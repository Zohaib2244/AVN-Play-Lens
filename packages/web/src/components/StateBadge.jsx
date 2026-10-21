// One palette for live SDK/ad state and saved captures. Keep text labels visible
// so a state can still be identified without relying on color.
const COLORS = {
  Ready: '#A3D98B',
  Initialized: '#A3D98B',
  Initializing: '#E6B880',
  Idle: '#C0B49D',
  Loading: '#F4D06F',
  Loaded: '#82D9BB',
  Showing: '#80C7F4',
  Showed: '#BAA3F0',
  Closed: '#D6A4C8',
  Destroyed: '#9CA8BB',
  Sending: '#F2AA79',
  Sent: '#70D2D4',
  Failed: '#FF9590',
  SendFailed: '#F3A0B5',
  Info: '#ACC9E6',
  InitializedSuccess: '#A3D98B',
  InitializedFailure: '#FF9590',
  NotInitialized: '#C1A982',
  InitializedUnknown: '#D5C99C',
  NotReported: '#A5AFBD',
  DoesNotApply: '#9E9DAB',
  'Not used': '#AAA49A',
  'No logs': '#A4B7BD',
  'Not seen': '#BDB5AA',
};

export function StateBadge({ state, label }) {
  const color = COLORS[state] ?? '#BDB5AA';
  return <span className="tag state-badge" title={state || 'No state reported'} style={{ color, backgroundColor: `${color}1F`, borderColor: `${color}50` }}>{label ?? state ?? '—'}</span>;
}
