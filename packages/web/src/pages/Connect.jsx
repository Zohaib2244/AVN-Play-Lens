import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../state.jsx';
import { Spinner } from '../components/ui.jsx';
import { api } from '../api.js';
import { Button, ErrorPanel, Icon, PageHead, Panel, Segmented, Tag } from '@avn/ui';
import { Disclosure } from '../components/ui.jsx';


function useQrSvg(text) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!text) return setSvg('');
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#2A221C', light: '#00000000' } })
      .then(setSvg).catch(() => setSvg(''));
  }, [text]);
  return svg;
}

export function Connect() {
  const { pair, setView, status, online, devices } = useApp();
  const [method, setMethod] = useState('qr');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [manualError, setManualError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectAddress, setConnectAddress] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState('');
  const connectedDevices = devices.filter((d) => d.state === 'device' && !d.replay);
  const svg = useQrSvg(pair.qr);

  useEffect(() => {
    if (!online || !status?.adb) return;
    api('pair/qr', { method: 'POST' }).catch((err) => setManualError(err.message));
    return () => { api('pair/cancel', { method: 'POST' }).catch(() => {}); };
  }, [online, status?.adb]);

  const failed = pair.state === 'failed' || pair.state === 'connection-failed';
  const caption = failed ? pair.error
    : pair.state === 'found' ? `Found a phone at ${pair.address}`
      : pair.state === 'pairing' ? 'Pairing…'
        : pair.state === 'connected' ? 'Done. You can close this tab; the phone stays connected.'
          : pair.state === 'connecting' || pair.state === 'paired' ? 'Paired successfully. Connecting to the phone...'
          : 'Waiting for your phone';

  const pairWithCode = async (ev) => {
    ev.preventDefault();
    setManualError('');
    setBusy(true);
    try {
      await api('pair/code', { method: 'POST', body: { address: address.trim(), code: code.trim() } });
    } catch (err) {
      setManualError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const connectPaired = async (ev) => {
    ev.preventDefault();
    setConnectError('');
    setConnectBusy(true);
    try {
      await api('connect', { method: 'POST', body: { address: connectAddress.trim() } });
      setView('devices');
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setConnectBusy(false);
    }
  };

  return <main className="content">
    <PageHead title="Connect a device" description="Use USB or pair an Android phone over Wi-Fi." actions={<Button onClick={() => setView('devices')}>Back to devices</Button>} />
    {!!connectedDevices.length && <div className="panel"><div className="status-strip"><Tag kind="ok">Connected</Tag><span>{connectedDevices.map((d) => d.info?.model || d.serial).join(', ')}</span><Button size="sm" variant="ghost" onClick={() => setView('home')}>Open game library <Icon name="arrow" /></Button></div></div>}
    {!online ? <div className="banner" role="status">Waiting for the local PlayLens server. Reconnecting automatically.</div> : !status?.adb ? <ErrorPanel title="Android device tools were not found" message="Install the Android SDK or set PLAYLENS_ADB to your adb executable, then restart PlayLens." onBack={() => setView('devices')} backLabel="Back to devices" details={status?.adbSearched?.join('\n')} /> : <>
      <div className="pl-setup-layout">
        <Panel title="On your phone" subtitle="Android 11 or later · same Wi-Fi network"><div className="pb pl-setup-panel">
          <ol className="pl-pair-instructions"><li><b>Enable developer options</b><p className="muted">Open Settings → About phone and tap Build number seven times.</p></li><li><b>Open Wireless debugging</b><p className="muted">In Developer options, turn on Wireless debugging.</p></li><li><b>{method === 'qr' ? 'Scan the QR code' : 'Use a pairing code'}</b><p className="muted">{method === 'qr' ? 'Tap Pair device with QR code, then scan the code beside these steps.' : 'Tap Pair device with pairing code. Enter its address, port and six-digit code.'}</p></li></ol>
          <div className="pl-page-note">Using USB? Enable USB debugging, connect the cable and allow this computer on your phone.</div>
        </div></Panel>
        <Panel title="Pair over Wi-Fi" actions={<Tag kind={pair.state === 'connected' ? 'ok' : failed ? 'bad' : 'info'}>{pair.state === 'connected' ? 'Connected' : failed ? 'Pairing failed' : pair.state === 'waiting' || pair.state === 'idle' ? 'Ready to pair' : pair.state}</Tag>}><div className="pb pl-setup-panel">
          <Segmented label="Pairing method" value={method} onChange={setMethod} options={[{ value: 'qr', label: 'QR code' }, { value: 'code', label: 'Pairing code' }]} />
          {method === 'qr' ? <>{svg ? <div className="qrscreen" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="empty" role="status"><Spinner /> Preparing a pairing code…</div>}<div className="pl-page-note" role="status">{caption}</div><Button disabled={busy} onClick={() => api('pair/qr', { method: 'POST' }).catch((err) => setManualError(err.message))}><Icon name="refresh" />New QR code</Button></> : <form className="pl-setup-panel" onSubmit={pairWithCode}>
            <div className="fld"><label htmlFor="pair-address">Pairing address and port</label><input id="pair-address" required placeholder="192.168.1.42:37115" value={address} onChange={(e) => setAddress(e.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} /></div>
            <div className="fld"><label htmlFor="pair-code">Six-digit pairing code</label><input id="pair-code" required inputMode="numeric" pattern="[0-9 ]{6,7}" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></div>
            <Button type="submit" variant="primary" loading={busy} loadingLabel="Pairing…">Pair device</Button>
          </form>}
          {manualError && <p className="badc" role="alert">{manualError}</p>}
          {pair.state === 'connected' && <Button variant="primary" onClick={() => setView('home')}>Open game library</Button>}
        </div></Panel>
      </div>
      <Disclosure id="connect.existing" title="Already paired? Connect by address" hint="Use the connection port shown on the Wireless debugging screen.">
        <form className="row-wrap" onSubmit={connectPaired}><label className="fld pl-spacer">Connection address and port<input required placeholder="192.168.1.42:39571" value={connectAddress} onChange={(e) => setConnectAddress(e.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} /></label><Button type="submit" loading={connectBusy} loadingLabel="Connecting…">Connect device</Button></form>
        {connectError && <p className="badc" role="alert">{connectError}</p>}
      </Disclosure>
    </>}
  </main>;
}
