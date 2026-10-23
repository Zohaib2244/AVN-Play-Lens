/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Formats a number with thousands separators and a fixed number of decimals. */
export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Seconds as "1m 12s" or "52s". */
export function secs(t: number): string {
  return t >= 60 ? `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s` : `${t}s`;
}

/** "just now", "2 min ago", "3 h ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A readable step for chart axes: 1, 2, 5 times a power of ten. */
export function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
