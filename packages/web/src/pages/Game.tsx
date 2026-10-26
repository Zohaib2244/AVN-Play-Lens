import {
  Button,
  DialogShell,
  Icon,
  PageHead,
  Panel,
  Tag,
  useToast,
} from "@avn/ui";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { GameEditor } from "../components/GameEditor";
import { GameIcon } from "../components/GameIcon";
import { SessionHistory } from "../components/SessionHistory";
import { Menu } from "../components/ui";
import { deviceName, useApp } from "../state";
import { healthIssues } from "../health-issues";

export function GameSessions() {
  const { game, pkg } = useApp();
  return (
    <main className="content">
      <h1 className="page-title">{game?.name} sessions</h1>
      <SessionHistory packageFilter={pkg ?? undefined} groupByGame={false} />
    </main>
  );
}
