import { Button, Kpi, Kpis, Panel, Tag } from "@avn/ui";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { PageHead } from "../components/bits";
import {
  BuildReportUpload,
  BuildVerificationTable,
  useBuildReport,
} from "../components/BuildReport";
import { DataTable } from "../components/DataTable";
import { RemoteConfigTable } from "../components/RemoteConfigTable";
import { Disclosure, LiveBars, Menu, SkeletonRows } from "../components/ui";
import { useResource } from "../query";
import { clock, deviceName, useApp } from "../state";
import type { Rules } from "../types";
import { Stepper } from "./Firebase";
import { useTrackingGate } from "../components/TrackingGate";

const SEVERITY_TAG: Record<string, string> = {
  critical: "tag-bad",
  warning: "tag-warn",
  info: "tag-plain",
};

function useClock(startedAt: number | undefined, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!startedAt) return "00:00";
  const s = Math.max(
    0,
    Math.floor(((active ? now : startedAt) - startedAt) / 1000),
  );
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useRules() {
  const result = useResource<Rules>("rules");
  return [result.data, () => result.refetch()] as const;
}

export function ChecklistSetup() {
  const { pkg, monitor, send, setView, showToast } = useApp();
  const [rules, reload] = useRules();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<string | null>(null);
  const run = monitor?.run;
  const build = useBuildReport(pkg, monitor);
  const [starting, setStarting] = useState<number | null>(null);
  useEffect(() => {
    if (starting != null && run?.active && run.startedAt > starting) {
      setStep(3);
      setStarting(null);
    }
  }, [run?.startedAt, run?.active, starting]);
  const elapsed = useClock(run?.startedAt, !!run?.active);

  useEffect(() => {
    if (!rules || file) return;
    const mine = rules.files.find((f) => f.game === pkg) ?? null;
    setFile(mine?.file ?? rules.files[0]?.file ?? null);
  }, [rules, pkg, file]);

  const create = async () => {
    try {
      const r = await api<{ file: string }>("rules/new", {
        method: "POST",
        body: { pkg },
      });
      await reload();
      setFile(r.file);
      send({ type: "rules.reload" });
    } catch (e) {
      showToast({
        title: "Could not create the rules file",
        msg: errorMessage(e),
      });
    }
  };
  const chosen = rules?.files.find((f) => f.file === file);
  const hasOwn = rules?.files.some((f) => f.game === pkg);
  const start = () => {
    setStarting(run?.startedAt || 0);
    send({ type: "run.start", file });
  };
  const items = run?.items ?? [];
  const ok = items.filter((i) => i.status === "ok").length;

  return (
    <main className="content">
      <PageHead
        title="Set up a test run"
        sub={`Attach the publishing report and choose rules for ${pkg}.`}
      >
        <Button onClick={() => setView("checklist")}>Back to checklist</Button>
      </PageHead>
      <Stepper step={step} labels={["Report & rules", "Start run", "Play"]} />
      {step === 1 && (
        <div className="pl-setup-layout">
          <Panel title="Publishing report">
            <div className="pb">
              <BuildReportUpload
                pkg={pkg}
                report={build.report}
                matches={build.matches}
                reason={build.reason}
                onSaved={build.setReport}
              />
            </div>
          </Panel>
          <Panel title="Game rules">
            <div className="pb pl-setup-panel">
              <p className="muted">
                Choose the events and checks to verify while playing.
              </p>
              {!rules ? (
                <SkeletonRows rows={3} />
              ) : (
                <label className="fld">
                  Rules file
                  <select
                    value={file || ""}
                    onChange={(e) => setFile(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose a rules file
                    </option>
                    {rules.files.map((f) => (
                      <option key={f.file} value={f.file}>
                        {f.file}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {chosen && (
                <>
                  <span className="tag plain">
                    {chosen.expect} expected events · {chosen.watch} flag rules
                  </span>
                  {chosen.error && <p className="badc">{chosen.error}</p>}
                </>
              )}
              {rules && !hasOwn && (
                <Button onClick={create}>Create this game’s rules file</Button>
              )}
              {rules?.dir && (
                <Button
                  variant="ghost"
                  onClick={() => api("rules/reveal", { method: "POST" })}
                >
                  Open rules folder
                </Button>
              )}
            </div>
          </Panel>
        </div>
      )}
      {step === 2 && (
        <Panel title="Ready to start">
          <div className="pb pl-setup-panel">
            <p className="muted">
              The checklist starts fresh and checks evidence from this moment
              until you finish. The game keeps running.
            </p>
            <div className="row-wrap">
              <span className="mono">{chosen?.file}</span>
              <Tag kind={build.matches ? "ok" : "warn"}>
                {build.matches ? "Build matches" : "Check installed build"}
              </Tag>
            </div>
            <p className="muted">{build.reason}</p>
            {!monitor?.firebase?.debug?.on && (
              <div className="banner">
                Firebase debug mode is off.{" "}
                <button
                  className="linkish"
                  onClick={() => setView("firebase-setup")}
                >
                  Set up Firebase
                </button>
              </div>
            )}
            <Button
              variant="primary"
              disabled={!file || !build.matches || starting != null}
              loading={starting != null}
              loadingLabel="Starting run…"
              onClick={start}
            >
              Start run
            </Button>
          </div>
        </Panel>
      )}
      {step === 3 && (
        <Panel title="Run in progress" actions={<Tag kind="info">Live</Tag>}>
          <div className="pb pl-setup-panel">
            <p className="muted">
              Play the game. Checks verify as supporting evidence arrives.
            </p>
            <Kpis>
              <Kpi label="Elapsed" value={elapsed} />
              <Kpi label="Verified" value={`${ok} / ${items.length}`} />
            </Kpis>
            <Button variant="primary" onClick={() => setView("checklist")}>
              Open checklist
            </Button>
          </div>
        </Panel>
      )}
      <div className="row-wrap">
        {step > 1 && step < 3 && (
          <Button onClick={() => setStep(step - 1)}>Back</Button>
        )}
        {step === 1 && (
          <Button
            variant="primary"
            disabled={!file || !!chosen?.error || !build.matches}
            onClick={() => setStep(2)}
          >
            Continue
          </Button>
        )}
      </div>
    </main>
  );
}

export function Checklist() {
  const { monitor, device, pkg, send, setView, lastReport, showInLogs } =
    useApp();
  const run = monitor?.run;
  const elapsed = useClock(run?.startedAt, !!run?.active);
  const report = monitor?.report ?? lastReport;
  const gate = useTrackingGate("Checklist", !!run);
  if (gate) return gate;
  if (!run) {
    return (
      <main className="content">
        <PageHead title="Checklist" />
        <Panel>
          <div className="pl-empty">
            <h2>No test run yet.</h2>
            <p className="muted">
              Attach this build’s report and rules to start verifying it.
            </p>
            <Button
              variant="primary"
              onClick={() => setView("checklist-setup")}
            >
              Set up a test run
            </Button>
          </div>
        </Panel>
      </main>
    );
  }
  const items = run.items;
  const counts = { ok: 0, problem: 0, pending: 0 };
  for (const i of items) counts[i.status as keyof typeof counts]++;
  const groups = [...new Set(items.map((i) => i.group))];
  const flags = (monitor.flags ?? []).filter((f) => f.severity !== "info");

  return (
    <main className="content">
      <PageHead
        title="Checklist"
        sub={`${run.file} · ${pkg} on ${deviceName(device)}`}
      >
        {run.active ? (
          <>
            <LiveBars label={`Run live · ${elapsed}`} />
            <button
              className="btn btn-warm"
              onClick={() => send({ type: "run.finish" })}
            >
              Finish and export report
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setView("checklist-setup")}>
            Start a new run
          </button>
        )}
        <Menu
          items={[
            {
              label: "Open the rules folder",
              onClick: () => api("rules/reveal", { method: "POST" }),
            },
            {
              label: "Start a new run",
              onClick: () => setView("checklist-setup"),
              hidden: !run.active,
            },
          ]}
        />
      </PageHead>

      {report && !run.active && (
        <div
          className="panel rise"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderColor: "var(--ok)",
            background: "var(--ok-soft)",
          }}
        >
          <span className="px" style={{ fontSize: 18 }}>
            Report ready: {report.passed} of {report.total} passed
          </span>
          <span className="mute">
            {report.buildVerified ?? 0} of {report.buildTotal ?? 0} For Dev
            items verified
          </span>
          <span style={{ flex: "1 1 0" }} />
          <a
            className="btn btn-sm"
            href={`/api/reports/${report.id}.html?view=1`}
            target="_blank"
            rel="noreferrer"
          >
            Open report
          </a>
          <Menu
            label="Save report"
            items={[
              {
                label: "Save as HTML",
                href: `/api/reports/${report.id}.html`,
                download: true,
              },
              {
                label: "Save as Markdown",
                href: `/api/reports/${report.id}.md`,
                download: true,
              },
            ]}
          />
        </div>
      )}

      <Kpis>
        <Kpi
          label="Verified"
          value={counts.ok}
          context={`Of ${items.length} checks`}
        />
        <Kpi
          label="Needs a look"
          value={counts.problem}
          context="Issues observed in this run"
        />
        <Kpi
          label="Waiting"
          value={counts.pending}
          context="No supporting evidence yet"
        />
      </Kpis>
      <Panel
        title="Runtime checklist"
        actions={
          <Tag kind={run.active ? "info" : "plain"}>
            {run.active ? "Run in progress" : "Run finished"}
          </Tag>
        }
      >
        <div className="t-wrap">
          <DataTable
            data={items}
            rowKey={(i) => i.id}
            groupBy={(i) => i.group ?? "Other checks"}
            columns={[
              {
                id: "check",
                header: "Check",
                cell: (i) => (
                  <>
                    <strong className={i.event ? "mono" : undefined}>
                      {i.event ?? i.name}
                    </strong>
                    {i.sdk && <div className="pl-page-note">{i.sdk}</div>}
                  </>
                ),
              },
              {
                id: "result",
                header: "Result / evidence",
                cell: (i) => (
                  <div className="row-wrap">
                    <Tag
                      kind={
                        i.status === "ok"
                          ? "ok"
                          : i.status === "problem"
                            ? "bad"
                            : "plain"
                      }
                    >
                      {i.status === "ok"
                        ? "Verified"
                        : i.status === "problem"
                          ? "Problem"
                          : "Waiting"}
                    </Tag>
                    <span>
                      {i.note ||
                        (i.status === "pending"
                          ? "Not seen in this run."
                          : i.event
                            ? i.name
                            : "")}
                    </span>
                  </div>
                ),
              },
              {
                id: "observed",
                header: "First observed",
                className: "mono pl-nowrap",
                cell: (i) => (i.firstTs ? clock(i.firstTs, false) : "—"),
              },
            ]}
          />
        </div>
      </Panel>
      <BuildVerificationTable build={run.build} showInLogs={showInLogs} />
      <Disclosure
        id="checklist.config"
        title="Captured Remote Config"
        hint="Values recorded for this test run."
      >
        <RemoteConfigTable rc={run.rc} showInLogs={showInLogs} />
      </Disclosure>

      <Disclosure
        id="checklist.more"
        title="Rule hits and rules file"
        hint={`${flags.length ? `${flags.length} rule hit${flags.length === 1 ? "" : "s"}` : "No rule hits"} · ${run.file}`}
      >
        <div className="panel" style={{ padding: "16px 22px 10px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span className="eyebrow">Rule hits</span>
            <button className="linkish" onClick={() => setView("logs")}>
              Open logs
            </button>
          </div>
          {flags.length === 0 && (
            <div className="dim" style={{ padding: "12px 0", fontSize: 14 }}>
              None so far.
            </div>
          )}
          {flags.slice(0, 8).map((f) => (
            <div key={f.id} className="flagrow">
              <span className={`tag ${SEVERITY_TAG[f.severity]}`}>
                {f.severity === "critical" ? "Error" : "Warn"}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>{f.name}</span>
              <span className="mono dim" style={{ fontSize: 12.5 }}>
                x{f.count}
              </span>
              <button className="linkish" onClick={() => showInLogs(f.entryId)}>
                Line
              </button>
            </div>
          ))}
        </div>
        <div className="mute" style={{ fontSize: 14, lineHeight: 1.55 }}>
          Rules file{" "}
          <span className="mono" style={{ color: "var(--text)" }}>
            {run.file}
          </span>
          . Edit it in any editor; the checklist updates as soon as you save.{" "}
          <button
            className="linkish"
            onClick={() => api("rules/reveal", { method: "POST" })}
          >
            Open folder
          </button>
        </div>
      </Disclosure>
    </main>
  );
}
