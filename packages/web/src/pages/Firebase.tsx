import { Button, Panel, Pipeline, StatusStrip, Tag } from "@avn/ui";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { PageHead } from "../components/bits";
import { DataTable } from "../components/DataTable";
import {
  EVENT_CHECK as CHECK,
  FirebaseEvents,
} from "../components/FirebaseEvents";
import { Disclosure, Menu, Skeleton } from "../components/ui";
import { useResource } from "../query";
import { clock, deviceName, useApp } from "../state";
import { useAppAction } from "./Logs";

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <Pipeline
      live={false}
      steps={labels.map((label, i) => ({
        label,
        detail:
          i + 1 < step ? "Done" : i + 1 === step ? "Current step" : "Next",
        state: i + 1 < step ? "ok" : "wait",
      }))}
    />
  );
}
export { Stepper };

export function FirebaseSetup() {
  const {
    serial,
    pkg,
    device,
    monitor,
    send,
    setView,
    showToast,
    stream,
    captureVersion,
  } = useApp();
  const appAction = useAppAction();
  const [step, setStep] = useState(1);
  const [restarted, setRestarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const commandsQuery = useResource<{ commands: string[] }>(
    `devices/${encodeURIComponent(serial ?? "")}/firebase?pkg=${encodeURIComponent(pkg ?? "")}`,
    { enabled: !!serial && !!pkg },
  );
  const commands = commandsQuery.data?.commands ?? [];
  const baseCount = useRef<number | null>(null);
  useEffect(() => {
    baseCount.current = null;
  }, [captureVersion]);
  const fb = monitor?.firebase;
  const debugOn = !!fb?.debug?.on;
  const replay = !!device?.replay;

  useEffect(() => {
    if (step === 3 && baseCount.current == null)
      baseCount.current = fb?.counts.firebase ?? 0;
  }, [step, fb]);

  const turnOn = async () => {
    setBusy(true);
    try {
      await api(`devices/${encodeURIComponent(serial ?? "")}/firebase`, {
        method: "POST",
        body: { pkg, on: true },
      });
      send({ type: "firebase.refresh", serial });
    } catch (e) {
      showToast({
        title: "Could not turn on debug mode",
        msg: errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    setBusy(true);
    const success = await appAction("restart");
    if (success) setRestarted(true);
    setBusy(false);
  };

  const caught = Math.max(
    0,
    (fb?.counts.firebase ?? 0) - (baseCount.current ?? 0),
  );
  const recent = (fb?.rows ?? [])
    .filter((r) => r.sdk === "FA" && !r.missing)
    .slice(0, 3);
  const canNext =
    step === 1 ? debugOn : step === 2 ? restarted || replay : false;

  return (
    <main className="content">
      <PageHead
        title="Firebase setup"
        sub={`Enable event logging for ${pkg} on ${deviceName(device)}.`}
      >
        <Button onClick={() => setView("firebase")}>Back to events</Button>
      </PageHead>
      <Stepper step={step} labels={["Debug mode", "Restart game", "Listen"]} />
      <Panel
        title={
          ["Turn on debug mode", "Restart the game", "Listen for events"][
            step - 1
          ]
        }
      >
        <div className="pb pl-setup-panel">
          {step === 1 && (
            <>
              <p className="muted">
                Firebase debug mode applies only to this package on this device.
                Turn it off from the events screen when you finish.
              </p>
              {commands.length > 0 && (
                <details>
                  <summary>View device commands</summary>
                  <pre className="cmd">{commands.join("\n")}</pre>
                </details>
              )}
              {debugOn ? (
                <Tag kind="ok">Debug mode enabled</Tag>
              ) : (
                <Button
                  variant="primary"
                  loading={busy}
                  loadingLabel="Enabling…"
                  disabled={!pkg}
                  onClick={turnOn}
                >
                  Enable debug mode
                </Button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <p className="muted">
                Firebase reads this setting when the game starts. Restarting
                ends the current play session and keeps your saved progress.
              </p>
              <div className="row-wrap">
                <span className="mono">{pkg}</span>
                <Tag kind={replay ? "plain" : stream.running ? "ok" : "plain"}>
                  {replay
                    ? "Demo replay"
                    : stream.running
                      ? "Running"
                      : "Not running"}
                </Tag>
              </div>
              {replay ? (
                <p className="muted">
                  Replay cannot restart a phone. Continue to listen to the saved
                  log.
                </p>
              ) : restarted ? (
                <Tag kind="done">Game restarted</Tag>
              ) : (
                <Button
                  variant="primary"
                  loading={busy}
                  loadingLabel="Restarting…"
                  onClick={restart}
                >
                  Restart game
                </Button>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <div className="status-strip">
                <Tag kind={caught ? "ok" : "info"}>
                  {caught ? "Events received" : "Listening"}
                </Tag>
                <span>{caught} Firebase events in this step</span>
              </div>
              <p className="muted">
                Play a level. Events appear when Firebase records them on this
                device.
              </p>
              <div className="t-wrap">
                <DataTable
                  data={recent}
                  className="t"
                  rowKey={(e) => String(e.id)}
                  sortKey="pagesFirebasetsx-sort"
                  columns={[
                    {
                      id: "col0",
                      header: <>Event</>,
                      className: "mono",
                      cell: (e) => {
                        return <>{e.name}</>;
                      },
                    },
                    {
                      id: "col1",
                      header: <>Evidence</>,
                      cell: (e) => {
                        return (
                          <>
                            <span className={`tag ${CHECK[e.check][1]}`}>
                              {CHECK[e.check][0]}
                            </span>
                          </>
                        );
                      },
                    },
                  ]}
                />
              </div>
              {!recent.length && (
                <p className="muted">
                  No events yet. Keep the game open and tracking active.
                </p>
              )}
              <Button variant="primary" onClick={() => setView("firebase")}>
                Open Firebase events
              </Button>
            </>
          )}
        </div>
      </Panel>
      <div className="row-wrap">
        {step > 1 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 && (
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
            Continue <span aria-hidden="true">→</span>
          </Button>
        )}
      </div>
    </main>
  );
}

export function Firebase() {
  const {
    monitor,
    device,
    pkg,
    serial,
    send,
    setView,
    showInLogs,
    showToast,
    gameInventory,
  } = useApp();
  const fb = monitor?.firebase;
  const installed =
    gameInventory.serial === serial
      ? gameInventory.games.find((g) => g.packageId === pkg)?.installed
      : undefined;
  if (!device || installed === false)
    return (
      <main className="content">
        <PageHead title="Firebase events" />
        <Panel>
          <div className="pl-empty">
            <h2>
              {!device ? "No device connected." : "This game is not installed."}
            </h2>
            <p className="muted">
              Open an installed build to capture its Firebase events.
            </p>
            <Button onClick={() => setView("game")}>Open game controls</Button>
          </div>
        </Panel>
      </main>
    );
  if (!fb) {
    return (
      <main className="content">
        <PageHead title="Firebase events" />
        <div
          className="panel"
          style={{ overflow: "hidden" }}
          aria-busy="true"
          aria-label="Loading events"
        >
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="erow" style={{ cursor: "default" }}>
              <Skeleton w={70} h={12} />
              <Skeleton w={30} h={18} />
              <Skeleton w={`${50 + ((i * 13) % 40)}%`} h={14} />
              <Skeleton w="70%" h={14} />
              <Skeleton w={100} h={18} />
              <span />
            </div>
          ))}
        </div>
      </main>
    );
  }

  const turnOff = async () => {
    try {
      await api(`devices/${encodeURIComponent(serial ?? "")}/firebase`, {
        method: "POST",
        body: { pkg, on: false },
      });
      send({ type: "firebase.refresh", serial });
      setView("firebase-setup");
    } catch (e) {
      showToast({
        title: "Could not turn off debug mode",
        msg: errorMessage(e),
      });
    }
  };

  return (
    <main className="content">
      <PageHead title="Firebase events" sub={`${pkg} on ${deviceName(device)}`}>
        {!fb.debug?.on && (
          <Button variant="primary" onClick={() => setView("firebase-setup")}>
            Set up event logging
          </Button>
        )}
        <Menu
          items={[
            {
              label: "Run setup again",
              onClick: () => setView("firebase-setup"),
            },
            {
              label: "Turn off Firebase debug mode",
              onClick: turnOff,
              hidden: device?.replay,
            },
          ]}
        />
      </PageHead>
      <StatusStrip
        live={false}
        status={
          fb.receiving
            ? "Receiving events"
            : fb.debug?.on
              ? "Listening"
              : "Debug mode off"
        }
        items={[
          `${fb.counts.firebase} Firebase logs`,
          `${fb.counts.sent || 0} handed to SDK`,
          device?.replay ? "Simulated replay" : "Current capture",
        ]}
        tag={
          <Tag kind={fb.receiving ? "ok" : fb.debug?.on ? "info" : "warn"}>
            {fb.receiving
              ? "Device evidence received"
              : fb.debug?.on
                ? "Waiting for evidence"
                : "Setup needed"}
          </Tag>
        }
      />
      {!fb.debug?.on && (
        <div className="banner">
          Enable debug mode and restart the game to capture Firebase event
          payloads.{" "}
          <button className="linkish" onClick={() => setView("firebase-setup")}>
            Open setup
          </button>
        </div>
      )}
      {fb.counts.notLogged > 0 && (
        <div className="banner">
          {fb.counts.notLogged} SDK handoffs have no matching Firebase payload.
          This does not confirm an upload failure.
        </div>
      )}
      <FirebaseEvents firebase={fb} showInLogs={showInLogs} />
      <Disclosure
        id="firebase.diagnostics"
        title="SDK and upload diagnostics"
        hint={
          fb.diagnostics?.upload?.state === "successful"
            ? "Upload reported successful"
            : fb.diagnostics?.lines
              ? `${fb.diagnostics.lines} SDK log lines observed`
              : "No upload confirmation received"
        }
      >
        {fb.diagnostics?.upload && (
          <div className="row-wrap">
            <Tag
              kind={fb.diagnostics.upload.state === "successful" ? "ok" : "bad"}
            >
              {fb.diagnostics.upload.state === "successful"
                ? "Upload reported successful"
                : "Upload reported failed"}
            </Tag>
            <span className="mono dim">
              {clock(fb.diagnostics.upload.ts, false)}
            </span>
            {fb.diagnostics.upload.entryId && (
              <Button
                size="sm"
                onClick={() => showInLogs(fb.diagnostics!.upload!.entryId!)}
              >
                Show upload log
              </Button>
            )}
          </div>
        )}
        <p className="muted">
          Device logs and SDK handoffs do not prove server delivery. Keep
          tracking active while you play; earlier events are not backfilled.
        </p>
        {fb.diagnostics?.issue && (
          <p className="warnc mono">{fb.diagnostics.issue}</p>
        )}
        <Button onClick={() => setView("logs")}>Inspect game logs</Button>
      </Disclosure>
    </main>
  );
}
