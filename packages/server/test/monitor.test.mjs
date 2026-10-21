// The live models fed with the demo capture (fixtures/demo.logcat), which follows the
// AVN plugin log reference: plugin health, flags, Firebase cross-check, checklist, report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLogcatLine, Grouper, classify } from '../src/logcat/parse.mjs';
import { RulesStore, profileTemplate } from '../src/rules/loader.mjs';
import { matches } from '../src/rules/match.mjs';
import { checkParams } from '../src/monitor/checklist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = 'com.avn.demo';

function demoEntries() {
  const out = [];
  const g = new Grouper((e) => out.push(e));
  for (const line of readFileSync(join(here, '..', 'fixtures', 'demo.logcat'), 'utf8').split('\n')) {
    const p = parseLogcatLine(line);
    if (p) g.push(p);
  }
  g.flush();
  return out.map((e, i) => ({ ...classify(e, PKG), id: i + 1 }));
}

function rulesWithProfile(profileText) {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-rules-'));
  if (profileText) writeFileSync(join(dir, `${PKG}.yaml`), profileText);
  return new RulesStore({ dir });
}

test('matcher: regex, negation, any, dotted paths', () => {
  const e = { level: 'W', tag: 'Unity', message: 'x', source: 'avn', avn: { kind: 'rc-sources', sources: { AdConfig: 'Remote', AdIdsConfig: 'Default' } } };
  assert.equal(matches(e, { kind: 'rc-sources', 'sources.AdIdsConfig': '!Remote' }), true);
  assert.equal(matches(e, { kind: 'rc-sources', 'sources.AdConfig': '!Remote' }), false);
  assert.equal(matches(e, { any: [{ kind: 'nope' }, { level: '/^[WE]$/' }] }), true);
});

test('param checks', () => {
  assert.deepEqual(checkParams({ level: '3' }, { level: { type: 'number', required: true } }), []);
  assert.equal(checkParams({}, { level: { required: true } })[0], 'level is missing');
  assert.match(checkParams({ stars: '5' }, { stars: { range: [0, 3] } })[0], /expected 0 to 3/);
  assert.match(checkParams({ cur: 'usd' }, { cur: { regex: '^[A-Z]{3}$' } })[0], /doesn't match/);
  assert.match(checkParams({ extra: '1' }, {}, true)[0], /unexpected parameter extra/);
});

test('monitor: health, flags, Firebase cross-check from the demo capture', async () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'playlens-home-'));
  const { Monitor } = await import('../src/monitor/monitor.mjs');
  const m = new Monitor({ rules: rulesWithProfile(null), pkg: PKG, deviceName: 'Test' });
  const entries = demoEntries();
  for (const e of entries) m.ingest(e);
  const end = entries.at(-1).ts + 10000;
  const s = m.snapshot(end);

  const steps = Object.fromEntries(s.health.startup.map((x) => [x.id, x.status]));
  assert.equal(steps.firebase, 'done');
  assert.equal(steps.max, 'done');
  assert.equal(steps.done, 'done');
  assert.equal(steps.autoload, 'done');
  assert.equal(s.health.debugLogs, 'on');
  assert.equal(s.health.sdks.find((x) => x.key === 'SDK.Firebase').state, 'Initialized');
  assert.ok(s.health.sdks.find((x) => x.key === 'SDK.ByteBrew').notUsed);

  const inter = s.health.funnels.find((f) => f.key === 'Ad.Interstitial.0');
  assert.deepEqual([inter.loadSent, inter.loaded, inter.showSent, inter.shown, inter.closed, inter.paid], [1, 1, 2, 2, 2, 2]);
  assert.equal(s.health.funnels.find((f) => f.key === 'Ad.Rewarded').loadFailed, 1);
  assert.ok(Math.abs(s.health.revenue.total - 0.0241) < 1e-9);
  assert.equal(s.health.adapters.find((a) => a.name === 'Moloco').status, 'InitializedFailure');
  assert.equal(s.health.rc.sources.AdIdsConfig, 'Default');
  assert.equal(s.health.rc.adConfig.InterAdDelay, '30');

  const flagIds = s.flags.map((f) => f.id);
  for (const id of ['adapter-failed', 'rc-not-from-server', 'ad-load-failed', 'revenue']) assert.ok(flagIds.includes(id), `flag ${id}`);

  const rows = s.firebase.rows;
  assert.equal(rows.find((r) => r.name === 'tutorial_complete').check, 'not-in-firebase');
  assert.equal(rows.find((r) => r.name === 'level_start').check, 'matches-plugin');
  assert.equal(rows.find((r) => r.name === 'session_start').check, 'automatic');
  assert.equal(s.firebase.counts.notLogged, 1);
  assert.ok(s.crashes.some((c) => c.kind === 'exception'));
});

test('owners, launch timeline, remote config values, ad rules, consent, SDKs', async () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'playlens-home-'));
  const { Monitor } = await import('../src/monitor/monitor.mjs');
  const m = new Monitor({ rules: rulesWithProfile(null), pkg: PKG, deviceName: 'Test' });
  m.app = { adId: true, sensitive: [{ id: 'android.permission.CAMERA', name: 'Camera', granted: false }] };
  m.apkSdks = [{ name: 'Unity Ads', version: '4.12.3' }, { name: 'AppLovin MAX', version: '13.0.1' }, { name: 'IL2CPP' }];
  const entries = demoEntries();
  for (const e of entries) m.ingest(e);
  const s = m.snapshot(entries.at(-1).ts + 1000);

  // Owners of warnings and errors
  const owner = (re) => entries.find((e) => re.test(e.message))?.owner;
  assert.equal(owner(/chroma siting/), 'android');
  assert.equal(owner(/Unknown ad format/), 'sdk');
  assert.equal(owner(/^NullReferenceException/), 'game');
  assert.equal(owner(/DOTWEEN/), 'game');
  assert.equal(owner(/Suspending all threads/), 'android');
  assert.equal(owner(/Rewarded load failed|LoadFailed/), 'avn');
  const mali = entries.filter((e) => /chroma siting/.test(e.message));
  assert.equal(new Set(mali.map((e) => e.gkey)).size, 1, 'repeats share a group key');
  assert.ok(mali[0].safe && mali[0].meaning);

  // Launch timeline
  const launch = Object.fromEntries(s.health.launch.steps.map((x) => [x.id, x]));
  assert.equal(s.health.launch.captured, true);
  assert.equal(launch.process.at, 0);
  assert.equal(launch.displayed.android, 412);
  assert.equal(launch.drawn.android, 3300);
  assert.equal(launch.firebase.at, 1841);
  assert.ok(launch.ad.at > 0 && launch.level.at > 0);

  // Remote config values
  const rc = Object.fromEntries(s.health.rc.values.map((v) => [v.name, v]));
  assert.equal(rc.AdConfig.json.InterAdDelay, 30);
  assert.equal(rc.AdConfig.from, 'fetch');
  assert.equal(rc.GameSettings.json.ShopMenuLevel, 20);
  assert.equal(rc.GameSettings.from, 'cache');

  // Ad rules: only keys in AdConfig
  const ad = Object.fromEntries(s.adRules.checks.map((c) => [c.id, c]));
  assert.equal(s.health.levels.source, 'level_start.level');
  assert.equal(ad['first-delay'].status, 'ok');
  assert.equal(ad['inter-delay'].status, 'problem', 'two interstitials ~20 s apart, config says 30');
  assert.equal(ad['from-level'].status, 'ok');
  assert.equal(ad['format-AppOpen'].status, 'ok');
  assert.equal(ad['format-Inter'].result, '2 shown');

  // Consent and privacy
  const pv = Object.fromEntries(s.privacy.map((c) => [c.id, c]));
  assert.equal(pv.consent.status, 'ok');
  assert.equal(pv['ads-after-consent'].status, 'ok');
  assert.equal(pv['firebase-consent'].status, 'warn');
  assert.equal(pv['ad-id'].status, 'ok');
  assert.equal(pv.permissions.status, 'warn');
  assert.equal(pv['hidden-api'].result, '1 warning from SDKs');

  // SDKs: plugin-verified ones are not repeated; others come from the APK and the logs
  const extra = Object.fromEntries(s.sdkList.extra.map((x) => [x.name, x]));
  assert.ok(extra['Unity Ads'].inApp);
  assert.equal(extra['AppLovin MAX'], undefined);
  assert.ok(!extra.IL2CPP);
  assert.deepEqual(s.sdkList.engine, ['IL2CPP']);

  // GC from logs feeds performance
  assert.equal(m.perf.summary().gc.count, 2);
});

test('checklist run, rules template, report', async () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'playlens-home-'));
  const { Monitor } = await import('../src/monitor/monitor.mjs');
  const extra = `
  - id: stars
    event: level_complete
    params:
      stars: { type: number, range: [0, 1] }
  - id: purchase
    event: in_app_purchase
`;
  const profile = profileTemplate(PKG)
    .replace('presets: [startup-health, remote-config]', 'presets: [startup-health, remote-config, interstitial-e2e]')
    .replace('\n# Extra log lines', `${extra}\n# Extra log lines`);
  const rules = rulesWithProfile(profile);
  assert.equal(rules.forGame(PKG), `${PKG}.yaml`);
  const m = new Monitor({ rules, pkg: PKG, deviceName: 'Test' });
  const entries = demoEntries();
  m.run = null;
  const run = m.startRun();
  run.startedAt = 0;
  for (const e of entries) m.ingest(e);
  const items = Object.fromEntries(m.snapshot(entries.at(-1).ts + 1000).run.items.map((i) => [i.id, i]));

  assert.equal(items['level-start'].status, 'ok');
  assert.equal(items['level-complete'].status, 'ok');
  assert.equal(items.stars.status, 'problem');
  assert.match(items.stars.note, /stars is 2, expected 0 to 1/);
  assert.equal(items.purchase.status, 'pending');
  assert.equal(items['startup-health:startup'].status, 'ok');
  assert.equal(items['interstitial-e2e:flow'].status, 'ok');
  assert.equal(items['interstitial-e2e:ad_interstitial'].status, 'ok');
  assert.equal(items['remote-config:1'].status, 'pending', 'AdIdsConfig was Default, so "from the server" stays open');

  const report = m.finishRun();
  assert.equal(report.total, Object.keys(items).length);
  assert.ok(existsSync(join(process.env.HOME, '.avn-playlens', 'reports', `${report.id}.md`)) || report.id);
});
