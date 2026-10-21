// Device details and app control over adb shell.

export function parseGetprop(text) {
  const out = {};
  for (const m of text.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]/gm)) out[m[1]] = m[2];
  return out;
}

export async function readDeviceInfo(adb, serial) {
  const out = await adb.shell(serial, 'getprop; echo __PLAYLENS__; dumpsys battery', { timeout: 10000 });
  const [propsText, batteryText = ''] = out.split('__PLAYLENS__');
  const p = parseGetprop(propsText);
  const level = /^\s*level:\s*(\d+)/m.exec(batteryText)?.[1];
  return {
    model: p['ro.product.model'] || null,
    manufacturer: p['ro.product.manufacturer'] || null,
    android: p['ro.build.version.release'] || null,
    sdk: p['ro.build.version.sdk'] ? Number(p['ro.build.version.sdk']) : null,
    abi: p['ro.product.cpu.abi'] || null,
    battery: level ? Number(level) : null,
  };
}

export async function listPackages(adb, serial) {
  const out = await adb.shell(serial, 'pm list packages -3');
  return out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).sort();
}

// "topResumedActivity=ActivityRecord{8d1 u0 com.studio.puzzle/com.unity3d.player.UnityPlayerActivity t42}"
export function parseForeground(text) {
  const m = /(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(text);
  return m ? m[1] : null;
}

export async function foregroundPackage(adb, serial) {
  const out = await adb.shell(serial, "dumpsys activity activities | grep -E 'ResumedActivity'");
  return parseForeground(out);
}

// "ps -A -o PID,NAME" lines; the package process and its ":sub" processes.
export function parsePids(text, pkg) {
  const pids = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (m && (m[2] === pkg || m[2].startsWith(pkg + ':'))) pids.push(Number(m[1]));
  }
  return pids;
}

export async function pidsOf(adb, serial, pkg) {
  const out = await adb.shell(serial, 'ps -A -o PID,NAME', { timeout: 8000 });
  return parsePids(out, pkg);
}

export async function isDebuggable(adb, serial, pkg) {
  const out = await adb.shell(serial, `dumpsys package ${pkg} | grep -m1 'pkgFlags'`);
  return /DEBUGGABLE/.test(out);
}

export const appActions = {
  launch: (adb, serial, pkg) => adb.shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`),
  stop: (adb, serial, pkg) => adb.shell(serial, `am force-stop ${pkg}`),
  async restart(adb, serial, pkg) {
    await adb.shell(serial, `am force-stop ${pkg}`);
    return adb.shell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  },
};

export const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;
