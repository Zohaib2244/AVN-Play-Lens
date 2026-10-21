import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grouper, classify } from '../src/logcat/parse.mjs';
import { Health } from '../src/monitor/health.mjs';
import { ingestRemoteValue } from '../src/monitor/remote-config.mjs';

const stack = ['UnityEngine.DebugLogHandler:Internal_Log(LogType, LogOption, String, Object)',
  'AVN.AdsPlugin.Services.FirebaseRemoteConfigService:DispatchCustomKeys()'];

test('Remote Config parses complete values without Unity stack traces and preserves real truncation', () => {
  const values = {};
  const add = (text, more = stack) => ingestRemoteValue(values, text, { ts: 1, id: 1, more });
  add('Dispatched custom key=GameSettings source=Remote with value: {"LevelsPerTheme":2,"meta":{"note":"a:b(c)"}}');
  add('Dispatched custom key=LevelSequence source=Remote with value: [2,3,4,1]');
  add('Dispatched custom key=TaichiThresholds source=Remote with value: ');
  add('Registered custom key=label, type=System.String');
  add('Dispatched custom key=label source=Remote with value: 123');
  add('Dispatched custom key=partial source=Remote with value: [2,3,4,… (+1655 chars)');
  assert.deepEqual(values.GameSettings.value, { LevelsPerTheme: 2, meta: { note: 'a:b(c)' } });
  assert.equal(values.GameSettings.truncated, false);
  assert.deepEqual(values.LevelSequence.value, [2, 3, 4, 1]);
  assert.equal(values.LevelSequence.type, 'array');
  assert.equal(values.TaichiThresholds.value, '');
  assert.equal(values.label.value, '123');
  assert.equal(values.label.declaredType, 'System.String');
  assert.equal(values.partial.truncated, true);
  for (const v of Object.values(values)) assert.doesNotMatch(v.raw ?? '', /Internal_Log|DispatchCustomKeys/);
});

test('multiline JSON retains its value and excludes the following logging stack', () => {
  const values = {};
  ingestRemoteValue(values, 'AdIdsConfig updated from fetch : {', {
    ts: 1, id: 1, more: ['  "InterAdUnitIds": ["unit-1"],', '  "BannerAdUnitId": "unit-2"', '} | AVNPLUGIN', ...stack],
  });
  assert.equal(values.AdIdsConfig.truncated, false);
  assert.deepEqual(values.AdIdsConfig.value.InterAdUnitIds, ['unit-1']);
});

test('separate Remote Config records in the same millisecond each keep their own value and evidence', () => {
  const health = new Health({});
  const entries = [];
  const g = new Grouper((raw) => { const e = { ...classify(raw), id: entries.length + 1 }; entries.push(e); health.ingest(e); });
  for (const message of ['Status RemoteConfig.Values => Loaded: AdConfig updated from fetch : {"EnableInterFromLevel":2} | AVNPLUGIN',
    ...stack, 'Status RemoteConfig.Values => Loaded: AdIdsConfig updated from fetch : {"InterAdUnitIds":["unit-1"]} | AVNPLUGIN', ...stack]) {
    g.push({ ts: 1, pid: 10, tid: 11, tag: 'Unity', level: 'I', message });
  }
  g.flush();
  assert.equal(entries.length, 2);
  const values = health.snapshot().rc.values;
  assert.deepEqual(values.map((v) => v.name), ['AdConfig', 'AdIdsConfig']);
  assert.ok(values.every((v) => !v.truncated));
  assert.notEqual(values[0].entryId, values[1].entryId);
});
