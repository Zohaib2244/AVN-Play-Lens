import { describe, expect, it } from "vitest";
import { tabBadges } from "./tab-badges";
import type { Monitor } from "./types";

describe("tabBadges", () => {
  it("counts only what needs a look, per tool tab", () => {
    const monitor = {
      flags: [
        { id: "a", severity: "critical" },
        { id: "b", severity: "info" },
      ],
      adRules: { checks: [{ status: "problem" }, { status: "ok" }] },
      privacy: [{ status: "warn" }],
      firebase: { counts: { notLogged: 3 } },
      run: { items: [{ status: "problem" }, { status: "ok" }] },
    } as unknown as Monitor;
    expect(tabBadges(monitor)).toEqual({
      health: 2,
      firebase: 3,
      checklist: 1,
    });
  });

  it("is empty before any monitor data arrives", () => {
    expect(tabBadges(null)).toEqual({ health: 0, firebase: 0, checklist: 0 });
  });
});
