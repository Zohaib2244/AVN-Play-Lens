// Where each game's builds come from. Two kinds of source:
//   file:   one APK/AAB, given as a path or uploaded from the page (copied under artifacts/)
//   folder: a folder PlayLens watches for a file name (with * wildcards), e.g. MyGame*.apk;
//           the newest match wins, once the build has finished writing it.
// Saved in ~/.avn-playlens/builds.json, next to games.json.
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync, watch, createWriteStream, rmSync } from 'node:fs';
import { readdir, stat, rm, rename, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { ArtifactError, ARTIFACT_EXT, fileError, inspectArtifact } from './artifact.mjs';

const POLL_MS = 4000;
const SETTLE_MS = 2000;            // a build's file must stay unchanged this long before it is read
const MAX_UPLOAD = 4 * 1024 ** 3;

export function expandPath(p) {
  const s = String(p ?? '').trim().replace(/^["']|["']$/g, '');
  if (s === '~' || s.startsWith('~/')) return join(os.homedir(), s.slice(1));
  return s;
}

export function patternRegex(pattern) {
  const body = pattern.split('*').map((part) => part.split('?').map((x) => x.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.')).join('.*');
  return new RegExp(`^${body}$`, 'i');
}

function validatePattern(raw) {
  const pattern = String(raw ?? '').trim();
  if (!pattern) throw new ArtifactError('bad-pattern', 'Enter the file name to look for, for example MyGame.apk or MyGame*.aab');
  if (pattern.length > 200) throw new ArtifactError('bad-pattern', 'The file name is too long');
  if (/[\\/]/.test(pattern)) throw new ArtifactError('bad-pattern', 'Enter only the file name, not a path', 'Put the folder in the folder field and the file name here.');
  if (!/\.(apk|aab)$/i.test(pattern) && !pattern.endsWith('*')) {
    throw new ArtifactError('bad-pattern', 'The file name must end in .apk or .aab', 'Use * for the parts that change, for example MyGame-*.apk, or MyGame.* for either kind.');
  }
  return pattern;
}

function folderError(err, dir) {
  if (err.code === 'ENOENT') return new ArtifactError('folder-missing', `Folder not found: ${dir}`, 'Check the path. If the build creates it, build once first.');
  if (err.code === 'ENOTDIR') return new ArtifactError('not-folder', `${dir} is a file, not a folder`, 'Choose the folder that contains the build, or use the "A file" option for this exact file.');
  return fileError(err, dir);
}

const publicError = (err) => ({ code: err.code ?? 'error', message: err.message, hint: err.hint ?? null });

export class BuildSources extends EventEmitter {
  constructor({ dir = join(os.homedir(), '.avn-playlens'), games, pollMs = POLL_MS, settleMs = SETTLE_MS } = {}) {
    super();
    this.file = join(dir, 'builds.json');
    this.artifactsDir = join(dir, 'artifacts');
    this.games = games;
    this.pollMs = pollMs;
    this.settleMs = settleMs;
    this.state = this.load();
    this.watchers = new Map();
    this.scans = new Map();
  }

  load() {
    try { return JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
  }

  persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    const saved = Object.fromEntries(Object.entries(this.state).map(([id, s]) => [id, { source: s.source, latest: s.latest ?? null, installs: s.installs ?? {} }]));
    writeFileSync(this.file + '.tmp', JSON.stringify(saved, null, 2));
    renameSync(this.file + '.tmp', this.file);
  }

  game(gameId) {
    const game = this.games.list().find((g) => g.id === gameId);
    if (!game) throw Object.assign(new Error('Game not found'), { statusCode: 404 });
    return game;
  }

  start() {
    for (const [gameId, s] of Object.entries(this.state)) {
      if (!this.games.list().some((g) => g.id === gameId)) continue;
      if (s.source?.type === 'folder') this.watchFolder(gameId);
      else if (s.source?.type === 'file') this.refreshFile(gameId).catch(() => {});
    }
  }

  get(gameId) {
    const s = this.state[gameId];
    if (!s?.source) return { source: null, latest: null, status: null, installs: {} };
    return { source: s.source, latest: s.latest ?? null, status: s.status ?? null, installs: s.installs ?? {} };
  }

  changed(gameId) {
    this.emit('change', gameId, this.get(gameId));
  }

  setStatus(gameId, status) {
    const s = this.state[gameId];
    if (!s) return;
    const next = { ...status, at: Date.now() };
    const same = s.status && s.status.state === next.state && s.status.message === next.message;
    s.status = next;
    if (!same) this.changed(gameId);
  }

  // The identity check every source shares: the build must be this game.
  checkGame(game, artifact) {
    if (artifact.packageId !== game.packageId) {
      throw new ArtifactError('wrong-game', `${artifact.name} is ${artifact.packageId}, but ${game.name} is ${game.packageId}`,
        'Pick the build of this game, or fix the package ID in Unity Player Settings.');
    }
  }

  async setSource(gameId, input = {}) {
    const game = this.game(gameId);
    const autoInstall = input.autoInstall === true;
    let source;
    let latest = null;
    if (input.type === 'file') {
      const path = expandPath(input.path);
      if (!path) throw new ArtifactError('bad-path', 'Enter the path to the APK or AAB file');
      if (!isAbsolute(path)) throw new ArtifactError('bad-path', 'Use the full path to the file, starting with / or ~');
      latest = await inspectArtifact(path);
      this.checkGame(game, latest);
      source = { type: 'file', path, uploaded: input.uploaded === true, autoInstall };
    } else if (input.type === 'folder') {
      const dir = expandPath(input.dir);
      if (!dir) throw new ArtifactError('bad-path', 'Enter the folder the build is written to');
      if (!isAbsolute(dir)) throw new ArtifactError('bad-path', 'Use the full path to the folder, starting with / or ~');
      const pattern = validatePattern(input.pattern);
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) throw Object.assign(new Error('not a folder'), { code: 'ENOTDIR' });
        await readdir(dir);
      } catch (err) { throw folderError(err, dir); }
      source = { type: 'folder', dir: resolve(dir), pattern, autoInstall };
    } else {
      throw new ArtifactError('bad-source', 'Choose a file or a folder as the build source');
    }
    const old = this.state[gameId];
    this.stopWatch(gameId);
    if (old?.source?.uploaded && old.source.path !== source.path) await rm(old.source.path, { force: true }).catch(() => {});
    this.state[gameId] = { source, latest, status: latest ? { state: 'ready', message: `${latest.name} is ready to install`, at: Date.now() } : null, installs: old?.installs ?? {} };
    this.persist();
    if (source.type === 'folder') this.watchFolder(gameId);
    this.changed(gameId);
    if (latest) this.emit('artifact', gameId, latest);
    return this.get(gameId);
  }

  async clearSource(gameId) {
    const s = this.state[gameId];
    this.stopWatch(gameId);
    if (!s) return false;
    if (s.source?.uploaded) await rm(dirname(s.source.path), { recursive: true, force: true }).catch(() => {});
    delete this.state[gameId];
    this.persist();
    this.changed(gameId);
    return true;
  }

  // Streams an upload to disk, keeps it only if it is a build of this game.
  async saveUpload(gameId, req, rawName) {
    const game = this.game(gameId);
    const name = basename(String(rawName ?? '')).replace(/[^\w.\- ]+/g, '_');
    if (!ARTIFACT_EXT.test(name)) throw new ArtifactError('bad-file', 'Choose an .apk or .aab file');
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_UPLOAD) throw Object.assign(new ArtifactError('too-large', 'The file is larger than 4 GB'), { statusCode: 413 });
    if (length === 0) throw new ArtifactError('empty', `${name} is empty`);
    const folder = join(this.artifactsDir, gameId);
    await mkdir(folder, { recursive: true });
    const temp = join(folder, `.upload-${randomUUID()}`);
    let bytes = 0;
    req.on('data', (c) => { bytes += c.length; if (bytes > MAX_UPLOAD) req.destroy(new ArtifactError('too-large', 'The file is larger than 4 GB')); });
    try {
      await pipeline(req, createWriteStream(temp));
    } catch (err) {
      rmSync(temp, { force: true });
      if (err instanceof ArtifactError) throw err;
      throw new ArtifactError('upload-failed', 'The upload did not finish', err.code === 'ENOSPC' ? 'This computer is out of disk space.' : 'Try again.');
    }
    let artifact;
    try {
      artifact = await inspectArtifact(temp);
      this.checkGame(game, { ...artifact, name });
    } catch (err) {
      await rm(temp, { force: true });
      throw err instanceof ArtifactError ? Object.assign(err, { message: err.message.replace(basename(temp), name) }) : err;
    }
    const target = join(folder, name);
    await rename(temp, target);
    // Only the latest upload is kept; builds are large.
    for (const f of await readdir(folder)) if (f !== name) await rm(join(folder, f), { force: true }).catch(() => {});
    return this.setSource(gameId, { type: 'file', path: target, uploaded: true, autoInstall: this.state[gameId]?.source?.autoInstall === true });
  }

  setAutoInstall(gameId, on) {
    const s = this.state[gameId];
    if (!s?.source) throw Object.assign(new Error('Set up a build source first'), { statusCode: 409 });
    s.source = { ...s.source, autoInstall: on === true };
    this.persist();
    this.changed(gameId);
    if (on && s.latest) this.emit('artifact', gameId, s.latest);
    return this.get(gameId);
  }

  recordInstall(gameId, serial, fingerprint, ok) {
    const s = this.state[gameId];
    if (!s) return;
    s.installs = { ...(s.installs ?? {}), [serial]: { fingerprint, ok, at: Date.now() } };
    this.persist();
  }

  // The build to install right now, read fresh from disk so a deleted or replaced file is caught.
  async latestArtifact(gameId) {
    const game = this.game(gameId);
    const s = this.state[gameId];
    if (!s?.source) throw Object.assign(new ArtifactError('no-source', `No build source for ${game.name}`, 'Choose an APK/AAB file or a build folder first.'), { statusCode: 409 });
    if (s.source.type === 'file') return this.refreshFile(gameId);
    await this.scan(gameId, { force: true });
    const st = s.status;
    if (st?.state === 'settling') throw new ArtifactError('settling', st.message, 'Install again in a few seconds.');
    // The newest matching file decides: an older good build is not installed in its place.
    if (st?.state === 'error' || !s.latest) {
      throw new ArtifactError(st?.code ?? 'no-build', st?.state === 'waiting' ? `No file named ${s.source.pattern} in the folder yet` : st?.message ?? `No build matching ${s.source.pattern} yet`, st?.hint ?? null);
    }
    const artifact = await inspectArtifact(s.latest.path);
    this.checkGame(game, artifact);
    return artifact;
  }

  async refreshFile(gameId) {
    const game = this.game(gameId);
    const s = this.state[gameId];
    try {
      const artifact = await inspectArtifact(s.source.path);
      this.checkGame(game, artifact);
      const isNew = artifact.fingerprint !== s.latest?.fingerprint;
      s.latest = artifact;
      if (isNew) this.persist();
      this.setStatus(gameId, { state: 'ready', message: `${artifact.name} is ready to install` });
      return artifact;
    } catch (err) {
      this.setStatus(gameId, { state: 'error', ...publicError(err) });
      throw err;
    }
  }

  watchFolder(gameId) {
    const { dir } = this.state[gameId].source;
    const entry = { fsWatcher: null, timer: null, settleTimer: null, candidate: null };
    this.watchers.set(gameId, entry);
    const kick = () => {
      clearTimeout(entry.debounce);
      entry.debounce = setTimeout(() => this.scan(gameId).catch(() => {}), 500);
    };
    try {
      entry.fsWatcher = watch(dir, { persistent: false }, kick);
      entry.fsWatcher.on('error', () => { entry.fsWatcher?.close(); entry.fsWatcher = null; });
    } catch { /* network drives and missing folders: polling below still works */ }
    entry.timer = setInterval(() => this.scan(gameId).catch(() => {}), this.pollMs);
    entry.timer.unref?.();
    this.scan(gameId).catch(() => {});
  }

  stopWatch(gameId) {
    const w = this.watchers.get(gameId);
    if (!w) return;
    w.fsWatcher?.close();
    clearInterval(w.timer);
    clearTimeout(w.settleTimer);
    clearTimeout(w.debounce);
    this.watchers.delete(gameId);
  }

  rescan(gameId) {
    const s = this.state[gameId];
    if (!s?.source) throw Object.assign(new Error('Set up a build source first'), { statusCode: 409 });
    return s.source.type === 'folder' ? this.scan(gameId, { force: true }).then(() => this.get(gameId)) : this.refreshFile(gameId).then(() => this.get(gameId), () => this.get(gameId));
  }

  // One scan at a time per game; a scan asked for meanwhile runs after it.
  scan(gameId, opts) {
    const prev = this.scans.get(gameId) ?? Promise.resolve();
    const next = prev.then(() => this.scanOnce(gameId, opts), () => this.scanOnce(gameId, opts));
    this.scans.set(gameId, next.finally(() => { if (this.scans.get(gameId) === next) this.scans.delete(gameId); }));
    return next;
  }

  async scanOnce(gameId, { force = false } = {}) {
    const s = this.state[gameId];
    const w = this.watchers.get(gameId);
    if (!s?.source || s.source.type !== 'folder') return;
    const { dir, pattern } = s.source;
    let names;
    try { names = await readdir(dir); }
    catch (err) { return this.setStatus(gameId, { state: 'error', ...publicError(folderError(err, dir)) }); }
    const re = patternRegex(pattern);
    const matches = [];
    for (const name of names) {
      if (!re.test(name) || !ARTIFACT_EXT.test(name)) continue;
      try {
        const info = await stat(join(dir, name));
        if (info.isFile()) matches.push({ name, path: join(dir, name), size: info.size, mtime: Math.round(info.mtimeMs) });
      } catch { /* removed between readdir and stat */ }
    }
    if (!matches.length) {
      const nearMiss = names.filter((n) => ARTIFACT_EXT.test(n)).slice(0, 3);
      return this.setStatus(gameId, {
        state: s.latest ? 'error' : 'waiting', code: 'no-match',
        message: s.latest ? `${s.latest.name} is gone from the folder and nothing else matches ${pattern}` : `Waiting for a file named ${pattern}`,
        hint: nearMiss.length ? `The folder has ${nearMiss.join(', ')}. Check the file name.` : 'Build the game into this folder.',
      });
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    const newest = matches[0];
    const fingerprint = `${newest.size}:${newest.mtime}`;
    if (!force && s.latest?.fingerprint === fingerprint && s.latest.path === newest.path) return;
    if (!force && s.failed === `${newest.path}|${fingerprint}`) return;

    // Unity writes the file in place; read it only after it stops changing.
    const now = Date.now();
    const seen = w?.candidate;
    const settled = seen && seen.path === newest.path && seen.fingerprint === fingerprint && now - seen.at >= this.settleMs;
    const quiet = now - newest.mtime >= this.settleMs;
    if (!settled && !quiet) {
      if (w && (!seen || seen.path !== newest.path || seen.fingerprint !== fingerprint)) w.candidate = { path: newest.path, fingerprint, at: now };
      if (w) { clearTimeout(w.settleTimer); w.settleTimer = setTimeout(() => this.scan(gameId).catch(() => {}), this.settleMs + 100); }
      return this.setStatus(gameId, { state: 'settling', code: 'settling', message: `Found ${newest.name}; waiting for the build to finish writing it` });
    }
    try {
      const artifact = await inspectArtifact(newest.path);
      this.checkGame(this.game(gameId), artifact);
      const isNew = artifact.fingerprint !== s.latest?.fingerprint || artifact.path !== s.latest?.path;
      s.latest = artifact;
      s.failed = null;
      if (isNew) this.persist();
      this.setStatus(gameId, { state: 'ready', message: `${artifact.name} is ready to install${matches.length > 1 ? ` (newest of ${matches.length} matching files)` : ''}` });
      if (isNew) {
        this.changed(gameId);
        this.emit('artifact', gameId, artifact);
      }
    } catch (err) {
      s.failed = `${newest.path}|${fingerprint}`;
      this.setStatus(gameId, { state: 'error', ...publicError(err) });
    }
  }

  close() {
    for (const id of [...this.watchers.keys()]) this.stopWatch(id);
  }
}
