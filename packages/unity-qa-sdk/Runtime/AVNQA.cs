using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace AVN.QA
{
    /// <summary>
    /// Public entry point of the AVN QA SDK. Every method is a no-op unless the
    /// AVN_QA scripting define is set, so games can call it unconditionally.
    /// PlayLens talks to the bridge (see AVNQABridge) and only knows about what
    /// is registered here.
    /// </summary>
    public static class AVNQA
    {
        public const string Version = "0.1.0";

        /// <summary>Suffix carried by every Unity log line the SDK writes. PlayLens filters on it.</summary>
        public const string LogSuffix = "| AVNQA";

        /// <summary>True only in QA builds (AVN_QA define present).</summary>
        public static bool IsEnabled
        {
            get
            {
#if AVN_QA
                return true;
#else
                return false;
#endif
            }
        }

        /// <summary>Signature of an action handler. Returns a JSON-serialisable value or null.</summary>
        public delegate object ActionHandler(IReadOnlyDictionary<string, object> args);

        /// <summary>Register a named action PlayLens can invoke. See <see cref="AVNQAActions"/> for standard ids.</summary>
        [Conditional("AVN_QA")]
        public static void RegisterAction(string id, ActionHandler handler, string description = null)
        {
#if AVN_QA
            AVNQARegistry.RegisterAction(id, handler, description);
#endif
        }

        /// <summary>Register a named action without arguments or result.</summary>
        [Conditional("AVN_QA")]
        public static void RegisterAction(string id, Action handler, string description = null)
        {
#if AVN_QA
            AVNQARegistry.RegisterAction(id, _ => { handler(); return null; }, description);
#endif
        }

        /// <summary>Register a named action that takes an integer (for example a level number).</summary>
        [Conditional("AVN_QA")]
        public static void RegisterAction(string id, Action<int> handler, string argName, string description = null)
        {
#if AVN_QA
            AVNQARegistry.RegisterAction(id, args => { handler(AVNQARegistry.IntArg(args, argName)); return null; }, description);
#endif
        }

        /// <summary>Remove an action, for example when the owning scene unloads.</summary>
        [Conditional("AVN_QA")]
        public static void UnregisterAction(string id)
        {
#if AVN_QA
            AVNQARegistry.UnregisterAction(id);
#endif
        }

        /// <summary>Tell PlayLens which level the player is on. Called by PlayLens on every state query.</summary>
        [Conditional("AVN_QA")]
        public static void SetLevelProvider(Func<LevelInfo> provider)
        {
#if AVN_QA
            AVNQARegistry.LevelProvider = provider;
#endif
        }

        /// <summary>Tell PlayLens the high-level game state (for example "menu", "playing", "won", "lost", "shop").</summary>
        [Conditional("AVN_QA")]
        public static void SetStateProvider(Func<string> provider)
        {
#if AVN_QA
            AVNQARegistry.StateProvider = provider;
#endif
        }

        /// <summary>Add extra key/values to every state query (coins, lives, anything useful in a report).</summary>
        [Conditional("AVN_QA")]
        public static void SetExtraStateProvider(Func<IDictionary<string, object>> provider)
        {
#if AVN_QA
            AVNQARegistry.ExtraProvider = provider;
#endif
        }

        /// <summary>
        /// Report something that happened. It is pushed to PlayLens and written to the
        /// Unity log as "[AVNQA.Report] name {json} | AVNQA" so logcat has it too.
        /// </summary>
        [Conditional("AVN_QA")]
        public static void Report(string name, IDictionary<string, object> data = null)
        {
#if AVN_QA
            AVNQARegistry.Report(name, data);
#endif
        }

        [Conditional("AVN_QA")]
        public static void LevelStarted(int level) { Report(AVNQAEvents.LevelStarted, Kv("level", level)); }

        [Conditional("AVN_QA")]
        public static void LevelWon(int level) { Report(AVNQAEvents.LevelWon, Kv("level", level)); }

        [Conditional("AVN_QA")]
        public static void LevelLost(int level) { Report(AVNQAEvents.LevelLost, Kv("level", level)); }

        [Conditional("AVN_QA")]
        public static void RewardGranted(string placement) { Report(AVNQAEvents.RewardGranted, Kv("placement", placement)); }

        [Conditional("AVN_QA")]
        public static void EntitlementGranted(string productId) { Report(AVNQAEvents.EntitlementGranted, Kv("productId", productId)); }

        /// <summary>
        /// Use as the body of an action the plugin or game has not wired yet. PlayLens
        /// reports the step as "not supported" instead of pretending it ran.
        /// </summary>
        public static object NotWired(string actionId)
        {
#if AVN_QA
            return AVNQARegistry.NotWired(actionId);
#else
            return null;
#endif
        }

        static Dictionary<string, object> Kv(string key, object value)
        {
            return new Dictionary<string, object> { { key, value } };
        }
    }

    /// <summary>What the game knows about the current level.</summary>
    public sealed class LevelInfo
    {
        /// <summary>1-based level number as shown to the player, or 0 when not in a level.</summary>
        public int Number;
        /// <summary>Optional stable identifier (scene name, asset name, world-level string).</summary>
        public string Id;
        /// <summary>Optional display name.</summary>
        public string Name;
        /// <summary>Total number of levels when known, else 0.</summary>
        public int Total;

        public LevelInfo() { }
        public LevelInfo(int number, string id = null, string name = null, int total = 0)
        {
            Number = number; Id = id; Name = name; Total = total;
        }
    }

    /// <summary>
    /// Standard action ids. A plan in PlayLens refers to these. Register the ones your
    /// game supports; unknown ids are reported as unsupported, never as passed.
    /// </summary>
    public static class AVNQAActions
    {
        // Game adapter (each game wires these)
        public const string LevelLoad = "level.load";          // args: { "level": int }
        public const string LevelRestart = "level.restart";
        public const string LevelNext = "level.next";
        public const string LevelWin = "level.win";            // force the current level to its win state
        public const string LevelLose = "level.lose";          // force the current level to its lose state
        public const string NavHome = "nav.home";
        public const string NavShop = "nav.shop";
        public const string NavSettings = "nav.settings";
        public const string GameReset = "game.reset";          // wipe save data and return to first launch state

        // Plugin hooks (wired once in the AVN plugin)
        public const string AdInterstitialShow = "ad.interstitial.show";
        public const string AdRewardedShow = "ad.rewarded.show";   // args: { "placement": string? }
        public const string AdBannerShow = "ad.banner.show";
        public const string AdBannerHide = "ad.banner.hide";
        public const string AdAppOpenShow = "ad.appopen.show";
        public const string AdStatus = "ad.status";                 // returns load states per format
        public const string IapBuy = "iap.buy";                     // args: { "productId": string }
        public const string IapRestore = "iap.restore";
        public const string IapProducts = "iap.products";           // returns registered products
        public const string RcValues = "rc.values";                 // returns effective remote config values
    }

    /// <summary>Standard event names pushed through <see cref="AVNQA.Report"/>.</summary>
    public static class AVNQAEvents
    {
        public const string LevelStarted = "level.started";
        public const string LevelWon = "level.won";
        public const string LevelLost = "level.lost";
        public const string RewardGranted = "reward.granted";
        public const string EntitlementGranted = "entitlement.granted";
        public const string PurchaseFailed = "purchase.failed";
        public const string StateChanged = "state.changed";
    }
}
