import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { AppProvider, useApp } from './state.jsx';
import { Toast } from './components/bits.jsx';
import { AppHeader, GameHeader } from './components/Header.jsx';
import { GameSessions } from './pages/Game.jsx';
import { Devices } from './pages/Devices.jsx';
import { Home } from './pages/Home.jsx';
import { Logs } from './pages/Logs.jsx';
import { Connect } from './pages/Connect.jsx';
import { Health } from './pages/Health.jsx';
import { Firebase, FirebaseSetup } from './pages/Firebase.jsx';
import { Checklist, ChecklistSetup } from './pages/Checklist.jsx';
import { Sessions, SavedSession } from './pages/Sessions.jsx';
import { Performance } from './pages/Performance.jsx';

const PAGES = { home: Home, 'game-sessions': GameSessions, devices: Devices, sessions: Sessions, 'saved-session': SavedSession, logs: Logs, performance: Performance, health: Health, firebase: Firebase, 'firebase-setup': FirebaseSetup, checklist: Checklist, 'checklist-setup': ChecklistSetup };

function App() {
  const { view, captureVersion, archivedId, serial, pkg, inGameWorkspace } = useApp();
  if (view === 'connect') return <><Connect /><Toast /></>;
  const Page = PAGES[view] ?? (inGameWorkspace ? Logs : Home);
  const live = ['logs', 'performance', 'health', 'firebase', 'checklist'].includes(view);
  return (
    <div className={`shell${inGameWorkspace ? ' with-tabs' : ''}`}>
      {inGameWorkspace ? <GameHeader key={pkg} /> : <AppHeader />}
      <div className="page">
        <Page key={view === 'saved-session' ? `saved-${archivedId}` : view.endsWith('-setup') ? `setup-${view}-${serial}-${pkg}` : live ? `page-${view}-${captureVersion}` : view} />
      </div>
      <Toast />
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
