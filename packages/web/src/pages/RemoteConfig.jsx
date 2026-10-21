import { useApp, deviceName } from '../state.jsx';
import { PageHead } from '../components/bits.jsx';
import { Disclosure } from '../components/ui.jsx';
import { RemoteConfigTable } from '../components/RemoteConfigTable.jsx';

export function RemoteConfig() {
  const { monitor, device, pkg, showInLogs } = useApp();
  const rc = monitor?.health?.rc;
  const count = (rc?.values ?? []).filter((v) => v.hasValue).length;
  return <main className="main">
    <PageHead title="Remote Config" sub={`${pkg} on ${deviceName(device)}`} />
    <Disclosure id="remote-config.values" title="Remote Config values" hint={`${count} keys${rc?.fetch ? ` · ${rc.fetch.lastFetchStatus || 'fetch reported'}` : ''}`}>
      <RemoteConfigTable rc={rc} showInLogs={showInLogs} />
    </Disclosure>
  </main>;
}
