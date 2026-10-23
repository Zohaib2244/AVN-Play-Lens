// App-wide state: server status, devices, pairing, the selected device and game, the view,
// and the live stream (log lines + monitor snapshot). The stream lives here so it keeps
// running while you switch between Logs, Plugin health, Firebase and Checklist.
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api, connectSocket } from './api.js';
import { readLocation, viewLocation } from './navigation.mjs';

const AppContext = createContext(null);
const MAX_LINES = 50000;
const GAME_VIEWS = new Set(['snapshooter', 'game', 'logs', 'performance', 'health', 'firebase', 'firebase-setup', 'remote-config', 'checklist', 'checklist-setup', 'game-sessions']);
const ALERT_KINDS = { exception: 'Unity exception', 'java-crash': 'App crashed (Java)', 'native-crash': 'App crashed (native)', anr: 'App not responding (ANR)' };

export function AppProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pair, setPair] = useState({ state: 'idle' });
  const [online, setOnline] = useState(false);
  const [view, setView] = useState(() => readLocation(window.location.search).view);
  const [serial, setSerial] = useState(null);
  const [pkg, setPkg] = useState(() => readLocation(window.location.search).pkg);
  const [games, setGames] = useState([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [gamesError, setGamesError] = useState('');
  const [gameInventory, setGameInventory] = useState({ serial: null, games: [] });
  const [inventoryError, setInventoryError] = useState('');
  const [actionBusy, setActionBusy] = useState(null);
  const [archiveReturn, setArchiveReturn] = useState(() => readLocation(window.location.search).pkg ? 'game-sessions' : 'sessions');
  const captureIdentity = useRef(null);
  const displayedIdentity = useRef(null);
  const collectionAllowed = useRef(false);
  const [historyGame, setHistoryGame] = useState('__all');
  const captureWaiter = useRef(null);
  const refreshInventoryRef = useRef(null);
  // "Follow the open app" picks whichever installed game is in front on the phone; choosing a
  // game by hand turns it off. The list of installed games is kept fresh here so every page's
  // picker shows apps installed after PlayLens started.
  const [follow, setFollow] = useState(false);
  const [apps, setApps] = useState({ serial: null, packages: [], foreground: null });
  const [version, setVersion] = useState(0);
  const [stream, setStream] = useState({ state: 'idle', running: false });
  const [rate, setRate] = useState(0);
  const [monitor, setMonitor] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [session, setSession] = useState(null);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [captureRequest, setCaptureRequest] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [archivedId, setArchivedId] = useState(() => readLocation(window.location.search).archivedId);
  const disposition = useRef('save');
  const [toast, setToast] = useState(null);
  const [alerts, setAlerts] = useState(true);
  const [lastReport, setLastReport] = useState(null);
  const [focusEntry, setFocusEntry] = useState(null);
  const lines = useRef([]);
  const groups = useRef(new Map());   // warnings/errors grouped by owner + message
  const perf = useRef([]);            // performance samples, one per second
  const [perfSummary, setPerfSummary] = useState(null);
  const [perfVersion, setPerfVersion] = useState(0);
  const socket = useRef(null);
  const streamId = useRef(0);
  const raf = useRef(0);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const showToast = useCallback((t) => setToast(t), []);

  useEffect(() => {
    const route = readLocation(window.location.search);
    const search = viewLocation(window.location.search, { view, pkg, archivedId });
    if (route.view !== view || window.location.search !== search) {
      window.history.pushState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
    }
  }, [view, pkg, archivedId]);
  useEffect(() => {
    const onPop = () => {
      const route = readLocation(window.location.search);
      setView(route.view); setPkg(route.pkg); setArchivedId(route.archivedId);
      if (route.view === 'saved-session') setArchiveReturn(route.pkg ? 'game-sessions' : 'sessions');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
      if (msg.type === 'hello') {
        setStatus(msg.status);
        setDevices(msg.devices);
        setPair(msg.pair);
        return;
      }
      if (msg.type === 'devices') return setDevices(msg.devices);
      if (msg.type === 'pair') return setPair(msg);
      if (msg.type === 'error') return showToast({ title: 'PlayLens could not complete the request', msg: msg.message, severity: 'critical' });
      if (!collectionAllowed.current && ['log.batch', 'monitor', 'perf', 'alert', 'run.report'].includes(msg.type)) return;
      if (msg.type === 'run.report') return setLastReport(msg);
      if (msg.streamId !== undefined && msg.streamId !== streamId.current) return;
      if (msg.type === 'stream.state') setStream(msg);
      else if (msg.type === 'monitor') setMonitor(msg);
      else if (msg.type === 'session') {
        if (msg.reset) resetCapture();
        setSessionId(msg.id);
        setSession(msg);
        if (msg.paused !== undefined) setStream((s) => ({ ...s, state: msg.paused ? 'paused' : ['ended', 'error'].includes(s.state) ? s.state : 'live' }));
        if (captureWaiter.current?.pkg === msg.pkg && captureWaiter.current?.serial === msg.serial) captureWaiter.current.resolve(msg);
        setHistoryVersion((v) => v + 1);
      }
      else if (msg.type === 'alert') {
        // Only serious problems pop up; warnings wait in Plugin health so they don't interrupt.
        if (alertsRef.current && msg.severity === 'critical') showToast({ title: msg.title, msg: msg.message, severity: msg.severity });
      } else if (msg.type === 'perf') {
        if (msg.reset) perf.current = [];
        perf.current.push(...msg.samples);
        setPerfSummary(msg.summary);
        setPerfVersion((v) => v + 1);
      } else if (msg.type === 'log.batch') {
        const buf = lines.current;
        buf.push(...msg.entries);
        for (const e of msg.entries) if (e.gkey) addToGroup(groups.current, e);
        if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
        setRate(msg.rate);
        const crash = msg.entries.find((e) => ALERT_KINDS[e.kind]);
        if (crash && alertsRef.current) showToast({ title: ALERT_KINDS[crash.kind], msg: crash.message, severity: 'critical' });
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => setVersion((v) => v + 1));
      }
    }, setOnline);
    return () => socket.current.close();
  }, [showToast, resetCapture]);

  const reloadGames = useCallback(async ({ previousPackage, nextPackage } = {}) => {
    try { setGames(await api('games')); if (previousPackage && nextPackage) setPkg((p) => p === previousPackage ? nextPackage : p); setGamesError(''); setGamesLoaded(true); }
    catch (err) { setGamesError(err.message); }
  }, []);
  useEffect(() => {
    if (!online) return;
    reloadGames();
    const timer = setInterval(reloadGames, 10000);
    return () => clearInterval(timer);
  }, [online, reloadGames]);

  useEffect(() => {
    if (!serial || !online || !gamesLoaded) return;
    let alive = true;
    const load = async (force = false) => {
      try {
        const list = await api(`devices/${encodeURIComponent(serial)}/games${force === true ? '?refresh=1' : ''}`);
        if (alive) { setGameInventory({ serial, games: list }); setInventoryError(''); }
      } catch (err) { if (alive) setInventoryError(err.message); }
    };
    refreshInventoryRef.current = load;
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); refreshInventoryRef.current = null; };
  }, [serial, online, games, gamesLoaded]);

  // Switching phones starts over: the game on the old phone may not exist on the new one.
  const selectDevice = useCallback((d) => {
    setSerial(d.serial);
    setFollow(false);
  }, []);

  // Keep a sensible device selected: the current one if still there, else the first ready phone.
  useEffect(() => {
    const ready = devices.filter((d) => d.state === 'device');
    if (!ready.some((d) => d.serial === serial)) {
      const next = ready.find((d) => !d.replay) ?? ready[0] ?? null;
      if (next) selectDevice(next);
      else setSerial(null);
    }
  }, [devices, serial, selectDevice]);

  // The phone's installed games and the app in front, refreshed while a phone is selected.
  const replayDevice = !!devices.find((d) => d.serial === serial)?.replay;
  const loadApps = useRef(null);
  useEffect(() => {
    if (!serial || !online || replayDevice) return undefined;
    let alive = true;
    const load = () => api(`devices/${encodeURIComponent(serial)}/apps`).then((a) => { if (alive) setApps({ serial, ...a }); }).catch(() => {});
    loadApps.current = load;
    load();
    const t = setInterval(load, follow ? 3000 : 8000);
    return () => { alive = false; clearInterval(t); };
  }, [serial, online, follow, replayDevice]);
  const refreshApps = useCallback(() => { loadApps.current?.(); refreshInventoryRef.current?.(true); }, []);

  useEffect(() => {
    if (gamesLoaded && pkg && !games.some((g) => g.packageId === pkg)) {
      setPkg(null);
      setView('home');
    }
  }, [games, gamesLoaded, pkg]);

  const send = useCallback((msg) => socket.current?.send(msg), []);

  // "Stop log" halts logcat itself (nothing collected or saved) until Play; picking another
  // device or game starts streaming again.
  const [stopped, setStopped] = useState(false);
  useEffect(() => setStopped(false), [serial, pkg]);

  const game = games.find((g) => g.packageId === pkg) || null;
  const inGameWorkspace = !!game && (GAME_VIEWS.has(view) || (view === 'saved-session' && archiveReturn === 'game-sessions'));
  const installedGame = gameInventory.serial === serial && gameInventory.games.find((g) => g.packageId === pkg)?.installed;
  const captureEnabled = inGameWorkspace && view !== 'saved-session' && !!installedGame;
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
    if (!online) { captureIdentity.current = null; return; }
    if (!captureEnabled || !serial || !gamesLoaded) {
      setStream((s) => ({ ...s, state: 'paused' }));
      return;
    }
    if (stopped) {
      send({ type: 'stream.stop', previous: 'save' });
      captureIdentity.current = null;
      setStream((s) => ({ ...s, state: 'stopped' }));
      return;
    }
    const identity = `${serial}:${pkg}:${captureRequest}`;
    let id = streamId.current;
    if (captureIdentity.current === identity) {
      send({ type: 'stream.resume', streamId: id });
    } else {
      resetCapture();
      setStream({ state: 'starting', running: false });
      id = ++streamId.current;
      send({ type: 'stream.start', serial, pkg, streamId: id, previous: disposition.current });
      disposition.current = 'save';
      captureIdentity.current = identity;
    }
    return () => send({ type: 'stream.pause', streamId: id });
  }, [serial, pkg, online, send, stopped, captureRequest, resetCapture, gamesLoaded, captureEnabled]);

  const newSession = useCallback((previous = 'save') => {
    if (previous === 'save') send({ type: 'session.save', streamId: streamId.current });
    else send({ type: 'session.discard', id: sessionId });
    disposition.current = previous;
    streamId.current++; // reject late batches from the capture being cleared
    resetCapture();
    setStopped(false);
    setCaptureRequest((v) => v + 1);
    setHistoryVersion((v) => v + 1);
  }, [send, resetCapture, sessionId]);
  const saveSession = useCallback(() => send({ type: 'session.save', streamId: streamId.current }), [send]);
  const reviewSession = useCallback((id) => { setArchivedId(id); setArchiveReturn(inGameWorkspace ? 'game-sessions' : 'sessions'); setView('saved-session'); }, [inGameWorkspace]);

  const selectGame = useCallback((packageId) => { setFollow(false); setPkg(packageId); }, []);
  const openGame = useCallback((packageId) => { setFollow(false); setPkg(packageId); setView('game'); }, []);
  const viewGameSessions = useCallback((packageId = '__all') => { setHistoryGame(packageId); setView(packageId === '__all' ? 'sessions' : 'game-sessions'); if (packageId !== '__all') setPkg(packageId); }, []);
  const performGameAction = useCallback(async (packageId, action) => {
    if (actionBusy || !serial || !online) return;
    setActionBusy(`${packageId}:${action}`);
    try {
      if (action !== 'stop') {
        const ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { captureWaiter.current = null; reject(new Error('The new capture did not start. Try again when the phone is ready.')); }, 15000);
          captureWaiter.current = { pkg: packageId, serial, resolve: (s) => { clearTimeout(timer); captureWaiter.current = null; resolve(s); } };
        });
        selectGame(packageId);
        if (pkg === packageId) newSession('save');
        else setStopped(false);
        await ready;
      }
      await api(`devices/${encodeURIComponent(serial)}/apps/${encodeURIComponent(packageId)}/${action}`, { method: 'POST' });
      if (action === 'stop' && pkg === packageId) setStopped(true);
      refreshApps();
    } catch (err) { showToast({ title: `Could not ${action} the game`, msg: err.message }); }
    finally { setActionBusy(null); }
  }, [actionBusy, serial, online, pkg, newSession, selectGame, refreshApps, showToast]);

  const value = useMemo(() => ({
    status, devices, pair, online, view, setView, serial, setSerial, selectDevice, pkg, setPkg, follow, setFollow, apps, refreshApps, send,
    device: devices.find((d) => d.serial === serial) ?? null,
    game, inGameWorkspace, openGame, archiveReturn,
    games, gamesLoaded, gamesError, reloadGames, gameInventory, inventoryError, actionBusy, selectGame, performGameAction, historyGame, setHistoryGame, viewGameSessions,
    session, captureVersion, historyVersion, setHistoryVersion, newSession, saveSession, archivedId, reviewSession,
    lines, version, stream, rate, monitor, sessionId, toast, setToast, showToast, alerts, setAlerts, lastReport, setLastReport,
    focusEntry, setFocusEntry, stopped, setStopped, groups, perf, perfSummary, perfVersion,
    showInLogs: (entryId) => { setFocusEntry(entryId); setView('logs'); },
  }), [status, devices, pair, online, view, serial, selectDevice, pkg, follow, apps, refreshApps, send, version, stream, rate, monitor, sessionId, toast, showToast, alerts, lastReport, focusEntry, stopped, perfSummary, perfVersion, session, captureVersion, historyVersion, newSession, saveSession, archivedId, reviewSession, games, gamesLoaded, gamesError, reloadGames, gameInventory, inventoryError, actionBusy, selectGame, performGameAction, historyGame, viewGameSessions, game, inGameWorkspace, openGame, archiveReturn]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);

const LEVEL_RANK = { W: 1, E: 2, F: 3 };
function addToGroup(map, e) {
  let g = map.get(e.gkey);
  if (!g) {
    g = { key: e.gkey, owner: e.owner, sdk: e.sdk ?? null, tag: e.tag, level: e.level, kind: e.kind, meaning: e.meaning ?? null, safe: !!e.safe, count: 0, first: e.ts, last: e.ts, lastId: e.id, sample: e };
    map.set(e.gkey, g);
  }
  g.count++;
  g.last = e.ts;
  g.lastId = e.id;
  if ((LEVEL_RANK[e.level] ?? 0) > (LEVEL_RANK[g.level] ?? 0)) g.level = e.level;
  if (e.more && !g.sample.more) g.sample = e;
}

export function deviceName(d) {
  if (!d) return 'No device';
  return d.info?.model || d.props?.model?.replace(/_/g, ' ') || d.serial;
}

// Plain-language hint for device states that need the user to do something.
export function stateHint(d) {
  switch (d.state) {
    case 'device': return null;
    case 'unauthorized': return 'Tap "Allow" on the USB debugging prompt on the phone.';
    case 'offline': return 'Offline. Unplug and plug back in, or toggle wireless debugging.';
    case 'no permissions': return 'No permission to talk to this phone (Linux udev rules).';
    case 'authorizing':
    case 'connecting': return 'Connecting…';
    default: return `State: ${d.state}`;
  }
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function clock(ts, ms = true) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? `.${pad(d.getMilliseconds(), 3)}` : ''}`;
}

export function secs(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// Short statuses for the rail and home tiles, from the live monitor.
export function viewStatus(monitor, perf) {
  const issues = (monitor?.flags ?? []).filter((f) => f.severity !== 'info').length;
  const fb = monitor?.firebase;
  const run = monitor?.run;
  const items = run?.items ?? [];
  const fps = perf?.fps?.last;
  const mem = perf?.mem?.last;
  return {
    performance: fps != null || mem != null ? { text: [fps != null && `${Math.round(fps)} FPS`, mem != null && `${Math.round(mem)} MB`].filter(Boolean).join(' · '), cls: fps != null && fps < 30 ? 'warm' : 'ok' } : { text: 'FPS, CPU, memory', cls: '' },
    health: !monitor?.health?.seen ? { text: 'Waiting for plugin lines', cls: '' } : issues ? { text: `${issues} to look at`, cls: 'warm' } : { text: 'All good', cls: 'ok' },
    firebase: fb?.debug?.on ? { text: fb.receiving ? `${fb.counts.firebase} events logged` : fb.diagnostics?.upload?.state === 'successful' ? 'Upload confirmed' : fb.diagnostics?.lines ? 'SDK active' : 'Waiting for SDK', cls: fb.receiving || fb.diagnostics?.upload?.state === 'successful' ? 'ok' : '', ready: true } : { text: 'Needs setup', cls: 'warm', ready: false },
    checklist: run?.active ? { text: `Run live · ${items.filter((i) => i.status === 'ok').length} of ${items.length}`, cls: 'ok', ready: true } : run ? { text: 'Run finished', cls: '', ready: true } : { text: 'Needs setup', cls: 'warm', ready: false },
  };
}
