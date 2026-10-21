// Live device list from `adb track-devices -l`. Restarts the tracker if adb restarts
// (Unity or Android Studio may restart the adb server), and fills in device details
// once per device when it reaches the `device` state.
import { EventEmitter } from 'node:events';
import { TrackFrameParser } from './devices.mjs';
import { readDeviceInfo } from '../device/info.mjs';

export class DeviceTracker extends EventEmitter {
  constructor(adb) {
    super();
    this.adb = adb;
    this.devices = new Map();
    this.info = new Map();
    this.proc = null;
    this.stopped = false;
    this.status = 'starting';
  }

  list() {
    return [...this.devices.values()].map((d) => ({ ...d, info: this.info.get(d.serial) ?? null }));
  }

  start() {
    this.stopped = false;
    const parser = new TrackFrameParser();
    const proc = this.adb.spawn(['track-devices', '-l']);
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      for (const frame of parser.push(chunk)) this.apply(frame);
    });
    proc.on('error', (err) => this.setStatus('error', err.message));
    proc.on('exit', () => {
      this.proc = null;
      if (this.stopped) return;
      this.setStatus('restarting');
      setTimeout(() => this.start(), 2000);
    });
    this.setStatus('running');
  }

  setStatus(status, message) {
    this.status = status;
    this.emit('status', { status, message });
  }

  apply(list) {
    const next = new Map(list.map((d) => [d.serial, d]));
    for (const d of list) {
      if (d.state === 'device' && !this.info.has(d.serial)) {
        this.info.set(d.serial, null);
        readDeviceInfo(this.adb, d.serial)
          .then((info) => { this.info.set(d.serial, info); this.emit('change', this.list()); })
          .catch(() => this.info.delete(d.serial));
      }
    }
    for (const serial of this.info.keys()) if (!next.has(serial)) this.info.delete(serial);
    this.devices = next;
    this.emit('change', this.list());
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }
}
