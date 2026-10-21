// End to end through the real start command with a fake adb (test/fake-adb.cjs):
// device tracking, device details, app list, QR pairing to a Wi-Fi phone, the remembered
// device file, and a live logcat stream with a grouped stack trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 7498;
const base = `http://127.0.0.1:${PORT}/api/`;
const get = async (p) => (await fetch(base + p)).json();

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(150);
  }
  throw new Error('timed out');
}

test('fake adb: devices, QR pairing, live logcat', { skip: process.platform === 'win32' }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'playlens-state-'));
  const home = mkdtempSync(join(tmpdir(), 'playlens-home-'));
  const proc = spawn(process.execPath, [join(here, '..', 'bin', 'avn-playlens.mjs'), '--no-open', '--port', String(PORT)], {
    env: { ...process.env, PLAYLENS_ADB: join(here, 'fake-adb.cjs'), FAKE_ADB_STATE: state, FAKE_LOG: join(here, '..', 'fixtures', 'demo.logcat'), HOME: home, USERPROFILE: home },
    stdio: 'ignore',
  });
  try {
    const usb = await until(async () => (await get('devices')).find((d) => d.serial === 'FAKE123' && d.info?.model));
    assert.equal(usb.info.model, 'Pixel 7');
    assert.equal(usb.info.battery, 71);
    assert.equal((await get('status')).adbVersion, '35.0.2');
    assert.equal((await get('devices/FAKE123/apps')).foreground, 'com.avn.demo');

    const started = await (await fetch(base + 'pair/qr', { method: 'POST' })).json();
    assert.equal(started.state, 'waiting');
    writeFileSync(join(state, 'qrname'), started.name); // the phone scans the code
    const done = await until(async () => { const p = await get('pair'); return p.state === 'connected' && p; });
    assert.equal(done.address, '192.168.1.50:37115');
    const wifi = await until(async () => (await get('devices')).find((d) => d.transport === 'wifi'));
    assert.equal(wifi.state, 'device');
    const remembered = JSON.parse(readFileSync(join(home, '.avn-playlens', 'devices.json'), 'utf8'));
    assert.equal(remembered[0].id, 'adb-WIFI999');

    const profile = await get('devices/FAKE123/profile?pkg=com.avn.demo');
    assert.equal(profile.device.chipset, 'Google Tensor G2');
    assert.equal(profile.device.refreshHz, 90);
    assert.equal(profile.app.targetSdk, 34);
    assert.equal(profile.app.adId, true);

    const perf = [];
    let snap = null;
    const entries = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      const got = [];
      const timer = setTimeout(() => { ws.close(); resolve(got); }, 12000);
      const done = () => got.some((e) => e.kind === 'exception') && perf.some((x) => x.fps > 0) && perf.some((x) => x.mem);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'stream.start', serial: 'FAKE123', pkg: 'com.avn.demo', streamId: 1 })));
      ws.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.type === 'perf') perf.push(...m.samples);
        else if (m.type === 'monitor') snap = m;
        else if (m.type === 'log.batch') got.push(...m.entries);
        if (done()) { clearTimeout(timer); ws.close(); resolve(got); }
      });
      ws.on('error', reject);
    });
    const s = perf.find((x) => x.fps > 0);
    assert.ok(s.fps > 40 && s.fps <= 60, `fps from SurfaceFlinger frames: ${s.fps}`);
    assert.ok(perf.some((x) => x.cpu > 50 && x.cpu < 200), 'cpu from /proc stat');
    assert.equal(perf.find((x) => x.mem).mem, 402);
    assert.ok(perf.some((x) => x.gpu >= 40));
    assert.equal(snap.app.versionName, '1.2.0');
    const ex = entries.find((e) => e.kind === 'exception');
    assert.ok(ex, 'exception line arrived');
    assert.equal(ex.more.length, 3, 'stack trace grouped into one entry');
    assert.ok(entries.some((e) => e.source === 'firebase' && e.fa?.name === 'level_start'));
  } finally {
    proc.kill();
  }
});
