import type { ConfigValue, Json, RemoteConfig } from "./types";

export function configValueModel(raw: ConfigValue, rc?: RemoteConfig) {
  const source =
    raw.source ||
    (raw.from === "cache" ? "Cache" : rc?.sources?.[raw.name]) ||
    "Unknown";
  const normalized = source.toLowerCase().replace(/[^a-z]/g, "");
  const isStatic = ["static", "staticvalue"].includes(normalized);
  const sourceLabel = isStatic
    ? "Not configured"
    : ["remote", "remotevalue"].includes(normalized)
      ? "Firebase server"
      : ["default", "defaultvalue"].includes(normalized)
        ? "App default"
        : normalized === "cache"
          ? "Saved on device"
          : "Unknown source";
  let value = raw.value;
  let issue: string | undefined;
  const json =
    /json/i.test(raw.declaredType || "") ||
    (value !== null && typeof value === "object");
  const hasValue = raw.hasValue ?? value !== undefined;
  const fetched = !!rc?.fetch;
  if (isStatic)
    issue =
      "No server value or app default was found. Firebase returned its empty fallback.";
  else if (!hasValue && fetched)
    issue =
      "This key has no value in the captured fetch. Check its Firebase configuration and game logs.";
  else if (json && hasValue && (value === undefined || value === ""))
    issue = "The game logged an empty JSON value.";
  else if (json && typeof value === "string") {
    try {
      value = JSON.parse(value) as Json;
    } catch {
      issue = raw.truncated
        ? "The JSON value is incomplete in the game log."
        : "The game logged invalid JSON. Inspect its log line.";
    }
  }
  if (raw.truncated && !issue)
    issue = "The value is incomplete in the game log.";
  const expandable = !issue && value !== null && typeof value === "object";
  const type =
    raw.declaredType || (expandable ? "JSON" : raw.type || "Unknown");
  return {
    ...raw,
    value,
    source,
    sourceLabel,
    isStatic,
    hasValue,
    issue,
    expandable,
    type,
    waiting: !hasValue && !fetched && !isStatic,
  };
}

export function configValues(rc?: RemoteConfig) {
  const values = new Map(
    (rc?.values ?? rc?.variables ?? [])
      .filter((value) => !value.parent)
      .map((value) => [value.name, value]),
  );
  for (const [name, source] of Object.entries(rc?.sources ?? {}))
    if (!values.has(name)) values.set(name, { name, source, hasValue: false });
  return [...values.values()].map((value) => configValueModel(value, rc));
}
