#if AVN_QA
using System;
using System.Collections.Generic;
using UnityEngine;

namespace AVN.QA
{
    /// <summary>Holds everything the game registered. Main-thread only.</summary>
    internal static class AVNQARegistry
    {
        internal sealed class ActionEntry
        {
            public string Id;
            public string Description;
            public AVNQA.ActionHandler Handler;
        }

        static readonly Dictionary<string, ActionEntry> Actions = new Dictionary<string, ActionEntry>(StringComparer.Ordinal);

        internal static Func<LevelInfo> LevelProvider;
        internal static Func<string> StateProvider;
        internal static Func<IDictionary<string, object>> ExtraProvider;

        /// <summary>Set by the bridge; receives reports to push to the client.</summary>
        internal static Action<string, IDictionary<string, object>> ReportSink;

        internal static void RegisterAction(string id, AVNQA.ActionHandler handler, string description)
        {
            if (string.IsNullOrEmpty(id)) throw new ArgumentException("action id is required", nameof(id));
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            Actions[id] = new ActionEntry { Id = id, Handler = handler, Description = description };
            Debug.Log("[AVNQA.Register] " + id + " " + AVNQA.LogSuffix);
        }

        internal static void UnregisterAction(string id)
        {
            if (!string.IsNullOrEmpty(id)) Actions.Remove(id);
        }

        internal static bool TryGet(string id, out ActionEntry entry) => Actions.TryGetValue(id, out entry);

        internal static List<object> ListActions()
        {
            var list = new List<object>(Actions.Count);
            foreach (var a in Actions.Values)
                list.Add(new Dictionary<string, object> { { "id", a.Id }, { "description", a.Description } });
            return list;
        }

        internal static List<string> ActionIds()
        {
            var list = new List<string>(Actions.Keys);
            list.Sort(StringComparer.Ordinal);
            return list;
        }

        internal static void Report(string name, IDictionary<string, object> data)
        {
            if (string.IsNullOrEmpty(name)) return;
            Debug.Log("[AVNQA.Report] " + name + " " + AVNQAJson.Serialize(data ?? new Dictionary<string, object>()) + " " + AVNQA.LogSuffix);
            ReportSink?.Invoke(name, data);
        }

        internal static object NotWired(string actionId)
        {
            throw new NotWiredException(actionId);
        }

        internal static int IntArg(IReadOnlyDictionary<string, object> args, string name)
        {
            if (args == null || !args.TryGetValue(name, out var v) || v == null)
                throw new ArgumentException("missing argument '" + name + "'");
            switch (v)
            {
                case long l: return checked((int)l);
                case int i: return i;
                case double d: return (int)Math.Round(d);
                case string s when int.TryParse(s, out var parsed): return parsed;
                default: throw new ArgumentException("argument '" + name + "' must be an integer");
            }
        }

        internal static string StringArg(IReadOnlyDictionary<string, object> args, string name, string fallback = null)
        {
            if (args == null || !args.TryGetValue(name, out var v) || v == null) return fallback;
            return Convert.ToString(v);
        }
    }

    /// <summary>Thrown by handlers that exist but are not connected to game or plugin code.</summary>
    public sealed class NotWiredException : Exception
    {
        public string ActionId { get; }
        public NotWiredException(string actionId) : base("action '" + actionId + "' is registered but not wired")
        {
            ActionId = actionId;
        }
    }
}
#endif
