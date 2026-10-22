import { useEffect, useRef, useState } from 'react';
import { useApp, deviceName, clock } from '../state.jsx';
import { api } from '../api.js';
import { PageHead, Check, Lattice } from '../components/bits.jsx';
import { Menu, LiveBars, Skeleton, Spinner } from '../components/ui.jsx';
import { useAppAction } from './Logs.jsx';
import { FirebaseEvents, EVENT_CHECK as CHECK } from '../components/FirebaseEvents.jsx';

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
  const { serial, pkg, device, monitor, send, setView, showToast, stream, captureVersion } = useApp();
  const appAction = useAppAction();
  const [step, setStep] = useState(1);
  const [restarted, setRestarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commands, setCommands] = useState([]);
  const baseCount = useRef(null);
  useEffect(() => { baseCount.current = null; }, [captureVersion]);
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
        sub={<>{pkg} on {deviceName(device)} · {fb.counts.firebase} logged by Firebase{fb.counts.sent ? ` · ${fb.counts.sent} handed to SDK` : ''}{fb.counts.notLogged ? <> · <span style={{ color: 'var(--warn)' }}>{fb.counts.notLogged} without a matching Firebase log</span></> : null}</>}
      >
        {fb.debug?.on && (fb.receiving ? <LiveBars label="Listening" /> : <span className="live paused">{fb.diagnostics?.upload?.state === 'successful' ? 'Upload confirmed' : fb.diagnostics?.lines ? 'Firebase SDK active' : 'Waiting for SDK activity'}</span>)}
        <Menu items={[
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

      {fb.diagnostics?.upload && <section className="card" style={{ padding: '16px 22px' }} role="status">
        <strong className={fb.diagnostics.upload.state === 'successful' ? 'okc' : 'warnc'}>{fb.diagnostics.upload.state === 'successful' ? 'Analytics upload succeeded' : 'Analytics upload failed'}</strong>
        <span className="dim" style={{ marginLeft: 12 }}>{clock(fb.diagnostics.upload.ts, false)}</span>
        <p className="mute" style={{ margin: '8px 0 0' }}>Google Play services reported this result for {pkg}. Events below come from Firebase logs and upload batches identified with this package.</p>
        {fb.diagnostics.upload.entryId && <button className="linkish" style={{ marginTop: 8 }} onClick={() => showInLogs(fb.diagnostics.upload.entryId)}>Show upload log</button>}
      </section>}

      {fb.debug?.on && !fb.receiving && fb.diagnostics?.upload?.state !== 'successful' && <section className="card" style={{ padding: '18px 22px' }} role="status">
        <strong>{fb.diagnostics?.lines ? 'Firebase SDK activity detected' : 'Waiting for Firebase SDK logs'}</strong>
        <p className="mute" style={{ margin: '8px 0', lineHeight: 1.6 }}>{fb.diagnostics?.lines
          ? `${fb.diagnostics.lines} SDK log lines captured${fb.diagnostics.collection === true ? '. Analytics collection is enabled' : fb.diagnostics.collection === false ? '. Analytics collection is disabled' : ''}${fb.diagnostics.dispatches ? `; ${fb.diagnostics.dispatches} event dispatch${fb.diagnostics.dispatches === 1 ? '' : 'es'} reported` : ''}. This SDK can log event details in Google Play services upload batches; they appear as the next batch is captured.`
          : 'Debug mode is enabled. Restart the game with tracking active, then play a level. Earlier events are not backfilled.'}</p>
        <p className="dim" style={{ margin: 0, fontSize: 13 }}>SDK handoff and local logging do not confirm delivery to Firebase. An ad blocker, Private DNS or VPN can prevent Analytics uploads.</p>
        {fb.diagnostics?.issue && <p className="mono warnc" style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{fb.diagnostics.issue}</p>}
        <button className="linkish" style={{ marginTop: 12 }} onClick={() => setView('logs')}>Inspect game logs</button>
      </section>}

      <FirebaseEvents firebase={fb} showInLogs={showInLogs} />
    </main>
  );
}
