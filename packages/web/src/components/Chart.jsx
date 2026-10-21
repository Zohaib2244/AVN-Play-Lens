// Small time-series line chart in SVG: gaps where there's no sample, an optional
// reference line (e.g. 30 FPS), and a hover readout.
import { useEffect, useRef, useState } from 'react';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const pad = (n) => String(n).padStart(2, '0');
const mmss = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v);
}

export function Chart({ data, field, color = 'var(--warm)', unit = '', fixedMax, minMax = 1, refLine, start, height = 170, format = (v) => Math.round(v) }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const L = 40;
  const R = 10;
  const T = 12;
  const B = 24;
  const w = width - L - R;
  const h = height - T - B;
  const vals = data.map((d) => d[field]).filter((v) => v != null);
  const max = fixedMax ?? niceMax(Math.max(minMax, ...vals, refLine?.value ?? 0) * 1.08);
  const t0 = data[0]?.t ?? 0;
  const t1 = data.at(-1)?.t ?? t0 + 1;
  const span = Math.max(1, t1 - t0);
  const x = (t) => L + ((t - t0) / span) * w;
  const y = (v) => T + h - (Math.min(v, max) / max) * h;

  // Split into runs where the value exists (and no long time gap).
  const runs = [];
  let run = [];
  data.forEach((d, i) => {
    const gap = i > 0 && d.t - data[i - 1].t > 5000;
    if (d[field] == null || gap) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (d[field] != null) run.push(d);
  });
  if (run.length) runs.push(run);
  const path = runs.map((r) => r.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d[field]).toFixed(1)}`).join('')).join('');
  const area = runs.map((r) => `M${x(r[0].t).toFixed(1)},${T + h}${r.map((d) => `L${x(d.t).toFixed(1)},${y(d[field]).toFixed(1)}`).join('')}L${x(r.at(-1).t).toFixed(1)},${T + h}Z`).join('');

  const ticks = [0, max / 2, max];
  const tcount = Math.max(2, Math.min(6, Math.floor(w / 110)));
  const tTicks = Array.from({ length: tcount }, (_, i) => t0 + (span * i) / (tcount - 1));

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const t = t0 + ((px - L) / w) * span;
    let best = null;
    for (const d of data) if (!best || Math.abs(d.t - t) < Math.abs(best.t - t)) best = d;
    setHover(best);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${field} over time`} style={{ display: 'block' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={L + w} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
          </g>
        ))}
        {tTicks.map((t, i) => <text key={t} x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === tTicks.length - 1 ? 'end' : 'middle'} className="axis">{mmss((t - (start ?? t0)) / 1000)}</text>)}
        {refLine && refLine.value <= max && (
          <g>
            <line x1={L} x2={L + w} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--dim)" strokeDasharray="4 4" />
            <text x={L + w - 2} y={y(refLine.value) - 5} textAnchor="end" className="axis">{refLine.label}</text>
          </g>
        )}
        <path d={area} fill={color} opacity=".12" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover && hover[field] != null && (
          <g>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={T} y2={T + h} stroke="var(--line-strong)" />
            <circle cx={x(hover.t)} cy={y(hover[field])} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />
          </g>
        )}
        {!vals.length && <text x={L + w / 2} y={T + h / 2} textAnchor="middle" className="axis">no data yet</text>}
      </svg>
      {hover && hover[field] != null && (
        <div className="tip" style={{ left: Math.min(Math.max(x(hover.t) - 50, 0), width - 110), top: 0 }}>
          <b>{format(hover[field])}{unit}</b> <span className="dim">at {mmss((hover.t - (start ?? t0)) / 1000)}</span>
        </div>
      )}
    </div>
  );
}
