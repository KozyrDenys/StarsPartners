#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECTS_ROOT = path.join(process.cwd(), 'projects');
const OUT_DIR = path.join(PROJECTS_ROOT, 'dashboard');
const OUT_MD = path.join(OUT_DIR, 'qa-trends.md');
const OUT_HTML = path.join(OUT_DIR, 'qa-trends.html');

const PHASE_ORDER = [
  'precheck',
  'home',
  'registration',
  'auth',
  'profile',
  'deposit',
  'withdraw',
  'sidebar',
  'sports',
  'casino',
  'livecasino',
  'security',
  'contracts',
  'nightlyextras',
  'a11y',
  'visual',
  'main',
  'destructive',
];

const FAILURE_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toInt(value, fallback = 0) {
  const num = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(num) ? num : fallback;
}

function collectTestsFromSuites(suites) {
  const tests = [];

  function walkSuite(suite) {
    if (!suite || typeof suite !== 'object') return;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec || typeof spec !== 'object') continue;
        const specFile = spec.file || spec.location?.file || '';
        const specTitle = oneLine(spec.title || '');

        for (const test of spec.tests || []) {
          const results = Array.isArray(test.results) ? test.results : [];
          const final = results[results.length - 1] || {};
          const status = final.status || test.status || 'unknown';
          const mergedAnnotations = [
            ...(Array.isArray(test.annotations) ? test.annotations : []),
            ...results.flatMap((result) =>
              Array.isArray(result.annotations) ? result.annotations : []
            ),
          ];

          tests.push({
            file: specFile,
            title: oneLine(test.title || specTitle),
            status,
            annotations: mergedAnnotations,
          });
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) walkSuite(child);
    }
  }

  for (const suite of suites || []) walkSuite(suite);
  return tests;
}

function summarizePhaseReport(filePath) {
  const payload = readJson(filePath);
  if (!payload) return null;

  const stats = payload.stats || {};
  const tests = collectTestsFromSuites(payload.suites || []);

  const total =
    toInt(stats.expected, 0) +
    toInt(stats.unexpected, 0) +
    toInt(stats.flaky, 0) +
    toInt(stats.skipped, 0);

  const failed = tests.filter((item) => FAILURE_STATUSES.has(item.status)).length;
  const blockedSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'blocked')
  ).length;
  const partialSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'partial')
  ).length;

  return {
    total,
    passed: toInt(stats.expected, 0),
    failed,
    skipped: toInt(stats.skipped, 0),
    flaky: toInt(stats.flaky, 0),
    blockedSignals,
    partialSignals,
    durationMs: Number(stats.duration || 0),
    generatedAt: oneLine(stats.startTime || ''),
  };
}

function loadCurrentSnapshot(brandRoot) {
  const phaseDir = path.join(brandRoot, 'artifacts', 'phase-reports');
  const phases = {};

  for (const phase of PHASE_ORDER) {
    const reportPath = path.join(phaseDir, `${phase}-report.json`);
    const summary = summarizePhaseReport(reportPath);
    if (summary) phases[phase] = summary;
  }

  const totals = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    blockedSignals: 0,
    partialSignals: 0,
    durationMs: 0,
  };

  for (const phase of Object.keys(phases)) {
    const item = phases[phase];
    totals.total += item.total;
    totals.passed += item.passed;
    totals.failed += item.failed;
    totals.skipped += item.skipped;
    totals.flaky += item.flaky;
    totals.blockedSignals += item.blockedSignals;
    totals.partialSignals += item.partialSignals;
    totals.durationMs += item.durationMs;
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'current-phase-reports',
    phases,
    totals,
  };
}

function loadHistoryRuns(brandRoot) {
  const historyDir = path.join(brandRoot, 'artifacts', 'history', 'runs');
  if (!fs.existsSync(historyDir)) return [];

  const files = fs
    .readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const runs = [];
  for (const fileName of files) {
    const payload = readJson(path.join(historyDir, fileName));
    if (!payload || typeof payload !== 'object') continue;
    if (!payload.totals || !payload.phases) continue;
    runs.push(payload);
  }
  return runs;
}

function resolveModeRoots(brandRoot) {
  const modes = [];
  const desktopRoot = path.join(brandRoot, 'desktop');
  const mobileRoot = path.join(brandRoot, 'mobile');
  const legacyArtifacts = path.join(brandRoot, 'artifacts');

  if (fs.existsSync(desktopRoot)) modes.push({ mode: 'desktop', root: desktopRoot });
  if (fs.existsSync(mobileRoot)) modes.push({ mode: 'mobile', root: mobileRoot });
  if (fs.existsSync(legacyArtifacts)) modes.push({ mode: 'legacy', root: brandRoot });

  return modes;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function detectRunStatus(run) {
  const failed = toInt(run?.totals?.failed, 0);
  return failed > 0 ? 'FAILED' : 'PASSED';
}

function buildBrandRows() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];

  const dirs = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'dashboard')
    .map((entry) => entry.name)
    .sort();

  const rows = [];

  for (const brand of dirs) {
    const brandRoot = path.join(PROJECTS_ROOT, brand);
    const modeRoots = resolveModeRoots(brandRoot);

    for (const modeTarget of modeRoots) {
      const historyRuns = loadHistoryRuns(modeTarget.root);
      const fallback = loadCurrentSnapshot(modeTarget.root);
      const runs = historyRuns.length > 0 ? historyRuns : [fallback];
      const latest = runs[runs.length - 1];

      const recent = runs.slice(-10);
      const failedTrend = recent.map((run) => toInt(run.totals.failed, 0));
      const blockedTrend = recent.map((run) => toInt(run.totals.blockedSignals, 0));

      rows.push({
        brand,
        mode: modeTarget.mode,
        label: `${brand} (${modeTarget.mode})`,
        runsCount: runs.length,
        latest,
        status: detectRunStatus(latest),
        failedTrend,
        blockedTrend,
      });
    }
  }

  return rows;
}

function renderMarkdown(rows) {
  const lines = [];
  lines.push('# QA Trends Dashboard');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    '| Brand | Mode | Runs | Last Status | Total | Failed | Blocked Signals | Last Duration | Failed Trend (10) | Blocked Trend (10) |'
  );
  lines.push('| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |');

  for (const row of rows) {
    const total = toInt(row.latest?.totals?.total, 0);
    const failed = toInt(row.latest?.totals?.failed, 0);
    const blocked = toInt(row.latest?.totals?.blockedSignals, 0);
    const duration = formatDuration(Number(row.latest?.totals?.durationMs || 0));

    lines.push(
      `| ${row.brand} | ${row.mode} | ${row.runsCount} | ${row.status} | ${total} | ${failed} | ${blocked} | ${duration} | ${row.failedTrend.join(', ')} | ${row.blockedTrend.join(', ')} |`
    );
  }

  for (const row of rows) {
    lines.push('');
    lines.push(`## ${row.label}`);
    lines.push('');
    lines.push(`Latest run: ${oneLine(row.latest?.timestamp || row.latest?.generatedAt || '-')}`);
    lines.push('');
    lines.push('| Phase | Total | Failed | Blocked Signals | Partial Signals | Duration |');
    lines.push('| --- | ---: | ---: | ---: | ---: | --- |');

    for (const phase of PHASE_ORDER) {
      const summary = row.latest?.phases?.[phase];
      if (!summary) continue;
      lines.push(
        `| ${phase} | ${toInt(summary.total, 0)} | ${toInt(summary.failed, 0)} | ${toInt(summary.blockedSignals, 0)} | ${toInt(summary.partialSignals, 0)} | ${formatDuration(Number(summary.durationMs || 0))} |`
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderHtml(rows) {
  const summaryRows = rows
    .map((row) => {
      const total = toInt(row.latest?.totals?.total, 0);
      const failed = toInt(row.latest?.totals?.failed, 0);
      const blocked = toInt(row.latest?.totals?.blockedSignals, 0);
      const duration = formatDuration(Number(row.latest?.totals?.durationMs || 0));

      return `<tr>
        <td>${escapeHtml(row.brand)}</td>
        <td>${escapeHtml(row.mode || '-')}</td>
        <td>${row.runsCount}</td>
        <td>${escapeHtml(row.status)}</td>
        <td>${total}</td>
        <td>${failed}</td>
        <td>${blocked}</td>
        <td>${escapeHtml(duration)}</td>
        <td>${escapeHtml(row.failedTrend.join(', '))}</td>
        <td>${escapeHtml(row.blockedTrend.join(', '))}</td>
      </tr>`;
    })
    .join('\n');

  const phaseSections = rows
    .map((row) => {
      const phaseRows = PHASE_ORDER.map((phase) => {
        const summary = row.latest?.phases?.[phase];
        if (!summary) return '';

        return `<tr>
          <td>${escapeHtml(phase)}</td>
          <td>${toInt(summary.total, 0)}</td>
          <td>${toInt(summary.failed, 0)}</td>
          <td>${toInt(summary.blockedSignals, 0)}</td>
          <td>${toInt(summary.partialSignals, 0)}</td>
          <td>${escapeHtml(formatDuration(Number(summary.durationMs || 0)))}</td>
        </tr>`;
      })
        .filter(Boolean)
        .join('\n');

      return `<section>
        <h2>${escapeHtml(row.label || row.brand)}</h2>
        <p>Latest run: ${escapeHtml(oneLine(row.latest?.timestamp || row.latest?.generatedAt || '-'))}</p>
        <table>
          <thead>
            <tr><th>Phase</th><th>Total</th><th>Failed</th><th>Blocked</th><th>Partial</th><th>Duration</th></tr>
          </thead>
          <tbody>
            ${phaseRows}
          </tbody>
        </table>
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>QA Trends Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; margin: 24px; color: #1f2937; }
    h1, h2 { margin: 0 0 12px 0; }
    p { margin: 0 0 12px 0; color: #4b5563; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 28px 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #f3f4f6; }
    section { margin-top: 28px; }
  </style>
</head>
<body>
  <h1>QA Trends Dashboard</h1>
  <p>Generated: ${escapeHtml(new Date().toISOString())}</p>
  <table>
    <thead>
      <tr>
        <th>Brand</th><th>Mode</th><th>Runs</th><th>Last Status</th><th>Total</th><th>Failed</th><th>Blocked</th><th>Last Duration</th><th>Failed Trend (10)</th><th>Blocked Trend (10)</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRows}
    </tbody>
  </table>
  ${phaseSections}
</body>
</html>`;
}

(function main() {
  const rows = buildBrandRows();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const md = renderMarkdown(rows);
  const html = renderHtml(rows);

  fs.writeFileSync(OUT_MD, md, 'utf8');
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  console.log(`Dashboard generated:\n- ${OUT_MD}\n- ${OUT_HTML}`);
})();
