#!/usr/bin/env node
// Fake adb used by test/fake-adb.test.mjs: one USB phone, plus a Wi-Fi phone that appears after QR pairing.
// State lives in files under FAKE_ADB_STATE; FAKE_LOG is the logcat capture it streams.
const fs = require('fs'); const path = require('path');
const dir = process.env.FAKE_ADB_STATE; const st = (f) => path.join(dir, f);
let args = process.argv.slice(2); let serial = null;
if (args[0] === '-s') { serial = args[1]; args = args.slice(2); }
const out = (s) => process.stdout.write(s);
const devices = () => {
  let l = 'FAKE123\tdevice product:panther model:Pixel_7 device:panther transport_id:1\n';
  if (fs.existsSync(st('connected'))) l += 'adb-WIFI999-AbCd._adb-tls-connect._tcp\tdevice product:dm1q model:SM_S911B device:dm1q transport_id:2\n';
  return l;
};
const cmd = args[0];
if (cmd === 'version') out('Android Debug Bridge version 1.0.41\nVersion 35.0.2-fake\n');
else if (cmd === 'track-devices') {
  let last = '';
  const tick = () => { const p = devices(); if (p !== last) { last = p; out(p.length.toString(16).padStart(4, '0') + p); } };
  tick(); setInterval(tick, 300);
} else if (cmd === 'devices') { out('List of devices attached\n' + devices());
} else if (cmd === 'disconnect') { fs.rmSync(st('connected'), { force: true }); out(`disconnected ${args[1]}\n`);
} else if (cmd === 'mdns') {
  let s = 'List of discovered mdns services\n';
  if (fs.existsSync(st('qrname'))) s += `${fs.readFileSync(st('qrname'), 'utf8').trim()}\t_adb-tls-pairing._tcp\t192.168.1.50:40123\n`;
  if (fs.existsSync(st('paired'))) s += 'adb-WIFI999-AbCd\t_adb-tls-connect._tcp\t192.168.1.50:37115\n';
  out(s);
} else if (cmd === 'pair') { fs.writeFileSync(st('paired'), '1'); fs.writeFileSync(st('connected'), '1'); out(`Successfully paired to ${args[1]} [guid=adb-WIFI999-AbCd]\n`); }
else if (cmd === 'connect') { fs.writeFileSync(st('connected'), '1'); out(`connected to ${args[1]}\n`); }
else if (cmd === 'forward') {
  if (args[1] === '--remove') out('');
  else { const port = process.env.FAKE_BRIDGE_PORT || '7421'; out(port + '\n'); }
} else if (cmd === 'exec-out') {
  process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]));
} else if (cmd === 'shell') {
  const c = args.slice(1).join(' ');
  const active = () => fs.existsSync(st('active-package')) ? fs.readFileSync(st('active-package'), 'utf8') : 'com.avn.demo';
  const propsFile = st('props.json');
  const props = fs.existsSync(propsFile) ? JSON.parse(fs.readFileSync(propsFile, 'utf8')) : {};
  if (c.startsWith('monkey -p ') || c.startsWith('am force-stop ')) {
    fs.appendFileSync(st('actions.jsonl'), JSON.stringify({ command: c, at: Date.now() }) + '\n');
    const pkg = c.split(' ')[2];
    if (c.startsWith('monkey')) { fs.writeFileSync(st('active-package'), pkg); out('Events injected: 1\n'); }
    else if (active() === pkg) fs.writeFileSync(st('active-package'), '');
  }
  else if (c.startsWith('date ')) out((Date.now() / 1000).toFixed(9) + '\n');
  else if (c.startsWith('wm size')) out('Physical size: 1080x2400\n');
  else if (c.startsWith('input ')) { fs.appendFileSync(st('actions.jsonl'), JSON.stringify({ command: c, at: Date.now() }) + '\n'); if (c.startsWith('input keyevent 3')) fs.writeFileSync(st('active-package'), 'com.android.launcher'); }
  else if (c.startsWith('uiautomator')) out('<?xml version="1.0"?><hierarchy><node bounds="[1000,60][1060,120]" clickable="true" content-desc="Close" /></hierarchy>\n');
  else if (c.startsWith('getprop debug.firebase')) out(`${props['debug.firebase.analytics.app'] || ''}\n${props['log.tag.FA'] || ''}\n${props['log.tag.FA-SVC'] || ''}\n`);
  else if (c.startsWith('setprop')) {
    for (const part of c.split(';')) { const m = /setprop (\S+) (\S+)/.exec(part.trim()); if (m) props[m[1]] = m[2]; }
    fs.writeFileSync(propsFile, JSON.stringify(props));
  } else if (c.includes('cat /proc/meminfo')) out('[ro.product.manufacturer]: [Google]\n[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\n[ro.build.version.sdk]: [34]\n[ro.soc.manufacturer]: [Google]\n[ro.soc.model]: [Tensor G2]\n[ro.product.cpu.abilist]: [arm64-v8a]\n__PLAYLENS__\nMemTotal:        7880000 kB\n__PLAYLENS__\nPhysical size: 1080x2400\nPhysical density: 420\n__PLAYLENS__\nGLES: ARM, Mali-G710, OpenGL ES 3.2\n__PLAYLENS__\nfps=90.0\n__PLAYLENS__\n0-7\n__PLAYLENS__\n  level: 71\n  temperature: 331\n');
  else if (c.startsWith('dumpsys package')) out('    versionCode=12 minSdk=24 targetSdk=34\n    versionName=1.2.0\n    primaryCpuAbi=arm64-v8a\n    installerPackageName=com.android.shell\n    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA DEBUGGABLE ]\n    requested permissions:\n      android.permission.INTERNET\n      com.google.android.gms.permission.AD_ID\n    install permissions:\n      android.permission.INTERNET: granted=true\n');
  else if (c.startsWith('for p in')) out('98000000\n');
  else if (c.startsWith('pm path')) out('package:/data/app/~~x/com.avn.demo-1/base.apk\n');
  else if (c.startsWith('cat /sys/devices/system/cpu/possible')) out('0-7\n__PLAYLENS__\n/sys/kernel/gpu/gpu_busy\n');
  else if (c.startsWith('pidof')) out(active() && c.includes(active()) ? '18342\n' : '');
  else if (c.startsWith('dumpsys SurfaceFlinger --list')) out('SurfaceView[com.avn.demo/com.unity3d.player.UnityPlayerActivity](BLAST)#88\nStatusBar#2\n');
  else if (c.startsWith('cat /proc/18342/stat')) {
    const now = process.hrtime.bigint();
    let lat = '16666666\n';
    for (let i = 127; i >= 0; i--) { const t = now - BigInt(i) * 16666666n - (i % 40 === 0 ? 50000000n : 0n); lat += `${t} ${t} ${t}\n`; }
    const ticks = Math.floor(Date.now() / 10 * 1.2) % 1e9;
    let o = `18342 (com.avn.demo) S 1 2 3 4 5 6 7 8 9 10 ${ticks} 0 0 0\n__PLAYLENS__\n${lat}__PLAYLENS__\n${40 + (Date.now() / 1000 % 10 | 0)}\n__PLAYLENS__\n`;
    o += c.includes('dumpsys meminfo') ? '        TOTAL PSS:   412000   TOTAL RSS: 500000\n            Graphics:    90000\n' : '\n';
    o += '__PLAYLENS__\n' + (c.includes('dumpsys battery') ? '  level: 71\n  temperature: 334\nThermal Status: 0\n' : '\n');
    out(o);
  }
  else if (c.startsWith('getprop')) out('[ro.product.model]: [' + (serial === 'FAKE123' ? 'Pixel 7' : 'Galaxy S23') + ']\n[ro.product.manufacturer]: [Google]\n[ro.build.version.release]: [14]\n[ro.build.version.sdk]: [34]\n__PLAYLENS__\nCurrent Battery Service state:\n  level: 71\n');
  else if (c.startsWith('pm list')) out('package:com.avn.demo\npackage:com.other.app\n');
  else if (c.startsWith('dumpsys activity')) out(active() ? `  topResumedActivity=ActivityRecord{8d1 u0 ${active()}/com.unity3d.player.UnityPlayerActivity t42}\n` : '');
  else if (c.startsWith('ps')) out(`  PID NAME\n${active() ? '18342 ' + active() + '\n' : ''}1 init\n`);
  else out('');
} else if (cmd === 'logcat') {
  const lines = fs.readFileSync(process.env.FAKE_LOG, 'utf8').split('\n').filter((l) => /^\d/.test(l));
  let i = 0; let wait = 0;
  setInterval(() => {
    if (i >= lines.length) { if (++wait > 25) { i = 0; wait = 0; } return; }   // loop like a relaunch
    const orig = lines[i].split(' ')[0]; const ts = (Date.now() / 1000).toFixed(3); let chunk = '';
    while (i < lines.length && lines[i].split(' ')[0] === orig) chunk += lines[i++].replace(/^\d+\.\d+/, ts) + '\n';
    out(chunk);
  }, 120);
} else out('');
