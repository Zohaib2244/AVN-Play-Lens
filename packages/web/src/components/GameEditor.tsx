import { useToast } from "@avn/ui";
import { useMutation } from "@tanstack/react-query";
import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { useApp } from "../state";
import type { Game } from "../types";
import { GameIcon } from "./GameIcon";
export function GameEditor({
  game = null,
  onDone,
}: {
  game?: Game | null;
  onDone: (game: Game | null) => void;
}) {
  const { reloadGames, refreshApps, serial, apps } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState(game?.name || "");
  const [packageId, setPackageId] = useState(game?.packageId || "");
  const [icon, setIcon] = useState(game?.icon || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 250 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP icon smaller than 250 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setIcon(String(reader.result));
      setError("");
    };
    reader.onerror = () => setError("Could not read this image.");
    reader.readAsDataURL(file);
  };
  const mutation = useMutation({
    mutationFn: () =>
      api<Game>(game ? `games/${game.id}` : "games", {
        method: game ? "PATCH" : "POST",
        body: { name, packageId, icon },
      }),
  });
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await mutation.mutateAsync();
      await reloadGames({
        previousPackage: game?.packageId,
        nextPackage: saved.packageId,
      });
      refreshApps();
      toast({ kind: "ok", title: game ? "Game updated" : "Game registered" });
      onDone(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="pl-editor"
      onSubmit={save}
      aria-label={game ? "Edit game" : "Add game"}
    >
      <div className="library-heading">
        <p className="muted">Use the package ID from your Android build.</p>
        <button type="button" className="linkish" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
      <div className="icon-editor">
        <GameIcon game={{ name: name || "Game", icon }} />
        <div>
          <label className="btn btn-sm icon-upload">
            Choose icon
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={upload}
              aria-label="Game icon"
            />
          </label>
          <p className="dim" style={{ fontSize: 12.5, margin: "8px 0" }}>
            PNG, JPEG or WebP · up to 250 KB
          </p>
          {icon && (
            <button
              type="button"
              className="linkish"
              onClick={() => setIcon(null)}
            >
              Remove icon
            </button>
          )}
        </div>
      </div>
      <div className="library-fields">
        <label>
          Game name
          <input
            className="field"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Puzzle Game"
          />
        </label>
        <label>
          Android package ID
          <input
            className="field mono"
            required
            maxLength={255}
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            placeholder="com.studio.game"
            list="installed-package-ids"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <datalist id="installed-package-ids">
          {(apps.serial === serial ? apps.packages : []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div style={{ marginTop: 18 }}>
        <button className="btn btn-warm" disabled={busy}>
          {busy ? "Saving…" : "Save game"}
        </button>
      </div>
    </form>
  );
}
