// Ties the live models to one log stream: plugin health, watch-rule flags, Firebase
// events with the plugin cross-check, crashes, and an optional checklist run.
import { EventEmitter } from 'node:events';
import { Health, Flags } from './health.mjs';
import { FirebaseEvents } from './firebase.mjs';
import { ChecklistRun } from './checklist.mjs';
import { buildReport } from './report.mjs';
import { adRules, privacy, sdkList } from './checks.mjs';
import { PerfModel } from '../perf/sampler.mjs';
import { buildMatch, BuildVerification } from './build-report.mjs';

const CRASH_KINDS = new Set(['java-crash', 'native-crash', 'anr', 'exception']);
const ALERT_EVERY_MS = 30000;

export class Monitor extends EventEmitter {
  constructor({ rules, pkg, deviceName }) {
    super();
    this.rules = rules;
    this.pkg = pkg;
    this.deviceName = deviceName;
    this.firebaseDebug = null;
    this.crashes = [];
    this.run = null;
    this.lastReport = null;
    this.alerted = {};
    this.health = null;
    this.flags = new Flags();
    this.firebase = new FirebaseEvents();
    this.perf = new PerfModel();
    this.app = null;        // installed app profile (version, target API, permissions)
    this.buildReport = null;
    this.apkSdks = null;    // SDKs found inside the APK
    this.hiddenApi = 0;
    this.loadRules();
    this.dirty = true;
  }

  loadRules() {
    const pack = this.rules.pack();
    this.profileFile = this.pkg ? this.rules.forGame(this.pkg) : null;
    const { doc, error } = this.profileFile ? this.rules.read(this.profileFile) : { doc: null, error: null };
    this.profile = doc;
    this.profileError = error;
    const options = { ...(doc?.options ?? {}), ...(doc?.level ? { level: doc.level } : {}) };
    if (!this.health) this.health = new Health(pack, options);
    else this.health.options = { ...this.health.options, ...options };
    this.health.pkg = this.pkg;
    this.flags.setRules([...(pack?.watch ?? []), ...(doc?.watch ?? []).map((w) => ({ ...w, id: `game:${w.id}` }))]);
    if (this.run && this.run.profileFile) {
      const r = this.rules.read(this.run.profileFile);
      if (r.doc) this.run.load(r.doc);
    }
    this.dirty = true;
  }

  ingest(e) {
    this.health.ingest(e);
    // ART garbage collection: "... GC freed 2603KB ... paused 1.269ms,340us total 182.705ms"
    if (/GC freed/.test(e.message)) {
      const p = /paused ([^ ]+) total/.exec(e.message)?.[1];
      if (p) this.perf.addGc(p.split(',').reduce((ms, v) => ms + (parseFloat(v) || 0) * (/us$/.test(v) ? 0.001 : /ms$/.test(v) ? 1 : 1000), 0));
    }
    if (/^hiddenapi: Accessing hidden/.test(e.message)) this.hiddenApi++;
    for (const hit of this.flags.ingest(e)) {
      if (hit.severity === 'info') continue;
      const last = this.alerted[hit.id] ?? 0;
      if (e.ts - last > ALERT_EVERY_MS) {
        this.alerted[hit.id] = e.ts;
        this.emit('alert', { title: hit.name, message: hit.message, severity: hit.severity, entryId: e.id });
      }
    }
    const ev = this.firebase.ingest(e);
    if (CRASH_KINDS.has(e.kind)) {
      this.crashes.push({ ts: e.ts, kind: e.kind, message: e.message, entryId: e.id });
      if (this.crashes.length > 200) this.crashes.shift();
    }
    if (this.run && !this.run.finishedAt && e.ts >= this.run.startedAt) {
      this.run.health.ingest(e);
      this.run.verification.ingest(e);
      if (ev) this.run.ingestEvent(ev);
      this.run.ingestEntry(e);
    }
    this.dirty = true;
  }

  startRun(file) {
    const match = buildMatch(this.buildReport, this.pkg, this.app);
    if (!match.ok) throw new Error(match.reason);
    const f = file ?? this.profileFile;
    const { doc, error } = f ? this.rules.read(f) : { doc: null, error: 'no rules file' };
    if (!doc) throw new Error(error || 'Rules file not found');
    this.run = new ChecklistRun({ profile: doc, profileFile: f, pack: this.rules.pack() });
    this.run.verification = new BuildVerification(this.buildReport, this.app);
    this.run.health = new Health(this.rules.pack(), this.health.options);
    this.run.health.pkg = this.pkg;
    this.lastReport = null;
    this.dirty = true;
    return this.run;
  }

  finishRun() {
    if (!this.run) throw new Error('No run in progress');
    this.run.finishedAt = Date.now();
    const health = this.run.health.snapshot();
    const items = this.run.evaluate(health);
    const id = `run-${new Date(this.run.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    const crashes = this.crashes.filter((c) => c.ts >= this.run.startedAt);
    this.lastReport = buildReport({ id, run: this.run, items, flags: this.flags.list(), crashes, health, device: this.deviceName, pkg: this.pkg, build: this.run.verification.snapshot() });
    this.dirty = true;
    return this.lastReport;
  }

  summary() {
    const p = this.perf.summary();
    return {
      perf: p.frames || p.mem ? { fps: p.fps?.avg ?? null, lowFps: p.lowFps, memPeak: p.mem?.max ?? null, cpu: p.cpu?.avg ?? null, tempMax: p.temp?.max ?? null } : null,
      crashes: this.crashes.filter((c) => c.kind !== 'exception').length,
      exceptions: this.crashes.filter((c) => c.kind === 'exception').length,
      events: this.firebase.fa.length,
      flags: this.flags.list().filter((f) => f.severity !== 'info').length,
      checklist: this.lastReport ? `${this.lastReport.passed}/${this.lastReport.total}` : null,
    };
  }

  snapshot(now = Date.now()) {
    this.dirty = false;
    const health = this.health.snapshot(now);
    return {
      pkg: this.pkg,
      rules: { file: this.profileFile, error: this.profileError, name: this.profile?.name ?? null },
      health,
      adRules: adRules(this.health, now),
      privacy: privacy(this.health, this.app, { hiddenApi: this.hiddenApi, now }),
      sdkList: sdkList(this.health, this.apkSdks),
      app: this.app,
      buildReport: this.buildReport,
      buildMatch: buildMatch(this.buildReport, this.pkg, this.app),
      flags: this.flags.list(),
      firebase: this.firebase.snapshot(now, this.firebaseDebug),
      crashes: this.crashes.slice(-50),
      run: this.run ? {
        active: !this.run.finishedAt,
        startedAt: this.run.startedAt,
        finishedAt: this.run.finishedAt,
        file: this.run.profileFile,
        name: this.run.profileName,
        items: this.run.evaluate(this.run.health.snapshot(this.run.finishedAt || now)),
        build: this.run.verification.snapshot(),
        rc: this.run.health.snapshot(this.run.finishedAt || now).rc,
      } : null,
      report: this.lastReport,
    };
  }
}
