import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildReportStore, BuildVerification, buildMatch } from '../src/monitor/build-report.mjs';
import { Monitor } from '../src/monitor/monitor.mjs';
import { RulesStore } from '../src/rules/loader.mjs';
import { classify } from '../src/logcat/parse.mjs';
import { ingestRemoteValue, remoteVariables } from '../src/monitor/remote-config.mjs';
import { parseReportWords, tsvWords } from '../../web/src/report-import.mjs';
import { buildReport } from '../src/monitor/report.mjs';
import { createServer } from '../src/api/server.mjs';
import { replayDevice } from '../src/replay/source.mjs';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const pkg = 'com.test.game';
const app = { versionName: '0.1.3', versionCode: 13, permissions: ['android.permission.INTERNET'], minSdk: 25, sensitive: [] };
const row = (label, section, value = 'PASS') => ({ label, section, value, id: label });
const report = { id: 'source', packageId: pkg, versionName: '0.1.3', versionCode: '13', rows: [row('Google Analytics (USE_FIREBASE)', '4. SCRIPTING DEFINE SYMBOLS'), row('Firebase Remote Config', '6. PACKAGE DEPENDENCIES'), row('INTERNET', '5. ANDROID MANIFEST PERMISSIONS'), row('Minimum API Level', '7. UNITY PLAYER SETTINGS', 'PASS (25)'), row('Custom Main Gradle Template', '7. UNITY PLAYER SETTINGS'), row('Interstitial', '2. ADS IDS', 'unit-1'), row('ByteBrew (USE_BYTEBREW)', '4. SCRIPTING DEFINE SYMBOLS', 'INACTIVE')] };
const entry = (message, ts = Date.now(), tag = 'Unity') => ({ ...classify({ message, tag, ts, level: 'I' }, pkg), id: ts });

test('build identity requires package, version and build number, including a loaded app profile', () => {
  assert.equal(buildMatch(null, pkg, app).ok, false);
  assert.equal(buildMatch(report, pkg, null).ok, false);
  assert.equal(buildMatch(report, 'com.wrong.game', app).ok, false);
  assert.equal(buildMatch(report, pkg, { ...app, versionCode: 14 }).ok, false);
  assert.equal(buildMatch(report, pkg, { ...app, versionName: '0.1.4' }).ok, false);
  assert.equal(buildMatch(report, pkg, app).ok, true);
});

test('upload persists the original PDF and rejects missing rows, invalid identities and invalid PDFs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-build-'));
  try {
    const store = new BuildReportStore(dir);
    const pdf = Buffer.from('%PDF-1.7\nfixture').toString('base64');
    const saved = store.save({ ...report, filename: 'publishing.pdf', pdf });
    assert.equal(store.get(pkg).id, saved.id);
    assert.equal(store.pdf(saved.id).toString(), '%PDF-1.7\nfixture');
    assert.throws(() => store.save({ ...report, pdf: 'bad' }), /valid PDF/);
    assert.throws(() => store.save({ ...report, rows: [], pdf }), /For Dev/);
    assert.throws(() => store.save({ ...report, packageId: '../../x', pdf }), /package/);
    assert.equal(store.pdf('../../x'), null);
    assert.equal(store.get('../../x'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('For Dev keeps original results, separates static matches/manual checks, and requires feature evidence', () => {
  const v = new BuildVerification(report, app);
  const get = (label) => v.snapshot().rows.find((r) => r.label === label);
  assert.equal(get('INTERNET').status, 'matched');
  assert.equal(get('Minimum API Level').status, 'matched');
  assert.equal(get('Custom Main Gradle Template').status, 'manual');
  assert.equal(get('ByteBrew (USE_BYTEBREW)').status, 'not-applicable');
  v.ingest(entry('Status SDK.Firebase => Initialized: Ready | AVNPLUGIN', 1));
  assert.equal(get('Google Analytics (USE_FIREBASE)').status, 'pending');
  v.ingest({ ts: 2, id: 2, message: 'Firebase event', fa: { name: 'level_start', params: {} } });
  assert.equal(get('Google Analytics (USE_FIREBASE)').status, 'verified');
  assert.equal(get('Google Analytics (USE_FIREBASE)').value, 'PASS');
  v.ingest(entry('Status SDK.RemoteConfig => Initialized: Remote config fetched | AVNPLUGIN', 3));
  assert.equal(get('Firebase Remote Config').status, 'pending', 'generic completion cannot prove a successful server fetch');
  v.ingest(entry('Status SDK.RemoteConfig => Initialized: FetchRemoteConfig success: config fetched and activated (lastFetchStatus=Success, fetchTime=2026-10-22) | AVNPLUGIN', 4));
  assert.equal(get('Firebase Remote Config').status, 'verified');
  v.ingest(entry('SDKCallback | InterAd | Displayed | unit=other slot=0 | AVNPLUGIN', 5));
  v.ingest(entry('SDKCallback | InterAd | RevenuePaid | unit=unit-1 slot=0 revenue=0.1 | AVNPLUGIN', 6));
  assert.equal(get('Interstitial').status, 'pending');
  v.ingest(entry('SDKCallback | InterAd | Displayed | unit=unit-1 slot=0 | AVNPLUGIN', 7));
  v.ingest(entry('SDKCallback | InterAd | RevenuePaid ignored: stale callback | unit=unit-1 slot=0 revenue=0.1 | AVNPLUGIN', 8));
  assert.equal(get('Interstitial').status, 'pending');
  v.ingest(entry('SDKCallback | InterAd | RevenuePaid | unit=unit-1 slot=0 revenue=0.1 | AVNPLUGIN', 9));
  assert.equal(get('Interstitial').status, 'verified');
  assert.equal(get('Interstitial').evidence.entryId, 9);
});

test('checklist rejects a missing/mismatched report; pre-run state cannot satisfy a fresh check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-verify-'));
  try {
    const rules = new RulesStore({ dir }); rules.create(pkg);
    const m = new Monitor({ rules, pkg }); m.app = app;
    assert.throws(() => m.startRun(), /Upload/);
    m.buildReport = { ...report, versionCode: '12' };
    assert.throws(() => m.startRun(), /does not match/);
    m.buildReport = report;
    m.ingest(entry('Status SDK.Firebase => Initialized: Ready | AVNPLUGIN', 1));
    m.startRun();
    assert.equal(m.snapshot().run.build.rows[0].status, 'pending');
    assert.equal(m.snapshot().run.items.find((r) => r.id === 'startup-health:startup').status, 'pending');
    m.ingest({ ts: Date.now() + 10, id: 2, message: 'Firebase event', fa: { name: 'level_start', params: { level: 1 } } });
    assert.equal(m.snapshot().run.build.rows[0].status, 'pending', 'pre-run Firebase init cannot combine with an in-run event');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Remote Config includes scalar values, registered string types, nested JSON, cache/default sources and truncation', () => {
  const values = {};
  const add = (text) => ingestRemoteValue(values, text, { id: 10, ts: 20 });
  add('Registered custom key=label, type=System.String');
  add('Dispatched custom key=label source=Remote with value: 123');
  add('Dispatched custom key=enabled source=Remote with value: false');
  add('Dispatched custom key=ratio source=Default with value: 0.5');
  add('Dispatched custom key=empty source=Remote with value: null');
  add('Custom key=legacy value loaded from cache: 0');
  add('AdConfig updated from fetch : {"delay":0,"flags":{"banner":false},"ids":["a"]}');
  add('Dispatched custom key=long source=Remote with value: {"partial":… (+200 chars)');
  const list = remoteVariables({ values: Object.values(values), sources: { AdConfig: 'Remote' } });
  const r = Object.fromEntries(list.map((v) => [v.name, v]));
  assert.equal(r.label.type, 'string'); assert.equal(r.label.value, '123');
  assert.equal(r.enabled.type, 'boolean'); assert.equal(r.enabled.value, false);
  assert.equal(r.ratio.source, 'Default'); assert.equal(r.ratio.type, 'number');
  assert.equal(r.empty.type, 'null'); assert.equal(r.empty.value, null);
  assert.equal(r.legacy.source, 'Cache'); assert.equal(r.legacy.value, 0);
  assert.equal(r['AdConfig.delay'].value, 0); assert.equal(r['AdConfig.flags.banner'].type, 'boolean');
  assert.equal(r['AdConfig.ids[0]'].value, 'a'); assert.equal(r.AdConfig.source, 'Remote');
  assert.equal(r.long.truncated, true); assert.equal(r.long.type, 'unknown');
});

test('positioned report parser keeps For Dev sections across pages and extracts build identity', () => {
  const w = (text, x, y) => ({ text, x, y, h: .01 });
  const r = parseReportWords([
    [w('Package Name', .08, .1), w(pkg, .48, .1), w('Version (bundleVersion)', .08, .15), w('0.1.3', .48, .15), w('Bundle Version Code', .08, .2), w('13', .48, .2), w('FOR DEV', .08, .3), w('2. ADS IDS', .08, .35), w('Banner', .08, .4), w('unit-a', .48, .4)],
    [w('Interstitial', .08, .1), w('unit-b', .48, .1), w('3. IN-APP PURCHASES', .08, .2), w('In-App Purchasing', .08, .25), w('ENABLED', .48, .25)],
  ]);
  assert.equal(r.packageId, pkg); assert.equal(r.versionCode, '13');
  assert.equal(r.rows.length, 3); assert.equal(r.rows[1].section, '2. ADS IDS'); assert.equal(r.rows[1].page, 2);
  assert.equal(tsvWords('header\n5\t1\t1\t1\t1\t1\t10\t20\t20\t10\t90\tPASS', 100, 100)[0].text, 'PASS');
});

test('exports retain original For Dev results, evidence, replay provenance and typed Remote Config values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-report-export-'));
  try {
    const v = new BuildVerification({ ...report, filename: 'publishing.pdf' }, { ...app, replay: true });
    v.ingest(entry('Status SDK.Firebase => Initialized: Ready | AVNPLUGIN', 1));
    v.ingest({ ts: 2, id: 2, message: '<script>unsafe</script>', fa: { name: 'level_start' } });
    const result = buildReport({ id: 'test', dir, run: { startedAt: 1, finishedAt: 100, profileFile: 'game.yaml' }, items: [], flags: [], crashes: [], health: { rc: { variables: [{ name: 'active', type: 'boolean', value: false, hasValue: true, source: 'Remote', from: 'fetch', ts: 3 }] } }, build: v.snapshot(), pkg, device: 'Test' });
    const html = readFileSync(join(dir, 'test.html'), 'utf8');
    const md = readFileSync(join(dir, 'test.md'), 'utf8');
    assert.equal(result.buildVerified, 1);
    assert.equal(result.buildTotal, report.rows.length);
    assert.match(html, /REPLAY - simulated evidence/);
    assert.match(html, /Build report result/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.ok(!html.includes('<script>unsafe</script>'));
    assert.match(md, /\| active \| false \| boolean \|/);
    assert.match(md, /Google Analytics \(USE_FIREBASE\).*PASS.*Verified/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP upload preserves the PDF; WebSocket run start cannot bypass report/build matching', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-build-api-'));
  const rules = new RulesStore({ dir: join(dir, 'rules') }); rules.create(pkg);
  const replay = { pkg, device: replayDevice(pkg), file: fileURLToPath(new URL('../fixtures/demo.logcat', import.meta.url)) };
  const port = 7489;
  const server = createServer({ port, staticDir: null, rules, replay, record: false, buildReports: new BuildReportStore(join(dir, 'reports')), games: { list: () => [{ packageId: pkg, name: 'Test' }] }, devices: () => [replay.device], onDevices: () => {}, status: () => ({}) });
  await server.listen();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(d)));
  t.after(async () => { ws.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve) => ws.on('open', resolve));
  const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { const result = messages.find(fn); if (result) return result; await new Promise((r) => setTimeout(r, 25)); } throw new Error('WebSocket result timed out'); };
  const send = (m) => ws.send(JSON.stringify(m));
  send({ type: 'stream.start', serial: 'replay', pkg, streamId: 1 });
  await waitFor((m) => m.type === 'monitor');
  send({ type: 'run.start' });
  await waitFor((m) => m.type === 'error' && /Upload/.test(m.message));
  const post = (data) => fetch(`http://127.0.0.1:${port}/api/build-reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const pdf = Buffer.from('%PDF-1.7\nfixture').toString('base64');
  const saved = await (await post({ ...report, pdf })).json();
  const download = await fetch(`http://127.0.0.1:${port}/api/build-reports/${saved.report.id}.pdf`);
  assert.equal(await download.text(), '%PDF-1.7\nfixture');
  send({ type: 'run.start' });
  await waitFor((m) => m.type === 'error' && /does not match installed/.test(m.message));
  assert.equal((await post({ ...report, versionName: '1.4.0', versionCode: 140, pdf })).status, 201);
  send({ type: 'run.start' });
  const live = await waitFor((m) => m.type === 'monitor' && m.run?.active);
  assert.equal(live.run.build.simulated, true);
  assert.equal(live.run.build.rows.length, report.rows.length);
  assert.equal(live.run.build.rows[0].status, 'pending');
  assert.ok(Array.isArray(live.run.rc.variables));
});
