# Wire this game to the AVN QA standard

Copy everything below the line into Claude Code, Cursor or another coding agent opened at the root of the Unity game project. It writes the game's QA adapter against the `com.avn.qa` package and tells you what it could not wire.

---

You are wiring this Unity game to the AVN QA SDK so AVN PlayLens can run automated checks on a phone. The SDK is the package `com.avn.qa` (namespace `AVN.QA`). Read its `README.md` and `Samples~/GameAdapter/ExampleGameQAAdapter.cs` first. Every `AVNQA.*` call compiles to nothing in release builds, so do not add `#if` guards around them.

## The standard you must meet

Providers (always):

- `AVNQA.SetLevelProvider(() => new LevelInfo(number, id, name, total))` — the level the player is on right now, 1-based, 0 when not in a level.
- `AVNQA.SetStateProvider(() => "...")` — one of `menu`, `playing`, `won`, `lost`, `paused`, `shop`, `settings`, `loading`, or another short lowercase word if none fits.

Actions (register the ones the game can honestly support, using the ids in `AVNQAActions`):

- `level.load {level}` — load that level and make it playable.
- `level.restart`, `level.next`.
- `level.win` — finish the current level **through the same code path a real win uses** (win screen, analytics event, interstitial gate). Not a scene load, not a flag flip.
- `level.lose` — same rule, through the real lose path.
- `nav.home`, `nav.shop`, `nav.settings` if those screens exist.
- `game.reset` — wipe saved progress and return to the first-launch state.

Events (call from the real game flow, not from the action handlers):

- `AVNQA.LevelStarted(n)` when a level becomes playable.
- `AVNQA.LevelWon(n)` / `AVNQA.LevelLost(n)` when the player wins or loses.
- `AVNQA.RewardGranted("placement")` when a rewarded ad pays out inside the game (extra moves, revive, coins).
- `AVNQA.EntitlementGranted("productId")` when a purchase is applied in the game (remove ads, coin pack).

Do not touch the ad or IAP actions (`ad.*`, `iap.*`, `rc.values`); the AVN plugin registers those.

## How to work

1. Find the code that owns levels and game state. Look for classes named like `LevelManager`, `GameManager`, `LevelController`, `GameController`, `ProgressionManager`, scene loading, and the methods that run on win and lose (often `OnLevelComplete`, `Win`, `LevelFailed`, `GameOver`). Read them; do not guess from names alone.
2. Create `Assets/Scripts/QA/GameQAAdapter.cs` as a `MonoBehaviour` that registers everything in `Awake`, and put it on a GameObject that lives for the whole session (the GameManager's object, or a new `DontDestroyOnLoad` one in the first scene). If the project uses assembly definitions, add a reference to `AVN.QA`.
3. Wire each action to the existing method that does the job. If an action needs a method that does not exist and cannot be added safely in a few lines, register it with `AVNQA.NotWired(AVNQAActions.X)` as the body and list it in your final summary. Never fake it.
4. Add the four event calls at the real places in the game flow. One call per event, where the state actually changes.
5. Build check: menu **AVN → QA → Enable QA build**, then make sure the project compiles. Then **AVN → QA → Disable QA build** and make sure it still compiles (the adapter must compile without the define).
6. Finish with a short summary: which actions are wired, which are `NotWired` and why, where the event calls went, and anything you were unsure about (for example if `level.win` had to skip part of the real win path).

Rules: change nothing about gameplay, ads, analytics or saving. Keep the adapter in one file. Prefer calling existing public methods; if you must expose one, make it `internal` and explain why.
