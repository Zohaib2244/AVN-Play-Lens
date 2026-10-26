// Build sources and installs: reading APK/AAB identity, watching a build folder, uploads,
// installing through a fake adb, failure explanations and automatic installs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotZip } from '../src/snapshots/zip.mjs';
import { parseBinaryManifest, parseProtoManifest } from '../src/install/manifest.mjs';
import { inspectArtifact, deviceMismatch } from '../src/install/artifact.mjs';
import { explainInstallFailure } from '../src/install/errors.mjs';
import { BuildSources, patternRegex } from '../src/install/builds.mjs';
import { Installer, parseDumpsysTime } from '../src/install/installer.mjs';
import { createServer } from '../src/api/server.mjs';

// ---- synthetic manifests -------------------------------------------------------------

// Binary XML (AXML) with <manifest package versionCode versionName><uses-sdk minSdkVersion/>.
function axml({ packageId, versionCode, versionName, minSdk, split }) {
  const strings = ['package', 'versionCode', 'versionName', 'minSdkVersion', 'manifest', 'uses-sdk', 'android', 'http://schemas.android.com/apk/res/android', packageId, versionName, 'split', split ?? ''];
  const idx = (s) => strings.indexOf(s);
  const encoded = strings.map((s) => { const b = Buffer.alloc(2 + s.length * 2 + 2); b.writeUInt16LE(s.length, 0); b.write(s, 2, 'utf16le'); return b; });
  const offsets = []; let o = 0;
  for (const e of encoded) { offsets.push(o); o += e.length; }
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const poolHeader = Buffer.alloc(28);
  const stringsStart = 28 + strings.length * 4;
  poolHeader.writeUInt16LE(0x0001, 0); poolHeader.writeUInt16LE(28, 2); poolHeader.writeUInt32LE(stringsStart + data.length, 4);
  poolHeader.writeUInt32LE(strings.length, 8); poolHeader.writeUInt32LE(0, 12); poolHeader.writeUInt32LE(0, 16); poolHeader.writeUInt32LE(stringsStart, 20);
  const offs = Buffer.alloc(strings.length * 4); offsets.forEach((v, i) => offs.writeUInt32LE(v, i * 4));
  const pool = Buffer.concat([poolHeader, offs, data]);
  // Resource map: indexes 1..3 are the android: attributes (0 is "package", which has none).
  const resMap = Buffer.alloc(8 + 4 * 4);
  resMap.writeUInt16LE(0x0180, 0); resMap.writeUInt16LE(8, 2); resMap.writeUInt32LE(resMap.length, 4);
  [0, 0x0101021b, 0x0101021c, 0x0101020c].forEach((v, i) => resMap.writeUInt32LE(v, 8 + i * 4));
  const element = (name, attrs) => {
    const head = Buffer.alloc(16 + 20);
    head.writeUInt16LE(0x0102, 0); head.writeUInt16LE(16, 2); head.writeUInt32LE(36 + attrs.length * 20, 4);
    head.writeUInt32LE(1, 8); head.writeUInt32LE(0xffffffff, 12);
    head.writeUInt32LE(0xffffffff, 16); head.writeUInt32LE(idx(name), 20); head.writeUInt16LE(20, 24); head.writeUInt16LE(20, 26); head.writeUInt16LE(attrs.length, 28);
    const body = Buffer.alloc(attrs.length * 20);
    attrs.forEach(([nameIdx, kind, value], i) => {
      const p = i * 20;
      body.writeUInt32LE(0xffffffff, p);
      body.writeUInt32LE(nameIdx, p + 4);
      body.writeUInt32LE(kind === 'string' ? idx(value) : 0xffffffff, p + 8);
      body.writeUInt16LE(8, p + 12);
      body[p + 15] = kind === 'string' ? 0x03 : 0x10;
      body.writeUInt32LE(kind === 'string' ? idx(value) : value, p + 16);
    });
    return Buffer.concat([head, body]);
  };
  const manifestAttrs = [[0, 'string', packageId], [1, 'int', versionCode], [2, 'string', versionName]];
  if (split) manifestAttrs.push([idx('split'), 'string', split]);
  const chunks = Buffer.concat([pool, resMap, element('manifest', manifestAttrs), element('uses-sdk', [[3, 'int', minSdk]])]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0); header.writeUInt16LE(8, 2); header.writeUInt32LE(8 + chunks.length, 4);
  return Buffer.concat([header, chunks]);
}

// aapt2 protobuf XML for app bundles.
const varint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const ld = (no, buf) => Buffer.concat([varint(no * 8 + 2), varint(buf.length), buf]);
const str = (no, s) => ld(no, Buffer.from(s));
const attr = (name, value, resId) => ld(4, Buffer.concat([str(2, name), str(3, value), ...(resId ? [varint(5 * 8), varint(resId)] : [])]));
function protoXml({ packageId, versionCode, versionName, minSdk }) {
  const usesSdk = ld(5, ld(1, Buffer.concat([str(3, 'uses-sdk'), attr('minSdkVersion', String(minSdk), 0x0101020c)])));
  const manifest = Buffer.concat([str(3, 'manifest'), attr('package', packageId), attr('versionCode', String(versionCode), 0x0101021b), attr('versionName', versionName, 0x0101021c), usesSdk]);
  return ld(1, manifest);
}

const apk = (m, abis = ['arm64-v8a']) => snapshotZip([{ name: 'AndroidManifest.xml', data: axml(m) }, ...abis.map((a) => ({ name: `lib/${a}/libunity.so`, data: Buffer.from('x') }))]);
const aab = (m) => snapshotZip([{ name: 'base/manifest/AndroidManifest.xml', data: protoXml(m) }, { name: 'base/lib/arm64-v8a/libunity.so', data: Buffer.from('x') }]);
const GAME = { id: 'g1', name: 'Tower', packageId: 'com.studio.tower' };
const ID = { packageId: GAME.packageId, versionCode: 7, versionName: '1.0.7', minSdk: 24 };
const library = (games = [GAME]) => ({ list: () => games });
const tmp = (p) => mkdtempSync(join(tmpdir(), `playlens-${p}-`));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out'); };

// ---- identity ------------------------------------------------------------------------

test('manifest parsers read package, version and min SDK from APK and bundle formats', () => {
  assert.deepEqual(parseBinaryManifest(axml(ID)), { ...ID, split: null });
  assert.deepEqual(parseProtoManifest(protoXml(ID)), { ...ID, split: null });
  assert.throws(() => parseBinaryManifest(Buffer.from('<manifest/>')), /not binary XML/);
});

test('inspectArtifact decides by content and explains bad files', async () => {
  const dir = tmp('artifacts');
  writeFileSync(join(dir, 'Tower.apk'), apk(ID, ['arm64-v8a', 'armeabi-v7a']));
  writeFileSync(join(dir, 'Tower.aab'), aab(ID));
  writeFileSync(join(dir, 'renamed.apk'), aab(ID));
  writeFileSync(join(dir, 'text.apk'), 'hello');
  writeFileSync(join(dir, 'empty.apk'), '');
  writeFileSync(join(dir, 'zip.apk'), snapshotZip([{ name: 'readme.txt', data: Buffer.from('x') }]));
  writeFileSync(join(dir, 'config.apk'), apk({ ...ID, split: 'config.arm64_v8a' }));

  const a = await inspectArtifact(join(dir, 'Tower.apk'));
  assert.equal(a.kind, 'apk');
  assert.deepEqual([a.packageId, a.versionCode, a.versionName, a.minSdk], [GAME.packageId, 7, '1.0.7', 24]);
  assert.deepEqual(a.abis, ['arm64-v8a', 'armeabi-v7a']);
  assert.equal((await inspectArtifact(join(dir, 'Tower.aab'))).kind, 'aab');
  assert.equal((await inspectArtifact(join(dir, 'renamed.apk'))).kind, 'aab');

  const code = (p) => inspectArtifact(join(dir, p)).then(() => 'ok', (e) => e.code);
  assert.equal(await code('text.apk'), 'not-zip');
  assert.equal(await code('empty.apk'), 'empty');
  assert.equal(await code('zip.apk'), 'not-android');
  assert.equal(await code('config.apk'), 'split-apk');
  assert.equal(await code('missing.apk'), 'not-found');
  assert.equal(await inspectArtifact(dir).catch((e) => e.code), 'is-folder');
});

test('phone checks: Android version and CPU architecture', () => {
  const artifact = { kind: 'apk', minSdk: 26, abis: ['arm64-v8a'] };
  assert.equal(deviceMismatch(artifact, { sdk: 25, abis: ['arm64-v8a'] }).code, 'older-sdk');
  assert.equal(deviceMismatch(artifact, { sdk: 30, abis: ['armeabi-v7a'] }).code, 'no-matching-abi');
  assert.equal(deviceMismatch(artifact, { sdk: 30, abis: ['arm64-v8a', 'armeabi-v7a'] }), null);
  assert.equal(deviceMismatch({ ...artifact, abis: [] }, { sdk: 30, abis: ['x86'] }), null);
});

test('install failures become a reason, a fix and a retry kind', () => {
  const sig = explainInstallFailure('Performing Streamed Install\nadb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.a signatures do not match newer version; ignoring!]');
  assert.deepEqual([sig.code, sig.retry], ['signature-mismatch', 'uninstall']);
  const down = explainInstallFailure('Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Update version code 3 is older than current 9]');
  assert.equal(down.code, 'version-downgrade');
  assert.match(down.message, /versionCode 9, newer than this build \(3\)/);
  assert.equal(explainInstallFailure('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]').code, 'no-space');
  assert.equal(explainInstallFailure('adb: device \'R58M\' not found').code, 'phone-disconnected');
  assert.equal(explainInstallFailure('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]').code, 'blocked-on-phone');
  assert.equal(explainInstallFailure('[BT:1.17.2] Error: No connected devices found.\ncom.android...CommandExecutionException: No connected devices found.').code, 'phone-disconnected');
  const bt = explainInstallFailure('[BT:1.17.2] Error: Something odd.\n\tat com.android.tools.Foo.bar(Foo.java:1)\n\t... 3 more', { fallback: 'bundletool failed' });
  assert.equal(bt.message, 'bundletool failed: Something odd.');
  assert.doesNotMatch(bt.output, /Foo\.java|more/);
  const unknown = explainInstallFailure('Failure [INSTALL_FAILED_WEIRD_THING]');
  assert.deepEqual([unknown.code, unknown.retry], ['install-failed-weird-thing', 'again']);
  assert.match(unknown.output, /WEIRD_THING/);
});

test('file name patterns: * and ? wildcards, case-insensitive, no partial matches', () => {
  const re = patternRegex('Tower-*.apk');
  assert.ok(re.test('Tower-1.0.7.apk') && re.test('tower-x.APK'));
  assert.ok(!re.test('Tower-1.apk.tmp') && !re.test('OldTower-1.apk'));
  assert.ok(patternRegex('Tower.*').test('Tower.aab'));
  assert.ok(patternRegex('T?wer.apk').test('Tower.apk'));
});

// ---- sources -------------------------------------------------------------------------

test('file source: validates the path and the game', async () => {
  const dir = tmp('file-source');
  writeFileSync(join(dir, 'Tower.apk'), apk(ID));
  writeFileSync(join(dir, 'Other.apk'), apk({ ...ID, packageId: 'com.other.game' }));
  const sources = new BuildSources({ dir: tmp('data'), games: library() });
  const err = (input) => sources.setSource('g1', input).then(() => null, (e) => e);
  assert.equal((await err({ type: 'file', path: '' })).code, 'bad-path');
  assert.equal((await err({ type: 'file', path: 'relative/Tower.apk' })).code, 'bad-path');
  assert.equal((await err({ type: 'file', path: join(dir, 'nope.apk') })).code, 'not-found');
  const wrong = await err({ type: 'file', path: join(dir, 'Other.apk') });
  assert.equal(wrong.code, 'wrong-game');
  assert.match(wrong.message, /Other\.apk is com\.other\.game, but Tower is com\.studio\.tower/);
  await assert.rejects(sources.setSource('nope', { type: 'file', path: join(dir, 'Tower.apk') }), /Game not found/);

  const view = await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk'), autoInstall: true });
  assert.equal(view.latest.versionCode, 7);
  assert.equal(view.status.state, 'ready');
  assert.equal(view.source.autoInstall, true);
  // Deleted after it was chosen: caught at install time.
  rmSync(join(dir, 'Tower.apk'));
  await assert.rejects(sources.latestArtifact('g1'), (e) => e.code === 'not-found');
  assert.equal(sources.get('g1').status.state, 'error');
});

test('folder source: validates, waits for the build to settle, picks the newest match, flags the wrong game', async () => {
  const dir = tmp('folder-source');
  const sources = new BuildSources({ dir: tmp('data'), games: library(), pollMs: 50, settleMs: 150 });
  const artifacts = [];
  sources.on('artifact', (id, a) => artifacts.push(a));
  try {
    const err = (input) => sources.setSource('g1', input).then(() => null, (e) => e.code);
    assert.equal(await err({ type: 'folder', dir: join(dir, 'missing'), pattern: 'Tower.apk' }), 'folder-missing');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.equal(await err({ type: 'folder', dir: join(dir, 'file.txt'), pattern: 'Tower.apk' }), 'not-folder');
    assert.equal(await err({ type: 'folder', dir, pattern: '' }), 'bad-pattern');
    assert.equal(await err({ type: 'folder', dir, pattern: 'Builds/Tower.apk' }), 'bad-pattern');
    assert.equal(await err({ type: 'folder', dir, pattern: 'Tower.zip' }), 'bad-pattern');

    writeFileSync(join(dir, 'Tower-old.apk'), apk(ID));
    let view = await sources.setSource('g1', { type: 'folder', dir, pattern: 'Tower.apk' });
    await until(() => sources.get('g1').status?.state === 'waiting');
    assert.match(sources.get('g1').status.hint, /Tower-old\.apk/);   // near miss named in the hint
    await assert.rejects(sources.latestArtifact('g1'), /No file named Tower\.apk/);

    // A file still being written is not read until it stops changing.
    view = await sources.setSource('g1', { type: 'folder', dir, pattern: 'Tower-*.apk' });
    const old = new Date(Date.now() - 60000);
    utimesSync(join(dir, 'Tower-old.apk'), old, old);
    await until(() => sources.get('g1').latest?.name === 'Tower-old.apk');
    writeFileSync(join(dir, 'Tower-new.apk'), apk({ ...ID, versionCode: 8 }));
    await until(() => sources.get('g1').status?.state === 'settling');
    await until(() => sources.get('g1').latest?.name === 'Tower-new.apk');
    assert.equal(sources.get('g1').latest.versionCode, 8);
    assert.match(sources.get('g1').status.message, /newest of 2/);
    assert.deepEqual(artifacts.map((a) => a.name), ['Tower-old.apk', 'Tower-new.apk']);

    // The newest match is another game: reported, and not replaced by the older good build.
    writeFileSync(join(dir, 'Tower-zz.apk'), apk({ ...ID, packageId: 'com.other.game' }));
    await until(() => sources.get('g1').status?.code === 'wrong-game');
    await assert.rejects(sources.latestArtifact('g1'), (e) => e.code === 'wrong-game');
    void view;
  } finally { sources.close(); }
});

// ---- installs ------------------------------------------------------------------------

// A fake adb: answers getprop/dumpsys and runs `install`/`uninstall` with scripted outputs.
function fakeAdb({ installs = ['Performing Streamed Install\nSuccess\n'], installed = null, sdk = 30, abis = 'arm64-v8a,armeabi-v7a' } = {}) {
  const calls = [];
  const state = { installed };
  return {
    bin: '/fake/adb', calls, state,
    async shell(serial, cmd) {
      calls.push(cmd);
      if (cmd.startsWith('getprop')) return `${sdk}\n${abis}\n`;
      if (cmd.startsWith('dumpsys package')) return state.installed ? `    versionCode=${state.installed.versionCode} minSdk=24 targetSdk=34\n    versionName=${state.installed.versionName}\n    lastUpdateTime=${state.installed.lastUpdate ?? '2020-01-01 00:00:00'}\n` : '';
      return '';
    },
    spawn(args) {
      calls.push(args.join(' '));
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', null, 'SIGKILL');
      setImmediate(() => {
        let out = '';
        if (args[0] === 'install') {
          out = installs.length > 1 ? installs.shift() : installs[0];
          if (/Success/.test(out)) state.installed = { versionCode: 7, versionName: '1.0.7', lastUpdate: '2099-01-01 00:00:00' };
        } else if (args[0] === 'uninstall') { out = 'Success\n'; state.installed = null; }
        child.stdout.end(out);
        child.emit('close', /Success/.test(out) ? 0 : 1);
      });
      return child;
    },
  };
}

function setup({ adb = fakeAdb(), devices = [{ serial: 'S1', state: 'device', info: { model: 'Galaxy A51' } }], busy, tools } = {}) {
  const dir = tmp('install-src');
  writeFileSync(join(dir, 'Tower.apk'), apk(ID));
  writeFileSync(join(dir, 'Tower.aab'), aab(ID));
  const sources = new BuildSources({ dir: tmp('data'), games: library() });
  const installer = new Installer({ adb, sources, games: library(), devices: () => devices, busy, tools: tools ?? (() => ({ jar: null, java: null })), dir: tmp('data') });
  return { dir, sources, installer, adb };
}
const settle = (installer, id) => until(() => { const j = installer.get(id); return j && !['queued', 'running'].includes(j.status) ? j : null; });

test('installs an APK step by step and confirms the version on the phone', async () => {
  const { dir, sources, installer, adb } = setup();
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk') });
  const job = await settle(installer, installer.start({ gameId: 'g1', serial: 'S1' }).id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.steps.map((s) => [s.id, s.status]), [['find', 'done'], ['check', 'done'], ['install', 'done'], ['verify', 'done']]);
  assert.equal(job.device, 'Galaxy A51');
  assert.deepEqual(job.installed, { versionName: '1.0.7', versionCode: 7 });
  assert.ok(adb.calls.includes(`install -r -d -t ${join(dir, 'Tower.apk')}`));
  assert.equal(sources.get('g1').installs.S1.ok, true);
});

test('refuses to start without a phone, a source, or while busy; failures carry the fix', async () => {
  const devices = [{ serial: 'S1', state: 'device' }, { serial: 'S2', state: 'unauthorized' }];
  const adb = fakeAdb({ installs: ['Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]', 'Success'] });
  let qaBusy = null;
  const { dir, sources, installer } = setup({ adb, devices, busy: () => qaBusy });
  assert.throws(() => installer.start({ gameId: 'g1', serial: 'S1' }), /Choose where Tower's builds come from/);
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk') });
  assert.throws(() => installer.start({ gameId: 'g1', serial: 'S9' }), /not connected/);
  assert.throws(() => installer.start({ gameId: 'g1', serial: 'S2' }), /Allow USB debugging/);
  assert.throws(() => installer.start({ gameId: 'nope', serial: 'S1' }), /Game not found/);

  qaBusy = 'QA run abc is using this phone';
  let job = await settle(installer, installer.start({ gameId: 'g1', serial: 'S1' }).id);
  assert.deepEqual([job.status, job.error.code], ['failed', 'phone-busy']);
  qaBusy = null;

  const first = installer.start({ gameId: 'g1', serial: 'S1' });
  assert.throws(() => installer.start({ gameId: 'g1', serial: 'S1' }), (e) => e.statusCode === 409 && e.jobId === first.id);
  job = await settle(installer, first.id);
  assert.deepEqual([job.status, job.error.code, job.error.retry], ['failed', 'signature-mismatch', 'uninstall']);
  assert.match(job.error.hint, /deletes the game's data/);
  assert.equal(sources.get('g1').installs.S1.ok, false);

  // The retry the page offers: uninstall first, then install.
  job = await settle(installer, installer.start({ gameId: 'g1', serial: 'S1', uninstallFirst: true }).id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.steps.map((s) => s.id), ['find', 'check', 'uninstall', 'install', 'verify']);
});

test('checks the phone before copying: too old Android, wrong CPU', async () => {
  const { dir, sources, installer } = setup({ adb: fakeAdb({ sdk: 22 }) });
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk') });
  const job = await settle(installer, installer.start({ gameId: 'g1', serial: 'S1' }).id);
  assert.equal(job.error.code, 'older-sdk');
  assert.match(job.error.message, /needs Android API 24 or newer; the phone runs API 22/);
  assert.ok(!installer.adb.calls.some((c) => c.startsWith('install')));
});

test('app bundles need bundletool and Java; a clear error when they are missing', async () => {
  const { dir, sources, installer } = setup();
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.aab') });
  const job = await settle(installer, installer.start({ gameId: 'g1', serial: 'S1' }).id);
  assert.deepEqual([job.status, job.error.code], ['failed', 'no-bundletool']);
  assert.match(job.error.hint, /Android Build Support/);
  assert.equal(job.steps.at(-1).id, 'prepare');
});

test('auto-install: new builds and newly connected phones get the build once; failures wait for a manual retry', async () => {
  const devices = [];
  const adb = fakeAdb();
  const { dir, sources, installer } = setup({ adb, devices });
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk'), autoInstall: true });
  assert.equal(installer.list().length, 0);   // no phone yet

  devices.push({ serial: 'S1', state: 'device' });
  installer.observeDevices(devices);
  const auto = await until(() => installer.list().find((j) => j.trigger === 'auto'));
  assert.equal((await settle(installer, auto.id)).status, 'done');

  // Same build, phone reconnects: nothing to do.
  installer.observeDevices([]);
  installer.observeDevices(devices);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(installer.list().length, 1);

  // Off: a new build is not installed by itself.
  sources.setAutoInstall('g1', false);
  assert.deepEqual(await installer.autoInstall('g1'), []);
});

test('auto-install does not retry a build that failed on a phone', async () => {
  const devices = [{ serial: 'S1', state: 'device' }];
  const { dir, sources, installer } = setup({ adb: fakeAdb({ installs: ['Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]'] }), devices });
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk'), autoInstall: true });
  const auto = await until(() => installer.list().find((j) => j.trigger === 'auto'));
  assert.equal((await settle(installer, auto.id)).error.code, 'no-space');
  installer.observeDevices([]);
  installer.observeDevices(devices);
  assert.deepEqual(await installer.autoInstall('g1'), []);
  assert.equal(installer.list().length, 1);
});

test('auto-install skips a phone that already has a newer install (Unity Build and Run)', async () => {
  const adb = fakeAdb({ installed: { versionCode: 7, versionName: '1.0.7', lastUpdate: '2099-01-01 00:00:00' } });
  const { dir, sources, installer } = setup({ adb });
  await sources.setSource('g1', { type: 'file', path: join(dir, 'Tower.apk'), autoInstall: true });
  assert.deepEqual(await installer.autoInstall('g1'), []);
  assert.equal(parseDumpsysTime('2026-10-26 16:25:01'), new Date(2026, 9, 26, 16, 25, 1).getTime());
  assert.equal(parseDumpsysTime('garbage'), null);
});

// ---- HTTP ----------------------------------------------------------------------------

test('API: upload keeps only builds of this game; install errors return a hint', async () => {
  const dataDir = tmp('api-data');
  const games = { list: () => [GAME], remove: () => true };
  const port = 7511;
  const srv = createServer({
    port, staticDir: null, record: false, adb: null, pairing: null, games, dataDir,
    devices: () => [], onDevices: () => {}, status: () => ({}), bundleTools: () => ({ jar: null, java: null }),
  });
  await srv.listen();
  const base = `http://127.0.0.1:${port}/api`;
  const upload = (name, body) => fetch(`${base}/builds/g1/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body });
  try {
    let r = await upload('notes.txt', 'x');
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /\.apk or \.aab/);

    r = await upload('Other.apk', apk({ ...ID, packageId: 'com.other.game' }));
    const wrong = await r.json();
    assert.deepEqual([r.status, wrong.code], [400, 'wrong-game']);
    assert.match(wrong.error, /^Other\.apk is com\.other\.game/);
    assert.ok(wrong.hint);
    assert.equal(readdirSync(join(dataDir, 'artifacts', 'g1')).length, 0);   // nothing left behind

    r = await upload('Tower 1.0.7.apk', apk(ID));
    assert.equal(r.status, 201);
    const view = await r.json();
    assert.equal(view.source.type, 'file');
    assert.equal(view.source.uploaded, true);
    assert.equal(view.latest.versionName, '1.0.7');
    assert.ok(existsSync(view.source.path));

    const state = await (await fetch(`${base}/builds/g1`)).json();
    assert.deepEqual(state.tools, { bundletool: false, java: false });
    assert.equal(state.jobs.length, 0);

    r = await fetch(`${base}/installs`, { method: 'POST', body: JSON.stringify({ gameId: 'g1', serial: 'S1' }) });
    assert.equal(r.status, 503);   // no adb in this server

    r = await fetch(`${base}/builds/g1/source`, { method: 'PUT', body: JSON.stringify({ type: 'folder', dir: join(dataDir, 'nope'), pattern: 'x.apk' }) });
    const folder = await r.json();
    assert.deepEqual([r.status, folder.code], [400, 'folder-missing']);

    r = await fetch(`${base}/builds/g1/source`, { method: 'DELETE' });
    assert.equal((await r.json()).source, null);
    assert.ok(!existsSync(view.source.path));   // the uploaded copy is removed with the source
  } finally { await srv.close(); }
});
