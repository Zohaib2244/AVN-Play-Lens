import { useState } from 'react';
import { clock } from '../state.jsx';

export function RemoteConfigTable({ rc, showInLogs }) {
  const [search, setSearch] = useState('');
  // One row per key. Expanding an array should not add hundreds of duplicate rows.
  const variables = (rc?.values ?? rc?.variables ?? []).filter((v) => !v.parent).map((v) => ({
    ...v, source: v.source || (v.from === 'cache' ? 'Cache' : rc?.sources?.[v.name]) || 'Unknown',
  }));
  const rows = variables.filter((v) => !search || `${v.name} ${v.type} ${v.source}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel" style={{ overflow: 'hidden', minWidth: 0 }} aria-label="Firebase Remote Config variables">
    <div className="ph report-heading">
      <div><h2>Config values</h2><p className="mute">{rc?.fetch ? `Fetch: ${rc.fetch.lastFetchStatus || 'reported'}${rc.fetch.ts ? ` · ${clock(rc.fetch.ts, false)}` : ''}` : 'Waiting for a fetch'} · {variables.filter((v) => v.hasValue).length} keys logged</p></div>
      <input className="input" aria-label="Filter Remote Config variables" placeholder="Filter variables…" value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
    <div className="t-wrap"><table className="t verification-table"><thead><tr><th>Variable / field</th><th>Value</th><th>Data type</th><th>Source</th><th>Time / evidence</th></tr></thead>
      <tbody>{rows.map((v) => <tr key={v.name}>
        <td className="mono" style={{ paddingLeft: v.parent ? 28 : undefined }}>{v.name}</td>
        <td className="mono rc-value">{!v.hasValue ? <span className="dim">Waiting for a value</span> : v.value !== null && typeof v.value === 'object' ? <details><summary>{Array.isArray(v.value) ? `${v.value.length} items` : `${Object.keys(v.value).length} fields`}</summary><pre>{JSON.stringify(v.value, null, 2)}</pre></details> : String(v.value ?? '').length > 160 ? <details><summary>{String(v.value).slice(0, 120)}…</summary><pre>{String(v.value)}</pre></details> : String(v.value)}{v.truncated && <div className="tag tag-warn">Value incomplete in game log</div>}</td>
        <td><span className="tag tag-plain">{v.type || 'unknown'}</span>{v.declaredType && <div className="dim" style={{ marginTop: 5 }}>Registered: {v.declaredType}</div>}</td>
        <td><span className={`tag ${v.source === 'Remote' ? 'tag-ok' : 'tag-plain'}`}>{v.source}</span>{v.from && <div className="dim" style={{ marginTop: 5 }}>{v.from}</div>}</td>
        <td>{v.ts ? clock(v.ts, false) : '—'}{v.entryId && showInLogs && <button className="linkish" style={{ display: 'block', marginTop: 5 }} onClick={() => showInLogs(v.entryId)}>Log line</button>}</td>
      </tr>)}</tbody></table></div>
    {!rows.length && <div className="empty">{variables.length ? 'No matching variables.' : 'No values logged yet. Fetch Remote Config or restart the game while capturing logs.'}</div>}
    <p className="dim" style={{ padding: '0 22px 16px', fontSize: 13 }}>Expand a value to inspect its fields or level list. Values cut short by the game are marked incomplete.</p>
  </section>;
}
