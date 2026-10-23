import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { useAppContainer } from './context';
import { cx } from './cx';
import { Icon } from './icons';
import { Button } from './primitives';

/* ───────── Inspector drawer ───────── */

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shown as a back arrow when one drawer leads to another. */
  onBack?: () => void;
  /** Extra controls in the header, e.g. previous / next neighbour. */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

/** Opens from the right over the page (bottom sheet on phones). Esc closes. */
export function Drawer({ open, onClose, title, subtitle, onBack, headerExtra, footer, children }: DrawerProps): ReactElement {
  const reduce = useReducedMotion();
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div key="bg" className="drawer-bg" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />
          <motion.aside
            key="panel"
            ref={ref}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{ animation: 'none' }}
            initial={reduce ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="dh">
              {onBack ? <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="back" /></button> : null}
              <div className="sp1">
                <h2 id={titleId}>{title}</h2>
                {subtitle ? <span className="sub">{subtitle}</span> : null}
              </div>
              {headerExtra}
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="db">{children}</div>
            {footer ? <div className="df">{footer}</div> : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ───────── Dialogs ───────── */

type DialogShellProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode };

/** Radix dialog (focus trap, aria, Esc) rendered inside the app frame with our classes. */
export function DialogShell({ open, onOpenChange, title, children }: DialogShellProps): ReactElement {
  const container = useAppContainer();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container ?? undefined}>
        <RadixDialog.Overlay className="dlg-bg" />
        <RadixDialog.Content className="dlg" aria-describedby={undefined}>
          <RadixDialog.Title asChild><h2>{title}</h2></RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** True when the typed text confirms the name (trimmed, case-insensitive). */
export function confirmsName(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase();
}

/**
 * Permanent actions: lists exactly what is lost and keeps the confirm button disabled
 * until the person types the name. Reversible actions should use Undo in a toast instead.
 */
export function ConfirmDelete({ open, onClose, onConfirm, name, title, consequences, confirmLabel = 'Delete everything', busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; name: string; title: string; consequences: string[]; confirmLabel?: string; busy?: boolean;
}): ReactElement {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const inputId = useId();
  return (
    <DialogShell open={open} onOpenChange={(o) => { if (!o) onClose(); }} title={title}>
      <p className="muted" style={{ fontSize: 13.5 }}>This can’t be undone. It removes:</p>
      <ul>{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="fld">
        <label htmlFor={inputId}>Type <b className="mono">{name}</b> to confirm</label>
        <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={!confirmsName(typed, name)} loading={busy} loadingLabel="Deleting…" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </DialogShell>
  );
}

export type Shortcut = { keys: string[]; label: string };
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], label: 'Search and jump anywhere' },
  { keys: ['Ctrl', 'J'], label: 'Open or close NutBot' },
  { keys: ['Ctrl', '/'], label: 'This list' },
  { keys: ['Esc'], label: 'Close the top panel, menu or dialog' },
  { keys: ['↑', '↓', 'Enter'], label: 'Move and open in lists and search' },
  { keys: ['Enter'], label: 'Inspect the focused table row' },
];

export function ShortcutsDialog({ open, onClose, shortcuts = DEFAULT_SHORTCUTS }: { open: boolean; onClose: () => void; shortcuts?: Shortcut[] }): ReactElement {
  return (
    <DialogShell open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="Keyboard shortcuts">
      <div className="keys">
        {shortcuts.map((s) => (
          <ShortcutRow key={s.label} s={s} />
        ))}
      </div>
      <p className="hint">On a Mac, Cmd works wherever Ctrl is shown. No single-letter shortcuts, so typing never triggers anything.</p>
      <div className="row-wrap" style={{ justifyContent: 'flex-end' }}><Button onClick={onClose}>Close</Button></div>
    </DialogShell>
  );
}

function ShortcutRow({ s }: { s: Shortcut }): ReactElement {
  return (
    <>
      <span>{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
      <span>{s.label}</span>
    </>
  );
}

/* ───────── Definition tooltip ───────── */

/** A label with a dotted underline that explains how a number is counted. */
export function Definition({ term, children, source }: { term: string; children: ReactNode; source?: string }): ReactElement {
  return (
    <RadixTooltip.Provider delayDuration={150}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <span className="def" tabIndex={0}>{term}</span>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="tip" sideOffset={8} style={{ position: 'static' }}>
            <b>{term}</b>
            {children}
            {source ? <small>{source}</small> : null}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

/* ───────── Popover (pickers) ───────── */

/**
 * Opens under its anchor inside the app frame (so on a phone the CSS turns it into a bottom sheet).
 * Esc or an outside click closes it.
 */
export function Popover({ open, onClose, anchor, width = 260, className, children }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; width?: number; className?: string; children: ReactNode }): ReactElement | null {
  const app = useAppContainer();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!open || !anchor.current) return;
    const a = anchor.current.getBoundingClientRect();
    const frame = (app ?? document.body).getBoundingClientRect();
    setPos({ x: Math.max(10, Math.min(a.left - frame.left, frame.width - width - 10)), y: a.bottom - frame.top + 6 });
  }, [open, anchor, app, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <>
      <div className="pop-bg" aria-hidden="true" />
      <div ref={ref} className={cx('pop', className)} role="dialog" style={{ ['--x' as string]: `${pos.x}px`, ['--y' as string]: `${pos.y}px`, ['--w' as string]: `${width}px` }}>
        {children}
      </div>
    </>
  );
}

/* ───────── Pickers ───────── */

export type PickerOption<T extends string = string> = { value: T; label: string; count?: number; hint?: string };
export type PickerGroup<T extends string = string> = { label: string; options: PickerOption<T>[] };

/** Multi-select list: categories with a thin rule, checkbox left, count right, a pinned toggle on top. */
export function MultiSelect({ groups, value, onChange, pinned, onClear, onDone }: {
  groups: PickerGroup[];
  value: Record<string, string[]>;
  onChange: (group: string, values: string[]) => void;
  pinned?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  onClear?: () => void;
  onDone?: () => void;
}): ReactElement {
  return (
    <>
      <div className="pop-scroll">
        {pinned ? (
          <button type="button" className="opt top" role="menuitemcheckbox" aria-checked={pinned.checked} onClick={() => pinned.onChange(!pinned.checked)}>
            <span className="cb"><Icon name="check" /></span>
            <span className="ot">{pinned.label}</span>
          </button>
        ) : null}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="pop-grp"><span className="eyebrow">{g.label}</span></div>
            {g.options.map((o) => {
              const on = (value[g.label] ?? []).includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className="opt"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => onChange(g.label, on ? (value[g.label] ?? []).filter((v) => v !== o.value) : [...(value[g.label] ?? []), o.value])}
                >
                  <span className="cb"><Icon name="check" /></span>
                  <span className="ot">{o.label}</span>
                  {o.count != null ? <span className="oc">{o.count.toLocaleString('en-US')}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {onClear || onDone ? (
        <div className="pop-foot">
          {onClear ? <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button> : <span />}
          {onDone ? <Button size="sm" onClick={onDone}>Done</Button> : null}
        </div>
      ) : null}
    </>
  );
}

/** Single-select list: same rows without checkboxes; a tick marks the current option; picking applies. */
export function SingleSelect<T extends string>({ options, value, onChange }: { options: PickerOption<T>[]; value: T; onChange: (v: T) => void }): ReactElement {
  return (
    <div className="pop-scroll">
      {options.map((o) => (
        <button key={o.value} type="button" className="opt" role="menuitemradio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          <span className="tick"><Icon name="check" /></span>
          <span className="ot">{o.label}</span>
          {o.hint ? <span className="oc">{o.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ───────── Date range ───────── */

export type DateRange = { start: Date; end: Date };
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a?: Date | null, b?: Date | null): boolean => !!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime();

/** Two taps pick a range: the first sets the start, the second the end (swapped if earlier). Returns the next state. */
export function pickDay(state: { start: Date | null; end: Date | null }, day: Date): { start: Date | null; end: Date | null; complete: boolean } {
  const d = startOfDay(day);
  if (!state.start || state.end) return { start: d, end: null, complete: false };
  return d < state.start ? { start: d, end: state.start, complete: true } : { start: state.start, end: d, complete: true };
}

/** The 42 days shown for a month, Monday first, including the neighbouring months' days. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

export function Calendar({ value, onChange, today = new Date() }: { value: DateRange | null; onChange: (r: DateRange) => void; today?: Date }): ReactElement {
  const base = value?.end ?? today;
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const [draft, setDraft] = useState<{ start: Date | null; end: Date | null }>({ start: value?.start ?? null, end: value?.end ?? null });
  const grid = monthGrid(view.y, view.m);
  const title = `${new Date(view.y, view.m, 1).toLocaleString('en-US', { month: 'long' }).toUpperCase()} ${view.y}`;
  const nav = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <div className="cal">
      <div className="cal-h">
        <button type="button" aria-label="Previous month" onClick={() => nav(-1)}><Icon name="caret" style={{ transform: 'rotate(90deg)' }} /></button>
        <b>{title}</b>
        <button type="button" aria-label="Next month" onClick={() => nav(1)}><Icon name="caret" style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
      <div className="cal-w">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-g">
        {grid.map((d) => {
          const inRange = draft.start && draft.end && d >= draft.start && d <= draft.end;
          const isStart = sameDay(d, draft.start);
          const isEnd = sameDay(d, draft.end) || (isStart && !draft.end);
          return (
            <button
              key={d.getTime()}
              type="button"
              className={cx('day', d.getMonth() !== view.m && 'out', inRange && 'in', isStart && 'start', isEnd && 'end', sameDay(d, today) && 'today')}
              aria-label={d.toDateString()}
              aria-pressed={isStart || isEnd}
              onClick={() => {
                const next = pickDay(draft, d);
                setDraft({ start: next.start, end: next.end });
                if (next.complete && next.start && next.end) onChange({ start: next.start, end: next.end });
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="cal-f">{draft.start && !draft.end ? 'Now pick the end date' : 'Pick a start date, then an end date'}</div>
    </div>
  );
}
