# AVN PlayLens UX cleanup

Implemented on `design/avn-integration` from `avn-playlens-ux-prompt.md` and its 16 reference screenshots. The overview follows option A, selected by the user: status first. AVN Family tokens, typography, artwork, transitions and responsive shell are retained.

## Changes by requested point

1. **Sidebar:** Main contains Overview and Plugin health. Inspect contains Logs, Events (Firebase), and Remote Config (RC). Workspace contains the library and devices once.
2. **Tools:** Level Snapshooter, Checklist Verifier, and Performance are grouped together.
3. **Sessions:** Automatic archiving is off on pause, stop, restart, device/game changes, and disconnect. Unsaved temporary recordings are removed when finished. Explicitly saved captures remain available through **Open saved sessions** in Ctrl+K; both session pages and the session toolbar have been removed from normal navigation. **Save current capture**, **Start a new capture session**, and **Stop capture session** remain explicit commands.
4. **Devices:** Consistent grid columns and stretched cards. Real phones replace an already selected simulator when they arrive. An unauthorized/offline phone is never masked by automatic simulator selection. The simulator is labeled **Demo simulator** with an explanation; the active phone has an **Active device** badge and highlighted card.
5. **Device selection:** **Use this device** has a distinct area above connection management; **Currently active** confirms the selection.
6. **Auto-reconnect:** Each remembered Wi-Fi phone has a labeled on/off switch, immediate feedback, disabled controls while saving, and error rollback. Toggling it leaves the current connection intact. USB reconnect behavior is explained inline.
7. **Device recognition:** Pixel phone illustrations use randomly assigned variants, persisted per device. Reconnects retain the illustration; no customization control is added.
8. **Notifications:** The bell opens an anchored dropdown. Notification creation uses pure React updaters; repeated alerts occupy one history entry, and the app bridge guards against duplicate delivery.
9. **Game icons:** PNG, JPEG and WebP images up to 20 MB are resized to at most 512 pixels and compressed automatically before the existing storage API receives them. The form explains this and shows upload progress.
10. **Game card tint:** A subtle card tint is sampled from its uploaded icon; games without an icon use the palette accent.
11. **Card statuses:** One status and a short explanation replace Quiet, Tracking paused, and contradictory installation badges. No device, simulator, loading inventory, missing installation, ready, and capturing are distinguished.
12. **Overview:** Device, capture, and problem state lead the screen. The duplicate navigation tiles and recent-session panel are removed. A short issue preview and specific next steps replace them.
13. **Game scope:** The in-page game selector is removed from Logs. Ordinary game switching stays in the sidebar. Explicit command actions name/select their game before opening a page. The overview identifies the active phone and links to device management.
14. **Health summary:** A plain count of **issues to fix** precedes the issue list and detailed metrics. Release debug logging is included as an explained issue instead of a separate banner above the summary. Overview, sidebar, and health page use the same issue calculation.
15. **Health alignment:** Ad rules and Consent & privacy share equal grid columns. Check names, notes and results use consistent rows, with long values wrapping and a single-column layout on smaller screens.
16. **Ad counts:** **Load failed** is its own column, with nonzero failures in red. Loaded remains an independent count. Wider columns scroll inside the table on narrow screens.
17. **Firebase setup:** Steps show waiting, listening, and done states. A successful restart advances directly to listening. Receiving a Firebase event completes setup and exposes **Done — open Firebase events**. Waiting states explain what to do; simulator evidence remains labeled.
18. **Events:** Firebase and ByteBrew are spelled out. The dictionary retains Count and Last seen, removes Avg. gap, and displays readable parameter name/value chips. Values refer to the latest retained matching event; unavailable values are stated. Repeated hidden-parameter counts are removed. The timeline uses spacious event rows and wrapping parameter chips, following the supplied reference.
19. **Diagnostics:** The SDK/upload diagnostics section is removed from the Firebase page. Raw evidence remains inspectable in Logs.
20. **Closing fields:** Live table cells now render without creating new React component types on every update. Expanded config values and focused inputs retain their DOM and state. The edit-game dialog is also checked during live updates. The supplied screenshot points to config expansion, so both interpretations were covered.
21. **Config types:** Registered types take precedence. When no registered type exists, parsed objects/arrays display JSON instead of JavaScript's object/array label. Registered strings retain their registered type.
22. **Fetch noise:** The repeated internal fetch/cache operation text is removed beneath source values. The useful Remote/Default/Cache provenance remains.
23. **Appearance:** Light and Dark explain their surface brightness. Palette names have a shared description of their colors. Compact and Roomy explain row/control spacing.
24. **View links:** The extra View events action column is removed. Selecting an event name opens its timeline; config expansion and evidence links remain useful, named actions.
25. **Refresh:** The top action says **Refresh library** and names game-library/installed-version refresh in its tooltip and accessible label. Failures produce a clear notification.
26. **Global search:** Ctrl+K searches all pages, games, devices, and actions from any screen. Game-scoped pages collect a game parameter, with the current game first. Empty and unavailable states explain the prerequisite.
27. **Action runner:** Commands start/stop/resume capture, explicitly save a capture, switch game/device, toggle a paired phone's auto-reconnect, open optional history, and open pages for a chosen game. Action definitions declare a parameter kind and handler so new actions share search, selection, keyboard controls, loading, and error behavior.

## Interpretation choices

- Retained session storage/export support as an optional command feature; no automatic saving preference or history navigation was added.
- Auto-reconnect is a per-paired-Wi-Fi-device preference. A global default was unnecessary; USB behavior is explained instead.
- Retained named palettes with descriptions because they are part of the existing AVN art style.
- Firebase completion means an event was observed in this device capture. It does not claim delivery to Firebase servers.
- Device selection prioritizes a real phone whenever one is present. Simulator use is available when real phones are disconnected.
- Changes to the server are limited to opt-in session retention and the saved-device auto-reconnect preference API; packaging and the capture protocol architecture are retained.

## Verification

- `npm run typecheck`: passed for the web app and `@avn/ui`.
- `npm test`: 107 server tests and 28 frontend tests passed; the existing fake-ADB integration test is skipped.
- `npm run build`: passed. Vite still reports its existing warning about bundles larger than 500 KB.
- `npm run test:e2e`: all 39 browser checks passed. All six focused config checks also passed after the final responsive refinement, across all three widths. Screenshots are generated under `test-results/`; the HTML run report is under `playwright-report/`.
- Browser checks cover desktop (1440 × 1000), tablet (780 × 900), and phone (390 × 844), including dark/light themes, Nutmeg/Moss palettes, reduced motion, keyboard navigation, page overflow, drawers, icon compression, command parameters, config expansion, notifications, and device selection/preferences.
- Browser evidence uses an isolated replay library and simulated device/API fixtures. It does not verify a physical phone or Firebase server delivery, and it does not modify the user's saved game library.

## Follow-up screenshot feedback

- **Startup fill:** Removed the fixed 64% progress rail. Each connector reflects the two adjacent steps; all eight completed steps produce seven green connectors. Phones show a vertical sequence.
- **SDK cards:** Removed the probe handoff, country/adapter fraction, and App Open footnotes. Kept name, state, measured startup time, and actionable failures.
- **Event reading:** Replaced the cramped six-column timeline with time, event/status, and spacious parameter chips. Values wrap, additional parameters expand inline, and details use separated name/value rows.
- **Event meaning:** Actual Firebase log payloads, including automatic events, say **Recorded by Firebase**. A plugin send without a matching payload says **Not confirmed** or **Waiting for Firebase**. Explicit plugin drops say **Not sent**. Recording on a device does not establish server delivery; the UI links to [Firebase DebugView](https://firebase.google.com/docs/analytics/debugview) for that check.
- **Config reading:** Broad **Show fields** controls and row clicks expand a structured inspector across the table. Nested objects and lists have full-width controls. Expansion stays open across monitor updates. Narrow layouts use stacked key/value cards so keys and field values stay visible without sideways scrolling.
- **Missing config:** Missing, empty JSON, invalid JSON, and truncated values show explicit errors. Keys seen only in source metadata are included instead of disappearing. Valid `false`, `0`, and intentional empty strings remain visible values. `StaticValue` means Firebase returned a built-in fallback because no active server value or app default was available, as described in [Firebase's value-source documentation](https://firebase.google.com/docs/reference/android/com/google/firebase/remoteconfig/FirebaseRemoteConfigValue). Sources now use **Firebase server**, **App default**, **Saved on device**, and **Not configured**.
- **Command reading:** Removed repeated action descriptions and current-game suffixes. Rows size to their content, title/package spacing is consistent, and game choices use their game artwork or initials.
- **Auto-reconnect stability:** Saving the preference has its own loading state and a reserved feedback area. It no longer changes Disconnect into a spinner/Working label or resizes the card. Browser checks hold the request open and compare card and button geometry during the save.
