import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cx, fmt, niceStep } from './cx';
import { Delta, Tag } from './primitives';

/* ───────── Sizing: draw charts at their real width so text stays readable ───────── */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setW(Math.floor(el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ───────── Bar chart (activity per day, events per hour) ───────── */

export function BarChart({ data, labels, label, highlightLast = true, showLast = true }: { data: number[]; labels?: string[]; label: string; highlightLast?: boolean; showLast?: boolean }): ReactElement {
  const [ref, w] = useWidth<HTMLDivElement>();
  const top = Math.max(1, ...data), step = niceStep(top / 4), max = Math.ceil(top / step) * step;
  const H = w < 420 ? 170 : 210, L = 30, R = 4, T = 8, B = 24;
  const iw = Math.max(0, w - L - R), ih = H - T - B, bw = data.length ? iw / data.length : 0;
  const every = Math.max(1, Math.ceil(64 / (bw || 1)));
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return (
    <div className="chart pb" ref={ref}>
      {w > 0 ? (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={label}>
          {ticks.map((v) => {
            const y = T + ih - (v / max) * ih;
            return (
              <g key={v}>
                <line x1={L} x2={w - R} y1={y} y2={y} stroke="var(--line)" strokeDasharray={v ? '2 4' : undefined} />
                <text x={L - 6} y={y + 3} textAnchor="end">{v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : v}</text>
              </g>
            );
          })}
          {data.map((v, i) => {
            const h = (v / max) * ih, x = L + i * bw + 1.5, last = i === data.length - 1;
            return (
              <g key={i}>
                <rect className="bar" x={x} y={T + ih - h} width={Math.max(1, bw - 3)} height={Math.max(0, h)} rx={2} fill={last && highlightLast ? 'var(--accent)' : 'var(--bar)'} style={{ ['--i' as string]: i }} />
                {labels && ((i % every === 0 && data.length - 1 - i >= every) || last) ? <text x={x + (bw - 3) / 2} y={H - 7} textAnchor="middle">{labels[i]}</text> : null}
              </g>
            );
          })}
          {showLast && data.length ? <text x={L + (data.length - 1) * bw + 1.5 + (bw - 3) / 2} y={T + ih - (data[data.length - 1]! / max) * ih - 5} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 600 }}>{fmt(data[data.length - 1]!)}</text> : null}
        </svg>
      ) : null}
    </div>
  );
}

/* ───────── Survival curve + heat strip (level by level) ───────── */

/** Percent of the previous level's starters who never started the next one; null for the last level. */
export function dropToNext(starts: number[], i: number): number | null {
  const next = starts[i + 1];
  const cur = starts[i];
  return next === undefined || !cur ? null : ((cur - next) / cur) * 100;
}

/** Indices of the n steepest drops, steepest first. */
export function steepest(starts: number[], n = 2): number[] {
  return starts.map((_, i) => ({ i, d: dropToNext(starts, i) ?? 0 })).sort((a, b) => b.d - a.d).slice(0, n).map((o) => o.i);
}

export function SurvivalCurve({ starts, label, onSelect }: { starts: number[]; label: string; onSelect?: (level: number) => void }): ReactElement {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = starts.length, H = w < 420 ? 190 : 230, L = 34, R = 12, T = 22, B = 24, iw = Math.max(0, w - L - R), ih = H - T - B;
  const stp = niceStep((starts[0] ?? 1) / 3), max = Math.ceil((starts[0] ?? 1) / stp) * stp;
  const X = (i: number) => L + (i / Math.max(1, n - 1)) * iw;
  const Y = (v: number) => T + ih - (v / max) * ih;
  const d = starts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const hot = steepest(starts, 2);
  const every = Math.max(1, Math.ceil(26 / (iw / Math.max(1, n - 1) || 1)));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += stp) ticks.push(v);
  return (
    <div className="chart" ref={ref}>
      {w > 0 ? (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeDasharray={v ? '2 4' : undefined} />
              <text x={L - 6} y={Y(v) + 3} textAnchor="end">{v}</text>
            </g>
          ))}
          <path d={`${d} L${X(n - 1)} ${Y(0)} L${X(0)} ${Y(0)}Z`} fill="var(--accent)" opacity={0.1} />
          <path d={d} className="surv-line" />
          {starts.map((v, i) => {
            const big = hot.includes(i), dd = dropToNext(starts, i);
            return (
              <g key={i}>
                <circle cx={X(i)} cy={Y(v)} r={big ? 4.5 : 2.6} fill={big ? 'var(--bad)' : 'var(--panel)'} stroke={big ? undefined : 'var(--accent)'} strokeWidth={big ? undefined : 1.5} />
                {big && dd != null ? <text x={X(i) + 7} y={Y(v) - 7} style={{ fill: 'var(--bad)', fontWeight: 600 }}>L{i + 1} −{Math.round(dd)}%</text> : null}
                {i % every === 0 || i === n - 1 ? <text x={X(i)} y={H - 7} textAnchor="middle">{i + 1}</text> : null}
                <rect className="hit" x={X(i) - iw / Math.max(1, n - 1) / 2} y={T} width={iw / Math.max(1, n - 1)} height={ih} onClick={() => onSelect?.(i + 1)}><title>{`Level ${i + 1}: ${v} players`}</title></rect>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}

export function HeatStrip({ starts, onSelect }: { starts: number[]; onSelect?: (level: number) => void }): ReactElement {
  const drops = starts.map((_, i) => dropToNext(starts, i) ?? 0);
  const mx = Math.max(1, ...drops);
  return (
    <div>
      <div className="heat" style={{ gridTemplateColumns: `repeat(${starts.length}, minmax(0, 1fr))` }}>
        {starts.map((_, i) => {
          const dd = dropToNext(starts, i);
          return (
            <button key={i} type="button" style={{ ['--h' as string]: Math.round((drops[i]! / mx) * 85) }} title={`Level ${i + 1}: ${dd == null ? 'no next level yet' : `${dd.toFixed(1)}% did not start the next`}`} onClick={() => onSelect?.(i + 1)}>{i + 1}</button>
          );
        })}
      </div>
      <div className="heat-l"><span>Drop to next level: low<i />high</span><span>Click a level to inspect</span></div>
    </div>
  );
}

/* ───────── Funnel ───────── */

export type FunnelStep = { label: ReactNode; count: number; /** share of this step belonging to the first segment, when broken down */ firstShare?: number; median?: string };

export function FunnelHeadline({ percent, sentence, started, finished, median }: { percent: number; sentence: ReactNode; started: number; finished: number; median?: string }): ReactElement {
  return (
    <div className="fhead">
      <span className="big">{percent.toFixed(1)}%</span>
      <span className="lead">{sentence}</span>
      <span className="st"><b>{fmt(started)}</b><span>started</span></span>
      <span className="st"><b>{fmt(finished)}</b><span>finished</span></span>
      {median ? <span className="st"><b>{median}</b><span>median to finish</span></span> : null}
    </div>
  );
}

/** Result rows: label and count, a full-width bar, and between rows the players lost with "See who". The biggest drop is marked. */
export function FunnelResult({ steps, segments, onSeeWho }: { steps: FunnelStep[]; segments?: [string, string]; onSeeWho?: (stepIndex: number) => void }): ReactElement {
  const n0 = steps[0]?.count ?? 1;
  const worst = biggestDrop(steps.map((x) => x.count));
  return (
    <div>
      {segments ? <div className="legend2"><span><i style={{ background: 'var(--bar)' }} />{segments[0]}</span><span><i style={{ background: 'var(--hl-cyan)' }} />{segments[1]}</span></div> : null}
      <div className="fun">
        {steps.map((s, i) => {
          const pct = (s.count / n0) * 100, a = segments && s.firstShare != null ? Math.round(s.count * s.firstShare) : s.count;
          const next = steps[i + 1];
          const lost = next ? s.count - next.count : 0;
          return (
            <div key={i}>
              <div className={cx('frow', i === steps.length - 1 && 'last')}>
                <span className="n">{i + 1}</span>
                <span className="fl">{s.label}</span>
                <div className="fbar">
                  <i style={{ ['--i' as string]: i, width: `${(a / n0) * 100}%` }} />
                  {segments ? <i className="b2" style={{ ['--i' as string]: i, width: `${((s.count - a) / n0) * 100}%` }} /> : null}
                </div>
                <span className="fv">{fmt(s.count)} <small>{pct.toFixed(1)}%{segments ? ` · ${a} / ${s.count - a}` : ''}</small></span>
              </div>
              {next ? (
                <div className={cx('fdrop', i === worst && 'worst')}>
                  <span>↓ {fmt(lost)} players left ({((lost / s.count) * 100).toFixed(1)}%){s.median ? ` · median ${s.median} to the next step` : ''}{i === worst ? ' · biggest drop' : ''}</span>
                  {onSeeWho ? <button type="button" className="btn sm ghost" onClick={() => onSeeWho(i)}>See who</button> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Index of the step after which the most players are lost (-1 when there are fewer than two steps). */
export function biggestDrop(counts: number[]): number {
  let worst = -1, most = -Infinity;
  for (let i = 0; i < counts.length - 1; i++) {
    const lost = (counts[i] as number) - (counts[i + 1] as number);
    if (lost > most) { most = lost; worst = i; }
  }
  return worst;
}

/** Funnel options are chips that light up when changed from their default. */
export function OptionChip({ label, value, changed, onClick }: { label: string; value: string; changed?: boolean; onClick?: () => void }): ReactElement {
  return <button type="button" className={cx('ochip', changed && 'set')} onClick={onClick}>{label} <b>{value}</b></button>;
}

/* ───────── Compare table ───────── */

export type CompareRow = { key: string | number; a: { start: number; finish: number }; b: { start: number; finish: number } };
const pct = (s: number, f: number) => (s ? ((s - f) / s) * 100 : 0);
const fmtp = (p: number) => `${p.toFixed(1).replace(/\.0$/, '')}%`;
export const SMALL_SAMPLE = 5;

export function compareSummary(rows: CompareRow[]): { worse: number; better: number; same: number; small: number } {
  let worse = 0, better = 0, same = 0, small = 0;
  for (const r of rows) {
    const d = pct(r.b.start, r.b.finish) - pct(r.a.start, r.a.finish);
    if (r.a.start < SMALL_SAMPLE || r.b.start < SMALL_SAMPLE) small++;
    if (d >= 0.5) worse++; else if (d <= -0.5) better++; else same++;
  }
  return { worse, better, same, small };
}

/** A vs B, level by level: summary strip, grouped headers, pinned first column, change cell last. */
export function CompareTable({ rows, aLabel, bLabel, firstColumn = 'Level' }: { rows: CompareRow[]; aLabel: string; bLabel: string; firstColumn?: string }): ReactElement {
  const s = compareSummary(rows);
  const mark = (n: number) => (n < SMALL_SAMPLE ? <i className="ss" title={`Small sample: fewer than ${SMALL_SAMPLE} players`}>◦</i> : null);
  return (
    <>
      <div className="sumstrip">
        <Tag kind="bad" dot>{s.worse} worse</Tag>
        <Tag kind="ok" dot>{s.better} better</Tag>
        <Tag kind="plain">{s.same} unchanged</Tag>
        <span>{s.small} with small samples <i className="ss" style={{ margin: 0 }}>◦</i></span>
      </div>
      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr className="g1">
              <th rowSpan={2} className="lvh">{firstColumn}</th>
              <th colSpan={3} className="grp">{aLabel} · A</th>
              <th colSpan={3} className="grp sep">{bLabel} · B</th>
              <th rowSpan={2} className="sep">Drop change · B vs A</th>
            </tr>
            <tr className="g2">
              <th className="n">Start</th><th className="n">Finish</th><th className="n">Drop</th>
              <th className="n sep">Start</th><th className="n">Finish</th><th className="n">Drop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pa = pct(r.a.start, r.a.finish), pb = pct(r.b.start, r.b.finish), d = pb - pa;
              return (
                <tr key={r.key}>
                  <td className="lv mono">{r.key}</td>
                  <td className="n">{r.a.start}</td><td className="n">{r.a.finish}</td><td className="n">{fmtp(pa)} · {r.a.start - r.a.finish}{mark(r.a.start)}</td>
                  <td className="n sep">{r.b.start}</td><td className="n">{r.b.finish}</td><td className="n">{fmtp(pb)} · {r.b.start - r.b.finish}{mark(r.b.start)}</td>
                  <td className={cx('sep', d >= 5 && 'hotb', d <= -5 && 'hotg')}><Delta value={d} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="foot-note">pp = percentage points · ◦ small sample (under {SMALL_SAMPLE} players) · observed behaviour, not proof that a release caused a change</div>
    </>
  );
}
