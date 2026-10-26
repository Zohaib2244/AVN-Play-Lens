import { useViewState } from "./route-state";
// App-wide state: server status, devices, pairing, the selected device and game, the view,
// and the live stream (log lines + monitor snapshot). The stream lives here so it keeps
// running while you switch between Logs, Plugin health, Firebase and Checklist.
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, connectSocket, errorMessage } from "./api";
import { preferredDevice } from "./device-selection";
import type { View } from "./navigation";
import { validateSearch } from "./navigation";
import { resourceKey, useResource } from "./query";
import type {
  Command,
  Device,
  Game,
  LogEntry,
  LogGroup,
  Monitor,
  PairState,
  PerfSample,
  PerfSummary,
  Report,
  ServerStatus,
  Session,
  ToastMessage,
} from "./types";

const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);
const MAX_LINES = 50000;
// A restart this soon after an unsaved, crash-free session replaces it instead of saving a near-empty one.
const THROWAWAY_MS = 30000;
const GAME_VIEWS = new Set([
  "qa",
  "snapshooter",
  "logs",
  "performance",
  "health",
  "firebase",
  "firebase-setup",
  "remote-config",
  "checklist",
  "checklist-setup",
  "game-sessions",
]);
const ALERT_KINDS: Record<string, string> = {
  exception: "Unity exception",
  "java-crash": "App crashed (Java)",
  "native-crash": "App crashed (native)",
  anr: "App not responding (ANR)",
};

function useAppState() {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const query = useQueryClient();
  const view = search.view ?? "home";
  const [selectedPackage, updatePackage] = useState<string | null>(
    search.game ?? null,
  );
  const pkg = search.game ?? selectedPackage;
  const archivedId = search.session ?? null;
  const setView = useCallback(
    (next: string) => {
      void navigate({
        to: "/",
        resetScroll: false,
        search: (old) => ({
          ...validateSearch(old),
          view: next as View,
          game:
            GAME_VIEWS.has(next) || next === "saved-session"
              ? (pkg ?? undefined)
              : undefined,
          session:
            next === "saved-session"
              ? typeof old.session === "string"
                ? old.session
                : undefined
              : undefined,
        }),
      });
    },
    [navigate, pkg],
  );
  const setPkg = useCallback(
    (next: string | null) => {
      updatePackage(next);
      void navigate({
        to: "/",
        replace: true,
        resetScroll: false,
        search: (old) => ({ ...validateSearch(old), game: next ?? undefined }),
      });
    },
    [navigate],
  );
  useEffect(() => {
    if (search.game) updatePackage(search.game);
  }, [search.game]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<PairState>({ state: "idle" });
  const [online, setOnline] = useState(false);
  const [serial, setSerial] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const archiveReturn = search.game ? "game-sessions" : "sessions";
  const captureIdentity = useRef<string | null>(null);
  const displayedIdentity = useRef<string | null>(null);
  const collectionAllowed = useRef(false);
  const [historyGame, setHistoryGame] = useViewState("sessionGame", "__all");
  const captureWaiter = useRef<{
    pkg: string;
    serial: string;
    resolve: (session: Session) => void;
  } | null>(null);
  // "Follow the open app" picks whichever installed game is in front on the phone; choosing a
  // game by hand turns it off. The list of installed games is kept fresh here so every page's
  // picker shows apps installed after PlayLens started.
  const [follow, setFollow] = useState(false);
  const gamesQuery = useResource<Game[]>("games", {
    enabled: online,
    interval: 10000,
  });
  const games = gamesQuery.data ?? [];
  const gamesLoaded = gamesQuery.isSuccess;
  const gamesError = gamesQuery.error?.message ?? "";
  const inventoryPath = `devices/${encodeURIComponent(serial ?? "")}/games`;
  const inventoryQuery = useResource<Game[]>(inventoryPath, {
    enabled: !!serial && online && gamesLoaded,
    interval: 5000,
  });
  const gameInventory = { serial, games: inventoryQuery.data ?? [] };
  const inventoryError = inventoryQuery.error?.message ?? "";
  const replayDevice = !!devices.find((d) => d.serial === serial)?.replay;
  const appsQuery = useResource<{
    packages: string[];
    foreground: string | null;
  }>(`devices/${encodeURIComponent(serial ?? "")}/apps`, {
    enabled: !!serial && online && !replayDevice,
    interval: follow ? 3000 : 8000,
  });
  const apps = {
    serial,
    packages: appsQuery.data?.packages ?? [],
    foreground: appsQuery.data?.foreground ?? null,
  };
  const [version, setVersion] = useState(0);
  const [stream, setStream] = useState<{
    state: string;
    running: boolean;
    reason?: string;
  }>({ state: "idle", running: false });
  const [rate, setRate] = useState(0);
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [captureRequest, setCaptureRequest] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const disposition = useRef("keep");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [alerts, setAlerts] = useState(true);
  const [lastReport, setLastReport] = useState<Report | null>(null);
  const [focusEntry, setFocusEntry] = useState<number | null>(null);
  const lines = useRef<LogEntry[]>([]);
  const groups = useRef(new Map<string, LogGroup>()); // warnings/errors grouped by owner + message
  const perf = useRef<PerfSample[]>([]); // performance samples, one per second
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [perfVersion, setPerfVersion] = useState(0);
  const [qaVersion, setQaVersion] = useState(0);
  const socket = useRef<ReturnType<typeof connectSocket> | null>(null);
  const streamId = useRef(0);
  const raf = useRef(0);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const showToast = useCallback((t: ToastMessage) => setToast(t), []);

  const resetCapture = useCallback(() => {
    cancelAnimationFrame(raf.current);
    lines.current = [];
    groups.current = new Map();
    perf.current = [];
    setPerfSummary(null);
    setMonitor(null);
    setSession(null);
    setSessionId(null);
    setRate(0);
    setFocusEntry(null);
    setLastReport(null);
    setToast(null);
    setVersion((v) => v + 1);
    setPerfVersion((v) => v + 1);
    setCaptureVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    socket.current = connectSocket((msg) => {
      if (msg.type === "hello") {
        setStatus(msg.status);
        setDevices(msg.devices);
        setPair(msg.pair);
        return;
      }
      if (msg.type === "devices") return setDevices(msg.devices);
      if (msg.type === "pair") return setPair(msg);
      if (msg.type === "error")
        return showToast({
          title: "PlayLens could not complete the request",
          msg: msg.message,
          severity: "critical",
        });
      if (
        !collectionAllowed.current &&
        ["log.batch", "monitor", "perf", "alert", "run.report"].includes(
          msg.type,
        )
      )
        return;
      if (msg.type === "run.report") return setLastReport(msg);
      if (msg.type === "qa.run") return setQaVersion((v) => v + 1);
      if (
        "streamId" in msg &&
        msg.streamId !== undefined &&
        msg.streamId !== streamId.current
      )
        return;
      if (msg.type === "stream.state") setStream(msg);
      else if (msg.type === "monitor") setMonitor(msg);
      else if (msg.type === "session") {
        if (msg.reset) resetCapture();
        setSessionId(msg.id);
        setSession(msg);
        if (msg.paused !== undefined)
          setStream((s) => ({
            ...s,
            state: msg.paused
              ? "paused"
              : ["ended", "error"].includes(s.state)
                ? s.state
                : "live",
          }));
        if (
          captureWaiter.current?.pkg === msg.pkg &&
          captureWaiter.current?.serial === msg.serial
        )
          captureWaiter.current?.resolve(msg);
        setHistoryVersion((v) => v + 1);
      } else if (msg.type === "alert") {
        // Only serious problems pop up; warnings wait in Plugin health so they don't interrupt.
        if (alertsRef.current && msg.severity === "critical")
          showToast({
            title: msg.title,
            msg: msg.message,
            severity: msg.severity,
          });
      } else if (msg.type === "perf") {
        if (msg.reset) perf.current = [];
        perf.current.push(...msg.samples);
        setPerfSummary(msg.summary);
        setPerfVersion((v) => v + 1);
      } else if (msg.type === "log.batch") {
        const buf = lines.current;
        buf.push(...msg.entries);
        for (const e of msg.entries) if (e.gkey) addToGroup(groups.current, e);
        if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
        setRate(msg.rate);
        const crash = msg.entries.find((e) => ALERT_KINDS[e.kind ?? ""]);
        if (crash && alertsRef.current)
          showToast({
            title: ALERT_KINDS[crash.kind ?? ""],
            msg: crash.message,
            severity: "critical",
          });
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => setVersion((v) => v + 1));
      }
    }, setOnline);
    return () => {
      socket.current?.close();
      cancelAnimationFrame(raf.current);
    };
  }, [showToast, resetCapture]);

  const reloadGames = useCallback(
    async ({
      previousPackage,
      nextPackage,
    }: { previousPackage?: string; nextPackage?: string } = {}) => {
      await query.invalidateQueries(
        { queryKey: resourceKey("games") },
        { throwOnError: true },
      );
      await query.invalidateQueries({ queryKey: resourceKey(inventoryPath) });
      if (previousPackage && nextPackage && pkg === previousPackage)
        setPkg(nextPackage);
    },
    [query, inventoryPath, pkg, setPkg],
  );

  // Switching phones starts over: the game on the old phone may not exist on the new one.
  const selectDevice = useCallback((d: Device | undefined) => {
    if (!d) return;
    setSerial(d.serial);
    setFollow(false);
  }, []);

  // Prefer a real phone even when a simulator was selected before it arrived.
  useEffect(() => {
    const next = preferredDevice(devices, serial);
    if ((next?.serial ?? null) !== serial) {
      if (next) selectDevice(next);
      else setSerial(null);
    }
  }, [devices, serial, selectDevice]);

  const refreshApps = useCallback(async () => {
    if (!serial) return;
    const list = await api<Game[]>(`${inventoryPath}?refresh=1`);
    query.setQueryData(resourceKey(inventoryPath), list);
    await query.invalidateQueries({
      queryKey: resourceKey(`devices/${encodeURIComponent(serial ?? "")}/apps`),
    });
  }, [query, serial, inventoryPath]);

  useEffect(() => {
    if (gamesLoaded && pkg && !games.some((g) => g.packageId === pkg)) {
      setPkg(null);
      setView("home");
    }
  }, [games, gamesLoaded, pkg]);

  const send = useCallback((msg: Command) => socket.current?.send(msg), []);

  // "Stop log" halts logcat itself (nothing collected or saved) until Play; picking another
  // device or game starts streaming again.
  const [stopped, setStopped] = useState(false);
  useEffect(() => setStopped(false), [serial, pkg]);

  const game = games.find((g) => g.packageId === pkg) || null;
  const inGameWorkspace =
    !!game &&
    (GAME_VIEWS.has(view) ||
      (view === "saved-session" && archiveReturn === "game-sessions"));
  const installedGame =
    gameInventory.serial === serial &&
    gameInventory.games.find((g) => g.packageId === pkg)?.installed;
  const captureEnabled =
    inGameWorkspace && view !== "saved-session" && !!installedGame;
  useEffect(() => {
    const identity = `${serial}:${pkg}`;
    if (displayedIdentity.current !== identity) {
      displayedIdentity.current = identity;
      captureIdentity.current = null;
      resetCapture();
    }
  }, [serial, pkg, resetCapture]);
  collectionAllowed.current = captureEnabled && !stopped;

  // Home and global pages pause the source and sampler, keeping this capture resumable.
  useEffect(() => {
    if (!online) {
      captureIdentity.current = null;
      return;
    }
    if (!captureEnabled || !serial || !gamesLoaded) {
      setStream((s) => ({ ...s, state: "paused" }));
      return;
    }
    if (stopped) {
      send({ type: "stream.stop", previous: "keep" });
      captureIdentity.current = null;
      setStream((s) => ({ ...s, state: "stopped" }));
      return;
    }
    const identity = `${serial}:${pkg}:${captureRequest}`;
    let id = streamId.current;
    if (captureIdentity.current === identity) {
      send({ type: "stream.resume", streamId: id });
    } else {
      resetCapture();
      setStream({ state: "starting", running: false });
      id = ++streamId.current;
      send({
        type: "stream.start",
        serial,
        pkg,
        streamId: id,
        previous: disposition.current,
      });
      disposition.current = "keep";
      captureIdentity.current = identity;
    }
    return () => send({ type: "stream.pause", streamId: id });
  }, [
    serial,
    pkg,
    online,
    send,
    stopped,
    captureRequest,
    resetCapture,
    gamesLoaded,
    captureEnabled,
  ]);

  const newSession = useCallback(
    (previous = "keep") => {
      if (previous === "save")
        send({ type: "session.save", streamId: streamId.current });
      else if (previous === "discard")
        send({ type: "session.discard", id: sessionId });
      disposition.current = previous;
      streamId.current++; // reject late batches from the capture being cleared
      resetCapture();
      setStopped(false);
      setCaptureRequest((v) => v + 1);
      setHistoryVersion((v) => v + 1);
    },
    [send, resetCapture, sessionId],
  );
  const saveSession = useCallback(
    () => send({ type: "session.save", streamId: streamId.current }),
    [send],
  );
  const reviewSession = useCallback(
    (id: string) => {
      void navigate({
        to: "/",
        resetScroll: false,
        search: (old) => ({
          ...validateSearch(old),
          view: "saved-session",
          session: id,
          game: inGameWorkspace ? (pkg ?? undefined) : undefined,
        }),
      });
    },
    [inGameWorkspace, navigate, pkg],
  );

  const selectGame = useCallback(
    (packageId: string) => {
      setFollow(false);
      setPkg(packageId);
    },
    [setPkg],
  );
  const openGame = useCallback(
    (packageId: string, destination: View = "logs") => {
      setFollow(false);
      updatePackage(packageId);
      void navigate({
        to: "/",
        resetScroll: false,
        search: (old) => ({
          ...validateSearch(old),
          view: destination,
          game: packageId,
          session: undefined,
        }),
      });
    },
    [navigate],
  );
  const viewGameSessions = useCallback(
    (packageId = "__all") => {
      setHistoryGame(packageId);
      if (packageId !== "__all") updatePackage(packageId);
      void navigate({
        to: "/",
        resetScroll: false,
        search: (old) => ({
          ...validateSearch(old),
          view: packageId === "__all" ? "sessions" : "game-sessions",
          game: packageId === "__all" ? undefined : packageId,
          session: undefined,
        }),
      });
    },
    [navigate],
  );
  // Keep an unsaved session only if you saved it or it caught a crash.
  const throwaway = useCallback(
    () =>
      !!session &&
      !session.saved &&
      !!session.startedAt &&
      Date.now() - session.startedAt < THROWAWAY_MS &&
      !lines.current.some((e) => ALERT_KINDS[e.kind ?? ""]),
    [session],
  );
  const performGameAction = useCallback(
    async (packageId: string, action: string) => {
      if (actionBusy || !serial || !online) return;
      setActionBusy(`${packageId}:${action}`);
      try {
        if (action !== "stop") {
          const ready = new Promise<Session>((resolve, reject) => {
            const timer = setTimeout(() => {
              captureWaiter.current = null;
              reject(
                new Error(
                  "The new capture did not start. Try again when the phone is ready.",
                ),
              );
            }, 15000);
            captureWaiter.current = {
              pkg: packageId,
              serial,
              resolve: (s) => {
                clearTimeout(timer);
                captureWaiter.current = null;
                resolve(s);
              },
            };
          });
          selectGame(packageId);
          if (pkg === packageId) newSession(throwaway() ? "discard" : "save");
          else setStopped(false);
          await ready;
        }
        await api(
          `devices/${encodeURIComponent(serial ?? "")}/apps/${encodeURIComponent(packageId)}/${action}`,
          { method: "POST" },
        );
        if (action === "stop" && pkg === packageId) setStopped(true);
        refreshApps();
      } catch (err) {
        showToast({
          title: `Could not ${action} the game`,
          msg: errorMessage(err),
        });
      } finally {
        setActionBusy(null);
      }
    },
    [
      actionBusy,
      serial,
      online,
      pkg,
      newSession,
      selectGame,
      refreshApps,
      showToast,
    ],
  );

  const value = useMemo(
    () => ({
      status,
      devices,
      pair,
      online,
      view,
      setView,
      serial,
      setSerial,
      selectDevice,
      pkg,
      setPkg,
      follow,
      setFollow,
      apps,
      refreshApps,
      send,
      device: devices.find((d) => d.serial === serial) ?? null,
      game,
      inGameWorkspace,
      openGame,
      archiveReturn,
      games,
      gamesLoaded,
      gamesError,
      reloadGames,
      gameInventory,
      inventoryError,
      actionBusy,
      selectGame,
      performGameAction,
      historyGame,
      setHistoryGame,
      viewGameSessions,
      session,
      captureVersion,
      historyVersion,
      setHistoryVersion,
      newSession,
      saveSession,
      archivedId,
      reviewSession,
      lines,
      version,
      stream,
      rate,
      monitor,
      sessionId,
      toast,
      setToast,
      showToast,
      alerts,
      setAlerts,
      lastReport,
      setLastReport,
      focusEntry,
      setFocusEntry,
      stopped,
      setStopped,
      groups,
      perf,
      perfSummary,
      perfVersion,
      qaVersion,
      showInLogs: (entryId: number) => {
        setFocusEntry(entryId);
        setView("logs");
      },
    }),
    [
      status,
      devices,
      pair,
      online,
      view,
      serial,
      selectDevice,
      pkg,
      follow,
      apps,
      refreshApps,
      send,
      version,
      stream,
      rate,
      monitor,
      sessionId,
      toast,
      showToast,
      alerts,
      lastReport,
      focusEntry,
      stopped,
      perfSummary,
      perfVersion,
      qaVersion,
      session,
      captureVersion,
      historyVersion,
      newSession,
      saveSession,
      archivedId,
      reviewSession,
      games,
      gamesLoaded,
      gamesError,
      reloadGames,
      gameInventory,
      inventoryError,
      actionBusy,
      selectGame,
      performGameAction,
      historyGame,
      viewGameSessions,
      game,
      inGameWorkspace,
      openGame,
      archiveReturn,
    ],
  );

  return value;
}

export function AppProvider({ children }: PropsWithChildren) {
  const value = useAppState();
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("AppProvider is required");
  return app;
}

const LEVEL_RANK: Record<string, number> = { W: 1, E: 2, F: 3 };
function addToGroup(map: Map<string, LogGroup>, e: LogEntry) {
  let g = map.get(e.gkey!);
  if (!g) {
    g = {
      key: e.gkey!,
      owner: e.owner,
      sdk: e.sdk ?? null,
      tag: e.tag,
      level: e.level,
      kind: e.kind,
      meaning: e.meaning ?? null,
      safe: !!e.safe,
      count: 0,
      first: e.ts,
      last: e.ts,
      lastId: e.id,
      sample: e,
    };
    map.set(e.gkey!, g);
  }
  g.count++;
  g.last = e.ts;
  g.lastId = e.id;
  if ((LEVEL_RANK[e.level] ?? 0) > (LEVEL_RANK[g.level] ?? 0))
    g.level = e.level;
  if (e.more && !g.sample.more) g.sample = e;
}

export function deviceName(d: Device | null | undefined) {
  if (!d) return "No device";
  return d.info?.model || d.props?.model?.replace(/_/g, " ") || d.serial;
}

// Plain-language hint for device states that need the user to do something.
export function stateHint(d: Device) {
  switch (d.state) {
    case "device":
      return null;
    case "unauthorized":
      return 'Tap "Allow" on the USB debugging prompt on the phone.';
    case "offline":
      return "Offline. Unplug and plug back in, or toggle wireless debugging.";
    case "no permissions":
      return "No permission to talk to this phone (Linux udev rules).";
    case "authorizing":
    case "connecting":
      return "Connecting…";
    default:
      return `State: ${d.state}`;
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function clock(ts: number, ms = true) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? `.${pad(d.getMilliseconds(), 3)}` : ""}`;
}

export function secs(ms: number | null | undefined) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
