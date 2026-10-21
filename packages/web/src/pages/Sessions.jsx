import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, clock } from '../state.jsx';
import { PageHead } from '../components/bits.jsx';
import { StateBadge } from '../components/StateBadge.jsx';
import { SessionHistory } from '../components/SessionHistory.jsx';

export function Sessions() {
  return <main className="main"><PageHead title="Session history" sub="Saved captures stay separate from the live session." /><SessionHistory filterable /></main>;
}
export function SavedSession() {
  const { archivedId, setView, archiveReturn } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('firebase');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(500);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api(`sessions/${encodeURIComponent(archivedId)}`).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [archivedId]);
  const events = data?.snapshot?.firebase?.rows ?? [];
  const logs = (data?.entries ?? []).filter((e) => !search || `${e.tag} ${e.message} ${(e.more || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="main">
    <PageHead title={data?.session.name || 'Saved session'} sub={data ? `${data.session.gameName ? data.session.gameName + ' · ' : ''}${data.session.pkg || 'All apps'}${data.session.versionName ? ' · v' + data.session.versionName : ''} · ${new Date(data.session.startedAt).toLocaleString()} · saved capture` : 'Loading capture…'}>
      <button className="btn" onClick={() => setView(archiveReturn)}>Back to sessions</button>
    </PageHead>
    <div className="card" style={{ padding: '14px 20px', fontSize: 14 }}>You are reviewing a saved capture. New live events do not get added to this view.</div>
    {error && <div role="alert" className="card empty">{error}</div>}
    {data && <>
      <div className="seg" role="group" aria-label="Saved capture views">
        {[['firebase', `Firebase events (${events.length})`], ['logs', `Logs (${data.entries.length})`], ['ads', 'Ad state']].map(([id, title]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}
      </div>
      {tab === 'firebase' && <div className="card" style={{ overflow: 'hidden' }}>
        {!events.length && <div className="empty">No Firebase events in this capture.</div>}
        {events.map((e) => <div key={e.id} style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)' }}>
          <span className="mono dim" style={{ fontSize: 12.5, marginRight: 14 }}>{clock(e.ts, false)}</span><strong>{e.name}</strong><span className="tag tag-plain" style={{ marginLeft: 14 }}>{e.check}</span>
          <div className="mono mute" style={{ fontSize: 12.5, marginTop: 8, overflowWrap: 'anywhere' }}>{JSON.stringify(e.params)}</div>
        </div>)}
      </div>}
      {tab === 'logs' && <>
        <input className="field" placeholder="Search saved logs" aria-label="Search saved logs" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(500); }} />
        <div className="card" style={{ overflow: 'hidden' }}>{logs.slice(0, limit).map((e, i) => <pre className="saved-log" key={i}>{clock(e.ts)} {e.level} {e.tag}: {e.message}{e.more?.length ? '\n' + e.more.join('\n') : ''}</pre>)}{!logs.length && <div className="empty">No matching lines.</div>}</div>
        {logs.length > limit && <button className="btn" onClick={() => setLimit(limit + 500)}>Show more lines</button>}
      </>}
      {tab === 'ads' && <div className="card" style={{ padding: 20 }}>
        {(data.snapshot?.health?.funnels ?? []).map((f) => <div className="kv" key={f.key}><strong>{f.name}</strong><span>{f.loaded} loaded · {f.shown || f.displayed} shown · <StateBadge state={f.state} /></span></div>)}
        {!data.snapshot?.health?.funnels?.length && <div className="empty">No ad activity in this capture.</div>}
      </div>}
    </>}
  </main>;
}
