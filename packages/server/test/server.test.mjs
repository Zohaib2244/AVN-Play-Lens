import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { parseLogcatLine, Grouper, classify, belongsToGame, startedPid } from '../src/logcat/parse.mjs';
import { parseDeviceList, TrackFrameParser, parseMdnsServices, transportOf } from '../src/adb/devices.mjs';
import { parseForeground, parsePids, parseGetprop } from '../src/device/info.mjs';
import { adbCandidates, locateAdb } from '../src/adb/locate.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeQrPayload, serviceId } from '../src/wifi/pairing.mjs';
import { replayDevice } from '../src/replay/source.mjs';
import { createServer } from '../src/api/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '..', 'fixtures', 'demo.logcat');

test('logcat threadtime + epoch line', () => {
  const l = parseLogcatLine('1729420812.123 18342 18360 I Unity   : Level 3 loaded');
  assert.deepEqual(l, { ts: 1729420812123, pid: 18342, tid: 18360, level: 'I', tag: 'Unity', message: 'Level 3 loaded' });
  assert.equal(parseLogcatLine('--------- beginning of main'), null);
  assert.equal(parseLogcatLine('1729420812.123  1520  1544 I ActivityManager: Start proc 1:a.b/u0').tag, 'ActivityManager');
  assert.equal(parseLogcatLine('1729420812.123 1 1 W FA-SVC  : x: y').message, 'x: y');
});

test('grouper merges a stack trace into one entry', async () => {
  const out = [];
  const g = new Grouper((e) => out.push(e), 5);
  const head = { ts: 1, pid: 2, tid: 2, level: 'E', tag: 'Unity' };
  g.push({ ...head, message: 'NullReferenceException: boom' });
  g.push({ ...head, message: '  at A.B ()' });
  g.push({ ...head, ts: 2, level: 'I', message: 'next' });
  g.flush();
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].more, ['  at A.B ()']);
});

test('classify: AVN, Unity exception, Firebase, crashes', () => {
  const avn = classify({ tag: 'Unity', level: 'I', message: 'Status SDK.Firebase => Initialized: ok | AVNPLUGIN' }, 'a.b');
  assert.equal(avn.source, 'avn');
  assert.equal(avn.avn.key, 'SDK.Firebase');
  assert.equal(classify({ tag: 'Unity', level: 'E', message: 'NullReferenceException: x' }).kind, 'exception');
  const fa = classify({ tag: 'FA', level: 'V', message: 'Logging event (FE): level_start, Bundle[{level=1}]' });
  assert.equal(fa.fa.name, 'level_start');
  assert.equal(classify({ tag: 'AndroidRuntime', level: 'E', message: 'FATAL EXCEPTION: main', more: ['Process: a.b, PID: 1'] }).kind, 'java-crash');
  assert.equal(classify({ tag: 'ActivityManager', level: 'E', message: 'ANR in a.b (a.b/.Main)' }, 'a.b').kind, 'anr');
});

test('game filter keeps its own processes and attributed system lines, rejects unowned Firebase', () => {
  const pids = new Set([10]);
  assert.equal(belongsToGame({ pid: 10, tag: 'Unity', message: '' }, 'a.b', pids), true);
  assert.equal(belongsToGame({ pid: 99, tag: 'FA-SVC', message: '' }, 'a.b', pids), false);
  assert.equal(belongsToGame({ pid: 99, tag: 'ActivityManager', message: 'ANR in a.b' }, 'a.b', pids), true);
  assert.equal(belongsToGame({ pid: 99, tag: 'chatty', message: 'x' }, 'a.b', pids), false);
  assert.equal(startedPid({ tag: 'ActivityManager', message: 'Start proc 18342:a.b/u0a1 for top-activity' }, 'a.b'), 18342);
});

test('device list, track-devices frames, transports', () => {
  const list = parseDeviceList('List of devices attached\nR5CW31X8KPL device product:dm1q model:SM_S911B device:dm1q transport_id:2\n192.168.1.42:37115 unauthorized transport_id:3\nABC no permissions (user in plugdev group); see [http://x] usb:1-1 transport_id:4\n');
  assert.equal(list.length, 3);
  assert.equal(list[0].props.model, 'SM_S911B');
  assert.equal(list[1].transport, 'wifi');
  assert.equal(list[2].state, 'no permissions');
  const payload = 'R5CW31X8KPL\tdevice\n';
  const frame = payload.length.toString(16).padStart(4, '0') + payload;
  const p = new TrackFrameParser();
  assert.deepEqual(p.push(frame.slice(0, 6)), []);
  assert.equal(p.push(frame.slice(6) + '0000')[0][0].serial, 'R5CW31X8KPL');
  assert.equal(transportOf('adb-R5C-abc._adb-tls-connect._tcp'), 'wifi');
});

test('mdns services, foreground app, pids, getprop', () => {
  const s = parseMdnsServices('List of discovered mdns services\nadb-R5C-AbC\t_adb-tls-connect._tcp\t192.168.1.42:37115\nplaylens-1a2b\t_adb-tls-pairing._tcp\t192.168.1.42:40123\n');
  assert.deepEqual(s.map((x) => x.kind), ['connect', 'pairing']);
  assert.equal(serviceId('adb-R5C-AbC'), 'adb-R5C');
  assert.equal(parseForeground('  topResumedActivity=ActivityRecord{8d1 u0 com.studio.puzzle/com.unity3d.player.UnityPlayerActivity t42}'), 'com.studio.puzzle');
  assert.deepEqual(parsePids('  PID NAME\n18342 com.studio.puzzle\n18390 com.studio.puzzle:remote\n1 init\n', 'com.studio.puzzle'), [18342, 18390]);
  assert.equal(parseGetprop('[ro.product.model]: [Pixel 7]\n')['ro.product.model'], 'Pixel 7');
});

test('adb candidates include Unity and the env override first', () => {
  const list = adbCandidates({ PLAYLENS_ADB: '/x/adb', PATH: '/usr/bin' }, 'linux');
  assert.equal(list[0], '/x/adb');
  assert.ok(list.includes(join('/usr/bin', 'adb')));
});

test('finds ADB in a custom Unity Hub editor install folder on Windows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-unity-adb-'));
  try {
    const hubDir = join(dir, 'roaming', 'UnityHub');
    const editors = join(dir, 'Unity Editors');
    const binDir = join(editors, '6000.3.25f1', 'Editor', 'Data', 'PlaybackEngines', 'AndroidPlayer', 'SDK', 'platform-tools');
    mkdirSync(hubDir, { recursive: true }); mkdirSync(binDir, { recursive: true });
    writeFileSync(join(hubDir, 'secondaryInstallPath.json'), JSON.stringify(editors));
    const adb = join(binDir, 'adb.exe'); writeFileSync(adb, 'test fixture');
    const result = locateAdb({ APPDATA: join(dir, 'roaming'), PATH: '' }, 'win32');
    assert.ok(result.searched.includes(adb));
    assert.equal(result.path, adb);
    writeFileSync(join(hubDir, 'secondaryInstallPath.json'), 'bad json');
    assert.doesNotThrow(() => adbCandidates({ APPDATA: join(dir, 'roaming'), PATH: '' }, 'win32'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('QR payload format', () => {
  const p = makeQrPayload();
  assert.match(p.qr, /^WIFI:T:ADB;S:playlens-[0-9a-f]{8};P:[\w-]{10};;$/);
});

// End to end: server in replay mode, host/origin checks, a live replay stream over the WebSocket.
test('server: other websites are refused, replay stream works', async () => {
  const port = 7499;
  const replay = { file: FIXTURE, pkg: 'com.avn.demo', device: replayDevice('com.avn.demo') };
  const srv = createServer({
    port, staticDir: null, record: false, adb: null, pairing: null, replay, games: { list: () => [{ packageId: 'com.avn.demo', name: 'Demo' }] },
    devices: () => [replay.device], onDevices: () => {}, status: () => ({ replay: true }),
  });
  await srv.listen();
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/status`, { headers: { origin: 'http://evil.example' } })).status, 403);
    const ok = await fetch(`${base}/api/devices`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json())[0].serial, 'replay');

    const entries = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const got = [];
      const timer = setTimeout(() => { ws.close(); resolve(got); }, 1800);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'stream.start', serial: 'replay', pkg: 'com.avn.demo', streamId: 1 })));
      ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'log.batch') got.push(...m.entries); });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    assert.ok(entries.length >= 5, `expected replay lines, got ${entries.length}`);
    assert.ok(entries.some((e) => e.source === 'avn' && e.avn.kind === 'status'));
    assert.ok(entries.every((e) => e.tag !== 'ActivityManager' || e.message.includes('com.avn.demo')));

    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://evil.example' });
    const code = await new Promise((r) => { bad.on('unexpected-response', (_q, res) => r(res.statusCode)); bad.on('error', () => r('error')); });
    assert.equal(code, 403);
  } finally {
    await srv.close();
  }
});

test('strict game attribution excludes other games and unattributed Firebase events', () => {
  const pids = new Set([123]);
  assert.equal(belongsToGame({ pid: 123, tag: 'FA', message: 'Logging event (FE): mine' }, 'com.demo.game', pids), true);
  assert.equal(belongsToGame({ pid: 999, tag: 'FA', message: 'Logging event (FE): another_game' }, 'com.demo.game', pids), false);
  assert.equal(belongsToGame({ pid: 999, tag: 'FA-SVC', message: 'Logging event: origin=app,name=unattributed' }, 'com.demo.game', pids), false);
  assert.equal(belongsToGame({ pid: 999, tag: 'FA-SVC', message: 'Logging event (FE): recommended_app, Bundle[{app=com.demo.game}]' }, 'com.demo.game', pids), false);
  assert.equal(belongsToGame({ pid: 999, tag: 'ActivityManager', message: 'ANR in com.demo.game.other' }, 'com.demo.game', pids), false);
  assert.equal(belongsToGame({ pid: 999, tag: 'ActivityManager', message: 'Start proc 123:com.demo.game/u0a1' }, 'com.demo.game', pids), true);
});
