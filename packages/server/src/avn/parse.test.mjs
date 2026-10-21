// Run: node --test packages/server/src/avn/parse.test.mjs
// Fixture lines are the examples and formats from AVN_PLUGIN_LOG_REFERENCE.md.
// Values in <angle brackets> in the reference are filled with plausible data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvnLine, parseSpacedKv } from './parse.mjs';

test('ignores lines that are not from the plugin', () => {
  assert.equal(parseAvnLine('Level 3 loaded (seed 4021)'), null);
  assert.equal(parseAvnLine('[GameManager.Start] game started'), null);
});

test('hub status line', () => {
  const e = parseAvnLine('Status Ad.Rewarded => Loaded: Rewarded loaded | AVNPLUGIN');
  assert.deepEqual([e.kind, e.key, e.state, e.message], ['status', 'Ad.Rewarded', 'Loaded', 'Rewarded loaded']);
});

test('editor color tags are stripped', () => {
  const e = parseAvnLine('<color=cyan>Status SDK.Firebase => Initialized: Firebase initialized successfully | AVNPLUGIN</color>');
  assert.equal(e.key, 'SDK.Firebase');
  assert.equal(e.state, 'Initialized');
});

test('counter line, with and without the suffix, with reason and caller', () => {
  const a = parseAvnLine('Counter Ad.Interstitial.0 LoadCallsSent=3');
  assert.deepEqual([a.kind, a.key, a.name, a.value], ['counter', 'Ad.Interstitial.0', 'LoadCallsSent', 3]);
  const b = parseAvnLine('Counter Ad.Rewarded LoadCallsFailed=2 reason=Rewarded load failed: NoFill | AVNPLUGIN');
  assert.equal(b.reason, 'Rewarded load failed: NoFill');
  const c = parseAvnLine('[DiagnosticsHubAVNPlugin.IncrementAdsLoaded] Counter Ad.Interstitial.0 AdsLoaded=4 | AVNPLUGIN');
  assert.equal(c.name, 'AdsLoaded');
  assert.equal(c.caller.class, 'DiagnosticsHubAVNPlugin');
});

test('plain line with caller', () => {
  const e = parseAvnLine('[MaxAdsProvider.OnSdkInitialized] MaxAdsProvider SDK Initialized | AVNPLUGIN');
  assert.equal(e.kind, 'plain');
  assert.deepEqual(e.caller, { class: 'MaxAdsProvider', method: 'OnSdkInitialized' });
  assert.equal(e.message, 'MaxAdsProvider SDK Initialized');
});

test('MAX callback: loaded', () => {
  const e = parseAvnLine('[MaxAdsProvider.OnInterstitialLoadedEvent] SDKCallback | InterAd | Loaded | slot=0 unit=abc123 network=AppLovin latencyMs=812 | AVNPLUGIN');
  assert.equal(e.kind, 'callback');
  assert.equal(e.format, 'interstitial');
  assert.equal(e.callback, 'Loaded');
  assert.deepEqual(e.fields, { slot: '0', unit: 'abc123', network: 'AppLovin', latencyMs: '812' });
});

test('MAX callback: failure fields keep spaces in msg and networkMsg', () => {
  const e = parseAvnLine('SDKCallback | InterAd | LoadFailed | slot=1 unit=def456 code=NoFill msg=No Fill networkCode=204 networkMsg=No ad to show latencyMs=3021 | AVNPLUGIN');
  assert.equal(e.fields.msg, 'No Fill');
  assert.equal(e.fields.networkMsg, 'No ad to show');
  assert.equal(e.fields.latencyMs, '3021');
});

test('MAX callback: rewarded, revenue, ignored', () => {
  const r = parseAvnLine('SDKCallback | RewardAd | Rewarded | label=coins amount=50 unit=r1 | AVNPLUGIN');
  assert.equal(r.format, 'rewarded');
  assert.equal(r.fields.amount, '50');
  const p = parseAvnLine('SDKCallback | InterAd | RevenuePaid | unit=abc123 network=Mintegral latencyMs=0 revenue=0.0123 | AVNPLUGIN');
  assert.equal(p.fields.revenue, '0.0123');
  const i = parseAvnLine('SDKCallback | InterAd | Loaded ignored: no slot currently uses ad unit xyz | AVNPLUGIN');
  assert.equal(i.ignored, 'no slot currently uses ad unit xyz');
});

test('MAX adapters: one line and summary', () => {
  const a = parseAvnLine('MAX adapter | name=Pangle adapterVersion=6.1.0.6.0 sdkVersion=6.1.0.6 status=InitializedSuccess | AVNPLUGIN');
  assert.equal(a.kind, 'adapter');
  assert.equal(a.fields.status, 'InitializedSuccess');
  const s = parseAvnLine('MAX adapters: 11/14 initialized; not ready: Yandex=NotInitialized, Moloco=InitializedFailure | AVNPLUGIN');
  assert.equal(s.ok, 11);
  assert.equal(s.total, 14);
  assert.deepEqual(s.notReady[1], { name: 'Moloco', status: 'InitializedFailure' });
});

test('MAX init config', () => {
  const e = parseAvnLine('MAX init config | success=True country=US testMode=False att=Authorized consentGeo=Other consentState=Unknown | AVNPLUGIN');
  assert.equal(e.fields.testMode, 'False');
});

test('banner lines', () => {
  const l = parseAvnLine('-------- MAX Banner ad loaded -------- unit=b1 network=Google AdMob latencyMs=400 | AVNPLUGIN');
  assert.deepEqual([l.kind, l.format, l.what], ['banner', 'banner', 'loaded']);
  assert.equal(l.fields.network, 'Google AdMob');
  const f = parseAvnLine('-------- MAX Banner load failed: NoFill -------- unit=b1 code=NoFill msg=No Fill latencyMs=900 | AVNPLUGIN');
  assert.equal(f.what, 'load-failed');
  assert.equal(f.code, 'NoFill');
  const r = parseAvnLine('-------- MAX MREC ad revenue paid -------- unit=m1 network=Meta revenue=0.002 | AVNPLUGIN');
  assert.deepEqual([r.format, r.what, r.fields.revenue], ['mrec', 'revenue-paid', '0.002']);
});

test('analytics: custom event with values', () => {
  const e = parseAvnLine('Status Analytics.Event => Sent: Custom event sent: Event=level_complete, Params=2 [level=3, time_s=41.2] | AVNPLUGIN');
  assert.deepEqual(e.event, { name: 'level_complete', stage: 'sent', paramCount: 2, params: { level: '3', time_s: '41.2' } });
});

test('analytics: plugin-sent events, early and dropped', () => {
  const h = parseAvnLine('Status Analytics.Event => Sent: Firebase event handed to SDK: ad_interstitial (COUNT=3, SLOT=0) | AVNPLUGIN');
  assert.deepEqual(h.event, { name: 'ad_interstitial', stage: 'handed', params: { COUNT: '3', SLOT: '0' } });
  const b = parseAvnLine('Status Analytics.Event => SendFailed: Firebase event sent BEFORE Firebase init succeeded (may be dropped): ad_banner () | AVNPLUGIN');
  assert.equal(b.event.stage, 'before-init');
  const d = parseAvnLine('Status Analytics.Event => SendFailed: level_start: dropped, Firebase is not initialized | AVNPLUGIN');
  assert.deepEqual(d.event, { name: 'level_start', stage: 'dropped' });
  const r = parseAvnLine('Status Analytics.Event => Sending: SendCustomEvent requested: event=level_start, toFirebase=True, toByteBrew=False | AVNPLUGIN');
  assert.equal(r.event.toByteBrew, false);
  const v = parseAvnLine('Status SDK.Firebase.EventVerified => Sent: First Firebase event handed to SDK after init: avn_qa_probe | AVNPLUGIN');
  assert.equal(v.event.stage, 'first-after-init');
});

test('analytics: SendToFirebase and SendToByteBrew', () => {
  const f = parseAvnLine('[AnalyticsEventService.SendToFirebase] SendToFirebase sent event=level_complete, params=2 | AVNPLUGIN');
  assert.deepEqual([f.kind, f.sdk, f.event.name, f.event.paramCount], ['send', 'firebase', 'level_complete', 2]);
  const b = parseAvnLine('[AnalyticsEventService.SendToByteBrew] SendToByteBrew sent event=level_complete, params=2 | AVNPLUGIN');
  assert.equal(b.sdk, 'bytebrew');
});

test('remote config: success, sources, AdConfig, effective ids', () => {
  const s = parseAvnLine('Status SDK.RemoteConfig => Initialized: FetchRemoteConfig success: config fetched and activated (lastFetchStatus=Success, fetchTime=2026-10-20T12:00:00Z) | AVNPLUGIN');
  assert.deepEqual(s.fetch, { lastFetchStatus: 'Success', fetchTime: '2026-10-20T12:00:00Z' });
  const src = parseAvnLine('Remote config value sources | AdConfig=Remote, AdIdsConfig=Default, CMPEligibleUser=Remote | AVNPLUGIN');
  assert.deepEqual(src.sources, { AdConfig: 'Remote', AdIdsConfig: 'Default', CMPEligibleUser: 'Remote' });
  const cfg = parseAvnLine('AdConfig applied | EnableInterFromLevel=2 InterAdDelay=30 DelayBeforeFirstAd=60 InterstitialShowMode=ShowDefault RateUs=True Notification=True Banner=True Inter=True Rewarded=True AppOpen=False (RemoveAdsPurchased=False) ANRFixer=True WatchdogInter=True WatchdogRewarded=True | AVNPLUGIN');
  assert.equal(cfg.values.InterAdDelay, '30');
  assert.equal(cfg.values.RemoveAdsPurchased, 'False');
  assert.equal(cfg.values.WatchdogRewarded, 'True');
  const ids = parseAvnLine('[AVNPlugin.ApplyMergedAdIds] Effective ad IDs | remoteOverride=True banner=b1 mrec=m1 rewarded=r1 inter=[i1 | i2 | i3] appOpen1=a1 appOpen2=a2 | AVNPLUGIN');
  assert.deepEqual(ids.ids.inter, ['i1', 'i2', 'i3']);
  assert.equal(ids.ids.appOpen2, 'a2');
  assert.equal(ids.ids.remoteOverride, 'True');
});

test('spaced kv parser handles a trailing value', () => {
  assert.deepEqual(parseSpacedKv('a=1 b=two words c=3'), { a: '1', b: 'two words', c: '3' });
});
