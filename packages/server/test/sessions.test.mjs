import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import WebSocket from 'ws';

// This worker owns a temporary history store; never touch the user's captures.
const sessionTestHome = mkdtempSync(join(tmpdir(), 'playlens-session-tests-'));
mock.method(os, 'homedir', () => sessionTestHome);
const { SessionRecorder, listSessions, sessionDetails, sessionText, deleteSession, SESSIONS_DIR } = await import('../src/session/recorder.mjs');
const { createServer } = await import('../src/api/server.mjs');
const { RulesStore } = await import('../src/rules/loader.mjs');
const { Health } = await import('../src/monitor/health.mjs');
const { classify } = await import('../src/logcat/parse.mjs');
const { adbSource } = await import('../src/session/stream.mjs');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 150; i++) { const v = await fn(); if (v) return v; await pause(25); } throw new Error('condition timed out'); }
const entry = (message, id = 1) => ({ ts: Date.now(), pid: 123, tid: 123, level: 'I', tag: 'Unity', message, id });
const capture = () => new SessionRecorder({ serial: 'PHONE', pkg: 'com.demo.game', deviceName: 'Phone' });

test('named sessions save readable active exports, preserve short explicit saves, and delete all artifacts', async () => {
  const rec = capture();
  rec.write(entry('one line'));
  await rec.save({ events: 1 }, { snapshot: { firebase: { rows: [{ name: 'first_event' }] } }, perf: { samples: [1] } });
  assert.match(rec.meta.name, /^Session \d+$/);
  assert.match(sessionText(rec.id), /one line/);
  assert.equal(sessionDetails(rec.id).snapshot.firebase.rows[0].name, 'first_event');
  assert.throws(() => deleteSession(rec.id), /still recording/);
  await rec.finish();
  assert.equal(listSessions().find((s) => s.id === rec.id).active, false);
  assert.equal(deleteSession(rec.id), true);
  assert.equal(sessionDetails(rec.id), null);
  for (const ext of ['jsonl.gz', 'snapshot.json', 'perf.json']) assert.equal(existsSync(join(SESSIONS_DIR, `${rec.id}.${ext}`)), false);
  assert.equal(deleteSession('../outside'), false);
});

test('discard removes an already-saved capture; short unsaved captures leave no orphan files', async () => {
  const rec = capture();
  rec.write(entry('discard me'));
  await rec.save();
  await rec.finish({}, { save: false });
  assert.equal(listSessions().some((s) => s.id === rec.id), false);
  assert.ok(!readdirSync(SESSIONS_DIR).some((f) => f.startsWith(rec.id)));
  const short = capture();
  short.write(entry('not retained'));
  await short.finish();
  assert.ok(!readdirSync(SESSIONS_DIR).some((f) => f.startsWith(short.id)));
});

test('ad counters and SDK callbacks update Now without separate hub status, without double-counting', () => {
  const h = new Health(null);
  const ingest = (message, ts) => h.ingest(classify({ ...entry(message), ts }));
  ingest('Status Ad.Interstitial.0 => Loading: requested | AVNPLUGIN', 1);
  ingest('Counter Ad.Interstitial.0 AdsLoaded=1 | AVNPLUGIN', 2);
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Loaded');
  ingest('SDKCallback | InterAd | Loaded | slot=0 unit=x network=MAX | AVNPLUGIN', 3);
  assert.equal(h.funnels['Ad.Interstitial.0'].loaded, 1);
  ingest('Status Ad.Interstitial.0 => Info: diagnostic message | AVNPLUGIN', 4);
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Loaded');
  ingest('SDKCallback | InterAd | Displayed | slot=0 unit=x | AVNPLUGIN', 5);
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Showed');
  ingest('SDKCallback | InterAd | Loaded ignored: stale callback | slot=0 unit=x | AVNPLUGIN', 6);
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Showed');
  ingest('SDKCallback | InterAd | Closed | slot=0 unit=x | AVNPLUGIN', 7);
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Closed');
});

test('fresh logcat uses phone time and excludes a prior session event', async () => {
  const stdout = new PassThrough();
  let command;
  const proc = new EventEmitter(); proc.stdout = stdout; proc.kill = () => {};
  const source = adbSource({ shell: async () => '100.500000000\n', spawn: (args) => { command = args; return proc; } }, 'PHONE');
  const lines = [];
  source.start((line) => lines.push(line), () => {});
  await until(() => command);
  stdout.write('100.100 123 123 I FA: old_event\n100.600 123 123 I FA: new_event\n');
  assert.deepEqual(command.slice(-2), ['-T', '100.500000000']);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /new_event/);
  source.stop();
});

test('WebSocket session changes isolate Firebase, support save/discard, and split a game restart', async (t) => {
  let stdout;
  const adb = {
    shell: async (_s, cmd) => cmd.startsWith('date ') ? `${Date.now() / 1000}\n` : cmd.startsWith('ps ') ? '123 com.demo.game\n' : '',
    run: async () => '',
    spawn: () => { const proc = new EventEmitter(); proc.stdout = stdout = new PassThrough(); proc.kill = () => {}; return proc; },
  };
  const rules = new RulesStore({ dir: mkdtempSync(join(tmpdir(), 'playlens-session-rules-')) });
  const server = createServer({ port: 7495, staticDir: null, adb, rules, record: true, games: { list: () => [{ packageId: 'com.demo.game', name: 'Demo' }] },
    devices: () => [{ serial: 'PHONE', state: 'device', info: { model: 'Test' } }], onDevices: () => {}, status: () => ({}) });
  await server.listen();
  const ws = new WebSocket('ws://127.0.0.1:7495/ws');
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  t.after(async () => { ws.close(); await pause(50); await server.close(); rules.close(); });
  const send = (m) => ws.send(JSON.stringify(m));
  const emit = (tag, message) => stdout.write(`${((Date.now() + 10) / 1000).toFixed(3)} 123 123 I ${tag}: ${message}\n`);
  send({ type: 'stream.start', serial: 'PHONE', all: true, streamId: 99 });
  await until(() => messages.find((m) => m.type === 'stream.state' && m.streamId === 99 && m.state === 'error'));
  assert.equal(stdout, undefined, 'an unscoped capture must never start adb logcat');
  send({ type: 'stream.start', serial: 'PHONE', pkg: 'com.demo.game', streamId: 1 });
  const first = await until(() => messages.find((m) => m.type === 'session' && m.streamId === 1));
  await until(() => stdout);
  emit('FA', 'Logging event (FE): first_capture, Bundle[{level=1}]');
  emit('Unity', 'Status Ad.Interstitial.0 => Loading: request | AVNPLUGIN');
  emit('Unity', 'Counter Ad.Interstitial.0 AdsLoaded=1 | AVNPLUGIN');
  await until(() => messages.find((m) => m.type === 'monitor' && m.firebase?.rows.some((e) => e.name === 'first_capture')));
  stdout.write(`${((Date.now() + 10) / 1000).toFixed(3)} 999 999 I FA: Logging event (FE): foreign_app, Bundle[{level=99}]\n`);
  send({ type: 'stream.pause', streamId: 1 });
  await until(() => messages.find((m) => m.type === 'session' && m.streamId === 1 && m.paused));
  assert.equal(sessionDetails(first.id), null, 'leaving a game page must not auto-save its capture');
  const beforePause = messages.filter((m) => m.type === 'log.batch').length;
  emit('FA', 'Logging event (FE): during_pause, Bundle[{level=9}]');
  await pause(120);
  assert.equal(messages.filter((m) => m.type === 'log.batch').length, beforePause);
  const sessionCount = messages.filter((m) => m.type === 'session').length;
  send({ type: 'stream.resume', streamId: 1 });
  await until(() => messages.filter((m) => m.type === 'session').length > sessionCount && messages.filter((m) => m.type === 'session').at(-1).paused === false);
  assert.equal(messages.filter((m) => m.type === 'session' && m.streamId === 1).at(-1).id, first.id, 'resume preserves the session');
  emit('FA', 'Logging event (FE): after_resume, Bundle[{level=10}]');
  emit('Unity', 'resume boundary');
  const resumed = await until(() => messages.find((m) => m.type === 'monitor' && m.streamId === 1 && m.firebase?.rows.some((e) => e.name === 'after_resume')));
  assert.ok(resumed.firebase.rows.some((e) => e.name === 'first_capture'));
  assert.ok(!resumed.firebase.rows.some((e) => ['during_pause', 'foreign_app'].includes(e.name)));
  send({ type: 'session.save', streamId: 1 });
  await until(() => messages.find((m) => m.type === 'session' && m.id === first.id && m.saved));
  assert.match(sessionText(first.id), /first_capture/);
  send({ type: 'stream.start', serial: 'PHONE', pkg: 'com.demo.game', streamId: 2, previous: 'save' });
  const second = await until(() => messages.find((m) => m.type === 'session' && m.streamId === 2));
  assert.notEqual(first.id, second.id);
  const clean = await until(() => messages.find((m) => m.type === 'monitor' && m.streamId === 2));
  assert.equal(clean.firebase.rows.length, 0);
  assert.equal(clean.health.funnels.length, 0);
  emit('FA', 'Logging event (FE): second_capture, Bundle[{level=2}]');
  emit('Unity', 'another line');
  await until(() => messages.find((m) => m.type === 'monitor' && m.streamId === 2 && m.firebase?.rows.some((e) => e.name === 'second_capture')));
  send({ type: 'session.save', streamId: 2 });
  await until(() => messages.find((m) => m.type === 'session' && m.id === second.id && m.saved));
  const archived = await (await fetch(`http://127.0.0.1:7495/api/sessions/${first.id}`)).json();
  assert.ok(archived.snapshot.firebase.rows.some((e) => e.name === 'first_capture'));
  assert.ok(!archived.entries.some((e) => /second_capture/.test(e.message)));
  send({ type: 'stream.start', serial: 'PHONE', pkg: 'com.demo.game', streamId: 3, previous: 'discard' });
  await until(() => messages.find((m) => m.type === 'session' && m.streamId === 3));
  assert.equal(sessionDetails(second.id), null);
  emit('FA', 'Logging event (FE): before_restart, Bundle[{level=3}]');
  emit('Unity', 'before restart');
  await until(() => messages.find((m) => m.type === 'monitor' && m.streamId === 3 && m.firebase?.rows.some((e) => e.name === 'before_restart')));
  emit('ActivityManager', 'Start proc 999:com.demo.game/u0a1 for top-activity');
  emit('FA', 'Logging event (FE): after_restart, Bundle[{level=4}]');
  emit('Unity', 'after restart');
  const boundary = await until(() => messages.find((m) => m.type === 'session' && m.streamId === 3 && m.reset));
  assert.equal(boundary.reason, 'Game restarted');
  const after = await until(() => messages.find((m) => m.type === 'monitor' && m.streamId === 3 && m.firebase?.rows.some((e) => e.name === 'after_restart')));
  assert.ok(!after.firebase.rows.some((e) => e.name === 'before_restart'));
  send({ type: 'stream.stop' });
  send({ type: 'session.discard', id: boundary.id });
  send({ type: 'stream.start', serial: 'PHONE', pkg: 'com.demo.game', streamId: 4 });
  await until(() => messages.find((m) => m.type === 'session' && m.streamId === 4));
  assert.equal(sessionDetails(boundary.id), null, 'discard after Stop must remove the completed capture');
  const deleted = await fetch(`http://127.0.0.1:7495/api/sessions/${first.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(`http://127.0.0.1:7495/api/sessions/${first.id}`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:7495/api/sessions/UNKNOWN`, { method: 'DELETE' })).status, 404);
});

test('a fresh capture does not import historical cumulative ad counters', () => {
  const h = new Health(null);
  for (const [value, ts] of [[8, 1], [9, 2]]) h.ingest(classify({ ...entry(`Counter Ad.Interstitial.0 AdsLoaded=${value} | AVNPLUGIN`), ts }));
  assert.equal(h.funnels['Ad.Interstitial.0'].loaded, 2);
});

test('a short session with Firebase events is retained when explicitly saved on a game boundary', async () => {
  const rec = capture();
  rec.write(entry('one Firebase event'));
  await rec.finish({ events: 1 }, { save: true, snapshot: { firebase: { rows: [{ name: 'short_session_event' }] } } });
  assert.equal(sessionDetails(rec.id).snapshot.firebase.rows[0].name, 'short_session_event');
  deleteSession(rec.id);
});

test('unsaved captures are discarded by default even with many lines and Firebase evidence', async () => {
  const rec = capture();
  for (let i = 0; i < 100; i++) rec.write(entry(`unsaved ${i}`, i));
  await rec.finish({ events: 1 }, { snapshot: { firebase: { rows: [{ name: 'unsaved_event' }] } } });
  assert.equal(sessionDetails(rec.id), null);
  assert.ok(!readdirSync(SESSIONS_DIR).some((file) => file.startsWith(rec.id)));
});

test('a subprocess launch does not reset the main game ad state', () => {
  const h = new Health(null);
  h.pkg = 'com.demo.game';
  h.ingest(classify(entry('Counter Ad.Interstitial.0 AdsLoaded=1 | AVNPLUGIN')));
  h.ingest({ ...entry('Start proc 900:com.demo.game:ads/u0a1 for service'), tag: 'ActivityManager' });
  assert.equal(h.funnels['Ad.Interstitial.0'].state, 'Loaded');
});

test('session names count per game and saved captures retain the game and installed version', async () => {
  const a = new SessionRecorder({ serial: 'PHONE', pkg: 'com.library.alpha', deviceName: 'Phone', game: { id: 'alpha', name: 'Alpha' } });
  const b = new SessionRecorder({ serial: 'PHONE', pkg: 'com.library.beta', deviceName: 'Phone', game: { id: 'beta', name: 'Beta' } });
  const a2 = new SessionRecorder({ serial: 'PHONE', pkg: 'com.library.alpha', deviceName: 'Phone' });
  assert.equal(a.meta.name, 'Session 1');
  assert.equal(b.meta.name, 'Session 1');
  assert.equal(a2.meta.name, 'Session 2');
  a.write(entry('Alpha capture'));
  await a.save({}, { snapshot: { app: { versionName: '2.4.1', versionCode: 241 } } });
  await a.finish();
  assert.equal(sessionDetails(a.id).session.gameName, 'Alpha');
  assert.equal(sessionDetails(a.id).session.versionName, '2.4.1');
  assert.equal(sessionDetails(a.id).session.versionCode, 241);
  await b.finish({}, { save: false });
  await a2.finish({}, { save: false });
  deleteSession(a.id);
});
