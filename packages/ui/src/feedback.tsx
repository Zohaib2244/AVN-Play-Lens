import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cx, relativeTime } from './cx';
import { Icon, type IconName } from './icons';
import { Button } from './primitives';

/* ───────── Loading ───────── */

export function Skeleton({ width = '100%', height = 12, style }: { width?: CSSProperties['width']; height?: CSSProperties['height']; style?: CSSProperties }): ReactElement {
  return <span className="sk" aria-hidden="true" style={{ width, height, ...style }} />;
}

/** Skeleton with the same shape as a row of KPI cards plus a panel, for first loads. */
export function PageSkeleton({ kpis = 4, rows = 5 }: { kpis?: number; rows?: number }): ReactElement {
  return (
    <>
      <div className="kpis">
        {Array.from({ length: kpis }, (_, i) => (
          <div className="kpi" key={i}>
            <Skeleton width="60%" height={10} />
            <Skeleton width="45%" height={26} style={{ margin: '14px 0 10px' }} />
            <Skeleton width="80%" height={10} />
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="pb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} width={`${100 - ((i * 7) % 14)}%`} />)}
        </div>
      </div>
    </>
  );
}

/**
 * The status line shown while something loads for more than a second:
 * spinner, what is happening, elapsed seconds. After `slowAfter` seconds it says so and offers Retry.
 */
export function LoadBar({ text, slowAfter = 10, onRetry }: { text: string; slowAfter?: number; onRetry?: () => void }): ReactElement {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, []);
  const slow = elapsed >= slowAfter;
  return (
    <div className="loadbar" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="lb-t">{slow ? 'This is taking longer than usual.' : text}</span>
      <span className="lb-s mono">{elapsed} s</span>
      {slow && onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

/* ───────── Errors ───────── */

export function ErrorPanel({ title, message, onRetry, onBack, backLabel = 'Back', details }: { title: string; message: ReactNode; onRetry?: () => void; onBack?: () => void; backLabel?: string; details?: string }): ReactElement {
  return (
    <div className="errp" role="alert">
      <span className="errp-i"><Icon name="alert" /></span>
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="row-wrap" style={{ justifyContent: 'center' }}>
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
        {onBack ? <Button variant="ghost" onClick={onBack}>{backLabel}</Button> : null}
      </div>
      {details ? (
        <details className="errd">
          <summary>Technical details</summary>
          <code>{details}</code>
        </details>
      ) : null}
    </div>
  );
}

export function Banner({ icon = 'alert', children, busy }: { icon?: IconName; children: ReactNode; busy?: boolean }): ReactElement {
  return (
    <div className="banner" role="status">
      <Icon name={icon} />
      <span>{children}</span>
      {busy ? <span className="spinner sm" aria-hidden="true" /> : null}
    </div>
  );
}

/** "Updated 2 min ago" with a refresh icon; spins while refreshing. */
export function Freshness({ updatedAt, refreshing, onRefresh }: { updatedAt: number; refreshing?: boolean; onRefresh?: () => void }): ReactElement {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);
  return (
    <button type="button" className={cx('fresh', refreshing && 'spinning')} onClick={onRefresh} title="Refresh this panel" disabled={refreshing}>
      <Icon name="refresh" />
      <span>Updated {relativeTime(updatedAt)}</span>
    </button>
  );
}

/* ───────── Toasts and notifications ───────── */

export type ToastKind = 'ok' | 'info' | 'warn' | 'bad';
export type ToastInput = { kind?: ToastKind; title: string; message?: ReactNode; action?: { label: string; onClick?: () => void } };
export type Notification = { id: number; kind: ToastKind; title: string; message: ReactNode; at: number; read: boolean };

type Live = { id: number; key: string; count: number; kind: ToastKind; title: string; message?: ReactNode; action?: ToastInput['action'] };

/** How long each kind stays: errors stay until dismissed. */
export const TOAST_MS: Record<ToastKind, number> = { ok: 5000, info: 5000, warn: 8000, bad: 0 };
export const MAX_TOASTS = 4;
const ICON: Record<ToastKind, IconName> = { ok: 'check', info: 'info', warn: 'alert', bad: 'alert' };

type ToastApi = {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
  notifications: Notification[];
  unread: number;
  markAllRead: () => void;
  clearNotifications: () => void;
};
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Pure stacking rules, exported so they can be tested: dedupe, cap at 4, drop the oldest non-error. */
export function stackToast(list: Live[], incoming: Omit<Live, 'id' | 'count' | 'key'>, nextId: number): { list: Live[]; id: number; deduped: boolean } {
  const key = `${incoming.kind}|${incoming.title}|${typeof incoming.message === 'string' ? incoming.message : ''}`;
  const dup = list.find((t) => t.key === key);
  if (dup) return { list: list.map((t) => (t.id === dup.id ? { ...t, count: t.count + 1 } : t)), id: dup.id, deduped: true };
  const next = [...list, { ...incoming, id: nextId, count: 1, key }];
  while (next.length > MAX_TOASTS) {
    const victim = next.find((t) => t.kind !== 'bad' && t.id !== nextId) ?? next[0]!;
    next.splice(next.indexOf(victim), 1);
  }
  return { list: next, id: nextId, deduped: false };
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [list, setList] = useState<Live[]>([]);
  const [notes, setNotes] = useState<Notification[]>([]);
  const idRef = useRef(0);
  const noteRef = useRef(0);

  const dismiss = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const kind = t.kind ?? 'info';
    const id = ++idRef.current;
    let usedId = id;
    setList((l) => {
      const r = stackToast(l, { kind, title: t.title, message: t.message, action: t.action }, id);
      usedId = r.id;
      return r.list;
    });
    setNotes((n) => [{ id: ++noteRef.current, kind, title: t.title, message: t.message ?? '', at: Date.now(), read: false }, ...n].slice(0, 50));
    return usedId;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    toast,
    dismiss,
    notifications: notes,
    unread: notes.filter((n) => !n.read).length,
    markAllRead: () => setNotes((n) => n.map((x) => ({ ...x, read: true }))),
    clearNotifications: () => setNotes([]),
  }), [toast, dismiss, notes]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost list={list} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost({ list, onDismiss }: { list: Live[]; onDismiss: (id: number) => void }): ReactElement {
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {list.map((t) => <ToastItem key={t.id} t={t} onDismiss={onDismiss} />)}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ t, onDismiss }: { t: Live; onDismiss: (id: number) => void }): ReactElement {
  const reduce = useReducedMotion();
  const ms = TOAST_MS[t.kind];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(ms);
  const started = useRef(Date.now());

  // Restart the timer when a duplicate arrives (count changes).
  useEffect(() => { remaining.current = ms; started.current = Date.now(); }, [t.count, ms]);

  useEffect(() => {
    if (!ms || paused) return;
    started.current = Date.now();
    const id = setTimeout(() => onDismiss(t.id), Math.max(700, remaining.current));
    return () => {
      clearTimeout(id);
      remaining.current -= Date.now() - started.current;
    };
  }, [ms, paused, t.id, t.count, onDismiss]);

  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className={cx('toast', t.kind)}
      role={t.kind === 'bad' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="t-i"><Icon name={ICON[t.kind]} /></span>
      <div className="t-b">
        <b>
          {t.title}
          {t.count > 1 ? <span className="t-n">×{t.count}</span> : null}
        </b>
        {t.message ? <span className="m">{t.message}</span> : null}
        {t.action ? (
          <button type="button" className="t-a" onClick={() => { t.action?.onClick?.(); onDismiss(t.id); }}>{t.action.label}</button>
        ) : null}
      </div>
      <button type="button" className="t-x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><Icon name="x" /></button>
      {ms ? (
        <i
          key={t.count}
          className="t-bar"
          style={{ animation: `barrun ${ms}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      ) : null}
    </motion.div>
  );
}

/** The bell: unread count, and a list of everything that was ever toasted (last 50). */
export function NotificationList({ onClose }: { onClose?: () => void }): ReactElement {
  const { notifications, clearNotifications } = useToast();
  return (
    <>
      <div className="pop-head">
        <b>Notifications</b>
        {notifications.length ? <Button size="sm" variant="ghost" onClick={clearNotifications}>Clear all</Button> : onClose ? <Button size="sm" variant="ghost" onClick={onClose}>Close</Button> : null}
      </div>
      <div className="pop-scroll" style={{ paddingTop: 0 }}>
        {notifications.length ? (
          notifications.map((n) => (
            <div key={n.id} className={cx('note-i', n.kind, !n.read && 'new')}>
              <span className="t-i"><Icon name={ICON[n.kind]} /></span>
              <div>
                <b>{n.title}</b>
                {n.message ? <span>{n.message}</span> : null}
                <time>{relativeTime(n.at)}</time>
              </div>
            </div>
          ))
        ) : (
          <div className="cmdk-empty">Nothing yet. Results of exports, saves and errors land here, so a toast you missed is never lost.</div>
        )}
      </div>
    </>
  );
}

export const BellButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(function BellButton({ onClick }, ref) {
  const { unread } = useToast();
  return (
    <button ref={ref} type="button" className="icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications" onClick={onClick}>
      <Icon name="bell" />
      {unread ? <span className="bell-n">{unread > 9 ? '9+' : unread}</span> : null}
    </button>
  );
});

export function StatusLine({ children }: { children: ReactNode }): ReactElement {
  return <span className="inline-st">{children}</span>;
}
