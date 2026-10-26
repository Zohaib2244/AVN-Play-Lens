import type { NavItem } from "@avn/ui";

export const LIBRARY: NavItem[] = [
  { id: "home", label: "Game library", icon: "grid" },
  { id: "devices", label: "Devices", icon: "link" },
];
// The five tool tabs of a game: the sidebar on wide screens, the bottom bar on narrow ones.
export const GAME_TABS: NavItem[] = [
  { id: "logs", label: "Logs", icon: "term" },
  { id: "performance", label: "Performance", icon: "pulse" },
  { id: "health", label: "Health", icon: "shield" },
  { id: "firebase", label: "Events", icon: "flame" },
  { id: "checklist", label: "Checklist", icon: "checklist" },
];
export const TOOLS: NavItem[] = [
  { id: "snapshooter", label: "Level Snapshooter", icon: "grid" },
  { id: "remote-config", label: "Remote Config (RC)", icon: "sliders" },
  { id: "qa", label: "QA runs", icon: "shield" },
  { id: "builds", label: "Builds & install", icon: "down" },
];
