import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { GameIcon } from './GameIcon.jsx';
export function GameEditor({ game = null, onDone }) {
  const { reloadGames, refreshApps, serial, apps } = useApp();
  const [name, setName] = useState(game?.name || '');
  const [packageId, setPackageId] = useState(game?.packageId || '');
  const [icon, setIcon] = useState(game?.icon || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 250 * 1024) { setError('Choose a PNG, JPEG or WebP icon smaller than 250 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setIcon(reader.result); setError(''); };
    reader.onerror = () => setError('Could not read this image.');
    reader.readAsDataURL(file);
  };
  const save = async (ev) => {
    ev.preventDefault(); setBusy(true); setError('');
    try {
      const saved = await api(game ? `games/${game.id}` : 'games', { method: game ? 'PATCH' : 'POST', body: { name, packageId, icon } });
      await reloadGames({ previousPackage: game?.packageId, nextPackage: saved.packageId }); refreshApps(); onDone(saved);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <form className="card library-form" onSubmit={save} aria-label={game ? 'Edit game' : 'Add game'}>
    <div className="library-heading"><h3 style={{ margin: 0 }}>{game ? 'Edit game' : 'Add a game'}</h3><button type="button" className="linkish" onClick={() => onDone(null)}>Cancel</button></div>
    <div className="icon-editor"><GameIcon game={{ name: name || 'Game', icon }} /><div><label className="btn btn-sm icon-upload">Choose icon<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} aria-label="Game icon" /></label><p className="dim" style={{ fontSize: 12.5, margin: '8px 0' }}>PNG, JPEG or WebP · up to 250 KB</p>{icon && <button type="button" className="linkish" onClick={() => setIcon(null)}>Remove icon</button>}</div></div>
    <div className="library-fields">
      <label>Game name<input className="field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Puzzle Game" /></label>
      <label>Android package ID<input className="field mono" required maxLength={255} value={packageId} onChange={(e) => setPackageId(e.target.value)} placeholder="com.studio.game" list="installed-package-ids" autoCapitalize="none" spellCheck={false} /></label>
      <datalist id="installed-package-ids">{(apps.serial === serial ? apps.packages : []).map((p) => <option key={p} value={p} />)}</datalist>
    </div>
    {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
    <div style={{ marginTop: 18 }}><button className="btn btn-warm" disabled={busy}>{busy ? 'Saving…' : 'Save game'}</button></div>
  </form>;
}
