import { useApp } from '../state.jsx';
export function GamePicker({ className = 'select', id, ...rest }) {
  const { games, pkg, openGame } = useApp();
  return <select id={id} className={className} value={pkg || ''} onChange={(e) => openGame(e.target.value)} aria-label="Game" {...rest}>
    <option value="" disabled>Choose a registered game</option>{games.map((g) => <option key={g.id} value={g.packageId}>{g.name}</option>)}
  </select>;
}
