// One live log stream: a device (or the replay source), optionally narrowed to one game.
// Keeps a ring buffer so a page that opens late still sees recent lines, and hands out
// batches every 50 ms so the browser isn't flooded line by line.
import { EventEmitter } from 'node:events';
import { parseLogcatLine, Grouper, classify, belongsToGame, startedPid } from '../logcat/parse.mjs';
import { pidsOf } from '../device/info.mjs';

const BUFFER = 20000;

export class LogStream extends EventEmitter {
  // source: { start(onLine, onEnd), stop(), pids(pkg) -> Promise<number[]> }
  constructor({ source, pkg, all = false, onEntry = null }) {
    super();
    Object.assign(this, { source, pkg, all, onEntry });
    this.pids = new Set();
    this.buffer = [];
    this.pending = [];
    this.nextId = 1;
    this.counts = { total: 0, recent: [] };
    this.state = 'starting';
    this.grouper = new Grouper((e) => this.accept(e));
  }

  start() {
    this.source.start(
      (line) => {
        const parsed = parseLogcatLine(line);
        if (parsed) this.grouper.push(parsed);
      },
      (reason) => this.setState('ended', reason),
    );
    this.setState('live');
    this.batchTimer = setInterval(() => this.flushBatch(), 50);
    if (this.pkg) {
      this.refreshPids();
      this.pidTimer = setInterval(() => this.refreshPids(), 1500);
    }
  }

  setState(state, reason) {
    this.state = state;
    this.emit('state', { state, reason, running: this.pids.size > 0 });
  }

  async refreshPids() {
    try {
      const list = await this.source.pids(this.pkg);
      const before = this.pids.size;
      this.pids = new Set(list);
      if ((before > 0) !== (this.pids.size > 0)) this.emit('state', { state: this.state, running: this.pids.size > 0 });
    } catch {
      // device busy or gone; the next poll retries
    }
  }

  accept(raw) {
    const started = startedPid(raw, this.pkg);
    if (started) this.pids.add(started);
    if (!this.all && this.pkg && !belongsToGame(raw, this.pkg, this.pids)) return;
    const entry = classify(raw, this.pkg, this.pids.has(raw.pid));
    entry.id = this.nextId++;
    this.buffer.push(entry);
    if (this.buffer.length > BUFFER) this.buffer.splice(0, this.buffer.length - BUFFER);
    this.pending.push(entry);
    this.counts.total++;
    this.onEntry?.(entry);
  }

  flushBatch() {
    const now = Date.now();
    this.counts.recent = this.counts.recent.filter((t) => now - t.at < 5000);
    if (!this.pending.length) return;
    this.counts.recent.push({ at: now, n: this.pending.length });
    const batch = this.pending;
    this.pending = [];
    this.emit('batch', batch);
  }

  rate() {
    return Math.round(this.counts.recent.reduce((s, r) => s + r.n, 0) / 5);
  }

  stop() {
    clearInterval(this.batchTimer);
    clearInterval(this.pidTimer);
    this.grouper.flush();
    this.source.stop();
    this.removeAllListeners();
  }
}

// Real device: `adb logcat`. "-T 1" starts at the newest line; history is opt-in.
export function adbSource(adb, serial, { history = false } = {}) {
  let proc = null;
  let stopped = false;
  return {
    start(onLine, onEnd) {
      const args = ['logcat', '-v', 'threadtime', '-v', 'epoch', '-b', 'main,system,crash'];
      if (!history) args.push('-T', '1');
      proc = adb.spawn(args, { serial });
      let rest = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const l of lines) onLine(l);
      });
      proc.on('exit', () => !stopped && onEnd('logcat stopped (device disconnected?)'));
      proc.on('error', (err) => onEnd(err.message));
    },
    stop() {
      stopped = true;
      proc?.kill();
    },
    pids: (pkg) => pidsOf(adb, serial, pkg),
  };
}
