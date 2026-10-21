import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Menu } from './ui.jsx';

export function SessionHistory({ groupByGame = true, filterable = false, packageFilter = undefined }) {
  const { online, historyVersion, setHistoryVersion, reviewSession, games, historyGame, setHistoryGame } = useApp();
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
  const gameName = (p) => games.find((g) => g.packageId === p)?.name || sessions.find((s) => s.pkg === p)?.gameName || (p === '__device' ? 'Device-wide sessions' : p);
  const groups = new Map();
  for (const s of filtered) {
    const key = groupByGame ? s.pkg || '__device' : '__all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return <section aria-label="Saved sessions">
    {filterable && <label className="history-actions" style={{ marginBottom: 20 }}>Game<select className="select" aria-label="Filter sessions by game" value={historyGame} onChange={(e) => setHistoryGame(e.target.value)}><option value="__all">All games</option>{packages.map((p) => <option key={p} value={p}>{gameName(p)}</option>)}</select></label>}
    {error && <p role="alert" className="badc">{error}</p>}
    {!filtered.length && <div className="card empty">No saved sessions yet. Sessions save automatically when you start a new one.</div>}
    {[...groups].map(([packageId, captures]) => <div className="game-session-group" key={packageId}>
      {groupByGame && <div className="library-heading"><h2 className="section-title" style={{ margin: 0 }}>{gameName(packageId)}</h2><span className="dim">{captures.length} session{captures.length === 1 ? '' : 's'}</span></div>}
      <div className="card" style={{ overflow: 'hidden' }}>
        {captures.map((s) => <div className="history-row" key={s.id}>
          <button className="history-open" onClick={() => reviewSession(s.id)} aria-label={`Review ${s.name || 'session'}`}>
            <strong>{s.name || 'Earlier session'}</strong>
            <span className="dim">{new Date(s.startedAt).toLocaleString()}</span>
            <span className="mute history-meta">{s.device} · {s.lines.toLocaleString()} lines{s.versionName ? ` · v${s.versionName}${s.versionCode != null ? ` (${s.versionCode})` : ''}` : ''}{s.active ? s.paused ? ' · paused' : ' · recording' : ''}</span>
          </button>
          <Menu label={`More for ${s.name || 'session'}`} items={[
            { label: 'Export log (.txt)', href: `/api/sessions/${s.id}.txt`, download: true },
            { label: 'Delete…', onClick: () => setDeleting(s.id), danger: true, hidden: s.active },
          ]} />
          {deleting === s.id && <div className="history-confirm">
            <span>Delete {s.name || 'this session'} and its logs?</span>
            <button className="btn btn-sm" disabled={busy} onClick={() => remove(s)}>Delete session</button>
            <button className="linkish" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
          </div>}
        </div>)}
      </div>
    </div>)}
  </section>;
}
