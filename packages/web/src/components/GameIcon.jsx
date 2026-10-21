export function GameIcon({ game, size = 64, paused = false }) {
  return <span className="game-icon" style={{ width: size, height: size }}>
    {game.icon ? <img src={game.icon} alt={`${game.name} icon`} /> : <span className="px game-initials" aria-hidden="true">{game.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</span>}
    {paused && <span className="icon-pause" aria-label="Tracking paused" title="Tracking paused">Ⅱ</span>}
  </span>;
}
