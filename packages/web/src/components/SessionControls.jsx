import { useState } from 'react';
import { Button, ConfirmDelete, DialogShell, Tag } from '@avn/ui';
import { useApp, clock } from '../state.jsx';

export function SessionControls() {
  const { session, serial, online, stopped, newSession, saveSession, sessionId, games, pkg } = useApp();
  const [choose, setChoose] = useState(false);
  const [discard, setDiscard] = useState(false);
  if (!serial || (games.length && (!session || session.pkg !== pkg))) return null;
  return <section className="pl-session-bar" aria-label="Current capture session">
    <Tag kind={stopped ? 'plain' : 'info'}>{stopped ? 'Stopped' : 'Capture'}</Tag>
    <div className="pl-session-name"><strong>{session?.name || 'Starting a session…'}</strong><span>{session?.startedAt ? `Started ${clock(session.startedAt, false)}` : ''}{session?.recording === false ? ' · recording disabled' : session?.saved ? ' · saved, still recording' : ' · auto-saves when finished'}</span></div>
    <Button size="sm" disabled={!online || stopped || !sessionId || session?.recording === false} onClick={saveSession}>{session?.saved ? 'Save latest' : 'Save session'}</Button>
    <Button size="sm" disabled={!online} onClick={() => setChoose(true)}>New session</Button>
    <DialogShell open={choose} onOpenChange={setChoose} title="Start a new session"><p className="muted">Logs, events, ad counts and performance start fresh together. Save this capture to keep its evidence.</p><div className="row-wrap"><Button variant="primary" onClick={() => { newSession('save'); setChoose(false); }}>Save & start new</Button><Button onClick={() => { setChoose(false); setDiscard(true); }}>Discard this capture…</Button><Button variant="ghost" onClick={() => setChoose(false)}>Cancel</Button></div></DialogShell>
    <ConfirmDelete open={discard} onClose={() => setDiscard(false)} onConfirm={() => { newSession('discard'); setDiscard(false); }} name={session?.name || 'current capture'} title="Discard this capture?" consequences={['The current session’s logs, events and performance samples. Saved sessions from earlier tests are kept.']} confirmLabel="Discard & start new" />
  </section>;
}
