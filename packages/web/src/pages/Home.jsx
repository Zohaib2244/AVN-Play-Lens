import { useApp } from '../state.jsx';
import { GameLibrary } from '../components/GameLibrary.jsx';
export function Home() {
  const { setView, devices, status, online } = useApp();
  const ready = devices.filter((d) => d.state === 'device');
  return <main className="main home">
    {online && !ready.length && <div className="card callout warn"><span style={{ flex: '1 1 auto' }}><b>No phone connected.</b> <span className="mute">Connect one to track a game.</span></span><button className="btn btn-sm btn-warm" disabled={!status?.adb} onClick={() => setView('connect')}>Connect a phone</button></div>}
    <GameLibrary />
  </main>;
}
