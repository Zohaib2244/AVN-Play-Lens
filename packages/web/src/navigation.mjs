const VIEWS = new Set(['home', 'connect', 'games', 'devices', 'sessions', 'saved-session', 'game', 'game-sessions', 'logs', 'performance', 'health', 'firebase', 'firebase-setup', 'remote-config', 'checklist', 'checklist-setup', 'snapshooter']);

export function readLocation(search) {
  const params = new URLSearchParams(search);
  return { view: VIEWS.has(params.get('view')) ? params.get('view') : 'home', pkg: params.get('game') || null, archivedId: params.get('session') || null };
}

export function viewLocation(search, { view, pkg, archivedId }) {
  const params = new URLSearchParams(search);
  if (view === 'home') params.delete('view'); else params.set('view', view);
  if (pkg && !['home', 'devices', 'connect', 'sessions', 'games'].includes(view)) params.set('game', pkg); else params.delete('game');
  if (view === 'saved-session' && archivedId) params.set('session', archivedId); else params.delete('session');
  return params.size ? `?${params}` : '';
}
