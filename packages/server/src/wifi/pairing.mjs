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
import { parseDeviceList, parseMdnsServices } from '../adb/devices.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "adb-R5CW31X8KPL-AbCdEf" -> "adb-R5CW31X8KPL": the part that stays the same for one phone.
export function serviceId(name) {
  const bare = name.replace(/\._adb-tls-connect\._tcp\.?$/, '');
  const last = bare.lastIndexOf('-');
  return last > 3 ? bare.slice(0, last) : bare;
}

export function makeQrPayload() {
  const name = 'playlens-' + randomBytes(4).toString('hex');
  const password = randomBytes(8).toString('base64url').slice(0, 10);
  return { name, password, qr: `WIFI:T:ADB;S:${name};P:${password};;` };
}

export class Pairing extends EventEmitter {
  constructor(adb, store, connections = new WifiConnections(adb, store), { retryMs = 2000, connectionTimeoutMs = 180000 } = {}) {
    super();
    this.adb = adb;
    this.store = store;
    this.connections = connections;
    this.job = null;
    this.retryMs = retryMs;
    this.connectionTimeoutMs = connectionTimeoutMs;
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
    await this.pairAndConnect(job, address, code).catch((err) => this.job === job && !job.cancelled && this.update({ state: 'failed', error: err.message }));
    return this.state();
  }

  async pairAndConnect(job, address, secret) {
    this.update({ state: 'pairing' });
    const out = await this.adb.run(['pair', address, secret], { timeout: 20000 }).catch((e) => e.stdout || e.stderr || e.message);
    if (job.cancelled || this.job !== job) return;
    if (!/Successfully paired/i.test(out)) {
      return this.update({ state: 'failed', error: (out || 'Pairing failed').trim() });
    }
    job.ip = address.split(':')[0];
    job.pairedName = /\[guid=([^\]]+)\]/i.exec(out)?.[1];
    // Remember trust immediately, so keep-alive can finish a late connection even
    // after the Connect page is closed. The pairing port is never a connect port.
    if (job.pairedName) this.store.remember({ id: serviceId(job.pairedName), ip: job.ip, name: job.pairedName, autoReconnect: true });
    job.deadline = Date.now() + this.connectionTimeoutMs;
    this.update({ state: 'connecting', paired: true, error: null });
    await this.connectPaired(job);
  }

  current(job) {
    return this.job === job && !job.cancelled;
  }

  matchingDevice(job, devices) {
    return devices.find((d) => d.state === 'device' &&
      ((job.pairedName && /\._adb-tls-connect\._tcp\.?$/.test(d.serial) && serviceId(d.serial) === serviceId(job.pairedName)) || d.serial.startsWith(job.ip + ':')));
  }

  connected(job, device, svc) {
    if (!this.current(job)) return;
    clearTimeout(job.retryTimer);
    const name = svc?.name || job.pairedName || (device.serial.includes('._adb-tls-connect._tcp')
      ? device.serial.replace(/\._adb-tls-connect\._tcp\.?$/, '') : null);
    const address = svc?.address || (device.serial.startsWith(job.ip + ':') ? device.serial : null);
    if (name) this.store.remember({ id: serviceId(name), ip: job.ip, name, ...(address ? { address } : {}), autoReconnect: true });
    this.update({ state: 'connected', address: address || device.serial, error: null });
  }

  // DeviceTracker also completes pairing when ADB connects outside this retry loop.
  observeDevices(devices) {
    const job = this.job;
    if (!job?.public.paired || job.public.state === 'connected' || !this.current(job)) return;
    const device = this.matchingDevice(job, devices);
    if (device) this.connected(job, device);
  }

  async connectPaired(job) {
    if (!this.current(job) || job.public.state === 'connected') return;
    try {
      const result = await this.connections.exclusive(async () => {
        if (!this.current(job)) return null;
        let devices = await this.connections.devices();
        const svc = (await this.mdns()).find((s) => s.kind === 'connect' &&
          ((job.pairedName && serviceId(s.name) === serviceId(job.pairedName)) || s.address.startsWith(job.ip + ':')));
        if (!this.current(job) || job.public.state === 'connected') return null;
        if (svc) {
          await this.connections.connect(svc).catch(() => false);
          devices = await this.connections.devices();
        } else if (!this.matchingDevice(job, devices) && job.pairedName) {
          // ADB may still resolve a known service while its discovery list is late.
          await this.adb.run(['connect', `${job.pairedName}._adb-tls-connect._tcp`], { timeout: 5000 }).catch(() => '');
          devices = await this.connections.devices();
        }
        const device = devices.find((d) => d.state === 'device' && svc && this.connections.matches(d, svc)) || this.matchingDevice(job, devices);
        return device ? { device, svc } : null;
      });
      if (!this.current(job) || job.public.state === 'connected') return;
      if (result) return this.connected(job, result.device, result.svc);
    } catch { /* Retry transient discovery and ADB failures without re-pairing. */ }
    if (!this.current(job) || job.public.state === 'connected') return;
    if (Date.now() >= job.deadline) {
      return this.update({ state: 'connection-failed', error: 'Pairing succeeded, but the connection timed out. Retry connection.' });
    }
    job.retryTimer = setTimeout(() => this.connectPaired(job), this.retryMs);
    job.retryTimer.unref?.();
  }

  async retryConnection() {
    const job = this.job;
    if (!job?.public.paired) throw new Error('Pair a phone first.');
    if (job.public.state === 'connected' || job.public.state === 'connecting') return this.state();
    clearTimeout(job.retryTimer);
    job.deadline = Date.now() + this.connectionTimeoutMs;
    this.update({ state: 'connecting', error: null });
    await this.connectPaired(job);
    return this.state();
  }

  cancel() {
    if (this.job) { this.job.cancelled = true; clearTimeout(this.job.retryTimer); }
    this.job = null;
  }
}

// Reconnects remembered phones when their connect service shows up again.
// Android picks a new port each time wireless debugging is turned on, so we match by service name.
export class KeepAlive {
  constructor(adb, store, tracker, intervalMs = 10000, connections = new WifiConnections(adb, store)) {
    Object.assign(this, { adb, store, tracker, intervalMs, connections });
    this.ticking = false;
    this.timer = null;
  }

  start() {
    this.tick().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.connections.exclusive(async () => {
        const known = this.store.list();
        if (!known.length) return;
        const services = await this.connections.services();
        for (const svc of services) {
          if (svc.kind !== 'connect') continue;
          const saved = this.store.list().find((k) => k.id === serviceId(svc.name));
          if (saved && saved.autoReconnect !== false) {
            if (!await this.connections.connect(svc).catch(() => false)) continue;
            if (saved.address !== svc.address || saved.name !== svc.name || !saved.label) {
              const device = (await this.connections.devices()).find((d) => this.connections.matches(d, svc));
              const label = device?.props?.model?.replace(/_/g, ' ') || saved.label;
              this.store.remember({ ...saved, name: svc.name, address: svc.address, label });
            }
          }
        }
      });
    } finally {
      this.ticking = false;
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

  forget(id) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.list().filter((e) => e.id !== id), null, 2));
  }

  remember(entry) {
    const old = this.list().find((e) => e.id === entry.id);
    const list = this.list().filter((e) => e.id !== entry.id);
    list.push({ ...old, ...entry, savedAt: old?.savedAt ?? new Date().toISOString() });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(list, null, 2));
  }
}

// Share one queue between pairing, reconnection and device controls. Use the same
// mDNS serial as adb's automatic connection, including when it arrives mid-command.
export class WifiConnections {
  constructor(adb, store) {
    Object.assign(this, { adb, store });
    this.queue = Promise.resolve();
  }

  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  async services() {
    return parseMdnsServices(await this.adb.run(['mdns', 'services'], { timeout: 5000 }));
  }

  async devices() {
    return parseDeviceList(await this.adb.run(['devices', '-l'], { timeout: 5000 }));
  }

  serial(svc) {
    return `${svc.name}._adb-tls-connect._tcp`;
  }

  matches(device, svc) {
    return device.serial === svc.address || device.serial === this.serial(svc);
  }

  async connect(svc) {
    const devices = await this.devices();
    const named = devices.find((d) => d.serial === this.serial(svc) && d.state === 'device');
    const addressed = devices.find((d) => d.serial === svc.address);
    if (named) {
      // This removes the actual duplicate from adb, so Unity benefits too.
      if (addressed) await this.adb.run(['disconnect', svc.address], { timeout: 8000 });
      return true;
    }
    if (addressed?.state === 'device') return true;
    let out = await this.adb.run(['connect', this.serial(svc)], { timeout: 10000 }).catch(() => '');
    // A discovered IP may be reachable even when this ADB cannot resolve the service name.
    if (!/^(?:already )?connected to /im.test(out)) {
      out = await this.adb.run(['connect', svc.address], { timeout: 10000 });
    }
    if (!/^(?:already )?connected to /im.test(out)) return false;
    // Catch an automatic connection that appeared while the command was running.
    const after = await this.devices();
    if (after.some((d) => d.serial === this.serial(svc) && d.state === 'device') &&
        after.some((d) => d.serial === svc.address)) {
      await this.adb.run(['disconnect', svc.address], { timeout: 8000 });
    }
    return true;
  }

  manage(id, action) {
    return this.exclusive(async () => {
      if (!['disconnect', 'reconnect', 'forget'].includes(action)) throw new Error('Unknown device action.');
      const saved = this.store.list().find((d) => d.id === id);
      if (!saved) throw new Error('Remembered device not found.');
      const services = await this.services().catch(() => []);
      const svc = services.find((s) => s.kind === 'connect' && serviceId(s.name) === id);
      if (action === 'reconnect') {
        if (!svc) throw new Error('Phone not found. Enable wireless debugging on the same Wi-Fi and try again.');
        if (!await this.connect(svc)) throw new Error('The phone did not accept the connection.');
        this.store.remember({ ...saved, name: svc.name, address: svc.address, autoReconnect: true });
      } else {
        // Persist the pause before disconnecting so the keep-alive cannot undo it.
        this.store.remember({ ...saved, autoReconnect: false });
        const devices = await this.devices();
        for (const d of devices) {
          const named = d.serial.endsWith('._adb-tls-connect._tcp') && serviceId(d.serial) === id;
          const addressed = d.serial === (svc?.address ?? saved.address);
          if (d.transport === 'wifi' && (named || addressed)) {
            await this.adb.run(['disconnect', d.serial], { timeout: 8000 });
          }
        }
        if (action === 'forget') this.store.forget(id);
      }
      return { ok: true };
    });
  }
}
