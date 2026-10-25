import { Fragment, useId, useState } from "react";
import { Icon } from "@avn/ui";
import { configValues } from "../config-values";
import { useViewState } from "../route-state";
import { clock } from "../state";
import type { Json, RemoteConfig } from "../types";
import { ConfigTree } from "./ConfigTree";

export function RemoteConfigTable({
  rc,
  showInLogs,
}: {
  rc?: RemoteConfig;
  showInLogs?: (id: number) => void;
}) {
  const [search, setSearch] = useViewState("configSearch", "");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const scope = useId();
  const values = configValues(rc);
  const rows = values.filter((value) =>
    `${value.name} ${value.type} ${value.sourceLabel} ${value.issue || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const missing = values.filter((value) => value.issue).length;
  const toggle = (name: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return (
    <section
      className="panel pl-config-values"
      aria-label="Firebase Remote Config variables"
    >
      <div className="ph report-heading">
        <div>
          <h2>Config values</h2>
          <p className="mute">
            {rc?.fetch
              ? `Fetch: ${rc.fetch.lastFetchStatus || "reported"}${rc.fetch.ts ? ` at ${clock(rc.fetch.ts, false)}` : ""}`
              : "Waiting for a fetch"}
          </p>
        </div>
        <input
          className="input"
          aria-label="Filter Remote Config variables"
          placeholder="Find a key, type or source..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {!!missing && (
        <div className="pl-config-missing-summary" role="status">
          <Icon name="alert" />
          <div>
            <b>
              {missing} {missing === 1 ? "key needs" : "keys need"} a value
            </b>
            <p>
              Missing or invalid values are marked below. No configured value
              means Firebase returned its fallback because neither a server
              value nor an app default was available.
            </p>
          </div>
        </div>
      )}
      <div className="t-wrap">
        <table className="t verification-table pl-config-table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Value</th>
              <th scope="col">Source</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((value, index) => {
              const open = expanded.has(value.name);
              const id = `${scope}-config-${index}`;
              const entries = value.expandable
                ? Object.keys(value.value as object).length
                : 0;
              return (
                <Fragment key={value.name}>
                  <tr
                    className={`${value.issue ? "pl-config-error" : ""}${value.expandable ? " pl-config-expandable" : ""}`}
                    onClick={(event) => {
                      if (
                        value.expandable &&
                        !(event.target as HTMLElement).closest("button, a")
                      )
                        toggle(value.name);
                    }}
                  >
                    <th scope="row">
                      <span className="mono pl-config-name">{value.name}</span>
                      <span className="tag plain pl-config-type">
                        {value.type}
                      </span>
                    </th>
                    <td className="rc-value">
                      {value.issue ? (
                        <div className="pl-config-value-error">
                          <b>
                            <Icon name="alert" />
                            {value.isStatic
                              ? "Missing value"
                              : value.truncated
                                ? "Incomplete value"
                                : "Value error"}
                          </b>
                          <span>{value.issue}</span>
                        </div>
                      ) : value.waiting ? (
                        <span className="muted">Waiting for fetch</span>
                      ) : value.expandable ? (
                        <button
                          className="btn pl-config-expand"
                          aria-expanded={open}
                          aria-controls={id}
                          onClick={() => toggle(value.name)}
                        >
                          <Icon name={open ? "caret" : "plus"} />
                          <span>
                            {open ? "Hide" : "Show"} {entries}{" "}
                            {Array.isArray(value.value) ? "items" : "fields"}
                          </span>
                        </button>
                      ) : (
                        <span className="mono pl-config-scalar">
                          {value.value === ""
                            ? '\"\" (empty string)'
                            : value.value === undefined
                              ? "No value captured"
                              : String(value.value)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`tag ${value.isStatic ? "bad" : "plain"}`}
                      >
                        {value.sourceLabel}
                      </span>
                    </td>
                    <td className="pl-config-evidence">
                      {value.ts ? <time>{clock(value.ts, false)}</time> : null}
                      {value.entryId && showInLogs ? (
                        <button
                          className="linkish"
                          onClick={() => showInLogs(value.entryId!)}
                        >
                          Show log
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {open && value.expandable && (
                    <tr className="pl-config-expanded">
                      <td colSpan={4}>
                        <section
                          id={id}
                          aria-label={`${value.name} fields`}
                          className="pl-config-inspector"
                        >
                          <div className="pl-config-inspector-head">
                            <b className="mono">{value.name}</b>
                            <button
                              className="btn ghost sm"
                              onClick={() => toggle(value.name)}
                            >
                              Close fields
                            </button>
                          </div>
                          <ConfigTree value={value.value as Json} />
                        </section>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="empty">
          {values.length
            ? "No matching keys."
            : "No config keys captured yet. Fetch Remote Config or restart the game while capturing logs."}
        </div>
      )}
    </section>
  );
}
