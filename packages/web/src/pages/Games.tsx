import { GameLibrary } from "../components/GameLibrary";
import { PageHead } from "../components/bits";
export function Games() {
  return (
    <main className="content">
      <PageHead
        title="Game library"
        sub="Manage package IDs, installed builds and game sessions."
      />
      <GameLibrary />
    </main>
  );
}
