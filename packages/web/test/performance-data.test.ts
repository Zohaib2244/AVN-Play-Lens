import { describe, expect, it } from "vitest";
import { alignSamples, chartMaximum } from "../src/performance-data";
describe("performance chart data", () => {
  it("retains missing readings and inserts a gap after a capture pause", () => {
    expect(
      alignSamples(
        [
          { t: 1000, fps: 60 },
          { t: 2000, fps: null },
          { t: 9000, fps: 30 },
        ],
        "fps",
      ),
    ).toEqual([
      [1000, 2000, 2001, 9000],
      [60, null, null, 30],
    ]);
  });
  it("never plots NaN as a real measurement", () => {
    expect(
      alignSamples(
        [
          { t: 1, cpu: NaN },
          { t: 2, cpu: 0 },
        ],
        "cpu",
      ),
    ).toEqual([
      [1, 2],
      [null, 0],
    ]);
  });
  it("keeps fixed scales and includes reference thresholds in automatic scales", () => {
    expect(chartMaximum([{ t: 1, fps: 120 }], "fps", 60, 1)).toBe(60);
    expect(
      chartMaximum([{ t: 1, temp: 35 }], "temp", undefined, 1, 42),
    ).toBeGreaterThan(42);
  });
});
