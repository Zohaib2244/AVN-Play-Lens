// Wireless debugging (Android 11+).
// QR pairing works like Android Studio: we show WIFI:T:ADB;S:<name>;P:<password>;;
// the phone advertises a _adb-tls-pairing._tcp service with that name once it has
// scanned it, and we run `adb pair <address> <password>`. After pairing, the phone's
// _adb-tls-connect._tcp service is used to connect.
// Remembered phones are reconnected by the keep-alive loop when they reappear.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { parseMdnsServices } from '../adb/devices.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "adb-R5CW31X8KPL-AbCdEf" -> "adb-R5CW31X8KPL": the part that stays the same for one phone.
export function serviceId(name) {
  return name.split('-').slice(0, 2).join('-');
}

export function makeQrPayload() {
  const name = 'playlens-' + randomBytes(4).toString('hex');
  const password = randomBytes(8).toString('base64url').slice(0, 10);
  return { name, password, qr: `WIFI:T:ADB;S:${name};P:${password};;` };
}

export class Pairing extends EventEmitter {
  constructor(adb, store) {
    super();
    this.adb = adb;
    this.store = store;
    this.job = null;
  }

  state() {
    return this.job ? { ...this.job.public } : { state: 'idle' };
  }

  update(patch) {
    if (!this.job) return;
    Object.assign(this.job.public, patch);
    this.emit('update', this.state());
  }

  async mdns() {
    try {
      return parseMdnsServices(await this.adb.run(['mdns', 'services'], { timeout: 5000 }));
    } catch {
      return [];
    }
  }

  startQr() {
    this.cancel();
    const p = makeQrPayload();
    const job = { cancelled: false, public: { state: 'waiting', qr: p.qr, name: p.name, startedAt: Date.now() } };
    this.job = job;
    this.emit('update', this.state());
    this.runQr(job, p).catch((err) => this.job === job && this.update({ state: 'failed', error: err.message }));
    return this.state();
  }

  async runQr(job, p) {
    const deadline = Date.now() + 3 * 60 * 1000;
    let target = null;
    while (!job.cancelled && Date.now() < deadline && !target) {
      target = (await this.mdns()).find((s) => s.kind === 'pairing' && s.name === p.name) ?? null;
      if (!target) await sleep(1000);
    }
    if (job.cancelled) return;
    if (!target) return this.update({ state: 'failed', error: 'The phone never showed up. Check it is on the same Wi-Fi, or use a pairing code.' });
    this.update({ state: 'found', address: target.address });
    await this.pairAndConnect(job, target.address, p.password);
  }

  async pairWithCode(address, code) {
    this.cancel();
    const job = { cancelled: false, public: { state: 'pairing', address, startedAt: Date.now() } };
    this.job = job;
    this.emit('update', this.state());
    await this.pairAndConnect(job, address, code).catch((err) => this.update({ state: 'failed', error: err.message }));
    return this.state();
  }

  async pairAndConnect(job, address, secret) {
    this.update({ state: 'pairing' });
    const out = await this.adb.run(['pair', address, secret], { timeout: 20000 }).catch((e) => e.stdout || e.message);
    if (!/Successfully paired/i.test(out)) {
      return this.update({ state: 'failed', error: (out || 'Pairing failed').trim() });
    }
    const ip = address.split(':')[0];
    // The connect service usually appears a moment after pairing; adb may also connect on its own.
    for (let i = 0; i < 15 && !job.cancelled; i++) {
      const svc = (await this.mdns()).find((s) => s.kind === 'connect' && s.address.startsWith(ip + ':'));
      if (svc) {
        const res = await this.adb.run(['connect', svc.address], { timeout: 10000 }).catch((e) => e.stdout || e.message);
        if (/connected to|already connected/i.test(res)) {
          this.store.remember({ id: serviceId(svc.name), ip });
          return this.update({ state: 'connected', address: svc.address });
        }
      }
      await sleep(1000);
    }
    this.update({ state: 'failed', error: 'Paired, but the phone did not accept the connection. Toggle wireless debugging and try again.' });
  }

  cancel() {
    if (this.job) this.job.cancelled = true;
    this.job = null;
  }
}

// Reconnects remembered phones when their connect service shows up again.
// Android picks a new port each time wireless debugging is turned on, so we match by service name.
export class KeepAlive {
  constructor(adb, store, tracker, intervalMs = 10000) {
    Object.assign(this, { adb, store, tracker, intervalMs });
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
  }

  async tick() {
    const known = this.store.list();
    if (!known.length) return;
    const services = parseMdnsServices(await this.adb.run(['mdns', 'services'], { timeout: 5000 }).catch(() => ''));
    const online = new Set(this.tracker.list().filter((d) => d.state === 'device').map((d) => d.serial));
    for (const svc of services) {
      if (svc.kind !== 'connect') continue;
      const id = serviceId(svc.name);
      const remembered = known.some((k) => k.id === id);
      const connected = [...online].some((s) => s === svc.address || s.startsWith(id));
      if (remembered && !connected) await this.adb.run(['connect', svc.address], { timeout: 8000 }).catch(() => {});
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

export class DeviceStore {
  constructor(file = join(os.homedir(), '.avn-playlens', 'devices.json')) {
    this.file = file;
  }

  list() {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return [];
    }
  }

  remember(entry) {
    const list = this.list().filter((e) => e.id !== entry.id);
    list.push({ ...entry, savedAt: new Date().toISOString() });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(list, null, 2));
  }
}
