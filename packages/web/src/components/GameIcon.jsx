export function GameIcon({ game, size = 64 }) {
  return <span className="game-icon" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
    {game.icon ? <img src={game.icon} alt={`${game.name} icon`} /> : <span className="px game-initials" aria-hidden="true">{game.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</span>}
  </span>;
}
