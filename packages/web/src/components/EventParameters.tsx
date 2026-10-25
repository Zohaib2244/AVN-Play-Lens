import { useState } from "react";
import type { Json } from "../types";

export const parameterText = (value: Json | undefined) =>
  value === undefined
    ? "Unavailable"
    : value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

export function EventParameters({
  entries,
  limit = 6,
  empty = "No parameters",
}: {
  entries: [string, Json | undefined][];
  limit?: number;
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  if (!entries.length)
    return <span className="pl-event-no-params">{empty}</span>;
  return (
    <div className="pl-parameter-chips">
      {entries.slice(0, all ? undefined : limit).map(([key, value]) => (
        <span className="pl-parameter-chip" key={key}>
          <span className="pl-parameter-name">{key}</span>
          <span className="pl-parameter-value">{parameterText(value)}</span>
        </span>
      ))}
      {entries.length > limit && (
        <button
          type="button"
          className="pl-parameter-more"
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${entries.length} parameters`}
        </button>
      )}
    </div>
  );
}
