// One QA run: owns the device for its duration, drives the plan's steps with deadlines,
// keeps logcat + plugin health + perf alive without a browser, talks to the QA bridge,
// and writes everything under <dir>/<run id>/ as it goes.
//
// Every step produces checks with one of: passed, failed, skipped, not-supported,
// not-verified. A missing hook is "not-supported", a soft expectation that timed out is
// "not-verified"; neither counts as a pass.
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, createWriteStream, renameSync } from 'node:fs';
import { join } from 'node:path';
import { LogStream, adbSource } from '../session/stream.mjs';
import { Monitor } from '../monitor/monitor.mjs';
import { PerfSampler } from '../perf/sampler.mjs';
import { matches } from '../rules/match.mjs';
import { appActions, foregroundPackage } from '../device/info.mjs';
import { readAppProfile } from '../device/profile.mjs';
import { forward, removeForward, screencap, tap, swipe, key, displaySize, deviceClockMs, uiDump, findCloseControl } from './adb-actions.mjs';
import { BridgeClient } from './bridge-client.mjs';

export const DEFAULT_BRIDGE_PORT = 7421;
const DEFAULT_WITHIN = { network: 15000, launch: 30000, stop: 10000, expect: 30000, bridge: 15000, action: 30000, closeAd: 60000, appOpenCycle: 45000, screenshot: 20000, tapUi: 20000, key: 10000, manual: 180000, wait: 0, monkey: 0 };
const CRASH_KINDS = new Set(['java-crash', 'native-crash', 'anr']);
const MAX_EVENTS = 2000;
const AD_OPEN = { interstitial: (a) => a.kind === 'callback' && a.format === 'interstitial' && a.callback === 'Displayed', rewarded: (a) => a.kind === 'callback' && a.format === 'rewarded' && a.callback === 'Displayed', 'app-open': (a) => a.kind === 'status' && a.key === 'Ad.AppOpen' && a.state === 'Showed' };
const AD_CLOSE = { interstitial: (a) => a.kind === 'callback' && a.format === 'interstitial' && a.callback === 'Closed', rewarded: (a) => a.kind === 'callback' && a.format === 'rewarded' && a.callback === 'Closed', 'app-open': (a) => a.kind === 'status' && a.key === 'Ad.AppOpen' && a.state === 'Closed' };

class Cancelled extends Error { constructor(reason) { super(reason || 'cancelled'); this.cancelled = true; } }
class StepTimeout extends Error { constructor(ms) { super(`timed out after ${Math.round(ms / 1000)} s`); this.timeout = true; } }

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason instanceof Error ? signal.reason : new Cancelled(signal.reason)); }, { once: true });
});

// Deterministic PRNG for the monkey step so the tap sequence is recorded by its seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shot';

export class QARun extends EventEmitter {
  constructor({ id, adb, serial, pkg, plan, rules, deviceName, dir, game, bridgePort, connected, record = true }) {
    super();
    Object.assign(this, { id, adb, serial, pkg, plan, rules, deviceName, game, record });
    this.dir = join(dir, id);
    this.bridgePort = Number(bridgePort) || DEFAULT_BRIDGE_PORT;
    this.connected = connected ?? (() => true);
    this.status = 'queued';
    this.createdAt = Date.now();
    this.startedAt = null;
    this.endedAt = null;
    this.error = null;
    this.cancelReason = null;
    this.steps = plan.steps.map((s) => ({ ...s, status: 'pending', startedAt: null, endedAt: null, note: null, checks: [], evidence: [] }));
    this.current = null;
    this.checks = [];
    this.evidence = [];
    this.findings = [];
    this.events = [];          // bridge events + run markers
    this.bridgeInfo = { connected: false, hello: null, port: null, error: null };
    this.app = null;
    this.display = null;
    this.clockOffset = 0;
    this.windowStart = 0;      // device-clock ms; expectations look at lines after this
    this.adShowing = {};       // format -> device ts of the open ad
    this.waiters = new Set();
    this.bridgeWaiters = new Set();
    this.abort = new AbortController();
    this.manual = null;
    this.lineCount = 0;
    this.saveTimer = null;
    this.lastSaveAt = 0;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async start() {
    this.startedAt = Date.now();
    this.setStatus('preparing');
    try {
      mkdirSync(join(this.dir, 'shots'), { recursive: true });
      await this.prepare();
      this.setStatus('running');
      for (const step of this.steps) {
        if (this.abort.signal.aborted) break;
        await this.runStep(step);
      }
      await this.finish(this.abort.signal.aborted ? 'cancelled' : 'completed');
    } catch (err) {
      await this.finish(err?.cancelled ? 'cancelled' : 'infrastructure-error', err).catch(() => {});
    }
    return this;
  }

  cancel(reason = 'Cancelled by user') {
    if (this.endedAt) return false;
    this.cancelReason = reason;
    if (this.status === 'running' || this.status === 'preparing') this.setStatus('stopping');
    this.abort.abort(reason);
    return true;
  }

  async prepare() {
    const { adb, serial, pkg } = this;
    if (!this.connected(serial)) throw new Error(`Device ${serial} is not connected`);
    this.app = await readAppProfile(adb, serial, pkg).catch(() => null);
    if (!this.app?.versionName && !this.app?.versionCode) throw new Error(`${pkg} is not installed on ${this.deviceName}`);
    const clock = await deviceClockMs(adb, serial);
    this.clockOffset = clock != null ? clock - Date.now() : 0;
    this.display = await displaySize(adb, serial).catch(() => null);
    this.windowStart = this.deviceNow();

    this.monitor = this.rules ? new Monitor({ rules: this.rules, pkg, deviceName: this.deviceName }) : null;
    if (this.monitor) { this.monitor.app = this.app; this.monitor.health.debuggable = this.app?.debuggable; }
    if (this.record) this.logFile = createWriteStream(join(this.dir, 'logcat.jsonl'), { flags: 'a' });
    this.stream = new LogStream({ source: adbSource(adb, serial, { history: false }), pkg, all: false, onEntry: (e) => this.onEntry(e) });
    this.stream.on('state', (st) => { if (st.state === 'ended' && !this.endedAt) this.note(`logcat ended: ${st.reason ?? 'unknown'}`); });
    await this.stream.start();
    if (this.monitor) {
      this.sampler = new PerfSampler({ adb, serial, pkg, model: this.monitor.perf });
      this.sampler.start();
    }
    this.scheduleSave();
  }

  async finish(status, err = null) {
    if (this.endedAt) return;
    this.setStatus('stopping');
    for (const s of this.steps) if (s.status === 'pending') s.status = 'skipped';
    this.closeBridge();
    await removeForward(this.adb, this.serial, this.bridgeInfo.port);
    if (this.networkOff) {
      await this.adb.shell(this.serial, 'cmd connectivity airplane-mode disable 2>/dev/null || (settings put global airplane_mode_on 0 && am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false)', { timeout: 10000 }).catch(() => {});
      this.networkOff = false;
      this.note('network restored at the end of the run');
    }
    this.sampler?.stop();
    this.stream?.stop();
    await new Promise((r) => (this.logFile ? this.logFile.end(r) : r()));
    this.collectFindings();
    this.endedAt = Date.now();
    this.error = err ? String(err.message || err) : null;
    this.perf = this.monitor ? { summary: this.monitor.perf.summary(), samples: this.monitor.perf.samples } : null;
    if (this.record) writeFileSync(join(this.dir, 'perf.json'), JSON.stringify(this.perf ?? null));
    this.status = status;
    this.save();
    this.emit('update', this);
    this.emit('done', this);
  }

  deviceNow() { return Date.now() + this.clockOffset; }
  setStatus(s) { this.status = s; this.emit('update', this); this.scheduleSave(); }
  note(text) { this.events.push({ kind: 'note', text, at: Date.now() }); if (this.events.length > MAX_EVENTS) this.events.shift(); }

  // ── log intake ─────────────────────────────────────────────────────────────

  onEntry(e) {
    this.lineCount++;
    this.monitor?.ingest(e);
    this.logFile?.write(JSON.stringify(e) + '\n');
    const a = e.avn;
    if (a) {
      for (const [format, test] of Object.entries(AD_OPEN)) if (test(a)) this.adShowing[format] = e.ts;
      for (const [format, test] of Object.entries(AD_CLOSE)) if (test(a)) this.adShowing[format] = null;
    }
    if (/\[AVNQA\.Bridge\] listening/.test(e.message)) this.bridgeSeenInLog = e;
    for (const w of [...this.waiters]) {
      if (e.ts >= w.since && matches(e, w.match)) { this.waiters.delete(w); w.resolve(e); }
    }
  }

  onBridgeEvent(ev) {
    this.events.push({ kind: 'bridge', ...ev });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    for (const w of [...this.bridgeWaiters]) {
      if (ev.at >= w.since && ev.name === w.event && (!w.data || Object.entries(w.data).every(([k, v]) => String(ev.data?.[k]) === String(v)))) { this.bridgeWaiters.delete(w); w.resolve(ev); }
    }
    this.scheduleSave();
  }

  waitForLog(match, { since, signal }) {
    const seen = this.stream?.buffer.find((e) => e.ts >= since && matches(e, match));
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w = { match, since, resolve };
      this.waiters.add(w);
      signal.addEventListener('abort', () => { this.waiters.delete(w); reject(signal.reason instanceof Error ? signal.reason : new Cancelled(signal.reason)); }, { once: true });
    });
  }

  waitForBridge(event, data, { since, signal }) {
    const seen = this.events.find((x) => x.kind === 'bridge' && x.at >= since && x.name === event && (!data || Object.entries(data).every(([k, v]) => String(x.data?.[k]) === String(v))));
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const w = { event, data, since, resolve };
      this.bridgeWaiters.add(w);
      signal.addEventListener('abort', () => { this.bridgeWaiters.delete(w); reject(signal.reason instanceof Error ? signal.reason : new Cancelled(signal.reason)); }, { once: true });
    });
  }

  // ── steps ──────────────────────────────────────────────────────────────────

  async runStep(step) {
    step.status = 'running';
    step.startedAt = Date.now();
    step.deviceStartedAt = this.deviceNow();
    this.current = step.id;
    this.emit('update', this);
    this.scheduleSave();
    const ms = step.within ?? DEFAULT_WITHIN[step.type] ?? 30000;
    const ctl = new AbortController();
    const onCancel = () => ctl.abort(new Cancelled(this.cancelReason));
    this.abort.signal.addEventListener('abort', onCancel, { once: true });
    const timer = ms > 0 ? setTimeout(() => ctl.abort(new StepTimeout(ms)), ms) : null;
    try {
      await this[`step_${step.type}`](step, ctl.signal);
      if (step.status === 'running') step.status = step.checks.some((c) => c.status === 'failed') ? 'failed' : step.checks.every((c) => c.status === 'skipped' || c.status === 'not-supported') && step.checks.length ? step.checks[0].status : 'passed';
    } catch (err) {
      if (err?.cancelled || this.abort.signal.aborted) { step.status = 'cancelled'; step.note = this.cancelReason; }
      else if (err?.timeout) { this.check(step, step.soft ? 'not-verified' : 'failed', step.label, err.message); step.status = step.soft ? 'not-verified' : 'failed'; }
      else { this.check(step, 'failed', step.label, err.message); step.status = 'failed'; }
      if (err?.cancelled) throw err;
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', onCancel);
      step.endedAt = Date.now();
      this.current = null;
      this.emit('update', this);
      this.scheduleSave();
    }
  }

  check(step, status, label, note = null, extra = {}) {
    const c = { stepId: step.id, label, status, note, at: Date.now(), ...extra };
    step.checks.push(c);
    this.checks.push(c);
    return c;
  }

  // Evaluate a step's expectations concurrently; each becomes a check.
  async expectAll(step, expects, signal, { since = this.windowStart, sinceHost = step.startedAt } = {}) {
    if (!expects?.length) return;
    await Promise.all(expects.map(async (x) => {
      const soft = x.soft || step.soft;
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = x.within ? setTimeout(() => ctl.abort(new StepTimeout(x.within)), x.within) : null;
      try {
        if (x.kind === 'log') {
          const e = await this.waitForLog(x.match, { since, signal: ctl.signal });
          if (x.absent) this.check(step, soft ? 'not-verified' : 'failed', x.label, `happened: ${(e.message || '').slice(0, 140)}`, { entryId: e.id, ts: e.ts });
          else this.check(step, 'passed', x.label, (e.message || '').slice(0, 160), { entryId: e.id, ts: e.ts });
        } else if (x.kind === 'bridge') {
          const ev = await this.waitForBridge(x.event, x.data, { since: sinceHost, signal: ctl.signal });
          if (x.absent) this.check(step, soft ? 'not-verified' : 'failed', x.label, `happened: ${JSON.stringify(ev.data ?? {}).slice(0, 140)}`, { ts: ev.at });
          else this.check(step, 'passed', x.label, JSON.stringify(ev.data ?? {}).slice(0, 160), { ts: ev.at });
        } else if (x.kind === 'foreground') {
          const fg = await foregroundPackage(this.adb, this.serial);
          const ok = (fg === this.pkg) === x.game;
          this.check(step, ok ? 'passed' : soft ? 'not-verified' : 'failed', x.label, `foreground: ${fg ?? 'unknown'}`);
        }
      } catch (err) {
        if (err?.cancelled) throw err;
        if (x.absent && err?.timeout) this.check(step, 'passed', x.label, `did not happen within ${Math.round(x.within / 1000)} s`);
        else if (err?.timeout || signal.aborted) this.check(step, soft ? 'not-verified' : 'failed', x.label, err?.timeout ? err.message : 'step deadline reached');
        else this.check(step, 'failed', x.label, err.message);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
    }));
  }

  async step_launch(step, signal) {
    const { adb, serial, pkg } = this;
    if (step.cold) { this.closeBridge(); await appActions.stop(adb, serial, pkg); await sleep(1000, signal); }
    this.windowStart = this.deviceNow() - 500;
    await appActions.launch(adb, serial, pkg);
    this.note(`launch ${step.cold ? 'cold' : 'warm'}`);
    while (!signal.aborted) {
      const fg = await foregroundPackage(adb, serial).catch(() => null);
      if (fg === pkg) { this.check(step, 'passed', 'Game in the foreground'); return; }
      await sleep(1000, signal);
    }
    throw signal.reason;
  }

  async step_stop(step) {
    this.closeBridge();
    await appActions.stop(this.adb, this.serial, this.pkg);
    this.check(step, 'passed', 'Game stopped');
  }

  async step_wait(step, signal) { await sleep(step.seconds * 1000, signal); this.check(step, 'passed', `Waited ${step.seconds} s`); }

  async step_expect(step, signal) { await this.expectAll(step, step.expect, signal); }

  async step_screenshot(step) {
    const png = await screencap(this.adb, this.serial);
    const file = `${step.id}-${slug(step.label)}.png`;
    if (this.record) writeFileSync(join(this.dir, 'shots', file), png);
    const ev = { file, label: step.label, stepId: step.id, at: Date.now(), bytes: png.length };
    step.evidence.push(ev);
    this.evidence.push(ev);
    this.check(step, 'passed', step.label, file);
  }

  async step_bridge(step, signal) {
    try {
      await this.connectBridge(signal);
      const h = this.bridgeInfo.hello;
      const n = h?.capabilities?.actions?.length ?? 0;
      this.check(step, 'passed', 'QA bridge connected', `SDK ${h?.sdk}, ${n} action${n === 1 ? '' : 's'}${h?.capabilities?.level ? ', level provider' : ''}${h?.capabilities?.state ? ', state provider' : ''}`);
    } catch (err) {
      if (err?.cancelled) throw err;
      this.bridgeInfo.error = err.message;
      this.check(step, step.required ? 'failed' : 'not-supported', 'QA bridge connected', `${err.message}. Build with AVN_QA (menu AVN > QA > Enable QA build) to enable bridge steps.`);
    }
  }

  async connectBridge(signal) {
    this.closeBridge();
    if (!this.bridgeInfo.port) this.bridgeInfo.port = await forward(this.adb, this.serial, this.bridgePort);
    const client = new BridgeClient({ port: this.bridgeInfo.port, timeoutMs: 8000 });
    await client.connect();
    const hello = await client.handshake(this.id);
    if (hello?.app?.package && hello.app.package !== this.pkg) { client.close(); throw new Error(`bridge belongs to ${hello.app.package}, not ${this.pkg}`); }
    client.on('event', (ev) => this.onBridgeEvent(ev));
    client.on('close', () => { if (this.bridge === client) { this.bridge = null; this.bridgeInfo.connected = false; this.note('bridge disconnected'); } });
    this.bridge = client;
    this.bridgeInfo = { ...this.bridgeInfo, connected: true, hello, error: null };
    this.note(`bridge connected: ${hello?.capabilities?.actions?.join(', ') || 'no actions'}`);
    if (signal?.aborted) throw signal.reason;
    return client;
  }

  closeBridge() {
    this.bridge?.close();
    this.bridge = null;
    this.bridgeInfo.connected = false;
  }

  async bridgeOrSkip(step, label) {
    if (this.bridge) return this.bridge;
    if (this.bridgeInfo.port) { try { return await this.connectBridge(); } catch { /* fall through */ } }
    this.check(step, 'not-supported', label, this.bridgeInfo.error ? `QA bridge unavailable: ${this.bridgeInfo.error}` : 'QA bridge not connected (add a bridge step first)');
    return null;
  }

  async step_action(step, signal) {
    const bridge = await this.bridgeOrSkip(step, step.label);
    if (!bridge) return;
    if (!bridge.supports(step.action)) { this.check(step, 'not-supported', step.label, `the game did not register ${step.action}`); return; }
    this.windowStart = this.deviceNow() - 200;
    const sinceHost = Date.now() - 50;
    try {
      const result = await bridge.invoke(step.action, step.args, { timeoutMs: Math.min(step.within ?? 30000, 30000) });
      this.check(step, 'passed', `${step.action} invoked`, result == null ? null : JSON.stringify(result).slice(0, 200), { result });
    } catch (err) {
      if (err.code === 'not-wired' || err.code === 'unknown-action') { this.check(step, 'not-supported', step.label, err.message); return; }
      if (err.code === 'not-connected') { this.check(step, 'not-supported', step.label, 'bridge disconnected'); return; }
      this.check(step, 'failed', `${step.action} invoked`, err.message);
      return;
    }
    await this.expectAll(step, step.expect, signal, { sinceHost });
  }

  async step_tapUi(step, signal) {
    const bridge = await this.bridgeOrSkip(step, step.label);
    if (!bridge) return;
    const control = await bridge.find(step.query);
    if (!control) { this.check(step, step.soft ? 'not-verified' : 'failed', step.label, `no visible control matches "${step.query}"`); return; }
    if (!this.display) { this.check(step, 'failed', step.label, 'display size unknown'); return; }
    const x = control.center.x * this.display.width, y = control.center.y * this.display.height;
    this.windowStart = this.deviceNow() - 200;
    const sinceHost = Date.now() - 50;
    await tap(this.adb, this.serial, x, y);
    this.check(step, 'passed', `Tapped ${control.name}`, `${control.id} at ${Math.round(x)},${Math.round(y)}`);
    await this.expectAll(step, step.expect, signal, { sinceHost });
  }

  async step_key(step, signal) {
    this.windowStart = this.deviceNow() - 200;
    const sinceHost = Date.now() - 50;
    await key(this.adb, this.serial, step.key);
    this.check(step, 'passed', `Pressed ${step.key}`);
    await this.expectAll(step, step.expect, signal, { sinceHost });
  }

  async step_appOpenCycle(step, signal) {
    const { adb, serial, pkg } = this;
    await key(adb, serial, 'home');
    await sleep(step.backgroundSeconds * 1000, signal);
    const fg = await foregroundPackage(adb, serial).catch(() => null);
    this.check(step, fg !== pkg ? 'passed' : 'failed', 'Game went to the background', `foreground: ${fg ?? 'unknown'}`);
    this.windowStart = this.deviceNow() - 200;
    await appActions.launch(adb, serial, pkg);
    let back = false;
    for (let i = 0; i < 10 && !signal.aborted; i++) { if ((await foregroundPackage(adb, serial).catch(() => null)) === pkg) { back = true; break; } await sleep(1000, signal); }
    this.check(step, back ? 'passed' : 'failed', 'Game returned to the foreground');
    if (!step.expectShow || !back) return;
    // Either the ad shows, or the plugin explains why it did not (level gate, cooldown, disabled).
    const shown = { kind: 'status', key: 'Ad.AppOpen', state: 'Showed' };
    const blocked = { kind: 'status', key: 'Ad.AppOpen', message: '/TryShow blocked|suppressed|not ready|disabled|First foreground resume ignored/' };
    const result = await Promise.race([
      this.waitForLog(shown, { since: this.windowStart, signal }).then((e) => ({ ok: true, e })),
      this.waitForLog(blocked, { since: this.windowStart, signal }).then((e) => ({ ok: false, e })),
    ]).catch((err) => { if (err?.cancelled) throw err; return { timeout: true }; });
    if (result.timeout) this.check(step, 'not-verified', 'App Open ad displayed', 'no show and no reason within the deadline');
    else if (result.ok) this.check(step, 'passed', 'App Open ad displayed', result.e.message.slice(0, 160), { entryId: result.e.id, ts: result.e.ts });
    else this.check(step, 'not-verified', 'App Open ad displayed', `plugin: ${result.e.avn?.message ?? result.e.message}`.slice(0, 200), { entryId: result.e.id, ts: result.e.ts });
  }

  // Close the ad that is showing. Real creatives differ, so this is best effort and the report
  // says how it was closed. It never taps the middle of the screen while an ad is up.
  async step_closeAd(step, signal) {
    const { adb, serial } = this;
    const format = step.format;
    const openedAt = this.adShowing[format];
    if (!openedAt) {
      // Give a just-triggered ad a moment to report Displayed.
      try { await sleep(Math.min(5000, step.within ?? 5000), signal); } catch (err) { if (err?.cancelled) throw err; }
      if (!this.adShowing[format]) { this.check(step, 'skipped', step.label, `no ${format} ad was showing`); step.status = 'skipped'; return; }
    }
    if (format === 'rewarded' && step.early) {
      // Close before the creative finishes: the "reward cancelled by user" path.
      await sleep(step.minSeconds * 1000, signal);
    } else if (format === 'rewarded') {
      // Wait for the reward callback (the creative has finished) or a reasonable upper bound.
      const reward = { kind: 'callback', format: 'rewarded', callback: 'Rewarded' };
      await Promise.race([this.waitForLog(reward, { since: this.windowStart, signal }), sleep(45000, signal)]).catch((err) => { if (err?.cancelled) throw err; });
      await sleep(1500, signal);
    } else if (step.minSeconds > 0) {
      await sleep(step.minSeconds * 1000, signal);
    }
    const closed = () => !this.adShowing[format];
    let how = null;
    for (let attempt = 0; attempt < 4 && !closed() && !signal.aborted; attempt++) {
      const control = findCloseControl(await uiDump(adb, serial));
      if (control) {
        await tap(adb, serial, control.x, control.y);
        how = `tapped "${control.label}" at ${Math.round(control.x)},${Math.round(control.y)}`;
        await sleep(2500, signal);
        if (closed()) break;
      }
      if (attempt === 2) { await key(adb, serial, 'back'); how = (how ? how + ', then ' : '') + 'pressed back'; await sleep(2500, signal); }
      else await sleep(3000, signal);
    }
    if (closed()) { this.check(step, 'passed', step.label, how ?? 'closed on its own'); return; }
    this.manual = { stepId: step.id, text: `Close the ${format} ad on the phone.` };
    this.emit('update', this);
    try {
      await this.waitForLog(this.closeMatcher(format), { since: this.windowStart, signal });
      this.check(step, 'not-verified', step.label, `${how ? how + '; ' : ''}needed a manual close`);
    } catch (err) {
      if (err?.cancelled) throw err;
      this.check(step, 'failed', step.label, `${how ? how + '; ' : ''}still showing at the deadline`);
    } finally { this.manual = null; }
  }

  closeMatcher(format) {
    return format === 'app-open' ? { kind: 'status', key: 'Ad.AppOpen', state: 'Closed' } : { kind: 'callback', format, callback: 'Closed' };
  }

  // Airplane mode through the connectivity service (Android 11+), with the settings fallback.
  async step_network(step) {
    const on = step.state === 'on';
    const { adb, serial } = this;
    const cmd = `cmd connectivity airplane-mode ${on ? 'disable' : 'enable'} 2>/dev/null || (settings put global airplane_mode_on ${on ? 0 : 1} && am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${on ? 'false' : 'true'})`;
    await adb.shell(serial, cmd, { timeout: 10000 });
    this.networkOff = !on;
    this.note(`network ${step.state}`);
    this.check(step, 'passed', step.label);
  }

  async step_manual(step, signal) {
    this.manual = { stepId: step.id, text: step.instructions || step.label };
    this.windowStart = Math.min(this.windowStart, this.deviceNow() - 200);
    this.emit('update', this);
    try { await this.expectAll(step, step.expect, signal, { sinceHost: step.startedAt - 1000 }); }
    finally { this.manual = null; }
  }

  // Random taps inside the game only: pauses while an ad is up or another app is in front,
  // keeps clear of the status bar, the navigation bar and the banner strip at the bottom.
  async step_monkey(step, signal) {
    const { adb, serial, pkg } = this;
    if (!this.display) { this.check(step, 'failed', step.label, 'display size unknown'); return; }
    const rnd = mulberry32(step.seed);
    const { width: W, height: H } = this.display;
    const end = Date.now() + step.seconds * 1000;
    const gap = 1000 / step.perSecond;
    let taps = 0, swipes = 0, paused = 0, lastCheck = 0, ok = true;
    const actions = [];
    while (Date.now() < end && !signal.aborted) {
      if (Date.now() - lastCheck > 2000) {
        lastCheck = Date.now();
        const fg = await foregroundPackage(adb, serial).catch(() => null);
        ok = fg === pkg && !Object.values(this.adShowing).some(Boolean);
      }
      if (!ok) { paused++; await sleep(1000, signal); continue; }
      const x = Math.round(W * (0.05 + rnd() * 0.9)), y = Math.round(H * (0.1 + rnd() * 0.72));
      if (rnd() < 0.2) {
        const x2 = Math.round(W * (0.05 + rnd() * 0.9)), y2 = Math.round(H * (0.1 + rnd() * 0.72));
        await swipe(adb, serial, x, y, x2, y2, 150 + Math.round(rnd() * 300)).catch(() => {});
        swipes++; actions.push(['s', x, y, x2, y2]);
      } else { await tap(adb, serial, x, y).catch(() => {}); taps++; actions.push(['t', x, y]); }
      await sleep(gap, signal);
    }
    this.check(step, 'passed', step.label, `${taps} taps, ${swipes} swipes, seed ${step.seed}${paused ? `, paused ${paused} s while an ad or another app was in front` : ''}`, { actions: actions.slice(0, 2000) });
  }

  // ── results ────────────────────────────────────────────────────────────────

  collectFindings() {
    const m = this.monitor;
    if (!m) return;
    for (const c of m.crashes) {
      if (c.ts < this.windowStartAtLaunch) continue;
      this.findings.push({ severity: CRASH_KINDS.has(c.kind) ? 'critical' : 'warning', kind: c.kind, title: c.kind === 'exception' ? 'Unity exception' : c.kind === 'anr' ? 'App not responding' : 'Crash', message: c.message.slice(0, 300), entryId: c.entryId, ts: c.ts, stepId: this.stepAt(c.ts) });
    }
    for (const f of m.flags.list()) if (f.severity !== 'info') this.findings.push({ severity: f.severity, kind: 'rule', title: f.name, message: (f.message ?? '').slice(0, 300), entryId: f.entryId ?? null, ts: f.ts ?? null, stepId: this.stepAt(f.ts) });
    if (this.bridgeSeenInLog && this.app && this.app.debuggable === false) this.findings.push({ severity: 'critical', kind: 'release', title: 'QA bridge present in a non-debuggable build', message: 'Remove AVN_QA before a store build (menu AVN > QA > Disable QA build).', entryId: this.bridgeSeenInLog.id, ts: this.bridgeSeenInLog.ts });
    this.findings.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
    if (this.findings.length > 200) this.findings.length = 200;
  }

  stepAt(ts) {
    if (!Number.isFinite(ts)) return null;
    const host = ts - this.clockOffset;
    return this.steps.find((s) => s.startedAt && host >= s.startedAt && (!s.endedAt || host <= s.endedAt))?.id ?? null;
  }

  summary() {
    const counts = { passed: 0, failed: 0, skipped: 0, 'not-supported': 0, 'not-verified': 0 };
    for (const c of this.checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
    const critical = this.findings.filter((f) => f.severity === 'critical').length;
    const outcome = this.status !== 'completed' ? 'incomplete' : counts.failed || critical ? 'failed' : 'passed';
    return { ...counts, findings: this.findings.length, critical, outcome, steps: this.steps.length, lines: this.lineCount };
  }

  toJSON({ full = true } = {}) {
    const h = this.monitor?.health?.snapshot?.();
    const base = {
      id: this.id, status: this.status, pkg: this.pkg, serial: this.serial, device: this.deviceName, game: this.game ? { id: this.game.id, name: this.game.name } : null,
      plan: { id: this.plan.id, name: this.plan.name, coverage: this.plan.coverage, source: this.plan.source, options: this.plan.options ?? {} },
      build: this.app ? { versionName: this.app.versionName ?? null, versionCode: this.app.versionCode ?? null, debuggable: this.app.debuggable ?? null } : null,
      createdAt: this.createdAt, startedAt: this.startedAt, endedAt: this.endedAt, error: this.error, cancelReason: this.cancelReason,
      current: this.current, manual: this.manual, summary: this.summary(), bridge: { connected: this.bridgeInfo.connected, port: this.bridgeInfo.port, error: this.bridgeInfo.error, sdk: this.bridgeInfo.hello?.sdk ?? null, actions: this.bridgeInfo.hello?.capabilities?.actions ?? [] },
    };
    if (!full) return base;
    return {
      ...base,
      display: this.display, clockOffset: this.clockOffset,
      steps: this.steps.map(({ ...s }) => s),
      checks: this.checks, evidence: this.evidence, findings: this.findings, events: this.events.slice(-400),
      perf: this.perf?.summary ?? this.monitor?.perf.summary() ?? null,
      levels: h?.levels ?? null, funnels: h?.funnels ?? null,
      firebase: this.monitor ? this.monitor.firebase.snapshot(Date.now(), null)?.counts ?? null : null,
    };
  }

  get windowStartAtLaunch() { return this.startedAt ? this.startedAt + this.clockOffset - 1000 : 0; }

  scheduleSave() {
    if (!this.record || this.saveTimer) return;
    const wait = Math.max(0, 1000 - (Date.now() - this.lastSaveAt));
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, wait);
  }

  save() {
    if (!this.record) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.lastSaveAt = Date.now();
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, 'run.json.tmp');
      writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 1));
      renameSync(tmp, join(this.dir, 'run.json'));
    } catch (err) { this.note(`save failed: ${err.message}`); }
  }
}
