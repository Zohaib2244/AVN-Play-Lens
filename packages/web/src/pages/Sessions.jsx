import { useEffect, useState } from 'react';
import { Button, Drawer, ErrorPanel, PageSkeleton, Segmented, Tag } from '@avn/ui';
import { api } from '../api.js';
import { useApp, clock } from '../state.jsx';
import { PageHead } from '../components/bits.jsx';
import { StateBadge } from '../components/StateBadge.jsx';
import { SessionHistory } from '../components/SessionHistory.jsx';
import { FirebaseEvents } from '../components/FirebaseEvents.jsx';

export function Sessions() {
  return <main className="content"><PageHead title="Saved sessions" sub="Review and export captures from your game workspaces." /><SessionHistory filterable /></main>;
}
export function SavedSession() {
  const { archivedId, setView, archiveReturn } = useApp();
  const [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState('firebase'), [search, setSearch] = useState(''), [limit, setLimit] = useState(500), [entry, setEntry] = useState(null);
  useEffect(() => {
    let alive = true; setError('');
    api(`sessions/${encodeURIComponent(archivedId)}`).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [archivedId, retry]);
  const events = data?.snapshot?.firebase?.rows ?? [];
  const logs = (data?.entries ?? []).filter((e) => !search || `${e.tag} ${e.message} ${(e.more || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="content">
    <PageHead title={data?.session.name || 'Saved session'} sub={data ? `${data.session.gameName || data.session.pkg || 'Capture'} · ${new Date(data.session.startedAt).toLocaleString()}` : 'Loading saved capture…'}><Button onClick={() => setView(archiveReturn)}>Back to sessions</Button></PageHead>
    <div className="panel"><div className="status-strip"><Tag kind="plain">Saved capture</Tag><span className="muted">Live events are paused while you review this session.</span></div></div>
    {error && <ErrorPanel title="Could not open this capture" message={error} onRetry={() => setRetry((r) => r + 1)} onBack={() => setView(archiveReturn)} backLabel="Back to sessions" />}
    {!data && !error && <PageSkeleton kpis={0} rows={6} />}
    {data && <><div className="filters"><Segmented label="Saved capture views" value={tab} onChange={setTab} options={[{ value: 'firebase', label: `Firebase events (${events.length})` }, { value: 'logs', label: `Logs (${data.entries.length})` }, { value: 'ads', label: 'Ad state' }]} /></div>
      {tab === 'firebase' && <FirebaseEvents firebase={data.snapshot?.firebase ?? { rows: [] }} />}
      {tab === 'logs' && <><div className="filters"><input className="input" placeholder="Search saved logs…" aria-label="Search saved logs" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(500); }} />{search && <Button variant="ghost" onClick={() => setSearch('')}>Clear search</Button>}</div><div className="panel t-wrap"><table className="t"><thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead><tbody>{logs.slice(0, limit).map((e, i) => <tr key={i}><td className="mono pl-nowrap">{clock(e.ts)}</td><td><Tag kind={['E', 'F'].includes(e.level) ? 'bad' : e.level === 'W' ? 'warn' : 'plain'}>{e.level}</Tag></td><td><button className="pl-row-link mono pl-log-message" onClick={() => setEntry(e)}>{e.message}</button></td></tr>)}</tbody></table>{!logs.length && <div className="empty">No matching lines.</div>}</div>{logs.length > limit && <Button onClick={() => setLimit(limit + 500)}>Show more lines</Button>}</>}
      {tab === 'ads' && <div className="panel t-wrap"><table className="t"><thead><tr><th>Ad format</th><th className="num">Loaded</th><th className="num">Shown</th><th>State</th></tr></thead><tbody>{(data.snapshot?.health?.funnels ?? []).map((f) => <tr key={f.key}><th>{f.name}</th><td className="num mono">{f.loaded}</td><td className="num mono">{f.shown || f.displayed}</td><td><StateBadge state={f.state} /></td></tr>)}</tbody></table>{!data.snapshot?.health?.funnels?.length && <div className="empty">No ad activity in this capture.</div>}</div>}
    </>}
    <Drawer open={!!entry} onClose={() => setEntry(null)} title={entry?.tag || 'Log entry'} subtitle={entry ? clock(entry.ts) : undefined}>{entry && <pre className="pl-trace">{[entry.message, ...(entry.more || [])].join('\n')}</pre>}</Drawer>
  </main>;
}
