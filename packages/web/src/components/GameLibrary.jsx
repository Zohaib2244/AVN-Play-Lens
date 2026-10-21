import { useState } from 'react';
import { useApp } from '../state.jsx';
import { PageHead } from './bits.jsx';
import { GameEditor } from './GameEditor.jsx';
import { GameIcon } from './GameIcon.jsx';
export function GameLibrary() {
  const { games, gamesLoaded, gamesError, gameInventory, serial, openGame, device, refreshApps } = useApp();
  const [adding, setAdding] = useState(false);
  return <section className="game-library" aria-label="My games">
    <PageHead title="Library" sub="Open a game to track its logs, events and performance.">
      <div className="history-actions"><button className="linkish" disabled={!device} onClick={refreshApps}>Refresh versions</button><button className="btn btn-warm" onClick={() => setAdding(true)}>+ Add game</button></div>
    </PageHead>
    {gamesError && <p role="alert" className="badc">{gamesError}</p>}
    {adding && <GameEditor onDone={() => setAdding(false)} />}
    {gamesLoaded && !games.length && !adding && <div className="card library-empty"><div className="empty-title">Add your first game</div><p className="mute">Give it a name, the Android package ID and an optional icon.</p><button className="btn btn-warm" onClick={() => setAdding(true)}>+ Add game</button></div>}
    {!gamesLoaded && <p className="dim">Loading your games…</p>}
    <div className="store-grid">{games.map((g) => {
      const info = gameInventory.serial === serial ? gameInventory.games.find((x) => x.id === g.id) : null;
      return <button className="card store-game" key={g.id} onClick={() => openGame(g.packageId)} aria-label={`Open ${g.name}`}>
        <GameIcon game={g} size={56} />
        <div className="store-game-body"><h2>{g.name}</h2><p className="mono dim">{g.packageId}</p></div>
        <span className={`tag ${info?.installed ? 'tag-ok' : 'tag-plain'}`}>{!device ? 'No phone' : !info ? 'Checking…' : info.installed ? `v${info.versionName || '?'}` : 'Not installed'}</span>
      </button>;
    })}</div>
  </section>;
}
