const valueType = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const clean = (s) => String(s).replace(/\s*\|\s*AVNPLUGIN\s*$/gm, '').trim();

// Unity appends its logging stack after the value. It is evidence, not config data.
export function cleanRemoteText(message, more = []) {
  const lines = [message, ...more].join('\n').split(/\r?\n/);
  const end = lines.findIndex((line, i) =>
    /^\s*(?:at\s+)?[\w.$+`<>]+(?::[\w.$+`<>]+|\.[\w.$+`<>]+)\s*\(/.test(line) ||
    (i > 0 && /^(?:\[[^\]]+\]\s*)?Status\s+\S+\s+=>/.test(line)));
  return clean((end < 0 ? lines : lines.slice(0, end)).join('\n'));
}

export function ingestRemoteValue(values, message, e) {
  const text = cleanRemoteText(message, e.more);
  let m = /^Registered custom key=([^,\s]+),\s*type=(.+)$/.exec(text);
  if (m) {
    const previous = values[m[1]];
    values[m[1]] = { name: m[1], hasValue: false, ...previous, declaredType: m[2].trim() };
    return;
  }
  let name, raw, source, from;
  if ((m = /^Dispatched custom key=(\S+) source=(\w+) with value:\s*([\s\S]*)$/.exec(text))) {
    [, name, source, raw] = m; from = 'fetch';
  } else if ((m = /^Custom key=(\S+) value loaded from cache:\s*([\s\S]*)$/.exec(text))) {
    [, name, raw] = m; source = 'Cache'; from = 'cache';
  } else if ((m = /^(AdConfig|AdIdsConfig) (updated from fetch|loaded from cache)\s*:\s*([\s\S]*)$/.exec(text))) {
    [, name, from, raw] = m; from = /fetch/.test(from) ? 'fetch' : 'cache'; source = from === 'cache' ? 'Cache' : null;
  } else if ((m = /^Applied cached (AdConfig|AdIdsConfig):\s*([\s\S]*)$/.exec(text))) {
    [, name, raw] = m; from = 'cache'; source = 'Cache';
  } else if ((m = /^Applied CMPEligibleUser=(\w+) to IsUserInCMPCountry/.exec(text))) {
    name = 'CMPEligibleUser'; raw = m[1]; from = 'applied';
  } else return;
  raw = raw.trim();
  const declaredType = values[name]?.declaredType || null;
  let value = raw;
  let parsed = false;
  let truncated = /(?:…|\.\.\.)\s*\(\+\d+ chars\)/.test(raw);
  if (!truncated && !/^(?:System\.)?String$/i.test(declaredType || '')) {
    try { value = /^(?:true|false)$/i.test(raw) ? JSON.parse(raw.toLowerCase()) : JSON.parse(raw); parsed = true; } catch { if (/^[{[]/.test(raw)) truncated = true; }
  }
  values[name] = { name, hasValue: true, value, type: truncated ? 'unknown' : valueType(value), declaredType, source: source || null, from, raw: raw.slice(0, 16000), json: parsed ? value : null, truncated: truncated || raw.length > 16000, ts: e.ts, entryId: e.id };
}

export function remoteVariables(rc) {
  const result = [];
  function add(v, path, value, depth) {
    if (result.length >= 1000 || depth > 8) return;
    const type = path === v.name ? v.type : valueType(value);
    result.push({ ...v, name: path, type, value, source: v.source || (v.from === 'cache' ? 'Cache' : rc.sources?.[v.name]) || 'Unknown', json: undefined, raw: undefined, parent: path === v.name ? null : v.name });
    if (value && typeof value === 'object' && !v.truncated) for (const [key, child] of Object.entries(value)) add(v, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, child, depth + 1);
  }
  for (const v of rc.values ?? []) add(v, v.name, v.value, 0);
  return result;
}

export const displayRemoteValue = (v) => !v.hasValue ? 'Waiting for a value' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value) ?? '';
