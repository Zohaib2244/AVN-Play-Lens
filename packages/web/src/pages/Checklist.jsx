import { useEffect, useState } from 'react';
import { useApp, deviceName, clock } from '../state.jsx';
import { api } from '../api.js';
import { Menu, Disclosure, LiveBars, SkeletonRows } from '../components/ui.jsx';
import { PageHead, Check } from '../components/bits.jsx';
import { Stepper } from './Firebase.jsx';
import { BuildReportUpload, BuildVerificationTable, useBuildReport } from '../components/BuildReport.jsx';
import { RemoteConfigTable } from '../components/RemoteConfigTable.jsx';

const SEVERITY_TAG = { critical: 'tag-bad', warning: 'tag-warn', info: 'tag-plain' };

function useClock(startedAt, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!startedAt) return '00:00';
  const s = Math.max(0, Math.floor(((active ? now : startedAt) - startedAt) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function useRules() {
  const [rules, setRules] = useState(null);
  const load = () => api('rules').then(setRules).catch(() => setRules({ files: [], presets: [], dir: '' }));
  useEffect(() => { load(); }, []);
  return [rules, load];
}

export function ChecklistSetup() {
  const { pkg, monitor, send, setView, showToast } = useApp();
  const [rules, reload] = useRules();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const run = monitor?.run;
  const build = useBuildReport(pkg, monitor);
  const [starting, setStarting] = useState(null);
  useEffect(() => { if (starting != null && run?.active && run.startedAt > starting) { setStep(3); setStarting(null); } }, [run?.startedAt, run?.active, starting]);
  const elapsed = useClock(run?.startedAt, !!run?.active);

  useEffect(() => {
    if (!rules || file) return;
    const mine = rules.files.find((f) => f.game === pkg) ?? null;
    setFile(mine?.file ?? rules.files[0]?.file ?? null);
  }, [rules, pkg, file]);

  const create = async () => {
    try {
      const r = await api('rules/new', { method: 'POST', body: { pkg } });
      await reload();
      setFile(r.file);
      send({ type: 'rules.reload' });
    } catch (e) {
      showToast({ title: 'Could not create the rules file', msg: e.message });
    }
  };
  const chosen = rules?.files.find((f) => f.file === file);
  const hasOwn = rules?.files.some((f) => f.game === pkg);
  const start = () => {
    setStarting(run?.startedAt || 0);
    send({ type: 'run.start', file });
  };
  const items = run?.items ?? [];
  const ok = items.filter((i) => i.status === 'ok').length;

  return (
    <main className="main" style={{ alignItems: 'center', paddingTop: 52 }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px 16px' }}>
          <span className="eyebrow">Checklist · setup</span>
          {run && <button className="linkish" onClick={() => setView('checklist')}>Run already going? Open the checklist</button>}
        </div>
        <h1 className="setup-title">Set up a test run</h1>
        <p className="mute" style={{ margin: '0 0 34px', fontSize: 16, lineHeight: 1.6, maxWidth: 600 }}>Attach the publishing report for {pkg}, choose its rules, then play to verify the build.</p>
        <Stepper step={step} labels={['Report & rules', 'Start run', 'Play']} />

        <div className="card setup-card">
          {step === 1 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <BuildReportUpload pkg={pkg} report={build.report} matches={build.matches} reason={build.reason} onSaved={build.setReport} />
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Choose the rules for this game</h2>
              <p className="mute" style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.6 }}>A rules file lists the events you expect and extra log lines to flag. Edit it in any editor; the checklist updates when you save.</p>
              {!rules && <SkeletonRows rows={3} />}
              {rules?.files.map((f) => (
                <button key={f.file} className="ropt" aria-pressed={file === f.file} onClick={() => setFile(f.file)}>
                  <span className="radio"><i /></span>
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span className="mono" style={{ display: 'block', fontSize: 14 }}>{f.file}</span>
                    <span style={{ display: 'block', fontSize: 13, color: f.error ? 'var(--bad)' : 'var(--mute)', marginTop: 3 }}>
                      {f.error ? `Can't read it: ${f.error}` : `${f.expect} expected events · ${f.watch} flag rules${f.presets.length ? ` · presets: ${f.presets.join(', ')}` : ''}`}
                    </span>
                  </span>
                </button>
              ))}
              {rules && !hasOwn && (
                <button className="ropt" onClick={create}>
                  <span className="radio" style={{ borderStyle: 'dashed' }} />
                  <span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>Create a rules file for {pkg}</span>
                    <span className="mute" style={{ display: 'block', fontSize: 13, marginTop: 3 }}>Starts with level_start, level_complete and the startup and remote-config checks</span>
                  </span>
                </button>
              )}
              {rules?.dir && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 12, fontSize: 13 }} className="dim">
                  <span>Rules live in <span className="mono mute">{rules.dir}</span></span>
                  <button className="linkish" onClick={() => api('rules/reveal', { method: 'POST' })}>Open folder</button>
                </div>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Start the run</h2>
              <p className="mute" style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.6 }}>Starting clears the checklist and checks everything from now until you finish. The game keeps running.</p>
              {chosen && (
                <div className="mute" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
                  <div><span className="mono" style={{ color: 'var(--text)' }}>{chosen.file}</span></div>
                  <div>{chosen.expect} expected events, {chosen.watch} flag rules{chosen.presets.length ? `, plugin checks: ${chosen.presets.join(', ')}` : ''}</div>
                </div>
              )}
              {!monitor?.firebase?.debug?.on && (
                <div style={{ marginTop: 16, background: 'var(--warn-soft)', color: 'var(--warn)', borderRadius: 12, padding: '12px 14px', fontSize: 14, lineHeight: 1.5 }}>
                  Firebase debug mode is off, so events can't be checked. <button className="linkish" onClick={() => setView('firebase-setup')}>Set up Firebase first</button>
                </div>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 22 }}>
                <p className={build.matches ? 'mute' : 'warn'}>{build.reason}</p>
                <button className="btn btn-warm" style={{ height: 44 }} onClick={start} disabled={!file || !build.matches}><span className="dot" style={{ background: 'var(--warm-ink)' }} />Start run</button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Run is live</h2>
              <p className="mute" style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.6 }}>Play the game. Each expected event ticks off as it's logged.</p>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', maxWidth: 540 }}>
                <span className="mono" style={{ fontSize: 46 }}>{elapsed}</span>
                <span className="mono" style={{ fontSize: 14 }}><span style={{ color: 'var(--ok)' }}>{ok}</span><span className="dim"> of {items.length} verified</span></span>
              </div>
              <div style={{ marginTop: 14, maxWidth: 540, height: 4, borderRadius: 2, background: '#26261F', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: items.length ? `${(ok / items.length) * 100}%` : 0, background: 'var(--ok)', transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 22 }}>
                <button className="btn btn-warm" style={{ height: 44 }} onClick={() => setView('checklist')}>Open checklist</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, minHeight: 44 }}>
          {step > 1 && step < 3 ? <button className="btn" onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {step === 1 && <button className="btn btn-warm" onClick={() => setStep(2)} disabled={!file || !!chosen?.error || !build.matches}>Next</button>}
        </div>
      </div>
    </main>
  );
}

export function Checklist() {
  const { monitor, device, pkg, send, setView, lastReport, showInLogs } = useApp();
  const run = monitor?.run;
  const elapsed = useClock(run?.startedAt, !!run?.active);
  const report = monitor?.report ?? lastReport;
  if (!run) {
    return (
      <main className="main">
        <PageHead title="Checklist" />
        <div className="card empty">No run yet. <button className="linkish" onClick={() => setView('checklist-setup')}>Set one up</button></div>
      </main>
    );
  }
  const items = run.items;
  const counts = { ok: 0, problem: 0, pending: 0 };
  for (const i of items) counts[i.status]++;
  const groups = [...new Set(items.map((i) => i.group))];
  const flags = (monitor.flags ?? []).filter((f) => f.severity !== 'info');

  return (
    <main className="main">
      <PageHead title="Checklist" sub={`${run.file} · ${pkg} on ${deviceName(device)}`}>
        {run.active
          ? <>
            <LiveBars label={`Run live · ${elapsed}`} />
            <button className="btn btn-warm" onClick={() => send({ type: 'run.finish' })}>Finish and export report</button>
          </>
          : <button className="btn" onClick={() => setView('checklist-setup')}>Start a new run</button>}
        <Menu items={[
          { label: 'Open the rules folder', onClick: () => api('rules/reveal', { method: 'POST' }) },
          { label: 'Start a new run', onClick: () => setView('checklist-setup'), hidden: !run.active },
        ]} />
      </PageHead>

      {report && !run.active && (
        <div className="card rise" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '16px 20px', borderColor: '#2f6a50', background: '#17221d' }}>
          <span className="px" style={{ fontSize: 18 }}>Report ready: {report.passed} of {report.total} passed</span>
          <span className="mute">{report.buildVerified ?? 0} of {report.buildTotal ?? 0} For Dev items verified</span>
          <span style={{ flex: '1 1 0' }} />
          <a className="btn btn-sm" href={`/api/reports/${report.id}.html?view=1`} target="_blank" rel="noreferrer">Open report</a>
          <Menu label="Save report" items={[
            { label: 'Save as HTML', href: `/api/reports/${report.id}.html`, download: true },
            { label: 'Save as Markdown', href: `/api/reports/${report.id}.md`, download: true },
          ]} />
        </div>
      )}

      <BuildVerificationTable build={run.build} showInLogs={showInLogs} />
      <RemoteConfigTable rc={run.rc} showInLogs={showInLogs} />

      <div className="card" style={{ padding: '22px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px 24px', marginBottom: 16 }}>
          <span className="px" style={{ fontSize: 30, fontWeight: 600 }}>{counts.ok} of {items.length} verified</span>
          <span className="mute" style={{ fontSize: 14.5 }}>{counts.problem ? <span style={{ color: 'var(--warn)' }}>{counts.problem} need a look</span> : 'nothing to fix'} · {counts.pending} waiting</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }} aria-hidden="true">
          {items.map((i, n) => <span key={i.id} className={`blk ${i.status}`} style={{ animationDelay: `${n * 0.05}s` }} />)}
        </div>
      </div>

        <div className="card" style={{ minWidth: 0, overflow: 'hidden' }}>
          {groups.map((g) => (
            <div key={g}>
              <div className="eyebrow" style={{ padding: '16px 22px 10px' }}>{g}</div>
              {items.filter((i) => i.group === g).map((i) => (
                <div key={i.id} className="citem" style={i.status === 'problem' ? { background: 'rgba(235,200,106,.05)' } : undefined}>
                  <span className={`ck ${i.status}`}>{i.status === 'ok' ? <Check /> : i.status === 'problem' ? '!' : null}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className={i.event ? 'mono' : ''} style={{ fontSize: 15.5, fontWeight: i.event ? 500 : 700 }}>{i.event ?? i.name}</span>
                      {i.sdk && i.type === 'event' && <span className={`tag sdk-${i.sdk === 'bytebrew' ? 'BB' : 'FA'}`}>{i.sdk === 'bytebrew' ? 'BB' : 'FA'}</span>}
                    </span>
                    <span style={{ display: 'block', fontSize: 14, marginTop: 4, color: i.status === 'problem' ? 'var(--warn)' : 'var(--mute)' }}>
                      {i.status === 'pending' ? (i.note || (i.event ? 'Waiting. Not seen yet in this run' : 'Waiting')) : i.note || (i.event ? i.name : '')}
                    </span>
                  </span>
                  <span className="mono dim" style={{ fontSize: 12.5 }}>{i.firstTs ? clock(i.firstTs, false) : 'not yet'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

      <Disclosure id="checklist.more" title="Rule hits and rules file" hint={`${flags.length ? `${flags.length} rule hit${flags.length === 1 ? '' : 's'}` : 'No rule hits'} · ${run.file}`}>
        <div className="card" style={{ padding: '16px 22px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="eyebrow">Rule hits</span>
            <button className="linkish" onClick={() => setView('logs')}>Open logs</button>
          </div>
          {flags.length === 0 && <div className="dim" style={{ padding: '12px 0', fontSize: 14 }}>None so far.</div>}
          {flags.slice(0, 8).map((f) => (
            <div key={f.id} className="flagrow">
              <span className={`tag ${SEVERITY_TAG[f.severity]}`}>{f.severity === 'critical' ? 'Error' : 'Warn'}</span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>{f.name}</span>
              <span className="mono dim" style={{ fontSize: 12.5 }}>x{f.count}</span>
              <button className="linkish" onClick={() => showInLogs(f.entryId)}>Line</button>
            </div>
          ))}
        </div>
        <div className="mute" style={{ fontSize: 14, lineHeight: 1.55 }}>Rules file <span className="mono" style={{ color: 'var(--text)' }}>{run.file}</span>. Edit it in any editor; the checklist updates as soon as you save. <button className="linkish" onClick={() => api('rules/reveal', { method: 'POST' })}>Open folder</button></div>
      </Disclosure>
    </main>
  );
}
