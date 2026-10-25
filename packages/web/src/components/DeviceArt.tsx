const assignments = new Map<string, number>();
function deviceVariant(id: string) {
  if (assignments.has(id)) return assignments.get(id)!;
  let variant: number;
  try {
    const stored = localStorage.getItem(`playlens.device-art.${id}`);
    variant =
      stored === null
        ? crypto.getRandomValues(new Uint32Array(1))[0] % 4
        : Number(stored) % 4;
    localStorage.setItem(`playlens.device-art.${id}`, String(variant));
  } catch {
    variant = Math.floor(Math.random() * 4);
  }
  assignments.set(id, variant);
  return variant;
}

/** A phone keeps its randomly assigned pixel illustration across reconnects. */
export function DeviceArt({
  id,
  replay = false,
}: {
  id: string;
  replay?: boolean;
}) {
  const variant = deviceVariant(id);
  return (
    <svg
      className={`pl-device-art variant-${variant}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path fill="var(--raise)" d="M4 4h40v40H4z" />
      <path fill="var(--text)" d="M14 7h20v3h3v30h-3v3H14v-3h-3V10h3z" />
      <path fill="var(--panel)" d="M15 11h18v27H15z" />
      <path fill="var(--dim)" d="M21 9h6v2h-6zM22 39h4v2h-4z" />
      <g
        fill={
          replay
            ? "var(--dim)"
            : ["var(--accent)", "var(--info)", "var(--ok)", "var(--warn)"][
                variant
              ]
        }
      >
        {replay ? (
          <path d="M21 19v12l9-6z" />
        ) : variant === 0 ? (
          <path d="M18 27h3v-6h6v3h3v9H18zM24 16h3v3h-3z" />
        ) : variant === 1 ? (
          <path d="M18 17h12v3H18zM18 23h9v3h-9zM18 29h12v3H18z" />
        ) : variant === 2 ? (
          <path d="M21 17h6v6h6v6h-6v6h-6v-6h-6v-6h6z" />
        ) : (
          <path d="M18 18h3v3h6v-3h3v9h-3v6h-6v-6h-3z" />
        )}
      </g>
    </svg>
  );
}
