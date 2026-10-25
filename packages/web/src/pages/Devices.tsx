import {
  Button,
  ConfirmDelete,
  Drawer,
  ErrorPanel,
  Icon,
  PageHead,
  Panel,
  Tag,
} from "@avn/ui";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { DeviceRows, useProfile } from "../components/DeviceProfile";
import { SkeletonRows } from "../components/ui";
import { DeviceArt } from "../components/DeviceArt";
import { useResource } from "../query";
import { deviceName, stateHint, useApp } from "../state";
import type { Device, SavedDevice } from "../types";

function DeviceDetails({ serial }: { serial: string }) {
  const { profile, error } = useProfile(serial, null);
  return error ? (
    <p className="badc">Could not read this device. {error}</p>
  ) : profile ? (
    <DeviceRows d={profile.device} />
  ) : (
    <SkeletonRows rows={6} />
  );
}
function savedPhoneFor(d: Device, saved: SavedDevice[]) {
  return d.transport === "wifi"
    ? saved.find(
        (s) =>
          d.serial === s.address ||
          d.serial.startsWith(`${s.id}-`) ||
          (!s.address && d.serial.startsWith(`${s.ip}:`)),
      )
    : null;
}
function WifiControls({
  saved,
  connected,
  onChange,
}: {
  saved: SavedDevice;
  connected: boolean;
  onChange: (action?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [savingReconnect, setSavingReconnect] = useState(false);
  const [error, setError] = useState("");
  const [unpair, setUnpair] = useState(false);
  const [reconnect, setReconnect] = useState(saved.autoReconnect !== false);
  useEffect(
    () => setReconnect(saved.autoReconnect !== false),
    [saved.autoReconnect],
  );
  const toggleReconnect = async (enabled: boolean) => {
    setReconnect(enabled);
    setSavingReconnect(true);
    setError("");
    try {
      await api(`devices/saved/${encodeURIComponent(saved.id)}`, {
        method: "PATCH",
        body: { autoReconnect: enabled },
      });
      await onChange();
    } catch (err) {
      setReconnect(saved.autoReconnect !== false);
      setError(errorMessage(err));
    } finally {
      setSavingReconnect(false);
    }
  };
  const manage = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`devices/saved/${encodeURIComponent(saved.id)}/${action}`, {
        method: "POST",
      });
      setUnpair(false);
      await onChange(action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="pl-device-actions row-wrap">
        <Button
          size="sm"
          loading={busy}
          loadingLabel="Working…"
          onClick={() => manage(connected ? "disconnect" : "reconnect")}
        >
          {connected ? "Disconnect" : "Reconnect"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setUnpair(true)}>
          Forget device…
        </Button>
        <label className="pl-reconnect-toggle">
          <input
            type="checkbox"
            role="switch"
            checked={reconnect}
            disabled={busy || savingReconnect}
            onChange={(e) => toggleReconnect(e.target.checked)}
            aria-label={`Auto-reconnect ${saved.label || saved.id}`}
          />
          <span>
            Auto-reconnect <b>{reconnect ? "on" : "off"}</b>
          </span>
          <span className="pl-reconnect-feedback" role="status">
            {savingReconnect ? "Saving…" : ""}
          </span>
        </label>
      </div>
      {error && (
        <p className="badc" role="alert">
          {error}
        </p>
      )}
      <ConfirmDelete
        open={unpair}
        onClose={() => setUnpair(false)}
        onConfirm={() => manage("forget")}
        name={saved.label || saved.id}
        title="Forget this device?"
        busy={busy}
        consequences={[
          "Its saved Wi-Fi connection in PlayLens. Also forget this computer in your phone’s Wireless debugging → Paired devices to fully revoke pairing.",
        ]}
        confirmLabel="Disconnect & forget"
      />
    </>
  );
}
export function Devices() {
  const { devices, serial, selectDevice, setView, online } = useApp();
  const remembered = useResource<SavedDevice[]>("devices/saved", {
    enabled: online,
    interval: 5000,
  });
  const saved = remembered.data ?? [],
    error = remembered.error?.message;
  const [details, setDetails] = useState<Device | null>(null);
  const [notice, setNotice] = useState(false);
  const load = async (action?: string) => {
    await remembered.refetch();
    if (action === "forget") setNotice(true);
  };
  return (
    <main className="content">
      <PageHead
        title="Devices"
        description="Your Android connections. Select a device, then open a game."
        actions={
          <Button variant="primary" onClick={() => setView("connect")}>
            <Icon name="plus" />
            Connect device
          </Button>
        }
      />
      {notice && (
        <div className="banner" role="status">
          Device forgotten in PlayLens. Forget this computer in the phone’s
          Wireless debugging settings to fully unpair.
        </div>
      )}
      {error && (
        <ErrorPanel
          title="Could not load remembered devices"
          message={error}
          onRetry={load}
        />
      )}
      <div className="pl-device-grid">
        {devices.map((d) => {
          const hint = stateHint(d),
            remembered = savedPhoneFor(d, saved);
          return (
            <Panel
              key={d.serial}
              className={d.serial === serial ? "pl-device-active" : undefined}
              title={
                <span className="pl-device-title">
                  <DeviceArt
                    id={remembered?.id ?? d.serial}
                    replay={d.replay}
                  />
                  <span>{d.replay ? "Demo simulator" : deviceName(d)}</span>
                </span>
              }
              subtitle={
                d.replay
                  ? "Simulated device · saved log replay"
                  : [
                      d.info?.android && `Android ${d.info.android}`,
                      d.info?.battery != null && `${d.info.battery}% battery`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || d.serial
              }
              actions={
                <Tag
                  kind={
                    d.serial === serial
                      ? "info"
                      : hint
                        ? "warn"
                        : d.replay
                          ? "plain"
                          : "ok"
                  }
                >
                  {d.serial === serial
                    ? "Active device"
                    : hint
                      ? "Needs attention"
                      : d.replay
                        ? "Simulator"
                        : "Connected"}
                </Tag>
              }
            >
              <div className="pb pl-setup-panel">
                <div className="row-wrap">
                  <span className="pill">
                    {d.replay
                      ? "Demo"
                      : d.transport === "wifi"
                        ? "Wi-Fi"
                        : "USB"}
                  </span>
                  <span className="mono dim pl-page-note">{d.serial}</span>
                </div>
                {hint && <p className="warnc">{hint}</p>}
                <div className="pl-use-device">
                  <Button
                    variant={d.serial === serial ? "ghost" : "primary"}
                    disabled={
                      d.serial === serial ||
                      d.state !== "device" ||
                      (!!d.replay && devices.some((phone) => !phone.replay))
                    }
                    onClick={() => selectDevice(d)}
                  >
                    {d.serial === serial
                      ? "Currently active"
                      : "Use this device"}
                  </Button>
                  <Button variant="ghost" onClick={() => setDetails(d)}>
                    Device details <Icon name="arrow" />
                  </Button>
                </div>
                {d.replay && (
                  <p className="pl-page-note">
                    Plays saved demo logs.{" "}
                    {devices.some((phone) => !phone.replay)
                      ? "Your real phone takes priority. Disconnect it to use the simulator."
                      : "No data comes from a live phone."}
                  </p>
                )}
                {!remembered && !d.replay && (
                  <p className="pl-page-note">
                    {d.transport === "wifi"
                      ? "Pair this phone to save its auto-reconnect preference."
                      : "USB reconnects when the cable is plugged in. Auto-reconnect applies to paired Wi-Fi devices."}
                  </p>
                )}
                {remembered && (
                  <WifiControls saved={remembered} connected onChange={load} />
                )}
              </div>
            </Panel>
          );
        })}
        {saved
          .filter((s) => !devices.some((d) => savedPhoneFor(d, [s])))
          .map((s) => (
            <Panel
              key={s.id}
              title={
                <span className="pl-device-title">
                  <DeviceArt id={s.id} />
                  <span>{s.label || s.id}</span>
                </span>
              }
              actions={<Tag kind="plain">Disconnected</Tag>}
            >
              <div className="pb">
                <WifiControls saved={s} connected={false} onChange={load} />
              </div>
            </Panel>
          ))}
      </div>
      {!devices.length && !saved.length && (
        <Panel>
          <div className="pl-empty">
            <Icon name="link" size={28} />
            <h2>No devices connected.</h2>
            <p className="muted">
              Plug in a USB cable or pair your phone over Wi-Fi.
            </p>
            <Button onClick={() => setView("connect")}>
              Connect your first device
            </Button>
          </div>
        </Panel>
      )}
      <Drawer
        open={!!details}
        onClose={() => setDetails(null)}
        title={details ? deviceName(details) : "Device details"}
        subtitle={details?.serial}
      >
        {details && <DeviceDetails serial={details.serial} />}
      </Drawer>
    </main>
  );
}
