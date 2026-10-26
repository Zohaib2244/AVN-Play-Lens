import { Button, Kpi, Kpis, Panel, Pipeline, StatusStrip, Tag } from "@avn/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Lattice, PageHead } from "../components/bits";
import { DataTable } from "../components/DataTable";
import { StateBadge } from "../components/StateBadge";
import { Disclosure, Skeleton } from "../components/ui";
import dora from "../design/dora.svg?raw";
import { healthIssues } from "../health-issues";
import { useViewState } from "../route-state";
import { clock, deviceName, secs, useApp } from "../state";
import type {
  HealthSnapshot,
  RuntimeCheck,
  SdkCard as SdkCardData,
} from "../types";
import { useTrackingGate } from "../components/TrackingGate";

const STEP_NAMES: Record<string, string> = {
  awake: "Awake",
  start: "Start",
  accepted: "Init accepted",
  max: "MAX",
  firebase: "Firebase",
  admob: "AdMob",
  rc: "Remote config",
  done: "Init done",
  autoload: "Auto-load",
};
const SEVERITY_TAG: Record<string, string> = {
  critical: "tag-bad",
  warning: "tag-warn",
  info: "tag-plain",
};

export function StatusMark({ status }: { status: string }) {
  const map: Record<string, [string, ReactNode]> = {
    ok: ["ok", <Check key="c" size={13} />],
    problem: ["problem", "!"],
    warn: ["warn", "!"],
    pending: ["pending", null],
    info: ["info", "i"],
    skipped: ["skipped", "–"],
  };
  const [cls, inner] = map[status] ?? map.pending;
  return (
    <span className={`ck ${cls}`} aria-label={status}>
      {inner}
    </span>
  );
}

function CheckList({
  checks,
  empty,
}: {
  checks?: RuntimeCheck[];
  empty?: string;
}) {
  if (!checks?.length && !empty) return null;
  if (!checks?.length)
    return (
      <div className="dim" style={{ padding: "12px 22px 18px", fontSize: 14 }}>
        {empty}
      </div>
    );
  return checks.map((c) => (
    <div key={c.id} className="citem" style={{ padding: "13px 22px" }}>
      <StatusMark status={c.status} />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{c.name}</span>
        {c.key && (
          <span className="mono dim" style={{ fontSize: 12.5 }}>
            {" "}
            {c.key}={String(c.value ?? "")}
          </span>
        )}
        {c.note && (
          <span
            className="dim"
            style={{ display: "block", fontSize: 13, marginTop: 3 }}
          >
            {c.note}
          </span>
        )}
      </span>
      <span
        className={`mono ${c.status === "problem" ? "badc" : c.status === "warn" ? "warnc" : "mute"}`}
        style={{ fontSize: 13, textAlign: "right", maxWidth: 260 }}
      >
        {c.result}
      </span>
    </div>
  ));
}

function LaunchTimeline({ launch }: { launch: HealthSnapshot["launch"] }) {
  if (!launch) return null;
  const steps = launch.steps.filter((x) => x.at != null && x.id !== "rc");
  const max = Math.max(1, ...steps.map((x) => x.at!));
  return (
    <div style={{ marginBottom: 18 }}>
      {steps.map((x) => (
        <div key={x.id} className="lrow">
          <span>{x.label}</span>
          <span className="lbar">
            <i style={{ width: `${Math.max(0.6, (x.at! / max) * 100)}%` }} />
          </span>
          <span className="mono" style={{ textAlign: "right" }}>
            {x.id === "process" ? "0" : `+${secs(x.at)}`}
          </span>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {x.android != null ? `Android: ${secs(x.android)}` : ""}
          </span>
        </div>
      ))}
      <div className="dim" style={{ fontSize: 13, marginTop: 8 }}>
        {launch.captured
          ? 'From tapping the icon (game process start). "Android" is the launch time Android itself reports.'
          : "The launch happened before the log started, so times are from the first plugin line. Use Restart game in Logs to measure a full launch."}
      </div>
    </div>
  );
}

function sdkState(card: SdkCardData) {
  if (card.notUsed) return "Not used";
  if (card.noLogs) return "No logs";
  return card.state || "Not seen";
}

function SdkCard({ card }: { card: SdkCardData }) {
  const state = sdkState(card);
  return (
    <div className={`panel sdk${card.notUsed || card.noLogs ? " na" : ""}`}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{ fontWeight: 700, fontSize: 16 }}
          className={card.notUsed || card.noLogs ? "mute" : ""}
        >
          {card.label}
        </span>
        <StateBadge
          state={state}
          label={state === "Initialized" ? "Ready" : state}
        />
      </div>
      {card.notUsed && (
        <span className="dim" style={{ fontSize: 13.5 }}>
          USE_BYTEBREW is off for this game (set byteBrew: true in its rules
          file if it's on).
        </span>
      )}
      {card.noLogs && (
        <span className="dim" style={{ fontSize: 13.5 }}>
          The plugin can't log AppsFlyer's start. Turn on isDebug to see
          AppsFlyer's own lines.
        </span>
      )}
      {!card.notUsed && !card.noLogs && (
        <>
          <span className="mono dim" style={{ fontSize: 12.5 }}>
            {card.upInMs != null
              ? `up in ${secs(card.upInMs)}`
              : card.waitingMs != null && card.state !== "Initialized"
                ? `waiting ${secs(card.waitingMs)}`
                : card.state
                  ? ""
                  : "no line yet"}
          </span>
          {card.state === "Failed" && (
            <span className="mute" style={{ fontSize: 13.5, lineHeight: 1.45 }}>
              {card.message}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// A group of checks that shows only what needs attention, with the rest one click away.
function CheckCard({
  title,
  sub,
  checks,
  empty,
}: {
  title: string;
  sub?: string;
  checks?: RuntimeCheck[];
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  const list = checks ?? [];
  const count = (st: string) => list.filter((c) => c.status === st).length;
  const attention = list.filter(
    (c) => c.status === "problem" || c.status === "warn",
  );
  const ok = count("ok");
  const waiting = count("pending");
  return (
    <section
      className="panel"
      style={{ flex: "1 1 400px", minWidth: 0, overflow: "hidden" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 22px 10px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
        <span style={{ flex: "1 1 auto" }} />
        {count("problem") > 0 && (
          <span className="tag tag-bad">
            {count("problem")} problem{count("problem") > 1 ? "s" : ""}
          </span>
        )}
        {count("warn") > 0 && (
          <span className="tag tag-warn">{count("warn")} to check</span>
        )}
        {ok > 0 && <span className="tag tag-ok">{ok} ok</span>}
        {waiting > 0 && (
          <span className="tag tag-plain">{waiting} waiting</span>
        )}
      </div>
      {sub && (
        <div className="dim" style={{ fontSize: 13, padding: "0 22px 8px" }}>
          {sub}
        </div>
      )}
      {!list.length ? (
        <div className="dim" style={{ padding: "6px 22px 18px", fontSize: 14 }}>
          {empty}
        </div>
      ) : (
        <>
          <CheckList checks={all ? list : attention} empty="" />
          {!all && !attention.length && (
            <div
              className="mute"
              style={{ padding: "6px 22px 14px", fontSize: 14 }}
            >
              {waiting
                ? `Nothing wrong so far. ${waiting} still waiting for the game to get there.`
                : "Everything checks out."}
            </div>
          )}
          <button
            className="linkish"
            style={{ margin: "4px 22px 16px" }}
            onClick={() => setAll(!all)}
          >
            {all ? "Show only issues" : `Show all ${list.length} checks`}
          </button>
        </>
      )}
    </section>
  );
}

function HealthSkeleton() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
      aria-busy="true"
      aria-label="Loading plugin health"
    >
      <div
        className="panel"
        style={{
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Skeleton w="40%" h={24} />
        <Skeleton w="70%" />
      </div>
      <div className="panel" style={{ padding: 22, display: "flex", gap: 18 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} w="100%" h={46} r={10} />
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="panel"
            style={{
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Skeleton w="60%" h={16} />
            <Skeleton w="40%" h={11} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Health() {
  const { monitor, device, pkg, showInLogs, setView, gameInventory, serial } =
    useApp();
  const [onlyProblems, setOnlyProblems] = useViewState("adapterProblems", true);
  const [allIssues, setAllIssues] = useState(false);
  const h = monitor?.health;
  const head = (sub?: string) => (
    <PageHead
      title="Health"
      sub={
        sub ??
        `AVN plugin · ${pkg || "no game picked"} on ${deviceName(device)}`
      }
    />
  );

  const installed =
    gameInventory.serial === serial
      ? gameInventory.games.find((g) => g.packageId === pkg)?.installed
      : undefined;
  const gate = useTrackingGate("Health", !!monitor);
  if (gate) return gate;
  if (!device || installed === false)
    return (
      <main className="content">
        {head()}
        <Panel>
          <div className="pl-empty">
            <h2>
              {!device ? "No device connected." : "This game is not installed."}
            </h2>
            <p className="muted">
              Connect a device with this game installed to receive plugin
              evidence.
            </p>
            <Button onClick={() => setView("game")}>Open game controls</Button>
          </div>
        </Panel>
      </main>
    );
  if (!monitor)
    return (
      <main className="content">
        {head()}
        <HealthSkeleton />
      </main>
    );
  if (!h?.seen) {
    return (
      <main className="content">
        {head()}
        <div
          className="panel empty"
          style={{
            lineHeight: 1.7,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Lattice />
          <div className="px" style={{ fontSize: 22, color: "var(--text)" }}>
            Waiting for the AVN plugin
          </div>
          <div>
            Launch or restart the game. Plugin lines end with{" "}
            <span className="mono">| AVNPLUGIN</span>.<br />
            If the game is running and nothing shows up, the build may not
            include the plugin.
          </div>
          <button className="btn" onClick={() => setView("logs")}>
            Open logs
          </button>
        </div>
      </main>
    );
  }

  const startup = h.startup.filter((s) => s.id !== "rc");
  const done = startup.filter((s) => s.status === "done").length;
  const sdk = Object.fromEntries(h.sdks.map((c) => [c.key, c]));
  const adapters = h.adapters.filter(
    (a) => !onlyProblems || a.status !== "InitializedSuccess",
  );
  const okAdapters = h.adapters.filter(
    (a) => a.status === "InitializedSuccess",
  ).length;
  const extra = monitor.sdkList;
  const startedLabel = h.appStart ? `launched ${clock(h.appStart, false)}` : "";

  // Everything that needs a look, in one list: rule hits, broken ad rules, privacy problems.
  const issues = healthIssues(monitor);
  const shownIssues = allIssues ? issues : issues.slice(0, 3);
  const readySdks = h.sdks.filter(
    (c) => c.state === "Initialized" && c.key !== "SDK.RemoteConfig",
  ).length;
  const seenSdks = h.sdks.filter(
    (c) =>
      c.key !== "SDK.RemoteConfig" &&
      (c.state || (!c.notUsed && !c.noLogs && c.key !== "SDK.Purchaser")),
  );
  const ads = h.funnels.reduce(
    (n, f) =>
      n +
      (f.format === "interstitial" || f.format === "rewarded" ? f.shown : 0),
    0,
  );
  const healthy = !issues.length && !h.debugInRelease;

  return (
    <main className="content pl-health" style={{ gap: 22 }}>
      <PageHead
        title="Health"
        sub={`AVN plugin · ${pkg} on ${deviceName(device)}${startedLabel ? ` · ${startedLabel}` : ""}`}
      >
        {h.debugLogs === "off" && (
          <span className="tag tag-warn">Plugin debug logs off</span>
        )}
      </PageHead>

      <StatusStrip
        live={false}
        status={
          healthy
            ? "No issues observed"
            : `${issues.length} ${issues.length === 1 ? "issue" : "issues"} to fix`
        }
        items={[
          device?.replay ? "Simulated replay evidence" : "Current capture",
        ]}
        tag={
          <Tag kind={healthy ? "ok" : "warn"}>
            {healthy ? "Clear so far" : "Needs attention"}
          </Tag>
        }
      />
      <Panel
        title="Issues to fix"
        actions={
          <Tag kind={issues.length ? "warn" : "plain"}>
            {issues.length} observed issues
          </Tag>
        }
      >
        {shownIssues.map((f) => (
          <div className="look" key={f.id}>
            <span className={`tag ${SEVERITY_TAG[f.severity]}`}>
              {f.severity === "critical" ? "Failed" : "Warning"}
            </span>
            <div>
              <b>{f.name}</b>
              <span className="s" title={f.detail}>
                {f.detail}
              </span>
            </div>
            {f.entryId && (
              <button
                className="btn ghost sm"
                onClick={() => showInLogs(f.entryId!)}
              >
                Inspect
              </button>
            )}
          </div>
        ))}
        {!issues.length && (
          <div className="pl-quiet">
            <span dangerouslySetInnerHTML={{ __html: dora }} />
            <p className="muted">
              No issues observed in the evidence received so far.
            </p>
          </div>
        )}
        {issues.length > 3 && (
          <div className="pb">
            <button
              className="btn ghost"
              onClick={() => setAllIssues(!allIssues)}
            >
              {allIssues ? "Show fewer" : `Show all ${issues.length}`}
            </button>
          </div>
        )}
      </Panel>

      <Kpis>
        <Kpi
          label="Startup"
          value={`${done} / ${startup.length}`}
          context="Steps completed"
        />
        <Kpi
          label="SDKs ready"
          value={readySdks}
          context="Initialized in this capture"
        />
        <Kpi
          label="Ads shown"
          value={ads}
          context="Interstitial and rewarded"
        />
        <Kpi
          label="Ad revenue"
          value={`$${h.revenue.total.toFixed(4)}`}
          context="Reported by the game"
        />
      </Kpis>
      <section className="panel rise" style={{ padding: "18px 22px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <span className="eyebrow">Startup</span>
          <span className="mono" style={{ fontSize: 13 }}>
            <span style={{ color: "var(--ok)" }}>{done}</span>
            <span className="dim"> of {startup.length} steps</span>
          </span>
        </div>
        <Pipeline
          live={false}
          steps={startup.map((s) => ({
            label: STEP_NAMES[s.id] ?? s.id,
            detail:
              s.status === "done"
                ? secs(s.at)
                : s.status === "timeout"
                  ? "Timed out"
                  : s.status === "failed"
                    ? "Failed"
                    : "Waiting",
            state: s.status === "done" ? "ok" : "wait",
          }))}
        />
        {startup.find((s) => s.failed) && (
          <div style={{ color: "var(--bad)", fontSize: 13.5, marginTop: 12 }}>
            {startup.find((s) => s.failed)?.failed}
          </div>
        )}
      </section>

      <section className="rise">
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          SDKs
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          {seenSdks.map((c) => (
            <SdkCard key={c.key} card={c} />
          ))}
        </div>
      </section>

      <Panel
        title="Ads this session"
        actions={
          <span className="mono pl-page-note">
            ${h.revenue.total.toFixed(4)} reported revenue
          </span>
        }
      >
        <div className="t-wrap">
          <DataTable
            data={h.funnels}
            className="t pl-ads-table"
            rowKey={(f) => String(f.key)}
            sortKey="pagesHealthtsx-sort"
            columns={[
              {
                id: "col0",
                header: <>Format</>,
                cell: (f) => {
                  return <>{f.name}</>;
                },
              },
              {
                id: "col1",
                header: <>Load sent</>,
                className: "num mono",
                cell: (f) => {
                  return <>{f.loadSent}</>;
                },
              },
              {
                id: "col2",
                header: <>Loaded</>,
                className: "num mono",
                cell: (f) => {
                  return <>{f.loaded}</>;
                },
              },
              {
                id: "load-failed",
                header: <>Load failed</>,
                className: "num mono",
                cell: (f) => (
                  <span className={f.loadFailed ? "badc" : "dim"}>
                    {f.loadFailed}
                  </span>
                ),
              },
              {
                id: "col3",
                header: <>Show sent</>,
                className: "num mono",
                cell: (f) => {
                  return <>{f.showSent}</>;
                },
              },
              {
                id: "col4",
                header: <>Shown</>,
                className: "num mono",
                cell: (f) => {
                  return (
                    <>
                      {["banner", "mrec", "app-open"].includes(f.format)
                        ? f.displayed
                        : f.shown}
                    </>
                  );
                },
              },
              {
                id: "col5",
                header: <>Closed</>,
                className: "num mono",
                cell: (f) => {
                  return (
                    <>
                      {["banner", "mrec"].includes(f.format) ? "—" : f.closed}
                    </>
                  );
                },
              },
              {
                id: "col6",
                header: <>Paid</>,
                className: "num mono",
                cell: (f) => {
                  return <>{f.paid}</>;
                },
              },
              {
                id: "col7",
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
        </div>
        {!h.funnels.length && (
          <div className="empty">No ad activity observed yet.</div>
        )}
        <div className="pb pl-page-note">
          Paid callbacks provide evidence that an ad was seen.
        </div>
      </Panel>

      <div className="rise pl-health-checks">
        <CheckCard
          title="Ad rules"
          sub={`Checked against this game's AdConfig.${monitor.adRules?.levelSource ? ` Level from ${monitor.adRules.levelSource}.` : ""}`}
          checks={monitor.adRules?.checks}
          empty="AdConfig hasn't been applied yet."
        />
        <CheckCard
          title="Consent & privacy"
          checks={monitor.privacy}
          empty="Waiting for consent lines."
        />
      </div>

      <Disclosure
        id="health.advanced"
        title="Advanced"
        hint={`Launch timing · other SDKs${extra?.extra?.length ? ` (${extra.extra.length})` : ""} · MAX adapters${h.adapters.length ? ` (${okAdapters}/${h.adapters.length})` : ""}`}
      >
        <section className="panel" style={{ padding: "18px 22px" }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Launch timing
          </div>
          <LaunchTimeline launch={h.launch} />
          <div className="dim" style={{ fontSize: 13 }}>
            Firebase and MAX each get 20 s in the startup sequence. If one runs
            out, the launch continues and it shows as timed out.
          </div>
        </section>

        {extra && (
          <section className="panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "18px 22px 6px",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span className="eyebrow">
                Other SDKs in the app · not verified by the plugin
              </span>
              <span className="dim" style={{ fontSize: 13 }}>
                {extra.apkRead
                  ? "Found inside the APK and in the logs"
                  : "Found in the logs (the APK could not be read)"}
              </span>
            </div>
            {extra.extra.length === 0 ? (
              <div
                className="dim"
                style={{ padding: "10px 22px 18px", fontSize: 14 }}
              >
                Nothing else found yet.
              </div>
            ) : (
              <>
                <div className="xsdk eyebrow" style={{ borderTop: 0 }}>
                  <span>SDK</span>
                  <span>Version</span>
                  <span>Seen</span>
                  <span className="num">Lines</span>
                  <span className="num">Warn / err</span>
                </div>
                {extra.extra.map((x) => (
                  <div key={x.name} className="xsdk">
                    <span style={{ fontWeight: 700 }}>{x.name}</span>
                    <span className="mono mute">{x.version ?? "—"}</span>
                    <span className="mute" style={{ fontSize: 13.5 }}>
                      {[
                        x.inApp && "in the APK",
                        x.lines && "logging",
                        x.adapter &&
                          `MAX adapter ${x.adapter === "InitializedSuccess" ? "started" : x.adapter}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                    <span className="num mute">{x.lines || "—"}</span>
                    <span className="num">
                      {x.warnings || x.errors ? (
                        <>
                          <span className="warnc">{x.warnings}</span> /{" "}
                          <span className="badc">{x.errors}</span>
                        </>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div
              className="dim"
              style={{
                fontSize: 13,
                padding: "12px 22px 16px",
                borderTop: "1px solid var(--line-soft)",
              }}
            >
              AppsFlyer's start isn't logged by the plugin; turn on its isDebug
              to see its own lines.
              {sdk["SDK.ByteBrew"]?.notUsed &&
                " ByteBrew is off for this game (set byteBrew: true in its rules file if it's on)."}{" "}
              Warnings and errors from these SDKs are in Logs → Grouped.
            </div>
          </section>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          <section
            className="panel"
            style={{
              flex: "1 1 340px",
              minWidth: 0,
              padding: "18px 22px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
                gap: 10,
              }}
            >
              <span className="eyebrow">
                MAX adapters
                {h.adapters.length
                  ? ` · ${okAdapters} of ${h.adapters.length}`
                  : ""}
              </span>
              <button
                className="btn btn-sm"
                aria-pressed={onlyProblems}
                onClick={() => setOnlyProblems(!onlyProblems)}
              >
                Only problems
              </button>
            </div>
            {adapters.length === 0 && (
              <div className="dim" style={{ padding: "10px 0", fontSize: 14 }}>
                {h.adapters.length
                  ? "All adapters started."
                  : "No adapter lines yet."}
              </div>
            )}
            {adapters.map((a) => (
              <div key={a.name} className="arow">
                <span
                  className={`sq ${a.status === "InitializedSuccess" ? "ok" : a.status === "InitializedFailure" ? "bad" : ""}`}
                />
                <span style={{ flex: "1 1 auto" }}>{a.name}</span>
                <StateBadge
                  state={a.status}
                  label={
                    {
                      InitializedSuccess: "started",
                      InitializedFailure: "failed",
                      NotInitialized: "not started",
                      NotReported: "not reported",
                      InitializedUnknown: "unknown",
                      DoesNotApply: "not applicable",
                    }[a.status] ?? a.status
                  }
                />
              </div>
            ))}
            <div
              className="dim"
              style={{
                fontSize: 12.5,
                padding: "10px 0 8px",
                borderTop: "1px solid var(--line-soft)",
              }}
            >
              Not started is fine if that network isn't on any of your ad units.
            </div>
          </section>
        </div>
      </Disclosure>
    </main>
  );
}
