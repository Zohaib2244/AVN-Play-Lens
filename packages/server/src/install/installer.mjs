// Installs a game's latest build on a phone. APKs go straight to `adb install`; app bundles are
// turned into the phone's APK set with bundletool first. Jobs on one phone run one at a time,
// every step is reported, and a failure comes back as a reason plus what to do about it.
// Auto-install: when a source marked "install automatically" gets a new build, or a phone
// connects, phones that lack the build get it. A build that failed on a phone is not retried
// automatically; the page offers the retry.
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { parseAppProfile } from '../device/profile.mjs';
import { ArtifactError, deviceMismatch } from './artifact.mjs';
import { explainInstallFailure } from './errors.mjs';
import { locateBundleTools } from './tools.mjs';

const STEP_LABELS = {
  find: 'Find the build',
  check: 'Check the phone',
  uninstall: 'Uninstall the old copy',
  prepare: 'Make APKs for this phone (bundletool)',
  install: 'Install',
  verify: 'Confirm on the phone',
};
const ACTIVE = new Set(['queued', 'running']);
const INSTALL_TIMEOUT = 10 * 60 * 1000;
const KEEP_JOBS = 100;

class InstallError extends Error {
  constructor({ code, message, hint = null, retry = null, output = null }) {
    super(message);
    Object.assign(this, { code, hint, retry, output });
  }
}

// Runs a child process, collecting output (capped), with a timeout and a cancel hook.
function collect(child, { timeout = INSTALL_TIMEOUT, onChild } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    const add = (c) => { output = (output + c).slice(-64 * 1024); };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    const timer = setTimeout(() => { timedOut = true; child.kill?.('SIGKILL'); }, timeout);
    onChild?.(child);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, output: output + `\n${err.message}`, spawnError: err }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: code ?? -1, signal, output, timedOut }); });
  });
}

// "2026-10-26 16:25:01" from dumpsys, read as the computer's local time.
export function parseDumpsysTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(text ?? '').trim());
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  return Number.isFinite(t) ? t : null;
}

export class Installer extends EventEmitter {
  constructor({ adb, sources, games, devices, busy = () => null, tools = locateBundleTools, dir = join(os.homedir(), '.avn-playlens'), onInstalled = () => {} }) {
    super();
    Object.assign(this, { adb, sources, games, devices, busy, tools, dir, onInstalled });
    this.jobs = [];
    this.queues = new Map();
    this.children = new Map();
    this.ready = new Set();
    sources.on('artifact', (gameId) => this.autoInstall(gameId).catch(() => {}));
  }

  view(job) {
    const { cancelled, ...rest } = job;
    void cancelled;
    return structuredClone(rest);
  }

  list({ gameId } = {}) {
    return this.jobs.filter((j) => !gameId || j.gameId === gameId).map((j) => this.view(j));
  }

  get(id) {
    const job = this.jobs.find((j) => j.id === id);
    return job ? this.view(job) : null;
  }

  update(job) {
    this.emit('update', this.view(job));
  }

  device(serial) {
    return this.devices().find((d) => d.serial === serial) ?? null;
  }

  deviceProblem(serial) {
    const d = this.device(serial);
    if (!d) return 'This phone is not connected. Connect it from Devices.';
    if (d.replay) return 'The replay device is a recording; nothing can be installed on it.';
    if (d.state === 'unauthorized') return 'Allow USB debugging on the phone first (accept the prompt on its screen).';
    if (d.state !== 'device') return `The phone is ${d.state}. Reconnect it from Devices.`;
    return null;
  }

  activeFor(serial, gameId) {
    return this.jobs.find((j) => j.serial === serial && (!gameId || j.gameId === gameId) && ACTIVE.has(j.status)) ?? null;
  }

  start({ gameId, serial, uninstallFirst = false, trigger = 'manual' }) {
    const game = this.games.list().find((g) => g.id === gameId);
    if (!game) throw Object.assign(new Error('Game not found'), { statusCode: 404 });
    if (!this.adb) throw Object.assign(new Error('adb was not found, so PlayLens cannot install builds'), { statusCode: 503 });
    if (typeof serial !== 'string' || !serial) throw Object.assign(new Error('Choose a phone to install on'), { statusCode: 400 });
    const problem = this.deviceProblem(serial);
    if (problem) throw Object.assign(new Error(problem), { statusCode: 409 });
    if (!this.sources.get(gameId).source) throw Object.assign(new Error(`Choose where ${game.name}'s builds come from first`), { statusCode: 409 });
    const existing = this.activeFor(serial, gameId);
    if (existing) throw Object.assign(new Error(`${game.name} is already being installed on this phone`), { statusCode: 409, jobId: existing.id });
    const d = this.device(serial);
    const job = {
      id: randomUUID().slice(0, 8), gameId, packageId: game.packageId, gameName: game.name, serial,
      device: d?.info?.model || d?.props?.model?.replace(/_/g, ' ') || serial,
      trigger, uninstallFirst: uninstallFirst === true, status: 'queued', steps: [], artifact: null, error: null, installed: null,
      createdAt: Date.now(), startedAt: null, endedAt: null,
    };
    this.jobs.unshift(job);
    if (this.jobs.length > KEEP_JOBS) {
      const keep = this.jobs.filter((j) => ACTIVE.has(j.status));
      this.jobs = [...new Set([...keep, ...this.jobs.slice(0, KEEP_JOBS)])];
    }
    const prev = this.queues.get(serial) ?? Promise.resolve();
    const next = prev.then(() => this.run(job)).catch(() => {});
    this.queues.set(serial, next);
    next.finally(() => { if (this.queues.get(serial) === next) this.queues.delete(serial); });
    this.update(job);
    return this.view(job);
  }

  cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || !ACTIVE.has(job.status)) return false;
    job.cancelled = true;
    this.children.get(id)?.kill?.('SIGKILL');
    if (job.status === 'queued') this.finish(job, 'cancelled');
    return true;
  }

  finish(job, status, error = null) {
    job.status = status;
    job.error = error;
    job.endedAt = Date.now();
    for (const s of job.steps) if (s.status === 'running') { s.status = status === 'cancelled' ? 'cancelled' : 'failed'; s.endedAt = job.endedAt; }
    this.update(job);
  }

  async step(job, id, fn) {
    if (job.cancelled) throw new InstallError({ code: 'cancelled', message: 'Cancelled' });
    const s = { id, label: STEP_LABELS[id], status: 'running', detail: null, startedAt: Date.now(), endedAt: null };
    job.steps.push(s);
    this.update(job);
    try {
      const detail = await fn(s);
      if (job.cancelled) throw new InstallError({ code: 'cancelled', message: 'Cancelled' });
      s.status = 'done';
      if (detail) s.detail = detail;
      s.endedAt = Date.now();
      this.update(job);
    } catch (err) {
      s.status = job.cancelled ? 'cancelled' : 'failed';
      s.endedAt = Date.now();
      throw err;
    }
  }

  async exec(job, child, opts) {
    const r = await collect(child, { ...opts, onChild: (c) => this.children.set(job.id, c) });
    this.children.delete(job.id);
    if (job.cancelled) throw new InstallError({ code: 'cancelled', message: 'Cancelled' });
    return r;
  }

  async run(job) {
    if (job.status !== 'queued') return;
    job.status = 'running';
    job.startedAt = Date.now();
    this.update(job);
    let artifact = null;
    try {
      await this.step(job, 'find', async () => {
        try { artifact = await this.sources.latestArtifact(job.gameId); }
        catch (err) { throw new InstallError({ code: err.code ?? 'no-build', message: err.message, hint: err.hint ?? null }); }
        job.artifact = { name: artifact.name, path: artifact.path, kind: artifact.kind, versionName: artifact.versionName, versionCode: artifact.versionCode, size: artifact.size, modifiedAt: artifact.modifiedAt, fingerprint: artifact.fingerprint };
        return `${artifact.name} · v${artifact.versionName ?? '?'} (${artifact.versionCode ?? '?'}) · ${(artifact.size / 1048576).toFixed(0)} MB`;
      });

      await this.step(job, 'check', async () => {
        const problem = this.deviceProblem(job.serial);
        if (problem) throw new InstallError({ code: 'phone-disconnected', message: problem, retry: 'again' });
        const owner = this.busy(job.serial);
        if (owner) throw new InstallError({ code: 'phone-busy', message: owner, hint: 'Wait for it to finish or cancel it, then install again.', retry: 'again' });
        const props = await this.adb.shell(job.serial, 'getprop ro.build.version.sdk; getprop ro.product.cpu.abilist', { timeout: 10000 })
          .catch((err) => { throw new InstallError({ code: 'phone-disconnected', message: `Could not talk to the phone: ${err.message.split('\n')[0]}`, hint: 'Reconnect it from Devices, then install again.', retry: 'again' }); });
        const [sdk, abilist = ''] = props.split(/\r?\n/).map((l) => l.trim());
        const mismatch = deviceMismatch(artifact, { sdk: Number(sdk) || null, abis: abilist.split(',').filter(Boolean) });
        if (mismatch) throw new InstallError({ code: mismatch.code, message: mismatch.message, hint: mismatch.hint });
        return `Android API ${sdk || '?'} · ${abilist || 'unknown CPU'}`;
      });

      if (job.uninstallFirst) {
        await this.step(job, 'uninstall', async () => {
          const r = await this.exec(job, this.adb.spawn(['uninstall', job.packageId], { serial: job.serial }), { timeout: 60000 });
          if (/Success/.test(r.output)) return 'Removed the old copy and its data';
          if (/DELETE_FAILED_INTERNAL_ERROR|Unknown package|not installed/i.test(r.output)) return 'It was not installed';
          throw new InstallError({ ...explainInstallFailure(r.output, { fallback: 'Could not uninstall the old copy' }), retry: 'again' });
        });
      }

      if (artifact.kind === 'apk') {
        await this.step(job, 'install', async () => {
          // -r replace, -d allow downgrade (debuggable builds), -t allow test-only.
          const r = await this.exec(job, this.adb.spawn(['install', '-r', '-d', '-t', artifact.path], { serial: job.serial }));
          if (r.timedOut) throw new InstallError({ code: 'timeout', message: 'The install took longer than 10 minutes and was stopped', hint: 'Use a USB cable for large builds, then try again.', retry: 'again' });
          if (r.spawnError) throw new InstallError({ code: 'adb-failed', message: `Could not run adb: ${r.spawnError.message}` });
          if (r.code !== 0 || !/\bSuccess\b/.test(r.output)) throw new InstallError(explainInstallFailure(r.output));
          return null;
        });
      } else {
        const temp = await mkdtemp(join(os.tmpdir(), 'playlens-apks-'));
        try {
          const tools = this.tools();
          await this.step(job, 'prepare', async () => {
            if (!tools.jar) throw new InstallError({ code: 'no-bundletool', message: 'bundletool was not found, so app bundles (.aab) cannot be installed', hint: 'Install Unity\'s Android Build Support module (it includes bundletool), set PLAYLENS_BUNDLETOOL to a bundletool-all.jar, or build an APK instead.' });
            if (!tools.java) throw new InstallError({ code: 'no-java', message: 'No Java runtime was found, so app bundles (.aab) cannot be installed', hint: 'Install Unity\'s Android Build Support module (it includes OpenJDK) or set PLAYLENS_JAVA.' });
            const ks = await this.keystore(job, tools);
            const r = await this.exec(job, spawn(tools.java, ['-jar', tools.jar, 'build-apks', `--bundle=${artifact.path}`, `--output=${join(temp, 'app.apks')}`, '--overwrite',
              '--connected-device', `--device-id=${job.serial}`, `--adb=${this.adb.bin}`,
              `--ks=${ks}`, '--ks-pass=pass:android', '--ks-key-alias=androiddebugkey', '--key-pass=pass:android'], { windowsHide: true }));
            if (r.timedOut) throw new InstallError({ code: 'timeout', message: 'bundletool took longer than 10 minutes and was stopped', retry: 'again' });
            if (r.code !== 0) throw new InstallError(explainInstallFailure(r.output, { fallback: 'bundletool could not make APKs for this phone' }));
            return 'Signed with the debug key';
          });
          await this.step(job, 'install', async () => {
            const r = await this.exec(job, spawn(tools.java, ['-jar', tools.jar, 'install-apks', `--apks=${join(temp, 'app.apks')}`, `--device-id=${job.serial}`, `--adb=${this.adb.bin}`, '--allow-downgrade'], { windowsHide: true }));
            if (r.timedOut) throw new InstallError({ code: 'timeout', message: 'The install took longer than 10 minutes and was stopped', hint: 'Use a USB cable for large builds, then try again.', retry: 'again' });
            if (r.code !== 0) throw new InstallError(explainInstallFailure(r.output));
            return null;
          });
        } finally {
          await rm(temp, { recursive: true, force: true }).catch(() => {});
        }
      }

      await this.step(job, 'verify', async () => {
        const out = await this.adb.shell(job.serial, `dumpsys package ${job.packageId}`, { timeout: 10000 }).catch(() => '');
        const profile = parseAppProfile(out);
        if (!profile.versionCode && !profile.versionName) throw new InstallError({ code: 'not-on-phone', message: 'The install reported success, but the phone does not list the game', hint: 'Check the phone for a prompt, then install again.', retry: 'again' });
        job.installed = { versionName: profile.versionName, versionCode: profile.versionCode };
        if (artifact.versionCode != null && profile.versionCode !== artifact.versionCode) {
          throw new InstallError({ code: 'version-mismatch', message: `The phone reports versionCode ${profile.versionCode}, not ${artifact.versionCode} from this build`, hint: 'Another install may have run at the same time. Install again.', retry: 'again' });
        }
        return `v${profile.versionName ?? '?'} (${profile.versionCode ?? '?'}) is on the phone`;
      });

      this.sources.recordInstall(job.gameId, job.serial, artifact.fingerprint, true);
      this.onInstalled(job.serial, job.packageId);
      this.finish(job, 'done');
    } catch (err) {
      if (job.cancelled) return this.finish(job, 'cancelled');
      if (artifact) this.sources.recordInstall(job.gameId, job.serial, artifact.fingerprint, false);
      this.onInstalled(job.serial, job.packageId);
      const e = err instanceof InstallError || err instanceof ArtifactError ? err : new InstallError({ code: 'error', message: err.message });
      this.finish(job, 'failed', { code: e.code, message: e.message, hint: e.hint ?? null, retry: e.retry ?? null, output: e.output ?? null });
    }
  }

  // bundletool re-signs the APKs it makes. Use the standard Android debug key, creating a
  // PlayLens one when this computer has none.
  async keystore(job, tools) {
    const standard = join(os.homedir(), '.android', 'debug.keystore');
    if (existsSync(standard)) return standard;
    const own = join(this.dir, 'debug.keystore');
    if (existsSync(own)) return own;
    if (!tools.keytool) throw new InstallError({ code: 'keystore', message: 'There is no debug keystore and keytool was not found to create one', hint: 'Build any Android project once in Unity or Android Studio (it creates ~/.android/debug.keystore), then try again.' });
    mkdirSync(this.dir, { recursive: true });
    const r = await this.exec(job, spawn(tools.keytool, ['-genkeypair', '-keystore', own, '-storepass', 'android', '-alias', 'androiddebugkey', '-keypass', 'android',
      '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US'], { windowsHide: true }), { timeout: 60000 });
    if (r.code !== 0) throw new InstallError({ code: 'keystore', message: 'Could not create a debug keystore', output: r.output.trim().split('\n').slice(-3).join('\n') });
    return own;
  }

  // Phones that should get the game's latest build without being asked.
  async autoInstall(gameId, serials = null) {
    const state = this.sources.get(gameId);
    if (!state.source?.autoInstall || !state.latest || !this.adb) return [];
    const started = [];
    const targets = (serials ?? this.devices().filter((d) => d.state === 'device' && !d.replay).map((d) => d.serial));
    for (const serial of targets) {
      if (this.deviceProblem(serial) || this.busy(serial) || this.activeFor(serial, gameId)) continue;
      const last = state.installs?.[serial];
      if (last?.fingerprint === state.latest.fingerprint) continue;   // installed, or failed and waiting for a manual retry
      const game = this.games.list().find((g) => g.id === gameId);
      if (!game) return started;
      const out = await this.adb.shell(serial, `dumpsys package ${game.packageId}`, { timeout: 10000 }).catch(() => null);
      if (out == null) continue;
      const profile = parseAppProfile(out);
      const installed = profile.versionCode != null || profile.versionName != null;
      const updatedAt = installed ? parseDumpsysTime(profile.lastUpdate) : null;
      // Built and Run from Unity after this file was written: the phone already has something newer.
      if (installed && updatedAt != null && updatedAt >= state.latest.modifiedAt) continue;
      try { started.push(this.start({ gameId, serial, trigger: 'auto' })); } catch { /* raced with another job */ }
    }
    return started;
  }

  // Called with the device list on every change; acts on phones that just became ready.
  observeDevices(devices) {
    const ready = new Set(devices.filter((d) => d.state === 'device' && !d.replay).map((d) => d.serial));
    const fresh = [...ready].filter((s) => !this.ready.has(s));
    this.ready = ready;
    if (!fresh.length) return;
    for (const g of this.games.list()) this.autoInstall(g.id, fresh).catch(() => {});
  }

  close() {
    for (const job of this.jobs) if (ACTIVE.has(job.status)) this.cancel(job.id);
  }
}
