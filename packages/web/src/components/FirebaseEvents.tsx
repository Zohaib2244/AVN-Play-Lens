import { Drawer, Icon } from "@avn/ui";
import { useMemo, useState } from "react";
import type { EventOption } from "../firebase-events";
import {
  eventMatches,
  eventOptions,
  eventTypes,
  isFirebaseParameter,
  visibleParameters,
} from "../firebase-events";
import { useViewPreference, useViewState } from "../route-state";
import { clock } from "../state";
import type { FirebaseEvent, FirebaseInput } from "../types";
import { DataTable } from "./DataTable";
import { eventStatus } from "../event-status";
import { EventParameters, parameterText } from "./EventParameters";

export const EVENT_CHECK: Record<string, [string, string]> = {
  "matches-plugin": ["Recorded by Firebase", "tag-ok"],
  "game-code": ["Recorded by Firebase", "tag-ok"],
  automatic: ["Recorded by Firebase", "tag-ok"],
  "not-in-firebase": ["Not confirmed", "tag-warn"],
  "plugin-pending": ["Waiting for Firebase", "tag-plain"],
  "dropped-by-plugin": ["Not sent", "tag-bad"],
  "sent-before-init": ["Not confirmed", "tag-warn"],
  "plugin-only": ["ByteBrew reported", "tag-plain"],
};

function EventRecordingStatus({ row }: { row: FirebaseEvent }) {
  const status = eventStatus(row);
  return (
    <span className={`pl-event-recording ${status.kind}`} title={status.reason}>
      <Icon
        name={
          status.kind === "ok" ? "check" : status.kind === "bad" ? "x" : "info"
        }
      />
      {status.label}
    </span>
  );
}

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
  const latestByType = useMemo(() => {
    const latest = new Map<string, FirebaseEvent>();
    for (const row of fb.rows ?? []) {
      if (row.missing || !eventMatches(row, { sdk, hideAuto })) continue;
      const key = JSON.stringify([row.sdk, row.name]);
      if (!latest.has(key) || latest.get(key)!.ts < row.ts)
        latest.set(key, row);
    }
    return latest;
  }, [fb.rows, sdk, hideAuto]);
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

      <p className="pl-event-evidence-note">
        Recorded means Firebase logged the event on this phone. Server arrival
        is checked in{" "}
        <a
          href="https://firebase.google.com/docs/analytics/debugview"
          target="_blank"
          rel="noreferrer"
        >
          Firebase DebugView
        </a>
        .
      </p>
      <div className="event-caption dim">
        <span>
          {view === "dictionary"
            ? `${types.length} unique event ${types.length === 1 ? "type" : "types"}`
            : `${rows.length} ${rows.length === 1 ? "row" : "rows"} shown`}{" "}
          · {logged} logged by Firebase
          {reports ? ` · ${reports} ByteBrew reports` : ""} · this capture
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
              Events observed in this capture, ordered by count. Select an event
              name to see its timeline.
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
                    id: "event",
                    header: "Event",
                    cell: (type) => (
                      <>
                        <button
                          className="linkish mono"
                          onClick={() => {
                            setName(type.name);
                            setSdk(type.sdk);
                            setView("timeline");
                            setOpen(null);
                          }}
                        >
                          {type.name}
                        </button>
                        <div className="event-type-origin dim">
                          {type.sdk === "BB"
                            ? "ByteBrew · plugin report"
                            : type.automatic === type.count
                              ? "Firebase · automatic"
                              : "Firebase · app / SDK event"}
                        </div>
                      </>
                    ),
                  },
                  {
                    id: "count",
                    header: "Count",
                    className: "mono",
                    sortable: true,
                    value: (type) => type.count,
                    cell: (type) => type.count,
                  },
                  {
                    id: "last-seen",
                    header: "Last seen",
                    className: "mono",
                    sortable: true,
                    value: (type) => type.lastTs,
                    cell: (type) => timestamp(type.lastTs),
                  },
                  {
                    id: "parameters",
                    header: "Parameters (latest event)",
                    className: "event-param-names",
                    cell: (type) => {
                      const params = type.params.filter(
                        (param) => showInternal || !isFirebaseParameter(param),
                      );
                      const latest = latestByType.get(
                        JSON.stringify([type.sdk, type.name]),
                      );
                      return (
                        <EventParameters
                          entries={params.map((param) => [
                            param,
                            latest?.params?.[param],
                          ])}
                          empty={
                            type.sdk === "BB"
                              ? "Values unavailable"
                              : "No parameters"
                          }
                        />
                      );
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="panel pl-event-timeline">
          <div className="pl-event-table-head eyebrow" aria-hidden="true">
            <span>Time</span>
            <span>Event / recording status</span>
            <span>Parameters</span>
          </div>
          {!rows.length && (
            <div className="empty">
              {fb.rows?.length || selectedName || hideAuto
                ? "No events match these filters."
                : "No events captured yet."}
            </div>
          )}
          {rows.map((row) => {
            const params = visibleParameters(row.params, showInternal);
            const status = eventStatus(row);
            return (
              <article
                className={`pl-event-row ${status.state}`}
                key={row.id}
                aria-label={row.name}
              >
                <div className="pl-event-time">{timestamp(row.ts)}</div>
                <div className="pl-event-identity">
                  <button
                    type="button"
                    className="pl-event-name mono"
                    onClick={() => setOpen(row.id)}
                    aria-label={`Inspect ${row.name}`}
                  >
                    {row.name}
                  </button>
                  <EventRecordingStatus row={row} />
                  {status.state === "unconfirmed" &&
                    row.check === "sent-before-init" && (
                      <small className="muted">Before initialization</small>
                    )}
                </div>
                <EventParameters
                  entries={params}
                  empty={
                    row.sdk === "BB"
                      ? `${row.paramCount ?? 0} parameters reported; values unavailable`
                      : "No parameters"
                  }
                />
              </article>
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
            ? `${selectedRow.sdk === "FA" ? "Firebase" : "ByteBrew"} · ${clock(selectedRow.ts)}`
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
  const status = eventStatus(row);
  return (
    <div className="pl-setup-panel">
      <EventRecordingStatus row={row} />
      <p className="muted">{status.reason}</p>
      {row.problems?.map((problem) => (
        <p className="warnc" key={problem}>
          {problem}
        </p>
      ))}
      <div className="eyebrow">Parameters</div>
      <dl className="pl-event-detail-params">
        {params.map(([key, value]) => (
          <div key={key}>
            <dt className="mono">{key}</dt>
            <dd className="mono">{parameterText(value)}</dd>
          </div>
        ))}
      </dl>
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
