// Firebase debug mode on the phone. Firebase only writes its events to logcat when the
// app is marked for debug and the FA tags are verbose; the game must restart to pick it up.
import { PACKAGE_RE } from './info.mjs';

export async function firebaseDebugStatus(adb, serial, pkg) {
  const out = await adb.shell(serial, 'getprop debug.firebase.analytics.app; getprop log.tag.FA; getprop log.tag.FA-SVC');
  const [app = '', fa = '', svc = ''] = out.split(/\r?\n/).map((l) => l.trim());
  const verbose = fa.toUpperCase() === 'VERBOSE' && svc.toUpperCase() === 'VERBOSE';
  return { app: app && app !== '.none.' ? app : null, verbose, on: !!pkg && app === pkg && verbose };
}

export async function setFirebaseDebug(adb, serial, pkg, on) {
  if (!PACKAGE_RE.test(pkg)) throw new Error('bad package name');
  const cmds = on
    ? [`setprop debug.firebase.analytics.app ${pkg}`, 'setprop log.tag.FA VERBOSE', 'setprop log.tag.FA-SVC VERBOSE']
    : ['setprop debug.firebase.analytics.app .none.', 'setprop log.tag.FA INFO', 'setprop log.tag.FA-SVC INFO'];
  await adb.shell(serial, cmds.join('; '));
  return firebaseDebugStatus(adb, serial, pkg);
}

export const FIREBASE_COMMANDS = (pkg) => [
  `adb shell setprop debug.firebase.analytics.app ${pkg}`,
  'adb shell setprop log.tag.FA VERBOSE',
  'adb shell setprop log.tag.FA-SVC VERBOSE',
];
