import type { ReactNode } from "react";
import { useApp } from "../state";
import { PageHead } from "./bits";

export interface Tracking {
  tone: "" | "ok" | "warn" | "bad";
  text: string;
  live?: boolean;
  blocked?: "no-device" | "not-installed" | "stopped" | "ended";
}

// One answer to "is PlayLens collecting right now, and if not, why".
export function useTracking(): Tracking {
  const {
    online,
    device,
    stopped,
    stream,
    session,
    gameInventory,
    serial,
    pkg,
  } = useApp();
  const info =
    gameInventory.serial === serial
      ? (gameInventory.games.find((g) => g.packageId === pkg) ?? null)
      : null;
  if (!online) return { tone: "", text: "Reconnecting…" };
  if (!device) return { tone: "warn", text: "No phone", blocked: "no-device" };
  if (!info) return { tone: "", text: "Checking…" };
  if (!info.installed)
    return { tone: "warn", text: "Not installed", blocked: "not-installed" };
  if (stopped) return { tone: "", text: "Stopped", blocked: "stopped" };
  if (stream.state === "live")
    return {
      tone: "ok",
      text: session?.name ? `Live · ${session.name}` : "Live",
      live: true,
    };
  if (stream.state === "ended" || stream.state === "error")
    return { tone: "bad", text: "Log ended", blocked: "ended" };
  if (stream.state === "paused") return { tone: "", text: "Paused" };
  return { tone: "", text: "Starting…" };
}

// A tool page's empty state when collection is stopped or has ended, instead of loading forever.
// No phone or uninstalled game is explained by the page itself. Call after the page's own hooks;
// returns null when the page should render normally.
export function useTrackingGate(title: string, hasData: boolean): ReactNode {
  const { stream } = useApp();
  const t = useTracking();
  if (hasData) return null;
  let reason: { title: string; body: string } | null = null;
  if (t.blocked === "stopped")
    reason = {
      title: "Tracking is stopped",
      body: "Start the game from the top bar to collect again.",
    };
  else if (t.blocked === "ended")
    reason = {
      title: "The log stopped",
      body: stream.reason || "Restart the game to start a fresh log.",
    };
  if (!reason) return null;
  return (
    <main className="main">
      <PageHead title={title} />
      <div className="card empty">
        <div className="empty-title">{reason.title}</div>
        <div>{reason.body}</div>
      </div>
    </main>
  );
}
