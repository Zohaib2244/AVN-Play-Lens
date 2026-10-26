/** The local Node API and WebSocket protocol. Keep measurements nullable when unavailable. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Params = Record<string, Json>;
export interface Game {
  id: string;
  name: string;
  packageId: string;
  icon?: string | null;
  installed?: boolean;
  versionName?: string;
  versionCode?: number;
  running?: boolean;
}
export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  tier?: string;
  android?: string;
  sdk?: number;
  chipset?: string;
  cores?: number;
  abis: string[];
  gpu?: string;
  ramGb?: number;
  screen?: { w: number; h: number; dpi?: number };
  refreshHz?: number;
  battery?: number;
  batteryTemp?: number;
  securityPatch?: string;
}
export interface Device {
  serial: string;
  state: string;
  replay?: boolean;
  transport?: string;
  info?: DeviceInfo;
  props?: { model?: string };
  label?: string;
  saved?: boolean;
  address?: string;
}
export interface SavedDevice {
  ip?: string;
  id: string;
  serial?: string;
  label: string;
  address?: string;
  host?: string;
  port?: number;
  autoReconnect: boolean;
  connected?: boolean;
  lastSeen?: number;
  lastError?: string;
  connectAddress?: string;
  lastConnectAddress?: string;
  deviceId?: string;
  status?: string;
}
export interface AppInfo {
  versionName?: string;
  versionCode?: number;
  targetSdk?: number;
  minSdk?: number;
  debuggable?: boolean;
  abi?: string;
  sizeBytes?: number;
  splits: number;
  installer?: string;
  lastUpdate?: string;
}
export interface Profile {
  device: DeviceInfo;
  app: AppInfo;
}
export interface PairState {
  state: string;
  qr?: string;
  message?: string;
  error?: string;
  address?: string;
  service?: string;
  code?: string;
}
export interface LogEntry {
  id: number;
  ts: number;
  level: string;
  tag: string;
  message: string;
  pid: number;
  tid: number;
  source?: string;
  kind?: string;
  more?: string[];
  gkey?: string;
  owner?: string;
  sdk?: string;
  meaning?: string;
  safe?: boolean;
  avn?: {
    kind?: string;
    key?: string;
    state?: string;
    format?: string;
    callback?: string;
    caller?: { class: string };
    name?: string;
    value?: Json;
    reason?: string;
    event?: { name: string; stage: string; params?: Params };
    fields?: Params;
  };
  fa?: { name: string; origin?: string; params?: Params };
}
export interface LogGroup {
  key: string;
  owner?: string;
  sdk: string | null;
  tag: string;
  level: string;
  kind?: string;
  meaning: string | null;
  safe: boolean;
  count: number;
  first: number;
  last: number;
  lastId: number;
  sample: LogEntry;
}
export type Metric =
  | "fps"
  | "cpu"
  | "mem"
  | "temp"
  | "gpu"
  | "gfx"
  | "cpuTemp"
  | "thermal";
export type PerfSample = { t: number; battery?: number } & Partial<
  Record<Metric, number | null>
>;
export interface Stat {
  last?: number;
  avg: number;
  min: number;
  max: number;
}
export interface PerfSummary {
  info: {
    fps?: string;
    gpu?: string;
    error?: string;
    refreshMs?: number;
    cores?: number;
  };
  durationS?: number;
  fps?: Stat;
  cpu?: Stat;
  mem?: Stat;
  temp?: Stat;
  gpu?: Stat;
  under30?: number;
  lowFps?: number;
  memStart?: number;
  memEnd?: number;
  frames?: number;
  stutters?: number;
  stuttersPerMin?: number;
  medianFps?: number;
  stability?: number;
  longestFrame?: number;
  buckets: number[];
  gc?: { count: number; pausedMs: number; longestMs: number };
  battery?: { start: number; end: number };
  thermalMax?: number;
}
export interface FirebaseEvent {
  id: string;
  ts: number;
  sdk: string;
  name: string;
  check: string;
  auto?: boolean;
  missing?: boolean;
  params?: Params;
  paramCount?: number;
  problems?: string[];
  entryId?: number;
  origin?: string;
}
export interface EventType {
  sdk: string;
  name: string;
  auto?: boolean;
  count: number;
  firstTs: number;
  lastTs: number;
  params: string[];
}
export interface FirebaseCounts {
  firebase: number;
  app?: number;
  byteBrew?: number;
  notLogged: number;
  pending?: number;
  sent: number;
  problems?: number;
}
export interface FirebaseSnapshot {
  rows: FirebaseEvent[];
  catalog?: EventType[];
  counts: FirebaseCounts;
  debug?: { on: boolean } | null;
  receiving?: boolean;
  diagnostics?: {
    lines?: number;
    upload?: { state: string; ts: number; entryId?: number };
    issue?: string;
  };
}
export type FirebaseInput = Pick<FirebaseSnapshot, "rows"> &
  Partial<Omit<FirebaseSnapshot, "rows">>;
export interface RuntimeCheck {
  id: string;
  name: string;
  status: string;
  key?: string;
  value?: Json;
  note?: string;
  result?: string;
  group?: string;
  event?: string;
  sdk?: string;
  firstTs?: number;
}
export interface Flag {
  id: string;
  severity: string;
  name: string;
  message: string;
  count: number;
  entryId: number;
}
export interface Funnel {
  key: string;
  name: string;
  format: string;
  loadSent: number;
  loaded: number;
  loadFailed: number;
  showSent: number;
  shown: number;
  displayed: number;
  closed: number;
  paid: number;
  state: string;
}
export interface SdkCard {
  key: string;
  label: string;
  state?: string;
  notUsed?: boolean;
  noLogs?: boolean;
  upInMs?: number;
  waitingMs?: number;
  message?: string;
}
export interface Startup {
  id: string;
  label: string;
  status: string;
  at: number | null;
  android?: number;
  failed?: string;
}
export interface HealthSnapshot {
  rc?: RemoteConfig;
  levels?: { current?: number };
  seen: boolean;
  startup: Startup[];
  sdks: SdkCard[];
  adapters: { name: string; status: string }[];
  maxConfig?: { country?: string };
  adapterSummary?: { ok: number; total: number };
  appStart?: number;
  debugInRelease?: boolean;
  debugLogs?: string;
  firstEventVerified?: boolean;
  funnels: Funnel[];
  revenue: { total: number };
  launch?: { steps: Startup[]; captured: boolean };
}
export interface ConfigValue {
  name: string;
  parent?: string;
  source?: string;
  from?: string;
  type?: string;
  hasValue?: boolean;
  value?: Json;
  truncated?: boolean;
  declaredType?: string;
  ts?: number;
  entryId?: number;
}
export interface RemoteConfig {
  values?: ConfigValue[];
  variables?: ConfigValue[];
  sources?: Record<string, string>;
  fetch?: { lastFetchStatus?: string; ts?: number };
}
export interface BuildRow {
  id: string;
  label: string;
  value: string;
  section: string;
  page?: number;
  status: string;
  note?: string;
  evidence?: { ts: number; entryId?: number };
}
export interface BuildReport {
  id?: string;
  packageId: string;
  versionName: string;
  versionCode: string | number;
  filename?: string;
  fileName?: string;
  source?: string;
  rows: BuildRow[];
  importedAt?: number;
  title?: string;
  pages?: number;
  ocr?: boolean;
}
export interface BuildVerification {
  simulated?: boolean;
  filename?: string;
  versionName?: string;
  versionCode?: string | number;
  id?: string;
  rows: BuildRow[];
  matches?: boolean;
  reason?: string;
  verified?: number;
  total?: number;
  report?: BuildReport;
  match?: boolean;
}
export interface Run {
  active: boolean;
  startedAt: number;
  file: string;
  items: RuntimeCheck[];
  build?: BuildVerification;
  rc?: RemoteConfig;
}
export interface Monitor {
  report?: Report;
  health: HealthSnapshot;
  firebase: FirebaseSnapshot;
  flags: Flag[];
  adRules?: { checks: RuntimeCheck[]; levelSource?: string };
  privacy?: RuntimeCheck[];
  app?: AppInfo;
  sdkList?: {
    engine: string[];
    apkRead?: boolean;
    extra: {
      name: string;
      version?: string;
      inApp?: boolean;
      lines: number;
      warnings: number;
      errors: number;
      adapter?: string;
    }[];
  };
  run?: Run;
  buildReport?: BuildReport;
  remoteConfig?: RemoteConfig;
  rc?: RemoteConfig;
}
export interface Session {
  recording?: boolean;
  saved?: boolean;
  id: string;
  name?: string;
  pkg?: string;
  serial?: string;
  gameName?: string;
  device: string;
  startedAt: number;
  lines: number;
  versionName?: string;
  versionCode?: number;
  active?: boolean;
  paused?: boolean;
}
export interface SavedSessionData {
  session: Session;
  snapshot?: Partial<Monitor>;
  entries: LogEntry[];
}
export interface Report {
  id: string;
  passed: number;
  total: number;
  buildVerified?: number;
  buildTotal?: number;
}
export interface Rules {
  files: {
    file: string;
    game?: string;
    expect: number;
    watch: number;
    error?: string;
  }[];
  presets: { name: string; id?: string; file?: string }[];
  dir: string;
}
export interface SnapshotImage {
  level: number;
  name: string;
  capturedAt: number;
  bytes: number;
}
export interface CaptureState {
  watching?: boolean;
  pendingLevel?: number | null;
  busy?: boolean;
  enabled: boolean;
  delayMs: number;
  serial?: string;
  lastLevel?: number;
  pending?: boolean;
  error?: string;
  status?: string;
}
export interface Snapshots {
  snapshots: SnapshotImage[];
  capture: CaptureState;
}
export interface ToastMessage {
  kind?: import("@avn/ui").ToastKind;
  action?: { label: string; onClick?: () => void };
  title: string;
  msg?: string;
  severity?: string;
}
export interface ServerStatus {
  adbSearched?: string[];
  replay?: boolean;
  adb?: string;
  version?: string;
  record?: boolean;
  rulesDir?: string;
}
export type Command = { type: string; [key: string]: Json | undefined };
export type ServerMessage =
  | { type: "hello"; status: ServerStatus; devices: Device[]; pair: PairState }
  | { type: "devices"; devices: Device[] }
  | ({ type: "pair" } & PairState)
  | { type: "error"; message: string }
  | { type: "qa.run" }
  | ({ type: "run.report"; streamId?: number } & Report)
  | {
      type: "stream.state";
      state: string;
      running: boolean;
      reason?: string;
      streamId?: number;
    }
  | ({ type: "monitor"; streamId?: number } & Monitor)
  | ({ type: "session"; reset?: boolean; streamId?: number } & Session)
  | {
      type: "alert";
      streamId?: number;
      severity: string;
      title: string;
      message: string;
    }
  | {
      type: "perf";
      streamId?: number;
      reset?: boolean;
      samples: PerfSample[];
      summary: PerfSummary;
    }
  | { type: "log.batch"; streamId?: number; entries: LogEntry[]; rate: number };
