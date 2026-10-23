// Phone and game build details, read from adb.
import type { ReactNode } from "react";
import { useResource } from "../query";
import type { AppInfo, DeviceInfo, Profile } from "../types";

const PLAY_TARGET = 35; // Google Play: new apps and updates must target API 35 (since Aug 2025)

export function useProfile(serial: string | null, pkg: string | null) {
  const result = useResource<Profile>(
    `devices/${encodeURIComponent(serial ?? "")}/profile${pkg ? `?pkg=${encodeURIComponent(pkg ?? "")}` : ""}`,
    { enabled: !!serial },
  );
  return { profile: result.data, error: result.error?.message };
}

const mb = (b: number | undefined) =>
  b ? `${Math.round(b / 1048576)} MB` : null;

function Rows({ rows }: { rows: [string, ReactNode, string?][] }) {
  return rows
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v, cls]) => (
      <div key={k} className="kv">
        <span className="mute">{k}</span>
        <span
          className={`mono ${cls ?? ""}`}
          style={{ textAlign: "right", overflowWrap: "anywhere" }}
        >
          {v}
        </span>
      </div>
    ));
}

export function DeviceRows({ d }: { d: DeviceInfo | undefined }) {
  if (!d) return null;
  return (
    <Rows
      rows={[
        ["Phone", [d.manufacturer, d.model].filter(Boolean).join(" ")],
        ["Class", d.tier ? `${d.tier} (rough guess from RAM)` : null],
        ["Android", d.android ? `${d.android} (API ${d.sdk})` : null],
        ["Chipset", d.chipset],
        ["CPU", d.cores ? `${d.cores} cores · ${d.abis[0] ?? ""}` : null],
        ["GPU", d.gpu],
        ["RAM", d.ramGb ? `${d.ramGb} GB` : null],
        [
          "Screen",
          d.screen
            ? `${d.screen.w}×${d.screen.h} · ${d.screen.dpi ?? "?"} dpi${d.refreshHz ? ` · ${d.refreshHz} Hz` : ""}`
            : null,
        ],
        [
          "Battery",
          d.battery != null
            ? `${d.battery}%${d.batteryTemp != null ? ` · ${d.batteryTemp} °C` : ""}`
            : null,
        ],
        ["Security patch", d.securityPatch],
      ]}
    />
  );
}

export function AppRows({ a, engine }: { a: AppInfo; engine?: string[] }) {
  if (!a) return null;
  const oldTarget = a.targetSdk && a.targetSdk < PLAY_TARGET;
  return (
    <Rows
      rows={[
        [
          "Version",
          a.versionName ? `${a.versionName} (${a.versionCode})` : null,
        ],
        [
          "Target / min API",
          a.targetSdk ? `${a.targetSdk} / ${a.minSdk ?? "?"}` : null,
          oldTarget ? "warnc" : "",
        ],
        ["Build", a.debuggable ? "Debug (debuggable)" : "Release"],
        [
          "CPU architecture",
          a.abi ?? null,
          a.abi && !/arm64|x86_64/.test(a.abi) ? "warnc" : "",
        ],
        ["Scripting", engine?.length ? engine.join(" · ") : null],
        [
          "Installed size",
          mb(a.sizeBytes)
            ? `${mb(a.sizeBytes)}${a.splits > 1 ? ` · ${a.splits} parts` : ""}`
            : null,
        ],
        ["Installed from", a.installer],
        ["Last updated", a.lastUpdate],
      ]}
    />
  );
}

export function targetNote(a: AppInfo | undefined) {
  if (!a?.targetSdk || a.targetSdk >= PLAY_TARGET) return null;
  return `Target API ${a.targetSdk}: Google Play needs ${PLAY_TARGET} or higher for updates.`;
}
