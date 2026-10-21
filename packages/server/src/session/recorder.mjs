// Named captures, searchable history and explicit deletion. Active gzip streams are
// flushed before export; discarded/short captures leave no orphaned files behind.
import { createGzip, gunzipSync, constants } from 'node:zlib';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const SESSIONS_DIR = join(os.homedir(), '.avn-playlens', 'sessions');
const active = new Map();
const validId = (id) => /^[\w-]+$/.test(id);
const files = (id) => ['jsonl.gz', 'perf.json', 'snapshot.json'].map((ext) => join(SESSIONS_DIR, `${id}.${ext}`));
const indexFile = () => join(SESSIONS_DIR, 'index.json');
export function listSessions() {
  try { return JSON.parse(readFileSync(indexFile(), 'utf8')).map((s) => ({ ...s, active: active.has(s.id), paused: !!active.get(s.id)?.paused })); }
  catch { return []; }
}
function saveIndex(list) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(indexFile(), JSON.stringify(list.map(({ active, ...s }) => s), null, 2));
}
function removeFiles(id) {
  for (const f of files(id)) { try { unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
export function deleteSession(id) {
  if (!validId(id) || !listSessions().some((s) => s.id === id)) return false;
  if (active.has(id)) throw new Error('This session is still recording. Discard it from the session controls first.');
  removeFiles(id);
  saveIndex(listSessions().filter((s) => s.id !== id));
  return true;
}
function nextName(pkg) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = join(SESSIONS_DIR, 'sequence.json');
  let sequence = {};
  try { const data = JSON.parse(readFileSync(file, 'utf8')); if (data && typeof data === 'object') sequence = data; } catch {}
  const key = pkg || '__device';
  const previous = listSessions().filter((s) => (s.pkg || '') === (pkg || '')).reduce((n, s) => Math.max(n, Number(/^Session (\d+)$/.exec(s.name || '')?.[1]) || 0), 0);
  const n = Math.max(Number(sequence[key]) || 0, previous);
  sequence[key] = n + 1;
  writeFileSync(file, JSON.stringify(sequence));
  return `Session ${n + 1}`;
}
export class SessionRecorder {
  constructor({ serial, deviceName, pkg, replay, game = null }) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
    this.meta = { id: this.id, name: nextName(pkg), gameId: game?.id ?? null, gameName: game?.name ?? null, serial, device: deviceName, pkg, replay: !!replay, startedAt: Date.now(), endedAt: null, lines: 0 };
    this.gzip = createGzip();
    this.file = createWriteStream(files(this.id)[0]);
    this.error = null;
    this.gzip.on('error', (err) => { this.error = err; this.file.destroy(); });
    this.file.on('error', (err) => { this.error = err; });
    this.closed = new Promise((resolve) => this.file.on('close', resolve));
    this.gzip.pipe(this.file);
    this.lines = 0;
    this.saved = false;
    active.set(this.id, this);
  }
  write(entry) {
    if (this.done || this.error) return;
    this.lines++;
    this.gzip.write(JSON.stringify(entry) + '\n');
  }
  details() { return { ...this.meta, lines: this.lines, saved: this.saved, paused: !!this.paused }; }
  persist(summary = {}, { perf = null, snapshot = null } = {}) {
    if (this.error) throw this.error;
    if (snapshot?.app) Object.assign(this.meta, { versionName: snapshot.app.versionName, versionCode: snapshot.app.versionCode });
    if (perf) writeFileSync(files(this.id)[1], JSON.stringify(perf));
    if (snapshot) writeFileSync(files(this.id)[2], JSON.stringify(snapshot));
    const list = listSessions().filter((s) => s.id !== this.id);
    list.unshift({ ...this.meta, ...summary, lines: this.lines });
    // Do not evict a capture still being written by another tab.
    const completed = list.filter((s) => !active.has(s.id) && (s.pkg || '') === (this.meta.pkg || ''));
    const expired = new Set(completed.slice(50).map((s) => s.id));
    for (const id of expired) removeFiles(id);
    saveIndex(list.filter((s) => !expired.has(s.id)));
    this.saved = true;
  }
  async save(summary = {}, options = {}) {
    if (this.done) return;
    if (this.error) throw this.error;
    this.saved = true;
    await new Promise((resolve, reject) => this.gzip.flush(constants.Z_SYNC_FLUSH, (err) => err ? reject(err) : resolve()));
    if (this.done) return this.closed;
    await new Promise((resolve, reject) => this.file.write('', (err) => err ? reject(err) : resolve()));
    this.persist(summary, options);
  }
  async finish(summary = {}, { save = true, ...options } = {}) {
    if (this.done) return this.closed;
    this.done = true;
    this.gzip.end();
    await this.closed;
    active.delete(this.id);
    const meaningful = (summary?.events ?? 0) > 0 || options.snapshot?.health?.funnels?.length > 0;
    if (!save || this.error || (!this.saved && !meaningful && this.lines < 20)) {
      removeFiles(this.id);
      saveIndex(listSessions().filter((s) => s.id !== this.id));
      return;
    }
    this.meta.endedAt = Date.now();
    this.persist(summary, options);
  }
}
export function sessionEntries(id) {
  if (!validId(id)) return null;
  try {
    const raw = gunzipSync(readFileSync(files(id)[0]), { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return null; }
}
export function sessionDetails(id) {
  const session = listSessions().find((s) => s.id === id);
  if (!session) return null;
  const entries = sessionEntries(id);
  if (!entries) return null;
  let snapshot = null;
  try { snapshot = JSON.parse(readFileSync(files(id)[2], 'utf8')); } catch {}
  return { session, entries, snapshot };
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
export function sessionText(id) {
  const entries = sessionEntries(id);
  if (!entries) return null;
  return entries.map((e) => {
    const head = `${stamp(e.ts)} ${String(e.pid).padStart(5)} ${String(e.tid).padStart(5)} ${e.level} ${e.tag}: `;
    return [head + e.message, ...(e.more ?? []).map((m) => head + m)].join('\n');
  }).join('\n') + '\n';
}
