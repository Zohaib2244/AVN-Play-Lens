import { useEffect } from "react";
import { refreshResource, useResource } from "./query";
import { useApp } from "./state";
import type { BuildState } from "./types";

// Share the same game-scoped resource in the persistent header and Builds page.
export function useBuildState(gameId: string | undefined) {
  const { buildsVersion } = useApp();
  const path = `builds/${encodeURIComponent(gameId ?? "")}`;
  const query = useResource<BuildState>(path, { enabled: !!gameId });
  useEffect(() => {
    if (gameId && buildsVersion) void refreshResource(path);
  }, [buildsVersion, gameId, path]);
  return query;
}
