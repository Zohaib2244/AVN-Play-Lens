// Run: node --test packages/server/src/avn/fa.test.mjs
// The FA line formats below are the commonly seen Firebase SDK formats, not taken
// from a capture of your games. Replace them with real lines when a capture exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFaLine, parseBundle, checkLimits } from './fa.mjs';
import { crossCheck } from './crosscheck.mjs';

test('ignores other tags', () => {
  assert.equal(parseFaLine('Unity', 'Logging event: origin=app,name=x,params=Bundle[{}]'), null);
});

test('FA-SVC line: custom event with params', () => {
  const e = parseFaLine('FA-SVC', 'Logging event: origin=app,name=level_start,params=Bundle[{level=3, ga_event_origin(_o)=app, mode=classic}]');
  assert.equal(e.name, 'level_start');
  assert.equal(e.origin, 'app');
  assert.deepEqual(e.params, { level: '3', ga_event_origin: 'app', mode: 'classic' });
  assert.equal(e.auto, false);
});

test('FA-SVC line: automatic event short name is expanded', () => {
  const e = parseFaLine('FA-SVC', 'Logging event: origin=auto,name=_vs,params=Bundle[{ga_event_origin(_o)=auto, ga_screen_class(_sc)=UnityPlayerActivity}]');
  assert.equal(e.name, 'screen_view');
  assert.equal(e.auto, true);
  assert.equal(e.params.ga_screen_class, 'UnityPlayerActivity');
});

test('FA (FE) line, with and without a short name', () => {
  const a = parseFaLine('FA', 'Logging event (FE): level_complete, Bundle[{firebase_event_origin(_o)=app, level=3, stars=2}]');
  assert.equal(a.name, 'level_complete');
  assert.equal(a.params.stars, '2');
  const b = parseFaLine('FA', 'Logging event (FE): screen_view(_vs), Bundle[{ga_event_origin(_o)=auto, firebase_screen(_sn)=Shop}]');
  assert.equal(b.name, 'screen_view');
  assert.equal(b.auto, true);
});

test('bundle values may contain commas', () => {
  assert.deepEqual(parseBundle('item_name=Gems, big pack, value=0.99'), { item_name: 'Gems, big pack', value: '0.99' });
});

test('Firebase limits', () => {
  assert.deepEqual(checkLimits({ name: 'ok', params: { a: '1' } }), []);
  const long = checkLimits({ name: 'x'.repeat(41), params: { note: 'y'.repeat(101) } });
  assert.equal(long.length, 2);
});

test('cross-check: matched, not logged, pending, firebase only', () => {
  const plugin = [
    { ts: 1000, name: 'ad_interstitial' },
    { ts: 2000, name: 'tutorial_complete' },
    { ts: 9000, name: 'ad_rewarded' },
  ];
  const fa = [
    { ts: 1300, name: 'ad_interstitial' },
    { ts: 3000, name: 'level_start' },
  ];
  const r = crossCheck(plugin, fa, { windowMs: 5000, now: 10000 });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].delayMs, 300);
  assert.deepEqual(r.notLogged.map((e) => e.name), ['tutorial_complete']);
  assert.deepEqual(r.pending.map((e) => e.name), ['ad_rewarded']);
  assert.deepEqual(r.firebaseOnly.map((e) => e.name), ['level_start']);
});

test('cross-check: one Firebase line only matches one plugin event', () => {
  const r = crossCheck([{ ts: 0, name: 'a' }, { ts: 10, name: 'a' }], [{ ts: 100, name: 'a' }], { now: 99999 });
  assert.equal(r.matched.length, 1);
  assert.equal(r.notLogged.length, 1);
});
