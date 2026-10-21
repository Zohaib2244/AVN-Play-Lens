// Parser for AVN plugin log lines (logcat tag `Unity`).
// Spec: AVN_PLUGIN_LOG_REFERENCE.md (sections 1.2 - 1.4, 3, 4, 5, 9, 10).
// Takes one logcat message (tag already known to be Unity) and returns a
// structured entry, or null when the line is not from the plugin.

export const STATES = [
  'Info', 'Initializing', 'Initialized', 'Failed', 'Idle', 'Loading', 'Loaded',
  'Showing', 'Showed', 'Closed', 'Destroyed', 'Sending', 'Sent', 'SendFailed',
];

const SUFFIX = /\s*\|\s*AVNPLUGIN\s*$/;
const COLOR_TAGS = /<\/?color[^>]*>/g;
const CALLER = /^\[([^\]\s]+)\]\s+(.*)$/s;
const COUNTER = /^Counter (\S+) (\w+)=(\d+)(?: reason=(.*))?$/s;
const STATUS = new RegExp(`^Status (\\S+) => (${STATES.join('|')}): (.*)$`, 's');
const CALLBACK = /^SDKCallback \| (InterAd|RewardAd) \| (\w+)(?: ignored: (.*?))?(?: \| (.*))?$/s;
const ADAPTER = /^MAX adapter \| (.*)$/s;
const ADAPTERS = /^MAX adapters: (\d+)\/(\d+) initialized(?:; not ready: (.*))?$/s;
const MAX_CONFIG = /^MAX init config \| (.*)$/s;
const BANNER = /^-------- MAX (Banner|MREC) (ad loaded|load failed: (\S+)|ad expanded|ad collapsed|ad clicked|ad revenue paid) --------\s*(.*)$/s;
const SEND_FB = /^SendToFirebase sent event=([^,]+), params=(\d+)$/;
const SEND_BB = /^SendToByteBrew sent event=([^,]+), params=(\d+)$/;
const RC_SOURCES = /^Remote config value sources \| (.*)$/s;
const AD_CONFIG = /^AdConfig applied \| (.*)$/s;
const AD_IDS = /^Effective ad IDs \| (.*)$/s;

const EV_CUSTOM = /^Custom event (sent|failed to send): Event=([^,]+), Params=(\d+)\s*(?:\[(.*)\])?$/s;
const EV_HANDED = /^Firebase event handed to SDK: (\S+) \((.*)\)$/s;
const EV_EARLY = /^Firebase event sent BEFORE Firebase init succeeded \(may be dropped\): (\S+) \((.*)\)$/s;
const EV_REQUEST = /^SendCustomEvent requested: event=([^,]+), toFirebase=(\w+), toByteBrew=(\w+)$/;
const EV_DROPPED = /^(\S+): dropped, Firebase is not initialized$/;
const EV_FIRST = /^First Firebase event handed to SDK after init: (\S+)$/;

// "key=value key=value" where values may contain spaces (e.g. msg=No Fill).
// A value runs until the next " word=" or the end of the string.
export function parseSpacedKv(text) {
  const out = {};
  const re = /(?:^|\s)\(?(\w+)=/g;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ key: m[1], start: m.index + m[0].length, at: m.index });
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : text.length;
    out[h.key] = text.slice(h.start, end).trim().replace(/\)$/, '');
  });
  return out;
}

// "k=v, k=v" (event params, remote config sources).
export function parseCommaKv(text) {
  const out = {};
  if (!text || !text.trim()) return out;
  for (const part of text.split(/,\s*(?=[\w.-]+=)/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseAdIds(text) {
  const out = {};
  const inter = /inter=\[([^\]]*)\]/.exec(text);
  Object.assign(out, parseSpacedKv(text.replace(/inter=\[[^\]]*\]/, '')));
  if (inter) out.inter = inter[1].split('|').map((s) => s.trim()).filter(Boolean);
  return out;
}

function parseEvent(key, state, message) {
  let m;
  if (key === 'Analytics.Event') {
    if ((m = EV_CUSTOM.exec(message))) {
      return { name: m[2].trim(), stage: m[1] === 'sent' ? 'sent' : 'failed', paramCount: Number(m[3]), params: parseCommaKv(m[4] || '') };
    }
    if ((m = EV_HANDED.exec(message))) return { name: m[1], stage: 'handed', params: parseCommaKv(m[2]) };
    if ((m = EV_EARLY.exec(message))) return { name: m[1], stage: 'before-init', params: parseCommaKv(m[2]) };
    if ((m = EV_REQUEST.exec(message))) return { name: m[1].trim(), stage: 'requested', toFirebase: m[2] === 'True' || m[2] === 'true', toByteBrew: m[3] === 'True' || m[3] === 'true' };
    if ((m = EV_DROPPED.exec(message))) return { name: m[1], stage: 'dropped' };
  }
  if (key === 'SDK.Firebase.EventVerified' && (m = EV_FIRST.exec(message))) return { name: m[1], stage: 'first-after-init' };
  return null;
}

export function parseAvnLine(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.replace(COLOR_TAGS, '').trim();
  const tagged = SUFFIX.test(text);
  text = text.replace(SUFFIX, '');

  let caller = null;
  let body = text;
  const c = CALLER.exec(text);
  if (c) {
    const dot = c[1].lastIndexOf('.');
    caller = dot > 0 ? { class: c[1].slice(0, dot), method: c[1].slice(dot + 1) } : { class: c[1], method: null };
    body = c[2];
  }

  let m;
  // Counter lines are accepted without the suffix: the reference shows them both ways.
  if ((m = COUNTER.exec(body))) {
    return { kind: 'counter', key: m[1], name: m[2], value: Number(m[3]), reason: m[4] ?? null, caller, tagged };
  }
  if (!tagged) return null;

  if ((m = STATUS.exec(body))) {
    const entry = { kind: 'status', key: m[1], state: m[2], message: m[3], caller };
    const event = parseEvent(m[1], m[2], m[3]);
    if (event) entry.event = event;
    if (m[1] === 'SDK.RemoteConfig') {
      const fetched = /lastFetchStatus=(\w+), fetchTime=([^)]+)\)/.exec(m[3]);
      if (fetched) entry.fetch = { lastFetchStatus: fetched[1], fetchTime: fetched[2] };
    }
    return entry;
  }
  if ((m = CALLBACK.exec(body))) {
    return { kind: 'callback', format: m[1] === 'InterAd' ? 'interstitial' : 'rewarded', callback: m[2], ignored: m[3] ?? null, fields: parseSpacedKv(m[4] || ''), caller };
  }
  if ((m = ADAPTER.exec(body))) return { kind: 'adapter', fields: parseSpacedKv(m[1]), caller };
  if ((m = ADAPTERS.exec(body))) {
    const notReady = (m[3] || '').split(/,\s*/).filter(Boolean).map((p) => { const [name, status] = p.split('='); return { name, status }; });
    return { kind: 'adapters', ok: Number(m[1]), total: Number(m[2]), notReady, caller };
  }
  if ((m = MAX_CONFIG.exec(body))) return { kind: 'max-config', fields: parseSpacedKv(m[1]), caller };
  if ((m = BANNER.exec(body))) {
    const what = m[2].startsWith('load failed') ? 'load-failed' : m[2].replace('ad ', '').replace(' ', '-');
    return { kind: 'banner', format: m[1] === 'MREC' ? 'mrec' : 'banner', what, code: m[3] ?? null, fields: parseSpacedKv(m[4] || ''), caller };
  }
  if ((m = SEND_FB.exec(body))) return { kind: 'send', sdk: 'firebase', event: { name: m[1].trim(), paramCount: Number(m[2]) }, caller };
  if ((m = SEND_BB.exec(body))) return { kind: 'send', sdk: 'bytebrew', event: { name: m[1].trim(), paramCount: Number(m[2]) }, caller };
  if ((m = RC_SOURCES.exec(body))) return { kind: 'rc-sources', sources: parseCommaKv(m[1]), caller };
  if ((m = AD_CONFIG.exec(body))) return { kind: 'ad-config', values: parseSpacedKv(m[1]), caller };
  if ((m = AD_IDS.exec(body))) return { kind: 'ad-ids', ids: parseAdIds(m[1]), caller };

  return { kind: 'plain', message: body, caller };
}
