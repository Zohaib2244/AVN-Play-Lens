// Parsing for `adb devices -l`, `adb track-devices -l` and `adb mdns services`.

const STATES = ['device', 'offline', 'unauthorized', 'authorizing', 'connecting', 'recovery', 'sideload', 'bootloader', 'host', 'rescue'];

// One line: "<serial> <state> [key:value ...]". "no permissions (...)" has spaces.
export function parseDeviceLine(line) {
  const text = line.trim();
  if (!text || text.startsWith('List of devices') || text.startsWith('*')) return null;
  const [serial, ...rest] = text.split(/\s+/);
  if (!serial || rest.length === 0) return null;
  let state = rest[0];
  let propTokens = rest.slice(1);
  if (state === 'no' && rest[1] === 'permissions') {
    state = 'no permissions';
    propTokens = rest.filter((t) => /^\w+:/.test(t));
  } else if (!STATES.includes(state)) {
    state = 'unknown';
  }
  const props = {};
  for (const t of propTokens) {
    const i = t.indexOf(':');
    if (i > 0) props[t.slice(0, i)] = t.slice(i + 1);
  }
  return { serial, state, transport: transportOf(serial), props };
}

export function parseDeviceList(text) {
  return text.split(/\r?\n/).map(parseDeviceLine).filter(Boolean);
}

export function transportOf(serial) {
  return /:\d+$/.test(serial) || serial.includes('._adb-tls-connect._tcp') ? 'wifi' : 'usb';
}

// track-devices sends frames: 4 hex digits of length, then that many bytes of device list.
export class TrackFrameParser {
  constructor() {
    this.buf = '';
  }

  push(chunk) {
    this.buf += chunk;
    const frames = [];
    while (this.buf.length >= 4) {
      const len = parseInt(this.buf.slice(0, 4), 16);
      if (Number.isNaN(len)) {
        this.buf = '';
        break;
      }
      if (this.buf.length < 4 + len) break;
      frames.push(parseDeviceList(this.buf.slice(4, 4 + len)));
      this.buf = this.buf.slice(4 + len);
    }
    return frames;
  }
}

// "adb-R5CW31X8KPL-AbCdEf\t_adb-tls-connect._tcp\t192.168.1.42:37115"
export function parseMdnsServices(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || !parts[1].startsWith('_adb')) continue;
    const kind = parts[1].includes('pairing') ? 'pairing' : parts[1].includes('tls-connect') ? 'connect' : 'legacy';
    out.push({ name: parts[0], kind, address: parts[2] });
  }
  return out;
}
