// Live performance of the game over adb, sampled while you play:
//   FPS and frame times  dumpsys SurfaceFlinger --latency <game layer>  (frames actually shown)
//   CPU                  /proc/<pid>/stat  (process time; 100% = one core)
//   GPU busy             vendor sysfs files, when readable (Adreno usually, many Mali phones not)
//   Memory               dumpsys meminfo <pid>  (PSS, includes graphics)
//   Temperature          dumpsys battery, dumpsys thermalservice
// One small shell call per second, meminfo every 5 s, battery/thermal every 10 s.

const SEP = '__PLAYLENS__';
const NEVER = 9223372036854775807n;

const GPU_FILES = [
  '/sys/class/kgsl/kgsl-3d0/gpu_busy_percentage',
  '/sys/kernel/gpu/gpu_busy',
  '/sys/class/misc/mali0/device/utilization',
  '/sys/devices/platform/mali.0/utilization',
  '/sys/module/ged/parameters/gpu_loading',
  '/sys/kernel/ged/hal/gpu_utilization',
];

export const THERMAL = ['None', 'Light', 'Moderate', 'Severe', 'Critical', 'Emergency', 'Shutdown'];

// /proc/<pid>/stat: fields after the ")" of the process name; utime and stime are 14 and 15.
export function parseProcStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0) return null;
  const f = text.slice(close + 2).trim().split(/\s+/);
  const utime = Number(f[11]);
  const stime = Number(f[12]);
  return Number.isFinite(utime) && Number.isFinite(stime) ? utime + stime : null;
}

// First line: refresh period (ns). Then "desiredPresent actualPresent frameReady" per frame.
export function parseSfLatency(text) {
  const lines = text.trim().split(/\r?\n/);
  const period = Number(lines[0]);
  const frames = [];
  for (const l of lines.slice(1)) {
    const parts = l.trim().split(/\s+/);
    if (parts.length < 3) continue;
    let actual;
    try { actual = BigInt(parts[1]); } catch { continue; }
    if (actual === 0n || actual >= NEVER) continue;
    frames.push(Number(actual / 1000n) / 1000);   // ms
  }
  return { periodMs: period > 0 ? period / 1e6 : null, frames };
}

// Pick the game's SurfaceView layer (Unity draws there) from `dumpsys SurfaceFlinger --list`.
// Newer Android versions print "552614a SurfaceView[...]#48719" (a hex id before the name);
// the whole line, id included, is what --latency accepts, so only the scoring ignores the id.
export function pickLayer(list, pkg) {
  const lines = list.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes(pkg));
  const score = (l) => {
    const name = l.replace(/^[0-9a-f]{6,}\s+/, '');
    return (/^SurfaceView/.test(name) ? 4 : 0) + (/BLAST/.test(name) ? 1 : 0) - (/^(Background|Bounds|Splash|Screenshot)|ActivityRecord|^VRI-|\$/.test(name) ? 5 : 0);
  };
  return lines.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function parseMeminfo(text) {
  const kb = (re) => Number(re.exec(text)?.[1]) || null;
  const total = kb(/TOTAL PSS:\s+(\d+)/) ?? kb(/^\s*TOTAL:?\s+(\d+)/m);
  return {
    totalMb: total ? total / 1024 : null,
    javaMb: (kb(/Java Heap:\s+(\d+)/) ?? 0) / 1024 || null,
    nativeMb: (kb(/Native Heap:\s+(\d+)/) ?? 0) / 1024 || null,
    graphicsMb: (kb(/Graphics:\s+(\d+)/) ?? 0) / 1024 || null,
  };
}

export function parseBattery(text) {
  const level = Number(/^\s*level:\s*(\d+)/m.exec(text)?.[1]);
  const temp = Number(/^\s*temperature:\s*(\d+)/m.exec(text)?.[1]);
  const status = Number(/^\s*status:\s*(\d+)/m.exec(text)?.[1]);
  return { level: Number.isFinite(level) ? level : null, temp: Number.isFinite(temp) ? temp / 10 : null, charging: status === 2 || status === 5 };
}

export function parseThermal(text) {
  const status = Number(/Thermal Status:\s*(\d+)/.exec(text)?.[1]);
  // "Temperature{mValue=41.2, mType=0, mName=cpu-0-0, mStatus=0}"; type 0 = CPU, 3 = skin.
  const temps = [...text.matchAll(/mValue=([\d.]+), mType=(\d+), mName=([^,]+)/g)].map((m) => ({ value: Number(m[1]), type: Number(m[2]) }));
  const cpu = temps.filter((t) => t.type === 0).map((t) => t.value);
  return { status: Number.isFinite(status) ? status : null, cpuTemp: cpu.length ? Math.max(...cpu) : null };
}

export function parseGpu(text) {
  const n = /(\d+(?:\.\d+)?)/.exec(text)?.[1];
  if (n == null) return null;
  const v = Number(n);
  // Some files report "busy total" pairs, e.g. "1234 5678".
  const pair = /^\s*(\d+)\s+(\d+)\s*$/.exec(text);
  if (pair && Number(pair[2]) > 0) return Math.round((Number(pair[1]) / Number(pair[2])) * 100);
  return v <= 100 ? Math.round(v) : null;
}

// ── Model: series + summary for one stream ──────────────────────────────────

const HIST_MS = 1000;          // frame-time histogram, 1 ms bins up to 1 s
const MAX_POINTS = 3600;

export class PerfModel {
  constructor() {
    this.samples = [];
    this.sent = 0;
    this.hist = new Uint32Array(HIST_MS + 1);
    this.frames = 0;
    this.stutters = 0;
    this.longestFrame = 0;
    this.gc = { count: 0, pausedMs: 0, longestMs: 0 };
    this.info = { fps: 'waiting', gpu: 'waiting', layer: null, refreshMs: null, cores: null };
    this.battery = { start: null, end: null };
    this.thermalMax = null;
    this.firstAt = null;
  }

  addFrames(intervals) {
    for (const ms of intervals) {
      if (!(ms > 0) || ms > 5000) continue;
      this.hist[Math.min(HIST_MS, Math.round(ms))]++;
      this.frames++;
      if (ms > 83) this.stutters++;
      if (ms > this.longestFrame) this.longestFrame = ms;
    }
  }

  addGc(pausedMs) {
    this.gc.count++;
    this.gc.pausedMs += pausedMs;
    this.gc.longestMs = Math.max(this.gc.longestMs, pausedMs);
  }

  add(s) {
    this.firstAt ??= s.t;
    this.samples.push(s);
    if (s.battery != null) {
      this.battery.start ??= s.battery;
      this.battery.end = s.battery;
    }
    if (s.thermal != null) this.thermalMax = Math.max(this.thermalMax ?? 0, s.thermal);
    if (this.samples.length > MAX_POINTS) {
      // Keep the whole session: halve the resolution of the older half.
      const half = Math.floor(this.samples.length / 2);
      const older = this.samples.slice(0, half).filter((_, i) => i % 2 === 0);
      this.samples = [...older, ...this.samples.slice(half)];
      this.sent = 0;
      this.resend = true;
    }
  }

  percentile(p) {
    if (!this.frames) return null;
    let target = this.frames * p;
    for (let i = 0; i <= HIST_MS; i++) {
      target -= this.hist[i];
      if (target <= 0) return i;
    }
    return HIST_MS;
  }

  // Average frame time of the slowest share of frames ("1% low" uses 0.01).
  slowestAvg(share) {
    if (!this.frames) return null;
    let left = Math.max(1, Math.round(this.frames * share));
    let sum = 0;
    const n = left;
    for (let i = HIST_MS; i >= 0 && left > 0; i--) {
      const take = Math.min(left, this.hist[i]);
      sum += take * i;
      left -= take;
    }
    return sum / n;
  }

  summary() {
    const vals = (k) => this.samples.map((s) => s[k]).filter((v) => v != null);
    const stat = (k) => {
      const v = vals(k);
      if (!v.length) return null;
      return { avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), last: v[v.length - 1] };
    };
    const fps = vals('fps');
    const under30 = fps.length ? fps.filter((v) => v < 30).length / fps.length : null;
    const median = this.percentile(0.5);
    const slow = this.slowestAvg(0.01);
    const durationS = this.samples.length ? (this.samples[this.samples.length - 1].t - this.firstAt) / 1000 : 0;
    const buckets = [[0, 25], [26, 33], [34, 50], [51, 100], [101, HIST_MS]].map(([a, b]) => {
      let n = 0;
      for (let i = a; i <= b; i++) n += this.hist[i];
      return this.frames ? n / this.frames : 0;
    });
    const stable = median && fps.length ? fps.filter((v) => Math.abs(v - 1000 / median) <= 0.2 * (1000 / median)).length / fps.length : null;
    return {
      durationS,
      fps: stat('fps'),
      cpu: stat('cpu'),
      gpu: stat('gpu'),
      mem: stat('mem'),
      temp: stat('temp'),
      under30,
      frames: this.frames,
      medianFps: median ? 1000 / median : null,
      lowFps: slow ? 1000 / slow : null,
      stability: stable,
      stutters: this.stutters,
      stuttersPerMin: durationS > 0 ? this.stutters / (durationS / 60) : null,
      longestFrame: this.longestFrame || null,
      buckets,
      gc: this.gc,
      battery: this.battery,
      thermalMax: this.thermalMax,
      memStart: vals('mem')[0] ?? null,
      memEnd: vals('mem').at(-1) ?? null,
      info: this.info,
    };
  }

  // New samples since the last call (or all of them after a resolution change).
  delta() {
    const reset = !!this.resend;
    this.resend = false;
    const out = this.samples.slice(reset ? 0 : this.sent);
    this.sent = this.samples.length;
    return { reset, samples: out };
  }
}

// ── Sampler: drives adb and feeds a PerfModel ───────────────────────────────

export class PerfSampler {
  constructor({ adb, serial, pkg, model, intervalMs = 1000 }) {
    Object.assign(this, { adb, serial, pkg, model, intervalMs });
    this.tick = 0;
    this.pid = null;
    this.layer = null;
    this.lastFrame = 0;
    this.lastCpu = null;
    this.gpuFile = undefined;
    this.noFrames = 0;
    this.mem = null;
    this.batt = null;
    this.thermal = null;
    this.busy = false;
  }

  start() {
    const tick = () => this.step().then(() => { this.model.info.error = null; }, (err) => { this.model.info.error = String(err.message || err).split('\n')[0].slice(0, 160); });
    this.timer = setInterval(tick, this.intervalMs);
    tick();
  }

  stop() {
    clearInterval(this.timer);
    this.stopped = true;
  }

  // adb passes the phone's exit code through, and `pidof` (no such process) or a probe loop
  // that finds nothing exit non-zero. The output is still what we want, so only a real
  // failure (timeout, adb gone) counts as one.
  async sh(cmd, timeout = 8000) {
    try {
      return await this.adb.shell(this.serial, cmd, { timeout });
    } catch (err) {
      if (typeof err.code === 'number' && !err.killed && typeof err.stdout === 'string') return err.stdout;
      throw err;
    }
  }

  async setup() {
    if (this.model.info.cores == null) {
      const out = await this.sh(`cat /sys/devices/system/cpu/possible; echo ${SEP}; for f in ${GPU_FILES.join(' ')}; do [ -r $f ] && cat $f >/dev/null 2>&1 && echo $f && break; done; true`);
      const [cpus, gpu] = out.split(SEP);
      const r = /(\d+)-(\d+)/.exec(cpus);
      this.model.info.cores = r ? Number(r[2]) - Number(r[1]) + 1 : null;
      this.gpuFile = gpu.trim().split(/\s+/)[0] || null;
      this.model.info.gpu = this.gpuFile ? 'ok' : 'unreadable';
    }
  }

  async findPid() {
    const out = (await this.sh(`pidof ${this.pkg}`)).trim();
    const pid = Number(out.split(/\s+/)[0]) || null;
    if (pid !== this.pid) {
      this.pid = pid;
      this.layer = null;
      this.lastCpu = null;
      this.lastFrame = 0;
    }
    return pid;
  }

  async findLayer() {
    this.layer = pickLayer(await this.sh('dumpsys SurfaceFlinger --list'), this.pkg);
    this.model.info.layer = this.layer;
    this.model.info.fps = this.layer ? 'ok' : 'no-layer';
  }

  async step() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      this.tick++;
      await this.setup();
      if (!this.pid || this.tick % 5 === 0) await this.findPid();
      const t = Date.now();
      if (!this.pid) {
        this.model.info.fps = 'not-running';
        return;
      }
      if (!this.layer || this.noFrames >= 3) {
        this.noFrames = 0;
        await this.findLayer();
      }
      const parts = [`cat /proc/${this.pid}/stat`];
      parts.push(this.layer ? `dumpsys SurfaceFlinger --latency '${this.layer.replace(/'/g, "'\\''")}'` : 'echo');
      parts.push(this.gpuFile ? `cat ${this.gpuFile}` : 'echo');
      if (this.tick % 5 === 1) parts.push(`dumpsys meminfo ${this.pid}`);
      else parts.push('echo');
      if (this.tick % 10 === 1) parts.push('dumpsys battery; echo; dumpsys thermalservice | head -40');
      else parts.push('echo');
      const [stat, lat, gpu, mem, batt] = (await this.sh(parts.join(`; echo ${SEP}; `), 10000)).split(SEP);
      if (this.stopped) return;

      // CPU
      let cpu = null;
      const ticks = parseProcStat(stat);
      if (ticks != null) {
        if (this.lastCpu) cpu = ((ticks - this.lastCpu.ticks) / 100) / ((t - this.lastCpu.t) / 1000) * 100;
        this.lastCpu = { ticks, t };
      } else {
        this.pid = null;   // process gone; look again next tick
      }

      // FPS + frame times from frames presented since the last sample
      let fps = null;
      if (this.layer) {
        const { periodMs, frames } = parseSfLatency(lat);
        if (periodMs) this.model.info.refreshMs = periodMs;
        const fresh = frames.filter((f) => f > this.lastFrame);
        if (fresh.length && this.lastFrame) {
          const all = [this.lastFrame, ...fresh];
          this.model.addFrames(all.slice(1).map((f, i) => f - all[i]));
          // Frames shown over the span they cover; at least ~ the wall time between samples,
          // so a game that stopped drawing mid-sample isn't reported as smooth.
          const spanMs = fresh[fresh.length - 1] - this.lastFrame;
          const wallMs = this.lastT ? t - this.lastT : this.intervalMs;
          fps = fresh.length / (Math.max(spanMs, wallMs * 0.75) / 1000);
          if (periodMs) fps = Math.min(fps, 1000 / periodMs);
        } else if (!fresh.length) {
          this.noFrames++;
          fps = this.lastFrame ? 0 : null;
        }
        if (frames.length) this.lastFrame = Math.max(this.lastFrame, frames[frames.length - 1]);
      }
      this.lastT = t;

      if (mem.trim()) this.mem = parseMeminfo(mem);
      if (batt.trim()) {
        this.batt = parseBattery(batt);
        this.thermal = parseThermal(batt);
      }
      this.model.add({
        t,
        fps: fps != null ? Math.round(fps * 10) / 10 : null,
        cpu: cpu != null && cpu >= 0 ? Math.round(cpu) : null,
        gpu: this.gpuFile ? parseGpu(gpu) : null,
        mem: this.mem?.totalMb != null ? Math.round(this.mem.totalMb) : null,
        gfx: this.mem?.graphicsMb != null ? Math.round(this.mem.graphicsMb) : null,
        temp: this.batt?.temp ?? null,
        cpuTemp: this.thermal?.cpuTemp ?? null,
        thermal: this.thermal?.status ?? null,
        battery: this.batt?.level ?? null,
      });
    } finally {
      this.busy = false;
    }
  }
}

// Replay device: believable numbers so the Performance view can be tried without a phone.
export class ReplayPerf {
  constructor({ model }) {
    this.model = model;
    this.n = 0;
  }

  start() {
    Object.assign(this.model.info, { fps: 'ok', gpu: 'ok', layer: 'SurfaceView[com.avn.demo/com.unity3d.player.UnityPlayerActivity](BLAST)', refreshMs: 16.67, cores: 8, replay: true });
    this.timer = setInterval(() => this.step(), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  step() {
    const n = this.n++;
    const ad = n % 70 > 55;   // an "ad" every 70 s: lower FPS, more memory
    const base = ad ? 42 : 58;
    const fps = Math.max(5, Math.round((base + Math.sin(n / 3) * 3 + (Math.random() - 0.5) * 4 - (n % 23 === 0 ? 25 : 0)) * 10) / 10);
    const frames = Array.from({ length: Math.round(fps) }, () => 1000 / fps + (Math.random() - 0.5) * 6);
    if (n % 23 === 0) frames.push(140);
    this.model.addFrames(frames);
    if (n % 9 === 0) this.model.addGc(1 + Math.random() * 6);
    this.model.add({
      t: Date.now(),
      fps,
      cpu: Math.round(95 + Math.sin(n / 5) * 25 + Math.random() * 20 + (ad ? 30 : 0)),
      gpu: Math.round(48 + Math.sin(n / 7) * 12 + Math.random() * 8 + (ad ? 15 : 0)),
      mem: Math.round(Math.min(560, 180 + n * 12) + (ad ? 60 : 0) + Math.random() * 6),
      gfx: Math.round(120 + (ad ? 40 : 0)),
      temp: Math.round((33.5 + Math.min(n / 120, 3)) * 10) / 10,
      cpuTemp: Math.round((44 + Math.min(n / 40, 9)) * 10) / 10,
      thermal: n > 240 ? 1 : 0,
      battery: Math.max(5, 82 - Math.floor(n / 90)),
    });
  }
}
