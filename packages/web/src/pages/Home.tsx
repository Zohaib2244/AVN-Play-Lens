import { DeviceConnection } from "../components/DeviceConnection";
import { GameLibrary } from "../components/GameLibrary";

export function Home() {
  return (
    <main className="content pl-library">
      <DeviceConnection />
      <GameLibrary />
    </main>
  );
}
