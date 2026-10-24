// Markdown export of a QA run: what ran, what passed, what did not, what was never
// verified, and where the evidence is. Written so a reader who did not watch the run can
// tell a forced transition from real gameplay and a missing hook from a failure.
const STATUS_WORD = { passed: 'Passed', failed: 'FAILED', skipped: 'Skipped', 'not-supported': 'Not supported', 'not-verified': 'Not verified', cancelled: 'Cancelled', pending: 'Pending', running: 'Running' };
const COVERAGE = { bridge: 'QA bridge actions (forced transitions and plugin calls through the real code paths; not proof that levels are beatable)', random: 'Random taps through ADB (finds crashes and startup faults; proves nothing about gameplay)', adb: 'Device actions through ADB only' };

const when = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '—');
const secs = (a, b) => (a && b ? `${((b - a) / 1000).toFixed(1)} s` : '—');

export function runMarkdown(run) {
  const s = run.summary ?? {};
  const lines = [];
  lines.push(`# QA run ${run.id}`, '');
  lines.push(`**Outcome:** ${s.outcome ?? run.status} · **Status:** ${run.status}${run.error ? ` (${run.error})` : ''}${run.cancelReason ? ` (${run.cancelReason})` : ''}`, '');
  lines.push(`- Game: ${run.game?.name ?? run.pkg} (\`${run.pkg}\`)${run.build ? `, v${run.build.versionName ?? '?'} build ${run.build.versionCode ?? '?'}${run.build.debuggable === false ? ', release (not debuggable)' : run.build.debuggable ? ', debuggable' : ''}` : ''}`);
  lines.push(`- Device: ${run.device ?? run.serial} (\`${run.serial}\`)`);
  lines.push(`- Plan: ${run.plan?.name ?? run.plan?.id} (${run.plan?.source ?? 'builtin'})${Object.keys(run.plan?.options ?? {}).length ? ` with ${JSON.stringify(run.plan.options)}` : ''}`);
  lines.push(`- Coverage: ${COVERAGE[run.plan?.coverage] ?? run.plan?.coverage ?? '—'}`);
  lines.push(`- Started ${when(run.startedAt)}, ended ${when(run.endedAt)}, duration ${secs(run.startedAt, run.endedAt)}`);
  lines.push(`- QA bridge: ${run.bridge?.connected || run.bridge?.sdk ? `SDK ${run.bridge.sdk ?? '?'}, actions: ${(run.bridge.actions ?? []).join(', ') || 'none'}` : run.bridge?.error ? `not available (${run.bridge.error})` : 'not used'}`);
  lines.push(`- Checks: ${s.passed ?? 0} passed, ${s.failed ?? 0} failed, ${s['not-verified'] ?? 0} not verified, ${s['not-supported'] ?? 0} not supported, ${s.skipped ?? 0} skipped · ${s.findings ?? 0} findings (${s.critical ?? 0} critical) · ${s.lines ?? 0} log lines`, '');

  if (run.findings?.length) {
    lines.push('## Findings', '');
    for (const f of run.findings) lines.push(`- **${f.severity}** ${f.title}${f.stepId ? ` (step ${f.stepId})` : ''}: ${f.message}`);
    lines.push('');
  }

  lines.push('## Steps', '', '| # | Step | Result | Duration | Notes |', '|---|---|---|---|---|');
  for (const st of run.steps ?? []) {
    const notes = st.checks.map((c) => `${STATUS_WORD[c.status] ?? c.status}: ${c.label}${c.note ? ` — ${c.note}` : ''}`).join('<br>');
    lines.push(`| ${st.id} | ${st.label} | ${STATUS_WORD[st.status] ?? st.status} | ${secs(st.startedAt, st.endedAt)} | ${notes.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  if (run.evidence?.length) {
    lines.push('## Screenshots', '');
    for (const e of run.evidence) lines.push(`- ${e.label} (step ${e.stepId}): \`shots/${e.file}\``);
    lines.push('');
  }

  if (run.perf) {
    const p = run.perf;
    lines.push('## Performance', '');
    if (p.fps) lines.push(`- FPS avg ${p.fps.avg ?? '—'}, min ${p.fps.min ?? '—'}, low-FPS seconds ${p.lowFps ?? 0}, stutters ${p.stutters ?? 0}`);
    if (p.cpu) lines.push(`- CPU avg ${p.cpu.avg ?? '—'}%`);
    if (p.mem) lines.push(`- Memory peak ${p.mem.max ?? '—'} MB`);
    if (p.temp) lines.push(`- Temperature max ${p.temp.max ?? '—'} °C${p.thermalMax ? `, thermal status ${p.thermalMax}` : ''}`);
    if (p.info?.error) lines.push(`- Sampler note: ${p.info.error}`);
    lines.push('');
  }

  lines.push('## How to read this', '');
  lines.push('- *Not supported* means the game or plugin did not register that hook; nothing was tested.');
  lines.push('- *Not verified* means a soft expectation did not show up in time; it is not a pass.');
  lines.push('- A passed run means no problem was observed in these steps on this phone. It does not cover levels, ads or purchases the plan did not touch.');
  lines.push('- Full log: `logcat.jsonl`. Performance samples: `perf.json`.');
  return lines.join('\n') + '\n';
}
