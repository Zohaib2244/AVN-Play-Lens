import { expect, test } from "vitest";
import { validateSearch } from "./navigation";

test("validates route identity while retaining typed filter and density parameters", () => {
  const search = validateSearch({
    view: "saved-session",
    game: "com.studio.game",
    session: "capture 1",
    density: "comfort",
    hideAutoEvents: true,
    perfWindow: "600",
  });
  expect(search).toMatchObject({
    view: "saved-session",
    game: "com.studio.game",
    session: "capture 1",
    density: "comfort",
    hideAutoEvents: true,
    perfWindow: "600",
  });
});
test("unknown routes fall back to home and malformed identity and density are discarded", () => {
  expect(
    validateSearch({
      view: "unknown",
      game: { wrong: true },
      session: 7,
      density: "invalid",
    }),
  ).toEqual({
    view: "home",
    game: undefined,
    session: undefined,
    density: undefined,
  });
});
