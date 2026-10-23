import { Button, Icon, Panel, Tag } from "@avn/ui";
import { deviceName, useApp } from "../state";

export function DeviceConnection() {
  const { devices, device, online, serial, selectDevice, setView } = useApp();
  const ready = devices.filter((d) => d.state === "device");
  return (
    <Panel
      title="Device connection"
      actions={
        <Tag
          kind={
            !online
              ? "warn"
              : device?.replay
                ? "plain"
                : ready.length
                  ? "ok"
                  : "plain"
          }
        >
          {!online
            ? "Reconnecting"
            : device?.replay
              ? "Demo replay"
              : ready.length
                ? "Connected"
                : "No device"}
        </Tag>
      }
    >
      <div className="pb row-wrap pl-device-connection">
        <Icon name="link" />
        {ready.length ? (
          <label className="pl-device-choice">
            <span className="muted">Selected device</span>
            <select
              className="select"
              aria-label="Selected device"
              value={serial || ""}
              onChange={(e) =>
                selectDevice(ready.find((d) => d.serial === e.target.value))
              }
            >
              {ready.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {deviceName(d)}
                  {d.replay
                    ? " · simulated"
                    : d.transport === "wifi"
                      ? " · Wi-Fi"
                      : " · USB"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="muted">
            Connect an Android phone by USB or wireless debugging.
          </span>
        )}
        <span className="pl-spacer" />
        <Button onClick={() => setView("devices")}>Manage devices</Button>
        <Button onClick={() => setView("connect")}>
          <Icon name="plus" />
          Connect device
        </Button>
      </div>
    </Panel>
  );
}
