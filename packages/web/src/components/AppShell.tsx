import type { NavItem } from "@avn/ui";
import {
  AppShell,
  Brand,
  Button,
  DialogShell,
  Icon,
  NotificationList,
  Popover,
  SearchButton,
  Segmented,
  ShortcutsDialog,
  Sidebar,
  SidebarNav,
  TabBar,
  TopBar,
  useToast,
  Workspace,
} from "@avn/ui";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useViewPreference } from "../route-state";
import { useApp } from "../state";
import { tabBadges } from "../tab-badges";
import { GameIcon } from "./GameIcon";
import { GameBar } from "./GameBar";
import { CommandRunner } from "./CommandRunner";

import { GAME_TABS, LIBRARY, TOOLS } from "../nav-items";
const EXTRA: NavItem[] = [
  { id: "connect", label: "Connect a device", icon: "link" },
];
const ALL_PAGES = [...LIBRARY, ...GAME_TABS, ...TOOLS, ...EXTRA];

function readPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(`playlens.${key}`) || fallback;
  } catch {
    return fallback;
  }
}

export function PlayLensShell({ children }: PropsWithChildren) {
  const {
    view,
    setView,
    game,
    games,
    openGame,
    inGameWorkspace,
    device,
    online,
    stopped,
    stream,
    monitor,
    refreshApps,
    reloadGames,
    archiveReturn,
  } = useApp();
  const { toast, unread, markAllRead } = useToast();
  const [command, setCommand] = useState(false);
  const [more, setMore] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [settings, setSettings] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(() => readPreference("theme", "dark"));
  const [palette, setPalette] = useState(() =>
    readPreference("palette", "nutmeg"),
  );
  const [density, updateDensity] = useViewPreference<"compact" | "comfort">(
    "density",
    "playlens.density",
    "compact",
  );
  const setDensity = (next: string) =>
    updateDensity(next === "comfort" ? "comfort" : "compact");
  const [refreshing, setRefreshing] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const active = view.endsWith("-setup")
    ? view.replace("-setup", "")
    : view === "saved-session"
      ? archiveReturn
      : view;
  const current =
    ALL_PAGES.find((p) => p.id === active)?.label || "Saved session";
  // Things to look at show as counts on the game's tabs.
  const badges = tabBadges(monitor);
  const gameTabs = GAME_TABS.map((p) => {
    const count = badges[p.id as keyof typeof badges] || undefined;
    return count ? { ...p, count } : p;
  });
  const groups = inGameWorkspace
    ? [
        { label: "Game", items: gameTabs },
        { label: "Tools", items: TOOLS },
        { label: "Workspace", items: LIBRARY },
      ]
    : [
        { label: "Workspace", items: LIBRARY },
        { label: "Get started", items: EXTRA },
      ];
  const tabs = inGameWorkspace ? gameTabs : LIBRARY;
  const select = (id: string) => setView(id);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem("playlens.theme", theme);
      localStorage.setItem("playlens.palette", palette);
      localStorage.setItem("playlens.density", density);
    } catch {
      /* storage may be unavailable */
    }
  }, [theme, palette, density]);
  useEffect(() => {
    document.title = `${current}${game && inGameWorkspace ? ` · ${game?.name}` : ""} · AVN PlayLens`;
  }, [view, current, game?.name, inGameWorkspace]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand((s) => !s);
      }
      if (e.key === "/") {
        e.preventDefault();
        setShortcuts((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await reloadGames();
      await refreshApps();
    } catch (err) {
      toast({
        kind: "bad",
        title: "Could not refresh the library",
        message:
          err instanceof Error
            ? err.message
            : "Try again when your device is connected.",
      });
    } finally {
      setRefreshing(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ kind: "ok", title: "View link copied" });
    } catch {
      toast({
        kind: "bad",
        title: "Could not copy the link",
        message: "Copy the address from your browser.",
        action: { label: "Retry", onClick: copyLink },
      });
    }
  };
  return (
    <AppShell
      className="playlens-app"
      density={density}
      sidebar={
        <Sidebar>
          <Brand
            mark={
              <img
                src="/avn-style/styles/avn-family/icons/avn-playlens.svg"
                alt=""
                width="28"
                height="28"
              />
            }
            name="AVN PlayLens"
            onClick={() => setView("home")}
          />
          <button
            className="game"
            title={
              game && inGameWorkspace
                ? `Switch game: ${game?.name}`
                : "Choose a game"
            }
            onClick={() => {
              setQuery("");
              setSwitcher(true);
            }}
          >
            <GameIcon
              game={inGameWorkspace && game ? game : { name: "Games" }}
              size={30}
            />
            <span className="pl-game-label">
              <b>{inGameWorkspace ? game?.name : "Your games"}</b>
              <small>
                {inGameWorkspace ? game?.packageId : "Choose a workspace"}
              </small>
            </span>
            <Icon name="caret" />
          </button>
          <SidebarNav
            groups={groups}
            active={active}
            onSelect={select}
            label="PlayLens views"
          />
          <div className="pl-sidebar-foot">
            <span className={`pl-connection ${online ? "connected" : ""}`} />
            <span>{online ? "Local server online" : "Reconnecting…"}</span>
          </div>
          <button
            className="acct-btn"
            title="Appearance and density"
            onClick={() => setSettings(true)}
          >
            <span className="av">
              <Icon name="sliders" />
            </span>
            <div>
              <b>Your workspace</b>
              <small>Appearance & density</small>
            </div>
          </button>
        </Sidebar>
      }
      tabbar={
        <TabBar
          items={tabs}
          active={active}
          onSelect={select}
          moreItems
          onMore={() => setMore(true)}
        />
      }
    >
      <Workspace>
        <TopBar
          crumbs={[
            { label: "Games", onClick: () => setView("home") },
            ...(inGameWorkspace
              ? [
                  {
                    label: game?.name ?? "Game",
                    onClick: () => setView("logs"),
                  },
                ]
              : []),
            ...(view !== "home" ? [{ label: current }] : []),
          ]}
          mobileTitle={
            <>
              <img
                src="/avn-style/styles/avn-family/icons/avn-playlens.svg"
                alt=""
                width="24"
                height="24"
              />
              <b>{current}</b>
            </>
          }
          tools={
            <>
              <SearchButton onClick={() => setCommand(true)} />
              <button
                className="btn pl-refresh"
                title="Refresh game library and installed versions"
                aria-label="Refresh game library and installed versions"
                disabled={refreshing || !online}
                onClick={refresh}
              >
                <Icon name="refresh" />
                <span className="pl-refresh-label">Refresh library</span>
              </button>
              <button
                className="icon-btn pl-copy"
                title="Copy view link"
                aria-label="Copy view link"
                onClick={copyLink}
              >
                <Icon name="link" />
              </button>
              <button
                className="icon-btn"
                ref={bell}
                title="Notifications"
                aria-expanded={notifications}
                aria-controls="playlens-notifications"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                onClick={() => {
                  markAllRead();
                  setNotifications((open) => !open);
                }}
              >
                <Icon name="bell" />
                {unread > 0 && <span className="pl-unread">{unread}</span>}
              </button>
            </>
          }
        />
        <div
          className="pl-scroll"
          ref={content}
          id="workspace-content"
          tabIndex={-1}
        >
          {!online && (
            <div className="banner" role="status">
              <Icon name="alert" />
              <span>
                Connection lost. Your capture stays on this computer.
                Reconnecting automatically…
              </span>
            </div>
          )}
          {inGameWorkspace && view !== "saved-session" && <GameBar />}
          {children}
        </div>
      </Workspace>
      <DialogShell
        open={switcher}
        onOpenChange={setSwitcher}
        title="Switch game"
      >
        <input
          className="pl-input"
          aria-label="Find a game"
          placeholder="Find a game or package…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="pl-switch-list">
          {games
            .filter((g) =>
              `${g.name} ${g.packageId}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((g) => (
              <button
                className="game"
                key={g.id}
                onClick={() => {
                  openGame(g.packageId);
                  setSwitcher(false);
                }}
              >
                <GameIcon game={g} size={32} />
                <span>
                  <b>{g.name}</b>
                  <small>{g.packageId}</small>
                </span>
              </button>
            ))}
          {!games.length && (
            <p className="muted">Register your first game in the library.</p>
          )}
        </div>
        <Button
          onClick={() => {
            setView("home");
            setSwitcher(false);
          }}
        >
          Open game library
        </Button>
      </DialogShell>
      <DialogShell open={more} onOpenChange={setMore} title="More pages">
        <div className="pl-more-list">
          {groups.map((g) => (
            <section key={g.label}>
              <span className="eyebrow">{g.label}</span>
              {g.items.map((p) => (
                <button
                  key={p.id}
                  className="ni"
                  onClick={() => {
                    select(p.id);
                    setMore(false);
                  }}
                >
                  <Icon name={p.icon} />
                  <span>{p.label}</span>
                </button>
              ))}
            </section>
          ))}
          <button
            className="ni"
            onClick={() => {
              setMore(false);
              setSettings(true);
            }}
          >
            <Icon name="sliders" />
            Appearance & density
          </button>
          <Button onClick={() => setMore(false)}>Close</Button>
        </div>
      </DialogShell>
      <DialogShell
        open={settings}
        onOpenChange={setSettings}
        title="Appearance and spacing"
      >
        <div className="pl-settings">
          <label>Theme</label>
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
          <p className="pl-page-note">
            Light uses bright surfaces; Dark uses dim surfaces for lower light.
          </p>
          <label htmlFor="palette">Palette</label>
          <select
            id="palette"
            className="select"
            value={palette}
            onChange={(e) => setPalette(e.target.value)}
          >
            {["nutmeg", "slate", "moss", "hibiscus", "white"].map((p) => (
              <option value={p} key={p}>
                {p === "white"
                  ? "White build"
                  : p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <p className="pl-page-note">
            Palette changes the color scheme: Nutmeg is warm orange, Slate cool
            gray, Moss green, Hibiscus pink, and White build neutral.
          </p>
          <label>Data density</label>
          <Segmented
            label="Data density"
            value={density}
            onChange={setDensity}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfort", label: "Roomy" },
            ]}
          />
          <p className="pl-page-note">
            Compact fits more rows on screen. Roomy adds space around rows and
            controls.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setSettings(false);
              setShortcuts(true);
            }}
          >
            Keyboard shortcuts
          </Button>
          <Button onClick={() => setSettings(false)}>Done</Button>
        </div>
      </DialogShell>
      <Popover
        open={notifications}
        onClose={() => setNotifications(false)}
        anchor={bell}
        width={380}
        className="pl-notifications"
      >
        {notifications && (
          <NotificationContents onClose={() => setNotifications(false)} />
        )}
      </Popover>
      <ShortcutsDialog
        open={shortcuts}
        onClose={() => setShortcuts(false)}
        shortcuts={[
          { keys: ["Ctrl", "K"], label: "Search games, pages and actions" },
          { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
          { keys: ["Ctrl", "Space"], label: "Pause or resume the log view" },
          { keys: ["Esc"], label: "Close the current dialog" },
        ]}
      />
      {command && (
        <CommandRunner
          onClose={() => setCommand(false)}
          onAppearance={() => setSettings(true)}
          onShortcuts={() => setShortcuts(true)}
        />
      )}
    </AppShell>
  );
}

function NotificationContents({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      ref={panel}
      tabIndex={-1}
      id="playlens-notifications"
      aria-label="Notifications"
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node) &&
          (e.relatedTarget as HTMLElement).getAttribute("aria-controls") !==
            "playlens-notifications"
        )
          onClose();
      }}
    >
      <NotificationList />
      <div className="pl-notifications-foot">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close notifications
        </Button>
      </div>
    </div>
  );
}

export function ToastBridge() {
  const { toast: incoming, setToast } = useApp();
  const { toast } = useToast();
  const delivered = useRef<typeof incoming>(null);
  useEffect(() => {
    if (!incoming || delivered.current === incoming) return;
    delivered.current = incoming;
    toast({
      kind: incoming.severity === "critical" ? "bad" : incoming.kind || "info",
      title: incoming.title,
      message: incoming.msg,
      action: incoming.action,
    });
    setToast(null);
  }, [incoming, toast, setToast]);
  return null;
}
