// QA plans: the built-in ones plus any a game's rules file adds under `qa.plans`.
// A plan is a list of steps; each step runs with a deadline and records a check result.
// Unknown step types or expectation shapes are rejected before the run starts.
import { durationMs } from '../rules/match.mjs';

export const STEP_TYPES = new Set(['launch', 'wait', 'expect', 'bridge', 'action', 'closeAd', 'appOpenCycle', 'screenshot', 'tapUi', 'key', 'monkey', 'repeat', 'manual', 'stop', 'network']);
const AD_FORMATS = new Set(['interstitial', 'rewarded', 'app-open', 'banner']);
const ACTION_RE = /^[a-z][\w.-]{0,63}$/i;
const MAX_STEPS = 400;

// Expectation sugar -> { kind: 'log', match } | { kind: 'bridge', event } | { kind: 'foreground', pkg: bool }
export function normalizeExpect(x, path) {
  if (!x || typeof x !== 'object') throw new Error(`${path}: expectation must be an object`);
  // absent: true inverts a log or bridge expectation: it passes when nothing matches before `within` ends.
  const out = { label: x.label ?? null, soft: !!x.soft, absent: !!x.absent, within: x.within != null ? durationMs(x.within) : null };
  if (x.within != null && !(out.within > 0)) throw new Error(`${path}: within must be a duration like 20s`);
  if (out.absent && !(out.within > 0)) throw new Error(`${path}: an absent expectation needs within`);
  if (out.absent && x.foreground != null) throw new Error(`${path}: absent cannot be combined with foreground`);
  if (x.event) {
    if (typeof x.event !== 'string') throw new Error(`${path}: event must be a string`);
    return { ...out, kind: 'log', label: out.label ?? `event ${x.event}`, match: { any: [{ kind: 'fa-event', name: x.event }, { kind: 'send', 'event.name': x.event }] } };
  }
  if (x.status) {
    const s = x.status;
    if (typeof s !== 'object' || (!s.key && !s.state && !s.message)) throw new Error(`${path}: status needs key/state/message`);
    const match = { kind: 'status', ...(s.key ? { key: s.key } : {}), ...(s.state ? { state: s.state } : {}), ...(s.message ? { message: s.message } : {}) };
    return { ...out, kind: 'log', label: out.label ?? `status ${s.key ?? ''} ${s.state ?? ''}`.trim(), match };
  }
  if (x.callback) {
    const c = x.callback;
    if (typeof c !== 'object' || !c.callback) throw new Error(`${path}: callback needs callback (and format)`);
    const match = { kind: 'callback', callback: c.callback, ...(c.format ? { format: c.format } : {}) };
    return { ...out, kind: 'log', label: out.label ?? `${c.format ?? 'ad'} ${c.callback}`, match };
  }
  if (x.match) {
    if (typeof x.match !== 'object') throw new Error(`${path}: match must be an object`);
    return { ...out, kind: 'log', label: out.label ?? 'log line', match: x.match };
  }
  if (x.bridge) {
    if (typeof x.bridge !== 'string') throw new Error(`${path}: bridge must be an event name`);
    return { ...out, kind: 'bridge', label: out.label ?? `game reports ${x.bridge}`, event: x.bridge, data: x.data ?? null };
  }
  if (x.foreground != null) return { ...out, kind: 'foreground', label: out.label ?? (x.foreground ? 'game in foreground' : 'game not in foreground'), game: !!x.foreground };
  throw new Error(`${path}: expectation needs event, status, callback, match, bridge or foreground`);
}

function num(v, path, { min = 0, max = Infinity, fallback } = {}) {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${path}: expected a number between ${min} and ${max}`);
  return n;
}

export function normalizeStep(raw, path, depth = 0) {
  if (!raw || typeof raw !== 'object') throw new Error(`${path}: step must be an object`);
  const type = raw.type ?? Object.keys(raw).find((k) => STEP_TYPES.has(k));
  if (!STEP_TYPES.has(type)) throw new Error(`${path}: unknown step type "${raw.type ?? Object.keys(raw)[0]}"`);
  // Shorthand `- action: { action: level.win }` keeps the outer key's object as the step body.
  const { [type]: inner, ...rest } = raw;
  const o = raw.type ? raw : { ...(inner && typeof inner === 'object' ? inner : {}), ...rest };
  const step = { type, label: o.label ?? null, within: o.within != null ? durationMs(o.within) : null };
  if (o.within != null && !(step.within > 0)) throw new Error(`${path}: within must be a duration like 20s`);
  const expects = (list) => (Array.isArray(list) ? list : list ? [list] : []).map((e, i) => normalizeExpect(e, `${path}.expect[${i}]`));
  switch (type) {
    case 'launch': return { ...step, cold: o.cold !== false, label: step.label ?? (o.cold === false ? 'Bring the game to the front' : 'Cold launch') };
    case 'stop': return { ...step, label: step.label ?? 'Stop the game' };
    case 'wait': return { ...step, seconds: num(o.seconds ?? raw.wait, `${path}.seconds`, { min: 0, max: 600, fallback: 2 }), label: step.label ?? 'Wait' };
    case 'expect': {
      const list = expects(o.expect ?? (o.event || o.status || o.callback || o.match || o.bridge || o.foreground != null ? o : null));
      if (!list.length) throw new Error(`${path}: expect needs at least one expectation`);
      return { ...step, expect: list, soft: !!o.soft, label: step.label ?? list.map((e) => e.label).join(', ') };
    }
    case 'bridge': return { ...step, required: !!o.required, label: step.label ?? 'Connect to the QA bridge' };
    case 'action': {
      if (typeof o.action !== 'string' || !ACTION_RE.test(o.action)) throw new Error(`${path}: action needs a valid action id`);
      if (o.args != null && (typeof o.args !== 'object' || Array.isArray(o.args))) throw new Error(`${path}: args must be an object`);
      return { ...step, action: o.action, args: o.args ?? {}, expect: expects(o.expect), soft: !!o.soft, label: step.label ?? `Action ${o.action}` };
    }
    case 'closeAd': {
      const format = o.format ?? 'interstitial';
      if (!AD_FORMATS.has(format)) throw new Error(`${path}: format must be one of ${[...AD_FORMATS].join(', ')}`);
      // early: close a rewarded ad before the reward callback (the "cancelled by user" path).
      return { ...step, format, early: !!o.early, minSeconds: num(o.minSeconds, `${path}.minSeconds`, { max: 120, fallback: format === 'rewarded' ? (o.early ? 4 : 0) : 6 }), label: step.label ?? (o.early ? `Close the ${format} ad early` : `Close the ${format} ad`) };
    }
    case 'appOpenCycle': return { ...step, backgroundSeconds: num(o.backgroundSeconds, `${path}.backgroundSeconds`, { min: 1, max: 300, fallback: 4 }), expectShow: o.expectShow !== false, label: step.label ?? 'Background and return (App Open)' };
    case 'screenshot': return { ...step, label: step.label ?? 'Screenshot' };
    case 'tapUi': {
      if (typeof o.query !== 'string' || !o.query.trim()) throw new Error(`${path}: tapUi needs query`);
      return { ...step, query: o.query.trim(), expect: expects(o.expect), soft: !!o.soft, label: step.label ?? `Tap "${o.query}"` };
    }
    case 'key': {
      if (!['back', 'home'].includes(o.key)) throw new Error(`${path}: key must be back or home`);
      return { ...step, key: o.key, expect: expects(o.expect), soft: !!o.soft, label: step.label ?? `Press ${o.key}` };
    }
    case 'monkey': return { ...step, seconds: num(o.seconds, `${path}.seconds`, { min: 1, max: 1800, fallback: 60 }), seed: num(o.seed, `${path}.seed`, { fallback: 12345 }), perSecond: num(o.perSecond, `${path}.perSecond`, { min: 0.2, max: 10, fallback: 2 }), label: step.label ?? 'Random taps' };
    case 'manual': {
      const list = expects(o.expect);
      if (!list.length) throw new Error(`${path}: manual needs an expectation that a human will trigger`);
      return { ...step, instructions: String(o.instructions ?? ''), expect: list, label: step.label ?? 'Manual step' };
    }
    case 'network': {
      if (!['on', 'off'].includes(o.state)) throw new Error(`${path}: network state must be on or off`);
      return { ...step, state: o.state, label: step.label ?? (o.state === 'off' ? 'Airplane mode on (no network)' : 'Network back on') };
    }
    case 'repeat': {
      if (depth > 2) throw new Error(`${path}: repeat nests too deep`);
      const times = num(o.times, `${path}.times`, { min: 1, max: 500, fallback: 1 });
      const from = o.from != null ? num(o.from, `${path}.from`, { max: 100000 }) : null;
      const steps = (o.steps ?? []).map((s, i) => normalizeStep(s, `${path}.steps[${i}]`, depth + 1));
      if (!steps.length) throw new Error(`${path}: repeat needs steps`);
      return { ...step, times, from, steps, label: step.label ?? `Repeat ${times}×` };
    }
    default: throw new Error(`${path}: unhandled step ${type}`);
  }
}

// Repeats are unrolled here so the run has a flat list with stable indices. "{i}" in labels,
// args and queries becomes the iteration number (starting at `from`, else 1).
export function flattenSteps(steps, { prefix = '', bindings = {} } = {}) {
  const out = [];
  const sub = (v) => (typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => (k in bindings ? String(bindings[k]) : m)) : v);
  const subDeep = (v) => (Array.isArray(v) ? v.map(subDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subDeep(x)])) : sub(v));
  for (const [i, s] of steps.entries()) {
    const id = `${prefix}${i + 1}`;
    if (s.type === 'repeat') {
      for (let n = 0; n < s.times; n++) {
        const value = (s.from ?? 1) + n;
        out.push(...flattenSteps(s.steps, { prefix: `${id}.${n + 1}.`, bindings: { ...bindings, i: value, n: n + 1 } }));
        if (out.length > MAX_STEPS) throw new Error(`plan has more than ${MAX_STEPS} steps`);
      }
      continue;
    }
    const { args, query, label, expect, ...rest } = s;
    out.push({ ...rest, id, label: sub(label), ...(args ? { args: subDeep(args) } : {}), ...(query ? { query: sub(query) } : {}), ...(expect ? { expect: expect.map((e) => ({ ...e, label: sub(e.label), ...(e.data ? { data: subDeep(e.data) } : {}) })) } : {}) });
  }
  if (out.length > MAX_STEPS) throw new Error(`plan has more than ${MAX_STEPS} steps`);
  return out;
}

export function normalizePlan(id, raw) {
  if (!raw || typeof raw !== 'object') throw new Error(`plan ${id}: must be an object`);
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`plan id "${id}" must be letters, digits, - or _`);
  if (!Array.isArray(raw.steps) || !raw.steps.length) throw new Error(`plan ${id}: steps must be a non-empty list`);
  const steps = raw.steps.map((s, i) => normalizeStep(s, `plan ${id}.steps[${i}]`));
  const flat = flattenSteps(steps);
  return {
    id,
    name: String(raw.name ?? id),
    description: String(raw.description ?? ''),
    needsBridge: !!raw.needsBridge || flat.some((s) => s.type === 'bridge' && s.required),
    coverage: String(raw.coverage ?? (flat.some((s) => s.type === 'action') ? 'bridge' : flat.some((s) => s.type === 'monkey') ? 'random' : 'adb')),
    steps: flat,
    source: raw.source ?? 'game',
  };
}

// ── Built-in plans ───────────────────────────────────────────────────────────
// Expectations use the plugin's documented lines (docs/AVN_PLUGIN_LOG_REFERENCE.md).
const STARTUP = [
  { type: 'expect', label: 'Plugin finished initialising', status: { key: 'SDK.InitCompleted', state: 'Info' }, within: '60s' },
  { type: 'expect', label: 'Ad auto-load started', match: { kind: 'plain', message: '/^Auto-load starting:/' }, within: '20s' },
];

export const BUILTIN_PLANS = {
  'plugin-smoke': {
    name: 'Plugin smoke',
    description: 'Cold launch, SDK startup, App Open cycle, one interstitial and one rewarded ad through the plugin, with screenshots. Ads need the QA bridge; without it those steps are reported as not supported.',
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'wait', seconds: 4 },
      { type: 'bridge', required: false },
      { type: 'screenshot', label: 'After startup' },
      { type: 'appOpenCycle', backgroundSeconds: 4, expectShow: true, within: '45s' },
      { type: 'closeAd', format: 'app-open', within: '60s' },
      { type: 'action', action: 'ad.interstitial.show', label: 'Show an interstitial', within: '45s', expect: [{ callback: { format: 'interstitial', callback: 'Displayed' }, label: 'interstitial displayed' }] },
      { type: 'closeAd', format: 'interstitial', within: '90s' },
      { type: 'expect', label: 'Interstitial closed', callback: { format: 'interstitial', callback: 'Closed' }, within: '20s' },
      { type: 'screenshot', label: 'After interstitial' },
      { type: 'action', action: 'ad.rewarded.show', label: 'Show a rewarded ad', within: '45s', expect: [{ callback: { format: 'rewarded', callback: 'Displayed' }, label: 'rewarded displayed' }] },
      { type: 'closeAd', format: 'rewarded', within: '120s' },
      { type: 'expect', label: 'Reward granted on close', status: { key: 'Ad.Rewarded', message: 'Reward granted on close' }, within: '30s' },
      { type: 'screenshot', label: 'After rewarded' },
    ],
  },
  'adb-smoke': {
    name: 'ADB smoke (no bridge)',
    description: 'Cold launch, SDK startup, random taps for two minutes (pausing when an ad or another app is in front), App Open cycle, screenshots. Finds crashes, ANRs and startup faults; proves nothing about gameplay.',
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'screenshot', label: 'After startup' },
      { type: 'monkey', seconds: 120, seed: 12345, perSecond: 2 },
      { type: 'screenshot', label: 'After random taps' },
      { type: 'appOpenCycle', backgroundSeconds: 4, expectShow: true, within: '45s' },
      { type: 'closeAd', format: 'app-open', within: '60s' },
      { type: 'screenshot', label: 'After App Open' },
    ],
  },
  progression: {
    name: 'Level progression (forced wins)',
    description: 'Needs the QA bridge and a game adapter. Forces a win on each of the first ten levels through the real win path and checks that the game reports the win and the next level starts. Forced wins do not prove the level is beatable.',
    needsBridge: true,
    coverage: 'bridge',
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'action', action: 'level.load', args: { level: 1 }, label: 'Load level 1', within: '30s', expect: [{ bridge: 'level.started', label: 'level 1 started' }] },
      { type: 'repeat', times: 10, from: 1, steps: [
        { type: 'screenshot', label: 'Level {i}' },
        { type: 'action', action: 'level.win', label: 'Force win on level {i}', within: '30s', expect: [{ bridge: 'level.won', label: 'game reported level {i} won' }] },
        { type: 'wait', seconds: 3 },
        { type: 'closeAd', format: 'interstitial', minSeconds: 0, within: '45s', label: 'Close the interstitial if the level gate showed one' },
        { type: 'action', action: 'level.next', label: 'Next level after {i}', within: '30s', expect: [{ bridge: 'level.started', label: 'next level started' }] },
      ] },
      { type: 'screenshot', label: 'After progression' },
    ],
  },
  iap: {
    name: 'In-app purchase (manual confirm)',
    description: 'Needs the QA bridge, a Play licence-tester account and a test product. Starts the purchase through the plugin; you tap the Google purchase sheet. Checks that the plugin confirms the purchase and the game grants the entitlement.',
    needsBridge: true,
    coverage: 'bridge',
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'expect', label: 'Store connected and products ready', status: { key: 'SDK.Purchaser', state: 'Initialized' }, within: '60s' },
      { type: 'action', action: 'iap.products', label: 'List products', within: '15s' },
      { type: 'action', action: 'iap.buy', args: { productId: '{productId}' }, label: 'Start purchase {productId}', within: '20s' },
      { type: 'manual', label: 'Confirm the Google purchase sheet on the phone (test card only)', instructions: 'Approve the purchase on the phone with the licence-tester account. Never confirm with a real card.', within: '180s', expect: [{ status: { key: 'SDK.Purchaser', message: '/^Purchase confirmed/' }, label: 'plugin confirmed the purchase' }] },
      { type: 'expect', label: 'Game granted the entitlement', bridge: 'entitlement.granted', within: '20s', soft: true },
      { type: 'expect', label: 'in_app_purchase event logged', event: 'in_app_purchase', within: '20s' },
      { type: 'screenshot', label: 'After purchase' },
    ],
  },
  'inter-level-gate': {
    name: 'Interstitial level gate',
    description: 'Needs the bridge. Wins a level below EnableInterFromLevel and expects no interstitial, then wins a level at or above it and expects one. Options: beforeGate, atGate (level numbers).',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'expect', label: 'Interstitial loaded', callback: { format: 'interstitial', callback: 'Loaded' }, within: '45s', soft: true },
      { type: 'action', action: 'level.load', args: { level: '{beforeGate}' }, label: 'Load level {beforeGate} (below the gate)', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'Win level {beforeGate}', within: '30s', expect: [{ bridge: 'level.won' }, { callback: { format: 'interstitial', callback: 'Displayed' }, absent: true, within: '12s', label: 'no interstitial below the gate' }] },
      { type: 'screenshot', label: 'After win below gate' },
      { type: 'action', action: 'level.load', args: { level: '{atGate}' }, label: 'Load level {atGate} (at the gate)', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'Win level {atGate}', within: '45s', expect: [{ bridge: 'level.won' }, { callback: { format: 'interstitial', callback: 'Displayed' }, within: '30s', label: 'interstitial displayed at the gate' }] },
      { type: 'closeAd', format: 'interstitial', within: '90s' },
      { type: 'screenshot', label: 'After win at gate' },
    ],
  },
  'inter-cooldown': {
    name: 'Interstitial cooldown',
    description: 'Needs the bridge. Two wins back to back above the gate: the first shows an interstitial, the second must not, and the plugin must say why (cooldown or delay). Option: level (a level above the gate).',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'action', action: 'level.load', args: { level: '{level}' }, label: 'Load level {level}', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'First win shows an interstitial', within: '45s', expect: [{ callback: { format: 'interstitial', callback: 'Displayed' }, within: '30s' }] },
      { type: 'closeAd', format: 'interstitial', within: '90s' },
      { type: 'action', action: 'level.next', label: 'Next level', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'Second win inside the cooldown', within: '30s', expect: [{ callback: { format: 'interstitial', callback: 'Displayed' }, absent: true, within: '10s', label: 'no interstitial inside the cooldown' }, { status: { key: 'Ad.Interstitial', message: '/Cooldown active|Delay before first interstitial|TryShow blocked/' }, within: '10s', soft: true, label: 'plugin explains the block' }] },
      { type: 'screenshot', label: 'After second win' },
    ],
  },
  'retry-flow': {
    name: 'Lose and retry',
    description: 'Needs the bridge. Loses a level through the real lose path, restarts it, and checks the same level starts again. Option: level.',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'action', action: 'level.load', args: { level: '{level}' }, label: 'Load level {level}', within: '30s', expect: [{ bridge: 'level.started', data: { level: '{level}' } }] },
      { type: 'action', action: 'level.lose', label: 'Lose level {level}', within: '30s', expect: [{ bridge: 'level.lost' }] },
      { type: 'screenshot', label: 'Lose screen' },
      { type: 'closeAd', format: 'interstitial', minSeconds: 0, within: '45s', label: 'Close an interstitial if the lose gate showed one' },
      { type: 'action', action: 'level.restart', label: 'Retry', within: '30s', expect: [{ bridge: 'level.started', data: { level: '{level}' }, label: 'level {level} started again' }] },
      { type: 'screenshot', label: 'After retry' },
    ],
  },
  'rewarded-continue': {
    name: 'Rewarded continue after a loss',
    description: 'Needs the bridge and the reward hook. Loses a level, shows the rewarded ad for the continue placement, and checks the plugin grants the reward and the game applies it. Option: level.',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'expect', label: 'Rewarded loaded', callback: { format: 'rewarded', callback: 'Loaded' }, within: '60s' },
      { type: 'action', action: 'level.load', args: { level: '{level}' }, label: 'Load level {level}', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.lose', label: 'Lose level {level}', within: '30s', expect: [{ bridge: 'level.lost' }] },
      { type: 'action', action: 'ad.rewarded.show', args: { placement: 'continue' }, label: 'Show the continue rewarded ad', within: '45s', expect: [{ callback: { format: 'rewarded', callback: 'Displayed' } }] },
      { type: 'closeAd', format: 'rewarded', within: '120s' },
      { type: 'expect', label: 'Plugin granted the reward on close', status: { key: 'Ad.Rewarded', message: 'Reward granted on close' }, within: '30s' },
      { type: 'expect', label: 'Game applied the reward', bridge: 'reward.granted', within: '15s', soft: true },
      { type: 'screenshot', label: 'After continue' },
    ],
  },
  'rewarded-cancel': {
    name: 'Rewarded closed early (no reward)',
    description: 'Needs the bridge. Shows a rewarded ad and closes it before it finishes: the plugin must report "cancelled by user" and the game must not grant anything.',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'expect', label: 'Rewarded loaded', callback: { format: 'rewarded', callback: 'Loaded' }, within: '60s' },
      { type: 'action', action: 'ad.rewarded.show', label: 'Show a rewarded ad', within: '45s', expect: [{ callback: { format: 'rewarded', callback: 'Displayed' } }] },
      { type: 'closeAd', format: 'rewarded', early: true, within: '60s' },
      { type: 'expect', label: 'Plugin reports the reward as cancelled', status: { key: 'Ad.Rewarded', message: 'Reward cancelled by user' }, within: '20s' },
      { type: 'expect', label: 'Game granted nothing', bridge: 'reward.granted', absent: true, within: '8s' },
      { type: 'screenshot', label: 'After early close' },
    ],
  },
  'no-fill-recovery': {
    name: 'No network: no-fill and recovery',
    description: 'Turns airplane mode on, asks for an interstitial (must fail cleanly, no crash), turns the network back on and checks the plugin reloads and can show. Needs the bridge for the show calls; without it only the load-failure path is observed.',
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: false },
      { type: 'network', state: 'off' },
      { type: 'wait', seconds: 3 },
      { type: 'launch', cold: true, label: 'Cold launch without network' },
      { type: 'expect', label: 'Plugin finished initialising offline', status: { key: 'SDK.InitCompleted', state: 'Info' }, within: '60s', soft: true },
      { type: 'expect', label: 'Ad load fails cleanly', match: { any: [{ kind: 'callback', callback: 'LoadFailed' }, { kind: 'counter', name: 'LoadCallsFailed' }] }, within: '60s' },
      { type: 'bridge', required: false },
      { type: 'action', action: 'ad.interstitial.show', label: 'Ask for an interstitial offline', within: '20s', expect: [{ match: { any: [{ kind: 'counter', name: 'ShowCallsFailed' }, { kind: 'status', key: '/^Ad\\.Interstitial/', state: 'Failed' }] }, label: 'show refused with a reason', within: '15s' }] },
      { type: 'screenshot', label: 'Offline' },
      { type: 'network', state: 'on' },
      { type: 'expect', label: 'Interstitial loads once the network is back', callback: { format: 'interstitial', callback: 'Loaded' }, within: '120s' },
      { type: 'action', action: 'ad.interstitial.show', label: 'Show after recovery', within: '45s', expect: [{ callback: { format: 'interstitial', callback: 'Displayed' } }] },
      { type: 'closeAd', format: 'interstitial', within: '90s' },
    ],
  },
  'remove-ads': {
    name: 'Remove Ads purchase disables interstitials',
    description: 'Needs the bridge, a licence-tester account and the Remove Ads product. Buys it (you confirm the sheet), then wins a level above the gate and expects no interstitial. Options: productId, level.',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'expect', label: 'Store connected and products ready', status: { key: 'SDK.Purchaser', state: 'Initialized' }, within: '60s' },
      { type: 'action', action: 'iap.buy', args: { productId: '{productId}' }, label: 'Start purchase {productId}', within: '20s' },
      { type: 'manual', label: 'Confirm the Google purchase sheet on the phone (test card only)', instructions: 'Approve the purchase with the licence-tester account. Never confirm with a real card.', within: '180s', expect: [{ status: { key: 'SDK.Purchaser', message: '/^Purchase confirmed/' }, label: 'plugin confirmed the purchase' }] },
      { type: 'expect', label: 'Plugin disabled interstitials', match: { kind: 'plain', message: '/EnableInterAd set to: False/' }, within: '20s' },
      { type: 'expect', label: 'Game applied the entitlement', bridge: 'entitlement.granted', within: '15s', soft: true },
      { type: 'action', action: 'level.load', args: { level: '{level}' }, label: 'Load level {level}', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'Win level {level} with ads removed', within: '30s', expect: [{ bridge: 'level.won' }, { callback: { format: 'interstitial', callback: 'Displayed' }, absent: true, within: '12s', label: 'no interstitial after Remove Ads' }] },
      { type: 'screenshot', label: 'After win with ads removed' },
    ],
  },
  'kill-restore': {
    name: 'Progress survives a kill',
    description: 'Needs the bridge. Wins a level, force-stops the game, relaunches and checks the game reports a level at or beyond the one won. Option: level.',
    needsBridge: true,
    steps: [
      { type: 'launch', cold: true },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'action', action: 'level.load', args: { level: '{level}' }, label: 'Load level {level}', within: '30s', expect: [{ bridge: 'level.started' }] },
      { type: 'action', action: 'level.win', label: 'Win level {level}', within: '30s', expect: [{ bridge: 'level.won' }] },
      { type: 'wait', seconds: 3 },
      { type: 'closeAd', format: 'interstitial', minSeconds: 0, within: '45s', label: 'Close an interstitial if one showed' },
      { type: 'stop' },
      { type: 'launch', cold: false, label: 'Relaunch after kill' },
      ...STARTUP,
      { type: 'bridge', required: true },
      { type: 'screenshot', label: 'After relaunch' },
      { type: 'action', action: 'level.next', label: 'Continue from saved progress', within: '30s', soft: true, expect: [{ bridge: 'level.started', label: 'a level started after relaunch' }] },
    ],
  },
};

export function builtinPlans() {
  return Object.entries(BUILTIN_PLANS).map(([id, p]) => normalizePlan(id, { ...p, source: 'builtin' }));
}

// Plans from a game's rules file (`qa.plans`), validated; errors are returned, not thrown,
// so a broken plan doesn't hide the built-in ones.
export function gamePlans(doc) {
  const out = [];
  const errors = [];
  const plans = doc?.qa?.plans;
  if (!plans || typeof plans !== 'object') return { plans: out, errors };
  for (const [id, raw] of Object.entries(plans)) {
    try { out.push(normalizePlan(id, { ...raw, source: 'game' })); }
    catch (err) { errors.push(err.message); }
  }
  return { plans: out, errors };
}

// Plan options from the request ({productId: 'remove_ads'}) fill "{productId}" placeholders.
export function applyOptions(plan, options = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(options ?? {})) if (/^\w{1,32}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) safe[k] = v;
  const fill = (v) => (typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => (k in safe ? String(safe[k]) : m)) : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, fill(b)])) : v);
  const steps = plan.steps.map(fill);
  const missing = new Set();
  for (const s of steps) for (const v of [s.label, JSON.stringify(s.args ?? {}), s.query ?? '']) for (const m of String(v ?? '').matchAll(/\{(\w+)\}/g)) missing.add(m[1]);
  return { plan: { ...plan, steps, options: safe }, missing: [...missing] };
}
