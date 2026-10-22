# Automated game QA plan

Status: proposed roadmap. The automation in this document is not implemented yet.

## Goal and use case

Turn PlayLens into a QA assistant for the developer's own Unity hypercasual and casual puzzle games. The expected workload is one or two games per day, with a Samsung A51 as the primary test device and a personal phone available for occasional comparison.

The workflow should support both clicking Run and returning to a report, and watching an assistant explore the game. Results should appear in the existing local web app first. Ticket integrations and automatic runs after builds can follow later.

Priority coverage:

- Levels load, accept input, remain playable, and progress through win, lose and retry flows.
- App Open, banner, rewarded and interstitial ads display and complete the appropriate lifecycle.
- Purchases grant the intended entitlement and handle cancellation, failure and restoration.
- Analytics events have the expected names, parameters, order and counts.
- Performance drops are tied to a level, scene and action, with evidence to investigate.

The developer controls the AVN plugin code. Its source and the Unity game projects are outside this repository, so their integration will require changes in those projects.

## What PlayLens already provides

Reuse the current implementation rather than starting a separate tool:

- ADB discovery and connection, registered games, installed build identity, and game controls.
- Package-scoped log collection, crash and ANR diagnostics, sessions and replay.
- AVN startup and SDK health checks, ad funnels, Remote Config observations and Firebase event validation.
- Performance sampling and graphs, level detection and screenshots.
- YAML rules, publishing checklist evidence, and HTML/Markdown report exports.

Useful integration points are `packages/server/src/adb/client.mjs`, `session/stream.mjs`, `session/recorder.mjs`, `monitor/monitor.mjs`, `monitor/checks.mjs`, `monitor/report.mjs`, `perf/sampler.mjs`, `snapshots/snapshots.mjs`, `rules/loader.mjs` and `api/server.mjs`. These paths after the first are relative to `packages/server/src/`.

The existing checklist's publishing-report requirement should remain specific to that workflow. A new smoke run should not require a publishing PDF merely to collect logs and exercise an installed game.

## Use Unity Test Framework alongside device automation

Use Unity Test Framework (UTF) for assertions written inside each Unity project. Unity documents NUnit-style tests, coroutine-based `[UnityTest]` tests and simulated Input System actions. These offer a foundation for repeatable gameplay scenarios, provided each game supplies meaningful actions and assertions. See Unity's [automated testing guide](https://unity.com/how-to/automated-tests-unity-test-framework).

Split the planned coverage into three layers:

1. **Edit Mode:** validate level data, puzzle rules, progression calculations, reward amounts and event payload construction. Use fake ad and billing services for deterministic logic checks.
2. **Play Mode:** load scenes and exercise gameplay over multiple frames. Assert that a known sequence of moves wins a puzzle, retry resets the board, a rewarded continuation resumes play, and the next level becomes available. Implement bounded waits for states instead of relying on arbitrary long delays.
3. **Android device runs:** exercise the actual game with native SDKs, Android lifecycle changes and device performance. PlayLens correlates the observations with the scenario timeline. Editor results alone cannot establish that an Android ad displayed or a Play purchase succeeded.

UTF is a test runner, so it still needs authored tests. It does not autonomously discover how an arbitrary puzzle is solved. A useful first suite is one representative level per game, one retry flow, and one progression flow, expanded as bugs are found.

### UTF integration into PlayLens

Start with importing results from a developer-run Unity test invocation. Later, allow PlayLens to launch a selected local Unity Editor with the chosen project, test category and output paths. Record the project's Editor and Test Framework versions rather than assuming one version across all games.

Unity's command-line reference supports `EditMode`, `PlayMode` and a build target such as `Android` through `-testPlatform`, with NUnit-format XML via `-testResults`. Android tests require building a test player; ordinary APKs do not gain embedded tests through result import. Consult the documentation matching the project's installed package. See the [Test Framework command-line reference](https://docs.unity.cn/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html).

Illustrative PowerShell invocation; substitute real paths and create the output directory first:

```powershell
& 'C:\Path\To\Unity.exe' -batchmode -runTests `
  -projectPath 'D:\Games\MyGame' `
  -testPlatform Android `
  -testCategory PlayLensSmoke `
  -testResults 'D:\QA\run-001\results.xml' `
  -logFile 'D:\QA\run-001\unity.log'
```

Before enabling one-click Android execution, verify deployment to the selected ADB serial and result return on the actual Editor/package version, especially with two phones connected. Do not assume Unity automatically selects PlayLens's device. Use a supported device-selection integration or require only the intended device to be eligible for deployment.

The import should preserve individual cases, durations, skipped cases, failure messages and stack traces. A missing, malformed or stale XML file is an infrastructure error. Record the expected suite and discovered test count: zero tests or a filter matching nothing cannot make a required suite pass. Parse untrusted XML without external entity resolution, with file-size limits.

Keep test-player build identity separate from an ordinary QA APK's identity. Correlate results with a PlayLens run ID and device/build metadata; attaching unrelated XML must not verify a live session. Store Unity logs even when compilation or deployment fails.

## Proposed architecture

Add a server-owned QA runner in `packages/server/src/qa/` and a QA Runs view inside each game's workspace. The runner owns device actions, step deadlines, evidence and the final result. It uses the current monitor and recorder for observations.

Each run binds to a registered package, exact device serial, installed version/build, APK hash when available, plan snapshot and rules snapshot. Only one run may control a device at a time. Reject competing control actions and identify the active run in the UI.

The runner needs an explicit capture lease: current collection pauses when leaving a game workspace, but an unattended QA run must keep its package-scoped logs and performance sampling alive after navigation or tab closure. Release the lease when the run ends, preserving existing manual capture behavior.

Run states: queued, preparing, running, stopping, completed, cancelled and infrastructure-error. Individual checks use passed, failed, skipped and not-verified. A completed run can contain failures. Required missing evidence must prevent an overall pass.

Use structured process arguments, validated package IDs and device serials, bounded output and timeouts. Cancellation must stop the run's own subprocesses, finish its report and remove its own ADB forwarding. A phone disconnect ends the run with partial evidence. A server restart marks unfinished runs interrupted; do not silently resume actions.

### Debug-only QA Bridge in the AVN plugin

Provide a small versioned protocol reached through a host-loopback `adb forward` connection. The device listener should also bind to loopback. Compile it only into deliberately enabled QA/development builds, with release-build checks confirming its absence. Authenticate commands with a per-run handshake and restrict them to a fixed command list.

Proposed observations:

- Scene, level identifier, game state and a timestamp.
- Stable action IDs for visible interactable controls, plus bounds and screen orientation where available.
- Supported capabilities, so unsupported game hooks are reported explicitly.
- Ad lifecycle and entitlement changes with correlation IDs.

Proposed commands include invoking a named UI action, loading a level, forcing win/lose, and requesting a test ad. Each game registers an adapter for its level manager, game states and controls. Stable IDs should take precedence over duplicate object names. Execute Unity API work on the main thread and reject stale actions after scene changes.

Forced win/lose verifies transitions and progression. It does not prove that the level is solvable or its controls work. Report that coverage separately from recorded input, authored solver tests and exploratory gameplay.

UTF tests and the bridge should share the same game adapter where useful. Keep test assertions in the tests and observation collection in PlayLens, avoiding two unrelated implementations of the same scenario.

## How each QA area is checked

### Gameplay and progression

Use bridge-assisted transitions to visit a configurable level range and find load failures or broken progression quickly. Use authored UTF scenarios or recorded device inputs for real interaction checks. Puzzle solvability needs a known solution, a game-specific solver or human review; random exploration cannot establish it.

Every scenario has state expectations and a timeout. Capture the screen and nearby logs on failure. Treat a possible softlock inferred from inactivity as a finding needing review unless a defined progress assertion actually fails.

### Ads

Run an App Open background/foreground cycle through ADB. For banner, interstitial and rewarded flows, trigger the normal placement or an explicit test hook and verify the expected lifecycle within that action's time window. Distinguish ad load, show, dismissal and reward evidence. SDK initialization does not prove a visible ad, and a request does not prove display.

Check interstitial level gating against observed AdConfig, and verify that reward delivery occurs once. Include no-fill, timeout and cancellation paths. Test-mode ads should be the default; network no-fill should be reported distinctly from a gameplay assertion failure. Revenue callbacks can be observed where available, but should not be required for every test-mode impression.

### In-app purchases

First add deterministic UTF coverage with a fake billing service for grant-once, cancellation, failure and restore behavior. Separately plan real store testing on the A51 using a configured license tester and the appropriate Play test distribution setup; confirm the game's billing integration before implementing it.

The bridge may initiate a configured test product. Android purchase sheets require separate native UI handling or a manual step. Automation must verify a recognized test purchase context before any confirmation; otherwise stop for manual review. Do not automatically approve real-money purchases. Verify the entitlement and transaction evidence, not just a button tap or analytics event. Keep personal-device installs, data resets and purchases outside default run actions.

### Analytics

Reuse existing game rules for event names, required parameters, types, ordering and counts. Evaluate them in the relevant step/run window so events from an earlier action cannot satisfy a new assertion. Preserve log links and label on-device delivery separately from backend/dashboard verification.

### Performance

Tag samples with scene, level and action from the bridge or observed level events. Report FPS/frame-time distributions, sustained drops, CPU, memory, temperature and throttling when available. Record unavailable metrics explicitly; do not infer a GPU bottleneck from FPS alone.

Use configurable, device-specific budgets and distinguish cold launch, warmup and active play. Compare equivalent builds, scenarios and thermal conditions. Attach a nearby screenshot and sample window to a drop; screenshot/video capture adds overhead, so record capture settings and allow clean measurement runs. Avoid labelling every low sample a reproducible regression.

### AI exploration

After deterministic runs work, add an optional player using screenshots, bridge state and a restricted action API. Give it a goal, time/action budget, stop control and reproducible action trace. Flag findings as suspected until supported by an assertion or repeatable evidence.

Paid API use was not confirmed in the original discussion. Confirm provider, budget and permission to send screenshots/logs before enabling this mode. Store credentials outside reports and rules. Exclude purchases and destructive actions from the agent's action set.

## Plans, reports and web experience

A QA Runs page should let the user choose the game, device and plan; optionally choose an APK to install; then start or cancel. Show preparation errors before actions, current step, recent screenshot, elapsed time and live findings. An existing installed build should work without an APK upload. Installation should verify package identity and avoid silently clearing app data.

Keep immutable run results under a proposed `~/.avn-playlens/qa-runs/<run-id>/`, independently of session rotation. Save plan/rules snapshots, session references or retained evidence, step/action timeline, check results, build/device identity, screenshots and imported UTF output. Recording/video can be optional and added after reliable screenshot evidence.

The report should explain what ran, passed, failed, was skipped or remains unverified. Include coverage mode (forced transition, authored gameplay, SDK/device test or AI exploration), steps to reproduce and links to the evidence. Keep existing manual checklist results identifiable. A clean random smoke run means no issue was observed during that run, not that all levels, ads and purchases passed.

An eventual game-rules extension could look like this. This is a proposed schema, not supported configuration today:

```yaml
qa:
  plans:
    smoke:
      driver: adb
      durationSeconds: 180
      seed: 12345
      appOpenCycle: true
    progression:
      driver: bridge
      levels: { from: 1, to: 10 }
      completion: forceWin
      ads: [banner, interstitial, rewarded]
    gameplay:
      driver: unity-tests
      category: PlayLensSmoke
      platform: Android
    explore:
      driver: ai
      durationSeconds: 600
      goal: 'Play normally, then inspect the shop and settings'
```

Validate schemas before execution, reject unknown actions and unsupported capabilities, and snapshot the effective configuration. Version the schema independently from current observation rules.

## Delivery order and acceptance criteria

### Phase 1: ADB smoke runner and report

Implement device ownership, run lifecycle, capture lease, launch, optional APK install, bounded package-restricted random input, App Open cycle, cancellation and persisted reports. Keep random input away from purchase/permission dialogs; pause when the foreground package leaves the game except during explicitly planned lifecycle steps. Record seed and issued actions, without promising exact deterministic replay.

Acceptance: an installed registered game can run for a configured duration on the A51 and produce a report with logs, crashes/ANRs, observed events, performance and screenshots. Browser closure does not stop capture. Cancellation, disconnect and server interruption produce honest partial results. A fake-ADB test covers lifecycle and cleanup; a real-device run validates behavior. No claim of completed gameplay or verified purchases is made by this phase.

### Phase 2: UTF results and initial Unity suite

Add result import and report display, then optional Editor invocation with version/project selection. In one game project, author Edit Mode logic checks and Play Mode tests for one known level, retry and progression. Establish the Android test-player workflow on the A51 before generalizing it.

Acceptance: imported cases preserve failures/skips and identity, missing output never passes, and the web report links the Unity log and evidence. A representative Android run is distinguishable from an Editor run and an ordinary APK smoke run.

### Phase 3: QA Bridge and scripted plans

Implement the AVN plugin bridge, one game adapter, protocol client and validated plans. Add level transitions, normal input scenarios, test ads and level-tagged performance. Add fake billing coverage first, then separately gated store scenarios.

Acceptance: unsupported hooks are explicit, release builds expose no bridge, forced transitions and played levels have separate coverage, ad/reward checks require correlated evidence, and scripted failures include bounded waits and reproduction steps.

### Phase 4: AI exploration

Add optional provider integration after budget/data-sharing choices are settled. Keep action restrictions, evidence and deterministic regression scenarios for confirmed bugs.

Acceptance: exploration respects budgets and cancellation, produces a complete action trace, and reports suspected findings without converting them into unsupported passes or failures.

### Later

Build/upload triggers, report export to issue trackers, additional device comparisons and longer performance baselines. Keep the first delivery focused on the local workflow and one test phone.

## Decisions needed before the relevant implementation phase

- Unity Editor/Test Framework versions, project locations and assembly setup for the first game.
- Whether games share level/game-state APIs or need separate adapters.
- UI/input system: uGUI, UI Toolkit, legacy input or the new Input System.
- Billing SDK, test products, license-tester account and test-track setup.
- Analytics expectations, ad placements and performance budgets for each game/device.
- Approved AI provider, usage budget and screenshot/log sharing policy.

These do not block documenting the plan or building the basic ADB runner. They do gate the corresponding Unity, billing and AI integrations.
