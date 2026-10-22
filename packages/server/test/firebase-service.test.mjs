import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseServiceCapture, parseFirebaseBatch } from '../src/avn/fa-service.mjs';
import { belongsToGame } from '../src/logcat/parse.mjs';
import { LogStream } from '../src/session/stream.mjs';
import { FirebaseEvents } from '../src/monitor/firebase.mjs';
import { Health } from '../src/monitor/health.mjs';

const pkg = 'com.demo.game';
const header = (app = pkg) => `Uploading data. app, uncompressed size, data: ${app}, 1552, `;
const raw = (message, tid = 20, ts = 3000) => ({ message, pid: 90, tid, ts, tag: 'FA-SVC', level: 'V' });
function batch(app = pkg) {
  return ['batch {', '  bundle {', `    app_id: ${app}`, '    bundle_sequential_index: 12',
    '    user_property {', '      name: user_id', '      string_value: do-not-include', '    }',
    '    event {', '      name: LEVEL_ANALYSIS', '      timestamp_millis: 2000',
    '      param {', '        name: ga_event_origin(_o)', '        string_value: app', '      }',
    '      param {', '        name: Started', '        int_value: 8', '      }',
    '      param {', '        name: note', '        string_value: text with } and { inside', '      }', '    }',
    '    event {', '      name: screen_view(_vs)', '      timestamp_millis: 2001',
    '      param {', '        name: ga_event_origin(_o)', '        string_value: auto', '      }',
    '      param {', '        name: ga_screen_id(_si)', '        int_value: -2615377656110575353', '      }', '    }',
    '  }', '} // End-of-batch'];
}

test('real Play services batch structure yields named events, types, original times and safe evidence', () => {
  const capture = new FirebaseServiceCapture(pkg);
  const events = [header(), ...batch()].flatMap((message) => capture.push(raw(message)));
  assert.equal(events.length, 2);
  assert.equal(events[0].ts, 2000);
  assert.equal(events[0].observedTs, 3000);
  assert.equal(events[0].fa.name, 'LEVEL_ANALYSIS');
  assert.equal(events[0].fa.params.Started, 8);
  assert.equal(events[0].fa.params.note, 'text with } and { inside');
  assert.equal(events[1].fa.name, 'screen_view');
  assert.equal(events[1].fa.auto, true);
  assert.equal(events[1].fa.params.ga_screen_id, '-2615377656110575353');
  assert.doesNotMatch(JSON.stringify(events), /do-not-include/);
});

test('shared PID/thread interleaving never includes another app or unscoped events', () => {
  const capture = new FirebaseServiceCapture(pkg);
  const events = [];
  events.push(...capture.push(raw(header(), 20)));
  events.push(...capture.push(raw(header('com.other.game'), 21)));
  for (const message of batch()) {
    events.push(...capture.push(raw(message, 20)));
    events.push(...capture.push(raw(message, 21)));
  }
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.fa.packageId === pkg));
  assert.equal(belongsToGame(raw(`Logging event: origin=app,name=x,params=Bundle[{package=${pkg}}]`), pkg, new Set()), false);
  assert.equal(belongsToGame(raw('Gms url request successful. app: com.other.game, GOOGLE_ANALYTICS'), pkg, new Set()), false);
  assert.equal(belongsToGame(raw(`Gms url request successful. app: ${pkg}, GOOGLE_ANALYTICS`), pkg, new Set()), true);
  assert.deepEqual([header('com.other.game'), ...batch()].flatMap((s) => capture.push(raw(s))), []);
});

test('mismatched bundle IDs, truncated batches, stale events and duplicate identity fields are rejected', () => {
  assert.deepEqual(parseFirebaseBatch(batch('com.other.game'), pkg), []);
  assert.deepEqual(parseFirebaseBatch(batch().slice(0, -1), pkg), []);
  assert.deepEqual(parseFirebaseBatch(batch(), pkg, 2002), []);
  const ambiguous = batch();
  ambiguous.splice(3, 0, '    app_id: com.other.game');
  assert.deepEqual(parseFirebaseBatch(ambiguous, pkg), []);
  const capture = new FirebaseServiceCapture(pkg);
  capture.push(raw(header()));
  capture.push(raw('batch {'));
  capture.push(raw('Network upload failed. Will retry later.'));
  assert.deepEqual(batch().slice(1).flatMap((s) => capture.push(raw(s))), []);
});

test('stream includes package-scoped upload events and status, deduplicates retries, and matches SDK handoffs', () => {
  const firebase = new FirebaseEvents();
  const stream = new LogStream({ source: { stop() {} }, pkg, onEntry: (e) => firebase.ingest(e) });
  stream.pids.add(10);
  stream.accept({ ...raw('Status Analytics.Event => Sent: Firebase event handed to SDK: LEVEL_ANALYSIS (Started=8) | AVNPLUGIN', 10, 1999), tag: 'Unity', pid: 10 });
  for (let attempt = 0; attempt < 2; attempt++) for (const message of [header(), ...batch()]) stream.accept(raw(message));
  stream.accept(raw(`Gms url request successful. app: ${pkg}, GOOGLE_ANALYTICS`, 20, 3100));
  const snapshot = firebase.snapshot(4000);
  assert.equal(snapshot.counts.firebase, 2);
  assert.equal(snapshot.counts.notLogged, 0);
  assert.equal(snapshot.rows.find((r) => r.name === 'LEVEL_ANALYSIS').check, 'matches-plugin');
  assert.equal(snapshot.diagnostics.upload.state, 'successful');
  assert.equal(snapshot.diagnostics.upload.ts, 3100);
  assert.equal(stream.buffer.filter((e) => e.fa).length, 4);
  // Recorded evidence is app/event-scoped, without shared-service user properties.
  assert.doesNotMatch(JSON.stringify(stream.buffer), /do-not-include/);
});

test('process restart drops incomplete prior-process upload batches', () => {
  const stream = new LogStream({ source: { stop() {} }, pkg });
  stream.accept(raw(header()));
  stream.accept(raw('batch {'));
  stream.accept({ ...raw(`Start proc 11:${pkg}/u0a1 for top-activity`, 1, 4000), tag: 'ActivityManager', pid: 1 });
  for (const line of batch().slice(1)) stream.accept(raw(line, 20, 4001));
  assert.equal(stream.buffer.filter((e) => e.fa).length, 0);
  for (const line of [header(), ...batch()]) stream.accept(raw(line, 20, 4002));
  assert.equal(stream.buffer.filter((e) => e.fa).length, 0);
});

test('delayed upload levels cannot rewind live levels or disable subsequent live level updates', () => {
  const health = new Health({});
  const pluginLevel = (level, ts) => ({ ts, tag: 'Unity', message: 'level', source: 'avn', avn: { kind: 'status', key: 'Analytics.Event', state: 'Sent', message: 'level', event: { name: 'level_start', params: { level } } } });
  const uploadedLevel = (level, ts) => ({ ts, tag: 'FA-SVC', message: 'upload event', source: 'firebase', fa: { name: 'level_start', params: { level }, evidence: 'upload-batch' } });
  health.ingest(pluginLevel(8, 2000));
  health.ingest(uploadedLevel(7, 1000));
  assert.equal(health.snapshot().levels.current, 8);
  health.ingest(uploadedLevel(9, 3000));
  health.ingest(pluginLevel(10, 4000));
  assert.equal(health.snapshot().levels.current, 10);
});
