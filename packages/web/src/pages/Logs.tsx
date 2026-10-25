import { Button, Drawer, Panel } from "@avn/ui";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Icon, PageHead } from "../components/bits";
import { Grouped } from "../components/Grouped";
import { ActionButton, LiveBars, Menu, SkeletonLog } from "../components/ui";
import { useViewPreference, useViewState } from "../route-state";
import { clock, deviceName, useApp } from "../state";
import type { LogEntry } from "../types";

const LOG_COLUMNS: ColumnDef<LogEntry>[] = [
  { accessorKey: "ts" },
  { accessorKey: "level" },
  { accessorKey: "message" },
  { accessorKey: "tag" },
];
const LEVEL_WORD: Record<string, string> = {
  W: "WARN",
  E: "ERROR",
  F: "FATAL",
};

export function cleanMessage(e: LogEntry) {
  const m =
    e.source === "avn"
      ? e.message.replace(/\s*\|\s*AVNPLUGIN\s*$/, "")
      : e.message;
  return m.replace(/<\/?(color|b|i|size)(=[^>]*)?>/g, "");
}

function fromLabel(e: LogEntry) {
  if (e.source === "avn") {
    const a = e.avn!;
    if (a.key) return `AVN · ${a.key}`;
    if (a.kind === "callback") return `AVN · ${a.format}`;
    return a.caller ? `AVN · ${a.caller.class}` : "AVN plugin";
  }
  if (e.source === "unity") return "Unity";
  if (e.source === "firebase") return "Firebase";
  if (e.source === "crash")
    return (
      {
        "java-crash": "Crash · Java",
        "native-crash": "Crash · native",
        anr: "ANR",
      }[e.kind ?? ""] || "Crash"
    );
  return e.tag;
}

function Detail({ e }: { e: LogEntry }) {
  const params = e.fa?.params ?? e.avn?.event?.params ?? e.avn?.fields ?? null;
  const facts = [];
  if (e.avn?.kind === "status")
    facts.push(["Hub key", e.avn.key], ["State", e.avn.state]);
  if (e.avn?.kind === "counter")
    facts.push(
      ["Counter", `${e.avn.key} ${e.avn.name}`],
      ["Value", String(e.avn.value)],
      ...(e.avn.reason ? [["Reason", e.avn.reason]] : []),
    );
  if (e.avn?.kind === "callback")
    facts.push(["Callback", `${e.avn.format} · ${e.avn.callback}`]);
  if (e.avn?.event)
    facts.push(["Event", `${e.avn.event.name} (${e.avn.event.stage})`]);
  if (e.fa)
    facts.push(["Firebase event", e.fa.name], ["Origin", e.fa.origin || "—"]);
  facts.push(["Tag", e.tag], ["Process", `${e.pid} / thread ${e.tid}`]);
  const copy = () =>
    navigator.clipboard?.writeText(
      [
        `${clock(e.ts)} ${e.level} ${e.tag}: ${e.message}`,
        ...(e.more || []),
      ].join("\n"),
    );
  return (
    <div className="log-detail">
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          marginBottom: 12,
          wordBreak: "break-word",
        }}
        className="mono"
      >
        {cleanMessage(e)}
      </div>
      {e.more && <pre className="trace">{e.more.join("\n")}</pre>}
      {params && Object.keys(params).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {Object.entries(params).map(([k, v]) => (
            <span key={k} className="chip">
              <span className="dim">{k}</span>
              {String(v)}
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 20px",
          fontSize: 13,
          marginBottom: 12,
        }}
        className="dim"
      >
        {facts.map(([k, v]) => (
          <span key={k}>
            {k}: <span className="mute mono">{v}</span>
          </span>
        ))}
      </div>
      <button className="btn btn-sm" onClick={copy}>
        Copy
      </button>
    </div>
  );
}

export function useAppAction() {
  const { serial, pkg, showToast } = useApp();
  return (action: string) =>
    api(
      `devices/${encodeURIComponent(serial ?? "")}/apps/${encodeURIComponent(pkg ?? "")}/${action}`,
      { method: "POST" },
    )
      .then(() => true)
      .catch((e) => {
        showToast({
          title: `Could not ${action} the game`,
          msg: e.message,
          severity: "critical",
        });
        return false;
      });
}

export function Logs() {
  const {
    device,
    pkg,
    lines,
    version,
    stream,
    rate,
    alerts,
    setAlerts,
    sessionId,
    focusEntry,
    setFocusEntry,
    stopped,
    setStopped,
    monitor,
    setView,
    gameInventory,
    serial,
  } = useApp();
  const [q, setQ] = useViewState("logSearch", "");
  const [filter, setFilter] = useViewState("logSeverity", "all");
  const [mode, pickMode] = useViewPreference<string>(
    "logMode",
    "playlens.logMode",
    "lines",
  );
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [lastId, setLastId] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const appAction = useAppAction();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ok = (lv: string) =>
      filter === "all" ||
      (filter === "warn" ? "WEF".includes(lv) : "EF".includes(lv));
    return lines.current.filter(
      (e) =>
        (!paused || e.id <= pausedAt) &&
        ok(e.level) &&
        (!needle ||
          `${e.message} ${e.tag} ${fromLabel(e)} ${(e.more || []).join(" ")}`
            .toLowerCase()
            .includes(needle)),
    );
    // version changes whenever lines.current is mutated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, q, filter, paused, pausedAt]);

  const table = useReactTable({
    data: shown,
    columns: LOG_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (e) => String(e.id),
  });
  const logRows = table.getRowModel().rows;
  const virt = useVirtualizer({
    count: logRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 41,
    overscan: 12,
    getItemKey: (i) => logRows[i].id,
  });

  // "Show in logs" from other views: open that line and scroll to it.
  useEffect(() => {
    if (!focusEntry) return;
    const i = shown.findIndex((e) => e.id === focusEntry);
    if (i >= 0) {
      setFollow(false);
      setOpen(focusEntry);
      virt.scrollToIndex(i, { align: "center" });
    }
    setFocusEntry(null);
  }, [focusEntry, shown, virt, setFocusEntry]);

  useEffect(() => {
    if (follow && shown.length)
      virt.scrollToIndex(shown.length - 1, { align: "end" });
    const newest = shown.length ? shown[shown.length - 1].id : 0;
    const t = setTimeout(() => setLastId(newest), 600);
    return () => clearTimeout(t);
  }, [shown, follow, virt]);

  const togglePause = useCallback(() => {
    setPausedAt(lines.current.at(-1)?.id ?? 0);
    setPaused((p) => !p);
  }, [lines]);

  const toggleStopped = () => {
    if (
      !stopped &&
      monitor?.run?.active &&
      !window.confirm(
        "A checklist run is live. Stopping the log ends it. Stop anyway?",
      )
    )
      return;
    setPaused(false);
    setStopped(!stopped);
  };

  // Ctrl/Cmd + Space pauses / resumes, unless you're typing or on a button outside the log.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code !== "Space" ||
        e.repeat ||
        !(e.metaKey || e.ctrlKey) ||
        e.altKey
      )
        return;
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]'))
        return;
      if (t.closest?.("button, a") && !t.closest(".logscroll")) return; // log rows are fine; other buttons keep Space
      if (stopped) return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, stopped]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  }, []);

  const installed =
    gameInventory.serial === serial
      ? gameInventory.games.find((g) => g.packageId === pkg)?.installed
      : undefined;
  if (!device || installed === false) {
    return (
      <main className="content">
        <h1 className="page-title">Logs</h1>
        <Panel>
          <div className="pl-empty">
            <h2>
              {!device ? "No device connected." : "This game is not installed."}
            </h2>
            <p className="muted">
              {!device
                ? "Connect a phone to collect this game’s output."
                : "Install the package on the selected phone, or choose another device."}
            </p>
            <Button onClick={() => setView(!device ? "connect" : "game")}>
              {!device ? "Connect device" : "Open game controls"}
            </Button>
          </div>
        </Panel>
      </main>
    );
  }

  const openEntry = shown.find((entry) => entry.id === open);
  const newCount = shown.length ? shown.filter((e) => e.id > lastId).length : 0;
  return (
    <main className="content">
      <PageHead
        title="Logs"
        sub={
          <>
            {pkg
              ? `${pkg} on ${deviceName(device)}`
              : `Everything on ${deviceName(device)}`}{" "}
            · {shown.length.toLocaleString()}{" "}
            {shown.length === 1 ? "line" : "lines"}
            {pkg && !device.replay && (
              <>
                {" "}
                ·{" "}
                <span
                  style={{ color: stream.running ? "var(--ok)" : "var(--dim)" }}
                >
                  {stream.running ? "game running" : "game not running"}
                </span>
              </>
            )}
          </>
        }
      >
        {stopped ? (
          <span className="tag plain">Stopped</span>
        ) : (
          <LiveBars
            label={paused ? "Paused" : rate ? `Live · ${rate}/s` : "Live"}
            paused={paused}
          />
        )}
        {stopped ? (
          <button className="btn btn-warm" onClick={toggleStopped}>
            <Icon.play /> Start log
          </button>
        ) : (
          <button
            className="btn"
            aria-pressed={paused}
            onClick={togglePause}
            title="Freeze the view; lines are still collected (Ctrl/Cmd + Space)"
          >
            {paused ? (
              <>
                <Icon.play /> Resume
              </>
            ) : (
              <>
                <Icon.pause /> Pause
              </>
            )}
          </button>
        )}
        {pkg && !device.replay && (
          <ActionButton
            onClick={() => appAction(stream.running ? "restart" : "launch")}
            busyLabel={stream.running ? "Restarting…" : "Launching…"}
          >
            <Icon.restart /> {stream.running ? "Restart game" : "Launch game"}
          </ActionButton>
        )}
        <Menu
          items={[
            {
              label: "Stop the game",
              onClick: () => appAction("stop"),
              hidden: !pkg || device.replay || !stream.running,
            },
            {
              label: "Save this log (.txt)",
              href: sessionId ? `/api/sessions/${sessionId}.txt` : null,
              download: true,
              hidden: !sessionId,
            },
            {
              label: "Pop-up alerts for crashes and errors",
              pressed: alerts,
              onClick: () => setAlerts(!alerts),
            },
            {
              label: "Stop collecting logs",
              onClick: toggleStopped,
              hidden: stopped,
            },
          ]}
        />
      </PageHead>

      <div className="filters pl-log-filters">
        <div className="qwrap">
          <Icon.search />
          <input
            className="qin"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the logs"
            aria-label="Search the logs"
          />
        </div>
        <div className="seg" role="group" aria-label="View">
          {[
            ["lines", "Lines"],
            ["grouped", "Grouped"],
          ].map(([k, label]) => (
            <button
              key={k}
              aria-pressed={mode === k}
              onClick={() => pickMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Show">
          {(mode === "grouped"
            ? [
                ["all", "Warnings + errors"],
                ["err", "Errors"],
              ]
            : [
                ["all", "All"],
                ["warn", "Warnings"],
                ["err", "Errors"],
              ]
          ).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {(q || filter !== "all" || paused) && (
        <div className="pl-active-filters" aria-label="Active log filters">
          <span>Showing</span>
          {q && (
            <span className="chip">
              Search: {q}
              <button aria-label="Clear log search" onClick={() => setQ("")}>
                ×
              </button>
            </span>
          )}
          {filter !== "all" && (
            <span className="chip">
              {filter === "warn" ? "Warnings and errors" : "Errors only"}
              <button
                aria-label="Clear severity filter"
                onClick={() => setFilter("all")}
              >
                ×
              </button>
            </span>
          )}
          {paused && (
            <span className="tag tag-warm">
              View paused · capture continues
            </span>
          )}
          {(q || filter !== "all") && (
            <button
              className="linkish"
              onClick={() => {
                setQ("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {mode === "grouped" ? (
        <Grouped
          q={q}
          filter={filter === "warn" ? "all" : filter}
          onShow={(id) => {
            pickMode("lines");
            setPaused(false);
            setFocusEntry(id);
          }}
        />
      ) : (
        <>
          <div className="panel logcard">
            <div className="loghead eyebrow">
              <span>Time</span>
              <span>Level</span>
              <span>Message</span>
              <span style={{ textAlign: "right" }}>From</span>
            </div>
            <div
              className="logscroll"
              ref={scrollRef}
              onScroll={onScroll}
              role="log"
              aria-live="off"
            >
              {shown.length === 0 ? (
                !stopped &&
                !q &&
                filter === "all" &&
                stream.state !== "ended" &&
                !lines.current.length ? (
                  <SkeletonLog />
                ) : (
                  <div className="empty">
                    {stopped ? (
                      "The log is stopped. Press Start log to begin a fresh one."
                    ) : stream.state === "ended" ? (
                      `The log stopped: ${stream.reason}`
                    ) : q || filter !== "all" ? (
                      <span>
                        No lines match these filters.{" "}
                        <button
                          className="linkish"
                          onClick={() => {
                            setQ("");
                            setFilter("all");
                          }}
                        >
                          Clear filters
                        </button>
                      </span>
                    ) : (
                      "Waiting for the first lines…"
                    )}
                  </div>
                )
              ) : (
                <div
                  style={{ height: virt.getTotalSize(), position: "relative" }}
                >
                  {virt.getVirtualItems().map((vi) => {
                    const e = logRows[vi.index].original;
                    const isOpen = open === e.id;
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={virt.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vi.start}px)`,
                        }}
                      >
                        <button
                          className={`log-row r-${e.level}${isOpen ? " open" : ""}${e.id > lastId && !paused ? " new" : ""}`}
                          onClick={() => setOpen(isOpen ? null : e.id)}
                          aria-expanded={isOpen}
                        >
                          <span className="mono dim" style={{ fontSize: 12.5 }}>
                            {clock(e.ts)}
                          </span>
                          <span className={`lv lv-${e.level}`}>
                            {LEVEL_WORD[e.level] || ""}
                          </span>
                          <span className="cell-msg">
                            {cleanMessage(e)}
                            {e.more ? (
                              <span className="dim">
                                {" "}
                                +{e.more.length} lines
                              </span>
                            ) : null}
                          </span>
                          <span className="cell-from">{fromLabel(e)}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 20px",
              fontSize: 13.5,
            }}
            className="mute"
          >
            {stopped ? (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span className="dot" style={{ background: "var(--dim)" }} />
                Log stopped. Nothing is being collected. Start log begins a
                fresh one
              </span>
            ) : paused ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--warm-text)",
                }}
              >
                <span
                  className="dot"
                  style={{ background: "var(--warm-text)" }}
                />
                Paused. New lines are still being collected
              </span>
            ) : follow ? null : (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setFollow(true);
                  virt.scrollToIndex(shown.length - 1, { align: "end" });
                }}
              >
                ↓ Jump to newest{newCount ? ` (${newCount} new)` : ""}
              </button>
            )}
            {device.replay && (
              <span className="tag tag-plain">
                Replay: saved demo log, not a live phone
              </span>
            )}
            <span style={{ flex: "1 1 0" }} />
            <span className="dim">
              Click a line to see more
              {!stopped && (
                <>
                  {" "}
                  · <kbd>Ctrl Space</kbd> pauses
                </>
              )}
            </span>
          </div>
        </>
      )}
      <Drawer
        open={!!openEntry}
        onClose={() => setOpen(null)}
        title={openEntry ? fromLabel(openEntry) : "Log entry"}
        subtitle={
          openEntry
            ? `${clock(openEntry.ts)} · ${LEVEL_WORD[openEntry.level] || openEntry.level}`
            : undefined
        }
      >
        {openEntry && <Detail e={openEntry} />}
      </Drawer>
    </main>
  );
}
