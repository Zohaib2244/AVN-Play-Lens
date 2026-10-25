import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore, WifiConnections, Pairing, KeepAlive, serviceId } from '../src/wifi/pairing.mjs';
import { createServer } from '../src/api/server.mjs';

const svc = { name: 'adb-PHONE123-AbCd', kind: 'connect', address: '192.168.1.50:37115' };
const serial = `${svc.name}._adb-tls-connect._tcp`;
function setup(t, devices = [serial]) {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-wifi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new DeviceStore(join(dir, 'devices.json'));
  store.remember({ id: serviceId(svc.name), ip: '192.168.1.50' });
  const calls = [];
  const online = new Set(devices);
  const adb = { async run(args) {
    calls.push(args);
    if (args[0] === 'devices') return 'List of devices attached\n' + [...online].map((s) => `${s}\tdevice model:Phone\n`).join('');
    if (args[0] === 'mdns') return `${svc.name}\t_adb-tls-connect._tcp\t${svc.address}\n`;
    if (args[0] === 'pair') { online.add(serial); return 'Successfully paired'; }
    if (args[0] === 'connect') { online.add(args[1]); return `connected to ${args[1]}`; }
    if (args[0] === 'disconnect') { online.delete(args[1]); return `disconnected ${args[1]}`; }
    throw new Error(`Unexpected adb call: ${args}`);
  } };
  const connections = new WifiConnections(adb, store);
  return { store, adb, connections, calls, online };
}

test('pairing reuses the automatic mDNS connection after one scan', async (t) => {
  const { adb, store, connections, calls } = setup(t, []);
  const pair = new Pairing(adb, store, connections);
  const result = await pair.pairWithCode('192.168.1.50:40123', '123456');
  assert.equal(result.state, 'connected');
  assert.equal(calls.filter((a) => a[0] === 'pair').length, 1);
  assert.equal(calls.filter((a) => a[0] === 'connect').length, 0);
  assert.equal(store.list()[0].address, svc.address);
});

test('fallback connects using the same mDNS serial as automatic ADB', async (t) => {
  const { connections, calls, online } = setup(t, []);
  assert.equal(await connections.connect(svc), true);
  assert.deepEqual(calls.find((a) => a[0] === 'connect'), ['connect', serial]);
  assert.deepEqual([...online], [serial]);
});

test('an existing IP connection is reused', async (t) => {
  const { connections, calls } = setup(t, [svc.address]);
  assert.equal(await connections.connect(svc), true);
  assert.ok(!calls.some((a) => a[0] === 'connect' || a[0] === 'disconnect'));
});

test('pairing recognizes an automatic ADB connection without mDNS discovery', async (t) => {
  const { adb, store, connections, calls } = setup(t, []);
  const run = adb.run.bind(adb);
  adb.run = async (args) => {
    if (args[0] === 'mdns') throw new Error('mDNS unavailable');
    const out = await run(args);
    return args[0] === 'pair' ? `${out} to 192.168.1.50:40123 [guid=${svc.name}]` : out;
  };
  const pair = new Pairing(adb, store, connections);
  assert.equal((await pair.pairWithCode('192.168.1.50:40123', '123456')).state, 'connected');
  assert.equal(store.list()[0].id, serviceId(svc.name));
  assert.ok(!calls.some((args) => args[0] === 'connect'));
});

test('an unresolvable mDNS name falls back to the advertised IP connection', async (t) => {
  const { adb, connections, online, calls } = setup(t, []);
  const run = adb.run.bind(adb);
  adb.run = (args) => {
    if (args[0] === 'connect' && args[1] === serial) {
      calls.push(args);
      return Promise.reject(new Error('Cannot resolve service'));
    }
    return run(args);
  };
  assert.equal(await connections.connect(svc), true);
  assert.deepEqual([...online], [svc.address]);
  assert.deepEqual(calls.filter((args) => args[0] === 'connect'), [['connect', serial], ['connect', svc.address]]);
});

test('keep-alive removes an existing duplicate from ADB without touching another phone', async (t) => {
  const { adb, store, connections, online } = setup(t, [svc.address, serial, 'OTHER_USB']);
  const keepAlive = new KeepAlive(adb, store, null, 10000, connections);
  await keepAlive.tick();
  assert.deepEqual([...online], [serial, 'OTHER_USB']);
});

test('disconnect persists a pause, survives restart, and reconnect resumes it', async (t) => {
  const { adb, store, connections, online } = setup(t, [svc.address, serial, 'OTHER_USB']);
  await connections.manage(serviceId(svc.name), 'disconnect');
  assert.deepEqual([...online], ['OTHER_USB']);
  const restarted = new DeviceStore(store.file);
  const keepAlive = new KeepAlive(adb, restarted, null, 10000, connections);
  await keepAlive.tick();
  assert.deepEqual([...online], ['OTHER_USB']);
  await connections.manage(serviceId(svc.name), 'reconnect');
  assert.ok(online.has(serial));
  assert.equal(store.list()[0].autoReconnect, true);
});

test('forget disconnects all aliases and removes only the selected remembered device', async (t) => {
  const { store, connections, online } = setup(t, [svc.address, serial, 'OTHER_USB']);
  store.remember({ id: 'adb-OTHER', ip: '192.168.1.51' });
  await connections.manage(serviceId(svc.name), 'forget');
  assert.deepEqual([...online], ['OTHER_USB']);
  assert.deepEqual(store.list().map((s) => s.id), ['adb-OTHER']);
});

test('device management is serialized with an in-flight keep-alive', async (t) => {
  const { adb, store, connections, online } = setup(t, []);
  const keepAlive = new KeepAlive(adb, store, null, 10000, connections);
  await Promise.all([keepAlive.tick(), connections.manage(serviceId(svc.name), 'disconnect')]);
  assert.equal(store.list()[0].autoReconnect, false);
  assert.equal(online.size, 0);
});

test('stable service identity supports hyphenated physical serials', () => {
  assert.equal(serviceId('adb-PHONE-123-AbCd._adb-tls-connect._tcp'), 'adb-PHONE-123');
});

test('saved device API lists, disconnects, reconnects and forgets; rejects unknown devices', async (t) => {
  const { adb, store, connections, online } = setup(t);
  const server = createServer({ port: 7497, staticDir: null, adb, store, connections,
    devices: () => [], onDevices: () => {}, status: () => ({}) });
  await server.listen();
  t.after(() => server.close());
  const base = 'http://127.0.0.1:7497/api/devices/saved';
  const id = serviceId(svc.name);
  assert.equal((await (await fetch(base)).json())[0].id, id);
  const preference = await fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoReconnect: false }) });
  assert.equal(preference.status, 200);
  assert.equal(store.list()[0].autoReconnect, false);
  assert.equal(online.has(serial), true, 'turning off auto-reconnect does not disconnect the active phone');
  assert.equal((await fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoReconnect: 'yes' }) })).status, 400);
  assert.equal((await fetch(`${base}/${id}`, { method: 'PATCH', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ autoReconnect: true }) })).status, 403);
  for (const action of ['disconnect', 'reconnect', 'forget']) {
    const res = await fetch(`${base}/${id}/${action}`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.equal(online.has(serial), action === 'reconnect');
  }
  assert.deepEqual(store.list(), []);
  assert.equal((await fetch(`${base}/${id}/forget`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/UNKNOWN/forget`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/UNKNOWN/forget`, { method: 'POST', headers: { origin: 'http://evil.example' } })).status, 403);
});

test('manual address connection works without discovery and returns the ADB failure reason', async (t) => {
  const { adb, store, connections, online } = setup(t, []);
  connections.services = async () => { throw new Error('mDNS unavailable'); };
  const server = createServer({ port: 7496, staticDir: null, adb, store, connections,
    devices: () => [], onDevices: () => {}, status: () => ({}) });
  await server.listen();
  t.after(() => server.close());
  const connect = () => fetch('http://127.0.0.1:7496/api/connect', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: svc.address }),
  });
  assert.equal((await connect()).status, 200);
  assert.ok(online.has(svc.address));
  const run = adb.run.bind(adb);
  adb.run = (args) => args[0] === 'connect' ? Promise.resolve('failed to connect: connection refused') : run(args);
  const failed = await connect();
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /connection refused/);
});

async function waitForPair(pair, state) {
  const deadline = Date.now() + 1500;
  while (pair.state().state !== state && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(pair.state().state, state);
}

test('pairing waits for a verified connection, times out clearly, and retries without pairing again', async (t) => {
  const { adb, store, connections, online } = setup(t, []);
  const run = adb.run.bind(adb);
  let pairCalls = 0;
  adb.run = (args) => {
    if (args[0] === 'pair') { pairCalls++; return Promise.resolve(`Successfully paired [guid=${svc.name}]`); }
    if (args[0] === 'mdns') return Promise.resolve('');
    // A command response alone must never produce the Connected badge.
    if (args[0] === 'connect') return Promise.resolve(`connected to ${serial}`);
    return run(args);
  };
  const pair = new Pairing(adb, store, connections, { retryMs: 5, connectionTimeoutMs: 35 });
  t.after(() => pair.cancel());
  const result = await pair.pairWithCode('192.168.1.50:40123', '123456');
  assert.equal(result.state, 'connecting');
  assert.equal(store.list()[0].autoReconnect, true);
  await waitForPair(pair, 'connection-failed');
  assert.doesNotMatch(pair.state().error, /IP|port|pair again/);
  online.add(serial);
  assert.equal((await pair.retryConnection()).state, 'connected');
  assert.equal(pairCalls, 1);
});

test('a late connect service is retried automatically after successful pairing', async (t) => {
  const { adb, store, connections } = setup(t, []);
  const run = adb.run.bind(adb);
  let advertised = false;
  let pairCalls = 0;
  adb.run = (args) => {
    if (args[0] === 'pair') { pairCalls++; return Promise.resolve(`Successfully paired [guid=${svc.name}]`); }
    if (!advertised && args[0] === 'mdns') return Promise.resolve('');
    if (!advertised && args[0] === 'connect') return Promise.resolve('cannot resolve service');
    return run(args);
  };
  const pair = new Pairing(adb, store, connections, { retryMs: 5 });
  t.after(() => pair.cancel());
  assert.equal((await pair.pairWithCode('192.168.1.50:40123', '123456')).state, 'connecting');
  advertised = true;
  await waitForPair(pair, 'connected');
  assert.equal(pair.state().address, svc.address);
  assert.equal(pairCalls, 1);
});

test('tracker completes only the paired phone, and cancelling clears connection retries', async (t) => {
  const { adb, store, connections, calls } = setup(t, []);
  const run = adb.run.bind(adb);
  adb.run = (args) => {
    if (args[0] === 'pair') return Promise.resolve(`Successfully paired [guid=${svc.name}]`);
    if (args[0] === 'mdns') return Promise.resolve('');
    if (args[0] === 'connect') return Promise.resolve('cannot resolve service');
    return run(args);
  };
  const pair = new Pairing(adb, store, connections, { retryMs: 20 });
  t.after(() => pair.cancel());
  await pair.pairWithCode('192.168.1.50:40123', '123456');
  pair.observeDevices([{ serial: 'OTHER_USB', state: 'device' }]);
  assert.equal(pair.state().state, 'connecting');
  pair.observeDevices([{ serial: 'adb-PHONE123-NewSession._adb-tls-connect._tcp', state: 'device' }]);
  assert.equal(pair.state().state, 'connected');
  await pair.pairWithCode('192.168.1.50:40123', '123456');
  pair.cancel();
  const count = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.length, count);
  assert.equal(pair.state().state, 'idle');
});

test('cleans an IP alias that appears during a fallback connection', async (t) => {
  const { adb, connections, online } = setup(t, []);
  const run = adb.run.bind(adb);
  adb.run = async (args) => {
    const out = await run(args);
    if (args[0] === 'connect') online.add(svc.address);
    return out;
  };
  await connections.connect(svc);
  assert.deepEqual([...online], [serial]);
});

test('a late cancelled pairing does not overwrite a newer pairing job', async (t) => {
  const { adb, store, connections } = setup(t, []);
  let finishPair;
  const run = adb.run.bind(adb);
  adb.run = (args) => args[0] === 'pair' ? new Promise((r) => { finishPair = r; }) : run(args);
  const pairing = new Pairing(adb, store, connections);
  const first = pairing.pairWithCode('192.168.1.50:40123', '123456');
  pairing.cancel();
  const newer = { cancelled: false, public: { state: 'waiting', name: 'new-qr' } };
  pairing.job = newer;
  finishPair('Pairing failed');
  await first;
  assert.deepEqual(pairing.state(), newer.public);
});

test('failed reconnect leaves auto-reconnect paused and reports the failure', async (t) => {
  const { store, adb, connections } = setup(t, []);
  store.remember({ id: serviceId(svc.name), autoReconnect: false });
  const run = adb.run.bind(adb);
  adb.run = (args) => args[0] === 'connect' ? Promise.resolve('failed to connect') : run(args);
  await assert.rejects(connections.manage(serviceId(svc.name), 'reconnect'), /did not accept/);
  assert.equal(store.list()[0].autoReconnect, false);
});
