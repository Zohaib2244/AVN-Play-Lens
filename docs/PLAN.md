# AVN PlayLens: Android Game Test Console (plan)

*A local web tool for testing Unity Android builds: live logs, analytics events, ad-SDK flags and event verification, all in the browser.*

---

## 1. Goals

| # | Goal | What "done" means |
|---|------|-------------------|
| G1 | **Runs locally, opens in a browser** | One command (`npx playlens` or a single downloadable binary) starts a local server and opens `http://localhost:7420`. No Electron app. Works on macOS and Windows. |
| G2 | **Device discovery and connection** | USB and Wi-Fi devices show up automatically. Wi-Fi pairing is guided by QR code or pairing code, with a legacy `tcpip` fallback. Device states (unauthorized, offline) come with fix-it hints. |
| G3 | **Pick the game** | Shows the device's installed third-party apps. Auto-selects the foreground app. You can pin your own games. The app's PID is tracked across restarts and crashes. |
| G4 | **Live logs** | Streams Unity logs, exceptions, warnings, native and Java crashes, and ANRs. Stack traces are grouped into one entry. Stays smooth at thousands of lines per second. |
| G5 | **Analytics events** | Firebase Analytics events are parsed out of logcat into a structured Events timeline with name and params. ByteBrew is handled the same way, through native logs or a small QA bridge (see §6). |
| G6 | **Filter and search** | Filter by level, tag, source, and free text, regex, or a query syntax. Saved filters. Search runs in a Web Worker so it never blocks the UI. |
| G7 | **PLUS layer: rules** | You can add (a) **watch rules** that flag specific log lines (for example, ad SDK load failures or revenue callbacks), and (b) **expected events** that are checked off live as Firebase or ByteBrew sends them, with param validation. Rules are files you can edit, version, and share. |
| G8 | **Smooth, polished UI** | Modern dark-first developer-tool design with purposeful animation. 60 fps while streaming. |

**Non-goals for v1:** iOS, network or proxy interception of analytics traffic, editing data in the Firebase console, running more than one device side by side (the architecture allows it later).

---

## 2. Architecture

```
┌──────────────────────── Your Mac / PC ────────────────────────┐
│                                                                │
│  Browser (React UI) ◄──── WebSocket + REST ────► Local server  │
│   • virtualized log view           (127.0.0.1)    (Node / TS)  │
│   • events / checklist / flags                     │           │
│   • filter worker                                  │ spawns    │
│                                                    ▼           │
│                                               adb (platform-   │
│                                               tools binary)    │
└────────────────────────────────────────────────────┬───────────┘
                                                     │ USB / Wi-Fi
                                              ┌──────▼──────┐
                                              │ Android     │
                                              │ device      │
                                              │ (your game) │
                                              └─────────────┘
```

**Server pipeline (one per active device):**

```
adb logcat (all buffers) ─► line parser ─► multiline grouper ─► process filter
   ─► classifiers (Unity, Crash, Firebase, ByteBrew, Ads, System)
   ─► rule engine (watch rules + expected events)
   ─► ring buffer + session recorder (JSONL.gz)
   ─► WebSocket hub (batched every ~50 ms) ─► browser
```

The server parses and evaluates rules, not the browser. This keeps rule results consistent, lets sessions record even if the tab is closed, and keeps the frontend focused on rendering.

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Server | **Node 22+ with TypeScript, Fastify, `ws`** | Mature `child_process` support for adb. Shares types with the frontend. |
| Validation | **zod** | One schema for the rule files, API, and WebSocket messages. |
| File watching | **chokidar** | Hot-reloads rule files when you edit them in VS Code. |
| Frontend | **React 18, Vite, TypeScript** | Fast development loop and a large ecosystem. |
| Styling | **Tailwind CSS with CSS variables** for theme tokens | Fast and consistent. Light and dark themes come cheap. |
| Animation | **Motion (Framer Motion)** | Layout animations, springs, `AnimatePresence`. |
| Log list | **TanStack Virtual** | Renders only the visible rows, so 200k+ lines stay usable. |
| State | **Zustand** | Simple. Works well with high-frequency updates. |
| Command palette | **cmdk** | ⌘K / Ctrl+K for everything. |
| QR code | `qrcode` | Wi-Fi pairing. |
| Tests | **Vitest** (parsers and rules), **Playwright** (UI, in replay mode) | |
| Packaging | `npx playlens` first. Later a single executable (Node SEA or `bun build --compile`) for macOS arm64/x64 and Windows x64. | |

Storage uses no native dependencies. Sessions are gzipped JSONL files, and config and rules are YAML/JSON. This keeps single-binary packaging easy.

### Monorepo layout

```
playlens/
├─ packages/
│  ├─ shared/            # types, WS protocol, rule schema (zod)
│  ├─ server/
│  │  ├─ adb/            # adb locator, client, device tracker, wifi pairing, mdns
│  │  ├─ device/         # device info, app list, foreground app, PID tracker, app controls
│  │  ├─ logcat/         # stream, line parser, multiline grouper
│  │  ├─ classifiers/    # unity.ts, crash.ts, firebase.ts, bytebrew.ts, ads.ts
│  │  ├─ rules/          # loader, watcher, engine, packs
│  │  ├─ sessions/       # recorder, export (jsonl / txt / html report), import
│  │  ├─ replay/         # fake device that replays a captured logcat file
│  │  └─ api/            # REST routes, WS hub
│  └─ web/
│     ├─ app/            # shell, routing, theme, command palette
│     ├─ features/       # devices, apps, logs, events, checklist, flags, crashes, rules-editor, sessions
│     ├─ workers/        # filter.worker.ts (search and filtering off the main thread)
│     └─ ui/             # design-system components
├─ unity/com.yourstudio.qalog/   # optional Unity package: QA bridge (see §6)
├─ rules/packs/          # built-in packs: firebase-core, applovin-max, levelplay, admob, unity-ads
└─ fixtures/             # real logcat captures from your games (used by tests and replay)
```

---

## 3. Feature design

## 3.0 The connection is its own feature (not tied to logs)

Most of the time you'll use this tool just to connect a phone so Unity's **Build and Run** can install to it. So connecting must work and stay up without opening any log view.

- **Connection comes first.** The first screen after launch is the device list with each device's state (for example "Ready for Unity"). Logs, Firebase events, and the checklist are optional views you open afterwards.
- **Same adb as Unity.** Unity's Build and Run uses the adb server on port 5037. Bench talks to that same server, so any device Bench connects shows up in Unity's Run Device list. Bench should use the adb Unity is configured to use (Unity Hub's bundled SDK, or the external SDK set in Unity preferences), so the two never fight over versions.
- **Never kill the adb server.** If the versions differ, Bench shows a warning and lets you choose. It does not run `adb kill-server` on its own, because that would drop Unity's connection mid-build.
- **Survives closing the tab.** The connection lives in the adb server, not the browser. Closing the tab changes nothing. Closing Bench itself leaves the adb server and the devices connected.
- **Wi-Fi stays up.** Bench retries dropped Wi-Fi connections in the background, and re-finds the device when Android changes its wireless debugging port, even while no view is open.
- **Ready-for-Unity check.** A device only gets the "Ready for Unity" badge when adb reports it as `device` (not `unauthorized` or `offline`), so a green badge means Build and Run will work.
- **Pairing is remembered.** A paired phone reconnects when you start Bench again, without scanning the QR again.
- **No log process runs unless a view is open.** Streaming logcat only starts when you open a view that needs it (and Logs can keep running in the background after that). Connection-only use costs almost nothing.

**Needs checking in Phase 0:** which adb binary your Unity version uses (Editor settings), and that Build and Run lists a device connected through Bench over Wi-Fi.

---

### 3.1 Finding and running adb
- Search order: `PLAYLENS_ADB` env var, then `PATH`, then `ANDROID_HOME` / `ANDROID_SDK_ROOT`, then **Unity Hub's bundled SDK**:
  - macOS: `/Applications/Unity/Hub/Editor/*/PlaybackEngines/AndroidPlayer/SDK/platform-tools/adb`
  - Windows: `C:\Program Files\Unity\Hub\Editor\*\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\platform-tools\adb.exe`
- If none is found, offer a one-click download of Google platform-tools into `~/.playlens/platform-tools`.
- If an adb server is already running, reuse it. If the found adb's version doesn't match the running server's, show a warning instead of killing it. Unity's adb and Android Studio's adb can otherwise keep restarting each other's servers.

### 3.2 Device discovery and connection
- **Live tracking:** `adb track-devices -l` streams changes. When a device appears, read its details: model, manufacturer, Android version and SDK level, ABI, battery, screen size, and whether it's on USB or Wi-Fi.
- **States with guidance:**
  - `unauthorized`: "Check your phone for the *Allow USB debugging* prompt."
  - `offline`: offer a "Reconnect" button.
  - `no permissions` (Linux): udev hint.
- **Wi-Fi, Android 11+ (wireless debugging):**
  1. **QR pairing**, like Android Studio: generate a random service name and password, and show the QR string `WIFI:T:ADB;S:<name>;P:<password>;;`. Poll `adb mdns services` for a `_adb-tls-pairing._tcp` entry with that name, then run `adb pair ip:port password`.
  2. **Pairing code**: the user types the IP, port, and 6-digit code from the phone.
  3. After pairing, auto-connect through the `_adb-tls-connect._tcp` mDNS entry.
- **Wi-Fi, legacy:** with the device on USB, read its IP (`ip route` / `ip addr show wlan0`), run `adb tcpip 5555`, then `adb connect ip:5555`.
- Remember devices you've paired before and offer "Reconnect" for them.
- UI: device cards animate in and out when devices are plugged or unplugged. Connection status shows as a pulsing dot.
- **Wi-Fi is a first-class connection, not a fallback.** A device card shows a USB or Wi-Fi badge, and a Wi-Fi device behaves the same as a USB one: same logs, events, rules, and app actions.
- **Reconnect handling:** Wi-Fi drops more often than USB (phone sleep, switching networks). PlayLens retries automatically with backoff, keeps the log view and the session open, and shows a "Reconnecting…" state with a marker in the log where the gap happened. When the device returns, the stream resumes in the same session.
- **Caveats the UI should explain when pairing fails** (these are the usual reasons Wi-Fi doesn't work, especially at work):
  - **Office Wi-Fi often blocks it.** Many corporate and guest networks use "client isolation", so the laptop and phone can't see each other, or they block mDNS, which breaks auto-discovery and QR pairing. Workarounds, in order: (1) manual pairing with the IP, port, and code typed in (works when mDNS is blocked but the devices can still reach each other), (2) put both on a **phone hotspot or a small travel router**, (3) fall back to USB.
  - **Phone and laptop must be on the same network/subnet.** The UI checks this and says so.
  - **Wireless debugging needs Android 11+.** Older phones use the legacy `adb tcpip` route, which requires one USB connection to set up.
  - **The port changes** each time wireless debugging is toggled on Android 11+, so PlayLens re-discovers it instead of storing a fixed port.
  - Some Xiaomi/Huawei/Samsung versions turn wireless debugging off when the screen sleeps. The UI gives a per-brand hint.

### 3.3 Choosing the game
- List apps with `pm list packages -3`. Show **Pinned games** first. You can give each package a friendly name and icon color in the config.
- **"Follow foreground app"** mode reads `dumpsys activity activities` (the resumed activity) and auto-selects the game you open on the phone.
- **PID tracking:** a game restart gets a new PID, so the server streams the **full** logcat and filters by a live set of PIDs for the package, including `:subprocesses`. The set is updated from `ActivityManager: Start proc …` lines and a `pidof` poll every 1 s as a safety net.
- **Quick actions:** Launch, Force stop, Restart, Clear data, Uninstall, **drag and drop an APK to install** (`adb install -r`), and Screenshot (`screencap`, nice to have).
- **App state badge:** Running, Stopped, or Crashed. On a crash the badge flips red with an animation and the crash appears in the Crashes tab.

### 3.4 Log streaming and parsing
- Command: `adb -s <serial> logcat -v threadtime -v epoch -b main,system,crash`. Before streaming starts, the user chooses "from now" (`-T 1`) or "include recent buffer".
- **Line parser:** splits each line into timestamp, PID, TID, level, tag, and message. Lines that don't parse are kept as raw lines.
- **Multiline grouper:** consecutive lines with the same PID, TID, tag, and timestamp are merged into one entry. That way a Unity exception and its stack trace are a single row you can expand.
- **Which lines are kept:**
  - Lines from the app's own PIDs.
  - **Plus allowlisted system lines that relate to the app**, even though they come from other processes:
    - `FA-SVC` (Firebase lines logged by the Google Play Services process)
    - `AndroidRuntime` FATAL EXCEPTION for the package
    - `DEBUG` / `crash_dump` tombstones (native crashes)
    - `ActivityManager` "ANR in <pkg>" and "Process <pkg> has died"
    - `libc` fatal signals
  - A toggle shows **all device logs**.
- **Entry model:**
  ```ts
  type LogEntry = {
    id: number; ts: number; pid: number; tid: number;
    level: 'V'|'D'|'I'|'W'|'E'|'F';
    tag: string; message: string; lines?: string[];   // stack trace, if any
    source: 'unity'|'firebase'|'bytebrew'|'ads'|'crash'|'system'|'app';
    kind?: 'exception'|'native-crash'|'java-crash'|'anr'|'analytics'|'flag';
    flags?: string[];                                 // ids of watch rules that matched
  };
  ```

### 3.5 Classifiers
| Classifier | Detects |
|---|---|
| **Unity** | Tag `Unity`. `Debug.Log` maps to I, `LogWarning` to W, `LogError` and exceptions to E. Exceptions are detected by the `XxxException:` pattern and their C# stack frames are grouped. Also tags `IL2CPP`, `CRASH` (Unity's native crash reporter), and `UnityMain`. |
| **Custom logger** | Your games use a **custom logger**, so its output format is configured per profile instead of hard-coded (see §6.1). It extracts level, category/channel, and message from your format, and categories become a filter chip group. |
| **Crash** | Java: `AndroidRuntime` FATAL EXCEPTION. Native: `*** *** ***` tombstone blocks with backtrace. ANR. Each becomes a **Crash card**: summary, top frame, full trace, timestamp, and a copy button. |
| **Firebase** | See §5. |
| **ByteBrew** | See §6. |
| **Ads** | Tags such as `AppLovinSdk`, `IronSource`/`LevelPlay`, `Ads` (AdMob), `UnityAds`. These lines get an "Ads" source badge and feed the watch rules. |

### 3.6 Filtering and search
- **Quick filters:** level chips (V D I W E F), source chips (Unity, Firebase, ByteBrew, Ads, Crash, System), tag include/exclude.
- **Query bar** with autocomplete:
  `tag:Unity level>=W "failed to load" -tag:Choreographer source:ads /reward(ed)?/i`
- **Saved filters**, for example "Ads only" or "Errors and crashes", are stored in your config.
- Matching text is highlighted. Click a tag or PID in any row to filter by it.
- Filtering and search run in a **Web Worker** over the client ring buffer (default 200k entries, configurable).
- **Autoscroll:** pauses when you scroll up and shows a floating "↓ 132 new lines" pill. Clicking it jumps back to live.

---

## 4. UI and UX design

### Layout
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◉ PlayLens   [Pixel 7 ▾]  [com.studio.puzzle ▾ ● Running]   ⏸ ⟲ ⏺  ⌘K   │
├────────────┬─────────────────────────────────────────────┬───────────────┤
│ DEVICES    │  Logs | Events | Checklist 4/6 | Flags 3 |   │  INSPECTOR    │
│ ● Pixel 7  │  Crashes 1                                  │               │
│   USB      │  ┌───────────────────────────────────────┐  │  level_start  │
│ ○ Galaxy   │  │ query: level>=W source:ads           │  │  firebase     │
│   Wi-Fi    │  └───────────────────────────────────────┘  │  12:03:44.120 │
│ + Pair     │  12:03:41 I Unity   Level 3 loaded           │  ───────────  │
│            │  12:03:44 ◆ FA      level_start {level:3}    │  level   3    │
│ GAMES      │  12:03:45 W Ads     MAX interstitial NO_FILL │  mode classic │
│ ★ Puzzle   │  12:03:47 E Unity ▸ NullReferenceException   │               │
│ ★ Runner   │  ...                          [↓ 132 new]    │  [Copy JSON]  │
└────────────┴─────────────────────────────────────────────┴───────────────┘
```

**Views:**
- **Logs:** the main live stream.
- **Events:** timeline of analytics events, one lane per SDK (Firebase, ByteBrew). Shows event name chips with params, and *logged* vs *uploaded* status where the logs show it.
- **Checklist:** expected-event verification (§7).
- **Flags:** every watch-rule hit, grouped by rule, with counts and extracted values.
- **Crashes:** crash and ANR cards.
- **Inspector:** right-hand drawer for the selected row or event. Shows a params table, a collapsible stack trace, "copy as text/JSON", and "create rule from this line".

### Visual language
- Dark-first, with a light theme. Neutral graphite background and one accent color.
- Each source has a consistent color badge: Unity is white/grey, Firebase amber, ByteBrew violet, Ads green, Crash red.
- Fonts: **Inter** for the UI and **JetBrains Mono** for logs. Dense but readable rows (22–24 px) with a compact-mode toggle.
- Soft glass panels, 1 px borders, subtle shadows. Everything uses design tokens (CSS variables) so themes stay consistent.

### Animations (purposeful, never in the way)
| Where | Animation |
|---|---|
| Device plugged in or removed | Card springs in or collapses out (`AnimatePresence`, layout). |
| Connection states | Pulsing status dot. Smooth color morph from connecting to connected. |
| Wi-Fi pairing | QR modal scales in. A step indicator advances as discovery, pairing, and connection complete. Success ends with a check-mark draw animation. |
| Tab switching | Shared-layout underline (`layoutId`). Content cross-fades. |
| New analytics event | The event chip pops into the timeline. The Events tab badge ticks up. |
| Checklist item verified | Row flashes the accent color. A check mark draws in with a spring. The progress ring fills. |
| Watch-rule hit (critical) | Toast slides in, with optional sound or desktop notification. The Flags badge bounces. |
| Crash | App badge turns red with a shake. The crash card slides into the Crashes tab. |
| Inspector | Slides in from the right. Stack frames expand with height animation. |
| Log rows | Fade in only at low throughput. Above about 50 lines/s row animation turns off automatically to protect frame rate. |

All animation respects `prefers-reduced-motion`.

**Performance budget:** 60 fps while streaming 2,000 lines/s on a mid-range laptop. Only low-frequency elements are animated.

### Keyboard
`⌘K` / `Ctrl+K` palette (switch device or app, run any action, jump to a view) · `/` focus search · `Space` pause/resume · `⌘L` clear · `E` errors-only toggle · `J`/`K` move through rows · `Enter` open inspector.

---

## 4b. Modes and UI components (added after design pass 1)

**You pick one view at a time.** After a device and game are chosen, the first screen asks what you want to look at. Only the views that need preparation ask you to set something up, and each setup can be skipped when it's already done.

| View | Setup before it opens | Skip |
|---|---|---|
| **Logs** | None. Opens immediately. | n/a |
| **Firebase events** | 3-step stepper: turn on debug mode, restart the game, listen for the first events (about 20 s). | "Already done? Skip to events" |
| **Checklist** | 3-step stepper: choose a rules file, start a run (clears and records), play (about 10 s). | "Run already going? Open the checklist" |

The left rail shows all three views and their state (ready, needs setup, listening, run live), so switching is one click and never forces a setup you don't need. The logs always run in the background, so switching away from Logs doesn't lose lines.

**Components from React Bits** (installed with shadcn after the project is set up):
```
npx shadcn@latest init
npx shadcn@latest add @react-bits/GradientASCII-JS-CSS   # animated ASCII gradient background
npx shadcn@latest add @react-bits/LineSidebar-JS-CSS     # the view switcher rail
npx shadcn@latest add @react-bits/Stepper-JS-CSS         # setup steps, QR pairing steps
```
- The design mock approximates these three. I could not reach reactbits.dev from this environment, so I haven't read their code or the micro components list. Before building, check the real components match the design, and pick micro components from https://www.reactbits.dev/c/micro for buttons, counters, and status dots.
- The plan uses TypeScript, and React Bits also offers TS variants (`...-TS-CSS`). Use those unless you prefer plain JS.
- Check each component's license note and that it works with React 18 and Vite.
- The ASCII background sits behind the whole app at low contrast and is masked out where text is dense, so logs stay readable. A setting turns it off, and it stops moving when the OS asks for reduced motion.


### 4b.1 Micro-interaction components (React Bits)

These seven were chosen by you. I couldn't open reactbits.dev from this environment, so **the mapping below is based on the component names only**. Check each one against its docs page before building and move it if it behaves differently.

```
npx shadcn@latest add @react-bits/BellToggle-JS-CSS
npx shadcn@latest add @react-bits/CallChip-JS-CSS
npx shadcn@latest add @react-bits/GlideSelect-JS-CSS
npx shadcn@latest add @react-bits/LatticeLoader-JS-CSS
npx shadcn@latest add @react-bits/SpringCheck-JS-CSS
npx shadcn@latest add @react-bits/StatusMark-JS-CSS
npx shadcn@latest add @react-bits/SwipeToast-JS-CSS
```

| Component | Where it goes | In the design now |
|---|---|---|
| **BellToggle** | The "Alerts" switch: turns pop-up alerts for rule hits on or off. | Yes, in the Logs header |
| **SwipeToast** | Rule-hit alerts, "device disconnected", "copied", "rules reloaded". | Yes, slides in on a flagged log line, bottom right |
| **LatticeLoader** | Waiting states: "listening for events", "searching for devices", "reconnecting". | Yes, Firebase setup step 3 |
| **SpringCheck** | Verified items in the checklist and finished setup steps. | Yes, on the checklist |
| **StatusMark** | Device and app state: connected, ready for Unity, running, idle, error. | Not yet, the design uses plain dots and tags |
| **GlideSelect** | The device and game selectors at the top. | Not yet, they are still static buttons |
| **CallChip** | Unclear from the name. Likely a compact live-status chip, so a candidate for the "connected device" chip in the header. Confirm before using. | Not yet |

If StatusMark and GlideSelect turn out as expected, they replace the hand-drawn dots and the static selectors, and the plan keeps all the connection states in one place (one component, one set of colors) so "Ready for Unity" looks the same everywhere.

---

## 4c. Look and feel (design pass 2)

**Name:** AVN PlayLens.

The design canvas now has three pages:
- **v1 · first pass:** the original screens, kept for comparison.
- **v2 · Lofi console:** the first pass rebuilt to be calmer and easier to read, with a cozy, retro-tech, lofi feel.
- **v3 · AVN Hub style:** the same app built with the AVN Hub design skill (`Zohaib2244/avn-style`, `nutstyle` and `avnhub-design`).

**Decided: v2 · Lofi console.** v3 stays on the canvas for reference only. The v2 page now also has the **Plugin health** screen (§6.2), and Plugin health is in the left rail of every v2 screen.

**What changed to make it less overwhelming (both v2 and v3)**
- One thing per screen. The always-open inspector is gone from Logs in v2: you click a line and its details open inline below it.
- Fewer controls. The level filter is one three-way switch (All, Warnings, Errors) instead of four chips, and source chips are gone.
- Bigger, calmer text. Rows are taller (40 px), body text is 15 px, and logs use a monospace font made for reading.
- Level is shown by a small coloured mark, and only warnings and errors get a word. Plain info lines don't shout.
- The ASCII background is only kept where there's no data to read. Data screens use a quiet dot texture.

**v2 · Lofi console**
- Warm night palette (cocoa background, cream text, a lamp-peach accent, soft teal for "ok").
- Fonts: Pixelify Sans for titles (the retro touch), Atkinson Hyperlegible for UI text (built for readability), IBM Plex Mono for logs.
- The home screen has a small animated pixel-art scene: a desk at night with the phone on a stand, a steaming mug, a radio, twinkling stars.
- QR pairing sits in a little retro handheld frame.

**v3 · AVN Hub style** (follows the skill's hard rules)
- Tokens and palettes from `tokens.css`. Ember is the default, and the design also carries circuit, slate, and graphite in dark and light (switchable in the canvas Tweaks, and dark/light with the round toggle).
- DotGothic16 for labels and stats, JetBrains Mono for content, the five-step type scale only, sticker cards with hard offset shadows and no blur.
- Page canvas: everything inside one `.frame` bezel, a slot grid (left / Central Base / base / right), and the **Hub Core dock** at the bottom.
- **The modes are canvases.** The dock pills are home · logs · firebase · checklist, plus connect, canvas settings, and the `ctrl+k` palette. Each mode is its own widget layout.
- Widgets: devices, connect-by-QR, Central Base hero (live logs, events, checklist, or the "ready to build" status), stats strip, inspector, rule hits, recent sessions.
- Building v3 for real means porting `tokens.css` and `base.css` as plain CSS (outside Tailwind), loading the two fonts, and following `avnhub-design` for the dock, grid, and widget manifest.

---

## 5. Firebase Analytics events

**How it works:** the Firebase Unity SDK wraps the native Android SDK. With debug mode and verbose logging on, the native SDK prints each event to logcat.

**One-click "Firebase debug" toggle in the UI.** It runs:
```
adb shell setprop debug.firebase.analytics.app <package>   # debug mode (also enables DebugView)
adb shell setprop log.tag.FA VERBOSE
adb shell setprop log.tag.FA-SVC VERBOSE
```
and turns them off with `setprop debug.firebase.analytics.app .none.`.

The app must be **restarted** after enabling. The UI offers "Restart app now". Note that the log-tag props reset when the phone reboots.

**Parser:**
- Matches `FA` and `FA-SVC` lines such as `Logging event: origin=app,name=level_start,params=Bundle[{...}]` and `Logging event (FE): level_start(_xx), Bundle[{...}]`.
- Parses the `Bundle[{k=v, ...}]` params into typed key/value pairs (number, string, boolean).
- Normalizes the `name(_short)` format and maps auto-collected short names (`_s` session_start, `_vs` screen_view, `_e` engagement, and others) to readable names. Auto events can be hidden with a toggle.
- Also captures **user properties** ("Setting user property") and upload lines ("Uploading data", "Successful upload"), so an event can show *logged → uploaded*.
- Removes duplicates when the same event shows up in both the `FA` and `FA-SVC` lines.

**Risk:** these log formats are not a documented API and change between SDK versions. Mitigations:
- (a) Several regex patterns with **fixture tests built from your real logs** (Phase 0).
- (b) A fallback that shows unparsed FA lines raw in the Events view.
- (c) An optional QA bridge (§6) that works for Firebase too.

**Event model:**
```ts
type AnalyticsEvent = {
  id: string; ts: number; sdk: 'firebase'|'bytebrew'|string;
  name: string; params: Record<string, string|number|boolean>;
  status: 'logged'|'uploaded'; logIds: number[];   // links back to the raw log lines
};
```

---

## 6. ByteBrew events and the QA bridge

**Step 1, verify (Phase 0):** run your game with ByteBrew and capture logcat, then check the ByteBrew SDK for a debug or verbose logging option. If ByteBrew already prints events in a parseable way, write a `bytebrew.ts` classifier the same way as Firebase.

**Step 2, fallback (likely needed): the QA bridge.** This is a tiny optional Unity package (`unity/com.yourstudio.qalog`) that you call wherever you send analytics:

```csharp
// Wrap the calls you already make
QALog.Event("bytebrew", "level_complete", new() { ["level"] = 3, ["time"] = 41.2 });
ByteBrew.NewCustomEvent("level_complete", "level=3;time=41.2;");
```

It writes one structured line:
```
Unity  I  [QA_EVT] {"sdk":"bytebrew","name":"level_complete","params":{"level":3,"time":41.2}}
```

- PlayLens parses `[QA_EVT]` lines exactly, with no regex guessing.
- It works for **any SDK**: ByteBrew, Firebase, AppsFlyer, Adjust, or your ad SDK's revenue callbacks.
- It's compiled out of release builds with a scripting define (`QA_LOG`), so it costs nothing in production.
- Matching `[QA_FLAG]` and `[QA_STEP]` lines let your game mark test checkpoints, for example "entered shop", that rules can refer to.

This is the most reliable path for event verification. It's still optional, and Firebase works without it.

### 6.1 Integration with your custom logger (decided)
You already route logs through a custom logger, so there's **no separate QALog package to call**. The bridge becomes a few methods added to your existing logger:

```csharp
// Inside your existing logger class
[Conditional("QA_LOG")] public static void Event(string sdk, string name, Dictionary<string, object> p) =>
    Emit($"[QA_EVT] {Json(new { sdk, name, @params = p })}");
[Conditional("QA_LOG")] public static void Step(string name) => Emit($"[QA_STEP] {name}");
```

Then call `GameLogger.Event(...)` in your analytics wrapper next to the ByteBrew and Firebase calls.

PlayLens reads your logger's normal lines through a **logger format** in the game's profile:

```yaml
logger:
  tag: Unity                       # or your own tag if the logger writes to Android Log directly
  pattern: '^\[(?<level>\w+)\]\[(?<category>[^\]]+)\]\s(?<message>.*)$'
  levels: { DBG: D, INF: I, WRN: W, ERR: E }   # map your level names to logcat levels
```

**Needed from you in Phase 0:** a few sample lines from your logger, one per level, plus one exception. Tell me also whether the logger writes through `Debug.Log` or straight to Android Log.

---

### 6.2 AVN plugin logs: the reference the checker uses (decided)

Source: `AVN_PLUGIN_LOG_REFERENCE.md` (plugin code under `Assets/_DT1_AdsPlugin/AVNPlugin/Scripts/Runtime`, reviewed 2026-10-20). Ads are **AppLovin MAX**; App Open is **AdMob**.

**How PlayLens reads it**
- Only lines with the `| AVNPLUGIN` suffix on tag `Unity` are parsed. Editor `<color=cyan>` tags are stripped. Game-specific scripts (`User Setup/*`, `GameAnalyticsEvents`, game folders) are never parsed by the shared checker.
- The parser turns each line into a structured entry: hub **status** (key, state, message), **counter** (key, name, value, reason), **MAX callback** (format, callback, unit, network, latency, error fields), **adapter**, **banner**, **analytics event**, **remote config** (fetch result, value sources, applied AdConfig, effective ad IDs) or **plain** with its `[Class.Method]` caller.
- **Prototype built and tested:** `avn-playlens/packages/server/src/avn/parse.mjs`. Its 16 tests (`parse.test.mjs`) pass on the reference's example lines.
- **Check pack:** `avn-playlens/rules/packs/avn-plugin.yaml` has:
  - build checks
  - the startup sequence with its 20 s timeouts
  - 16 watch rules
  - 4 ad flows (interstitial per slot, rewarded, app open, banner/MREC)
  - the 22-event catalogue with expected parameters and Firebase limits
  - 7 one-click checklist presets
  - the known gaps

**Severity gating matters**
- Info lines only exist with `USE_AVNADS_PLUGIN_DEBUG`, but warnings and errors are always written.
- PlayLens shows a banner when the symbol is off ("only warnings and errors are visible").
- It flags a critical issue when the symbol is on in a non-debuggable (release) build.

**What this changes in the app**
- **New view: Plugin health** (no setup). It's built from the hub status and counter lines:
  - every hub key with its current state (SDK.Firebase, SDK.AdsProvider, SDK.AdMob, SDK.RemoteConfig, Ad.Interstitial.<slot>, Ad.Rewarded, Ad.AppOpen, Ad.Banner.*, SDK.Purchaser)
  - the startup timeline against section 2, with durations and timeouts
  - the MAX adapter table, where `NotInitialized` is shown as neutral, not a fault
  - an ad funnel per format: load sent → loaded → show sent → displayed → closed → revenue
  - the remote config panel: whether values came from the server, the applied AdConfig values, and the effective ad IDs
- **Firebase events come from Firebase itself, through adb.** The events view is built from the `FA` / `FA-SVC` debug lines, which needs the Firebase debug setup and a game restart (section 5). Parser: `avn-playlens/packages/server/src/avn/fa.mjs`.
- **The plugin lines are a cross-check, not the source.** `crosscheck.mjs` pairs each event the plugin says it handed to Firebase with a Firebase log line of the same name within 5 s:
  - **matched:** the plugin sent it and Firebase logged it.
  - **not logged** (warning): the plugin sent it, but Firebase never logged it. This is the "sent but not recorded" case.
  - **Firebase only** (info): Firebase logged an event the plugin didn't send, meaning game code called Firebase directly. Automatic events (session_start, screen_view, …) are ignored.
  - Each event row in the view shows its cross-check result.
- Tests: `parse.test.mjs` (16) and `fa.test.mjs` (8) all pass. The FA line formats in `fa.test.mjs` are the commonly seen Firebase SDK formats, not lines captured from your games, so they need confirming in Phase 0.
- **ByteBrew is answered:** with `USE_BYTEBREW`, the plugin writes `SendToByteBrew sent event=<name>, params=<n>`. That gives the name and the parameter count, but not the values. ByteBrew has no adb debug log of its own, so these plugin lines are the only ByteBrew source; they're shown as "plugin only". Games without the symbol (Zombie Rush) set `byteBrew: false` in their profile, and ByteBrew checks are skipped.
- **Revenue is the only proof of an impression** (MAX `RevenuePaid`, banner `revenue paid`, AdMob `paid event`). Ad flows count an ad as shown only when it appears. Every revenue line must be followed by `ad_impression`.
- **Custom remote config keys:** the checker only asserts `source=Remote`, never their values. Their meaning is per game.

**To confirm on a real device (Phase 0)**
1. Do `Counter` lines carry the `| AVNPLUGIN` suffix? The reference shows both forms, so the parser accepts both.
2. What is the exact parameter format inside `Firebase event handed to SDK: <name> (<params>)`? The parser assumes `k=v, k=v`.
3. Long lines: Android cuts logcat lines at about 4 KB, so long `AdConfig … : <json>` lines may be truncated.
4. Capture one full launch with the debug symbol on and one with it off, and save them as fixtures.

---

## 7. PLUS layer: rules engine (watch rules and expected events)

This was designed in from the start, so you can add rules at any time without code changes.

### 7.1 Concepts
- **Profile:** the rules for one game (package name). It is loaded automatically when you select that game.
- **Pack:** a reusable set of rules, for example `applovin-max`, `levelplay`, or `firebase-core`. A profile `extends` packs.
- **Watch rule:** "flag any log line that matches X". It has a severity (info, warning, critical), a color, a notification type, and optional **capture groups** that pull values out of the line (network, ad unit, revenue).
- **Expected event:** "verify that event Y is sent, with these params, this many times, in this order". It shows up as a live checklist.

### 7.2 Where rules live
- `~/.playlens/rules/` locally,. They're personal and not shared with anyone (decided).
- Rules are **hot-reloaded** on save. They can be edited in the built-in UI editor (form plus YAML view, schema-validated with inline errors) or in VS Code. A JSON Schema is generated from zod so VS Code autocompletes the YAML.

### 7.3 Rule file format (example)
```yaml
profile: com.studio.puzzle
name: Puzzle Quest
extends: [applovin-max, firebase-core]

watch:
  - id: max-load-failed
    name: MAX ad failed to load
    match:
      source: ads                 # or tag: AppLovinSdk
      message: /(failed to load|NO_FILL|error code -?\d+)/i
    severity: warning
    notify: toast                 # none | toast | sound | desktop
    capture:
      adUnit: /ad unit id[=: ]+(\w+)/i
      code: /code[=: ]+(-?\d+)/

  - id: max-revenue
    name: Ad revenue paid
    match: { message: /onAdRevenuePaid|revenue/i, source: ads }
    severity: info
    capture: { network: /network[=: ]+(\w+)/i, revenue: /revenue[=: ]+([\d.]+)/i }

  - id: unity-exception
    name: Any Unity exception
    match: { source: unity, kind: exception }
    severity: critical
    notify: desktop

expect:
  - id: level-start
    name: level_start fires with level number
    event: level_start
    sdk: firebase                 # firebase | bytebrew | any
    params:
      level: { type: number, required: true }
      mode:  { oneOf: [classic, hard] }
    count: { min: 1 }

  - id: level-complete
    event: level_complete
    sdk: firebase
    after: level-start            # ordering check
    within: 10m
    params:
      level: { type: number, required: true }
      stars: { type: number, range: [0, 3] }

  - id: bb-level-complete
    event: level_complete
    sdk: bytebrew

  - id: no-unknown-params
    event: purchase
    sdk: firebase
    params:
      value:    { type: number, required: true }
      currency: { regex: "^[A-Z]{3}$", required: true }
    strictParams: true            # flag params that aren't listed
```

### 7.4 Engine behavior
- Watch rules are compiled once when loaded (regexes precompiled) and checked against each entry. Target: under 5 µs per entry for about 50 rules.
- Expected events are a small state machine per rule:
  `pending → seen ✓` or `seen with problems ⚠` (wrong or missing param, wrong order, too many or too few), and `missing ✗` when the session ends.
- Every checklist item links to the exact event and log line that satisfied or broke it. Click to jump.
- **"Create rule from this line/event"** in the inspector pre-fills a rule from what you clicked.
- **Test runs:** press ⏺ to start a run. The checklist resets and everything is recorded. At the end you get a **report** (HTML or Markdown): pass/fail per expected event, flag counts, crashes, device and build info. You can send it to QA or attach it to a ticket.

### 7.5 Built-in packs
- `firebase-core` (v1): session_start present, screen_view present, no events with invalid names (over 40 characters, reserved prefixes), param limits (more than 25 params, values over 100 characters).
- **Ad SDK packs are deferred.** You'll send your ad SDK and sample logs later. The engine is fully generic, so the pack is just a YAML file written from those logs, with no code changes.

---

## 8. API and protocol

**REST:** `GET /api/devices`, `POST /api/devices/pair`, `POST /api/devices/connect`, `GET /api/devices/:serial/apps`, `POST /api/devices/:serial/apps/:pkg/{launch|stop|clear|install}`, `POST /api/firebase-debug`, `GET/PUT /api/rules/...`, `GET /api/sessions`, `GET /api/sessions/:id/export?format=jsonl|txt|html`.

**WebSocket (`/ws`):**
- Server to client: `devices.update`, `app.state`, `log.batch` (batched every ~50 ms), `event`, `flag`, `checklist.update`, `rules.reloaded`, `stream.stats` (lines/s, dropped lines).
- Client to server: `stream.start {serial, pkg, fromNow}`, `stream.pause`, `stream.resume`, `stream.clear`.

**Security:** no login (decided; it only runs on this computer).
- Binds to `127.0.0.1` only.
- `Origin` and `Host` headers are checked, so other websites open in the browser (and DNS-rebinding tricks) can't send adb commands.

---

## 9. Sessions, export, and replay
- Every stream is recorded as `~/.playlens/sessions/<date>_<pkg>.jsonl.gz`, with a retention limit (for example, last 50 sessions or 2 GB).
- **Open past sessions** in the same UI, with the same filters, events, and checklist.
- **Import** a plain `adb logcat` text file a tester sent you, and get the same analysis offline.
- **Export:** raw text, JSONL, or the HTML test report.
- **Replay mode:** feeds a captured log through the pipeline as if a device were connected. Used for development, demos, and automated tests.

---

## 10. Delivery phases

| Phase | Scope | Output | Est.* |
|---|---|---|---|
| **0. Spike and validation** | On your real game: capture logcat with Firebase debug on and off, check ByteBrew output and debug options, capture your ad SDK's log tags and messages, capture one Unity exception, one native crash, and one ANR (test scene). Confirm the Wi-Fi pairing flow on your phones. | `fixtures/` folder, decision on ByteBrew (native logs or QA bridge), tag list for the ad packs | 1–2 days |
| **1. Core MVP** | Monorepo, adb locator, USB device tracking, app list and foreground detection, PID tracker, logcat pipeline (parse, group, filter), WS streaming, virtualized log view with level, source, and text filters, replay mode | You can watch your game's logs live in the browser | 4–5 days |
| **2. Connectivity and control** (also usable on its own: build-to-device without any log view) | Wi-Fi: QR pairing, pairing code, legacy tcpip, remembered devices. Device details. App actions (launch, stop, clear, APK drag-and-drop install). Crash and ANR classifier and Crashes view. | No more USB cable or on-phone console needed | 3–4 days |
| **3. Analytics** | Firebase debug toggle, FA/FA-SVC parser with fixture tests, Events timeline and inspector. ByteBrew via the chosen path. QA bridge Unity package. | Firebase and ByteBrew events visible and searchable | 3–4 days |
| **4. Design polish** | Design tokens, themes, all animations from §4, command palette, keyboard shortcuts, query-bar autocomplete, empty and error states, onboarding ("connect your first device") | The smooth, polished UI | 3–4 days |
| **5. PLUS layer** | Rule schema and JSON Schema, loader with hot reload, engine, Flags view, Checklist view, rule editor UI, "create rule from line", notifications, built-in packs, test runs with HTML report | Your custom ad-SDK flags and event verification | 4–6 days |
| **6. Sessions and ship** | Session recording, browse, import, export, retention. Packaging (`npx` and single binaries for Mac and Windows). README and docs. Performance test at 2k lines/s. | Installable, documented v1 | 2–3 days |

\*Rough estimates for one developer. Phases 4 and 5 can overlap with 3.

**Milestones:** M1 (end of Phase 1): logs in the browser · M2 (Phase 3): events visible · M3 (Phase 5): rules and verification · M4 (Phase 6): v1 release.

---

## 11. Testing strategy
- **Parser and classifier unit tests** (Vitest) against the real captured fixtures. These are the main protection against Firebase or SDK log format changes. When an SDK update breaks parsing, add the new capture as a fixture.
- **Rule engine tests:** table-driven. For each rule: matching lines, non-matching lines, param validation, ordering, counts.
- **Integration tests:** replay mode with a fake adb shim that serves `devices`, `shell`, and `logcat` from fixtures. The whole server runs with no phone attached.
- **E2E** (Playwright, using the preinstalled Chromium): connect, pick the app, stream, filter, verify a checklist item, export a report.
- **Performance test:** replay at 5k lines/s, then check the frame rate, memory ceiling, and that no WS backlog builds up.
- **Manual device matrix:** one Pixel (stock Android), one Samsung, one Xiaomi or other Chinese OEM (these have known logging and install quirks), on both Mac and Windows.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Firebase log format is undocumented and changes | Several patterns, fixture tests, raw fallback, QA bridge |
| ByteBrew doesn't log events | QA bridge (§6), decided in Phase 0 |
| Release builds strip logs (Unity "Stack Trace: None", a custom logger, or `Debug.Log` removed) | Docs on recommended QA build settings. The UI warns when it sees no Unity lines after launch. |
| Logcat truncates long messages (~4 KB) | Show a "truncated" marker. The QA bridge can split long payloads into chunks. |
| OEM quirks: Xiaomi needs "USB debugging (Security settings)" to install, Huawei has logging disabled | Fix-it hints keyed on manufacturer |
| adb server conflicts between Unity and Android Studio | Reuse the running server, warn on version mismatch |
| High log volume causes UI jank | Server-side batching, ring buffers, virtualization, filter worker, animations turn off under load |
| A local server that can control devices | Localhost-only binding, Origin/Host checks (no login) |

---

## 13. Decisions
**Settled**
- **Local only.** Runs on the PC, opens in the browser. No home server, no sync, no accounts. Everything is stored on that PC under `~/.playlens`.
- **Device tracking:** PlayLens keeps track of the devices connected to that PC, both USB and Wi-Fi, and remembers devices it has paired before.
- **Connecting over Wi-Fi: QR first.** Scan-to-pair is the main path. Pairing code and `adb tcpip` stay as fallbacks for networks that block QR discovery.
- **Ad SDK:** AppLovin MAX (App Open on AdMob) through the AVN plugin. All checks follow `AVN_PLUGIN_LOG_REFERENCE.md` (§6.2).
- **Logging:** a custom logger. PlayLens gets a configurable logger format, and the QA event bridge is added to your logger (§6.1).
- **Platforms:** macOS and Windows.
- **Look:** v2 Lofi console (§4c).
- **Rules:** personal only, kept in `~/.playlens/rules/`.

**Still open**
1. ~~Logger sample lines~~ answered by the AVN plugin log reference (§6.2).
2. One device at a time for v1, or side-by-side devices early? (Default: one at a time, but all connected devices are listed and tracked.)
3. ~~Pick the look~~ v2 Lofi.
4. Real logcat capture (one Zombie Rush launch, plugin debug on): later. Until then the parser accepts both forms where the reference is unclear (§6.2, "To confirm").

---

## 14. Later ideas (v2+)
- Several devices side by side, and comparing two sessions.
- Screen mirroring panel (scrcpy) next to the logs.
- Performance overlay: FPS, memory, CPU, battery temperature from `dumpsys gfxinfo` and `meminfo`.
- Push watch-rule hits to Slack or Discord during long soak tests.
- Remote Config / A/B variant display (if the game logs it through the QA bridge).
- iOS support through `idevicesyslog`.

---

## 16. Build progress

**Step 1 (done): core.** Code is in `avn-playlens/`. Run it with `npm start`, or `npm run replay` to try it without a phone.

Built:
- **Server** (Node, plain JavaScript modules, not TypeScript, to keep it to one build step with no compiler):
  - adb locator (Unity's adb first) and live device tracking (`track-devices`) with device details
  - app list, foreground app, PID tracking, launch / stop / restart
  - QR pairing and pairing-code pairing, remembered phones and the Wi-Fi keep-alive loop
  - logcat streaming with stack-trace grouping, the game filter (its processes + Firebase + crash/ANR lines), and classification into AVN, Unity, Firebase and crash
  - HTTP + WebSocket API on 127.0.0.1 with no login
  - replay mode
- **Page** (React + Vite, v2 Lofi design, fonts bundled so it works offline):
  - **Home:** greeting, live device cards with fix-it hints, pixel scene, view tiles
  - **Logs:** virtualized live list, search, All / Warnings / Errors, pause, inline details with stack traces and parsed parameters, crash alerts, game picker with "follow the open app", restart / stop
  - **Connect:** a real QR code, live pairing steps, pairing-code form

Tests: 34 passing.
- parsers, adb output, security checks, replay stream
- a full run of the start command against a fake adb, covering device tracking, QR pairing to a Wi-Fi phone, the remembered-device file, and live logcat with a grouped stack trace

The page was also checked in a headless browser against the fake adb, with no console errors.

**Not yet tested on a real phone or real adb.** That's the first thing to try (see the README).

**Next steps:**
- Plugin health (wire `parse.mjs` and the pack into a live state model)
- Firebase setup and events with the cross-check
- Checklist with rules files
- session recording and export
- packaging as a single download for Mac and Windows

**Step 2 (done): the rest of the app.**
- **Plugin health:** live model from the plugin lines:
  - startup sequence with 20 s timeouts
  - SDK cards with start-up times
  - MAX adapters (problems first)
  - ad funnels per format and slot, from load sent to paid, with revenue
  - remote config sources and applied values
  - warnings when plugin debug logs are off, or left on in a release build
  - watch-rule hits with "Show line"
- **Firebase setup:** a 3-step stepper that really runs the setprop commands, restarts the game and counts events as they arrive.
- **Firebase events:**
  - Firebase's own FA lines are the source
  - plugin cross-check per row: matches plugin, not in Firebase, dropped by plugin, sent before init, game code, automatic
  - ByteBrew rows from the plugin (names only)
  - Firebase limits checked on every event
  - turn off debug from the screen
- **Checklist:**
  - personal rules files with hot reload
  - "Create a rules file" template
  - pack presets (startup, remote config, ad flows, purchase)
  - parameter checks (required, type, oneOf, range, regex, order, count)
  - live run with a timer
  - HTML / Markdown report
- **Session history:** every stream saved (gzipped, last 50), recent sessions on Home, "Save log" as text.
- **Alerts:** pop-ups for crashes, ANRs, Unity exceptions and critical or warning rule hits (at most once every 30 s per rule).
- The log stream now lives at app level, so switching views never drops lines.

Tests: 38 passing. A full browser run against the fake adb with no console errors covered:
home → logs → plugin health → Firebase setup → Firebase events → create rules → checklist run → report → home.

It caught and fixed one real crash: switching games could write to a closed session file.

**Not built from the original plan:**
- single-file downloads for Mac and Windows (run with Node + npm for now)
- side-by-side devices
- command palette

**Still to confirm on a real device:** the three items in §6.2, and the FA line formats.
