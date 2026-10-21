#!/usr/bin/env node
// Builds AVN PlayLens as a single-file app per platform (Node's "single executable
// application"): the server, the web page, the rules pack and the demo log in one program.
// No Node install needed to run it; double-click and it opens in the browser.
//
//   npm run package                      all platforms
//   npm run package -- mac-arm64 win-x64 just these
//
// Output: release/AVN-PlayLens-<version>-<platform>.zip
// Mac binaries are ad-hoc signed (codesign on a Mac, rcodesign elsewhere; downloaded once).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'build');
const cache = join(build, 'cache');
const release = join(root, 'release');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const NODE = process.version;   // the blob must come from the same Node version as the binaries
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const TARGETS = {
  'mac-arm64': { node: 'darwin-arm64', exe: 'AVN-PlayLens', mac: true },
  'mac-x64': { node: 'darwin-x64', exe: 'AVN-PlayLens', mac: true },
  'win-x64': { node: 'win-x64', exe: 'AVN-PlayLens.exe', win: true },
  'linux-x64': { node: 'linux-x64', exe: 'AVN-PlayLens' },
};
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = wanted.length ? wanted : Object.keys(TARGETS);
for (const t of targets) if (!TARGETS[t]) throw new Error(`Unknown target ${t}. Use: ${Object.keys(TARGETS).join(', ')}`);

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const step = (msg) => console.log(`\n▸ ${msg}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

async function download(url, file) {
  if (existsSync(file)) return file;
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// The official Node binary for a platform, cached under build/cache.
async function nodeBinary(target) {
  const t = TARGETS[target];
  const out = join(cache, `node-bin-${NODE}-${t.node}${t.win ? '.exe' : ''}`);
  if (existsSync(out)) return out;
  if (t.win) return download(`https://nodejs.org/dist/${NODE}/win-x64/node.exe`, out);
  const name = `node-${NODE}-${t.node}`;
  const archive = await download(`https://nodejs.org/dist/${NODE}/${name}.tar.gz`, join(cache, `${name}.tar.gz`));
  run('tar', ['-xzf', archive, '-C', cache, `${name}/bin/node`]);
  copyFileSync(join(cache, name, 'bin', 'node'), out);
  return out;
}

async function macSigner() {
  if (process.platform === 'darwin') return (file) => run('codesign', ['--sign', '-', '--force', file]);
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const v = '0.29.0';
  const name = `apple-codesign-${v}-${arch}-unknown-linux-musl`;
  const bin = join(cache, name, 'rcodesign');
  if (!existsSync(bin)) {
    const archive = await download(`https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${v}/${name}.tar.gz`, join(cache, `${name}.tar.gz`));
    run('tar', ['-xzf', archive, '-C', cache]);
  }
  return (file) => run(bin, ['sign', file], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// ── 1. Web page ──────────────────────────────────────────────────────────────
if (!process.argv.includes('--skip-web')) {
  step('Building the web page');
  run('npm', ['run', 'build'], { cwd: root });
}

// ── 2. Embedded files ────────────────────────────────────────────────────────
step('Collecting files to embed');
const files = {};
const webDist = join(root, 'packages', 'web', 'dist');
for (const f of walk(webDist)) files[`web/${relative(webDist, f).split('\\').join('/')}`] = readFileSync(f);
const packs = join(root, 'rules', 'packs');
for (const f of walk(packs).filter((x) => /\.ya?ml$/.test(x))) files[`packs/${relative(packs, f)}`] = readFileSync(f);
files['demo.logcat'] = readFileSync(join(root, 'packages', 'server', 'fixtures', 'demo.logcat'));
const hash = createHash('sha256');
for (const [k, v] of Object.entries(files).sort()) hash.update(k).update(v);
const version = `${pkg.version}-${hash.digest('hex').slice(0, 8)}`;
mkdirSync(build, { recursive: true });
const embeddedFile = join(build, 'embedded.gen.mjs');
writeFileSync(embeddedFile, `export const EMBEDDED = ${JSON.stringify({ version, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('base64')])) })};\n`);
console.log(`  ${Object.keys(files).length} files · app version ${version}`);

// ── 3. One JavaScript file ───────────────────────────────────────────────────
step('Bundling the server');
const bundle = join(build, 'playlens.cjs');
await esbuild.build({
  entryPoints: [join(root, 'packages', 'server', 'bin', 'avn-playlens.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  external: ['bufferutil', 'utf-8-validate'],   // optional speed-ups for ws
  define: { 'import.meta.url': '"file:///avn-playlens/packages/server/bin/avn-playlens.mjs"' },
  logLevel: 'warning',
  plugins: [{
    name: 'embedded',
    setup(b) { b.onResolve({ filter: /embedded\.mjs$/ }, () => ({ path: embeddedFile })); },
  }],
});

// ── 4. SEA blob ──────────────────────────────────────────────────────────────
step('Preparing the app blob');
const blob = join(build, 'playlens.blob');
writeFileSync(join(build, 'sea-config.json'), JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
run(process.execPath, ['--experimental-sea-config', join(build, 'sea-config.json')], { stdio: ['ignore', 'ignore', 'inherit'] });

// ── 5. One program per platform ──────────────────────────────────────────────
const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const sign = targets.some((t) => TARGETS[t].mac) ? await macSigner() : null;
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });

const readme = (t) => `AVN PlayLens ${version}
==============================

Start it
  ${t.win ? 'Double-click AVN-PlayLens.exe.' : t.mac ? 'Double-click AVN-PlayLens (it opens in Terminal).' : 'Run ./AVN-PlayLens'}
  Your browser opens http://127.0.0.1:7420. Keep the ${t.win ? 'window' : 'Terminal window'} open while you use it;
  close it (or press Ctrl+C) to stop. Phones you connected stay connected for Unity.
${t.mac ? `
First time on a Mac
  macOS blocks apps that aren't from the App Store or a registered developer.
  Right-click AVN-PlayLens → Open → Open. You only need to do this once.
  If it still refuses: System Settings → Privacy & Security → "Open Anyway",
  or in Terminal:  xattr -d com.apple.quarantine /path/to/AVN-PlayLens
` : ''}${t.win ? `
First time on Windows
  If SmartScreen says "Windows protected your PC": More info → Run anyway.
` : ''}
adb
  PlayLens uses the adb that comes with Unity's Android Build Support (or Android
  platform-tools). If it isn't found, set PLAYLENS_ADB to the adb file.

Options (from a terminal)
  --port 7500     use another port
  --replay        add a pretend device that plays a demo log (no phone needed)
  --no-open       don't open the browser
  --no-record     don't save session history

Your data
  Everything stays on this computer in ~/.avn-playlens (rules, sessions, paired phones).
`;

for (const target of targets) {
  const t = TARGETS[target];
  step(`Building ${target}`);
  const name = `AVN-PlayLens-${pkg.version}-${target}`;
  const dir = join(build, 'out', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, t.exe);
  copyFileSync(await nodeBinary(target), exe);
  chmodSync(exe, 0o755);
  if (t.mac && process.platform === 'darwin') run('codesign', ['--remove-signature', exe]);
  run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', FUSE, ...(t.mac ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (t.mac) sign(exe);
  writeFileSync(join(dir, 'README.txt'), t.win ? readme(t).replace(/\n/g, '\r\n') : readme(t));
  const zip = join(release, `${name}.zip`);
  run('zip', ['-q', '-r', '-X', zip, name], { cwd: join(build, 'out') });
  console.log(`  ${relative(root, zip)} (${Math.round(statSync(zip).size / 1048576)} MB)`);
}
console.log(`\nDone. Zips are in ${relative(root, release)}/\n`);
