// Owns QA runs: one active run per phone, run history on disk, and interrupted-run
// detection after a restart. Results live under ~/.avn-playlens/qa-runs/<run id>/,
// independent of session rotation.
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { QARun, DEFAULT_BRIDGE_PORT } from './run.mjs';
import { builtinPlans, gamePlans, applyOptions } from './plans.mjs';
import { assertSerial, assertPackage } from './adb-actions.mjs';

export const QA_RUNS_DIR = join(os.homedir(), '.avn-playlens', 'qa-runs');
const RUN_ID = /^qa-[\w-]{1,80}$/;
const KEEP_RUNS = 200;

export class QARunner extends EventEmitter {
  constructor({ adb, rules, games, devices, deviceName, dir = QA_RUNS_DIR, record = true }) {
    super();
    Object.assign(this, { adb, rules, games, devices, deviceName, dir, record });
    this.active = new Map();   // run id -> QARun
    this.markInterrupted();
  }

  // A server that died mid-run leaves run.json saying "running"; it never resumes actions.
  markInterrupted() {
    for (const run of this.readAll()) {
      if (!['queued', 'preparing', 'running', 'stopping'].includes(run.status)) continue;
      run.status = 'interrupted';
      run.endedAt = run.endedAt ?? Date.now();
      run.error = run.error ?? 'PlayLens stopped while this run was in progress';
      for (const s of run.steps ?? []) if (s.status === 'running' || s.status === 'pending') s.status = 'skipped';
      if (run.summary) run.summary.outcome = 'incomplete';
      try { writeFileSync(join(this.dir, run.id, 'run.json'), JSON.stringify(run, null, 1)); } catch { /* read-only dir */ }
    }
  }

  readAll() {
    if (!existsSync(this.dir)) return [];
    const runs = [];
    for (const name of readdirSync(this.dir)) {
      if (!RUN_ID.test(name)) continue;
      try { runs.push(JSON.parse(readFileSync(join(this.dir, name, 'run.json'), 'utf8'))); } catch { /* partial write */ }
    }
    return runs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  list(pkg = null) {
    const onDisk = this.readAll().filter((r) => !this.active.has(r.id));
    const live = [...this.active.values()].map((r) => r.toJSON({ full: false }));
    const all = [...live, ...onDisk.map(({ steps, checks, evidence, findings, events, ...rest }) => rest)];
    return all.filter((r) => !pkg || r.pkg === pkg).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  get(id) {
    if (!RUN_ID.test(id)) return null;
    const live = this.active.get(id);
    if (live) return live.toJSON();
    try { return JSON.parse(readFileSync(join(this.dir, id, 'run.json'), 'utf8')); } catch { return null; }
  }

  file(id, name) {
    if (!RUN_ID.test(id) || !/^[\w.-]{1,120}$/.test(name) || name.includes('..')) return null;
    const p = name.endsWith('.png') ? join(this.dir, id, 'shots', name) : join(this.dir, id, name);
    return existsSync(p) ? p : null;
  }

  activeFor(serial) {
    for (const r of this.active.values()) if (r.serial === serial) return r;
    return null;
  }

  plans(pkg) {
    const builtin = builtinPlans();
    let game = { plans: [], errors: [] };
    let bridgePort = DEFAULT_BRIDGE_PORT;
    if (pkg && this.rules) {
      const file = this.rules.forGame(pkg);
      const { doc } = file ? this.rules.read(file) : { doc: null };
      game = gamePlans(doc);
      if (Number.isInteger(doc?.qa?.bridgePort) && doc.qa.bridgePort > 1024 && doc.qa.bridgePort < 65536) bridgePort = doc.qa.bridgePort;
    }
    const placeholders = (steps) => [...new Set([...JSON.stringify(steps).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => k !== 'i' && k !== 'n'))];
    return { plans: [...builtin, ...game.plans].map(({ steps, ...p }) => ({ ...p, stepCount: steps.length, options: placeholders(steps) })), errors: game.errors, bridgePort };
  }

  resolvePlan(pkg, planId) {
    const builtin = builtinPlans().find((p) => p.id === planId);
    if (builtin) return builtin;
    if (pkg && this.rules) {
      const file = this.rules.forGame(pkg);
      const { doc } = file ? this.rules.read(file) : { doc: null };
      return gamePlans(doc).plans.find((p) => p.id === planId) ?? null;
    }
    return null;
  }

  async start({ pkg, serial, planId, options = {} }) {
    assertPackage(pkg);
    assertSerial(serial);
    const game = this.games.list().find((g) => g.packageId === pkg);
    if (!game) throw Object.assign(new Error('Add this game to your library first'), { statusCode: 403 });
    const device = this.devices().find((d) => d.serial === serial);
    if (!device || device.state !== 'device') throw Object.assign(new Error('Device is not connected'), { statusCode: 409 });
    if (device.replay) throw Object.assign(new Error('QA runs need a real phone, not the replay device'), { statusCode: 400 });
    if (!this.adb) throw Object.assign(new Error('adb is not available'), { statusCode: 503 });
    const busy = this.activeFor(serial);
    if (busy) throw Object.assign(new Error(`Run ${busy.id} is already using this phone`), { statusCode: 409, runId: busy.id });
    const base = this.resolvePlan(pkg, String(planId ?? ''));
    if (!base) throw Object.assign(new Error('Unknown plan'), { statusCode: 404 });
    const { plan, missing } = applyOptions(base, options);
    if (missing.length) throw Object.assign(new Error(`Plan needs options: ${missing.join(', ')}`), { statusCode: 400, missing });
    const id = `qa-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomBytes(2).toString('hex')}`;
    const run = new QARun({ id, adb: this.adb, serial, pkg, plan, rules: this.rules, deviceName: this.deviceName(serial), dir: this.dir, game, record: this.record,
      bridgePort: this.plans(pkg).bridgePort, connected: (s) => this.devices().some((d) => d.serial === s && d.state === 'device') });
    this.active.set(id, run);
    run.on('update', () => this.emit('update', run.toJSON({ full: false })));
    run.on('done', () => { this.active.delete(id); this.emit('update', run.toJSON({ full: false })); this.prune(); });
    this.watchDevice(run);
    run.start();   // runs in the background; the caller gets the id right away
    return run.toJSON();
  }

  // A phone that disappears ends its run with partial evidence.
  watchDevice(run) {
    const timer = setInterval(() => {
      if (run.endedAt) return clearInterval(timer);
      if (!this.devices().some((d) => d.serial === run.serial && d.state === 'device')) { run.cancel('Phone disconnected'); clearInterval(timer); }
    }, 2000);
    timer.unref?.();
  }

  cancel(id, reason) {
    const run = this.active.get(id);
    if (!run) return false;
    return run.cancel(reason || 'Cancelled by user');
  }

  remove(id) {
    if (!RUN_ID.test(id) || this.active.has(id)) return false;
    const p = join(this.dir, id);
    if (!existsSync(p)) return false;
    rmSync(p, { recursive: true, force: true });
    return true;
  }

  prune() {
    const runs = this.readAll().filter((r) => !this.active.has(r.id));
    for (const r of runs.slice(KEEP_RUNS)) this.remove(r.id);
  }

  async close() {
    for (const run of this.active.values()) run.cancel('PlayLens is shutting down');
    await Promise.all([...this.active.values()].map((r) => new Promise((resolve) => (r.endedAt ? resolve() : r.once('done', resolve)))));
  }
}

export function ensureDir(dir = QA_RUNS_DIR) { mkdirSync(dir, { recursive: true }); return dir; }
