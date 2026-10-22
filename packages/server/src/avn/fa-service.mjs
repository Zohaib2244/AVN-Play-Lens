import { AUTO_EVENTS } from './fa.mjs';

const UPLOAD = /^Uploading data\. app, uncompressed size, data: ([\w.]+),/;
const PACKAGE_LINES = [UPLOAD,
  /^Bundling raw events\. appId, hasRealtimeData, totalEvents: ([\w.]+),/,
  /^Uploading bundle with GmsCore network library\. app: ([\w.]+)\s*$/,
  /^Gms url request (?:successful|failed)\. app: ([\w.]+),/,
];

// Only protocol fields identifying the app count; an arbitrary package in an
// event's parameters must never grant ownership of shared Play services logs.
export function firebaseServicePackage(message) {
  for (const pattern of PACKAGE_LINES) {
    const match = pattern.exec(message);
    if (match) return match[1];
  }
  return null;
}

const plainName = (name = '') => name.replace(/\(_\w+\)$/, '');
function scalar(fields) {
  if (Object.hasOwn(fields, 'string_value')) return fields.string_value;
  for (const key of ['int_value', 'double_value', 'float_value']) {
    if (!Object.hasOwn(fields, key)) continue;
    const value = Number(fields[key]);
    if (!Number.isFinite(value)) return fields[key];
    return key === 'int_value' && !Number.isSafeInteger(value) ? fields[key] : value;
  }
  return undefined;
}

// The SDK prints a protobuf text batch. Parse its structure, never substring-match
// event names or app IDs inside values, and reject incomplete/truncated batches.
export function parseFirebaseBatch(lines, pkg, since = 0) {
  const root = { fields: {}, children: [] };
  const stack = [root];
  for (const line of lines) {
    const text = line.trim();
    let match;
    if ((match = /^(\w+)\s*\{$/.exec(text))) {
      const child = { kind: match[1], fields: {}, children: [] };
      stack.at(-1).children.push(child);
      stack.push(child);
    } else if (/^}\s*(?:\/\/.*)?$/.test(text)) {
      if (stack.length === 1) return [];
      stack.pop();
    } else if ((match = /^(\w+):(?: ?)(.*)$/.exec(text))) {
      const node = stack.at(-1);
      if (Object.hasOwn(node.fields, match[1])) node.ambiguous = true;
      node.fields[match[1]] = match[2];
    } else if (text) return [];
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.children[0].kind !== 'batch') return [];
  const events = [];
  for (const bundle of root.children[0].children) {
    if (bundle.kind !== 'bundle' || bundle.ambiguous || bundle.fields.app_id !== pkg) continue;
    for (const [index, event] of bundle.children.filter((c) => c.kind === 'event').entries()) {
      const ts = Number(event.fields.timestamp_millis);
      if (event.ambiguous || !event.fields.name || !Number.isSafeInteger(ts) || ts < since) continue;
      const params = {};
      for (const param of event.children.filter((c) => c.kind === 'param')) {
        if (!param.ambiguous && param.fields.name) {
          const value = scalar(param.fields);
          if (value !== undefined) params[plainName(param.fields.name)] = value;
        }
      }
      const name = AUTO_EVENTS[event.fields.name] || plainName(event.fields.name);
      const origin = params.ga_event_origin ?? params.firebase_event_origin ?? params._o ?? null;
      const eventKey = JSON.stringify([pkg, ts, name, bundle.fields.bundle_sequential_index ?? '', index,
        Object.keys(params).sort().map((key) => [key, params[key]])]);
      events.push({ kind: 'fa-event', source: 'FA-SVC', packageId: pkg, name, params, origin,
        auto: origin === 'auto' || origin === 'am', ts, eventKey, evidence: 'upload-batch' });
    }
  }
  return events;
}

export class FirebaseServiceCapture {
  constructor(pkg) { this.pkg = pkg; this.reset(); }

  reset(since = 0) { this.since = since; this.blocks = new Map(); }

  push(raw) {
    if (!this.pkg || raw.tag !== 'FA-SVC') return [];
    const key = `${raw.pid}:${raw.tid}`;
    const start = UPLOAD.exec(raw.message);
    if (start) {
      this.blocks.delete(key);
      if (start[1] === this.pkg) {
        if (this.blocks.size >= 16) this.blocks.delete(this.blocks.keys().next().value);
        this.blocks.set(key, { header: raw, lines: [], size: 0 });
      }
      return [];
    }
    const block = this.blocks.get(key);
    if (!block) return [];
    if (raw.ts - block.header.ts > 5000 || block.lines.length >= 2048 || block.size > 256000 ||
      !/^(?:\s|batch\s*\{|})/.test(raw.message)) {
      this.blocks.delete(key);
      return [];
    }
    block.lines.push(raw.message);
    block.size += raw.message.length;
    if (!/^}\s*(?:\/\/.*)?$/.test(raw.message)) return [];
    this.blocks.delete(key);
    return parseFirebaseBatch(block.lines, this.pkg, this.since).map((fa) => ({
      ...block.header, ts: fa.ts, observedTs: block.header.ts,
      message: `Firebase upload event: ${fa.name} (${this.pkg})`,
      // Preserve app/event evidence without unrelated user-property/device data.
      more: [`App: ${this.pkg}`, `Event time: ${fa.ts}`, `Parameters: ${JSON.stringify(fa.params)}`], fa,
    }));
  }
}
