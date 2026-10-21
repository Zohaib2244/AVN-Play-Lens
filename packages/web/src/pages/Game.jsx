import { useApp } from '../state.jsx';
import { PageHead } from '../components/bits.jsx';
import { SessionHistory } from '../components/SessionHistory.jsx';
export function GameSessions() {
  const { game, pkg, viewGameSessions } = useApp();
  return <main className="main">
    <PageHead title="History" sub={`Saved sessions for ${game?.name ?? 'this game'}`}><button className="linkish" onClick={() => viewGameSessions('__all')}>All games</button></PageHead>
    <SessionHistory packageFilter={pkg} groupByGame={false} />
  </main>;
}
