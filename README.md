# AVN PlayLens

A local web console for testing Unity Android builds. It runs on your Mac or PC and opens in the browser.

- **Connect phones:** USB, or Wi-Fi with a QR code. Paired phones reconnect on their own, and Unity's Build and Run sees them too, even with the tab closed.
- **Logs:** what your game prints, plus crashes, ANRs and AVN plugin lines. Searchable, filterable, stack traces grouped, alerts for crashes and rule hits, saved to history. Pause (or Space) freezes the view while lines keep coming in; Stop log halts collecting until you start a fresh one.
- **Grouped warnings and errors:** in Logs, switch to Grouped: repeats merged with a count, sorted into your game / AVN plugin / other SDKs / Android (safe to ignore), with a plain meaning where known.
- **Performance:** FPS and frame times (from SurfaceFlinger), CPU, GPU (where the phone allows it), memory, temperature and throttling, sampled every second with graphs of the session. Plus the phone's and the game build's details.
- **Plugin health:** the launch timeline in ms, the AVN plugin's startup sequence, SDKs it verifies plus other SDKs found in the APK and logs, MAX adapters, ad funnels from load to paid, ad rules checked against the AdConfig values, consent and privacy, remote config with the actual values, and what needs a look.
- **Firebase events:** turns on Firebase debug mode for you, then shows every event Firebase logs with its values. The plugin's lines double-check that nothing was sent but not recorded.
- **Checklist:** attach the plugin’s publishing PDF, match its package/version/build to the installed app, and verify its For Dev items with fresh runtime evidence. Original build results stay in their own column. Expected events and parameters are checked from the game’s rules file. Export HTML / Markdown, or open the report and print/save as PDF.

## Get it

Download the zip for your computer, unzip it, and double-click **AVN-PlayLens** (`AVN-PlayLens.exe` on Windows). It opens in your browser at http://127.0.0.1:7420. No Node.js or install needed; keep the window that opens running while you use it. Each zip has a README with first-run notes (macOS asks you to right-click → Open the first time; Windows SmartScreen needs "More info → Run anyway").

| Computer | Zip |
|---|---|
| Mac with Apple silicon (M1 and later) | `AVN-PlayLens-<version>-mac-arm64.zip` |
| Mac with Intel | `AVN-PlayLens-<version>-mac-x64.zip` |
| Windows | `AVN-PlayLens-<version>-win-x64.zip` |
| Linux | `AVN-PlayLens-<version>-linux-x64.zip` |

### Build the zips

```bash
npm install
npm run package                  # all platforms -> release/
npm run package -- mac-arm64     # just one
```

Each app is Node's own binary with PlayLens built in (Node "single executable application"): the server, the web page, the AVN rules pack and the demo log. On first run it unpacks the page and rules to `~/.avn-playlens/app/<version>/`. Mac builds are ad-hoc signed (with `codesign` on a Mac, or `rcodesign`, downloaded automatically, elsewhere). They're not notarized, hence the right-click → Open the first time.

## Run from source

Needs Node.js 20 or newer.

```bash
npm install
npm start          # builds the page, starts PlayLens, opens http://127.0.0.1:7420
```

PlayLens uses the same adb as Unity. It looks for adb in this order: the `PLAYLENS_ADB` environment variable, your `PATH`, `ANDROID_HOME` / `ANDROID_SDK_ROOT`, Unity Hub's bundled Android SDK (newest editor first), then Android Studio's default SDK. It never restarts the adb server, so it won't interrupt a Unity build.

Options: `--port 7500`, `--no-open`, `--replay [file]`.

## Manage paired phones

On Home, each remembered Wi-Fi phone has **Disconnect**, **Reconnect**, and **Forget / unpair…** controls. Disconnect pauses PlayLens's auto-reconnect, including across restarts; Reconnect resumes it. Remembered phones remain available here while disconnected.

Forget disconnects the phone and removes it from PlayLens. To fully revoke Android's pairing, follow the on-screen instructions: on the phone, open **Developer options → Wireless debugging → Paired devices**, select this computer, and tap **Forget**. ADB's own auto-discovery can reconnect a trusted phone until that final step is done.

PlayLens reuses ADB's automatic Wi-Fi connection and removes duplicate IP connections for remembered phones, so Unity sees one Wi-Fi target per phone. USB and Wi-Fi remain separate transports if both are connected.

## Try it without a phone

```bash
npm run replay     # adds a "Replay device" that plays a saved log (packages/server/fixtures/demo.logcat)
```

Pass your own capture with `node packages/server/bin/avn-playlens.mjs --replay my.logcat`. Captures must be in `adb logcat -v threadtime -v epoch` format.

## Develop

```bash
npm run dev:server   # API on 7420 with the replay device
npm run dev:web      # Vite on http://localhost:5173 with hot reload
npm test             # parsers, adb handling, server, and an end-to-end run against a fake adb
```

## Rules files

Each game gets one YAML file in `~/.avn-playlens/rules/<package>.yaml` (Checklist setup can create it). Edit it in any editor; the checklist updates on save. It lists:

- `presets`: checks from the AVN plugin pack (startup-health, remote-config, interstitial-e2e, rewarded-e2e, app-open, banner, purchase)
- `expect`: events you expect, with parameter rules (`required`, `type: number`, `oneOf`, `range`, `regex`), `after` for order, `count`
- `watch`: extra log lines to flag
- `level`: where the current level comes from (for the AdConfig `EnableInterFromLevel` check), e.g. `level: { event: LEVEL_ANALYSIS, param: Started }`

The plugin checks themselves are in `rules/packs/avn-plugin.yaml`, written from `docs/AVN_PLUGIN_LOG_REFERENCE.md`.

## Game workspaces

Home is your game library. Add a game name, Android package ID (for example `com.studio.game`) and optional PNG, JPEG or WebP icon (up to 250 KB). Icons and game IDs stay in `~/.avn-playlens/games.json`. Open a tile to enter its workspace; edit the ID or icon and remove the library entry from that game's page. Removing an entry keeps the installed game and saved captures.

Checklist setup requires a publishing report before starting a run. Text PDFs are read directly; image/outlined PDFs use bundled English OCR locally, without an external service. Review and correct the extracted identity and For Dev rows before attaching. Originals and imported rows are stored under `~/.avn-playlens/build-reports/`. Package, version and build number must match; increment the build number on every rebuild because reused numbers cannot identify a different binary. Logs, Firebase and Plugin health remain available without a report.

For Dev results distinguish **Verified** (the behavior described in the evidence occurred during this run), **Matches installed build** (static package settings), **Not verified**, **Problem**, **Manual check**, and **Not enabled**. SDK initialization is not proof of every SDK feature. Analytics is verified on-device, not at the backend. An ad unit needs matching unit-ID evidence; generic counters cannot verify a primary/backfill unit. Unity editor settings, SDK keys and dashboard delivery remain manual where logs cannot prove them. Replay results are labeled as simulated.

Firebase and Plugin health show a Remote Config variables table with values, observed data types, registered custom types, source (Remote/Default/Static/Cache/Unknown), timestamps and log links. JSON fields are listed individually. Only values emitted by the plugin can be shown; truncated payloads are identified. To expose additional keys, the Unity plugin must log their key, type, source and value (custom registration/dispatch lines are already supported). The tool does not infer unlogged server values from the build report.

The game workspace contains the installed version/build, device selector, Start/Restart/Stop controls, and links to Logs, Performance, Plugin health, Firebase and Checklist. Its recent sessions appear below; **Game sessions** opens the full history for that game. The global **Sessions** page has all saved captures grouped/filterable by game. Home has no session bar, history feed or playback controls.

Tracking starts only inside an installed, registered game's workspace. Home, Devices, pairing and global history pause the logcat source, analysis updates and performance sampling. Game tiles show a pause marker. Returning to the same game resumes its current session from the phone's current log time; events produced during the pause are not backfilled. Reviewing an archived capture also pauses live collection. Switching games or devices starts a separate capture.

PlayLens rejects device-wide and unregistered-game captures. It accepts only log lines from the selected game's processes, plus system crash/launch diagnostics naming that exact package. Firebase lines from unknown/shared service PIDs are excluded, so other apps' events cannot enter the selected game's counts.

Connected devices are summarized in Home's header. **Devices** contains pairing, connection controls and the option to connect another phone. When no phone is connected, Home shows a connect prompt.

## Sessions and history

Each game's capture numbers advance independently: **Session 1**, **Session 2**, and so on, with start time and installed version when available. The session bar lives inside game workspaces. **New session / clear** offers **Save & start new** or **Discard & start new**; both reset logs, Firebase events, ad state and performance together. Discard also removes a previously saved copy of the current capture. **Save session** keeps short captures immediately.

A detected new main game process starts a separate session. Switching between that game's monitoring views keeps the same capture. Global history lets you review Firebase events, search logs, inspect ad state, export, and delete completed captures. A paused capture can be resumed or discarded from its game workspace.

## What gets saved

Everything stays in `~/.avn-playlens/` on your computer: `rules/`, `sessions/` (each log stream gzipped, plus its performance samples, last 50 per game), `reports/` (test-run reports), `devices.json` (paired Wi-Fi phones). Use `--no-record` to skip saving sessions.

## Layout

```
packages/server   Node server: adb, devices, QR pairing, logcat streaming, AVN + Firebase parsers
packages/web      React page (v2 Lofi design)
scripts           package.mjs: builds the single-file apps
rules/packs       avn-plugin.yaml: the AVN plugin checks
docs              plan and the AVN plugin log reference
```

## Safety

PlayLens only listens on 127.0.0.1, so nothing else on the network can reach it. There's no login. Requests are only accepted from PlayLens's own page, so another website open in your browser can't send adb commands to your phone.
