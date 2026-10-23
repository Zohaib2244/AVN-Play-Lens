import type { ReactNode } from "react";
import { useViewState } from "../route-state";
import type { Metric, PerfSample } from "../types";
// Live performance of the game while you play. Four numbers at the top (each one picks the
// graph below), one graph, and everything else tucked into "More details" and
// "Phone and game build". Sampled by the server once a second.
import { Button, Panel } from "@avn/ui";
import { useMemo } from "react";
import { Lattice, PageHead } from "../components/bits";
import { Chart } from "../components/Chart";
import {
  AppRows,
  DeviceRows,
  targetNote,
  useProfile,
} from "../components/DeviceProfile";
import {
  ActionButton,
  Disclosure,
  LiveBars,
  Skeleton,
  SkeletonRows,
} from "../components/ui";
import { deviceName, useApp } from "../state";
import { useAppAction } from "./Logs";

const THERMAL = [
  "None",
  "Light",
  "Moderate",
  "Severe",
  "Critical",
  "Emergency",
  "Shutdown",
];
const WINDOWS = [
  ["120", "2 min"],
  ["600", "10 min"],
  ["all", "Session"],
];
const r0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v));
const r1 = (v: number | null | undefined) =>
  v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1);
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(v * 100)}%`;

function fpsTone(v: number | null | undefined, hz: number | null) {
  if (v == null) return "";
  if (v >= Math.min(55, (hz ?? 60) * 0.9)) return "ok";
  if (v >= 30) return "warn";
  return "bad";
}

function Tile({
  id,
  label,
  value,
  unit,
  sub,
  tone,
  picked,
  onPick,
  loading,
}: {
  id: string;
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: string;
  picked: boolean;
  onPick: (id: string) => void;
  loading: boolean;
}) {
  return (
    <button
      className="kpi pl-metric"
      aria-pressed={picked}
      onClick={() => onPick(id)}
      aria-label={`${label}: show graph`}
    >
      <span className="eyebrow">{label}</span>
      {loading ? (
        <>
          <Skeleton w="55%" h={28} />
          <Skeleton w="75%" h={11} />
        </>
      ) : (
        <>
          <span className="k-v">
            {value}
            {unit && <small>{unit}</small>}
          </span>
          <span className="k-c">
            {tone && (
              <span className={`tag ${tone}`}>
                {tone === "ok"
                  ? "Normal"
                  : tone === "bad"
                    ? "High concern"
                    : "Needs a look"}
              </span>
            )}{" "}
            {sub}
          </span>
        </>
      )}
    </button>
  );
}

function ChartSkeleton() {
  return (
    <div
      style={{
        height: 240,
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        padding: "10px 10px 28px 44px",
      }}
      aria-busy="true"
      aria-label="Collecting samples"
    >
      {Array.from({ length: 28 }, (_, i) => (
        <Skeleton
          key={i}
          w="100%"
          h={`${30 + Math.abs(Math.sin(i / 3)) * 55}%`}
          r={3}
          style={{ flex: "1 1 0" }}
        />
      ))}
    </div>
  );
}

export function Performance() {
  const {
    device,
    pkg,
    serial,
    perf,
    perfSummary: s,
    perfVersion,
    monitor,
    stream,
    gameInventory,
    setView,
  } = useApp();
  const [win, setWin] = useViewState("perfWindow", "120");
  const [metric, setMetric] = useViewState("perfMetric", "fps");
  const appAction = useAppAction();
  const { profile } = useProfile(serial, pkg);

  const all = perf.current;
  const data = useMemo(() => {
    if (win === "all" || !all.length) return all.slice();
    const from = all.at(-1)!.t - Number(win) * 1000;
    return all.filter((d) => d.t >= from);
    // perfVersion changes whenever perf.current grows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfVersion, win]);

  const installed =
    gameInventory.serial === serial
      ? gameInventory.games.find((g) => g.packageId === pkg)?.installed
      : undefined;
  if (!device || !pkg || installed === false) {
    return (
      <main className="content">
        <PageHead title="Performance" />
        <Panel>
          <div className="pl-empty">
            <h2>
              {installed === false
                ? "This game is not installed."
                : "Choose a device and game."}
            </h2>
            <p className="muted">
              Performance is measured for one installed game at a time.
            </p>
            <Button onClick={() => setView(pkg ? "game" : "home")}>
              {pkg ? "Open game controls" : "Open game library"}
            </Button>
          </div>
        </Panel>
      </main>
    );
  }

  const info = s?.info ?? {};
  const last: Partial<PerfSample> = all.at(-1) ?? {};
  const hz = info.refreshMs
    ? Math.round(1000 / info.refreshMs)
    : (profile?.device?.refreshHz ?? null);
  const cores = info.cores ?? profile?.device?.cores;
  const start = all[0]?.t;
  const waitingGame =
    info.fps === "not-running" && !all.some((x) => x.cpu != null);
  // Skeletons only while the first message from the phone is still on its way. After that,
  // no samples means there is a reason (game closed, adb trouble) and the page says which.
  const loading = !s && !all.length;
  const failed = !all.length && !!info.error;
  const app = monitor?.app ?? profile?.app;
  const engine = monitor?.sdkList?.engine;
  const tnote = targetNote(app);
  const dur = s?.durationS
    ? `${Math.floor(s.durationS / 60)}m ${Math.round(s.durationS % 60)}s`
    : null;
  const ramGb = profile?.device?.ramGb;

  const charts: Record<
    string,
    {
      title: string;
      right: string;
      props: {
        field: Metric;
        color: string;
        unit: string;
        fixedMax?: number;
        minMax?: number;
        refLine?: { value: number; label: string };
      };
    }
  > = {
    fps: {
      title: "Frame rate",
      right: s?.fps
        ? `avg ${r1(s.fps.avg)} · under 30 for ${pct(s.under30)}`
        : "",
      props: {
        field: "fps",
        color: "var(--ok)",
        unit: " fps",
        fixedMax: hz ? Math.max(60, hz) : 60,
        refLine: { value: 30, label: "30 FPS" },
      },
    },
    cpu: {
      title: "CPU",
      right: cores ? `100% = one core · ${cores} cores` : "100% = one core",
      props: { field: "cpu", color: "var(--warm)", unit: "%", minMax: 100 },
    },
    mem: {
      title: "Memory",
      right: s?.mem ? `start ${r0(s.memStart)} · peak ${r0(s.mem.max)} MB` : "",
      props: {
        field: "mem",
        color: "var(--lavender)",
        unit: " MB",
        minMax: 200,
      },
    },
    temp: {
      title: "Temperature",
      right: s?.temp ? `battery ${r1(s.temp.min)} → ${r1(s.temp.max)} °C` : "",
      props: {
        field: "temp",
        color: "var(--bad)",
        unit: " °C",
        minMax: 45,
        refLine: { value: 42, label: "42 °C" },
      },
    },
  };
  const c = charts[metric] ?? charts.fps;
  const fpsNote =
    info.fps === "no-layer"
      ? "Couldn't find the game's screen layer, so FPS isn't available (is the game in the foreground?). CPU, memory and temperature still work."
      : null;

  return (
    <main className="content" style={{ gap: 20 }}>
      <PageHead
        title="Performance"
        sub={`${pkg} on ${deviceName(device)}${dur ? ` · ${dur} measured` : ""}`}
      >
        {waitingGame ? (
          <span className="tag plain">Waiting for the game</span>
        ) : (
          <LiveBars label="Sampling every second" />
        )}
      </PageHead>

      {waitingGame && (
        <div
          className="panel"
          style={{
            padding: "18px 22px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Lattice />
          <span style={{ flex: "1 1 auto" }}>
            <b>The game isn't running.</b>{" "}
            <span className="mute">Measuring starts as soon as it opens.</span>
          </span>
          {!device.replay && !stream.running && (
            <ActionButton
              className="btn btn-warm"
              onClick={() => appAction("launch")}
              busyLabel="Launching…"
            >
              Launch game
            </ActionButton>
          )}
        </div>
      )}

      {failed && (
        <div
          className="panel"
          style={{
            padding: "18px 22px",
            borderColor: "var(--bad)",
            background: "var(--bad-soft)",
          }}
        >
          <b style={{ color: "var(--bad)" }}>
            Couldn't read performance from the phone.
          </b>
          <span
            className="mono mute"
            style={{
              display: "block",
              fontSize: 13,
              marginTop: 6,
              overflowWrap: "anywhere",
            }}
          >
            {info.error}
          </span>
          <span
            className="dim"
            style={{ display: "block", fontSize: 13.5, marginTop: 6 }}
          >
            Check the phone is still connected. PlayLens keeps trying every
            second.
          </span>
        </div>
      )}

      <div className="kpis">
        <Tile
          id="fps"
          label="FPS"
          picked={metric === "fps"}
          onPick={setMetric}
          loading={loading}
          value={info.fps === "no-layer" ? "n/a" : r0(last.fps)}
          sub={
            s?.lowFps != null
              ? `1% low ${r1(s.lowFps)}${hz ? ` · ${hz} Hz screen` : ""}`
              : "waiting for frames"
          }
          tone={fpsTone(last.fps, hz)}
        />
        <Tile
          id="cpu"
          label="CPU"
          picked={metric === "cpu"}
          onPick={setMetric}
          loading={loading}
          value={r0(last.cpu)}
          unit="%"
          sub={s?.cpu ? `avg ${r0(s.cpu.avg)}%` : "100% = one core"}
        />
        <Tile
          id="mem"
          label="Memory"
          picked={metric === "mem"}
          onPick={setMetric}
          loading={loading}
          value={r0(last.mem)}
          unit="MB"
          sub={s?.mem ? `peak ${r0(s.mem.max)} MB` : "includes graphics"}
          tone={
            s?.mem && ramGb
              ? s.mem.max > ramGb * 1024 * 0.4
                ? "warn"
                : "ok"
              : ""
          }
        />
        <Tile
          id="temp"
          label="Temperature"
          picked={metric === "temp"}
          onPick={setMetric}
          loading={loading}
          value={r1(last.temp)}
          unit="°C"
          sub={
            last.thermal != null
              ? `throttling: ${THERMAL[last.thermal] ?? last.thermal}`
              : "battery"
          }
          tone={
            last.thermal == null
              ? ""
              : last.thermal === 0
                ? "ok"
                : last.thermal <= 1
                  ? "warn"
                  : "bad"
          }
        />
      </div>

      <section className="panel">
        <div className="ph">
          <span
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>{c.title}</span>
            <span className="mono dim" style={{ fontSize: 12 }}>
              {c.right}
            </span>
          </span>
          <div className="seg" role="group" aria-label="Time window">
            {WINDOWS.map(([k, label]) => (
              <button
                key={k}
                aria-pressed={win === k}
                onClick={() => setWin(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="pb">
          {metric === "fps" && fpsNote ? (
            <div className="empty" style={{ padding: "70px 20px" }}>
              {fpsNote}
            </div>
          ) : data.length < 2 ? (
            waitingGame || failed ? (
              <div className="empty" style={{ padding: "70px 20px" }}>
                {waitingGame
                  ? "The game isn't running, so there is nothing to measure yet."
                  : "No samples yet."}
              </div>
            ) : (
              <ChartSkeleton />
            )
          ) : (
            <Chart data={data} start={start} height={240} {...c.props} />
          )}
        </div>
      </section>

      <Disclosure
        id="perf.more"
        title="More details"
        hint={
          s?.frames
            ? `Frame times · ${s.stutters} stutter${s.stutters === 1 ? "" : "s"} · GPU · garbage collection · battery`
            : "Frame times, GPU, garbage collection, battery"
        }
      >
        <div className="pcharts">
          <section
            className="panel"
            style={{ padding: "16px 18px", minWidth: 0 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 10,
              }}
            >
              <span style={{ fontWeight: 700 }}>Frame times</span>
              <span className="mono dim" style={{ fontSize: 12 }}>
                {s?.frames ? `${s.frames.toLocaleString()} frames` : ""}
              </span>
            </div>
            {!s?.frames ? (
              <SkeletonRows rows={5} />
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    gap: 22,
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  <span>
                    <span className="eyebrow">Median</span>
                    <br />
                    <span className="px" style={{ fontSize: 22 }}>
                      {r1(s.medianFps)}
                    </span>{" "}
                    <span className="dim">fps</span>
                  </span>
                  <span>
                    <span className="eyebrow">Stable</span>
                    <br />
                    <span className="px" style={{ fontSize: 22 }}>
                      {pct(s.stability)}
                    </span>
                  </span>
                  <span>
                    <span className="eyebrow">Longest</span>
                    <br />
                    <span className="px" style={{ fontSize: 22 }}>
                      {r0(s.longestFrame)}
                    </span>{" "}
                    <span className="dim">ms</span>
                  </span>
                </div>
                {[
                  "≤ 25 ms (smooth)",
                  "26–33 ms",
                  "34–50 ms",
                  "51–100 ms",
                  "> 100 ms (freeze)",
                ].map((label, i) => (
                  <div key={label} className="fbar">
                    <span className="dim">{label}</span>
                    <span className="bar" style={{ marginTop: 0 }}>
                      <i
                        style={{
                          width: `${(s.buckets[i] * 100).toFixed(1)}%`,
                          background:
                            i < 2
                              ? "var(--ok)"
                              : i < 3
                                ? "var(--warn)"
                                : "var(--bad)",
                        }}
                      />
                    </span>
                    <span className="mono">
                      {(s.buckets[i] * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </>
            )}
          </section>
          <section
            className="panel"
            style={{ padding: "16px 18px 10px", minWidth: 0 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 700 }}>GPU</span>
              <span className="mono dim" style={{ fontSize: 12 }}>
                {info.gpu === "unreadable"
                  ? "not readable on this phone"
                  : s?.gpu
                    ? `avg ${r0(s.gpu.avg)}% · peak ${r0(s.gpu.max)}%`
                    : "busy %"}
              </span>
            </div>
            {info.gpu === "unreadable" ? (
              <div className="empty" style={{ padding: "50px 10px" }}>
                This phone doesn't let adb read GPU load (common on Mali /
                Samsung). Graphics memory is in the session details.
              </div>
            ) : data.length < 2 ? (
              waitingGame || failed ? (
                <div className="empty" style={{ padding: "50px 10px" }}>
                  No data yet.
                </div>
              ) : (
                <ChartSkeleton />
              )
            ) : (
              <Chart
                data={data}
                field="gpu"
                color="var(--info)"
                unit="%"
                start={start}
                fixedMax={100}
              />
            )}
          </section>
        </div>
        <section className="panel" style={{ padding: "16px 22px 10px" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            This session
          </div>
          {[
            [
              "Frame rate",
              s?.fps
                ? `avg ${r1(s.fps.avg)} · min ${r0(s.fps.min)} · max ${r0(s.fps.max)}`
                : "—",
            ],
            ["Time under 30 FPS", pct(s?.under30)],
            [
              "Stutters (frames over 83 ms)",
              s?.stutters != null
                ? `${s.stutters}${s.stuttersPerMin != null ? ` · ${r1(s.stuttersPerMin)} per min` : ""}`
                : "—",
            ],
            [
              "CPU",
              s?.cpu
                ? `avg ${r0(s.cpu.avg)}% · peak ${r0(s.cpu.max)}%${cores ? ` of ${cores * 100}%` : ""}`
                : "—",
            ],
            [
              "Memory",
              s?.mem
                ? `start ${r0(s.memStart)} · peak ${r0(s.mem.max)} · now ${r0(s.memEnd)} MB`
                : "—",
            ],
            ["Graphics memory", last.gfx != null ? `${last.gfx} MB` : "—"],
            [
              "CPU temperature",
              last.cpuTemp != null ? `${r1(last.cpuTemp)} °C` : "—",
            ],
            [
              "Garbage collection",
              s?.gc?.count
                ? `${s.gc.count} runs · ${r0(s.gc.pausedMs)} ms paused · longest ${r1(s.gc.longestMs)} ms`
                : "none seen",
            ],
            [
              "Battery",
              s?.battery?.start != null
                ? `${s.battery.start}% → ${s.battery.end}%`
                : "—",
            ],
            [
              "Thermal throttling",
              s?.thermalMax != null
                ? `highest: ${THERMAL[s.thermalMax] ?? s.thermalMax}`
                : "—",
            ],
          ].map(([k, v]) => (
            <div key={k} className="kv">
              <span className="mute">{k}</span>
              <span className="mono" style={{ textAlign: "right" }}>
                {v}
              </span>
            </div>
          ))}
        </section>
        <div className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
          FPS and frame times come from the frames Android actually showed for
          the game (SurfaceFlinger). CPU is the game's process time, where 100%
          is one core. Memory is PSS from{" "}
          <span className="mono">dumpsys meminfo</span>, including graphics.
          Temperature is the battery sensor.{" "}
          {device.replay &&
            "Replay device: these numbers are made up for the demo."}
        </div>
      </Disclosure>

      <Disclosure
        id="perf.build"
        title="Phone and game build"
        tone={tnote ? "warn" : ""}
        hint={
          tnote ??
          [
            profile?.device &&
              [
                profile.device.model,
                profile.device.android && `Android ${profile.device.android}`,
                profile.device.ramGb && `${profile.device.ramGb} GB`,
              ]
                .filter(Boolean)
                .join(" · "),
            app?.versionName && `v${app.versionName}`,
          ]
            .filter(Boolean)
            .join(" · ")
        }
      >
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
              padding: "16px 22px 10px",
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Phone
            </div>
            {profile?.device ? (
              <DeviceRows d={profile.device} />
            ) : (
              <SkeletonRows rows={8} />
            )}
          </section>
          <section
            className="panel"
            style={{
              flex: "1 1 340px",
              minWidth: 0,
              padding: "16px 22px 10px",
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Game build
            </div>
            {app ? (
              <AppRows a={app} engine={engine} />
            ) : (
              <SkeletonRows rows={6} />
            )}
            {tnote && (
              <div
                style={{
                  color: "var(--warn)",
                  fontSize: 13.5,
                  padding: "10px 0 4px",
                }}
              >
                {tnote}
              </div>
            )}
          </section>
        </div>
      </Disclosure>
    </main>
  );
}
