const fs = require('fs');
const path = require('path');
const { URL, pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');

const cwd = process.cwd();
const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
const projectPaths = resolveProjectPaths({ cwd, baseUrl });
const brandName = (() => {
  try {
    return new URL(baseUrl).hostname || 'brand';
  } catch {
    return 'brand';
  }
})();
const brandSlug =
  String(brandName)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'brand';
const reportDir = projectPaths.testResultsDir;
const artifactsDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const reportPath = path.join(reportDir, 'report.json');
const phaseReportCandidates = [
  {
    phase: 'precheck',
    paths: [
      path.join(artifactsDir, 'precheck-report.json'),
      path.join(reportDir, 'precheck-report.json'),
    ],
  },
  {
    phase: 'home',
    paths: [path.join(artifactsDir, 'home-report.json'), path.join(reportDir, 'home-report.json')],
  },
  {
    phase: 'registration',
    paths: [
      path.join(artifactsDir, 'registration-report.json'),
      path.join(reportDir, 'registration-report.json'),
    ],
  },
  {
    phase: 'auth',
    paths: [path.join(artifactsDir, 'auth-report.json'), path.join(reportDir, 'auth-report.json')],
  },
  {
    phase: 'profile',
    paths: [
      path.join(artifactsDir, 'profile-report.json'),
      path.join(reportDir, 'profile-report.json'),
    ],
  },
  {
    phase: 'deposit',
    paths: [
      path.join(artifactsDir, 'deposit-report.json'),
      path.join(reportDir, 'deposit-report.json'),
    ],
  },
  {
    phase: 'withdraw',
    paths: [
      path.join(artifactsDir, 'withdraw-report.json'),
      path.join(reportDir, 'withdraw-report.json'),
    ],
  },
  {
    phase: 'sidebar',
    paths: [
      path.join(artifactsDir, 'sidebar-report.json'),
      path.join(reportDir, 'sidebar-report.json'),
    ],
  },
  {
    phase: 'sports',
    paths: [
      path.join(artifactsDir, 'sports-report.json'),
      path.join(reportDir, 'sports-report.json'),
    ],
  },
  {
    phase: 'casino',
    paths: [
      path.join(artifactsDir, 'casino-report.json'),
      path.join(reportDir, 'casino-report.json'),
    ],
  },
  {
    phase: 'livecasino',
    paths: [
      path.join(artifactsDir, 'livecasino-report.json'),
      path.join(reportDir, 'livecasino-report.json'),
    ],
  },
  {
    phase: 'security',
    paths: [
      path.join(artifactsDir, 'security-report.json'),
      path.join(reportDir, 'security-report.json'),
    ],
  },
  {
    phase: 'contracts',
    paths: [
      path.join(artifactsDir, 'contracts-report.json'),
      path.join(reportDir, 'contracts-report.json'),
    ],
  },
  {
    phase: 'nightlyextras',
    paths: [
      path.join(artifactsDir, 'nightlyextras-report.json'),
      path.join(reportDir, 'nightlyextras-report.json'),
    ],
  },
  {
    phase: 'a11y',
    paths: [path.join(artifactsDir, 'a11y-report.json'), path.join(reportDir, 'a11y-report.json')],
  },
  {
    phase: 'visual',
    paths: [
      path.join(artifactsDir, 'visual-report.json'),
      path.join(reportDir, 'visual-report.json'),
    ],
  },
  {
    phase: 'main',
    paths: [path.join(artifactsDir, 'main-report.json'), path.join(reportDir, 'main-report.json')],
  },
  {
    phase: 'destructive',
    paths: [
      path.join(artifactsDir, 'destructive-report.json'),
      path.join(reportDir, 'destructive-report.json'),
    ],
  },
];

const outPath = path.join(projectPaths.projectRoot, 'qa-report.md');
const outHtmlPath = path.join(projectPaths.projectRoot, 'qa-report.html');
const analyzeOutPath = path.join(projectPaths.analyzeDir, 'qa-report.md');
const analyzeOutHtmlPath = path.join(projectPaths.analyzeDir, 'qa-report.html');
const autotestReportDir = projectPaths.autotestReportDir;
const brandOutPath = path.join(autotestReportDir, `${brandSlug}.md`);
const brandOutHtmlPath = path.join(autotestReportDir, `${brandSlug}.html`);
const brandOutPdfPath = path.join(autotestReportDir, `${brandSlug}.pdf`);

const registrationCurrentRunPath = path.join(
  projectPaths.artifactsDir,
  'registration-data-current-run.json'
);
const registrationCandidates = [
  registrationCurrentRunPath,
  path.join(projectPaths.testResultsDir, 'registration-data.json'),
  path.join(projectPaths.artifactsDir, 'last-registered-player.json'),
];
const manualLoginPlayerPath = path.join(projectPaths.artifactsDir, 'last-manual-login-player.json');
const registrationNetworkPath = path.join(projectPaths.testResultsDir, 'registration-network.json');
const providerMatrixPath = path.join(
  autotestReportDir,
  'casino',
  'providers-real',
  'providers-real-matrix.json'
);
const depositInventoryArtifactPath = path.join(
  autotestReportDir,
  'deposit',
  'deposit-inventory.json'
);
const depositArtifactPath = path.join(autotestReportDir, 'deposit', 'deposit-non-destructive.json');
const authStateHealthArtifactPath = path.join(projectPaths.artifactsDir, 'auth-state-health.json');
const kpiValidationArtifactPath = path.join(projectPaths.artifactsDir, 'kpi-validation.json');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

const reportCompact = String(process.env.QA_REPORT_COMPACT || '1')
  .trim()
  .toLowerCase();
const reportCompactMode = !['0', 'false', 'no', 'off'].includes(reportCompact);
const includeReportGuide = (() => {
  const raw = String(process.env.QA_REPORT_INCLUDE_GUIDE || (reportCompactMode ? '0' : '1'))
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
})();
const sectionDetailRowsLimit = parsePositiveInt(
  process.env.QA_REPORT_SECTION_ROWS,
  reportCompactMode ? 0 : 200
);
const testMatrixRowsLimit = parsePositiveInt(
  process.env.QA_REPORT_MATRIX_ROWS,
  reportCompactMode ? 80 : 5000
);
const providerMatrixRowsLimit = parsePositiveInt(
  process.env.QA_REPORT_PROVIDER_ROWS,
  reportCompactMode ? 30 : 5000
);

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readFirstJson(paths) {
  for (const filePath of paths) {
    const data = readJson(filePath);
    if (data) return { data, path: filePath };
  }
  return { data: null, path: null };
}

function isManualLoginReadyPlayer(data) {
  if (!data || typeof data !== 'object') return false;
  const email = oneLine(data.email || '');
  const password = oneLine(data.password || '');
  const status = String(data.loginValidationStatus || '')
    .trim()
    .toLowerCase();
  return Boolean(
    email && password && data.manualLoginReady === true && status === 'password-signin-ok'
  );
}

function loadReportSources() {
  const phaseSources = phaseReportCandidates
    .map((entry) => {
      for (const candidatePath of entry.paths) {
        const data = readJson(candidatePath);
        if (data) {
          return { phase: entry.phase, path: candidatePath, data };
        }
      }
      return null;
    })
    .filter(Boolean);

  if (phaseSources.length) return phaseSources;

  const fallback = readJson(reportPath);
  if (fallback) {
    return [{ phase: 'latest', path: reportPath, data: fallback }];
  }

  console.error(`JSON report not found: ${reportPath}`);
  process.exit(1);
}

function stripAnsi(value) {
  const input = String(value || '');
  let output = '';
  let i = 0;

  while (i < input.length) {
    const charCode = input.charCodeAt(i);
    if (charCode === 27) {
      i += 1;
      if (input[i] === '[') {
        i += 1;
        while (i < input.length) {
          const code = input.charCodeAt(i);
          if (code >= 64 && code <= 126) {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      continue;
    }

    output += input[i];
    i += 1;
  }

  return output;
}

function uniquePathParts(parts) {
  const unique = [];
  for (const part of parts || []) {
    const text = oneLine(part);
    if (!text) continue;
    if (unique[unique.length - 1] !== text) unique.push(text);
  }
  return unique;
}

function collectAnnotations(test, results) {
  const seen = new Set();
  const annotations = [];
  const raw = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : [])),
  ];

  for (const annotation of raw) {
    const type = oneLine(annotation && annotation.type ? annotation.type : 'note') || 'note';
    const description = oneLine(
      stripAnsi(annotation && annotation.description ? annotation.description : '')
    );
    const key = `${type}::${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    annotations.push({ type, description });
  }

  return annotations;
}

function collectTests(suite, phase, acc = [], suitePath = []) {
  if (!suite) return acc;
  const nextSuitePath = suite.title ? [...suitePath, suite.title] : suitePath;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      const specFile = spec.file || spec.location?.file || '';
      const specTitle = oneLine(spec.title || '');
      const specPath = uniquePathParts([...nextSuitePath, specTitle]);

      for (const t of spec.tests || []) {
        const title = t.title || specTitle || '(untitled)';
        const results = Array.isArray(t.results) ? t.results : [];
        const annotations = collectAnnotations(t, results);
        const final = results[results.length - 1] || {};
        const explicitTitlePath = Array.isArray(t.titlePath)
          ? uniquePathParts(t.titlePath)
          : uniquePathParts([...specPath, t.title]);
        const titlePath = explicitTitlePath.join(' > ') || title;
        const duration = results.reduce((sum, result) => sum + Number(result.duration || 0), 0);

        acc.push({
          phase,
          title,
          titlePath,
          status: final.status || t.status || 'unknown',
          expectedStatus: t.expectedStatus || 'passed',
          projectName: oneLine(t.projectName || final.projectName || t.projectId || ''),
          location: t.location || spec.location || {},
          file: specFile,
          duration: duration || Number(final.duration || 0),
          retries: Math.max(0, results.length - 1),
          error:
            final.error?.message ||
            final.errors?.[0]?.message ||
            results
              .flatMap((result) => result.errors || [])
              .map((error) => error?.message || '')
              .find(Boolean) ||
            '',
          attachments: Array.isArray(final.attachments) ? final.attachments : [],
          annotations,
        });
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) collectTests(child, phase, acc, nextSuitePath);
  }

  return acc;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return `${mins}m ${secs}s`;
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOTE_TEXT_LIMIT = 180;
const TOP_REASON_TEXT_LIMIT = 140;

function truncateText(value, limit = NOTE_TEXT_LIMIT) {
  const text = oneLine(value);
  if (!text) return '';
  const safeLimit = Math.max(24, Number(limit || NOTE_TEXT_LIMIT));
  return text.length > safeLimit ? `${text.slice(0, safeLimit - 3)}...` : text;
}

function normalizeReason(value, limit = TOP_REASON_TEXT_LIMIT) {
  const raw = oneLine(stripAnsi(value || ''));
  if (!raw) return '';
  const pipedChunks = raw
    .split('|')
    .map((item) => oneLine(item))
    .filter(Boolean);
  const compactRaw = pipedChunks.length >= 2 ? `${pipedChunks[0]} ...` : raw;
  const lowered = compactRaw.toLowerCase();

  if (
    /cloudflare|cf_chl|__cf_chl|just a moment|challenge url detected|challenge text visible/.test(
      lowered
    )
  ) {
    return 'Cloudflare/WAF challenge gate';
  }
  if (/captcha/.test(lowered)) {
    return 'Captcha gate';
  }
  if (
    /provider .* did not pass non-demo launch\/health checks|non-demo launch\/health checks/.test(
      lowered
    )
  ) {
    return 'Provider non-demo launch/health check did not pass';
  }
  if (/credentials_not_valid|wrong login or password/.test(lowered)) {
    return 'Credentials not valid';
  }
  if (/blocked by product|product blocked/.test(lowered)) {
    return 'Product surface blocked';
  }
  if (/authorized sidebar primary navigation|authorized sidebar home/.test(lowered)) {
    return 'Authorized sidebar items blocked (layout/challenge)';
  }
  if (/storagestate|auth state/.test(lowered)) {
    return 'Auth state/storage issue';
  }

  const withNormalizedUrls = compactRaw.replace(/https?:\/\/[^\s|,)]+/gi, (urlValue) => {
    try {
      const parsed = new URL(urlValue);
      return `${parsed.hostname}${parsed.pathname || '/'}`.replace(/\/{2,}/g, '/');
    } catch {
      return 'url';
    }
  });

  const withMaskedTokens = withNormalizedUrls
    .replace(/[A-Za-z0-9._-]{24,}/g, '<token>')
    .replace(/\b\d{7,}\b/g, '<num>');

  return truncateText(withMaskedTokens, limit);
}

function formatPathForDisplay(filePath) {
  if (!filePath) return '-';
  const rel = oneLine(toRelative(filePath));
  return rel || oneLine(filePath) || '-';
}

function formatLocation(test) {
  const loc = (test && test.location) || {};
  const file = formatPathForDisplay(loc.file || test.file || '');
  const line = Number(loc.line || 0);
  return line > 0 ? `${file}:${line}` : file;
}

function escapeMdCell(value) {
  return String(value || '-')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

function toRelative(filePath) {
  if (!filePath) return '';
  return path.relative(cwd, filePath) || filePath;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFailureStatus(status) {
  return ['failed', 'timedOut', 'interrupted'].includes(status);
}

function getStatusTotals(tests) {
  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => isFailureStatus(t.status)).length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    flaky: tests.filter((t) => t.status === 'flaky').length,
  };
}

function getRunStatus(totals) {
  if (totals.failed > 0) return 'FAILED';
  if (totals.total === 0) return 'NO_TESTS';
  if (totals.flaky > 0) return 'PASSED_WITH_FLAKY';
  if (totals.skipped > 0) return 'PASSED_WITH_SKIPS';
  return 'PASSED';
}

function statusRank(status) {
  const order = ['failed', 'flaky', 'skipped', 'timedOut', 'interrupted', 'passed'];
  const idx = order.indexOf(status);
  return idx === -1 ? order.length : idx;
}

function resolveSection(test) {
  const file = String(test.file || '').toLowerCase();
  const title = String(test.titlePath || test.title || '').toLowerCase();
  const haystack = `${file} ${title}`;

  if (/contract|schemathesis|spectral|openapi/.test(haystack)) return 'Contracts';
  if (/live chat|livechat|chat-widget/.test(haystack)) return 'Live Chat';
  if (/sidebar/.test(haystack)) return 'Sidebar';
  if (/signup|registration/.test(haystack)) return 'Registration';
  if (
    /profile-password-security|profile security|account details|security center|\/profile\//.test(
      haystack
    )
  )
    return 'My Profile';
  if (/login|auth|forgot password|forgot-password|reset password|password reset/.test(haystack))
    return 'Login';
  if (/casino|provider|slot|game/.test(haystack)) return 'Casino';
  if (/deposit|withdraw|wallet|payment|cashier/.test(haystack)) return 'Deposit';
  if (/profile|account details|security center/.test(haystack)) return 'My Profile';
  if (/button-sweep|navigation|home|precheck|site regression|full-check/.test(haystack))
    return 'Navigation & Core';
  if (/a11y|accessibility|axe/.test(haystack)) return 'Accessibility';
  if (/visual|screenshot|snapshot/.test(haystack)) return 'Visual';
  if (/sports/.test(haystack)) return 'Sports';
  return 'Other';
}

const SECTION_EXPLANATIONS = {
  'Report Guide':
    'Embedded explanation of every main report block so the md/html/pdf output is self-explanatory.',
  Highlights:
    'Short executive summary of the run with status, failure/blocked ratios, and dominant blocker patterns.',
  Summary:
    'Top-level result of the full run: totals, skips, diagnostic signals, and total duration.',
  'Mobile Stability':
    'Mobile-only stability summary: mobile totals, failures/timeouts, blocked signals, and the most frequent blocker reasons.',
  Sections:
    'Aggregates tests by product area so it is easy to see where runtime and blocked signals are concentrated.',
  Accessibility: 'Accessibility smoke checks and their most important findings.',
  Visual: 'Visual smoke checks and screenshots captured from key routes and flows in this run.',
  Casino:
    'Casino catalog, filters, game launch checks, and provider-level non-demo launch coverage.',
  Deposit:
    'Deposit UI and API alignment, plus working surface checks for each visible deposit category.',
  Contracts:
    'API contract and fuzz checks for auth/payment OpenAPI surfaces via Spectral and Schemathesis.',
  Sidebar:
    'Full sidebar coverage for guest and authorized users, including inventory, navigation, utilities, and gating.',
  'Live Chat':
    'Sidebar live chat widget checks, including launcher, pre-chat form, and destructive send/reply coverage when enabled.',
  Login: 'Login flow, auth-sensitive checks, and authorization-dependent sweeps.',
  'My Profile':
    'Profile route access, account/security sections, persistence checks, visual and accessibility smoke.',
  'Navigation & Core': 'Homepage, precheck, key navigation, and generic site-health smoke checks.',
  Registration:
    'Registration-specific checks, including real signup API validation and registration-dependent bootstrap flows.',
  'Registration & Player':
    'Compact registration status plus current manual-login credentials and validation state.',
  'Casino Providers Matrix':
    'Provider-by-provider non-demo launch matrix, showing whether a provider launched strongly, weakly, or was blocked/absent.',
  'Deposit Coverage':
    'Compact combined view of deposit inventory + method readiness with key availability and blocked diagnostics.',
  'Auth State Health':
    'Freshness and usability diagnostics for storageState used by authorized suites (especially provider/history checks).',
  'Run KPI Validation':
    'Run-level validity gates (blocked ratios, provider success minimum, deposit UI/API consistency) that can fail an otherwise green run.',
  'Failed Tests':
    'Only the tests that hard-failed in the run, with condensed failure context and attachment references.',
  'Registration Diagnostics':
    'Detailed registration network and console evidence captured for debugging signup issues.',
};

const FLAG_EXPLANATIONS = [
  {
    flag: 'blocked',
    meaning:
      'The test finished with a classified external blocker such as WAF, captcha, missing route, or unavailable UI.',
  },
  {
    flag: 'infra blocked',
    meaning:
      'Blocked by infrastructure constraints (WAF/challenge/auth state/session/network/provider bootstrap).',
  },
  {
    flag: 'product blocked',
    meaning:
      'Blocked by product surface constraints (feature not rendered/interactive in the current brand layout).',
  },
  {
    flag: 'partial',
    meaning:
      'The test completed with useful evidence, but the intended coverage was intentionally incomplete.',
  },
  {
    flag: 'n/a',
    meaning:
      'Capability is marked optional for this brand in brand-capabilities matrix and is reported as not applicable.',
  },
  {
    flag: 'weak surface',
    meaning:
      'A flow launched, but the visible surface was weaker than the strict success criteria.',
  },
  {
    flag: 'provider absent',
    meaning:
      'The provider is included in the target matrix but was not present on the brand in this run.',
  },
  {
    flag: 'provider blocked',
    meaning:
      'The provider launch was blocked by challenge text, cancelled bootstrap, or another launch-level blocker.',
  },
  {
    flag: 'retried',
    meaning: 'The test needed a retry or recovery attempt before reaching its final result.',
  },
];

const REPORT_GUIDE_ROWS = [
  { section: 'Highlights', meaning: SECTION_EXPLANATIONS.Highlights },
  { section: 'Summary', meaning: SECTION_EXPLANATIONS.Summary },
  { section: 'Mobile Stability', meaning: SECTION_EXPLANATIONS['Mobile Stability'] },
  { section: 'Sections', meaning: SECTION_EXPLANATIONS.Sections },
  { section: 'Accessibility', meaning: SECTION_EXPLANATIONS.Accessibility },
  { section: 'Visual', meaning: SECTION_EXPLANATIONS.Visual },
  { section: 'Casino', meaning: SECTION_EXPLANATIONS.Casino },
  { section: 'Deposit', meaning: SECTION_EXPLANATIONS.Deposit },
  { section: 'Contracts', meaning: SECTION_EXPLANATIONS.Contracts },
  { section: 'Sidebar', meaning: SECTION_EXPLANATIONS.Sidebar },
  { section: 'Live Chat', meaning: SECTION_EXPLANATIONS['Live Chat'] },
  { section: 'Login', meaning: SECTION_EXPLANATIONS.Login },
  { section: 'My Profile', meaning: SECTION_EXPLANATIONS['My Profile'] },
  { section: 'Navigation & Core', meaning: SECTION_EXPLANATIONS['Navigation & Core'] },
  { section: 'Registration', meaning: SECTION_EXPLANATIONS.Registration },
  { section: 'Registration & Player', meaning: SECTION_EXPLANATIONS['Registration & Player'] },
  { section: 'Casino Providers Matrix', meaning: SECTION_EXPLANATIONS['Casino Providers Matrix'] },
  { section: 'Deposit Coverage', meaning: SECTION_EXPLANATIONS['Deposit Coverage'] },
  { section: 'Auth State Health', meaning: SECTION_EXPLANATIONS['Auth State Health'] },
  { section: 'Run KPI Validation', meaning: SECTION_EXPLANATIONS['Run KPI Validation'] },
  { section: 'Failed Tests', meaning: SECTION_EXPLANATIONS['Failed Tests'] },
  {
    section: 'Registration Diagnostics',
    meaning: SECTION_EXPLANATIONS['Registration Diagnostics'],
  },
];

function getSectionExplanation(name) {
  return SECTION_EXPLANATIONS[name] || '';
}

function renderSectionIntroMd(name) {
  const explanation = getSectionExplanation(name);
  return explanation ? `${explanation}\n\n` : '';
}

function renderSectionIntroHtml(name) {
  const explanation = getSectionExplanation(name);
  return explanation ? `<p class="section-intro">${escapeHtml(explanation)}</p>` : '';
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function blockedAwareCount(value, blocked) {
  const numeric = Number(value || 0);
  if (!blocked) return numeric;
  return numeric > 0 ? numeric : 'N/A (blocked)';
}

function blockedAwareList(items, blocked) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > 0) return list.join(', ');
  if (blocked) return 'N/A (blocked)';
  return '-';
}

function blockedAwareBool(value, blocked) {
  if (blocked) return 'N/A (blocked)';
  return value ? 'yes' : 'no';
}

function blockedReasonText(value) {
  const clean = normalizeReason(value, NOTE_TEXT_LIMIT);
  return clean || 'Deposit surface unavailable in current run.';
}

function resolveCoverageMode(uiAvailable, apiAvailable) {
  if (uiAvailable && apiAvailable) return 'ui+api';
  if (uiAvailable) return 'ui-only';
  if (apiAvailable) return 'api-only';
  return 'none';
}

function renderReportGuideMd() {
  return [
    '## Report Guide',
    '',
    renderSectionIntroMd('Report Guide').trim(),
    '',
    '| Section | Meaning |',
    '| --- | --- |',
    ...REPORT_GUIDE_ROWS.map(
      (entry) => `| ${escapeMdCell(entry.section)} | ${escapeMdCell(entry.meaning)} |`
    ),
    '',
    '### Flag Legend',
    '',
    '| Flag | Meaning |',
    '| --- | --- |',
    ...FLAG_EXPLANATIONS.map(
      (entry) => `| ${escapeMdCell(entry.flag)} | ${escapeMdCell(entry.meaning)} |`
    ),
    '',
  ].join('\n');
}

function renderReportGuideHtml() {
  return `
      <section>
        <h2>Report Guide</h2>
        ${renderSectionIntroHtml('Report Guide')}
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            ${REPORT_GUIDE_ROWS.map(
              (entry) => `
                <tr>
                  <td>${escapeHtml(entry.section)}</td>
                  <td>${escapeHtml(entry.meaning)}</td>
                </tr>
              `
            ).join('')}
          </tbody>
        </table>
        <h3>Flag Legend</h3>
        <table>
          <thead>
            <tr>
              <th>Flag</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            ${FLAG_EXPLANATIONS.map(
              (entry) => `
                <tr>
                  <td>${escapeHtml(entry.flag)}</td>
                  <td>${escapeHtml(entry.meaning)}</td>
                </tr>
              `
            ).join('')}
          </tbody>
        </table>
      </section>
    `;
}

function attachmentLinksMd(attachments) {
  if (!attachments || !attachments.length) return '-';
  const links = attachments.map((att) => {
    const name = att.name || 'attachment';
    const rel = att.path ? toRelative(att.path) : '';
    if (!rel) return name;
    return `[${name}](${rel})`;
  });
  return links.join(', ');
}

function attachmentLinksHtml(attachments) {
  if (!attachments || !attachments.length) return '<span class="muted">-</span>';
  return attachments
    .map((att) => {
      const name = escapeHtml(att.name || 'attachment');
      const rel = att.path ? toRelative(att.path) : '';
      if (!rel) return `<span>${name}</span>`;
      return `<a href="${escapeHtml(rel)}">${name}</a>`;
    })
    .join('<span class="sep">, </span>');
}

function runStatusBadgeClass(status) {
  if (status === 'FAILED' || status === 'FAILED_KPI') return 'badge-failed';
  if (status === 'PASSED') return 'badge-passed';
  if (status.startsWith('PASSED_WITH')) return 'badge-skipped';
  return 'badge-default';
}

function hasAnnotation(test, type) {
  return (test.annotations || []).some((annotation) => annotation.type === type);
}

const ISSUE_ANNOTATION_TYPES = new Set([
  'blocked',
  'infra-blocked',
  'product-blocked',
  'provider-blocked',
  'provider-absent',
  'partial',
  'deposit-method-limit',
  'weak-surface',
  'not-applicable',
  'retried',
  'flaky',
]);

function isIssueLikeTest(test) {
  if (isFailureStatus(test && test.status)) return true;
  const annotations = Array.isArray(test && test.annotations) ? test.annotations : [];
  return annotations.some((item) => ISSUE_ANNOTATION_TYPES.has(String(item.type || '').trim()));
}

function sortByImportance(tests) {
  return [...(tests || [])].sort((a, b) => {
    const failureDiff = Number(isFailureStatus(b.status)) - Number(isFailureStatus(a.status));
    if (failureDiff !== 0) return failureDiff;
    const issueDiff = Number(isIssueLikeTest(b)) - Number(isIssueLikeTest(a));
    if (issueDiff !== 0) return issueDiff;
    const blockedDiff = Number(hasAnnotation(b, 'blocked')) - Number(hasAnnotation(a, 'blocked'));
    if (blockedDiff !== 0) return blockedDiff;
    return String(a.titlePath || a.title || '').localeCompare(String(b.titlePath || b.title || ''));
  });
}

function sliceWithMeta(items, limit) {
  const normalized = Array.isArray(items) ? items : [];
  if (limit < 0) {
    return { items: normalized, omitted: 0 };
  }
  const safeLimit = Math.max(0, Number(limit || 0));
  const visible = normalized.slice(0, safeLimit);
  const omitted = Math.max(0, normalized.length - visible.length);
  return { items: visible, omitted };
}

function getFlagLabels(test) {
  const flags = [];
  if (hasAnnotation(test, 'provider-absent')) flags.push('provider absent');
  if (hasAnnotation(test, 'provider-blocked')) flags.push('provider blocked');
  else if (hasAnnotation(test, 'blocked')) {
    if (hasAnnotation(test, 'infra-blocked')) flags.push('infra blocked');
    else if (hasAnnotation(test, 'product-blocked')) flags.push('product blocked');
    else flags.push('blocked');
  }
  if (hasAnnotation(test, 'not-applicable')) flags.push('n/a');
  if (hasAnnotation(test, 'weak-surface')) flags.push('weak surface');
  if (hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit'))
    flags.push('partial');
  if (hasAnnotation(test, 'retried') || test.retries > 0 || hasAnnotation(test, 'flaky')) {
    flags.push(`retried x${Math.max(1, test.retries)}`);
  }
  return flags;
}

function flagsMd(test) {
  const flags = getFlagLabels(test);
  return flags.length ? flags.join(', ') : '-';
}

function flagsHtml(test) {
  const flags = getFlagLabels(test);
  if (!flags.length) return '<span class="muted">-</span>';
  return flags.map((flag) => `<span class="mini-flag">${escapeHtml(flag)}</span>`).join('');
}

function noteSummary(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const reasons = !annotations.length
    ? [normalizeReason(test.error || test.status || '-')]
    : annotations
        .slice(0, 3)
        .map((annotation) => normalizeReason(annotation.description || annotation.type))
        .filter(Boolean);
  const uniqueReasons = [...new Set(reasons)];
  const note = uniqueReasons.join(' | ');
  return truncateText(note || '-', NOTE_TEXT_LIMIT);
}

function getSignalTotals(tests) {
  return {
    blocked: tests.filter((test) => hasAnnotation(test, 'blocked')).length,
    infraBlocked: tests.filter((test) => hasAnnotation(test, 'infra-blocked')).length,
    productBlocked: tests.filter((test) => hasAnnotation(test, 'product-blocked')).length,
    notApplicable: tests.filter((test) => hasAnnotation(test, 'not-applicable')).length,
    partial: tests.filter(
      (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
    ).length,
    retried: tests.filter(
      (test) => hasAnnotation(test, 'retried') || test.retries > 0 || hasAnnotation(test, 'flaky')
    ).length,
    weakSurface: tests.filter((test) => hasAnnotation(test, 'weak-surface')).length,
    providerAbsent: tests.filter((test) => hasAnnotation(test, 'provider-absent')).length,
  };
}

function extractReason(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const preferred = annotations.find(
    (item) =>
      [
        'blocked',
        'infra-blocked',
        'product-blocked',
        'provider-blocked',
        'not-applicable',
      ].includes(String(item.type || '').toLowerCase()) && oneLine(item.description)
  );
  if (preferred) return normalizeReason(preferred.description);

  const anyDescription = annotations.find((item) => oneLine(item.description));
  if (anyDescription) return normalizeReason(anyDescription.description);

  return normalizeReason(test.error || test.status || 'unknown');
}

function topReasons(tests, limit = 5) {
  const counts = new Map();
  for (const test of tests || []) {
    const reason = extractReason(test);
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.reason.localeCompare(b.reason);
    })
    .slice(0, Math.max(1, limit));
}

function resolveMobileTests(allTests, executionMode) {
  const mode = String(executionMode || '')
    .trim()
    .toLowerCase();
  if (mode === 'mobile') return allTests.slice();
  return allTests.filter((test) =>
    String(test.projectName || '')
      .trim()
      .toLowerCase()
      .includes('mobile')
  );
}

function summarizeProviderMatrix(payload) {
  const results = Array.isArray(payload && payload.results) ? payload.results : [];
  const summary = payload && payload.summary ? payload.summary : {};
  const targetDeclared = Number(
    (payload && (payload.providersTargetCountAll || payload.providersTargetCount)) ||
      results.length ||
      0
  );
  const providersDiscovered = Number((payload && payload.providersDiscovered) || 0);
  return {
    targetDeclared,
    resultsCaptured: results.length,
    providersDiscovered,
    total: Number(summary.total || results.length || 0),
    passed: Number(
      summary.passed || results.filter((item) => item.status === 'passed').length || 0
    ),
    failed: Number(
      summary.failed || results.filter((item) => item.status === 'failed').length || 0
    ),
    blocked: Number(
      summary.blocked || results.filter((item) => item.status === 'blocked').length || 0
    ),
    passedStrong: Number(
      summary.passedStrong || results.filter((item) => item.outcome === 'passed-strong').length || 0
    ),
    passedWeakSurface: Number(
      summary.passedWeakSurface ||
        results.filter((item) => item.outcome === 'passed-weak-surface').length ||
        0
    ),
    blockedProviderAbsent: Number(
      summary.blockedProviderAbsent ||
        results.filter((item) => item.outcome === 'provider-absent').length ||
        0
    ),
    blockedProviderLaunch: Number(
      summary.blockedProviderLaunch ||
        results.filter((item) => item.outcome === 'provider-launch-blocked').length ||
        0
    ),
    blockedOther: Number(
      summary.blockedOther ||
        results.filter(
          (item) =>
            item.status === 'blocked' &&
            !['provider-absent', 'provider-launch-blocked'].includes(item.outcome)
        ).length ||
        0
    ),
    retriedRecovered: Number(
      summary.retriedRecovered || results.filter((item) => Boolean(item.flakyRecovered)).length || 0
    ),
  };
}

function summarizeDepositArtifact(payload) {
  const results = Array.isArray(payload && payload.selectionResults)
    ? payload.selectionResults
    : [];
  const realResults = results.filter((item) => item.method && item.method !== '__time_budget__');
  const discoveredCount = Number(
    payload && payload.paymentMethodsDiscoveredCount
      ? payload.paymentMethodsDiscoveredCount
      : Array.isArray(payload && payload.paymentMethodsDiscovered)
        ? payload.paymentMethodsDiscovered.length
        : 0
  );
  const checkedCount = Number(
    payload && payload.paymentMethodsCheckedCount
      ? payload.paymentMethodsCheckedCount
      : Array.isArray(payload && payload.paymentMethodsChecked)
        ? payload.paymentMethodsChecked.length
        : realResults.length
  );
  const uiCoverageAvailable =
    payload && typeof payload.uiCoverageAvailable === 'boolean'
      ? payload.uiCoverageAvailable
      : Number(
          payload && payload.paymentMethodTilesDiscoveredCount
            ? payload.paymentMethodTilesDiscoveredCount
            : 0
        ) > 0;
  const apiCoverageAvailable =
    payload && typeof payload.apiCoverageAvailable === 'boolean'
      ? payload.apiCoverageAvailable
      : Boolean(payload && payload.apiFallback && payload.apiFallback.resolved);
  return {
    discoveredCount,
    checkedCount,
    readyCount: Number(
      payload && payload.paymentMethodsReadyCount
        ? payload.paymentMethodsReadyCount
        : realResults.filter((item) => item.selected && item.surfaceReady).length
    ),
    partialCoverage: Boolean(payload && payload.partialCoverage),
    submitVisible: Boolean(payload && payload.submitVisible),
    submitEnabled: Boolean(payload && payload.submitEnabled),
    source: oneLine((payload && payload.source) || ''),
    sourceMode: oneLine(
      (payload && payload.sourceMode) ||
        resolveCoverageMode(uiCoverageAvailable, apiCoverageAvailable)
    ),
    uiCoverageAvailable,
    apiCoverageAvailable,
    results: realResults,
  };
}

function summarizeDepositInventory(payload) {
  const apiInventory = payload && payload.apiInventory ? payload.apiInventory : {};
  const uiInventory = payload && payload.uiInventory ? payload.uiInventory : {};
  const apiFallback = payload && payload.apiFallback ? payload.apiFallback : {};
  const fallbackAttempts = Array.isArray(apiFallback.attempts) ? apiFallback.attempts : [];
  const uiCoverageAvailable =
    payload && typeof payload.uiCoverageAvailable === 'boolean'
      ? payload.uiCoverageAvailable
      : Number(uiInventory.totalTiles || 0) > 0;
  const apiCoverageAvailable =
    payload && typeof payload.apiCoverageAvailable === 'boolean'
      ? payload.apiCoverageAvailable
      : Number(apiInventory.itemsCount || 0) > 0;
  return {
    apiItemsCount: Number(apiInventory.itemsCount || 0),
    apiCategories: Array.isArray(apiInventory.categories) ? apiInventory.categories : [],
    apiGrouped: Array.isArray(apiInventory.grouped) ? apiInventory.grouped : [],
    uiCategories: Array.isArray(uiInventory.uniqueCategories) ? uiInventory.uniqueCategories : [],
    uiTilesCount: Number(uiInventory.totalTiles || 0),
    sourceMode: oneLine(
      (payload && payload.sourceMode) ||
        resolveCoverageMode(uiCoverageAvailable, apiCoverageAvailable)
    ),
    uiCoverageAvailable,
    apiCoverageAvailable,
    apiFallbackResolved: Boolean(apiFallback && apiFallback.resolved),
    apiFallbackBestCurrency: oneLine(apiFallback.bestCurrency || ''),
    apiFallbackBestStatus: Number(apiFallback.bestStatus || 0),
    apiFallbackAttempts: fallbackAttempts.map((attempt) => ({
      currency: oneLine(attempt.currency || '-'),
      status: Number(attempt.status || 0),
      itemsCount: Number(attempt.itemsCount || 0),
      error: oneLine(attempt.error || ''),
      url: oneLine(attempt.url || ''),
      bodyPreview: oneLine(attempt.bodyPreview || ''),
    })),
    unexpectedUiCategories: Array.isArray(payload && payload.unexpectedUiCategories)
      ? payload.unexpectedUiCategories
      : [],
    missingUiCategories: Array.isArray(payload && payload.missingUiCategories)
      ? payload.missingUiCategories
      : [],
  };
}

const reportSources = loadReportSources();
let tests = [];
for (const source of reportSources) {
  const suites = Array.isArray(source.data.suites) ? source.data.suites : [];
  for (const suite of suites) tests = collectTests(suite, source.phase, tests);
}

tests.sort((a, b) => {
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus;
  if (a.phase !== b.phase) return a.phase.localeCompare(b.phase);
  return a.titlePath.localeCompare(b.titlePath);
});

const totals = getStatusTotals(tests);
const signalTotals = getSignalTotals(tests);
const authStateHealth = readJson(authStateHealthArtifactPath);
const kpiValidation = readJson(kpiValidationArtifactPath);
const runStatusBase = getRunStatus(totals);
const runStatus = kpiValidation && kpiValidation.valid === false ? 'FAILED_KPI' : runStatusBase;
const failed = tests.filter((t) => isFailureStatus(t.status));
const executionMode = String(process.env.QA_EXECUTION_MODE || process.env.PW_PROJECT_MATRIX || '')
  .trim()
  .toLowerCase();
const mobileTests = resolveMobileTests(tests, executionMode);
const mobileTotals = getStatusTotals(mobileTests);
const mobileBlockedCount = mobileTests.filter((test) => hasAnnotation(test, 'blocked')).length;
const mobileProviderBlockedCount = mobileTests.filter((test) =>
  hasAnnotation(test, 'provider-blocked')
).length;
const mobileInfraBlockedCount = mobileTests.filter((test) =>
  hasAnnotation(test, 'infra-blocked')
).length;
const mobileTimedOutCount = mobileTests.filter((test) => String(test.status) === 'timedOut').length;
const mobileStabilityTests = mobileTests.filter(
  (test) =>
    isFailureStatus(test.status) ||
    hasAnnotation(test, 'blocked') ||
    hasAnnotation(test, 'provider-blocked')
);
const mobileTopReasons = topReasons(mobileStabilityTests, 6);
const mobileTopReasonsTotal = Math.max(1, mobileStabilityTests.length);
const showMobileStability = executionMode === 'mobile' || mobileTests.length > 0;
const durationMs = reportSources.reduce(
  (sum, src) => sum + Number(src.data.stats?.duration || 0),
  0
);
const generatedAt = new Date().toISOString();

const phaseSummary = reportSources.map((src) => {
  const phaseTests = tests.filter((t) => t.phase === src.phase);
  const phaseTotals = getStatusTotals(phaseTests);
  return {
    phase: src.phase,
    sourcePath: src.path,
    totals: phaseTotals,
    durationMs: Number(src.data.stats?.duration || 0),
  };
});

const sectionMap = new Map();
for (const testItem of tests) {
  const section = resolveSection(testItem);
  if (!sectionMap.has(section)) sectionMap.set(section, []);
  sectionMap.get(section).push(testItem);
}

const sectionSummary = [...sectionMap.entries()]
  .map(([section, sectionTests]) => ({
    section,
    tests: sectionTests,
    totals: getStatusTotals(sectionTests),
    durationMs: sectionTests.reduce((sum, t) => sum + Number(t.duration || 0), 0),
  }))
  .sort((a, b) => {
    const rankDiff =
      statusRank(a.tests.some((t) => isFailureStatus(t.status)) ? 'failed' : 'passed') -
      statusRank(b.tests.some((t) => isFailureStatus(t.status)) ? 'failed' : 'passed');
    if (rankDiff !== 0) return rankDiff;
    return a.section.localeCompare(b.section);
  });

const blockedRatio = Number(signalTotals.blocked || 0) / Math.max(1, Number(totals.total || 0));
const failedRatio = Number(totals.failed || 0) / Math.max(1, Number(totals.total || 0));
const topSectionsByBlocked = [...sectionSummary]
  .map((section) => ({
    section: section.section,
    blocked: section.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
    total: section.totals.total,
  }))
  .filter((item) => item.blocked > 0)
  .sort((a, b) => b.blocked - a.blocked)
  .slice(0, 3);
const runIssueTopReasons = topReasons(
  tests.filter(
    (test) =>
      isFailureStatus(test.status) ||
      hasAnnotation(test, 'blocked') ||
      hasAnnotation(test, 'provider-blocked')
  ),
  3
);
const quickHighlights = [];
quickHighlights.push(
  `Run status: ${runStatus}. Failed: ${totals.failed}/${totals.total} (${formatPercent(failedRatio, 1)}).`
);
quickHighlights.push(
  `Blocked signals: ${signalTotals.blocked}/${totals.total} (${formatPercent(blockedRatio, 1)}).`
);
if (topSectionsByBlocked.length) {
  quickHighlights.push(
    `Most blocked section: ${topSectionsByBlocked[0].section} (${topSectionsByBlocked[0].blocked}/${topSectionsByBlocked[0].total}).`
  );
}
if (runIssueTopReasons.length) {
  quickHighlights.push(
    `Top issue reason: ${runIssueTopReasons[0].reason} (${runIssueTopReasons[0].count} tests).`
  );
}

const liveChatSection = sectionSummary.find((item) => item.section === 'Live Chat') || null;
const sidebarSection = sectionSummary.find((item) => item.section === 'Sidebar') || null;
const sectionDetails = sectionSummary.map((section) => {
  const ordered = sortByImportance(section.tests);
  const issueOnly = ordered.filter((test) => isIssueLikeTest(test));
  const sourceRows =
    sectionDetailRowsLimit <= 0
      ? []
      : reportCompactMode
        ? issueOnly.length
          ? issueOnly
          : ordered
        : ordered;
  const sliced = sliceWithMeta(sourceRows, sectionDetailRowsLimit);
  return {
    ...section,
    detailTests: sliced.items,
    detailOmitted: sliced.omitted,
    detailSourceCount: sourceRows.length,
    detailIssueCount: issueOnly.length,
  };
});

const orderedTests = sortByImportance(tests);
const issueTests = orderedTests.filter((test) => isIssueLikeTest(test));
const matrixSourceTests = reportCompactMode && issueTests.length > 0 ? issueTests : orderedTests;
const matrixSlice = sliceWithMeta(matrixSourceTests, testMatrixRowsLimit);
const matrixTests = matrixSlice.items;
const matrixOmitted = matrixSlice.omitted;
const matrixIssueOnlyMode = reportCompactMode && issueTests.length > 0;

const registration = readFirstJson(registrationCandidates);
const registrationData = registration.data;
const manualLoginPlayerFallback = readFirstJson([manualLoginPlayerPath]);
const manualLoginPlayerResolved = isManualLoginReadyPlayer(registrationData)
  ? {
      data: registrationData,
      path: registration.path,
    }
  : isManualLoginReadyPlayer(manualLoginPlayerFallback.data)
    ? manualLoginPlayerFallback
    : { data: null, path: null };
const manualLoginPlayerData = manualLoginPlayerResolved.data;
const manualLoginPlayerDataSource = manualLoginPlayerResolved.path || '-';
const currentManualLoginEmail = oneLine(
  (manualLoginPlayerData && manualLoginPlayerData.email) ||
    (registrationData && registrationData.email) ||
    ''
);
const currentManualLoginPassword = oneLine(
  (manualLoginPlayerData && manualLoginPlayerData.password) ||
    (registrationData && registrationData.password) ||
    ''
);
const registrationNetwork = readJson(registrationNetworkPath);
const registrationPrimaryTest =
  tests.find((testItem) => /signup-api-success\.spec\.js$/i.test(testItem.file || '')) ||
  tests.find((testItem) =>
    /sign up api: successful registration returns token and userid/i.test(
      testItem.titlePath || testItem.title || ''
    )
  ) ||
  null;
const registrationCurrentRunPaths = new Set(
  [registrationCurrentRunPath, path.join(cwd, 'test-results', 'registration-data.json')].map(
    (filePath) => path.resolve(filePath)
  )
);
const registrationDataFromCurrentRun = Boolean(
  registrationPrimaryTest &&
  registrationPrimaryTest.status === 'passed' &&
  registrationData &&
  registration.path &&
  registrationCurrentRunPaths.has(path.resolve(registration.path)) &&
  registrationData.email &&
  registrationData.password
);
const newPlayerRegisteredInRun = Boolean(
  registrationPrimaryTest &&
  registrationPrimaryTest.status === 'passed' &&
  registrationDataFromCurrentRun
);
const registrationOutcome = {
  testFound: Boolean(registrationPrimaryTest),
  newPlayerRegisteredInRun,
  testStatus: registrationPrimaryTest ? registrationPrimaryTest.status : 'not-found',
  flags: registrationPrimaryTest ? flagsMd(registrationPrimaryTest) : '-',
  note: registrationPrimaryTest
    ? noteSummary(registrationPrimaryTest)
    : 'Registration success test was not found in the collected reports.',
  playerDataAvailable: Boolean(registrationData),
  playerDataSource: registration.path || '-',
  playerDataFromCurrentRun: registrationDataFromCurrentRun,
  playerGeneratedAt:
    registrationData && registrationData.generatedAt ? registrationData.generatedAt : '-',
  playerEmail: registrationData && registrationData.email ? registrationData.email : '-',
  manualLoginReady: Boolean(registrationData && registrationData.manualLoginReady === true),
  loginValidationStatus:
    registrationData && registrationData.loginValidationStatus
      ? registrationData.loginValidationStatus
      : '-',
  loginValidationMethod:
    registrationData && registrationData.loginValidationMethod
      ? registrationData.loginValidationMethod
      : '-',
  loginValidationReason:
    registrationData && registrationData.loginValidationReason
      ? registrationData.loginValidationReason
      : '-',
  loginValidationAt:
    registrationData && registrationData.loginValidationAt
      ? registrationData.loginValidationAt
      : '-',
  manualLoginPlayerAvailable: Boolean(manualLoginPlayerData),
  manualLoginPlayerSource: manualLoginPlayerDataSource,
  manualLoginPlayerFromCurrentRun: Boolean(
    manualLoginPlayerData && registration.path && manualLoginPlayerResolved.path
      ? path.resolve(manualLoginPlayerResolved.path) === path.resolve(registration.path)
      : false
  ),
  manualLoginPlayerEmail:
    manualLoginPlayerData && manualLoginPlayerData.email ? manualLoginPlayerData.email : '-',
  manualLoginPlayerGeneratedAt:
    manualLoginPlayerData && manualLoginPlayerData.generatedAt
      ? manualLoginPlayerData.generatedAt
      : '-',
  manualLoginPlayerValidationAt:
    manualLoginPlayerData && manualLoginPlayerData.loginValidationAt
      ? manualLoginPlayerData.loginValidationAt
      : '-',
  currentManualLoginEmail: currentManualLoginEmail || '-',
  currentManualLoginPassword: currentManualLoginPassword || '-',
  sourceTest:
    (registrationData && registrationData.source) ||
    (registrationPrimaryTest &&
      (registrationPrimaryTest.titlePath || registrationPrimaryTest.title)) ||
    '-',
};
const providerMatrix = readJson(providerMatrixPath);
const providerMatrixSummary = summarizeProviderMatrix(providerMatrix);
const providerMatrixAllResults = Array.isArray(providerMatrix && providerMatrix.results)
  ? providerMatrix.results
  : [];
const providerMatrixOrderedResults = reportCompactMode
  ? [...providerMatrixAllResults].sort((a, b) => {
      const rank = (item) => {
        const status = String(item && item.status ? item.status : '').toLowerCase();
        if (status === 'failed') return 0;
        if (status === 'blocked') return 1;
        if (status === 'passed') return 2;
        return 3;
      };
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return String(a.provider || '').localeCompare(String(b.provider || ''));
    })
  : providerMatrixAllResults;
const providerMatrixSlice = sliceWithMeta(providerMatrixOrderedResults, providerMatrixRowsLimit);
const providerMatrixResults = providerMatrixSlice.items;
const providerMatrixOmitted = providerMatrixSlice.omitted;
const depositInventoryArtifact = readJson(depositInventoryArtifactPath);
const depositInventorySummary = summarizeDepositInventory(depositInventoryArtifact);
const depositArtifact = readJson(depositArtifactPath);
const depositSummary = summarizeDepositArtifact(depositArtifact);
const depositInventoryCoverageBlocked = Boolean(
  depositInventoryArtifact && depositInventoryArtifact.blocked
);
const depositMethodCoverageBlocked = Boolean(depositArtifact && depositArtifact.blocked);
const depositInventoryCoverageReason = blockedReasonText(
  (depositInventoryArtifact && depositInventoryArtifact.reason) || ''
);
const depositMethodCoverageReason = blockedReasonText(
  (depositArtifact && depositArtifact.reason) || ''
);
const depositInventoryRowsMd = depositInventorySummary.apiGrouped.length
  ? depositInventorySummary.apiGrouped.map(
      (entry) =>
        `| ${escapeMdCell(entry.category)} | ${escapeMdCell(
          (entry.methods || []).map((method) => method.name).join(', ') || '-'
        )} |`
    )
  : [
      `| - | ${escapeMdCell(
        depositInventoryCoverageBlocked ? `Blocked: ${depositInventoryCoverageReason}` : '-'
      )} |`,
    ];
const depositFallbackRowsMd = depositInventorySummary.apiFallbackAttempts.length
  ? depositInventorySummary.apiFallbackAttempts.map(
      (attempt) =>
        `| ${escapeMdCell(attempt.currency || '-')} | ${escapeMdCell(
          attempt.status || '-'
        )} | ${escapeMdCell(attempt.itemsCount || 0)} | ${escapeMdCell(
          truncateText(
            normalizeReason(attempt.error || attempt.bodyPreview || '-'),
            NOTE_TEXT_LIMIT
          )
        )} |`
    )
  : ['| - | - | - | - |'];
const depositMethodRowsMd = depositSummary.results.length
  ? depositSummary.results.map((item) => {
      const surface = item.surface || {};
      const note =
        item.challenge ||
        item.clickError ||
        (surface.unavailableMessageVisible ? 'Method unavailable' : '-');
      return `| ${escapeMdCell(item.method)} | ${item.selected ? 'yes' : 'no'} | ${
        item.surfaceReady ? 'yes' : 'no'
      } | ${surface.submitVisible ? 'yes' : 'no'} | ${surface.amountInputVisible ? 'yes' : 'no'} | ${
        surface.changeMethodVisible ? 'yes' : 'no'
      } | ${escapeMdCell(normalizeReason(note) || '-')} |`;
    })
  : [
      `| - | - | - | - | - | - | ${escapeMdCell(
        depositMethodCoverageBlocked ? `Blocked: ${depositMethodCoverageReason}` : '-'
      )} |`,
    ];
const authStateHealthEntriesMd =
  authStateHealth && Array.isArray(authStateHealth.entries) && authStateHealth.entries.length
    ? authStateHealth.entries.map(
        (entry) =>
          `| ${escapeMdCell(entry.path ? toRelative(entry.path) : '-')} | ${yesNo(entry.exists)} | ${yesNo(
            entry.fresh
          )} | ${escapeMdCell(entry.ageSec == null ? '-' : `${entry.ageSec}s`)} | ${escapeMdCell(
            `${Number(entry.cookiesCount || 0)}/${Number(entry.originsCount || 0)}`
          )} | ${yesNo(entry.hasSessionArtifacts)} | ${escapeMdCell(oneLine(entry.parseError || '-') || '-')} |`
      )
    : ['| - | - | - | - | - | - | - |'];
const authStateHealthMd = authStateHealth
  ? [
      '## Auth State Health',
      '',
      renderSectionIntroMd('Auth State Health').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Checked At | ${escapeMdCell(authStateHealth.checkedAt || '-')} |`,
      `| Phase | ${escapeMdCell(authStateHealth.phase || '-')} |`,
      `| Max Age | ${escapeMdCell(authStateHealth.maxAgeSec ? `${authStateHealth.maxAgeSec}s` : '-')} |`,
      `| Selected Path | ${escapeMdCell(
        authStateHealth.selectedPath ? toRelative(authStateHealth.selectedPath) : '-'
      )} |`,
      `| Selected Modified At | ${escapeMdCell(authStateHealth.selectedModifiedAt || '-')} |`,
      `| Selected Age | ${escapeMdCell(
        authStateHealth.selectedAgeSec == null ? '-' : `${authStateHealth.selectedAgeSec}s`
      )} |`,
      `| Selected Fresh | ${yesNo(authStateHealth.selectedFresh)} |`,
      `| Selected Session Artifacts | ${yesNo(authStateHealth.selectedHasSessionArtifacts)} |`,
      `| Selected Cookies/Origins | ${escapeMdCell(
        `${Number(authStateHealth.selectedCookiesCount || 0)}/${Number(
          authStateHealth.selectedOriginsCount || 0
        )}`
      )} |`,
      `| Refresh Triggered | ${yesNo(authStateHealth.refreshTriggered)} |`,
      `| Refresh Reason | ${escapeMdCell(oneLine(authStateHealth.refreshReason || '-') || '-')} |`,
      `| Healthy | ${yesNo(authStateHealth.healthy)} |`,
      '',
      '| Candidate Path | Exists | Fresh | Age | Cookies/Origins | Session Artifacts | Parse Error |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...authStateHealthEntriesMd,
      '',
    ].join('\n')
  : '';
const kpiChecks = Array.isArray(kpiValidation && kpiValidation.checks) ? kpiValidation.checks : [];
const kpiFailedChecks = Array.isArray(kpiValidation && kpiValidation.failedChecks)
  ? kpiValidation.failedChecks
  : [];
const kpiRowsMd = kpiChecks.length
  ? kpiChecks.map(
      (item) =>
        `| ${escapeMdCell(item.label || item.id || '-')} | ${yesNo(item.applicable !== false)} | ${yesNo(
          item.passed
        )} | ${escapeMdCell(item.actual)} | ${escapeMdCell(item.threshold)} | ${escapeMdCell(
          oneLine(item.detail || '-') || '-'
        )} |`
    )
  : ['| - | - | - | - | - | - |'];
const kpiValidationMd = kpiValidation
  ? [
      '## Run KPI Validation',
      '',
      renderSectionIntroMd('Run KPI Validation').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Generated At | ${escapeMdCell(kpiValidation.generatedAt || '-')} |`,
      `| Valid | ${yesNo(kpiValidation.valid)} |`,
      `| Failed Checks | ${kpiFailedChecks.length} |`,
      `| Blocked Ratio | ${escapeMdCell(
        formatPercent(
          Number((kpiValidation.totals && kpiValidation.totals.blockedSignals) || 0) /
            Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
        )
      )} |`,
      `| Infra Blocked Ratio | ${escapeMdCell(
        formatPercent(
          Number((kpiValidation.totals && kpiValidation.totals.infraBlockedSignals) || 0) /
            Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
        )
      )} |`,
      '',
      '| Check | Applicable | Passed | Actual | Threshold | Detail |',
      '| --- | --- | --- | --- | --- | --- |',
      ...kpiRowsMd,
      '',
    ].join('\n')
  : '';
const mobileTopReasonRowsMd = mobileTopReasons.length
  ? mobileTopReasons.map(
      (entry) =>
        `| ${escapeMdCell(entry.reason)} | ${Number(entry.count || 0)} | ${escapeMdCell(
          formatPercent(Number(entry.count || 0) / mobileTopReasonsTotal, 1)
        )} |`
    )
  : ['| - | 0 | 0.0% |'];
const mobileStabilityMd = showMobileStability
  ? [
      '## Mobile Stability',
      '',
      renderSectionIntroMd('Mobile Stability').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Execution Mode | ${escapeMdCell(executionMode || '-')} |`,
      `| Mobile Tests | ${mobileTotals.total} |`,
      `| Mobile Passed | ${mobileTotals.passed} |`,
      `| Mobile Failed | ${mobileTotals.failed} |`,
      `| Mobile Timed Out | ${mobileTimedOutCount} |`,
      `| Mobile Blocked Signals | ${mobileBlockedCount} |`,
      `| Mobile Infra Blocked | ${mobileInfraBlockedCount} |`,
      `| Mobile Provider Blocked | ${mobileProviderBlockedCount} |`,
      '',
      '| Top Reason | Count | Share |',
      '| --- | --- | --- |',
      ...mobileTopReasonRowsMd,
      '',
    ].join('\n')
  : '';
const registrationOutcomeMd = [
  '## Registration Outcome',
  '',
  renderSectionIntroMd('Registration Outcome').trim(),
  '',
  '| Field | Value |',
  '| --- | --- |',
  `| Registration Test Present | ${yesNo(registrationOutcome.testFound)} |`,
  `| New Player Registered In This Run | ${yesNo(registrationOutcome.newPlayerRegisteredInRun)} |`,
  `| Registration Test Status | ${escapeMdCell(registrationOutcome.testStatus)} |`,
  `| Registration Test Flags | ${escapeMdCell(registrationOutcome.flags)} |`,
  `| Registration Test Note | ${escapeMdCell(registrationOutcome.note)} |`,
  `| Registered Player Data Available | ${yesNo(registrationOutcome.playerDataAvailable)} |`,
  `| Registered Player Data Source | ${escapeMdCell(registrationOutcome.playerDataSource)} |`,
  `| Registered Player Belongs To Current Run | ${yesNo(registrationOutcome.playerDataFromCurrentRun)} |`,
  `| Registered Player Generated At | ${escapeMdCell(registrationOutcome.playerGeneratedAt)} |`,
  `| Registered Player Email | ${escapeMdCell(registrationOutcome.playerEmail)} |`,
  `| Manual Password Login Ready | ${yesNo(registrationOutcome.manualLoginReady)} |`,
  `| Login Validation Status | ${escapeMdCell(registrationOutcome.loginValidationStatus)} |`,
  `| Login Validation Method | ${escapeMdCell(registrationOutcome.loginValidationMethod)} |`,
  `| Login Validation Reason | ${escapeMdCell(registrationOutcome.loginValidationReason)} |`,
  `| Login Validation At | ${escapeMdCell(registrationOutcome.loginValidationAt)} |`,
  `| Manual Login Player Available | ${yesNo(registrationOutcome.manualLoginPlayerAvailable)} |`,
  `| Manual Login Player Source | ${escapeMdCell(registrationOutcome.manualLoginPlayerSource)} |`,
  `| Manual Login Player From Current Run | ${yesNo(
    registrationOutcome.manualLoginPlayerFromCurrentRun
  )} |`,
  `| Manual Login Player Email | ${escapeMdCell(registrationOutcome.manualLoginPlayerEmail)} |`,
  `| Manual Login Player Generated At | ${escapeMdCell(
    registrationOutcome.manualLoginPlayerGeneratedAt
  )} |`,
  `| Manual Login Player Validation At | ${escapeMdCell(
    registrationOutcome.manualLoginPlayerValidationAt
  )} |`,
  `| Current Manual Login Email | ${escapeMdCell(registrationOutcome.currentManualLoginEmail)} |`,
  `| Current Manual Login Password | ${escapeMdCell(
    registrationOutcome.currentManualLoginPassword
  )} |`,
  `| Source Test | ${escapeMdCell(registrationOutcome.sourceTest)} |`,
  '',
].join('\n');
const registrationPlayerMd = (() => {
  const primaryEmail =
    registrationOutcome.currentManualLoginEmail ||
    registrationOutcome.manualLoginPlayerEmail ||
    registrationOutcome.playerEmail ||
    '-';
  const primaryPassword =
    registrationOutcome.currentManualLoginPassword ||
    (manualLoginPlayerData &&
      (manualLoginPlayerData.password || manualLoginPlayerData.passwordMasked)) ||
    (registrationData && (registrationData.password || registrationData.passwordMasked)) ||
    '-';
  const sourcePath = formatPathForDisplay(registration.path || manualLoginPlayerDataSource || '-');

  return [
    '## Registration & Player',
    '',
    renderSectionIntroMd('Registration & Player').trim(),
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Registration Test Present | ${yesNo(registrationOutcome.testFound)} |`,
    `| Registration Test Status | ${escapeMdCell(registrationOutcome.testStatus)} |`,
    `| New Player Registered In This Run | ${yesNo(registrationOutcome.newPlayerRegisteredInRun)} |`,
    `| Player Data Belongs To Current Run | ${yesNo(registrationOutcome.playerDataFromCurrentRun)} |`,
    `| Manual Password Login Ready | ${yesNo(registrationOutcome.manualLoginReady)} |`,
    `| Login Validation Status | ${escapeMdCell(registrationOutcome.loginValidationStatus)} |`,
    `| Login Validation At | ${escapeMdCell(registrationOutcome.loginValidationAt)} |`,
    `| Manual Login Player Available | ${yesNo(registrationOutcome.manualLoginPlayerAvailable)} |`,
    `| Email For Manual Login | ${escapeMdCell(primaryEmail)} |`,
    `| Password For Manual Login | ${escapeMdCell(primaryPassword)} |`,
    `| Player Generated At | ${escapeMdCell(registrationOutcome.playerGeneratedAt)} |`,
    `| Data Source | ${escapeMdCell(sourcePath)} |`,
    `| Source Test | ${escapeMdCell(registrationOutcome.sourceTest)} |`,
    '',
  ].join('\n');
})();
const providerMatrixMd =
  providerMatrixAllResults.length || providerMatrix
    ? [
        '## Casino Providers Matrix',
        '',
        renderSectionIntroMd('Casino Providers Matrix').trim(),
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Target Providers Declared | ${providerMatrixSummary.targetDeclared} |`,
        `| Provider Results Captured | ${providerMatrixSummary.resultsCaptured} |`,
        `| Providers Discovered On Brand | ${providerMatrixSummary.providersDiscovered || '-'} |`,
        `| Passed | ${providerMatrixSummary.passed} |`,
        `| Passed Strong | ${providerMatrixSummary.passedStrong} |`,
        `| Passed Weak Surface | ${providerMatrixSummary.passedWeakSurface} |`,
        `| Failed | ${providerMatrixSummary.failed} |`,
        `| Blocked | ${providerMatrixSummary.blocked} |`,
        `| Provider Absent | ${providerMatrixSummary.blockedProviderAbsent} |`,
        `| Provider Launch Blocked | ${providerMatrixSummary.blockedProviderLaunch} |`,
        `| Blocked Other | ${providerMatrixSummary.blockedOther} |`,
        `| Retried and Recovered | ${providerMatrixSummary.retriedRecovered} |`,
        `| Rows In Report | ${providerMatrixResults.length} |`,
        `| Omitted Rows | ${providerMatrixOmitted} |`,
        '',
        '| Provider | Status | Outcome | Launch | Surface | Controls | Note |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...providerMatrixResults.map(
          (item) =>
            `| ${escapeMdCell(item.provider)} | ${escapeMdCell(item.status)} | ${escapeMdCell(
              item.outcome || '-'
            )} | ${escapeMdCell(item.launchState || '-')} | ${escapeMdCell(
              item.gameSurface || '-'
            )} | ${escapeMdCell(item.controlsClicked || 0)} | ${escapeMdCell(
              normalizeReason(item.reason || '-') || '-'
            )} |`
        ),
        ...(providerMatrixOmitted > 0
          ? [
              `| ... | ... | ... | ... | ... | ... | ${escapeMdCell(
                `Omitted ${providerMatrixOmitted} provider rows in compact report.`
              )} |`,
            ]
          : []),
        '',
      ].join('\n')
    : `## Casino Providers Matrix\n\n${renderSectionIntroMd('Casino Providers Matrix')}Provider matrix artifact not found.\n\n`;
const depositMd =
  depositArtifact || depositInventoryArtifact
    ? [
        '## Deposit Inventory',
        '',
        renderSectionIntroMd('Deposit Inventory').trim(),
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Coverage State | ${depositInventoryCoverageBlocked ? 'blocked' : 'ready'} |`,
        `| Blocked Reason | ${escapeMdCell(
          depositInventoryCoverageBlocked ? depositInventoryCoverageReason : '-'
        )} |`,
        `| API Pay Systems | ${blockedAwareCount(
          depositInventorySummary.apiItemsCount,
          depositInventoryCoverageBlocked
        )} |`,
        `| API Categories | ${blockedAwareCount(
          depositInventorySummary.apiCategories.length,
          depositInventoryCoverageBlocked
        )} |`,
        `| UI Coverage Available | ${blockedAwareBool(
          depositInventorySummary.uiCoverageAvailable,
          depositInventoryCoverageBlocked
        )} |`,
        `| API Coverage Available | ${blockedAwareBool(
          depositInventorySummary.apiCoverageAvailable,
          depositInventoryCoverageBlocked
        )} |`,
        `| Coverage Source Mode | ${escapeMdCell(
          depositInventoryCoverageBlocked
            ? 'N/A (blocked)'
            : depositInventorySummary.sourceMode || '-'
        )} |`,
        `| UI Category Tiles | ${blockedAwareCount(
          depositInventorySummary.uiTilesCount,
          depositInventoryCoverageBlocked
        )} |`,
        `| UI Unique Categories | ${blockedAwareCount(
          depositInventorySummary.uiCategories.length,
          depositInventoryCoverageBlocked
        )} |`,
        `| API Fallback Attempts | ${depositInventorySummary.apiFallbackAttempts.length} |`,
        `| API Fallback Resolved | ${yesNo(depositInventorySummary.apiFallbackResolved)} |`,
        `| API Fallback Best Currency | ${escapeMdCell(
          depositInventorySummary.apiFallbackBestCurrency || '-'
        )} |`,
        `| API Fallback Best Status | ${escapeMdCell(
          depositInventorySummary.apiFallbackBestStatus || '-'
        )} |`,
        `| Unexpected UI Categories | ${escapeMdCell(
          blockedAwareList(
            depositInventorySummary.unexpectedUiCategories,
            depositInventoryCoverageBlocked
          )
        )} |`,
        `| Missing UI Categories | ${escapeMdCell(
          blockedAwareList(
            depositInventorySummary.missingUiCategories,
            depositInventoryCoverageBlocked
          )
        )} |`,
        '',
        '| Category | API Methods |',
        '| --- | --- |',
        ...depositInventoryRowsMd,
        '',
        '| Fallback Currency | HTTP Status | Items | Error / Body Preview |',
        '| --- | --- | --- | --- |',
        ...depositFallbackRowsMd,
        '',
        '## Deposit Method Coverage',
        '',
        renderSectionIntroMd('Deposit Method Coverage').trim(),
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Coverage State | ${depositMethodCoverageBlocked ? 'blocked' : 'ready'} |`,
        `| Blocked Reason | ${escapeMdCell(
          depositMethodCoverageBlocked ? depositMethodCoverageReason : '-'
        )} |`,
        `| Methods Discovered | ${blockedAwareCount(
          depositSummary.discoveredCount,
          depositMethodCoverageBlocked
        )} |`,
        `| Methods Checked | ${blockedAwareCount(
          depositSummary.checkedCount,
          depositMethodCoverageBlocked
        )} |`,
        `| UI Coverage Available | ${blockedAwareBool(
          depositSummary.uiCoverageAvailable,
          depositMethodCoverageBlocked
        )} |`,
        `| API Coverage Available | ${blockedAwareBool(
          depositSummary.apiCoverageAvailable,
          depositMethodCoverageBlocked
        )} |`,
        `| Coverage Source Mode | ${escapeMdCell(
          depositMethodCoverageBlocked ? 'N/A (blocked)' : depositSummary.sourceMode || '-'
        )} |`,
        `| Methods Ready | ${blockedAwareCount(depositSummary.readyCount, depositMethodCoverageBlocked)} |`,
        `| Partial Coverage | ${blockedAwareBool(
          depositSummary.partialCoverage,
          depositMethodCoverageBlocked
        )} |`,
        `| Submit Visible | ${blockedAwareBool(
          depositSummary.submitVisible,
          depositMethodCoverageBlocked
        )} |`,
        `| Submit Enabled | ${blockedAwareBool(
          depositSummary.submitEnabled,
          depositMethodCoverageBlocked
        )} |`,
        '',
        '| Method | Selected | Surface Ready | Submit | Amount | Change Method | Note |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...depositMethodRowsMd,
        '',
      ].join('\n')
    : `## Deposit Method Coverage\n\n${renderSectionIntroMd('Deposit Method Coverage')}Deposit artifact not found.\n\n`;
const depositCoverageMd = (() => {
  const inventoryBlocked = depositInventoryCoverageBlocked;
  const methodsBlocked = depositMethodCoverageBlocked;
  const overallState =
    inventoryBlocked && methodsBlocked
      ? 'blocked'
      : inventoryBlocked || methodsBlocked
        ? 'partial'
        : 'ready';
  const reasons = [
    inventoryBlocked ? `Inventory: ${depositInventoryCoverageReason}` : '',
    methodsBlocked ? `Methods: ${depositMethodCoverageReason}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const apiCategoriesPreview = depositInventorySummary.apiCategories.slice(0, 8);
  const uiCategoriesPreview = depositInventorySummary.uiCategories.slice(0, 8);
  const readyMethodsPreview = depositSummary.results
    .filter((item) => item.surfaceReady)
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const checkedMethodsPreview = depositSummary.results
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);

  return [
    '## Deposit Coverage',
    '',
    renderSectionIntroMd('Deposit Coverage').trim(),
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Coverage State | ${overallState} |`,
    `| Inventory Blocked | ${yesNo(inventoryBlocked)} |`,
    `| Methods Blocked | ${yesNo(methodsBlocked)} |`,
    `| Blocked Reason | ${escapeMdCell(reasons || '-')} |`,
    `| API Coverage Available | ${blockedAwareBool(depositInventorySummary.apiCoverageAvailable, inventoryBlocked)} |`,
    `| UI Coverage Available | ${blockedAwareBool(depositInventorySummary.uiCoverageAvailable, inventoryBlocked)} |`,
    `| API Categories | ${blockedAwareCount(depositInventorySummary.apiCategories.length, inventoryBlocked)} |`,
    `| UI Categories | ${blockedAwareCount(depositInventorySummary.uiCategories.length, inventoryBlocked)} |`,
    `| Methods Discovered | ${blockedAwareCount(depositSummary.discoveredCount, methodsBlocked)} |`,
    `| Methods Checked | ${blockedAwareCount(depositSummary.checkedCount, methodsBlocked)} |`,
    `| Methods Ready | ${blockedAwareCount(depositSummary.readyCount, methodsBlocked)} |`,
    `| Submit Visible | ${blockedAwareBool(depositSummary.submitVisible, methodsBlocked)} |`,
    `| Submit Enabled | ${blockedAwareBool(depositSummary.submitEnabled, methodsBlocked)} |`,
    `| API Categories (preview) | ${escapeMdCell(blockedAwareList(apiCategoriesPreview, inventoryBlocked))} |`,
    `| UI Categories (preview) | ${escapeMdCell(blockedAwareList(uiCategoriesPreview, inventoryBlocked))} |`,
    `| Ready Methods (preview) | ${escapeMdCell(blockedAwareList(readyMethodsPreview, methodsBlocked))} |`,
    `| Checked Methods (preview) | ${escapeMdCell(blockedAwareList(checkedMethodsPreview, methodsBlocked))} |`,
    '',
  ].join('\n');
})();
const liveChatMd = liveChatSection
  ? [
      '## Live Chat',
      '',
      renderSectionIntroMd('Live Chat').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Total | ${liveChatSection.totals.total} |`,
      `| Passed | ${liveChatSection.totals.passed} |`,
      `| Failed | ${liveChatSection.totals.failed} |`,
      `| Skipped | ${liveChatSection.totals.skipped} |`,
      `| Blocked | ${liveChatSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length} |`,
      `| Duration | ${formatDuration(liveChatSection.durationMs)} |`,
      '',
      '| Status | Flags | Test | Location | Duration | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...liveChatSection.tests.map((t) => {
        const locStr = formatLocation(t);
        return `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
          t.titlePath || t.title
        )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
          noteSummary(t)
        )} |`;
      }),
      '',
    ].join('\n')
  : `## Live Chat\n\n${renderSectionIntroMd('Live Chat')}No live chat tests were present in the collected reports.\n\n`;
const sidebarMd = sidebarSection
  ? [
      '## Sidebar',
      '',
      renderSectionIntroMd('Sidebar').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Total | ${sidebarSection.totals.total} |`,
      `| Passed | ${sidebarSection.totals.passed} |`,
      `| Failed | ${sidebarSection.totals.failed} |`,
      `| Skipped | ${sidebarSection.totals.skipped} |`,
      `| Blocked | ${sidebarSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length} |`,
      `| Duration | ${formatDuration(sidebarSection.durationMs)} |`,
      '',
      '| Status | Flags | Test | Location | Duration | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sidebarSection.tests.map((t) => {
        const locStr = formatLocation(t);
        return `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
          t.titlePath || t.title
        )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
          noteSummary(t)
        )} |`;
      }),
      '',
    ].join('\n')
  : `## Sidebar\n\n${renderSectionIntroMd('Sidebar')}No sidebar tests were present in the collected reports.\n\n`;

let md = `# QA Report - ${brandName}\n\n`;
md += `Generated: ${generatedAt}\n\n`;
md += `Brand: ${brandName}\n\n`;
md += `Run status: **${runStatus}**\n\n`;
if (includeReportGuide) {
  md += renderReportGuideMd();
  md += '\n';
}
md += '## Highlights\n\n';
md += renderSectionIntroMd('Highlights');
if (quickHighlights.length) {
  for (const item of quickHighlights) {
    md += `- ${item}\n`;
  }
} else {
  md += '- No run highlights available.\n';
}
md += '\n';
md += '## Summary\n\n';
md += renderSectionIntroMd('Summary');
md += '| Metric | Value |\n';
md += '| --- | --- |\n';
md += `| Total | ${totals.total} |\n`;
md += `| Passed | ${totals.passed} |\n`;
md += `| Failed | ${totals.failed} |\n`;
md += `| Skipped | ${totals.skipped} |\n`;
md += `| Flaky | ${totals.flaky} |\n`;
md += `| Blocked Signals | ${signalTotals.blocked} |\n`;
md += `| Blocked Ratio | ${formatPercent(blockedRatio, 1)} |\n`;
md += `| Failed Ratio | ${formatPercent(failedRatio, 1)} |\n`;
md += `| Infra Blocked Signals | ${signalTotals.infraBlocked} |\n`;
md += `| Product Blocked Signals | ${signalTotals.productBlocked} |\n`;
md += `| N/A Signals | ${signalTotals.notApplicable} |\n`;
md += `| Partial Coverage Signals | ${signalTotals.partial} |\n`;
md += `| Retried Signals | ${signalTotals.retried} |\n`;
md += `| Weak Surface Signals | ${signalTotals.weakSurface} |\n`;
md += `| Provider Absent Signals | ${signalTotals.providerAbsent} |\n`;
md += `| KPI Valid | ${kpiValidation ? yesNo(kpiValidation.valid) : 'N/A'} |\n`;
md += `| KPI Failed Checks | ${
  kpiValidation && Array.isArray(kpiValidation.failedChecks)
    ? kpiValidation.failedChecks.length
    : 'N/A'
} |\n`;
md += `| New Player Registered In This Run | ${yesNo(registrationOutcome.newPlayerRegisteredInRun)} |\n`;
md += `| Manual Login Player Available | ${yesNo(registrationOutcome.manualLoginPlayerAvailable)} |\n`;
md += `| Report Compact Mode | ${yesNo(reportCompactMode)} |\n`;
md += `| Duration | ${formatDuration(durationMs)} |\n\n`;

if (mobileStabilityMd) {
  md += mobileStabilityMd;
  md += '\n';
}

md += '## Sections\n\n';
md += renderSectionIntroMd('Sections');
md += '| Section | Total | Passed | Failed | Skipped | Blocked | Partial | Duration |\n';
md += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
for (const section of sectionSummary) {
  const blockedCount = section.tests.filter((test) => hasAnnotation(test, 'blocked')).length;
  const partialCount = section.tests.filter(
    (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
  ).length;
  md += `| ${escapeMdCell(section.section)} | ${section.totals.total} | ${section.totals.passed} | ${
    section.totals.failed
  } | ${section.totals.skipped} | ${blockedCount} | ${partialCount} | ${escapeMdCell(
    formatDuration(section.durationMs)
  )} |\n`;
}
md += '\n';

if (sectionDetailRowsLimit <= 0) {
  md += '### Section Details\n\n';
  md += 'Detailed section rows are omitted in compact mode.\n\n';
} else {
  for (const section of sectionDetails) {
    md += `### ${section.section}\n\n`;
    md += renderSectionIntroMd(section.section);
    md += '| Status | Flags | Test | Location | Duration | Note |\n';
    md += '| --- | --- | --- | --- | --- | --- |\n';
    for (const t of section.detailTests) {
      const locStr = formatLocation(t);
      md += `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
        t.titlePath || t.title
      )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
        noteSummary(t)
      )} |\n`;
    }
    if (section.detailOmitted > 0) {
      md += `| - | - | _Omitted rows_ | - | - | ${escapeMdCell(
        `Showing ${section.detailTests.length} of ${section.detailSourceCount}; omitted ${section.detailOmitted}.`
      )} |\n`;
    }
    md += '\n';
  }
}

md += registrationPlayerMd;
md += providerMatrixMd;
md += depositCoverageMd;
if (authStateHealthMd) md += authStateHealthMd;
if (kpiValidationMd) md += kpiValidationMd;
md += sidebarMd;
md += liveChatMd;

if (failed.length) {
  md += '## Failed Tests\n\n';
  md += renderSectionIntroMd('Failed Tests');
  let idx = 1;
  for (const t of failed) {
    const locStr = formatLocation(t);
    md += `### ${idx}. ${t.titlePath || t.title}\n\n`;
    md += `- Phase: ${t.phase}\n`;
    md += `- Status: ${t.status}\n`;
    md += `- Location: ${locStr}\n`;
    md += `- Duration: ${formatDuration(t.duration)}\n`;
    md += `- Error: ${oneLine(t.error) || '-'}\n`;
    md += `- Flags: ${flagsMd(t)}\n`;
    md += `- Attachments: ${attachmentLinksMd(t.attachments)}\n\n`;
    idx += 1;
  }
}

if (registrationNetwork) {
  const responseErrors = Array.isArray(registrationNetwork.responseErrors)
    ? registrationNetwork.responseErrors
    : [];
  const failedRequests = Array.isArray(registrationNetwork.failedRequests)
    ? registrationNetwork.failedRequests
    : [];
  const consoleErrors = Array.isArray(registrationNetwork.consoleErrors)
    ? registrationNetwork.consoleErrors
    : [];
  const toastErrors = Array.isArray(registrationNetwork.toastErrors)
    ? registrationNetwork.toastErrors
    : [];
  const authResponses = Array.isArray(registrationNetwork.authResponses)
    ? registrationNetwork.authResponses
    : [];

  md += '## Registration Diagnostics\n\n';

  if (responseErrors.length) {
    md += '### API Errors\n\n';
    for (const err of responseErrors) {
      const req = `${err.method || ''} ${err.url || ''}`.trim();
      const status = `${err.status || ''} ${err.statusText || ''}`.trim();
      md += `- ${req} (${status})${err.body ? ` -> ${oneLine(err.body).slice(0, 200)}` : ''}\n`;
    }
    md += '\n';
  }

  if (failedRequests.length) {
    md += '### Failed Requests\n\n';
    for (const req of failedRequests) {
      md += `- ${(req.method || '').trim()} ${(req.url || '').trim()} ${oneLine(req.errorText || '')}\n`;
    }
    md += '\n';
  }

  if (consoleErrors.length) {
    md += '### Console Errors\n\n';
    for (const message of consoleErrors) {
      md += `- ${oneLine(message)}\n`;
    }
    md += '\n';
  }

  if (toastErrors.length) {
    md += '### Toast Errors\n\n';
    for (const message of toastErrors) {
      md += `- ${oneLine(message)}\n`;
    }
    md += '\n';
  }

  if (authResponses.length) {
    md += '### Auth Responses\n\n';
    for (const response of authResponses) {
      const req = `${response.method || ''} ${response.url || ''}`.trim();
      const status = `${response.status || ''} ${response.statusText || ''}`.trim();
      md += `- ${req} (${status})${response.body ? ` -> ${oneLine(response.body).slice(0, 200)}` : ''}\n`;
    }
    md += '\n';
  }
}

if (registrationNetwork) {
  md = md.replace(
    '## Registration Diagnostics\n\n',
    `## Registration Diagnostics\n\n${renderSectionIntroMd('Registration Diagnostics')}`
  );
}

const summaryCardsHtml = [
  { label: 'Run Status', value: runStatus },
  { label: 'KPI Valid', value: kpiValidation ? yesNo(kpiValidation.valid) : 'N/A' },
  { label: 'Total', value: totals.total },
  { label: 'Passed', value: totals.passed },
  { label: 'Failed', value: totals.failed },
  { label: 'Skipped', value: totals.skipped },
  { label: 'Flaky', value: totals.flaky },
  { label: 'Blocked Signals', value: signalTotals.blocked },
  { label: 'Blocked Ratio', value: formatPercent(blockedRatio, 1) },
  { label: 'Failed Ratio', value: formatPercent(failedRatio, 1) },
  { label: 'Infra Blocked', value: signalTotals.infraBlocked },
  { label: 'Product Blocked', value: signalTotals.productBlocked },
  { label: 'N/A Signals', value: signalTotals.notApplicable },
  { label: 'Partial Signals', value: signalTotals.partial },
  { label: 'Retried Signals', value: signalTotals.retried },
  { label: 'New Player Registered', value: yesNo(registrationOutcome.newPlayerRegisteredInRun) },
  { label: 'Manual Login Player', value: yesNo(registrationOutcome.manualLoginPlayerAvailable) },
  { label: 'Compact Mode', value: yesNo(reportCompactMode) },
  { label: 'Duration', value: formatDuration(durationMs) },
  { label: 'Phases', value: phaseSummary.length },
]
  .map(
    (item) =>
      `<article class="card"><div class="label">${escapeHtml(item.label)}</div><div class="value">${escapeHtml(item.value)}</div></article>`
  )
  .join('');
const highlightsHtml = quickHighlights.length
  ? `<ul class="highlights-list">${quickHighlights
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('')}</ul>`
  : '<p class="muted">No run highlights available.</p>';
const reportTocItems = [
  { href: '#highlights', label: 'Highlights' },
  { href: '#summary', label: 'Summary' },
  { href: '#mobile-stability', label: 'Mobile Stability' },
  { href: '#sections', label: 'Sections' },
  { href: '#registration-player', label: 'Registration & Player' },
  { href: '#casino-providers-matrix', label: 'Providers' },
  { href: '#deposit-coverage', label: 'Deposit Coverage' },
  { href: '#auth-state-health', label: 'Auth State' },
  { href: '#run-kpi-validation', label: 'KPI Validation' },
  { href: '#sidebar', label: 'Sidebar' },
  { href: '#live-chat', label: 'Live Chat' },
  { href: '#failed-tests', label: 'Failed Tests' },
  { href: '#registration-diagnostics', label: 'Registration Diagnostics' },
];
const reportTocHtml = `
  <nav class="toc" aria-label="Report sections">
    ${reportTocItems
      .map(
        (item) =>
          `<a class="toc-link" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
      )
      .join('')}
  </nav>
`;
const mobileReasonRowsHtml = mobileTopReasons.length
  ? mobileTopReasons
      .map(
        (entry) => `
          <tr>
            <td>${escapeHtml(entry.reason)}</td>
            <td>${Number(entry.count || 0)}</td>
            <td>${escapeHtml(
              formatPercent(Number(entry.count || 0) / mobileTopReasonsTotal, 1)
            )}</td>
          </tr>
        `
      )
      .join('')
  : '<tr><td class="muted">-</td><td>0</td><td>0.0%</td></tr>';
const mobileStabilityHtml = showMobileStability
  ? `
      <section id="mobile-stability">
        <h2>Mobile Stability</h2>
        ${renderSectionIntroHtml('Mobile Stability')}
        <div class="summary-grid">
          ${[
            { label: 'Execution Mode', value: executionMode || '-' },
            { label: 'Mobile Tests', value: mobileTotals.total },
            { label: 'Mobile Passed', value: mobileTotals.passed },
            { label: 'Mobile Failed', value: mobileTotals.failed },
            { label: 'Mobile Timed Out', value: mobileTimedOutCount },
            { label: 'Mobile Blocked', value: mobileBlockedCount },
            { label: 'Mobile Infra Blocked', value: mobileInfraBlockedCount },
            { label: 'Mobile Provider Blocked', value: mobileProviderBlockedCount },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Top Reason</th>
              <th>Count</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            ${mobileReasonRowsHtml}
          </tbody>
        </table>
      </section>
    `
  : '';

const phaseRowsHtml = phaseSummary
  .map(
    (phase) => `
      <tr>
        <td>${escapeHtml(phase.phase)}</td>
        <td>${phase.totals.total}</td>
        <td>${phase.totals.passed}</td>
        <td>${phase.totals.failed}</td>
        <td>${phase.totals.skipped}</td>
        <td>${phase.totals.flaky}</td>
        <td>${escapeHtml(formatDuration(phase.durationMs))}</td>
        <td><code>${escapeHtml(formatPathForDisplay(phase.sourcePath))}</code></td>
      </tr>
    `
  )
  .join('');

const sectionRowsHtml = sectionSummary
  .map(
    (section) => `
      <tr>
        <td>${escapeHtml(section.section)}</td>
        <td>${section.totals.total}</td>
        <td>${section.totals.passed}</td>
        <td>${section.totals.failed}</td>
        <td>${section.totals.skipped}</td>
        <td>${section.tests.filter((test) => hasAnnotation(test, 'blocked')).length}</td>
        <td>${
          section.tests.filter(
            (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
          ).length
        }</td>
        <td>${escapeHtml(formatDuration(section.durationMs))}</td>
      </tr>
    `
  )
  .join('');

const sectionBlocksHtml =
  sectionDetailRowsLimit <= 0
    ? `
      <section>
        <h3>Section Details</h3>
        <p class="muted">Detailed section rows are omitted in compact mode.</p>
      </section>
    `
    : sectionDetails
        .map((section) => {
          const rows = section.detailTests
            .map((t) => {
              const locStr = formatLocation(t);
              return `
          <tr class="status-${escapeHtml(t.status)}">
            <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td>${flagsHtml(t)}</td>
            <td>${escapeHtml(t.titlePath || t.title)}</td>
            <td>${escapeHtml(locStr)}</td>
            <td>${escapeHtml(formatDuration(t.duration))}</td>
            <td>${escapeHtml(noteSummary(t))}</td>
          </tr>
        `;
            })
            .join('');

          return `
      <section>
        <h3>${escapeHtml(section.section)}</h3>
        ${renderSectionIntroHtml(section.section)}
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        ${
          section.detailOmitted > 0
            ? `<p class="muted">Showing ${section.detailTests.length} of ${section.detailSourceCount} rows for this section (omitted ${section.detailOmitted}).</p>`
            : ''
        }
      </section>
    `;
        })
        .join('');

const failedCardsHtml = failed.length
  ? failed
      .map((t) => {
        const locStr = formatLocation(t);
        return `
          <article class="failure-card">
            <h3>${escapeHtml(t.titlePath || t.title)}</h3>
            <div><strong>Phase:</strong> ${escapeHtml(t.phase)}</div>
            <div><strong>Location:</strong> ${escapeHtml(locStr)}</div>
            <div><strong>Duration:</strong> ${escapeHtml(formatDuration(t.duration))}</div>
            <div><strong>Error:</strong> ${escapeHtml(oneLine(t.error) || '-')}</div>
            <div><strong>Flags:</strong> ${flagsHtml(t)}</div>
            <div><strong>Attachments:</strong> ${attachmentLinksHtml(t.attachments)}</div>
          </article>
        `;
      })
      .join('')
  : '<p class="muted">No failed tests.</p>';

const allRowsHtml = matrixTests.length
  ? matrixTests
      .map((t) => {
        const locStr = formatLocation(t);
        return `
      <tr class="status-${escapeHtml(t.status)}">
        <td>${escapeHtml(t.phase)}</td>
        <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
        <td>${flagsHtml(t)}</td>
        <td>${escapeHtml(t.titlePath || t.title)}</td>
        <td>${escapeHtml(locStr)}</td>
        <td>${escapeHtml(formatDuration(t.duration))}</td>
        <td>${escapeHtml(noteSummary(t))}</td>
        <td>${attachmentLinksHtml(t.attachments)}</td>
      </tr>
    `;
      })
      .join('')
  : '<tr><td colspan="8" class="muted">No rows selected for current matrix mode.</td></tr>';

const providerMatrixHtml =
  providerMatrixAllResults.length || providerMatrix
    ? `
      <section id="casino-providers-matrix">
        <h2>Casino Providers Matrix</h2>
        ${renderSectionIntroHtml('Casino Providers Matrix')}
        <div class="summary-grid">
          ${[
            { label: 'Target Providers Declared', value: providerMatrixSummary.targetDeclared },
            { label: 'Provider Results Captured', value: providerMatrixSummary.resultsCaptured },
            {
              label: 'Providers Discovered On Brand',
              value: providerMatrixSummary.providersDiscovered || '-',
            },
            { label: 'Passed', value: providerMatrixSummary.passed },
            { label: 'Passed Strong', value: providerMatrixSummary.passedStrong },
            { label: 'Passed Weak Surface', value: providerMatrixSummary.passedWeakSurface },
            { label: 'Blocked', value: providerMatrixSummary.blocked },
            { label: 'Provider Absent', value: providerMatrixSummary.blockedProviderAbsent },
            {
              label: 'Provider Launch Blocked',
              value: providerMatrixSummary.blockedProviderLaunch,
            },
            { label: 'Retried Recovered', value: providerMatrixSummary.retriedRecovered },
            { label: 'Rows In Report', value: providerMatrixResults.length },
            { label: 'Omitted Rows', value: providerMatrixOmitted },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Launch</th>
              <th>Surface</th>
              <th>Controls</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${providerMatrixResults
              .map(
                (item) => `
                  <tr class="status-${escapeHtml(item.status || 'unknown')}">
                    <td>${escapeHtml(item.provider || '-')}</td>
                    <td><span class="badge badge-${escapeHtml(item.status || 'unknown')}">${escapeHtml(
                      item.status || '-'
                    )}</span></td>
                    <td>${escapeHtml(item.outcome || '-')}</td>
                    <td>${escapeHtml(item.launchState || '-')}</td>
                    <td>${escapeHtml(item.gameSurface || '-')}</td>
                    <td>${escapeHtml(item.controlsClicked || 0)}</td>
                    <td>${escapeHtml(normalizeReason(item.reason || '-') || '-')}</td>
                  </tr>
                `
              )
              .join('')}
            ${
              providerMatrixOmitted > 0
                ? `
                  <tr>
                    <td colspan="7" class="muted">Omitted ${providerMatrixOmitted} provider rows in compact report.</td>
                  </tr>
                `
                : ''
            }
          </tbody>
        </table>
      </section>
    `
    : `
      <section id="casino-providers-matrix">
        <h2>Casino Providers Matrix</h2>
        ${renderSectionIntroHtml('Casino Providers Matrix')}
        <p class="muted">Provider matrix artifact not found.</p>
      </section>
    `;

const depositHtml =
  depositArtifact || depositInventoryArtifact
    ? `
      <section id="deposit-inventory">
        <h2>Deposit Inventory</h2>
        ${renderSectionIntroHtml('Deposit Inventory')}
        <div class="summary-grid">
          ${[
            {
              label: 'Coverage State',
              value: depositInventoryCoverageBlocked ? 'blocked' : 'ready',
            },
            {
              label: 'Blocked Reason',
              value: depositInventoryCoverageBlocked ? depositInventoryCoverageReason : '-',
            },
            {
              label: 'API Pay Systems',
              value: blockedAwareCount(
                depositInventorySummary.apiItemsCount,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'API Categories',
              value: blockedAwareCount(
                depositInventorySummary.apiCategories.length,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'UI Coverage Available',
              value: blockedAwareBool(
                depositInventorySummary.uiCoverageAvailable,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'API Coverage Available',
              value: blockedAwareBool(
                depositInventorySummary.apiCoverageAvailable,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'Coverage Source Mode',
              value: depositInventoryCoverageBlocked
                ? 'N/A (blocked)'
                : depositInventorySummary.sourceMode || '-',
            },
            {
              label: 'UI Tiles',
              value: blockedAwareCount(
                depositInventorySummary.uiTilesCount,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'UI Unique Categories',
              value: blockedAwareCount(
                depositInventorySummary.uiCategories.length,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'API Fallback Attempts',
              value: depositInventorySummary.apiFallbackAttempts.length,
            },
            {
              label: 'API Fallback Resolved',
              value: yesNo(depositInventorySummary.apiFallbackResolved),
            },
            {
              label: 'API Fallback Best Currency',
              value: depositInventorySummary.apiFallbackBestCurrency || '-',
            },
            {
              label: 'API Fallback Best Status',
              value: depositInventorySummary.apiFallbackBestStatus || '-',
            },
            {
              label: 'Unexpected UI Categories',
              value: blockedAwareList(
                depositInventorySummary.unexpectedUiCategories,
                depositInventoryCoverageBlocked
              ),
            },
            {
              label: 'Missing UI Categories',
              value: blockedAwareList(
                depositInventorySummary.missingUiCategories,
                depositInventoryCoverageBlocked
              ),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>API Methods</th>
            </tr>
          </thead>
          <tbody>
            ${
              depositInventorySummary.apiGrouped.length
                ? depositInventorySummary.apiGrouped
                    .map(
                      (entry) => `
                        <tr>
                          <td>${escapeHtml(entry.category || '-')}</td>
                          <td>${escapeHtml(
                            (entry.methods || []).map((method) => method.name).join(', ') || '-'
                          )}</td>
                        </tr>
                      `
                    )
                    .join('')
                : `<tr><td>-</td><td class="muted">${escapeHtml(
                    depositInventoryCoverageBlocked
                      ? `Blocked: ${depositInventoryCoverageReason}`
                      : '-'
                  )}</td></tr>`
            }
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Fallback Currency</th>
              <th>HTTP Status</th>
              <th>Items</th>
              <th>Error / Body Preview</th>
            </tr>
          </thead>
          <tbody>
            ${
              depositInventorySummary.apiFallbackAttempts.length
                ? depositInventorySummary.apiFallbackAttempts
                    .map(
                      (attempt) => `
                        <tr>
                          <td>${escapeHtml(attempt.currency || '-')}</td>
                          <td>${escapeHtml(attempt.status || '-')}</td>
                          <td>${escapeHtml(attempt.itemsCount || 0)}</td>
                          <td>${escapeHtml(
                            truncateText(
                              normalizeReason(attempt.error || attempt.bodyPreview || '-'),
                              NOTE_TEXT_LIMIT
                            ) || '-'
                          )}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td>-</td><td>-</td><td>-</td><td class="muted">No fallback attempts captured.</td></tr>'
            }
          </tbody>
        </table>
      </section>
      <section id="deposit-method-coverage">
        <h2>Deposit Method Coverage</h2>
        ${renderSectionIntroHtml('Deposit Method Coverage')}
        <div class="summary-grid">
          ${[
            {
              label: 'Coverage State',
              value: depositMethodCoverageBlocked ? 'blocked' : 'ready',
            },
            {
              label: 'Blocked Reason',
              value: depositMethodCoverageBlocked ? depositMethodCoverageReason : '-',
            },
            {
              label: 'Methods Discovered',
              value: blockedAwareCount(
                depositSummary.discoveredCount,
                depositMethodCoverageBlocked
              ),
            },
            {
              label: 'Methods Checked',
              value: blockedAwareCount(depositSummary.checkedCount, depositMethodCoverageBlocked),
            },
            {
              label: 'UI Coverage Available',
              value: blockedAwareBool(
                depositSummary.uiCoverageAvailable,
                depositMethodCoverageBlocked
              ),
            },
            {
              label: 'API Coverage Available',
              value: blockedAwareBool(
                depositSummary.apiCoverageAvailable,
                depositMethodCoverageBlocked
              ),
            },
            {
              label: 'Coverage Source Mode',
              value: depositMethodCoverageBlocked
                ? 'N/A (blocked)'
                : depositSummary.sourceMode || '-',
            },
            {
              label: 'Methods Ready',
              value: blockedAwareCount(depositSummary.readyCount, depositMethodCoverageBlocked),
            },
            {
              label: 'Partial Coverage',
              value: blockedAwareBool(depositSummary.partialCoverage, depositMethodCoverageBlocked),
            },
            {
              label: 'Submit Visible',
              value: blockedAwareBool(depositSummary.submitVisible, depositMethodCoverageBlocked),
            },
            {
              label: 'Submit Enabled',
              value: blockedAwareBool(depositSummary.submitEnabled, depositMethodCoverageBlocked),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Selected</th>
              <th>Surface Ready</th>
              <th>Submit</th>
              <th>Amount</th>
              <th>Change Method</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${
              depositSummary.results.length
                ? depositSummary.results
                    .map((item) => {
                      const surface = item.surface || {};
                      const note =
                        item.challenge ||
                        item.clickError ||
                        (surface.unavailableMessageVisible ? 'Method unavailable' : '-');
                      return `
                        <tr class="status-${item.surfaceReady ? 'passed' : 'blocked'}">
                          <td>${escapeHtml(item.method || '-')}</td>
                          <td>${item.selected ? 'yes' : 'no'}</td>
                          <td>${item.surfaceReady ? 'yes' : 'no'}</td>
                          <td>${surface.submitVisible ? 'yes' : 'no'}</td>
                          <td>${surface.amountInputVisible ? 'yes' : 'no'}</td>
                          <td>${surface.changeMethodVisible ? 'yes' : 'no'}</td>
                          <td>${escapeHtml(normalizeReason(note) || '-')}</td>
                        </tr>
                      `;
                    })
                    .join('')
                : `<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td class="muted">${escapeHtml(
                    depositMethodCoverageBlocked ? `Blocked: ${depositMethodCoverageReason}` : '-'
                  )}</td></tr>`
            }
          </tbody>
        </table>
      </section>
    `
    : `
      <section id="deposit-inventory">
        <h2>Deposit Inventory</h2>
        ${renderSectionIntroHtml('Deposit Inventory')}
        <p class="muted">Deposit inventory artifact not found.</p>
      </section>
      <section id="deposit-method-coverage">
        <h2>Deposit Method Coverage</h2>
        ${renderSectionIntroHtml('Deposit Method Coverage')}
        <p class="muted">Deposit artifact not found.</p>
      </section>
    `;
const depositCoverageHtml = (() => {
  const inventoryBlocked = depositInventoryCoverageBlocked;
  const methodsBlocked = depositMethodCoverageBlocked;
  const overallState =
    inventoryBlocked && methodsBlocked
      ? 'blocked'
      : inventoryBlocked || methodsBlocked
        ? 'partial'
        : 'ready';
  const reasons = [
    inventoryBlocked ? `Inventory: ${depositInventoryCoverageReason}` : '',
    methodsBlocked ? `Methods: ${depositMethodCoverageReason}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const apiCategoriesPreview = depositInventorySummary.apiCategories.slice(0, 8);
  const uiCategoriesPreview = depositInventorySummary.uiCategories.slice(0, 8);
  const readyMethodsPreview = depositSummary.results
    .filter((item) => item.surfaceReady)
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const checkedMethodsPreview = depositSummary.results
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);

  return `
      <section id="deposit-coverage">
        <h2>Deposit Coverage</h2>
        ${renderSectionIntroHtml('Deposit Coverage')}
        <div class="summary-grid">
          ${[
            { label: 'Coverage State', value: overallState },
            { label: 'Inventory Blocked', value: yesNo(inventoryBlocked) },
            { label: 'Methods Blocked', value: yesNo(methodsBlocked) },
            { label: 'Blocked Reason', value: reasons || '-' },
            {
              label: 'API Coverage Available',
              value: blockedAwareBool(
                depositInventorySummary.apiCoverageAvailable,
                inventoryBlocked
              ),
            },
            {
              label: 'UI Coverage Available',
              value: blockedAwareBool(
                depositInventorySummary.uiCoverageAvailable,
                inventoryBlocked
              ),
            },
            {
              label: 'API Categories',
              value: blockedAwareCount(
                depositInventorySummary.apiCategories.length,
                inventoryBlocked
              ),
            },
            {
              label: 'UI Categories',
              value: blockedAwareCount(
                depositInventorySummary.uiCategories.length,
                inventoryBlocked
              ),
            },
            {
              label: 'Methods Discovered',
              value: blockedAwareCount(depositSummary.discoveredCount, methodsBlocked),
            },
            {
              label: 'Methods Checked',
              value: blockedAwareCount(depositSummary.checkedCount, methodsBlocked),
            },
            {
              label: 'Methods Ready',
              value: blockedAwareCount(depositSummary.readyCount, methodsBlocked),
            },
            {
              label: 'Submit Visible',
              value: blockedAwareBool(depositSummary.submitVisible, methodsBlocked),
            },
            {
              label: 'Submit Enabled',
              value: blockedAwareBool(depositSummary.submitEnabled, methodsBlocked),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <div class="key-grid">
          <div class="key">API Categories (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(apiCategoriesPreview, inventoryBlocked)
          )}</div>
          <div class="key">UI Categories (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(uiCategoriesPreview, inventoryBlocked)
          )}</div>
          <div class="key">Ready Methods (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(readyMethodsPreview, methodsBlocked)
          )}</div>
          <div class="key">Checked Methods (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(checkedMethodsPreview, methodsBlocked)
          )}</div>
        </div>
      </section>
    `;
})();

const authStateHealthHtml = authStateHealth
  ? `
      <section id="auth-state-health">
        <h2>Auth State Health</h2>
        ${renderSectionIntroHtml('Auth State Health')}
        <div class="summary-grid">
          ${[
            { label: 'Checked At', value: authStateHealth.checkedAt || '-' },
            { label: 'Phase', value: authStateHealth.phase || '-' },
            {
              label: 'Max Age',
              value: authStateHealth.maxAgeSec ? `${authStateHealth.maxAgeSec}s` : '-',
            },
            {
              label: 'Selected Path',
              value: authStateHealth.selectedPath ? toRelative(authStateHealth.selectedPath) : '-',
            },
            { label: 'Selected Fresh', value: yesNo(authStateHealth.selectedFresh) },
            {
              label: 'Selected Session Artifacts',
              value: yesNo(authStateHealth.selectedHasSessionArtifacts),
            },
            {
              label: 'Selected Cookies/Origins',
              value: `${Number(authStateHealth.selectedCookiesCount || 0)}/${Number(
                authStateHealth.selectedOriginsCount || 0
              )}`,
            },
            { label: 'Refresh Triggered', value: yesNo(authStateHealth.refreshTriggered) },
            { label: 'Healthy', value: yesNo(authStateHealth.healthy) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Candidate Path</th>
              <th>Exists</th>
              <th>Fresh</th>
              <th>Age</th>
              <th>Cookies/Origins</th>
              <th>Session Artifacts</th>
              <th>Parse Error</th>
            </tr>
          </thead>
          <tbody>
            ${
              Array.isArray(authStateHealth.entries) && authStateHealth.entries.length
                ? authStateHealth.entries
                    .map(
                      (entry) => `
                        <tr>
                          <td>${escapeHtml(entry.path ? toRelative(entry.path) : '-')}</td>
                          <td>${yesNo(entry.exists)}</td>
                          <td>${yesNo(entry.fresh)}</td>
                          <td>${escapeHtml(
                            entry.ageSec == null ? '-' : `${Number(entry.ageSec)}s`
                          )}</td>
                          <td>${escapeHtml(
                            `${Number(entry.cookiesCount || 0)}/${Number(entry.originsCount || 0)}`
                          )}</td>
                          <td>${yesNo(entry.hasSessionArtifacts)}</td>
                          <td>${escapeHtml(oneLine(entry.parseError || '-') || '-')}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
            }
          </tbody>
        </table>
      </section>
    `
  : '';

const kpiValidationHtml = kpiValidation
  ? `
      <section id="run-kpi-validation">
        <h2>Run KPI Validation</h2>
        ${renderSectionIntroHtml('Run KPI Validation')}
        <div class="summary-grid">
          ${[
            { label: 'Generated At', value: kpiValidation.generatedAt || '-' },
            { label: 'Valid', value: yesNo(kpiValidation.valid) },
            {
              label: 'Failed Checks',
              value: Array.isArray(kpiValidation.failedChecks)
                ? kpiValidation.failedChecks.length
                : 0,
            },
            {
              label: 'Blocked Ratio',
              value: formatPercent(
                Number((kpiValidation.totals && kpiValidation.totals.blockedSignals) || 0) /
                  Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
              ),
            },
            {
              label: 'Infra Blocked Ratio',
              value: formatPercent(
                Number((kpiValidation.totals && kpiValidation.totals.infraBlockedSignals) || 0) /
                  Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
              ),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Applicable</th>
              <th>Passed</th>
              <th>Actual</th>
              <th>Threshold</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            ${
              Array.isArray(kpiValidation.checks) && kpiValidation.checks.length
                ? kpiValidation.checks
                    .map(
                      (item) => `
                        <tr class="status-${item.passed ? 'passed' : 'failed'}">
                          <td>${escapeHtml(item.label || item.id || '-')}</td>
                          <td>${yesNo(item.applicable !== false)}</td>
                          <td>${yesNo(item.passed)}</td>
                          <td>${escapeHtml(item.actual)}</td>
                          <td>${escapeHtml(item.threshold)}</td>
                          <td>${escapeHtml(oneLine(item.detail || '-') || '-')}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
            }
          </tbody>
        </table>
      </section>
    `
  : '';

const liveChatHtml = liveChatSection
  ? `
      <section id="live-chat">
        <h2>Live Chat</h2>
        ${renderSectionIntroHtml('Live Chat')}
        <div class="summary-grid">
          ${[
            { label: 'Total', value: liveChatSection.totals.total },
            { label: 'Passed', value: liveChatSection.totals.passed },
            { label: 'Failed', value: liveChatSection.totals.failed },
            { label: 'Skipped', value: liveChatSection.totals.skipped },
            {
              label: 'Blocked',
              value: liveChatSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
            },
            { label: 'Duration', value: formatDuration(liveChatSection.durationMs) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${liveChatSection.tests
              .map((t) => {
                const locStr = formatLocation(t);
                return `
                  <tr class="status-${escapeHtml(t.status)}">
                    <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
                    <td>${flagsHtml(t)}</td>
                    <td>${escapeHtml(t.titlePath || t.title)}</td>
                    <td>${escapeHtml(locStr)}</td>
                    <td>${escapeHtml(formatDuration(t.duration))}</td>
                    <td>${escapeHtml(noteSummary(t))}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </section>
    `
  : `
      <section id="live-chat">
        <h2>Live Chat</h2>
        ${renderSectionIntroHtml('Live Chat')}
        <p class="muted">No live chat tests were present in the collected reports.</p>
      </section>
    `;
const sidebarHtml = sidebarSection
  ? `
      <section id="sidebar">
        <h2>Sidebar</h2>
        ${renderSectionIntroHtml('Sidebar')}
        <div class="summary-grid">
          ${[
            { label: 'Total', value: sidebarSection.totals.total },
            { label: 'Passed', value: sidebarSection.totals.passed },
            { label: 'Failed', value: sidebarSection.totals.failed },
            { label: 'Skipped', value: sidebarSection.totals.skipped },
            {
              label: 'Blocked',
              value: sidebarSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
            },
            { label: 'Duration', value: formatDuration(sidebarSection.durationMs) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${sidebarSection.tests
              .map((t) => {
                const locStr = formatLocation(t);
                return `
                  <tr class="status-${escapeHtml(t.status)}">
                    <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
                    <td>${flagsHtml(t)}</td>
                    <td>${escapeHtml(t.titlePath || t.title)}</td>
                    <td>${escapeHtml(locStr)}</td>
                    <td>${escapeHtml(formatDuration(t.duration))}</td>
                    <td>${escapeHtml(noteSummary(t))}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </section>
    `
  : `
      <section id="sidebar">
        <h2>Sidebar</h2>
        ${renderSectionIntroHtml('Sidebar')}
        <p class="muted">No sidebar tests were present in the collected reports.</p>
      </section>
    `;

const registrationOutcomeHtml = `
      <section id="registration-outcome">
        <h2>Registration Outcome</h2>
        ${renderSectionIntroHtml('Registration Outcome')}
        <div class="key-grid">
          <div class="key">Registration Test Present</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.testFound)
          )}</div>
          <div class="key">New Player Registered In This Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.newPlayerRegisteredInRun)
          )}</div>
          <div class="key">Registration Test Status</div><div class="val">${escapeHtml(
            registrationOutcome.testStatus
          )}</div>
          <div class="key">Registration Test Flags</div><div class="val">${escapeHtml(
            registrationOutcome.flags
          )}</div>
          <div class="key">Registration Test Note</div><div class="val">${escapeHtml(
            registrationOutcome.note
          )}</div>
          <div class="key">Registered Player Data Available</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.playerDataAvailable)
          )}</div>
          <div class="key">Registered Player Data Source</div><div class="val"><code>${escapeHtml(
            registrationOutcome.playerDataSource
          )}</code></div>
          <div class="key">Registered Player Belongs To Current Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.playerDataFromCurrentRun)
          )}</div>
          <div class="key">Registered Player Generated At</div><div class="val">${escapeHtml(
            registrationOutcome.playerGeneratedAt
          )}</div>
          <div class="key">Registered Player Email</div><div class="val">${escapeHtml(
            registrationOutcome.playerEmail
          )}</div>
          <div class="key">Manual Password Login Ready</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginReady)
          )}</div>
          <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationStatus
          )}</div>
          <div class="key">Login Validation Method</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationMethod
          )}</div>
          <div class="key">Login Validation Reason</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationReason
          )}</div>
          <div class="key">Login Validation At</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationAt
          )}</div>
          <div class="key">Manual Login Player Available</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginPlayerAvailable)
          )}</div>
          <div class="key">Manual Login Player Source</div><div class="val"><code>${escapeHtml(
            registrationOutcome.manualLoginPlayerSource
          )}</code></div>
          <div class="key">Manual Login Player From Current Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginPlayerFromCurrentRun)
          )}</div>
          <div class="key">Manual Login Player Email</div><div class="val">${escapeHtml(
            registrationOutcome.manualLoginPlayerEmail
          )}</div>
          <div class="key">Manual Login Player Generated At</div><div class="val">${escapeHtml(
            registrationOutcome.manualLoginPlayerGeneratedAt
          )}</div>
          <div class="key">Manual Login Player Validation At</div><div class="val">${escapeHtml(
            registrationOutcome.manualLoginPlayerValidationAt
          )}</div>
          <div class="key">Current Manual Login Email</div><div class="val">${escapeHtml(
            registrationOutcome.currentManualLoginEmail
          )}</div>
          <div class="key">Current Manual Login Password</div><div class="val">${escapeHtml(
            registrationOutcome.currentManualLoginPassword
          )}</div>
          <div class="key">Source Test</div><div class="val">${escapeHtml(
            registrationOutcome.sourceTest
          )}</div>
        </div>
      </section>
    `;

const registrationHtml = `
      <section id="registered-player">
        <h2>Registered Player</h2>
        ${renderSectionIntroHtml('Registered Player')}
        ${
          registrationData
            ? `
              <p class="muted">Data source: <code>${escapeHtml(
                formatPathForDisplay(registration.path || '-')
              )}</code></p>
              <div class="key-grid">
                <div class="key">New Player Registered In This Run</div><div class="val">${escapeHtml(
                  yesNo(registrationOutcome.newPlayerRegisteredInRun)
                )}</div>
                <div class="key">Player Data Belongs To Current Run</div><div class="val">${escapeHtml(
                  yesNo(registrationOutcome.playerDataFromCurrentRun)
                )}</div>
                <div class="key">Manual Password Login Ready</div><div class="val">${escapeHtml(
                  yesNo(registrationOutcome.manualLoginReady)
                )}</div>
                <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
                  registrationOutcome.loginValidationStatus
                )}</div>
                <div class="key">Login Validation Method</div><div class="val">${escapeHtml(
                  registrationOutcome.loginValidationMethod
                )}</div>
                <div class="key">Login Validation Reason</div><div class="val">${escapeHtml(
                  registrationOutcome.loginValidationReason
                )}</div>
                <div class="key">Login Validation At</div><div class="val">${escapeHtml(
                  registrationOutcome.loginValidationAt
                )}</div>
                <div class="key">Email</div><div class="val">${escapeHtml(registrationData.email || '-')}</div>
                <div class="key">Password</div><div class="val">${escapeHtml(
                  registrationData.password || registrationData.passwordMasked || '-'
                )}</div>
                <div class="key">Password (masked)</div><div class="val">${escapeHtml(
                  registrationData.passwordMasked || '-'
                )}</div>
                <div class="key">First Name</div><div class="val">${escapeHtml(
                  registrationData.firstName || '-'
                )}</div>
                <div class="key">Last Name</div><div class="val">${escapeHtml(
                  registrationData.lastName || '-'
                )}</div>
                <div class="key">Country</div><div class="val">${escapeHtml(
                  registrationData.country || '-'
                )}</div>
                <div class="key">City</div><div class="val">${escapeHtml(registrationData.city || '-')}</div>
                <div class="key">Address</div><div class="val">${escapeHtml(
                  registrationData.address || '-'
                )}</div>
                <div class="key">Date of Birth</div><div class="val">${escapeHtml(
                  registrationData.dateOfBirth || '-'
                )}</div>
                <div class="key">Phone (masked)</div><div class="val">${escapeHtml(
                  registrationData.phoneMasked || '-'
                )}</div>
                <div class="key">Generated At</div><div class="val">${escapeHtml(
                  registrationData.generatedAt || '-'
                )}</div>
                <div class="key">Source Test</div><div class="val">${escapeHtml(
                  registrationData.source || '-'
                )}</div>
              </div>
            `
            : '<p class="muted">Registration data not found.</p>'
        }
        <h3>Manual Login Player</h3>
        ${
          manualLoginPlayerData
            ? `
              <p class="muted">Data source: <code>${escapeHtml(
                formatPathForDisplay(manualLoginPlayerDataSource)
              )}</code></p>
              <div class="key-grid">
                <div class="key">Available For Manual Login</div><div class="val">${escapeHtml(
                  yesNo(true)
                )}</div>
                <div class="key">Belongs To Current Run</div><div class="val">${escapeHtml(
                  yesNo(registrationOutcome.manualLoginPlayerFromCurrentRun)
                )}</div>
                <div class="key">Email</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.email || '-'
                )}</div>
                <div class="key">Password</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.password || manualLoginPlayerData.passwordMasked || '-'
                )}</div>
                <div class="key">Password Usable For Manual Login</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.password || manualLoginPlayerData.passwordMasked || '-'
                )}</div>
                <div class="key">Password (masked)</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.passwordMasked || '-'
                )}</div>
                <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.loginValidationStatus || '-'
                )}</div>
                <div class="key">Login Validation Method</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.loginValidationMethod || '-'
                )}</div>
                <div class="key">Login Validation At</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.loginValidationAt || '-'
                )}</div>
                <div class="key">Generated At</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.generatedAt || '-'
                )}</div>
                <div class="key">Source Test</div><div class="val">${escapeHtml(
                  manualLoginPlayerData.source || '-'
                )}</div>
              </div>
            `
            : registrationData && registrationData.email && registrationData.password
              ? `
                <p class="muted">No player with validated password sign-in is currently available. Candidate credentials from this run are shown below (automation was blocked by captcha).</p>
                <div class="key-grid">
                  <div class="key">Available For Manual Login</div><div class="val">${escapeHtml(
                    yesNo(false)
                  )}</div>
                  <div class="key">Belongs To Current Run</div><div class="val">${escapeHtml(
                    yesNo(registrationOutcome.playerDataFromCurrentRun)
                  )}</div>
                  <div class="key">Email</div><div class="val">${escapeHtml(
                    registrationData.email || '-'
                  )}</div>
                  <div class="key">Password</div><div class="val">${escapeHtml(
                    registrationData.password || registrationData.passwordMasked || '-'
                  )}</div>
                  <div class="key">Password Usable For Manual Login (candidate)</div><div class="val">${escapeHtml(
                    registrationData.password || registrationData.passwordMasked || '-'
                  )}</div>
                  <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
                    registrationOutcome.loginValidationStatus || '-'
                  )}</div>
                  <div class="key">Login Validation Method</div><div class="val">${escapeHtml(
                    registrationOutcome.loginValidationMethod || '-'
                  )}</div>
                  <div class="key">Login Validation Reason</div><div class="val">${escapeHtml(
                    registrationOutcome.loginValidationReason || '-'
                  )}</div>
                </div>
              `
              : '<p class="muted">No player with validated password sign-in is currently available.</p>'
        }
      </section>
    `;
const registrationPlayerHtml = (() => {
  const primaryEmail =
    registrationOutcome.currentManualLoginEmail ||
    registrationOutcome.manualLoginPlayerEmail ||
    registrationOutcome.playerEmail ||
    '-';
  const primaryPassword =
    registrationOutcome.currentManualLoginPassword ||
    (manualLoginPlayerData &&
      (manualLoginPlayerData.password || manualLoginPlayerData.passwordMasked)) ||
    (registrationData && (registrationData.password || registrationData.passwordMasked)) ||
    '-';
  const sourcePath = formatPathForDisplay(registration.path || manualLoginPlayerDataSource || '-');

  return `
      <section id="registration-player">
        <h2>Registration &amp; Player</h2>
        ${renderSectionIntroHtml('Registration & Player')}
        <div class="key-grid">
          <div class="key">Registration Test Present</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.testFound)
          )}</div>
          <div class="key">Registration Test Status</div><div class="val">${escapeHtml(
            registrationOutcome.testStatus
          )}</div>
          <div class="key">New Player Registered In This Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.newPlayerRegisteredInRun)
          )}</div>
          <div class="key">Player Data Belongs To Current Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.playerDataFromCurrentRun)
          )}</div>
          <div class="key">Manual Password Login Ready</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginReady)
          )}</div>
          <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationStatus
          )}</div>
          <div class="key">Login Validation At</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationAt
          )}</div>
          <div class="key">Manual Login Player Available</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginPlayerAvailable)
          )}</div>
          <div class="key">Email For Manual Login</div><div class="val">${escapeHtml(primaryEmail)}</div>
          <div class="key">Password For Manual Login</div><div class="val">${escapeHtml(
            primaryPassword
          )}</div>
          <div class="key">Player Generated At</div><div class="val">${escapeHtml(
            registrationOutcome.playerGeneratedAt
          )}</div>
          <div class="key">Data Source</div><div class="val"><code>${escapeHtml(sourcePath)}</code></div>
          <div class="key">Source Test</div><div class="val">${escapeHtml(
            registrationOutcome.sourceTest
          )}</div>
        </div>
      </section>
    `;
})();

function renderRegistrationNetworkHtml(network) {
  if (!network) return '';

  const responseErrors = Array.isArray(network.responseErrors) ? network.responseErrors : [];
  const failedRequests = Array.isArray(network.failedRequests) ? network.failedRequests : [];
  const consoleErrors = Array.isArray(network.consoleErrors) ? network.consoleErrors : [];
  const toastErrors = Array.isArray(network.toastErrors) ? network.toastErrors : [];
  const authResponses = Array.isArray(network.authResponses) ? network.authResponses : [];

  const rowsFor = (items, mapRow) =>
    items.length
      ? `<tbody>${items.map(mapRow).join('')}</tbody>`
      : '<tbody><tr><td colspan="3" class="muted">No entries</td></tr></tbody>';

  const responseErrorsHtml = `
    <section>
      <h3>Registration API Errors</h3>
      <table>
        <thead><tr><th>Request</th><th>Status</th><th>Response</th></tr></thead>
        ${rowsFor(responseErrors, (err) => {
          const req = `${err.method || ''} ${err.url || ''}`.trim();
          const status = `${err.status || ''} ${err.statusText || ''}`.trim();
          return `<tr><td>${escapeHtml(req)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(
            oneLine(err.body || '').slice(0, 240)
          )}</td></tr>`;
        })}
      </table>
    </section>
  `;

  const failedRequestsHtml = `
    <section>
      <h3>Registration Failed Requests</h3>
      <table>
        <thead><tr><th>Request</th><th>Error</th></tr></thead>
        <tbody>
          ${
            failedRequests.length
              ? failedRequests
                  .map((req) => {
                    const line = `${req.method || ''} ${req.url || ''}`.trim();
                    return `<tr><td>${escapeHtml(line)}</td><td>${escapeHtml(
                      oneLine(req.errorText || '').slice(0, 240)
                    )}</td></tr>`;
                  })
                  .join('')
              : '<tr><td colspan="2" class="muted">No entries</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;

  const consoleErrorsHtml = `
    <section>
      <h3>Registration Console Errors</h3>
      <ul>
        ${
          consoleErrors.length
            ? consoleErrors.map((msg) => `<li>${escapeHtml(oneLine(msg))}</li>`).join('')
            : '<li class="muted">No entries</li>'
        }
      </ul>
    </section>
  `;

  const toastErrorsHtml = `
    <section>
      <h3>Registration Toast Errors</h3>
      <ul>
        ${
          toastErrors.length
            ? toastErrors.map((msg) => `<li>${escapeHtml(oneLine(msg))}</li>`).join('')
            : '<li class="muted">No entries</li>'
        }
      </ul>
    </section>
  `;

  const authResponsesHtml = `
    <section>
      <h3>Registration Auth Responses</h3>
      <table>
        <thead><tr><th>Request</th><th>Status</th><th>Response</th></tr></thead>
        ${rowsFor(authResponses, (res) => {
          const req = `${res.method || ''} ${res.url || ''}`.trim();
          const status = `${res.status || ''} ${res.statusText || ''}`.trim();
          return `<tr><td>${escapeHtml(req)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(
            oneLine(res.body || '').slice(0, 240)
          )}</td></tr>`;
        })}
      </table>
    </section>
  `;

  return `
    <section id="registration-diagnostics">
      <h2>Registration Diagnostics</h2>
      ${renderSectionIntroHtml('Registration Diagnostics')}
      ${responseErrorsHtml}
      ${failedRequestsHtml}
      ${consoleErrorsHtml}
      ${toastErrorsHtml}
      ${authResponsesHtml}
    </section>
  `;
}

async function exportPdfFromHtml(htmlPath, pdfPath) {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const targetUrl = pathToFileURL(htmlPath).href;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QA Report - ${escapeHtml(brandName)}</title>
    <style>
      :root {
        --bg: #f4f6f8;
        --surface: #ffffff;
        --surface-2: #f9fafc;
        --text: #14202b;
        --muted: #5f6b7a;
        --border: #d7dde5;
        --ok: #0f8a5f;
        --bad: #c43f3f;
        --warn: #a77800;
        --flaky: #7d3ac1;
        --accent: #0067d8;
      }

      html { scroll-behavior: smooth; }
      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--text);
        background: radial-gradient(circle at top right, #e7f2ff 0, var(--bg) 45%);
      }

      .container {
        max-width: 1240px;
        margin: 0 auto;
        padding: 24px;
      }

      header {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 20px 24px;
      }

      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.2;
      }

      h2 {
        margin: 0 0 12px;
        font-size: 22px;
      }

      h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      section {
        margin-top: 18px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 2px 8px rgba(20, 32, 43, 0.04);
      }

      .toc {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .toc-link {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        color: #2c3a47;
        background: #ffffff;
        text-decoration: none;
      }

      .toc-link:hover {
        background: #eef5ff;
        border-color: #bfd5f7;
      }

      .highlights-list {
        margin: 0;
        padding-left: 18px;
        line-height: 1.6;
      }

      .section-intro {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.6;
      }

      .meta {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
      }

      .status-line {
        margin-top: 10px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        background: #e8edf3;
        color: #3e4b58;
      }

      .badge-passed { background: #dcf5ea; color: var(--ok); }
      .badge-failed { background: #fde4e4; color: var(--bad); }
      .badge-skipped { background: #fff3d7; color: var(--warn); }
      .badge-flaky { background: #efe3ff; color: var(--flaky); }
      .badge-default { background: #e8edf3; color: #3e4b58; }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        background: var(--surface-2);
      }

      .label {
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--muted);
      }

      .value {
        margin-top: 6px;
        font-size: 20px;
        font-weight: 700;
        line-height: 1.25;
        word-break: break-word;
      }

      .muted { color: var(--muted); }

      .failure-list {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .failure-card {
        border: 1px solid #efcfcf;
        border-radius: 10px;
        padding: 12px;
        background: #fff6f6;
      }

      .key-grid {
        display: grid;
        grid-template-columns: 220px 1fr;
        gap: 8px 12px;
      }

      .key {
        color: var(--muted);
        font-weight: 600;
      }

      .val {
        word-break: break-word;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
        table-layout: fixed;
      }

      th, td {
        border-bottom: 1px solid var(--border);
        padding: 10px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }

      th {
        background: #f0f4f9;
        color: #3a4653;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        position: sticky;
        top: 0;
        z-index: 2;
      }

      tbody tr:nth-child(even) {
        background: #fbfdff;
      }

      code {
        background: #edf2f7;
        border-radius: 6px;
        padding: 2px 6px;
        word-break: break-all;
      }

      a {
        color: var(--accent);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      .sep { color: var(--muted); }

      .mini-flag {
        display: inline-flex;
        align-items: center;
        margin: 0 6px 6px 0;
        padding: 2px 8px;
        border-radius: 999px;
        background: #edf2f7;
        color: #2f3b47;
        font-size: 12px;
        white-space: nowrap;
      }

      @media (max-width: 800px) {
        .container {
          padding: 12px;
        }

        .key-grid {
          grid-template-columns: 1fr;
        }

        table {
          font-size: 13px;
        }

        th, td {
          padding: 8px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>QA Report - ${escapeHtml(brandName)}</h1>
        <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
        <div class="status-line">Run status: <span class="badge ${runStatusBadgeClass(
          runStatus
        )}">${escapeHtml(runStatus)}</span></div>
      </header>

      ${reportTocHtml}

      ${includeReportGuide ? renderReportGuideHtml() : ''}

      <section id="highlights">
        <h2>Highlights</h2>
        ${renderSectionIntroHtml('Highlights')}
        ${highlightsHtml}
      </section>

      <section id="summary">
        <h2>Summary</h2>
        ${renderSectionIntroHtml('Summary')}
        <div class="summary-grid">${summaryCardsHtml}</div>
      </section>

      ${mobileStabilityHtml}

      <section id="sections">
        <h2>Sections</h2>
        ${renderSectionIntroHtml('Sections')}
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Total</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Skipped</th>
              <th>Blocked</th>
              <th>Partial</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${sectionRowsHtml}
          </tbody>
        </table>
      </section>

      ${sectionBlocksHtml}

      ${registrationPlayerHtml}

      ${providerMatrixHtml}

      ${depositCoverageHtml}

      ${authStateHealthHtml}

      ${kpiValidationHtml}

      ${sidebarHtml}

      ${liveChatHtml}

      <section id="failed-tests">
        <h2>Failed Tests</h2>
        ${renderSectionIntroHtml('Failed Tests')}
        <div class="failure-list">${failedCardsHtml}</div>
      </section>

      ${renderRegistrationNetworkHtml(registrationNetwork)}
    </div>
  </body>
</html>`;

(async () => {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    fs.writeFileSync(outHtmlPath, html, 'utf8');

    fs.mkdirSync(autotestReportDir, { recursive: true });
    fs.writeFileSync(brandOutPath, md, 'utf8');
    fs.writeFileSync(brandOutHtmlPath, html, 'utf8');
    await exportPdfFromHtml(brandOutHtmlPath, brandOutPdfPath);

    try {
      fs.mkdirSync(path.dirname(analyzeOutPath), { recursive: true });
      fs.writeFileSync(analyzeOutPath, md, 'utf8');
      fs.writeFileSync(analyzeOutHtmlPath, html, 'utf8');
    } catch {
      // optional copies in analyze/
    }

    console.log(`QA report saved: ${outPath}`);
    console.log(`QA report saved: ${outHtmlPath}`);
    console.log(`QA report saved: ${brandOutPath}`);
    console.log(`QA report saved: ${brandOutHtmlPath}`);
    console.log(`QA report saved: ${brandOutPdfPath}`);
  } catch (error) {
    console.error(
      `Failed to generate QA report outputs: ${error && error.message ? error.message : error}`
    );
    process.exit(1);
  }
})();
