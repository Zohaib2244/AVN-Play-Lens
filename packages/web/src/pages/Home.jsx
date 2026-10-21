import { useEffect, useState } from 'react';
import { useApp, deviceName, stateHint, viewStatus } from '../state.jsx';
import { api } from '../api.js';
import { Logo, Icon } from '../components/bits.jsx';
import { PixelScene } from '../components/PixelScene.jsx';
import { GamePicker } from '../components/GamePicker.jsx';
import { useProfile, DeviceRows } from '../components/DeviceProfile.jsx';
import { Skeleton, SkeletonRows } from '../components/ui.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function PhoneGlyph({ color = '#84C9B9' }) {
  return (
    <svg width="28" height="28" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="0" width="4" height="8" fill="#3A2F27" /><rect x="2.5" y="1" width="3" height="5" fill={color} /><rect x="3.5" y="6.8" width="1" height=".6" fill="#9A8B76" />
    </svg>
  );
}

function DeviceDetails({ serial }) {
  const { profile, error } = useProfile(serial, null);
  if (error) return <div className="dim" style={{ fontSize: 13.5 }}>Couldn't read the phone: {error}</div>;
  if (!profile) return <div style={{ fontSize: 13.5 }}><SkeletonRows rows={6} /></div>;
  return <div style={{ fontSize: 13.5 }}><DeviceRows d={profile.device} /></div>;
}

function DeviceCard({ d, onOpen }) {
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
          <span style={{ display: 'block', fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{deviceName(d)}</span>
          <span className="mono dim" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>{meta}</span>
        </span>
        <span className="tag tag-plain">{transport}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {hint ? (
          <span className="tag tag-warn" style={{ whiteSpace: 'normal', textTransform: 'none', letterSpacing: 0, fontSize: 12.5 }}>{hint}</span>
        ) : d.replay ? (
          <button className="btn btn-sm" onClick={onOpen}>Open its logs</button>
        ) : (
          <span className="tag tag-ok"><span className="dot ok" />Ready for Unity Build and Run</span>
        )}
        {!hint && <button className="linkish" style={{ marginLeft: 'auto' }} aria-expanded={details} onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Details'}</button>}
      </div>
      {details && <DeviceDetails serial={d.serial} />}
    </div>
  );
}

const TILES = [
  { id: 'logs', title: 'Logs', text: 'What your game prints, plus crashes and warnings. Live and searchable.' },
  { id: 'performance', title: 'Performance', text: 'FPS, frame times, CPU, GPU, memory and heat while you play, with graphs.' },
  { id: 'health', title: 'Plugin health', text: 'Is the AVN plugin OK? Startup, SDKs, ads from load to paid, remote config.' },
  { id: 'firebase', title: 'Firebase events', text: 'Every event Firebase logs on the phone, double-checked against the plugin.' },
  { id: 'checklist', title: 'Checklist', text: 'Tick off the events you expect, with the right parameters, during a test run.' },
];

function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function RecentSessions() {
  const { online, sessionId } = useApp();
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!online) return;
    api('sessions').then(setList).catch(() => {});
  }, [online, sessionId]);
  const done = list.filter((s) => !s.replay);
  if (!done.length) return null;
  return (
    <section className="rise" style={{ marginTop: 52, animationDelay: '.34s' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 className="px" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Recent sessions</h2>
        <span className="dim" style={{ fontSize: 13.5 }}>Saved logs, newest first</span>
      </div>
      <div style={{ borderBottom: '1px solid #2E2620' }}>
        {done.slice(0, 6).map((s) => {
          const mins = Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000));
          const tag = s.crashes ? ['tag-warm', `${s.crashes} crash${s.crashes > 1 ? 'es' : ''}`] : s.checklist ? ['tag-ok', s.checklist] : s.exceptions ? ['tag-warn', `${s.exceptions} exception${s.exceptions > 1 ? 's' : ''}`] : ['tag-plain', `${s.lines.toLocaleString()} lines`];
          return (
            <div key={s.id} className="srow">
              <span className="mono dim" style={{ fontSize: 13 }}>{when(s.startedAt)}</span>
              <span><span style={{ fontWeight: 700 }}>{s.pkg || 'All apps'}</span><span className="dim"> · {s.device}</span></span>
              <span className="mono mute" style={{ fontSize: 13 }}>{mins} min{s.perf?.fps != null ? ` · ${Math.round(s.perf.fps)} fps` : ''}</span>
              <span className={`tag ${tag[0]}`}>{tag[1]}</span>
              <a className="linkish" href={`/api/sessions/${s.id}.txt`} download>Save log</a>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Home() {
  const { status, devices, setView, selectDevice, online, monitor, pkg, serial, perfSummary, device, follow, stream, refreshApps } = useApp();
  const st = viewStatus(monitor, perfSummary);
  const phones = devices.filter((d) => !d.replay);
  const ready = phones.filter((d) => d.state === 'device');
  const replay = devices.find((d) => d.replay);
  const first = ready[0];

  const title = !online ? 'Starting up…'
    : ready.length ? 'Your devices are ready to build to.'
      : phones.length ? 'Almost there. Check your phone.'
        : 'Connect a phone to get started.';
  const sub = ready.length
    ? `${ready.map(deviceName).join(' and ')} ${ready.length > 1 ? 'are' : 'is'} connected. Unity's Build and Run can use ${ready.length > 1 ? 'them' : 'it'} right now. Open a view below only if you want to look inside the game.`
    : 'Plug in by USB, or pair over Wi-Fi with a QR code. Once connected, Unity\'s Build and Run sees the phone too, even if you close this tab.';

  const openLogs = (d) => {
    if (d.serial !== serial) selectDevice(d);
    setView('logs');
  };
  const openView = (id) => {
    if (!serial) return openLogs(first || replay);
    if (id === 'logs' || !pkg) return setView('logs');
    if (id === 'firebase') return setView(st.firebase.ready ? 'firebase' : 'firebase-setup');
    if (id === 'checklist') return setView(st.checklist.ready ? 'checklist' : 'checklist-setup');
    setView(id);
  };

  return (
    <div className="home">
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '24px 0 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={30} />
          <span className="px" style={{ fontSize: 22, fontWeight: 600 }}>AVN PlayLens</span>
        </div>
        <div style={{ flex: '1 1 0' }} />
        {status?.adb
          ? <span className="tag tag-ok"><span className="dot ok pulse" style={{ width: 7, height: 7 }} />adb {status.adbVersion || 'ready'}</span>
          : status && <span className="tag tag-bad">adb not found</span>}
      </header>

      {status && !status.adb && (
        <div className="card" style={{ padding: '18px 22px', borderColor: '#6B2E27', marginTop: 16 }}>
          <div className="px" style={{ fontSize: 20, color: 'var(--bad)' }}>adb wasn't found on this computer</div>
          <p className="mute" style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
            PlayLens uses the same adb as Unity. Install Unity's Android Build Support, or Android platform-tools, or set the
            <span className="mono"> PLAYLENS_ADB </span> environment variable to the adb file, then restart PlayLens.
            {status.replay ? ' The replay device below works without it.' : ' Start with --replay to try it with a saved log.'}
          </p>
        </div>
      )}

      <section className="hero">
        <div className="rise" style={{ flex: '1 1 440px', minWidth: 0 }}>
          <span className="eyebrow">{greeting()}</span>
          <h1 className="hero-title">{title}</h1>
          <p className="mute" style={{ margin: '0 0 30px', fontSize: 17, lineHeight: 1.65, maxWidth: 480 }}>{sub}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button className="btn btn-warm" style={{ height: 44 }} onClick={() => setView('connect')} disabled={!status?.adb}>
              <Icon.qr /> Connect a phone
            </button>
            {(first || replay) && <button className="btn" style={{ height: 44 }} onClick={() => openLogs(first || replay)}>Open logs</button>}
          </div>
        </div>
        <PixelScene ready={!!first} caption={first ? `${deviceName(first)} · ${first.transport === 'wifi' ? 'Wi-Fi' : 'USB'}${first.transport === 'wifi' ? ` · ${first.serial.split(':')[0]}` : ''}` : 'No phone yet'} />
      </section>

      <section className="rise" style={{ animationDelay: '.18s' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <h2 className="px" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Devices</h2>
          <span className="dim" style={{ fontSize: 13.5 }}>They stay connected when you close this tab</span>
        </div>
        <div className="grid-cards">
          {!online && !devices.length && [0, 1].map((i) => (
            <div key={i} className="card devcard" aria-busy="true" aria-label="Looking for devices">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Skeleton w={28} h={28} r={6} /><span style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton w="55%" h={15} /><Skeleton w="35%" h={11} /></span></div>
              <Skeleton w={180} h={22} r={8} />
            </div>
          ))}
          {devices.map((d) => <DeviceCard key={d.serial} d={d} onOpen={() => openLogs(d)} />)}
          <button className="addcard" onClick={() => setView('connect')} disabled={!status?.adb}>
            <Icon.plus />
            <span style={{ fontSize: 15, fontWeight: 700 }}>Connect with QR</span>
            <span className="dim" style={{ fontSize: 13 }}>Scan once, it reconnects next time</span>
          </button>
        </div>
      </section>

      <section className="rise" style={{ marginTop: 52, animationDelay: '.26s' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <h2 className="px" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Look inside the game</h2>
          <span className="dim" style={{ fontSize: 13.5 }}>Optional. Pick one view at a time</span>
        </div>
        <div className="card gamebar">
          <label htmlFor="home-game" className="eyebrow">Game</label>
          {device ? (
            <>
              <GamePicker id="home-game" />
              {pkg && !device.replay && <span className={`tag ${stream.running ? 'tag-ok' : 'tag-plain'}`}>{stream.running ? 'Running' : 'Not running'}</span>}
              {!device.replay && <button className="btn btn-sm" onClick={refreshApps} title="Look for newly installed games">Refresh</button>}
              <span className="dim" style={{ flex: '1 1 100%', fontSize: 13.5, lineHeight: 1.5 }}>
                {follow && !device.replay ? (pkg ? `Following the app open on your phone. Open another game and this switches to it.` : 'Open a game on your phone and it shows up here, or pick one from the list.') : 'Pinned to this game. Choose "Follow the open app" to switch automatically.'}
              </span>
            </>
          ) : <span className="dim" style={{ fontSize: 14 }}>Connect a phone to choose a game.</span>}
        </div>
        <div className="grid-cards tiles">
          {TILES.map((t) => {
            const live = st[t.id];
            const tag = t.id === 'logs' || (t.id === 'performance' && pkg && !live.cls) ? ['No setup', 'tag-ok'] : !pkg ? ['Pick a game first', 'tag-plain'] : live.ready === false ? [live.text, 'tag-warm'] : [live.text.split(' · ')[0], live.cls === 'warm' ? 'tag-warn' : live.cls === 'ok' ? 'tag-ok' : 'tag-plain'];
            return (
              <button key={t.id} className="card tile" onClick={() => openView(t.id)} disabled={!first && !replay}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: 8 }}>
                  <span className="px" style={{ fontSize: 24, fontWeight: 600 }}>{t.title}</span>
                  <span className={`tag ${tag[1]}`} style={{ textAlign: 'right' }}>{tag[0]}</span>
                </div>
                <span className="mute" style={{ fontSize: 15, lineHeight: 1.55 }}>{t.text}</span>
                <Icon.arrow className="go" />
              </button>
            );
          })}
        </div>
      </section>

      <RecentSessions />
    </div>
  );
}
