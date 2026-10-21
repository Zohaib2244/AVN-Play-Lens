// Who wrote a log line, and what it means. Used to group warnings and errors into
// "your game", "AVN plugin", "other SDKs" and "Android: safe to ignore".
//
// Ownership comes from the process, the tag and the stack trace, not from the tag alone:
// lines logged by Android's runtime inside the game process carry the (truncated) process
// name as their tag, but they are not the game's code.

// Known lines: plain-language meaning, and whether they're safe to ignore.
// owner: android | sdk | game. First match wins.
const KNOWN = [
  { tag: /^mali_winsys$/, meaning: 'GPU driver message, usually while a video ad plays.', owner: 'android', safe: true },
  { tag: /^audit$/, meaning: 'Android security audit log.', owner: 'android', safe: true },
  { tag: /^(GraphicBufferAllocator|AHardwareBuffer|SurfaceSyncer|Surface|BufferQueueProducer|BLASTBufferQueue)$/, meaning: 'Graphics buffers for a video or web view (usually an ad) being created or released.', owner: 'android', safe: true },
  { tag: /^InputManager-JNI$/, meaning: 'An ad screen (activity) closed.', owner: 'android', safe: true },
  { tag: /^libc$/, message: /Access denied finding property/, meaning: 'An SDK read a system property it is not allowed to.', owner: 'android', safe: true },
  { tag: /^(ACodec|MediaCodec|CCodec|OMX.*|cr_MediaCodecBridge|MediaCodecList|AudioCapabilities|VideoCapabilities|Codec2Client)$/, meaning: 'Video decoder messages, usually from ads playing video.', owner: 'android', safe: true },
  { tag: /^(WindowManager|BroadcastQueue|ActivityTaskManager|Settings|Gralloc\d?|AdrenoGLES.*|libEGL|OpenGLRenderer|ViewRootImpl.*|Choreographer|chatty|cr_media|cr_.*)$/, meaning: 'Android system housekeeping.', owner: 'android', safe: true },
  { tag: /^ServiceBindIntentUtils$/, meaning: 'A Google ads service is not available on this phone.', owner: 'android', safe: true },
  { tag: /^adservices$/, meaning: "An ad SDK tried Android's Privacy Sandbox measurement, which this phone doesn't have.", owner: 'android', safe: true },
  { message: /GC freed .* paused/, meaning: 'Garbage collection. Fine now and then; frequent or long pauses cause stutters.', owner: 'android', safe: true },
  { message: /^Suspending all threads took/, meaning: 'The runtime paused the game briefly (usually for garbage collection). Fine if under ~5 ms.', owner: 'android', safe: true },
  { message: /^(ClassLoaderContext|ClassLoader referenced unknown path|Attempt to load writable dex file|Missing inline cache|No such thread for suspend|Accessing hidden (field|method).*denied)/, meaning: 'Android runtime loading code, often for an SDK. Safe to ignore.', owner: 'android', safe: true },
  { message: /^No package ID [0-9a-f]+ found for ID/, meaning: 'Android resource lookup noise. Safe to ignore.', owner: 'android', safe: true },
  { message: /^hiddenapi: Accessing hidden/, meaning: 'A plugin uses a hidden Android API; Android blocked it. Keep SDKs updated so they keep working on new Android versions.', owner: 'sdk', safe: false },
  { message: /A resource failed to call close/, meaning: 'Some Java code (usually an SDK) opened a file or stream and did not close it. Usually harmless.', owner: 'sdk', safe: true },
  { message: /Unknown ad format: (\w+)/, meaning: 'AppLovin was asked for an ad format it does not know. Check the MAX plugin version.', owner: 'sdk', sdk: 'AppLovin MAX' },
  { message: /No value of type '\w+' exists for parameter key/, meaning: 'The game asked Remote Config for a key that is not in the Firebase console, so the default value is used.', owner: 'sdk', sdk: 'Firebase' },
  { message: /Auto-refresh will resume|BANNER does not exist|Trying to create a BANNER that was already created|MREC does not exist/, meaning: 'Banner calls made in an unexpected order (e.g. load twice, or load after hide). Check the banner code path.', owner: 'sdk', sdk: 'AppLovin MAX' },
  { message: /Unable to load a new ad\. An ad refresh has already been scheduled/, meaning: 'Banner refresh was already scheduled. Harmless unless banners never appear.', owner: 'sdk', sdk: 'AppLovin MAX', safe: true },
  { tag: /^Ads$/, message: /Not retrying to fetch app settings|Update ad debug logging/, meaning: 'Google Mobile Ads internal message.', owner: 'sdk', sdk: 'Google AdMob', safe: true },
  { message: /NoClassDefFoundError|ClassNotFoundException/, meaning: 'Something the code expects is missing. Check ProGuard/minify rules and that the library is included in the build.', owner: 'sdk' },
  { message: /DOTWEEN.*error inside a tween callback/i, meaning: 'A tween callback hit an error, usually an object destroyed before its tween finished.', owner: 'game' },
  { message: /^NullReferenceException/, meaning: 'Code used an object that is null or destroyed. The first line of the stack shows where.', owner: 'game' },
  { message: /reference is not assigned/, meaning: 'A component reference is empty in the scene. Assign it in the inspector.', owner: 'game' },
];

// Log tags that belong to SDKs.
const SDK_TAGS = [
  [/^(AppLovinSdk|AppLovinMax|AppLovin|MaxUnityAdManager|MaxAdView|MaxRewardedAd|MaxInterstitialAd|ALSdk)/i, 'AppLovin MAX'],
  [/^(Ads|GMA|GoogleMobileAds|AdMob|UserMessagingPlatform|UMP)/, 'Google AdMob'],
  [/^(FA|FA-SVC|FirebaseApp|FirebaseRemoteConfig|FirebaseInstallations|FirebaseMessaging|FirebaseCrashlytics|FirebaseInitProvider|FirebaseSessions|Firebase.*)$/, 'Firebase'],
  [/^(UnityAds|UnityAdsSdk)/, 'Unity Ads'],
  [/^(Adjust)/, 'Adjust'],
  [/^(AppsFlyer)/i, 'AppsFlyer'],
  [/^(ByteBrew)/i, 'ByteBrew'],
  [/^(IronSource|LevelPlay)/i, 'ironSource'],
  [/^(Facebook|AudienceNetwork|FBAudienceNetwork)/, 'Meta'],
  [/^(Pangle|TTAd|PAG)/, 'Pangle'],
  [/^(Mintegral|MBridge)/i, 'Mintegral'],
  [/^(Vungle|Liftoff)/i, 'Liftoff'],
  [/^(InMobi)/i, 'InMobi'],
  [/^(BidMachine)/i, 'BidMachine'],
  [/^(Moloco)/i, 'Moloco'],
  [/^(Yandex|YandexAds)/i, 'Yandex'],
  [/^(BigoAds|Bigo)/i, 'BIGO'],
  [/^(Fyber|DTExchange|IA-)/i, 'DT Exchange'],
  [/^(BillingClient|BillingLogger|Purchasing|UnityIAP)/, 'Google Play Billing'],
];

// Stack frames / message text inside a Unity line that point at an SDK or the plugin.
const STACK_HINTS = [
  [/\bAVN\.|AVNPlugin|DiagnosticsHubAVNPlugin|GpAppTracking|GoogleAppTracking/, 'avn', null],
  [/GoogleMobileAds|com\.google\.android\.gms\.ads/, 'sdk', 'Google AdMob'],
  [/\bMaxSdk|AppLovin/, 'sdk', 'AppLovin MAX'],
  [/\bFirebase\./, 'sdk', 'Firebase'],
  [/UnityEngine\.Purchasing/, 'sdk', 'Google Play Billing'],
  [/\bByteBrew/, 'sdk', 'ByteBrew'],
];

// Tags of Android itself (anything else in the game's process with an unfamiliar tag is
// treated as an SDK or plugin, since Unity game code logs with the Unity tag).
const ANDROID_TAGS = /^(ActivityManager|ActivityThread|AndroidRuntime|art|ART|dalvikvm|DEBUG|crash_dump|libc|linker|System|System\.err|SurfaceFlinger|SurfaceControl|InputMethodManager|InputTransport|IInputConnectionWrapper|AudioTrack|AudioRecord|AudioManager|AudioSystem|MediaPlayer|NetworkSecurityConfig|TrafficStats|ProfileInstaller|Perf|PerfHint|AdrenoUtils|vulkan|Vulkan|HWUI|Gralloc.*|mali.*|ion|Looper|Process|GameManager|GameManagerService|Typeface|ApplicationLoaders|nativeloader|FeatureFlagsImplExport|WM-.*|DynamiteModule|zygote.*|Zygote|ConnectivityManager|LocalBroadcastManager|TetheringManager|ScrollView|AssetManager.*|ResourcesManager|Toast|CompatibilityChangeReporter|DecorView.*|PhoneWindow|ContentCatcher|AutofillManager|chromium|cr_.*|Bluetooth.*|NotificationManager|JobScheduler|ExoPlayer.*|MediaCodec.*|IMM|SoLoader|Accessibility.*)$/;

const COLOR_TAGS = /<\/?(color|b|i|size)[^>]*>/g;

export function cleanText(message) {
  return message.replace(COLOR_TAGS, '').replace(/\s*\|\s*AVNPLUGIN\s*$/, '').trim();
}

// Replace the parts of a message that change from one occurrence to the next, so repeats group.
export function normalize(message) {
  return cleanText(message)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '#')
    .slice(0, 180);
}

function known(entry, text) {
  for (const k of KNOWN) {
    if (k.tag && !k.tag.test(entry.tag)) continue;
    if (k.message && !k.message.test(text)) continue;
    return k;
  }
  return null;
}

export function sdkFromTag(tag) {
  for (const [re, name] of SDK_TAGS) if (re.test(tag)) return name;
  return null;
}

// The package name truncated the way logcat truncates process-name tags ("low.puzzle.game").
function isProcessTag(tag, pkg) {
  return !!pkg && tag.length >= 6 && (pkg === tag || pkg.endsWith(tag));
}

/**
 * Who owns a line. fromGame: the line came from one of the game's processes.
 * Returns { owner: 'game'|'avn'|'sdk'|'android', sdk, meaning, safe }.
 */
export function ownerOf(entry, { pkg, fromGame }) {
  const text = cleanText(entry.more ? `${entry.message}\n${entry.more.join('\n')}` : entry.message);
  if (entry.source === 'avn') return { owner: 'avn', sdk: null, ...pick(known(entry, text)) };
  const k = known(entry, text);
  if (entry.kind === 'java-crash' || entry.kind === 'native-crash' || entry.kind === 'anr') return { owner: 'game', sdk: null, meaning: 'The game crashed or stopped responding.', safe: false };

  if (entry.tag === 'Unity') {
    for (const [re, owner, sdk] of STACK_HINTS) if (re.test(text)) return { owner, sdk, ...pick(k) };
    return { owner: k?.owner === 'sdk' ? 'sdk' : 'game', sdk: k?.sdk ?? null, ...pick(k) };
  }
  if (k) return { owner: k.owner, sdk: k.sdk ?? sdkFromTag(entry.tag), ...pick(k) };

  const sdk = sdkFromTag(entry.tag);
  if (sdk) return { owner: 'sdk', sdk, meaning: null, safe: false };
  if (entry.tag === 'WM-WorkerWrapper' || entry.tag === 'WM-Processor') {
    if (/unity3d\.ads/i.test(text)) return { owner: 'sdk', sdk: 'Unity Ads', meaning: 'Unity Ads background job.', safe: true };
    return { owner: 'android', sdk: null, meaning: 'Background job (WorkManager).', safe: true };
  }
  if (!fromGame) return { owner: 'android', sdk: null, meaning: null, safe: true };
  if (isProcessTag(entry.tag, pkg) || ANDROID_TAGS.test(entry.tag)) return { owner: 'android', sdk: null, meaning: null, safe: true };
  return { owner: 'sdk', sdk: null, meaning: null, safe: false };
}

function pick(k) {
  return k ? { meaning: k.meaning, safe: !!k.safe } : { meaning: null, safe: false };
}

export function groupKey(entry, owner) {
  return `${owner.owner}|${owner.sdk ?? ''}|${entry.tag}|${normalize(entry.message)}`;
}
