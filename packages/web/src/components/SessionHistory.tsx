import { Button, DialogShell, ErrorPanel, Tag } from "@avn/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { resourceKey, useResource } from "../query";
import { useApp } from "../state";
import type { Session } from "../types";
import { DataTable, type DataColumn } from "./DataTable";
import { SkeletonRows } from "./ui";

export function SessionHistory({
  limit = null,
  groupByGame = true,
  filterable = false,
  packageFilter,
  compact = false,
}: {
  limit?: number | null;
  groupByGame?: boolean;
  filterable?: boolean;
  packageFilter?: string;
  compact?: boolean;
}) {
  const {
    online,
    historyVersion,
    reviewSession,
    games,
    historyGame,
    setHistoryGame,
  } = useApp();
  const client = useQueryClient();
  const result = useResource<Session[]>("sessions", {
    enabled: online,
    interval: 5000,
  });
  const sessions = result.data ?? [];
  const [deleting, setDeleting] = useState<Session | null>(null);
  useEffect(() => {
    void client.invalidateQueries({ queryKey: resourceKey("sessions") });
  }, [client, historyVersion]);
  const remove = useMutation({
    mutationFn: (session: Session) =>
      api(`sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleting(null);
      await client.invalidateQueries({ queryKey: resourceKey("sessions") });
    },
  });
  const name = (pkg: string | undefined) =>
    games.find((g) => g.packageId === pkg)?.name ||
    sessions.find((s) => s.pkg === pkg)?.gameName ||
    pkg ||
    "Device capture";
  const packages = [
    ...new Set([
      ...games.map((g) => g.packageId),
      ...sessions.map((s) => s.pkg),
    ]),
  ];
  const filtered = sessions.filter(
    (s) =>
      (packageFilter === undefined || s.pkg === packageFilter) &&
      (!filterable ||
        historyGame === "__all" ||
        (s.pkg || "__device") === historyGame),
  );
  const groups = new Map<string, Session[]>();
  for (const session of filtered) {
    const key = groupByGame ? (session.pkg ?? "__device") : "__all";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(session);
  }
  const rows = [...groups.values()].flatMap((captures) =>
    limit ? captures.slice(0, limit) : captures,
  );
  const columns: DataColumn<Session>[] = [
    {
      id: "capture",
      header: "Capture",
      cell: (s) => (
        <>
          <button className="pl-row-link" onClick={() => reviewSession(s.id)}>
            {s.name || "Earlier session"}
          </button>
          <div className="pl-page-note">
            {s.versionName
              ? `v${s.versionName}${s.versionCode != null ? ` · build ${s.versionCode}` : ""}`
              : name(s.pkg)}
            {s.active && (
              <>
                {" "}
                · <Tag kind="info">{s.paused ? "Paused" : "Recording"}</Tag>
              </>
            )}
          </div>
        </>
      ),
    },
    ...(!compact
      ? [{ id: "device", header: "Device", cell: (s: Session) => s.device }]
      : []),
    {
      id: "started",
      header: "Started",
      className: "mono pl-nowrap",
      sortable: true,
      value: (s) => s.startedAt,
      cell: (s) => (
        <time title={new Date(s.startedAt).toLocaleString()}>
          {new Date(s.startedAt).toLocaleDateString()}{" "}
          {new Date(s.startedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      ),
    },
    {
      id: "lines",
      header: "Lines",
      className: "num mono",
      sortable: true,
      value: (s) => s.lines,
      cell: (s) => s.lines.toLocaleString(),
    },
    {
      id: "actions",
      header: <span className="visually-hidden">Actions</span>,
      cell: (s) => (
        <div className="row-wrap">
          <Button size="sm" onClick={() => reviewSession(s.id)}>
            Review
          </Button>
          <a
            className="btn ghost sm"
            href={`/api/sessions/${s.id}.txt`}
            download
          >
            Export
          </a>
          <Button
            size="sm"
            variant="ghost"
            disabled={s.active || remove.isPending}
            onClick={() => {
              remove.reset();
              setDeleting(s);
            }}
          >
            Delete…
          </Button>
        </div>
      ),
    },
  ];
  const error = result.error?.message || remove.error?.message;
  return (
    <section className="pl-session-history" aria-label="Saved sessions">
      {filterable && (
        <div className="filters">
          <label className="event-filter">
            Game
            <select
              className="select"
              aria-label="Filter sessions by game"
              value={historyGame}
              onChange={(e) => setHistoryGame(e.target.value)}
            >
              <option value="__all">All games</option>
              {packages.map((pkg) => (
                <option key={pkg || "__device"} value={pkg || "__device"}>
                  {name(pkg)}
                </option>
              ))}
            </select>
          </label>
          <span className="pl-page-note">{filtered.length} captures</span>
          {historyGame !== "__all" && (
            <Button variant="ghost" onClick={() => setHistoryGame("__all")}>
              Clear filter
            </Button>
          )}
        </div>
      )}
      {error && (
        <ErrorPanel
          title="Could not load saved sessions"
          message={error}
          onRetry={() => {
            remove.reset();
            void result.refetch();
          }}
        />
      )}
      {result.isPending && !error && <SkeletonRows rows={3} />}
      {result.isSuccess && !rows.length && (
        <div className="empty">
          No saved sessions yet. Save a capture from a game workspace to review
          it here.
        </div>
      )}
      {!!rows.length && (
        <div className={compact ? "t-wrap" : "panel t-wrap"}>
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(s) => s.id}
            groupBy={groupByGame ? (s) => s.pkg ?? "__device" : undefined}
            groupLabel={(pkg) => (
              <>
                {name(pkg === "__device" ? undefined : pkg)}{" "}
                <span className="dim mono">
                  {pkg === "__device" ? "" : pkg}
                </span>
              </>
            )}
            sortKey="sessionSort"
          />
        </div>
      )}
      <DialogShell
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title="Delete this saved session?"
      >
        <p className="muted">
          Are you sure you want to delete{" "}
          <strong>{deleting?.name || "this saved session"}</strong>? This can’t
          be undone.
        </p>
        {remove.error && (
          <p className="badc" role="alert">{remove.error.message}</p>
        )}
        <div className="row-wrap" style={{ justifyContent: "flex-end" }}>
          <Button disabled={remove.isPending} onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            loadingLabel="Deleting…"
            onClick={() => {
              if (deleting && !remove.isPending) remove.mutate(deleting);
            }}
          >
            Delete session
          </Button>
        </div>
      </DialogShell>
    </section>
  );
}
