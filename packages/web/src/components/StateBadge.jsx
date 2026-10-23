// State words are preserved; colours use the shared AVN status roles in every palette.
const KINDS = {
  Ready: 'ok', Initialized: 'ok', InitializedSuccess: 'ok',
  Initializing: 'info', Loading: 'info', Showing: 'info', Sending: 'info',
  Loaded: 'done', Showed: 'done', Closed: 'done', Sent: 'done',
  Failed: 'bad', SendFailed: 'bad', InitializedFailure: 'bad',
  NotInitialized: 'warn', InitializedUnknown: 'warn',
};
export function StateBadge({ state, label }) {
  const kind = KINDS[state] || 'plain';
  return <span className={`tag ${kind} state-badge`} title={state || 'No state reported'}>{label ?? state ?? 'Not reported'}</span>;
}
