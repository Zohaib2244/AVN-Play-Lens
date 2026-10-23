import { useState, type ReactElement, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cx, fmt } from './cx';
import { Icon, type IconName } from './icons';
import { Button, Segmented, Tag, type StatusKind } from './primitives';

/* ───────── Games home ───────── */

export type GameSummary = { id: string; name: string; packageName: string; initials: string; android: number; ios: number; dauToday: number; dauYesterday: number; events: number; lastEvent: string; live: boolean };

export function GameCard({ game, onOpen }: { game: GameSummary; onOpen: (id: string) => void }): ReactElement {
  return (
    <button type="button" className="gcard" onClick={() => onOpen(game.id)}>
      <span className="gc-top">
        <span className="gc-ic">{game.initials}</span>
        <Tag kind={game.live ? 'ok' : 'plain'}>{game.live ? 'Live' : 'Quiet'}</Tag>
      </span>
      <span>
        <span className="gc-name">{game.name}</span>
        <span className="gc-id mono">{game.packageName}</span>
      </span>
      <span className="gc-pills">
        {game.android ? <span className="pill">Android · {fmt(game.android)}</span> : <span className="pill add">+ Android</span>}
        {game.ios ? <span className="pill">iOS · {fmt(game.ios)}</span> : <span className="pill add">+ iOS</span>}
      </span>
      <span className="gc-dau"><span className="px">{game.dauToday}</span><span><b>DAU today</b> · {game.dauYesterday} yesterday</span></span>
      <span className="gc-foot">
        <span>{fmt(game.events)} events</span>
        <span className="gc-last">Last event {game.lastEvent} <Icon name="arrow" /></span>
      </span>
    </button>
  );
}

export function GamesGrid({ games, onOpen, onRegister }: { games: GameSummary[]; onOpen: (id: string) => void; onRegister?: () => void }): ReactElement {
  return (
    <div className="games">
      {games.map((g) => <GameCard key={g.id} game={g} onOpen={onOpen} />)}
      {onRegister ? (
        <button type="button" className="gcard add" onClick={onRegister}>
          <span className="gc-addi">+</span>
          <b>Register a game</b>
          <span className="muted" style={{ fontSize: 12.5 }}>Get an API key and the Unity SDK</span>
        </button>
      ) : null}
    </div>
  );
}

/* ───────── Briefing overview ───────── */

export function InsightCard({ kind, headline, detail, action, onClick }: { kind: 'better' | 'worse'; headline: string; detail: string; action: string; onClick: () => void }): ReactElement {
  return (
    <button type="button" className="insight" onClick={onClick}>
      <Tag kind={kind === 'better' ? 'ok' : 'bad'} dot>{kind === 'better' ? 'Better' : 'Worse'}</Tag>
      <b>{headline}</b>
      <span className="s">{detail}</span>
      <span className="go">{action} <Icon name="arrow" /></span>
    </button>
  );
}

export const Insights = ({ children }: { children: ReactNode }): ReactElement => <div className="insights">{children}</div>;
export const Kpis = ({ children }: { children: ReactNode }): ReactElement => <div className="kpis">{children}</div>;
export const SectionLabel = ({ children }: { children: ReactNode }): ReactElement => <div className="strip-h"><span className="eyebrow">{children}</span></div>;

export function SectionTile({ icon, title, value, caption, visual, onOpen, pinned }: { icon: IconName; title: string; value: string; caption: string; visual?: ReactNode; onOpen: () => void; pinned?: boolean }): ReactElement {
  return (
    <button type="button" className={cx('tile', pinned && 'pinned')} onClick={onOpen}>
      <span className="th"><Icon name={icon} />{title}</span>
      <span className="tv">{value}</span>
      <span className="ts2">{caption}</span>
      {visual}
      <span className="go">Open {title.toLowerCase()} <Icon name="arrow" /></span>
    </button>
  );
}
export const Tiles = ({ children }: { children: ReactNode }): ReactElement => <div className="tiles">{children}</div>;

export function NeedsALook({ items }: { items: Array<{ kind: string; kind2?: StatusKind; title: string; detail: string; action: string; onAction: () => void }> }): ReactElement {
  return (
    <div className="panel">
      <div className="ph"><div><h2>Needs a look</h2></div><Tag kind={items.length ? 'warn' : 'ok'}>{items.length || 'All clear'}</Tag></div>
      {items.map((it, i) => (
        <div className="look" key={i}>
          <Tag kind={it.kind2 ?? 'warn'}>{it.kind}</Tag>
          <div><b>{it.title}</b><span className="s">{it.detail}</span></div>
          <Button size="sm" variant="ghost" onClick={it.onAction}>{it.action}</Button>
        </div>
      ))}
    </div>
  );
}

/* ───────── Setup checklist (Done → Verified) ───────── */

export type SetupStep = { id: string; title: string; detail: string; state: 'ok' | 'done' | 'wait' | 'todo'; action?: ReactNode };
const STEP_TAG: Record<SetupStep['state'], [StatusKind, string]> = { ok: ['ok', 'Verified'], done: ['done', 'Done · to confirm'], wait: ['info', 'Waiting'], todo: ['plain', 'To do'] };

/** Each step: status icon, title, one line, tag, one action. Collapsible; hide it once every step is verified. */
export function SetupChecklist({ title, steps, defaultOpen = true }: { title: string; steps: SetupStep[]; defaultOpen?: boolean }): ReactElement | null {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();
  const ok = steps.filter((s) => s.state === 'ok').length;
  if (ok === steps.length) return null;
  return (
    <div className="panel setup">
      <div className="ph">
        <div><h2>{title}</h2><p>{ok} of {steps.length} verified</p></div>
        <div className="row-wrap">
          <span className="sbar" aria-hidden="true">{steps.map((s) => <i key={s.id} className={s.state === 'todo' ? undefined : s.state} />)}</span>
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide steps' : 'Show steps'}</Button>
        </div>
      </div>
      <div className={cx('collapse', !open && 'shut')}>
        <div>
          {steps.map((s) => {
            const [kind, label] = STEP_TAG[s.state];
            return (
              <div className="srow" key={s.id}>
                <motion.span className={cx('sic', s.state)} initial={false} animate={reduce ? undefined : { scale: [0.6, 1] }} key={s.state} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                  {s.state === 'ok' || s.state === 'done' ? <Icon name="check" /> : null}
                </motion.span>
                <span><b>{s.title}</b><span className="s">{s.detail}</span></span>
                <span className="ra"><Tag kind={kind}>{label}</Tag>{s.action}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── Live monitor ───────── */

export function StatusStrip({ live, status, items, tag }: { live: boolean; status: string; items: ReactNode[]; tag?: ReactNode }): ReactElement {
  return (
    <div className="panel">
      <div className="status-strip">
        <div className="big">{live ? <span className="live" /> : null}{status}</div>
        {items.map((it, i) => <span className="muted" key={i}>{it}</span>)}
        {tag ? <span style={{ marginLeft: 'auto' }}>{tag}</span> : null}
      </div>
    </div>
  );
}

export type PipelineStep = { label: string; detail: string; state: 'ok' | 'done' | 'wait' };

/** Pipeline timeline: Verified steps are green, Done steps teal, the waiting step pulses. Packets move while live. */
export function Pipeline({ steps, live = true, onVerify }: { steps: PipelineStep[]; live?: boolean; onVerify?: (index: number) => void }): ReactElement {
  return (
    <div className="timeline" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
      {steps.map((s, i) => (
        <div key={s.label} className={cx('ts', s.state === 'wait' && 'wait', s.state === 'done' && 'done')} style={{ ['--i' as string]: i }}>
          <i>{s.state === 'wait' ? null : <Icon name="check" />}</i>
          <b>{s.label}</b>
          <span>{s.detail}</span>
          {s.state === 'done' && onVerify ? <Button size="sm" variant="ghost" className="chk" onClick={() => onVerify(i)}>Check now</Button> : null}
        </div>
      ))}
      {live ? <><span className="pkt" /><span className="pkt" style={{ animationDelay: '.8s' }} /><span className="pkt" style={{ animationDelay: '1.6s' }} /></> : null}
    </div>
  );
}

/* ───────── Filter bar ───────── */

export type FilterChip = { key: string; label: string; onRemove: () => void };

export function FilterBar({ range, dates, onRange, onDates, tz, onTz, extra, filterCount, onFilters, chips, note, density, onDensity }: {
  range: string; dates: string; onRange: (el: HTMLElement) => void; onDates: (el: HTMLElement) => void;
  tz: 'local' | 'utc'; onTz: (v: 'local' | 'utc') => void;
  extra?: ReactNode; filterCount: number; onFilters: (el: HTMLElement) => void; chips: FilterChip[]; note?: string;
  density: 'compact' | 'comfort'; onDensity: (d: 'compact' | 'comfort') => void;
}): ReactElement {
  return (
    <div className="filters">
      <button type="button" className="select" aria-haspopup="listbox" onClick={(e) => onRange(e.currentTarget)}>{range}<Icon name="caret" /></button>
      <button type="button" className="select mono" style={{ fontSize: 12.5 }} onClick={(e) => onDates(e.currentTarget)}>{dates}</button>
      <Segmented label="Time zone" value={tz} onChange={onTz} options={[{ value: 'local', label: 'Local' }, { value: 'utc', label: 'UTC' }]} />
      {extra}
      <button type="button" className="btn sm" onClick={(e) => onFilters(e.currentTarget)}>
        <Icon name="filter" />Filters{filterCount ? <span className="cnt" style={{ marginLeft: 2 }}>{filterCount}</span> : null}
      </button>
      {chips.map((c) => (
        <span className="chip" key={c.key}>{c.label}<button type="button" aria-label={`Remove ${c.label}`} onClick={c.onRemove}>×</button></span>
      ))}
      {note ? <span className="note">{note}</span> : null}
      <Segmented label="Row density" value={density} onChange={onDensity} options={[{ value: 'comfort', label: 'Roomy' }, { value: 'compact', label: 'Compact' }]} />
    </div>
  );
}
