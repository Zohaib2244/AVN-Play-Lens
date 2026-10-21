// Small shared pieces: logo, icons, rail navigation.
import { useApp, deviceName, viewStatus } from '../state.jsx';
import { GamePicker } from './GamePicker.jsx';

export function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="1" width="5" height="1" fill="#F6A57A" /><rect x="1" y="2" width="1" height="5" fill="#F6A57A" />
      <rect x="7" y="2" width="1" height="5" fill="#F6A57A" /><rect x="2" y="7" width="5" height="1" fill="#F6A57A" />
      <rect x="3" y="3" width="2" height="2" fill="#F1E7D6" /><rect x="7" y="7" width="1" height="1" fill="#F6A57A" />
      <rect x="8" y="8" width="1" height="1" fill="#F6A57A" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Icon = {
  qr: (p) => <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth="2.2" aria-hidden="true" {...p}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18v2" /></svg>,
  arrow: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2.2" aria-hidden="true" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  back: (p) => <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth="2.4" aria-hidden="true" {...p}><path d="M15 6l-6 6 6 6" /></svg>,
  search: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A8B76" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  pause: (p) => <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth="2.6" aria-hidden="true" {...p}><path d="M8 5v14M16 5v14" /></svg>,
  stop: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>,
  play: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}><path d="M7 4l13 8-13 8z" /></svg>,
  plus: (p) => <svg width="26" height="26" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M12 5v14M5 12h14" /></svg>,
  bell: (p) => <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8M10 21h4" /><path className="off" d="M4 4l16 16" /></svg>,
  home: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M4 11l8-7 8 7M6 9.5V20h4.5v-5.5h3V20H18V9.5" /></svg>,
  logs: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7.5 10l3 2-3 2M13 14.5h3.5" /></svg>,
  pulse: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M3 12h4l2.5-6.5L14 18l2.5-6H21" /></svg>,
  shield: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M12 3l7.5 3v5.5c0 4.4-3 7.7-7.5 9.5-4.5-1.8-7.5-5.1-7.5-9.5V6z" /><path d="M8.7 12l2.3 2.3 4.3-4.6" /></svg>,
  flame: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M12 3c.6 3.2 5.5 5.2 5.5 10.2A5.5 5.5 0 0 1 12 18.7a5.5 5.5 0 0 1-5.5-5.5c0-2 .9-3.4 2.1-4.4.1 1.6.8 2.6 1.9 3C10.2 8.5 10.6 5.4 12 3z" /></svg>,
  clipboard: (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth="2" aria-hidden="true" {...p}><path d="M8.5 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5h-2" /><rect x="8.5" y="3" width="7" height="4" rx="1.2" /><path d="M9 13l2 2 4-4.2" /></svg>,
  restart: (p) => <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth="2.4" aria-hidden="true" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>,
};

export function Toast() {
  const { toast, setToast } = useApp();
  if (!toast) return null;
  const color = toast.severity === 'critical' ? 'var(--bad)' : 'var(--warm-text)';
  return (
    <div className="toast" role="status">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="eyebrow" style={{ color }}>{toast.severity === 'critical' ? 'Needs attention' : 'Heads up'}</span>
        <span style={{ flex: '1 1 0' }} />
        <button onClick={() => setToast(null)} style={{ border: 0, background: 'transparent', color: 'var(--mute)', cursor: 'pointer', fontSize: 13 }}>Dismiss</button>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{toast.title}</div>
      {toast.msg && <div className="mono mute" style={{ fontSize: 12.5, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.msg}</div>}
    </div>
  );
}

// Every view is its own place, not a step in a sequence, so each gets its own icon tile and
// the views that look inside a game sit under their own heading.
const NAV = [
  { id: 'home', title: 'Home', short: 'Home', icon: 'home', sub: () => ({ text: 'Devices and Unity' }) },
  { id: 'logs', title: 'Logs', short: 'Logs', icon: 'logs', group: 'Look inside the game', sub: (st, ctx) => (ctx.stopped ? { text: 'Stopped', cls: 'warm' } : { text: 'Live' }) },
  { id: 'performance', title: 'Performance', short: 'Perf', icon: 'pulse', needsGame: true, sub: (st) => st.performance },
  { id: 'health', title: 'Plugin health', short: 'Health', icon: 'shield', needsGame: true, sub: (st) => st.health },
  { id: 'firebase', title: 'Firebase events', short: 'Firebase', icon: 'flame', needsGame: true, sub: (st) => st.firebase, go: (st) => (st.firebase.ready ? 'firebase' : 'firebase-setup'), also: ['firebase-setup'] },
  { id: 'checklist', title: 'Checklist', short: 'Checklist', icon: 'clipboard', needsGame: true, sub: (st) => st.checklist, go: (st) => (st.checklist.ready ? 'checklist' : 'checklist-setup'), also: ['checklist-setup'] },
];

export function Rail() {
  const { view, setView, device, online, monitor, pkg, stopped, perfSummary } = useApp();
  const st = viewStatus(monitor, perfSummary);
  return (
    <aside className="rail-col">
      <button className="wordmark" onClick={() => setView('home')} aria-label="AVN PlayLens home">
        <Logo />
        <span className="px wm-text">AVN PlayLens</span>
      </button>
      <nav aria-label="Views" className="rail-nav">
        {NAV.map((v) => {
          const sub = v.sub(st, { stopped });
          const active = view === v.id || v.also?.includes(view);
          const locked = v.needsGame && !pkg;
          const Ico = Icon[v.icon];
          return (
            <div key={v.id} className="nav-slot">
              {v.group && <span className="nav-group eyebrow">{v.group}</span>}
              <button className={`nav-item${active ? ' act' : ''}`} disabled={locked} onClick={() => setView(v.go?.(st) ?? v.id)} aria-current={active ? 'page' : undefined}>
                <span className="nav-ico">
                  <Ico />
                  {!locked && sub.cls && <span className={`nav-pip ${sub.cls}`} />}
                </span>
                <span className="nav-text">
                  <span className="t">{v.title}</span>
                  <span className="t-short">{v.short}</span>
                  <span className={`s ${locked ? '' : sub.cls ?? ''}`}>{locked ? 'Pick a game first' : sub.text}</span>
                </span>
              </button>
            </div>
          );
        })}
      </nav>
      <div className="card rail-foot">
        {device ? (
          <>
            <div className="rf-top">
              <span className="dot ok pulse" />
              <span className="rf-name">{deviceName(device)}</span>
              <span className="tag tag-plain rf-tag">{device.transport === 'wifi' ? 'Wi-Fi' : device.transport}</span>
            </div>
            {online ? <GamePicker className="select rf-pick" /> : <div className="mono dim rf-sub">reconnecting to PlayLens…</div>}
          </>
        ) : (
          <div className="dim" style={{ fontSize: 13.5 }}>{online ? 'No phone connected' : 'Starting…'}</div>
        )}
      </div>
    </aside>
  );
}

// Page header used by every inside view.
export function PageHead({ title, sub, children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 16px' }}>
      <div style={{ flex: '1 1 auto' }}>
        <h1 className="page-title">{title}</h1>
        {sub && <div className="dim" style={{ fontSize: 14, marginTop: 8 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function Check({ size = 14, color = '#16120F' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Lattice() {
  return <span className="lattice" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>;
}
