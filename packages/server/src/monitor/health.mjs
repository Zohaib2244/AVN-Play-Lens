// Plugin health: a live model of the AVN plugin built from its log lines
// (AVN_PLUGIN_LOG_REFERENCE.md): hub states, counters, the startup sequence, MAX
// adapters, ad funnels, remote config, revenue and the pack's watch rules.
import { matches, durationMs, template, valueTest } from '../rules/match.mjs';
import { sdkFromTag } from '../logcat/owner.mjs';
import { ingestRemoteValue, remoteVariables } from './remote-config.mjs';

const AD_FORMATS = [
  { id: 'interstitial', pattern: /^Ad\.Interstitial\.(\d+)$/, label: (m) => `Interstitial · slot ${m[1]}` },
  { id: 'rewarded', pattern: /^Ad\.Rewarded$/, label: () => 'Rewarded' },
  { id: 'app-open', pattern: /^Ad\.AppOpen$/, label: () => 'App open' },
  { id: 'banner', pattern: /^Ad\.Banner\.Standard$/, label: () => 'Banner' },
  { id: 'mrec', pattern: /^Ad\.Banner\.Mrec$/, label: () => 'MREC' },
];

const SDK_KEYS = ['SDK.Firebase', 'SDK.AdsProvider', 'SDK.AdMob', 'SDK.RemoteConfig', 'SDK.Purchaser', 'SDK.ByteBrew'];

export class Health {
  constructor(pack, options = {}) {
    this.pack = pack;
    this.options = { byteBrew: false, ...(pack?.options ?? {}), ...options };
    this.reset();
  }

  reset() {
    this.hub = {};
    this.counters = {};
    this.counterOffsets = {};
    this.adapters = {};
    this.adapterSummary = null;
    this.maxConfig = null;
    this.funnels = {};
    this.unitSlots = {};
    this.rc = { fetch: null, sources: null, adConfig: null, adIds: null, customKeys: [] };
    this.revenue = { total: 0, byFormat: {}, byNetwork: {} };
    this.flags = {};
    this.appStart = null;
    this.firstAvnTs = null;
    this.firstUnityTs = null;
    this.infoLines = 0;
    this.steps = (this.pack?.sequence?.[0]?.steps ?? []).map((s) => ({ ...s, ts: null, failed: null }));
    this.sdkStart = {};
    this.readyAt = {};
    this.debuggable = null;
    this.processSeen = false;
    this.launch = { displayed: null, fullyDrawn: null, firstAdLoaded: null };
    this.rcValues = {};
    this.interShows = [];
    this.levels = [];
    this.levelSource = null;
    this.blocked = { cooldown: 0, firstDelay: 0, level: 0 };
    this.consent = { notInCmp: false, cmpDisabled: false, gatherAt: null, status: null, doneAt: null, granted: null, failed: null, firebase: null, firstAdRequest: null, att: null };
    this.sdkLogs = {};
  }

  funnel(key) {
    for (const f of AD_FORMATS) {
      const m = f.pattern.exec(key);
      if (m) {
        this.funnels[key] ??= { key, format: f.id, name: f.label(m), loadSent: 0, loaded: 0, loadFailed: 0, showSent: 0, displayed: 0, shown: 0, closed: 0, paid: 0, revenue: 0, state: null, lastNetwork: null };
        return this.funnels[key];
      }
    }
    return null;
  }

  ingest(e) {
    if (e.tag === 'ActivityManager' && /Start proc/.test(e.message) && (!this.pkg || /Start proc \d+:([^/]+)\//.exec(e.message)?.[1] === this.pkg)) {
      this.reset();
      this.appStart = e.ts;
      this.processSeen = true;
      return;
    }
    if (e.tag === 'ActivityTaskManager' || e.tag === 'ActivityManager') this.ingestLaunch(e);
    if (e.tag === 'Unity' && this.firstUnityTs == null) this.firstUnityTs = e.ts;
    this.ingestSdkLog(e);
    this.ingestLevel(e);
    if (e.source !== 'avn') return;
    const a = e.avn;
    if (this.firstAvnTs == null) this.firstAvnTs = e.ts;
    if (this.appStart == null) this.appStart = e.ts;
    if (e.level === 'I' || e.level === 'D' || e.level === 'V') this.infoLines++;

    if (a.kind === 'status') {
      const prev = this.hub[a.key];
      this.hub[a.key] = { state: a.state, message: a.message, ts: e.ts, history: [...(prev?.history ?? []).slice(-9), { state: a.state, message: a.message, ts: e.ts }] };
      if (SDK_KEYS.includes(a.key) && a.state === 'Initializing' && !this.sdkStart[a.key]) this.sdkStart[a.key] = e.ts;
      if ((a.state === 'Initialized' || a.state === 'Info') && !this.readyAt[a.key]) this.readyAt[a.key] = e.ts;
      if (a.key === 'RemoteConfig.Values') this.ingestRcValue(a.message, e);
      if (/^Ad\./.test(a.key) && a.state === 'Loading' && this.consent.firstAdRequest == null) this.consent.firstAdRequest = e.ts;
      if (/Cooldown active|cooldown active/.test(a.message)) this.blocked.cooldown++;
      if (/Delay before first interstitial active/.test(a.message)) this.blocked.firstDelay++;
      if (/TryShow blocked: .*level/i.test(a.message)) this.blocked.level++;
      if (/Firebase post-init:/.test(a.message)) this.ingestConsent(a.message, e);
      const f = this.funnel(a.key);
      if (f && a.state !== 'Info') { f.state = a.state; f.stateTs = e.ts; }
      if (a.key === 'SDK.RemoteConfig' && a.fetch) this.rc.fetch = { ...a.fetch, ts: e.ts };
      if (a.key === 'RemoteConfig.Values') {
        const custom = /Dispatched custom key=(\S+) source=(\w+)/.exec(a.message);
        if (custom) this.rc.customKeys = [...this.rc.customKeys.filter((k) => k.key !== custom[1]), { key: custom[1], source: custom[2] }];
      }
      if (/Reward granted on close|Reward cancelled by user/.test(a.message)) {
        const r = this.funnel('Ad.Rewarded');
        if (r) r.outcome = /granted/.test(a.message) ? 'granted' : 'cancelled';
      }
    } else if (a.kind === 'counter') {
      this.counters[a.key] ??= {};
      const previous = this.counters[a.key][a.name]?.value ?? 0;
      this.counters[a.key][a.name] = { value: a.value, reason: a.reason, ts: e.ts };
      const f = this.funnel(a.key);
      if (f) {
        const map = { LoadCallsSent: 'loadSent', AdsLoaded: 'loaded', LoadCallsFailed: 'loadFailed', ShowCallsSent: 'showSent', AdsDisplayed: 'displayed' };
        const counterId = `${a.key}:${a.name}`;
        // Plugin counters are process-wide. Count only increments observed in this capture.
        this.counterOffsets[counterId] ??= Math.max(0, a.value - 1);
        if (a.value < previous) this.counterOffsets[counterId] = Math.max(0, a.value - 1);
        const observed = Math.max(0, a.value - this.counterOffsets[counterId]);
        if (map[a.name]) f[map[a.name]] = Math.max(f[map[a.name]], observed);
        const state = { LoadCallsSent: 'Loading', AdsLoaded: 'Loaded', LoadCallsFailed: 'Failed', ShowCallsSent: 'Showing', AdsDisplayed: 'Showed' }[a.name];
        if (state && a.value > previous && e.ts >= (f.stateTs ?? 0)) { f.state = state; f.stateTs = e.ts; }
      }
      if (a.name === 'LoadCallsSent' && this.consent.firstAdRequest == null) this.consent.firstAdRequest = e.ts;
      if (a.name === 'AdsLoaded' && this.launch.firstAdLoaded == null) this.launch.firstAdLoaded = e.ts;
    } else if (a.kind === 'callback') {
      if (a.ignored) return;
      const key = a.format === 'interstitial' ? `Ad.Interstitial.${a.fields.slot ?? this.slotForUnit(a.fields.unit) ?? 0}` : 'Ad.Rewarded';
      const f = this.funnel(key);
      if (f) {
        const state = { Loaded: 'Loaded', LoadFailed: 'Failed', Displayed: 'Showed', DisplayFailed: 'Failed', Closed: 'Closed', Hidden: 'Closed' }[a.callback];
        if (state && e.ts >= (f.stateTs ?? 0)) { f.state = state; f.stateTs = e.ts; }
        const metric = { Loaded: 'loaded', LoadFailed: 'loadFailed' }[a.callback];
        if (metric) {
          f.callbackCounts ??= {};
          f.callbackCounts[metric] = (f.callbackCounts[metric] ?? 0) + 1;
          f[metric] = Math.max(f[metric], f.callbackCounts[metric]);
        }
        if (a.fields.network) f.lastNetwork = a.fields.network;
        if (a.callback === 'Displayed') f.shown++;   // the SDK confirming the ad appeared
        if (a.callback === 'Closed') f.closed++;
        if (a.format === 'interstitial' && a.callback === 'Displayed') this.interShows.push({ ts: e.ts, level: this.levelAt(e.ts), closedTs: null });
        if (a.format === 'interstitial' && a.callback === 'Closed' && this.interShows.length) this.interShows[this.interShows.length - 1].closedTs ??= e.ts;
        if (a.callback === 'Loaded' && this.launch.firstAdLoaded == null) this.launch.firstAdLoaded = e.ts;
        if (a.callback === 'RevenuePaid') this.addRevenue(f, a.fields);
      }
      if (a.fields.unit && a.fields.slot != null) (this.unitSlots ??= {})[a.fields.unit] = a.fields.slot;
    } else if (a.kind === 'banner') {
      const f = this.funnel(a.format === 'mrec' ? 'Ad.Banner.Mrec' : 'Ad.Banner.Standard');
      if (f && a.what === 'revenue-paid') this.addRevenue(f, a.fields);
      if (f && a.fields.network) f.lastNetwork = a.fields.network;
    } else if (a.kind === 'adapter') {
      this.adapters[a.fields.name] = { status: a.fields.status, adapterVersion: a.fields.adapterVersion, sdkVersion: a.fields.sdkVersion };
    } else if (a.kind === 'adapters') {
      this.adapterSummary = { ok: a.ok, total: a.total };
    } else if (a.kind === 'max-config') {
      this.maxConfig = a.fields;
    } else if (a.kind === 'rc-sources') {
      this.rc.sources = a.sources;
    } else if (a.kind === 'ad-config') {
      this.rc.adConfig = a.values;
      this.rc.adConfigTs = e.ts;
    } else if (a.kind === 'ad-ids') {
      this.rc.adIds = { inter: a.ids.inter?.length ?? 0, remoteOverride: a.ids.remoteOverride ?? null, banner: !!a.ids.banner, rewarded: !!a.ids.rewarded };
    } else if (a.kind === 'plain' && /^AdMob AppOpen paid event slot=\S+ value=([\d.]+)/.test(a.message)) {
      const f = this.funnel('Ad.AppOpen');
      const v = /value=([\d.]+)/.exec(a.message);
      if (f && v) this.addRevenue(f, { revenue: v[1], network: 'AdMob' });
    } else if (a.kind === 'plain') {
      if (/^GoogleAppTracking:|^Firebase post-init:/.test(a.message)) this.ingestConsent(a.message, e);
      if (/^Firebase post-init:/.test(a.message) && !this.readyAt['SDK.Firebase']) this.readyAt['SDK.Firebase'] = e.ts;
    }

    for (const step of this.steps) {
      if (!step.ts && matches(e, step.match)) step.ts = e.ts;
    }
    for (const fail of this.pack?.sequence?.[0]?.failOn ?? []) {
      if (matches(e, fail.match)) {
        const step = this.steps.find((s) => s.match?.key === a.key);
        if (step && !step.ts) step.failed = template(fail.label ?? '{message}', e);
      }
    }
  }

  // "Displayed com.pkg/.Activity for user 0: +769ms", "Fully drawn com.pkg/.Activity: +3s280ms"
  ingestLaunch(e) {
    const m = /^(Displayed|Fully drawn) ([\w.]+)\/\S+?(?: for user \d+)?: \+([\dsm]+)/.exec(e.message);
    if (!m || (this.pkg && m[2] !== this.pkg)) return;
    const ms = launchMs(m[3]);
    if (m[1] === 'Displayed' && !this.launch.displayed) this.launch.displayed = { ts: e.ts, ms };
    if (m[1] === 'Fully drawn' && !this.launch.fullyDrawn) this.launch.fullyDrawn = { ts: e.ts, ms };
  }

  // Lines from SDKs, by tag: how much each one logs and how many warnings/errors.
  ingestSdkLog(e) {
    const name = e.sdk ?? sdkFromTag(e.tag);
    if (!name || e.source === 'avn') return;
    const s = (this.sdkLogs[name] ??= { lines: 0, warnings: 0, errors: 0, last: null });
    s.lines++;
    if (e.level === 'W') s.warnings++;
    if (e.level === 'E' || e.level === 'F') s.errors++;
    s.last = e.ts;
  }

  // The current level: from the rules file's "level:" setting, otherwise from a Firebase
  // event parameter called level / level_number.
  ingestLevel(e) {
    const opt = this.options.level;
    let level = null;
    let from = null;
    const params = e.fa?.params ?? e.avn?.event?.params;
    const name = e.fa?.name ?? e.avn?.event?.name;
    if (opt?.log && e.tag === 'Unity') {
      const m = (this.levelRe ??= toRegex(opt.log)).exec(e.message);
      if (m) { level = Number(m[1]); from = `log line ${opt.log}`; }
    } else if (opt?.event && params && name && valueTest(opt.event)(name) && params[opt.param ?? 'level'] != null) {
      level = Number(params[opt.param ?? 'level']);
      from = `${name}.${opt.param ?? 'level'}`;
    } else if (!opt && params && name && (e.fa || !this.levelFromFa)) {
      const key = Object.keys(params).find((k) => /^(level|level_number|levelnumber|level_num|current_level|lvl)$/i.test(k));
      if (key) { level = Number(params[key]); from = `${name}.${key}`; }
    }
    // Upload batches can arrive after the player has already reached another
    // level. They must not rewind live level checks or screenshot automation.
    if (!Number.isFinite(level) || e.ts < (this.levels.at(-1)?.ts ?? -Infinity)) return;
    if (e.fa && e.fa.evidence !== 'upload-batch') this.levelFromFa = true;
    this.levelSource ??= from;
    if (this.levels.at(-1)?.level !== level) this.levels.push({ level, ts: e.ts });
    if (this.levels.length > 500) this.levels.shift();
  }

  levelAt(ts) {
    let l = null;
    for (const x of this.levels) if (x.ts <= ts) l = x.level;
    return l;
  }

  // RemoteConfig.Values lines that carry JSON: "AdConfig updated from fetch : {...}",
  // "Custom key=GameSettings value loaded from cache: {...}", "Applied cached AdConfig: {...}".
  ingestRcValue(message, e) {
    ingestRemoteValue(this.rcValues, message, e);
  }

  ingestConsent(message, e) {
    const c = this.consent;
    const m = message.replace(/^GoogleAppTracking:\s*/, '');
    let x;
    if (/User not in CMP country/.test(m)) c.notInCmp = true;
    else if (/CMP disabled/.test(m)) c.cmpDisabled = true;
    else if (/Gathering consent|GatherConsent called/.test(m)) c.gatherAt ??= e.ts;
    else if ((x = /Consent updated\. Status=(\w+)/.exec(m))) { c.status = x[1]; c.updatedAt = e.ts; }
    else if ((x = /Failed to gather consent with error: (.*)/.exec(m))) c.failed = x[1];
    else if (/AdMob SDK init failed\. Skipping CMP/.test(m)) c.failed = 'AdMob failed to start, so the consent form was skipped';
    else if ((x = /Post-consent startup flow continuing\. consentGranted=(\w+)/.exec(m))) { c.doneAt ??= e.ts; c.granted = /true/i.test(x[1]); }
    else if ((x = /ATT (?:already resolved with status|callback received\. Status)=(\w+)/.exec(m))) c.att = x[1];
    else if ((x = /Firebase post-init:.*consent=(\w+)(.*)/.exec(m))) c.firebase = { value: x[1], unconditional: /unconditional/.test(x[2]) };
  }

  slotForUnit(unit) {
    return this.unitSlots?.[unit];
  }

  addRevenue(f, fields) {
    const v = Number(fields.revenue);
    if (!Number.isFinite(v)) return;
    f.paid++;
    f.revenue += v;
    this.revenue.total += v;
    this.revenue.byFormat[f.format] = (this.revenue.byFormat[f.format] ?? 0) + v;
    if (fields.network) this.revenue.byNetwork[fields.network] = (this.revenue.byNetwork[fields.network] ?? 0) + v;
  }

  startup(now) {
    const start = this.appStart;
    const accepted = this.steps.find((s) => s.id === 'accepted')?.ts ?? start;
    return this.steps.map((s) => {
      let status = s.ts ? 'done' : s.failed ? 'failed' : 'wait';
      const limit = durationMs(s.within);
      if (!s.ts && !s.failed && limit && accepted && now - accepted > limit) status = 'timeout';
      return { id: s.id, status, at: s.ts && start ? s.ts - start : null, failed: s.failed };
    });
  }

  sdks(now) {
    const card = (key, label) => {
      const h = this.hub[key];
      const start = this.sdkStart[key];
      return {
        key, label,
        state: h?.state ?? null,
        message: h?.message ?? null,
        upInMs: h?.state === 'Initialized' && start ? h.ts - start : null,
        waitingMs: !h || h.state === 'Idle' || h.state === 'Initializing' ? (start ? now - start : null) : null,
      };
    };
    return [
      card('SDK.Firebase', 'Firebase'),
      card('SDK.AdsProvider', 'AppLovin MAX'),
      card('SDK.AdMob', 'AdMob'),
      card('SDK.RemoteConfig', 'Remote config'),
      card('SDK.Purchaser', 'Purchases'),
      this.options.byteBrew ? card('SDK.ByteBrew', 'ByteBrew') : { key: 'SDK.ByteBrew', label: 'ByteBrew', notUsed: true },
      { key: 'SDK.AppsFlyer', label: 'AppsFlyer', noLogs: true },
    ];
  }

  // Launch timeline in ms from the game process starting (or the first plugin line when
  // the launch happened before the log started).
  launchTimeline() {
    const anchor = this.appStart;
    if (anchor == null) return null;
    const steps = [
      { id: 'process', label: 'Game process started', ts: this.processSeen ? anchor : null },
      { id: 'unity', label: 'Unity engine started', ts: this.firstUnityTs },
      { id: 'displayed', label: 'First screen shown', ts: this.launch.displayed?.ts, android: this.launch.displayed?.ms },
      { id: 'firebase', label: 'Firebase ready', ts: this.readyAt['SDK.Firebase'] },
      { id: 'drawn', label: 'App reported fully drawn', ts: this.launch.fullyDrawn?.ts, android: this.launch.fullyDrawn?.ms },
      { id: 'max', label: 'AppLovin MAX ready', ts: this.readyAt['SDK.AdsProvider'] },
      { id: 'admob', label: 'AdMob ready', ts: this.readyAt['SDK.AdMob'] },
      { id: 'rc', label: 'Remote config fetched', ts: this.readyAt['SDK.RemoteConfig'] },
      { id: 'plugin', label: 'Plugin init done', ts: this.readyAt['SDK.InitCompleted'] },
      { id: 'ad', label: 'First ad loaded', ts: this.launch.firstAdLoaded },
      { id: 'level', label: this.levels[0] ? `First level started (level ${this.levels[0].level})` : 'First level started', ts: this.levels[0]?.ts ?? null },
    ];
    return {
      captured: this.processSeen,
      anchor,
      steps: steps.map((s) => ({ ...s, at: s.ts != null ? Math.max(0, s.ts - anchor) : null })).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity)),
    };
  }

  snapshot(now = Date.now()) {
    const debugOff = this.firstUnityTs != null && this.infoLines === 0 && now - this.firstUnityTs > 15000;
    const expected = this.options.expectedAdapters ?? [];
    const adapters = Object.entries(this.adapters).map(([name, a]) => ({ name, ...a }));
    for (const name of expected) if (!adapters.some((a) => a.name.toLowerCase().includes(name.toLowerCase().split(' ')[0]))) adapters.push({ name, status: 'NotReported', expected: true });
    return {
      seen: this.firstAvnTs != null,
      appStart: this.appStart,
      debugLogs: debugOff ? 'off' : this.infoLines > 0 ? 'on' : 'unknown',
      debugInRelease: this.infoLines > 0 && this.debuggable === false,
      startup: this.startup(now),
      sdks: this.sdks(now),
      firstEventVerified: this.hub['SDK.Firebase.EventVerified']?.message ?? null,
      maxConfig: this.maxConfig,
      adapters,
      adapterSummary: this.adapterSummary,
      funnels: Object.values(this.funnels).sort((x, y) => x.key.localeCompare(y.key)),
      rc: { ...this.rc, values: Object.values(this.rcValues), variables: remoteVariables({ ...this.rc, values: Object.values(this.rcValues) }) },
      launch: this.launchTimeline(),
      levels: { source: this.levelSource, current: this.levels.at(-1)?.level ?? null, count: new Set(this.levels.map((l) => l.level)).size },
      revenue: this.revenue,
      hub: Object.fromEntries(Object.entries(this.hub).map(([k, v]) => [k, { state: v.state, message: v.message, ts: v.ts }])),
    };
  }
}

function toRegex(text) {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(String(text));
  return m ? new RegExp(m[1], m[2]) : new RegExp(String(text));
}

// "+769ms", "+3s280ms", "+1m2s5ms" -> ms
export function launchMs(text) {
  let ms = 0;
  for (const m of text.matchAll(/(\d+)(ms|s|m)/g)) ms += Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 's' ? 1000 : 60000);
  return ms;
}

// Watch rules (pack + game profile) -> flags with counts.
export class Flags {
  constructor(rules = []) {
    this.rules = rules;
    this.hits = {};
  }

  setRules(rules) {
    this.rules = rules;
  }

  ingest(e) {
    const hits = [];
    for (const r of this.rules) {
      if (!r.match || !matches(e, r.match)) continue;
      const h = (this.hits[r.id] ??= { id: r.id, name: r.name ?? r.id, severity: r.severity ?? 'warning', count: 0, last: null, message: null, capture: null, entryId: null });
      h.count++;
      h.last = e.ts;
      h.message = e.message.replace(/\s*\|\s*AVNPLUGIN\s*$/, '');
      h.entryId = e.id;
      if (r.capture) h.capture = Object.fromEntries(Object.entries(r.capture).map(([k, v]) => [k, template(v, e)]));
      hits.push(h);
    }
    return hits;
  }

  list() {
    const order = { critical: 0, warning: 1, info: 2 };
    return Object.values(this.hits).sort((a, b) => (order[a.severity] - order[b.severity]) || b.last - a.last);
  }
}
