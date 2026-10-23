// Real API/WebSocket replay with isolated files: browser tests never touch the user's library.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { createServer } from "../../server/src/api/server.mjs";
import { GameLibrary } from "../../server/src/games/library.mjs";
import { RulesStore } from "../../server/src/rules/loader.mjs";
import { replayDevice } from "../../server/src/replay/source.mjs";
import { SnapshotStore } from "../../server/src/snapshots/snapshots.mjs";

const dir = mkdtempSync(join(tmpdir(), "playlens-browser-"));
const games = new GameLibrary(join(dir, "games.json"));
games.save({ name: "PlayLens Demo", packageId: "com.avn.demo" });
games.save({ name: "Puzzle Garden", packageId: "com.studio.puzzlegarden" });
const replay = {
  file: resolve("packages/server/fixtures/demo.logcat"),
  pkg: "com.avn.demo",
  device: replayDevice("com.avn.demo"),
};
const pairing = new EventEmitter();
pairing.current = { state: "idle" };
pairing.state = () => pairing.current;
pairing.startQr = () => {
  pairing.current = {
    state: "waiting",
    qr: "WIFI:T:ADB;S:playlens-browser-fixture;P:fixture-only;;",
  };
  pairing.emit("update", pairing.current);
  return pairing.current;
};
pairing.cancel = () => {};
const server = createServer({
  port: 7431,
  staticDir: resolve("packages/web/dist"),
  record: false,
  adb: null,
  pairing,
  replay,
  games,
  snapshots: new SnapshotStore(join(dir, "snapshots")),
  rules: new RulesStore({ dir: join(dir, "rules") }),
  devices: () => [replay.device],
  onDevices: () => {},
  status: () => ({ replay: true, adb: "fixture-adb" }),
});
await server.listen();
console.log("PlayLens browser fixture listening on 7431");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
