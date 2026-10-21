// Session history: every log stream is saved as gzipped JSON lines under
// ~/.avn-playlens/sessions, with a small index for the home screen. Keeps the last 50.
import { createGzip, gunzipSync } from 'node:zlib';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const SESSIONS_DIR = join(os.homedir(), '.avn-playlens', 'sessions');
const INDEX = () => join(SESSIONS_DIR, 'index.json');
const KEEP = 50;

export function listSessions() {
  try {
    return JSON.parse(readFileSync(INDEX(), 'utf8'));
  } catch {
    return [];
  }
}

function saveIndex(list) {
  writeFileSync(INDEX(), JSON.stringify(list, null, 2));
}

export class SessionRecorder {
  constructor({ serial, deviceName, pkg, replay }) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const d = new Date();
    this.id = `${d.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
    this.meta = { id: this.id, serial, device: deviceName, pkg, replay: !!replay, startedAt: Date.now(), endedAt: null, lines: 0 };
    this.gzip = createGzip();
    this.gzip.on('error', () => {});   // a failed history write must never take the server down
    const file = createWriteStream(join(SESSIONS_DIR, `${this.id}.jsonl.gz`));
    file.on('error', () => {});
    this.gzip.pipe(file);
    this.lines = 0;
  }

  write(entry) {
    if (this.done) return;
    this.lines++;
    this.gzip.write(JSON.stringify({ ts: entry.ts, pid: entry.pid, tid: entry.tid, level: entry.level, tag: entry.tag, message: entry.message, more: entry.more, kind: entry.kind }) + '\n');
  }

  finish(summary = {}, { perf = null } = {}) {
    if (this.done) return;
    this.done = true;
    this.gzip.end();
    if (this.lines < 20) return;   // skip throwaway streams (e.g. a few seconds before picking a game)
    if (perf) {
      try { writeFileSync(join(SESSIONS_DIR, `${this.id}.perf.json`), JSON.stringify(perf)); } catch { /* history is best-effort */ }
    }
    const list = listSessions().filter((s) => s.id !== this.id);
    list.unshift({ ...this.meta, ...summary, endedAt: Date.now(), lines: this.lines });
    for (const old of list.splice(KEEP)) {
      for (const f of [`${old.id}.jsonl.gz`, `${old.id}.perf.json`]) {
        try { unlinkSync(join(SESSIONS_DIR, f)); } catch { /* already gone */ }
      }
    }
    saveIndex(list);
  }
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Plain-text export in a logcat-like layout, readable in any editor.
export function sessionText(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  let raw;
  try {
    raw = gunzipSync(readFileSync(join(SESSIONS_DIR, `${id}.jsonl.gz`))).toString('utf8');
  } catch (err) {
    // A session still being written has an unfinished gzip tail; read what's there.
    if (err.code === 'ENOENT') return null;
    raw = '';
  }
  return raw.split('\n').filter(Boolean).map((l) => {
    const e = JSON.parse(l);
    const head = `${stamp(e.ts)} ${String(e.pid).padStart(5)} ${String(e.tid).padStart(5)} ${e.level} ${e.tag}: `;
    return [head + e.message, ...(e.more ?? []).map((m) => head + m)].join('\n');
  }).join('\n') + '\n';
}
