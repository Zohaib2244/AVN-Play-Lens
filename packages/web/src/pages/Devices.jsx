import { useEffect, useState } from 'react';
import { Button, ConfirmDelete, Drawer, ErrorPanel, Icon, PageHead, Panel, Tag } from '@avn/ui';
import { useApp, deviceName, stateHint } from '../state.jsx';
import { api } from '../api.js';
import { useProfile, DeviceRows } from '../components/DeviceProfile.jsx';
import { SkeletonRows } from '../components/ui.jsx';

function DeviceDetails({ serial }) {
  const { profile, error } = useProfile(serial, null);
  return error ? <p className="badc">Could not read this device. {error}</p> : profile ? <DeviceRows d={profile.device} /> : <SkeletonRows rows={6} />;
}
function savedPhoneFor(d, saved) {
  return d.transport === 'wifi' ? saved.find((s) => d.serial === s.address || d.serial.startsWith(`${s.id}-`) || (!s.address && d.serial.startsWith(`${s.ip}:`))) : null;
}
function WifiControls({ saved, connected, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unpair, setUnpair] = useState(false);
  const manage = async (action) => {
    setBusy(true); setError('');
    try { await api(`devices/saved/${encodeURIComponent(saved.id)}/${action}`, { method: 'POST' }); setUnpair(false); await onChange(action); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <><div className="pl-device-actions row-wrap"><Button size="sm" loading={busy} loadingLabel="Working…" onClick={() => manage(connected ? 'disconnect' : 'reconnect')}>{connected ? 'Disconnect' : 'Reconnect'}</Button><Button size="sm" variant="ghost" onClick={() => setUnpair(true)}>Forget device…</Button><span className="pl-page-note">Auto-reconnect {saved.autoReconnect === false ? 'paused' : 'on'}</span></div>{error && <p className="badc" role="alert">{error}</p>}<ConfirmDelete open={unpair} onClose={() => setUnpair(false)} onConfirm={() => manage('forget')} name={saved.label || saved.id} title="Forget this device?" busy={busy} consequences={['Its saved Wi-Fi connection in PlayLens. Also forget this computer in your phone’s Wireless debugging → Paired devices to fully revoke pairing.']} confirmLabel="Disconnect & forget" /></>;
}
export function Devices() {
  const { devices, serial, selectDevice, setView, online } = useApp();
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);
  const [notice, setNotice] = useState(false);
  const load = async (action) => { try { setSaved(await api('devices/saved')); setError(''); if (action === 'forget') setNotice(true); } catch (e) { setError(e.message); } };
  useEffect(() => { if (online) load(); }, [online, devices]);
  return <main className="content">
    <PageHead title="Devices" description="Your Android connections. Select a device, then open a game." actions={<Button variant="primary" onClick={() => setView('connect')}><Icon name="plus" />Connect device</Button>} />
    {notice && <div className="banner" role="status">Device forgotten in PlayLens. Forget this computer in the phone’s Wireless debugging settings to fully unpair.</div>}
    {error && <ErrorPanel title="Could not load remembered devices" message={error} onRetry={load} />}
    <div className="pl-device-grid">{devices.map((d) => {
      const hint = stateHint(d), remembered = savedPhoneFor(d, saved);
      return <Panel key={d.serial} title={deviceName(d)} subtitle={d.replay ? 'Simulated device · saved log replay' : [d.info?.android && `Android ${d.info.android}`, d.info?.battery != null && `${d.info.battery}% battery`].filter(Boolean).join(' · ') || d.serial} actions={<Tag kind={hint ? 'warn' : d.replay ? 'plain' : 'ok'}>{hint ? 'Needs attention' : d.replay ? 'Replay' : 'Connected'}</Tag>}><div className="pb pl-setup-panel"><div className="row-wrap"><span className="pill">{d.replay ? 'Demo' : d.transport === 'wifi' ? 'Wi-Fi' : 'USB'}</span><span className="mono dim pl-page-note">{d.serial}</span></div>{hint && <p className="warnc">{hint}</p>}<div className="row-wrap"><Button disabled={d.serial === serial || d.state !== 'device'} onClick={() => selectDevice(d)}>{d.serial === serial ? 'Selected device' : 'Use this device'}</Button><Button variant="ghost" onClick={() => setDetails(d)}>Device details <Icon name="arrow" /></Button></div>{remembered && <WifiControls saved={remembered} connected onChange={load} />}</div></Panel>;
    })}{saved.filter((s) => !devices.some((d) => savedPhoneFor(d, [s]))).map((s) => <Panel key={s.id} title={s.label || s.id} actions={<Tag kind="plain">Disconnected</Tag>}><div className="pb"><WifiControls saved={s} connected={false} onChange={load} /></div></Panel>)}</div>
    {!devices.length && !saved.length && <Panel><div className="pl-empty"><Icon name="link" size={28} /><h2>No devices connected.</h2><p className="muted">Plug in a USB cable or pair your phone over Wi-Fi.</p><Button onClick={() => setView('connect')}>Connect your first device</Button></div></Panel>}
    <Drawer open={!!details} onClose={() => setDetails(null)} title={details ? deviceName(details) : 'Device details'} subtitle={details?.serial}>{details && <DeviceDetails serial={details.serial} />}</Drawer>
  </main>;
}
