import { useState } from "react";
import { Icon } from "@avn/ui";
import type { Json } from "../types";

export function ConfigTree({
  value,
  depth = 0,
}: {
  value: Json;
  depth?: number;
}) {
  const [limit, setLimit] = useState(50);
  if (value === null || typeof value !== "object")
    return (
      <span className="mono pl-json-scalar">
        {typeof value === "string" && !value.length
          ? '"" (empty string)'
          : String(value)}
      </span>
    );
  const entries = Object.entries(value);
  if (!entries.length)
    return (
      <span className="muted">
        {Array.isArray(value) ? "Empty list" : "Empty object"}
      </span>
    );
  return (
    <div className="pl-json-tree">
      {entries.slice(0, limit).map(([key, child]) => {
        const label = Array.isArray(value) ? `Item ${Number(key) + 1}` : key;
        if (child !== null && typeof child === "object")
          return (
            <details className="pl-json-branch" key={key}>
              <summary>
                <Icon name="caret" />
                <span className="mono">{label}</span>
                <small>
                  {Object.keys(child).length}{" "}
                  {Array.isArray(child) ? "items" : "fields"}
                </small>
              </summary>
              <div className="pl-json-children">
                {depth < 12 ? (
                  <ConfigTree value={child} depth={depth + 1} />
                ) : (
                  <pre>{JSON.stringify(child, null, 2)}</pre>
                )}
              </div>
            </details>
          );
        return (
          <div className="pl-json-field" key={key}>
            <span className="mono pl-json-key">{label}</span>
            <ConfigTree value={child} depth={depth + 1} />
          </div>
        );
      })}
      {entries.length > limit && (
        <button className="btn" onClick={() => setLimit((count) => count + 50)}>
          Show next {Math.min(50, entries.length - limit)}{" "}
          {Array.isArray(value) ? "items" : "fields"}
        </button>
      )}
    </div>
  );
}
