import {
  Button,
  DialogShell,
  Icon,
  filterCommands,
  useToast,
  type CommandItem,
  type IconName,
} from "@avn/ui";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../api";
import type { View } from "../navigation";
import { resourceKey, useResource } from "../query";
import { deviceName, useApp } from "../state";
import type { Game, SavedDevice } from "../types";
import { GameIcon } from "./GameIcon";
import { GAME_TABS, LIBRARY, TOOLS } from "../nav-items";

type Parameter = "game" | "device" | "saved-device";
/** Add an action, its parameter kind and its handler here; selection/search is shared. */
type Action = {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  hint?: string;
  game?: Game;
  parameter?: Parameter;
  disabled?: string;
  run: (value?: string) => unknown;
};

export function CommandRunner({
  onClose,
  onAppearance,
  onShortcuts,
}: {
  onClose: () => void;
  onAppearance: () => void;
  onShortcuts: () => void;
}) {
  const app = useApp();
  const {
    games,
    devices,
    serial,
    pkg,
    device,
    stopped,
    inGameWorkspace,
    openGame,
    setView,
    selectDevice,
    newSession,
    setStopped,
    saveSession,
    session,
    sessionId,
    online,
    status,
  } = app;
  const remembered = useResource<SavedDevice[]>("devices/saved", {
    enabled: online,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const gameActions: Action[] = [...GAME_TABS, ...TOOLS].map((page) => ({
    ...page,
    group: "Pages",
    parameter: "game",
    run: (value) => openGame(value!, page.id as View),
  }));
  const actions: Action[] = [
    ...LIBRARY.map((page) => ({
      ...page,
      group: "Pages",
      run: () => setView(page.id),
    })),
    ...gameActions,
    {
      id: "connect",
      label: "Connect a device",
      icon: "link",
      group: "Pages",
      run: () => setView("connect"),
    },
    ...games.map((game): Action => ({
      id: `game:${game.id}`,
      label: game.name,
      game,
      icon: "pad",
      group: "Games",
      hint: game.packageId,
      run: () => openGame(game.packageId),
    })),
    ...devices.map((phone): Action => ({
      id: `device:${phone.serial}`,
      label: phone.replay ? "Demo simulator" : deviceName(phone),
      icon: "link",
      group: "Devices",
      hint: phone.serial === serial ? "Active device" : phone.serial,
      disabled:
        phone.state !== "device"
          ? "Device is not ready"
          : phone.replay && devices.some((d) => !d.replay)
            ? "Real phone takes priority"
            : undefined,
      run: () => selectDevice(phone),
    })),
    {
      id: "switch-game",
      label: "Switch game",
      icon: "pad",
      group: "Actions",
      parameter: "game",
      run: (value) => openGame(value!),
    },
    {
      id: "switch-device",
      label: "Switch active device",
      icon: "link",
      group: "Actions",
      parameter: "device",
      run: (value) => selectDevice(devices.find((d) => d.serial === value)),
    },
    {
      id: "start-session",
      label: "Start a new capture session",
      icon: "pulse",
      group: "Actions",
      parameter: "game",
      hint: "Auto-save off · existing explicit saves are kept",
      disabled: !online
        ? "Server offline"
        : !device
          ? "Connect a device first"
          : undefined,
      run: (value) => {
        if (value === pkg) newSession();
        if (value !== pkg || !inGameWorkspace) openGame(value!);
      },
    },
    {
      id: "stop-session",
      label: "Stop capture session",
      icon: "pulse",
      group: "Actions",
      disabled:
        !inGameWorkspace || stopped || !session
          ? "No active capture"
          : undefined,
      run: () => setStopped(true),
    },
    {
      id: "resume-session",
      label: "Resume capture",
      icon: "pulse",
      group: "Actions",
      disabled:
        !inGameWorkspace || !stopped ? "Capture is not stopped" : undefined,
      run: () => setStopped(false),
    },
    {
      id: "save-session",
      label: "Save current capture",
      icon: "book",
      group: "Actions",
      hint: "Optional · save this capture to session history",
      disabled:
        !sessionId ||
        session?.recording === false ||
        status?.record === false ||
        stopped
          ? "No recordable capture"
          : undefined,
      run: () => saveSession(),
    },
    {
      id: "saved-sessions",
      label: "Open saved sessions",
      icon: "book",
      group: "Actions",
      hint: "Optional history · automatic saving is off",
      run: () => app.viewGameSessions("__all"),
    },
    {
      id: "auto-reconnect",
      label: "Toggle auto-reconnect",
      icon: "refresh",
      group: "Actions",
      parameter: "saved-device",
      hint: "For a paired Wi-Fi phone",
      run: async (value) => {
        const saved = remembered.data?.find((d) => d.id === value);
        if (!saved)
          throw new Error("This paired device is no longer available.");
        const enabled = saved.autoReconnect === false;
        await api(`devices/saved/${encodeURIComponent(saved.id)}`, {
          method: "PATCH",
          body: { autoReconnect: enabled },
        });
        await queryClient.invalidateQueries({
          queryKey: resourceKey("devices/saved"),
        });
        toast({
          kind: "ok",
          title: `Auto-reconnect ${enabled ? "on" : "off"} for ${saved.label || saved.id}`,
        });
      },
    },
    {
      id: "appearance",
      label: "Appearance and density",
      icon: "sliders",
      group: "Actions",
      run: onAppearance,
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: "book",
      group: "Actions",
      run: onShortcuts,
    },
  ];
  const options: Action[] = !action
    ? actions
    : action.parameter === "game"
      ? [...games]
          .sort(
            (a, b) => Number(b.packageId === pkg) - Number(a.packageId === pkg),
          )
          .map((game) => ({
            id: game.packageId,
            label: game.name,
            game,
            hint: game.packageId,
            group: "Choose a game",
            icon: "pad",
            run: () => action.run(game.packageId),
          }))
      : action.parameter === "device"
        ? devices.map((phone) => ({
            id: phone.serial,
            label: phone.replay ? "Demo simulator" : deviceName(phone),
            hint: phone.serial === serial ? "Active device" : phone.serial,
            group: "Choose a device",
            icon: "link",
            disabled:
              phone.state !== "device"
                ? "Device is not ready"
                : phone.replay && devices.some((d) => !d.replay)
                  ? "Real phone takes priority"
                  : undefined,
            run: () => action.run(phone.serial),
          }))
        : (remembered.data ?? []).map((saved) => ({
            id: saved.id,
            label: saved.label || saved.id,
            hint: `Auto-reconnect ${saved.autoReconnect === false ? "off → on" : "on → off"}`,
            group: "Choose a paired Wi-Fi device",
            icon: "link",
            run: () => action.run(saved.id),
          }));
  const filtered = filterCommands(
    options.map((item) => ({ ...item, run: () => {} }) satisfies CommandItem),
    query,
  ).map((item) => options.find((option) => option.id === item.id)!);
  const current = Math.min(selected, Math.max(0, filtered.length - 1));
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, query]);
  const back = () => {
    setAction(null);
    setQuery("");
    setSelected(0);
    input.current?.focus({ preventScroll: true });
  };
  const run = async (item?: Action) => {
    if (!item || item.disabled || busy) return;
    if (item.parameter) {
      setAction(item);
      setQuery("");
      setSelected(0);
      input.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      await item.run();
      onClose();
    } catch (err) {
      toast({
        kind: "bad",
        title: "Could not run this action",
        message: errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };
  let group = "";
  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={action ? action.label : "Commands"}
    >
      <div className="pl-command-runner">
        {action && (
          <Button size="sm" variant="ghost" onClick={back}>
            <Icon name="back" />
            All commands
          </Button>
        )}
        <div className="cmdk-in">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="playlens-command-options"
            aria-activedescendant={
              filtered.length ? `command-option-${current}` : undefined
            }
            aria-label="Search pages, games and actions"
            placeholder={
              action
                ? `Choose ${action.parameter === "game" ? "a game" : "a device"}…`
                : "Search pages, games, devices or actions…"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      current + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (e.key === "Enter") {
                e.preventDefault();
                void run(filtered[current]);
              }
              if (e.key === "Escape" && action) {
                e.preventDefault();
                e.stopPropagation();
                back();
              }
            }}
          />
        </div>
        <div
          className="cmdk-list"
          ref={list}
          role="listbox"
          id="playlens-command-options"
          aria-label={action ? "Action parameters" : "Commands"}
          aria-busy={busy}
        >
          {filtered.map((item, i) => {
            const heading = item.group !== group;
            group = item.group;
            return (
              <div key={item.id}>
                {heading && (
                  <span className="cmdk-g eyebrow">{item.group}</span>
                )}
                <button
                  type="button"
                  id={`command-option-${i}`}
                  role="option"
                  aria-selected={i === current}
                  aria-disabled={!!item.disabled || busy}
                  data-index={i}
                  className={`cmdk-i${i === current ? " on" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => void run(item)}
                >
                  {item.game ? (
                    <GameIcon game={item.game} size={36} />
                  ) : (
                    <Icon name={item.icon} />
                  )}
                  <span className="pl-command-copy">
                    <span className="pl-command-title">{item.label}</span>
                    {(item.disabled || item.hint) && (
                      <small>{item.disabled || item.hint}</small>
                    )}
                  </span>
                  {item.parameter && <Icon name="arrow" />}
                </button>
              </div>
            );
          })}
          {!filtered.length && (
            <div className="cmdk-empty">
              {query
                ? "No matches. Try another name."
                : remembered.isLoading && action?.parameter === "saved-device"
                  ? "Loading paired phones…"
                  : remembered.error && action?.parameter === "saved-device"
                    ? "Could not load paired phones. Close and try again."
                    : action?.parameter === "game"
                      ? "Register a game in the library first."
                      : "No paired devices. Connect a phone over Wi-Fi first."}
            </div>
          )}
        </div>
        <div className="cmdk-foot">
          {busy
            ? "Running action…"
            : "↑ ↓ to move · Enter to run · Esc to go back or close"}
        </div>
      </div>
    </DialogShell>
  );
}
