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
import { Rail, Toast } from './components/bits.jsx';
import { Home } from './pages/Home.jsx';
import { Logs } from './pages/Logs.jsx';
import { Connect } from './pages/Connect.jsx';
import { Health } from './pages/Health.jsx';
import { Firebase, FirebaseSetup } from './pages/Firebase.jsx';
import { Checklist, ChecklistSetup } from './pages/Checklist.jsx';
import { Performance } from './pages/Performance.jsx';

const PAGES = { logs: Logs, performance: Performance, health: Health, firebase: Firebase, 'firebase-setup': FirebaseSetup, checklist: Checklist, 'checklist-setup': ChecklistSetup };

function App() {
  const { view } = useApp();
  if (view === 'connect') return <><Connect /><Toast /></>;
  if (view === 'home') return <><Home /><Toast /></>;
  const Page = PAGES[view] ?? Logs;
  return (
    <div className="shell">
      <Rail />
      <Page />
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
