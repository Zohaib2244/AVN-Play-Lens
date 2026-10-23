import type { ReactElement, SVGProps } from 'react';

/** Stroke icons used by the components. 24 × 24, currentColor, 2px stroke. */
const PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  funnel: 'M3 4h18l-7 8v6l-4 2v-8z',
  pad: 'M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM7 11v3M5.5 12.5h3M15.5 12h.01M18 14h.01',
  users: 'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6',
  down: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 12l9-9M16 7l3 3',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  team: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  caret: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bot: 'M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 3v4M9 12h.01M15 12h.01M9.5 15.5h5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  building: 'M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2zM9 8h.01M15 8h.01M9 12h.01M15 12h.01M10 21v-4h4v4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8M10 21h4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  back: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.5h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  term: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3-3 3M12 15h5',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  flame: 'M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5.5 1 1 1.5 2 1.5 3 1-2.5 1.5-5 1.5-7.5z',
  checklist: 'M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2zM9 12l2 2 4-4',
  plus: 'M12 5v14M5 12h14',
} as const;

export type IconName = keyof typeof PATHS;

type IconProps = { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>;

/** A stroke icon. Decorative by default (aria-hidden); pass aria-label on the parent button. */
export function Icon({ name, size, className = 'ic', ...rest }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'check' ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={size}
      height={size}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
