import { GameLibrary } from '../components/GameLibrary.jsx';
import { PageHead } from '../components/bits.jsx';
export function Games() {
  return <main className="main"><PageHead title="Game library" sub="Manage package IDs, installed builds and game sessions." /><GameLibrary /></main>;
}
