import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PACKAGE_RE, foregroundPackage } from '../device/info.mjs';
import { snapshotZip } from './zip.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function levelNumber(value) {
  if (!/^(0|[1-9]\d{0,8})$/.test(String(value))) throw fail('Use a whole level number from 0 to 999999999');
  return Number(value);
}

export class SnapshotStore {
  constructor(dir = join(homedir(), '.avn-playlens', 'snapshots')) { this.dir = dir; }
  folder(pkg) {
    if (!PACKAGE_RE.test(pkg || '') || pkg.length > 255) throw fail('Invalid game package');
    return join(this.dir, pkg);
  }
  file(pkg, level) { return join(this.folder(pkg), `${levelNumber(level)}.png`); }
  has(pkg, level) { return existsSync(this.file(pkg, level)); }
  list(pkg) {
    const folder = this.folder(pkg);
    let names;
    try { names = readdirSync(folder); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    return names.filter((name) => /^(0|[1-9]\d{0,8})\.png$/.test(name)).map((name) => {
      const stat = statSync(join(folder, name));
      return { level: Number(name.slice(0, -4)), name, bytes: stat.size, capturedAt: stat.mtimeMs };
    }).sort((a, b) => a.level - b.level);
  }
  read(pkg, level) {
    try { return readFileSync(this.file(pkg, level)); } catch (err) { if (err.code === 'ENOENT') throw fail('Snapshot not found', 404); throw err; }
  }
  save(pkg, level, png) {
    if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(PNG) || png.length < 24) throw fail('The phone did not return a PNG screenshot', 502);
    const file = this.file(pkg, level);
    mkdirSync(this.folder(pkg), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, png); renameSync(temp, file); }
    finally { rmSync(temp, { force: true }); }
    return this.list(pkg).find((s) => s.level === levelNumber(level));
  }
  zip(pkg, levels) {
    const all = this.list(pkg);
    const selected = levels == null ? all : levels.map((level) => {
      const item = all.find((s) => s.level === levelNumber(level));
      if (!item) throw fail(`No snapshot for level ${level}`, 404);
      return item;
    });
    if (!selected.length) throw fail('Capture or select some levels first');
    if (selected.reduce((n, s) => n + s.bytes, 0) > 256 * 1024 * 1024) throw fail('Select fewer levels: ZIP exports are limited to 256 MB', 413);
    return snapshotZip(selected.map((s) => ({ name: s.name, data: this.read(pkg, s.level) })));
  }
}

export class LevelSnapshooter {
  constructor({ adb, store, connected }) {
    Object.assign(this, { adb, store, connected });
    this.settings = new Map();
    this.watchers = new Map();
    this.busy = new Set();
    this.jobs = new Set();
  }
  status(pkg) {
    const s = this.settings.get(pkg);
    return { enabled: !!s?.enabled, serial: s?.serial ?? null, delayMs: s?.delayMs ?? 1000,
      watching: !!s && this.connected(s.serial) && !!this.watchers.get(`${pkg}:${s.serial}`)?.size,
      pendingLevel: s?.pendingLevel ?? null, error: s?.error ?? null, busy: this.busy.has(pkg) };
  }
  configure(pkg, { enabled, serial, delayMs = 1000 }) {
    if (typeof enabled !== 'boolean') throw fail('Choose whether automatic capture is enabled');
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10000) throw fail('Capture delay must be 0–10000 ms');
    if (enabled && (!this.adb || !this.connected(serial) || serial === 'replay')) throw fail('Select a connected phone for screenshots', 409);
    const old = this.settings.get(pkg);
    clearTimeout(old?.timer);
    this.settings.set(pkg, { enabled, serial, delayMs, lastLevel: null, pendingLevel: null, error: null });
    return this.status(pkg);
  }
  watch(pkg, serial, owner) {
    const key = `${pkg}:${serial}`;
    if (!this.watchers.has(key)) this.watchers.set(key, new Set());
    this.watchers.get(key).add(owner);
  }
  unwatch(pkg, serial, owner) {
    const key = `${pkg}:${serial}`;
    const watchers = this.watchers.get(key);
    watchers?.delete(owner);
    if (watchers?.size) return;
    this.watchers.delete(key);
    const s = this.settings.get(pkg);
    if (s?.serial === serial) { clearTimeout(s.timer); s.pendingLevel = null; s.lastLevel = null; s.generation = Symbol(); }
  }
  observe(pkg, serial, level) {
    const s = this.settings.get(pkg);
    if (!s?.enabled || s.serial !== serial || !this.status(pkg).watching) return;
    try { level = levelNumber(level); } catch { return; }
    if (s.lastLevel === level) return;
    s.lastLevel = level;
    clearTimeout(s.timer);
    const generation = s.generation = Symbol();
    s.pendingLevel = null;
    if (this.store.has(pkg, level)) return;
    s.pendingLevel = level;
    const valid = () => this.settings.get(pkg) === s && s.generation === generation && this.status(pkg).watching;
    const take = () => {
      if (!valid()) { if (s.generation === generation) s.pendingLevel = null; return; }
      // A superseded capture may still be receiving bytes from adb. Wait for it
      // instead of losing the next level or saving the previous screen under its name.
      if (this.busy.has(pkg)) { s.timer = setTimeout(take, 100); return; }
      const job = this.capture(pkg, serial, level, valid, false).then(() => { if (valid()) s.error = null; })
        .catch((err) => { if (valid()) s.error = `Level ${level}: ${err.message}`; })
        .finally(() => { this.jobs.delete(job); if (valid()) s.pendingLevel = null; });
      this.jobs.add(job);
    };
    s.timer = setTimeout(take, s.delayMs);
  }
  async capture(pkg, serial, level, valid = () => true, replace = true) {
    level = levelNumber(level);
    if (!this.adb || !this.connected(serial) || serial === 'replay') throw fail('Select a connected phone for screenshots', 409);
    if (this.busy.has(pkg)) throw fail('A screenshot is already being captured. Try again.', 409);
    this.busy.add(pkg);
    try {
      if (!valid()) return null;
      if (await foregroundPackage(this.adb, serial) !== pkg) throw fail('Bring this game to the front on the phone, then capture again', 409);
      // exec-out sends PNG bytes straight to the computer; no file is created on Android.
      const png = await this.adb.run(['exec-out', 'screencap', '-p'], { serial, encoding: 'buffer', timeout: 15000 });
      if (!valid()) return null;
      if (!this.connected(serial) || await foregroundPackage(this.adb, serial) !== pkg) throw fail('The game left the foreground during capture. Try again.', 409);
      if (!valid() || (!replace && this.store.has(pkg, level))) return null;
      const snapshot = this.store.save(pkg, level, png);
      const settings = this.settings.get(pkg);
      if (settings) settings.error = null;
      return snapshot;
    } finally { this.busy.delete(pkg); }
  }
  async close() {
    for (const s of this.settings.values()) { clearTimeout(s.timer); s.enabled = false; s.generation = Symbol(); }
    this.watchers.clear();
    await Promise.allSettled([...this.jobs]);
  }
}
