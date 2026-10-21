// Phone and game build details, read from adb.
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const PLAY_TARGET = 35;   // Google Play: new apps and updates must target API 35 (since Aug 2025)

export function useProfile(serial, pkg) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!serial) return undefined;
    let alive = true;
    setError(null);
    api(`devices/${encodeURIComponent(serial)}/profile${pkg ? `?pkg=${encodeURIComponent(pkg)}` : ''}`)
      .then((p) => alive && setProfile(p))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [serial, pkg]);
  return { profile, error };
}

const mb = (b) => (b ? `${Math.round(b / 1048576)} MB` : null);

function Rows({ rows }) {
  return rows.filter(([, v]) => v != null && v !== '').map(([k, v, cls]) => (
    <div key={k} className="kv"><span className="mute">{k}</span><span className={`mono ${cls ?? ''}`} style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</span></div>
  ));
}

export function DeviceRows({ d }) {
  if (!d) return null;
  return (
    <Rows rows={[
      ['Phone', [d.manufacturer, d.model].filter(Boolean).join(' ')],
      ['Class', d.tier ? `${d.tier} (rough guess from RAM)` : null],
      ['Android', d.android ? `${d.android} (API ${d.sdk})` : null],
      ['Chipset', d.chipset],
      ['CPU', d.cores ? `${d.cores} cores · ${d.abis[0] ?? ''}` : null],
      ['GPU', d.gpu],
      ['RAM', d.ramGb ? `${d.ramGb} GB` : null],
      ['Screen', d.screen ? `${d.screen.w}×${d.screen.h} · ${d.screen.dpi ?? '?'} dpi${d.refreshHz ? ` · ${d.refreshHz} Hz` : ''}` : null],
      ['Battery', d.battery != null ? `${d.battery}%${d.batteryTemp != null ? ` · ${d.batteryTemp} °C` : ''}` : null],
      ['Security patch', d.securityPatch],
    ]} />
  );
}

export function AppRows({ a, engine }) {
  if (!a) return null;
  const oldTarget = a.targetSdk && a.targetSdk < PLAY_TARGET;
  return (
    <Rows rows={[
      ['Version', a.versionName ? `${a.versionName} (${a.versionCode})` : null],
      ['Target / min API', a.targetSdk ? `${a.targetSdk} / ${a.minSdk ?? '?'}` : null, oldTarget ? 'warnc' : ''],
      ['Build', a.debuggable ? 'Debug (debuggable)' : 'Release'],
      ['CPU architecture', a.abi ?? null, a.abi && !/arm64|x86_64/.test(a.abi) ? 'warnc' : ''],
      ['Scripting', engine?.length ? engine.join(' · ') : null],
      ['Installed size', mb(a.sizeBytes) ? `${mb(a.sizeBytes)}${a.splits > 1 ? ` · ${a.splits} parts` : ''}` : null],
      ['Installed from', a.installer],
      ['Last updated', a.lastUpdate],
    ]} />
  );
}

export function targetNote(a) {
  if (!a?.targetSdk || a.targetSdk >= PLAY_TARGET) return null;
  return `Target API ${a.targetSdk}: Google Play needs ${PLAY_TARGET} or higher for updates.`;
}
