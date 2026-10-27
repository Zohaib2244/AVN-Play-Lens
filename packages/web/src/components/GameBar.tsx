import { Button, Icon } from "@avn/ui";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { deviceName, useApp } from "../state";
import { GameEditor } from "./GameEditor";
import { GameIcon } from "./GameIcon";
import { Menu } from "./ui";
import { useBuildState } from "../use-build-state";
import { DialogShell } from "@avn/ui";
import { useTracking, type Tracking } from "./TrackingGate";

// The game's one header row: the game, the phone, the capture session and the main action.
// It replaces the old overview page, so tracking status is shown here and nowhere else.
export function GameBar() {
  const {
    game,
    pkg,
    device,
    devices,
    serial,
    selectDevice,
    setView,
    online,
    gameInventory,
    actionBusy,
    performGameAction,
    refreshApps,
    reloadGames,
    setStopped,
    stream,
    session,
    sessionId,
    saveSession,
    newSession,
    viewGameSessions,
  } = useApp();
  const builds = useBuildState(game?.id);
  const activeInstall = builds.data?.jobs?.find((job) =>
    job.gameId === game?.id && (job.status === "running" || job.status === "queued"),
  );
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const info =
    gameInventory.serial === serial
      ? (gameInventory.games.find((g) => g.packageId === pkg) ?? null)
      : null;
  const t: Tracking = useTracking();
  const running = info?.running ?? stream.running;
  const canAct =
    !!device && !!info?.installed && !actionBusy && !device?.replay;
  const busy = (action: string) => actionBusy === `${pkg}:${action}`;
  const ready = devices.filter((d) => d.state === "device");
  if (!game) return null;

  const remove = async () => {
    try {
      await api(`games/${game.id}`, { method: "DELETE" });
      setRemoving(false);
      setView("home");
      await reloadGames();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="game-bar" aria-label={`${game.name} controls`}>
      <Menu
        label="Game"
        className="game-bar-chip"
        align="start"
        trigger={
          <>
            {activeInstall && <span className="spinner sm" aria-hidden="true" />}
            <GameIcon game={game} size={26} />
            <span className="game-bar-text">
              <strong>{game.name}</strong>
              {info?.installed && !device?.replay && info.versionName && (
                <span className="dim"> v{info.versionName}</span>
              )}
            </span>
            <Icon name="caret" />
          </>
        }
        items={[
          { label: "Edit name & icon", onClick: () => setEditing(true) },
          { label: "Refresh version", onClick: refreshApps },
          { label: "Builds & install", onClick: () => setView("builds") },
          {
            label: "Stop game",
            onClick: () => performGameAction(pkg ?? "", "stop"),
            hidden: !canAct || !running,
          },
          { sep: true },
          { label: "Library", onClick: () => setView("home") },
          {
            label: "Remove from library…",
            danger: true,
            onClick: () => setRemoving(true),
          },
        ]}
      />
      {activeInstall && (
        <Button
          size="sm"
          variant="ghost"
          className="game-bar-install"
          aria-label={`${activeInstall.status === "queued" ? "Install queued" : "Installing"} on ${activeInstall.device}. View install details`}
          onClick={() => setView("builds")}
        >
          <span role="status">
            {activeInstall.status === "queued" ? "Install queued" : "Installing"} · {activeInstall.device}
          </span>
        </Button>
      )}
      <Menu
        label="Phone"
        className="game-bar-chip"
        align="start"
        trigger={
          <>
            <span className={`dot ${device ? "ok" : "warn"}`} />
            <span className="game-bar-text">
              {device ? deviceName(device) : online ? "No phone" : "Starting…"}
            </span>
            <Icon name="caret" />
          </>
        }
        items={[
          ready.length ? { heading: "Use phone" } : null,
          ...ready.map((d) => ({
            label: deviceName(d),
            pressed: d.serial === serial,
            onClick: () => selectDevice(d),
          })),
          ready.length ? { sep: true } : null,
          { label: "Connect a phone…", onClick: () => setView("connect") },
          { label: "Manage devices", onClick: () => setView("devices") },
        ]}
      />
      <Menu
        label="Session"
        className={`game-bar-chip status-chip ${t.tone}`}
        align="start"
        trigger={
          <>
            <span className={`dot ${t.tone}${t.live ? " pulse" : ""}`} />
            <span className="game-bar-text">{t.text}</span>
            <Icon name="caret" />
          </>
        }
        items={[
          session
            ? {
                heading: `${session.name ?? "Session"}${session.saved ? " · saved" : ""}`,
              }
            : null,
          {
            label: session?.saved ? "Save latest" : "Save session",
            onClick: saveSession,
            disabled: !sessionId || t.blocked === "stopped",
            hidden: !session,
          },
          {
            label: "Start a new session",
            onClick: () => newSession("save"),
            hidden: !session,
          },
          {
            label: "Discard and start new",
            danger: true,
            onClick: () => newSession("discard"),
            hidden: !session,
          },
          {
            label: "Resume tracking",
            onClick: () => setStopped(false),
            hidden: t.blocked !== "stopped",
          },
          session ? { sep: true } : null,
          {
            label: `History for ${game.name}`,
            onClick: () => viewGameSessions(pkg ?? "__all"),
          },
        ]}
      />
      <span className="game-bar-end">
        {device?.replay ? (
          <span className="tag tag-plain">Replay</span>
        ) : running ? (
          <Button
            size="sm"
            disabled={!canAct}
            loading={busy("restart")}
            loadingLabel="Restarting…"
            onClick={() => performGameAction(pkg ?? "", "restart")}
          >
            <Icon name="refresh" /> Restart
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!canAct}
            loading={busy("launch")}
            loadingLabel="Starting…"
            onClick={() => performGameAction(pkg ?? "", "launch")}
          >
            <svg
              className="ic"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 4l12 8-12 8z" />
            </svg> Start game
          </Button>
        )}
      </span>
      <DialogShell open={editing} onOpenChange={setEditing} title="Edit game">
        <GameEditor game={game} onDone={() => setEditing(false)} />
      </DialogShell>
      <DialogShell
        open={removing}
        onOpenChange={setRemoving}
        title="Remove from library"
      >
        <p>
          Remove {game.name} from the library? The installed game and its saved
          sessions stay on this computer.
        </p>
        {error && (
          <p role="alert" className="badc">
            {error}
          </p>
        )}
        <div className="row-wrap">
          <Button variant="danger" onClick={remove}>
            Remove from library
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      </DialogShell>
    </div>
  );
}
