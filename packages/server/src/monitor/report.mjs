// Test-run reports (Markdown and HTML) saved under ~/.avn-playlens/reports.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { BUILD_RESULTS } from './build-report.mjs';
import { displayRemoteValue } from './remote-config.mjs';

export const REPORTS_DIR = join(os.homedir(), '.avn-playlens', 'reports');
const ICON = { ok: 'PASS', problem: 'CHECK', pending: 'MISSING' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '—');
const mins = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`;

export function buildReport({ id, run, items, flags, crashes, health, device, pkg, build, dir = REPORTS_DIR }) {
  const passed = items.filter((i) => i.status === 'ok').length;
  const title = `${pkg || 'Game'} test run: ${passed} of ${items.length} checklist checks passed${build?.simulated ? ' (REPLAY - simulated evidence)' : ''}`;
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const variables = health?.rc?.variables ?? [];
  const verified = build?.rows.filter((r) => r.status === 'verified').length ?? 0;
  const buildMd = build ? [
    '## For Dev - runtime verification', '',
    `Publishing report: ${cell(build.filename)} · v${cell(build.versionName)} (${cell(build.versionCode)}) · SHA-256: ${build.id}`,
    `${verified} of ${build.rows.length} For Dev items verified at runtime. Static matches and manual checks are not runtime passes.`,
    'Verification only covers the behavior described in each evidence note. Package/version/build matching cannot distinguish rebuilds that reuse a build number.', '',
    '| Section | For Dev item | Build report result | Runtime verification | Evidence / next step |', '|---|---|---|---|---|',
    ...build.rows.map((r) => `| ${cell(r.section)} | ${cell(r.label)} | ${cell(r.value)} | ${BUILD_RESULTS[r.status]} | ${cell(r.note)}${r.evidence ? ` (${cell(when(r.evidence.ts))}, log #${r.evidence.entryId}: ${cell(r.evidence.message)})` : ''} |`), '',
  ] : [];
  const rcMd = ['## Firebase Remote Config', '', 'Values and types observed in plugin logs; unlogged keys and truncated values cannot be fully verified.', '', '| Variable / field | Value | Data type | Registered type | Source | Time |', '|---|---|---|---|---|---|', ...variables.map((v) => `| ${cell(v.name)} | ${cell(displayRemoteValue(v))}${v.truncated ? ' [TRUNCATED]' : ''} | ${cell(v.type || 'unknown')} | ${cell(v.declaredType)} | ${cell(v.source)} (${cell(v.from)}) | ${cell(when(v.ts))} |`), ''];
  const md = [
    `# ${title}`,
    '',
    `- Game: ${pkg || '—'}`,
    `- Device: ${device || '—'}`,
    `- Started: ${when(run.startedAt)} · ${mins((run.finishedAt ?? Date.now()) - run.startedAt)}`,
    `- Rules file: ${run.profileFile || '—'}`,
    `- Crashes and ANRs: ${crashes.length}`,
    health?.revenue?.total ? `- Ad revenue seen: $${health.revenue.total.toFixed(4)}` : null,
    '',
    ...buildMd,
    ...rcMd,
    '## Checklist',
    '',
    '| Result | Check | Notes |',
    '|---|---|---|',
    ...items.map((i) => `| ${ICON[i.status]} | ${cell(i.name)} | ${cell(i.note)} |`),
    '',
    '## Rule hits',
    '',
    flags.length ? '| Severity | Rule | Count | Last line |\n|---|---|---|---|' : 'None.',
    ...flags.map((f) => `| ${f.severity} | ${f.name} | ${f.count} | ${String(f.message || '').slice(0, 120).replace(/\|/g, '/')} |`),
    '',
    crashes.length ? '## Crashes\n' : null,
    ...crashes.map((c) => `- ${when(c.ts)} · ${c.kind}: ${String(c.message).slice(0, 200)}`),
  ].filter((l) => l !== null).join('\n');

  const row = (i) => `<tr class="${i.status}"><td>${ICON[i.status]}</td><td>${esc(i.name)}</td><td>${esc(i.note)}</td></tr>`;
  const buildHtml = build ? `<h2>For Dev - runtime verification</h2><p class="meta">${esc(build.filename)} · v${esc(build.versionName)} (${esc(build.versionCode)})<br>Source SHA-256: ${esc(build.id)}<br>${verified} of ${build.rows.length} items verified at runtime. Static matches and manual checks are not runtime passes.</p><p class="meta">Verification covers the behavior described in the evidence. Use a new build number for every rebuild.</p><table><tr><th>Section / item</th><th>Build report result</th><th>Runtime verification</th><th>Evidence / next step</th></tr>${build.rows.map((r) => `<tr><td>${esc(r.label)}<br><small>${esc(r.section)}</small></td><td>${esc(r.value)}</td><td>${esc(BUILD_RESULTS[r.status])}</td><td>${esc(r.note)}${r.evidence ? `<details><summary>${esc(when(r.evidence.ts))} · log #${esc(r.evidence.entryId)}</summary>${esc(r.evidence.message)}</details>` : ''}</td></tr>`).join('')}</table>` : '';
  const rcHtml = `<h2>Firebase Remote Config</h2><p class="meta">Values and types observed in plugin logs. Unlogged keys and truncated values cannot be fully verified.</p>${variables.length ? `<table><tr><th>Variable / field</th><th>Value</th><th>Data type</th><th>Source</th></tr>${variables.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(displayRemoteValue(v))}${v.truncated ? '<br>TRUNCATED' : ''}</td><td>${esc(v.type || 'unknown')}${v.declaredType ? `<br>Registered: ${esc(v.declaredType)}` : ''}</td><td>${esc(v.source)} · ${esc(v.from)}<br>${esc(when(v.ts))}</td></tr>`).join('')}</table>` : '<p class="meta">No values logged in this run.</p>'}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#16120F;color:#F1E7D6;font:15px/1.55 system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:40px 20px}h1{font-size:28px;margin:0 0 12px}h2{margin:32px 0 10px;font-size:18px}
.meta{color:#BDAE98}table{width:100%;border-collapse:collapse;background:#201A16;border-radius:12px;overflow:hidden}td,th{padding:10px 12px;border-top:1px solid #3A2F27;text-align:left;vertical-align:top}
th{color:#9A8B76;font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-top:0}tr.ok td:first-child{color:#9ED9C9}tr.problem td:first-child{color:#EBC86A}tr.pending td:first-child{color:#F28B82}td{overflow-wrap:anywhere;word-break:break-word}td:first-child{font-family:monospace}button{padding:8px 14px;cursor:pointer}@media print{body{background:white;color:#111}main{max-width:none;padding:0}table{background:white}th,td{border-color:#ccc}.meta{color:#444}button{display:none}thead{display:table-header-group}tr{break-inside:avoid}}</style></head>
<body><main><h1>${esc(title)}</h1><p class="meta">${esc(pkg)} · ${esc(device)} · ${esc(when(run.startedAt))} · ${esc(mins((run.finishedAt ?? Date.now()) - run.startedAt))} · rules: ${esc(run.profileFile)}</p>
<button onclick="window.print()">Print / Save as PDF</button>${buildHtml}${rcHtml}
<h2>Checklist</h2><table><tr><th>Result</th><th>Check</th><th>Notes</th></tr>${items.map(row).join('')}</table>
<h2>Rule hits</h2>${flags.length ? `<table><tr><th>Severity</th><th>Rule</th><th>Count</th></tr>${flags.map((f) => `<tr><td>${esc(f.severity)}</td><td>${esc(f.name)}</td><td>${f.count}</td></tr>`).join('')}</table>` : '<p class="meta">None.</p>'}
<h2>Crashes and ANRs</h2>${crashes.length ? `<ul>${crashes.map((c) => `<li>${esc(when(c.ts))} · ${esc(c.kind)}: ${esc(String(c.message).slice(0, 200))}</li>`).join('')}</ul>` : '<p class="meta">None.</p>'}
<p class="meta">Made by AVN PlayLens.</p></main></body></html>`;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), md);
  writeFileSync(join(dir, `${id}.html`), html);
  return { id, title, passed, total: items.length, buildVerified: verified, buildTotal: build?.rows.length ?? 0 };
}

export function readReport(id, format) {
  if (!/^[\w-]+$/.test(id) || !['md', 'html'].includes(format)) return null;
  try {
    return readFileSync(join(REPORTS_DIR, `${id}.${format}`), 'utf8');
  } catch {
    return null;
  }
}
