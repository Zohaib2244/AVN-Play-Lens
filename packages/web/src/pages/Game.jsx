import { useState } from 'react';
import { useApp, deviceName } from '../state.jsx';
import { api } from '../api.js';
import { GameIcon } from '../components/GameIcon.jsx';
import { GameEditor } from '../components/GameEditor.jsx';
import { SessionHistory } from '../components/SessionHistory.jsx';
const VIEWS = [
  ['logs', 'Logs', 'Search game output, warnings and crash traces.', '01'],
  ['performance', 'Performance', 'Frame times, CPU, memory and temperature.', '02'],
  ['health', 'Plugin health', 'SDK startup, ad state, revenue and checks.', '03'],
  ['firebase', 'Firebase events', 'Inspect this game’s events and parameters.', '04'],
  ['remote-config', 'Remote Config', 'Inspect fetched settings and level sequences.', '05'],
  ['checklist', 'Checklist', 'Run the checks for this game’s test session.', '06'],
  ['snapshooter', 'Level Snapshooter', 'Capture every level, browse images and share a ZIP.', '07'],
  ['qa', 'QA runs', 'Run a plan on the phone: startup, ads, levels, purchases, with a report.', '08'],
];
export function Game() {
  const { game, gameInventory, serial, device, devices, selectDevice, pkg, setView, performGameAction, actionBusy, refreshApps, stopped, setStopped, stream, reloadGames, viewGameSessions } = useApp();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  if (!game) return <main className="main"><div className="card empty">Choose a game from Home.</div></main>;
  const info = gameInventory.serial === serial ? gameInventory.games.find((g) => g.id === game.id) : null;
  const disabled = !device || !info?.installed || !!actionBusy || device?.replay;
  const remove = async () => { try { await api(`games/${game.id}`, { method: 'DELETE' }); setView('home'); await reloadGames(); } catch (e) { setError(e.message); } };
  return <main className="main game-overview">
    <div className="game-breadcrumb"><button className="linkish" onClick={() => setView('home')}>← All games</button><span>/</span><span>{game.name}</span></div>
    <header className="game-detail-header"><GameIcon game={game} size={88} paused={stopped} /><div style={{ flex: 1 }}><span className="eyebrow">GAME WORKSPACE</span><h1 className="page-title">{game.name}</h1><p className="mono dim" style={{ margin: '8px 0' }}>{game.packageId}</p><div className="history-actions"><span className={`tag ${info?.installed ? 'tag-ok' : 'tag-plain'}`}>{!device ? 'No device' : !info ? 'Checking…' : info.installed ? `v${info.versionName || '?'} · build ${info.versionCode ?? '?'}` : 'Not installed'}</span><span className="dim">{info?.running ? 'Game running' : 'Game stopped'}</span></div></div><button className="btn btn-sm" onClick={() => setEditing(!editing)}>Edit game & icon</button></header>
    {editing && <GameEditor game={game} onDone={() => setEditing(false)} />}
    <section className="card game-control-deck" aria-label="Game controls"><div className="library-heading"><div><span className="eyebrow">DEVICE & PLAYBACK</span><p className="mute" style={{ margin: '6px 0 0' }}>Controls apply only to {game.name}.</p></div><div className="history-actions"><select className="select" aria-label="Game device" value={serial || ''} onChange={(e) => selectDevice(devices.find((d) => d.serial === e.target.value))}><option value="" disabled>No device</option>{devices.filter((d) => d.state === 'device').map((d) => <option key={d.serial} value={d.serial}>{deviceName(d)}</option>)}</select><button className="linkish" onClick={refreshApps}>Refresh version</button></div></div>
      <div className="history-actions"><button className="btn btn-warm" disabled={disabled || info?.running === true} onClick={() => performGameAction(pkg, 'launch')}>{actionBusy === `${pkg}:launch` ? 'Starting…' : 'Start game'}</button><button className="btn" disabled={disabled} onClick={() => performGameAction(pkg, 'restart')}>{actionBusy === `${pkg}:restart` ? 'Restarting…' : 'Restart game'}</button><button className="btn" disabled={disabled || info?.running === false} onClick={() => performGameAction(pkg, 'stop')}>Stop game</button>{stopped && <button className="btn" disabled={!device || !info?.installed} onClick={() => setStopped(false)}>Resume tracking</button>}<span className={`tag ${!stopped && stream.state === 'live' ? 'tag-ok' : 'tag-plain'}`}>{stopped ? 'Tracking stopped' : !info?.installed ? 'Tracking unavailable' : stream.state === 'live' ? 'Tracking this game' : 'Preparing capture…'}</span></div>
      {!device && <p className="dim">Connect a device from the Devices page to start tracking.</p>}{info && !info.installed && <p className="dim">Install this package on {deviceName(device)}, then refresh.</p>}
    </section>
    <section><div className="library-heading"><h2 className="px" style={{ margin: 0, fontSize: 26 }}>What would you like to inspect?</h2><span className="dim" style={{ fontSize: 13 }}>One game. One session.</span></div><div className="inspect-grid">{VIEWS.map(([view, title, text, n]) => <button className="card inspect-card" key={view} aria-label={`Open ${title}`} onClick={() => setView(view)}><span className="eyebrow">{n}</span><strong className="px">{title}</strong><p>{text}</p><span className="inspect-arrow">↗</span></button>)}</div></section>
    <section className="game-history-preview"><SessionHistory limit={3} groupByGame={false} packageFilter={pkg} /><button className="btn" style={{ marginTop: 16 }} onClick={() => viewGameSessions(pkg)}>All sessions for {game.name}</button></section>
    <div className="game-settings-footer"><span className="dim">Game settings</span><button className="linkish" onClick={() => setRemoving(!removing)}>Remove game from library</button></div>
    {removing && <div className="card" style={{ padding: 20 }}><p>Remove {game.name}? The installed game and saved sessions stay on this computer.</p><button className="btn" onClick={remove}>Remove from library</button></div>}{error && <p role="alert">{error}</p>}
  </main>;
}
export function GameSessions() {
  const { game, pkg, setView } = useApp();
  return <main className="main"><div className="game-breadcrumb"><button className="linkish" onClick={() => setView('game')}>← {game?.name || 'Game workspace'}</button><span>/ Sessions</span></div><h1 className="page-title">{game?.name} sessions</h1><SessionHistory packageFilter={pkg} groupByGame={false} /></main>;
}
