import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grouper, classify } from '../src/logcat/parse.mjs';
import { FirebaseEvents } from '../src/monitor/firebase.mjs';

const entry = (message, ts, id = ts, tag = 'Unity') => ({ ...classify({ message, tag, ts, level: 'I' }), id });

test('Firebase events sharing a timestamp with diagnostics are separate records', () => {
  const fb = new FirebaseEvents();
  let id = 0;
  const g = new Grouper((e) => fb.ingest({ ...classify(e), id: ++id }));
  for (const message of ['Connected to remote service', 'Logging event (FE): LEVEL_ANALYSIS, Bundle[{Started=5}]',
    'Logging event (FE): SCREEN_ANALYSIS, Bundle[{screen=Main}]']) {
    g.push({ ts: 1000, pid: 10, tid: 11, level: 'D', tag: 'FA', message });
  }
  g.flush();
  assert.equal(fb.snapshot(2000).counts.firebase, 2);
  assert.equal(fb.snapshot(2000).diagnostics.lines, 3);
});

test('SendToFirebase events are visible immediately, deduplicate detailed status, and never confirm delivery', () => {
  const fb = new FirebaseEvents();
  fb.ingest(entry('[AnalyticsEventService.SendToFirebase] SendToFirebase sent event=LEVEL_ANALYSIS, params=1 | AVNPLUGIN', 1000));
  assert.equal(fb.snapshot(1100).rows[0].check, 'plugin-pending');
  assert.equal(fb.snapshot(1100).counts.firebase, 0);
  fb.ingest(entry('Status Analytics.Event => Sent: Custom event sent: Event=LEVEL_ANALYSIS, Params=1 [Started=5] | AVNPLUGIN', 1002));
  assert.equal(fb.snapshot(1100).counts.sent, 1);
  assert.deepEqual(fb.snapshot(1100).rows[0].params, { Started: '5' });
  assert.equal(fb.snapshot(7000).rows[0].check, 'not-in-firebase');
  fb.ingest(entry('Logging event (FE): LEVEL_ANALYSIS, Bundle[{Started=5}]', 1005, 1005, 'FA'));
  assert.equal(fb.snapshot(7000).counts.firebase, 1);
  assert.equal(fb.snapshot(7000).rows[0].check, 'matches-plugin');
});

test('native Firebase startup and dispatch logs explain progress without inventing event payloads', () => {
  const fb = new FirebaseEvents();
  for (const message of ['App measurement collection enabled', 'Connected to remote service', 'Logging telemetry for logEvent from database']) {
    fb.ingest(entry(message, 1000, 1, 'FA'));
  }
  const snapshot = fb.snapshot(2000);
  assert.equal(snapshot.receiving, false);
  assert.equal(snapshot.diagnostics.collection, true);
  assert.equal(snapshot.diagnostics.serviceConnected, true);
  assert.equal(snapshot.diagnostics.dispatches, 1);
  assert.equal(snapshot.counts.firebase, 0);
});
