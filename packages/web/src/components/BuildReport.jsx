import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Spinner } from './ui.jsx';

const LABELS = { verified: ['Verified', 'tag-ok'], matched: ['Matches installed build', 'tag-plain'], pending: ['Not verified', 'tag-plain'], problem: ['Problem', 'tag-bad'], manual: ['Manual check', 'tag-warn'], 'not-applicable': ['Not enabled', 'tag-plain'] };

export function useBuildReport(pkg, monitor) {
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    let alive = true;
    setSaved(null);
    if (pkg) api(`build-reports/${encodeURIComponent(pkg)}`).then((r) => { if (alive) setSaved(r.report); }).catch(() => {});
    return () => { alive = false; };
  }, [pkg]);
  useEffect(() => { if (monitor?.buildReport?.packageId === pkg) setSaved(monitor.buildReport); }, [monitor?.buildReport?.id, pkg]);
  const report = saved?.packageId === pkg ? saved : null;
  const app = monitor?.app;
  const matches = !!report && !!app?.versionName && app.versionCode != null && report.packageId === pkg && report.versionName === app.versionName && String(report.versionCode) === String(app.versionCode);
  return { report, setReport: setSaved, matches, reason: !report ? 'Upload the publishing report for this build.' : !app?.versionName || app.versionCode == null ? 'Start the game session to read the installed build version.' : matches ? `Matches installed v${app.versionName} (${app.versionCode}).` : `Report v${report.versionName} (${report.versionCode}) differs from installed v${app.versionName} (${app.versionCode}).` };
}

export function BuildReportUpload({ pkg, report, matches, reason, onSaved }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(null); setError(''); }, [pkg]);
  const read = async (file) => {
    if (!file) return;
    setError(''); setDraft(null); setBusy('Opening PDF…');
    try { const { readPublishingPdf } = await import('../report-import.mjs'); setDraft(await readPublishingPdf(file, setBusy)); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('Attaching report…'); setError('');
    try {
      if (draft.packageId !== pkg) throw new Error(`This report is for ${draft.packageId}, but the selected game is ${pkg}.`);
      const result = await api('build-reports', { method: 'POST', body: draft });
      onSaved(result.report); setDraft(null);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  return <section className="build-upload" aria-label="Publishing report upload">
    <h2>Publishing report <span className="tag tag-warn">Required</span></h2>
    <p className="mute">Attach the plugin’s PDF for this build. Its For Dev results stay alongside a separate runtime verification column.</p>
    {report && <div className="build-attached"><strong>{report.filename}</strong><span className={`tag ${matches ? 'tag-ok' : 'tag-warn'}`}>{matches ? 'Build matches' : 'Check build'}</span><div className="mono mute">{report.packageId} · v{report.versionName} ({report.versionCode}) · {report.rows.length} For Dev items</div><a className="linkish" href={`/api/build-reports/${report.id}.pdf`}>Download original PDF</a></div>}
    <p className={matches ? 'mute' : 'warn'}>{reason}</p>
    <label className="btn" style={{ alignSelf: 'flex-start' }}>{report ? 'Replace report' : 'Choose publishing PDF'}<input type="file" accept="application/pdf,.pdf" aria-label="Upload publishing PDF" disabled={!!busy} onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} /></label>
    {busy && <div role="status" className="import-progress"><Spinner />{busy}</div>}
    {error && <div role="alert" style={{ color: 'var(--bad)', marginTop: 12 }}>{error}</div>}
    {draft && <div className="import-review">
      <h3>Review imported report</h3>
      <p className="mute">{draft.ocr ? 'This PDF uses images. OCR can misread text; check the identity and all extracted rows against the original before attaching.' : 'Check the detected build identity and extracted rows before attaching.'}</p>
      <div className="build-fields">{[['packageId', 'Package name'], ['versionName', 'Version'], ['versionCode', 'Build number']].map(([key, label]) => <label key={key}>{label}<input className="input" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></label>)}</div>
      <details><summary>Review and correct all {draft.rows.length} For Dev items</summary><div className="table-scroll import-rows"><table className="t verification-table"><thead><tr><th>Section / page</th><th>Item</th><th>Build report result</th></tr></thead><tbody>{draft.rows.map((r, i) => <tr key={i}><td>{r.section} · p{r.page}</td><td><input className="input" aria-label={`Item ${i + 1}`} value={r.label} onChange={(e) => setDraft({ ...draft, rows: draft.rows.map((x, n) => n === i ? { ...x, label: e.target.value } : x) })} /></td><td><input className="input" aria-label={`Result ${i + 1}`} value={r.value} onChange={(e) => setDraft({ ...draft, rows: draft.rows.map((x, n) => n === i ? { ...x, value: e.target.value } : x) })} /></td></tr>)}</tbody></table></div></details>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}><button className="btn btn-warm" disabled={!!busy} onClick={save}>Attach reviewed report</button><button className="btn" disabled={!!busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </div>}
  </section>;
}

export function BuildVerificationTable({ build, showInLogs }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  if (!build) return null;
  const rows = build.rows.filter((r) => (status === 'all' || r.status === status) && (!search || `${r.label} ${r.section} ${r.value}`.toLowerCase().includes(search.toLowerCase())));
  return <section className="panel" style={{ overflow: 'hidden' }} aria-label="For Dev runtime verification">
    {build.simulated && <div className="panel note">Replay / simulated evidence. These results do not verify a real installed build.</div>}
    <div className="ph report-heading"><div><h2>For Dev · runtime verification</h2><p className="mute">{build.filename} · v{build.versionName} ({build.versionCode})</p><p className="mute">{build.rows.filter((r) => r.status === 'verified').length} verified · {build.rows.filter((r) => r.status === 'matched').length} match the installed build · {build.rows.filter((r) => r.status === 'problem').length} problems</p></div><a className="btn btn-sm" href={`/api/build-reports/${build.id}.pdf`}>Original PDF</a></div>
    <div className="filters report-filters"><input className="input" aria-label="Search For Dev items" placeholder="Search For Dev items…" value={search} onChange={(e) => setSearch(e.target.value)} /><select className="input" aria-label="Filter verification status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All results</option>{Object.entries(LABELS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="t-wrap"><table className="t verification-table"><thead><tr><th>For Dev item</th><th>Build report result</th><th>Runtime verification</th><th>Evidence / next step</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.label}</strong><div className="dim">{r.section}{r.page ? ` · p${r.page}` : ''}</div></td><td className="mono">{r.value}</td><td><span className={`tag ${LABELS[r.status]?.[1] || 'tag-plain'}`}>{LABELS[r.status]?.[0] || r.status}</span></td><td>{r.note}{r.evidence && <div className="dim" style={{ marginTop: 8 }}>{new Date(r.evidence.ts).toLocaleTimeString()}{r.evidence.entryId && showInLogs && <> · <button className="linkish" onClick={() => showInLogs(r.evidence.entryId)}>Log line</button></>}</div>}</td></tr>)}</tbody></table></div>
    {!rows.length && <div className="empty">No matching items.</div>}
    <p className="dim" style={{ padding: '0 22px 16px', fontSize: 13 }}>Verified applies to the behavior described in the evidence. Manual and unseen items remain unverified. Build matching uses package, version and build number; use a new build number for each rebuild.</p>
  </section>;
}
