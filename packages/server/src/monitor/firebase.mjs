// Firebase events: Firebase's own debug lines (FA / FA-SVC) are the source of truth.
// The AVN plugin's lines are a second opinion: every event the plugin says it handed to
// Firebase should show up in Firebase's log within a few seconds ("sent but not recorded").
// ByteBrew has no device log of its own, so its rows come from the plugin only.
import { crossCheck } from '../avn/crosscheck.mjs';
import { checkLimits } from '../avn/fa.mjs';

const MAX_EVENTS = 2000;

export class FirebaseEvents {
  constructor({ windowMs = 5000 } = {}) {
    this.windowMs = windowMs;
    this.reset();
  }

  reset() {
    this.fa = [];
    this.plugin = [];
    this.pluginProblems = [];
    this.byteBrew = [];
    this.nextId = 1;
  }

  ingest(e) {
    if (e.fa) {
      const f = e.fa;
      // FA and FA-SVC can both log the same event; keep one (the one with more detail).
      const dup = this.fa.findLast((x) => x.name === f.name && Math.abs(x.ts - e.ts) < 1500 && x.tag !== e.tag);
      if (dup) {
        if (Object.keys(f.params).length > Object.keys(dup.params).length) dup.params = f.params;
        return null;
      }
      const row = { id: this.nextId++, ts: e.ts, tag: e.tag, name: f.name, params: f.params, auto: f.auto, origin: f.origin, problems: checkLimits(f), entryId: e.id };
      this.fa.push(row);
      if (this.fa.length > MAX_EVENTS) this.fa.shift();
      return { sdk: 'firebase', ...row };
    }
    if (e.source !== 'avn') return null;
    const a = e.avn;
    if (a.kind === 'send' && a.sdk === 'bytebrew') {
      const row = { id: this.nextId++, ts: e.ts, name: a.event.name, paramCount: a.event.paramCount, entryId: e.id };
      this.byteBrew.push(row);
      return { sdk: 'bytebrew', ...row };
    }
    // The plugin's own probe event after Firebase init (debug builds only).
    const probe = a.kind === 'status' && a.key === 'SDK.Firebase.EventVerified' ? /QA probe event (\S+) handed/.exec(a.message) : null;
    if (probe) {
      this.plugin.push({ ts: e.ts, name: probe[1], params: {}, entryId: e.id });
      return null;
    }
    const ev = a.kind === 'status' && a.key === 'Analytics.Event' ? a.event : null;
    if (!ev) return null;
    if (ev.stage === 'handed' || ev.stage === 'sent') {
      this.plugin.push({ ts: e.ts, name: ev.name, params: ev.params ?? {}, entryId: e.id });
      if (this.plugin.length > MAX_EVENTS) this.plugin.shift();
    } else if (ev.stage === 'dropped' || ev.stage === 'before-init' || ev.stage === 'failed') {
      this.pluginProblems.push({ ts: e.ts, name: ev.name, stage: ev.stage, entryId: e.id });
    }
    return null;
  }

  snapshot(now = Date.now(), debug = null) {
    const appFa = this.fa.filter((f) => !f.auto);
    const r = crossCheck(this.plugin, appFa, { windowMs: this.windowMs, now });
    const matchedIds = new Set(r.matched.map((m) => m.fa.id));
    const pendingNames = new Set(r.pending.map((p) => p.name));
    const rows = this.fa.map((f) => ({
      ...f,
      sdk: 'FA',
      check: f.auto ? 'automatic' : matchedIds.has(f.id) ? 'matches-plugin' : 'game-code',
    }));
    for (const p of r.notLogged) rows.push({ id: `missing-${p.entryId}`, ts: p.ts, sdk: 'FA', name: p.name, params: p.params, check: 'not-in-firebase', missing: true, entryId: p.entryId });
    for (const p of this.pluginProblems) rows.push({ id: `problem-${p.entryId}`, ts: p.ts, sdk: 'FA', name: p.name, params: {}, check: p.stage === 'dropped' ? 'dropped-by-plugin' : 'sent-before-init', missing: true, entryId: p.entryId });
    for (const b of this.byteBrew) rows.push({ ...b, sdk: 'BB', params: {}, check: 'plugin-only' });
    rows.sort((x, y) => y.ts - x.ts);
    return {
      debug,
      receiving: this.fa.length > 0,
      counts: {
        firebase: this.fa.length,
        app: appFa.length,
        byteBrew: this.byteBrew.length,
        notLogged: r.notLogged.length,
        pending: pendingNames.size,
        problems: rows.filter((x) => x.problems?.length).length,
      },
      rows: rows.slice(0, 500),
    };
  }
}
