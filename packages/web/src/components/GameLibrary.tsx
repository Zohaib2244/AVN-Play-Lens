import {
  Button,
  DialogShell,
  ErrorPanel,
  Icon,
  LoadBar,
  PageHead,
  PageSkeleton,
  Tag,
} from "@avn/ui";
import { useMemo, useState } from "react";
import { useViewState } from "../route-state";
import { useApp } from "../state";
import { GameEditor } from "./GameEditor";
import { GameIcon } from "./GameIcon";

export function GameLibrary() {
  const {
    games,
    gamesLoaded,
    gamesError,
    reloadGames,
    gameInventory,
    inventoryError,
    serial,
    openGame,
    device,
    refreshApps,
  } = useApp();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useViewState("gameSearch", "");
  const [installedOnly, setInstalledOnly] = useViewState(
    "installedGames",
    false,
  );
  const shown = useMemo(
    () =>
      games.filter((g) => {
        const info =
          gameInventory.serial === serial
            ? gameInventory.games.find((x) => x.id === g.id)
            : undefined;
        return (
          `${g.name} ${g.packageId}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (!installedOnly || info?.installed)
        );
      }),
    [games, query, installedOnly, gameInventory, serial],
  );
  return (
    <>
      <PageHead
        title="Your games"
        description="Open a workspace or register a new game."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Register a game
          </Button>
        }
      />
      <div className="filters pl-library-filters">
        <label className="pl-search">
          <Icon name="search" />
          <input
            aria-label="Search your games"
            placeholder="Find a game or package…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`btn ${installedOnly ? "pl-selected" : ""}`}
          disabled={!device}
          aria-pressed={installedOnly}
          onClick={() => setInstalledOnly(!installedOnly)}
        >
          Installed on device
        </button>
        {(query || installedOnly) && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setInstalledOnly(false);
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="pl-filter-note">
          {gamesLoaded
            ? `${shown.length} of ${games.length} games`
            : "Loading library"}
        </span>
        <Button variant="ghost" disabled={!device} onClick={refreshApps}>
          <Icon name="refresh" />
          Refresh versions
        </Button>
      </div>
      {gamesError && (
        <ErrorPanel
          title="Could not load your game library"
          message={gamesError}
          onRetry={reloadGames}
        />
      )}
      {inventoryError && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>Could not check installed versions. {inventoryError}</span>
          <Button size="sm" onClick={refreshApps}>
            Try again
          </Button>
        </div>
      )}
      {!gamesLoaded && !gamesError && (
        <div role="status" aria-label="Loading your game library">
          <PageSkeleton kpis={0} rows={3} />
          <LoadBar text="Loading your games" onRetry={reloadGames} />
        </div>
      )}
      {gamesLoaded && !games.length && (
        <div className="pl-library-intro">
          <span className="eyebrow">A workspace for every build</span>
          <p className="muted">
            Register a name and Android package ID. Open its workspace to
            collect logs, check SDKs and review performance.
          </p>
        </div>
      )}
      <div className="games">
        {shown.map((g) => {
          const info =
            gameInventory.serial === serial
              ? gameInventory.games.find((x) => x.id === g.id)
              : null;
          return (
            <button
              className="gcard"
              key={g.id}
              onClick={() => openGame(g.packageId)}
              aria-label={`Open ${g.name}`}
            >
              <span className="gc-top">
                <span className="gc-ic">
                  <GameIcon game={g} size={44} />
                </span>
                <Tag kind="plain">Quiet</Tag>
              </span>
              <span>
                <span className="gc-name">{g.name}</span>
                <span className="gc-id mono">{g.packageId}</span>
              </span>
              <span className="gc-pills">
                <span className="pill">Android</span>
                <span className="pill">
                  {!device
                    ? "No device"
                    : !info
                      ? "Checking version…"
                      : info.installed
                        ? `v${info.versionName || "?"} · ${info.versionCode ?? "?"}`
                        : "Not installed"}
                </span>
              </span>
              <span className="gc-foot">
                <span>Tracking paused</span>
                <span className="gc-last">
                  Open workspace <Icon name="arrow" />
                </span>
              </span>
            </button>
          );
        })}
        {!query && !installedOnly && (
          <button className="gcard add" onClick={() => setAdding(true)}>
            <span className="gc-addi">+</span>
            <b>Register a game</b>
            <span className="muted">Name, package ID and optional icon</span>
          </button>
        )}
      </div>
      {gamesLoaded && !!games.length && !shown.length && (
        <div className="panel pl-empty">
          <Icon name="search" size={28} />
          <h2>No games match these filters.</h2>
          <p className="muted">
            Try a different name or show all registered games.
          </p>
          <Button
            onClick={() => {
              setQuery("");
              setInstalledOnly(false);
            }}
          >
            Show all games
          </Button>
        </div>
      )}

      <DialogShell
        open={adding}
        onOpenChange={setAdding}
        title="Register a game"
      >
        <GameEditor onDone={() => setAdding(false)} />
      </DialogShell>
    </>
  );
}
