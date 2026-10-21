// Small UI building blocks for keeping pages calm:
//   Skeleton / SkeletonRows / SkeletonLog   data is on its way (from the phone or the server)
//   Lattice (bits.jsx)                      waiting for you or the phone to do something
//   LiveBars                                something is running live (stream, sampling)
//   Spinner / ActionButton                  an action you clicked is in progress
//   Disclosure                              details tucked away, remembered per section
//   Menu                                    less-used actions behind a "More" button
import { useEffect, useRef, useState } from 'react';

export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="kv"><Skeleton w={`${28 + ((i * 17) % 22)}%`} /><Skeleton w={`${22 + ((i * 29) % 30)}%`} /></div>
      ))}
    </div>
  );
}

export function SkeletonLog({ rows = 9 }) {
  return (
    <div aria-busy="true" aria-label="Waiting for the first lines">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ cursor: 'default', opacity: 1 - i * 0.08 }}>
          <Skeleton w={78} h={12} /><Skeleton w={44} h={12} /><Skeleton w={`${45 + ((i * 23) % 45)}%`} h={12} /><Skeleton w={90} h={12} style={{ justifySelf: 'end' }} />
        </div>
      ))}
    </div>
  );
}

export function LiveBars({ label, paused = false }) {
  return (
    <span className={`live${paused ? ' paused' : ''}`}>
      <span className="bars" aria-hidden="true"><i /><i /><i /></span>
      {label}
    </span>
  );
}

export function Spinner({ size = 14 }) {
  return <span className="spin" style={{ width: size, height: size }} aria-hidden="true"><i /><i /><i /><i /></span>;
}

// A button for actions that take a moment: shows a spinner and ignores clicks until done.
export function ActionButton({ onClick, children, className = 'btn', busyLabel, ...rest }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async (e) => {
    if (busy) return;
    setBusy(true);
    try { await onClick?.(e); } finally { if (alive.current) setBusy(false); }
  };
  return (
    <button className={className} onClick={run} aria-busy={busy} disabled={busy || rest.disabled} {...rest}>
      {busy ? <><Spinner />{busyLabel ?? children}</> : children}
    </button>
  );
}

function remembered(id, fallback) {
  try { const v = localStorage.getItem(`playlens.open.${id}`); return v == null ? fallback : v === '1'; } catch { return fallback; }
}

// A collapsed section: title, a one-line hint of what's inside, and the content on demand.
export function Disclosure({ id, title, hint, children, defaultOpen = false, tone }) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(`playlens.open.${id}`, open ? '0' : '1'); } catch { /* private window */ }
  };
  return (
    <section className={`disc${open ? ' open' : ''}`}>
      <button className="dhead" onClick={toggle} aria-expanded={open}>
        <svg className="dcar" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <span className="dtitle">{title}</span>
        {hint && <span className={`dhint ${tone ?? ''}`}>{hint}</span>}
      </button>
      {open && <div className="dbody">{children}</div>}
    </section>
  );
}

// "More" menu: items are { label, onClick, href, download, pressed, hidden, danger }.
export function Menu({ items, label = 'More' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const shown = items.filter((i) => i && !i.hidden);
  if (!shown.length) return null;
  return (
    <span className="menu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={label} title={label}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="10" width="4" height="4" rx="1" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="17" y="10" width="4" height="4" rx="1" /></svg>
      </button>
      {open && (
        <span className="mlist" role="menu">
          {shown.map((i) => {
            const body = <>{i.pressed != null && <span className={`mchk${i.pressed ? ' on' : ''}`} />}{i.label}</>;
            return i.href
              ? <a key={i.label} role="menuitem" className="mitem" href={i.href} download={i.download} target={i.download ? undefined : '_blank'} rel="noreferrer" onClick={() => setOpen(false)}>{body}</a>
              : <button key={i.label} role="menuitem" className={`mitem${i.danger ? ' danger' : ''}`} onClick={() => { setOpen(false); i.onClick?.(); }}>{body}</button>;
          })}
        </span>
      )}
    </span>
  );
}
