import type { NavItem } from "@avn/ui";

export const LIBRARY: NavItem[] = [
  { id: "home", label: "Game library", icon: "grid" },
  { id: "devices", label: "Devices", icon: "link" },
];
export const MAIN: NavItem[] = [
  { id: "game", label: "Overview", icon: "home" },
  { id: "health", label: "Plugin health", icon: "shield" },
];
export const INSPECT: NavItem[] = [
  { id: "logs", label: "Logs", icon: "term" },
  { id: "firebase", label: "Events (Firebase)", icon: "flame" },
  { id: "remote-config", label: "Remote Config (RC)", icon: "sliders" },
];
export const TOOLS: NavItem[] = [
  { id: "snapshooter", label: "Level Snapshooter", icon: "grid" },
  { id: "checklist", label: "Checklist Verifier", icon: "checklist" },
  { id: "performance", label: "Performance", icon: "pulse" },
];
