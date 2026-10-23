import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocation, viewLocation } from './navigation.mjs';

test('view links retain the game and saved capture, and preserve unrelated parameters', () => {
  const route = { view: 'saved-session', pkg: 'com.studio.game', archivedId: 'capture 1' };
  const search = viewLocation('?debug=1', route);
  assert.deepEqual(readLocation(search), route);
  assert.equal(new URLSearchParams(search).get('debug'), '1');
});
test('global pages remove the previous capture scope; unknown views fall back to home', () => {
  assert.equal(viewLocation('?view=logs&game=com.studio.game&session=old', { view: 'home', pkg: 'com.studio.game', archivedId: 'old' }), '');
  assert.deepEqual(readLocation('?view=unknown'), { view: 'home', pkg: null, archivedId: null });
});
