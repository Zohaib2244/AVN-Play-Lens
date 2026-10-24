// QA runner: plan validation, ad close-button detection, the bridge client against a fake
// Unity bridge, and a whole run through the API with an in-process fake adb. No phone needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePlan, builtinPlans, gamePlans, applyOptions } from '../src/qa/plans.mjs';
import { findCloseControl, parseDisplaySize } from '../src/qa/adb-actions.mjs';
import { BridgeClient } from '../src/qa/bridge-client.mjs';
import { runMarkdown } from '../src/qa/report.mjs';
import { RulesStore } from '../src/rules/loader.mjs';
import { createServer } from '../src/api/server.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 8000, every = 25 } = {}) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out waiting'); await sleep(every); }
}

// ── plans ────────────────────────────────────────────────────────────────────

test('built-in plans normalise, unroll repeats and name their coverage', () => {
  const plans = builtinPlans();
  const ids = plans.map((p) => p.id);
  assert.deepEqual(ids, ['plugin-smoke', 'adb-smoke', 'progression', 'iap', 'inter-level-gate', 'inter-cooldown', 'retry-flow', 'rewarded-continue', 'rewarded-cancel', 'no-fill-recovery', 'remove-ads', 'kill-restore']);
  const progression = plans.find((p) => p.id === 'progression');
  assert.equal(progression.needsBridge, true);
  assert.equal(progression.coverage, 'bridge');
  const wins = progression.steps.filter((s) => s.type === 'action' && s.action === 'level.win');
  assert.equal(wins.length, 10);
  assert.equal(wins[2].label, 'Force win on level 3');
  assert.equal(wins[2].expect[0].label, 'game reported level 3 won');
  assert.match(wins[0].id, /^6\.1\.2$/);
  assert.equal(plans.find((p) => p.id === 'adb-smoke').coverage, 'random');
});

test('plan validation rejects unknown steps, bad durations and empty expectations', () => {
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'teleport' }] }), /unknown step type "teleport"/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'expect', within: 'soon', event: 'e' }] }), /within must be a duration/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'expect' }] }), /at least one expectation/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'action', action: 'bad action!' }] }), /valid action id/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'repeat', times: 3 }] }), /repeat needs steps/);
  assert.throws(() => normalizePlan('bad id!', { steps: [{ type: 'wait' }] }), /plan id/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'expect', event: 'e', absent: true }] }), /absent expectation needs within/);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'network', state: 'maybe' }] }), /network state/);
  assert.equal(normalizePlan('x', { steps: [{ type: 'closeAd', format: 'rewarded', early: true }] }).steps[0].minSeconds, 4);
  assert.throws(() => normalizePlan('x', { steps: [{ type: 'repeat', times: 500, steps: [{ type: 'wait' }] }] }), /more than 400 steps/);
  const p = normalizePlan('ok', { steps: [{ type: 'expect', event: 'level_start', within: '5s' }, { type: 'key', key: 'back' }, { type: 'closeAd', format: 'rewarded' }] });
  assert.deepEqual(p.steps[0].expect[0].match, { any: [{ kind: 'fa-event', name: 'level_start' }, { kind: 'send', 'event.name': 'level_start' }] });
  assert.equal(p.steps[0].expect[0].within, 5000);
  assert.equal(p.steps[2].minSeconds, 0);
});

test('game plans come from the rules file and broken ones are reported, not thrown', () => {
  const { plans, errors } = gamePlans({ qa: { plans: { 'level-5': { name: 'Level 5', steps: [{ type: 'launch' }, { type: 'action', action: 'level.load', args: { level: 5 } }] }, broken: { steps: [{ type: 'nope' }] } } } });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].source, 'game');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /plan broken/);
  const { plan, missing } = applyOptions(builtinPlans().find((p) => p.id === 'iap'), { productId: 'remove_ads', ignored: { deep: 1 } });
  assert.deepEqual(missing, []);
  assert.equal(plan.steps.find((s) => s.action === 'iap.buy').args.productId, 'remove_ads');
  assert.deepEqual(applyOptions(builtinPlans().find((p) => p.id === 'iap'), {}).missing, ['productId']);
});

// ── adb helpers ──────────────────────────────────────────────────────────────

test('close-button detection prefers labelled small controls and ignores the creative', () => {
  const xml = `<?xml version='1.0'?><hierarchy>
    <node class="android.webkit.WebView" bounds="[0,0][1080,2400]" clickable="true" content-desc="" />
    <node class="android.widget.ImageView" resource-id="com.game:id/applovin_close" bounds="[960,80][1040,160]" clickable="true" content-desc="" />
    <node class="android.widget.TextView" text="Install now" bounds="[200,2000][880,2120]" clickable="true" content-desc="" />
    <node class="android.widget.ImageButton" bounds="[20,80][120,180]" clickable="true" content-desc="Close ad" />
  </hierarchy>`;
  const c = findCloseControl(xml);
  assert.equal(c.label, 'Close ad');
  assert.deepEqual([c.x, c.y], [70, 130]);
  assert.equal(findCloseControl('<hierarchy><node bounds="[0,0][1080,2400]" clickable="true" content-desc="Install" /></hierarchy>'), null);
  assert.deepEqual(parseDisplaySize('Physical size: 1080x2400\nOverride size: 720x1600\n'), { width: 720, height: 1600 });
  assert.deepEqual(parseDisplaySize('Physical size: 1080x2400'), { width: 1080, height: 2400 });
});

// ── fake Unity bridge ────────────────────────────────────────────────────────

function fakeBridge({ pkg = 'com.demo.game', actions = ['level.win', 'level.load', 'ad.interstitial.show'], onInvoke } = {}) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buf = '';
    let session = null;
    const send = (o) => socket.write(JSON.stringify(o) + '\n');
    socket.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let req; try { req = JSON.parse(line); } catch { continue; }
        if (req.cmd === 'hello') { session = req.args.runId; return send({ id: req.id, ok: true, result: { proto: 1, sdk: '0.1.0', session, app: { package: pkg, version: '1.2.0' }, capabilities: { actions, level: true, state: true, ui: true } } }); }
        if (!session) return send({ id: req.id, ok: false, code: 'no-session', error: 'send hello first' });
        if (req.cmd === 'state') return send({ id: req.id, ok: true, result: { scene: 'Game', state: 'playing', level: { number: 1 } } });
        if (req.cmd === 'ui.find') return send({ id: req.id, ok: true, result: req.args.query === 'Next' ? { id: 'Canvas/Next', name: 'Next', center: { x: 0.5, y: 0.9 } } : null });
        if (req.cmd === 'invoke') {
          const { action, args } = req.args;
          onInvoke?.(action, args);
          if (!actions.includes(action)) return send({ id: req.id, ok: false, code: 'unknown-action', error: `action '${action}' is not registered`, action });
          if (action === 'ad.interstitial.show') return send({ id: req.id, ok: false, code: 'not-wired', error: "action 'ad.interstitial.show' is registered but not wired", action });
          send({ id: req.id, ok: true, result: true });
          if (action === 'level.win') setTimeout(() => send({ event: 'level.won', data: { level: 1 }, t: 5.5, frame: 300 }), 30);
          return;
        }
        send({ id: req.id, ok: false, code: 'unknown-command', error: 'unknown' });
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  };
}

test('bridge client handshakes, invokes, maps error codes and receives pushed events', async () => {
  const bridge = fakeBridge();
  const port = await bridge.listen();
  const client = new BridgeClient({ port, timeoutMs: 2000 });
  await client.connect();
  const hello = await client.handshake('qa-test');
  assert.equal(hello.session, 'qa-test');
  assert.equal(client.supports('level.win'), true);
  assert.equal(client.supports('iap.buy'), false);
  const events = [];
  client.on('event', (e) => events.push(e));
  assert.equal(await client.invoke('level.win'), true);
  await until(() => events.length);
  assert.equal(events[0].name, 'level.won');
  await assert.rejects(client.invoke('ad.interstitial.show'), (err) => err.code === 'not-wired' && err.action === 'ad.interstitial.show');
  await assert.rejects(client.invoke('iap.buy'), (err) => err.code === 'unknown-action');
  assert.equal(await client.find('Nope'), null);
  client.close();
  bridge.close();
});

// ── a whole run through the API ──────────────────────────────────────────────

// In-process fake adb: enough of a phone for the runner. The test feeds logcat lines through
// `stdout` and sees every shell command in `commands`.
function fakeAdb({ bridgePort, foreground = { pkg: 'com.demo.game' } }) {
  const commands = [];
  const forwards = [];
  let stdout = null;
  const adb = {
    commands, forwards,
    get stdout() { return stdout; },
    async shell(_serial, cmd) {
      commands.push(cmd);
      if (cmd.startsWith('date ')) return `${Date.now() / 1000}\n`;
      if (cmd.startsWith('ps ')) return '  PID NAME\n18342 com.demo.game\n';
      if (cmd.startsWith('dumpsys package')) return '    versionCode=12 minSdk=24 targetSdk=34\n    versionName=1.2.0\n    pkgFlags=[ HAS_CODE DEBUGGABLE ]\n';
      if (cmd.startsWith('for p in')) return '98000000\n';
      if (cmd.startsWith('wm size')) return 'Physical size: 1080x2400\n';
      if (cmd.startsWith('monkey')) { foreground.pkg = 'com.demo.game'; return 'Events injected: 1\n'; }
      if (cmd.startsWith('am force-stop')) { foreground.pkg = null; return ''; }
      if (cmd.startsWith('dumpsys activity')) return foreground.pkg ? `  topResumedActivity=ActivityRecord{8d1 u0 ${foreground.pkg}/com.unity3d.player.UnityPlayerActivity t42}\n` : '';
      if (cmd.startsWith('input keyevent 3')) { foreground.pkg = 'com.android.launcher'; return ''; }
      if (cmd.startsWith('uiautomator')) return '<?xml version="1.0"?><hierarchy><node bounds="[1000,60][1060,120]" clickable="true" content-desc="Close" /></hierarchy>\n';
      if (cmd.startsWith('pm list')) return 'package:com.demo.game\n';
      return '';
    },
    async run(args, opts) {
      commands.push(args.join(' '));
      if (args[0] === 'forward' && args[1] === 'tcp:0') { forwards.push(args[2]); return `${bridgePort}\n`; }
      if (args[0] === 'forward' && args[1] === '--remove') { forwards.pop(); return ''; }
      if (args[0] === 'exec-out') return opts?.encoding === 'buffer' ? PNG : PNG.toString('latin1');
      return '';
    },
    spawn: () => { const proc = new EventEmitter(); proc.stdout = stdout = new PassThrough(); proc.kill = () => {}; return proc; },
  };
  return adb;
}
const line = (msg, { tag = 'Unity', pid = 18342, ts = Date.now() / 1000 } = {}) => `${ts.toFixed(3)} ${pid} ${pid} I ${tag}   : ${msg}\n`;

test('a plan runs end to end: launch, startup lines, bridge action, screenshot, not-supported hook, cancel', async () => {
  const invoked = [];
  const bridge = fakeBridge({ onInvoke: (a) => invoked.push(a) });
  const bridgePort = await bridge.listen();
  const adb = fakeAdb({ bridgePort });
  const qaDir = mkdtempSync(join(tmpdir(), 'playlens-qa-runs-'));
  const rulesDir = mkdtempSync(join(tmpdir(), 'playlens-qa-rules-'));
  const rules = new RulesStore({ dir: rulesDir });
  rules.create('com.demo.game');
  // A game plan in the rules file, alongside the built-in ones.
  const file = join(rulesDir, rules.forGame('com.demo.game'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, readFileSync(file, 'utf8') + `\nqa:\n  plans:\n    tiny:\n      name: Tiny\n      steps:\n        - launch: { cold: true }\n        - expect: { status: { key: SDK.InitCompleted, state: Info }, within: 5s }\n        - bridge: { required: true }\n        - action: { action: level.win, expect: [{ bridge: level.won }], within: 5s }\n        - action: { action: ad.interstitial.show, within: 5s }\n        - action: { action: iap.buy, args: { productId: '{productId}' }, within: 5s }\n        - screenshot: { label: After win }\n        - closeAd: { format: interstitial, within: 3s }\n        - wait: { seconds: 30 }\n        - screenshot: { label: Never reached }\n`);
  const port = 7503;
  const server = createServer({ port, staticDir: null, adb, rules, record: true, qaDir, games: { list: () => [{ id: 'g1', packageId: 'com.demo.game', name: 'Demo' }] },
    devices: () => [{ serial: 'PHONE', state: 'device', info: { model: 'Test phone' } }], onDevices: () => {}, status: () => ({}) });
  await server.listen();
  const api = async (path, init) => { const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, init); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
  const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const plans = (await api('qa/plans?pkg=com.demo.game')).body;
    assert.ok(plans.plans.some((p) => p.id === 'plugin-smoke' && p.source === 'builtin'));
    assert.ok(plans.plans.some((p) => p.id === 'tiny' && p.source === 'game' && p.stepCount === 10));
    assert.deepEqual(plans.errors, []);

    // Validation before anything touches the phone.
    assert.equal((await post('qa/runs', { pkg: 'com.demo.game', serial: 'PHONE', plan: 'tiny' })).status, 400);        // missing productId
    assert.equal((await post('qa/runs', { pkg: 'com.demo.game', serial: 'NOPE', plan: 'tiny', options: { productId: 'x' } })).status, 409);
    assert.equal((await post('qa/runs', { pkg: 'com.other.game', serial: 'PHONE', plan: 'tiny', options: { productId: 'x' } })).status, 403);
    assert.equal((await post('qa/runs', { pkg: 'com.demo.game', serial: 'PHONE', plan: 'missing', options: { productId: 'x' } })).status, 404);

    const started = await post('qa/runs', { pkg: 'com.demo.game', serial: 'PHONE', plan: 'tiny', options: { productId: 'remove_ads' } });
    assert.equal(started.status, 201);
    const id = started.body.run.id;
    assert.match(id, /^qa-/);
    // The phone is owned by the run: the web's own launch button is refused, and so is a second run.
    assert.equal((await post('qa/runs', { pkg: 'com.demo.game', serial: 'PHONE', plan: 'adb-smoke' })).status, 409);
    assert.equal((await post('devices/PHONE/apps/com.demo.game/launch', {})).status, 409);

    // Launch step: force-stop then monkey, then it waits for the foreground.
    await until(() => adb.commands.some((c) => c.startsWith('monkey')));
    await until(() => adb.stdout);
    // Feed the plugin's startup lines; the expect step must see them even though they arrive
    // while the launch step is still running.
    adb.stdout.write(line('Status SDK.InitCompleted => Info: all SDKs ready | AVNPLUGIN'));
    const running = await until(async () => { const r = (await api(`qa/runs/${id}`)).body.run; return r.steps[3].status !== 'pending' && r.steps[3].status !== 'running' ? r : null; }, { timeout: 15000 });
    assert.equal(running.steps[0].status, 'passed', 'launch');
    assert.equal(running.steps[1].status, 'passed', 'startup expect');
    assert.equal(running.steps[2].status, 'passed', 'bridge');
    assert.equal(running.bridge.connected, true);
    assert.deepEqual(adb.forwards, ['tcp:7421']);
    assert.equal(running.steps[3].status, 'passed', 'level.win');
    assert.ok(running.steps[3].checks.some((c) => c.label === 'game reported level.won' || /level\.won/.test(c.label)));
    assert.deepEqual(invoked.slice(0, 1), ['level.win']);

    const later = await until(async () => { const r = (await api(`qa/runs/${id}`)).body.run; return r.steps[7].status !== 'pending' && r.steps[7].status !== 'running' ? r : null; }, { timeout: 15000 });
    assert.equal(later.steps[4].status, 'not-supported', 'not-wired action');
    assert.match(later.steps[4].checks[0].note, /not wired/);
    assert.equal(later.steps[5].status, 'not-supported', 'unregistered action');
    assert.equal(later.steps[6].status, 'passed', 'screenshot');
    assert.equal(later.evidence.length, 1);
    assert.equal(later.evidence[0].file, '7-after-win.png');
    assert.equal(later.steps[7].status, 'skipped', 'closeAd with no ad showing');
    assert.equal(later.summary['not-supported'], 2);

    // Cancel during the 30 s wait: the run ends honestly, the forward is removed, the report persists.
    await until(async () => (await api(`qa/runs/${id}`)).body.run.current === '9');
    assert.equal((await post(`qa/runs/${id}/cancel`, { reason: 'test over' })).status, 200);
    const done = await until(async () => { const r = (await api(`qa/runs/${id}`)).body.run; return r.endedAt ? r : null; });
    assert.equal(done.status, 'cancelled');
    assert.equal(done.cancelReason, 'test over');
    assert.equal(done.steps[8].status, 'cancelled');
    assert.equal(done.steps[9].status, 'skipped');
    assert.equal(done.summary.outcome, 'incomplete');
    assert.deepEqual(adb.forwards, []);
    assert.ok(adb.commands.includes(`forward --remove tcp:${bridgePort}`));

    assert.ok(existsSync(join(qaDir, id, 'run.json')));
    assert.ok(existsSync(join(qaDir, id, 'shots', '7-after-win.png')));
    assert.ok(readFileSync(join(qaDir, id, 'logcat.jsonl'), 'utf8').includes('SDK.InitCompleted'));
    const md = (await api(`qa/runs/${id}/report.md`)).body;
    assert.match(md, /Outcome:\*\* incomplete/);
    assert.match(md, /Not supported: Action ad.interstitial.show/);
    assert.equal((await api(`qa/runs/${id}/files/7-after-win.png`)).status, 200);
    assert.equal((await api(`qa/runs/${id}/files/../run.json`)).status, 404);
    const list = (await api('qa/runs?pkg=com.demo.game')).body.runs;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].steps, undefined, 'list is summaries only');

    // After the run the phone is free again.
    assert.equal((await post('devices/PHONE/apps/com.demo.game/stop', {})).status, 200);
    assert.equal((await api(`qa/runs/${id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(readdirSync(qaDir), []);
  } finally {
    await server.close();
    bridge.close();
  }
});

test('a run left "running" on disk is marked interrupted at startup', async () => {
  const qaDir = mkdtempSync(join(tmpdir(), 'playlens-qa-int-'));
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(qaDir, 'qa-old-1'));
  writeFileSync(join(qaDir, 'qa-old-1', 'run.json'), JSON.stringify({ id: 'qa-old-1', status: 'running', pkg: 'com.demo.game', createdAt: 1, steps: [{ id: '1', status: 'passed', checks: [] }, { id: '2', status: 'running', checks: [] }], summary: { outcome: 'passed' } }));
  const { QARunner } = await import('../src/qa/runner.mjs');
  const runner = new QARunner({ adb: null, rules: null, games: { list: () => [] }, devices: () => [], deviceName: () => 'x', dir: qaDir });
  const run = runner.get('qa-old-1');
  assert.equal(run.status, 'interrupted');
  assert.equal(run.steps[1].status, 'skipped');
  assert.equal(run.summary.outcome, 'incomplete');
  assert.match(runMarkdown(run), /interrupted/);
});

test('absent expectations pass on silence and fail when the line shows up; network is restored at the end', async () => {
  const { QARun } = await import('../src/qa/run.mjs');
  const { normalizePlan } = await import('../src/qa/plans.mjs');
  const commands = [];
  const adb = { shell: async (_s, cmd) => { commands.push(cmd); return ''; }, run: async () => '', spawn: () => null };
  const plan = normalizePlan('p', { steps: [{ type: 'expect', callback: { format: 'interstitial', callback: 'Displayed' }, absent: true, within: '300ms' }] });
  const run = new QARun({ id: 'qa-absent', adb, serial: 'PHONE', pkg: 'com.demo.game', plan, rules: null, deviceName: 'T', dir: mkdtempSync(join(tmpdir(), 'playlens-qa-abs-')), record: false });
  run.stream = { buffer: [], stop() {} };
  const step = run.steps[0];
  step.startedAt = Date.now();
  await run.expectAll(step, step.expect, new AbortController().signal);
  assert.equal(step.checks[0].status, 'passed');
  assert.match(step.checks[0].note, /did not happen/);
  // Now the line arrives in time.
  step.checks = [];
  const pending = run.expectAll(step, step.expect, new AbortController().signal);
  await sleep(20);
  run.onEntry({ id: 1, ts: Date.now() + 10000, message: 'SDKCallback | InterAd | Displayed | slot=0', avn: { kind: 'callback', format: 'interstitial', callback: 'Displayed' } });
  await pending;
  assert.equal(step.checks[0].status, 'failed');
  assert.match(step.checks[0].note, /happened/);
  // Airplane mode left on by a plan is switched off when the run ends.
  run.networkOff = true;
  run.startedAt = Date.now();
  await run.finish('completed');
  assert.ok(commands.some((c) => c.includes('airplane-mode disable')));
  assert.equal(run.status, 'completed');
});
