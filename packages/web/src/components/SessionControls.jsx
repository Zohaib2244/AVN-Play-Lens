import { useState } from 'react';
import { useApp, clock } from '../state.jsx';

export function SessionControls() {
  const { session, serial, online, stopped, newSession, saveSession, sessionId, games, pkg } = useApp();
  const gameName = games.find((g) => g.packageId === session?.pkg)?.name || session?.gameName || session?.pkg;
  const [choose, setChoose] = useState(false);
  if (!serial || (games.length && (!session || session.pkg !== pkg))) return null;
  return <section className="card session-controls" aria-label="Current capture session">
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <strong>{gameName ? `${gameName} · ` : ''}{session?.name || 'Starting a session…'}</strong>
        <span className="dim" style={{ marginLeft: 12, fontSize: 13 }}>{session?.startedAt ? `Started ${clock(session.startedAt, false)}` : ''}{stopped ? ' · stopped' : session?.recording === false ? ' · history recording disabled' : session?.saved ? ' · saved, still recording' : ' · auto-saves when finished'}</span>
        {session?.reason && <div className="mute" style={{ fontSize: 13, marginTop: 4 }}>{session.reason} · previous capture kept separately</div>}
      </div>
      <button className="btn btn-sm" disabled={!online || stopped || !sessionId} onClick={saveSession}>{session?.saved ? 'Save latest' : 'Save session'}</button>
      <button className="btn btn-sm" disabled={!online} aria-expanded={choose} onClick={() => setChoose(!choose)}>New session / clear</button>
    </div>
    {choose && <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
      <p className="mute" style={{ margin: '0 0 12px', fontSize: 14 }}>Start fresh: logs, Firebase events, ad counts and performance will reset together.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-sm btn-warm" onClick={() => { newSession('save'); setChoose(false); }}>Save & start new</button>
        <button className="btn btn-sm" onClick={() => { newSession('discard'); setChoose(false); }}>Discard & start new</button>
        <button className="linkish" onClick={() => setChoose(false)}>Cancel</button>
      </div>
    </div>}
  </section>;
}
