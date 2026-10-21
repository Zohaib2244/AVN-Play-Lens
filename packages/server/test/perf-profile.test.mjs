// Parsers for performance sampling and the device/app profile, on adb output samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseProcStat, parseSfLatency, pickLayer, parseMeminfo, parseBattery, parseThermal, parseGpu, PerfModel, PerfSampler } from '../src/perf/sampler.mjs';
import { parseDeviceProfile, parseAppProfile, zipNames, sdksFromNames } from '../src/device/profile.mjs';

test('perf parsers', () => {
  assert.equal(parseProcStat('18342 (com.avn.demo) S 1 2 3 4 5 6 7 8 9 10 1200 340 0 0 20 0 50'), 1540);
  assert.equal(parseProcStat('18342 (Unity Main) R 1 2 3 4 5 6 7 8 9 10 7 3 0'), 10, 'process names with spaces');

  const lat = parseSfLatency('16666666\n1000000000 1000016000 999000000\n1000016666 1000033000 1000010000\n0 9223372036854775807 0\n\n');
  assert.equal(lat.periodMs, 16.666666);
  assert.deepEqual(lat.frames, [1000.016, 1000.033]);

  const list = 'com.avn.demo/com.unity3d.player.UnityPlayerActivity#0\nSurfaceView[com.avn.demo/com.unity3d.player.UnityPlayerActivity](BLAST)#123\nBackground for SurfaceView[com.avn.demo/com.unity3d.player.UnityPlayerActivity]#124\nStatusBar#5';
  assert.equal(pickLayer(list, 'com.avn.demo'), 'SurfaceView[com.avn.demo/com.unity3d.player.UnityPlayerActivity](BLAST)#123');
  assert.equal(pickLayer('StatusBar#5', 'com.avn.demo'), null);

  const mem = parseMeminfo(' App Summary\n                       Pss(KB)\n           Java Heap:    24000\n         Native Heap:    81000\n            Graphics:   153600\n               TOTAL PSS:   612352            TOTAL RSS:   700000');
  assert.equal(mem.totalMb, 598);
  assert.equal(mem.graphicsMb, 150);
  assert.equal(parseMeminfo('        TOTAL   102400    20000').totalMb, 100, 'older format');

  assert.deepEqual(parseBattery('Current Battery Service state:\n  status: 2\n  level: 75\n  temperature: 347\n'), { level: 75, temp: 34.7, charging: true });
  const th = parseThermal('IsStatusOverride: false\nThermal Status: 2\nCurrent temperatures from HAL:\n\tTemperature{mValue=41.5, mType=0, mName=cpu-0-0, mStatus=0}\n\tTemperature{mValue=44.25, mType=0, mName=cpu-1-0, mStatus=0}\n\tTemperature{mValue=35.1, mType=3, mName=skin, mStatus=0}');
  assert.deepEqual(th, { status: 2, cpuTemp: 44.25 });
  assert.equal(parseGpu('23 %'), 23);
  assert.equal(parseGpu('500 1000'), 50);
  assert.equal(parseGpu(''), null);
});

test('pickLayer copes with the hex id newer Android puts before layer names', () => {
  const list = [
    'ActivityRecord{143053408 u0 com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity t454}#48637',
    '2975d79 com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity#48653',
    'Bounds for - com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity#48717',
    '552614a SurfaceView[com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity]#48718',
    '552614a SurfaceView[com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity](BLAST)#48719',
    'Background for 552614a SurfaceView[com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity]#48720',
  ].join('\n');
  assert.equal(pickLayer(list, 'com.flow.puzzle.game'), '552614a SurfaceView[com.flow.puzzle.game/com.unity3d.player.UnityPlayerActivity](BLAST)#48719');
});

// adb hands back the phone's exit code. The GPU probe finds no readable file on many phones
// (exit 1), and that used to make every sample fail, so Performance never got any data.
test('sampler records samples even when the phone commands exit non-zero', async () => {
  const exit1 = (stdout) => Object.assign(new Error('Command failed'), { code: 1, stdout });
  const SEP = '\n__PLAYLENS__\n';
  const adb = {
    async shell(_serial, cmd) {
      if (cmd.startsWith('cat /sys/devices/system/cpu/possible')) throw exit1(`0-7${SEP}`);
      if (cmd.startsWith('pidof')) return '4242\n';
      if (cmd.startsWith('dumpsys SurfaceFlinger --list')) return '552614a SurfaceView[com.avn.demo/Act](BLAST)#1\n';
      return ['4242 (x) S 1 2 3 4 5 6 7 8 9 10 100 50 0', '16666666\n', '', '    TOTAL PSS:   102400', '  level: 80\n  temperature: 350'].join(SEP);
    },
  };
  const model = new PerfModel();
  const sampler = new PerfSampler({ adb, serial: 'phone', pkg: 'com.avn.demo', model });
  await sampler.step();
  assert.equal(model.samples.length, 1);
  assert.equal(model.info.cores, 8);
  assert.equal(model.info.gpu, 'unreadable');
  assert.equal(model.info.fps, 'ok');
  assert.equal(model.samples[0].mem, 100);
});

test('sampler says the game is not running when pidof finds nothing', async () => {
  const adb = {
    async shell(_serial, cmd) {
      if (cmd.startsWith('pidof')) throw Object.assign(new Error('Command failed'), { code: 1, stdout: '' });
      return '0-7\n__PLAYLENS__\n';
    },
  };
  const model = new PerfModel();
  await new PerfSampler({ adb, serial: 'phone', pkg: 'com.avn.demo', model }).step();
  assert.equal(model.info.fps, 'not-running');
  assert.equal(model.samples.length, 0);
});

test('perf model: frame times, 1% low, stutters', () => {
  const m = new PerfModel();
  m.addFrames([...Array(990).fill(16.7), ...Array(10).fill(120)]);
  for (let i = 0; i < 10; i++) m.add({ t: i * 1000, fps: i < 9 ? 60 : 20, cpu: 100, mem: 500 + i, gpu: null, temp: 34 });
  const s = m.summary();
  assert.equal(s.frames, 1000);
  assert.equal(s.stutters, 10);
  assert.equal(Math.round(s.medianFps), 59);
  assert.ok(s.lowFps < 10, '1% low reflects the 120 ms frames');
  assert.equal(s.under30, 0.1);
  assert.equal(s.mem.max, 509);
  assert.equal(s.gpu, null);
  const d = m.delta();
  assert.equal(d.samples.length, 10);
  assert.equal(m.delta().samples.length, 0);
});

test('device and app profile parsers', () => {
  const dev = parseDeviceProfile([
    '[ro.product.manufacturer]: [samsung]\n[ro.product.model]: [SM-A515U]\n[ro.build.version.release]: [13]\n[ro.build.version.sdk]: [33]\n[ro.soc.manufacturer]: [Samsung]\n[ro.soc.model]: [Exynos 9611]\n[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a,armeabi]\n',
    'MemTotal:        3670016 kB\n',
    'Physical size: 1080x2400\nPhysical density: 420\n',
    'GLES: ARM, Mali-G72, OpenGL ES 3.2 v1.r38p1-01bet0\n',
    'fps=60.0\nfps=60.0\n',
    '0-7\n',
    'Current Battery Service state:\n  level: 75\n  temperature: 347\n',
  ].join('__PLAYLENS__'));
  assert.equal(dev.model, 'SM-A515U');
  assert.equal(dev.chipset, 'Samsung Exynos 9611');
  assert.equal(dev.ramGb, 3.5);
  assert.equal(dev.tier, 'Mid-range');
  assert.equal(dev.gpu, 'ARM, Mali-G72');
  assert.deepEqual(dev.screen, { w: 1080, h: 2400, dpi: 420, override: null });
  assert.equal(dev.refreshHz, 60);
  assert.equal(dev.cores, 8);
  assert.equal(dev.batteryTemp, 34.7);

  const app = parseAppProfile(`Packages:
  Package [com.flow.puzzle.game] (6b2):
    versionCode=2 minSdk=25 targetSdk=36
    versionName=0.0.2
    primaryCpuAbi=arm64-v8a
    installerPackageName=com.google.android.packageinstaller
    pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]
    firstInstallTime=2026-10-20 23:20:01
    requested permissions:
      android.permission.INTERNET
      com.google.android.gms.permission.AD_ID
      android.permission.POST_NOTIFICATIONS
      android.permission.BLUETOOTH_CONNECT: restricted=true
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1
      runtime permissions:
        android.permission.POST_NOTIFICATIONS: granted=true, flags=[ USER_SET ]
        android.permission.BLUETOOTH_CONNECT: granted=false, flags=[ ]
`, '130000000\n1000000\n');
  assert.equal(app.versionName, '0.0.2');
  assert.equal(app.targetSdk, 36);
  assert.equal(app.minSdk, 25);
  assert.equal(app.debuggable, false);
  assert.equal(app.adId, true);
  assert.equal(app.sizeBytes, 131000000);
  assert.deepEqual(app.sensitive.map((p) => [p.name, p.granted]), [['Notifications', true], ['Nearby devices (Bluetooth)', false]]);
});

test('APK central directory -> SDKs', () => {
  // Build a tiny zip: local headers + central directory + EOCD.
  const files = [
    ['META-INF/com.applovin_applovin-sdk.version', '13.0.1'],
    ['META-INF/com.unity3d.ads_unity-ads.version', '4.12.3'],
    ['META-INF/androidx.core_core.version', '1.13.0'],
    ['lib/arm64-v8a/libil2cpp.so', 'x'],
  ];
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, cd, eocd]);

  const r = zipNames(zip, zip.length);
  assert.equal(r.names.length, 4);
  assert.deepEqual(sdksFromNames(r.names).map((s) => s.name), ['AppLovin MAX', 'Unity Ads', 'IL2CPP']);
  const tail = zip.subarray(zip.length - 30);
  assert.ok(zipNames(tail, zip.length).need > 0, 'asks for more when the directory starts before the tail');
});
