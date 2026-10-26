// Turns adb / bundletool install output into a reason a developer can act on.
// `retry: 'uninstall'` marks failures that a clean install fixes; that deletes the game's
// data on the phone, so the page asks before doing it.

const RULES = [
  [/INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_SHARED_USER_INCOMPATIBLE|signatures do not match|INCONSISTENT_CERTIFICATES/i, () => ({
    code: 'signature-mismatch',
    message: 'The phone already has this game signed with a different key',
    hint: 'This happens when the installed copy came from the Play Store, another computer, or a build with another keystore. Uninstall it first; that deletes the game\'s data on the phone.',
    retry: 'uninstall',
  })],
  [/INSTALL_FAILED_VERSION_DOWNGRADE|Downgrade detected|downgrade/i, (out) => {
    const m = /Update version code (\d+) is older than current (\d+)/i.exec(out);
    return {
      code: 'version-downgrade',
      message: m ? `The phone has versionCode ${m[2]}, newer than this build (${m[1]})` : 'The phone has a newer version of this game than this build',
      hint: 'Android only allows downgrading debuggable builds. Uninstall first (deletes the game\'s data), or raise Bundle Version Code in Unity.',
      retry: 'uninstall',
    };
  }],
  [/INSTALL_FAILED_INSUFFICIENT_STORAGE|not enough space|No space left/i, () => ({
    code: 'no-space', message: 'The phone does not have enough free storage for this build',
    hint: 'Free some space on the phone (old games, videos), then install again.', retry: 'again',
  })],
  [/INSTALL_FAILED_OLDER_SDK|requires newer sdk version|minSdkVersion/i, () => ({
    code: 'older-sdk', message: 'This build needs a newer Android version than the phone has',
    hint: 'Lower Minimum API Level in Unity Player Settings, or use a newer phone.', retry: null,
  })],
  [/INSTALL_FAILED_NO_MATCHING_ABIS|no matching ABIs|IncompatibleDeviceException.*ABI/i, () => ({
    code: 'no-matching-abi', message: 'The build has no native code for this phone\'s CPU',
    hint: 'Enable ARM64 (and ARMv7 for older phones) under Target Architectures in Unity Player Settings.', retry: null,
  })],
  [/IncompatibleDeviceException|no matching APKs|doesn't support|not compatible with the device/i, (out) => ({
    code: 'incompatible-device', message: 'The app bundle has nothing this phone can install',
    hint: (/IncompatibleDeviceException[^\n]*?:\s*([^\n]+)/.exec(out)?.[1] ?? 'Check the minimum API level and target architectures in Unity Player Settings.').trim(), retry: null,
  })],
  [/INSTALL_PARSE_FAILED_NO_CERTIFICATES|INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION.*signature|is not signed|no signature/i, () => ({
    code: 'unsigned', message: 'The build is not signed', hint: 'Rebuild it. In Unity, check the keystore under Player Settings → Publishing Settings.', retry: null,
  })],
  [/INSTALL_PARSE_FAILED|INSTALL_FAILED_INVALID_APK|Failed to parse|zip file is empty|END header not found/i, () => ({
    code: 'damaged', message: 'The phone could not read the build file', hint: 'It may be damaged or only partly written. Rebuild it and try again.', retry: null,
  })],
  [/INSTALL_FAILED_USER_RESTRICTED|Install canceled by user|INSTALL_FAILED_ABORTED/i, () => ({
    code: 'blocked-on-phone', message: 'The phone refused or cancelled the install',
    hint: 'Look at the phone: accept the install prompt. On Xiaomi turn on "Install via USB" in Developer options; on Samsung check that Auto Blocker is off.', retry: 'again',
  })],
  [/INSTALL_FAILED_VERIFICATION_FAILURE|VERIFICATION_TIMEOUT|Play Protect/i, () => ({
    code: 'play-protect', message: 'Google Play Protect blocked the install',
    hint: 'On the phone, tap "Install anyway", or turn off "Scan apps with Play Protect" in the Play Store → Play Protect settings.', retry: 'again',
  })],
  [/INSTALL_FAILED_TEST_ONLY/i, () => ({
    code: 'test-only', message: 'The build is marked test-only', hint: 'Rebuild without the testOnly flag.', retry: null,
  })],
  [/INSTALL_FAILED_DUPLICATE_PERMISSION/i, (out) => ({
    code: 'duplicate-permission', message: 'Another app on the phone already defines one of this game\'s permissions',
    hint: `Uninstall the other copy of the game (often a different package ID of the same project). ${/permission (\S+)/i.exec(out)?.[1] ? `Permission: ${/permission (\S+)/i.exec(out)[1]}` : ''}`.trim(), retry: null,
  })],
  [/INSTALL_FAILED_CONFLICTING_PROVIDER/i, (out) => ({
    code: 'conflicting-provider', message: 'Another app on the phone uses the same content provider name',
    hint: `Uninstall the other app that shares it (often another build of the same project). ${/provider (\S+)/i.exec(out)?.[1] ? `Provider: ${/provider (\S+)/i.exec(out)[1]}` : ''}`.trim(), retry: null,
  })],
  [/INSTALL_FAILED_MISSING_SPLIT/i, () => ({
    code: 'missing-split', message: 'The phone has split APKs installed for this game and this build is a single APK',
    hint: 'Uninstall first (deletes the game\'s data), then install.', retry: 'uninstall',
  })],
  [/device '?[^']*'? not found|no devices\/emulators found|device offline|device unauthorized|error: closed|No connected devices found|Unable to find the requested device/i, () => ({
    code: 'phone-disconnected', message: 'The phone disconnected during the install', hint: 'Reconnect it from Devices, then install again.', retry: 'again',
  })],
  [/Broken pipe|Connection reset|protocol fault|failed to write|transport error/i, () => ({
    code: 'transfer-failed', message: 'The connection to the phone dropped while copying the build',
    hint: 'Wireless debugging can drop on large builds. Try again, or connect with a USB cable.', retry: 'again',
  })],
  [/Keystore was tampered|password was incorrect|Cannot recover key|keystore.*not found/i, () => ({
    code: 'keystore', message: 'bundletool could not use the signing key', hint: 'Check ~/.android/debug.keystore. Deleting it lets PlayLens create a fresh debug key.', retry: null,
  })],
  [/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/i, () => ({
    code: 'java-too-old', message: 'The Java runtime is too old for bundletool',
    hint: 'Set PLAYLENS_JAVA to Java 11 or newer (Unity\'s bundled OpenJDK works).', retry: null,
  })],
  [/Unable to locate a Java Runtime|No Java runtime present/i, () => ({
    code: 'no-java', message: 'No working Java runtime was found',
    hint: 'Install Unity\'s Android Build Support module (it includes OpenJDK) or set PLAYLENS_JAVA.', retry: null,
  })],
  [/InvalidBundleException|Bundle is invalid|not a valid zip/i, () => ({
    code: 'damaged', message: 'bundletool says the app bundle is invalid', hint: 'Rebuild the .aab and try again.', retry: null,
  })],
];

// Java stack frames say nothing to a developer; keep the lines around them.
const lastLines = (out, n = 6) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^at [\w$.]+\(/.test(l) && !/^\.\.\. \d+ more$/.test(l)).slice(-n).join('\n');

export function explainInstallFailure(output, { fallback = 'The install failed' } = {}) {
  const out = String(output ?? '');
  for (const [re, make] of RULES) if (re.test(out)) return { ...make(out), output: lastLines(out) };
  const code = /\[?(INSTALL_[A-Z_]+)/.exec(out)?.[1];
  const bundletool = /\[BT:[^\]]*\] Error: ([^\n]+)/.exec(out)?.[1]?.trim();
  return {
    code: code ? code.toLowerCase().replace(/_/g, '-') : 'install-failed',
    message: code ? `${fallback}: ${code}` : bundletool ? `${fallback}: ${bundletool}` : fallback,
    hint: 'See the output below. Install again, or check the phone screen for a prompt.',
    retry: 'again',
    output: lastLines(out),
  };
}
