# AVN QA SDK (`com.avn.qa`)

A debug-only bridge that lets AVN PlayLens drive and observe a game on a phone. It is compiled only when the `AVN_QA` scripting define is set, so a release build contains none of it.

## What it gives PlayLens

- Current scene, level and game state, plus anything else the game wants to report.
- A list of named actions the game and the AVN plugin registered (`level.win`, `ad.rewarded.show`, …). Unregistered or unwired actions are reported as **not supported**, never as passed.
- The on-screen uGUI controls with their screen rectangles, so PlayLens can tap real buttons through ADB.
- Push events (`level.won`, `reward.granted`, `entitlement.granted`, `state.changed`, `app.pause`) and a Unity log line for each, suffixed `| AVNQA`, so logcat has the same timeline.

Transport: newline-delimited JSON over TCP bound to `127.0.0.1:7421` on the phone. PlayLens reaches it with `adb forward`. Nothing on the network can connect.

## Install

1. Add the package in Unity: Window → Package Manager → `+` → *Add package from disk* → this folder's `package.json`, or add to `Packages/manifest.json`:
   ```json
   "com.avn.qa": "file:../../AVN-Play-Lens/packages/unity-qa-sdk"
   ```
2. Menu **AVN → QA → Enable QA build**. This adds `AVN_QA` to the Android defines and turns on Development Build. **Disable QA build** removes it before a store build. A build with `AVN_QA` that is not a Development Build fails on purpose.
3. Optional: *Assets → Create → AVN → QA Settings* saved at `Assets/Resources/AVNQASettings.asset` to change the port or list the QA phones' advertising IDs for MAX test mode.

## Wire it

Fastest route: open the game project in Claude Code or Cursor and paste the prompt from `WIRE_THIS_GAME.md`. It finds the level manager and win/lose paths, writes `Assets/Scripts/QA/GameQAAdapter.cs`, and reports what it could not wire. Review its summary; the rest of this section is what it does by hand.

**Once, in the AVN plugin:** import the *Plugin hooks* sample and replace each `TODO(plugin team)` line with the plugin call. This covers `ad.*`, `iap.*` and `rc.values` for every game.

**Per game:** import the *Game adapter example*, rename it, and connect:

```csharp
AVNQA.SetLevelProvider(() => new LevelInfo(levelManager.Current, total: levelManager.Count));
AVNQA.SetStateProvider(() => gameManager.State.ToString().ToLowerInvariant());
AVNQA.RegisterAction(AVNQAActions.LevelWin,  () => gameManager.CompleteLevel());
AVNQA.RegisterAction(AVNQAActions.LevelLose, () => gameManager.FailLevel());
AVNQA.RegisterAction(AVNQAActions.LevelLoad, level => levelManager.Load(level), "level");
```

and from the real game flow:

```csharp
AVNQA.LevelStarted(n);  AVNQA.LevelWon(n);  AVNQA.LevelLost(n);  AVNQA.RewardGranted("extra_moves");
```

Every `AVNQA.*` call is a no-op without `AVN_QA`, so none of this needs `#if` guards.

`level.win` must go through the same code path as a real win (win screen, analytics, interstitial gate), otherwise the run proves nothing about that path.

## Protocol (v1)

```
→ {"id":1,"cmd":"hello","args":{"runId":"qa-123"}}
← {"id":1,"ok":true,"result":{"proto":1,"sdk":"0.1.0","app":{...},"capabilities":{"actions":[...],"level":true,"state":true,"ui":true}}}
→ {"id":2,"cmd":"state"}
← {"id":2,"ok":true,"result":{"scene":"Game","state":"playing","level":{"number":3,...},"t":12.3,"frame":740}}
→ {"id":3,"cmd":"invoke","args":{"action":"level.win"}}
← {"id":3,"ok":false,"code":"not-wired","error":"action 'level.win' is registered but not wired","action":"level.win"}
→ {"id":4,"cmd":"ui"}
← {"id":4,"ok":true,"result":{"screen":{"width":1080,"height":2400,...},"controls":[{"id":"Canvas/Win/Next","name":"Next","type":"Button","label":"NEXT","interactable":true,"rect":{"x":0.3,"y":0.8,"w":0.4,"h":0.06},"center":{"x":0.5,"y":0.83}}]}}
← {"event":"level.won","data":{"level":3},"t":15.1,"frame":912}
```

Commands: `hello`, `ping`, `state`, `actions`, `invoke {action, args}`, `ui`, `ui.find {query}`, `screen`, `marker {text}`. Error codes: `bad-json`, `bad-request`, `no-session`, `unknown-command`, `unknown-action`, `not-wired`, `bad-args`, `handler-error`.

Control rectangles are normalised (0–1) with a top-left origin. PlayLens multiplies by the phone's physical display size, which may differ from `Screen.width/height` when resolution scaling is on.

## Release safety

- All bridge code sits under `#if AVN_QA`. The public `AVNQA` API stays, but its methods carry `[Conditional("AVN_QA")]` and compile to nothing.
- `AVNQABuildGuard` fails any non-development build that has `AVN_QA` unless `AVN_QA_ALLOW_RELEASE` is also set.
- The bridge logs `[AVNQA.Bridge] listening port=… | AVNQA` on start. PlayLens flags that line in a build whose package is not debuggable.
