#if AVN_QA
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace AVN.QA
{
    /// <summary>
    /// Loopback TCP bridge. Newline-delimited JSON, one client at a time.
    ///
    /// Request:  {"id":1,"cmd":"state","args":{}}
    /// Response: {"id":1,"ok":true,"result":{...}}  or  {"id":1,"ok":false,"code":"unknown-action","error":"..."}
    /// Push:     {"event":"level.won","data":{...},"t":12.34,"frame":740}
    ///
    /// Only compiled with AVN_QA. Binds 127.0.0.1 only; PlayLens reaches it with
    /// `adb forward tcp:PORT tcp:PORT`. Nothing on the network can connect to it.
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    internal sealed class AVNQABridge : MonoBehaviour
    {
        public const int Protocol = 1;

        static AVNQABridge _instance;

        TcpListener _listener;
        Thread _acceptThread;
        volatile bool _running;
        TcpClient _client;
        Stream _stream;
        readonly object _writeLock = new object();
        readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        string _session;
        string _lastState;
        int _port;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (_instance != null || !AVNQASettings.AutoStart) return;
            var go = new GameObject("AVNQABridge") { hideFlags = HideFlags.HideAndDontSave };
            DontDestroyOnLoad(go);
            _instance = go.AddComponent<AVNQABridge>();
        }

        void Awake()
        {
            if (_instance != null && _instance != this) { Destroy(gameObject); return; }
            _instance = this;
            AVNQARegistry.ReportSink = Push;
            _port = AVNQASettings.Port;
            try
            {
                _listener = new TcpListener(IPAddress.Loopback, _port);
                _listener.Start(1);
                _running = true;
                _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "AVNQABridge" };
                _acceptThread.Start();
                Debug.Log("[AVNQA.Bridge] listening port=" + _port + " proto=" + Protocol + " sdk=" + AVNQA.Version + " " + AVNQA.LogSuffix);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[AVNQA.Bridge] failed to listen on port " + _port + ": " + ex.Message + " " + AVNQA.LogSuffix);
            }
        }

        void OnDestroy()
        {
            _running = false;
            try { _listener?.Stop(); } catch { }
            CloseClient();
            if (AVNQARegistry.ReportSink == (Action<string, IDictionary<string, object>>)Push) AVNQARegistry.ReportSink = null;
            if (_instance == this) _instance = null;
        }

        void OnApplicationPause(bool paused) => Push("app.pause", Kv("paused", paused));
        void OnApplicationFocus(bool focus) => Push("app.focus", Kv("focus", focus));

        void Update()
        {
            while (_inbox.TryDequeue(out var line)) Handle(line);

            // Push state changes without the client polling.
            if (_stream != null && AVNQARegistry.StateProvider != null)
            {
                string state = SafeState();
                if (!string.Equals(state, _lastState, StringComparison.Ordinal))
                {
                    _lastState = state;
                    Push(AVNQAEvents.StateChanged, Kv("state", state));
                }
            }
        }

        // ── socket threads ────────────────────────────────────────────────

        void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client;
                try { client = _listener.AcceptTcpClient(); }
                catch { break; }
                CloseClient();
                client.NoDelay = true;
                _client = client;
                _stream = client.GetStream();
                _session = null;
                try
                {
                    using (var reader = new StreamReader(_stream, new UTF8Encoding(false), false, 64 * 1024, leaveOpen: true))
                    {
                        string line;
                        while (_running && (line = reader.ReadLine()) != null)
                        {
                            if (line.Length == 0) continue;
                            if (line.Length > 256 * 1024) continue; // refuse absurd lines
                            _inbox.Enqueue(line);
                        }
                    }
                }
                catch { /* client went away */ }
                if (ReferenceEquals(_client, client)) CloseClient();
            }
        }

        void CloseClient()
        {
            var c = _client;
            _client = null;
            _stream = null;
            _session = null;
            try { c?.Close(); } catch { }
        }

        void Send(object message)
        {
            var s = _stream;
            if (s == null) return;
            var bytes = Encoding.UTF8.GetBytes(AVNQAJson.Serialize(message) + "\n");
            lock (_writeLock)
            {
                try { s.Write(bytes, 0, bytes.Length); s.Flush(); }
                catch { CloseClient(); }
            }
        }

        void Push(string name, IDictionary<string, object> data)
        {
            if (_stream == null) return;
            Send(new Dictionary<string, object>
            {
                { "event", name },
                { "data", data ?? new Dictionary<string, object>() },
                { "t", Math.Round(Time.realtimeSinceStartupAsDouble, 3) },
                { "frame", Time.frameCount },
            });
        }

        // ── commands (main thread) ────────────────────────────────────────

        void Handle(string line)
        {
            Dictionary<string, object> req;
            try { req = AVNQAJson.ParseObject(line); }
            catch (Exception ex) { Send(Error(null, "bad-json", ex.Message)); return; }
            if (req == null) { Send(Error(null, "bad-json", "expected an object")); return; }

            req.TryGetValue("id", out var id);
            string cmd = req.TryGetValue("cmd", out var c) ? c as string : null;
            var args = req.TryGetValue("args", out var a) ? a as Dictionary<string, object> : null;
            args = args ?? new Dictionary<string, object>();

            if (string.IsNullOrEmpty(cmd)) { Send(Error(id, "bad-request", "cmd is required")); return; }
            if (cmd != "hello" && cmd != "ping" && _session == null) { Send(Error(id, "no-session", "send hello first")); return; }

            try
            {
                object result;
                switch (cmd)
                {
                    case "hello": result = Hello(args); break;
                    case "ping": result = Kv("t", Math.Round(Time.realtimeSinceStartupAsDouble, 3)); break;
                    case "state": result = State(); break;
                    case "actions": result = AVNQARegistry.ListActions(); break;
                    case "invoke": result = Invoke(id, args); break;
                    case "ui": result = new Dictionary<string, object> { { "screen", AVNQAUiScan.Screen() }, { "controls", AVNQAUiScan.Controls() } }; break;
                    case "ui.find": result = AVNQAUiScan.Find(AVNQARegistry.StringArg(args, "query")); break;
                    case "screen": result = AVNQAUiScan.Screen(); break;
                    case "marker":
                        Debug.Log("[AVNQA.Marker] " + AVNQARegistry.StringArg(args, "text", "") + " " + AVNQA.LogSuffix);
                        result = null;
                        break;
                    default:
                        Send(Error(id, "unknown-command", "unknown command '" + cmd + "'"));
                        return;
                }
                Send(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", result } });
            }
            catch (HandledException) { /* error already sent */ }
            catch (NotWiredException ex) { Send(Error(id, "not-wired", ex.Message, ex.ActionId)); }
            catch (ArgumentException ex) { Send(Error(id, "bad-args", ex.Message)); }
            catch (Exception ex)
            {
                Debug.LogException(ex);
                Send(Error(id, "handler-error", ex.GetType().Name + ": " + ex.Message));
            }
        }

        Dictionary<string, object> Hello(Dictionary<string, object> args)
        {
            _session = AVNQARegistry.StringArg(args, "runId", Guid.NewGuid().ToString("N"));
            _lastState = null;
            Debug.Log("[AVNQA.Bridge] client connected run=" + _session + " " + AVNQA.LogSuffix);
            return new Dictionary<string, object>
            {
                { "proto", Protocol },
                { "sdk", AVNQA.Version },
                { "session", _session },
                { "unity", Application.unityVersion },
                { "platform", Application.platform.ToString() },
                { "app", new Dictionary<string, object>
                    {
                        { "package", Application.identifier },
                        { "version", Application.version },
                        { "productName", Application.productName },
                        { "development", Debug.isDebugBuild },
                    } },
                { "capabilities", new Dictionary<string, object>
                    {
                        { "actions", AVNQARegistry.ActionIds() },
                        { "level", AVNQARegistry.LevelProvider != null },
                        { "state", AVNQARegistry.StateProvider != null },
                        { "ui", true },
                    } },
            };
        }

        Dictionary<string, object> State()
        {
            var level = SafeLevel();
            var result = new Dictionary<string, object>
            {
                { "scene", SceneManager.GetActiveScene().name },
                { "state", SafeState() },
                { "level", level == null ? null : new Dictionary<string, object>
                    {
                        { "number", level.Number }, { "id", level.Id }, { "name", level.Name }, { "total", level.Total },
                    } },
                { "t", Math.Round(Time.realtimeSinceStartupAsDouble, 3) },
                { "frame", Time.frameCount },
                { "timeScale", Time.timeScale },
                { "focused", Application.isFocused },
            };
            if (AVNQARegistry.ExtraProvider != null)
            {
                try { result["extra"] = AVNQARegistry.ExtraProvider(); }
                catch (Exception ex) { result["extraError"] = ex.Message; }
            }
            return result;
        }

        object Invoke(object id, Dictionary<string, object> args)
        {
            string action = AVNQARegistry.StringArg(args, "action");
            if (string.IsNullOrEmpty(action)) throw new ArgumentException("action is required");
            var actionArgs = args.TryGetValue("args", out var aa) ? aa as Dictionary<string, object> : null;
            if (!AVNQARegistry.TryGet(action, out var entry))
            {
                Send(Error(id, "unknown-action", "action '" + action + "' is not registered", action));
                throw new HandledException();
            }
            Debug.Log("[AVNQA.Invoke] action=" + action + " id=" + id + " " + AVNQA.LogSuffix);
            try
            {
                var result = entry.Handler(actionArgs ?? new Dictionary<string, object>());
                Debug.Log("[AVNQA.Result] action=" + action + " id=" + id + " ok=True " + AVNQA.LogSuffix);
                return result;
            }
            catch (Exception ex)
            {
                Debug.Log("[AVNQA.Result] action=" + action + " id=" + id + " ok=False error=" + ex.Message + " " + AVNQA.LogSuffix);
                throw;
            }
        }

        LevelInfo SafeLevel()
        {
            try { return AVNQARegistry.LevelProvider?.Invoke(); }
            catch (Exception ex) { Debug.LogWarning("[AVNQA.Bridge] level provider threw: " + ex.Message + " " + AVNQA.LogSuffix); return null; }
        }

        string SafeState()
        {
            try { return AVNQARegistry.StateProvider?.Invoke(); }
            catch (Exception ex) { return "error:" + ex.Message; }
        }

        static Dictionary<string, object> Error(object id, string code, string message, string action = null)
        {
            var d = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "code", code }, { "error", message } };
            if (action != null) d["action"] = action;
            return d;
        }

        static Dictionary<string, object> Kv(string key, object value) => new Dictionary<string, object> { { key, value } };

        /// <summary>Raised after an error response has already been sent, so Handle must not send another.</summary>
        sealed class HandledException : Exception { }
    }
}
#endif
