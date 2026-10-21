#!/usr/bin/env node
// AVN PlayLens: starts the local server and opens the browser.
//   avn-playlens                 use the adb that's found (Unity's first), port 7420
//   avn-playlens --replay [file] add a pretend device that replays a capture (default: bundled demo)
//   avn-playlens --port 7500 --no-open --no-record
//   avn-playlens --dev           API only, for `npm run dev:web`
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Adb } from '../src/adb/client.mjs';
import { locateAdb } from '../src/adb/locate.mjs';
import { DeviceTracker } from '../src/adb/tracker.mjs';
import { Pairing, KeepAlive, DeviceStore } from '../src/wifi/pairing.mjs';
import { replayDevice } from '../src/replay/source.mjs';
import { RulesStore, BUNDLED_PACKS } from '../src/rules/loader.mjs';
import { EMBEDDED } from '../src/embedded.mjs';
import { createServer } from '../src/api/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// The single-file app carries its web page, rules pack and demo log inside; unpack them once
// per version to ~/.avn-playlens/app/<version>.
function unpack(embedded) {
  const dir = join(os.homedir(), '.avn-playlens', 'app', embedded.version);
  if (!existsSync(join(dir, '.complete'))) {
    for (const [rel, b64] of Object.entries(embedded.files)) {
      const file = join(dir, ...rel.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(b64, 'base64'));
    }
    writeFileSync(join(dir, '.complete'), embedded.version);
  }
  return dir;
}
const appDir = EMBEDDED ? unpack(EMBEDDED) : null;
const paths = appDir
  ? { web: join(appDir, 'web'), packs: join(appDir, 'packs'), demo: join(appDir, 'demo.logcat') }
  : { web: join(here, '..', '..', 'web', 'dist'), packs: BUNDLED_PACKS, demo: join(here, '..', 'fixtures', 'demo.logcat') };

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const port = Number(value('--port') || process.env.PLAYLENS_PORT || 7420);
const dev = flag('--dev');
const replayFile = flag('--replay') ? resolve(value('--replay') || paths.demo) : null;
const staticDir = paths.web;

async function main() {
const located = locateAdb();
const adb = located.path ? new Adb(located.path) : null;
const adbVersion = adb ? await adb.version().catch(() => null) : null;

const tracker = adb ? new DeviceTracker(adb) : null;
const store = new DeviceStore();
const pairing = adb ? new Pairing(adb, store) : null;
const keepAlive = adb && tracker ? new KeepAlive(adb, store, tracker) : null;
const replay = replayFile ? { file: replayFile, pkg: 'com.avn.demo', device: replayDevice('com.avn.demo') } : null;

const rules = new RulesStore({ packsDir: paths.packs });
rules.watch();

const deviceListeners = new Set();
const devices = () => [...(replay ? [replay.device] : []), ...(tracker?.list() ?? [])];
tracker?.on('change', () => { for (const fn of deviceListeners) fn(devices()); });

const ctx = {
  port,
  adb,
  pairing,
  replay,
  rules,
  record: !flag('--no-record'),
  staticDir: existsSync(staticDir) && !dev ? staticDir : null,
  extraHosts: dev ? ['localhost:5173', '127.0.0.1:5173'] : [],
  devices,
  onDevices: (fn) => deviceListeners.add(fn),
  status: () => ({
    adb: located.path,
    adbVersion,
    adbSearched: located.path ? undefined : located.searched,
    tracker: tracker?.status ?? 'off',
    replay: !!replay,
    platform: process.platform,
  }),
};

const server = createServer(ctx);
await server.listen();
tracker?.start();
keepAlive?.start();

const url = `http://127.0.0.1:${port}/`;
console.log(`\n  AVN PlayLens running at ${dev ? 'http://localhost:5173/ (vite)' : url}`);
console.log(adb ? `  adb: ${located.path}${adbVersion ? ` (${adbVersion})` : ''}` : '  adb: not found. Set PLAYLENS_ADB or install Android platform-tools.');
if (replay) console.log(`  replay: ${replay.file}`);
console.log(`  rules: ${rules.dir}`);
console.log(adb ? '  Press Ctrl+C to stop. Your phones stay connected.\n' : '  Press Ctrl+C to stop.\n');

if (!dev && !flag('--no-open') && ctx.staticDir) {
  const opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const shutdown = async () => {
  tracker?.stop();
  keepAlive?.stop();
  rules.close();
  pairing?.cancel();
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`\n  AVN PlayLens could not start: ${err.code === 'EADDRINUSE' ? `port ${port} is in use (is PlayLens already running? try --port 7421)` : err.message}\n`);
  if (EMBEDDED && process.platform === 'win32') setTimeout(() => process.exit(1), 15000);   // keep the window readable
  else process.exitCode = 1;
});
