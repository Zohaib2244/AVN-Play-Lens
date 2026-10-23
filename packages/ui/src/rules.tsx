import { useMemo, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import { Button, Segmented } from './primitives';

/* ───────── Condition model ───────── */

export type Op = 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'missing';
export type Condition = { field: 'event' | 'param'; param: string; op: Op; value: string };
export type ConditionGroup = { match: 'all' | 'any'; conditions: Array<Condition | ConditionGroup> };
export type Node = Condition | ConditionGroup;

export const OPS: Array<[Op, string]> = [['eq', '='], ['ne', '≠'], ['contains', 'contains'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['exists', 'exists'], ['missing', 'is missing']];
export const opLabel = (o: Op): string => OPS.find((x) => x[0] === o)?.[1] ?? o;
export const isGroup = (n: Node): n is ConditionGroup => 'conditions' in n;
export const MAX_DEPTH = 3;

export type EventLike = { name: string; params: Record<string, string | number | undefined> };

function compare(actual: unknown, op: Op, value: string): boolean {
  if (op === 'exists') return actual !== undefined && actual !== null;
  if (op === 'missing') return actual === undefined || actual === null;
  if (actual === undefined || actual === null) return false;
  const a = String(actual).toLowerCase(), b = value.toLowerCase();
  const x = Number(actual), y = Number(value), num = Number.isFinite(x) && Number.isFinite(y) && value.trim() !== '';
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'contains': return a.includes(b);
    case 'gt': return num && x > y;
    case 'gte': return num && x >= y;
    case 'lt': return num && x < y;
    case 'lte': return num && x <= y;
    default: return false;
  }
}

/** True if the event satisfies the condition tree. An empty group matches nothing. */
export function matchesEvent(ev: EventLike, node: Node): boolean {
  if (isGroup(node)) {
    if (!node.conditions.length) return false;
    return node.match === 'all' ? node.conditions.every((c) => matchesEvent(ev, c)) : node.conditions.some((c) => matchesEvent(ev, c));
  }
  return compare(node.field === 'event' ? ev.name : ev.params[node.param], node.op, node.value);
}

/** The first problem in plain words, or '' if the tree is valid. */
export function conditionError(node: Node, depth = 1): string {
  if (isGroup(node)) {
    if (depth > MAX_DEPTH) return `Use at most ${MAX_DEPTH} levels of groups.`;
    if (!node.conditions.length && depth > 1) return 'A group is empty: add a condition or remove the group.';
    for (const c of node.conditions) { const e = conditionError(c, depth + 1); if (e) return e; }
    return '';
  }
  if (node.field === 'param' && !node.param) return 'Choose a parameter.';
  if (node.op !== 'exists' && node.op !== 'missing' && node.value === '') return 'Fill in a value.';
  if (['gt', 'gte', 'lt', 'lte'].includes(node.op) && !Number.isFinite(Number(node.value))) return 'Compare with a number.';
  return '';
}

/* ───────── Sentences ───────── */

/** A condition tree as a sentence of tokens: `level` = `12` AND (`format` = `rewarded` OR …). */
export function ConditionSentence({ node, top = true }: { node: Node; top?: boolean }): ReactElement {
  if (isGroup(node)) {
    const parts = node.conditions.map((c, i) => (
      <span key={i} style={{ display: 'contents' }}>
        {i > 0 ? <span className="join">{node.match === 'all' ? 'AND' : 'OR'}</span> : null}
        <ConditionSentence node={c} top={false} />
      </span>
    ));
    return top ? <>{parts}</> : <span className="gb">{parts}</span>;
  }
  return (
    <>
      <span className="tok">{node.field === 'event' ? 'event name' : node.param || '…'}</span>
      <span className="tok op">{opLabel(node.op)}</span>
      {node.op !== 'exists' && node.op !== 'missing' ? <span className="tok val">{node.value || '…'}</span> : null}
    </>
  );
}

export type PlayerRule = { verb: 'did' | 'didnt'; event: string; cond: ConditionGroup; times: number };

export function RuleSentence({ rule }: { rule: PlayerRule }): ReactElement {
  return (
    <span className="sent">
      <span className={cx('tok', 'verb', rule.verb !== 'did' && 'not')}>{rule.verb === 'did' ? 'did' : 'didn’t do'}</span>
      <span className="tok">{rule.event}</span>
      {rule.cond.conditions.length ? <><span>where</span><ConditionSentence node={rule.cond} /></> : null}
      {rule.verb === 'did' && rule.times > 1 ? <><span>at least</span><span className="tok val">{rule.times}×</span></> : null}
    </span>
  );
}

/* ───────── Rule bar ───────── */

export type RulePreset = { id: string; label: string };

/** Applied rules above the data, always visible: sentence per rule, AND/OR button, match count, Clear. */
export function RuleBar({ rules, match, onToggleMatch, onEdit, onRemove, onAdd, onClear, matchCount, total, presets, onPreset, subject = 'players' }: {
  rules: PlayerRule[];
  match: 'all' | 'any';
  onToggleMatch: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onClear: () => void;
  matchCount: number;
  total: number;
  presets?: RulePreset[];
  onPreset?: (id: string) => void;
  subject?: string;
}): ReactElement {
  if (!rules.length) {
    return (
      <div className="rulebar">
        <div className="rb-empty">
          <span className="rb-ic"><Icon name="filter" /></span>
          <b>All {total.toLocaleString('en-US')} {subject}</b>
          <span className="muted" style={{ fontSize: 13 }}>No rules. Try:</span>
          {presets?.map((p) => <button key={p.id} type="button" className="preset" onClick={() => onPreset?.(p.id)}>{p.label}</button>)}
          <Button size="sm" style={{ marginLeft: 'auto' }} onClick={onAdd}>+ Add rule</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rulebar">
      <div className="rb-h">
        <span className="rb-ic"><Icon name="filter" /></span>
        <b className="ttl">Showing {subject} who</b>
        <span className="rb-count"><b>{matchCount.toLocaleString('en-US')}</b> of {total.toLocaleString('en-US')} {subject}</span>
        <Button size="sm" variant="ghost" onClick={onClear}>Clear rules</Button>
      </div>
      <div className="rb-list">
        {rules.map((r, i) => (
          <div key={i}>
            {i > 0 ? (
              <div className="rjoin">
                <button type="button" className="join" title="Switch between all rules and any rule" onClick={onToggleMatch}>{match === 'all' ? 'AND' : 'OR'}</button>
                <span className="dim" style={{ fontSize: 11.5 }}>{match === 'all' ? `${subject} match every rule` : `${subject} match at least one rule`}</span>
              </div>
            ) : null}
            <div className="rrow">
              <RuleSentence rule={r} />
              <span className="ra">
                <button type="button" className="icon-btn" aria-label="Edit rule" onClick={() => onEdit(i)}><Icon name="edit" /></button>
                <button type="button" className="icon-btn" aria-label="Remove rule" onClick={() => onRemove(i)}><Icon name="x" /></button>
              </span>
            </div>
          </div>
        ))}
        <button type="button" className="rb-add" onClick={onAdd}>+ Add rule</button>
      </div>
    </div>
  );
}

/* ───────── Condition editor (goes in a Drawer) ───────── */

const emptyCondition = (): Condition => ({ field: 'param', param: '', op: 'eq', value: '' });
const emptyGroup = (): ConditionGroup => ({ match: 'any', conditions: [emptyCondition()] });

/** Immutable update helpers, exported for tests. `path` is a dotted index path like "1.0"; '' is the root. */
export function getNode(root: ConditionGroup, path: string): Node {
  return path === '' ? root : path.split('.').reduce<Node>((n, k) => (isGroup(n) ? n.conditions[Number(k)] as Node : n), root);
}
export function updateNode(root: ConditionGroup, path: string, fn: (n: Node) => Node | null): ConditionGroup {
  if (path === '') return (fn(root) as ConditionGroup | null) ?? root;
  const parts = path.split('.').map(Number);
  const rec = (g: ConditionGroup, i: number): ConditionGroup => {
    const idx = parts[i] as number;
    const conditions = [...g.conditions];
    if (i === parts.length - 1) {
      const next = fn(conditions[idx] as Node);
      if (next === null) conditions.splice(idx, 1); else conditions[idx] = next;
    } else {
      conditions[idx] = rec(conditions[idx] as ConditionGroup, i + 1);
    }
    return { ...g, conditions };
  };
  return rec(root, 0);
}
export { emptyCondition, emptyGroup };

export function ConditionEditor({ tree, onChange, params = [], events = [] }: { tree: ConditionGroup; onChange: (t: ConditionGroup) => void; params?: string[]; events?: string[] }): ReactElement {
  const listP = useMemo(() => `dl-params-${Math.random().toString(36).slice(2, 7)}`, []);
  const listE = useMemo(() => `dl-events-${Math.random().toString(36).slice(2, 7)}`, []);
  const renderNode = (node: Node, path: string, depth: number): ReactElement => {
    if (isGroup(node)) {
      return (
        <div className="cg" data-depth={depth} key={path || 'root'}>
          <div className="cg-h">
            Match
            <Segmented label="Match" value={node.match} onChange={(m) => onChange(updateNode(tree, path, (n) => ({ ...(n as ConditionGroup), match: m })))} options={[{ value: 'all', label: 'all (AND)' }, { value: 'any', label: 'any (OR)' }]} />
            of these
            {path ? <><span className="grow" /><Button size="sm" variant="ghost" onClick={() => onChange(updateNode(tree, path, () => null))}>Remove group</Button></> : null}
          </div>
          {node.conditions.map((c, i) => renderNode(c, path === '' ? String(i) : `${path}.${i}`, depth + 1))}
          <div className="cg-add">
            <button type="button" onClick={() => onChange(updateNode(tree, path, (n) => ({ ...(n as ConditionGroup), conditions: [...(n as ConditionGroup).conditions, emptyCondition()] })))}>+ Condition</button>
            {depth < MAX_DEPTH ? <button type="button" onClick={() => onChange(updateNode(tree, path, (n) => ({ ...(n as ConditionGroup), conditions: [...(n as ConditionGroup).conditions, emptyGroup()] })))}>+ Group</button> : null}
          </div>
        </div>
      );
    }
    const ops = node.field === 'event' ? OPS.slice(0, 3) : OPS;
    const set = (patch: Partial<Condition>) => onChange(updateNode(tree, path, (n) => ({ ...(n as Condition), ...patch })));
    return (
      <div className="cl" key={path}>
        <select aria-label="Field" value={node.field} onChange={(e) => { const f = e.target.value as Condition['field']; set({ field: f, op: f === 'event' ? 'contains' : 'eq', param: f === 'event' ? '' : node.param }); }}>
          <option value="param">Parameter</option>
          <option value="event">Event name</option>
        </select>
        {node.field === 'param' ? <input aria-label="Parameter" list={listP} value={node.param} placeholder="parameter" onChange={(e) => set({ param: e.target.value })} /> : null}
        <select aria-label="Comparison" value={node.op} onChange={(e) => set({ op: e.target.value as Op })}>
          {ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {node.op !== 'exists' && node.op !== 'missing' ? <input aria-label="Value" list={node.field === 'event' ? listE : undefined} value={node.value} placeholder="value" onChange={(e) => set({ value: e.target.value })} /> : null}
        <button type="button" className="icon-btn" aria-label="Remove condition" style={{ width: 30, height: 30 }} onClick={() => onChange(updateNode(tree, path, () => null))}><Icon name="x" /></button>
      </div>
    );
  };
  return (
    <div className="ed-sec">
      {renderNode(tree, '', 1)}
      <datalist id={listP}>{params.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id={listE}>{events.map((p) => <option key={p} value={p} />)}</datalist>
    </div>
  );
}

/** Live preview line: the first problem, or "N match" with an optional detail. */
export function RulePreview({ error, count, noun, detail }: { error?: string; count: number; noun: string; detail?: ReactNode }): ReactElement {
  if (error) return <div className="preview bad" role="status"><b className="n">{error}</b></div>;
  return (
    <div className={cx('preview', count === 0 && 'zero')} role="status">
      <b className="n">{count.toLocaleString('en-US')}</b>
      <span>{noun}{detail ? <><br /><span className="dim">{detail}</span></> : null}</span>
    </div>
  );
}

/* ───────── Highlights ───────── */

export type HighlightColor = 'orange' | 'cyan' | 'green' | 'pink' | 'violet' | 'gold';
export const HIGHLIGHT_COLORS: HighlightColor[] = ['orange', 'cyan', 'green', 'pink', 'violet', 'gold'];
export type Highlight = { name: string; color: HighlightColor; on: boolean; cond: ConditionGroup };

export const highlightsFor = (ev: EventLike, hs: Highlight[]): Highlight[] => hs.filter((h) => h.on && !conditionError(h.cond) && matchesEvent(ev, h.cond));
export const matchIndices = (events: EventLike[], hs: Highlight[]): number[] => events.flatMap((ev, i) => (highlightsFor(ev, hs).length ? [i] : []));

/** Next / previous match, wrapping around. `current` is the current event index or -1. */
export function stepMatch(indices: number[], current: number, dir: 1 | -1): number {
  if (!indices.length) return -1;
  const pos = indices.indexOf(current);
  if (pos < 0) return dir > 0 ? (indices.find((i) => i > current) ?? indices[0]!) : ([...indices].reverse().find((i) => i < current) ?? indices[indices.length - 1]!);
  return indices[(pos + dir + indices.length) % indices.length]!;
}

export function HighlightsBar({ highlights, events, mode, onMode, onToggle, onEdit, onAdd, presets, onPreset, current, onJump }: {
  highlights: Highlight[];
  events: EventLike[];
  mode: 'highlight' | 'filter';
  onMode: (m: 'highlight' | 'filter') => void;
  onToggle: (index: number) => void;
  onEdit: (index: number) => void;
  onAdd: () => void;
  presets?: Array<{ id: string; label: string }>;
  onPreset?: (id: string) => void;
  current: number;
  onJump: (eventIndex: number) => void;
}): ReactElement {
  const idx = matchIndices(events, highlights);
  const pos = idx.indexOf(current);
  return (
    <div className="hlbar">
      <div className="hlbar-h">
        <b>Highlights</b>
        <span className="dim" style={{ fontSize: 12 }}>{idx.length} of {events.length} events</span>
        <Segmented label="Mode" value={mode} onChange={onMode} options={[{ value: 'highlight', label: 'Highlight' }, { value: 'filter', label: 'Only matches' }]} />
      </div>
      <div className="hlchips">
        {highlights.map((h, i) => {
          const n = events.filter((ev) => !conditionError(h.cond) && matchesEvent(ev, h.cond)).length;
          return (
            <span key={i} className={cx('hlchip', !h.on && 'off')} style={{ ['--c' as string]: `var(--hl-${h.color})` }}>
              <span className="d" />
              {h.name}
              <span className="n">{n}</span>
              <button type="button" aria-label={`${h.on ? 'Hide' : 'Show'} ${h.name}`} title={h.on ? 'Turn off' : 'Turn on'} onClick={() => onToggle(i)}><Icon name="eye" /></button>
              <button type="button" aria-label={`Edit ${h.name}`} onClick={() => onEdit(i)}><Icon name="edit" /></button>
            </span>
          );
        })}
        <button type="button" className="hl-add" onClick={onAdd}>+ Highlight</button>
        {presets?.map((p) => <button key={p.id} type="button" className="preset" onClick={() => onPreset?.(p.id)}>+ {p.label}</button>)}
      </div>
      <div className="hlmap">
        <span>Start</span>
        <div className="hltrack">
          {events.map((ev, i) => {
            const hs = highlightsFor(ev, highlights);
            if (!hs.length) return null;
            return <button key={i} type="button" className={i === current ? 'cur' : undefined} style={{ left: `${(i / Math.max(1, events.length - 1)) * 100}%`, ['--c' as string]: `var(--hl-${hs[0]!.color})` }} title={ev.name} aria-label={`Go to ${ev.name}`} onClick={() => onJump(i)} />;
          })}
        </div>
        <span>Latest</span>
      </div>
      <div className="hlnav">
        <Button size="sm" disabled={!idx.length} onClick={() => onJump(stepMatch(idx, current, -1))}>← Previous</Button>
        <Button size="sm" disabled={!idx.length} onClick={() => onJump(stepMatch(idx, current, 1))}>Next →</Button>
        <span>{pos < 0 ? '–' : pos + 1} / {idx.length} matches</span>
      </div>
    </div>
  );
}

export type TimelineEvent = EventLike & { time: string; session: number };

/** The event timeline with highlight edges, tags and the current match outlined. */
export function Timeline({ events, highlights, mode, current }: { events: TimelineEvent[]; highlights: Highlight[]; mode: 'highlight' | 'filter'; current: number }): ReactElement {
  const rows: ReactNode[] = [];
  let session = 0;
  events.forEach((ev, i) => {
    const hs = highlightsFor(ev, highlights);
    if (mode === 'filter' && !hs.length) return;
    if (ev.session !== session) { session = ev.session; rows.push(<div key={`s${i}`} className="tl-s eyebrow">Session {ev.session}</div>); }
    rows.push(
      <div key={i} id={`tl${i}`} className={cx('tl-r', hs.length > 0 && 'hl', i === current && 'cur')} style={hs.length ? { ['--c' as string]: `var(--hl-${hs[0]!.color})` } : undefined}>
        <time>{ev.time.slice(0, 5)}</time>
        <span>
          <span className="nm">{ev.name}</span>
          {hs.map((h) => <span key={h.name} className="ht" style={{ ['--c' as string]: `var(--hl-${h.color})` }}>{h.name}</span>)}
        </span>
        {Object.keys(ev.params).length ? <span className="pr">{Object.entries(ev.params).map(([k, v]) => <span key={k}>{k} {String(v)}</span>)}</span> : null}
      </div>,
    );
  });
  return <div className="tl">{rows}</div>;
}
