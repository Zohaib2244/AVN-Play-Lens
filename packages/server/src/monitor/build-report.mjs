// Imported publishing reports retain build-time claims; runtime results need fresh evidence.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const PACKAGE = /^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/;
export const BUILD_RESULTS = { verified: 'Verified', matched: 'Matches installed build', pending: 'Not verified', problem: 'Problem', manual: 'Manual check', 'not-applicable': 'Not enabled' };

export function buildMatch(report, pkg, app) {
  if (!report) return { ok: false, reason: 'Upload this build’s publishing report before starting a checklist run.' };
  if (report.packageId !== pkg) return { ok: false, reason: `Report package ${report.packageId} does not match ${pkg}.` };
  if (app?.versionCode == null || !app?.versionName) return { ok: false, reason: 'Waiting for the installed app’s version information.' };
  if (String(report.versionCode) !== String(app.versionCode) || report.versionName !== app.versionName) return { ok: false, reason: `Report v${report.versionName} (${report.versionCode}) does not match installed v${app.versionName} (${app.versionCode}).` };
  return { ok: true, reason: 'Package, version and build number match. Reused version numbers cannot identify a rebuild.' };
}

export class BuildReportStore {
  constructor(dir = join(os.homedir(), '.avn-playlens', 'build-reports')) { this.dir = dir; }
  get(pkg) {
    if (!PACKAGE.test(pkg || '')) return null;
    try { return JSON.parse(readFileSync(join(this.dir, `${pkg}.json`), 'utf8')); } catch { return null; }
  }
  save(input) {
    const { packageId, versionName, versionCode, rows, pdf } = input ?? {};
    if (!PACKAGE.test(packageId || '') || !String(versionName || '').trim() || !/^\d+$/.test(String(versionCode))) throw new Error('Review the report’s package, version and build number.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || rows.some((r) => !r || typeof r.label !== 'string' || !r.label.trim() || typeof r.value !== 'string' || typeof r.section !== 'string' || [r.label, r.value, r.section].some((s) => s.length > 4000))) throw new Error('No valid For Dev rows were found. Use the publishing checklist PDF.');
    if (typeof pdf !== 'string' || pdf.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(pdf)) throw new Error('Upload a PDF under 20 MB.');
    const bytes = Buffer.from(pdf, 'base64');
    if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('This is not a valid PDF.');
    const id = createHash('sha256').update(bytes).digest('hex');
    const report = { id, filename: String(input.filename || 'publishing-report.pdf').slice(0, 200), packageId, versionName: String(versionName).trim(), versionCode: String(versionCode), importedAt: Date.now(), ocr: !!input.ocr, rows: rows.map((r, i) => ({ id: `dev-${i + 1}`, section: r.section, label: r.label.trim(), value: r.value.trim(), page: Number(r.page) || null })) };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${id}.pdf`), bytes);
    writeFileSync(join(this.dir, `${packageId}.json`), JSON.stringify(report));
    return report;
  }
  pdf(id) {
    if (!/^[a-f0-9]{64}$/.test(id || '')) return null;
    try { return readFileSync(join(this.dir, `${id}.pdf`)); } catch { return null; }
  }
}

const ADAPTERS = { bidmachine: /bidmachine/i, 'bigo ads': /bigo/i, pangle: /pangle/i, facebook: /meta|facebook/i, 'dt exchange': /dt exchange|fyber/i, 'google admob': /admob/i, 'google ad manager': /ad manager/i, inmobi: /inmobi/i, ironsource: /ironsource/i, mintegral: /mintegral/i, moloco: /moloco/i, 'unity ads': /unity/i, 'liftoff monetize': /liftoff|vungle/i, yandex: /yandex/i };

function ruleFor(row) {
  const label = row.label.toLowerCase();
  const section = row.section.toLowerCase();
  if (/inactive|disabled|not installed/i.test(row.value) && /scripting define/.test(section)) return { kind: 'disabled', note: 'Disabled in the publishing report; absence of logs cannot prove disabled code.' };
  if (/android manifest permissions/.test(section)) {
    if (/manifest exists/.test(label)) return { kind: 'manual' };
    const permission = row.label.trim().replace(/\s/g, '');
    return { kind: 'permission', permission: permission === 'AD_ID' ? 'com.google.android.gms.permission.AD_ID' : `android.permission.${permission}` };
  }
  if (/minimum api level|^min api level/.test(label)) return { kind: 'app', field: 'minSdk' };
  if (/target api level/.test(label)) return { kind: 'app', field: 'targetSdk' };
  if (/package id match/.test(label)) return { kind: 'package' };
  if (ADAPTERS[label] && /applovin max settings/.test(section)) return { kind: 'adapter', pattern: ADAPTERS[label] };
  if (/ads ids/.test(section)) {
    const format = /^mrec/.test(label) ? 'mrec' : /^banner/.test(label) ? 'banner' : /^interstitial/.test(label) ? 'interstitial' : /^rewarded/.test(label) ? 'rewarded' : /^app open/.test(label) ? 'app-open' : null;
    return format ? { kind: 'unit', format, unit: row.value.replace(/\s/g, '') } : { kind: 'manual', note: 'SDK keys are not printed by the plugin. Check these against the SDK dashboard.' };
  }
  if (/in-app purchases/.test(section) && !/^in-app purchasing$/.test(label)) return { kind: 'purchase', product: row.value.trim() };
  if (/use_avnads_plugin_debug/.test(label)) return { kind: 'debug' };
  if (/use_avnads_plugin/.test(label)) return { kind: 'plugin' };
  if (/remote config/.test(label)) return { kind: 'remote-config' };
  if (/firebase analytics|google analytics|use_firebase/.test(label)) return { kind: 'analytics' };
  if (/use_max|applovin max plugin/.test(label)) return { kind: 'sdk', key: 'SDK.AdsProvider' };
  if (/use_admob|google mobile ads sdk/.test(label)) return { kind: 'sdk', key: 'SDK.AdMob' };
  if (/use_bytebrew/.test(label)) return { kind: 'sdk', key: 'SDK.ByteBrew' };
  if (/use_iap|^in-app purchasing$|unity in-app purchasing/.test(label)) return { kind: 'sdk', key: 'SDK.Purchaser', note: 'Purchasing initialized. Complete a test purchase to verify individual products.' };
  return { kind: 'manual', note: 'This editor/build setting has no conclusive runtime log. Review it in Unity or the SDK dashboard.' };
}

export class BuildVerification {
  constructor(report, app) {
    this.report = structuredClone(report);
    this.app = structuredClone(app);
    this.rows = report.rows.map((r) => ({ ...r, rule: ruleFor(r), status: 'pending', evidence: null }));
    this.analyticsInitialized = false;
    for (const r of this.rows) {
      const rule = r.rule;
      if (rule.kind === 'manual') this.set(r, 'manual', rule.note);
      if (rule.kind === 'disabled') this.set(r, 'not-applicable', rule.note);
      if (rule.kind === 'package') this.set(r, 'matched', `Report package matches ${report.packageId}.`);
      if (rule.kind === 'permission') this.set(r, app.permissions?.includes(rule.permission) ? 'matched' : 'problem', `${rule.permission}: ${app.permissions?.includes(rule.permission) ? 'declared by installed app; runtime grant/feature use still needs testing' : 'not declared by installed app'}.`);
      if (rule.kind === 'app') {
        const expected = /\d+/.exec(r.value)?.[0];
        if (app[rule.field] != null && expected) this.set(r, String(app[rule.field]) === expected ? 'matched' : 'problem', `Installed ${rule.field}: ${app[rule.field]}; report: ${expected}.`);
      }
    }
  }
  set(row, status, note, e) { Object.assign(row, { status, note: note || '', evidence: e ? { entryId: e.id, ts: e.ts, message: String(e.message).slice(0, 1000) } : null }); }
  ingest(e) {
    const a = e.source === 'avn' ? e.avn : null;
    if (a?.ignored) return;
    if (a?.key === 'SDK.Firebase' && a.state === 'Initialized') this.analyticsInitialized = true;
    if (a?.key === 'SDK.Firebase' && a.state === 'Failed') this.analyticsInitialized = false;
    for (const row of this.rows) {
      const r = row.rule;
      if (r.kind === 'sdk' && a?.key === r.key) {
        if (a.state === 'Initialized') this.set(row, 'verified', r.note || 'SDK reported successful initialization; this does not prove every SDK feature.', e);
        else if (a.state === 'Failed') this.set(row, 'problem', a.message, e);
      } else if (r.kind === 'plugin' && a) this.set(row, 'verified', 'AVN plugin is running and writing diagnostics.', e);
      else if (r.kind === 'debug' && a && ['I', 'D', 'V'].includes(e.level)) this.set(row, 'matched', 'Plugin debug logging is active. Remove the debug symbol before release.', e);
      else if (r.kind === 'analytics' && e.fa && this.analyticsInitialized) this.set(row, 'verified', `Firebase initialized and logged ${e.fa.name} on-device. Server delivery needs dashboard confirmation.`, e);
      else if (r.kind === 'analytics' && a?.key === 'SDK.Firebase' && a.state === 'Failed') this.set(row, 'problem', a.message, e);
      else if (r.kind === 'remote-config' && a?.key === 'SDK.RemoteConfig') {
        if (a.state === 'Failed') this.set(row, 'problem', a.message, e);
        else if (a.fetch?.lastFetchStatus === 'Success') this.set(row, 'verified', 'Firebase reported a successful fetch and activation. Values are listed separately.', e);
      } else if (r.kind === 'adapter' && a?.kind === 'adapter' && r.pattern.test(a.fields.name || '')) {
        if (a.fields.status === 'InitializedSuccess') this.set(row, 'verified', `${a.fields.name} initialized. A filled ad is a separate test.`, e);
        else if (a.fields.status === 'InitializedFailure') this.set(row, 'problem', `${a.fields.name} failed to initialize.`, e);
      } else if (r.kind === 'unit') {
        const format = a?.kind === 'banner' ? a.format : a?.format;
        const fields = a?.fields;
        // A format-wide counter cannot verify a specific primary/backfill unit ID.
        if (format === r.format && fields?.unit === r.unit && (a.callback === 'Displayed' || a.what === 'loaded') && row.status !== 'verified') this.set(row, 'pending', 'This unit was observed; waiting for its revenue callback.', e);
        if (format === r.format && fields?.unit === r.unit && (a.callback === 'RevenuePaid' || a.what === 'revenue-paid')) {
          if (row.evidence && row.status === 'pending') this.set(row, 'verified', `Configured unit ${r.unit} was displayed/loaded and produced a revenue callback.`, e);
        }
      } else if (r.kind === 'purchase' && e.fa?.name === 'in_app_purchase' && String(e.fa.params?.product_id) === r.product) this.set(row, 'verified', `Firebase logged a purchase for ${r.product}. Confirm settlement in the store dashboard.`, e);
    }
  }
  snapshot() {
    return { ...this.report, simulated: !!this.app.replay, rows: this.rows.map(({ rule, ...r }) => ({ ...r, note: r.note || (rule.kind === 'unit' ? 'Exercise this ad unit. Verification requires its unit ID in display/load and revenue logs.' : 'Exercise this feature during this run to collect evidence.') })) };
  }
}
