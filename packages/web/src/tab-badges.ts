import type { Monitor } from "./types";

// Counts of things to look at, per tool tab. Nothing here means nothing to do.
export function tabBadges(monitor: Monitor | null | undefined) {
  if (!monitor) return { health: 0, firebase: 0, checklist: 0 };
  const health =
    (monitor.flags ?? []).filter((f) => f.severity !== "info").length +
    (monitor.adRules?.checks ?? []).filter((c) => c.status === "problem")
      .length +
    (monitor.privacy ?? []).filter((c) => c.status === "problem").length;
  const firebase = monitor.firebase?.counts?.notLogged ?? 0;
  const checklist = (monitor.run?.items ?? []).filter(
    (i) => i.status === "problem",
  ).length;
  return { health, firebase, checklist };
}
