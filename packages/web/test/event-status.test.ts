import { expect, it } from "vitest";
import { eventStatus } from "../src/event-status";

it("uses actual Firebase device evidence for recorded status, including automatic events", () => {
  for (const check of ["matches-plugin", "game-code", "automatic"]) {
    const status = eventStatus({ sdk: "FA", check });
    expect(status.state).toBe("recorded");
    expect(status.label).toBe("Recorded by Firebase");
    expect(status.reason).toContain("this device");
    expect(status.reason).toContain("server arrival");
  }
});
it("keeps a reported send, a dropped event, and ByteBrew evidence distinct", () => {
  for (const check of ["plugin-pending", "not-in-firebase", "sent-before-init"])
    expect(eventStatus({ sdk: "FA", check, missing: true }).state).toBe(
      "unconfirmed",
    );
  expect(
    eventStatus({ sdk: "FA", check: "dropped-by-plugin", missing: true }).label,
  ).toBe("Not sent");
  expect(eventStatus({ sdk: "BB", check: "plugin-only" }).state).toBe(
    "reported",
  );
  expect(
    eventStatus({ sdk: "FA", check: "matches-plugin", missing: true }).state,
  ).not.toBe("recorded");
});
