// Finds the adb binary. Order: PLAYLENS_ADB, PATH, ANDROID_HOME / ANDROID_SDK_ROOT,
// Unity Hub's bundled Android SDK (newest editor first), Android Studio's default SDK.
// Using Unity's own adb keeps PlayLens and Unity's Build and Run on the same adb version.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import os from 'node:os';

// Each Unity editor's Android module (newest editor first). It bundles adb, OpenJDK and bundletool.
export function unityAndroidPlayerDirs(platform = process.platform, env = process.env) {
  const roots = platform === 'darwin'
    ? [{ dir: '/Applications/Unity/Hub/Editor', tail: ['PlaybackEngines', 'AndroidPlayer'] }]
    : platform === 'win32'
      ? [{ dir: 'C:\\Program Files\\Unity\\Hub\\Editor', tail: ['Editor', 'Data', 'PlaybackEngines', 'AndroidPlayer'] }]
      : [{ dir: join(os.homedir(), 'Unity', 'Hub', 'Editor'), tail: ['Editor', 'Data', 'PlaybackEngines', 'AndroidPlayer'] }];
  if (platform === 'win32') {
    // Unity Hub permits moving editor installs off the system drive.
    const hubDir = join(env.APPDATA || join(os.homedir(), 'AppData', 'Roaming'), 'UnityHub');
    try {
      const custom = JSON.parse(readFileSync(join(hubDir, 'secondaryInstallPath.json'), 'utf8'));
      if (typeof custom === 'string' && custom.trim()) roots.push({ ...roots[0], dir: custom });
    } catch { /* Hub may not be installed/configured. */ }
  }
  const out = [];
  for (const { dir, tail } of roots) {
    let versions = [];
    try { versions = readdirSync(dir); } catch { continue; }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) out.push(join(dir, v, ...tail));
  }
  return out;
}

export function adbCandidates(env = process.env, platform = process.platform) {
  const exe = platform === 'win32' ? 'adb.exe' : 'adb';
  const list = [];
  if (env.PLAYLENS_ADB) list.push(env.PLAYLENS_ADB);
  for (const dir of (env.PATH || '').split(delimiter)) if (dir) list.push(join(dir, exe));
  for (const sdk of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) if (sdk) list.push(join(sdk, 'platform-tools', exe));
  for (const dir of unityAndroidPlayerDirs(platform, env)) list.push(join(dir, 'SDK', 'platform-tools', exe));
  if (platform === 'darwin') list.push(join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe));
  if (platform === 'win32' && env.LOCALAPPDATA) list.push(join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe));
  if (platform === 'linux') list.push(join(os.homedir(), 'Android', 'Sdk', 'platform-tools', exe));
  return [...new Set(list)];
}

export function locateAdb(env = process.env, platform = process.platform) {
  const searched = adbCandidates(env, platform);
  const found = searched.find((p) => existsSync(p)) ?? null;
  return { path: found, searched };
}
