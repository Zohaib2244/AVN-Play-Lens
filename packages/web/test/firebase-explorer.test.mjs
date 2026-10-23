import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FirebaseEvents } from '../../server/src/monitor/firebase.mjs';
import { classify } from '../../server/src/logcat/parse.mjs';
import { eventMatches, eventOptions, eventTypes, visibleParameters } from '../src/firebase-events';

const event = (name, ts, params = {}, auto = false, tag = 'FA', eventKey = undefined) => ({
  id: ts, ts, tag, source: 'firebase', message: '', fa: { name, params, auto, eventKey },
});

test('dictionary retains full capture counts, old unique types, and timing beyond timeline limits', () => {
  const fb = new FirebaseEvents();
  fb.ingest(event('only_at_start', 1000, { Started: 1 }));
  for (let i = 0; i < 2001; i++) fb.ingest(event('level_start', 2000 + i * 1000, { Started: i }));
  const snapshot = fb.snapshot(3000000);
  assert.equal(snapshot.rows.length, 500);
  assert.equal(snapshot.counts.firebase, 2002);
  const types = eventTypes(snapshot);
  assert.equal(types.length, 2);
  assert.equal(types[0].count, 2001);
  assert.equal(types[0].firstTs, 2000);
  assert.equal(types[0].lastTs, 2002000);
  assert.equal(types[0].averageGap, 1000);
  assert.deepEqual(types[1].params, ['Started']);
  assert.equal(eventOptions(snapshot).find((option) => option.name === 'only_at_start').logged, 1);
  fb.reset();
  assert.deepEqual(fb.snapshot().catalog, []);
  assert.equal(fb.snapshot().counts.firebase, 0);
});

test('cross-tag and upload retry duplicates count once and enrich dictionary parameter names', () => {
  const fb = new FirebaseEvents();
  fb.ingest(event('level_start', 1000, { Started: 1 }));
  fb.ingest(event('level_start', 1001, { Started: 1, TIME: 4 }, false, 'FA-SVC', 'batch-1'));
  fb.ingest(event('level_start', 1001, { Started: 1, TIME: 4 }, false, 'FA-SVC', 'batch-1'));
  const snapshot = fb.snapshot();
  assert.equal(snapshot.counts.firebase, 1);
  assert.deepEqual(eventTypes(snapshot)[0].params, ['Started', 'TIME']);
});

test('automatic toggle and source filter preserve accurate mixed-origin type counts and time ranges', () => {
  const fb = new FirebaseEvents();
  fb.ingest(event('ad_impression', 5000, { value: 2 }));
  fb.ingest(event('ad_impression', 1000, { _dbg: 1 }, true));
  fb.ingest(event('ad_impression', 11000, { currency: 'USD' }));
  const snapshot = fb.snapshot();
  assert.equal(eventTypes(snapshot)[0].count, 3);
  const [type] = eventTypes(snapshot, { hideAuto: true, sdk: 'FA' });
  assert.equal(type.count, 2);
  assert.equal(type.firstTs, 5000);
  assert.equal(type.lastTs, 11000);
  assert.equal(type.averageGap, 6000);
  assert.deepEqual(type.params, ['currency', 'value']);
  assert.equal(eventOptions(snapshot, { hideAuto: true })[0].logged, 2);
  assert.deepEqual(eventTypes(snapshot, { sdk: 'BB' }), []);
});

test('unconfirmed sends have selectable types but never inflate logged counts or dictionary stats', () => {
  const fb = new FirebaseEvents();
  fb.ingest({ ...classify({ tag: 'Unity', ts: 1000, level: 'I', message: '[AnalyticsEventService.SendToFirebase] SendToFirebase sent event=LEVEL_ANALYSIS, params=1 | AVNPLUGIN' }), id: 1 });
  const snapshot = fb.snapshot(10000);
  assert.deepEqual(eventOptions(snapshot), [{ name: 'LEVEL_ANALYSIS', logged: 0, reports: 0, unconfirmed: 1 }]);
  assert.deepEqual(eventTypes(snapshot), []);
  assert.equal(eventMatches(snapshot.rows[0], { name: 'LEVEL_ANALYSIS' }), true);
  assert.equal(eventMatches(snapshot.rows[0], { name: 'other' }), false);
});

test('old saved captures work without a catalog and distinguish Firebase logs from ByteBrew reports', () => {
  const snapshot = { rows: [
    { sdk: 'FA', name: 'level_start', ts: 1000, params: { Started: 1 }, check: 'matches-plugin' },
    { sdk: 'FA', name: 'level_start', ts: 7000, params: { TIME: 6 }, check: 'game-code' },
    { sdk: 'FA', name: 'screen_view', ts: 8000, params: { ga_screen_class: 'Game' }, check: 'automatic' },
    { sdk: 'FA', name: 'level_start', ts: 9000, missing: true, check: 'not-in-firebase' },
    { sdk: 'BB', name: 'level_start', ts: 10000, params: {}, check: 'plugin-only' },
  ] };
  const options = eventOptions(snapshot);
  assert.deepEqual(options.find((option) => option.name === 'level_start'), { name: 'level_start', logged: 2, reports: 1, unconfirmed: 1 });
  const types = eventTypes(snapshot, { sdk: 'FA', hideAuto: true });
  assert.equal(types.length, 1);
  assert.equal(types[0].count, 2);
  assert.equal(types[0].averageGap, 6000);
  assert.deepEqual(types[0].params, ['Started', 'TIME']);
});

test('parameter toggle hides raw and expanded Firebase bookkeeping without hiding game/ad values', () => {
  const params = { Started: 9, TIME: 102, value: 0.01, currency: 'USD', ad_unit_name: 'banner', ad_format: 'INTER',
    _r: 1, _dbg: 1, _syn: 1, _o: 'app', ga_screen_class: 'Game', ga_event_origin: 'app',
    firebase_screen: 'Game', engagement_time_msec: 20, session_id: 45, ad_event_id: '123' };
  assert.deepEqual(visibleParameters(params).map(([name]) => name), ['Started', 'TIME', 'value', 'currency', 'ad_unit_name', 'ad_format']);
  assert.equal(visibleParameters(params, true).length, Object.keys(params).length);
  assert.deepEqual(visibleParameters(undefined), []);
});
