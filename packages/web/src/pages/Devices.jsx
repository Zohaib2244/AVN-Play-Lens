import { useEffect, useState } from 'react';
import { useApp, deviceName, stateHint } from '../state.jsx';
import { api } from '../api.js';
import { PageHead } from '../components/bits.jsx';
import { useProfile, DeviceRows } from '../components/DeviceProfile.jsx';
import { SkeletonRows } from '../components/ui.jsx';
function PhoneGlyph({ color = '#84C9B9' }) {
  return (
    <svg width="28" height="28" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="0" width="4" height="8" fill="#3A2F27" /><rect x="2.5" y="1" width="3" height="5" fill={color} /><rect x="3.5" y="6.8" width="1" height=".6" fill="#9A8B76" />
    </svg>
  );
}

function DeviceDetails({ serial }) {
  const { profile, error } = useProfile(serial, null);
  if (error) return <div className="dim" style={{ fontSize: 14 }}>Couldn't read the phone: {error}</div>;
  if (!profile) return <div style={{ fontSize: 14 }}><SkeletonRows rows={6} /></div>;
  return <div style={{ fontSize: 14 }}><DeviceRows d={profile.device} /></div>;
}

function DeviceCard({ d, children }) {
  const [details, setDetails] = useState(false);
  const hint = stateHint(d);
  const transport = d.replay ? 'Replay' : d.transport === 'wifi' ? 'Wi-Fi' : 'USB';
  const meta = d.replay
    ? 'Plays a saved log, no phone needed'
    : [d.info?.android && `Android ${d.info.android}`, d.info?.battery != null && `battery ${d.info.battery}%`].filter(Boolean).join(' · ') || d.serial;
  return (
    <div className="card devcard">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <PhoneGlyph color={d.replay ? '#B7A7E8' : hint ? '#5A4A3C' : '#84C9B9'} />
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{deviceName(d)}</span>
          <span className="mono dim" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{meta}</span>
        </span>
        <span className="tag tag-plain">{transport}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {hint ? (
          <span className="tag tag-warn" style={{ whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>{hint}</span>
        ) : d.replay ? null : (
          <span className="tag tag-ok"><span className="dot ok" />Ready</span>
        )}
        {!hint && <button className="linkish" style={{ marginLeft: 'auto' }} aria-expanded={details} onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>}
      </div>
      {details && <DeviceDetails serial={d.serial} />}
      {children}
    </div>
  );
}

function savedPhoneFor(d, saved) {
  if (d.transport !== 'wifi') return null;
  return saved.find((s) => d.serial === s.address || d.serial.startsWith(`${s.id}-`) ||
    (!s.address && d.serial.startsWith(`${s.ip}:`)));
}

function WifiControls({ saved, connected, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unpair, setUnpair] = useState(false);
  const manage = async (action) => {
    setBusy(true);
    setError('');
    try {
      await api(`devices/saved/${encodeURIComponent(saved.id)}/${action}`, { method: 'POST' });
      await onChange(action);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-sm" disabled={busy} onClick={() => manage(connected ? 'disconnect' : 'reconnect')}>
          {busy ? 'Working…' : connected ? 'Disconnect' : 'Reconnect'}
        </button>
        <button className="linkish" disabled={busy} aria-expanded={unpair} onClick={() => setUnpair(!unpair)}>Forget / unpair…</button>
        <span className="dim" style={{ fontSize: 12 }}>{saved.autoReconnect === false ? 'Auto-reconnect paused' : 'Auto-reconnect on'}</span>
      </div>
      {unpair && <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>
        <p style={{ margin: '0 0 10px' }}>To fully unpair, on your phone open <strong>Developer options → Wireless debugging → Paired devices</strong>, select this computer, then tap <strong>Forget</strong>. Android requires this step on the phone.</p>
        <p className="mute" style={{ margin: '0 0 12px' }}>Forgetting here disconnects Wi-Fi and removes the phone from PlayLens. Android may reconnect it until you forget this computer on the phone.</p>
        <button className="btn btn-sm" disabled={busy} onClick={() => manage('forget')}>Disconnect and forget in PlayLens</button>
      </div>}
      {error && <p role="alert" style={{ color: 'var(--bad)', fontSize: 14, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}


export function Devices() {
  const { devices, serial, selectDevice, setView, online, status } = useApp();
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  const load = async (action) => { try { setSaved(await api('devices/saved')); if (action === 'forget') setNotice(true); } catch (e) { setError(e.message); } };
  useEffect(() => { if (online) load(); }, [online, devices]);
  return <main className="main"><PageHead title="Devices"><button className="btn btn-warm" disabled={!status?.adb} onClick={() => setView('connect')}>Connect a phone</button></PageHead>
    {notice && <div className="card" style={{ padding: 20 }}>Forgotten in PlayLens. To fully unpair, on your phone go to Developer options → Wireless debugging → Paired devices, select this computer and tap Forget.</div>}
    {error && <p role="alert">{error}</p>}
    <div className="grid-cards">{devices.map((d) => {
      const remembered = savedPhoneFor(d, saved);
      return <DeviceCard key={d.serial} d={d}>
        <button className="btn btn-sm" disabled={d.serial === serial || d.state !== 'device'} onClick={() => selectDevice(d)}>{d.serial === serial ? 'Selected device' : 'Use this device'}</button>
        {remembered && <WifiControls saved={remembered} connected onChange={load} />}
      </DeviceCard>;
    })}
    {saved.filter((s) => !devices.some((d) => savedPhoneFor(d, [s]))).map((s) => <div className="card devcard" key={s.id}><strong>{s.label || s.id}</strong><span className="dim">Remembered · disconnected</span><WifiControls saved={s} connected={false} onChange={load} /></div>)}
    </div>
    {!devices.length && !saved.length && <div className="card empty">No devices yet. Connect by USB or pair over Wi-Fi.</div>}
  </main>;
}
