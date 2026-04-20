const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { URL } = require('url');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');

const providerProfile = String(process.env.PW_PROVIDER_PROFILE || 'extended')
  .trim()
  .toLowerCase();
const isNightlyRoute = process.env.PW_NIGHTLY_ROUTE === '1' || providerProfile === 'nightly';
const includeNightlyExtras =
  process.env.PW_INCLUDE_NIGHTLY_EXTRAS === '1' ||
  (process.env.PW_INCLUDE_NIGHTLY_EXTRAS !== '0' && isNightlyRoute);
const includeA11ySuites =
  process.env.PW_INCLUDE_A11Y === '1' || (process.env.PW_INCLUDE_A11Y !== '0' && isNightlyRoute);
const includeVisualSuites =
  process.env.PW_VISUAL_REQUIRED === '1' ||
  process.env.PW_INCLUDE_VISUAL === '1' ||
  (process.env.PW_INCLUDE_VISUAL !== '0' && isNightlyRoute);

const orderedSuites = [
  {
    key: 'home',
    label: 'Home content/scroll/buttons',
    tests: ['tests/smoke/gt-home-content.spec.js', 'tests/smoke/gt-home-buttons.spec.js'],
  },
  {
    key: 'registration',
    label: 'Register a new player',
    tests: ['tests/critical/signup-api-success.spec.js'],
  },
  {
    key: 'auth',
    label: 'Authorize with newly registered player',
    tests: ['tests/critical/login-auth.spec.js'],
    env: {
      PW_LOGIN_REQUIRE_REGISTERED: '1',
      PW_LOGIN_USE_ENV: '0',
    },
  },
  {
    key: 'profile',
    label: 'My Profile coverage',
    tests: ['tests/critical/profile-sections.spec.js'],
  },
  {
    key: 'deposit',
    label: 'Deposit coverage',
    tests: ['tests/critical/deposit-non-destructive.spec.js'],
  },
  {
    key: 'withdraw',
    label: 'Withdraw skeleton coverage',
    tests: ['tests/critical/withdraw-skeleton.spec.js'],
  },
  {
    key: 'sidebar',
    label: 'Sidebar + live chat + language',
    tests: [
      'tests/critical/sidebar.spec.js',
      'tests/destructive/live-chat-message.spec.js',
      'tests/destructive/live-chat-message-authorized.spec.js',
    ],
    env: {
      PW_INCLUDE_LIVE_CHAT: '1',
      PW_INCLUDE_LIVE_CHAT_AUTH: '1',
    },
  },
  {
    key: 'sports',
    label: 'Sports page coverage',
    tests: ['tests/critical/sports-catalog.spec.js'],
  },
  {
    key: 'casino',
    label: 'Casino catalog + providers + favorites/history',
    tests: [
      'tests/critical/casino-catalog.spec.js',
      'tests/critical/casino-providers-real.spec.js',
    ],
  },
  {
    key: 'livecasino',
    label: 'Live casino coverage',
    tests: ['tests/critical/livecasino-catalog.spec.js'],
  },
  {
    key: 'security',
    label: 'Profile security password rotation',
    tests: ['tests/critical/profile-password-security.spec.js'],
  },
  {
    key: 'contracts',
    label: 'API contract checks: auth/payment',
    tests: ['tests/critical/auth-payment-contract.spec.js'],
    env: {
      PW_CONTRACT_CHECKS: process.env.PW_CONTRACT_CHECKS || '1',
    },
  },
];

if (includeNightlyExtras) {
  orderedSuites.push({
    key: 'nightlyextras',
    label: 'Nightly extras (regression/full navigation)',
    tests: [
      'tests/critical/auth-site-regression.spec.js',
      'tests/critical/button-sweep.spec.js',
      'tests/critical/gt-home-navigation.spec.js',
      'tests/critical/signup-open-close.spec.js',
      'tests/smoke/smoke-session.spec.js',
    ],
  });
}

if (includeA11ySuites) {
  orderedSuites.push({
    key: 'a11y',
    label: 'Accessibility smoke',
    tests: ['tests/smoke/a11y-smoke.spec.js'],
  });
}

if (includeVisualSuites) {
  orderedSuites.push({
    key: 'visual',
    label: 'Visual smoke',
    tests: ['tests/visual/site-visual-smoke.spec.js'],
  });
}

function parseSuiteSelection(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) =>
        String(item || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
}

const suitesOnly = parseSuiteSelection(process.env.PW_SUITES_ONLY || '');
const suitesSkip = parseSuiteSelection(process.env.PW_SUITES_SKIP || '');
const selectedOrderedSuites = orderedSuites.filter((suite) => {
  const key = String(suite && suite.key ? suite.key : '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (suitesOnly.size > 0 && !suitesOnly.has(key)) return false;
  if (suitesSkip.has(key)) return false;
  return true;
});

const destructiveTests = [
  'tests/destructive/signup-full.spec.js',
  'tests/destructive/forgot-password.spec.js',
];
const precheckTests = ['tests/smoke/gt-precheck.spec.js'];
const projectPaths = resolveProjectPaths({ cwd: process.cwd() });
const qaRunId = String(
  process.env.QA_RUN_ID ||
    `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
)
  .trim()
  .toLowerCase();
const storageStatePath =
  process.env.PW_STORAGE_STATE || path.join(projectPaths.projectRoot, 'storageState.json');
const reportDir = projectPaths.testResultsDir;
const reportJsonPath = path.join(reportDir, 'report.json');
const phaseReportDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const phaseTestResultsDir = path.join(projectPaths.artifactsDir, 'phase-test-results');
const runHistoryDir = path.join(projectPaths.artifactsDir, 'history', 'runs');
const phaseReportPaths = {
  precheck: path.join(phaseReportDir, 'precheck-report.json'),
  home: path.join(phaseReportDir, 'home-report.json'),
  registration: path.join(phaseReportDir, 'registration-report.json'),
  auth: path.join(phaseReportDir, 'auth-report.json'),
  profile: path.join(phaseReportDir, 'profile-report.json'),
  deposit: path.join(phaseReportDir, 'deposit-report.json'),
  withdraw: path.join(phaseReportDir, 'withdraw-report.json'),
  sidebar: path.join(phaseReportDir, 'sidebar-report.json'),
  sports: path.join(phaseReportDir, 'sports-report.json'),
  casino: path.join(phaseReportDir, 'casino-report.json'),
  livecasino: path.join(phaseReportDir, 'livecasino-report.json'),
  security: path.join(phaseReportDir, 'security-report.json'),
  contracts: path.join(phaseReportDir, 'contracts-report.json'),
  nightlyextras: path.join(phaseReportDir, 'nightlyextras-report.json'),
  a11y: path.join(phaseReportDir, 'a11y-report.json'),
  visual: path.join(phaseReportDir, 'visual-report.json'),
  main: path.join(phaseReportDir, 'main-report.json'),
  destructive: path.join(phaseReportDir, 'destructive-report.json'),
};
const authStateHealthPath = path.join(projectPaths.artifactsDir, 'auth-state-health.json');
const kpiValidationPath = path.join(projectPaths.artifactsDir, 'kpi-validation.json');
const providerMatrixArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'casino',
  'providers-real',
  'providers-real-matrix.json'
);
const depositInventoryArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'deposit',
  'deposit-inventory.json'
);
const depositMethodArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'deposit',
  'deposit-non-destructive.json'
);
const authStateMirrorPaths = [
  path.join(projectPaths.artifactsDir, 'profile-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'site-coverage-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'button-sweep-auth-state.json'),
].filter((candidate, index, all) => all.indexOf(candidate) === index);
const registrationChainArtifacts = [
  path.join(projectPaths.artifactsDir, 'registration-data-current-run.json'),
  path.join(projectPaths.testResultsDir, 'registration-data.json'),
  path.join(projectPaths.artifactsDir, 'last-registered-player.json'),
  path.join(projectPaths.artifactsDir, 'profile-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'site-coverage-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'button-sweep-auth-state.json'),
];
const qaPathEnv = {
  QA_PROJECT_ROOT: projectPaths.projectRoot,
  QA_PROJECT_SLUG: projectPaths.brandSlug,
  QA_ARTIFACTS_DIR: projectPaths.artifactsDir,
  QA_TEST_RESULTS_DIR: projectPaths.testResultsDir,
  QA_AUTOTEST_REPORT_DIR: projectPaths.autotestReportDir,
  QA_ANALYZE_DIR: projectPaths.analyzeDir,
  QA_RUN_ID: qaRunId,
  PW_STORAGE_STATE: storageStatePath,
};

const crashpadHints = [
  /crashpad/i,
  /Target page, context or browser has been closed/i,
  /Permission denied \(1100\)/i,
];

const networkTransientHints = [
  /internet connection appears to be offline/i,
  /net::err_internet_disconnected/i,
  /net::err_network_changed/i,
  /net::err_timed_out/i,
  /socket hang up/i,
];
const timeoutHints = [
  /Test timeout of \d+ms exceeded/i,
  /expect\([^)]*\)\.to(BeVisible|BeHidden|BeEnabled|HaveURL)\(\) failed by timeout/i,
];

const cloudflareHints = [
  /PRECHECK_BLOCKED/i,
  /cloudflare/i,
  /403 on critical resources/i,
  /App root not visible/i,
  /Just a moment/i,
  /challenge/i,
];
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);

const autoSaveState = process.env.PW_AUTO_SAVE_STATE !== '0';
const softPrecheck = process.env.PW_PRECHECK_SOFT === '1';
const includeDestructive = process.env.PW_INCLUDE_DESTRUCTIVE === '1';
const runHeaded = process.env.PW_HEADED === '1';
const aiRequired = process.env.PW_AI_REQUIRED === '1';
const useAiGeneration = aiRequired || process.env.PW_USE_AI_GENERATION === '1';
const preferWebkitOnCloudflare = process.env.PW_CF_PREFER_WEBKIT !== '0';
const forceSaveStateBeforeRun = process.env.PW_FORCE_SAVE_STATE_BEFORE_RUN !== '0';
const requireHeadedLoginBeforeRun = process.env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN === '1';
const requireHeadedLoginStrict = process.env.PW_REQUIRE_HEADED_LOGIN_STRICT === '1';
const mobileStabilizeRerun = process.env.PW_MOBILE_STABILIZE_RERUN !== '0';
const suitesProjectMatrix = process.env.PW_PROJECT_MATRIX || 'desktop';
const precheckProjectMatrix = process.env.PW_PRECHECK_PROJECT_MATRIX || 'desktop';
const runDoctorPreflight = process.env.QA_PREFLIGHT_DOCTOR !== '0';
const authStateFreshnessSec = (() => {
  const raw = Number.parseInt(process.env.PW_AUTH_STATE_MAX_AGE_SEC || '14400', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 14400;
  return raw;
})();

const kpiThresholds = {
  maxBlockedRatio: (() => {
    const raw = Number.parseFloat(process.env.PW_KPI_MAX_BLOCKED_RATIO || '0.55');
    if (!Number.isFinite(raw) || raw <= 0) return 0.55;
    return raw;
  })(),
  maxInfraBlockedRatio: (() => {
    const raw = Number.parseFloat(process.env.PW_KPI_MAX_INFRA_BLOCKED_RATIO || '0.45');
    if (!Number.isFinite(raw) || raw <= 0) return 0.45;
    return raw;
  })(),
  minProviderPassed: (() => {
    const raw = Number.parseInt(process.env.PW_KPI_MIN_PROVIDER_PASSED || '1', 10);
    if (!Number.isFinite(raw) || raw < 0) return 1;
    return raw;
  })(),
  requireDepositUiWhenApiPresent: process.env.PW_KPI_REQUIRE_DEPOSIT_UI_WITH_API !== '0',
};
const kpiWafGraceEnabled = process.env.PW_KPI_WAF_GRACE !== '0';
const kpiWafGraceMinBlockedRatio = (() => {
  const raw = Number.parseFloat(process.env.PW_KPI_WAF_GRACE_MIN_BLOCKED_RATIO || '0.70');
  if (!Number.isFinite(raw) || raw <= 0) return 0.7;
  return raw;
})();
const kpiWafGraceMinInfraRatio = (() => {
  const raw = Number.parseFloat(process.env.PW_KPI_WAF_GRACE_MIN_INFRA_RATIO || '0.60');
  if (!Number.isFinite(raw) || raw <= 0) return 0.6;
  return raw;
})();

const forceSaveStateWarmupRoutes = String(
  process.env.PW_SAVE_STATE_WARMUP_ROUTES || '/,/assets/,/casino/,/casino/recent/'
)
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean);

const saveStateTimeoutParsed = Number.parseInt(process.env.PW_SAVE_STATE_TIMEOUT || '90', 10);
const saveStateTimeoutSec =
  Number.isFinite(saveStateTimeoutParsed) && saveStateTimeoutParsed > 0
    ? saveStateTimeoutParsed
    : 90;

function isCloudflareBlocked(output) {
  return cloudflareHints.some((re) => re.test(output));
}

function isChallengeLikeText(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('cloudflare') ||
    text.includes('challenge') ||
    text.includes('turnstile') ||
    text.includes('captcha') ||
    text.includes('waf') ||
    text.includes('cdn-cgi') ||
    text.includes('__cf_chl') ||
    text.includes('just a moment') ||
    text.includes('security verification') ||
    text.includes('403')
  );
}

function isProviderRowChallengeBlocked(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '').toLowerCase() !== 'blocked') return false;
  const blob = [
    row.reason,
    row.note,
    row.outcome,
    row.uiBlockedReason,
    ...(Array.isArray(row.modes)
      ? row.modes.flatMap((mode) => [mode && mode.reason, mode && mode.uiBlockedReason])
      : []),
  ]
    .map((item) => String(item || ''))
    .join(' ');
  return isChallengeLikeText(blob);
}

function browserEnv(browser) {
  if (browser === 'webkit') {
    return {
      PW_USE_CHROME_CHANNEL: '0',
      PW_BROWSER: 'webkit',
    };
  }

  return {
    PW_BROWSER: 'chromium',
  };
}

function isMobileMatrix(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .includes('mobile');
}

function buildPlaywrightArgs(tests, options = {}) {
  const args = ['playwright', 'test', ...tests, '--workers=1'];
  const shardArg = String(options.shardArg || process.env.PW_PLAYWRIGHT_SHARD || '').trim();
  if (shardArg && /^\d+\/\d+$/.test(shardArg)) {
    args.push(`--shard=${shardArg}`);
  }
  if (runHeaded) args.push('--headed');
  return args;
}

function runCommand(bin, args, envOverride = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ...qaPathEnv,
      PW_REPORT_JSON: '1',
      FORCE_COLOR: '0',
      PW_WAF_DIAGNOSTIC: process.env.PW_WAF_DIAGNOSTIC || '1',
      PW_AUTO_BYPASS_CF_TIMEOUT_MS: process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '45000',
      ...envOverride,
    };
    delete env.NO_COLOR;

    const child = spawn(bin, args, { env });
    let output = '';

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString();
    });

    child.on('exit', (code) => resolve({ code, output }));
  });
}

function runPlaywright(args, envOverride = {}) {
  return runCommand('npx', args, envOverride);
}

function runNodeScript(scriptPath, scriptArgs = [], envOverride = {}) {
  return runCommand('node', [scriptPath, ...scriptArgs], envOverride);
}

function writeJson(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // best-effort write
  }
}

function mirrorPrimaryStorageState() {
  try {
    if (!fs.existsSync(storageStatePath)) return;
    for (const target of authStateMirrorPaths) {
      if (!target || path.resolve(target) === path.resolve(storageStatePath)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(storageStatePath, target);
    }
  } catch {
    // best-effort mirror
  }
}

function inspectStorageStateFile(filePath, maxAgeSec = authStateFreshnessSec) {
  const entry = {
    path: filePath,
    exists: false,
    sizeBytes: 0,
    modifiedAt: '',
    ageSec: null,
    fresh: false,
    cookiesCount: 0,
    originsCount: 0,
    hasSessionArtifacts: false,
    parseError: '',
  };
  if (!filePath) return entry;

  try {
    if (!fs.existsSync(filePath)) return entry;
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - Number(stat.mtimeMs || 0);
    entry.exists = true;
    entry.sizeBytes = Number(stat.size || 0);
    entry.modifiedAt = new Date(Number(stat.mtimeMs || Date.now())).toISOString();
    entry.ageSec = Math.max(0, Math.round(ageMs / 1000));
    entry.fresh = Number.isFinite(entry.ageSec) ? entry.ageSec <= maxAgeSec : false;

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      entry.cookiesCount = Array.isArray(payload && payload.cookies) ? payload.cookies.length : 0;
      entry.originsCount = Array.isArray(payload && payload.origins) ? payload.origins.length : 0;
      entry.hasSessionArtifacts = entry.cookiesCount > 0 || entry.originsCount > 0;
    } catch (err) {
      entry.parseError = String(err && err.message ? err.message : err);
      entry.hasSessionArtifacts = false;
    }
  } catch (err) {
    entry.parseError = String(err && err.message ? err.message : err);
  }

  return entry;
}

function listAuthStateCandidates() {
  return [
    storageStatePath,
    ...authStateMirrorPaths,
    path.join(projectPaths.projectRoot, 'storageState.json'),
    path.join(process.cwd(), 'storageState.json'),
  ]
    .filter(Boolean)
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function runSaveState(baseUrl, options = {}) {
  return new Promise((resolve) => {
    const warmupRoutes = Array.isArray(options.warmupRoutes)
      ? options.warmupRoutes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const warmupStrict = options.warmupStrict === true;
    const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);
    const manualMode = options.manual === true;
    const mobileSaveStateUserAgent =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
    const env = {
      ...process.env,
      ...qaPathEnv,
      PW_USE_CHROME_CHANNEL: '1',
      PW_SAVE_STATE_TIMEOUT: String(saveStateTimeoutSec),
      PW_SAVE_STATE_AUTO_BYPASS: manualMode ? '0' : '1',
      PW_SAVE_STATE_VIEWPORT:
        process.env.PW_SAVE_STATE_VIEWPORT || (mobileMatrixRun ? '390x844' : '1365x900'),
      PW_SAVE_STATE_IS_MOBILE: process.env.PW_SAVE_STATE_IS_MOBILE || (mobileMatrixRun ? '1' : '0'),
      PW_USER_AGENT: process.env.PW_USER_AGENT || (mobileMatrixRun ? mobileSaveStateUserAgent : ''),
      PW_SAVE_STATE_WARMUP_ROUTES:
        warmupRoutes.length > 0
          ? warmupRoutes.join(',')
          : process.env.PW_SAVE_STATE_WARMUP_ROUTES || '',
      PW_SAVE_STATE_WARMUP_STRICT: warmupStrict
        ? '1'
        : process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    };
    const args = ['analyze/saveState.js', baseUrl, storageStatePath];
    if (!manualMode) args.push('--auto');
    const child = spawn('node', args, { env, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (Number(code || 0) === 0) {
        mirrorPrimaryStorageState();
      }
      resolve(code);
    });
  });
}

function parseShardConfig(prefix) {
  const normalizedPrefix = String(prefix || '')
    .trim()
    .toUpperCase();
  if (!normalizedPrefix) return null;

  const totalRaw = Number.parseInt(process.env[`${normalizedPrefix}_SHARD_TOTAL`] || '0', 10);
  if (!Number.isFinite(totalRaw) || totalRaw <= 1) return null;

  const total = Math.max(2, totalRaw);
  const indexRaw = Number.parseInt(process.env[`${normalizedPrefix}_SHARD_INDEX`] || '1', 10);
  const index = Number.isFinite(indexRaw) ? Math.min(Math.max(indexRaw, 1), total) : 1;
  return { index, total, arg: `${index}/${total}` };
}

function resolveSuiteShardArg(suiteKey) {
  const suite = String(suiteKey || '')
    .trim()
    .toLowerCase();
  const generic = parseShardConfig('PW_SUITE');
  if (generic) return generic.arg;

  if (suite === 'sports') {
    const sports = parseShardConfig('PW_SPORTS');
    if (sports) return sports.arg;
  }

  if (suite === 'casino') {
    const casino = parseShardConfig('PW_CASINO');
    if (casino) return casino.arg;
  }

  return '';
}

async function ensureAuthStateHealth({ baseUrl, phase = 'precheck' }) {
  const candidates = listAuthStateCandidates();
  const checkedAt = new Date().toISOString();
  let entries = candidates.map((candidate) =>
    inspectStorageStateFile(candidate, authStateFreshnessSec)
  );
  const primary = entries.find(
    (item) => path.resolve(item.path) === path.resolve(storageStatePath)
  );
  let selected =
    primary ||
    entries.find((item) => item.exists && item.fresh && item.hasSessionArtifacts) ||
    entries.find((item) => item.exists) ||
    null;

  let refreshTriggered = false;
  let refreshReason = '';
  const selectedHealthy = Boolean(
    selected && selected.exists && selected.fresh && selected.hasSessionArtifacts
  );

  if (!selectedHealthy && autoSaveState && !process.env.CI) {
    refreshTriggered = true;
    if (!selected || !selected.exists) {
      refreshReason = 'No auth storageState found.';
    } else if (!selected.fresh) {
      refreshReason = `Auth storageState is stale (age=${selected.ageSec || 'n/a'}s, max=${authStateFreshnessSec}s).`;
    } else if (!selected.hasSessionArtifacts) {
      refreshReason = 'Auth storageState has no session cookies/origins.';
    } else {
      refreshReason = 'Auth storageState health check requested refresh.';
    }

    console.log(`\n⚠️  ${phase}: ${refreshReason} Refreshing storageState...`);
    const refreshCode = await runSaveState(baseUrl, {
      warmupRoutes: ['/', '/assets/', '/casino/', '/casino/recent/'],
      warmupStrict: false,
    });
    if (Number(refreshCode || 0) === 0) {
      entries = candidates.map((candidate) =>
        inspectStorageStateFile(candidate, authStateFreshnessSec)
      );
      selected =
        entries.find((item) => path.resolve(item.path) === path.resolve(storageStatePath)) ||
        entries.find((item) => item.exists && item.fresh && item.hasSessionArtifacts) ||
        entries.find((item) => item.exists) ||
        null;
      console.log(`\n✅ ${phase}: storageState refreshed for auth-state health.`);
    } else {
      console.log(`\n⚠️  ${phase}: storageState refresh failed during auth-state health check.`);
    }
  }

  const health = {
    checkedAt,
    phase,
    maxAgeSec: authStateFreshnessSec,
    storageStatePath,
    refreshTriggered,
    refreshReason,
    selectedPath: selected ? selected.path : '',
    selectedModifiedAt: selected ? selected.modifiedAt : '',
    selectedAgeSec: selected ? selected.ageSec : null,
    selectedFresh: Boolean(selected && selected.fresh),
    selectedHasSessionArtifacts: Boolean(selected && selected.hasSessionArtifacts),
    selectedCookiesCount: selected ? selected.cookiesCount : 0,
    selectedOriginsCount: selected ? selected.originsCount : 0,
    healthy: Boolean(selected && selected.exists && selected.fresh && selected.hasSessionArtifacts),
    entries,
  };

  writeJson(authStateHealthPath, health);
  return health;
}

function cleanupStaleBrowserProcesses() {
  const platform = process.platform;
  const patterns =
    platform === 'darwin'
      ? [
          'playwright/lib/common/process.js',
          'pw_run.sh --inspector-pipe',
          'chrome-headless-shell',
          'Google Chrome for Testing',
          'ms-playwright/chromium',
          'ms-playwright/webkit',
        ]
      : [
          'playwright/lib/common/process.js',
          'pw_run.sh --inspector-pipe',
          'chrome-headless-shell',
          'ms-playwright/chromium',
          'ms-playwright/webkit',
        ];

  for (const pattern of patterns) {
    try {
      spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' });
    } catch {
      // best-effort cleanup
    }
  }
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectTestsFromSuites(suites) {
  const tests = [];

  function walkSuite(suite) {
    if (!suite || typeof suite !== 'object') return;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const t of spec.tests || []) {
          const results = Array.isArray(t.results) ? t.results : [];
          const final = results[results.length - 1] || {};
          const mergedAnnotations = [
            ...(Array.isArray(t.annotations) ? t.annotations : []),
            ...results.flatMap((result) =>
              Array.isArray(result.annotations) ? result.annotations : []
            ),
          ];
          tests.push({
            status: final.status || t.status || 'unknown',
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
  if (!payload || !payload.stats) return null;

  const stats = payload.stats || {};
  const tests = collectTestsFromSuites(payload.suites || []);
  const total =
    Number(stats.expected || 0) +
    Number(stats.unexpected || 0) +
    Number(stats.flaky || 0) +
    Number(stats.skipped || 0);
  const failed = tests.filter((item) => failureStatuses.has(String(item.status || ''))).length;
  const blockedSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'blocked')
  ).length;
  const infraBlockedSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'infra-blocked')
  ).length;
  const productBlockedSignals = tests.filter((item) =>
    (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    )
  ).length;
  const notApplicableSignals = tests.filter((item) =>
    (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'not-applicable'
    )
  ).length;
  const partialSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'partial')
  ).length;

  return {
    total,
    passed: Number(stats.expected || 0),
    failed,
    skipped: Number(stats.skipped || 0),
    flaky: Number(stats.flaky || 0),
    blockedSignals,
    infraBlockedSignals,
    productBlockedSignals,
    notApplicableSignals,
    partialSignals,
    durationMs: Number(stats.duration || 0),
    generatedAt: String(stats.startTime || ''),
  };
}

function phaseHasCloudflareSignal(phase) {
  const filePath = phaseReportPaths[phase];
  if (!filePath) return false;
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.suites)) return false;

  const stack = [...payload.suites];
  while (stack.length > 0) {
    const suite = stack.pop();
    if (!suite || typeof suite !== 'object') continue;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const t of spec.tests || []) {
          const annotations = [
            ...(Array.isArray(t.annotations) ? t.annotations : []),
            ...(Array.isArray(t.results)
              ? t.results.flatMap((result) =>
                  Array.isArray(result.annotations) ? result.annotations : []
                )
              : []),
          ];
          for (const ann of annotations) {
            const blob = `${String(ann && ann.type ? ann.type : '')} ${String(
              ann && ann.description ? ann.description : ''
            )}`;
            if (isCloudflareBlocked(blob)) return true;
          }

          for (const result of t.results || []) {
            for (const err of result.errors || []) {
              const message = String(err && err.message ? err.message : '');
              if (isCloudflareBlocked(message)) return true;
            }
            const singleError = String(
              result && result.error && result.error.message ? result.error.message : ''
            );
            if (isCloudflareBlocked(singleError)) return true;
          }
        }
      }
    }

    if (Array.isArray(suite.suites)) stack.push(...suite.suites);
  }

  return false;
}

function collectRunSummary() {
  const phases = {};
  for (const [phase, filePath] of Object.entries(phaseReportPaths)) {
    const summary = summarizePhaseReport(filePath);
    if (summary) phases[phase] = summary;
  }

  const totals = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    blockedSignals: 0,
    infraBlockedSignals: 0,
    productBlockedSignals: 0,
    notApplicableSignals: 0,
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
    totals.infraBlockedSignals += Number(item.infraBlockedSignals || 0);
    totals.productBlockedSignals += Number(item.productBlockedSignals || 0);
    totals.notApplicableSignals += Number(item.notApplicableSignals || 0);
    totals.partialSignals += item.partialSignals;
    totals.durationMs += item.durationMs;
  }

  return { phases, totals };
}

function evaluateRunKpis(summary) {
  const phases = (summary && summary.phases) || {};
  const totals = (summary && summary.totals) || {};
  const checks = [];
  const blockedRatio =
    Number(totals.total || 0) > 0
      ? Number(totals.blockedSignals || 0) / Number(totals.total || 1)
      : 0;
  const infraBlockedRatio =
    Number(totals.total || 0) > 0
      ? Number(totals.infraBlockedSignals || 0) / Number(totals.total || 1)
      : 0;
  const precheckCloudflareSignal = phaseHasCloudflareSignal('precheck');
  const wafGraceApplied =
    kpiWafGraceEnabled &&
    (precheckCloudflareSignal ||
      (blockedRatio >= kpiWafGraceMinBlockedRatio &&
        infraBlockedRatio >= kpiWafGraceMinInfraRatio));
  const wafGraceReason = wafGraceApplied
    ? precheckCloudflareSignal
      ? 'Precheck contains Cloudflare/WAF challenge signals.'
      : `Blocked ratios exceed WAF grace thresholds (blocked=${blockedRatio.toFixed(3)}, infra=${infraBlockedRatio.toFixed(3)}).`
    : '';

  const pushCheck = ({ id, label, actual, threshold, passed, applicable = true, detail = '' }) => {
    checks.push({
      id,
      label,
      applicable,
      actual,
      threshold,
      passed: applicable ? Boolean(passed) : true,
      detail,
    });
  };

  pushCheck({
    id: 'blocked-ratio',
    label: 'Blocked signals ratio',
    actual: blockedRatio,
    threshold: kpiThresholds.maxBlockedRatio,
    passed: blockedRatio <= kpiThresholds.maxBlockedRatio,
    applicable: Number(totals.total || 0) > 0 && !wafGraceApplied,
    detail:
      `${Number(totals.blockedSignals || 0)}/${Number(totals.total || 0)}` +
      (wafGraceApplied ? ' (waived due to Cloudflare/WAF-dominated run)' : ''),
  });

  pushCheck({
    id: 'infra-blocked-ratio',
    label: 'Infra-blocked signals ratio',
    actual: infraBlockedRatio,
    threshold: kpiThresholds.maxInfraBlockedRatio,
    passed: infraBlockedRatio <= kpiThresholds.maxInfraBlockedRatio,
    applicable: Number(totals.total || 0) > 0 && !wafGraceApplied,
    detail:
      `${Number(totals.infraBlockedSignals || 0)}/${Number(totals.total || 0)}` +
      (wafGraceApplied ? ' (waived due to Cloudflare/WAF-dominated run)' : ''),
  });

  const providerMatrix = readJson(providerMatrixArtifactPath);
  const providerResults = Array.isArray(providerMatrix && providerMatrix.results)
    ? providerMatrix.results
    : [];
  const providerPassed = Number(
    (providerMatrix && providerMatrix.summary && providerMatrix.summary.passed) ||
      providerResults.filter((item) => String(item && item.status) === 'passed').length ||
      0
  );
  const providerApplicable = providerResults.length > 0 || Boolean(phases.casino);
  const providerAllBlockedByChallenge =
    providerResults.length > 0 && providerResults.every((row) => isProviderRowChallengeBlocked(row));
  pushCheck({
    id: 'provider-passed',
    label: 'Provider real-launch passed count',
    actual: providerPassed,
    threshold: kpiThresholds.minProviderPassed,
    passed: providerPassed >= kpiThresholds.minProviderPassed,
    applicable: providerApplicable && !(wafGraceApplied && providerAllBlockedByChallenge),
    detail: providerResults.length
      ? `${providerPassed}/${providerResults.length}` +
        (wafGraceApplied && providerAllBlockedByChallenge
          ? ' (waived: all provider rows are Cloudflare/WAF blocked)'
          : '')
      : `provider-results=${providerResults.length}`,
  });

  const depositInventory = readJson(depositInventoryArtifactPath);
  const depositApiItems = Number(
    depositInventory && depositInventory.apiInventory && depositInventory.apiInventory.itemsCount
      ? depositInventory.apiInventory.itemsCount
      : 0
  );
  const depositUiTiles = Number(
    depositInventory && depositInventory.uiInventory && depositInventory.uiInventory.totalTiles
      ? depositInventory.uiInventory.totalTiles
      : 0
  );
  const depositBlocked = Boolean(depositInventory && depositInventory.blocked);
  const depositApplicable = kpiThresholds.requireDepositUiWhenApiPresent && depositApiItems > 0;
  pushCheck({
    id: 'deposit-ui-vs-api',
    label: 'Deposit UI coverage present when API has methods',
    actual: depositUiTiles,
    threshold: depositApiItems > 0 ? 1 : 0,
    passed: depositBlocked ? true : depositUiTiles > 0,
    applicable: depositApplicable,
    detail: `apiItems=${depositApiItems}, uiTiles=${depositUiTiles}, blocked=${depositBlocked}`,
  });

  if (process.env.PW_VISUAL_REQUIRED === '1') {
    const visualPhase = phases.visual || {};
    const visualTotal = Number(visualPhase.total || 0);
    const visualFailed = Number(visualPhase.failed || 0);
    const visualBlocked = Number(visualPhase.blockedSignals || 0);

    pushCheck({
      id: 'visual-executed',
      label: 'Visual gate executed',
      actual: visualTotal,
      threshold: 1,
      passed: visualTotal >= 1,
      applicable: true,
      detail: `visualTotal=${visualTotal}`,
    });

    pushCheck({
      id: 'visual-no-failures',
      label: 'Visual gate failed tests',
      actual: visualFailed,
      threshold: 0,
      passed: visualFailed === 0,
      applicable: true,
      detail: `visualFailed=${visualFailed}`,
    });

    pushCheck({
      id: 'visual-no-blocked',
      label: 'Visual gate blocked signals',
      actual: visualBlocked,
      threshold: 0,
      passed: visualBlocked === 0,
      applicable: true,
      detail: `visualBlocked=${visualBlocked}`,
    });
  }

  const failedChecks = checks.filter((item) => item.applicable && !item.passed);
  const valid = failedChecks.length === 0;
  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds: kpiThresholds,
    totals,
    phases,
    waivers: {
      wafGraceEnabled: kpiWafGraceEnabled,
      wafGraceApplied,
      wafGraceReason,
      precheckCloudflareSignal,
      providerAllBlockedByChallenge,
      minBlockedRatio: kpiWafGraceMinBlockedRatio,
      minInfraRatio: kpiWafGraceMinInfraRatio,
    },
    valid,
    failedChecks,
    checks,
  };
  writeJson(kpiValidationPath, payload);
  return payload;
}

function hostSlugFromBaseUrl(baseUrl) {
  try {
    const hostname = new URL(String(baseUrl || '')).hostname || '';
    return String(hostname)
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-');
  } catch {
    return '';
  }
}

function fileDescriptor(filePath) {
  const absolute = String(filePath || '').trim();
  if (!absolute) return { path: '', exists: false, bytes: 0 };
  try {
    if (!fs.existsSync(absolute)) return { path: absolute, exists: false, bytes: 0 };
    const stat = fs.statSync(absolute);
    return { path: absolute, exists: true, bytes: Number(stat.size || 0) };
  } catch {
    return { path: absolute, exists: false, bytes: 0 };
  }
}

function collectRunArtifactIndex(baseUrl) {
  const hostSlug = hostSlugFromBaseUrl(baseUrl) || projectPaths.brandSlug;
  const rootReportMd = path.join(projectPaths.projectRoot, 'qa-report.md');
  const rootReportHtml = path.join(projectPaths.projectRoot, 'qa-report.html');
  const rootPdfByHost = path.join(projectPaths.autotestReportDir, `${hostSlug}.pdf`);
  const rootPdfByBrand = path.join(projectPaths.autotestReportDir, `${projectPaths.brandSlug}.pdf`);
  const reportPdf = fs.existsSync(rootPdfByHost) ? rootPdfByHost : rootPdfByBrand;

  return {
    rootReportMd: fileDescriptor(rootReportMd),
    rootReportHtml: fileDescriptor(rootReportHtml),
    reportPdf: fileDescriptor(reportPdf),
    bugsIndexJson: fileDescriptor(path.join(projectPaths.autotestReportDir, 'Bugs', 'index.json')),
    bugsIndexMd: fileDescriptor(path.join(projectPaths.autotestReportDir, 'Bugs', 'index.md')),
    screenshotsManifest: fileDescriptor(
      path.join(projectPaths.autotestReportDir, 'Screenshots', 'manifest.json')
    ),
    providerMatrix: fileDescriptor(providerMatrixArtifactPath),
    depositInventory: fileDescriptor(depositInventoryArtifactPath),
    depositMethods: fileDescriptor(depositMethodArtifactPath),
    authStateHealth: fileDescriptor(authStateHealthPath),
    kpiValidation: fileDescriptor(kpiValidationPath),
  };
}

function captureRunHistory({ baseUrl, runStatus, summary, kpi, authStateHealth }) {
  const runSummary = summary || collectRunSummary();
  const phases = runSummary.phases || {};
  const totals = runSummary.totals || {};
  const timestamp = new Date().toISOString();
  const payload = {
    runId: qaRunId,
    timestamp,
    runStatus,
    brandSlug: projectPaths.brandSlug,
    baseUrl,
    nodeVersion: process.version,
    phases,
    totals,
    kpi: kpi || null,
    authStateHealth: authStateHealth || readJson(authStateHealthPath) || null,
    artifacts: collectRunArtifactIndex(baseUrl),
  };

  try {
    fs.mkdirSync(runHistoryDir, { recursive: true });
    const stamp = timestamp.replace(/[:.]/g, '-');
    const filePath = path.join(runHistoryDir, `${stamp}--${qaRunId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { filePath, payload };
  } catch {
    return { filePath: '', payload: null };
  }
}

function resetPhaseReports() {
  for (const reportPath of Object.values(phaseReportPaths)) {
    try {
      if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    } catch {
      // best-effort cleanup
    }
  }
  for (const extraPath of [authStateHealthPath, kpiValidationPath]) {
    try {
      if (fs.existsSync(extraPath)) fs.unlinkSync(extraPath);
    } catch {
      // best-effort cleanup
    }
  }
}

function resetPhaseTestResults() {
  try {
    fs.rmSync(phaseTestResultsDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function snapshotPhaseReport(phase) {
  const targetPath = phaseReportPaths[phase];
  if (!targetPath) return;
  try {
    if (!fs.existsSync(reportJsonPath)) return;
    fs.mkdirSync(phaseReportDir, { recursive: true });
    fs.copyFileSync(reportJsonPath, targetPath);
  } catch {
    // best-effort snapshot
  }
}

function snapshotPhaseTestResults(phase) {
  if (!phase) return;
  try {
    if (!fs.existsSync(reportDir)) return;
    const targetDir = path.join(phaseTestResultsDir, phase);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(reportDir, targetDir, { recursive: true });
  } catch {
    // best-effort snapshot
  }
}

function resetRegistrationChainArtifacts() {
  for (const filePath of registrationChainArtifacts) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // best-effort cleanup
    }
  }
}

async function runSuiteWithRetry({
  tests,
  label,
  primaryBrowser = 'chromium',
  fallbackBrowser,
  envOverride = {},
  shardArg = '',
}) {
  const shardValue = String(shardArg || '').trim();
  const primaryArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
  const primaryEnv = {
    ...browserEnv(primaryBrowser),
    PW_PROJECT_MATRIX: suitesProjectMatrix,
  };

  console.log(`\n> npx ${primaryArgs.join(' ')}`);
  let result = await runPlaywright(primaryArgs, { ...primaryEnv, ...envOverride });
  let browserUsed = primaryBrowser;

  if (result.code !== 0 && isCloudflareBlocked(result.output) && fallbackBrowser) {
    const fallbackArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
    console.log(
      `\n⚠️  ${label}: Cloudflare/WAF detected on ${primaryBrowser}. Switching to ${fallbackBrowser}.`
    );
    console.log(`\n> npx ${fallbackArgs.join(' ')}`);
    result = await runPlaywright(fallbackArgs, {
      ...browserEnv(fallbackBrowser),
      PW_PROJECT_MATRIX: suitesProjectMatrix,
      ...envOverride,
    });
    browserUsed = fallbackBrowser;
    return { result, browserUsed };
  }

  let attempt = 1;
  const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);
  const maxAttempts = mobileMatrixRun ? 4 : 3;
  while (result.code !== 0 && attempt < maxAttempts) {
    const shouldRetry =
      crashpadHints.some((re) => re.test(result.output)) ||
      networkTransientHints.some((re) => re.test(result.output)) ||
      (mobileMatrixRun && timeoutHints.some((re) => re.test(result.output)));
    if (!shouldRetry) break;

    attempt += 1;
    const retryReason = crashpadHints.some((re) => re.test(result.output))
      ? 'crashpad/browser shutdown'
      : networkTransientHints.some((re) => re.test(result.output))
        ? 'transient network error'
        : 'mobile timeout instability';
    console.log(`\n⚠️  ${label}: Detected ${retryReason}. Retrying (${attempt}/${maxAttempts})...`);
    result = await runPlaywright(primaryArgs, { ...primaryEnv, ...envOverride });
  }

  if (result.code !== 0 && fallbackBrowser) {
    const shouldFallback =
      crashpadHints.some((re) => re.test(result.output)) || isCloudflareBlocked(result.output);

    if (shouldFallback) {
      const fallbackArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
      console.log(
        `\n⚠️  ${label}: ${primaryBrowser} is unstable/blocked. Trying ${fallbackBrowser} fallback...`
      );
      console.log(`\n> npx ${fallbackArgs.join(' ')}`);
      result = await runPlaywright(fallbackArgs, {
        ...browserEnv(fallbackBrowser),
        PW_PROJECT_MATRIX: suitesProjectMatrix,
        ...envOverride,
      });
      browserUsed = fallbackBrowser;
    }
  }

  return { result, browserUsed };
}

(async () => {
  const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
  let activeBrowser = 'chromium';
  let authStateHealthLatest = null;
  fs.mkdirSync(projectPaths.projectRoot, { recursive: true });
  fs.mkdirSync(projectPaths.artifactsDir, { recursive: true });
  fs.mkdirSync(projectPaths.testResultsDir, { recursive: true });
  fs.mkdirSync(projectPaths.autotestReportDir, { recursive: true });
  fs.mkdirSync(projectPaths.analyzeDir, { recursive: true });
  console.log(`\nℹ️  Project workspace: ${projectPaths.projectRoot}`);
  console.log(`\nℹ️  Playwright project matrix for ordered suites: ${suitesProjectMatrix}`);
  console.log(`ℹ️  Playwright project matrix for precheck: ${precheckProjectMatrix}`);
  cleanupStaleBrowserProcesses();
  if (runDoctorPreflight) {
    console.log('\n> node scripts/qa-doctor.js --preflight');
    const doctor = await runNodeScript(path.join('scripts', 'qa-doctor.js'), ['--preflight']);
    if (doctor.code !== 0) {
      console.log('\n❌ QA Doctor preflight failed. Aborting qa:all before test execution.');
      process.exit(doctor.code);
    }
  } else {
    console.log('\nℹ️  QA Doctor preflight skipped by QA_PREFLIGHT_DOCTOR=0.');
  }
  resetPhaseReports();
  resetPhaseTestResults();

  if (requireHeadedLoginBeforeRun && !process.env.CI) {
    if (process.stdin.isTTY) {
      const warmupLabel =
        forceSaveStateWarmupRoutes.length > 0 ? forceSaveStateWarmupRoutes.join(', ') : '(none)';
      console.log(
        `\n⚠️  Headed pre-login is required. Complete login/challenge manually in opened browser (warmup: ${warmupLabel}).`
      );
      const headedLoginCode = await runSaveState(baseUrl, {
        warmupRoutes: forceSaveStateWarmupRoutes,
        warmupStrict: false,
        manual: true,
      });
      if (headedLoginCode === 0) {
        console.log('\n✅ Headed pre-login storageState refresh completed.');
      } else {
        const message = '\n⚠️  Headed pre-login storageState refresh failed.';
        if (requireHeadedLoginStrict) {
          console.log(`${message} PW_REQUIRE_HEADED_LOGIN_STRICT=1, aborting run.`);
          process.exit(headedLoginCode || 1);
        }
        console.log(`${message} Continuing with current session artifacts.`);
      }
    } else {
      const message =
        '\n⚠️  PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=1, but stdin is not interactive (TTY missing).';
      if (requireHeadedLoginStrict) {
        console.log(`${message} PW_REQUIRE_HEADED_LOGIN_STRICT=1, aborting run.`);
        process.exit(1);
      }
      console.log(`${message} Falling back to automatic storageState refresh.`);
    }
  }

  if (autoSaveState && !process.env.CI && forceSaveStateBeforeRun) {
    const warmupLabel =
      forceSaveStateWarmupRoutes.length > 0 ? forceSaveStateWarmupRoutes.join(', ') : '(none)';
    console.log(
      `\n⚠️  Pre-run Cloudflare prep: refreshing storageState before precheck (warmup: ${warmupLabel}).`
    );
    const startupSaveStateCode = await runSaveState(baseUrl, {
      warmupRoutes: forceSaveStateWarmupRoutes,
      warmupStrict: false,
    });
    if (startupSaveStateCode === 0) {
      console.log('\n✅ Pre-run storageState refresh completed.');
    } else {
      console.log(
        '\n⚠️  Pre-run storageState refresh failed; continuing with current session artifacts.'
      );
    }
  }

  authStateHealthLatest = await ensureAuthStateHealth({
    baseUrl,
    phase: 'precheck-bootstrap',
  });

  const precheckArgs = buildPlaywrightArgs(precheckTests);
  console.log(`\n> npx ${precheckArgs.join(' ')}`);
  let precheck = await runPlaywright(precheckArgs, {
    ...browserEnv('chromium'),
    PW_PROJECT_MATRIX: precheckProjectMatrix,
  });

  if (precheck.code !== 0 && isCloudflareBlocked(precheck.output)) {
    if (autoSaveState && !process.env.CI) {
      console.log('\n⚠️  Precheck blocked by Cloudflare/WAF. Attempting storageState refresh...');
      const saveStateCode = await runSaveState(baseUrl);
      if (saveStateCode === 0) {
        console.log(`\n> npx ${precheckArgs.join(' ')}`);
        precheck = await runPlaywright(precheckArgs, {
          ...browserEnv('chromium'),
          PW_PROJECT_MATRIX: precheckProjectMatrix,
        });
        if (precheck.code === 0) {
          activeBrowser = 'chromium';
          console.log('\n✅ Precheck passed on Chromium after storageState refresh.');
        }
      } else {
        console.log('\n⚠️  storageState refresh failed.');
      }
    } else if (autoSaveState && process.env.CI) {
      console.log('\n⚠️  Precheck blocked and CI mode is enabled. Skipping storageState refresh.');
    }

    if (precheck.code !== 0 && preferWebkitOnCloudflare) {
      const webkitPrecheckArgs = buildPlaywrightArgs(precheckTests);
      console.log(
        '\n⚠️  Chromium precheck still blocked after storage refresh. Trying WebKit precheck...'
      );
      console.log(`\n> npx ${webkitPrecheckArgs.join(' ')}`);
      const webkitPrecheck = await runPlaywright(webkitPrecheckArgs, {
        ...browserEnv('webkit'),
        PW_PROJECT_MATRIX: precheckProjectMatrix,
      });
      if (webkitPrecheck.code === 0) {
        precheck = webkitPrecheck;
        activeBrowser = 'webkit';
        console.log('\n✅ Precheck passed on WebKit. Ordered suites will run on WebKit first.');
      }
    }
  }
  snapshotPhaseReport('precheck');
  snapshotPhaseTestResults('precheck');

  if (precheck.code !== 0 && !softPrecheck) {
    console.log('\n❌ Precheck failed. Skipping full suite.');
    const report = await runNodeScript(path.join('scripts', 'qa-report.js'));
    const artifacts = await runNodeScript(path.join('scripts', 'qa-artifacts.js'));
    if (report.code !== 0) process.exit(report.code);
    if (artifacts.code !== 0) process.exit(artifacts.code);
    process.exit(precheck.code);
  }

  if (precheck.code !== 0 && softPrecheck) {
    console.log('\n⚠️  Precheck failed, but continuing because PW_PRECHECK_SOFT=1.');
  }

  if (useAiGeneration) {
    console.log('\n> node analyze/runAll.js');
    const ai = await runNodeScript(path.join('analyze', 'runAll.js'));
    if (ai.code !== 0) {
      const message = '\n⚠️  AI generation pipeline failed.';
      if (aiRequired) {
        console.log(`${message} PW_AI_REQUIRED=1, aborting run.`);
        process.exit(ai.code);
      }
      console.log(`${message} Continuing without blocking suites.`);
    }
  } else {
    console.log('\nℹ️  AI generation skipped by default. Set PW_USE_AI_GENERATION=1 to enable it.');
  }

  let firstFailedCode = 0;
  let browserForNextPhase = activeBrowser;
  let providerCasinoRecoveryNeeded = false;
  const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);

  if (mobileMatrixRun && precheck.code !== 0 && isCloudflareBlocked(precheck.output || '')) {
    providerCasinoRecoveryNeeded = true;
    console.log(
      '\n⚠️  Mobile precheck is Cloudflare-blocked. Will refresh storageState on casino routes before provider checks.'
    );
  }

  if (selectedOrderedSuites.length === 0) {
    console.log(
      '\n⚠️  No ordered suites selected (check PW_SUITES_ONLY/PW_SUITES_SKIP). Continuing with report generation.'
    );
  }

  for (const suite of selectedOrderedSuites) {
    if (suite.key === 'registration') {
      resetRegistrationChainArtifacts();
    }

    const suiteEnv = { ...(suite.env || {}) };
    if (suite.key === 'casino') {
      suiteEnv.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED =
        suiteEnv.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED || '0';
      suiteEnv.PW_PROVIDER_REQUIRE_HISTORY_MATCH =
        suiteEnv.PW_PROVIDER_REQUIRE_HISTORY_MATCH || '1';

      authStateHealthLatest = await ensureAuthStateHealth({
        baseUrl,
        phase: 'before-casino-suite',
      });
      if (!authStateHealthLatest.healthy) {
        providerCasinoRecoveryNeeded = true;
        console.log(
          '\n⚠️  Auth state is not healthy before casino suite; forcing casino route recovery refresh.'
        );
      }

      if (autoSaveState && !process.env.CI && providerCasinoRecoveryNeeded) {
        console.log(
          '\n⚠️  Casino suite pre-recovery: refreshing storageState with /casino and /casino/recent warmup.'
        );
        const recoveryCode = await runSaveState(baseUrl, {
          warmupRoutes: ['/casino/', '/casino/recent/'],
          warmupStrict: false,
        });
        if (recoveryCode === 0) {
          console.log('\n✅ Casino pre-recovery storageState refresh completed.');
        } else {
          console.log('\n⚠️  Casino pre-recovery storageState refresh failed; continuing run.');
        }
      }
    }

    const suiteShardArg = resolveSuiteShardArg(suite.key);
    if (suiteShardArg) {
      console.log(`\nℹ️  ${suite.label}: using shard ${suiteShardArg}.`);
    }

    let run = await runSuiteWithRetry({
      tests: suite.tests,
      label: suite.label,
      primaryBrowser: browserForNextPhase,
      fallbackBrowser:
        browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
      envOverride: suiteEnv,
      shardArg: suiteShardArg,
    });
    snapshotPhaseReport(suite.key);
    snapshotPhaseTestResults(suite.key);
    browserForNextPhase = run.browserUsed || browserForNextPhase;

    let suiteCloudflareBlocked =
      isCloudflareBlocked(run.result.output || '') || phaseHasCloudflareSignal(suite.key);
    if (mobileMatrixRun && suite.key === 'auth' && suiteCloudflareBlocked) {
      providerCasinoRecoveryNeeded = true;
      console.log(
        '\n⚠️  Auth phase is Cloudflare/WAF-blocked on mobile. Casino routes will be refreshed before provider checks.'
      );
    }

    if (
      mobileMatrixRun &&
      mobileStabilizeRerun &&
      suiteCloudflareBlocked &&
      autoSaveState &&
      !process.env.CI &&
      suite.key !== 'registration'
    ) {
      const warmupRoutes =
        suite.key === 'casino' || suite.key === 'livecasino'
          ? ['/casino/', '/casino/recent/']
          : ['/', '/assets/'];
      console.log(
        `\n⚠️  ${suite.label}: mobile stabilization rerun after Cloudflare/WAF signal (refresh + one rerun).`
      );
      const stabilizerCode = await runSaveState(baseUrl, {
        warmupRoutes,
        warmupStrict: false,
      });
      if (stabilizerCode === 0) {
        run = await runSuiteWithRetry({
          tests: suite.tests,
          label: `${suite.label} [mobile-stabilize-rerun]`,
          primaryBrowser: browserForNextPhase,
          fallbackBrowser:
            browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
          envOverride: suiteEnv,
          shardArg: suiteShardArg,
        });
        snapshotPhaseReport(suite.key);
        snapshotPhaseTestResults(suite.key);
        browserForNextPhase = run.browserUsed || browserForNextPhase;
        suiteCloudflareBlocked =
          isCloudflareBlocked(run.result.output || '') || phaseHasCloudflareSignal(suite.key);
      } else {
        console.log('\n⚠️  Mobile stabilization storageState refresh failed; keeping initial run.');
      }
    }

    if (
      suiteCloudflareBlocked &&
      autoSaveState &&
      !process.env.CI &&
      suite.key !== 'registration'
    ) {
      const warmupRoutes =
        suite.key === 'casino' || suite.key === 'livecasino' ? ['/casino/', '/casino/recent/'] : [];
      console.log(
        `\n⚠️  ${suite.label}: Cloudflare/WAF signal detected. Refreshing storageState for downstream phases...`
      );
      const saveStateCode = await runSaveState(baseUrl, { warmupRoutes, warmupStrict: false });
      if (saveStateCode === 0) {
        console.log('\n✅ storageState refreshed successfully.');
      } else {
        console.log(
          '\n⚠️  storageState refresh failed; continuing with current session artifacts.'
        );
      }
    }

    if (!firstFailedCode && run.result.code !== 0) {
      firstFailedCode = run.result.code;
    }
  }

  let destructiveResult = { code: 0 };
  if (!firstFailedCode && includeDestructive) {
    const destructive = await runSuiteWithRetry({
      tests: destructiveTests,
      label: 'Destructive suite',
      primaryBrowser: browserForNextPhase,
      fallbackBrowser:
        browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
    });
    destructiveResult = destructive.result;
    snapshotPhaseReport('destructive');
    snapshotPhaseTestResults('destructive');
  } else if (!includeDestructive) {
    console.log('\nℹ️  Destructive suite skipped. Set PW_INCLUDE_DESTRUCTIVE=1 to run it.');
  }

  const summary = collectRunSummary();
  const kpi = evaluateRunKpis(summary);
  if (kpi && kpi.waivers && kpi.waivers.wafGraceApplied) {
    console.log(`\nℹ️  KPI WAF grace applied: ${kpi.waivers.wafGraceReason || 'Cloudflare/WAF-dominated run.'}`);
  }
  if (!kpi.valid) {
    console.log('\n❌ KPI validation failed. Run is marked invalid.');
    for (const item of kpi.failedChecks || []) {
      console.log(
        `   - ${item.label}: actual=${item.actual}, threshold=${item.threshold}, detail=${item.detail || '-'}`
      );
    }
  } else {
    console.log('\n✅ KPI validation passed.');
  }

  const report = await runNodeScript(path.join('scripts', 'qa-report.js'));
  const artifacts = await runNodeScript(path.join('scripts', 'qa-artifacts.js'));
  const runStatus =
    firstFailedCode !== 0 ||
    destructiveResult.code !== 0 ||
    report.code !== 0 ||
    artifacts.code !== 0 ||
    !kpi.valid
      ? 'FAILED'
      : 'PASSED';
  const history = captureRunHistory({
    baseUrl,
    runStatus,
    summary,
    kpi,
    authStateHealth: authStateHealthLatest,
  });
  const historyPath = history && history.filePath ? history.filePath : '';
  if (historyPath) {
    console.log(`\nℹ️  Run history saved: ${historyPath}`);
    const logIndexArgs = [`--run=${historyPath}`];
    if (process.env.LOKI_PUSH === '1') {
      logIndexArgs.push('--push=1');
    }
    const logIndex = await runNodeScript(path.join('scripts', 'qa-log-index.js'), logIndexArgs);
    if (logIndex.code !== 0) {
      console.log('\n⚠️  Log index update failed, continuing with run exit status.');
    }

    const bugFilingArgs = [`--run=${historyPath}`];
    if (process.env.QA_BUG_AUTOFILING === '1') bugFilingArgs.push('--push=1');
    const bugFiling = await runNodeScript(path.join('scripts', 'qa-bug-filing.js'), bugFilingArgs);
    if (bugFiling.code !== 0) {
      console.log('\n⚠️  Bug filing export failed, continuing with run exit status.');
    }
  }
  const dashboard = await runNodeScript(path.join('scripts', 'qa-trends-dashboard.js'));
  if (dashboard.code !== 0) {
    console.log('\n⚠️  Dashboard generation failed, continuing with run exit status.');
  }

  if (firstFailedCode !== 0) process.exit(firstFailedCode);
  if (destructiveResult.code !== 0) process.exit(destructiveResult.code);
  if (report.code !== 0) process.exit(report.code);
  if (artifacts.code !== 0) process.exit(artifacts.code);
  if (!kpi.valid) process.exit(2);
})();
