// Both short logcat aliases and expanded Firebase names occur on real devices.
// Keep useful game/ad/revenue values; hide only SDK bookkeeping and screen metadata.
const INTERNAL_NAMES = new Set(['engagement_time_msec', 'session_id', 'session_number',
  'entrances', 'debug_mode', 'ad_event_id', 'previous_timestamp_millis']);

export function isFirebaseParameter(name) {
  return /^(?:_|ga_|firebase_)/.test(name) || INTERNAL_NAMES.has(name);
}

export function visibleParameters(params, showInternal = false) {
  return Object.entries(params ?? {}).filter(([name]) => showInternal || !isFirebaseParameter(name));
}

export function eventMatches(row, { sdk = 'ALL', hideAuto = false, name = '' } = {}) {
  return (sdk === 'ALL' || row.sdk === sdk) && !(hideAuto && (row.auto || row.check === 'automatic')) && (!name || row.name === name);
}

// Older saved captures have only rows; never count unconfirmed plugin attempts
// as Firebase occurrences. New captures carry full-session catalog statistics.
export function eventTypes(firebase, filters = {}) {
  const source = firebase.catalog ?? (firebase.rows ?? []).filter((row) => !row.missing).map((row) => ({
    sdk: row.sdk, name: row.name, auto: row.auto || row.check === 'automatic', count: 1,
    firstTs: row.ts, lastTs: row.ts, params: Object.keys(row.params ?? {}),
  }));
  const types = new Map();
  for (const type of source) {
    if (!eventMatches(type, filters)) continue;
    const key = JSON.stringify([type.sdk, type.name]);
    const previous = types.get(key);
    if (previous) {
      previous.count += type.count;
      previous.firstTs = Math.min(previous.firstTs, type.firstTs);
      previous.lastTs = Math.max(previous.lastTs, type.lastTs);
      previous.automatic += type.auto ? type.count : 0;
      for (const param of type.params) previous.params.add(param);
    } else types.set(key, { ...type, automatic: type.auto ? type.count : 0, params: new Set(type.params) });
  }
  return [...types.values()].map((type) => ({ ...type, params: [...type.params].sort(),
    averageGap: type.count > 1 ? (type.lastTs - type.firstTs) / (type.count - 1) : null,
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.sdk.localeCompare(b.sdk));
}

export function eventOptions(firebase, filters = {}) {
  const types = eventTypes(firebase, { ...filters, name: '' });
  const options = new Map();
  for (const type of types) {
    const option = options.get(type.name) ?? { name: type.name, logged: 0, reports: 0, unconfirmed: 0 };
    option[type.sdk === 'FA' ? 'logged' : 'reports'] += type.count;
    options.set(type.name, option);
  }
  for (const row of firebase.rows ?? []) {
    if (!row.missing || !eventMatches(row, { ...filters, name: '' })) continue;
    const option = options.get(row.name) ?? { name: row.name, logged: 0, reports: 0, unconfirmed: 0 };
    option.unconfirmed++;
    options.set(row.name, option);
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatGap(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
}
