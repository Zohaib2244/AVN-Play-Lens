import { Button, Panel, Pipeline, StatusStrip, Tag } from "@avn/ui";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { PageHead } from "../components/bits";
import { DataTable } from "../components/DataTable";
import {
  EVENT_CHECK as CHECK,
  FirebaseEvents,
} from "../components/FirebaseEvents";
import { Menu, Skeleton } from "../components/ui";
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
    stopped,
    online,
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
  const fb = monitor?.firebase;
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const debugOn = enabled || !!fb?.debug?.on;
  const replay = !!device?.replay;

  const turnOn = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`devices/${encodeURIComponent(serial ?? "")}/firebase`, {
        method: "POST",
        body: { pkg, on: true },
      });
      send({ type: "firebase.refresh", serial });
      setEnabled(true);
    } catch (e) {
      setError(errorMessage(e));
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
    if (success) {
      setRestarted(true);
      setStep(3);
    } else
      setError(
        "Could not restart the game. Check the phone connection and try again.",
      );
    setBusy(false);
  };

  const caught =
    step === 3 && (restarted || replay) ? (fb?.counts.firebase ?? 0) : 0;
  const listening = online && !stopped && stream.state === "live";
  const complete = step === 3 && debugOn && caught > 0;
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
      <StatusStrip
        live={false}
        status={
          complete
            ? "Setup complete — device events received"
            : step === 3
              ? listening
                ? "Listening for Firebase events"
                : "Waiting for active capture"
              : `Step ${step} of 3 · ${step === 1 ? (debugOn ? "Debug mode connected" : "Waiting for debug mode") : "Waiting for game restart"}`
        }
        items={[
          replay ? "Demo simulator · saved log evidence" : deviceName(device),
        ]}
        tag={
          <Tag kind={complete ? "ok" : "info"}>
            {complete
              ? "Done"
              : step === 3 && listening
                ? "Listening"
                : "Waiting"}
          </Tag>
        }
      />
      <Stepper
        step={complete ? 4 : step}
        labels={["Debug mode", "Restart game", "Listen"]}
      />
      <Panel
        title={
          ["Turn on debug mode", "Restart the game", "Listen for events"][
            step - 1
          ]
        }
      >
        <div className="pb pl-setup-panel">
          {error && (
            <p className="badc" role="alert">
              {error}
            </p>
          )}
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
                  disabled={!pkg || !device || !online || stopped}
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
                  disabled={!online || stopped || !device}
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
                <Tag kind={complete ? "ok" : "info"}>
                  {complete
                    ? "Setup complete"
                    : listening
                      ? "Listening"
                      : "Waiting for capture"}
                </Tag>
                <span>{caught} Firebase events in this step</span>
              </div>
              <p className="muted">
                {complete
                  ? "Event logging works for this game. Open Firebase events to inspect the captured events and parameters."
                  : listening
                    ? "Keep the game open and play a level. Setup completes when a Firebase event is captured on this device."
                    : "Resume capture from the command menu, or reconnect your phone, then keep the game open."}
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
                {complete
                  ? "Done — open Firebase events"
                  : "Open events while waiting"}
              </Button>
            </>
          )}
        </div>
      </Panel>
      <div className="row-wrap">
        {step > 1 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 && (
          <Button
            disabled={!canNext || busy}
            onClick={() => setStep((current) => Math.min(3, current + 1))}
          >
            {step === 1 ? "Next: restart game" : "Next: listen for events"}{" "}
            <span aria-hidden="true">→</span>
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
    stopped,
    stream,
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
          stopped
            ? "Capture stopped"
            : stream.state === "ended"
              ? device.replay
                ? "Demo playback finished"
                : "Capture finished"
              : fb.receiving
                ? "Receiving events"
                : fb.debug?.on
                  ? "Listening"
                  : "Debug mode off"
        }
        items={[
          `${fb.counts.firebase} Firebase logs`,
          device?.replay ? "Simulated replay" : "Current capture",
        ]}
        tag={
          <Tag
            kind={
              stopped || stream.state === "ended"
                ? "plain"
                : fb.receiving
                  ? "ok"
                  : fb.debug?.on
                    ? "info"
                    : "warn"
            }
          >
            {stopped || stream.state === "ended"
              ? "Captured evidence"
              : fb.receiving
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
      <FirebaseEvents firebase={fb} showInLogs={showInLogs} />
    </main>
  );
}
