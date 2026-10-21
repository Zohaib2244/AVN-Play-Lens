// App-wide state: server status, devices, pairing, the selected device and game, the view,
// and the live stream (log lines + monitor snapshot). The stream lives here so it keeps
// running while you switch between Logs, Plugin health, Firebase and Checklist.
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api, connectSocket } from './api.js';

const AppContext = createContext(null);
const MAX_LINES = 50000;
const ALERT_KINDS = { exception: 'Unity exception', 'java-crash': 'App crashed (Java)', 'native-crash': 'App crashed (native)', anr: 'App not responding (ANR)' };

export function AppProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pair, setPair] = useState({ state: 'idle' });
  const [online, setOnline] = useState(false);
  const [view, setView] = useState('home');
  const [serial, setSerial] = useState(null);
  const [pkg, setPkg] = useState(null);
  // "Follow the open app" picks whichever installed game is in front on the phone; choosing a
  // game by hand turns it off. The list of installed games is kept fresh here so every page's
  // picker shows apps installed after PlayLens started.
  const [follow, setFollow] = useState(true);
  const [apps, setApps] = useState({ serial: null, packages: [], foreground: null });
  const [version, setVersion] = useState(0);
  const [stream, setStream] = useState({ state: 'idle', running: false });
  const [rate, setRate] = useState(0);
  const [monitor, setMonitor] = useState(null);
  const [sessionId, setSessionId] = useState(null);
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
  const toastTimer = useRef(0);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const showToast = useCallback((t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
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
      if (msg.type === 'error') return showToast({ title: 'Something went wrong', msg: msg.message });
      if (msg.type === 'run.report') return setLastReport(msg);
      if (msg.streamId !== undefined && msg.streamId !== streamId.current) return;
      if (msg.type === 'stream.state') setStream(msg);
      else if (msg.type === 'monitor') setMonitor(msg);
      else if (msg.type === 'session') setSessionId(msg.id);
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
  }, [showToast]);

  // Switching phones starts over: the game on the old phone may not exist on the new one.
  const selectDevice = useCallback((d) => {
    setSerial(d.serial);
    setPkg(d.replay ? d.packages[0] : null);
    setFollow(!d.replay);
  }, []);

  // Keep a sensible device selected: the current one if still there, else the first ready phone.
  useEffect(() => {
    const ready = devices.filter((d) => d.state === 'device');
    if (!ready.some((d) => d.serial === serial)) {
      const next = ready.find((d) => !d.replay) ?? ready[0] ?? null;
      if (next) selectDevice(next);
      else { setSerial(null); setPkg(null); }
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
  const refreshApps = useCallback(() => loadApps.current?.(), []);

  useEffect(() => {
    if (!follow || apps.serial !== serial) return;
    if (apps.foreground && apps.packages.includes(apps.foreground) && apps.foreground !== pkg) setPkg(apps.foreground);
  }, [follow, apps, serial, pkg]);

  const send = useCallback((msg) => socket.current?.send(msg), []);

  // "Stop log" halts logcat itself (nothing collected or saved) until Play; picking another
  // device or game starts streaming again.
  const [stopped, setStopped] = useState(false);
  useEffect(() => setStopped(false), [serial, pkg]);

  // One stream per device + game, independent of the view.
  useEffect(() => {
    if (!serial || !online) return undefined;
    if (stopped) {
      streamId.current++;   // ignore anything the old stream still sends
      setStream((s) => ({ ...s, state: 'stopped' }));
      return undefined;
    }
    lines.current = [];
    groups.current = new Map();
    perf.current = [];
    setPerfSummary(null);
    setMonitor(null);
    setStream({ state: 'starting', running: false });
    setVersion((v) => v + 1);
    const id = ++streamId.current;
    send({ type: 'stream.start', serial, pkg, all: !pkg, streamId: id });
    return () => send({ type: 'stream.stop' });
  }, [serial, pkg, online, send, stopped]);

  const value = useMemo(() => ({
    status, devices, pair, online, view, setView, serial, setSerial, selectDevice, pkg, setPkg, follow, setFollow, apps, refreshApps, send,
    device: devices.find((d) => d.serial === serial) ?? null,
    lines, version, stream, rate, monitor, sessionId, toast, setToast, showToast, alerts, setAlerts, lastReport, setLastReport,
    focusEntry, setFocusEntry, stopped, setStopped, groups, perf, perfSummary, perfVersion,
    showInLogs: (entryId) => { setFocusEntry(entryId); setView('logs'); },
  }), [status, devices, pair, online, view, serial, selectDevice, pkg, follow, apps, refreshApps, send, version, stream, rate, monitor, sessionId, toast, showToast, alerts, lastReport, focusEntry, stopped, perfSummary, perfVersion]);

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
    firebase: fb?.debug?.on ? { text: `Listening · ${fb.counts.firebase} logged`, cls: 'ok', ready: true } : { text: 'Needs setup', cls: 'warm', ready: false },
    checklist: run?.active ? { text: `Run live · ${items.filter((i) => i.status === 'ok').length} of ${items.length}`, cls: 'ok', ready: true } : run ? { text: 'Run finished', cls: '', ready: true } : { text: 'Needs setup', cls: 'warm', ready: false },
  };
}
