import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';

export function SessionHistory({ limit = null, groupByGame = true, filterable = false, packageFilter = undefined }) {
  const { online, historyVersion, setHistoryVersion, reviewSession, games, historyGame, setHistoryGame, viewGameSessions } = useApp();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) return;
    let alive = true;
    const load = () => api('sessions').then((list) => { if (alive) { setSessions(list); setError(''); } }).catch((e) => { if (alive) setError(e.message); });
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [online, historyVersion]);
  const remove = async (s) => {
    setBusy(true);
    try {
      await api(`sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      setSessions((list) => list.filter((x) => x.id !== s.id));
      setDeleting(null);
      setHistoryVersion((v) => v + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const scoped = packageFilter === undefined ? sessions : sessions.filter((s) => s.pkg === packageFilter);
  const filtered = filterable && historyGame !== '__all' ? scoped.filter((s) => (s.pkg || '__device') === historyGame) : scoped;
  const packages = [...new Set([...games.map((g) => g.packageId), ...sessions.map((s) => s.pkg || '__device')])];
  const gameName = (p) => games.find((g) => g.packageId === p)?.name || sessions.find((s) => s.pkg === p)?.gameName || (p === '__device' ? 'Device-wide captures' : p);
  const groups = new Map();
  for (const s of filtered) {
    const key = groupByGame ? s.pkg || '__device' : '__all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return <section aria-label="Saved sessions">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 14 }}>
      <h2 className="px" style={{ margin: 0, fontSize: 24 }}>Saved sessions</h2>
      {limit && <button className="linkish" onClick={() => viewGameSessions(packageFilter || '__all')}>View all sessions</button>}
    </div>
    <p className="dim" style={{ fontSize: 13.5 }}>Review each capture's logs and Firebase events separately. Delete removes the saved capture from this computer.</p>
    {filterable && <label className="history-actions" style={{ marginBottom: 20 }}>Game<select className="select" aria-label="Filter sessions by game" value={historyGame} onChange={(e) => setHistoryGame(e.target.value)}><option value="__all">All games</option>{packages.map((p) => <option key={p} value={p}>{gameName(p)}</option>)}</select></label>}
    {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
    {!filtered.length && <div className="card empty">No saved sessions yet. Use Save session to keep a capture, even a short one.</div>}
    {[...groups].map(([packageId, captures]) => <div className="game-session-group" key={packageId}>
      {groupByGame && <div className="library-heading"><div><h3 style={{ margin: 0 }}>{gameName(packageId)}</h3>{packageId !== '__device' && <div className="mono dim" style={{ fontSize: 12, marginTop: 5 }}>{packageId}</div>}</div><span className="tag tag-plain">{captures.length} session{captures.length === 1 ? '' : 's'}</span></div>}
      {(limit ? captures.slice(0, limit) : captures).map((s) => <div className="history-row" key={s.id}>
      <div className="history-name">
        <strong>{s.name || 'Earlier session'}</strong><span className="dim" style={{ marginLeft: 12, fontSize: 13 }}>{new Date(s.startedAt).toLocaleString()}</span>
        <div className="mute" style={{ fontSize: 13.5, marginTop: 5 }}>{s.pkg || 'All apps'} · {s.device} · {s.lines.toLocaleString()} lines{s.versionName ? ` · v${s.versionName}${s.versionCode != null ? ` (${s.versionCode})` : ''}` : ''}{s.active ? s.paused ? ' · paused' : ' · recording' : ''}</div>
      </div>
      <div className="history-actions">
        <button className="btn btn-sm" onClick={() => reviewSession(s.id)}>Review</button>
        <a className="linkish" href={`/api/sessions/${s.id}.txt`} download>Export log</a>
        <button className="linkish" disabled={s.active || busy} title={s.active ? 'Discard the active session using New session / clear' : undefined} onClick={() => setDeleting(s.id)}>Delete</button>
      </div>
      {deleting === s.id && <div style={{ flex: '1 1 100%', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Delete {s.name || 'this saved session'} and its logs?</span>
        <button className="btn btn-sm" disabled={busy} onClick={() => remove(s)}>Delete session</button>
        <button className="linkish" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
      </div>}
    </div>)}
    {limit && captures.length > limit && <button className="linkish" onClick={() => viewGameSessions(packageFilter || packageId)}>View all sessions for this game</button>}
    </div>)}
  </section>;
}
