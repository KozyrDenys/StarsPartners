#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const PROJECTS_ROOT = path.join(ROOT, 'projects');
const TESTS_ROOT = path.join(ROOT, 'tests');
const OUT_DIR = path.join(PROJECTS_ROOT, 'dashboard');
const OUT_JSON = path.join(OUT_DIR, 'deep-audit.json');
const OUT_MD = path.join(OUT_DIR, 'deep-audit.md');
const FAILURE_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDuration(ms) {
  const value = toNum(ms, 0);
  if (value <= 0) return '0s';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const min = Math.floor(value / 60_000);
  const sec = Math.round((value % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function commandOutput(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    ...options,
  });
  const stdout = oneLine(result.stdout || '');
  const stderr = oneLine(result.stderr || '');
  return {
    code: result.status || 0,
    stdout,
    stderr,
    text: oneLine(`${stdout} ${stderr}`),
  };
}

function shellOutput(command, env = {}) {
  return commandOutput('/bin/zsh', ['-lc', command], {
    env: {
      ...process.env,
      ...env,
    },
  });
}

function walk(dirPath, fileCb) {
  if (!fs.existsSync(dirPath)) return;
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        fileCb(fullPath);
      }
    }
  }
}

function collectTestsFromSuites(suites) {
  const tests = [];
  function walkSuite(suite) {
    if (!suite || typeof suite !== 'object') return;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec || typeof spec !== 'object') continue;
        const specFile = oneLine(spec.file || spec.location?.file || '');
        const specTitle = oneLine(spec.title || '');
        for (const test of spec.tests || []) {
          const results = Array.isArray(test.results) ? test.results : [];
          const final = results.length ? results[results.length - 1] : {};
          const status = final.status || test.status || 'unknown';
          const mergedAnnotations = [
            ...(Array.isArray(test.annotations) ? test.annotations : []),
            ...results.flatMap((result) =>
              Array.isArray(result.annotations) ? result.annotations : []
            ),
          ];
          tests.push({
            file: specFile,
            title: oneLine(test.title || specTitle || ''),
            status,
            errors: Array.isArray(final.errors) ? final.errors : [],
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

function parseModeWorkspaces(brandRoot) {
  const result = [];
  for (const mode of ['desktop', 'mobile']) {
    const modeRoot = path.join(brandRoot, mode);
    if (!fs.existsSync(modeRoot)) continue;
    result.push({
      mode,
      runtimeRoot: modeRoot,
      reportRoot: path.join(brandRoot, 'Autotest report', mode),
    });
  }

  const legacyArtifacts = path.join(brandRoot, 'artifacts');
  if (fs.existsSync(legacyArtifacts)) {
    result.push({
      mode: 'legacy',
      runtimeRoot: brandRoot,
      reportRoot: path.join(brandRoot, 'Autotest report'),
    });
  }

  return result;
}

function loadRunHistory(historyDir) {
  if (!fs.existsSync(historyDir)) return [];
  const files = fs
    .readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const runs = [];
  for (const fileName of files) {
    const payload = readJson(path.join(historyDir, fileName));
    if (!payload || typeof payload !== 'object') continue;
    if (!payload.totals || !payload.timestamp) continue;
    runs.push({ fileName, payload });
  }
  return runs;
}

function summarizePhaseReports(phaseReportsDir) {
  const phaseSummary = {};
  const blockedReasons = new Map();
  const failedCases = [];

  if (!fs.existsSync(phaseReportsDir)) {
    return { phaseSummary, blockedReasons, failedCases };
  }

  const files = fs
    .readdirSync(phaseReportsDir)
    .filter((name) => name.endsWith('-report.json'))
    .sort();
  for (const fileName of files) {
    const phase = oneLine(fileName.replace(/-report\.json$/, '')) || fileName;
    const payload = readJson(path.join(phaseReportsDir, fileName));
    if (!payload) continue;
    const tests = collectTestsFromSuites(payload.suites || []);
    const stats = payload.stats || {};
    const failed = tests.filter((item) => FAILURE_STATUSES.has(item.status)).length;
    const blocked = tests.filter((item) =>
      item.annotations.some((ann) => oneLine(ann.type).toLowerCase() === 'blocked')
    ).length;
    const partial = tests.filter((item) =>
      item.annotations.some((ann) => oneLine(ann.type).toLowerCase() === 'partial')
    ).length;
    phaseSummary[phase] = {
      total:
        toInt(stats.expected) + toInt(stats.unexpected) + toInt(stats.flaky) + toInt(stats.skipped),
      passed: toInt(stats.expected),
      failed,
      blocked,
      partial,
      durationMs: toNum(stats.duration, 0),
    };

    for (const testCase of tests) {
      for (const ann of testCase.annotations || []) {
        if (oneLine(ann.type).toLowerCase() !== 'blocked') continue;
        const reason = oneLine(ann.description || '(blocked without reason)');
        if (!reason) continue;
        blockedReasons.set(reason, (blockedReasons.get(reason) || 0) + 1);
      }
      if (FAILURE_STATUSES.has(testCase.status)) {
        const firstError = oneLine((testCase.errors[0] && testCase.errors[0].message) || '');
        failedCases.push({
          phase,
          file: testCase.file,
          title: testCase.title,
          status: testCase.status,
          error: firstError,
        });
      }
    }
  }

  return { phaseSummary, blockedReasons, failedCases };
}

function loadProviderMatrix(reportRoot) {
  const matrixPath = path.join(
    reportRoot,
    'casino',
    'providers-real',
    'providers-real-matrix.json'
  );
  const matrix = readJson(matrixPath);
  if (!matrix) return null;

  const reasons = new Map();
  for (const row of Array.isArray(matrix.results) ? matrix.results : []) {
    const status = oneLine(row.status).toLowerCase();
    if (status !== 'blocked' && status !== 'failed') continue;
    const reason = oneLine(row.reason || '(provider issue without reason)');
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }

  return {
    path: matrixPath,
    summary: matrix.summary || {},
    topReasons: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
  };
}

function loadDepositInventory(reportRoot) {
  const filePath = path.join(reportRoot, 'deposit', 'deposit-inventory.json');
  const payload = readJson(filePath);
  if (!payload) return null;
  const apiInventory =
    payload && payload.apiInventory && typeof payload.apiInventory === 'object'
      ? payload.apiInventory
      : {};

  return {
    path: filePath,
    itemsCount: toInt(apiInventory.itemsCount, 0),
    categories: Array.isArray(apiInventory.categories) ? apiInventory.categories : [],
    apiFound: Boolean(payload.depositPaySystemsApi && payload.depositPaySystemsApi.responseFound),
  };
}

function loadRegistrationState(runtimeRoot) {
  const artifactsDir = path.join(runtimeRoot, 'artifacts');
  const payload = readJson(path.join(artifactsDir, 'last-registered-player.json'));
  if (!payload) return null;
  return {
    email: oneLine(payload.loginEmail || payload.email || ''),
    manualLoginReady: payload.manualLoginReady === true,
    loginValidationStatus: oneLine(payload.loginValidationStatus || ''),
    generatedAt: oneLine(payload.generatedAt || ''),
  };
}

function mapToSortedArray(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

function countSpecsByFolder() {
  const folders = {
    smoke: 0,
    critical: 0,
    destructive: 0,
    localization: 0,
    visual: 0,
    ai: 0,
    other: 0,
  };

  walk(TESTS_ROOT, (filePath) => {
    if (!filePath.endsWith('.spec.js')) return;
    const rel = filePath.replace(`${TESTS_ROOT}${path.sep}`, '').replace(/\\/g, '/');
    const top = rel.split('/')[0] || 'other';
    if (Object.prototype.hasOwnProperty.call(folders, top)) folders[top] += 1;
    else folders.other += 1;
  });
  return folders;
}

function collectToolingSnapshot() {
  const nodeVersion = process.version;
  const npmVersion = shellOutput('npm -v').stdout || shellOutput('npm -v').stderr;
  const playwrightVersion = shellOutput('npx playwright --version').text;
  const doctorRaw = shellOutput('npm run -s qa:doctor -- --json');
  const npmOutdated = shellOutput('npm outdated --depth=0 --json || true');
  let outdated = {};
  try {
    outdated = npmOutdated.stdout ? JSON.parse(npmOutdated.stdout) : {};
  } catch {
    outdated = {};
  }

  const npmAuditRaw = shellOutput('npm audit --audit-level=high --json || true');
  let auditSummary = {};
  try {
    const audit = npmAuditRaw.stdout ? JSON.parse(npmAuditRaw.stdout) : {};
    auditSummary = {
      vulnerabilities: (audit.metadata && audit.metadata.vulnerabilities) || {},
      dependencies: (audit.metadata && audit.metadata.dependencies) || {},
    };
  } catch {
    auditSummary = {};
  }

  const brewOutdated = shellOutput('brew outdated', {
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ENV_HINTS: '1',
  });
  const brewOutdatedList = (brewOutdated.stdout || '')
    .split('\n')
    .map((line) => oneLine(line))
    .filter(Boolean);

  const doctor = (() => {
    if (!doctorRaw.stdout) return null;
    try {
      return JSON.parse(doctorRaw.stdout);
    } catch {
      return null;
    }
  })();

  return {
    nodeVersion,
    npmVersion: oneLine(npmVersion),
    playwrightVersion: oneLine(playwrightVersion),
    qaDoctor: doctor
      ? {
          summary: doctor.summary || {},
          criticalFails: (doctor.checks || []).filter(
            (item) => item.status === 'fail' && item.severity === 'critical'
          ),
        }
      : null,
    npmOutdated: {
      count: Object.keys(outdated || {}).length,
      packages: outdated || {},
    },
    npmAudit: auditSummary,
    brewOutdated: {
      count: brewOutdatedList.length,
      items: brewOutdatedList,
    },
  };
}

function buildAudit() {
  const brands = fs.existsSync(PROJECTS_ROOT)
    ? fs
        .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'dashboard')
        .map((entry) => entry.name)
        .sort()
    : [];

  const allBlockedReasons = new Map();
  const allProviderReasons = new Map();
  const allFailedCases = [];
  const modeRows = [];
  const registrationRows = [];
  const depositRows = [];

  let firstRunTs = Number.POSITIVE_INFINITY;
  let latestRunTs = 0;
  let totalRuns = 0;

  for (const brand of brands) {
    const brandRoot = path.join(PROJECTS_ROOT, brand);
    const workspaces = parseModeWorkspaces(brandRoot);
    for (const ws of workspaces) {
      const historyDir = path.join(ws.runtimeRoot, 'artifacts', 'history', 'runs');
      const phaseReportsDir = path.join(ws.runtimeRoot, 'artifacts', 'phase-reports');
      const runs = loadRunHistory(historyDir);
      totalRuns += runs.length;
      if (runs.length) {
        const first = Date.parse(runs[0].payload.timestamp || '');
        const last = Date.parse(runs[runs.length - 1].payload.timestamp || '');
        if (Number.isFinite(first)) firstRunTs = Math.min(firstRunTs, first);
        if (Number.isFinite(last)) latestRunTs = Math.max(latestRunTs, last);
      }

      const latestRun = runs.length ? runs[runs.length - 1].payload : null;
      const runStatus = oneLine((latestRun && latestRun.runStatus) || 'NO_RUN');
      const totals = (latestRun && latestRun.totals) || {};
      const failedRuns = runs.filter((item) => oneLine(item.payload.runStatus) === 'FAILED').length;

      const phaseDetails = summarizePhaseReports(phaseReportsDir);
      for (const [reason, count] of phaseDetails.blockedReasons.entries()) {
        allBlockedReasons.set(reason, (allBlockedReasons.get(reason) || 0) + count);
      }
      for (const failed of phaseDetails.failedCases) {
        allFailedCases.push({
          brand,
          mode: ws.mode,
          ...failed,
        });
      }

      const providerMatrix = loadProviderMatrix(ws.reportRoot);
      if (providerMatrix) {
        for (const item of providerMatrix.topReasons) {
          allProviderReasons.set(
            item.reason,
            (allProviderReasons.get(item.reason) || 0) + item.count
          );
        }
      }

      const registration = loadRegistrationState(ws.runtimeRoot);
      registrationRows.push({
        brand,
        mode: ws.mode,
        exists: Boolean(registration),
        ...(registration || {}),
      });

      const deposit = loadDepositInventory(ws.reportRoot);
      depositRows.push({
        brand,
        mode: ws.mode,
        exists: Boolean(deposit),
        itemsCount: deposit ? deposit.itemsCount : 0,
        categories: deposit ? deposit.categories : [],
        apiFound: deposit ? deposit.apiFound : false,
      });

      modeRows.push({
        brand,
        mode: ws.mode,
        runsCount: runs.length,
        failedRuns,
        latestRunStatus: runStatus,
        latestRunAt: oneLine((latestRun && latestRun.timestamp) || ''),
        total: toInt(totals.total, 0),
        passed: toInt(totals.passed, 0),
        failed: toInt(totals.failed, 0),
        blockedSignals: toInt(totals.blockedSignals, 0),
        infraBlockedSignals: toInt(totals.infraBlockedSignals, 0),
        productBlockedSignals: toInt(totals.productBlockedSignals, 0),
        partialSignals: toInt(totals.partialSignals, 0),
        durationMs: toNum(totals.durationMs, 0),
        providerMatrixSummary: providerMatrix ? providerMatrix.summary : null,
      });
    }
  }

  modeRows.sort((a, b) => a.brand.localeCompare(b.brand) || a.mode.localeCompare(b.mode));
  registrationRows.sort((a, b) => a.brand.localeCompare(b.brand) || a.mode.localeCompare(b.mode));
  depositRows.sort((a, b) => a.brand.localeCompare(b.brand) || a.mode.localeCompare(b.mode));

  const topBlockedReasons = mapToSortedArray(allBlockedReasons, 30);
  const topProviderReasons = mapToSortedArray(allProviderReasons, 20);

  const hasGit = fs.existsSync(path.join(ROOT, '.git'));
  const tooling = collectToolingSnapshot();

  const recommendations = [];
  if (!hasGit) {
    recommendations.push(
      'История правок по commit-level недоступна: в корне нет .git. Подключите репозиторий, чтобы получить полный diff-анализ всех правок с момента старта.'
    );
  }
  if (
    topBlockedReasons.some((item) => /cloudflare|challenge|captcha|turnstile/i.test(item.reason))
  ) {
    recommendations.push(
      'Высокая доля WAF/Cloudflare blocked: поддерживайте валидный storageState перед full-run (headed login), запускайте mobile/desktop раздельно, и используйте WebKit fallback.'
    );
  }
  if (
    topBlockedReasons.some((item) =>
      /no auth storage state|authorized session|\/api\/user\/preferences returned/i.test(
        item.reason
      )
    )
  ) {
    recommendations.push(
      'Есть признаки проблем с auth-state: используйте токен-recovery для provider-suite и проверяйте loginValidationStatus=PASSWORD_SIGNIN_OK в артефакте регистрации.'
    );
  }
  if ((tooling.npmOutdated && tooling.npmOutdated.count) > 0) {
    recommendations.push(
      'Обновите npm-зависимости с устаревшими версиями и перепроверьте qa:doctor + npm audit.'
    );
  }
  const highVulns = toInt(
    tooling.npmAudit && tooling.npmAudit.vulnerabilities
      ? tooling.npmAudit.vulnerabilities.high
      : 0,
    0
  );
  const criticalVulns = toInt(
    tooling.npmAudit && tooling.npmAudit.vulnerabilities
      ? tooling.npmAudit.vulnerabilities.critical
      : 0,
    0
  );
  if (highVulns > 0 || criticalVulns > 0) {
    recommendations.push(
      `Устраните security debt в npm tree (high=${highVulns}, critical=${criticalVulns}) либо зафиксируйте исключения с обоснованием.`
    );
  }
  if (depositRows.some((row) => row.exists && row.itemsCount === 0)) {
    recommendations.push(
      'Часть прогонов видит пустой deposit inventory: добавьте ретраи открытия Wallet/Deposit и API fallback check через /api/payment/getPaySystems.'
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: ROOT,
    gitRepositoryDetected: hasGit,
    timeline: {
      totalRuns,
      firstRunAt: Number.isFinite(firstRunTs) ? new Date(firstRunTs).toISOString() : '',
      latestRunAt: latestRunTs > 0 ? new Date(latestRunTs).toISOString() : '',
    },
    inventory: {
      brandsCount: brands.length,
      brands,
      testsBySuite: countSpecsByFolder(),
    },
    modes: modeRows,
    registration: registrationRows,
    deposit: depositRows,
    errors: {
      topBlockedReasons,
      topProviderReasons,
      failedCases: allFailedCases.slice(0, 120),
    },
    tooling,
    recommendations,
  };
}

function renderMarkdown(audit) {
  const lines = [];
  lines.push('# QA Deep Audit');
  lines.push('');
  lines.push(`Generated: ${audit.generatedAt}`);
  lines.push(`Project root: ${audit.projectRoot}`);
  lines.push(`Git detected: ${audit.gitRepositoryDetected ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  lines.push(`- Total runs indexed: ${toInt(audit.timeline.totalRuns, 0)}`);
  lines.push(`- First run: ${oneLine(audit.timeline.firstRunAt || '-')}`);
  lines.push(`- Latest run: ${oneLine(audit.timeline.latestRunAt || '-')}`);
  lines.push('');
  lines.push('## Coverage Inventory');
  lines.push('');
  lines.push(
    `- Brands: ${toInt(audit.inventory.brandsCount, 0)} (${(audit.inventory.brands || []).join(', ')})`
  );
  lines.push(
    `- Specs by suite: smoke=${audit.inventory.testsBySuite.smoke}, critical=${audit.inventory.testsBySuite.critical}, destructive=${audit.inventory.testsBySuite.destructive}, localization=${audit.inventory.testsBySuite.localization}, visual=${audit.inventory.testsBySuite.visual}, ai=${audit.inventory.testsBySuite.ai}, other=${audit.inventory.testsBySuite.other}`
  );
  lines.push('');
  lines.push('## Latest Mode Health');
  lines.push('');
  lines.push(
    '| Brand | Mode | Last Status | Total | Failed | Blocked | Infra Blocked | Product Blocked | Partial | Duration |'
  );
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const row of audit.modes || []) {
    lines.push(
      `| ${row.brand} | ${row.mode} | ${row.latestRunStatus} | ${row.total} | ${row.failed} | ${row.blockedSignals} | ${row.infraBlockedSignals} | ${row.productBlockedSignals} | ${row.partialSignals} | ${formatDuration(row.durationMs)} |`
    );
  }
  lines.push('');
  lines.push('## Registration Readiness');
  lines.push('');
  lines.push('| Brand | Mode | Artifact | Manual Login Ready | Validation Status | Email |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of audit.registration || []) {
    lines.push(
      `| ${row.brand} | ${row.mode} | ${row.exists ? 'yes' : 'no'} | ${row.manualLoginReady ? 'yes' : 'no'} | ${oneLine(row.loginValidationStatus || '-')} | ${oneLine(row.email || '-')} |`
    );
  }
  lines.push('');
  lines.push('## Deposit Inventory');
  lines.push('');
  lines.push('| Brand | Mode | Inventory File | Methods | API Found | Categories |');
  lines.push('| --- | --- | --- | ---: | --- | --- |');
  for (const row of audit.deposit || []) {
    lines.push(
      `| ${row.brand} | ${row.mode} | ${row.exists ? 'yes' : 'no'} | ${row.itemsCount} | ${row.apiFound ? 'yes' : 'no'} | ${(row.categories || []).join(', ') || '-'} |`
    );
  }
  lines.push('');
  lines.push('## Top Blocked Reasons');
  lines.push('');
  for (const item of audit.errors.topBlockedReasons || []) {
    lines.push(`- ${item.count}x — ${item.reason}`);
  }
  lines.push('');
  lines.push('## Top Provider Reasons');
  lines.push('');
  for (const item of audit.errors.topProviderReasons || []) {
    lines.push(`- ${item.count}x — ${item.reason}`);
  }
  lines.push('');
  lines.push('## Tooling');
  lines.push('');
  lines.push(`- Node: ${oneLine(audit.tooling.nodeVersion || '-')}`);
  lines.push(`- npm: ${oneLine(audit.tooling.npmVersion || '-')}`);
  lines.push(`- Playwright: ${oneLine(audit.tooling.playwrightVersion || '-')}`);
  lines.push(`- npm outdated count: ${toInt(audit.tooling.npmOutdated?.count, 0)}`);
  lines.push(
    `- npm audit vulnerabilities: ${JSON.stringify(
      (audit.tooling.npmAudit && audit.tooling.npmAudit.vulnerabilities) || {}
    )}`
  );
  lines.push(`- brew outdated count: ${toInt(audit.tooling.brewOutdated?.count, 0)}`);
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of audit.recommendations || []) {
    lines.push(`- ${rec}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const audit = buildAudit();
  ensureDir(OUT_DIR);
  fs.writeFileSync(OUT_JSON, JSON.stringify(audit, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(audit), 'utf8');

  console.log(`Deep audit JSON: ${OUT_JSON}`);
  console.log(`Deep audit MD: ${OUT_MD}`);
  console.log(
    `Modes analyzed: ${toInt((audit.modes || []).length, 0)} | Top blocked reasons: ${toInt(
      (audit.errors.topBlockedReasons || []).length,
      0
    )}`
  );
}

main();
