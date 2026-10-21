import { useState } from 'react';
import { useApp } from '../state.jsx';
import { GameEditor } from './GameEditor.jsx';
import { GameIcon } from './GameIcon.jsx';
export function GameLibrary() {
  const { games, gamesLoaded, gamesError, gameInventory, serial, openGame, device, refreshApps } = useApp();
  const [adding, setAdding] = useState(false);
  return <section className="game-library" aria-label="My games">
    <div className="library-heading"><div><span className="eyebrow">YOUR LIBRARY</span><h1 className="library-title px">Choose a game.</h1><p className="mute" style={{ margin: 0 }}>Open a workspace to start tracking. Your other games stay paused.</p></div><div className="history-actions"><button className="btn btn-sm" disabled={!device} onClick={refreshApps}>Refresh versions</button><button className="btn btn-warm" onClick={() => setAdding(true)}>+ Add game</button></div></div>
    {gamesError && <p role="alert" style={{ color: 'var(--bad)' }}>{gamesError}</p>}
    {adding && <GameEditor onDone={() => setAdding(false)} />}
    {!games.length && !adding && <div className="card library-empty"><div className="px" style={{ fontSize: 28 }}>A workspace for each game.</div><p className="mute">Add a name, package ID and optional icon. PlayLens only collects logs for the game you open.</p><button className="btn btn-warm" onClick={() => setAdding(true)}>Add your first game</button></div>}
    {!gamesLoaded && <p className="dim">Loading your games…</p>}
    <div className="store-grid">{games.map((g) => {
      const info = gameInventory.serial === serial ? gameInventory.games.find((x) => x.id === g.id) : null;
      return <button className="card store-game" key={g.id} onClick={() => openGame(g.packageId)} aria-label={`Open ${g.name}`}>
        <div className="store-art"><GameIcon game={g} size={92} paused /><span className="store-arrow">↗</span></div>
        <div className="store-game-body"><h2>{g.name}</h2><p className="mono dim">{g.packageId}</p><div className="store-meta"><span className={`tag ${info?.installed ? 'tag-ok' : 'tag-plain'}`}>{!device ? 'No device' : !info ? 'Checking…' : info.installed ? `v${info.versionName || '?'}` : 'Not installed'}</span><span className="tracking-paused">Ⅱ Tracking paused</span></div></div>
      </button>;
    })}</div>
  </section>;
}
