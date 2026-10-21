// Parser for Firebase Analytics debug lines (logcat tags FA and FA-SVC).
// These are the primary source for the Firebase events view. They only appear after:
//   adb shell setprop debug.firebase.analytics.app <package>
//   adb shell setprop log.tag.FA VERBOSE
//   adb shell setprop log.tag.FA-SVC VERBOSE
// and a game restart. The format is not a documented API, so every pattern here
// must be checked against a real capture (PLAN.md section 5, Phase 0).

// Short names Firebase uses for automatic events and params.
export const AUTO_EVENTS = {
  _s: 'session_start', _e: 'user_engagement', _vs: 'screen_view', _f: 'first_open',
  _ab: 'app_background', _au: 'app_update', _ui: 'app_remove', _cd: 'app_clear_data',
  _ai: 'ad_impression', _iap: 'in_app_purchase',
};

// "Logging event: origin=app,name=level_start,params=Bundle[{...}]"   (FA-SVC)
const SVC = /^Logging event: origin=([^,]+),name=([^,]+),params=Bundle\[\{(.*)\}\]\s*$/s;
// "Logging event (FE): level_start, Bundle[{...}]" or "screen_view(_vs), Bundle[{...}]"   (FA)
const FE = /^Logging event \(FE\): ([^,(]+)(?:\((_\w+)\))?, Bundle\[\{(.*)\}\]\s*$/s;

// Bundle contents: "level=3, ga_event_origin(_o)=app, firebase_screen(_sn)=Shop".
// Splits on ", " only when the next token looks like a key, so values may hold commas.
export function parseBundle(text) {
  const out = {};
  if (!text || !text.trim()) return out;
  for (const part of text.split(/,\s*(?=[\w.]+(?:\(_\w+\))?=)/)) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim().replace(/\(_\w+\)$/, '');
    out[key] = part.slice(i + 1).trim();
  }
  return out;
}

export function parseFaLine(tag, message) {
  if (tag !== 'FA' && tag !== 'FA-SVC') return null;
  let m = SVC.exec(message);
  if (m) {
    const raw = m[2].trim();
    return { kind: 'fa-event', source: tag, origin: m[1], name: AUTO_EVENTS[raw] ?? raw, params: parseBundle(m[3]), auto: m[1] === 'auto' };
  }
  m = FE.exec(message);
  if (m) {
    const params = parseBundle(m[3]);
    const origin = params.ga_event_origin ?? params.firebase_event_origin ?? null;
    return { kind: 'fa-event', source: tag, origin, name: m[1].trim(), params, auto: origin === 'auto' };
  }
  return null;
}

// Firebase limits, checked on every event (AVN reference section 13).
export function checkLimits(event) {
  const problems = [];
  if (event.name.length > 40) problems.push(`event name is ${event.name.length} characters (max 40)`);
  const keys = Object.keys(event.params).filter((k) => !k.startsWith('ga_') && !k.startsWith('firebase_') && !k.startsWith('_'));
  if (keys.length > 25) problems.push(`${keys.length} parameters (max 25)`);
  for (const k of keys) {
    const v = String(event.params[k]);
    if (v.length > 100) problems.push(`${k} is ${v.length} characters (max 100)`);
  }
  return problems;
}
