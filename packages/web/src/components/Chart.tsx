import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { alignSamples, chartMaximum } from "../performance-data";
import type { Metric, PerfSample } from "../types";

interface ChartProps {
  data: PerfSample[];
  field: Metric;
  color?: string;
  unit?: string;
  fixedMax?: number;
  minMax?: number;
  refLine?: { value: number; label: string };
  start?: number;
  height?: number;
  format?: (value: number) => string | number;
}
const rounded = (value: number) => Math.round(value);
export function Chart({
  data,
  field,
  color = "var(--accent)",
  unit = "",
  fixedMax,
  minMax = 1,
  refLine,
  start,
  height = 170,
  format = rounded,
}: ChartProps) {
  const host = useRef<HTMLDivElement>(null),
    plot = useRef<uPlot | null>(null);
  const latest = useRef({
    data,
    field,
    fixedMax,
    minMax,
    refLine,
    start,
    format,
    unit,
    color,
  });
  latest.current = {
    data,
    field,
    fixedMax,
    minMax,
    refLine,
    start,
    format,
    unit,
    color,
  };
  const [hover, setHover] = useState<{
    value: number;
    t: number;
    left: number;
  } | null>(null);
  useEffect(() => {
    const element = host.current!;
    // Canvas cannot resolve the style's light-dark()/var() tokens itself.
    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none";
    element.append(probe);
    const resolve = (value: string, alpha = 1) => {
      probe.style.color = value;
      const color = getComputedStyle(probe).color;
      return alpha === 1
        ? color
        : color.replace(/^rgb\((.*)\)$/, `rgba($1, ${alpha})`);
    };
    const token = (name: string) => resolve(`var(${name})`);
    const mono = getComputedStyle(element)
      .getPropertyValue("--font-mono")
      .trim();
    const options: uPlot.Options = {
      width: Math.max(200, element.clientWidth),
      height,
      padding: [14, 12, 0, 0],
      legend: { show: false },
      cursor: { drag: { x: false, y: false, setScale: false } },
      scales: {
        x: { time: false },
        y: {
          range: () => [
            0,
            chartMaximum(
              latest.current.data,
              field,
              latest.current.fixedMax,
              latest.current.minMax,
              latest.current.refLine?.value,
            ),
          ],
        },
      },
      series: [
        {},
        {
          label: field,
          stroke: () => resolve(latest.current.color),
          width: 2,
          fill: () => resolve(latest.current.color, 0.12),
          spanGaps: false,
          points: { show: false },
        },
      ],
      axes: [
        {
          stroke: () => token("--dim"),
          grid: { show: false },
          font: `11px ${mono}`,
          values: (_u, ticks) =>
            ticks.map((t) => {
              const seconds = Math.max(
                0,
                Math.floor(
                  (t -
                    (latest.current.start ?? latest.current.data[0]?.t ?? 0)) /
                    1000,
                ),
              );
              return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
            }),
        },
        {
          stroke: () => token("--dim"),
          size: 44,
          font: `11px ${mono}`,
          grid: { stroke: () => token("--line") },
          values: (_u, ticks) =>
            ticks.map((v) => String(latest.current.format(v))),
        },
      ],
      hooks: {
        draw: [
          (u) => {
            const threshold = latest.current.refLine;
            if (!threshold || threshold.value > u.scales.y.max!) return;
            const y = u.valToPos(threshold.value, "y", true),
              ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = token("--dim");
            ctx.fillStyle = token("--dim");
            ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `${11 * devicePixelRatio}px ${mono}`;
            ctx.textAlign = "right";
            ctx.fillText(
              threshold.label,
              u.bbox.left + u.bbox.width - 4,
              y - 5 * devicePixelRatio,
            );
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null) {
              setHover(null);
              return;
            }
            const value = u.data[1][idx],
              t = u.data[0][idx];
            setHover(
              value == null
                ? null
                : {
                    value,
                    t,
                    left: Math.min(
                      Math.max(u.cursor.left ?? 0, 0),
                      element.clientWidth - 120,
                    ),
                  },
            );
          },
        ],
      },
    };
    const chart = new uPlot(
      options,
      alignSamples(latest.current.data, field),
      element,
    );
    plot.current = chart;
    chart.root.setAttribute("aria-hidden", "true");
    const resize = new ResizeObserver(() =>
      chart.setSize({ width: Math.max(200, element.clientWidth), height }),
    );
    resize.observe(element);
    const theme = new MutationObserver(() => chart.redraw(false, true));
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.destroy();
      probe.remove();
      plot.current = null;
    };
  }, [field, height]);
  useEffect(() => {
    plot.current?.setData(alignSamples(data, field));
  }, [data, field, fixedMax, minMax, refLine?.value]);
  const seconds = hover
    ? Math.max(0, Math.floor((hover.t - (start ?? data[0]?.t ?? 0)) / 1000))
    : 0;
  return (
    <div
      className="pl-time-series"
      role="img"
      aria-label={`${field} over time`}
    >
      <div ref={host} className="pl-uplot" />
      {hover && (
        <div className="chart-tip" style={{ left: hover.left, top: 0 }}>
          <b>
            {format(hover.value)}
            {unit}
          </b>{" "}
          <span className="dim">
            at {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
      )}
    </div>
  );
}
