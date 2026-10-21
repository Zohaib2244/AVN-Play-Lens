// Local HTTP + WebSocket server. Binds to 127.0.0.1 only, no login. Because it can run adb
// commands on connected phones, requests must come from this app's own page: the Host and
// Origin headers must be this machine, so other websites open in the browser can't use it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { LogStream, adbSource } from '../session/stream.mjs';
import { listPackages, foregroundPackage, appActions, PACKAGE_RE } from '../device/info.mjs';
import { readDeviceProfile, readAppProfile, readApkSdks } from '../device/profile.mjs';
import { PerfSampler, ReplayPerf } from '../perf/sampler.mjs';
import { firebaseDebugStatus, setFirebaseDebug, FIREBASE_COMMANDS } from '../device/firebase.mjs';
import { replaySource, REPLAY_SERIAL, replayProfile } from '../replay/source.mjs';
import { Monitor } from '../monitor/monitor.mjs';
import { readReport } from '../monitor/report.mjs';
import { SessionRecorder, listSessions, sessionText } from '../session/recorder.mjs';
import { spawn } from 'node:child_process';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json' };
const ADDRESS_RE = /^[\w.-]+:\d{2,5}$/;

export function createServer(ctx) {
  const { port, staticDir } = ctx;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(ctx.extraHosts || [])]);

  const hostOk = (req) => allowedHosts.has(req.headers.host);
  const originOk = (req) => !req.headers.origin || [...allowedHosts].some((h) => req.headers.origin === `http://${h}`);

  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const download = (res, body, type, name) => {
    res.writeHead(200, { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' });
    res.end(body);
  };
  const deviceName = (serial) => {
    const d = ctx.devices().find((x) => x.serial === serial);
    return d?.info?.model || d?.props?.model?.replace(/_/g, ' ') || serial;
  };
  const isReplay = (serial) => serial === REPLAY_SERIAL && ctx.replay;
  const profiles = new Map();

  const readJson = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
    const [area, id, sub, pkg, action] = parts;

    if (req.method === 'GET' && area === 'status') return send(res, 200, ctx.status());
    if (req.method === 'GET' && area === 'devices' && !id) return send(res, 200, ctx.devices());

    if (area === 'devices' && id && sub === 'apps') {
      if (id === REPLAY_SERIAL && ctx.replay) {
        if (req.method === 'GET') return send(res, 200, { packages: [ctx.replay.pkg], foreground: ctx.replay.pkg });
        return send(res, 200, { ok: true, note: 'Replay device: app actions do nothing.' });
      }
      if (!ctx.adb) return send(res, 503, { error: 'adb not found' });
      if (req.method === 'GET' && !pkg) {
        const [packages, foreground] = await Promise.all([listPackages(ctx.adb, id), foregroundPackage(ctx.adb, id).catch(() => null)]);
        return send(res, 200, { packages, foreground });
      }
      if (req.method === 'POST' && pkg && action && appActions[action]) {
        if (!PACKAGE_RE.test(pkg)) return send(res, 400, { error: 'bad package name' });
        await appActions[action](ctx.adb, id, pkg);
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && area === 'devices' && id && sub === 'profile') {
      const ppkg = url.searchParams.get('pkg');
      if (isReplay(id)) return send(res, 200, replayProfile(ctx.replay.pkg));
      if (!ctx.adb) return send(res, 503, { error: 'adb not found' });
      const cached = profiles.get(id);
      const device = cached && Date.now() - cached.at < 60000 ? cached.device : await readDeviceProfile(ctx.adb, id);
      profiles.set(id, { at: Date.now(), device });
      const app = ppkg && PACKAGE_RE.test(ppkg) ? await readAppProfile(ctx.adb, id, ppkg).catch(() => null) : null;
      return send(res, 200, { device, app });
    }

    if (area === 'devices' && id && sub === 'firebase') {
      const body = req.method === 'POST' ? await readJson(req) : {};
      const fpkg = url.searchParams.get('pkg') || body.pkg;
      if (isReplay(id)) return send(res, 200, { on: true, app: ctx.replay.pkg, verbose: true, replay: true, commands: FIREBASE_COMMANDS(ctx.replay.pkg) });
      if (!ctx.adb) return send(res, 503, { error: 'adb not found' });
      if (req.method === 'GET') return send(res, 200, { ...(await firebaseDebugStatus(ctx.adb, id, fpkg)), commands: fpkg ? FIREBASE_COMMANDS(fpkg) : [] });
      if (req.method === 'POST') {
        if (!PACKAGE_RE.test(body.pkg || '')) return send(res, 400, { error: 'bad package name' });
        const st = await setFirebaseDebug(ctx.adb, id, body.pkg, !!body.on);
        for (const m of liveMonitors) if (m.pkg === body.pkg) { m.firebaseDebug = st; m.dirty = true; }
        return send(res, 200, st);
      }
    }

    if (area === 'rules' && ctx.rules) {
      if (req.method === 'GET' && !id) {
        const pack = ctx.rules.pack();
        return send(res, 200, { dir: ctx.rules.dir, files: ctx.rules.list(), presets: (pack?.presets ?? []).map((p) => ({ id: p.id, name: p.name })) });
      }
      if (req.method === 'POST' && id === 'new') {
        const { pkg: newPkg } = await readJson(req);
        if (!PACKAGE_RE.test(newPkg || '')) return send(res, 400, { error: 'bad package name' });
        return send(res, 200, { file: ctx.rules.create(newPkg) });
      }
      if (req.method === 'POST' && id === 'reveal') {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        spawn(opener, [ctx.rules.dir], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && area === 'sessions') {
      if (!id) return send(res, 200, listSessions().slice(0, 20));
      const sid = id.replace(/\.txt$/, '');
      const text = sessionText(sid);
      return text == null ? send(res, 404, { error: 'session not found' }) : download(res, text, 'text/plain; charset=utf-8', `playlens-${sid}.txt`);
    }
    if (req.method === 'GET' && area === 'reports' && id) {
      const m = /^([\w-]+)\.(md|html)$/.exec(id);
      const body = m && readReport(m[1], m[2]);
      if (!body) return send(res, 404, { error: 'report not found' });
      return m[2] === 'html' && url.searchParams.get('view') ? (res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), res.end(body))
        : download(res, body, m[2] === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8', id);
    }

    if (req.method === 'GET' && area === 'pair') return send(res, 200, ctx.pairing?.state() ?? { state: 'idle' });
    if (req.method === 'POST' && area === 'pair') {
      if (!ctx.pairing) return send(res, 503, { error: 'adb not found' });
      if (id === 'qr') return send(res, 200, ctx.pairing.startQr());
      if (id === 'cancel') { ctx.pairing.cancel(); return send(res, 200, { ok: true }); }
      if (id === 'code') {
        const { address, code } = await readJson(req);
        if (!ADDRESS_RE.test(address || '') || !/^\d{6}$/.test(String(code || '').replace(/\s/g, ''))) return send(res, 400, { error: 'Use address:port and the 6-digit code from the phone.' });
        return send(res, 200, await ctx.pairing.pairWithCode(address, String(code).replace(/\s/g, '')));
      }
    }
    if (req.method === 'POST' && area === 'connect') {
      const { address } = await readJson(req);
      if (!ctx.adb || !ADDRESS_RE.test(address || '')) return send(res, 400, { error: 'Use address:port' });
      const out = await ctx.adb.run(['connect', address], { timeout: 10000 }).catch((e) => e.stdout || e.message);
      return send(res, 200, { ok: /connected/i.test(out), message: out.trim() });
    }
    return send(res, 404, { error: 'not found' });
  }

  async function serveStatic(req, res, url) {
    if (!staticDir) return send(res, 404, { error: 'web build not found; run npm run build' });
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path.includes('..')) return send(res, 400, { error: 'bad path' });
    let file = join(staticDir, path || 'index.html');
    let body = await readFile(file).catch(() => null);
    if (!body) {
      file = join(staticDir, 'index.html');
      body = await readFile(file).catch(() => null);
    }
    if (!body) return send(res, 404, { error: 'web build not found; run npm run build' });
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!hostOk(req)) return send(res, 403, { error: 'host not allowed' });
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!originOk(req)) return send(res, 403, { error: 'request not from PlayLens' });
        return await api(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });

  // WebSocket: device list, pairing progress, and one log stream per browser tab.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws' || !hostOk(req) || !originOk(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const clients = new Set();
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(text);
  };
  ctx.onDevices((devices) => broadcast({ type: 'devices', devices }));
  ctx.pairing?.on('update', (state) => broadcast({ type: 'pair', ...state }));

  const liveMonitors = new Set();
  ctx.rules?.on('change', () => { for (const m of liveMonitors) m.loadRules(); });

  wss.on('connection', (ws) => {
    clients.add(ws);
    let stream = null;
    let monitor = null;
    let recorder = null;
    let ticker = null;
    let sampler = null;
    const out = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    out({ type: 'hello', status: ctx.status(), devices: ctx.devices(), pair: ctx.pairing?.state() ?? { state: 'idle' } });

    const stopStream = () => {
      clearInterval(ticker);
      sampler?.stop();
      stream?.stop();   // flushes the last grouped line first, then the session file can close
      if (recorder) recorder.finish(monitor?.summary(), { perf: monitor?.perf.samples.length ? { samples: monitor.perf.samples, summary: monitor.perf.summary() } : null });
      if (monitor) liveMonitors.delete(monitor);
      stream = monitor = recorder = sampler = null;
    };

    const refreshFirebase = async (serial, pkg, m) => {
      if (!pkg) return;
      if (isReplay(serial)) { m.firebaseDebug = { on: true, replay: true, app: pkg, verbose: true }; return; }
      if (!ctx.adb) return;
      m.firebaseDebug = await firebaseDebugStatus(ctx.adb, serial, pkg).catch(() => null);
      m.dirty = true;
    };

    // The installed app: version, target API, permissions, and the SDKs inside the APK.
    const readApp = async (serial, pkg, m) => {
      if (!pkg) return;
      if (isReplay(serial)) {
        const r = replayProfile(pkg);
        Object.assign(m, { app: r.app, apkSdks: r.sdks });
        m.health.debuggable = r.app.debuggable;
        return;
      }
      if (!ctx.adb) return;
      m.app = await readAppProfile(ctx.adb, serial, pkg).catch(() => null);
      if (m.app) m.health.debuggable = m.app.debuggable;
      m.dirty = true;
      m.apkSdks = await readApkSdks(ctx.adb, serial, pkg).catch(() => null);
      m.dirty = true;
    };

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.type === 'stream.start') {
        stopStream();
        const pkg = msg.pkg && PACKAGE_RE.test(msg.pkg) ? msg.pkg : null;
        let source;
        if (isReplay(msg.serial)) source = replaySource(ctx.replay.file);
        else if (ctx.adb && typeof msg.serial === 'string') source = adbSource(ctx.adb, msg.serial, { history: !!msg.history });
        else return out({ type: 'stream.state', state: 'error', reason: 'Device not available' });
        const streamId = msg.streamId;
        const m = ctx.rules ? new Monitor({ rules: ctx.rules, pkg, deviceName: deviceName(msg.serial) }) : null;
        const rec = ctx.record === false ? null : new SessionRecorder({ serial: msg.serial, deviceName: deviceName(msg.serial), pkg, replay: isReplay(msg.serial) });
        monitor = m;
        recorder = rec;
        if (m) {
          liveMonitors.add(m);
          m.on('alert', (a) => out({ type: 'alert', streamId, ...a }));
          refreshFirebase(msg.serial, pkg, m);
          readApp(msg.serial, pkg, m);
          if (pkg && !msg.all) {
            sampler = isReplay(msg.serial) ? new ReplayPerf({ model: m.perf }) : ctx.adb ? new PerfSampler({ adb: ctx.adb, serial: msg.serial, pkg, model: m.perf }) : null;
            sampler?.start();
          }
        }
        stream = new LogStream({ source, pkg, all: !!msg.all, onEntry: (e) => { m?.ingest(e); rec?.write(e); } });
        stream.on('batch', (entries) => out({ type: 'log.batch', streamId, entries, rate: stream?.rate() ?? 0 }));
        stream.on('state', (st) => out({ type: 'stream.state', streamId, ...st }));
        stream.start();
        let tick = 0;
        let lastInfo = '';
        ticker = setInterval(() => {
          tick++;
          if (m && (m.dirty || tick % 2 === 0)) out({ type: 'monitor', streamId, ...m.snapshot() });
          if (m && sampler && tick % 2 === 0) {
            // Also sent when only the sampler's state changed ("game not running", an adb error),
            // so the page can say so instead of waiting for a first sample that isn't coming.
            const d = m.perf.delta();
            const info = JSON.stringify(m.perf.info);
            if (d.samples.length || d.reset || info !== lastInfo) {
              lastInfo = info;
              out({ type: 'perf', streamId, ...d, summary: m.perf.summary() });
            }
          }
        }, 500);
        out({ type: 'session', streamId, id: rec?.id ?? null });
      } else if (msg.type === 'stream.stop') {
        stopStream();
      } else if (msg.type === 'firebase.refresh' && monitor) {
        refreshFirebase(msg.serial, monitor.pkg, monitor);
      } else if (msg.type === 'run.start' && monitor) {
        try { monitor.startRun(msg.file); } catch (err) { out({ type: 'error', message: err.message }); }
      } else if (msg.type === 'run.finish' && monitor) {
        try { out({ type: 'run.report', ...monitor.finishRun() }); } catch (err) { out({ type: 'error', message: err.message }); }
      } else if (msg.type === 'rules.reload' && monitor) {
        monitor.loadRules();
      }
    });
    ws.on('close', () => { clients.delete(ws); stopStream(); });
  });

  return {
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => new Promise((resolve) => { for (const ws of clients) ws.terminate(); wss.close(); server.close(resolve); }),
    server,
  };
}
