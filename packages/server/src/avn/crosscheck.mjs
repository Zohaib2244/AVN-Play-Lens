// Cross-check: events the AVN plugin handed to Firebase vs events Firebase logged.
// Firebase (FA lines) is the source of truth for the events view. The plugin lines
// are a second opinion that catches "sent but not recorded".
//
// Inputs are timestamped events in arrival order:
//   plugin: { ts, name }   from status lines with event.stage 'handed' or 'sent' (parse.mjs)
//   fa:     { ts, name }   from parseFaLine (fa.mjs), automatic events excluded
// Results:
//   matched        plugin event with a Firebase line for the same name within the window
//   notLogged      plugin says it was handed over, Firebase never logged it  -> warning
//   pending        still inside the window, no verdict yet
//   firebaseOnly   Firebase logged it, plugin has no line (game code calling Firebase directly) -> info only

export function crossCheck(plugin, fa, { windowMs = 5000, now = Infinity } = {}) {
  const used = new Set();
  const matched = [];
  const notLogged = [];
  const pending = [];

  for (const p of plugin) {
    const hit = fa.findIndex((f, i) => !used.has(i) && f.name === p.name && f.ts >= p.ts - 1000 && f.ts <= p.ts + windowMs);
    if (hit >= 0) {
      used.add(hit);
      matched.push({ plugin: p, fa: fa[hit], delayMs: fa[hit].ts - p.ts });
    } else if (now - p.ts < windowMs) {
      pending.push(p);
    } else {
      notLogged.push(p);
    }
  }
  const firebaseOnly = fa.filter((_, i) => !used.has(i));
  return { matched, notLogged, pending, firebaseOnly };
}
