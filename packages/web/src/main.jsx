import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { AppProvider, useApp } from './state.jsx';
import { ToastProvider } from '@avn/ui';
import { PlayLensShell, ToastBridge } from './components/AppShell.jsx';
import { PageTransition } from './components/PageTransition.jsx';
import { Game, GameSessions } from './pages/Game.jsx';
import { Devices } from './pages/Devices.jsx';
import { Games } from './pages/Games.jsx';
import { Home } from './pages/Home.jsx';
import { Logs } from './pages/Logs.jsx';
import { Connect } from './pages/Connect.jsx';
import { Health } from './pages/Health.jsx';
import { Firebase, FirebaseSetup } from './pages/Firebase.jsx';
import { Checklist, ChecklistSetup } from './pages/Checklist.jsx';
import { SessionControls } from './components/SessionControls.jsx';
import { Sessions, SavedSession } from './pages/Sessions.jsx';
import { Performance } from './pages/Performance.jsx';
import { Snapshooter } from './pages/Snapshooter.jsx';
import { RemoteConfig } from './pages/RemoteConfig.jsx';

const PAGES = { snapshooter: Snapshooter, game: Game, 'game-sessions': GameSessions, devices: Devices, games: Games, sessions: Sessions, 'saved-session': SavedSession, logs: Logs, performance: Performance, health: Health, firebase: Firebase, 'firebase-setup': FirebaseSetup, 'remote-config': RemoteConfig, checklist: Checklist, 'checklist-setup': ChecklistSetup };

function App() {
  const { view, captureVersion, archivedId, serial, pkg, inGameWorkspace } = useApp();
  const Page = view === 'home' ? Home : view === 'connect' ? Connect : PAGES[view] ?? Home;
  const pageKey = view === 'saved-session' ? `${view}-${archivedId}` : inGameWorkspace ? `${view}-${pkg}` : view;
  return <PlayLensShell>
    {inGameWorkspace && view !== 'saved-session' && <div className="pl-session"><SessionControls key={`controls-${captureVersion}`} /></div>}
    <PageTransition pageKey={pageKey}>
      <Page key={view === 'saved-session' ? `saved-${archivedId}` : view === 'snapshooter' ? `snapshots-${pkg}` : view === 'game' ? `game-${pkg}` : ['home', 'connect', 'devices', 'games', 'sessions'].includes(view) ? view : view.endsWith('-setup') ? `setup-${view}-${serial}-${pkg}` : `page-${view}-${captureVersion}`} />
    </PageTransition>
    <ToastBridge />
  </PlayLensShell>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider><AppProvider>
      <App />
    </AppProvider></ToastProvider>
  </StrictMode>,
);
