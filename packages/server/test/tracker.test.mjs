import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { TrackFrameParser } from '../src/adb/devices.mjs';
import { DeviceTracker } from '../src/adb/tracker.mjs';

const frame = (text, windows = false) => text.length.toString(16).padStart(4, '0') +
  (windows ? text.replace(/\n/g, '\r\n') : text);
const phone = 'adb-PHONE123-AbCd._adb-tls-connect._tcp';

test('Windows live frames stay synchronized across device additions, state changes and removal', () => {
  const updates = ['', 'USB123\tdevice model:Phone\n',
    `USB123\tdevice model:Phone\n${phone}\tdevice model:Wifi_Phone\n`,
    `${phone}\toffline\n`, ''];
  for (const windows of [false, true]) {
    const parser = new TrackFrameParser();
    const actual = [];
    // Splitting at every character includes CR/LF and frame-header boundaries.
    for (const char of updates.map((s) => frame(s, windows)).join('')) actual.push(...parser.push(char));
    assert.deepEqual(actual.map((list) => list.map((d) => [d.serial, d.state])), [[],
      [['USB123', 'device']], [['USB123', 'device'], [phone, 'device']], [[phone, 'offline']], []]);
  }
});

test('tracker discovers a phone connected outside PlayLens after earlier Windows updates', async (t) => {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.kill = () => proc.emit('exit', 0);
  const adb = {
    spawn(args) { assert.deepEqual(args, ['track-devices', '-l']); return proc; },
    async shell(serial) {
      assert.equal(serial, phone);
      return '[ro.product.model]: [Wifi Phone]\n__PLAYLENS__\nlevel: 70\n';
    },
  };
  const tracker = new DeviceTracker(adb);
  t.after(() => tracker.stop());
  tracker.start();
  proc.stdout.write(frame('USB123\tunauthorized\n', true));
  proc.stdout.write(frame('', true));
  proc.stdout.write(frame(`${phone}\tdevice model:Wifi_Phone\n`, true));
  assert.equal(tracker.list()[0].serial, phone);
  assert.equal(tracker.list()[0].transport, 'wifi');
  await once(tracker, 'change');
  assert.equal(tracker.list()[0].info.model, 'Wifi Phone');
  proc.stdout.write(frame('', true));
  assert.deepEqual(tracker.list(), []);
});
