import { expect, it } from "vitest";
import { preferredDevice } from "../src/device-selection";
import type { Device } from "../src/types";

const demo: Device = { serial: "replay", state: "device", replay: true };
const phone: Device = { serial: "PHONE", state: "device" };
it("replaces an already selected simulator as soon as a real phone arrives", () => {
  expect(preferredDevice([demo, phone], "replay")).toEqual(phone);
  expect(preferredDevice([demo, phone], null)).toEqual(phone);
});
it("keeps the chosen real phone and never masks an unauthorized phone with demo data", () => {
  const other = { ...phone, serial: "OTHER" };
  expect(preferredDevice([demo, phone, other], "OTHER")).toEqual(other);
  expect(
    preferredDevice([demo, { ...phone, state: "unauthorized" }], "replay"),
  ).toBeNull();
  expect(preferredDevice([demo], null)).toEqual(demo);
  expect(preferredDevice([], "PHONE")).toBeNull();
});
