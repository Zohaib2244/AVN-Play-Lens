import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer as createNetServer } from 'node:net';
import WebSocket from 'ws';
import { SnapshotStore, LevelSnapshooter, levelNumber } from '../src/snapshots/snapshots.mjs';
import { crc32 } from '../src/snapshots/zip.mjs';
import { Adb } from '../src/adb/client.mjs';
import { createServer } from '../src/api/server.mjs';

const PKG = 'com.studio.game';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII=', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { if (await fn()) return; await sleep(10); }
  assert.fail('Snapshot operation timed out');
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-snapshots-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new SnapshotStore(dir);
  const state = { connected: true, foreground: PKG, calls: [], png: PNG };
  const adb = {
    shell: async (_serial, command) => {
      if (command.startsWith('ps')) return `123 ${PKG}\n`;
      if (command.startsWith('date')) return `${Date.now() / 1000}`;
      return `topResumedActivity=ActivityRecord{x u0 ${state.foreground}/.Main}`;
    },
    run: async (args, options) => { state.calls.push({ args, options }); if (state.hold) await state.hold; return state.png; },
  };
  const shooter = new LevelSnapshooter({ adb, store, connected: () => state.connected });
  t.after(() => shooter.close());
  return { dir, store, state, adb, shooter };
}

test('snapshots persist per game with numeric filenames and valid stored ZIP records', (t) => {
  const { store, dir } = fixture(t);
  store.save(PKG, 10, PNG); store.save(PKG, 2, PNG); store.save('com.other.game', 1, PNG);
  assert.deepEqual(new SnapshotStore(dir).list(PKG).map((s) => s.name), ['2.png', '10.png']);
  store.save(PKG, 2, PNG);
  assert.equal(store.list(PKG).length, 2);
  assert.deepEqual(store.read(PKG, 2), PNG);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const zip = store.zip(PKG, [2]);
  assert.equal(zip.readUInt32LE(), 0x04034b50);
  const nameLength = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), '2.png');
  assert.deepEqual(zip.subarray(30 + nameLength, 30 + nameLength + PNG.length), PNG);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 1);
  const central = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt32LE(central), 0x02014b50);
  assert.equal(zip.readUInt32LE(central + 42), 0);
  for (const value of [-1, 1.2, '', null, undefined, '../2', '01', 1e9]) assert.throws(() => levelNumber(value));
  assert.equal(levelNumber(0), 0);
  assert.throws(() => store.list('../outside'));
  assert.throws(() => store.save(PKG, 3, Buffer.from('not a png')));
  assert.throws(() => store.zip(PKG, [99]), /No snapshot/);
  assert.throws(() => store.zip(PKG, []), /Capture or select/);
});

test('adb preserves screenshot bytes in buffer mode', async () => {
  const adb = new Adb(process.execPath);
  const result = await adb.run(['-e', `process.stdout.write(Buffer.from('${PNG.toString('base64')}', 'base64'))`], { encoding: 'buffer' });
  assert.deepEqual(result, PNG);
  assert.equal(await adb.run(['-e', "process.stdout.write('text')"]), 'text');
});

test('auto capture deduplicates, preserves saved levels, cancels on pause and rejects background screens', async (t) => {
  const { store, shooter, state } = fixture(t);
  shooter.watch(PKG, 'phone', 'tab');
  shooter.configure(PKG, { enabled: true, serial: 'phone', delayMs: 10 });
  shooter.observe(PKG, 'another-phone', 1);
  shooter.observe(PKG, 'phone', 1); shooter.observe(PKG, 'phone', 1);
  await until(() => store.has(PKG, 1));
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0], { args: ['exec-out', 'screencap', '-p'], options: { serial: 'phone', encoding: 'buffer', timeout: 15000 } });
  shooter.observe(PKG, 'phone', 2); shooter.unwatch(PKG, 'phone', 'tab');
  await sleep(40);
  assert.equal(store.has(PKG, 2), false);
  shooter.watch(PKG, 'phone', 'tab');
  shooter.observe(PKG, 'phone', 1); await sleep(30);
  assert.equal(state.calls.length, 1);
  state.foreground = 'com.other.app';
  shooter.observe(PKG, 'phone', 2);
  await until(() => shooter.status(PKG).error);
  assert.equal(store.has(PKG, 2), false);
  assert.equal(state.calls.length, 1);
  state.foreground = PKG;
  await shooter.capture(PKG, 'phone', 2);
  assert.equal(shooter.status(PKG).error, null);
  state.connected = false;
  await assert.rejects(shooter.capture(PKG, 'phone', 3), /connected phone/);
});

test('a level change during screencap discards the stale image and captures the next level', async (t) => {
  const { store, shooter, state } = fixture(t);
  shooter.watch(PKG, 'phone', 'tab');
  shooter.configure(PKG, { enabled: true, serial: 'phone', delayMs: 0 });
  let release;
  state.hold = new Promise((resolve) => { release = resolve; });
  shooter.observe(PKG, 'phone', 3);
  await until(() => state.calls.length === 1);
  shooter.observe(PKG, 'phone', 4);
  await sleep(20);
  release(); state.hold = null;
  await until(() => store.has(PKG, 4));
  assert.equal(store.has(PKG, 3), false);
  assert.equal(state.calls.length, 2);
  shooter.observe(PKG, 'phone', 5);
  shooter.configure(PKG, { enabled: false, serial: 'phone' });
  await sleep(30);
  assert.equal(store.has(PKG, 5), false);
});

test('foreground changes and invalid screencap responses never enter the gallery', async (t) => {
  const { shooter, store, state } = fixture(t);
  state.png = Buffer.from('adb: device offline');
  await assert.rejects(shooter.capture(PKG, 'phone', 1), /PNG screenshot/);
  let release;
  state.png = PNG;
  state.hold = new Promise((resolve) => { release = resolve; });
  const capture = shooter.capture(PKG, 'phone', 1);
  await until(() => state.calls.length === 2);
  state.foreground = 'com.other.app'; release();
  await assert.rejects(capture, /left the foreground/);
  assert.deepEqual(store.list(PKG), []);
});

test('snapshot API: capture, gallery, PNG download, ZIP selection, origin checks, live level detection and pause', async (t) => {
  const { adb, state, store } = fixture(t);
  let log;
  adb.spawn = () => {
    log = new EventEmitter(); log.stdout = new PassThrough(); log.stderr = new PassThrough();
    log.kill = () => { log.stdout.end(); log.emit('exit', 0); };
    return log;
  };
  const reservation = createNetServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const srv = createServer({ port, staticDir: null, adb, record: false, snapshots: store,
    games: { list: () => [{ packageId: PKG }] }, devices: () => [{ serial: 'phone', state: 'device' }], onDevices: () => {}, status: () => ({}) });
  await srv.listen(); t.after(() => srv.close());
  const base = `http://127.0.0.1:${port}/api/snapshots/${PKG}`;
  const get = (suffix = '', options = {}) => fetch(base + suffix, options);
  const post = (suffix, body) => get(suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await get('', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await post('/capture', { serial: 'phone', level: '../2' })).status, 400);
  assert.equal((await post('/capture', { serial: 'replay', level: 1 })).status, 409);
  assert.equal((await post('/capture', { serial: 'phone', level: 10 })).status, 201);
  assert.equal((await post('/capture', { serial: 'phone', level: 2 })).status, 201);
  assert.deepEqual((await (await get()).json()).snapshots.map((s) => s.name), ['2.png', '10.png']);
  const png = await get('/2.png?download=1');
  assert.match(png.headers.get('content-disposition'), /filename="2.png"/);
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG);
  const zip = await get('/download.zip?levels=10');
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const zipData = Buffer.from(await zip.arrayBuffer());
  assert.equal(zipData.readUInt16LE(zipData.length - 12), 1);
  assert.equal((await get('/download.zip?levels=100')).status, 404);
  assert.equal((await get('/nope.png')).status, 400);
  assert.equal((await post('/settings', { enabled: true, serial: 'phone', delayMs: -1 })).status, 400);
  await post('/settings', { enabled: true, serial: 'phone', delayMs: 80 });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  t.after(() => ws.terminate());
  await once(ws, 'open');
  const session = new Promise((resolve) => ws.on('message', (raw) => { if (JSON.parse(raw).type === 'session') resolve(); }));
  ws.send(JSON.stringify({ type: 'stream.start', serial: 'phone', pkg: PKG, streamId: 1 }));
  await session;
  const line = (level) => log.stdout.write(`${Date.now() / 1000} 123 123 V FA: Logging event (FE): level_start, Bundle[{level=${level}}]\n`);
  line(7);
  await until(() => store.has(PKG, 7));
  line(8);
  await until(async () => (await (await get()).json()).capture.pendingLevel === 8);
  ws.send(JSON.stringify({ type: 'stream.pause', streamId: 1 }));
  await until(async () => !(await (await get()).json()).capture.watching);
  await sleep(120);
  assert.equal(store.has(PKG, 8), false);
  assert.ok(state.calls.every((c) => c.args.join(' ') === 'exec-out screencap -p'));
});
