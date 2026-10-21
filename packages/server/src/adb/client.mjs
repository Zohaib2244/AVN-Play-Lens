// Thin wrapper over the adb binary. Never runs `adb kill-server`: Unity's Build and Run
// shares the same adb server, and killing it would drop Unity's connection mid-build.
import { execFile, spawn } from 'node:child_process';

export class Adb {
  constructor(bin) {
    this.bin = bin;
  }

  args(args, serial) {
    return serial ? ['-s', serial, ...args] : args;
  }

  run(args, { serial, timeout = 15000, encoding = 'utf8' } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, this.args(args, serial), { timeout, encoding, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  shell(serial, command, opts) {
    return this.run(['shell', command], { serial, ...opts });
  }

  spawn(args, { serial } = {}) {
    return spawn(this.bin, this.args(args, serial), { windowsHide: true });
  }

  async version() {
    const out = await this.run(['version']);
    // "Version 35.0.2-12147458" is the platform-tools release; fall back to the protocol version.
    return /^Version ([\d.]+)/m.exec(out)?.[1] ?? /Android Debug Bridge version ([\d.]+)/.exec(out)?.[1] ?? null;
  }
}
