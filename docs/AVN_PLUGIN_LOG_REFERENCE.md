# AVN Plugin — Log Reference (for automated runtime checks)

Every log line the **generic plugin code** writes, grouped by what it verifies. Game-specific scripts (`User Setup/*`, `GameAnalyticsEvents`, anything under the game's own folders) are **deliberately not covered**: they differ per game and must not be parsed by a shared checker.

Source of truth is the code under `Assets/_DT1_AdsPlugin/AVNPlugin/Scripts/Runtime`. Last reviewed 2026-10-20. Ads provider: **AppLovin MAX only**. App Open runs on **AdMob**.

---

## 1. Reading the logs

### 1.1 Gating

| Symbol | Effect |
|---|---|
| `USE_AVNADS_PLUGIN_DEBUG` | Turns on **all** `AVNLog` / hub lines (sections 1.2–1.4). Without it almost nothing below is written. **Remove it from release builds.** |
| `USE_BYTEBREW` | Compiles the ByteBrew service and sends. Not defined in Zombie Rush: every ByteBrew line in this doc is absent there. |

**Every line the plugin writes carries the keyword `| AVNPLUGIN`** (filter on it). Gating depends on severity:

- **Info** lines (`AVNLog`, hub statuses and counters): only written when `USE_AVNADS_PLUGIN_DEBUG` is defined.
- **Warnings and errors** (`AVNLogWarning` / `AVNLogError`): **always written**, with the same suffix and their normal Unity severity, so a setup mistake or SDK failure is visible even in a build without the symbol.

### 1.2 Line formats (logcat tag `Unity`)

| Kind | Format | Example |
|---|---|---|
| Hub status | `Status <Key> => <State>: <message> \| AVNPLUGIN` | `Status Ad.Rewarded => Loaded: Rewarded loaded \| AVNPLUGIN` |
| Hub counter | `Counter <Key> <Name>=<n>` (failures add ` reason=<text>`) | `Counter Ad.Interstitial.0 LoadCallsSent=3` |
| Plain log | `[<Class>.<Method>] <message> \| AVNPLUGIN` | `[MaxAdsProvider.OnSdkInitialized] MaxAdsProvider SDK Initialized \| AVNPLUGIN` |
| Plain log, no caller | `<message> \| AVNPLUGIN` | (used by hub lines) |
| Warning / error | Same two forms as above, logged as Unity Warning / Error, never gated | `[AVNPlugin.VerifyAdsScripts] BannerAdController reference is missing… \| AVNPLUGIN` |

Lines that used to be plain `Debug.Log` calls (consent/ATT, Firebase init, ANR, device tier, config errors, …) use the same forms; section 12.1 lists them. A message written as `GoogleAppTracking: …` therefore looks like `[GoogleAppTracking.<Method>] GoogleAppTracking: … \| AVNPLUGIN`.

Notes: `Counter … AdsLoaded` is the only counter line that carries the `[DiagnosticsHubAVNPlugin.IncrementAdsLoaded]` prefix. A status with an empty message is not logged. In the Editor lines are wrapped in `<color=cyan>` tags; on device they are plain.

### 1.3 Hub states

`Info, Initializing, Initialized, Failed, Idle, Loading, Loaded, Showing, Showed, Closed, Destroyed, Sending, Sent, SendFailed`

### 1.4 Hub keys

| Key | Covers |
|---|---|
| `SDK.Firebase` | Firebase init |
| `SDK.Firebase.EventVerified` | First Firebase event handed to the SDK after init (published once) |
| `SDK.RemoteConfig` | Remote config fetch |
| `RemoteConfig.Values` | Remote config values / cache |
| `SDK.AdsProvider` | MAX init (+ adapter summary) |
| `SDK.AdMob` | AdMob init (AVNPlugin's view) |
| `SDK.ByteBrew` | ByteBrew init (`USE_BYTEBREW` only) |
| `SDK.AppsFlyer` | Placeholder only, see gaps |
| `SDK.Purchaser` | In-app purchasing |
| `SDK.Init`, `SDK.InitCompleted` | Plugin init sequence markers (state `Info`) |
| `Ad.Interstitial` | Interstitial **flow** (TryShow, load queue, ad break) |
| `Ad.Interstitial.<slot>` | Interstitial **per-slot** events (load/show/callbacks) |
| `Ad.Rewarded`, `Ad.AppOpen` | Rewarded, App Open |
| `Ad.Banner.Standard`, `Ad.Banner.Mrec` | Banner, MREC |
| `Analytics.Event` | Every event sent through the plugin |
| `NativeRateUs`, `Notification` | Rate-us and notification prompts |

---

## 2. Startup sequence (what a healthy launch looks like)

Order with the current prefab (`StartOnInit`, AdMob CMP off). Items 5–9 run in parallel.

| # | Step | Pass line | Fail / timeout line |
|---|---|---|---|
| 1 | Awake | `Status SDK.Firebase => Idle: Waiting for initialization` (also `SDK.RemoteConfig`, `SDK.AppsFlyer`, `SDK.AdMob`, `SDK.AdsProvider`) | — |
| 2 | Start | `[AVNPlugin.Start] Start invoked; applying runtime IDs` | — |
| 3 | Cached config | `Status RemoteConfig.Values => Loading: Applying cached AdConfig`, `… Idle: Applied cached AdConfig: <json>` | `… Failed: TryApplyAdConfig failed: …` |
| 4 | Sequence accepted | `[AVNPlugin.InitializeServiceDependencies] Initialize accepted: starting initialization sequence`, `Status SDK.Init => Info: AdsManager initialization sequence started` | `Initialize ignored: already initialized` |
| 5 | MAX init | see 3.2 | see 3.2 |
| 6 | Firebase init | see 3.1 | see 3.1 |
| 7 | AdMob init (after Firebase + provider) | see 3.3 | see 3.3 |
| 8 | Remote config fetch | see 4 | see 4 |
| 9 | IAP | see 11 | see 11 |
| 10 | Done | `Status SDK.InitCompleted => Info: Plugin init completed; starting ad auto-load` | — |
| 11 | Auto-load (3 s later) | `[AVNPlugin.LoadAdsCoroutine] Auto-load starting: inter=True, rewarded=True, appOpen=…, mrec=…, banner=…` | — |

Timeouts: Firebase 20 s, ads provider 20 s. If either hits, the sequence **continues** and the failure is published.

---

## 3. SDK initialization

### 3.1 Firebase (`SDK.Firebase`)

| Event | Line |
|---|---|
| Start | `Status SDK.Firebase => Initializing: Initializing Firebase`, `… Initializing: Starting Firebase initialization`, `Checking Dependencies` |
| Success | `=================> Firebase Initialized Successfully =================>`, `Status SDK.Firebase => Initialized: Firebase initialized successfully`, `Firebase initialization succeeded` |
| Post-init | `Firebase post-init: userId=<id>, crashlyticsCollection=<bool>, consent=Granted (AdUserData, AnalyticsStorage, AdPersonalization, AdStorage; set unconditionally)` |
| Probe event | `Status SDK.Firebase.EventVerified => Sent: QA probe event avn_qa_probe handed to Firebase SDK` (**debug symbol only**) |
| Dependency failure | `=================> Firebase Initialization Failed =================>`, `Status SDK.Firebase => Failed: Firebase initialization failed. Dependency status: <status>` |
| Exception | error (always on) `Firebase initialization exception: <msg>`, `Status SDK.Firebase => Failed: Firebase initialization exception: <msg>` |
| Timeout | warning (always on) `Firebase initialization timed out. Continuing sequence.`, `Status SDK.Firebase => Failed: Firebase initialization timed out` |
| Manager missing | warning (always on) `Firebase init manager not found. Continuing sequence.` |

### 3.2 AppLovin MAX (`SDK.AdsProvider`)

| Event | Line |
|---|---|
| Start | `Status SDK.AdsProvider => Initializing: Starting SDK`, `[AVNPlugin.InitializeAdsProviderSequence] Provider init ad unit ids (priority order): <ids>`, `[MaxAdsProvider.Initialize] MaxAdsProvider Initialize called`, `MaxAdsProvider InitializeSdk ad unit ids: <ids>` |
| Success | `-------- MAX SDK Initialization Complete --------`, `MaxAdsProvider SDK Initialized`, `Status SDK.AdsProvider => Initialized: Ads provider SDK initialized` |
| Config | `MAX init config \| success=<bool> country=<cc> testMode=<bool> att=<status> consentGeo=<geo> consentState=<state>` |
| **Adapter, one per network** | `MAX adapter \| name=<network> adapterVersion=<v> sdkVersion=<v> status=<InitializedSuccess\|NotInitialized\|Initializing\|InitializedFailure\|InitializedUnknown\|DoesNotApply>` |
| Adapter summary | `MAX adapters: <ok>/<total> initialized; not ready: <name>=<status>, …` and the same on `Status SDK.AdsProvider => Info` |
| Failure | `Status SDK.AdsProvider => Failed: <message>` |
| Timeout | `Status SDK.AdsProvider => Failed: Ads provider initialization timed out after 20s` |
| No provider | `Status SDK.AdsProvider => Failed: No ads provider available (USE_MAX not defined)` |

Expected adapters in this project: BidMachine, BIGO, Pangle (ByteDance), Meta, DT Exchange (Fyber), Google AdMob, Google Ad Manager, InMobi, Mintegral, Moloco, Unity Ads, Liftoff (Vungle), Yandex, ironSource. `NotInitialized` is **not always a fault**: MAX only initializes a network that is enabled for one of your ad units.

### 3.3 AdMob (`SDK.AdMob`, plus `AdMobSdkInitializer`)

| Event | Line |
|---|---|
| Start | `Status SDK.AdMob => Initializing: Initializing AdMob SDK`, `[AdMobSdkInitializer.EnsureInitialized] AdMob SDK initialization started` |
| Success | `AdMob SDK initialized \| adapters=<n>`, one `AdMob adapter \| name=<class> state=<Ready\|NotReady> latencyMs=<n> desc=<text>` per adapter, `Status SDK.AdMob => Initialized: AdMob SDK initialized` |
| Failure | `AdMob SDK initialization FAILED: <message>`, `Status SDK.AdMob => Failed: <message>` |

### 3.4 Consent / ATT (`GoogleAppTracking`)

`User not in CMP country…`, `Google Mobile Ads initialization complete.`, `CMP disabled via inspector flag…`, `AdMob SDK init failed. Skipping CMP…` (warning), `Gathering consent.`, `GatherConsent called.`, `Consent updated. Status=<status>`, `Failed to gather consent with error: <err>` (error), `ATT already resolved with status=<s>…`, `CMP completed. Requesting iOS ATT authorization.`, `ATT callback received. Status=<s>…`, `Post-consent startup flow continuing. consentGranted=<bool>`, `Startup AppOpen request queued.`, `AVNPlugin.Initialize() called.` / `AVNPlugin init mode is <mode>, not StartByCMP…`. All prefixed `GoogleAppTracking: `. With `enableAdMobCMP: 0` and the user outside a CMP country, only the first and last appear.

### 3.5 ByteBrew (`USE_BYTEBREW` only, `SDK.ByteBrew`)

`Status SDK.ByteBrew => Initializing: Initializing ByteBrew` → `Initialized: ByteBrew initialized` / `Failed: <exception message>` / `Failed: ByteBrew initialization did not report ready state.` Plus `[ByteBrewService.Initialize] ByteBrew initialize requested`, `ByteBrew initialized successfully`, `ByteBrew init completed but ready state was false`, `ByteBrew init exception: <msg>`. Not defined in Zombie Rush: none of these appear there.

### 3.6 AppsFlyer

There is **no init log** (see section 14). Only the placeholder `Status SDK.AppsFlyer => Idle: Waiting for initialization`. Enable `isDebug` on the AppsFlyer object to get the native SDK's own request/response logs under tags `AppsFlyer_*`.

---

## 4. Remote config

`SDK.RemoteConfig` = the fetch. `RemoteConfig.Values` = what was in it.

| Step | Line |
|---|---|
| Request | `Status SDK.RemoteConfig => Initializing: FetchRemoteConfig requested`, `… Initializing: Fetching remote config` |
| Already fetching | `… Failed: FetchRemoteConfig ignored: fetch already in progress` |
| Fetch failed | `… Failed: FetchRemoteConfig failed during fetch phase: <exception>` |
| Activate failed | `… Failed: FetchRemoteConfig failed during activate phase: <exception>` |
| **Success (server round-trip)** | `Status SDK.RemoteConfig => Initialized: FetchRemoteConfig success: config fetched and activated (lastFetchStatus=<Success>, fetchTime=<utc>)` |
| Where values came from | `Remote config value sources \| AdConfig=<Remote\|Default\|Static>, AdIdsConfig=<…>, CMPEligibleUser=<…>` |
| Retry | `Status SDK.RemoteConfig => Initializing: Scheduling remote config retry <n>/<max> in <s>s`; limit: `… Failed: Remote config retry limit reached: <reason>` |
| Plugin-level result | `Status SDK.RemoteConfig => Initialized: Remote config fetched` / `Failed: <message>` |

Source meanings: `Remote` = the value came from the server; `Default` = key missing on the server; `Static` = type default.

| Value | Lines |
|---|---|
| `AdConfig` | `Status RemoteConfig.Values => Loaded: TryApplyAdConfig success, fromCache=<bool>`, `… Loaded: AdConfig updated from fetch : <json>` (or `loaded from cache : <json>`), then **`AdConfig applied \| EnableInterFromLevel=… InterAdDelay=… DelayBeforeFirstAd=… InterstitialShowMode=… RateUs=… Notification=… Banner=… Inter=… Rewarded=… AppOpen=… (RemoveAdsPurchased=…) ANRFixer=… WatchdogInter=… WatchdogRewarded=…`** — the parsed, effective values |
| `AdConfig` problems | `… Failed: TryApplyAdConfig empty payload, fromCache=<bool>`, `… Failed: TryApplyAdConfig failed: <msg>`, error (always on) `Failed to parse AdConfig: <msg>` |
| `AdIdsConfig` | `… Loaded: AdIdsConfig updated from fetch :<json>`; problems: `… Failed: AdIdsConfig was empty` / `AdIdsConfig json was invalid`; cache: `… Failed: No cached AdIdsConfig found` / `… Loading: Attempting to deserialize cached AdIdsConfig` |
| **Effective ad IDs** | `[AVNPlugin.ApplyMergedAdIds] Effective ad IDs \| remoteOverride=<bool> banner=… mrec=… rewarded=… inter=[a \| b \| …] appOpen1=… appOpen2=…` (the SDK key is **never** printed) |
| `CMPEligibleUser` | `… Loaded: Applied CMPEligibleUser=<bool> to IsUserInCMPCountry`; `… Failed: CMPEligibleUser was empty; keeping existing …` / `… parse failed for value='<v>'; keeping existing …` |
| Custom keys (registered by the game) | `… Idle: Registered custom key=<k>, type=<t>`; cached: `… Loaded: Using cached custom key value for key=<k>`, `… Loaded: Custom key=<k> value loaded from cache: <value>`; fetched: `… Loading: DispatchCustomKeys processing <n> registrations`, `… Loaded: Dispatched custom key=<k> source=<Remote\|Default\|Static> with value: <value>` |
| Side effects | `[PluginRemoteConfigData.Apply] EnableInterAd set to: <bool>`, `Status Ad.Interstitial => Idle: InterstitialShowMode updated to <mode>` |

Custom-key values are truncated in the log to 600 characters (`… (+N chars)`). **What the keys mean is per game**; the checker should only assert "dispatched with `source=Remote`", not their content.

---

## 5. Ads — common patterns

Every format follows the same chain. Use it to check a request end to end:

```
load requested → [Counter …LoadCallsSent] → provider "load sent" → SDKCallback Loaded | LoadFailed
show requested → [Counter …ShowCallsSent] → provider "show sent" → SDKCallback Displayed | DisplayFailed → Closed
revenue        → SDKCallback RevenuePaid → ad_impression (Firebase) + AppsFlyer logAdRevenue
```

MAX callback lines are `AVNLog` lines with caller info, e.g.
`[MaxAdsProvider.OnInterstitialLoadedEvent] SDKCallback | InterAd | Loaded | slot=0 unit=<id> network=<filling network> latencyMs=<n> \| AVNPLUGIN`.

All MAX callbacks log `unit`, `network` (the network that filled) and `latencyMs`. All **failures** log `unit=<id> code=<ErrorCode> msg=<text> networkCode=<n> networkMsg=<text> latencyMs=<n>`.

---

## 6. Interstitial (MAX)

Hub keys: **`Ad.Interstitial.<slot>`** for slot events, **`Ad.Interstitial`** for flow-level events. Show modes: `ShowDefault`, `ShowIterateSequence`, `ShowDefaultWithOneBackfill`, `ShowDefaultWithTwoBackfill`, `ShowThreeTierInterstitial`.

### 6.1 Load

| Step | Line |
|---|---|
| Blocked | `Status Ad.Interstitial => Failed: Load blocked: config/_provider/ads disabled` / `Load blocked: SDK not initialized`; `… Showing: Load ignored: interstitial currently showing`; `… Idle: Load ignored: state is <Loading\|Loaded>` |
| Queue problems | `… Failed: ProcessLoadQueues blocked: no provider`, `ProcessLoadQueue blocked: primary slot already loading` / `backfill slot already loading` / `invalid slot <n>`; slot: `ProcessLoadQueue: slot <n> already loaded` |
| Sent | `Counter Ad.Interstitial.<n> LoadCallsSent=<k>` → `MaxAdsProvider LoadInterstitial slot=<n> unit=<id>` → `MaxAdsProvider Interstitial load sent for slot=<n> unit=<id>` → `Status Ad.Interstitial.<n> => Loading: Loading interstitial slot <n>` |
| Empty id | `MaxAdsProvider LoadInterstitial blocked: ad unit id is empty, slot=<n>` |
| **Loaded** | `SDKCallback \| InterAd \| Loaded \| slot=<n> unit=… network=… latencyMs=…` → `[DiagnosticsHubAVNPlugin.IncrementAdsLoaded] Counter Ad.Interstitial.<n> AdsLoaded=<k>` → `Status Ad.Interstitial.<n> => Loaded: Interstitial slot <n> loaded` |
| Ignored callbacks | `… Info: Duplicate loaded callback ignored: slot already loaded (…)`, `Loaded callback ignored: slot is <state> (…)`, `Stale loaded callback ignored: slot not loading and provider not ready (…)`; MAX side: `SDKCallback \| InterAd \| Loaded ignored: no slot currently uses ad unit <id>` |
| **Load failed** | `SDKCallback \| InterAd \| LoadFailed \| slot=<n> unit=… code=… msg=… networkCode=… networkMsg=… latencyMs=…` → warning (always on) `Interstitial load failed (slot <n>): Interstitial slot <n> load failed: <code>` → `Counter Ad.Interstitial.<n> LoadCallsFailed=<k> reason=…` → `Status Ad.Interstitial.<n> => Failed: <message>` |
| Retry | `… Loading: Load failed, retrying in <s>s (retry <a>/<max>)`; end: `… Failed: Load retries exhausted after <n> attempts` / `Load failed; automatic retry is off`; `Load retry skipped: config/_provider/ads disabled` |
| Failure ignored | `… Info: Load failed callback ignored: slot is <state>. Message: …`, `Load failed callback but provider reports slot ready; keeping ad. Message: …` |
| Watchdog | `… Info: Load watchdog: provider ready but no loaded callback received; recovering`; timeout: `Load watchdog: no load callback for slot <n> after <s>s` (→ treated as a load failure). With the experimental switch on, also event `ADCallback_Missed` (section 10) |
| Reconcile | `… Failed: Reconcile: slot marked loaded but provider not ready; resetting state` |
| Three-tier | `Three-tier: slot 0 is already loading, skipping duplicate load request`, `…load already in progress`, `…already loaded, skipping load`, `…ID index <i> is out of range`, `…ID at index <i> is empty`, `…loading slot 0 with ID index <i> (<unit>)`, `…ID index <i-1> failed, trying index <i>`, `…all IDs exhausted (<n> tried)`, `…waterfall retries exhausted after <n> rounds` |

### 6.2 Show

| Step | Line |
|---|---|
| Entry | `[AVNPlugin.ShowInterAd] ShowInterAd result=<True\|False>` |
| Rejected | `Status Ad.Interstitial => Failed: TryShow blocked: config/_provider/ads disabled`, `TryShow rejected: interstitial already showing (current state: <s>)`, `TryShow rejected: not loaded, restarting load queue`, `TryShow blocked: SDK not initialized`, `CanShow False blocked display`, `Cooldown active Remaining Time: <s>`, `Delay before first interstitial active Remaining Time: <s>`; `… Idle: TryShow rejected: load already in progress` |
| No slot ready | `Counter Ad.Interstitial ShowCallsFailed=<k> reason=No interstitial slot ready` + event `ad_no_interstitial` / `ad_no_interstitial_reward` |
| Ad break panel | `… Idle: Ad Break Panel shown for <s> seconds`; `Counter … reason=Failed to dispatch interstitial show after ad break panel`; warning (always on) when no panel is assigned |
| Slot not ready | `Status Ad.Interstitial.<n> => Failed: Slot valid: '<unit>'`, `Slot Ready State In Provider: <bool>`, `Slot <n> not ready in provider (state: <s>)`, `Slot <n> is not configured` |
| Sent | `Counter Ad.Interstitial.<n> ShowCallsSent=<k>` → `Status Ad.Interstitial.<n> => Showing: <Showing default slot 0 …>` → `[HandleBeforeShow]`: `Counter …AdsDisplayed=<k>`, `Status … => Showing: Rewarded\|Non-rewarded`, event `ad_interstitial` (or `ad_interstitial_rewarded`) → `MaxAdsProvider ShowInterstitial sent for slot=<n> unit=<id> rewarded=<bool>` |
| Provider refused | `ShowInterstitial blocked: slot not found, slot=<n>` / `ShowInterstitial blocked: not ready, slot=<n>` |
| **Displayed** | `SDKCallback \| InterAd \| Displayed \| slot=<n> unit=… network=… latencyMs=…` → `Status Ad.Interstitial.<n> => Showed: Interstitial slot <n> shown` |
| **Display failed** | `SDKCallback \| InterAd \| DisplayFailed \| slot=<n> …error fields…` → warning (always on) `Interstitial show failed (slot <n>): …` → `Counter …ShowCallsFailed=<k> reason=…` → `Status … => Failed: <message>` + event `ad_no_interstitial` |
| **Closed** | `SDKCallback \| InterAd \| Closed \| slot=<n> …` → `Status Ad.Interstitial.<n> => Closed: Interstitial slot <n> closed` + event `USER_RETURN_STATUS` (`RETURNED_FROM_AD`) → reload |
| Duplicate close | `… Info: HandleClosed ignored: slot <n> is not the current shown slot (<m>)` |
| Show watchdog | `… Failed: Watchdog: slot <n> stuck Showing after <s>s — SDK dropped close callback. Forcing recovery.` then a normal Closed |
| Clicked | `SDKCallback \| InterAd \| Clicked \| unit=… network=…` |
| **Revenue** | `SDKCallback \| InterAd \| RevenuePaid \| unit=… network=… latencyMs=… revenue=<usd>` → `ad_impression` (Firebase), `ECPM_ANALYSIS`, `USER_RETURN_STATUS` (`SERVED_AD`), AppsFlyer `logAdRevenue` |
| Reward resets timer | `Status Ad.Interstitial => Info: Resetting interstitial timer due to reward earned` / `Reward earned, but interstitial timer not reset due to config` |

---

## 7. Rewarded (MAX) — key `Ad.Rewarded`

| Step | Line |
|---|---|
| State machine | `Reward state <transition\|unchanged> <old> -> <new> via <Method>: <reason> \| activeRequest=…, waitingFallback=…, interFallbackShown=…, rewardGranted=…, deferredLoad=…, providerReady=…` (**every** transition; states `NotLoaded, Loading, Loaded, Showing, Showed, Closing`) |
| Entry | `[AVNPlugin.ShowRewardedAd] ShowRewardAd result=<bool>`, `LoadRewardAd requested` |
| Load deferred / ignored | `Status Ad.Rewarded => Loading: Load deferred until rewarded flow closes`, `Load ignored: rewarded already loading`; `… Loaded: Load ignored: rewarded already loaded`; `… Failed: Load blocked: no provider` |
| Load sent | `Counter Ad.Rewarded LoadCallsSent=<k>` → `MaxAdsProvider LoadRewarded sent unit=<id>` → `Status Ad.Rewarded => Loading: Loading rewarded` |
| Already ready | `Rewarded already loaded in provider (missed loaded callback)` (no SDK call is made) |
| **Loaded** | `SDKCallback \| RewardAd \| Loaded \| unit=… network=… latencyMs=…` → `Counter Ad.Rewarded AdsLoaded=<k>` → `Status Ad.Rewarded => Loaded: Rewarded loaded` (variants: `Rewarded loaded (late callback)`, `Rewarded recovered by load watchdog (missed loaded callback)`, `Rewarded loaded (provider ready despite load failure)`) |
| Ignored | `… Info: Duplicate reward loaded callback ignored: already loaded`; `… Failed: Reward loaded callback but State not Loading instead it is <state>` |
| **Load failed** | `SDKCallback \| RewardAd \| LoadFailed \| unit=… code=… msg=… …` → `Counter Ad.Rewarded LoadCallsFailed=<k> reason=…` → `Status Ad.Rewarded => Failed: Rewarded load failed: <code>` (or `Load failed callback ignored: state is <s>. Message: …`) |
| Retry | `… Loading: Retrying rewarded load in <s>s (retry <a>/<max>)`; end: `Load retries exhausted after <n> retries; next Load()/TryShow restarts loading`, `Load failed; automatic retry is off…`, `Load retry skipped: rewarded disabled by config`; `Post-dismiss load deferred until current flow closes` / `Post-dismiss load skipped: already loading` |
| Watchdog | `Load watchdog: provider ready but no loaded callback received` (recovers) / `Load watchdog: no load callback after <s>s` (fails); + `ADCallback_Missed` if enabled |
| Show rejected | `… Failed: Rewarded blocked by config`, `Rewarded request ignored due to active show/fallback` |
| **Not loaded → fallback** | `… Failed: Rewarded not loaded` + event `ad_no_reward` → `… Loading: Fallback Inter Triggered: <reason>` (event `ad_interstitial_rewarded` when it shows) or `… Failed: Fallback Inter Cannot Be Shown` / `Fallback Inter failed to start` → `… Failed: TryShow failed: no rewarded and fallback unavailable` + `Counter Ad.Rewarded ShowCallsFailed=<k> reason=Rewarded not loaded` → `No Rewarded Ad Available` |
| Show requested | `Reward show requested \| state=Loaded, providerReady=True, activeRequest=True, waitingFallback=False` → `Counter Ad.Rewarded ShowCallsSent=<k>` → `MaxAdsProvider ShowRewarded sent unit=<id> ready=<bool>` |
| Before show | `Counter Ad.Rewarded AdsDisplayed=<k>`, `Status Ad.Rewarded => Showing: Rewarded Show Called`, event `ad_rewarded` |
| **Displayed** | `SDKCallback \| RewardAd \| Displayed \| …` → `Status Ad.Rewarded => Showed: Rewarded shown` |
| **Display failed** | `SDKCallback \| RewardAd \| DisplayFailed \| …error fields…` → `Counter … ShowCallsFailed=<k> reason=Rewarded failed to display: <code>` → `Status … => Failed: Rewarded failed to display: <code>` |
| **Reward earned** | `SDKCallback \| RewardAd \| Rewarded \| label=<l> amount=<n> unit=…` → `Status Ad.Rewarded => Sent: Reward trigger set; will grant on close`; ignored: `… Failed: Rewarded callback received with no active request or reward already granted: Ignoring` |
| **Closed** | `SDKCallback \| RewardAd \| Closed \| …` → **`Status Ad.Rewarded => Sent: Reward granted on close`** *or* **`Reward cancelled by user`** → `Status Ad.Rewarded => Closed: Rewarded closed` |
| Fallback close | `… Sent: Reward granted on interstitial close` / `… Failed: No Rewarded Ad Available on interstitial close` / `Fallback inter failed: <msg>` |
| Show watchdog | `… Failed: Watchdog: rewarded stuck in <Showing\|Showed> after <s>s; forcing close` |
| Clicked / revenue | `SDKCallback \| RewardAd \| Clicked …`, `… RevenuePaid \| … revenue=<usd>` → `ad_impression`, AppsFlyer |

The reward-granted toast shows when the callback fires (UI, not logged).

---

## 8. App Open (AdMob, 2 slots) — key `Ad.AppOpen`

Slot 0 = primary, slot 1 = backfill. Disabled below the level set by `enableAppOpenFromLevel`.

| Step | Line |
|---|---|
| Level gate | `Status Ad.AppOpen => Idle: TryShow blocked: app-open enabled from level <n>` (expected, not a failure) |
| Load blocked | `… Idle: Load blocked: app-open disabled for this session`; `… Failed: Load blocked: app-open sdk not initialized` / `app-open disabled` / `both app-open ad unit ids are empty` |
| Load sent | `Counter Ad.AppOpen LoadCallsSent=<k>` → `AdMob AppOpen load requested for slot=<n>` → `Status Ad.AppOpen => Loading\|Loaded: Loading app-open interstitial[ with show-on-load]` |
| **Loaded** | `Counter Ad.AppOpen AdsLoaded=<k>` → `Status Ad.AppOpen => Loaded: App-open slot <n> loaded` |
| **Load failed** | `Counter Ad.AppOpen LoadCallsFailed=<k> reason=…` → `Status … => Failed: App-open slot <n> load failed: [<domain>/<code>] <msg>` (also `AdMob SDK is not initialized`, `App-open ad unit ids are empty`, `ad was null`) |
| Retry / watchdog | `… Loading: Retrying app-open load in <s>s (retry <a>/<max>)`; `Load retries exhausted after <n> retries; the next Load() restarts loading`; `Load failed; automatic retry is off…`; watchdog `Recovered: provider ready but no loaded callback received` / `Load timed out after <s>s without a callback` |
| Foreground resume | `… Idle: First foreground resume ignored`, `Foreground resume suppressed: full-screen ad active`, `… Loading: Foreground resume: attempting app-open show` |
| Show blocked | `… Failed: TryShow blocked: runtime/config/app-open sdk check failed`; `… Showing: TryShow blocked: ad already showing`; `… Idle: TryShow blocked: cooldown active (<x>/<y>s)`; `… Loading: TryShow blocked: load in progress`; not ready: `Counter … ShowCallsFailed=<k> reason=App-open not ready` + event `ad_no_app_open` |
| Show sent | `Counter Ad.AppOpen ShowCallsSent=<k>` → `AdMob AppOpen show sent for slot=<n>` → `Status … => Showing: Showing app-open interstitial`; before-show: event `ad_app_open` |
| **Displayed** | `Counter Ad.AppOpen AdsDisplayed=<k>` → `Status … => Showed: App-open slot <n> shown`; `AdMob AppOpen impression slot=<n>` |
| **Show failed** | `Counter … ShowCallsFailed=<k> reason=App-open slot <n> failed to show: [<domain>/<code>] <msg>` → `Status … => Failed: …` + event `ad_no_app_open` |
| **Closed** | `Status Ad.AppOpen => Closed: App-open slot <n> closed`, `Status … => Closed: re-enabling app-open in <s>s`, later `… Idle: App-open re-enabled after suppression window`; the service reloads on its own |
| Suppression | `… Idle: App-open suppressed: full-screen ad active` (set whenever an interstitial, rewarded or purchase starts) |
| Clicked | `AdMob AppOpen clicked slot=<n>` |
| **Revenue** | `AdMob AppOpen paid event slot=<n> value=<v> <currency>` → `-------- ADMob Paid Ad Event <adapter class> <source>` → `ad_impression` (Firebase, **different schema from MAX**: `value, currency, precision, network`) and AppsFlyer `logAdRevenue` |

---

## 9. Banner and MREC (MAX) — keys `Ad.Banner.Standard`, `Ad.Banner.Mrec`

| Step | Line |
|---|---|
| Blocked | `Status Ad.Banner.<…> => Failed: Banner blocked by config` |
| Load | `Counter Ad.Banner.<…> LoadCallsSent=<k>` → `MaxAdsProvider LoadBanner sent unit=<id> adaptive=<bool> position=<pos>` (or `LoadMrec sent …`) → `Status … => Loading: Loading BANNER\|MREC`; ignored: `… Showing: Load blocked for <type>; already showing`, `… Loading: Load ignored for <type>; already loading`, `… Loaded: Load ignored for <type>; already loaded` |
| Empty id | `MaxAdsProvider LoadBanner blocked: banner ad unit id is empty` / `LoadMrec blocked: MREC …` |
| **Loaded** | `-------- MAX Banner ad loaded -------- unit=… network=… latencyMs=…` → `Counter … AdsLoaded=<k>` → `Status … => Loaded: Banner loaded` / `MREC loaded` |
| Refresh while showing | `… Loaded: Banner refresh loaded by the ads SDK while showing` |
| Stale loaded | `… Failed: Received Banner Loaded callback while not in Loading state — MAX probably sent this loaded call` |
| **Load failed** | `-------- MAX Banner load failed: <code> -------- unit=… code=… msg=… …` → `Counter … LoadCallsFailed=<k> reason=Banner load failed: <code>` → `Status … => Failed: …`; retry: `… Failed: <type> retries exhausted after <n> attempts` / `Not starting retry for <type> because persistent retries are disabled`; ignored: `Received Banner Load Failed callback while already ready — assuming late failure call` |
| Show | `Counter … ShowCallsSent=<k>` → `MaxAdsProvider ShowBanner sent unit=<id>` → `Status … => Showing: Showing BANNER`; not ready: `Counter … ShowCallsFailed=<k> reason=Not ready yet`, `… Failed: Show failed: BANNER not ready yet`; `Show ignored: <type> already showing`; `Show ignored for <type>; load already in progress` |
| **"Displayed"** | **Raised by the plugin at the show call**, not by the SDK (MAX has no banner displayed callback): `Counter … AdsDisplayed=<k>` → `Status … => Showing: Banner displayed` + event `ad_banner` (`ad_adaptive_banner` when adaptive) / `ad_mrec` |
| Expanded / collapsed / clicked | `-------- MAX Banner ad expanded -------- unit=…` (does **not** mean displayed), `… collapsed --------`, `… clicked -------- …` |
| Hide / destroy | `-------- Hiding Banner ad --------` + `Status … => Closed: Hiding BANNER` (`Hide ignored for <type>; not currently showing`); `-------- Destroying Banner ad --------` + `Status … => Destroyed: Destroying <type>` |
| **Revenue** | `-------- MAX Banner ad revenue paid -------- unit=… network=… revenue=<usd>` → `ad_impression`. Banners refresh, so this fires repeatedly. |

(`MREC` lines are identical with `MREC` in place of `Banner`; MREC revenue is reported with format `Native`.)

---

## 10. Analytics events (core, generated by the plugin)

Events the game sends through `GameAnalyticsEvents` are **out of scope**; they still pass through the same send path, so they produce the generic `Analytics.Event` lines in 10.1.

### 10.1 Send path and its lines

For anything sent via `AnalyticsEventService.SendCustomEvent`:

| Step | Line |
|---|---|
| Request | `Status Analytics.Event => Sending: SendCustomEvent requested: event=<name>, toFirebase=<bool>, toByteBrew=<bool>` |
| Firebase handed over | `[AnalyticsEventService.SendToFirebase] SendToFirebase sent event=<name>, params=<n>`, `Status Analytics.Event => Sent: <name> sent` |
| **Firebase dropped** | `SendToFirebase dropped: Firebase not initialized, event=<name>`, `Status Analytics.Event => SendFailed: <name>: dropped, Firebase is not initialized` |
| Firebase exception | `SendToFirebase exception event=<name>, message=<msg>`, `… SendFailed: <name> failed: <msg>` |
| ByteBrew (`USE_BYTEBREW`) | `SendToByteBrew sent event=<name>, params=<n>` / `SendToByteBrew failed: not initialized, event=<name>` / `SendToByteBrew exception …` |
| **Result with values** | `Status Analytics.Event => Sent\|SendFailed: Custom event sent\|failed to send: Event=<name>, Params=<n> [k=v, k=v]` |
| First event after init | `Status SDK.Firebase.EventVerified => Sent: First Firebase event handed to SDK after init: <name>` (once per launch) |

For events sent directly by `FinzAnalysisManager` (the `ad_*`, `ad_impression`, `c_ad_impression_*`, and ad-count milestone events):

`Status Analytics.Event => Sent: Firebase event handed to SDK: <name> (<params>)` — or, if Firebase isn't ready, `SendFailed: Firebase event sent BEFORE Firebase init succeeded (may be dropped): <name> (<params>)`. The status `Data` also carries `event`, `params`, `firebaseReady`.

### 10.2 Event catalogue

Destinations: **FB** Firebase, **BB** ByteBrew (`USE_BYTEBREW` only), **AF** AppsFlyer.

| Event | To | Parameters | Fires when |
|---|---|---|---|
| `ad_interstitial` | FB (+ BB, name only) | `COUNT`, `SLOT` | Immediately **before** the inter show call (not a confirmed impression) |
| `ad_interstitial_rewarded` | FB | none | Before an interstitial shown as a rewarded fallback |
| `ad_rewarded` | FB | none | Before the rewarded show call |
| `ad_app_open` | FB | none | Before the app-open show call |
| `ad_banner`, `ad_adaptive_banner`, `ad_mrec` | FB | none | At each banner/MREC show call |
| `ad_no_interstitial` | FB | `SLOT`, `ERROR` | Inter not ready, or display failed |
| `ad_no_interstitial_reward` | FB | none (message only appears in the log: `(message not sent: …)`) | Same, for the rewarded-fallback inter |
| `ad_no_reward` | FB | none (same note) | Rewarded not loaded |
| `ad_no_app_open` | FB | `ERROR` | App-open not ready, or show failed |
| `ad_impression` (MAX) | FB + AF revenue | `ad_platform=AppLovin, ad_source, ad_unit_name, ad_format, value, currency=USD` | Every MAX revenue callback |
| `ad_impression` (AdMob) | FB + AF revenue | `value, currency, precision, network` | App-open paid callback |
| `c_ad_impression_10`, `c_ad_impression_5` | FB | `value`, `currency=USD` | Accumulated ad revenue crosses $0.10 / $0.05 (thresholds from remote `TaichiThresholds`) |
| `TenAdsShown`, `FourteenAdsShown`, `FifteenAdsShown`, `EighteenAdsShown`, `TwentyAdsShown`, `TwentyTwoAdsShown` | FB | `value`, `currency=USD` | Ad-count milestones (also logs `[AdAggregator] Fired '<name>' with revenue: <v>`) |
| `ECPM_ANALYSIS` | FB | `PLAYER_ID`, `ECPM`, `INTER_COUNT` | MAX interstitial revenue |
| `USER_RETURN_STATUS` | FB + BB | `SERVED_AD` or `RETURNED_FROM_AD` = filling network | Inter revenue / inter closed |
| `INTER_SHOW_MODE` | FB | `MODE` | Each time AdConfig is applied |
| `ADCallback_Missed` | FB + BB | `SLOT`, `AD_TYPE` (`INTER`/`REWARD`) | A load watchdog fires (needs the experimental switch; on in the prefab) |
| `in_app_purchase` | FB + AF `af_purchase` | `product_id, price, currency, quantity` | Purchase confirmed |
| `purchase_restored`, `purchase_refunded` | FB | `product_id` | Restore / Android refund detection |
| `avn_qa_probe` | FB | `source=init` | Once after Firebase init, **debug symbol only** |

### 10.3 AppsFlyer lines

| Line | Meaning |
|---|---|
| `AppsFlyer logAdRevenue sent: network=<n>, unit=<id>, format=<f>, revenue=<v> USD` (MAX) / `… network=<adapter>, format=<f>, revenue=<v> <cur>` (AdMob) | `AppsFlyer.logAdRevenue` was called |
| `AppsFlyer af_purchase sent: product=<id>, revenue=<price> <currency>, quantity=<n>` | `AppsFlyer.sendEvent(af_purchase)` was called |

Neither proves delivery. See section 13.

---

## 11. In-app purchases (`SDK.Purchaser`, `USE_IAP`)

| Phase | Lines (all `Status SDK.Purchaser => …`) |
|---|---|
| Setup | `Idle: RegisterProduct: <name> => <id> (<type>)`, `Idle: SetRetryConfig maxRetries=<n>, retryDelay=<s>`, `Idle: SetAutoRestoreNonConsumablesOnInit: <bool>`; `Failed: RegisterProduct: skipped — ProductId or ProductName is empty`; `Failed: Set<Purchased\|Restored\|Refunded\|Expired>Callback: '<name>' not registered`; plain `RemoveAds product configured: <id>` |
| Init | `Initializing: Initialize requested` → `Initializing: Initializing purchasing service (IAP v5)` → `Loading: Connected to store, fetching products` → `Loading: Products fetched: <n>` → `Initialized: Store connected and products ready` → `Loading: HandlePurchasesFetched…` → `Initialized: Purchases fetched, service ready` |
| Init skipped | `Initialized: Initialize ignored: already initialized`, `Initializing: Initialize ignored: initialization already in progress`, `Failed: Initialize ignored: service disposed` |
| Init failure | `Failed: Initialize failed: StoreController unavailable`, `Initialize: connect did not succeed, product fetch skipped`, `Initialize exception: <msg>`, **`HandleProductsFetchFailed: reason=<reason>, products=[<ids>]`**, `HandleStoreDisconnected: <msg>` |
| Retry | `Loading: Initialization retry scheduled: attempt <n>`, `Loading: RetryInitializeAsync: waiting <s>s`, `Initializing: RetryInitializeAsync: invoking Initialize`, `Failed: Initialization retries exhausted` |
| Buy | `Loading: BuyProductById: <id>` → `Loading: Initiating purchase: <id>`; failures: `BuyProduct: '<name>' not registered`, `Product ID is empty`, `Purchasing not initialized: products not ready, re-initializing`, `Product not found or unavailable: <id>`, `Purchase request exception: <msg>` |
| Pending → success | `Loading: Purchase pending` → `Loading: ProcessPendingPurchase start` → `Showing: Purchase confirmed: <id>` → `Loaded: ProcessPendingPurchase confirmed` + event `in_app_purchase` (see 10.2) + AppsFlyer `af_purchase` |
| **Failure** | `Failed: Purchase failed: product=<id>, reason=<PurchaseFailureReason>, details=<text>`, `ProcessPendingPurchase exception: <msg>` |
| Restore | `Loading: Restoring purchases` → `Loading: HandlePurchasesFetched: found owned productId = <id>`, `total owned product IDs = <n>` → `Loaded: Non-consumable restored: <id>` / `already recorded: <id>` / `not owned: <id>`; subscriptions: `Subscription check: <id>, currentlyActive=…, previouslyOwned=…`, `Subscription restored: <id>`, `Subscription expired: <id>` |
| Refund | `Loaded: DetectAndProcessRefunds: refund detected for <id>`, `ProcessProductRefund: <name>` (Android) |
| Misc | `Failed: GetSubscriptionPeriod: …` (not registered / not a subscription / not initialized / store product not found / exception), `Destroyed: Dispose called`; `Subscription period in days: <n>` |

Remove-Ads state: `[AVNPlugin.HandleRemoveAdsPurchased]`, `HandleRemoveAdsRestored`, `HandleRemoveAdsRefunded`; `[RemoveAdsPurchased] EnableInterAd set to: <bool>`.

---

## 12. Other generic services

| Area | Lines |
|---|---|
| Rate us (`NativeRateUs`) | `Loading: Attempting to show native Rate Us prompt`, `Loading: Requesting in-app review flow on Android`, `Loaded: In-app review flow launched on Android`, `Failed: Failed to request review info on Android: <err>` / `Failed to launch review flow on Android: <err>` / `Rate Us not supported on this platform`; iOS equivalents |
| Notifications (`Notification`) | `Loading: Checking notification permission`, `Loaded: Notification permission requested on Android` / `already granted on Android` / `flow started on iOS`, `Received notification token on iOS` |
| ANR fixer | `AVNPlugin: ANR Fixer started\|stopped (Remote Config UseANRFixer = <bool>).`; warning `PreemptANRs: couldn't start the ANR supervisor …` |
| Device tier | `[DevicePerformance] <reason>: Tier=<t> Score=<n> ScoreLimits=… RAM=…MB Freq=…MHz Quality=<q> Shadows=<s>` |
| Ads enabled state | `[ApplyPersistedAdsState] EnableInterAd set to: False` (Remove Ads purchased) |
| Config errors | errors (always on): `BannerAdController reference is missing on AVNPlugin…` (also Inter / Reward / AppOpen), `Multiple instances of Singleton Script Detected: <name>` |

### 12.1 Lines that were plain `Debug.Log` before (now carry the keyword)

All plugin runtime logs, and those of the loader, toast and no-internet services that ship with it, go through `DebugLogger.AVNLog*`. These used to be the exceptions:

| Group | Severity | Gated by the symbol? |
|---|---|---|
| Firebase init (`Checking Dependencies`, `=================> Firebase … =================>`, `Firebase initialization succeeded`) | Info | Yes |
| Firebase init problems (`… timed out`, `… failed: <msg>`, `init manager not found`, `initialization exception`) | Warning / Error | **No** |
| `GoogleAppTracking: …` consent / ATT flow | Info (warnings for `AdMob SDK init failed`, `appOpenAdController/avnPlugin reference is not assigned`; error for `Failed to gather consent`) | Info yes, warn/error no |
| `[AdAggregator] Fired '<event>' with revenue: <v>`, `[PluginRemoteConfigData.Apply] EnableInterAd set to …`, `[ApplyPersistedAdsState] …`, `[RemoveAdsPurchased] …`, `Subscription period in days …` | Info | Yes |
| `AVNPlugin: ANR Fixer started\|stopped …` | Info | Yes |
| `PreemptANRs: couldn't start the ANR supervisor …` | Warning | **No** |
| `[DevicePerformance] <reason>: Tier=…` | Info (warning/error for unreadable remote config or a missing quality level) | Info yes, warn/error no |
| `Interstitial load failed (slot …)` / `show failed (slot …)` | Warning | **No** |
| Missing controller references, `Multiple instances of Singleton Script Detected`, `Failed to parse AdConfig`, `Failed to parse TaichiThresholds`, `Firebase ad analytics failed`, `ByteBrew event '<n>' failed`, `AdMob init callback threw` | Error | **No** |
| Toast text (`ShowToast`), `Initializing Toast Pool with limit: <n>`, loader / no-internet messages (`GenericLoader is not assigned…`, `Loader callback threw: …`, `OpenWifiSettings is only supported on Android devices.`) | Info / Error | Info yes, error no |

Not covered by the keyword: anything in the **game's own scripts** (`User Setup/*`, `GameAnalyticsEvents`, game code), third-party SDK output (MAX, AdMob, Firebase, AppsFlyer native logs), and the editor windows.

---

## 13. What "verified" means (and how to confirm it)

| Component | A log line proves | It does **not** prove | Confirm with |
|---|---|---|---|
| Firebase init | Dependencies available | Analytics works | `Status SDK.Firebase.EventVerified` + FA logs below |
| Firebase event | Handed to the SDK (`…handed to SDK` / `SendToFirebase sent`) | Reached Firebase | `adb shell setprop log.tag.FA VERBOSE` then match `Logging event: … name=<event>`; check name ≤ 40 chars, string params ≤ 100 chars, ≤ 25 params |
| Remote config | **Server round-trip**: `lastFetchStatus=Success`, `source=Remote` | The value is what you intended | Compare the logged `source=` and value with the Firebase console |
| MAX init | Init callback fired, adapters listed | A given network will fill | Per-adapter `status=` lines; load callbacks with `network=` |
| MAX ad | `Loaded`/`Displayed` callbacks with `network=` | — | Revenue callback (`RevenuePaid`) is the only proof of an impression |
| Banner "displayed" | The show call was made | The banner is visible | `RevenuePaid` for the banner |
| AppsFlyer | The SDK call was made | Delivery | `isDebug` on, filter logcat for `AppsFlyer_`, look for a 200 response; or AppsFlyer dashboard → Test devices |
| ByteBrew | `SendToByteBrew sent` | Delivery | ByteBrew dashboard (not used in Zombie Rush) |

---

## 14. Known gaps (nothing logs these today)

- **AppsFlyer init / start success or failure.** SDK 6.17.81 has no start callback; only the SDK's own debug logging exists.
- **Firebase Analytics delivery** (no callback exists; use the FA tag).
- **AdMob and MAX** per-call details beyond what is listed (e.g. AdMob app-open `impression`/`clicked` carry only the slot).
- **`ad_no_reward` / `ad_no_interstitial_reward`** send no `ERROR` parameter (kept as is; the message is in the log only).
- **ByteBrew** everything, in games that don't define `USE_BYTEBREW`.
- **iOS ordering:** MAX initializes before the ATT prompt resolves in `StartOnInit` mode.
