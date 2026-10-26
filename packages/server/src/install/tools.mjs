// Finds what an app bundle install needs: bundletool and a Java runtime. Unity's Android
// module ships both, so a machine that builds with Unity usually needs nothing extra.
// Order: PLAYLENS_BUNDLETOOL / PLAYLENS_JAVA, Unity editors (newest first, keeping each editor's
// own pair together), JAVA_HOME, PATH.
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter, dirname } from 'node:path';
import { unityAndroidPlayerDirs } from '../adb/locate.mjs';

function newestJar(dir) {
  try {
    return readdirSync(dir).filter((f) => /^bundletool.*\.jar$/i.test(f))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((f) => join(dir, f))[0] ?? null;
  } catch { return null; }
}

export function locateBundleTools(env = process.env, platform = process.platform) {
  const javaExe = platform === 'win32' ? 'java.exe' : 'java';
  const searched = [];
  const seen = (p) => { searched.push(p); return existsSync(p); };
  let jar = null;
  let java = null;

  if (env.PLAYLENS_BUNDLETOOL && seen(env.PLAYLENS_BUNDLETOOL)) jar = env.PLAYLENS_BUNDLETOOL;
  if (env.PLAYLENS_JAVA && seen(env.PLAYLENS_JAVA)) java = env.PLAYLENS_JAVA;

  for (const dir of unityAndroidPlayerDirs(platform, env)) {
    if (jar && java) break;
    const unityJar = newestJar(join(dir, 'Tools'));
    searched.push(join(dir, 'Tools', 'bundletool-*.jar'));
    const unityJava = join(dir, 'OpenJDK', 'bin', javaExe);
    if (!jar && unityJar) jar = unityJar;
    if (!java && seen(unityJava)) java = unityJava;
  }
  if (!java && env.JAVA_HOME && seen(join(env.JAVA_HOME, 'bin', javaExe))) java = join(env.JAVA_HOME, 'bin', javaExe);
  if (!java) for (const dir of (env.PATH || '').split(delimiter)) if (dir && seen(join(dir, javaExe))) { java = join(dir, javaExe); break; }

  const keytool = java ? join(dirname(java), platform === 'win32' ? 'keytool.exe' : 'keytool') : null;
  return { jar, java, keytool: keytool && existsSync(keytool) ? keytool : null, searched: [...new Set(searched)] };
}
