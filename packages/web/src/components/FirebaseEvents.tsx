import { Drawer } from "@avn/ui";
import { useMemo, useState } from "react";
import type { EventOption } from "../firebase-events";
import {
  eventMatches,
  eventOptions,
  eventTypes,
  formatGap,
  isFirebaseParameter,
  visibleParameters,
} from "../firebase-events";
import { useViewPreference, useViewState } from "../route-state";
import { clock } from "../state";
import type { FirebaseEvent, FirebaseInput } from "../types";
import { DataTable } from "./DataTable";

export const EVENT_CHECK: Record<string, [string, string]> = {
  "matches-plugin": ["Matches plugin", "tag-ok"],
  "game-code": ["Firebase log", "tag-plain"],
  automatic: ["Automatic", "tag-plain"],
  "not-in-firebase": ["No Firebase log", "tag-warn"],
  "plugin-pending": ["Sent to SDK", "tag-plain"],
  "dropped-by-plugin": ["Dropped by plugin", "tag-bad"],
  "sent-before-init": ["Sent before init", "tag-warn"],
  "plugin-only": ["Plugin only", "tag-plain"],
};
const WHY: Record<string, string> = {
  "not-in-firebase":
    "The plugin handed this event to the Firebase SDK, but no matching event payload was captured for this game. This does not prove upload failure. Check SDK logs and Firebase DebugView; shared service logs without a package cannot be attributed safely.",
  "plugin-pending":
    "The plugin handed this event to the Firebase SDK. Waiting for a matching Firebase event log; SDK handoff does not confirm server delivery.",
  "dropped-by-plugin":
    "The plugin dropped this event because Firebase was not initialized yet.",
  "sent-before-init":
    "The plugin sent this before Firebase finished starting, so Firebase may have dropped it.",
  "plugin-only":
    "ByteBrew has no debug log on the phone, so only the plugin line is visible: the event name and how many parameters it had, not their values.",
};

const countLabel = (option: EventOption) =>
  [
    `${option.logged} logged`,
    option.reports && `${option.reports} ByteBrew reports`,
    option.unconfirmed && `${option.unconfirmed} unconfirmed`,
  ]
    .filter(Boolean)
    .join(" · ");
const timestamp = (ts: number) => (
  <time
    dateTime={new Date(ts).toISOString()}
    title={new Date(ts).toLocaleString()}
  >
    {clock(ts, false)}
  </time>
);

export function FirebaseEvents({
  firebase: fb,
  showInLogs,
}: {
  firebase: FirebaseInput;
  showInLogs?: (id: number) => void;
}) {
  const [sdk, setSdk] = useViewState("eventSdk", "ALL");
  const [name, setName] = useViewState("eventName", "");
  const [view, setView] = useViewState("eventView", "timeline");
  const [open, setOpen] = useState<string | null>(null);
  const [hideAuto, setHideAuto] = useViewPreference<boolean>(
    "hideAutoEvents",
    "playlens.firebase.hideAuto",
    false,
  );
  const [showInternal, setShowInternal] = useViewPreference<boolean>(
    "showFirebaseParameters",
    "playlens.firebase.showInternal",
    false,
  );
  const options = useMemo(
    () => eventOptions(fb, { sdk, hideAuto }),
    [fb, sdk, hideAuto],
  );
  const selectedName = options.some((option) => option.name === name)
    ? name
    : "";
  const filters = { sdk, hideAuto, name: selectedName };
  const rows = (fb.rows ?? []).filter((row) => eventMatches(row, filters));
  const types = eventTypes(fb, filters);
  const allTypes = eventTypes(fb, { sdk, hideAuto });
  const logged = types
    .filter((type) => type.sdk === "FA")
    .reduce((n, type) => n + type.count, 0);
  const reports = types
    .filter((type) => type.sdk === "BB")
    .reduce((n, type) => n + type.count, 0);
  const hasByteBrew =
    (fb.counts?.byteBrew ?? 0) > 0 || fb.rows?.some((row) => row.sdk === "BB");
  const clearFilters = () => {
    setName("");
    setSdk("ALL");
    setHideAuto(false);
  };

  const selectedRow = rows.find((row) => row.id === open);
  return (
    <section className="firebase-explorer" aria-label="Captured event explorer">
      <div className="filters event-toolbar">
        <div className="seg" role="group" aria-label="Event views">
          <button
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            Event timeline
          </button>
          <button
            aria-pressed={view === "dictionary"}
            onClick={() => setView("dictionary")}
          >
            Event dictionary ({allTypes.length})
          </button>
        </div>
        {hasByteBrew && (
          <label className="event-filter">
            Source
            <select
              className="select"
              aria-label="Event source"
              value={sdk}
              onChange={(event) => {
                setSdk(event.target.value);
                setName("");
              }}
            >
              <option value="ALL">All sources</option>
              <option value="FA">Firebase</option>
              <option value="BB">ByteBrew</option>
            </select>
          </label>
        )}
        <label className="event-filter">
          Event type
          <select
            className="select"
            aria-label="Event type"
            value={selectedName}
            onChange={(event) => setName(event.target.value)}
          >
            <option value="">
              All event types (
              {options.reduce((n, option) => n + option.logged, 0)} logged
              {hasByteBrew
                ? ` · ${options.reduce((n, option) => n + option.reports, 0)} ByteBrew reports`
                : ""}
              )
            </option>
            {options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name} ({countLabel(option)})
              </option>
            ))}
          </select>
        </label>
        <label className="event-toggle">
          <input
            type="checkbox"
            checked={hideAuto}
            onChange={(event) => setHideAuto(event.target.checked)}
          />
          Hide automatic events
        </label>
        <label
          className="event-toggle"
          title="Show Firebase bookkeeping flags, screen metadata, session IDs and engagement timing for every event."
        >
          <input
            type="checkbox"
            checked={showInternal}
            onChange={(event) => setShowInternal(event.target.checked)}
          />
          Show Firebase parameters
        </label>
        {(selectedName || sdk !== "ALL" || hideAuto) && (
          <button className="linkish" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="event-caption dim">
        <span>
          {view === "dictionary"
            ? `${types.length} unique event ${types.length === 1 ? "type" : "types"}`
            : `${rows.length} ${rows.length === 1 ? "row" : "rows"} shown`}{" "}
          · {logged} logged by Firebase
          {reports ? ` · ${reports} ByteBrew reports` : ""} · this capture
        </span>
        <span>
          {showInternal
            ? "All parameters visible"
            : "Firebase parameters hidden"}
        </span>
      </div>
      {fb.catalog &&
        fb.catalog.reduce((n, type) => n + type.count, 0) >
          (fb.rows ?? []).filter((row) => !row.missing).length && (
          <p className="dim event-note">
            The timeline keeps the latest 500 rows. Dictionary statistics and
            filter counts cover the entire capture.
          </p>
        )}
      {!fb.catalog &&
        (fb.counts?.firebase ?? 0) >
          (fb.rows ?? []).filter((row) => row.sdk === "FA" && !row.missing)
            .length && (
          <p className="dim event-note">
            This older capture has a partial event timeline. Statistics cover
            its saved event rows.
          </p>
        )}

      {view === "dictionary" ? (
        <div className="panel event-dictionary">
          <div className="ph event-dictionary-intro">
            <h2 className="px">Event dictionary</h2>
            <p className="mute">
              Unique events observed in this capture, ordered by count.
              Unconfirmed plugin attempts are excluded. Average gap is the time
              between first and last occurrence divided by the number of gaps.
            </p>
          </div>
          {!types.length ? (
            <div className="empty">No logged events match these filters.</div>
          ) : (
            <div className="t-wrap">
              <DataTable
                data={types}
                className="t event-stats"
                rowKey={(type) => String(JSON.stringify([type.sdk, type.name]))}
                sortKey="componentsFirebaseEventstsx-sort"
                columns={[
                  {
                    id: "col0",
                    header: <>Event</>,
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return (
                        <>
                          <span className="mono">{type.name}</span>
                          <div className="event-type-origin dim">
                            <span className={`tag sdk-${type.sdk}`}>
                              {type.sdk}
                            </span>
                            {type.sdk === "BB"
                              ? "Plugin reports"
                              : type.automatic === type.count
                                ? "Automatic"
                                : type.automatic
                                  ? `${type.automatic} automatic`
                                  : "App / SDK event"}
                          </div>
                        </>
                      );
                    },
                  },
                  {
                    id: "col1",
                    header: <>Count</>,
                    className: "mono event-stat-count",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return <>{type.count}</>;
                    },
                  },
                  {
                    id: "col2",
                    header: <>First seen</>,
                    className: "mono",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return <>{timestamp(type.firstTs)}</>;
                    },
                  },
                  {
                    id: "col3",
                    header: <>Last seen</>,
                    className: "mono",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return <>{timestamp(type.lastTs)}</>;
                    },
                  },
                  {
                    id: "col4",
                    header: <>Avg. gap</>,
                    className: "mono",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return <>{formatGap(type.averageGap)}</>;
                    },
                  },
                  {
                    id: "col5",
                    header: <>Parameter names</>,
                    className: "event-param-names",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return (
                        <>
                          {params.map((param) => (
                            <span key={param} className="chip mono">
                              {param}
                            </span>
                          ))}
                          {!params.length && (
                            <span className="dim">
                              {type.sdk === "BB"
                                ? "Values unavailable"
                                : "None"}
                            </span>
                          )}
                          {hidden > 0 && (
                            <span className="dim event-hidden">
                              {hidden} Firebase{" "}
                              {hidden === 1 ? "parameter" : "parameters"} hidden
                            </span>
                          )}
                        </>
                      );
                    },
                  },
                  {
                    id: "col6",
                    header: <span className="visually-hidden">Actions</span>,
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const hidden = type.params.length - params.length;
                      return (
                        <>
                          <button
                            className="linkish"
                            aria-label={`View ${type.name} events from ${type.sdk}`}
                            onClick={() => {
                              setName(type.name);
                              setSdk(type.sdk);
                              setView("timeline");
                              setOpen(null);
                            }}
                          >
                            View events
                          </button>
                        </>
                      );
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div
            className="erow eyebrow"
            style={{ cursor: "default", minHeight: 40, borderTop: 0 }}
          >
            <span>Time</span>
            <span>From</span>
            <span>Event</span>
            <span>Parameters</span>
            <span>Plugin check</span>
            <span />
          </div>
          {rows.length === 0 && (
            <div className="empty">
              {fb.rows?.length || selectedName || hideAuto
                ? "No timeline rows match these filters."
                : "No events captured yet."}
            </div>
          )}
          {rows.map((row) => {
            const isOpen = open === row.id;
            const [checkLabel, checkClass] = EVENT_CHECK[row.check] ?? [
              row.check,
              "tag-plain",
            ];
            const params = visibleParameters(row.params, showInternal);
            const hidden = Object.keys(row.params ?? {}).length - params.length;
            return (
              <div key={row.id}>
                <button
                  className={`erow${isOpen ? " open" : ""}${row.missing ? " missing" : row.problems?.length ? " warn" : ""}`}
                  onClick={() => setOpen(isOpen ? null : row.id)}
                  aria-expanded={isOpen}
                >
                  <span className="mono dim" style={{ fontSize: 12.5 }}>
                    {timestamp(row.ts)}
                  </span>
                  <span
                    className={`tag sdk-${row.sdk}`}
                    style={{ justifySelf: "start" }}
                  >
                    {row.sdk}
                  </span>
                  <span
                    className="mono ename"
                    style={{
                      fontSize: 15,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.name}
                  </span>
                  <span className="event-param-preview">
                    {row.sdk === "BB" ? (
                      <span className="dim mono">{row.paramCount} params</span>
                    ) : (
                      params.slice(0, 3).map(([key, value]) => (
                        <span key={key} className="chip">
                          <span className="dim">{key}</span>
                          {String(value)}
                        </span>
                      ))
                    )}
                    {row.sdk !== "BB" && !params.length && (
                      <span className="dim">
                        {hidden ? "Only Firebase parameters" : "No parameters"}
                      </span>
                    )}
                    {params.length > 3 && (
                      <span className="dim">+{params.length - 3} more</span>
                    )}
                  </span>
                  <span>
                    <span className={`tag ${checkClass}`}>{checkLabel}</span>
                  </span>
                  <svg
                    className="car"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <Drawer
        open={!!selectedRow}
        onClose={() => setOpen(null)}
        title={selectedRow?.name || "Event details"}
        subtitle={
          selectedRow
            ? `${selectedRow.sdk} · ${clock(selectedRow.ts)}`
            : undefined
        }
      >
        {selectedRow && (
          <EventDetails
            row={selectedRow}
            showInternal={showInternal}
            showInLogs={showInLogs}
          />
        )}
      </Drawer>
    </section>
  );
}

function EventDetails({
  row,
  showInternal,
  showInLogs,
}: {
  row: FirebaseEvent;
  showInternal: boolean;
  showInLogs?: (id: number) => void;
}) {
  const params = visibleParameters(row.params, showInternal);
  const [label, kind] = EVENT_CHECK[row.check] ?? [row.check, "tag-plain"];
  return (
    <div className="pl-setup-panel">
      <span className={`tag ${kind}`}>{label}</span>
      {WHY[row.check] && <p className="muted">{WHY[row.check]}</p>}
      {row.problems?.map((problem) => (
        <p className="warnc" key={problem}>
          {problem}
        </p>
      ))}
      <div className="eyebrow">Parameters</div>
      {params.map(([key, value]) => (
        <div className="kv" key={key}>
          <span className="mono muted">{key}</span>
          <span className="mono">{String(value)}</span>
        </div>
      ))}
      {!params.length && (
        <p className="muted">
          {row.sdk === "BB"
            ? "Parameter values are unavailable for ByteBrew."
            : "No visible parameters. Enable Firebase parameters to inspect internal metadata."}
        </p>
      )}
      {row.entryId && showInLogs && (
        <button className="btn" onClick={() => showInLogs(row.entryId!)}>
          Show in logs
        </button>
      )}
    </div>
  );
}
