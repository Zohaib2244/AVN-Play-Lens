import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GameLibrary, GameInventory } from '../src/games/library.mjs';
import { createServer } from '../src/api/server.mjs';
import { appActions } from '../src/device/info.mjs';
function library(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playlens-games-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new GameLibrary(join(dir, 'games.json'));
}
test('game CRUD persists names and IDs, edits a package, and rejects duplicates and unsafe IDs', (t) => {
  const store = library(t);
  assert.deepEqual(store.list(), []);
  const first = store.save({ name: 'Puzzle', packageId: ' com.studio.puzzle ' });
  assert.equal(first.packageId, 'com.studio.puzzle');
  assert.equal(new GameLibrary(store.file).list()[0].name, 'Puzzle');
  assert.throws(() => store.save({ name: 'Duplicate', packageId: first.packageId }), /already/);
  assert.throws(() => store.save({ name: 'Invalid', packageId: 'com.game; echo nope' }), /package ID/);
  assert.throws(() => store.save({ name: '', packageId: 'com.game' }), /name/);
  const edited = store.save({ name: 'Puzzle QA', packageId: 'com.studio.puzzle.qa' }, first.id);
  assert.equal(edited.id, first.id);
  assert.equal(store.list()[0].packageId, 'com.studio.puzzle.qa');
  assert.equal(store.remove(first.id), true);
  assert.equal(store.remove(first.id), false);
  assert.deepEqual(store.list(), []);
});
function phone() {
  const calls = [];
  let version = '1.2.0';
  const adb = { async shell(serial, cmd) {
    calls.push({ serial, cmd });
    if (cmd.startsWith('pm list')) return 'package:com.studio.puzzle\npackage:com.other.app\n';
    if (cmd.startsWith('dumpsys activity')) return 'topResumedActivity=ActivityRecord{x u0 com.studio.puzzle/.Activity t1}';
    if (cmd.startsWith('ps ')) return '123 com.studio.puzzle\n456 com.studio.puzzle:ads\n';
    if (cmd.startsWith('dumpsys package')) return `versionName=${version}\nversionCode=12 minSdk=24 targetSdk=34\n`;
    if (cmd.startsWith('am force-stop')) return '';
    if (cmd.startsWith('monkey')) return 'Events injected: 1';
    throw new Error('Unexpected command ' + cmd);
  } };
  return { adb, calls, updateVersion: (v) => { version = v; } };
}
test('device inventory shows only registered games, installed builds and running state; refresh sees an update', async (t) => {
  const store = library(t);
  store.save({ name: 'Puzzle', packageId: 'com.studio.puzzle' });
  store.save({ name: 'Missing', packageId: 'com.studio.missing' });
  const { adb, calls, updateVersion } = phone();
  const inventory = new GameInventory(adb);
  let result = await inventory.list('PHONE1', store.list());
  assert.equal(result.length, 2);
  assert.equal(result[0].installed, true);
  assert.equal(result[0].versionName, '1.2.0');
  assert.equal(result[0].versionCode, 12);
  assert.equal(result[0].running, true);
  assert.equal(result[1].installed, false);
  assert.ok(!calls.some((c) => c.cmd === 'dumpsys package com.studio.missing'));
  updateVersion('2.0.0');
  result = await inventory.list('PHONE1', store.list(), { refresh: true });
  assert.equal(result[0].versionName, '2.0.0');
  assert.ok(calls.every((c) => c.serial === 'PHONE1'));
});
test('game API CRUD, installation lookup and controls validate targets and refuse foreign origins', async (t) => {
  const store = library(t);
  const { adb, calls } = phone();
  const server = createServer({ port: 7492, staticDir: null, adb, games: store,
    devices: () => [{ serial: 'PHONE1', state: 'device' }], onDevices: () => {}, status: () => ({}) });
  await server.listen(); t.after(() => server.close());
  const base = 'http://127.0.0.1:7492/api';
  const req = (path, method = 'GET', body) => fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const created = await req('/games', 'POST', { name: 'Puzzle', packageId: 'com.studio.puzzle' });
  assert.equal(created.status, 201);
  const game = await created.json();
  assert.equal((await (await req(`/games/${game.id}`)).json()).name, 'Puzzle');
  assert.equal((await (await req('/games')).json()).length, 1);
  assert.equal((await (await req('/devices/PHONE1/games')).json())[0].versionName, '1.2.0');
  assert.equal((await req(`/games/${game.id}`, 'PATCH', { name: 'Renamed', packageId: game.packageId })).status, 200);
  for (const action of ['launch', 'stop', 'restart']) assert.equal((await req(`/devices/PHONE1/apps/${game.packageId}/${action}`, 'POST')).status, 200);
  assert.equal(calls.filter((c) => c.cmd.startsWith('monkey')).length, 2);
  assert.equal((await req('/devices/PHONE1/apps/com.missing.game/launch', 'POST')).status, 403);
  assert.equal((await req('/devices/DISCONNECTED/apps/com.studio.puzzle/launch', 'POST')).status, 409);
  assert.equal((await fetch(base + '/games', { method: 'POST', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await req(`/games/${game.id}`, 'DELETE')).status, 200);
  assert.equal((await req(`/games/${game.id}`)).status, 404);
});
test('launch reports an adb monkey failure instead of claiming success', async () => {
  await assert.rejects(appActions.launch({ shell: async () => 'No activities found to run, monkey aborted.' }, 'PHONE', 'com.studio.game'), /No activities/);
});

test('custom icons persist through edits, can be removed, and reject remote or oversized data', (t) => {
  const store = library(t);
  const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5FXS8AAAAASUVORK5CYII=';
  const game = store.save({ name: 'Icon game', packageId: 'com.studio.icon', icon });
  assert.equal(new GameLibrary(store.file).list()[0].icon, icon);
  assert.equal(store.save({ name: 'Renamed', packageId: game.packageId }, game.id).icon, icon);
  assert.equal(store.save({ name: 'Renamed', packageId: game.packageId, icon: null }, game.id).icon, null);
  assert.throws(() => store.save({ name: 'Bad', packageId: 'com.studio.bad', icon: 'https://example.com/icon.png' }), /icon/);
  assert.throws(() => store.save({ name: 'Bad', packageId: 'com.studio.bad', icon: 'data:image/svg+xml;base64,AAAA' }), /icon/);
  assert.throws(() => store.save({ name: 'Bad', packageId: 'com.studio.bad', icon: 'data:image/png;base64,' + 'A'.repeat(350000) }), /icon/);
});
