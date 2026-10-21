// Checks built on the plugin health model:
//   adRules   what the game did vs the AdConfig values the plugin applied (only keys present)
//   privacy   consent before ads, AD_ID, sensitive permissions, hidden-API use
//   sdkList   SDKs the AVN plugin verifies, plus others found in the APK or the logs
// Each check: { id, name, status: ok | problem | warn | pending | skipped | info, result, note }

const TOLERANCE_S = 1;
const secs = (ms) => Math.round(ms / 100) / 10;
const truthy = (v) => /^true$/i.test(String(v));

export function adRules(h, now = Date.now()) {
  const ac = h.rc.adConfig;
  if (!ac) return { config: null, checks: [] };
  const has = (k) => ac[k] != null && ac[k] !== '';
  const num = (k) => Number(ac[k]);
  const shows = h.interShows;
  const anchor = h.appStart;
  const checks = [];
  const funnelsOf = (format) => Object.values(h.funnels).filter((f) => f.format === format);
  const shownOf = (format) => funnelsOf(format).reduce((n, f) => n + (format === 'interstitial' || format === 'rewarded' ? f.shown : f.displayed), 0);

  for (const [key, format, label] of [['Inter', 'interstitial', 'Interstitials'], ['Rewarded', 'rewarded', 'Rewarded ads'], ['Banner', 'banner', 'Banners'], ['AppOpen', 'app-open', 'App open ads']]) {
    if (!has(key)) continue;
    const n = shownOf(format);
    const on = truthy(ac[key]);
    if (!on && n) checks.push({ id: `format-${key}`, name: `${label} off in AdConfig`, key, value: ac[key], status: 'problem', result: `${n} shown anyway` });
    else checks.push({ id: `format-${key}`, name: `${label} ${on ? 'on' : 'off'}`, key, value: ac[key], status: on ? (n ? 'ok' : 'pending') : 'ok', result: on ? (n ? `${n} shown` : 'none shown yet') : 'none shown' });
  }

  if (has('DelayBeforeFirstAd')) {
    const want = num('DelayBeforeFirstAd');
    const first = shows[0];
    const c = { id: 'first-delay', name: `First interstitial after ${want} s`, key: 'DelayBeforeFirstAd', value: ac.DelayBeforeFirstAd };
    if (!first) checks.push({ ...c, status: 'pending', result: 'waiting for the first interstitial' });
    else {
      const gap = secs(first.ts - anchor);
      checks.push({ ...c, status: gap + TOLERANCE_S < want ? 'problem' : 'ok', result: `shown ${gap} s after launch`, note: h.processSeen ? null : 'Launch not captured; measured from the first plugin line.' });
    }
  }

  if (has('InterAdDelay')) {
    const want = num('InterAdDelay');
    const c = { id: 'inter-delay', name: `At least ${want} s between interstitials`, key: 'InterAdDelay', value: ac.InterAdDelay };
    if (shows.length < 2) checks.push({ ...c, status: 'pending', result: shows.length ? 'only one shown so far' : 'none shown yet' });
    else {
      let min = Infinity;
      let minClose = Infinity;
      for (let i = 1; i < shows.length; i++) {
        min = Math.min(min, shows[i].ts - shows[i - 1].ts);
        if (shows[i - 1].closedTs) minClose = Math.min(minClose, shows[i].ts - shows[i - 1].closedTs);
      }
      checks.push({ ...c, status: secs(min) + TOLERANCE_S < want ? 'problem' : 'ok', result: `shortest gap ${secs(min)} s`, note: Number.isFinite(minClose) ? `${secs(minClose)} s from the previous one closing` : null });
    }
  }

  if (has('EnableInterFromLevel')) {
    const want = num('EnableInterFromLevel');
    const c = { id: 'from-level', name: `Interstitials from level ${want}`, key: 'EnableInterFromLevel', value: ac.EnableInterFromLevel };
    const first = shows[0];
    if (!h.levels.length) checks.push({ ...c, status: 'skipped', result: 'no level seen in the logs', note: 'Add "level:" to this game\'s rules file to say where the level comes from.' });
    else if (!first) checks.push({ ...c, status: 'pending', result: `now on level ${h.levels.at(-1).level}` });
    else if (first.level == null) checks.push({ ...c, status: 'skipped', result: 'first interstitial came before any level was seen' });
    else checks.push({ ...c, status: first.level < want ? 'problem' : 'ok', result: `first one at level ${first.level}` });
  }

  if (has('InterstitialShowMode')) checks.push({ id: 'show-mode', name: 'Show mode', key: 'InterstitialShowMode', value: ac.InterstitialShowMode, status: 'info', result: ac.InterstitialShowMode });
  if (h.blocked.cooldown || h.blocked.firstDelay || h.blocked.level) {
    const parts = [h.blocked.firstDelay && `${h.blocked.firstDelay} for the first-ad delay`, h.blocked.cooldown && `${h.blocked.cooldown} for cooldown`, h.blocked.level && `${h.blocked.level} for level`].filter(Boolean);
    checks.push({ id: 'held-back', name: 'Plugin held interstitials back', status: 'info', result: parts.join(', ') });
  }
  void now;
  return { config: ac, levelSource: h.levelSource, checks };
}

export function privacy(h, app, { hiddenApi = 0, now = Date.now() } = {}) {
  const c = h.consent;
  const checks = [];
  const waited = now - (h.appStart ?? now);
  const exempt = c.notInCmp || c.cmpDisabled;

  // 1. Consent flow
  if (c.failed) checks.push({ id: 'consent', name: 'Consent form', status: 'problem', result: `failed: ${c.failed}` });
  else if (c.notInCmp) checks.push({ id: 'consent', name: 'Consent form', status: 'ok', result: 'not needed: user is outside CMP countries' });
  else if (c.cmpDisabled) checks.push({ id: 'consent', name: 'Consent form', status: 'warn', result: 'CMP is turned off in this build' });
  else if (c.doneAt) checks.push({ id: 'consent', name: 'Consent form', status: 'ok', result: `done${c.status ? ` · status ${c.status}` : ''}${c.granted != null ? ` · ${c.granted ? 'granted' : 'not granted'}` : ''}` });
  else if (c.gatherAt) checks.push({ id: 'consent', name: 'Consent form', status: 'pending', result: 'in progress' });
  else checks.push({ id: 'consent', name: 'Consent form', status: h.firstAvnTs && waited > 20000 ? 'warn' : 'pending', result: h.firstAvnTs && waited > 20000 ? 'no consent lines from the plugin' : 'waiting for consent lines' });

  // 2. Ads waited for consent
  const ar = { id: 'ads-after-consent', name: 'Ads waited for consent' };
  if (exempt) checks.push({ ...ar, status: 'ok', result: 'not needed' });
  else if (c.firstAdRequest == null) checks.push({ ...ar, status: 'pending', result: 'no ad requested yet' });
  else if (c.doneAt && c.firstAdRequest >= c.doneAt) checks.push({ ...ar, status: 'ok', result: `first ad request ${secs(c.firstAdRequest - c.doneAt)} s after consent` });
  else if (c.doneAt) checks.push({ ...ar, status: 'problem', result: `ads started loading ${secs(c.doneAt - c.firstAdRequest)} s before consent finished` });
  else checks.push({ ...ar, status: c.gatherAt ? 'problem' : 'warn', result: c.gatherAt ? 'ads started loading while the consent form was still open' : 'ads started loading, consent not finished' });

  // 3. Firebase / MAX consent values
  if (c.firebase) checks.push({ id: 'firebase-consent', name: 'Firebase consent', status: c.firebase.unconditional ? 'warn' : 'info', result: `${c.firebase.value}${c.firebase.unconditional ? ' for every user (set unconditionally)' : ''}`, note: c.firebase.unconditional ? 'Check this is intended for users in the EEA/UK.' : null });
  if (h.maxConfig?.consentState || h.maxConfig?.consentGeo) checks.push({ id: 'max-consent', name: 'AppLovin MAX consent', status: 'info', result: `geo ${h.maxConfig.consentGeo ?? '?'} · state ${h.maxConfig.consentState ?? '?'}${h.maxConfig.att ? ` · ATT ${h.maxConfig.att}` : ''}` });

  // 4. Manifest
  if (!app) checks.push({ id: 'ad-id', name: 'Advertising ID permission', status: 'pending', result: 'reading the app…' });
  else {
    checks.push({ id: 'ad-id', name: 'Advertising ID permission', status: app.adId ? 'ok' : 'problem', result: app.adId ? 'AD_ID declared' : 'AD_ID missing', note: app.adId ? null : 'Without it, ads on Android 13+ get a zeroed advertising ID.' });
    const sens = app.sensitive.filter((p) => p.id !== 'android.permission.POST_NOTIFICATIONS');
    const notif = app.sensitive.find((p) => p.id === 'android.permission.POST_NOTIFICATIONS');
    checks.push({ id: 'permissions', name: 'Sensitive permissions', status: sens.length ? 'warn' : 'ok', result: sens.length ? sens.map((p) => p.name).join(', ') : notif ? 'none (notifications only)' : 'none', note: sens.length ? 'Declare each in the Play Console Data safety form, and make sure an SDK isn\'t adding one you don\'t need.' : null, list: app.sensitive });
  }
  if (hiddenApi) checks.push({ id: 'hidden-api', name: 'Hidden Android APIs', status: 'info', result: `${hiddenApi} warning${hiddenApi === 1 ? '' : 's'} from SDKs`, note: 'Android blocked an SDK from using an internal API. Keep SDKs updated.' });
  return checks;
}

// ── SDK list ────────────────────────────────────────────────────────────────

const VERIFIED = {
  'AppLovin MAX': 'SDK.AdsProvider',
  'Google AdMob': 'SDK.AdMob',
  Firebase: 'SDK.Firebase',
  'Firebase Analytics': 'SDK.Firebase',
  'Firebase Remote Config': 'SDK.RemoteConfig',
  'Google Play Billing': 'SDK.Purchaser',
  ByteBrew: 'SDK.ByteBrew',
  'Google UMP (consent)': 'consent',
};
const NOT_SDKS = new Set(['Unity engine', 'IL2CPP', 'Mono']);
const ADAPTER_NAMES = { 'Unity Ads': /unity/i, 'Meta Audience Network': /meta|facebook/i, ironSource: /ironsource|levelplay/i, Pangle: /pangle/i, Mintegral: /mintegral/i, 'Liftoff (Vungle)': /liftoff|vungle/i, Liftoff: /liftoff|vungle/i, InMobi: /inmobi/i, 'DT Exchange': /dt exchange|fyber/i, BidMachine: /bidmachine/i, Moloco: /moloco/i, 'Yandex Ads': /yandex/i, Yandex: /yandex/i, BIGO: /bigo/i, Meta: /meta|facebook/i };

export function sdkList(h, apkSdks) {
  const extra = new Map();
  const add = (name, patch) => {
    // ByteBrew counts as verified only when the game turns it on in the plugin.
    if ((VERIFIED[name] && !(name === 'ByteBrew' && !h.options.byteBrew)) || NOT_SDKS.has(name)) return;
    extra.set(name, { name, inApp: false, version: null, lines: 0, warnings: 0, errors: 0, adapter: null, ...extra.get(name), ...patch });
  };
  for (const s of apkSdks ?? []) add(s.name, { inApp: true, version: s.version, artifact: s.artifact });
  for (const [name, log] of Object.entries(h.sdkLogs)) add(name, { lines: log.lines, warnings: log.warnings, errors: log.errors });
  for (const s of extra.values()) {
    const re = ADAPTER_NAMES[s.name];
    const a = re && Object.entries(h.adapters).find(([n]) => re.test(n));
    if (a) { s.adapter = a[1].status; s.version ??= a[1].sdkVersion ?? null; }
  }
  const engine = (apkSdks ?? []).filter((s) => NOT_SDKS.has(s.name)).map((s) => s.name);
  return { extra: [...extra.values()].sort((a, b) => Number(b.inApp) - Number(a.inApp) || b.lines - a.lines || a.name.localeCompare(b.name)), engine, apkRead: apkSdks != null };
}
