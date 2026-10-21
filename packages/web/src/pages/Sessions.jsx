import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, clock } from '../state.jsx';
import { PageHead } from '../components/bits.jsx';
import { StateBadge } from '../components/StateBadge.jsx';
import { SessionHistory } from '../components/SessionHistory.jsx';

export function Sessions() {
  return <main className="main"><PageHead title="History" sub="Saved sessions for every game" /><SessionHistory filterable /></main>;
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
    <PageHead title={data?.session.name || 'Saved session'} sub={data ? `${data.session.gameName ? data.session.gameName + ' · ' : ''}${data.session.versionName ? 'v' + data.session.versionName + ' · ' : ''}${new Date(data.session.startedAt).toLocaleString()} · saved, read-only` : 'Loading session…'}>
      <button className="btn" onClick={() => setView(archiveReturn)}>Back to history</button>
    </PageHead>
    {error && <div role="alert" className="card empty">{error}</div>}
    {data && <>
      <div className="seg" role="group" aria-label="Saved session views">
        {[['firebase', `Events (${events.length})`], ['logs', `Logs (${data.entries.length})`], ['ads', 'Ads']].map(([id, title]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{title}</button>)}
      </div>
      {tab === 'firebase' && <div className="card" style={{ overflow: 'hidden' }}>
        {!events.length && <div className="empty">No events in this session.</div>}
        {events.map((e) => <div key={e.id} style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)' }}>
          <span className="mono dim" style={{ fontSize: 12, marginRight: 14 }}>{clock(e.ts, false)}</span><strong>{e.name}</strong><span className="tag tag-plain" style={{ marginLeft: 14 }}>{e.check}</span>
          <div className="mono mute" style={{ fontSize: 12, marginTop: 8, overflowWrap: 'anywhere' }}>{JSON.stringify(e.params)}</div>
        </div>)}
      </div>}
      {tab === 'logs' && <>
        <input className="field" placeholder="Search saved logs" aria-label="Search saved logs" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(500); }} />
        <div className="card" style={{ overflow: 'hidden' }}>{logs.slice(0, limit).map((e, i) => <pre className="saved-log" key={i}>{clock(e.ts)} {e.level} {e.tag}: {e.message}{e.more?.length ? '\n' + e.more.join('\n') : ''}</pre>)}{!logs.length && <div className="empty">No matching lines.</div>}</div>
        {logs.length > limit && <button className="btn" onClick={() => setLimit(limit + 500)}>Show more lines</button>}
      </>}
      {tab === 'ads' && <div className="card" style={{ padding: 20 }}>
        {(data.snapshot?.health?.funnels ?? []).map((f) => <div className="kv" key={f.key}><strong>{f.name}</strong><span>{f.loaded} loaded · {f.shown || f.displayed} shown · <StateBadge state={f.state} /></span></div>)}
        {!data.snapshot?.health?.funnels?.length && <div className="empty">No ad activity in this session.</div>}
      </div>}
    </>}
  </main>;
}
