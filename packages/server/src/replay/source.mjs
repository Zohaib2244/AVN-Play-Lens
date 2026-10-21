// Replay mode: a pretend device that plays a saved logcat capture in a loop, with fresh
// timestamps and the original pacing (gaps capped so it stays lively). Used for
// development, demos and tests when no phone is connected. The bundled demo capture is
// synthetic; real captures can be dropped in with --replay <file>.
import { readFileSync } from 'node:fs';
import { parseLogcatLine } from '../logcat/parse.mjs';

export const REPLAY_SERIAL = 'replay';

export function replayDevice(pkg) {
  return {
    serial: REPLAY_SERIAL,
    state: 'device',
    transport: 'replay',
    props: {},
    info: { model: 'Replay device', manufacturer: 'AVN PlayLens', android: '14', sdk: 34, abi: null, battery: null },
    replay: true,
    packages: [pkg],
  };
}

export function replaySource(file, { speed = 1, maxGapMs = 1500 } = {}) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => parseLogcatLine(l));
  const parsed = lines.map(parseLogcatLine);
  const pids = new Set(parsed.filter((p) => p.tag !== 'ActivityManager').map((p) => p.pid));
  let timer = null;
  let i = 0;
  let clockMs = Date.now();

  const emit = (onLine) => {
    const p = parsed[i];
    const line = lines[i];
    const shifted = line.replace(/^\s*\d+\.\d+/, (clockMs / 1000).toFixed(3));
    onLine(shifted);
    const next = parsed[(i + 1) % parsed.length];
    const gap = i + 1 < parsed.length ? Math.min(Math.max(next.ts - p.ts, 0), maxGapMs) : 3000;
    i = (i + 1) % parsed.length;
    clockMs += gap;
    timer = setTimeout(() => emit(onLine), gap / speed);
  };

  return {
    start(onLine) {
      clockMs = Date.now();
      emit(onLine);
    },
    stop() {
      clearTimeout(timer);
    },
    pids: async () => [...pids],
  };
}

// Device and app profile for the replay device (made up, so the views have something to show).
export function replayProfile(pkg) {
  return {
    replay: true,
    device: {
      manufacturer: 'AVN PlayLens', model: 'Replay device', device: 'replay', android: '14', sdk: 34, securityPatch: '2026-09-05', build: 'replay',
      chipset: 'Qualcomm SM8450', abis: ['arm64-v8a', 'armeabi-v7a'], cores: 8, ramGb: 7.5, gpu: 'Qualcomm, Adreno (TM) 730', gles: 'Qualcomm, Adreno (TM) 730, OpenGL ES 3.2',
      screen: { w: 1080, h: 2400, dpi: 420, override: null }, refreshHz: 60, battery: 82, batteryTemp: 33.5, tier: 'High-end',
    },
    app: {
      versionName: '1.4.0', versionCode: 140, minSdk: 24, targetSdk: 35, abi: 'arm64-v8a', installer: 'com.android.shell', debuggable: true,
      firstInstall: '2026-10-20 10:12:03', lastUpdate: '2026-10-20 10:12:03', sizeBytes: 131_000_000, splits: 1,
      permissions: ['android.permission.INTERNET', 'com.google.android.gms.permission.AD_ID', 'android.permission.POST_NOTIFICATIONS'],
      adId: true,
      sensitive: [{ id: 'android.permission.POST_NOTIFICATIONS', name: 'Notifications', granted: true }],
    },
    sdks: [
      { name: 'AppLovin MAX', version: '13.0.1', from: 'library', artifact: 'com.applovin_applovin-sdk' },
      { name: 'Google AdMob', version: '23.4.0', from: 'library', artifact: 'com.google.android.gms_play-services-ads' },
      { name: 'Firebase Analytics', version: '22.1.2', from: 'library', artifact: 'com.google.firebase_firebase-analytics' },
      { name: 'Firebase Crashlytics', version: '19.2.0', from: 'library', artifact: 'com.google.firebase_firebase-crashlytics' },
      { name: 'Unity Ads', version: '4.12.3', from: 'library', artifact: 'com.unity3d.ads_unity-ads' },
      { name: 'Adjust', version: '5.0.1', from: 'library', artifact: 'com.adjust.sdk_adjust-android' },
      { name: 'Google Play Billing', version: '7.1.1', from: 'library', artifact: 'com.android.billingclient_billing' },
      { name: 'Unity engine', version: null, from: 'native lib', artifact: 'libunity.so' },
      { name: 'IL2CPP', version: null, from: 'native lib', artifact: 'libil2cpp.so' },
    ],
    pkg,
  };
}
