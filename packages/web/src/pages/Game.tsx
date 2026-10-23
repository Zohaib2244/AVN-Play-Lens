import {
  Button,
  DialogShell,
  Icon,
  PageHead,
  Panel,
  Tag,
  Tiles,
  useToast,
} from "@avn/ui";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { GameEditor } from "../components/GameEditor";
import { GameIcon } from "../components/GameIcon";
import { SessionHistory } from "../components/SessionHistory";
import { Menu } from "../components/ui";
import { deviceName, useApp } from "../state";

const VIEWS: [string, string, import("@avn/ui").IconName, string][] = [
  ["logs", "Logs", "term", "Search output and crash traces."],
  [
    "performance",
    "Performance",
    "pulse",
    "Frames, CPU, memory and temperature.",
  ],
  ["health", "Plugin health", "shield", "SDK startup, ads and privacy checks."],
  ["firebase", "Firebase events", "flame", "Events recorded by this device."],
  [
    "remote-config",
    "Remote Config",
    "sliders",
    "Fetched settings and level sequences.",
  ],
  [
    "checklist",
    "Checklist",
    "checklist",
    "Publishing checks backed by evidence.",
  ],
  [
    "snapshooter",
    "Level Snapshooter",
    "grid",
    "Level captures and ZIP exports.",
  ],
];

export function Game() {
  const app = useApp();
  const {
    game,
    gameInventory,
    serial,
    device,
    devices,
    selectDevice,
    pkg,
    setView,
    performGameAction,
    actionBusy,
    refreshApps,
    stopped,
    setStopped,
    reloadGames,
    viewGameSessions,
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
  const ready = devices.filter((d) => d.state === "device");
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
        <label className="pl-device-select">
          <span className="eyebrow">Testing on</span>
          <select
            className="select"
            aria-label="Game device"
            value={serial || ""}
            onChange={(e) =>
              selectDevice(devices.find((d) => d.serial === e.target.value))
            }
          >
            <option value="" disabled>
              No device
            </option>
            {ready.map((d) => (
              <option key={d.serial} value={d.serial}>
                {deviceName(d)}
              </option>
            ))}
          </select>
        </label>
        <Tag kind={info?.installed ? "plain" : "warn"}>
          {info?.installed
            ? `v${info.versionName || "?"} · build ${info.versionCode ?? "?"}`
            : device
              ? "Not installed"
              : "No device"}
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
        {stopped && (
          <Button
            disabled={!device || !info?.installed}
            onClick={() => setStopped(false)}
          >
            Resume tracking
          </Button>
        )}
      </div>
      <div className="strip-h">
        <span className="eyebrow">Inspect this build</span>
      </div>
      <Tiles>
        {VIEWS.map(([view, title, icon, text]) => (
          <button className="tile" key={view} onClick={() => setView(view)}>
            <span className="th">
              <Icon name={icon} />
              {title}
            </span>
            <span className="ts2">{text}</span>
            <span className="go">
              Open {title.toLowerCase()} <Icon name="arrow" />
            </span>
          </button>
        ))}
      </Tiles>
      <Panel
        title="Recent sessions"
        subtitle="Saved captures for this game"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => viewGameSessions(game.packageId)}
          >
            View all <Icon name="arrow" />
          </Button>
        }
      >
        <div className="data-page pl-history">
          <SessionHistory
            limit={3}
            compact
            groupByGame={false}
            packageFilter={pkg ?? undefined}
          />
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
