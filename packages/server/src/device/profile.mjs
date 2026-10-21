// Device and app profile over adb: hardware, screen, build, the game's version and target
// API, permissions, and which SDKs are inside the installed APK.
import { inflateRawSync } from 'node:zlib';
import { parseGetprop } from './info.mjs';

const SEP = '__PLAYLENS__';

// ── Device ──────────────────────────────────────────────────────────────────

export function parseDeviceProfile(text) {
  const [props = '', meminfo = '', wm = '', gles = '', fps = '', cpus = '', battery = ''] = text.split(SEP);
  const p = parseGetprop(props);
  const ramKb = Number(/MemTotal:\s+(\d+)/.exec(meminfo)?.[1]) || null;
  const size = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
  const override = /Override size:\s*(\d+)x(\d+)/.exec(wm);
  const density = /Physical density:\s*(\d+)/.exec(wm)?.[1];
  const glesLine = /GLES:\s*(.+)/.exec(gles)?.[1]?.trim() ?? null;
  const hz = Math.max(0, ...[...fps.matchAll(/(?:fps=|renderFrameRate |refresh-rate\s*:\s*)([\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite));
  const range = /(\d+)-(\d+)/.exec(cpus.trim());
  const cores = range ? Number(range[2]) - Number(range[1]) + 1 : null;
  const soc = [p['ro.soc.manufacturer'], p['ro.soc.model']].filter(Boolean).join(' ') || p['ro.hardware.chipname'] || p['ro.board.platform'] || p['ro.hardware'] || null;
  const ramGb = ramKb ? ramKb / 1048576 : null;
  const level = Number(/^\s*level:\s*(\d+)/m.exec(battery)?.[1]);
  const temp = Number(/^\s*temperature:\s*(\d+)/m.exec(battery)?.[1]);
  return {
    manufacturer: p['ro.product.manufacturer'] || null,
    model: p['ro.product.model'] || null,
    device: p['ro.product.device'] || null,
    android: p['ro.build.version.release'] || null,
    sdk: Number(p['ro.build.version.sdk']) || null,
    securityPatch: p['ro.build.version.security_patch'] || null,
    build: p['ro.build.display.id'] || null,
    chipset: soc,
    abis: (p['ro.product.cpu.abilist'] || p['ro.product.cpu.abi'] || '').split(',').filter(Boolean),
    cores,
    ramGb: ramGb ? Math.round(ramGb * 10) / 10 : null,
    gpu: glesLine ? glesLine.split(',').slice(0, 2).join(',').trim() : null,
    gles: glesLine,
    screen: size ? { w: Number(size[1]), h: Number(size[2]), dpi: density ? Number(density) : null, override: override ? `${override[1]}x${override[2]}` : null } : null,
    refreshHz: hz > 0 ? Math.round(hz) : null,
    battery: Number.isFinite(level) ? level : null,
    batteryTemp: Number.isFinite(temp) ? temp / 10 : null,
    // A rough class from RAM; labelled as a guess in the UI.
    tier: ramGb == null ? null : ramGb < 3.2 ? 'Low-end' : ramGb < 6.5 ? 'Mid-range' : 'High-end',
  };
}

export async function readDeviceProfile(adb, serial) {
  const cmd = [
    'getprop',
    'cat /proc/meminfo | head -3',
    'wm size; wm density',
    "dumpsys SurfaceFlinger | grep -m1 'GLES'",
    "dumpsys display | grep -o -m3 -E 'renderFrameRate [0-9.]+|fps=[0-9.]+'",
    'cat /sys/devices/system/cpu/possible',
    'dumpsys battery',
  ].join(`; echo ${SEP}; `);
  return parseDeviceProfile(await adb.shell(serial, cmd, { timeout: 15000 }));
}

// ── App ─────────────────────────────────────────────────────────────────────

const DANGEROUS = {
  'android.permission.CAMERA': 'Camera',
  'android.permission.RECORD_AUDIO': 'Microphone',
  'android.permission.ACCESS_FINE_LOCATION': 'Precise location',
  'android.permission.ACCESS_COARSE_LOCATION': 'Approximate location',
  'android.permission.ACCESS_BACKGROUND_LOCATION': 'Background location',
  'android.permission.READ_CONTACTS': 'Contacts',
  'android.permission.GET_ACCOUNTS': 'Accounts',
  'android.permission.READ_PHONE_STATE': 'Phone state',
  'android.permission.READ_PHONE_NUMBERS': 'Phone numbers',
  'android.permission.CALL_PHONE': 'Phone calls',
  'android.permission.READ_SMS': 'SMS',
  'android.permission.READ_CALENDAR': 'Calendar',
  'android.permission.READ_EXTERNAL_STORAGE': 'Storage (read)',
  'android.permission.WRITE_EXTERNAL_STORAGE': 'Storage (write)',
  'android.permission.READ_MEDIA_IMAGES': 'Photos',
  'android.permission.READ_MEDIA_VIDEO': 'Videos',
  'android.permission.READ_MEDIA_AUDIO': 'Audio files',
  'android.permission.BODY_SENSORS': 'Body sensors',
  'android.permission.ACTIVITY_RECOGNITION': 'Physical activity',
  'android.permission.BLUETOOTH_CONNECT': 'Nearby devices (Bluetooth)',
  'android.permission.BLUETOOTH_SCAN': 'Nearby devices (scan)',
  'android.permission.NEARBY_WIFI_DEVICES': 'Nearby Wi-Fi devices',
  'android.permission.POST_NOTIFICATIONS': 'Notifications',
  'android.permission.SYSTEM_ALERT_WINDOW': 'Draw over other apps',
  'android.permission.QUERY_ALL_PACKAGES': 'See all installed apps',
  'android.permission.REQUEST_INSTALL_PACKAGES': 'Install other apps',
};

// Section of `dumpsys package` starting at a header like "requested permissions:", one item per indented line.
function section(text, header) {
  const i = text.indexOf(`${header}:`);
  if (i < 0) return [];
  const lines = text.slice(i + header.length + 1).split(/\r?\n/).slice(1);
  const indent = /^(\s*)/.exec(lines[0] ?? '')?.[1].length ?? 0;
  const out = [];
  for (const l of lines) {
    const ind = /^(\s*)/.exec(l)[1].length;
    if (!l.trim() || ind < indent || /^\s*[\w ]+:\s*$/.test(l)) break;
    out.push(l.trim());
  }
  return out;
}

export function parseAppProfile(text, sizesText = '') {
  const pick = (re) => re.exec(text)?.[1] ?? null;
  const requested = section(text, 'requested permissions').map((l) => l.split(/[\s,:]/)[0]);
  const runtime = Object.fromEntries(section(text, 'runtime permissions').map((l) => {
    const m = /^([\w.]+): granted=(\w+)/.exec(l);
    return m ? [m[1], m[2] === 'true'] : null;
  }).filter(Boolean));
  const sizes = sizesText.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return {
    versionName: pick(/versionName=(\S+)/),
    versionCode: Number(pick(/versionCode=(\d+)/)) || null,
    minSdk: Number(pick(/minSdk=(\d+)/)) || null,
    targetSdk: Number(pick(/targetSdk=(\d+)/)) || null,
    abi: pick(/primaryCpuAbi=(\S+)/),
    installer: pick(/installerPackageName=(\S+)/) ?? pick(/installInitiatingPackageName=(\S+)/),
    debuggable: /pkgFlags=\[[^\]]*DEBUGGABLE/.test(text),
    firstInstall: pick(/firstInstallTime=([^\n]+)/)?.trim() ?? null,
    lastUpdate: pick(/lastUpdateTime=([^\n]+)/)?.trim() ?? null,
    sizeBytes: sizes.length ? sizes.reduce((a, b) => a + b, 0) : null,
    splits: sizes.length,
    permissions: requested,
    adId: requested.includes('com.google.android.gms.permission.AD_ID'),
    sensitive: requested.filter((p) => DANGEROUS[p]).map((p) => ({ id: p, name: DANGEROUS[p], granted: runtime[p] ?? null })),
  };
}

export async function readAppProfile(adb, serial, pkg) {
  const [dump, sizes] = await Promise.all([
    adb.shell(serial, `dumpsys package ${pkg}`, { timeout: 15000 }),
    adb.shell(serial, `for p in $(pm path ${pkg} | sed 's/^package://'); do stat -c %s "$p"; done`, { timeout: 10000 }).catch(() => ''),
  ]);
  return parseAppProfile(dump, sizes);
}

// ── SDKs inside the APK ─────────────────────────────────────────────────────
// Gradle copies each library's "META-INF/<group>_<artifact>.version" file into the APK, and
// native SDKs ship lib/<abi>/lib*.so. Reading only the ZIP central directory (the end of the
// file) is enough to list them, without pulling the whole APK.

const SDK_ARTIFACTS = [
  [/^com\.applovin_applovin-sdk/, 'AppLovin MAX'],
  [/^com\.google\.android\.gms_play-services-ads(-lite)?$/, 'Google AdMob'],
  [/^com\.google\.android\.ump_user-messaging-platform/, 'Google UMP (consent)'],
  [/^com\.google\.firebase_firebase-analytics$/, 'Firebase Analytics'],
  [/^com\.google\.firebase_firebase-crashlytics$/, 'Firebase Crashlytics'],
  [/^com\.google\.firebase_firebase-messaging$/, 'Firebase Messaging'],
  [/^com\.google\.firebase_firebase-config$/, 'Firebase Remote Config'],
  [/^com\.unity3d\.ads_unity-ads/, 'Unity Ads'],
  [/^com\.adjust\.sdk_adjust-android$/, 'Adjust'],
  [/^com\.appsflyer_af-android-sdk$/, 'AppsFlyer'],
  [/^com\.bytebrew/, 'ByteBrew'],
  [/^com\.android\.billingclient_billing$/, 'Google Play Billing'],
  [/^com\.facebook\.android_audience-network-sdk$/, 'Meta Audience Network'],
  [/^com\.facebook\.android_facebook-core$/, 'Facebook SDK'],
  [/^com\.ironsource/, 'ironSource'],
  [/^com\.pangle|^com\.bytedance/, 'Pangle'],
  [/^com\.mbridge|^com\.mintegral/, 'Mintegral'],
  [/^com\.vungle/, 'Liftoff (Vungle)'],
  [/^com\.inmobi/, 'InMobi'],
  [/^com\.fyber|^com\.google\.ads\.mediation_fyber/, 'DT Exchange'],
  [/^io\.bidmachine/, 'BidMachine'],
  [/^com\.moloco/, 'Moloco'],
  [/^com\.yandex\.android_mobileads/, 'Yandex Ads'],
  [/^com\.bigossp|^sg\.bigo/, 'BIGO'],
  [/^com\.gameanalytics/, 'GameAnalytics'],
  [/^com\.onesignal/, 'OneSignal'],
  [/^com\.google\.android\.play_review/, 'Play In-App Review'],
  [/^com\.google\.android\.play_app-update/, 'Play In-App Update'],
  [/^com\.google\.android\.play_integrity/, 'Play Integrity'],
];

const SDK_LIBS = [
  [/^libapplovin|^libmax/i, 'AppLovin MAX'],
  [/^libFirebaseCpp/i, 'Firebase (C++)'],
  [/^libbytebrew/i, 'ByteBrew'],
  [/^libunity\.so$/, 'Unity engine'],
  [/^libil2cpp\.so$/, 'IL2CPP'],
  [/^libmonobdwgc|^libmono/i, 'Mono'],
];

// Central-directory file names from the tail of a ZIP. Returns null if the directory
// starts before the tail (then call again with a bigger tail).
export function zipNames(tail, fileSize) {
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return { names: null };
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const tailStart = fileSize - tail.length;
  if (cdOffset < tailStart) return { names: null, need: fileSize - cdOffset };
  let p = cdOffset - tailStart;
  const names = [];
  const files = [];
  for (let i = 0; i < count && p + 46 <= tail.length; i++) {
    if (tail.readUInt32LE(p) !== 0x02014b50) break;
    const method = tail.readUInt16LE(p + 10);
    const csize = tail.readUInt32LE(p + 20);
    const nlen = tail.readUInt16LE(p + 28);
    const elen = tail.readUInt16LE(p + 30);
    const clen = tail.readUInt16LE(p + 32);
    const local = tail.readUInt32LE(p + 42);
    const name = tail.toString('utf8', p + 46, p + 46 + nlen);
    names.push(name);
    files.push({ name, method, csize, local });
    p += 46 + nlen + elen + clen;
  }
  void cdSize;
  return { names, files };
}

export function sdksFromNames(names) {
  const found = new Map();
  for (const n of names) {
    let m = /^META-INF\/(.+)\.version$/.exec(n);
    if (m) {
      for (const [re, name] of SDK_ARTIFACTS) if (re.test(m[1]) && !found.has(name)) found.set(name, { name, artifact: m[1], file: n });
      continue;
    }
    m = /^lib\/[^/]+\/(lib[^/]+\.so)$/.exec(n);
    if (m) for (const [re, name] of SDK_LIBS) if (re.test(m[1]) && !found.has(name)) found.set(name, { name, lib: m[1] });
  }
  return [...found.values()];
}

const b64 = (s) => Buffer.from(s.replace(/\s+/g, ''), 'base64');

export async function readApkSdks(adb, serial, pkg) {
  const path = (await adb.shell(serial, `pm path ${pkg} | head -1`)).replace(/^package:/, '').trim();
  if (!path.endsWith('.apk')) return null;
  const size = Number((await adb.shell(serial, `stat -c %s "${path}"`)).trim());
  if (!size) return null;
  let tail = b64(await adb.shell(serial, `tail -c 1048576 "${path}" | base64`, { timeout: 30000 }));
  let r = zipNames(tail, size);
  if (!r.names && r.need && r.need < 16 * 1048576) {
    tail = b64(await adb.shell(serial, `tail -c ${r.need + 65536} "${path}" | base64`, { timeout: 60000 }));
    r = zipNames(tail, size);
  }
  if (!r.names) return null;
  const sdks = sdksFromNames(r.names);
  // Versions: the .version files are tiny; read each one's bytes straight from the APK.
  const byName = new Map(r.files.map((f) => [f.name, f]));
  await Promise.all(sdks.filter((s) => s.file).map(async (s) => {
    const f = byName.get(s.file);
    if (!f || f.csize > 256) return;
    try {
      const raw = b64(await adb.shell(serial, `tail -c +${f.local + 1} "${path}" | head -c ${30 + 512 + f.csize} | base64`));
      const start = 30 + raw.readUInt16LE(26) + raw.readUInt16LE(28);
      const data = raw.subarray(start, start + f.csize);
      s.version = (f.method === 8 ? inflateRawSync(data) : data).toString('utf8').trim().slice(0, 40) || null;
    } catch { /* version stays unknown */ }
  }));
  return sdks.map(({ name, version, artifact, lib }) => ({ name, version: version ?? null, from: artifact ? 'library' : 'native lib', artifact: artifact ?? lib }));
}
