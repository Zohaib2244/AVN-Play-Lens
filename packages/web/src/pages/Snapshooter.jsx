import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp, deviceName } from '../state.jsx';
import { PageHead, Icon } from '../components/bits.jsx';

const validLevel = (s) => /^(0|[1-9]\d{0,8})$/.test(s);
const bytes = (n) => n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function SnapshotPreview({ snapshot, path, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className="snapshot-preview" onCancel={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={`Level ${snapshot.level} preview`}>
    <div className="snapshot-preview-head"><strong className="px">Level {snapshot.level}</strong><a className="btn btn-sm" href={`${path}/${snapshot.name}?download=1`}>Download {snapshot.name}</a><button className="btn btn-sm" onClick={onClose} autoFocus>Close</button></div>
    <img src={`${path}/${snapshot.name}?v=${snapshot.capturedAt}`} alt={`Level ${snapshot.level} screenshot`} />
  </dialog>;
}

export function Snapshooter() {
  const { pkg, game, serial, device, online, stopped, stream, monitor, gameInventory, setView, setStopped, showToast } = useApp();
  const endpoint = `snapshots/${encodeURIComponent(pkg)}`;
  const path = `/api/${endpoint}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [delay, setDelay] = useState('1000');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const request = useRef(0);
  const initial = useRef(true);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await api(endpoint);
      if (id !== request.current) return;
      setData(next); setError('');
      if (initial.current) { setDelay(String(next.capture.delayMs)); initial.current = false; }
    } catch (e) { if (id === request.current) setError(e.message); }
  }, [endpoint]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => { clearInterval(timer); request.current++; };
  }, [load]);

  const capture = data?.capture;
  const snapshots = data?.snapshots ?? [];
  const visible = snapshots.filter((s) => String(s.level).includes(query.trim()));
  const selectedLevels = snapshots.filter((s) => selected.has(s.level)).map((s) => s.level);
  const installed = gameInventory.serial === serial && gameInventory.games.some((g) => g.packageId === pkg && g.installed);
  const canCapture = online && device?.state === 'device' && !device.replay && installed;
  const currentLevel = monitor?.health?.levels?.current;
  const activeHere = capture?.enabled && capture.serial === serial;
  const delayValid = /^\d+$/.test(delay) && Number(delay) <= 10000;
  const run = async (name, action) => {
    if (busy) return;
    setBusy(name); setActionError('');
    try { await action(); await load(); }
    catch (e) { setActionError(e.message); }
    finally { setBusy(''); }
  };
  const configure = (enabled) => run('settings', async () => {
    await api(`${endpoint}/settings`, { method: 'POST', body: { enabled, serial, delayMs: delayValid ? Number(delay) : capture?.delayMs ?? 1000 } });
  });
  const downloadZip = (levels) => run('zip', async () => {
    const res = await fetch(`${path}/download.zip${levels ? `?levels=${levels.join(',')}` : ''}`);
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Could not download ZIP'); }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `${pkg}-levels.zip`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const toggle = (n) => setSelected((old) => { const next = new Set(old); if (next.has(n)) next.delete(n); else next.add(n); return next; });

  return <main className="main snapshot-page">
    <PageHead title="Level Snapshooter" sub={`${game?.name ?? 'Game'} · A screenshot library for every level.`}><span className="tag tag-plain">Saved on this computer</span></PageHead>
    <section className="card snapshot-controls" aria-label="Screenshot controls">
      <div className="snapshot-control-title"><span className="snapshot-camera"><Icon.camera width="28" height="28" /></span><div><h2 className="px">Capture as you play</h2><p className="mute">Play through the game. Each new detected level gets its own PNG, saved directly to PlayLens.</p></div><span className={`tag ${activeHere && capture?.watching && !stopped ? 'tag-ok' : 'tag-plain'}`} role="status">{!capture?.enabled ? 'Auto capture off' : !activeHere ? 'Armed on another phone' : stopped || !capture.watching ? 'Waiting for tracking' : capture.pendingLevel != null ? `Capturing level ${capture.pendingLevel}` : 'Auto capture on'}</span></div>
      <div className="snapshot-control-row">
        <label className="snapshot-field">Capture delay (ms)<input className="field" type="number" min="0" max="10000" step="100" value={delay} onChange={(e) => setDelay(e.target.value)} /></label>
        <button className="btn btn-warm" disabled={!data || !!busy || !canCapture || !delayValid || stopped || stream.state !== 'live'} onClick={() => configure(true)}>{busy === 'settings' ? 'Saving…' : activeHere ? 'Apply delay' : capture?.enabled ? 'Use selected phone' : 'Start auto capture'}</button>
        {capture?.enabled && <button className="btn" disabled={!!busy} onClick={() => configure(false)}>Stop auto capture</button>}
        <span className="mute snapshot-device">{deviceName(device)}{currentLevel != null ? ` · Level ${currentLevel}` : ' · Waiting for a level number'}</span>
      </div>
      <p className="dim snapshot-hint">Automatic capture keeps the first saved image for each level. The delay lets loading animations finish. Keep the game in the foreground; collection pauses when you leave its workspace.</p>
      {stopped && <p className="snapshot-notice">Tracking is stopped. <button className="linkish" onClick={() => setStopped(false)}>Resume tracking</button> to capture levels automatically.</p>}
      {device?.replay && <p className="snapshot-notice">Replay logs cannot capture a phone screen. Connect a real phone to take screenshots.</p>}
      {!device && <p className="snapshot-notice">Your saved gallery is available offline. <button className="linkish" onClick={() => setView('devices')}>Connect a phone</button> to capture more levels.</p>}
      {device && !device.replay && !installed && <p className="snapshot-notice">Install this game on the selected phone to capture levels.</p>}
      {currentLevel == null && <details className="snapshot-help"><summary>How are level numbers detected?</summary><p>Uses Firebase event parameters named level, level_number, levelnumber, level_num, current_level or lvl. For a different event or a Unity log line, add a level setting to this game’s rules file from Checklist setup.</p><pre>{"level: { event: LEVEL_ANALYSIS, param: Started }\n# Or match a Unity log line, with the number in group 1:\nlevel: { log: 'Level (\\d+) loaded' }"}</pre><p>Enable Firebase debug mode from Firebase events if your level events are not appearing. You can also enter the level number below.</p></details>}
      <form className="snapshot-manual" onSubmit={(e) => { e.preventDefault(); if (canCapture && validLevel(level)) run('capture', async () => {
        const result = await api(`${endpoint}/capture`, { method: 'POST', body: { serial, level: Number(level) } });
        showToast({ title: `Saved ${result.snapshot.name}`, msg: 'Available in this game’s gallery on this computer.' });
      }); }}>
        <label className="snapshot-field">Level number<input className="field" type="number" min="0" max="999999999" step="1" placeholder={currentLevel == null ? 'e.g. 12' : String(currentLevel)} value={level} onChange={(e) => setLevel(e.target.value)} required /></label>
        <button className="btn" type="submit" disabled={!canCapture || !validLevel(level) || !!busy || capture?.busy}>{busy === 'capture' ? 'Capturing…' : snapshots.some((s) => s.level === Number(level)) && level !== '' ? `Retake ${level}.png` : 'Capture now'}</button>
        {currentLevel != null && <button className="linkish" type="button" onClick={() => setLevel(String(currentLevel))}>Use current level</button>}
        <span className="dim">Manual captures replace an existing image for that level.</span>
      </form>
      {capture?.error && <p className="snapshot-error" role="alert">{capture.error} Use Capture now to retry.</p>}
      {actionError && <p className="snapshot-error" role="alert">{actionError}</p>}
    </section>
    <section aria-label="Level gallery">
      <div className="snapshot-gallery-heading"><div><span className="eyebrow">LEVEL GALLERY</span><h2 className="px">{snapshots.length} {snapshots.length === 1 ? 'level' : 'levels'} captured <span className="dim">/ {bytes(snapshots.reduce((n, s) => n + s.bytes, 0))}</span></h2></div><div className="history-actions"><button className="btn" disabled={!snapshots.length || !!busy} onClick={() => downloadZip(null)}>{busy === 'zip' ? 'Preparing ZIP…' : 'Download all as ZIP'}</button><button className="btn" disabled={!selectedLevels.length || !!busy} onClick={() => downloadZip(selectedLevels)}>Download selected ({selectedLevels.length})</button></div></div>
      <div className="snapshot-toolbar"><label className="snapshot-search"><Icon.search /><input className="field" type="search" aria-label="Find a level" placeholder="Find a level number…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button className="linkish" disabled={!visible.length} onClick={() => setSelected(new Set(visible.map((s) => s.level)))}>Select {query ? 'matching' : 'all'}</button><button className="linkish" disabled={!selectedLevels.length} onClick={() => setSelected(new Set())}>Clear selection</button><span className="dim">PNG files named by level · sorted numerically</span></div>
      {error && <p className="snapshot-error" role="alert">{error} <button className="linkish" onClick={load}>Retry</button></p>}
      {!data && !error ? <div className="card empty" role="status">Loading level gallery…</div> : !snapshots.length ? <div className="card snapshot-empty"><Icon.camera width="42" height="42" /><h3 className="px">Your levels, frame by frame.</h3><p className="mute">Start auto capture and play through the levels, or take your first screenshot with Capture now.</p><p className="dim">Images stay in PlayLens on this computer. Download a ZIP when you’re ready to share.</p></div> : !visible.length ? <div className="card empty">No levels match “{query}”.</div> : <div className="snapshot-grid">{visible.map((s) => <article className={`card snapshot-card${selected.has(s.level) ? ' selected' : ''}`} key={s.level}>
        <div className="snapshot-card-top"><label><input type="checkbox" checked={selected.has(s.level)} onChange={() => toggle(s.level)} aria-label={`Select level ${s.level}`} />Level {s.level}</label><span className="mono dim">{s.name}</span></div>
        <button className="snapshot-image" onClick={() => setPreview(s)} aria-label={`Preview level ${s.level}`}><img loading="lazy" src={`${path}/${s.name}?v=${s.capturedAt}`} alt={`Level ${s.level}`} /><span>View full size</span></button>
        <div className="snapshot-card-bottom"><span className="dim" title={new Date(s.capturedAt).toLocaleString()}>{bytes(s.bytes)} · {new Date(s.capturedAt).toLocaleDateString()}</span><a className="linkish" href={`${path}/${s.name}?download=1`}>Download</a></div>
      </article>)}</div>}
    </section>
    {preview && <SnapshotPreview snapshot={preview} path={path} onClose={() => setPreview(null)} />}
  </main>;
}
