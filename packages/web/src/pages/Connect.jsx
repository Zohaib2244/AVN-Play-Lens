import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../state.jsx';
import { Spinner } from '../components/ui.jsx';
import { api } from '../api.js';
import { Logo, Icon } from '../components/bits.jsx';

const STEPS = [
  { key: 'waiting', title: 'Scan the code' },
  { key: 'found', title: 'Phone found' },
  { key: 'pairing', title: 'Pairing, no cable needed' },
  { key: 'connecting', title: 'Connecting to the phone' },
  { key: 'connected', title: 'Connected. Ready for Unity Build and Run' },
];
const ORDER = { waiting: 0, found: 1, pairing: 2, connecting: 3, paired: 3, connected: 4 };

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

  const step = ORDER[pair.state] ?? 0;
  const failed = pair.state === 'failed';
  const caption = failed || pair.state === 'paired' ? pair.error
    : pair.state === 'found' ? `Found a phone at ${pair.address}`
      : pair.state === 'pairing' ? 'Pairing…'
        : pair.state === 'connected' ? 'Done. You can close this tab; the phone stays connected.'
          : pair.state === 'connecting' ? 'Paired successfully. Connecting to the phone...'
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

  return (
    <div className="home" style={{ maxWidth: 1160 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0' }}>
        <Logo size={26} />
        <span className="px" style={{ fontSize: 20, fontWeight: 600 }}>AVN PlayLens</span>
        <span style={{ flex: '1 1 0' }} />
        <button className="btn" onClick={() => setView('home')}><Icon.back /> Back home</button>
      </header>

      {(!online || !status?.adb) ? <section className="card" style={{ padding: 28, maxWidth: 760, margin: '40px auto' }} role="status">
        <h1 className="px" style={{ fontSize: 28, marginTop: 0 }}>{!online ? 'Connecting to PlayLens…' : 'Android device tools were not found'}</h1>
        {!online ? <p className="mute">Waiting for the local PlayLens server. Connection options will appear when it is ready.</p> : <>
          <p className="mute">PlayLens needs Android Debug Bridge (ADB) to connect your phone. It searches your PATH, Android SDK, and Unity Hub editor installations, including a custom install folder.</p>
          <p className="mute">If your SDK is elsewhere, set <code>PLAYLENS_ADB</code> to the full path of <code>adb{status?.platform === 'win32' ? '.exe' : ''}</code>, then restart PlayLens.</p>
          {!!status?.adbSearched?.length && <details><summary>Locations checked</summary><pre className="trace" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{status.adbSearched.join('\n')}</pre></details>}
        </>}
      </section> : <>

      {!!connectedDevices.length && <section className="card" style={{ padding: 20, maxWidth: 760, margin: '20px auto 0', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}><strong>{connectedDevices.length === 1 ? 'Your phone is already connected' : `${connectedDevices.length} devices are already connected`}</strong>
          <p className="mute" style={{ margin: '6px 0 0' }}>PlayLens includes devices connected through ADB, Unity, Android Studio or USB. You can use them without pairing here.</p>
        </div>
        <button className="btn btn-warm" onClick={() => setView('devices')}>View devices</button>
      </section>}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '48px 72px', paddingTop: 40 }}>
        <section className="rise" style={{ flex: '1 1 380px', maxWidth: 480, minWidth: 0 }}>
          <span className="eyebrow">Wireless debugging · Android 11 and up</span>
          <h1 className="hero-title">Scan to connect</h1>
          <p className="mute" style={{ margin: '0 0 26px', fontSize: 16.5, lineHeight: 1.65 }}>
            On your phone, open <span style={{ color: 'var(--text)' }}>Developer options</span>, then <span style={{ color: 'var(--text)' }}>Wireless debugging</span>, then <span style={{ color: 'var(--text)' }}>Pair device with QR code</span>, and point it at the screen.
          </p>
          <div style={{ borderTop: '1px solid #2E2620', borderBottom: '1px solid #2E2620', padding: '6px 0' }}>
            {STEPS.map((s, i) => (
              <div key={s.key} className={`st${i < step || pair.state === 'connected' ? ' done' : i === step ? (failed ? ' act fail' : ' act') : ''}`}>
                <span className="sn mono">{i + 1}</span>
                <span style={{ fontSize: 15.5 }}>{s.title}</span>
              </div>
            ))}
          </div>

          <details className="card" style={{ marginTop: 22 }} open={failed || undefined}>
            <summary style={{ cursor: 'pointer', padding: '16px 20px', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Can't scan? Use a pairing code <span className="dim mono" style={{ fontSize: 12 }}>MANUAL</span>
            </summary>
            <form onSubmit={pairWithCode} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '0 20px 20px' }}>
              <p className="mute" style={{ flex: '1 1 100%', margin: 0, fontSize: 13.5 }}>On the phone, choose <strong>Pair device with pairing code</strong>. Enter the address, port and code from that dialog. Its port differs from the connection port.</p>
              <div style={{ flex: '2 1 160px' }}>
                <label htmlFor="ip" className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Pairing address and port</label>
                <input id="ip" className="field" placeholder="192.168.1.42:37115" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 110px' }}>
                <label htmlFor="code" className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Code</label>
                <input id="code" className="field" placeholder="482913" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <button className="btn" style={{ flex: '1 1 100%', height: 42 }} disabled={busy || !address || !code}>{busy ? <><Spinner />Pairing…</> : 'Pair and connect'}</button>
              {manualError && <div style={{ color: 'var(--bad)', fontSize: 13.5 }}>{manualError}</div>}
            </form>
          </details>

          <details className="card" style={{ marginTop: 14 }} open={pair.state === 'paired' || undefined}>
            <summary style={{ cursor: 'pointer', padding: '16px 20px', fontWeight: 700 }}>Already paired? Connect by address</summary>
            <form onSubmit={connectPaired} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '0 20px 20px' }}>
              <p className="mute" style={{ margin: 0, fontSize: 13.5 }}>Use the IP address and port on the main <strong>Wireless debugging</strong> screen, outside the pairing dialog. No pairing code is needed.</p>
              <label htmlFor="connect-address" className="eyebrow">Connection address and port</label>
              <input id="connect-address" className="field" style={{ width: '100%' }} placeholder="192.168.1.42:39703" value={connectAddress} onChange={(e) => setConnectAddress(e.target.value)} required />
              <button className="btn" style={{ width: '100%' }} disabled={connectBusy || !connectAddress.trim()}>{connectBusy ? <><Spinner /> Connecting...</> : 'Connect paired phone'}</button>
              {connectError && <div role="alert" style={{ color: 'var(--bad)', fontSize: 13.5 }}>{connectError}</div>}
            </form>
          </details>
        </section>

        <section className="rise" style={{ flex: '0 1 400px', minWidth: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, animationDelay: '.1s' }}>
          <div className="handheld">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span className="px" style={{ fontSize: 14, letterSpacing: '.12em', color: 'var(--mute)' }}>PLAYLENS · PAIR</span>
              <span className={`dot ${failed ? 'bad' : pair.state === 'connected' ? 'ok' : 'warn'}`} style={{ borderRadius: 2 }} />
            </div>
            <div className="qrscreen" aria-label="Pairing QR code" role="img">
              {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div style={{ aspectRatio: '1', display: 'grid', placeItems: 'center' }} className="dim">Making a code…</div>}
              {pair.state === 'waiting' && svg && <div className="sweep"><i /></div>}
              {pair.state === 'connected' && (
                <div className="qrdone">
                  <svg width="72" height="72" viewBox="0 0 76 76" fill="none" aria-hidden="true"><rect x="6" y="6" width="64" height="64" rx="14" stroke="#9ED9C9" strokeWidth="3" opacity=".4" /><path d="M24 39l10 10 19-21" stroke="#9ED9C9" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="60" style={{ animation: 'draw .5s .15s ease-out forwards' }} /></svg>
                  <span className="px" style={{ fontSize: 16, letterSpacing: '.08em' }}>CONNECTED</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }} aria-hidden="true">
              <svg width="52" height="52" viewBox="0 0 13 13" shapeRendering="crispEdges"><rect x="4" y="0" width="5" height="13" fill="#1A1512" /><rect x="0" y="4" width="13" height="5" fill="#1A1512" /></svg>
              <div style={{ display: 'flex', gap: 12, transform: 'rotate(-20deg)' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#F6A57A' }} />
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#C9705A', marginTop: 12 }} />
              </div>
            </div>
          </div>
          <div style={{ fontSize: 15.5, textAlign: 'center', color: failed ? 'var(--bad)' : 'var(--text)', maxWidth: 380 }}>{caption}</div>
          {failed && <button className="btn" onClick={() => api('pair/qr', { method: 'POST' })}>Try again with a new code</button>}
          {pair.state === 'connected' && <button className="btn btn-warm" onClick={() => setView('home')}>Back home</button>}
          <div className="dim" style={{ fontSize: 13.5, textAlign: 'center', maxWidth: 340, lineHeight: 1.55 }}>Phone and computer need the same Wi-Fi. Office networks sometimes block this; a phone hotspot works.</div>
        </section>
      </div>
      </>}
    </div>
  );
}
