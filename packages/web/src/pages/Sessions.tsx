import {
  Button,
  Drawer,
  ErrorPanel,
  PageSkeleton,
  Segmented,
  Tag,
} from "@avn/ui";
import { useState } from "react";
import { PageHead } from "../components/bits";
import { DataTable } from "../components/DataTable";
import { FirebaseEvents } from "../components/FirebaseEvents";
import { SessionHistory } from "../components/SessionHistory";
import { StateBadge } from "../components/StateBadge";
import { useResource } from "../query";
import { useViewState } from "../route-state";
import { clock, useApp } from "../state";
import type { LogEntry, SavedSessionData } from "../types";

export function Sessions() {
  return (
    <main className="content">
      <PageHead
        title="Saved sessions"
        sub="Review and export captures from your game workspaces."
      />
      <SessionHistory filterable />
    </main>
  );
}
export function SavedSession() {
  const { archivedId, setView, archiveReturn } = useApp();
  const capture = useResource<SavedSessionData>(
    `sessions/${encodeURIComponent(archivedId ?? "")}`,
    { enabled: !!archivedId },
  );
  const data = capture.data,
    error = capture.error?.message;
  const retry = () => capture.refetch();
  const [tab, setTab] = useViewState("savedTab", "firebase"),
    [search, setSearch] = useViewState("savedSearch", ""),
    [limit, setLimit] = useState(500),
    [entry, setEntry] = useState<LogEntry | null>(null);
  const events = data?.snapshot?.firebase?.rows ?? [];
  const logs = (data?.entries ?? []).filter(
    (e) =>
      !search ||
      `${e.tag} ${e.message} ${(e.more || []).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="content">
      <PageHead
        title={data?.session.name || "Saved session"}
        sub={
          data
            ? `${data.session.gameName || data.session.pkg || "Capture"} · ${new Date(data.session.startedAt).toLocaleString()}`
            : "Loading saved capture…"
        }
      >
        <Button onClick={() => setView(archiveReturn)}>Back to sessions</Button>
      </PageHead>
      <div className="panel">
        <div className="status-strip">
          <Tag kind="plain">Saved capture</Tag>
          <span className="muted">
            Live events are paused while you review this session.
          </span>
        </div>
      </div>
      {error && (
        <ErrorPanel
          title="Could not open this capture"
          message={error}
          onRetry={() => retry()}
          onBack={() => setView(archiveReturn)}
          backLabel="Back to sessions"
        />
      )}
      {!data && !error && <PageSkeleton kpis={0} rows={6} />}
      {data && (
        <>
          <div className="filters">
            <Segmented
              label="Saved capture views"
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "firebase",
                  label: `Events (${events.length})`,
                },
                { value: "logs", label: `Logs (${data.entries.length})` },
                { value: "ads", label: "Ad state" },
              ]}
            />
          </div>
          {tab === "firebase" && (
            <FirebaseEvents
              firebase={data.snapshot?.firebase ?? { rows: [] }}
            />
          )}
          {tab === "logs" && (
            <>
              <div className="filters">
                <input
                  className="input"
                  placeholder="Search saved logs…"
                  aria-label="Search saved logs"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setLimit(500);
                  }}
                />
                {search && (
                  <Button variant="ghost" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                )}
              </div>
              <div className="panel t-wrap">
                <DataTable
                  data={logs.slice(0, limit)}
                  className="t"
                  rowKey={(e, i) => String(i)}
                  sortKey="pagesSessionstsx-sort"
                  columns={[
                    {
                      id: "col0",
                      header: <>Time</>,
                      className: "mono pl-nowrap",
                      cell: (e, i) => {
                        return <>{clock(e.ts)}</>;
                      },
                    },
                    {
                      id: "col1",
                      header: <>Level</>,
                      cell: (e, i) => {
                        return (
                          <>
                            <Tag
                              kind={
                                ["E", "F"].includes(e.level)
                                  ? "bad"
                                  : e.level === "W"
                                    ? "warn"
                                    : "plain"
                              }
                            >
                              {e.level}
                            </Tag>
                          </>
                        );
                      },
                    },
                    {
                      id: "col2",
                      header: <>Message</>,
                      cell: (e, i) => {
                        return (
                          <>
                            <button
                              className="pl-row-link mono pl-log-message"
                              onClick={() => setEntry(e)}
                            >
                              {e.message}
                            </button>
                          </>
                        );
                      },
                    },
                  ]}
                />
                {!logs.length && (
                  <div className="empty">No matching lines.</div>
                )}
              </div>
              {logs.length > limit && (
                <Button onClick={() => setLimit(limit + 500)}>
                  Show more lines
                </Button>
              )}
            </>
          )}
          {tab === "ads" && (
            <div className="panel t-wrap">
              <DataTable
                data={data.snapshot?.health?.funnels ?? []}
                className="t"
                rowKey={(f) => String(f.key)}
                sortKey="pagesSessionstsx-sort"
                columns={[
                  {
                    id: "col0",
                    header: <>Ad format</>,
                    cell: (f) => {
                      return <>{f.name}</>;
                    },
                  },
                  {
                    id: "col1",
                    header: <>Loaded</>,
                    className: "num mono",
                    cell: (f) => {
                      return <>{f.loaded}</>;
                    },
                  },
                  {
                    id: "col2",
                    header: <>Shown</>,
                    className: "num mono",
                    cell: (f) => {
                      return <>{f.shown || f.displayed}</>;
                    },
                  },
                  {
                    id: "col3",
                    header: <>State</>,
                    cell: (f) => {
                      return (
                        <>
                          <StateBadge state={f.state} />
                        </>
                      );
                    },
                  },
                ]}
              />
              {!data.snapshot?.health?.funnels?.length && (
                <div className="empty">No ad activity in this capture.</div>
              )}
            </div>
          )}
        </>
      )}
      <Drawer
        open={!!entry}
        onClose={() => setEntry(null)}
        title={entry?.tag || "Log entry"}
        subtitle={entry ? clock(entry.ts) : undefined}
      >
        {entry && (
          <pre className="pl-trace">
            {[entry.message, ...(entry.more || [])].join("\n")}
          </pre>
        )}
      </Drawer>
    </main>
  );
}
