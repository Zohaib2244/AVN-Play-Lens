import { PlayLensShell, ToastBridge } from "./components/AppShell";
import { PageTransition } from "./components/PageTransition";
import { Checklist, ChecklistSetup } from "./pages/Checklist";
import { Connect } from "./pages/Connect";
import { Devices } from "./pages/Devices";
import { Firebase, FirebaseSetup } from "./pages/Firebase";
import { Game, GameSessions } from "./pages/Game";
import { Games } from "./pages/Games";
import { Health } from "./pages/Health";
import { Home } from "./pages/Home";
import { Logs } from "./pages/Logs";
import { Performance } from "./pages/Performance";
import { QARuns } from "./pages/QARuns";
import { RemoteConfig } from "./pages/RemoteConfig";
import { SavedSession, Sessions } from "./pages/Sessions";
import { Snapshooter } from "./pages/Snapshooter";
import { useApp } from "./state";

const PAGES = {
  snapshooter: Snapshooter,
  game: Game,
  "game-sessions": GameSessions,
  devices: Devices,
  games: Games,
  sessions: Sessions,
  "saved-session": SavedSession,
  logs: Logs,
  performance: Performance,
  health: Health,
  firebase: Firebase,
  "firebase-setup": FirebaseSetup,
  "remote-config": RemoteConfig,
  checklist: Checklist,
  "checklist-setup": ChecklistSetup,
  qa: QARuns,
};

export function App() {
  const { view, captureVersion, archivedId, serial, pkg, inGameWorkspace } =
    useApp();
  const Page =
    view === "home"
      ? Home
      : view === "connect"
        ? Connect
        : (PAGES[view] ?? Home);
  const pageKey =
    view === "saved-session"
      ? `${view}-${archivedId}`
      : inGameWorkspace
        ? `${view}-${pkg}`
        : view;
  return (
    <PlayLensShell>
      <PageTransition pageKey={pageKey}>
        <Page
          key={
            view === "saved-session"
              ? `saved-${archivedId}`
              : view === "snapshooter"
                ? `snapshots-${pkg}`
                : view === "game"
                  ? `game-${pkg}`
                  : view === "qa"
                    ? `qa-${pkg}`
                  : [
                        "home",
                        "connect",
                        "devices",
                        "games",
                        "sessions",
                      ].includes(view)
                    ? view
                    : view.endsWith("-setup")
                      ? `setup-${view}-${serial}-${pkg}`
                      : `page-${view}-${captureVersion}`
          }
        />
      </PageTransition>
      <ToastBridge />
    </PlayLensShell>
  );
}
