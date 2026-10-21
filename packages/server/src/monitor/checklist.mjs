// Checklist runs: a rules file's expected events (and chosen pack presets) checked live
// against what happens after "Start run". Firebase events are checked against Firebase's
// own debug lines; ByteBrew against the plugin's send lines (names only, no values).
import { matches } from '../rules/match.mjs';

function checkParams(params, rules = {}, strict = false) {
  const problems = [];
  for (const [key, rule] of Object.entries(rules ?? {})) {
    const r = rule ?? {};
    const has = Object.prototype.hasOwnProperty.call(params, key);
    if (!has) {
      if (r.required) problems.push(`${key} is missing`);
      continue;
    }
    const v = String(params[key]);
    if (r.type === 'number' && !Number.isFinite(Number(v))) problems.push(`${key} should be a number, got "${v}"`);
    if (r.oneOf && !r.oneOf.map(String).includes(v)) problems.push(`${key} is "${v}", expected one of ${r.oneOf.join(', ')}`);
    if (Array.isArray(r.range) && (Number(v) < r.range[0] || Number(v) > r.range[1])) problems.push(`${key} is ${v}, expected ${r.range[0]} to ${r.range[1]}`);
    if (r.regex && !new RegExp(r.regex).test(v)) problems.push(`${key} "${v}" doesn't match ${r.regex}`);
  }
  if (strict) {
    for (const key of Object.keys(params)) {
      if (!(key in (rules ?? {})) && !/^(ga_|firebase_|_)/.test(key)) problems.push(`unexpected parameter ${key}`);
    }
  }
  return problems;
}

// Presets from the AVN plugin pack, turned into checklist items.
function presetItems(id, pack) {
  const p = pack?.presets?.find((x) => x.id === id);
  if (!p) return [];
  const items = [];
  const label = p.name ?? id;
  if (p.uses?.includes('sequence.startup')) items.push({ id: `${id}:startup`, name: 'Healthy launch: every startup step completes', type: 'startup', group: label });
  if (p.uses?.includes('events.consistency.first-event-verified')) items.push({ id: `${id}:verified`, name: 'First Firebase event confirmed after init', type: 'line', match: { kind: 'status', key: 'SDK.Firebase.EventVerified', state: 'Sent' }, group: label });
  const flow = p.uses?.find((u) => u.startsWith('flows.'))?.slice(6);
  if (flow) items.push({ id: `${id}:flow`, name: `${label}: shown and paid`, type: 'flow', flow, outcome: p.expectOutcome, group: label });
  for (const ev of p.expectEvents ?? []) items.push({ id: `${id}:${ev}`, name: `${ev} is logged by Firebase`, type: 'event', event: ev, sdk: 'firebase', group: label });
  for (const [i, m] of (p.expect ?? []).entries()) items.push({ id: `${id}:${i}`, name: describe(m), type: 'line', match: m, group: label });
  return items;
}

function describe(m) {
  if (m.key && m['fetch.lastFetchStatus']) return 'Remote config fetched from the server';
  if (m.kind === 'rc-sources') return 'AdConfig and AdIdsConfig came from the server';
  if (m.kind === 'ad-config') return 'AdConfig was applied';
  if (m['event.name']) return `${m['event.name']} is sent`;
  if (m.message) return String(m.message).replace(/^\/\^?|\/[a-z]*$/g, '').replace(/:$/, '');
  return JSON.stringify(m);
}

export class ChecklistRun {
  constructor({ profile, profileFile, pack, startedAt = Date.now() }) {
    this.profileFile = profileFile;
    this.pack = pack;
    this.startedAt = startedAt;
    this.finishedAt = null;
    this.load(profile);
  }

  load(profile) {
    const prev = new Map((this.items ?? []).map((i) => [i.id, i]));
    const items = [];
    for (const id of profile?.presets ?? []) items.push(...presetItems(id, this.pack));
    for (const x of profile?.expect ?? []) {
      if (!x?.event && !x?.match) continue;
      items.push({ id: x.id ?? x.event, name: x.name ?? `${x.event} is sent`, type: x.match ? 'line' : 'event', event: x.event, sdk: x.sdk ?? 'firebase', params: x.params, count: x.count, after: x.after, strict: !!x.strictParams, match: x.match, group: 'Your events' });
    }
    // Keep progress for items that survive a rules-file edit.
    this.items = items.map((i) => {
      const old = prev.get(i.id);
      return { ...i, seen: old?.seen ?? 0, valid: old?.valid ?? 0, firstTs: old?.firstTs ?? null, lastTs: old?.lastTs ?? null, problems: old?.problems ?? [] };
    });
    this.profileName = profile?.name ?? this.profileFile;
  }

  ingestEvent({ sdk, name, params, ts }) {
    for (const item of this.items) {
      if (item.type !== 'event' || item.event !== name || (item.sdk ?? 'firebase') !== sdk) continue;
      const problems = sdk === 'firebase' ? checkParams(params ?? {}, item.params, item.strict) : [];
      if (item.after) {
        const before = this.items.find((x) => x.id === item.after);
        if (!before?.firstTs || before.firstTs > ts) problems.push(`came before ${before?.event ?? item.after}`);
      }
      item.seen++;
      item.lastTs = ts;
      item.firstTs ??= ts;
      if (problems.length) item.problems = [...new Set([...item.problems, ...problems])].slice(-6);
      else item.valid++;
    }
  }

  ingestEntry(e) {
    for (const item of this.items) {
      if (item.type === 'line' && !item.firstTs && matches(e, item.match)) {
        item.seen = 1;
        item.valid = 1;
        item.firstTs = e.ts;
        item.lastTs = e.ts;
      }
    }
  }

  evaluate(health) {
    return this.items.map((i) => {
      let status = 'pending';
      let note = null;
      if ((i.type === 'startup' || i.type === 'flow') && i.latched) {
        status = i.latched.status;
        note = i.latched.note;
      } else if (i.type === 'startup') {
        const steps = health?.startup ?? [];
        const bad = steps.find((s) => s.status === 'failed' || s.status === 'timeout');
        if (bad) { status = 'problem'; note = `${bad.id}: ${bad.failed ?? bad.status}`; }
        else if (steps.length && steps.every((s) => s.status === 'done')) status = 'ok';
      } else if (i.type === 'flow') {
        const fs = (health?.funnels ?? []).filter((f) => f.format === i.flow);
        const shown = fs.reduce((n, f) => n + Math.max(f.shown, i.flow === 'banner' || i.flow === 'app-open' ? f.displayed : 0), 0);
        const paid = fs.reduce((n, f) => n + f.paid, 0);
        const outcome = fs.find((f) => f.outcome)?.outcome;
        if (i.outcome && outcome && outcome !== i.outcome) { status = 'problem'; note = `reward was ${outcome}`; }
        else if (shown && paid && (!i.outcome || outcome === i.outcome)) status = 'ok';
        else note = shown ? 'shown, waiting for the revenue callback' : 'waiting for an ad to show';
      } else {
        const min = i.count?.min ?? 1;
        const max = i.count?.max ?? Infinity;
        if (i.problems.length) { status = 'problem'; note = i.problems.join('; '); }
        else if (i.valid > max) { status = 'problem'; note = `sent ${i.valid} times, expected at most ${max}`; }
        else if (i.valid >= min) status = 'ok';
        if (status === 'ok') note = i.seen > 1 ? `seen ${i.seen} times` : 'seen once';
        if (i.sdk === 'bytebrew' && status === 'ok') note += ' (ByteBrew: name only, values not visible)';
      }
      // Launch and ad-flow checks are worked out from live state that resets on a relaunch;
      // once they pass (or fail) during a run, keep that result.
      if ((i.type === 'startup' || i.type === 'flow') && !i.latched && status !== 'pending') {
        i.latched = { status, note };
        i.firstTs = Date.now();
      }
      return { id: i.id, name: i.name, group: i.group, type: i.type, event: i.event ?? null, sdk: i.sdk ?? null, status, note, firstTs: i.firstTs, seen: i.seen };
    });
  }
}

export { checkParams };
