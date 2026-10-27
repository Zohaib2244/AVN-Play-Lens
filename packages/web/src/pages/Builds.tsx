import {
  Button,
  DialogShell,
  Panel,
  Segmented,
  Tag,
  type StatusKind,
} from "@avn/ui";
import { useRef, useState } from "react";
import { api, ApiError, apiError, errorMessage } from "../api";
import { PageHead } from "../components/bits";
import { SkeletonRows, Spinner } from "../components/ui";
import { refreshResource } from "../query";
import { useBuildState } from "../use-build-state";
import { clock, deviceName, useApp } from "../state";
import type { BuildState, InstallJob, InstallStep } from "../types";

// A game's builds: where they come from (one APK/AAB, or a folder PlayLens watches) and
// installing them on the selected phone. Every failure says what happened and what to do.

const STATUS: Record<string, [StatusKind, string]> = {
  ready: ["ok", "Ready"],
  waiting: ["plain", "Waiting"],
  settling: ["info", "Build writing"],
  error: ["bad", "Problem"],
};
const JOB: Record<InstallJob["status"], [StatusKind, string]> = {
  queued: ["plain", "Queued"],
  running: ["info", "Installing"],
  done: ["ok", "Installed"],
  failed: ["bad", "Failed"],
  cancelled: ["plain", "Cancelled"],
};
const ACTIVE = new Set(["queued", "running"]);
// Server error codes that belong under a form field rather than above the form.
const PATH_CODES = new Set(["bad-path", "folder-missing", "not-folder", "no-access", "not-found", "is-folder"]);

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;
function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
const version = (v: { versionName: string | null; versionCode: number | null }) =>
  `v${v.versionName ?? "?"} (${v.versionCode ?? "?"})`;

type FieldError = { message: string; hint?: string; field?: "path" | "pattern" | "form" };
function fieldError(e: unknown, pathField: "path" = "path"): FieldError {
  if (e instanceof ApiError)
    return {
      message: e.message,
      hint: e.hint,
      field: e.code === "bad-pattern" ? "pattern" : e.code && PATH_CODES.has(e.code) ? pathField : "form",
    };
  return { message: errorMessage(e), field: "form" };
}

function ErrorText({ error }: { error: FieldError | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="builds-error">
      <span className="badc">{error.message}</span>
      {error.hint && <span className="dim">{error.hint}</span>}
    </div>
  );
}

// Uploads with progress (fetch cannot report upload progress).
function upload(path: string, file: File, onProgress: (p: number) => void) {
  return new Promise<BuildState>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/${path}/upload?name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as BuildState);
      else reject(apiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Is PlayLens still running?"));
    xhr.send(file);
  });
}

function SourceForm({ path, state, onDone, onCancel }: { path: string; state: BuildState; onDone: () => void; onCancel?: () => void }) {
  const current = state.source;
  const [kind, setKind] = useState<"file" | "folder">(current?.type ?? "folder");
  const [filePath, setFilePath] = useState(current?.type === "file" && !current.uploaded ? current.path : "");
  const [dir, setDir] = useState(current?.type === "folder" ? current.dir : "");
  const [pattern, setPattern] = useState(current?.type === "folder" ? current.pattern : "");
  const [auto, setAuto] = useState(current?.autoInstall ?? false);
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`${path}/source`, { method: "PUT", body });
      onDone();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(apk|aab)$/i.test(file.name)) {
      setError({ message: `${file.name} is not an .apk or .aab file`, field: "form" });
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      await upload(path, file, setProgress);
      if (auto !== (current?.autoInstall ?? false)) await api(`${path}/source`, { method: "PATCH", body: { autoInstall: auto } });
      onDone();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="builds-form">
      <Segmented
        label="Build source"
        value={kind}
        onChange={(v) => {
          setKind(v);
          setError(null);
        }}
        options={[
          { value: "folder", label: "Watch a folder" },
          { value: "file", label: "Single APK or AAB" },
        ]}
      />
      <p className="dim">
        {kind === "folder"
          ? "Watch a build folder for new APK or AAB files. PlayLens uses the newest matching build."
          : "Use one APK or AAB build. To pick up new builds from a folder, choose Watch a folder."}
      </p>
      {kind === "file" ? (
        <>
          <label
            className={`builds-drop${dragging ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void send(e.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".apk,.aab"
              disabled={busy}
              onChange={(e) => void send(e.target.files?.[0])}
            />
            <strong>{progress != null ? `Uploading… ${Math.round(progress * 100)}%` : "Drop an APK or AAB here, or click to choose"}</strong>
            <span className="dim">PlayLens keeps a copy, so the original can move or be deleted.</span>
            {progress != null && (
              <span className="builds-bar" aria-hidden>
                <span style={{ width: `${progress * 100}%` }} />
              </span>
            )}
          </label>
          <label className="qa-field">
            <span className="dim">Or use the file where it is (full path)</span>
            <span className="builds-row">
              <input
                className="input mono"
                value={filePath}
                placeholder="~/Builds/MyGame.apk"
                onChange={(e) => setFilePath(e.target.value)}
                aria-invalid={error?.field === "path"}
              />
              <Button disabled={busy || !filePath.trim()} loading={busy && progress == null} loadingLabel="Checking…" onClick={() => save({ type: "file", path: filePath, autoInstall: auto })}>
                Use this file
              </Button>
            </span>
          </label>
          {error?.field === "path" && <ErrorText error={error} />}
        </>
      ) : (
        <div className="pl-form-grid">
          <label>
            <span className="dim">Folder the build is written to</span>
            <input
              className="input mono"
              value={dir}
              placeholder="~/Projects/MyGame/Builds"
              onChange={(e) => setDir(e.target.value)}
              aria-invalid={error?.field === "path"}
            />
            {error?.field === "path" && <ErrorText error={error} />}
          </label>
          <label>
            <span className="dim">File name to look for</span>
            <input
              className="input mono"
              value={pattern}
              placeholder="MyGame.apk or MyGame-*.aab"
              onChange={(e) => setPattern(e.target.value)}
              aria-invalid={error?.field === "pattern"}
            />
            {error?.field === "pattern" ? (
              <ErrorText error={error} />
            ) : (
              <span className="pl-page-note">* matches any text. The newest match is used once the build finishes writing it.</span>
            )}
          </label>
        </div>
      )}
      <label className="pl-reconnect-toggle">
        <input type="checkbox" role="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>
          Install automatically <b>{auto ? "on" : "off"}</b>
          <span className="dim">
            {" "}
            · {kind === "folder" ? "when a new build appears, and when a phone connects without it" : "when a phone connects without this build"}
          </span>
        </span>
      </label>
      {error?.field === "form" && <ErrorText error={error} />}
      <div className="row-wrap">
        {kind === "folder" && (
          <Button variant="primary" disabled={busy || !dir.trim() || !pattern.trim()} loading={busy} loadingLabel="Checking…" onClick={() => save({ type: "folder", dir, pattern, autoInstall: auto })}>
            Watch this folder
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function StepMark({ status }: { status: InstallStep["status"] }) {
  if (status === "running")
    return (
      <span className="builds-mark" aria-label="In progress">
        <Spinner />
      </span>
    );
  return (
    <span className={`builds-mark ${status}`} aria-label={status === "done" ? "Done" : status === "failed" ? "Failed" : "Cancelled"}>
      {status === "done" ? "✓" : status === "failed" ? "✗" : "–"}
    </span>
  );
}

function JobCard({ job, latest, onRetry, onUninstallRetry, onCancel }: { job: InstallJob; latest: boolean; onRetry: () => void; onUninstallRetry: () => void; onCancel: () => void }) {
  // Retrying only makes sense from the newest install on that phone.
  const retry = latest && job.status === "failed" ? job.error?.retry : null;
  const [kind, word] = JOB[job.status];
  const took = job.endedAt && job.startedAt ? `${((job.endedAt - job.startedAt) / 1000).toFixed(1)} s` : null;
  return (
    <article className="builds-job" aria-label={`Install ${job.artifact?.name ?? job.gameName} on ${job.device}: ${word}`}>
      <header>
        <Tag kind={kind}>
          {word}
        </Tag>
        <strong>{job.artifact ? `${job.artifact.name} · ${version(job.artifact)}` : job.gameName}</strong>
        <span className="dim">→ {job.device}</span>
        {job.trigger === "auto" && <Tag kind="plain">Automatic</Tag>}
        {job.uninstallFirst && <Tag kind="warn">Clean install</Tag>}
        <span className="dim mono builds-when">
          {clock(job.createdAt, false)}
          {took ? ` · ${took}` : ""}
        </span>
      </header>
      {job.steps.length > 0 && (
        <ol className="builds-steps">
          {job.steps.map((s) => (
            <li key={s.id}>
              <StepMark status={s.status} />
              <span>{s.label}</span>
              {s.detail && <span className="dim">{s.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {job.error && (
        <div className="builds-failure" role="alert">
          <strong className="badc">{job.error.message}</strong>
          {job.error.hint && <span>{job.error.hint}</span>}
          {job.error.output && (
            <details>
              <summary className="dim">Output from the phone</summary>
              <pre className="mono">{job.error.output}</pre>
            </details>
          )}
        </div>
      )}
      {(ACTIVE.has(job.status) || retry) && (
        <div className="row-wrap">
          {ACTIVE.has(job.status) && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {retry === "uninstall" && (
            <Button size="sm" onClick={onUninstallRetry}>
              Uninstall and install…
            </Button>
          )}
          {retry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function Builds() {
  const { game, serial, device, online, gameInventory, showToast } = useApp();
  const path = `builds/${encodeURIComponent(game?.id ?? "")}`;
  const query = useBuildState(game?.id);
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const [actionError, setActionError] = useState<FieldError | null>(null);

  const state = query.data;
  const refresh = () => refreshResource(path);
  const phone = device && !device.replay && device.state === "device" ? device : null;
  const onPhone =
    gameInventory.serial === serial ? gameInventory.games.find((g) => g.id === game?.id) : undefined;
  const jobs = state?.jobs ?? [];
  const activeHere = jobs.find((j) => j.serial === serial && ACTIVE.has(j.status));

  const install = async (uninstallFirst = false) => {
    if (!game || !serial) return;
    setStarting(true);
    setActionError(null);
    try {
      await api("installs", { method: "POST", body: { gameId: game.id, serial, uninstallFirst } });
      setConfirmClean(false);
      await refresh();
    } catch (e) {
      setActionError(fieldError(e));
      showToast({ kind: "bad", title: "Could not start the install", msg: errorMessage(e) });
    } finally {
      setStarting(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await api(`installs/${id}/cancel`, { method: "POST" });
    } catch (e) {
      showToast({ kind: "bad", title: "Could not cancel", msg: errorMessage(e) });
    }
  };
  const setAuto = async (on: boolean) => {
    try {
      await api(`${path}/source`, { method: "PATCH", body: { autoInstall: on } });
      await refresh();
    } catch (e) {
      showToast({ kind: "bad", title: "Could not change automatic install", msg: errorMessage(e) });
    }
  };
  const removeSource = async () => {
    try {
      await api(`${path}/source`, { method: "DELETE" });
      setEditing(false);
      await refresh();
    } catch (e) {
      showToast({ kind: "bad", title: "Could not remove the source", msg: errorMessage(e) });
    }
  };
  const rescan = async () => {
    try {
      await api(`${path}/rescan`, { method: "POST" });
      await refresh();
    } catch (e) {
      showToast({ kind: "bad", title: "Could not check again", msg: errorMessage(e) });
    }
  };

  if (!game) return null;
  const head = (
    <PageHead
      title="Builds & install"
      sub={`Where ${game.name}'s APK or AAB comes from, and installing it on ${device ? deviceName(device) : "a phone"}.`}
    />
  );
  if (query.isPending)
    return (
      <main className="content">
        {head}
        <SkeletonRows rows={4} />
      </main>
    );
  if (query.error || !state)
    return (
      <main className="content">
        {head}
        <div className="card builds-pad" role="alert">
          <p className="badc">Could not load the build source: {errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()}>Try again</Button>
        </div>
      </main>
    );

  const { source, latest, status } = state;
  const [statusKind, statusWord] = STATUS[status?.state ?? "waiting"] ?? STATUS.waiting;
  const blocked = !online
    ? "PlayLens is reconnecting."
    : !device
      ? "Choose a phone in the top bar."
      : device.replay
        ? "The replay device is a recording; choose a real phone."
        : device.state !== "device"
          ? `${deviceName(device)} is ${device.state}. Reconnect it from Devices.`
          : !latest || status?.state === "error" || status?.state === "settling"
            ? null
            : null;
  const canInstall = !!phone && !!source && !!latest && !activeHere && !starting && online && status?.state !== "settling";
  const lastHere = latest && serial ? state.installs[serial] : undefined;
  const sameAsPhone =
    onPhone?.installed && latest?.versionCode != null && onPhone.versionCode === latest.versionCode;

  return (
    <main className="content">
      {head}

      <Panel
        title="Latest build"
        actions={
          source && (
            <span className="row-wrap">
              <Tag kind={statusKind}>
                {statusWord}
              </Tag>
              {source.type === "folder" && (
                <Button size="sm" variant="ghost" onClick={rescan}>
                  Check now
                </Button>
              )}
            </span>
          )
        }
      >
        <div className="builds-pad">
          {!source ? (
            <p className="dim">No build source yet. Choose a file or a folder below and the latest build shows here.</p>
          ) : (
            <>
              {status && status.state !== "ready" && (
                <div className={status.state === "error" ? "builds-failure" : "builds-note"} role={status.state === "error" ? "alert" : "status"}>
                  <strong className={status.state === "error" ? "badc" : undefined}>{status.message}</strong>
                  {status.hint && <span>{status.hint}</span>}
                </div>
              )}
              {latest && (
                <dl className="builds-facts">
                  <div>
                    <dt>File</dt>
                    <dd>{latest.name}</dd>
                  </div>
                  <div>
                    <dt>Kind</dt>
                    <dd>{latest.kind === "aab" ? "App bundle (AAB)" : "APK"}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd className="mono">{version(latest)}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd className="mono">{mb(latest.size)}</dd>
                  </div>
                  <div>
                    <dt>Built</dt>
                    <dd title={new Date(latest.modifiedAt).toLocaleString()}>{ago(latest.modifiedAt)}</dd>
                  </div>
                  <div>
                    <dt>On {device ? deviceName(device) : "the phone"}</dt>
                    <dd>
                      {!phone
                        ? "—"
                        : onPhone?.installed
                          ? `${version({ versionName: onPhone.versionName ?? null, versionCode: onPhone.versionCode ?? null })}${sameAsPhone ? " · same version code" : ""}`
                          : "Not installed"}
                    </dd>
                  </div>
                  <div className="wide">
                    <dt>Location</dt>
                    <dd className="mono">{latest.path}</dd>
                  </div>
                </dl>
              )}
              {latest?.kind === "aab" && state.tools && (!state.tools.bundletool || !state.tools.java) && (
                <div className="builds-failure" role="alert">
                  <strong className="badc">
                    App bundles need {[!state.tools.bundletool && "bundletool", !state.tools.java && "Java"].filter(Boolean).join(" and ")}, which this computer does not have
                  </strong>
                  <span>Install Unity's Android Build Support module (it includes both), set PLAYLENS_BUNDLETOOL / PLAYLENS_JAVA, or build an APK instead.</span>
                </div>
              )}
              {latest?.kind === "aab" && (
                <p className="pl-page-note">
                  App bundles are re-signed with this computer's debug key. If the phone has a copy signed with another key, the install asks to uninstall it first.
                </p>
              )}
              <div className="builds-actions">
                <Button
                  variant="primary"
                  disabled={!canInstall}
                  loading={starting || !!activeHere}
                  loadingLabel={activeHere?.status === "queued" ? "Queued…" : "Installing…"}
                  onClick={() => install(false)}
                >
                  {phone ? `Install on ${deviceName(phone)}` : "Install"}
                </Button>
                <label className="pl-reconnect-toggle builds-auto">
                  <input type="checkbox" role="switch" checked={source.autoInstall} onChange={(e) => setAuto(e.target.checked)} />
                  <span>
                    Install automatically <b>{source.autoInstall ? "on" : "off"}</b>
                  </span>
                </label>
              </div>
              {blocked && <p className="dim">{blocked}</p>}
              {lastHere && !lastHere.ok && lastHere.fingerprint === latest?.fingerprint && source.autoInstall && (
                <p className="dim">This build failed on this phone, so it will not be installed automatically again. Fix the problem below and install it by hand.</p>
              )}
              <ErrorText error={actionError} />
            </>
          )}
        </div>
      </Panel>

      <Panel
        title="Build source"
        actions={
          source &&
          !editing && (
            <span className="row-wrap">
              <Button size="sm" onClick={() => setEditing(true)}>
                Change source
              </Button>
              <Button size="sm" variant="ghost" onClick={removeSource}>
                {source.type === "file" && source.uploaded ? "Remove (deletes the uploaded copy)" : "Remove"}
              </Button>
            </span>
          )
        }
      >
        <div className="builds-pad">
          {source && !editing ? (
            <dl className="builds-facts">
              <div>
                <dt>Kind</dt>
                <dd>{source.type === "folder" ? "Folder PlayLens watches" : source.uploaded ? "Uploaded file" : "File on this computer"}</dd>
              </div>
              {source.type === "folder" ? (
                <>
                  <div>
                    <dt>Looks for</dt>
                    <dd className="mono">{source.pattern}</dd>
                  </div>
                  <div className="wide">
                    <dt>Folder</dt>
                    <dd className="mono">{source.dir}</dd>
                  </div>
                </>
              ) : (
                <div className="wide">
                  <dt>Path</dt>
                  <dd className="mono">{source.path}</dd>
                </div>
              )}
            </dl>
          ) : (
            <SourceForm
              key={editing ? "edit" : "new"}
              path={path}
              state={state}
              onDone={() => {
                setEditing(false);
                void refresh();
              }}
              onCancel={source ? () => setEditing(false) : undefined}
            />
          )}
        </div>
      </Panel>

      <Panel title="Installs" subtitle="Recent installs of this game, newest first. Kept until PlayLens restarts.">
        <div className="builds-pad builds-jobs">
          {jobs.length === 0 ? (
            <p className="dim">No installs yet.</p>
          ) : (
            jobs.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                latest={jobs.find((x) => x.serial === j.serial) === j}
                onCancel={() => void cancel(j.id)}
                onRetry={() => void install(false)}
                onUninstallRetry={() => setConfirmClean(true)}
              />
            ))
          )}
        </div>
      </Panel>

      <DialogShell open={confirmClean} onOpenChange={setConfirmClean} title="Uninstall and install">
        <p>
          Uninstall {game.name} from {device ? deviceName(device) : "the phone"}, then install {latest?.name ?? "the latest build"}?
        </p>
        <p className="dim">This deletes the game's data on the phone: progress, purchases restored locally, settings and consent choices.</p>
        <div className="row-wrap">
          <Button variant="danger" loading={starting} loadingLabel="Starting…" disabled={!canInstall} onClick={() => install(true)}>
            Uninstall and install
          </Button>
          <Button variant="ghost" onClick={() => setConfirmClean(false)}>
            Cancel
          </Button>
        </div>
      </DialogShell>
    </main>
  );
}
