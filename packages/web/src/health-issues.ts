import type { Monitor } from "./types";

export interface HealthIssue {
  id: string;
  severity: string;
  name: string;
  detail?: string;
  count?: number;
  entryId?: number;
}
export function healthIssues(
  monitor: Monitor | null | undefined,
): HealthIssue[] {
  if (!monitor) return [];
  return [
    ...(monitor.health?.debugInRelease
      ? [
          {
            id: "debug-release",
            severity: "critical",
            name: "Plugin debug logging is on in a release build",
            detail: "Remove USE_AVNADS_PLUGIN_DEBUG before shipping.",
          },
        ]
      : []),
    ...(monitor.flags ?? [])
      .filter((f) => f.severity !== "info")
      .map((f) => ({
        id: f.id,
        severity: f.severity,
        name: f.name,
        detail: f.message,
        count: f.count,
        entryId: f.entryId,
      })),
    ...(monitor.adRules?.checks ?? [])
      .filter((c) => c.status === "problem" || c.status === "warn")
      .map((c) => ({
        id: `ad:${c.id}`,
        severity: "warning",
        name: c.name,
        detail: `${c.result}${c.key ? ` · ${c.key}=${String(c.value ?? "")}` : ""}`,
      })),
    ...(monitor.privacy ?? [])
      .filter((c) => c.status === "problem" || c.status === "warn")
      .map((c) => ({
        id: `pv:${c.id}`,
        severity: "warning",
        name: c.name,
        detail: c.result,
      })),
  ].sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical"),
  );
}
