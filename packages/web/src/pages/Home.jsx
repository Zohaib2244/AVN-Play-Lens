import { useApp, deviceName } from '../state.jsx';
import { Logo } from '../components/bits.jsx';
import { GameLibrary } from '../components/GameLibrary.jsx';
export function Home() {
  const { setView, device, devices, status, online, viewGameSessions } = useApp();
  const ready = devices.filter((d) => d.state === 'device');
  return <div className="home workspace-home">
    <header className="store-header"><div className="store-brand"><Logo size={28} /><strong className="px">AVN PlayLens</strong></div><nav className="history-actions" aria-label="Main navigation"><button className="linkish" onClick={() => viewGameSessions('__all')}>Sessions</button><button className="btn btn-sm" onClick={() => setView('devices')}>Devices{ready.length ? ` · ${ready.length}` : ''}</button></nav></header>
    <div className="connection-strip"><span className={`dot ${ready.length ? 'ok' : 'warn'}`} /><span>{!online ? 'Connecting to PlayLens…' : ready.length ? `${deviceName(device || ready[0])} connected` : 'No phone connected'}</span><span className="dim connection-note">{ready.length ? 'Ready for your game workspace' : 'Connect a phone to inspect an installed game'}</span>{!ready.length && <button className="btn btn-sm btn-warm" disabled={!status?.adb} onClick={() => setView('connect')}>Connect device</button>}</div>
    <GameLibrary />
    <footer className="store-footer"><span>Ⅱ Tracking is paused on Home.</span><span>Open a game to collect its logs, events and performance.</span></footer>
  </div>;
}
