import type uPlot from "uplot";
import type { Metric, PerfSample } from "./types";
/** Keep missing samples and long capture pauses as visible gaps, never fabricated values. */
export function alignSamples(
  samples: PerfSample[],
  field: Metric,
): uPlot.AlignedData {
  const time: number[] = [],
    values: (number | null)[] = [];
  samples.forEach((sample, index) => {
    if (index && sample.t - samples[index - 1].t > 5000) {
      time.push(samples[index - 1].t + 1);
      values.push(null);
    }
    time.push(sample.t);
    const value = sample[field];
    values.push(
      typeof value === "number" && Number.isFinite(value) ? value : null,
    );
  });
  return [time, values];
}
export function chartMaximum(
  samples: PerfSample[],
  field: Metric,
  fixed: number | undefined,
  min: number,
  threshold?: number,
) {
  if (fixed !== undefined) return fixed;
  let max = Math.max(min, threshold ?? 0);
  for (const sample of samples) {
    const v = sample[field];
    if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, v);
  }
  const target = max * 1.08,
    base = 10 ** Math.floor(Math.log10(target || 1));
  return (
    [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      .map((m) => m * base)
      .find((value) => value >= target) ?? target
  );
}
