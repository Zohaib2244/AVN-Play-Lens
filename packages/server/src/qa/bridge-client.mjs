// Client for the AVN QA SDK bridge (packages/unity-qa-sdk): newline-delimited JSON over a
// TCP port that `adb forward` maps to the phone's loopback listener.
import net from 'node:net';
import { EventEmitter } from 'node:events';

export const BRIDGE_PROTOCOL = 1;
const MAX_LINE = 1024 * 1024;

export class BridgeClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port, timeoutMs = 10000 }) {
    super();
    Object.assign(this, { host, port, timeoutMs });
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.hello = null;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => { socket.destroy(new Error('bridge connect timed out')); }, this.timeoutMs);
      socket.setNoDelay(true);
      socket.setEncoding('utf8');
      socket.once('connect', () => { clearTimeout(timer); this.socket = socket; resolve(); });
      socket.once('error', (err) => { clearTimeout(timer); if (!this.socket) reject(err); else this.fail(err); });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('close', () => this.fail(new Error('bridge connection closed')));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE) { this.fail(new Error('bridge sent an oversized line')); return; }
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg && typeof msg === 'object' && 'event' in msg) {
        this.emit('event', { name: msg.event, data: msg.data ?? {}, t: msg.t ?? null, frame: msg.frame ?? null, at: Date.now() });
        continue;
      }
      const p = msg?.id != null ? this.pending.get(msg.id) : null;
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result ?? null);
      else p.reject(Object.assign(new Error(msg.error || 'bridge error'), { code: msg.code || 'error', action: msg.action ?? null }));
    }
  }

  fail(err) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.emit('close', err);
  }

  request(cmd, args = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.socket || this.closed) return Promise.reject(Object.assign(new Error('bridge not connected'), { code: 'not-connected' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`bridge ${cmd} timed out after ${timeoutMs} ms`), { code: 'timeout' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  async handshake(runId) {
    const hello = await this.request('hello', { runId, client: 'avn-playlens' });
    if (hello?.proto !== BRIDGE_PROTOCOL) throw Object.assign(new Error(`bridge protocol ${hello?.proto ?? '?'} is not ${BRIDGE_PROTOCOL}`), { code: 'protocol' });
    this.hello = hello;
    return hello;
  }

  state() { return this.request('state'); }
  actions() { return this.request('actions'); }
  invoke(action, args = {}, opts) { return this.request('invoke', { action, args }, opts); }
  ui() { return this.request('ui'); }
  find(query) { return this.request('ui.find', { query }); }
  marker(text) { return this.request('marker', { text }); }
  supports(action) { return !!this.hello?.capabilities?.actions?.includes(action); }

  close() {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('bridge closed')); }
    this.pending.clear();
    this.socket?.destroy();
    this.socket = null;
  }
}
