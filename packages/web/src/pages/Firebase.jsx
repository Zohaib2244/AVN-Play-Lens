import { useEffect, useRef, useState } from 'react';
import { useApp, deviceName, clock } from '../state.jsx';
import { api } from '../api.js';
import { PageHead, Check, Lattice } from '../components/bits.jsx';
import { Menu, LiveBars, Skeleton, Spinner } from '../components/ui.jsx';
import { useAppAction } from './Logs.jsx';

const CHECK = {
  'matches-plugin': ['Matches plugin', 'tag-ok'],
  'game-code': ['Game code', 'tag-plain'],
  automatic: ['Automatic', 'tag-plain'],
  'not-in-firebase': ['Not in Firebase', 'tag-bad'],
  'dropped-by-plugin': ['Dropped by plugin', 'tag-bad'],
  'sent-before-init': ['Sent before init', 'tag-warn'],
  'plugin-only': ['Plugin only', 'tag-plain'],
};
const WHY = {
  'not-in-firebase': 'The plugin handed this event to Firebase, but Firebase never logged it. Usual causes: Firebase was not ready yet, the event name breaks a Firebase rule, or analytics collection is off in this build.',
  'dropped-by-plugin': 'The plugin dropped this event because Firebase was not initialized yet.',
  'sent-before-init': 'The plugin sent this before Firebase finished starting, so Firebase may have dropped it.',
  'plugin-only': 'ByteBrew has no debug log on the phone, so only the plugin line is visible: the event name and how many parameters it had, not their values.',
};

function Stepper({ step, labels }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 30 }} role="list" aria-label="Setup steps">
      {labels.map((label, i) => (
        <div key={label} style={{ display: 'contents' }}>
          {i > 0 && <span className={`sseg${step > i ? ' on' : ''}`}><i /></span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} role="listitem">
            <span className={`snode${i + 1 < step ? ' done' : i + 1 === step ? ' act' : ''}`}><span className="n mono">{i + 1}</span><span className="chk"><Check size={16} /></span></span>
            <span className={`slab${i + 1 === step ? ' on' : ''}`}>{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
export { Stepper };

export function FirebaseSetup() {
  const { serial, pkg, device, monitor, send, setView, showToast, stream } = useApp();
  const appAction = useAppAction();
  const [step, setStep] = useState(1);
  const [restarted, setRestarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commands, setCommands] = useState([]);
  const baseCount = useRef(null);
  const fb = monitor?.firebase;
  const debugOn = !!fb?.debug?.on;
  const replay = !!device?.replay;

  useEffect(() => {
    if (!serial || !pkg) return;
    api(`devices/${encodeURIComponent(serial)}/firebase?pkg=${encodeURIComponent(pkg)}`).then((s) => setCommands(s.commands || [])).catch(() => {});
  }, [serial, pkg]);
  useEffect(() => {
    if (step === 3 && baseCount.current == null) baseCount.current = fb?.counts.firebase ?? 0;
  }, [step, fb]);

  const turnOn = async () => {
    setBusy(true);
    try {
      await api(`devices/${encodeURIComponent(serial)}/firebase`, { method: 'POST', body: { pkg, on: true } });
      send({ type: 'firebase.refresh', serial });
    } catch (e) {
      showToast({ title: 'Could not turn on debug mode', msg: e.message });
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    setBusy(true);
    await appAction('restart');
    setRestarted(true);
    setBusy(false);
  };

  const caught = Math.max(0, (fb?.counts.firebase ?? 0) - (baseCount.current ?? 0));
  const recent = (fb?.rows ?? []).filter((r) => r.sdk === 'FA' && !r.missing).slice(0, 3);
  const canNext = step === 1 ? debugOn : step === 2 ? restarted || replay : false;

  return (
    <main className="main" style={{ alignItems: 'center', paddingTop: 52 }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px 16px' }}>
          <span className="eyebrow">Firebase events · setup</span>
          <button className="linkish" onClick={() => setView('firebase')}>Already set up? Skip to events</button>
        </div>
        <h1 className="setup-title">Let Firebase talk to you</h1>
        <p className="mute" style={{ margin: '0 0 34px', fontSize: 16, lineHeight: 1.6, maxWidth: 600 }}>
          Firebase only writes its events to the phone's log in debug mode. Three steps, about 20 seconds. The plugin's own lines then double-check that nothing goes missing.
        </p>
        <Stepper step={step} labels={['Debug mode', 'Restart game', 'Listen']} />

        <div className="card setup-card">
          {step === 1 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Turn on debug mode</h2>
              <p className="mute" style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.6 }}>Only for {pkg}, only on {deviceName(device)}. It stays on until you turn it off from the events screen.</p>
              <span className="eyebrow" style={{ marginBottom: 8 }}>What this runs</span>
              <div className="cmd">{commands.map((c) => <div key={c}>{c}</div>)}</div>
              <div style={{ marginTop: 'auto', paddingTop: 22, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                {debugOn
                  ? <span className="tag tag-ok" style={{ fontSize: 12.5, padding: '8px 12px' }}>Debug mode on for {pkg}</span>
                  : <button className="btn btn-warm" style={{ height: 44 }} onClick={turnOn} disabled={busy || !pkg}>{busy ? <><Spinner />Turning on…</> : 'Turn on debug mode'}</button>}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Restart the game</h2>
              <p className="mute" style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.6 }}>Firebase reads the setting when the game starts. You lose the current play session, not your saved progress.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px', background: 'var(--well)', maxWidth: 540 }}>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <span className="mono" style={{ display: 'block', fontSize: 15 }}>{pkg}</span>
                  <span className="dim" style={{ display: 'block', fontSize: 13, marginTop: 3 }}>{deviceName(device)}</span>
                </span>
                <span className={`tag ${stream.running || replay ? 'tag-ok' : 'tag-plain'}`}>{replay ? 'Replay' : stream.running ? (restarted ? 'Running · new process' : 'Running') : 'Not running'}</span>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 22, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                {replay ? <span className="dim">The replay device can't be restarted; go on to the next step.</span>
                  : restarted ? <span className="tag tag-ok" style={{ fontSize: 12.5, padding: '8px 12px' }}>Restarted</span>
                    : <button className="btn btn-warm" style={{ height: 44 }} onClick={restart} disabled={busy}>{busy ? <><Spinner />Restarting…</> : 'Restart the game'}</button>}
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}>
              <h2 className="px" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Listening</h2>
              <p className="mute" style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.6 }}>Play for a moment. Events appear as Firebase logs them.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
                <Lattice />
                <span style={{ fontSize: 15 }}><span className="mono" style={{ color: 'var(--warm)' }}>{caught}</span> events logged by Firebase so far</span>
              </div>
              <div style={{ maxWidth: 560, minHeight: 126 }}>
                {recent.map((e) => (
                  <div key={e.id} className="rise" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--line-soft)', fontSize: 14.5, animationDuration: '.45s' }}>
                    <span className="tag sdk-FA">FA</span>
                    <span className="mono">{e.name}</span>
                    <span className={`tag ${CHECK[e.check][1]}`} style={{ marginLeft: 'auto' }}>{CHECK[e.check][0]}</span>
                  </div>
                ))}
                {!recent.length && <div className="dim" style={{ fontSize: 14 }}>Nothing yet. If this stays empty after you play, restart the game once more.</div>}
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 20 }}>
                <button className="btn btn-warm" style={{ height: 44 }} onClick={() => setView('firebase')}>Open Firebase events</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, minHeight: 44 }}>
          {step > 1 ? <button className="btn" onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {step < 3 && <button className="btn btn-warm" onClick={() => setStep(step + 1)} disabled={!canNext}>Next</button>}
        </div>
      </div>
    </main>
  );
}

export function Firebase() {
  const { monitor, device, pkg, serial, send, setView, showInLogs, showToast } = useApp();
  const [sdk, setSdk] = useState('ALL');
  const [hideAuto, setHideAuto] = useState(false);
  const [open, setOpen] = useState(null);
  const fb = monitor?.firebase;
  if (!fb) {
    return (
      <main className="main">
        <PageHead title="Firebase events" />
        <div className="card" style={{ overflow: 'hidden' }} aria-busy="true" aria-label="Loading events">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="erow" style={{ cursor: 'default' }}>
              <Skeleton w={70} h={12} /><Skeleton w={30} h={18} /><Skeleton w={`${50 + (i * 13) % 40}%`} h={14} /><Skeleton w="70%" h={14} /><Skeleton w={100} h={18} /><span />
            </div>
          ))}
        </div>
      </main>
    );
  }

  const rows = fb.rows.filter((r) => (sdk === 'ALL' || r.sdk === sdk) && !(hideAuto && r.check === 'automatic'));
  const turnOff = async () => {
    try {
      await api(`devices/${encodeURIComponent(serial)}/firebase`, { method: 'POST', body: { pkg, on: false } });
      send({ type: 'firebase.refresh', serial });
      setView('firebase-setup');
    } catch (e) {
      showToast({ title: 'Could not turn off debug mode', msg: e.message });
    }
  };

  return (
    <main className="main">
      <PageHead
        title="Firebase events"
        sub={<>{pkg} on {deviceName(device)} · {fb.counts.firebase} logged by Firebase{fb.counts.notLogged ? <> · <span style={{ color: 'var(--bad)' }}>{fb.counts.notLogged} sent by the plugin but not logged</span></> : null}</>}
      >
        {fb.debug?.on && (fb.receiving ? <LiveBars label="Listening" /> : <span className="live paused">Waiting for Firebase lines</span>)}
        <Menu items={[
          { label: 'Hide automatic events', pressed: hideAuto, onClick: () => setHideAuto(!hideAuto) },
          { label: 'Run setup again', onClick: () => setView('firebase-setup') },
          { label: 'Turn off Firebase debug mode', onClick: turnOff, hidden: device?.replay, danger: true },
        ]} />
      </PageHead>

      {!fb.debug?.on && (
        <div className="card" style={{ padding: '14px 20px', borderColor: '#5a4a1e', background: '#221d14', fontSize: 14.5 }}>
          <b style={{ color: 'var(--warn)' }}>Firebase debug mode is off,</b> <span className="mute">so Firebase isn't writing events to the log. </span>
          <button className="linkish" onClick={() => setView('firebase-setup')}>Set it up</button>
        </div>
      )}

      {fb.rows.some((r) => r.sdk === 'BB') && <div style={{ alignSelf: 'flex-start' }} className="seg" role="group" aria-label="Show events from">
          {[['ALL', 'All'], ['FA', 'Firebase'], ['BB', 'ByteBrew']].map(([k, label]) => <button key={k} aria-pressed={sdk === k} onClick={() => setSdk(k)}>{label}</button>)}
        </div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="erow eyebrow" style={{ cursor: 'default', minHeight: 40, borderTop: 0 }}>
          <span>Time</span><span>From</span><span>Event</span><span>Parameters</span><span>Plugin check</span><span />
        </div>
        {rows.length === 0 && <div className="empty">{fb.debug?.on ? 'No events yet. Play the game for a moment.' : 'No events. Turn on Firebase debug mode first.'}</div>}
        {rows.map((r) => {
          const isOpen = open === r.id;
          const [checkLabel, checkCls] = CHECK[r.check] ?? [r.check, 'tag-plain'];
          const params = Object.entries(r.params ?? {}).filter(([k]) => !/^(ga_|firebase_)/.test(k));
          return (
            <div key={r.id}>
              <button className={`erow${isOpen ? ' open' : ''}${r.missing ? ' missing' : r.problems?.length ? ' warn' : ''}`} onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <span className="mono dim" style={{ fontSize: 12.5 }}>{clock(r.ts, false)}</span>
                <span className={`tag sdk-${r.sdk}`} style={{ justifySelf: 'start' }}>{r.sdk}</span>
                <span className="mono ename" style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {r.sdk === 'BB' ? <span className="dim mono" style={{ fontSize: 12.5 }}>{r.paramCount} params</span> : params.slice(0, 3).map(([k, v]) => <span key={k} className="chip" style={{ margin: '0 6px 0 0' }}><span className="dim">{k}</span>{String(v)}</span>)}
                </span>
                <span><span className={`tag ${checkCls}`}>{checkLabel}</span></span>
                <svg className="car" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
              {isOpen && (
                <div className="edetail">
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>All parameters</div>
                    {Object.entries(r.params ?? {}).map(([k, v]) => (
                      <div key={k} className="kv"><span className="mono mute">{k}</span><span className="mono">{String(v)}</span></div>
                    ))}
                    {!Object.keys(r.params ?? {}).length && <div className="dim" style={{ fontSize: 14 }}>{r.sdk === 'BB' ? 'Values are not visible for ByteBrew.' : 'No parameters.'}</div>}
                  </div>
                  <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                    {WHY[r.check] && <div style={{ background: r.missing ? 'var(--bad-soft)' : 'var(--panel)', borderRadius: 12, padding: '12px 14px', fontSize: 14, lineHeight: 1.5, color: r.missing ? 'var(--bad)' : 'var(--mute)' }}>{WHY[r.check]}</div>}
                    {r.problems?.map((p) => <div key={p} style={{ background: 'var(--warn-soft)', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: 'var(--warn)' }}>{p}</div>)}
                    {r.entryId && <button className="btn btn-sm" onClick={() => showInLogs(r.entryId)}>Show in logs</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
