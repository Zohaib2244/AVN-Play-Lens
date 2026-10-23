import { useEffect, useState } from 'react';
import { Button, ConfirmDelete, ErrorPanel, Tag } from '@avn/ui';
import { SkeletonRows } from './ui.jsx';
import { api } from '../api.js';
import { useApp } from '../state.jsx';

export function SessionHistory({ limit = null, groupByGame = true, filterable = false, packageFilter = undefined, compact = false }) {
  const { online, historyVersion, setHistoryVersion, reviewSession, games, historyGame, setHistoryGame } = useApp();
  const [sessions, setSessions] = useState([]), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) return;
    let alive = true;
    const load = () => api('sessions').then((list) => { if (alive) { setSessions(list); setLoaded(true); setError(''); } }).catch((e) => { if (alive) setError(e.message); });
    load(); const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [online, historyVersion]);
  const name = (pkg) => games.find((g) => g.packageId === pkg)?.name || sessions.find((s) => s.pkg === pkg)?.gameName || pkg || 'Device capture';
  const packages = [...new Set([...games.map((g) => g.packageId), ...sessions.map((s) => s.pkg)])];
  const rows = sessions.filter((s) => (packageFilter === undefined || s.pkg === packageFilter) && (!filterable || historyGame === '__all' || (s.pkg || '__device') === historyGame));
  const groups = new Map();
  for (const s of rows) { const key = groupByGame ? s.pkg : '__all'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); }
  const remove = async () => {
    setBusy(true);
    try { await api(`sessions/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }); setSessions((list) => list.filter((s) => s.id !== deleting.id)); setDeleting(null); setHistoryVersion((v) => v + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="pl-session-history" aria-label="Saved sessions">
    {filterable && <div className="filters"><label className="event-filter">Game<select className="select" aria-label="Filter sessions by game" value={historyGame} onChange={(e) => setHistoryGame(e.target.value)}><option value="__all">All games</option>{packages.map((pkg) => <option key={pkg || '__device'} value={pkg || '__device'}>{name(pkg)}</option>)}</select></label><span className="pl-page-note">{rows.length} captures</span>{historyGame !== '__all' && <Button variant="ghost" onClick={() => setHistoryGame('__all')}>Clear filter</Button>}</div>}
    {error && <ErrorPanel title="Could not load saved sessions" message={error} onRetry={() => setHistoryVersion((v) => v + 1)} />}
    {!loaded && !error && <SkeletonRows rows={3} />}
    {loaded && !rows.length && <div className="empty">No saved sessions yet. Save a capture from a game workspace to review it here.</div>}
    {!!rows.length && <div className={compact ? 't-wrap' : 'panel t-wrap'}><table className="t"><thead><tr><th>Capture</th>{!compact && <th>Device</th>}<th>Started</th><th className="num">Lines</th><th aria-label="Actions" /></tr></thead>{[...groups].map(([pkg, captures]) => <tbody key={pkg || '__device'}>{groupByGame && <tr className="pl-table-group"><th colSpan={compact ? 4 : 5}>{name(pkg)} <span className="dim mono">{pkg}</span></th></tr>}{(limit ? captures.slice(0, limit) : captures).map((s) => <tr key={s.id}><td><button className="pl-row-link" onClick={() => reviewSession(s.id)}>{s.name || 'Earlier session'}</button><div className="pl-page-note">{s.versionName ? `v${s.versionName}${s.versionCode != null ? ` · build ${s.versionCode}` : ''}` : name(s.pkg)}{s.active && <> · <Tag kind="info">{s.paused ? 'Paused' : 'Recording'}</Tag></>}</div></td>{!compact && <td>{s.device}</td>}<td className="mono pl-nowrap"><time title={new Date(s.startedAt).toLocaleString()}>{new Date(s.startedAt).toLocaleDateString()} {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></td><td className="num mono">{s.lines.toLocaleString()}</td><td><div className="row-wrap"><Button size="sm" onClick={() => reviewSession(s.id)}>Review</Button><a className="btn ghost sm" href={`/api/sessions/${s.id}.txt`} download>Export</a><Button size="sm" variant="ghost" disabled={s.active || busy} onClick={() => setDeleting(s)}>Delete…</Button></div></td></tr>)}</tbody>)}</table></div>}
    <ConfirmDelete open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} busy={busy} name={deleting?.name || 'saved session'} title="Delete this saved session?" consequences={['Its saved logs, performance samples and analysis snapshot. Other captures stay on this computer.']} confirmLabel="Delete session" />
  </section>;
}
