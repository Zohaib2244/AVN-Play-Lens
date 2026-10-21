// Test-run reports (Markdown and HTML) saved under ~/.avn-playlens/reports.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const REPORTS_DIR = join(os.homedir(), '.avn-playlens', 'reports');
const ICON = { ok: 'PASS', problem: 'CHECK', pending: 'MISSING' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '—');
const mins = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`;

export function buildReport({ id, run, items, flags, crashes, health, device, pkg }) {
  const passed = items.filter((i) => i.status === 'ok').length;
  const title = `${pkg || 'Game'} test run: ${passed} of ${items.length} passed`;
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
    '## Checklist',
    '',
    '| Result | Check | Notes |',
    '|---|---|---|',
    ...items.map((i) => `| ${ICON[i.status]} | ${i.name} | ${(i.note || '').replace(/\|/g, '/')} |`),
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#16120F;color:#F1E7D6;font:15px/1.55 system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:40px 20px}h1{font-size:28px;margin:0 0 12px}h2{margin:32px 0 10px;font-size:18px}
.meta{color:#BDAE98}table{width:100%;border-collapse:collapse;background:#201A16;border-radius:12px;overflow:hidden}td,th{padding:10px 12px;border-top:1px solid #3A2F27;text-align:left;vertical-align:top}
th{color:#9A8B76;font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-top:0}tr.ok td:first-child{color:#9ED9C9}tr.problem td:first-child{color:#EBC86A}tr.pending td:first-child{color:#F28B82}td:first-child{font-family:monospace;white-space:nowrap}</style></head>
<body><main><h1>${esc(title)}</h1><p class="meta">${esc(pkg)} · ${esc(device)} · ${esc(when(run.startedAt))} · ${esc(mins((run.finishedAt ?? Date.now()) - run.startedAt))} · rules: ${esc(run.profileFile)}</p>
<h2>Checklist</h2><table><tr><th>Result</th><th>Check</th><th>Notes</th></tr>${items.map(row).join('')}</table>
<h2>Rule hits</h2>${flags.length ? `<table><tr><th>Severity</th><th>Rule</th><th>Count</th></tr>${flags.map((f) => `<tr><td>${esc(f.severity)}</td><td>${esc(f.name)}</td><td>${f.count}</td></tr>`).join('')}</table>` : '<p class="meta">None.</p>'}
<h2>Crashes and ANRs</h2>${crashes.length ? `<ul>${crashes.map((c) => `<li>${esc(when(c.ts))} · ${esc(c.kind)}: ${esc(String(c.message).slice(0, 200))}</li>`).join('')}</ul>` : '<p class="meta">None.</p>'}
<p class="meta">Made by AVN PlayLens.</p></main></body></html>`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, `${id}.md`), md);
  writeFileSync(join(REPORTS_DIR, `${id}.html`), html);
  return { id, title, passed, total: items.length };
}

export function readReport(id, format) {
  if (!/^[\w-]+$/.test(id) || !['md', 'html'].includes(format)) return null;
  try {
    return readFileSync(join(REPORTS_DIR, `${id}.${format}`), 'utf8');
  } catch {
    return null;
  }
}
