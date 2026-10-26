import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { PageHead } from "../components/bits";
import { refreshResource, resourceKey, useResource } from "../query";
import { deviceName, useApp } from "../state";

type Tone = [string, string];

const TAG: Record<string, Tone> = {
  passed: ["Passed", "tag-ok"],
  failed: ["Failed", "tag-bad"],
  "not-verified": ["Not verified", "tag-warn"],
  "not-supported": ["Not supported", "tag-plain"],
  skipped: ["Skipped", "tag-plain"],
  cancelled: ["Cancelled", "tag-plain"],
  pending: ["Pending", "tag-plain"],
  running: ["Running", "tag-warm"],
};
const RUN_TAG: Record<string, Tone> = {
  queued: ["Queued", "tag-plain"],
  preparing: ["Preparing", "tag-warm"],
  running: ["Running", "tag-warm"],
  stopping: ["Stopping", "tag-warm"],
  completed: ["Completed", "tag-ok"],
  cancelled: ["Cancelled", "tag-plain"],
  "infrastructure-error": ["Could not run", "tag-bad"],
  interrupted: ["Interrupted", "tag-bad"],
};
const OUTCOME: Record<string, Tone> = {
  passed: ["No problems seen", "tag-ok"],
  failed: ["Problems found", "tag-bad"],
  incomplete: ["Incomplete", "tag-warn"],
};
const ACTIVE = new Set(["queued", "preparing", "running", "stopping"]);

interface QaEvidence {
  file: string;
  label: string;
}
interface QaCheck {
  status: string;
  label: string;
  note?: string;
  entryId?: number;
}
interface QaStep {
  id: string;
  label: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
  checks?: QaCheck[];
  evidence?: QaEvidence[];
}
interface QaFinding {
  severity: string;
  title: string;
  message: string;
  stepId?: string;
}
interface QaSummary {
  outcome?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  findings?: number;
  lines?: number;
  "not-verified"?: number;
  "not-supported"?: number;
}
interface QaRun {
  id: string;
  status: string;
  serial: string;
  device: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  plan?: { name: string };
  build?: { versionCode?: number | string; debuggable?: boolean };
  error?: string;
  cancelReason?: string;
  manual?: { text: string };
  summary?: QaSummary;
  steps?: QaStep[];
  current?: string;
  evidence?: QaEvidence[];
  findings?: QaFinding[];
  perf?: {
    fps?: { avg?: number; min?: number };
    lowFps?: number;
    mem?: { max?: number };
    temp?: { max?: number };
  };
  bridge?: {
    connected?: boolean;
    error?: string;
    sdk?: boolean;
    actions?: unknown[];
  };
}
interface QaPlan {
  id: string;
  name: string;
  source?: string;
  stepCount: number;
  description: string;
  needsBridge?: boolean;
  options?: string[];
}
interface QaPlans {
  plans: QaPlan[];
  errors: string[];
}

const when = (t?: number) => (t ? new Date(t).toLocaleString() : "—");
const secs = (a?: number, b?: number) =>
  a ? `${Math.round(((b ?? Date.now()) - a) / 1000)} s` : "—";
const filesPath = (runPath: string, name: string) =>
  `/api/${runPath}/files/${encodeURIComponent(name)}`;

function Tag({
  map,
  value,
}: {
  map: Record<string, Tone>;
  value?: string;
}) {
  const [text, cls] = (value && map[value]) || [value ?? "—", "tag-plain"];
  return <span className={`tag ${cls}`}>{text}</span>;
}

function RunDetail({
  id,
  onChanged,
  showInLogs,
}: {
  id: string;
  onChanged: (removed?: boolean) => void;
  showInLogs: (entryId: number) => void;
}) {
  const { qaVersion } = useApp();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const path = `qa/runs/${encodeURIComponent(id)}`;
  const query = useQuery({
    queryKey: resourceKey(path),
    queryFn: ({ signal }) => api<{ run: QaRun }>(path, { signal }),
    refetchInterval: (q) =>
      ACTIVE.has(q.state.data?.run.status ?? "") ? 1500 : false,
  });

  useEffect(() => {
    if (qaVersion) void refreshResource(path);
  }, [qaVersion, path]);

  const run = query.data?.run;
  const error =
    actionError || (query.error ? errorMessage(query.error) : "");
  if (error)
    return (
      <div className="card" style={{ padding: 20 }} role="alert">
        {error}
      </div>
    );
  if (!run) return <div className="card empty">Loading run…</div>;

  const active = ACTIVE.has(run.status);
  const cancel = async () => {
    setBusy(true);
    try {
      await api(`${path}/cancel`, {
        method: "POST",
        body: { reason: "Cancelled from the QA page" },
      });
      await refreshResource(path);
      onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(path, { method: "DELETE" });
      onChanged(true);
    } catch (e) {
      setActionError(errorMessage(e));
      setBusy(false);
    }
  };
  const s: QaSummary = run.summary ?? {};
  const lastShot = run.evidence?.at(-1);
  const files = (name: string) => filesPath(path, name);
  return (
    <section className="card qa-detail">
      <div className="library-heading">
        <div>
          <span className="eyebrow">
            {run.plan?.name} · {run.device} · build{" "}
            {run.build?.versionCode ?? "?"}
            {run.build?.debuggable === false ? " (release)" : ""}
          </span>
          <div className="history-actions" style={{ marginTop: 8 }}>
            <Tag map={RUN_TAG} value={run.status} />
            {!active && <Tag map={OUTCOME} value={s.outcome} />}
            <span className="dim">
              {when(run.startedAt)} · {secs(run.startedAt, run.endedAt)}
            </span>
          </div>
          {run.error && (
            <p className="dim" role="alert" style={{ margin: "8px 0 0" }}>
              {run.error}
            </p>
          )}
          {run.cancelReason && (
            <p className="dim" style={{ margin: "8px 0 0" }}>
              {run.cancelReason}
            </p>
          )}
        </div>
        <div className="history-actions">
          {active ? (
            <button className="btn" disabled={busy} onClick={cancel}>
              Cancel run
            </button>
          ) : (
            <>
              <a
                className="btn btn-sm"
                href={`/api/${path}/report.md`}
              >
                Report (Markdown)
              </a>
              <a className="btn btn-sm" href={files("logcat.jsonl")}>
                Log
              </a>
              <button className="btn btn-sm" disabled={busy} onClick={remove}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {run.manual && (
        <div className="qa-manual" role="status">
          <span className="eyebrow">Your turn on the phone</span>
          <strong>{run.manual.text}</strong>
          <span className="dim">
            The run is waiting for the matching log line; cancel if it never
            comes.
          </span>
        </div>
      )}
      <div className="qa-summary mono">
        <span>{s.passed ?? 0} passed</span>
        <span className={s.failed ? "bad" : ""}>{s.failed ?? 0} failed</span>
        <span>{s["not-verified"] ?? 0} not verified</span>
        <span>{s["not-supported"] ?? 0} not supported</span>
        <span>{s.skipped ?? 0} skipped</span>
        <span>{s.findings ?? 0} findings</span>
        <span>{s.lines ?? 0} log lines</span>
        <span>
          bridge:{" "}
          {run.bridge?.connected
            ? `connected (${run.bridge.actions?.length ?? 0} actions)`
            : run.bridge?.error
              ? "unavailable"
              : run.bridge?.sdk
                ? "was connected"
                : "not used"}
        </span>
      </div>
      <div className="qa-body">
        <ol className="qa-steps">
          {run.steps?.map((st) => (
            <li
              key={st.id}
              className={`qa-step${run.current === st.id ? " act" : ""}`}
            >
              <div className="qa-step-head">
                <span className="mono dim">{st.id}</span>
                <strong>{st.label}</strong>
                <Tag map={TAG} value={st.status} />
                <span className="dim mono">
                  {st.startedAt ? secs(st.startedAt, st.endedAt) : ""}
                </span>
              </div>
              {st.checks && st.checks.length > 0 && (
                <ul className="qa-checks">
                  {st.checks.map((c, i) => (
                    <li key={i}>
                      <Tag map={TAG} value={c.status} />
                      <span>{c.label}</span>
                      {c.note && <span className="dim"> — {c.note}</span>}
                      {c.entryId !== undefined && showInLogs && (
                        <button
                          className="linkish"
                          onClick={() => showInLogs(c.entryId!)}
                        >
                          log line
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {st.evidence?.map((e) => (
                <a
                  key={e.file}
                  className="qa-shot-link"
                  href={files(e.file)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={files(e.file)} alt={e.label} loading="lazy" />
                </a>
              ))}
            </li>
          ))}
        </ol>
        <aside className="qa-side">
          {lastShot && (
            <div>
              <span className="eyebrow">Latest screenshot</span>
              <a
                href={files(lastShot.file)}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className="qa-shot"
                  src={files(lastShot.file)}
                  alt={lastShot.label}
                />
              </a>
              <div className="dim">{lastShot.label}</div>
            </div>
          )}
          {run.findings && run.findings.length > 0 && (
            <div>
              <span className="eyebrow">Findings</span>
              <ul className="qa-findings">
                {run.findings.map((f, i) => (
                  <li key={i}>
                    <span
                      className={`tag ${f.severity === "critical" ? "tag-bad" : "tag-warn"}`}
                    >
                      {f.severity}
                    </span>{" "}
                    <strong>{f.title}</strong>
                    {f.stepId ? (
                      <span className="dim"> (step {f.stepId})</span>
                    ) : null}
                    <div className="dim mono" style={{ fontSize: 12 }}>
                      {f.message}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {run.perf?.fps && (
            <div>
              <span className="eyebrow">Performance</span>
              <div className="mono dim">
                FPS avg {run.perf.fps.avg ?? "—"}, min{" "}
                {run.perf.fps.min ?? "—"} · low-FPS {run.perf.lowFps ?? 0} s ·
                mem peak {run.perf.mem?.max ?? "—"} MB · temp max{" "}
                {run.perf.temp?.max ?? "—"} °C
              </div>
            </div>
          )}
          {run.bridge?.error && (
            <div>
              <span className="eyebrow">QA bridge</span>
              <div className="dim">{run.bridge.error}</div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export function QARuns() {
  const {
    pkg,
    game,
    serial,
    device,
    online,
    gameInventory,
    qaVersion,
    showInLogs,
    showToast,
  } = useApp();
  const [planId, setPlanId] = useState("plugin-smoke");
  const [options, setOptions] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [starting, setStarting] = useState(false);

  const plansPath = `qa/plans?pkg=${encodeURIComponent(pkg ?? "")}`;
  const runsPath = `qa/runs?pkg=${encodeURIComponent(pkg ?? "")}`;
  const plansQuery = useResource<QaPlans>(plansPath);
  const runsQuery = useResource<{ runs: QaRun[] }>(runsPath, { interval: 4000 });
  const plans: QaPlans = plansQuery.data ?? { plans: [], errors: [] };
  const runs = runsQuery.data?.runs ?? [];
  const error =
    actionError ||
    (plansQuery.error ? errorMessage(plansQuery.error) : "") ||
    (runsQuery.error ? errorMessage(runsQuery.error) : "");

  useEffect(() => {
    if (!qaVersion) return;
    void refreshResource(plansPath);
    void refreshResource(runsPath);
  }, [qaVersion, plansPath, runsPath]);
  useEffect(() => {
    if (!selected && runs[0]) setSelected(runs[0].id);
  }, [runs, selected]);

  const plan = plans.plans.find((p) => p.id === planId) ?? plans.plans[0];
  const installed =
    gameInventory.serial === serial &&
    gameInventory.games.some((g) => g.packageId === pkg && g.installed);
  const activeHere = runs.find(
    (r) => ACTIVE.has(r.status) && r.serial === serial,
  );
  const canStart =
    online &&
    device?.state === "device" &&
    !device.replay &&
    installed &&
    !!plan &&
    !activeHere &&
    !starting;
  const needed = (plan?.options ?? []).filter(
    (k) => !String(options[k] ?? "").trim(),
  );
  const start = async () => {
    if (!plan) return;
    setStarting(true);
    setActionError("");
    try {
      const { run } = await api<{ run: QaRun }>("qa/runs", {
        method: "POST",
        body: { pkg, serial, plan: plan.id, options },
      });
      setSelected(run.id);
      await refreshResource(runsPath);
    } catch (e) {
      const msg = errorMessage(e);
      setActionError(msg);
      showToast({ title: "Could not start the run", msg, severity: "critical" });
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="main">
      <PageHead
        title="QA runs"
        sub={`Automated checks for ${game?.name ?? pkg} on ${device ? deviceName(device) : "no device"}. The run owns the phone until it ends; this tab can be closed.`}
      />
      <section className="card qa-start">
        <div className="library-heading">
          <div>
            <span className="eyebrow">START A RUN</span>
          </div>
        </div>
        <div className="qa-start-row">
          <label className="qa-field">
            <span className="dim">Plan</span>
            <select
              className="select"
              value={plan?.id ?? ""}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {plans.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.source === "game" ? " (this game)" : ""} · {p.stepCount}{" "}
                  steps
                </option>
              ))}
            </select>
          </label>
          {plan?.options?.map((k) => (
            <label key={k} className="qa-field">
              <span className="dim">{k}</span>
              <input
                className="input"
                value={options[k] ?? ""}
                onChange={(e) =>
                  setOptions({ ...options, [k]: e.target.value })
                }
                placeholder={k === "productId" ? "e.g. remove_ads" : k}
              />
            </label>
          ))}
          <button
            className="btn btn-warm"
            disabled={!canStart || needed.length > 0}
            onClick={start}
          >
            {starting ? "Starting…" : "Run on this phone"}
          </button>
        </div>
        {plan && (
          <p className="dim" style={{ margin: "10px 0 0" }}>
            {plan.description}
            {plan.needsBridge
              ? " Needs a QA build (AVN_QA) with the game adapter wired."
              : ""}
          </p>
        )}
        {activeHere && (
          <p className="dim" style={{ margin: "8px 0 0" }}>
            A run is already using this phone.
          </p>
        )}
        {!device && (
          <p className="dim" style={{ margin: "8px 0 0" }}>
            Connect a phone from Devices first.
          </p>
        )}
        {device && !installed && (
          <p className="dim" style={{ margin: "8px 0 0" }}>
            This game is not installed on {deviceName(device)}.
          </p>
        )}
        {plans.errors.length > 0 && (
          <p className="dim" role="alert" style={{ margin: "8px 0 0" }}>
            Rules file plan errors: {plans.errors.join("; ")}
          </p>
        )}
        {error && (
          <p role="alert" style={{ margin: "8px 0 0" }}>
            {error}
          </p>
        )}
      </section>
      {selected && (
        <RunDetail
          id={selected}
          showInLogs={showInLogs}
          onChanged={(removed) => {
            if (removed) setSelected(null);
            void refreshResource(runsPath);
          }}
        />
      )}
      <section>
        <div className="library-heading">
          <h2 className="px" style={{ margin: 0, fontSize: 22 }}>
            Past runs
          </h2>
          <span className="dim" style={{ fontSize: 13 }}>
            Kept under ~/.avn-playlens/qa-runs
          </span>
        </div>
        {runs.length === 0 ? (
          <div className="card empty">No runs yet for this game.</div>
        ) : (
          <div className="table-scroll">
            <table className="verification-table qa-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Plan</th>
                  <th>Phone · build</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th>Checks</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === selected ? "act" : ""}
                    onClick={() => setSelected(r.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono">
                      {when(r.startedAt ?? r.createdAt)}
                    </td>
                    <td>{r.plan?.name}</td>
                    <td className="dim">
                      {r.device} · {r.build?.versionCode ?? "?"}
                    </td>
                    <td>
                      <Tag map={RUN_TAG} value={r.status} />
                    </td>
                    <td>
                      {ACTIVE.has(r.status) ? (
                        <span className="dim">
                          {r.current ? `step ${r.current}` : "…"}
                        </span>
                      ) : (
                        <Tag map={OUTCOME} value={r.summary?.outcome} />
                      )}
                    </td>
                    <td className="mono dim">
                      {r.summary?.passed ?? 0}✓ {r.summary?.failed ?? 0}✗{" "}
                      {r.summary?.["not-verified"] ?? 0}?{" "}
                      {r.summary?.["not-supported"] ?? 0}–
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
