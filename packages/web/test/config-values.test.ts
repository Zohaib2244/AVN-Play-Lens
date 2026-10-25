import { expect, it } from "vitest";
import { configValueModel, configValues } from "../src/config-values";

const fetched = { fetch: { lastFetchStatus: "Success", ts: 1 } };
it("flags static fallbacks and missing fetched keys instead of rendering blank values", () => {
  const fallback = configValueModel(
    {
      name: "Economy",
      value: "",
      hasValue: true,
      declaredType: "Json",
      source: "StaticValue",
    },
    fetched,
  );
  expect(fallback.issue).toContain("No server value or app default");
  expect(fallback.sourceLabel).toBe("Not configured");
  expect(
    configValueModel({ name: "Missing", hasValue: false }, fetched).issue,
  ).toBeTruthy();
  expect(
    configValues({ ...fetched, sources: { Missing: "RemoteValue" } })[0].issue,
  ).toBeTruthy();
});
it("retains meaningful false/zero/empty-string values and explains defaults and cache", () => {
  for (const value of [false, 0, ""])
    expect(
      configValueModel(
        {
          name: "Value",
          value,
          hasValue: true,
          declaredType: "String",
          source: "RemoteValue",
        },
        fetched,
      ).issue,
    ).toBeUndefined();
  expect(
    configValueModel({ name: "Key", value: false, source: "DefaultValue" })
      .sourceLabel,
  ).toBe("App default");
  expect(
    configValueModel({ name: "Key", value: 0, source: "Cache" }).sourceLabel,
  ).toBe("Saved on device");
});
it("waits before fetch and validates registered JSON without discarding the registered type", () => {
  const waiting = configValueModel({
    name: "AdConfig",
    declaredType: "Json",
    hasValue: false,
  });
  expect(waiting.waiting).toBe(true);
  expect(waiting.issue).toBeUndefined();
  const parsed = configValueModel(
    {
      name: "AdConfig",
      declaredType: "Json",
      hasValue: true,
      value: '{"enabled":true}',
    },
    fetched,
  );
  expect(parsed.value).toEqual({ enabled: true });
  expect(parsed.type).toBe("Json");
  expect(parsed.expandable).toBe(true);
  expect(
    configValueModel(
      {
        name: "Invalid",
        declaredType: "Json",
        hasValue: true,
        value: "bad JSON",
      },
      fetched,
    ).issue,
  ).toContain("invalid JSON");
});
