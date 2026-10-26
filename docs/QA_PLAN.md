# Automated game QA

Status: the first slice is implemented (QA SDK, PlayLens runner, built-in plans, QA runs page). What is not built yet is marked **later**.

## Who this is for and what it must do

A studio shipping one or two Unity hypercasual or casual puzzle games a day. Several developers, each testing their own game on their own Mac with PlayLens and a phone (a Samsung A51 is the reference device). Game code differs per developer; the AVN plugin is the one thing every game shares. Unity Editor is installed on the developer machines. Billing is Unity IAP. No MAX test devices were registered, so ads are real unless a build enables test mode.

Priority order, as decided on 2026-10-24:

1. **Plugin and SDK integration**: ads load, show, close and pay out; analytics events are right; remote config is applied; purchases grant.
2. **Gameplay**: levels load, win, lose, retry and progress without softlocks.
3. **Performance and stability**: FPS, memory, thermal, crashes and ANRs tied to a level.

Results appear in the local web app. Developers click Run, come back to a report, and can watch the live step list while it runs.

## The design in one paragraph

Each game ships a small **QA SDK** (`packages/unity-qa-sdk`, `com.avn.qa`) that compiles only in QA builds. Developers wire a handful of hooks into their own game code (`level.win`, `level.load`, current level and state); the AVN plugin team wires the shared ad, IAP and remote-config hooks once. PlayLens opens a loopback socket to that SDK through `adb forward`, runs a **plan** step by step with deadlines, correlates each step with the plugin's log lines, perf samples and screenshots, and writes an honest report: passed, failed, not verified, not supported, skipped. Unity Test Framework is used only where it earns its keep: the plugin's own logic with fake ad and billing services.

Why this shape rather than the first draft of this plan:

- **Per-game Unity Test Framework suites do not scale to a game a day.** Hooks are cheaper than tests, and the game's real code paths run on the real phone with the real SDKs.
- **Random tapping finds crashes, which logcat already catches.** It is kept as a plan, not the foundation.
- **The plugin already logs everything the checks need** (`docs/AVN_PLUGIN_LOG_REFERENCE.md`). The runner does not guess; it waits for the documented line.
- **Real input where it matters.** The SDK reports on-screen uGUI controls with their rectangles; PlayLens taps them through ADB, so a tapped button is a real tap.
- **AltTester** was considered and dropped: it sees GameObjects, not game meaning, and adds a third-party package to every build. The bridge protocol is narrow enough to swap later if needed.
- **Unity Automated QA** is abandoned upstream; do not build on it.

## What is implemented

### Unity QA SDK (`packages/unity-qa-sdk`)

- `AVNQA` static API: `RegisterAction`, `SetLevelProvider`, `SetStateProvider`, `SetExtraStateProvider`, `Report`, `LevelStarted/Won/Lost`, `RewardGranted`, `EntitlementGranted`, `NotWired`. Every method is `[Conditional("AVN_QA")]`, so games call it without `#if`.
- `AVNQABridge`: loopback TCP listener (default port 7421), newline JSON, one client, main-thread dispatch. Commands: `hello`, `ping`, `state`, `actions`, `invoke`, `ui`, `ui.find`, `screen`, `marker`. Pushes `level.*`, `reward.granted`, `entitlement.granted`, `state.changed`, `app.pause`, `app.focus`. Every invoke and report also writes a Unity log line suffixed `| AVNQA`.
- `AVNQAUiScan`: interactable uGUI `Selectable`s with normalised top-left-origin rectangles and labels (uGUI Text, TextMeshPro by reflection).
- `AVNQASettings` (optional Resources asset): port, auto-start, QA phones' advertising IDs for MAX test mode.
- Editor: **AVN → QA → Enable/Disable QA build** toggles the `AVN_QA` define; `AVNQABuildGuard` fails a non-development build that still has `AVN_QA`.
- Samples: `PluginHooks` (ad.*, iap.*, rc.values, to be wired once in the plugin) and `GameAdapter` (per-game template).
- Verified: compiles under Unity 6000.3 with and without `AVN_QA`; bridge types exist only with the define.

Standard action ids: `level.load {level}`, `level.restart`, `level.next`, `level.win`, `level.lose`, `nav.home`, `nav.shop`, `nav.settings`, `game.reset`, `ad.interstitial.show`, `ad.rewarded.show {placement?}`, `ad.banner.show/hide`, `ad.appopen.show`, `ad.status`, `iap.buy {productId}`, `iap.restore`, `iap.products`, `rc.values`.

### PlayLens runner (`packages/server/src/qa/`)

- `runner.mjs`: one active run per phone; run history under `~/.avn-playlens/qa-runs/<run id>/`; runs left "running" by a crashed PlayLens are marked **interrupted** at startup; the newest 200 runs are kept. While a run owns a phone, the workspace's Start/Stop buttons are refused with 409.
- `run.mjs`: the state machine (queued → preparing → running → stopping → completed | cancelled | infrastructure-error). It builds its own `LogStream`, `Monitor` and `PerfSampler`, so capture continues with the browser closed. Step windows use the phone's clock (`date +%s.%N`), so expectations line up with logcat timestamps. Cancellation and phone disconnect end the run with partial evidence and remove the run's `adb forward`.
- `plans.mjs`: schema validation and the built-in plans. Step types: `launch`, `stop`, `wait`, `expect`, `bridge`, `action`, `closeAd`, `appOpenCycle`, `screenshot`, `tapUi`, `key`, `monkey`, `repeat`, `manual`. Expectations: `event` (Firebase or plugin send line), `status {key,state,message}`, `callback {format,callback}`, raw `match`, `bridge` (an SDK push event), `foreground`. `soft: true` turns a timeout into **not verified** instead of failed.
- `adb-actions.mjs`: forward, screencap, tap, swipe, key, display size, device clock, `uiautomator dump` and a close-button finder for ads.
- `bridge-client.mjs`: the Node side of the protocol with request ids, timeouts and error codes (`not-wired`, `unknown-action`, `handler-error`, `timeout`).
- `report.mjs`: Markdown export with coverage mode and a plain reading guide.
- API: `GET /api/qa/plans?pkg=`, `GET/POST /api/qa/runs`, `GET /api/qa/runs/:id`, `POST …/cancel`, `DELETE …`, `GET …/report.md`, `GET …/files/<name>`. WebSocket broadcast `qa.run` on every change.
- Web: **QA runs** view in each game workspace: plan picker with per-plan options (for example `productId`), live step list, manual-step banner, latest screenshot, findings, perf, past runs table, Markdown report download.
- Tests (`packages/server/test/qa.test.mjs`): plan validation and unrolling, ad close-button detection, bridge client against a fake Unity bridge, and a whole run through the API with an in-process fake adb (launch, startup lines, bridge action, not-wired and unregistered hooks, screenshot, cancel, persisted files, report).

### Built-in plans

| Plan | Needs bridge | What it proves | What it does not prove |
|---|---|---|---|
| `plugin-smoke` | optional | Cold launch, SDK startup, App Open on return from background, interstitial displayed and closed, rewarded displayed and reward granted on close, screenshots | Gameplay, purchases, ad revenue |
| `adb-smoke` | no | Startup, two minutes of random taps without a crash or ANR, App Open cycle | Anything about gameplay or ads beyond "did not crash" |
| `progression` | yes | Forced wins on levels 1–10 through the real win path, next level starts, interstitial gate handled | That a level is beatable by a player |
| `iap` | yes | Purchase started through the plugin, confirmed by the plugin after a manual tap on the Google sheet, `in_app_purchase` logged, entitlement reported | Anything with a real card; the run never confirms a purchase sheet itself |
| `inter-level-gate` | yes | No interstitial on a win below `EnableInterFromLevel`, one at the gate (options `beforeGate`, `atGate`) | Ad revenue |
| `inter-cooldown` | yes | Second win inside the cooldown shows no interstitial and the plugin logs why (option `level`) | — |
| `retry-flow` | yes | Lose through the real path, restart, same level starts again (option `level`) | That the level is beatable |
| `rewarded-continue` | yes | Lose, continue placement shows, reward granted on close, game applies it (option `level`) | — |
| `rewarded-cancel` | yes | Close a rewarded ad early: plugin says cancelled, game grants nothing | — |
| `no-fill-recovery` | optional | Airplane mode: loads fail cleanly, show is refused with a reason, no crash; network back: loads and shows again | — |
| `remove-ads` | yes | Remove Ads bought (manual sheet), interstitials disabled, a win above the gate shows none (options `productId`, `level`) | Refunds |
| `kill-restore` | yes | Win, force-stop, relaunch, a level starts from saved progress (option `level`) | Exact save contents |

Step types added for these: `network` (airplane mode on/off, restored automatically when a run ends), `closeAd` with `early: true` (close a rewarded ad before it finishes), and `absent: true` on any log or bridge expectation (passes only if nothing matches before `within` ends).

A game adds its own plans in its rules file:

```yaml
qa:
  bridgePort: 7421            # optional
  plans:
    level-5-retry:
      name: Level 5 retry flow
      steps:
        - launch: { cold: true }
        - expect: { status: { key: SDK.InitCompleted, state: Info }, within: 60s }
        - bridge: { required: true }
        - action: { action: level.load, args: { level: 5 }, expect: [{ bridge: level.started }] }
        - action: { action: level.lose, expect: [{ bridge: level.lost }] }
        - tapUi: { query: Retry, expect: [{ bridge: level.started }], within: 15s }
        - screenshot: { label: Level 5 after retry }
```

### Ads without test devices

Real ads cannot be auto-dismissed safely and tapping them is invalid traffic. Two things make ad runs safe:

- Register the QA phones as MAX test devices. Either paste their advertising IDs (phone: Settings → Google → Ads) into `AVNQASettings`, which the plugin hooks sample passes to `MaxSdk.SetTestDeviceAdvertisingIdentifiers`, or add them in the AppLovin dashboard.
- The `closeAd` step waits for the creative's close control (rewarded: until the `Rewarded` callback), finds it with `uiautomator dump`, taps it, falls back to Back, and if the ad is still up it asks for a manual close and reports **not verified**. It never taps the middle of the screen while an ad is showing, and the random-tap step pauses while any ad is up.

## Test-case catalogue

Status: **Now** = a built-in plan covers it; **Plan** = needs only a YAML plan with existing steps; **Step** = needs a new step type; **Manual** = a human stays in the loop; **No** = cannot be automated honestly.

### Plugin and SDKs

| Case | Evidence | Status |
|---|---|---|
| Cold launch, SDKs initialise in order, auto-load starts | `SDK.InitCompleted`, `Auto-load starting` | Now (`plugin-smoke`) |
| Interstitial loads, displays, closes, reloads | callbacks Loaded, Displayed, Closed | Now |
| Interstitial gated by `EnableInterFromLevel` | absent Displayed below, Displayed at gate | Now (`inter-level-gate`) |
| Interstitial cooldown and delay-before-first | absent Displayed, block reason logged | Now (`inter-cooldown`) |
| Rewarded loads, displays, reward granted on close | `Reward granted on close`, `reward.granted` | Now |
| Rewarded closed early grants nothing | `Reward cancelled by user`, absent `reward.granted` | Now (`rewarded-cancel`) |
| Rewarded continue after a loss | `rewarded-continue` | Now |
| Rewarded not loaded, interstitial fallback | `Fallback Inter Triggered` | Plan (airplane mode then show) |
| App Open on return from background | `Ad.AppOpen => Showed` or a block reason | Now |
| App Open suppressed during a full-screen ad | background during an interstitial, absent Showed | Plan |
| Banner show, hide, refresh | banner loaded and show counters | Plan (needs `ad.banner.*` hooks) |
| Same ad never double-grants | one `Rewarded` per show | Plan |
| No-fill and load-failed paths, recovery | `no-fill-recovery` | Now |
| Remote config fetched from server and applied | `AdConfig applied`, source Remote | Now (rules presets) |
| Remove Ads disables interstitials | `remove-ads` | Now, manual sheet |
| Purchase, restore | `iap` | Now, manual sheet |
| Purchase cancelled or failed | `Purchase failed: reason=` | Manual (dismiss the sheet) |
| Analytics names, parameters, order, counts | rules file `expect` | Now |
| Consent and ATT first-run flow | CMP lines | Manual, needs `game.reset` |
| Release build sanity (debug symbol, bridge, debuggable) | findings | Now |

### Gameplay

| Case | Status |
|---|---|
| Levels 1 to N win through the real path, next level starts | Now (`progression`) |
| Lose then retry restarts the same level | Now (`retry-flow`) |
| Progress survives kill and relaunch | Now (`kill-restore`) |
| A real tap on a named button changes state | Now (`tapUi`) |
| No softlock: state changes within a budget after input | Step (state timeout) |
| Every level screenshot for visual review | Now |
| Level is beatable by a player | No (needs a solver or recorded input) |

### Performance and stability

| Case | Status |
|---|---|
| No crash, ANR or Unity exception during a run | Now (findings) |
| FPS, memory, thermal summary | Now |
| Drops tied to a level | Step (tag samples with the SDK level) |
| Regression against the previous build | Later |
| Rotation, low memory, permission dialogs | Step |

## How to use it today

1. Add `com.avn.qa` to the game (see `packages/unity-qa-sdk/README.md`). Paste `packages/unity-qa-sdk/WIRE_THIS_GAME.md` into Claude Code or Cursor in the game project; it writes the adapter against the standard and lists what it could not wire. The plugin team wires the Plugin hooks sample once.
2. **AVN → QA → Enable QA build**, build and install on the phone.
3. In PlayLens open the game workspace → **QA runs**, pick a plan, Run. Close the tab if you like; the run keeps going.
4. Read the report. "Not supported" means a hook is missing, not that the feature passed.
5. **AVN → QA → Disable QA build** before a store build. The build guard and PlayLens both flag a bridge in a non-debuggable build.

## Later

- **Unity Test Framework for the plugin.** Edit Mode tests with fake ad and billing services for grant-once, cancellation, failure and restore; import the NUnit XML into a run as a separate coverage line. Only after the plugin team agrees to own that suite.
- **Build-to-build diff.** Compare a run against the previous run of the same game and plan: new findings, slower levels, changed event sets.
- **Level-tagged performance.** The SDK already reports the level; attach it to perf samples and screenshots on drops, with device-specific budgets.
- **More Android lifecycle**: rotation, low memory, permission dialogs, process kill and restore, offline.
- **AI exploration.** A player driven by screenshots, bridge state and the UI list, with a goal, budget, stop button and action trace. Needs an approved provider and a decision on sending screenshots and logs. Findings stay "suspected" until a deterministic step reproduces them.
- Build triggers, issue-tracker export, more phones. (Installing builds is done: see **Builds & install** in the README.)

## Decisions still open

- Which plugin methods the hook sample should call (names in the sample are placeholders; the plugin team fills them in).
- Whether `level.win` can be guaranteed to use the real win path in every game. If not, that game's progression result must say "forced transition".
- MAX test device registration for the A51 and the developers' own phones.
- A Play licence-tester account and a test product per game for the `iap` plan.
