import { PageHead } from "../components/bits";
import { RemoteConfigTable } from "../components/RemoteConfigTable";
import { deviceName, useApp } from "../state";
export function RemoteConfig() {
  const { monitor, device, pkg, showInLogs } = useApp();
  return (
    <main className="content">
      <PageHead
        title="Remote Config"
        sub={`${pkg} on ${deviceName(device)} · Values observed in this capture.`}
      />
      <RemoteConfigTable rc={monitor?.health?.rc} showInLogs={showInLogs} />
    </main>
  );
}
