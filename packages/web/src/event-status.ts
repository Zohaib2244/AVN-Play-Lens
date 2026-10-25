import type { FirebaseEvent } from "./types";

export type EventStatus = {
  state: "recorded" | "unconfirmed" | "not-sent" | "reported";
  label: string;
  kind: "ok" | "warn" | "bad" | "plain";
  reason: string;
};
export function eventStatus(
  row: Pick<FirebaseEvent, "sdk" | "check" | "missing">,
): EventStatus {
  if (row.sdk === "BB")
    return {
      state: "reported",
      label: "ByteBrew reported",
      kind: "plain",
      reason:
        "The plugin reported this ByteBrew event. Firebase delivery does not apply.",
    };
  if (row.check === "dropped-by-plugin")
    return {
      state: "not-sent",
      label: "Not sent",
      kind: "bad",
      reason:
        "The plugin dropped the event because Firebase had not initialized.",
    };
  if (
    !row.missing &&
    ["matches-plugin", "game-code", "automatic"].includes(row.check)
  )
    return {
      state: "recorded",
      label: "Recorded by Firebase",
      kind: "ok",
      reason:
        "Firebase logged this event on this device. Confirm server arrival in Firebase DebugView.",
    };
  if (row.check === "sent-before-init")
    return {
      state: "unconfirmed",
      label: "Not confirmed",
      kind: "warn",
      reason:
        "Sent before Firebase initialized; no matching Firebase event was captured.",
    };
  if (row.check === "plugin-pending")
    return {
      state: "unconfirmed",
      label: "Waiting for Firebase",
      kind: "plain",
      reason:
        "The plugin called Firebase. Waiting for Firebase to log the event.",
    };
  return {
    state: "unconfirmed",
    label: "Not confirmed",
    kind: "warn",
    reason:
      "The plugin reported a send, but no matching Firebase event was captured.",
  };
}
