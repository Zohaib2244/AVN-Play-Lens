import { Icon, Tag } from "@avn/ui";
import { useEffect, useState, type CSSProperties } from "react";
import { useApp } from "../state";
import type { Game } from "../types";
import { GameIcon } from "./GameIcon";

const tintCache = new Map<string, string>();
function useIconTint(icon?: string | null) {
  const [tint, setTint] = useState<string>();
  useEffect(() => {
    setTint(undefined);
    if (!icon) return;
    if (tintCache.has(icon)) {
      setTint(tintCache.get(icon));
      return;
    }
    let alive = true;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let r = 0,
        g = 0,
        b = 0,
        weight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const saturation =
          Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
          Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        const w = (pixels[i + 3] / 255) * (1 + saturation / 32);
        r += pixels[i] * w;
        g += pixels[i + 1] * w;
        b += pixels[i + 2] * w;
        weight += w;
      }
      if (!weight) return;
      const color = `rgb(${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)})`;
      tintCache.set(icon, color);
      if (alive) setTint(color);
    };
    image.src = icon;
    return () => {
      alive = false;
    };
  }, [icon]);
  return tint;
}

export function GameCard({ game, info }: { game: Game; info?: Game | null }) {
  const { device, openGame, pkg, stopped, stream, inGameWorkspace } = useApp();
  const tint = useIconTint(game.icon);
  const capturing =
    pkg === game.packageId &&
    inGameWorkspace &&
    !stopped &&
    stream.state === "live";
  const status = !device
    ? "Connect a device"
    : device.replay
      ? "Demo simulator"
      : !info
        ? "Checking device"
        : !info.installed
          ? "Install this game"
          : capturing
            ? "Capturing"
            : "Ready to inspect";
  const explanation = !device
    ? "Connect an Android phone to check this build."
    : device.replay
      ? "Saved demo logs; no live phone data."
      : !info
        ? "Reading installed games from the active phone."
        : !info.installed
          ? "This package is not installed on the active phone."
          : capturing
            ? "Collecting this game's logs and events."
            : "Open the workspace to inspect this game.";
  return (
    <button
      className="gcard pl-tinted-card"
      style={{ "--game-tint": tint ?? "var(--accent)" } as CSSProperties}
      onClick={() => openGame(game.packageId)}
      aria-label={`Open ${game.name}`}
    >
      <span className="gc-top">
        <span className="gc-ic">
          <GameIcon game={game} size={44} />
        </span>
        <Tag kind={capturing ? "ok" : "plain"}>{status}</Tag>
      </span>
      <span>
        <span className="gc-name">{game.name}</span>
        <span className="gc-id mono">{game.packageId}</span>
      </span>
      {device && !device.replay && info?.installed && (
        <span className="gc-pills">
          <span className="pill">
            v{info.versionName || "?"} · build {info.versionCode ?? "?"}
          </span>
        </span>
      )}
      <span className="pl-card-explanation">{explanation}</span>
      <span className="gc-foot">
        <span className="gc-last">
          Open workspace <Icon name="arrow" />
        </span>
      </span>
    </button>
  );
}
