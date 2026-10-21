// Matching rule definitions (YAML) against classified log entries.
//
// A matcher is a map of field -> expected value:
//   { kind: status, key: SDK.Firebase, state: Failed }
//   { kind: callback, callback: LoadFailed, fields.code: NoFill }
//   { kind: plain, level: E, message: /reference is missing/ }
// Fields are read from the parsed AVN entry (entry.avn), so dotted paths like
// fields.status or event.name work. `level`, `tag` and `source` come from the log line.
// Values: plain text = exact, "/regex/flags" = regex, "!text" = anything but that.
// { any: [matcher, matcher] } matches if one of them does.

const cache = new Map();

export function valueTest(expected) {
  if (cache.has(expected)) return cache.get(expected);
  let fn;
  if (typeof expected === 'string') {
    const re = /^\/(.*)\/([a-z]*)$/s.exec(expected);
    if (re) {
      const rx = new RegExp(re[1], re[2]);
      fn = (v) => rx.test(String(v));
    } else if (expected.startsWith('!')) {
      const not = expected.slice(1);
      fn = (v) => String(v) !== not;
    } else {
      fn = (v) => String(v) === expected;
    }
  } else {
    fn = (v) => String(v) === String(expected);
  }
  cache.set(expected, fn);
  return fn;
}

export function getPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function matches(entry, matcher) {
  if (!matcher) return false;
  if (matcher.any) return matcher.any.some((m) => matches(entry, m));
  const subject = entry.avn ?? (entry.fa ? { kind: 'fa-event', ...entry.fa } : { kind: 'line' });
  for (const [field, expected] of Object.entries(matcher)) {
    let value;
    if (field === 'level') value = entry.level;
    else if (field === 'tag') value = entry.tag;
    else if (field === 'source') value = entry.source;
    else {
      value = getPath(subject, field);
      if (value === undefined && field === 'message') value = entry.message;
    }
    if (value === undefined || value === null) return false;
    if (!valueTest(expected)(value)) return false;
  }
  return true;
}

// "20s", "10m", "1500ms", 30 -> milliseconds
export function durationMs(text) {
  if (typeof text === 'number') return text * 1000;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?/.exec(String(text || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 'm' ? n * 60000 : n * 1000;
}

// Fill "{event.name}" style placeholders from a parsed entry.
export function template(text, entry) {
  const subject = entry.avn ?? entry.fa ?? {};
  return String(text).replace(/\{([\w.]+)\}/g, (_, path) => {
    const v = getPath(subject, path) ?? getPath(entry, path);
    return v == null ? '' : String(v);
  });
}
