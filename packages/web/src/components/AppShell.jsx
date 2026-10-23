import { useEffect, useRef, useState } from 'react';
import {
  AppShell, Sidebar, SidebarNav, Brand, Workspace, TopBar, TabBar,
  SearchButton, CommandPalette, DialogShell, ShortcutsDialog, NotificationList,
  Icon, Tag, useToast, Button, Segmented,
} from '@avn/ui';
import { useApp, deviceName } from '../state.jsx';
import { GameIcon } from './GameIcon.jsx';

const LIBRARY = [
  { id: 'home', label: 'Game library', icon: 'grid' },
  { id: 'sessions', label: 'Saved sessions', icon: 'book' },
  { id: 'devices', label: 'Devices', icon: 'link' },
];
const INSPECT = [
  { id: 'game', label: 'Overview', icon: 'home' },
  { id: 'logs', label: 'Logs', icon: 'term' },
  { id: 'performance', label: 'Performance', icon: 'pulse' },
  { id: 'health', label: 'Plugin health', icon: 'shield' },
];
const DATA = [
  { id: 'firebase', label: 'Firebase events', icon: 'flame' },
  { id: 'remote-config', label: 'Remote Config', icon: 'sliders' },
  { id: 'checklist', label: 'Checklist', icon: 'checklist' },
  { id: 'snapshooter', label: 'Level Snapshooter', icon: 'grid' },
  { id: 'game-sessions', label: 'Game sessions', icon: 'book' },
];
const EXTRA = [{ id: 'connect', label: 'Connect a device', icon: 'link' }];
const ALL_PAGES = [...LIBRARY, ...INSPECT, ...DATA, ...EXTRA];

function readPreference(key, fallback) {
  try { return localStorage.getItem(`playlens.${key}`) || fallback; } catch { return fallback; }
}

export function PlayLensShell({ children }) {
  const { view, setView, game, games, openGame, inGameWorkspace, device, online, stopped, stream, monitor, viewGameSessions, refreshApps, reloadGames, archiveReturn } = useApp();
  const { toast, unread, markAllRead } = useToast();
  const [command, setCommand] = useState(false);
  const [more, setMore] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [settings, setSettings] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(() => readPreference('theme', 'dark'));
  const [palette, setPalette] = useState(() => readPreference('palette', 'nutmeg'));
  const [density, setDensity] = useState(() => readPreference('density', 'compact'));
  const [refreshing, setRefreshing] = useState(false);
  const content = useRef(null);
  const active = view.endsWith('-setup') ? view.replace('-setup', '') : view === 'saved-session' ? archiveReturn : view;
  const current = ALL_PAGES.find((p) => p.id === active)?.label || 'Saved session';
  const live = inGameWorkspace && !stopped && stream.state === 'live';
  const groups = inGameWorkspace
    ? [{ label: 'Inspect', items: INSPECT.map((p) => p.id === 'health' ? { ...p, count: monitor?.flags?.filter((f) => f.severity !== 'info').length } : p) }, { label: 'Test & capture', items: DATA }, { label: 'Library', items: LIBRARY }]
    : [{ label: 'Workspace', items: LIBRARY }, { label: 'Get started', items: EXTRA }];
  const tabs = inGameWorkspace
    ? ['logs', 'performance', 'health', 'checklist'].map((id) => ALL_PAGES.find((p) => p.id === id))
    : LIBRARY;
  const select = (id) => { if (id === 'sessions') viewGameSessions('__all'); else if (id === 'game-sessions') viewGameSessions(game.packageId); else setView(id); };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    try { localStorage.setItem('playlens.theme', theme); localStorage.setItem('playlens.palette', palette); localStorage.setItem('playlens.density', density); } catch { /* storage may be unavailable */ }
  }, [theme, palette, density]);
  useEffect(() => {
    document.title = `${current}${game && inGameWorkspace ? ` · ${game.name}` : ''} · AVN PlayLens`;
  }, [view, current, game?.name, inGameWorkspace]);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setCommand((s) => !s); }
      if (e.key === '/') { e.preventDefault(); setShortcuts((s) => !s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try { await reloadGames(); refreshApps(); } finally { setRefreshing(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ kind: 'ok', title: 'View link copied' }); }
    catch { toast({ kind: 'bad', title: 'Could not copy the link', message: 'Copy the address from your browser.', action: { label: 'Retry', onClick: copyLink } }); }
  };
  const commands = [
    ...[...LIBRARY, ...EXTRA, ...(inGameWorkspace ? [...INSPECT, ...DATA] : [])].map((p) => ({ ...p, group: 'Pages', run: () => select(p.id) })),
    ...games.map((g) => ({ id: g.id, label: g.name, icon: 'pad', hint: g.packageId, group: 'Games', run: () => openGame(g.packageId) })),
    { id: 'appearance', label: 'Appearance and density', icon: 'sliders', group: 'Actions', run: () => setSettings(true) },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'book', group: 'Actions', run: () => setShortcuts(true) },
  ];
  return <AppShell className="playlens-app" density={density}
    sidebar={<Sidebar>
      <Brand mark={<img src="/avn-style/styles/avn-family/icons/avn-playlens.svg" alt="" width="28" height="28" />} name="AVN PlayLens" onClick={() => setView('home')} />
      <button className="game" title={game && inGameWorkspace ? `Switch game: ${game.name}` : 'Choose a game'} onClick={() => { setQuery(''); setSwitcher(true); }}>
        <GameIcon game={inGameWorkspace ? game : { name: 'Games' }} size={30} />
        <span className="pl-game-label"><b>{inGameWorkspace ? game.name : 'Your games'}</b><small>{inGameWorkspace ? game.packageId : 'Choose a workspace'}</small></span><Icon name="caret" />
      </button>
      <SidebarNav groups={groups} active={active} onSelect={select} label="PlayLens views" />
      <div className="pl-sidebar-foot"><span className={`pl-connection ${online ? 'connected' : ''}`} /><span>{online ? 'Local server online' : 'Reconnecting…'}</span></div>
      <button className="acct-btn" title="Appearance and density" onClick={() => setSettings(true)}><span className="av"><Icon name="sliders" /></span><div><b>Your workspace</b><small>Appearance & density</small></div></button>
    </Sidebar>}
    tabbar={<TabBar items={tabs} active={active} onSelect={select} moreItems onMore={() => setMore(true)} />}>
    <Workspace>
      <TopBar crumbs={[{ label: 'Games', onClick: () => setView('home') }, ...(inGameWorkspace ? [{ label: game.name, onClick: () => setView('game') }] : []), ...(view !== 'home' ? [{ label: current }] : [])]}
        mobileTitle={<><img src="/avn-style/styles/avn-family/icons/avn-playlens.svg" alt="" width="24" height="24" /><b>{current}</b></>}
        tools={<><SearchButton onClick={() => setCommand(true)} /><button className="icon-btn" title="Refresh game library and installed versions" aria-label="Refresh game library and installed versions" disabled={refreshing} onClick={refresh}><Icon name="refresh" /></button><button className="icon-btn pl-copy" title="Copy view link" aria-label="Copy view link" onClick={copyLink}><Icon name="link" /></button><button className="icon-btn" title="Notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => { markAllRead(); setNotifications(true); }}><Icon name="bell" />{unread > 0 && <span className="pl-unread">{unread}</span>}</button></>} />
      <div className="pl-scroll" ref={content} id="workspace-content" tabIndex={-1}>
        {!online && <div className="banner" role="status"><Icon name="alert" /><span>Connection lost. Your capture stays on this computer. Reconnecting automatically…</span></div>}
        {view !== 'home' && <div className="pl-context"><span className={`tag ${device?.replay ? 'plain' : live ? 'ok' : 'info'}`}>{device?.replay ? 'Demo replay' : live ? 'Live capture' : device ? 'Device ready' : 'No device'}</span><span>{device ? deviceName(device) : 'Connect an Android phone to test a build'}</span><span className="pl-context-end">{device?.replay ? 'Simulated evidence · no live phone' : live ? 'Collecting this game only' : 'Tracking paused'}</span></div>}
        {children}
      </div>
    </Workspace>
    <DialogShell open={switcher} onOpenChange={setSwitcher} title="Switch game">
      <input className="pl-input" aria-label="Find a game" placeholder="Find a game or package…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="pl-switch-list">{games.filter((g) => `${g.name} ${g.packageId}`.toLowerCase().includes(query.toLowerCase())).map((g) => <button className="game" key={g.id} onClick={() => { openGame(g.packageId); setSwitcher(false); }}><GameIcon game={g} size={32} /><span><b>{g.name}</b><small>{g.packageId}</small></span></button>)}{!games.length && <p className="muted">Register your first game in the library.</p>}</div>
      <Button onClick={() => { setView('home'); setSwitcher(false); }}>Open game library</Button>
    </DialogShell>
    <DialogShell open={more} onOpenChange={setMore} title="More pages">
      <div className="pl-more-list">{groups.map((g) => <section key={g.label}><span className="eyebrow">{g.label}</span>{g.items.map((p) => <button key={p.id} className="ni" onClick={() => { select(p.id); setMore(false); }}><Icon name={p.icon} /><span>{p.label}</span></button>)}</section>)}<button className="ni" onClick={() => { setMore(false); setSettings(true); }}><Icon name="sliders" />Appearance & density</button><Button onClick={() => setMore(false)}>Close</Button></div>
    </DialogShell>
    <DialogShell open={settings} onOpenChange={setSettings} title="Make yourself at home">
      <div className="pl-settings"><label>Theme</label><Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        <label htmlFor="palette">Palette</label><select id="palette" className="select" value={palette} onChange={(e) => setPalette(e.target.value)}>{['nutmeg', 'slate', 'moss', 'hibiscus', 'white'].map((p) => <option value={p} key={p}>{p === 'white' ? 'White build' : p[0].toUpperCase() + p.slice(1)}</option>)}</select>
        <label>Data density</label><Segmented label="Data density" value={density} onChange={setDensity} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfort', label: 'Roomy' }]} />
        <Button variant="ghost" onClick={() => { setSettings(false); setShortcuts(true); }}>Keyboard shortcuts</Button><Button onClick={() => setSettings(false)}>Done</Button></div>
    </DialogShell>
    <DialogShell open={notifications} onOpenChange={setNotifications} title="Notifications"><NotificationList /><Button onClick={() => setNotifications(false)}>Close</Button></DialogShell>
    <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} shortcuts={[{ keys: ['Ctrl', 'K'], label: 'Search games, pages and actions' }, { keys: ['Ctrl', '/'], label: 'Keyboard shortcuts' }, { keys: ['Ctrl', 'Space'], label: 'Pause or resume the log view' }, { keys: ['Esc'], label: 'Close the current dialog' }]} />
    {command && <CommandDialog items={commands} onClose={() => setCommand(false)} />}
  </AppShell>;
}

function CommandDialog({ items, onClose }) {
  const host = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement;
    host.current?.querySelector('input')?.focus();
    const trap = (e) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab') return;
      const nodes = [...host.current.querySelectorAll('input,button:not(:disabled)')];
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const node = host.current;
    node?.addEventListener('keydown', trap);
    return () => { node?.removeEventListener('keydown', trap); trigger?.focus(); };
  }, []);
  return <div ref={host}><CommandPalette open onClose={onClose} items={items} /></div>;
}

export function ToastBridge() {
  const { toast: incoming, setToast } = useApp();
  const { toast } = useToast();
  useEffect(() => {
    if (!incoming) return;
    toast({ kind: incoming.severity === 'critical' ? 'bad' : incoming.kind || 'info', title: incoming.title, message: incoming.msg, action: incoming.action });
    setToast(null);
  }, [incoming, toast, setToast]);
  return null;
}
