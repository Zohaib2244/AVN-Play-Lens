import {
  Button,
  DialogShell,
  Icon,
  PageHead,
  Panel,
  Tag,
  useToast,
} from "@avn/ui";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { GameEditor } from "../components/GameEditor";
import { GameIcon } from "../components/GameIcon";
import { SessionHistory } from "../components/SessionHistory";
import { Menu } from "../components/ui";
import { deviceName, useApp } from "../state";
import { healthIssues } from "../health-issues";

export function Game() {
  const app = useApp();
  const {
    game,
    gameInventory,
    serial,
    device,
    pkg,
    setView,
    performGameAction,
    actionBusy,
    refreshApps,
    stopped,
    setStopped,
    reloadGames,
    monitor,
    stream,
  } = app;
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  if (!game)
    return (
      <main className="content">
        <Panel title="Choose a game">
          <p className="muted">Open a registered game from your library.</p>
          <Button onClick={() => setView("home")}>Open game library</Button>
        </Panel>
      </main>
    );
  const info =
    gameInventory.serial === serial
      ? gameInventory.games.find((g) => g.id === game.id)
      : null;
  const disabled =
    !device || !info?.installed || !!actionBusy || device?.replay;
  const issues = healthIssues(monitor);
  const live = !stopped && stream.state === "live";
  const remove = async () => {
    try {
      await api(`games/${game.id}`, { method: "DELETE" });
      setView("home");
      await reloadGames();
      toast({
        kind: "info",
        title: `${game.name} removed from the library`,
        message: "Installed game and saved sessions kept.",
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await api("games", {
                method: "POST",
                body: {
                  name: game.name,
                  packageId: game.packageId,
                  icon: game.icon,
                },
              });
              await reloadGames();
              toast({ kind: "ok", title: `${game.name} restored` });
            } catch (e) {
              toast({
                kind: "bad",
                title: "Could not restore the game",
                message: errorMessage(e),
              });
            }
          },
        },
      });
    } catch (e) {
      toast({
        kind: "bad",
        title: "Could not remove the game",
        message: errorMessage(e),
      });
    }
  };
  return (
    <main className="content pl-overview">
      <div className="pl-game-head">
        <GameIcon game={game} size={52} />
        <PageHead
          title={game.name}
          description={game.packageId}
          actions={
            <Button onClick={() => setEditing(true)}>
              <Icon name="edit" />
              Edit game
            </Button>
          }
        />
      </div>
      <div className="pl-control-row">
        <Tag kind={info?.installed ? "plain" : "warn"}>
          {!device
            ? "No device"
            : device.replay
              ? "Demo simulator"
              : !info
                ? "Checking installed build…"
                : info.installed
                  ? `v${info.versionName || "?"} · build ${info.versionCode ?? "?"}`
                  : "Install this game on the active phone"}
        </Tag>
        <span className="pl-spacer" />
        <Button
          variant="primary"
          disabled={disabled || info?.running === true}
          loading={actionBusy === `${pkg}:launch`}
          loadingLabel="Starting…"
          onClick={() => performGameAction(game.packageId, "launch")}
        >
          <Icon name="pad" />
          Start game
        </Button>
        <span className="data-page">
          <Menu
            label="More game actions"
            items={[
              {
                label: "Restart game",
                hidden: disabled,
                onClick: () => performGameAction(game.packageId, "restart"),
              },
              {
                label: "Stop game",
                hidden: disabled || info?.running === false,
                onClick: () => performGameAction(game.packageId, "stop"),
              },
              { label: "Refresh installed version", onClick: refreshApps },
            ]}
          />
        </span>
      </div>
      <section
        className="pl-overview-status"
        aria-label="Game and capture status"
      >
        <div>
          <span className="eyebrow">Active device</span>
          <strong>
            {device?.replay ? "Demo simulator" : deviceName(device)}
          </strong>
          <span className="muted">
            {device?.replay
              ? "Saved logs · no live phone"
              : device
                ? `${device.transport === "wifi" ? "Wi-Fi" : "USB"} connection`
                : "Connect a phone to begin"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setView("devices")}>
            Manage devices
          </Button>
        </div>
        <div>
          <span className="eyebrow">Capture</span>
          <strong>
            {!device
              ? "Waiting for a device"
              : !info
                ? "Checking installed build"
                : !info.installed
                  ? "Game not installed"
                  : stopped
                    ? "Stopped"
                    : live
                      ? device.replay
                        ? "Playing demo logs"
                        : "Live capture"
                      : stream.state === "starting"
                        ? "Starting capture"
                        : stream.state === "ended"
                          ? device.replay
                            ? "Demo playback finished"
                            : "Capture finished"
                          : stream.state === "error"
                            ? "Capture needs attention"
                            : "Waiting for game logs"}
          </strong>
          <span className="muted">
            {stream.reason ||
              "Only this game's logs and events. Auto-save is off."}
          </span>
          {info?.installed && (
            <Button size="sm" onClick={() => setStopped(!stopped)}>
              {stopped ? "Start capture" : "Stop capture"}
            </Button>
          )}
        </div>
        <div>
          <span className="eyebrow">Problems</span>
          <strong className={issues.length ? "warnc" : ""}>
            {!device || !info?.installed || !monitor
              ? "Waiting for evidence"
              : issues.length
                ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"} to fix`
                : "No issues observed"}
          </strong>
          <span className="muted">
            {device?.replay
              ? "Simulated evidence from the demo."
              : "Based on this capture's plugin evidence."}
          </span>
          {!!monitor && (
            <Button size="sm" variant="ghost" onClick={() => setView("health")}>
              Review plugin health
            </Button>
          )}
        </div>
      </section>
      <Panel title={issues.length ? "Fix these first" : "What's happening"}>
        <div className="pb pl-setup-panel">
          {issues.slice(0, 3).map((issue) => (
            <div className="pl-overview-issue" key={issue.id}>
              <Tag kind={issue.severity === "critical" ? "bad" : "warn"}>
                {issue.severity === "critical" ? "Failed" : "Warning"}
              </Tag>
              <div>
                <b>{issue.name}</b>
                <p className="muted">{issue.detail}</p>
              </div>
            </div>
          ))}
          {!issues.length && (
            <p className="muted">
              {!device
                ? "Connect an Android phone, then launch an installed build."
                : !info?.installed
                  ? "Install this game's package on the active phone to inspect it."
                  : !monitor
                    ? "Waiting for the first game logs. Launch the game on your phone."
                    : "Capture is ready. Play the game to collect logs, events and plugin checks. Use the sidebar to inspect the evidence."}
            </p>
          )}
          {!!issues.length && (
            <Button onClick={() => setView("health")}>
              Review{" "}
              {issues.length === 1 ? "issue" : `all ${issues.length} issues`}
            </Button>
          )}
        </div>
      </Panel>
      <footer className="pl-game-footer">
        <span className="muted">
          Only {game.name} is tracked in this workspace.
        </span>
        <Button variant="ghost" onClick={remove}>
          Remove from library
        </Button>
      </footer>
      <DialogShell open={editing} onOpenChange={setEditing} title="Edit game">
        <GameEditor game={game} onDone={() => setEditing(false)} />
      </DialogShell>
    </main>
  );
}

export function GameSessions() {
  const { game, pkg } = useApp();
  return (
    <main className="content">
      <h1 className="page-title">{game?.name} sessions</h1>
      <SessionHistory packageFilter={pkg ?? undefined} groupByGame={false} />
    </main>
  );
}
