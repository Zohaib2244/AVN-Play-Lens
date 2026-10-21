// logcat line parsing (format: `-v threadtime -v epoch`), multi-line grouping and
// classification into sources and kinds for the UI.
import { parseAvnLine } from '../avn/parse.mjs';
import { parseFaLine } from '../avn/fa.mjs';
import { ownerOf, groupKey } from './owner.mjs';

// "1729420812.123 18342 18360 I Unity   : message"
const LINE = /^\s*(\d+\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?)\s*:(?: (.*))?$/;

export function parseLogcatLine(line) {
  const m = LINE.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  return { ts: Math.round(Number(m[1]) * 1000), pid: Number(m[2]), tid: Number(m[3]), level: m[4], tag: m[5], message: m[6] ?? '' };
}

// logcat prints a multi-line message (a Unity exception and its stack) as several lines
// with an identical header. Consecutive lines with the same header become one entry.
export class Grouper {
  constructor(onEntry, flushMs = 60) {
    this.onEntry = onEntry;
    this.flushMs = flushMs;
    this.cur = null;
    this.timer = null;
  }

  push(line) {
    const c = this.cur;
    // Independent diagnostics can share a millisecond and thread. Firebase messages
    // are individual records; a new AVN record starts another Unity message/stack.
    const avn = line.tag === 'Unity' ? parseAvnLine(line.message) : null;
    const separate = line.tag === 'FA' || line.tag === 'FA-SVC' ||
      (avn && (avn.kind !== 'plain' || avn.caller)) || /^\[AVN Analytics\]/.test(line.message);
    if (c && !separate && c.ts === line.ts && c.pid === line.pid && c.tid === line.tid && c.level === line.level && c.tag === line.tag) {
      c.lines.push(line.message);
    } else {
      this.flush();
      this.cur = { ...line, lines: [line.message] };
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  flush() {
    clearTimeout(this.timer);
    if (!this.cur) return;
    const c = this.cur;
    this.cur = null;
    this.onEntry({ ts: c.ts, pid: c.pid, tid: c.tid, level: c.level, tag: c.tag, message: c.lines[0], more: c.lines.length > 1 ? c.lines.slice(1) : undefined });
  }
}

const EXCEPTION = /^(?:[\w.]+\.)?\w*Exception\b|^\w+Error:/;

export function classify(entry, pkg, fromGame = true) {
  const e = { ...entry, source: 'app', kind: null };
  const text = entry.more ? entry.message + '\n' + entry.more.join('\n') : entry.message;
  if (entry.tag === 'Unity') {
    const avn = parseAvnLine(entry.message);
    if (avn) {
      e.source = 'avn';
      e.avn = avn;
    } else {
      e.source = 'unity';
      if (EXCEPTION.test(entry.message)) e.kind = 'exception';
    }
  } else if (entry.tag === 'FA' || entry.tag === 'FA-SVC') {
    e.source = 'firebase';
    const fa = parseFaLine(entry.tag, entry.message);
    if (fa) {
      e.fa = fa;
      e.kind = 'event';
    }
  } else if (entry.tag === 'AndroidRuntime' && /FATAL EXCEPTION/.test(text)) {
    e.source = 'crash';
    e.kind = 'java-crash';
  } else if ((entry.tag === 'DEBUG' || entry.tag === 'crash_dump' || entry.tag === 'libc') && /\*\*\* \*\*\*|Fatal signal/.test(text)) {
    e.source = 'crash';
    e.kind = 'native-crash';
  } else if (entry.tag === 'ActivityManager' && pkg && new RegExp(`ANR in ${pkg.replace(/\./g, '\\.')}`).test(text)) {
    e.source = 'crash';
    e.kind = 'anr';
  } else if (entry.tag === 'CRASH') {
    e.source = 'crash';
    e.kind = 'native-crash';
  }
  // Warnings, errors and crashes get an owner and a group key for the grouped view.
  if ('WEF'.includes(entry.level) || e.source === 'crash') {
    const o = ownerOf(e, { pkg, fromGame });
    e.owner = o.owner;
    if (o.sdk) e.sdk = o.sdk;
    if (o.meaning) e.meaning = o.meaning;
    if (o.safe) e.safe = true;
    e.gkey = groupKey(e, o);
  }
  return e;
}

// Keep only the game's processes and system diagnostics naming the exact package.
// Shared Firebase service lines without a verified game PID are excluded.
export function belongsToGame(entry, pkg, pids) {
  if (!pkg) return false;
  if (pids.has(entry.pid)) return true;
  const text = entry.more ? entry.message + ' ' + entry.more.join(' ') : entry.message;
  const named = new RegExp(`(^|[^a-zA-Z0-9_.])${pkg.replace(/\./g, '\\.')}($|[^a-zA-Z0-9_.])`).test(text);
  // Unattributed FA/FA-SVC lines may belong to any app on the phone.
  if (entry.tag === 'FA' || entry.tag === 'FA-SVC') return false;
  if (['ActivityManager', 'ActivityTaskManager', 'DEBUG', 'crash_dump', 'libc'].includes(entry.tag)) return named;
  return false;
}

// "Start proc 18342:com.studio.puzzle/u0a123 for ..." lets us pick up a restart immediately.
export function startedPid(entry, pkg) {
  if (entry.tag !== 'ActivityManager' || !pkg) return null;
  const m = /Start proc (\d+):([\w.:]+)\//.exec(entry.message);
  return m && (m[2] === pkg || m[2].startsWith(pkg + ':')) ? Number(m[1]) : null;
}
