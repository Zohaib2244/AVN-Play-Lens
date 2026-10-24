// Device actions a QA run needs beyond what device/info.mjs offers: port forwarding to
// the QA bridge, screenshots into a run folder, taps and keys, the phone's clock, the
// physical display size, and a uiautomator dump used to find an ad's close button.
import { PACKAGE_RE } from '../device/info.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const SERIAL_RE = /^[\w.:-]{1,64}$/;
export const KEYS = { back: 4, home: 3, power: 26, enter: 66, appSwitch: 187 };

export function assertSerial(serial) {
  if (typeof serial !== 'string' || !SERIAL_RE.test(serial)) throw Object.assign(new Error('Invalid device serial'), { statusCode: 400 });
  return serial;
}
export function assertPackage(pkg) {
  if (typeof pkg !== 'string' || !PACKAGE_RE.test(pkg) || pkg.length > 255) throw Object.assign(new Error('Invalid game package'), { statusCode: 400 });
  return pkg;
}

// `adb forward tcp:0 tcp:<remote>` lets adb pick a free local port and prints it.
export async function forward(adb, serial, remotePort) {
  const out = await adb.run(['forward', 'tcp:0', `tcp:${Number(remotePort)}`], { serial, timeout: 8000 });
  const port = Number(/(\d+)/.exec(out.trim())?.[1]);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`adb forward gave no port: ${out.trim() || '(empty)'}`);
  return port;
}
export async function removeForward(adb, serial, localPort) {
  if (!localPort) return;
  await adb.run(['forward', '--remove', `tcp:${localPort}`], { serial, timeout: 8000 }).catch(() => {});
}

export async function screencap(adb, serial) {
  const png = await adb.run(['exec-out', 'screencap', '-p'], { serial, encoding: 'buffer', timeout: 15000 });
  if (!Buffer.isBuffer(png) || png.length < 64 || !png.subarray(0, 8).equals(PNG)) throw new Error('Screenshot was not a PNG');
  return png;
}

export async function tap(adb, serial, x, y) {
  return adb.shell(serial, `input tap ${Math.round(x)} ${Math.round(y)}`, { timeout: 8000 });
}
export async function swipe(adb, serial, x1, y1, x2, y2, ms = 200) {
  return adb.shell(serial, `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(ms)}`, { timeout: 8000 });
}
export async function key(adb, serial, name) {
  const code = KEYS[name] ?? (Number.isInteger(name) ? name : null);
  if (code == null) throw new Error(`Unknown key ${name}`);
  return adb.shell(serial, `input keyevent ${code}`, { timeout: 8000 });
}

// "Physical size: 1080x2400" (and an optional "Override size:" when the user scaled the display)
export function parseDisplaySize(text) {
  const over = /Override size:\s*(\d+)x(\d+)/.exec(text);
  const phys = /Physical size:\s*(\d+)x(\d+)/.exec(text);
  const m = over ?? phys;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}
export async function displaySize(adb, serial) {
  return parseDisplaySize(await adb.shell(serial, 'wm size', { timeout: 8000 }));
}

// Phone clock in ms, so step windows use the same clock as logcat timestamps.
export async function deviceClockMs(adb, serial) {
  const out = await adb.shell(serial, 'date +%s.%N', { timeout: 3000 });
  const n = Number(out.trim());
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

// uiautomator dump: the XML of the current window. Ads from MAX/AdMob networks render their
// close control as a native view most of the time; a WebView creative gives nothing useful.
export async function uiDump(adb, serial) {
  try {
    const out = await adb.shell(serial, 'uiautomator dump /dev/tty 2>/dev/null', { timeout: 15000 });
    const start = out.indexOf('<?xml');
    return start >= 0 ? out.slice(start).replace(/UI hierchary dumped to.*$/s, '') : null;
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.includes('<?xml')) return err.stdout.slice(err.stdout.indexOf('<?xml'));
    return null;
  }
}

const CLOSE_WORDS = /\b(close|skip|dismiss|done|continue to app|x)\b/i;
// Pick the node that most looks like an ad's close button; returns its centre in pixels.
export function findCloseControl(xml) {
  if (!xml) return null;
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*?\/?>/g)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    const w = x2 - x1, h = y2 - y1;
    if (w <= 0 || h <= 0 || w > 400 || h > 400) continue;   // full-screen and banner-sized views are the ad, not its close
    const desc = (attrs['content-desc'] ?? '') + ' ' + (attrs.text ?? '');
    const id = attrs['resource-id'] ?? '';
    let score = 0;
    if (CLOSE_WORDS.test(desc)) score += 5;
    if (/close|skip|dismiss|btn_close|mute_close|x_button/i.test(id)) score += 4;
    if (attrs.clickable === 'true') score += 1;
    if (/^(×|✕|✖|X|x)$/.test((attrs.text ?? '').trim())) score += 3;
    if (score === 0) continue;
    nodes.push({ score, x: (x1 + x2) / 2, y: (y1 + y2) / 2, label: (desc.trim() || id).slice(0, 60) });
  }
  nodes.sort((a, b) => b.score - a.score);
  return nodes[0] ?? null;
}
