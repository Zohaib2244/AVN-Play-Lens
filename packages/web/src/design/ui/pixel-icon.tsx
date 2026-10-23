import type { ReactElement } from 'react';

/**
 * The AVN pixel icon grammar (see styles/avn-family/SKILL.md):
 * a 10 × 10 grid, warm dark tile, a one-pixel frame with open corners, one idea in cream (six pixels or fewer),
 * and one accent "spark" pixel outside the frame placed where it hints the verb.
 */
type Rect = readonly [x: number, y: number, w: number, h: number];
export type PixelIconName = 'playlens' | 'analytics' | 'nutbot' | 'template';

export const PIXEL_ICONS: Record<PixelIconName, { idea: readonly Rect[]; spark: readonly [number, number] | null; label: string }> = {
  playlens: { idea: [[3, 3, 2, 2]], spark: [8, 8], label: 'AVN PlayLens' },
  analytics: { idea: [[3, 5, 1, 2], [5, 3, 1, 4]], spark: [8, 1], label: 'AVN Analytics' },
  nutbot: { idea: [[3, 3, 1, 1], [5, 3, 1, 1], [3, 5, 3, 1]], spark: [4, 0], label: 'NutBot' },
  template: { idea: [], spark: null, label: 'New tool' },
};

const FRAME: readonly Rect[] = [[2, 1, 5, 1], [1, 2, 1, 5], [7, 2, 1, 5], [2, 7, 5, 1]];
export const ICON_COLORS = { tile: '#16120F', cream: '#F1E7D6', taken: '#3A2F27', templateFrame: '#5A4A3C' } as const;

/** The icon as an SVG string with a fixed accent colour: for favicons, app icons and exports. */
export function pixelIconSVG(name: PixelIconName, accent = '#FF7F45'): string {
  const def = PIXEL_ICONS[name];
  const rect = ([x, y, w, h]: Rect, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  const frame = name === 'template' ? ICON_COLORS.templateFrame : accent;
  const parts = [
    `<rect width="10" height="10" fill="${ICON_COLORS.tile}"/>`,
    ...FRAME.map((r) => rect(r, frame)),
    ...def.idea.map((r) => rect(r, ICON_COLORS.cream)),
    def.spark ? rect([def.spark[0], def.spark[1], 1, 1], accent) : '',
    ...(name === 'template' ? [[8, 8], [8, 1], [4, 0]].map(([x, y]) => rect([x as number, y as number, 1, 1], ICON_COLORS.taken)) : []),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges">${parts.join('')}</svg>`;
}

export type SparkStatus = 'idle' | 'live' | 'warn' | 'bad';

/**
 * The icon in the app's accent colour. The spark pixel is a status light:
 * accent when idle, green live, amber needs a look, red blinks on an error (needs the style's flavour.css).
 */
export function PixelIcon({ name, size = 28, status = 'idle', build = false }: { name: PixelIconName; size?: number; status?: SparkStatus; build?: boolean }): ReactElement {
  const def = PIXEL_ICONS[name];
  let delay = 0;
  const cell = ([x, y, w, h]: Rect, fill: string, key: string, cls?: string) => (
    <rect key={key} x={x} y={y} width={w} height={h} className={cls} style={{ fill, ['--d' as string]: `${(delay += 55)}` }} />
  );
  return (
    <span className={build ? 'pxi build' : 'pxi'} data-st={status === 'idle' ? undefined : status} style={{ display: 'inline-block', flex: '0 0 auto', width: size, height: size, borderRadius: Math.round(size * 0.22), overflow: 'hidden' }} role="img" aria-label={def.label}>
      <svg viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }}>
        <rect className="tile" width="10" height="10" fill={ICON_COLORS.tile} />
        {FRAME.map((r, i) => cell(r, name === 'template' ? ICON_COLORS.templateFrame : 'var(--accent)', `f${i}`))}
        {def.idea.map((r, i) => cell(r, ICON_COLORS.cream, `i${i}`))}
        {def.spark ? cell([def.spark[0], def.spark[1], 1, 1], 'var(--accent)', 'sp', 'sp') : null}
      </svg>
    </span>
  );
}
