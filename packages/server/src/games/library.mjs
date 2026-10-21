import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { PACKAGE_RE, listPackages, foregroundPackage, parsePids } from '../device/info.mjs';
import { parseAppProfile } from '../device/profile.mjs';

export class GameLibrary {
  constructor(file = join(os.homedir(), '.avn-playlens', 'games.json')) { this.file = file; }
  list() {
    try { return JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }
  write(games) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(games, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }
  save(input, id = null) {
    const games = this.list();
    if (id && !games.some((g) => g.id === id)) throw new Error('Game not found');
    const packageId = typeof input.packageId === 'string' ? input.packageId.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!PACKAGE_RE.test(packageId) || packageId.length > 255) throw new Error('Use an Android package ID such as com.studio.game');
    if (!name || name.length > 100) throw new Error('Enter a game name (up to 100 characters)');
    if (games.some((g) => g.packageId === packageId && g.id !== id)) throw new Error('That package ID is already in your library');
    const old = games.find((g) => g.id === id);
    const icon = input.icon === undefined ? old?.icon ?? null : input.icon;
    if (icon !== null && (typeof icon !== 'string' || icon.length > 350000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon))) throw new Error('Choose a PNG, JPEG or WebP icon smaller than 250 KB');
    const game = { icon, id: old?.id ?? randomUUID(), name, packageId, createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() };
    this.write(old ? games.map((g) => g.id === id ? game : g) : [...games, game]);
    return game;
  }
  remove(id) {
    const games = this.list();
    if (!games.some((g) => g.id === id)) return false;
    this.write(games.filter((g) => g.id !== id));
    return true;
  }
}

export class GameInventory {
  constructor(adb) { this.adb = adb; this.versions = new Map(); }
  async list(serial, games, { refresh = false } = {}) {
    const [packages, foreground, processes] = await Promise.all([
      listPackages(this.adb, serial), foregroundPackage(this.adb, serial).catch(() => null),
      this.adb.shell(serial, 'ps -A -o PID,NAME', { timeout: 8000 }).catch(() => null),
    ]);
    const installed = new Set(packages);
    const result = [];
    // Bound profile reads to four at a time, regardless of library size.
    for (let i = 0; i < games.length; i += 4) {
      result.push(...await Promise.all(games.slice(i, i + 4).map(async (g) => {
        const base = { ...g, installed: installed.has(g.packageId), foreground: foreground === g.packageId,
          running: processes == null ? null : parsePids(processes, g.packageId).length > 0 };
        if (!base.installed) { this.versions.delete(`${serial}:${g.packageId}`); return { ...base, running: false, versionName: null, versionCode: null }; }
        const key = `${serial}:${g.packageId}`;
        const cached = this.versions.get(key);
        try {
          let version = cached?.version;
          if (refresh || !cached || Date.now() - cached.at > 15000) {
            const profile = parseAppProfile(await this.adb.shell(serial, `dumpsys package ${g.packageId}`, { timeout: 10000 }));
            version = { versionName: profile.versionName, versionCode: profile.versionCode };
            this.versions.set(key, { at: Date.now(), version });
          }
          return { ...base, ...version };
        } catch (err) { return { ...base, versionName: null, versionCode: null, error: `Could not read installed version: ${err.message}` }; }
      })));
    }
    return result;
  }
}
