# AVN PlayLens

A local web console for testing Unity Android builds. It runs on your Mac or PC and opens in the browser.

- **Connect phones:** USB, or Wi-Fi with a QR code. Paired phones reconnect on their own, and Unity's Build and Run sees them too, even with the tab closed.
- **Logs:** what your game prints, plus crashes, ANRs and AVN plugin lines. Searchable, filterable, stack traces grouped, alerts for crashes and rule hits, saved to history. Pause (or Space) freezes the view while lines keep coming in; Stop log halts collecting until you start a fresh one.
- **Grouped warnings and errors:** in Logs, switch to Grouped: repeats merged with a count, sorted into your game / AVN plugin / other SDKs / Android (safe to ignore), with a plain meaning where known.
- **Performance:** FPS and frame times (from SurfaceFlinger), CPU, GPU (where the phone allows it), memory, temperature and throttling, sampled every second with graphs of the session. Plus the phone's and the game build's details.
- **Plugin health:** the launch timeline in ms, the AVN plugin's startup sequence, SDKs it verifies plus other SDKs found in the APK and logs, MAX adapters, ad funnels from load to paid, ad rules checked against the AdConfig values, consent and privacy, remote config with the actual values, and what needs a look.
- **Firebase events:** turns on Firebase debug mode for you, then shows every event Firebase logs with its values. The plugin's lines double-check that nothing was sent but not recorded.
- **Checklist:** expected events and parameters from a rules file, ticked off live during a test run, with an HTML / Markdown report at the end.

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

## What gets saved

Everything stays in `~/.avn-playlens/` on your computer: `rules/`, `sessions/` (each log stream gzipped, plus its performance samples, last 50), `reports/` (test-run reports), `devices.json` (paired Wi-Fi phones). Use `--no-record` to skip saving sessions.

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
