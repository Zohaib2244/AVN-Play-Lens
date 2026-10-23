export const VIEWS = [
  "home",
  "connect",
  "games",
  "devices",
  "sessions",
  "saved-session",
  "game",
  "game-sessions",
  "logs",
  "performance",
  "health",
  "firebase",
  "firebase-setup",
  "remote-config",
  "checklist",
  "checklist-setup",
  "snapshooter",
] as const;
export type View = (typeof VIEWS)[number];
export interface ViewSearch extends Record<string, unknown> {
  view: View;
  game?: string;
  session?: string;
  density?: "compact" | "comfort";
}
export const isView = (value: unknown): value is View =>
  typeof value === "string" && (VIEWS as readonly string[]).includes(value);
export function validateSearch(search: Record<string, unknown>): ViewSearch {
  const out: ViewSearch = {
    ...search,
    view: isView(search.view) ? search.view : "home",
  };
  out.game = typeof search.game === "string" ? search.game : undefined;
  out.session = typeof search.session === "string" ? search.session : undefined;
  out.density =
    search.density === "compact" || search.density === "comfort"
      ? search.density
      : undefined;
  return out;
}
