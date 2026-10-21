// The app's only navigation. Outside a game: logo, Library / History / Devices and the phone.
// Inside a game: one row with the game, the phone, the live session and the main action, then
// the five tool tabs. Tracking status is shown here and nowhere else.
import { useState } from 'react';
import { useApp, deviceName, tabBadges } from '../state.jsx';
import { api } from '../api.js';
import { Icon, Logo, PageHead } from './bits.jsx';
import { GameIcon } from './GameIcon.jsx';
import { GameEditor } from './GameEditor.jsx';
import { Menu } from './ui.jsx';

const TABS = [
  { id: 'logs', title: 'Logs', icon: 'logs' },
  { id: 'performance', title: 'Performance', short: 'Perf', icon: 'pulse' },
  { id: 'health', title: 'Health', icon: 'shield', badge: 'health' },
  { id: 'firebase', title: 'Events', icon: 'flame', badge: 'firebase', also: ['firebase-setup'] },
  { id: 'checklist', title: 'Checklist', icon: 'clipboard', badge: 'checklist', also: ['checklist-setup'] },
];

// The game on the selected phone: installed, version, running.
export function useGameInfo() {
  const { gameInventory, serial, pkg } = useApp();
  return gameInventory.serial === serial ? gameInventory.games.find((g) => g.packageId === pkg) ?? null : null;
}

// One answer to "is PlayLens collecting right now, and if not, why".
export function useTracking() {
  const { online, device, stopped, stream, session } = useApp();
  const info = useGameInfo();
  if (!online) return { tone: '', text: 'Reconnecting…' };
  if (!device) return { tone: 'warn', text: 'No phone', blocked: 'no-device' };
  if (!info) return { tone: '', text: 'Checking…' };
  if (!info.installed) return { tone: 'warn', text: 'Not installed', blocked: 'not-installed' };
  if (stopped) return { tone: '', text: 'Stopped', blocked: 'stopped' };
  if (stream.state === 'live') return { tone: 'ok', text: session?.name ? `Live · ${session.name}` : 'Live', live: true };
  if (stream.state === 'ended' || stream.state === 'error') return { tone: 'bad', text: 'Log ended', blocked: 'ended' };
  if (stream.state === 'paused') return { tone: '', text: 'Paused' };
  return { tone: '', text: 'Starting…' };
}

// A page's empty state when tracking can't run, instead of loading placeholders forever.
// Call after the page's own hooks; returns null when the page should render normally.
export function useGate(title, hasData) {
  const { device, game, stream, setView } = useApp();
  const t = useTracking();
  let reason = null;
  if (t.blocked === 'no-device') reason = { title: 'No phone connected', body: 'Connect a phone to start tracking this game.', action: ['Connect a phone', () => setView('connect')] };
  else if (t.blocked === 'not-installed') reason = { title: `${game?.name ?? 'This game'} isn't installed on ${deviceName(device)}`, body: 'Install the build on the phone. PlayLens picks it up within a few seconds.' };
  else if (!hasData && t.blocked === 'stopped') reason = { title: 'Tracking is stopped', body: 'Start the game from the top bar to collect again.' };
  else if (!hasData && t.blocked === 'ended') reason = { title: 'The log stopped', body: stream.reason || 'Restart the game to start a fresh log.' };
  if (!reason) return null;
  return (
    <main className="main">
      <PageHead tab title={title} />
      <div className="card empty">
        <div className="empty-title">{reason.title}</div>
        <div>{reason.body}</div>
        {reason.action && <button className="btn btn-warm" style={{ marginTop: 16 }} onClick={reason.action[1]}>{reason.action[0]}</button>}
      </div>
    </main>
  );
}

function DeviceMenu() {
  const { devices, device, serial, selectDevice, setView, online } = useApp();
  const ready = devices.filter((d) => d.state === 'device');
  return (
    <Menu
      label={device ? `Phone: ${deviceName(device)}` : 'Phone'}
      align="left"
      className="chip-btn device-chip"
      trigger={<><span className={`dot ${device ? 'ok' : 'warn'}`} /><span className="chip-text">{device ? deviceName(device) : online ? 'No phone' : 'Starting…'}</span><Icon.caret /></>}
      items={[
        ready.length ? { heading: 'Use phone' } : null,
        ...ready.map((d) => ({ key: d.serial, label: deviceName(d), pressed: d.serial === serial, onClick: () => selectDevice(d) })),
        ready.length ? { sep: true } : null,
        { label: 'Connect a phone…', onClick: () => setView('connect') },
        { label: 'Manage devices', onClick: () => setView('devices') },
      ]}
    />
  );
}

export function AppHeader() {
  const { view, setView, viewGameSessions } = useApp();
  const links = [['home', 'Library', () => setView('home')], ['sessions', 'History', () => viewGameSessions('__all')], ['devices', 'Devices', () => setView('devices')]];
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => setView('home')} aria-label="AVN PlayLens library">
        <Logo />
        <span className="px wm-text">AVN PlayLens</span>
      </button>
      <nav className="toplinks" aria-label="Main">
        {links.map(([id, title, go]) => (
          <button key={id} className={`toplink${view === id || (id === 'sessions' && view === 'saved-session') ? ' act' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={go}>{title}</button>
        ))}
      </nav>
      <span className="grow-space" />
      <DeviceMenu />
    </header>
  );
}

export function GameHeader() {
  const { game, pkg, device, view, setView, games, openGame, monitor, actionBusy, performGameAction, refreshApps, setStopped,
    sessionId, session, saveSession, newSession, viewGameSessions, reloadGames, stream } = useApp();
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState('');
  const info = useGameInfo();
  const t = useTracking();
  const badges = tabBadges(monitor);
  const running = info?.running ?? stream.running;
  const canAct = !!device && !!info?.installed && !actionBusy && !device?.replay;
  const busy = (a) => actionBusy === `${pkg}:${a}`;
  const remove = async () => {
    try { await api(`games/${game.id}`, { method: 'DELETE' }); setView('home'); await reloadGames(); }
    catch (e) { setError(e.message); }
  };

  return (
    <>
      <header className="topbar in-game">
        <button className="wordmark" onClick={() => setView('home')} aria-label="Back to library" title="Library">
          <Logo />
        </button>
        <Menu
          label="Game"
          align="left"
          className="chip-btn game-chip"
          trigger={<><GameIcon game={game} size={26} /><span className="chip-text"><strong>{game.name}</strong>{info?.installed && !info.replay && info.versionName && <span className="dim"> v{info.versionName}</span>}</span><Icon.caret /></>}
          items={[
            { label: 'Edit name & icon', onClick: () => setPanel('edit') },
            { label: 'Refresh version', onClick: refreshApps },
            { label: 'Stop game', onClick: () => performGameAction(pkg, 'stop'), hidden: !canAct || !running },
            games.length > 1 ? { sep: true } : null,
            games.length > 1 ? { heading: 'Switch game' } : null,
            ...games.filter((g) => g.packageId !== pkg).map((g) => ({ key: g.id, label: g.name, onClick: () => openGame(g.packageId) })),
            { sep: true },
            { label: 'Library', onClick: () => setView('home') },
            { label: 'Remove from library…', onClick: () => setPanel('remove'), danger: true },
          ]}
        />
        <DeviceMenu />
        <Menu
          label="Session"
          align="left"
          className={`chip-btn status-chip ${t.tone}`}
          trigger={<><span className={`dot ${t.tone}${t.live ? ' pulse' : ''}`} /><span className="chip-text">{t.live ? <>Live{session?.name && <span className="chip-extra"> · {session.name}</span>}</> : t.text}</span><Icon.caret /></>}
          items={[
            session ? { heading: `${session.name ?? 'Session'}${session.saved ? ' · saved' : ''}` } : null,
            { label: session?.saved ? 'Save latest' : 'Save session', onClick: saveSession, disabled: !sessionId || t.blocked === 'stopped', hidden: !session },
            { label: 'Start a new session', onClick: () => newSession('save'), hidden: !session },
            { label: 'Discard and start new', onClick: () => newSession('discard'), danger: true, hidden: !session },
            { label: 'Resume tracking', onClick: () => setStopped(false), hidden: t.blocked !== 'stopped' },
            session ? { sep: true } : null,
            { label: `History for ${game.name}`, onClick: () => viewGameSessions(pkg) },
          ]}
        />
        <span className="grow-space" />
        {device?.replay ? <span className="tag tag-plain">Replay</span> : running
          ? <button className="btn btn-sm" disabled={!canAct} onClick={() => performGameAction(pkg, 'restart')}><Icon.restart />{busy('restart') ? 'Restarting…' : 'Restart'}</button>
          : <button className="btn btn-sm btn-warm" disabled={!canAct} onClick={() => performGameAction(pkg, 'launch')}><Icon.play />{busy('launch') ? 'Starting…' : 'Start game'}</button>}
      </header>
      <nav className="tabs" aria-label="Tools">
        {TABS.map((tab) => {
          const active = view === tab.id || tab.also?.includes(view);
          const count = tab.badge ? badges[tab.badge] : 0;
          const Ico = Icon[tab.icon];
          return (
            <button key={tab.id} className={`tab${active ? ' act' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => setView(tab.id)}>
              <span className="tab-ico"><Ico /></span>
              <span className="tab-t">{tab.title}</span>
              <span className="tab-short">{tab.short ?? tab.title}</span>
              {count > 0 && <span className="tab-badge" aria-label={`${count} to look at`}>{count}</span>}
            </button>
          );
        })}
      </nav>
      {panel === 'edit' && <div className="header-panel"><GameEditor game={game} onDone={() => setPanel(null)} /></div>}
      {panel === 'remove' && (
        <div className="header-panel">
          <div className="card" style={{ padding: 20 }}>
            <p style={{ marginTop: 0 }}>Remove {game.name} from the library? The installed game and its saved sessions stay on this computer.</p>
            <div className="history-actions">
              <button className="btn btn-sm" onClick={remove}>Remove from library</button>
              <button className="linkish" onClick={() => setPanel(null)}>Cancel</button>
            </div>
            {error && <p role="alert" className="badc">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
