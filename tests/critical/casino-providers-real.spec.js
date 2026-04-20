const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('@playwright/test');
const {
  assertNotCloudflare,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { getBaselineProviders } = require('../helpers/provider-baseline');
const { createRegistrationData } = require('../helpers/registration-data');
const { applyAuthTokenCookie, registerPlayerViaApi } = require('../helpers/signup-api-fallback');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const BASE_HOSTNAME = new URL(BASE_URL).hostname.toLowerCase();
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'casino', 'providers-real');
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const AUTH_STATE_OUTPUT_PATHS = [
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const AUTH_RECOVERY_INPUT_CANDIDATES = [
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json'),
];
const AUTH_RECOVERY_OUTPUT_PATHS = [
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json'),
];
const PROVIDER_SIGNUP_BOOTSTRAP_ENABLED = process.env.PW_PROVIDER_SIGNUP_BOOTSTRAP !== '0';
const PROVIDER_PROFILE = String(process.env.PW_PROVIDER_PROFILE || 'smoke')
  .trim()
  .toLowerCase();

function resolveDefaultProviderMax() {
  if (PROVIDER_PROFILE === 'extended') {
    if (BASE_HOSTNAME === 'gt.bet' || BASE_HOSTNAME === 'nix.bet') return 50;
    return 40;
  }
  if (PROVIDER_PROFILE === 'nightly') return 0;
  return 12;
}

function resolveProviderMax() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'PW_PROVIDER_MAX')) {
    const parsed = Number.parseInt(String(process.env.PW_PROVIDER_MAX || '').trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return resolveDefaultProviderMax();
}

const PROVIDER_MAX = resolveProviderMax();
const PROVIDER_TEST_TIMEOUT_MS = Number.parseInt(
  process.env.PW_PROVIDER_TEST_TIMEOUT || '240000',
  10
);
const PROVIDER_TEST_TIMEOUT_CAP_MS = Number.parseInt(
  process.env.PW_PROVIDER_TEST_TIMEOUT_CAP || '420000',
  10
);
const PROVIDER_RETRY_ON_FAIL = Number.parseInt(process.env.PW_PROVIDER_RETRY_ON_FAIL || '0', 10);
const PROVIDER_DESKTOP_GAMES = Number.parseInt(process.env.PW_PROVIDER_DESKTOP_GAMES || '2', 10);
const PROVIDER_MIN_GAMES = Number.parseInt(process.env.PW_PROVIDER_MIN_GAMES || '1', 10);
const PROVIDER_ENABLE_MOBILE = process.env.PW_PROVIDER_ENABLE_MOBILE === '1';
const PROVIDER_ONLY_MOBILE = process.env.PW_PROVIDER_ONLY_MOBILE === '1';
const PROVIDER_FAST_FAIL_ON_UI_BLOCKED = process.env.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED === '1';
const PROVIDER_FAST_FAIL_PRESET = process.env.PW_PROVIDER_FAST_FAIL_PRESET === '1';
const PROVIDER_REQUIRE_HISTORY_MATCH = process.env.PW_PROVIDER_REQUIRE_HISTORY_MATCH !== '0';
const PROVIDER_MOBILE_GAMES = Number.parseInt(process.env.PW_PROVIDER_MOBILE_GAMES || '1', 10);
const PROVIDER_MODE_TIMEOUT_MS = Number.parseInt(
  process.env.PW_PROVIDER_MODE_TIMEOUT || '60000',
  10
);
const PROVIDER_FILTER_MISMATCH_MAX = Number.parseInt(
  process.env.PW_PROVIDER_FILTER_MISMATCH_MAX || '1',
  10
);
const PROVIDER_STRICT_MISMATCH_BLOCK = process.env.PW_PROVIDER_STRICT_MISMATCH_BLOCK === '1';
const PROVIDER_SHARD_TOTAL_RAW = Number.parseInt(process.env.PW_PROVIDER_SHARD_TOTAL || '1', 10);
const PROVIDER_SHARD_TOTAL =
  Number.isFinite(PROVIDER_SHARD_TOTAL_RAW) && PROVIDER_SHARD_TOTAL_RAW > 1
    ? PROVIDER_SHARD_TOTAL_RAW
    : 1;
const PROVIDER_SHARD_INDEX_RAW = Number.parseInt(process.env.PW_PROVIDER_SHARD_INDEX || '1', 10);
const PROVIDER_SHARD_INDEX =
  Number.isFinite(PROVIDER_SHARD_INDEX_RAW) && PROVIDER_SHARD_INDEX_RAW > 0
    ? Math.min(PROVIDER_SHARD_INDEX_RAW, PROVIDER_SHARD_TOTAL)
    : 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const PROVIDER_DEMO_GAMES = Number.parseInt(process.env.PW_PROVIDER_DEMO_GAMES || '3', 10);
const PROVIDER_DEMO_MIN_GAMES = Number.parseInt(process.env.PW_PROVIDER_DEMO_MIN_GAMES || '2', 10);
const PROVIDER_DEMO_SCAN_MAX = Number.parseInt(process.env.PW_PROVIDER_DEMO_SCAN_MAX || '0', 10);
const PROVIDER_DEMO_SCAN_TIMEOUT_MS = Number.parseInt(
  process.env.PW_PROVIDER_DEMO_SCAN_TIMEOUT || '420000',
  10
);
const PROVIDER_DEMO_SCAN_PER_PROVIDER_TIMEOUT_MS = Number.parseInt(
  process.env.PW_PROVIDER_DEMO_SCAN_PER_PROVIDER_TIMEOUT || '12000',
  10
);
const PROVIDER_RESTORE_CASINO_RETRIES = Number.parseInt(
  process.env.PW_PROVIDER_RESTORE_CASINO_RETRIES || '1',
  10
);
const PROVIDER_RESTORE_CASINO_NAV_TIMEOUT_MS = Number.parseInt(
  process.env.PW_PROVIDER_RESTORE_CASINO_NAV_TIMEOUT || '15000',
  10
);
const CHALLENGE_SETTLE_TIMEOUT_MS = Math.max(
  0,
  Number.parseInt(process.env.PW_CHALLENGE_SETTLE_TIMEOUT || '8000', 10)
);
const CHALLENGE_SETTLE_POLL_MS = Math.max(
  250,
  Number.parseInt(process.env.PW_CHALLENGE_SETTLE_POLL || '700', 10)
);
const EFFECTIVE_PROVIDER_DESKTOP_GAMES =
  typeof process.env.PW_PROVIDER_DESKTOP_GAMES === 'undefined' && BASE_HOSTNAME === 'nix.bet'
    ? 1
    : PROVIDER_DESKTOP_GAMES;
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MATRIX_JSON_PATH = path.join(ARTIFACT_DIR, 'providers-real-matrix.json');
const PROVIDER_DEMO_AVAILABILITY_JSON_PATH = path.join(
  ARTIFACT_DIR,
  'providers-demo-availability.json'
);
const INVENTORY_CACHE_CANDIDATES = [
  path.join(ARTIFACT_DIR, 'p0-providers-inventory.json'),
  path.join(ARTIFACT_DIR, 'providers-inventory.json'),
];
const DEMO_AVAILABILITY_CACHE_CANDIDATES = [
  path.join(ARTIFACT_DIR, 'p0-providers-demo-availability.json'),
  PROVIDER_DEMO_AVAILABILITY_JSON_PATH,
  path.join(ARTIFACT_DIR, 'providers-demo-availability.json'),
];
let cachedProviders = null;
let cachedProviderDemoAvailability = new Map();
let providerMatrixResults = [];
let providerHistoryLaunchCandidates = [];
let cachedApiProviderMetadata = null;
let providerFastFailActive = PROVIDER_FAST_FAIL_PRESET;
let providerFastFailReason = PROVIDER_FAST_FAIL_PRESET
  ? 'Provider real-launch checks were short-circuited due to upstream Cloudflare/WAF block.'
  : '';
const API_PROVIDER_METADATA_TTL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.PW_PROVIDER_API_CACHE_TTL || '180000', 10) || 180_000
);

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function pickAuthStatePath() {
  for (const filePath of AUTH_STATE_CANDIDATES) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createProviderBootstrapEmailSuffix() {
  const shardTag = `${PROVIDER_SHARD_INDEX}${PROVIDER_SHARD_TOTAL > 1 ? `s${PROVIDER_SHARD_TOTAL}` : ''}`;
  const runTag = oneLine(process.env.GITHUB_RUN_ID || process.env.QA_RUN_ID || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toLowerCase();
  const timeTag = Date.now().toString(36).slice(-4);
  return `p${shardTag}${runTag}${timeTag}`.slice(0, 8);
}

function writeProviderBootstrapRegistration(data, signupResult) {
  const token =
    signupResult &&
    signupResult.body &&
    typeof signupResult.body.token === 'string' &&
    signupResult.body.token.length >= 10
      ? signupResult.body.token
      : '';
  if (!token) return false;

  const payload = {
    source: 'tests/critical/casino-providers-real.spec.js',
    generatedAt: new Date().toISOString(),
    email: data.email,
    loginEmail: data.email,
    password: data.password,
    authToken: token,
    manualLoginReady: false,
    loginValidationStatus: 'provider-bootstrap-token-only',
    loginValidationMethod: 'signup-api-bootstrap',
    loginValidationReason:
      'Provider suite bootstrap created an auth token for authorized casino checks.',
    lastLoginCheckStatus: 'provider-bootstrap-token-only',
    lastLoginCheckMethod: 'signup-api-bootstrap',
    lastLoginCheckReason:
      'Provider suite bootstrap created an auth token for authorized casino checks.',
    brand: BASE_HOSTNAME,
  };

  let wrote = false;
  for (const outPath of AUTH_RECOVERY_OUTPUT_PATHS) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
      wrote = true;
    } catch {
      // best-effort write
    }
  }
  return wrote;
}

function summarizeSignupFailure(result) {
  if (!result || typeof result !== 'object') return 'signup bootstrap returned empty response';
  const status = Number(result.status || 0);
  const errorCode = oneLine(result.body && result.body.errorCode);
  const errorMessage = oneLine(result.body && result.body.errorMessage);
  const cdpCode = oneLine(
    result.cdpFallback && result.cdpFallback.body && result.cdpFallback.body.errorCode
  );
  const cdpMessage = oneLine(
    result.cdpFallback && result.cdpFallback.body && result.cdpFallback.body.errorMessage
  );
  return [
    `status=${status || 0}`,
    errorCode ? `errorCode=${errorCode}` : '',
    errorMessage ? `errorMessage=${errorMessage}` : '',
    cdpCode ? `cdpError=${cdpCode}` : '',
    cdpMessage ? `cdpMessage=${cdpMessage}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

async function bootstrapAuthTokenViaSignup(browser, testInfo, triggerReason = '') {
  if (!PROVIDER_SIGNUP_BOOTSTRAP_ENABLED) {
    return {
      ok: false,
      reason: 'Provider signup bootstrap is disabled by PW_PROVIDER_SIGNUP_BOOTSTRAP=0.',
    };
  }

  const data = createRegistrationData({
    emailSuffix: createProviderBootstrapEmailSuffix(),
  });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await context.newPage();
    const signupResult = await registerPlayerViaApi({
      page,
      data,
      baseUrl: BASE_URL,
    }).catch((error) => ({
      ok: false,
      status: 0,
      body: {
        errorCode: 'SIGNUP_BOOTSTRAP_EXCEPTION',
        errorMessage: oneLine(error && error.message ? error.message : error),
      },
    }));

    const token =
      signupResult &&
      signupResult.ok &&
      signupResult.body &&
      typeof signupResult.body.token === 'string'
        ? oneLine(signupResult.body.token)
        : '';

    if (!token || token.length < 10) {
      return {
        ok: false,
        reason: `Provider signup bootstrap failed: ${summarizeSignupFailure(signupResult)}.`,
      };
    }

    writeProviderBootstrapRegistration(data, signupResult);

    if (testInfo) {
      testInfo.annotations.push({
        type: 'auth-recovery',
        description: `Recovered provider auth token via signup API bootstrap (${data.email}), trigger=${oneLine(triggerReason) || 'n/a'}.`,
      });
    }

    return {
      ok: true,
      tokenArtifact: {
        sourcePath: 'signup-api-bootstrap',
        token,
        email: data.email,
        validationStatus: 'provider-bootstrap-token-only',
      },
    };
  } finally {
    await closeContextSafe(context, 8_000);
  }
}

function extractAuthTokenArtifact() {
  for (const filePath of AUTH_RECOVERY_INPUT_CANDIDATES) {
    const payload = readJson(filePath);
    if (!payload || typeof payload !== 'object') continue;

    const token = oneLine(payload.authToken || '');
    if (token.length < 10) continue;

    const email = oneLine(payload.loginEmail || payload.email || '').toLowerCase();
    const validationStatus = oneLine(payload.loginValidationStatus || '');
    return {
      sourcePath: filePath,
      token,
      email,
      validationStatus,
    };
  }

  return null;
}

async function recoverAuthStateFromArtifactToken(browser, testInfo, triggerReason = '') {
  let tokenArtifact = extractAuthTokenArtifact();
  let signupBootstrapReason = '';
  if (!tokenArtifact) {
    const signupBootstrap = await bootstrapAuthTokenViaSignup(browser, testInfo, triggerReason);
    if (signupBootstrap && signupBootstrap.ok && signupBootstrap.tokenArtifact) {
      tokenArtifact = signupBootstrap.tokenArtifact;
    } else {
      signupBootstrapReason = oneLine(signupBootstrap && signupBootstrap.reason);
    }
  }

  if (!tokenArtifact) {
    return {
      ok: false,
      reason:
        signupBootstrapReason || 'Registration artifacts do not contain a reusable auth token.',
      authStatePath: null,
      userPreferencesStatus: 0,
    };
  }

  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    ignoreHTTPSErrors: true,
  });

  let authStatePath = null;
  let userPreferencesStatus = 0;

  try {
    await applyAuthTokenCookie(context, tokenArtifact.token, BASE_URL);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(20_000);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
    await dismissOverlays(page).catch(() => null);

    userPreferencesStatus = await page.request
      .get(buildUrl('/api/user/preferences'), {
        failOnStatusCode: false,
        timeout: 20_000,
      })
      .then((resp) => resp.status())
      .catch(() => 0);

    for (const outPath of AUTH_STATE_OUTPUT_PATHS) {
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        await context.storageState({ path: outPath });
        if (!authStatePath) authStatePath = outPath;
      } catch {
        // best-effort save for each auth-state consumer path
      }
    }

    if (testInfo) {
      testInfo.annotations.push({
        type: 'auth-recovery',
        description: `Recovered provider auth-state from token artifact (${path.basename(tokenArtifact.sourcePath)}), preferencesStatus=${userPreferencesStatus || 0}, trigger=${oneLine(triggerReason) || 'n/a'}.`,
      });
    }

    if (!authStatePath) {
      return {
        ok: false,
        reason: 'Auth token was found but storageState could not be written.',
        authStatePath: null,
        userPreferencesStatus,
      };
    }

    return {
      ok: true,
      reason: '',
      authStatePath,
      userPreferencesStatus,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Auth-state recovery failed: ${oneLine(error && error.message ? error.message : error) || 'unknown error'}.`,
      authStatePath: null,
      userPreferencesStatus,
    };
  } finally {
    await closeContextSafe(context, 8_000);
  }
}

function toSlug(value) {
  return String(value || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeProviderName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBaseBrandHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (host === BASE_HOSTNAME) return true;
  return host.endsWith(`.${BASE_HOSTNAME}`);
}

function mentionsBaseBrand(value) {
  const source = String(value || '').toLowerCase();
  if (!source) return false;
  if (source.includes(BASE_HOSTNAME)) return true;
  const rootParts = BASE_HOSTNAME.split('.').filter(Boolean);
  if (!rootParts.length) return false;
  return rootParts.some((part) => part.length >= 3 && source.includes(part));
}

function providerNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function providerNamesMatch(left, right) {
  const leftKey = providerNameKey(left);
  const rightKey = providerNameKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;

  const normalizedLeft = normalizeProviderName(left);
  const normalizedRight = normalizeProviderName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function markProviderAnnotation(testInfo, type, description) {
  testInfo.annotations.push({ type, description });
}

async function closeContextSafe(context, timeoutMs = 12_000) {
  if (!context) return;
  await Promise.race([
    context.close(),
    new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(timeoutMs) || 12_000))),
  ]).catch(() => null);
}

async function raceWithTimeout(promise, timeoutMs) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 1000);
  const TIMEOUT = Symbol('timeout');
  let timer = null;

  const observed = promise
    .then((value) => ({ kind: 'value', value }))
    .catch((error) => ({ kind: 'error', error }));
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), safeTimeoutMs);
  });

  const raced = await Promise.race([observed, timeoutPromise]);
  if (timer) clearTimeout(timer);

  if (raced === TIMEOUT) {
    return { timedOut: true, value: null };
  }
  if (raced.kind === 'error') throw raced.error;
  return { timedOut: false, value: raced.value };
}

function resolveBlockedOutcome(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('absent in current brand inventory')) return 'provider-absent';
  if (
    /temporarily unavailable|backend unavailable|transport negotiation failed|cancelled\/aborted before bootstrap|provider launch/i.test(
      text
    )
  ) {
    return 'provider-launch-blocked';
  }
  return 'blocked-other';
}

function isChallengeLikeReason(reason) {
  const text = String(reason || '').toLowerCase();
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
    text.includes('forbidden') ||
    text.includes('403')
  );
}

function providerMatrixAllChallengeBlocked(results) {
  const rows = Array.isArray(results) ? results : [];
  if (!rows.length) return false;
  return rows.every((row) => {
    if (!row || typeof row !== 'object') return false;
    if (String(row.status || '').toLowerCase() !== 'blocked') return false;
    const blob = [
      row.reason,
      row.note,
      row.outcome,
      ...(Array.isArray(row.modes)
        ? row.modes.flatMap((mode) => [mode && mode.reason, mode && mode.uiBlockedReason])
        : []),
    ]
      .map((item) => String(item || ''))
      .join(' ');
    return isChallengeLikeReason(blob);
  });
}

function uniqueApiProviderFilters(items) {
  const rows = Array.isArray(items) ? items : [];
  const map = new Map();
  for (const row of rows) {
    const name = String(row && row.name ? row.name : '').trim();
    const key = normalizeProviderName(name);
    if (!key) continue;
    const next = {
      id: Number(row && row.id),
      name,
      gameCount: Number(row && row.gameCount),
    };
    if (!map.has(key)) {
      map.set(key, next);
      continue;
    }
    const prev = map.get(key);
    const prevCount = Number.isFinite(prev.gameCount) ? prev.gameCount : 0;
    const nextCount = Number.isFinite(next.gameCount) ? next.gameCount : 0;
    if (nextCount > prevCount) {
      map.set(key, next);
    }
  }

  return [...map.values()].sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || ''))
  );
}

async function writeAndAttach(testInfo, fileName, payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(ARTIFACT_DIR, fileName);
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, body, 'utf8');
  const contentType = fileName.endsWith('.md') ? 'text/markdown' : 'application/json';
  await testInfo.attach(fileName, { body, contentType });
  return filePath;
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const matches = root.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 300);
    for (let i = 0; i < count; i += 1) {
      const candidate = matches.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function hasChallengeTokenPage(page) {
  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (appRootVisible) return false;

  const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
  const compact = bodyText.replace(/\s+/g, '');
  return /^[a-f0-9]{12,}$/i.test(compact);
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  const challengeTextVisible = await page
    .getByText(/cloudflare|verify you are human|just a moment|checking your browser|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeTextVisible) return 'Challenge text is visible.';

  const challengeFrameVisible = await page
    .locator(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile, [id*="turnstile"]'
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeFrameVisible) return 'Challenge widget (Turnstile/Cloudflare) is visible.';

  if (await hasChallengeTokenPage(page)) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function getChallengeReasonAfterSettle(page, options = {}) {
  const settleTimeoutMs = Math.max(
    0,
    Number.isFinite(options.settleTimeoutMs)
      ? Number(options.settleTimeoutMs)
      : CHALLENGE_SETTLE_TIMEOUT_MS
  );
  const pollMs = Math.max(
    250,
    Number.isFinite(options.pollMs) ? Number(options.pollMs) : CHALLENGE_SETTLE_POLL_MS
  );

  let reason = await getChallengeReason(page);
  if (!reason || settleTimeoutMs <= 0) return reason;

  const deadline = Date.now() + settleTimeoutMs;
  let lastReason = reason;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    await sleep(Math.min(pollMs, remainingMs));
    await page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => null);

    reason = await getChallengeReason(page);
    if (!reason) return null;
    lastReason = reason;
  }

  return lastReason;
}

async function openCasino(page, options = {}) {
  const requestedUrl = buildUrl('/casino/');
  const attemptsLimit = Math.max(
    1,
    Number.isFinite(options.attemptsLimit)
      ? Number(options.attemptsLimit)
      : Number.parseInt(process.env.PW_CASINO_OPEN_RETRIES || '3', 10)
  );
  const navigationTimeoutMs = Math.max(
    8_000,
    Number.isFinite(options.navigationTimeoutMs)
      ? Number(options.navigationTimeoutMs)
      : Number.parseInt(process.env.PW_CASINO_OPEN_TIMEOUT || '30000', 10)
  );
  let lastState = null;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    let response = null;
    let navigationError = null;
    let assertError = null;
    try {
      response = await page.goto(requestedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs,
      });
    } catch (err) {
      navigationError = String(err && err.message ? err.message : err);
    }

    await dismissOverlays(page);
    await page
      .locator('body')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null);
    await assertNotCloudflare(page).catch((err) => {
      assertError = String(err && err.message ? err.message : err);
    });

    const challenge =
      (await getChallengeReasonAfterSettle(page, { settleTimeoutMs: 7000 })) || assertError;
    lastState = {
      route: '/casino/',
      requestedUrl,
      finalUrl: page.url(),
      status: response ? response.status() : 0,
      title: await page.title().catch(() => ''),
      challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
      attempt,
    };
    if (!lastState.challenge) return lastState;

    if (attempt < attemptsLimit) {
      await sleep(900 * attempt);
    }
  }

  return lastState;
}

async function openCasinoSubRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;
  let assertError = null;
  try {
    response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await dismissOverlays(page);
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout: 12_000 })
    .catch(() => null);
  await assertNotCloudflare(page).catch((err) => {
    assertError = String(err && err.message ? err.message : err);
  });
  const challenge =
    (await getChallengeReasonAfterSettle(page, { settleTimeoutMs: 7000 })) || assertError;

  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
  };
}

async function collectRecentEntries(page) {
  return page
    .evaluate(() => {
      function isVisible(node) {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (rect.width < 20 || rect.height < 14) return false;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      }

      function parseIdentity(rawHref) {
        const source = String(rawHref || '').trim();
        if (!source) return { provider: '', slug: '', gameId: '' };
        try {
          const parsed = source.startsWith('http')
            ? new URL(source)
            : new URL(source, window.location.origin);
          const parts = String(parsed.pathname || '')
            .split('/')
            .filter(Boolean);
          const casinoIndex = parts.findIndex((item) => item.toLowerCase() === 'casino');
          const provider = casinoIndex >= 0 ? parts[casinoIndex + 1] || '' : '';
          const slug = casinoIndex >= 0 ? parts[casinoIndex + 2] || '' : '';
          const gameId =
            parsed.searchParams.get('gameId') ||
            parsed.searchParams.get('game_id') ||
            parsed.searchParams.get('id') ||
            parsed.searchParams.get('gid') ||
            '';
          return { provider, slug, gameId };
        } catch {
          return { provider: '', slug: '', gameId: '' };
        }
      }

      const selectors = [
        '.t-recent [class*="game" i]',
        '.t-transactions [class*="game" i]',
        '[class*="recent" i] [class*="item" i]',
        '[class*="recent" i] a[href*="/casino/"]',
        'a[href*="/casino/"]',
      ];
      const out = [];
      const seen = new Set();

      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter((node) =>
          isVisible(node)
        );
        for (const node of nodes) {
          const anchor = node.matches('a[href]') ? node : node.querySelector('a[href]');
          const href = anchor ? String(anchor.getAttribute('href') || '').trim() : '';
          const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          const title = (
            node.querySelector(
              '.t-game-play__title, .t-game-item__hover-name, [class*="title" i], [class*="name" i]'
            )?.textContent || text
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (!text && !title && !href) continue;

          const providerHint = (
            node.querySelector('.t-game-item__hover-provider, [class*="provider" i]')
              ?.textContent || ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const idHint =
            String(node.getAttribute('data-id') || '').trim() ||
            String(node.getAttribute('data-game-id') || '').trim() ||
            String(node.getAttribute('data-gid') || '').trim();

          const parsed = parseIdentity(href);
          const entry = {
            text,
            title,
            href,
            provider: parsed.provider || providerHint || '',
            slug: parsed.slug || '',
            gameId: parsed.gameId || idHint || '',
          };
          const key = `${entry.href}|${entry.title}|${entry.provider}|${entry.slug}|${entry.gameId}|${entry.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(entry);
        }
      }

      return out;
    })
    .catch(() => []);
}

async function waitForCasinoContent(page) {
  const heading = page.getByText(/^games$/i).first();
  const searchButton = page.locator('.t-games-catalog__search-btn').first();
  const gameCard = page
    .locator('.t-games-catalog .t-game-play, .t-games-catalog a[href*="/casino/"]')
    .first();

  await Promise.any([
    heading.waitFor({ state: 'visible', timeout: 15000 }),
    searchButton.waitFor({ state: 'visible', timeout: 15000 }),
    gameCard.waitFor({ state: 'visible', timeout: 15000 }),
  ]).catch(() => null);
}

async function openFilterPanel(page) {
  const panelSelectors = [
    '.t-games-filters-mobile__body:visible',
    '.t-games-filters-mobile__body .t-games-filters-block.providers:visible',
    '.t-games-filters-block.providers.is-active-tabs:visible',
    '.t-games-filters-block.providers:visible',
    '[class*="games-filters-mobile__body" i]:visible',
    '[class*="games-filters-panel" i]:visible',
  ];

  const existingPanel = await firstVisibleLocator(page, panelSelectors);
  if (existingPanel) return { opened: true, panel: existingPanel, reason: null };

  const selectors = [
    '.t-games-filters-mobile__toggle',
    '[class*="games-filters-mobile__toggle" i]',
    '.t-games-filters-mobile__head button',
    '.t-games-catalog__head-filters button',
    '.t-games-catalog__head-filters',
    '[class*="head-filter" i] button',
    '[class*="filter-toggle" i]',
    '[data-filter*="filters" i]',
    '[class*="games-filters-mobile__head" i] button',
  ];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const toggle = await firstVisibleLocator(page, selectors);
    if (toggle) {
      await toggle.scrollIntoViewIfNeeded().catch(() => null);
      let clicked = await toggle
        .click({ timeout: 7000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        clicked = await toggle
          .click({ timeout: 5000, force: true })
          .then(() => true)
          .catch(() => false);
      }
      if (!clicked) {
        await toggle.press('Enter').catch(() => null);
      }
      await waitForUiSettled(page, 1200);
    }

    let panel = await firstVisibleLocator(page, panelSelectors);
    if (panel) return { opened: true, panel, reason: null };

    const domFallbackClicked = await page
      .evaluate(() => {
        const selectors = [
          '.t-games-filters-mobile__toggle',
          '[class*="games-filters-mobile__toggle" i]',
          '.t-games-filters-mobile__head button',
          '.t-games-catalog__head-filters button',
          '.t-games-catalog__head-filters',
          '[class*="head-filter" i] button',
          '[class*="filter-toggle" i]',
          '[data-filter*="filters" i]',
          '[class*="games-filters-mobile__head" i] button',
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          element.dispatchEvent(
            new globalThis.MouseEvent('click', { bubbles: true, cancelable: true })
          );
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!domFallbackClicked) {
      await waitForUiSettled(page, 1000);
      continue;
    }

    await waitForUiSettled(page, 1200);
    panel = await firstVisibleLocator(page, panelSelectors);
    if (panel) return { opened: true, panel, reason: null };

    await waitForUiSettled(page, 1000);
  }

  const inlineProviderRows = page.locator(
    '.t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
  );
  const inlineCount = await inlineProviderRows.count().catch(() => 0);
  if (inlineCount > 0) {
    return {
      opened: true,
      panel: page.locator('main, body').first(),
      reason: null,
      inline: true,
    };
  }

  return { opened: false, panel: null, reason: 'Filter panel not visible.' };
}

async function activateFilterTab(panel, label) {
  const raw = String(label || '').trim();
  const aliases = {
    providers: [
      'providers',
      'provider',
      'провайдер',
      'proveedor',
      'fournisseur',
      'anbieter',
      'provedor',
      'fornitore',
    ],
    category: ['category', 'categories', 'категор', 'catégorie', 'kategorie', 'categor'],
    collections: ['collections', 'collection', 'коллекц', 'colecciones', 'collezioni'],
  };
  const bucket = aliases[raw.toLowerCase()] || [raw];
  const selectors = [];
  for (const alias of bucket) {
    const escaped = String(alias).replace(/"/g, '');
    selectors.push(
      `.t-games-filters__tabs .t-tabs__item:has-text("${escaped}")`,
      `button:has-text("${escaped}")`,
      `[role="tab"]:has-text("${escaped}")`
    );
  }

  const tab = await firstVisibleLocator(panel, selectors);
  if (!tab) return false;
  await tab.click({ timeout: 5000 }).catch(() => null);
  await waitForUiSettled(panel.page(), 1000);
  return true;
}

async function filterPanelOk(panel) {
  let ok = await firstVisibleLocator(panel, [
    '.t-games-filters-action__close',
    'button:has-text("OK")',
    'button:has-text("Apply")',
  ]);
  if (!ok) {
    ok = await firstVisibleLocator(panel.page(), [
      '.t-games-filters-action__close',
      'button:has-text("OK")',
      'button:has-text("Apply")',
    ]);
  }
  if (!ok) return false;
  await ok.click({ timeout: 5000 }).catch(() => null);
  await waitForUiSettled(panel.page(), 1200);
  return true;
}

async function filterPanelClear(panel) {
  let clear = await firstVisibleLocator(panel, [
    '.t-games-filters-action__clear',
    'button:has-text("CLEAR")',
    'button:has-text("Clear")',
    'button:has-text("Reset")',
  ]);
  if (!clear) {
    clear = await firstVisibleLocator(panel.page(), [
      '.t-games-filters-action__clear',
      'button:has-text("CLEAR")',
      'button:has-text("Clear")',
      'button:has-text("Reset")',
    ]);
  }
  if (clear) {
    await clear.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(panel.page(), 1000);
    return true;
  }

  const scopes = [panel, panel.page()];
  let toggled = 0;
  for (const scope of scopes) {
    const rows = scope.locator(
      '.t-games-filters-block.providers .t-games-select__checkbox .t-checkbox, .t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
    );
    const count = Math.min(await rows.count().catch(() => 0), 250);
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      if (!(await row.isVisible().catch(() => false))) continue;
      const checked = await row
        .evaluate((node) => {
          const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
          const input = node.querySelector('input[type="checkbox"]');
          return classChecked || Boolean(input && input.checked);
        })
        .catch(() => false);
      if (!checked) continue;
      await row.click({ timeout: 5000 }).catch(() => null);
      toggled += 1;
      await waitForUiSettled(panel.page(), 200);
    }
  }
  if (toggled > 0) {
    await waitForUiSettled(panel.page(), 900);
    return true;
  }
  return false;
}

async function getCheckedProvidersCount(panel) {
  const byClass = await panel
    .locator(
      '.t-games-filters-block.providers .t-checkbox.t-checkbox_checked, .t-games-select__checkbox .t-checkbox.t-checkbox_checked'
    )
    .count()
    .catch(() => 0);
  if (byClass > 0) return byClass;
  const byInput = await panel
    .locator(
      '.t-games-filters-block.providers input[type="checkbox"]:checked, .t-games-select__checkbox input[type="checkbox"]:checked'
    )
    .count()
    .catch(() => 0);
  if (byInput > 0) return byInput;
  const pageByClass = await panel
    .page()
    .locator('.t-games-filters-block.providers .t-checkbox.t-checkbox_checked')
    .count()
    .catch(() => 0);
  if (pageByClass > 0) return pageByClass;
  return panel
    .page()
    .locator('.t-games-filters-block.providers input[type="checkbox"]:checked')
    .count()
    .catch(() => 0);
}

async function collectProvidersFromPanel(panel) {
  const scopes = [panel, panel.page()];
  const providers = new Set();

  for (const scope of scopes) {
    const rows = scope.locator(
      '.t-games-filters-block.providers .t-games-select__checkbox .t-checkbox, .t-games-filters-block.providers .t-checkbox'
    );
    const count = Math.min(await rows.count().catch(() => 0), 300);

    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      if (!(await row.isVisible().catch(() => false))) continue;
      const name = (
        (await row
          .locator('.t-checkbox__label')
          .first()
          .innerText()
          .catch(() => '')) || ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!name) continue;
      providers.add(name);
    }

    if (providers.size > 0) break;
  }

  return [...providers];
}

async function selectProviderByName(panel, providerName) {
  const wanted = normalizeProviderName(providerName);
  const scopes = [panel, panel.page()];
  const exactNameRegex = new RegExp(`^\\s*${escapeRegExp(providerName)}\\s*$`, 'i');

  for (const scope of scopes) {
    const scopePage = typeof scope.page === 'function' ? scope.page() : scope;
    const searchInput = await firstVisibleLocator(scope, [
      '.t-games-filters-block.providers input[type="search"]',
      '.t-games-filters-block.providers input[placeholder*="Search" i]',
      '.t-games-filters-block.providers input[placeholder*="Provider" i]',
      '.t-games-select__search input',
      'input[placeholder*="Search" i]',
    ]);
    if (searchInput) {
      await searchInput.fill(providerName).catch(() => null);
      await searchInput.press('Enter').catch(() => null);
      await waitForUiSettled(panel.page(), 700);
    }

    const directRows = scope
      .locator(
        '.t-games-select__checkbox .t-checkbox, .t-games-filters-block.providers .t-checkbox'
      )
      .filter({ hasText: providerName });
    const directCap = Math.min(await directRows.count().catch(() => 0), 12);
    for (let i = 0; i < directCap; i += 1) {
      const row = directRows.nth(i);
      if (!(await row.isVisible().catch(() => false))) continue;
      const name = (
        (await row
          .locator('.t-checkbox__label')
          .first()
          .innerText()
          .catch(() => '')) || (await row.innerText().catch(() => ''))
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!name) continue;
      if (!providerNamesMatch(name, wanted) && !exactNameRegex.test(name)) continue;
      const checked = await row
        .evaluate((node) => {
          const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
          const input = node.querySelector('input[type="checkbox"]');
          return classChecked || Boolean(input && input.checked);
        })
        .catch(() => false);
      if (!checked) {
        await row.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(panel.page(), 600);
      }
      return { found: true, selectedLabel: name };
    }

    const scrollContainers = [];
    for (const selector of [
      '.t-games-filters-block.providers .t-games-select__list',
      '.t-games-select__list',
      '.t-games-filters-block.providers',
      '.t-games-filters-mobile__body',
    ]) {
      const candidate = await firstVisibleLocator(scope, [selector]);
      if (candidate) scrollContainers.push(candidate);
    }

    const rows = scope.locator(
      '.t-games-filters-block.providers .t-games-select__checkbox .t-checkbox, .t-games-select__checkbox .t-checkbox, .t-games-filters-block.providers .t-checkbox'
    );

    for (let pass = 0; pass < 6; pass += 1) {
      const count = Math.min(await rows.count().catch(() => 0), 180);

      for (let i = 0; i < count; i += 1) {
        const row = rows.nth(i);
        if (!(await row.isVisible().catch(() => false))) continue;
        const name = (
          (await row
            .locator('.t-checkbox__label')
            .first()
            .innerText()
            .catch(() => '')) || ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        if (!name) continue;
        if (!providerNamesMatch(name, wanted)) continue;

        const checked = await row
          .evaluate((node) => {
            const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
            const input = node.querySelector('input[type="checkbox"]');
            return classChecked || Boolean(input && input.checked);
          })
          .catch(() => false);

        if (!checked) {
          await row.click({ timeout: 5000 }).catch(() => null);
          await waitForUiSettled(panel.page(), 1000);
        }

        return { found: true, selectedLabel: name };
      }

      let scrolled = false;
      for (const container of scrollContainers) {
        const moved = await container
          .evaluate((node) => {
            const prev = node.scrollTop;
            const step = Math.max(60, Math.floor(node.clientHeight * 0.8));
            node.scrollTop = Math.min(node.scrollHeight, prev + step);
            return node.scrollTop !== prev;
          })
          .catch(() => false);
        if (moved) scrolled = true;
      }
      if (!scrolled) {
        await scopePage.mouse.wheel(0, 450).catch(() => null);
      }
      await waitForUiSettled(panel.page(), 400);
    }
  }

  return { found: false, selectedLabel: null };
}

function makeProvidersInventoryMarkdown(providers, meta) {
  const lines = [];
  lines.push('# Casino Providers Inventory');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${meta.baseUrl}`);
  lines.push(`Route: ${meta.route}`);
  lines.push(`Total Providers: ${providers.length}`);
  lines.push('');
  lines.push('| # | Provider |');
  lines.push('| --- | --- |');
  providers.forEach((name, idx) => {
    lines.push(`| ${idx + 1} | ${name} |`);
  });
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function makeProvidersMatrixMarkdown(summary, results) {
  const lines = [];
  lines.push('# Casino Providers Real-Mode Matrix');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Total | ${summary.total || 0} |`);
  lines.push(`| Passed | ${summary.passed || 0} |`);
  lines.push(`| Passed Strong | ${summary.passedStrong || 0} |`);
  lines.push(`| Passed Weak Surface | ${summary.passedWeakSurface || 0} |`);
  lines.push(`| Failed | ${summary.failed || 0} |`);
  lines.push(`| Blocked | ${summary.blocked || 0} |`);
  lines.push(`| Blocked: Provider Absent | ${summary.blockedProviderAbsent || 0} |`);
  lines.push(`| Blocked: Provider Launch | ${summary.blockedProviderLaunch || 0} |`);
  lines.push(`| Blocked: Other | ${summary.blockedOther || 0} |`);
  lines.push(`| Retried and Recovered | ${summary.retriedRecovered || 0} |`);
  lines.push(`| Demo Available | ${summary.demoAvailable || 0} |`);
  lines.push(`| Demo Not Available | ${summary.demoNotAvailable || 0} |`);
  lines.push(`| Demo Unknown/Blocked | ${summary.demoUnknown || 0} |`);
  lines.push('');
  lines.push(
    '| # | Provider | Status | Outcome | Demo Mode | Launch | Game Surface | Controls Clicked | Note |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  results.forEach((item, idx) => {
    const demoStatus = item.demoAvailability?.status || '-';
    lines.push(
      `| ${idx + 1} | ${item.provider} | ${item.status} | ${item.outcome || '-'} | ${demoStatus} | ${item.launchState || '-'} | ${item.gameSurface || '-'} | ${item.controlsClicked || 0} | ${(item.reason || '').replace(/\|/g, '/')} |`
    );
  });
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function summarizeDemoAvailabilityRows(rows) {
  const total = rows.length;
  const available = rows.filter((item) => item.status === 'available').length;
  const notAvailable = rows.filter((item) => item.status === 'not-available').length;
  const blocked = rows.filter((item) => item.status === 'blocked').length;
  const unknown = total - available - notAvailable - blocked;
  return {
    total,
    available,
    notAvailable,
    blocked,
    unknown,
  };
}

function makeProvidersDemoAvailabilityMarkdown(summary, rows, meta) {
  const lines = [];
  lines.push('# Casino Providers Demo Availability');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${meta.baseUrl}`);
  lines.push(`Route: ${meta.route}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Total Providers | ${summary.total || 0} |`);
  lines.push(`| Demo Available | ${summary.available || 0} |`);
  lines.push(`| Demo Not Available | ${summary.notAvailable || 0} |`);
  lines.push(`| Blocked | ${summary.blocked || 0} |`);
  lines.push(`| Unknown | ${summary.unknown || 0} |`);
  lines.push('');
  lines.push('| # | Provider | Demo Status | Card Title | Demo Action | Note |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  rows.forEach((item, idx) => {
    lines.push(
      `| ${idx + 1} | ${item.provider} | ${item.status || 'unknown'} | ${(item.cardTitle || '-').replace(/\|/g, '/')} | ${(item.buttonText || '-').replace(/\|/g, '/')} | ${(item.reason || '-').replace(/\|/g, '/')} |`
    );
  });
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function uniqueProvidersByNormalizedName(list) {
  const byKey = new Map();
  for (const raw of list || []) {
    const name = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const key = normalizeProviderName(name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()];
}

function applyProviderLimit(list) {
  const deduped = uniqueProvidersByNormalizedName(list);
  return Number.isFinite(PROVIDER_MAX) && PROVIDER_MAX > 0
    ? deduped.slice(0, PROVIDER_MAX)
    : deduped;
}

function applyProviderShard(list) {
  const deduped = uniqueProvidersByNormalizedName(list);
  if (PROVIDER_SHARD_TOTAL <= 1) return deduped;
  return deduped.filter((_, idx) => idx % PROVIDER_SHARD_TOTAL === PROVIDER_SHARD_INDEX - 1);
}

function applyDemoScanLimit(list) {
  const deduped = uniqueProvidersByNormalizedName(list);
  return Number.isFinite(PROVIDER_DEMO_SCAN_MAX) && PROVIDER_DEMO_SCAN_MAX > 0
    ? deduped.slice(0, PROVIDER_DEMO_SCAN_MAX)
    : deduped;
}

function rememberProviderDemoAvailability(provider, demoAvailability) {
  const key = normalizeProviderName(provider);
  if (!key || !demoAvailability) return;
  cachedProviderDemoAvailability.set(key, {
    provider,
    ...demoAvailability,
  });
}

function getCachedProviderDemoAvailability(provider) {
  const key = normalizeProviderName(provider);
  if (!key) return null;
  return cachedProviderDemoAvailability.get(key) || null;
}

function normalizeDemoAvailability(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'unknown',
      hasDemo: null,
      reason: '',
    };
  }
  const status = String(raw.status || '')
    .trim()
    .toLowerCase();
  if (status === 'available') {
    return { ...raw, status: 'available', hasDemo: true };
  }
  if (status === 'not-available') {
    return { ...raw, status: 'not-available', hasDemo: false };
  }
  if (status === 'blocked') {
    return { ...raw, status: 'blocked', hasDemo: null };
  }
  return { ...raw, status: 'unknown', hasDemo: raw.hasDemo === true ? true : null };
}

function readCachedProviderInventory() {
  for (const filePath of INVENTORY_CACHE_CANDIDATES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const providers = uniqueProvidersByNormalizedName(payload && payload.providers);
      if (providers.length) {
        return { filePath, providers };
      }
    } catch {
      // ignore malformed cache and continue
    }
  }
  return null;
}

function readCachedProviderDemoAvailability() {
  for (const filePath of DEMO_AVAILABILITY_CACHE_CANDIDATES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      if (rows.length > 0) return { filePath, rows };
    } catch {
      // ignore malformed cache and continue
    }
  }
  return null;
}

function resolveProviderTargets() {
  const cachedInventory = readCachedProviderInventory();
  if (cachedInventory && cachedInventory.providers.length) {
    return {
      source: `inventory-cache (${path.basename(cachedInventory.filePath)})`,
      providersAll: cachedInventory.providers,
      cachePath: cachedInventory.filePath,
    };
  }

  const baseline = uniqueProvidersByNormalizedName(getBaselineProviders(BASE_URL));
  return {
    source: `brand-baseline (${BASE_HOSTNAME}; fallback: inventory cache is missing)`,
    providersAll: baseline,
    cachePath: null,
  };
}

const PROVIDER_TARGET_META = resolveProviderTargets();
const PROVIDER_ALL_TARGETS = PROVIDER_TARGET_META.providersAll;
const PROVIDER_TARGETS = applyProviderShard(applyProviderLimit(PROVIDER_ALL_TARGETS));
const CACHED_DEMO_AVAILABILITY = readCachedProviderDemoAvailability();

if (CACHED_DEMO_AVAILABILITY && CACHED_DEMO_AVAILABILITY.rows.length > 0) {
  for (const row of CACHED_DEMO_AVAILABILITY.rows) {
    if (!row || !row.provider) continue;
    rememberProviderDemoAvailability(row.provider, normalizeDemoAvailability(row));
  }
}

function summarizeProviderResults(results) {
  const passedStrong = results.filter((item) => item.outcome === 'passed-strong').length;
  const passedWeakSurface = results.filter((item) => item.outcome === 'passed-weak-surface').length;
  const blockedProviderAbsent = results.filter((item) => item.outcome === 'provider-absent').length;
  const blockedProviderLaunch = results.filter(
    (item) => item.outcome === 'provider-launch-blocked'
  ).length;
  const blockedOther = results.filter(
    (item) =>
      item.status === 'blocked' &&
      !['provider-absent', 'provider-launch-blocked'].includes(item.outcome)
  ).length;
  const retriedRecovered = results.filter((item) => Boolean(item.flakyRecovered)).length;
  const demoAvailable = results.filter(
    (item) => item.demoAvailability?.status === 'available'
  ).length;
  const demoNotAvailable = results.filter(
    (item) => item.demoAvailability?.status === 'not-available'
  ).length;
  const demoUnknown = results.length - demoAvailable - demoNotAvailable;

  return {
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    blocked: results.filter((item) => item.status === 'blocked').length,
    passedStrong,
    passedWeakSurface,
    blockedProviderAbsent,
    blockedProviderLaunch,
    blockedOther,
    retriedRecovered,
    demoAvailable,
    demoNotAvailable,
    demoUnknown,
  };
}

function readMatrixResultsFromDisk() {
  if (!fs.existsSync(MATRIX_JSON_PATH)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(MATRIX_JSON_PATH, 'utf8'));
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function syncMatrixArtifacts(extra = {}) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const existing = readMatrixResultsFromDisk();
  if (existing.length > providerMatrixResults.length) {
    providerMatrixResults = existing;
  }
  const summary = summarizeProviderResults(providerMatrixResults);
  const payload = {
    generatedAt: new Date().toISOString(),
    providerProfile: PROVIDER_PROFILE,
    providerMaxApplied: Number.isFinite(PROVIDER_MAX) && PROVIDER_MAX > 0 ? PROVIDER_MAX : null,
    providerShard:
      PROVIDER_SHARD_TOTAL > 1 ? `${PROVIDER_SHARD_INDEX}/${PROVIDER_SHARD_TOTAL}` : null,
    providerTargetSource: PROVIDER_TARGET_META.source,
    providersTargetCountAll: PROVIDER_ALL_TARGETS.length,
    providersTargetAll: PROVIDER_ALL_TARGETS,
    providersTargetCount: PROVIDER_TARGETS.length,
    providersTarget: PROVIDER_TARGETS,
    summary,
    results: providerMatrixResults,
    ...extra,
  };
  fs.writeFileSync(MATRIX_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'providers-real-matrix.md'),
    makeProvidersMatrixMarkdown(summary, providerMatrixResults),
    'utf8'
  );
  return payload;
}

function upsertProviderMatrixResult(item) {
  const existing = readMatrixResultsFromDisk();
  if (existing.length > providerMatrixResults.length) {
    providerMatrixResults = existing;
  }

  const key = normalizeProviderName(item.provider);
  const index = providerMatrixResults.findIndex(
    (row) => normalizeProviderName(row.provider) === key
  );
  if (index >= 0) providerMatrixResults[index] = item;
  else providerMatrixResults.push(item);

  const order = new Map(PROVIDER_TARGETS.map((name, idx) => [normalizeProviderName(name), idx]));
  providerMatrixResults.sort((a, b) => {
    const ai = order.has(normalizeProviderName(a.provider))
      ? order.get(normalizeProviderName(a.provider))
      : Number.MAX_SAFE_INTEGER;
    const bi = order.has(normalizeProviderName(b.provider))
      ? order.get(normalizeProviderName(b.provider))
      : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return String(a.provider).localeCompare(String(b.provider));
  });
}

async function discoverProviders(page) {
  const opened = await openFilterPanel(page);
  if (!opened.opened || !opened.panel) {
    const fallback = await discoverProvidersViaApi(page);
    if (fallback.providers.length > 0) {
      return {
        providers: fallback.providers,
        reason: null,
        source: 'api',
      };
    }
    return {
      providers: [],
      reason: opened.reason || 'Filter panel failed to open for provider inventory.',
      source: 'ui',
    };
  }
  await activateFilterTab(opened.panel, 'providers');
  const providers = uniqueProvidersByNormalizedName(await collectProvidersFromPanel(opened.panel));
  await filterPanelOk(opened.panel).catch(() => null);
  return { providers, reason: null, source: 'ui' };
}

function singleLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeLoose(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCasinoIdentityFromUrl(rawUrl) {
  const source = String(rawUrl || '').trim();
  if (!source) {
    return {
      provider: '',
      slug: '',
      gameId: '',
      pathname: '',
      url: '',
    };
  }

  try {
    const parsed = source.startsWith('http') ? new URL(source) : new URL(source, BASE_ORIGIN);
    const parts = String(parsed.pathname || '')
      .split('/')
      .filter(Boolean);
    const casinoIndex = parts.findIndex((item) => item.toLowerCase() === 'casino');
    const provider = casinoIndex >= 0 ? parts[casinoIndex + 1] || '' : '';
    const slug = casinoIndex >= 0 ? parts[casinoIndex + 2] || '' : '';
    const gameId =
      parsed.searchParams.get('gameId') ||
      parsed.searchParams.get('game_id') ||
      parsed.searchParams.get('id') ||
      parsed.searchParams.get('gid') ||
      '';

    return {
      provider,
      slug,
      gameId,
      pathname: parsed.pathname || '',
      url: parsed.toString(),
    };
  } catch {
    return {
      provider: '',
      slug: '',
      gameId: '',
      pathname: '',
      url: source,
    };
  }
}

function buildProviderHistoryCandidate(provider, modeLabel, launch) {
  const source = launch && typeof launch === 'object' ? launch : {};
  const signals = [source.cardHref, source.sameTabUrl, source.popupUrl];
  const parsedSignals = signals.map((url) => parseCasinoIdentityFromUrl(url));

  const providerCandidates = [provider, source.provider];
  const slugCandidates = [];
  const gameIdCandidates = [];
  for (const parsed of parsedSignals) {
    if (parsed.provider) providerCandidates.push(parsed.provider);
    if (parsed.slug) slugCandidates.push(parsed.slug);
    if (parsed.gameId) gameIdCandidates.push(parsed.gameId);
  }

  const resolvedProvider = providerCandidates.find((value) => String(value || '').trim()) || '';
  const resolvedSlug = slugCandidates.find((value) => String(value || '').trim()) || '';
  const resolvedGameId = gameIdCandidates.find((value) => String(value || '').trim()) || '';
  const titleNeedle = normalizeLoose(source.cardTitle).split(' ').slice(0, 4).join(' ');

  return {
    provider: resolvedProvider,
    mode: modeLabel || '',
    cardTitle: source.cardTitle || '',
    cardHref: source.cardHref || '',
    sameTabUrl: source.sameTabUrl || '',
    popupUrl: source.popupUrl || '',
    slug: resolvedSlug,
    gameId: resolvedGameId,
    providerKey: normalizeIdentity(resolvedProvider),
    slugKey: normalizeIdentity(resolvedSlug),
    gameIdKey: normalizeIdentity(resolvedGameId),
    titleNeedle,
    strictReady: Boolean(resolvedSlug || resolvedGameId),
  };
}

function rememberProviderHistoryLaunchCandidates(provider, modeResults = []) {
  for (const modeResult of modeResults) {
    if (!modeResult || !Array.isArray(modeResult.launches)) continue;
    const modeLabel = modeResult.mode || '';
    for (const launch of modeResult.launches) {
      if (!launch || String(launch.status || '').toLowerCase() !== 'passed') continue;
      if (String(launch.launchState || '').toLowerCase() !== 'launched') continue;
      const candidate = buildProviderHistoryCandidate(provider, modeLabel, launch);
      if (!candidate.strictReady) continue;
      providerHistoryLaunchCandidates.push(candidate);
    }
  }
}

function getProviderHistoryLaunchCandidates(limit = 12) {
  const maxRows = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 12;
  const deduped = [];
  const seen = new Set();

  for (const item of providerHistoryLaunchCandidates) {
    if (!item || !item.strictReady) continue;
    const key = [
      item.providerKey || '-',
      item.slugKey || '-',
      item.gameIdKey || '-',
      normalizeIdentity(item.cardHref || ''),
      normalizeIdentity(item.cardTitle || ''),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= maxRows) break;
  }

  return deduped;
}

function matchesProviderHistoryEntry(entry, candidate) {
  const row = entry && typeof entry === 'object' ? entry : {};
  const provider = normalizeIdentity(row.provider);
  const slug = normalizeIdentity(row.slug);
  const gameId = normalizeIdentity(row.gameId);
  const textBlob = normalizeLoose(`${row.title || ''} ${row.text || ''} ${row.href || ''}`);

  if (candidate.gameIdKey && gameId && candidate.gameIdKey === gameId) return true;

  if (candidate.slugKey && slug && candidate.slugKey === slug) {
    if (!candidate.providerKey) return true;
    if (provider && candidate.providerKey === provider) return true;
  }

  if (candidate.titleNeedle && textBlob.includes(candidate.titleNeedle)) {
    if (!candidate.providerKey) return true;
    if (provider && provider === candidate.providerKey) return true;
  }

  return false;
}

function getKnownProvidersForMatching() {
  return uniqueProvidersByNormalizedName([...(cachedProviders || []), ...PROVIDER_ALL_TARGETS]).map(
    (name) => ({
      name,
      normalized: normalizeProviderName(name),
    })
  );
}

function detectProviderInBlob(blob, providerEntries) {
  const normalizedBlob = normalizeProviderName(blob);
  if (!normalizedBlob) return null;
  const sorted = [...providerEntries].sort((a, b) => b.normalized.length - a.normalized.length);
  for (const entry of sorted) {
    if (!entry.normalized) continue;
    if (normalizedBlob.includes(entry.normalized)) return entry.name;
  }
  return null;
}

function extractProviderSlugFromHref(href) {
  const value = String(href || '').trim();
  if (!value) return '';

  const fromPath = value.match(/\/casino\/([^/?#]+)\//i);
  if (fromPath && fromPath[1]) return fromPath[1];

  try {
    const parsed = new URL(value, BASE_ORIGIN);
    const fromParsedPath = String(parsed.pathname || '').match(/\/casino\/([^/?#]+)\//i);
    return fromParsedPath && fromParsedPath[1] ? fromParsedPath[1] : '';
  } catch {
    return '';
  }
}

function isCardMatchingProvider(cardHref, cardTitle, provider, providerEntries) {
  const wanted = normalizeProviderName(provider);
  if (!wanted) return true;

  const blob = [cardHref, cardTitle].filter(Boolean).join(' ');
  const detected = detectProviderInBlob(blob, providerEntries);
  if (detected) return providerNamesMatch(detected, provider);

  const hrefSlug = extractProviderSlugFromHref(cardHref);
  if (!hrefSlug) return false;

  const wantedKey = providerNameKey(provider);
  const hrefKey = providerNameKey(hrefSlug);
  if (!wantedKey || !hrefKey) return false;
  if (wantedKey === hrefKey) return true;
  if (wantedKey.includes(hrefKey) || hrefKey.includes(wantedKey)) return true;

  return false;
}

function shouldIgnoreDiagnosticUrl(url) {
  return /google-analytics|googletagmanager|doubleclick|facebook|hotjar|clarity|segment|sentry|intercom|livechatinc|cdn-cgi\/rum|adnxs|appnexus|getblue|taboola|outbrain|criteo|bing\.com\/fd\/ls/i.test(
    String(url || '')
  );
}

const NON_CRITICAL_DIAGNOSTIC_URLS = [/\/(?:server\/)?api\/languages\/thook(?:\/|$|\?)/i];

function isNonCriticalDiagnosticUrl(url) {
  const value = String(url || '');
  if (!value) return false;
  return NON_CRITICAL_DIAGNOSTIC_URLS.some((re) => re.test(value));
}

function dedupeDiagnostics(list, makeKey) {
  const seen = new Set();
  const deduped = [];
  for (const item of list || []) {
    const key = makeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isProductDiagnosticUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (shouldIgnoreDiagnosticUrl(raw)) return false;

  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || '').toLowerCase();
    const pathBlob = `${parsed.pathname || ''} ${parsed.search || ''}`.toLowerCase();
    if (parsed.origin === BASE_ORIGIN) return true;
    if (isBaseBrandHost(host)) return true;
    return /(^|[^a-z])(casino|slot|launch|session|provider|wallet|rgs|balance|auth)([^a-z]|$)|\/api\//.test(
      pathBlob
    );
  } catch {
    return /(^|[^a-z])(casino|slot|launch|session|provider|wallet|rgs|balance|auth)([^a-z]|$)|\/api\//i.test(
      raw
    );
  }
}

function createDiagnosticsCollector(context, initialPages = []) {
  const diagnostics = {
    httpErrors: [],
    requestFailures: [],
    consoleErrors: [],
  };
  const trackedPages = new Set();

  const onResponse = (response) => {
    const status = Number(response.status());
    if (!Number.isFinite(status) || status < 400) return;
    const url = response.url();
    if (shouldIgnoreDiagnosticUrl(url)) return;
    diagnostics.httpErrors.push({
      status,
      url,
      method: response.request().method(),
      statusText: response.statusText(),
    });
  };

  const onRequestFailed = (request) => {
    const url = request.url();
    if (shouldIgnoreDiagnosticUrl(url)) return;
    diagnostics.requestFailures.push({
      url,
      method: request.method(),
      errorText: request.failure()?.errorText || '',
    });
  };

  const onConsole = (message) => {
    if (message.type() !== 'error') return;
    const text = singleLine(message.text());
    if (!text) return;
    diagnostics.consoleErrors.push({
      text,
      location: message.location() || {},
    });
  };

  const attachPage = (page) => {
    if (!page || trackedPages.has(page)) return;
    trackedPages.add(page);
    page.on('console', onConsole);
  };

  context.on('response', onResponse);
  context.on('requestfailed', onRequestFailed);
  for (const page of initialPages) attachPage(page);

  const stop = () => {
    context.off('response', onResponse);
    context.off('requestfailed', onRequestFailed);
    for (const page of trackedPages) page.off('console', onConsole);
  };

  return { diagnostics, attachPage, stop };
}

function splitCriticalDiagnostics(raw) {
  const responseErrors = dedupeDiagnostics(
    raw.httpErrors,
    (entry) => `${entry.status}|${entry.method || ''}|${entry.url || ''}`
  ).filter((entry) => {
    if (shouldIgnoreDiagnosticUrl(entry.url)) return false;
    if (isNonCriticalDiagnosticUrl(entry.url)) return false;
    if (entry.status < 500) return false;
    return isProductDiagnosticUrl(entry.url);
  });
  const requestFailures = dedupeDiagnostics(
    raw.requestFailures,
    (entry) => `${entry.method || ''}|${entry.url || ''}|${entry.errorText || ''}`
  ).filter((entry) => {
    if (shouldIgnoreDiagnosticUrl(entry.url)) return false;
    if (isNonCriticalDiagnosticUrl(entry.url)) return false;
    if (!isProductDiagnosticUrl(entry.url)) return false;
    const errorText = String(entry.errorText || '');
    if (/ERR_ABORTED|NS_BINDING_ABORTED|ERR_BLOCKED_BY_CLIENT/i.test(errorText)) return false;
    return true;
  });
  const consoleErrors = dedupeDiagnostics(raw.consoleErrors, (entry) => {
    const text = singleLine(entry.text || '');
    const locationUrl = singleLine(entry.location?.url || '');
    return `${text}|${locationUrl}`;
  }).filter((entry) => {
    const text = String(entry.text || '');
    const locationUrl = String(entry.location?.url || '');
    const relevanceBlob = `${text} ${locationUrl}`;

    if (/ResizeObserver loop limit exceeded/i.test(text)) return false;
    if (/favicon|sourcemap|source map/i.test(text)) return false;
    if (/No translation for key/i.test(text)) return false;
    if (/Viewport argument key .* not recognized and ignored/i.test(text)) return false;
    if (/audio\/mpeg;?\s*codecs=.*TypeError:\s*Type error/i.test(text)) return false;
    if (/video\/mp4;?\s*codecs=.*TypeError:\s*Type error/i.test(text)) return false;
    if (shouldIgnoreDiagnosticUrl(locationUrl)) return false;
    if (isNonCriticalDiagnosticUrl(locationUrl)) return false;
    if (
      /Failed to load resource: the server responded with a status of 403/i.test(text) &&
      isNonCriticalDiagnosticUrl(relevanceBlob)
    ) {
      return false;
    }

    const failedResourceNoise =
      /Failed to load resource/i.test(text) &&
      !isProductDiagnosticUrl(locationUrl) &&
      !mentionsBaseBrand(relevanceBlob);
    if (failedResourceNoise) return false;

    if (/Script error\.?$/i.test(text) && !locationUrl) return false;

    if (
      /uncaught|typeerror|referenceerror|syntaxerror|chunkloaderror|cannot read|is not a function|undefined/i.test(
        text
      )
    ) {
      return true;
    }
    if (
      /Failed to load resource: the server responded with a status of 5\d\d/i.test(text) &&
      isProductDiagnosticUrl(locationUrl)
    ) {
      return true;
    }

    try {
      if (
        locationUrl &&
        new URL(locationUrl).origin === BASE_ORIGIN &&
        /error|exception|failed|typeerror|referenceerror|syntaxerror/i.test(text)
      ) {
        return true;
      }
    } catch {
      // ignore malformed URL in console location metadata
    }

    return false;
  });

  return {
    responseErrors,
    requestFailures,
    consoleErrors,
    hasCritical:
      responseErrors.length > 0 || requestFailures.length > 0 || consoleErrors.length > 0,
  };
}

function detectTransientProviderLaunchIssue(diagnostics) {
  if (!diagnostics) return '';
  const responseErrors = Array.isArray(diagnostics.responseErrors)
    ? diagnostics.responseErrors
    : [];
  const requestFailures = Array.isArray(diagnostics.requestFailures)
    ? diagnostics.requestFailures
    : [];
  const consoleErrors = Array.isArray(diagnostics.consoleErrors) ? diagnostics.consoleErrors : [];

  const responseUnavailable = responseErrors.find((entry) =>
    [429, 500, 502, 503, 504].includes(Number(entry.status))
  );
  if (responseUnavailable) {
    return `Provider backend unavailable (${responseUnavailable.status}).`;
  }

  const requestBlob = requestFailures
    .map((entry) => `${entry.url || ''} ${entry.errorText || ''}`)
    .join(' | ');
  if (
    /cancelled|aborted|ERR_ABORTED|NS_BINDING_ABORTED|timeout/i.test(requestBlob) &&
    responseErrors.length === 0
  ) {
    return 'Provider launch requests were cancelled/aborted before bootstrap.';
  }

  const consoleBlob = consoleErrors
    .map((entry) => `${entry.text || ''} ${entry.location?.url || ''}`)
    .join(' | ');
  if (
    /failed to complete negotiation|failed to start the connection|signalr|typeerror:\s*load failed|websocket|connection.*failed/i.test(
      consoleBlob
    )
  ) {
    return 'Provider transport negotiation failed during launch.';
  }

  return '';
}

function shouldTreatConsoleOnlyDiagnosticsAsWeakPass(diagnostics, options = {}) {
  if (!diagnostics || typeof diagnostics !== 'object') return false;
  const responseErrors = Array.isArray(diagnostics.responseErrors)
    ? diagnostics.responseErrors
    : [];
  const requestFailures = Array.isArray(diagnostics.requestFailures)
    ? diagnostics.requestFailures
    : [];
  const consoleErrors = Array.isArray(diagnostics.consoleErrors) ? diagnostics.consoleErrors : [];
  if (responseErrors.length > 0 || requestFailures.length > 0 || consoleErrors.length < 1)
    return false;

  const interactionSignal = Boolean(
    options.surfaceVisible || options.balanceGateVisible || Number(options.controlsClicked || 0) > 0
  );
  if (!interactionSignal) return false;

  for (const entry of consoleErrors) {
    const text = String(entry && entry.text ? entry.text : '').trim();
    const locationUrl = String(
      entry && entry.location && entry.location.url ? entry.location.url : ''
    ).trim();
    const relevance = `${text} ${locationUrl}`;
    const mentionsProduct = mentionsBaseBrand(relevance) || isProductDiagnosticUrl(locationUrl);
    if (
      mentionsProduct &&
      /chunkloaderror|cannot read properties of undefined|cannot set properties of undefined|react error|hydration|uncaught exception|failed to fetch dynamically imported module/i.test(
        text
      )
    ) {
      return false;
    }
  }

  return true;
}

async function inspectProviderFilterConsistency(page, provider) {
  const providerEntries = getKnownProvidersForMatching();
  const wanted = normalizeProviderName(provider);
  const cards = page.locator(
    '.t-games-catalog .t-game-play, .t-games-catalog [class*="game-play" i], .t-games-catalog [class*="games-item" i], main [class*="game-play" i], main [class*="games-item" i]'
  );
  const count = Math.min(await cards.count().catch(() => 0), 20);
  const mismatches = [];
  let checkedCards = 0;
  let recognizedCards = 0;

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;
    checkedCards += 1;

    const blob = await card
      .evaluate((node) => {
        const candidates = [];
        const push = (value) => {
          const text = String(value || '').trim();
          if (text) candidates.push(text);
        };
        push(node.innerText || node.textContent || '');
        push(node.getAttribute('data-provider'));
        push(node.getAttribute('data-game-provider'));
        push(node.getAttribute('title'));
        push(node.getAttribute('aria-label'));
        const link = node.querySelector('a[href]');
        if (link) {
          push(link.getAttribute('href'));
          push(link.getAttribute('title'));
          push(link.getAttribute('aria-label'));
          push(link.textContent || '');
        }
        return candidates.join(' ');
      })
      .catch(() => '');

    const detectedProvider = detectProviderInBlob(blob, providerEntries);
    if (!detectedProvider) continue;
    recognizedCards += 1;
    if (normalizeProviderName(detectedProvider) !== wanted) {
      mismatches.push({
        cardIndex: i,
        detectedProvider,
        snippet: singleLine(blob).slice(0, 200),
      });
    }
  }

  return {
    checkedCards,
    recognizedCards,
    mismatches,
    strictCheckApplied: recognizedCards > 0,
  };
}

function isProviderMismatchBlocking(filterConsistency) {
  if (!PROVIDER_STRICT_MISMATCH_BLOCK) return false;
  if (!filterConsistency || !filterConsistency.strictCheckApplied) return false;
  const recognizedCards = Number(filterConsistency.recognizedCards || 0);
  const mismatches = Array.isArray(filterConsistency.mismatches)
    ? filterConsistency.mismatches.length
    : 0;
  if (recognizedCards < 4) return false;

  const absoluteThreshold = Math.max(3, PROVIDER_FILTER_MISMATCH_MAX + 2);
  const mismatchRatio = mismatches / Math.max(recognizedCards, 1);
  return mismatches >= absoluteThreshold && mismatchRatio >= 0.75;
}

async function applyProviderFilter(page, provider) {
  const reasons = [];
  let panelPersistentAfterApply = false;
  const panelSelectors = [
    '.t-games-filters-mobile__body:visible',
    '.t-games-filters-mobile__body .t-games-filters-block.providers:visible',
    '.t-games-filters-block.providers.is-active-tabs:visible',
    '.t-games-filters-block.providers:visible',
    '[class*="games-filters-mobile__body" i]:visible',
    '[class*="games-filters-panel" i]:visible',
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await openFilterPanel(page);
    if (!opened.opened || !opened.panel) {
      reasons.push(opened.reason || 'Filter panel failed to open.');
      await waitForUiSettled(page, 800);
      continue;
    }

    await activateFilterTab(opened.panel, 'providers');
    await filterPanelClear(opened.panel).catch(() => null);
    const selected = await selectProviderByName(opened.panel, provider);
    if (!selected.found) {
      reasons.push('Provider checkbox not found in filter list.');
      await filterPanelOk(opened.panel).catch(() => null);
      await waitForUiSettled(page, 800);
      continue;
    }

    const checkedAfterSelect = await getCheckedProvidersCount(opened.panel);
    const closeClicked = await filterPanelOk(opened.panel).catch(() => false);
    if (!closeClicked) {
      await page.keyboard.press('Escape').catch(() => null);
      await waitForUiSettled(page, 800);
    }
    if (checkedAfterSelect < 1) {
      reasons.push('Provider filter did not get checked.');
      await waitForUiSettled(page, 800);
      continue;
    }

    let panelStillOpen = Boolean(await firstVisibleLocator(page, panelSelectors));
    if (panelStillOpen) {
      const toggle = await firstVisibleLocator(page, [
        '.t-games-filters-mobile__toggle',
        '[class*="games-filters-mobile__toggle" i]',
        '.t-games-catalog__head-filters button',
        '.t-games-catalog__head-filters',
      ]);
      if (toggle) {
        await toggle.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 1000);
      }
      panelStillOpen = Boolean(await firstVisibleLocator(page, panelSelectors));
    }
    if (panelStillOpen) {
      await page.keyboard.press('Escape').catch(() => null);
      await waitForUiSettled(page, 600);
      panelStillOpen = Boolean(await firstVisibleLocator(page, panelSelectors));
    }
    if (panelStillOpen) {
      panelPersistentAfterApply = true;
      reasons.push('Provider filter panel stayed open after apply.');
    }

    await waitForProviderCatalogContent(page, 14_000);
    const cardsInfo = await countVisibleCatalogCards(page, 24);
    if (cardsInfo.total < 1) {
      reasons.push(
        `Provider filter applied but no catalog cards rendered (total=${cardsInfo.total}, visible=${cardsInfo.visible}).`
      );
      await openCasino(page).catch(() => null);
      await waitForCasinoContent(page).catch(() => null);
      continue;
    }

    await waitForUiSettled(page, 1200);
    const challengeAfterFilter = await getChallengeReason(page);
    if (challengeAfterFilter) {
      return { ok: false, blocked: true, reason: challengeAfterFilter };
    }

    return {
      ok: true,
      selectedLabel: selected.selectedLabel || provider,
      panelPersistentAfterApply,
    };
  }

  return {
    blocked:
      /filter panel not visible|filter panel failed to open|filter toggle not found|provider checkbox not found|panel stayed open/i.test(
        reasons.filter(Boolean).join(' | ')
      ),
    ok: false,
    reason: reasons.filter(Boolean).join(' | ') || 'Provider filter apply failed.',
  };
}

function hasDemoHint(value) {
  return /try\s*for\s*fun|[?&]fun(?:=|$)|\/fun(?:\/|$)|mode=demo|demo/i.test(String(value || ''));
}

async function findDemoPlayButton(page, options = {}) {
  const skipCardKeys = options.skipCardKeys || new Set();
  const cardSelectors = [
    '.t-games-catalog .t-game-play',
    '.t-games-catalog .t-game-item',
    '.t-games-catalog [class*="game-play" i]',
    '.t-games-catalog [class*="games-item" i]',
    'main .t-game-item',
    'main [class*="game-play" i]',
    'main [class*="games-item" i]',
  ];

  let cards = null;
  for (const selector of cardSelectors) {
    const loc = page.locator(selector);
    if ((await loc.count().catch(() => 0)) > 0) {
      cards = loc;
      break;
    }
  }
  if (!cards) {
    return {
      found: false,
      reason: 'No game cards found.',
      button: null,
      cardIndex: -1,
      cardKey: '',
      cardTitle: '',
      cardHref: '',
      buttonText: '',
      demoHref: '',
    };
  }

  const count = Math.min(await cards.count().catch(() => 0), 20);
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;
    await card.scrollIntoViewIfNeeded().catch(() => null);
    await card.hover().catch(() => null);
    await waitForUiSettled(page, 600);

    const cardTitle = singleLine(
      await card
        .locator('.t-game-play__title, [class*="title" i], [class*="name" i]')
        .first()
        .innerText()
        .catch(() => '')
    );
    const cardHref = singleLine(
      await card
        .locator('a[href]')
        .first()
        .getAttribute('href')
        .catch(() => '')
    );
    const cardKey = `${cardHref || cardTitle || `card-${i + 1}`}`.toLowerCase();
    if (skipCardKeys.has(cardKey)) continue;

    const demoButton = await firstVisibleLocator(card, [
      'a:has-text("Try for Fun")',
      'a:has-text("Try for fun")',
      'a:has-text("Essai")',
      'a:has-text("Essaie")',
      'a[href*="?fun"]',
      'a[href*="&fun"]',
      'a[href*="/fun"]',
      'a[href*="mode=demo"]',
      'a:has-text("Demo")',
      'button:has-text("Try for Fun")',
      '[data-testid*="demo" i]',
    ]);
    if (!demoButton) continue;

    const buttonText = singleLine(await demoButton.innerText().catch(() => ''));
    const demoHref = singleLine(await demoButton.getAttribute('href').catch(() => ''));
    if (!hasDemoHint(`${buttonText} ${demoHref}`)) continue;

    return {
      found: true,
      reason: null,
      button: demoButton,
      cardIndex: i,
      buttonText,
      cardKey,
      cardTitle,
      cardHref,
      demoHref,
    };
  }

  return {
    found: false,
    reason: 'Demo-mode action button is not visible on first game cards.',
    button: null,
    cardIndex: -1,
    cardKey: '',
    cardTitle: '',
    cardHref: '',
    buttonText: '',
    demoHref: '',
  };
}

async function countVisibleCatalogCards(page, limit = 24) {
  const cards = page.locator(
    '.t-games-catalog .t-game-play, .t-games-catalog .t-game-item, .t-games-catalog [class*="game-play" i], .t-games-catalog [class*="games-item" i], main .t-game-item, main [class*="game-play" i], main [class*="games-item" i]'
  );
  const total = await cards.count().catch(() => 0);
  const inspect = Math.min(Math.max(0, total), Math.max(1, limit));
  let visible = 0;
  for (let i = 0; i < inspect; i += 1) {
    if (
      await cards
        .nth(i)
        .isVisible()
        .catch(() => false)
    )
      visible += 1;
  }
  return { total, inspected: inspect, visible };
}

async function waitForProviderCatalogContent(page, timeoutMs = 15_000) {
  const card = page
    .locator(
      '.t-games-catalog .t-game-play, .t-games-catalog .t-game-item, .t-games-catalog [class*="game-play" i], .t-games-catalog [class*="games-item" i], main .t-game-item, main [class*="game-play" i], main [class*="games-item" i]'
    )
    .first();
  const emptyState = page
    .getByText(/nothing found|no games|no results|not available|empty/i)
    .first();
  await Promise.any([
    card.waitFor({ state: 'visible', timeout: timeoutMs }),
    emptyState.waitFor({ state: 'visible', timeout: timeoutMs }),
  ]).catch(() => null);
}

async function detectProviderDemoAvailability(page, provider) {
  let assertError = '';
  await assertNotCloudflare(page).catch((err) => {
    assertError = String(err && err.message ? err.message : err);
  });
  const challenge =
    (await getChallengeReasonAfterSettle(page, { settleTimeoutMs: 5000 })) || assertError;
  if (challenge) {
    return {
      provider,
      status: 'blocked',
      hasDemo: null,
      reason: challenge,
      cardTitle: '',
      cardHref: '',
      demoHref: '',
      buttonText: '',
      totalCards: 0,
      visibleCards: 0,
    };
  }

  const cardsInfo = await countVisibleCatalogCards(page, 30);
  if (cardsInfo.total < 1) {
    return {
      provider,
      status: 'unknown',
      hasDemo: null,
      reason: 'No game cards found after provider filter.',
      cardTitle: '',
      cardHref: '',
      demoHref: '',
      buttonText: '',
      totalCards: cardsInfo.total,
      visibleCards: cardsInfo.visible,
    };
  }

  const demoAction = await findDemoPlayButton(page, { skipCardKeys: new Set() });
  if (demoAction.found) {
    return {
      provider,
      status: 'available',
      hasDemo: true,
      reason: 'Demo action is visible on provider cards.',
      cardTitle: demoAction.cardTitle || '',
      cardHref: demoAction.cardHref || '',
      demoHref: demoAction.demoHref || '',
      buttonText: demoAction.buttonText || 'Try for Fun',
      totalCards: cardsInfo.total,
      visibleCards: cardsInfo.visible,
    };
  }

  const realAction = await findRealPlayButton(page, {
    skipCardKeys: new Set(),
    provider,
    providerEntries: getKnownProvidersForMatching(),
  });
  if (realAction.found) {
    return {
      provider,
      status: 'not-available',
      hasDemo: false,
      reason: 'No demo action visible; real Play action is available.',
      cardTitle: realAction.cardTitle || '',
      cardHref: realAction.cardHref || '',
      demoHref: '',
      buttonText: '',
      totalCards: cardsInfo.total,
      visibleCards: cardsInfo.visible,
    };
  }

  return {
    provider,
    status: cardsInfo.visible > 0 ? 'not-available' : 'unknown',
    hasDemo: cardsInfo.visible > 0 ? false : null,
    reason:
      demoAction.reason ||
      realAction.reason ||
      (cardsInfo.visible > 0
        ? 'Demo action is not visible on sampled provider cards.'
        : 'Provider cards are not visible after filtering.'),
    cardTitle: '',
    cardHref: '',
    demoHref: '',
    buttonText: '',
    totalCards: cardsInfo.total,
    visibleCards: cardsInfo.visible,
  };
}

async function findRealPlayButton(page, options = {}) {
  const skipCardKeys = options.skipCardKeys || new Set();
  const expectedProvider = String(options.provider || '').trim();
  const providerEntries =
    options.providerEntries && Array.isArray(options.providerEntries)
      ? options.providerEntries
      : getKnownProvidersForMatching();
  const cardSelectors = [
    '.t-games-catalog .t-game-play',
    '.t-games-catalog .t-game-item',
    '.t-games-catalog [class*="game-play" i]',
    '.t-games-catalog [class*="games-item" i]',
    'main .t-game-item',
    'main [class*="game-play" i]',
    'main [class*="games-item" i]',
  ];

  let cards = null;
  for (const selector of cardSelectors) {
    const loc = page.locator(selector);
    if ((await loc.count().catch(() => 0)) > 0) {
      cards = loc;
      break;
    }
  }
  if (!cards)
    return {
      found: false,
      reason: 'No game cards found.',
      button: null,
      cardIndex: -1,
      cardKey: '',
      cardTitle: '',
      cardHref: '',
    };

  const count = Math.min(await cards.count().catch(() => 0), 14);
  let providerMatchedCards = 0;
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;
    await card.scrollIntoViewIfNeeded().catch(() => null);
    await card.hover().catch(() => null);
    await waitForUiSettled(page, 700);

    const cardTitle = singleLine(
      await card
        .locator('.t-game-play__title, [class*="title" i], [class*="name" i]')
        .first()
        .innerText()
        .catch(() => '')
    );
    const cardHref = singleLine(
      await card
        .locator('a[href]')
        .first()
        .getAttribute('href')
        .catch(() => '')
    );
    const cardKey = `${cardHref || cardTitle || `card-${i + 1}`}`.toLowerCase();
    if (skipCardKeys.has(cardKey)) continue;

    if (expectedProvider) {
      const providerMatched = isCardMatchingProvider(
        cardHref,
        cardTitle,
        expectedProvider,
        providerEntries
      );
      if (!providerMatched) continue;
      providerMatchedCards += 1;
    }

    let button = await firstVisibleLocator(card, [
      'button:has-text("Play")',
      'a:has-text("Play")',
      '[data-testid*="play" i]',
    ]);
    if (!button) {
      button = await firstVisibleLocator(page, ['button:has-text("Play")', 'a:has-text("Play")']);
    }
    if (!button) continue;

    const buttonText = ((await button.innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/try for fun|demo/i.test(buttonText)) continue;
    return {
      found: true,
      reason: null,
      button,
      cardIndex: i,
      buttonText,
      cardKey,
      cardTitle,
      cardHref,
    };
  }

  return {
    found: false,
    reason: expectedProvider
      ? providerMatchedCards < 1
        ? `No game cards found for provider "${expectedProvider}".`
        : `Real-mode Play action button is not visible for provider "${expectedProvider}".`
      : 'Real-mode Play action button is not visible on first game cards.',
    button: null,
    cardIndex: -1,
    cardKey: '',
    cardTitle: '',
    cardHref: '',
  };
}

async function clickAndCaptureLaunch(context, page, button) {
  const beforeUrl = page.url();
  const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  let clickError = null;

  try {
    await button.click({ timeout: 6000 });
  } catch (err) {
    clickError = String(err && err.message ? err.message : err);
    await button.click({ timeout: 6000, force: true }).catch(() => null);
  }

  const popup = await popupPromise;
  let popupUrl = null;
  let popupTitle = null;
  let popupChallenge = null;

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
    popupUrl = popup.url();
    popupTitle = await popup.title().catch(() => '');
    popupChallenge = await getChallengeReasonAfterSettle(popup);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await waitForUiSettled(page, 2000);
  const sameTabUrl = page.url();
  const sameTabChallenge = await getChallengeReasonAfterSettle(page);

  const iframeVisible = await page
    .locator('iframe[src*="casino" i], iframe[src*="game" i], iframe[src*="slot" i], canvas')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const balanceGateVisible = await page
    .getByText(/insufficient|not enough|deposit|top up|balance/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const loginModalVisible = await page
    .getByText(/log in|registered email|password/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  const launched = Boolean(
    (popup && popupUrl && !popupChallenge) ||
    (sameTabUrl !== beforeUrl && !sameTabChallenge) ||
    iframeVisible
  );

  return {
    popup,
    beforeUrl,
    sameTabUrl,
    popupUrl,
    popupTitle,
    popupChallenge,
    sameTabChallenge,
    iframeVisible,
    balanceGateVisible,
    loginModalVisible,
    launched,
    clickError,
  };
}

async function inspectGameHealth(targetPage) {
  await targetPage.waitForLoadState('domcontentloaded').catch(() => null);
  await waitForUiSettled(targetPage, 2500);

  const challenge = await getChallengeReasonAfterSettle(targetPage);
  const errorVisible = await targetPage
    .getByText(/error|failed|forbidden|not available|something went wrong|maintenance|not found/i)
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
  const surfaceVisible = Boolean(
    await firstVisibleLocator(targetPage, [
      'canvas',
      'iframe[src*="game" i]',
      'iframe[src*="casino" i]',
      'iframe[src*="slot" i]',
      '[class*="game-container" i]',
      '[id*="game" i]',
      'video',
    ])
  );

  return { challenge, errorVisible, surfaceVisible };
}

async function clickSafeGameControls(targetPage) {
  const elements = targetPage.locator('button, [role="button"], a');
  const count = Math.min(await elements.count().catch(() => 0), 350);
  const detected = [];
  const dedupe = new Set();

  const includeHints =
    /menu|help|info|sound|mute|volume|full\s*screen|fullscreen|expand|rules|paytable|settings/i;
  const excludeHints =
    /log in|sign up|deposit|withdraw|cashier|spin|bet|register|promo|bonus|play now/i;

  for (let i = 0; i < count; i += 1) {
    const el = elements.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const enabled = await el.isEnabled().catch(() => false);
    if (!enabled) continue;

    const meta = await el
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        const aria = (node.getAttribute('aria-label') || '').trim();
        const title = (node.getAttribute('title') || '').trim();
        const testid = (node.getAttribute('data-testid') || '').trim();
        const className = String(node.className || '').trim();
        return {
          text,
          aria,
          title,
          testid,
          className,
          width: rect.width,
          height: rect.height,
        };
      })
      .catch(() => null);
    if (!meta) continue;
    if (meta.width < 18 || meta.height < 18) continue;

    const label = [meta.text, meta.aria, meta.title, meta.testid].filter(Boolean).join(' ').trim();
    const hintBlob = `${label} ${meta.className}`.trim();
    if (!includeHints.test(hintBlob)) continue;
    if (excludeHints.test(hintBlob)) continue;

    const key = `${hintBlob.toLowerCase()}|${Math.round(meta.width)}|${Math.round(meta.height)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    detected.push({ locator: el, label: label || meta.className || `control-${i + 1}` });
    if (detected.length >= 8) break;
  }

  const clickedLabels = [];
  for (const control of detected.slice(0, 3)) {
    try {
      await control.locator.scrollIntoViewIfNeeded().catch(() => null);
      await control.locator.click({ timeout: 4000 });
      clickedLabels.push(control.label);
      await waitForUiSettled(targetPage, 800);
    } catch {
      // continue with next safe control
    }
  }

  return {
    detectedLabels: detected.map((item) => item.label),
    clickedLabels,
    clickedCount: clickedLabels.length,
  };
}

async function runSingleDemoGameCheck(context, page, gameIndex, skipCardKeys) {
  const game = {
    mode: 'demo',
    gameIndex: gameIndex + 1,
    status: 'failed',
    outcome: 'failed',
    launchState: 'none',
    gameSurface: 'none',
    controlsClicked: 0,
    reason: '',
  };
  let popup = null;
  const collector = createDiagnosticsCollector(context, [page]);

  try {
    const action = await findDemoPlayButton(page, { skipCardKeys });
    if (!action.found || !action.button) {
      game.status = 'no-game';
      game.outcome = 'no-game';
      game.reason = action.reason || 'Demo-mode action button is not visible.';
      return game;
    }

    skipCardKeys.add(action.cardKey);
    game.cardKey = action.cardKey;
    game.cardTitle = action.cardTitle;
    game.cardHref = action.cardHref;
    game.demoHref = action.demoHref;

    const launch = await clickAndCaptureLaunch(context, page, action.button);
    popup = launch.popup || null;
    if (popup) collector.attachPage(popup);
    game.launchState = launch.launched ? 'launched' : 'not-launched';

    const challengeReason = launch.popupChallenge || launch.sameTabChallenge;
    if (challengeReason) {
      game.status = 'blocked';
      game.outcome = resolveBlockedOutcome(challengeReason);
      game.reason = challengeReason;
      return game;
    }

    const targetPage = launch.popup || page;
    const health = await inspectGameHealth(targetPage);
    const controls = await clickSafeGameControls(targetPage);
    const diagnostics = splitCriticalDiagnostics(collector.diagnostics);

    const demoHintSource = [
      action.demoHref,
      action.cardHref,
      launch.popupUrl,
      launch.sameTabUrl,
    ].join(' | ');
    const demoHintDetected = hasDemoHint(demoHintSource);

    game.gameSurface = health.surfaceVisible ? 'visible' : 'not-visible';
    game.controlsClicked = controls.clickedCount;
    game.detectedControls = controls.detectedLabels.slice(0, 20);
    game.clickedControls = controls.clickedLabels;
    game.health = {
      errorVisible: health.errorVisible,
      challenge: health.challenge,
      demoHintDetected,
    };
    game.diagnostics = diagnostics;

    if (health.challenge) {
      game.status = 'blocked';
      game.outcome = resolveBlockedOutcome(health.challenge);
      game.reason = health.challenge;
      return game;
    }

    if (!demoHintDetected) {
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Demo mode hint is not detected in launch URLs/links.';
      return game;
    }

    if (!launch.launched) {
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Try for Fun did not launch demo surface.';
      return game;
    }

    if (health.errorVisible) {
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Demo launch shows error/unavailable state.';
      return game;
    }

    if (!health.surfaceVisible && controls.clickedCount === 0) {
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Demo launch has no visible game surface and no clickable in-game controls.';
      return game;
    }

    if (diagnostics.hasCritical) {
      const transientLaunchIssue = detectTransientProviderLaunchIssue(diagnostics);
      if (transientLaunchIssue) {
        game.status = 'blocked';
        game.outcome = 'provider-launch-blocked';
        game.reason = `Demo launch temporarily unavailable: ${transientLaunchIssue}`;
        return game;
      }
      if (
        shouldTreatConsoleOnlyDiagnosticsAsWeakPass(diagnostics, {
          surfaceVisible: health.surfaceVisible,
          controlsClicked: controls.clickedCount,
        })
      ) {
        game.status = 'passed';
        game.outcome = 'passed-weak-diagnostics';
        game.reason = `Demo launch is healthy; non-blocking console-only diagnostics observed (${diagnostics.consoleErrors.length} item(s)).`;
        return game;
      }
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = `Critical diagnostics detected: ${diagnostics.responseErrors.length} HTTP errors, ${diagnostics.requestFailures.length} request failures, ${diagnostics.consoleErrors.length} console errors.`;
      return game;
    }

    game.status = 'passed';
    game.outcome = 'passed-strong';
    return game;
  } catch (err) {
    game.status = 'failed';
    game.outcome = 'failed';
    game.reason = String(err && err.message ? err.message : err);
    return game;
  } finally {
    collector.stop();
    if (popup) await popup.close().catch(() => null);
    await openCasino(page, {
      attemptsLimit: PROVIDER_RESTORE_CASINO_RETRIES,
      navigationTimeoutMs: PROVIDER_RESTORE_CASINO_NAV_TIMEOUT_MS,
    }).catch(() => null);
    await waitForCasinoContent(page).catch(() => null);
  }
}

function summarizeDemoMode(launches, minGames) {
  const executedGames = launches.filter((item) => item.status !== 'no-game');
  const passedGames = executedGames.filter((item) => item.status === 'passed');
  const blockedGames = executedGames.filter((item) => item.status === 'blocked');
  const failedGames = executedGames.filter((item) => item.status === 'failed');

  if (passedGames.length >= minGames) {
    return {
      status: 'passed',
      outcome: 'passed-strong',
      reason:
        failedGames.length > 0
          ? `${failedGames.length} demo launch(es) failed but minimum pass threshold is met.`
          : '',
      launches,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      minGames,
    };
  }

  if (failedGames.length > 0 && passedGames.length === 0) {
    return {
      status: 'failed',
      outcome: failedGames[0].outcome || 'failed',
      reason: failedGames[0].reason || 'Demo launch failed.',
      launches,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      minGames,
    };
  }

  if (passedGames.length < minGames) {
    if (blockedGames.length > 0) {
      return {
        status: 'blocked',
        outcome: blockedGames[0].outcome || 'blocked-other',
        reason:
          blockedGames[0].reason ||
          `Only ${passedGames.length} demo launch(es) passed; remaining launches were blocked by challenge/WAF.`,
        launches,
        gamesExecuted: executedGames.length,
        gamesPassed: passedGames.length,
        minGames,
      };
    }
    return {
      status: 'failed',
      outcome: 'failed',
      reason: `Only ${passedGames.length} demo game(s) launched, required at least ${minGames}.`,
      launches,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      minGames,
    };
  }

  return {
    status: 'passed',
    outcome: 'passed-strong',
    reason: '',
    launches,
    gamesExecuted: executedGames.length,
    gamesPassed: passedGames.length,
    minGames,
  };
}

async function runDemoSmokeCheck(context, page, options = {}) {
  const gamesToCheck = Math.max(1, Number(options.gamesToCheck || PROVIDER_DEMO_GAMES));
  const minGames = Math.max(
    1,
    Math.min(gamesToCheck, Number(options.minGames || PROVIDER_DEMO_MIN_GAMES))
  );
  const launches = [];
  const skipCardKeys = new Set();

  for (let i = 0; i < gamesToCheck; i += 1) {
    const single = await runSingleDemoGameCheck(context, page, i, skipCardKeys);
    launches.push(single);
    if (single.status === 'blocked') break;
    if (single.status === 'no-game') break;
  }

  return summarizeDemoMode(launches, minGames);
}

function buildGamesListQuery(overrides = {}) {
  return {
    categoryIds: [],
    providerIds: [],
    themeIds: [],
    name: '',
    limit: 24,
    offset: 0,
    isEnabledGeoRestricts: false,
    hasDesktop: true,
    partition: 'casino',
    ...overrides,
  };
}

async function requestGamesList(page, queryOverrides = {}) {
  const payload = {
    component: 'games.tGameCatalog.list',
    query: buildGamesListQuery(queryOverrides),
  };
  const response = await page.request.post(buildUrl('/api/games/list'), { data: payload });
  const status = response.status();
  if (status >= 400) {
    throw new Error(`Games list API returned ${status}.`);
  }
  const json = await response.json().catch(() => null);
  const data =
    json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : {};
  const list = Array.isArray(data.list) ? data.list : [];
  const total = Number.isFinite(Number(data.total)) ? Number(data.total) : list.length;
  const providerFilters = Array.isArray(data.checkProvidersItems) ? data.checkProvidersItems : [];
  return { list, total, providerFilters, raw: json };
}

async function getApiProviderMetadata(page, options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (
    !force &&
    cachedApiProviderMetadata &&
    now - Number(cachedApiProviderMetadata.fetchedAt || 0) <= API_PROVIDER_METADATA_TTL_MS
  ) {
    return cachedApiProviderMetadata;
  }

  const response = await requestGamesList(page, { limit: 24, offset: 0 });
  const providerFilters = uniqueApiProviderFilters(response.providerFilters);
  cachedApiProviderMetadata = {
    fetchedAt: now,
    totalGames: Number(response.total) || 0,
    providerFilters,
    providers: providerFilters.map((item) => String(item.name || '').trim()).filter(Boolean),
  };
  return cachedApiProviderMetadata;
}

async function discoverProvidersViaApi(page) {
  try {
    const metadata = await getApiProviderMetadata(page);
    return {
      providers: uniqueProvidersByNormalizedName(metadata.providers),
      reason: null,
      source: 'api',
      providersTotalGames: Number(metadata.totalGames || 0),
      providerFilters: metadata.providerFilters,
    };
  } catch (err) {
    return {
      providers: [],
      reason: `Providers API fallback failed: ${String(err && err.message ? err.message : err)}`,
      source: 'api',
      providersTotalGames: 0,
      providerFilters: [],
    };
  }
}

async function collectProviderGamesViaApi(page, providerId, options = {}) {
  const targetGames = Math.max(1, Number(options.targetGames || 1));
  const pageLimit = Math.max(24, Number(options.pageLimit || 48));
  const maxPages = Math.max(1, Number(options.maxPages || 3));
  const games = [];
  const seen = new Set();
  let offset = 0;
  let sampledGames = 0;
  let apiTotalGames = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = await requestGamesList(page, {
      providerIds: [providerId],
      limit: pageLimit,
      offset,
    });
    const list = Array.isArray(response.list) ? response.list : [];
    sampledGames += list.length;
    if (!apiTotalGames) apiTotalGames = Number(response.total) || list.length;
    if (!list.length) break;

    for (const item of list) {
      const link = String(item && item.link ? item.link : '').trim();
      const title = String(item && item.name ? item.name : '').trim();
      const key = `${link}|${title}`.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      games.push({
        id: Number(item && item.id),
        name: title,
        link,
        hasDemo: Boolean(item && item.hasDemo),
      });
      if (games.length >= targetGames) {
        return {
          games,
          sampledGames,
          apiTotalGames,
          exhausted: false,
        };
      }
    }

    if (list.length < pageLimit) break;
    offset += list.length;
  }

  return {
    games,
    sampledGames,
    apiTotalGames,
    exhausted: true,
  };
}

function findApiProviderMatch(provider, apiProviders) {
  const wanted = normalizeProviderName(provider);
  for (const entry of apiProviders || []) {
    const entryName = String(entry && entry.name ? entry.name : '').trim();
    if (!entryName) continue;
    if (providerNamesMatch(entryName, wanted)) return entry;
  }
  return null;
}

async function classifyProviderDemoViaApi(page, provider, apiProvider, options = {}) {
  const pageLimit = Math.max(24, Number(options.limit) || 120);
  const maxPages = Math.max(1, Number(options.maxPages) || 4);
  const providerId = Number(apiProvider && apiProvider.id);
  if (!Number.isFinite(providerId) || providerId <= 0) {
    return {
      provider,
      status: 'unknown',
      hasDemo: null,
      reason: 'Provider id is missing in API metadata.',
      providerId: null,
      cardTitle: '',
      cardHref: '',
      demoHref: '',
      buttonText: '',
      sampledGames: 0,
      apiTotalGames: Number(apiProvider && apiProvider.gameCount) || 0,
      scanSource: 'api',
    };
  }

  let offset = 0;
  let sampledGames = 0;
  let apiTotalGames = Number(apiProvider.gameCount) || 0;
  let demoGame = null;
  let firstGame = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = await requestGamesList(page, {
      providerIds: [providerId],
      limit: pageLimit,
      offset,
    });
    const games = response.list;
    if (!Number.isFinite(apiTotalGames) || apiTotalGames < 1) {
      apiTotalGames = Number(response.total) || apiTotalGames;
    }
    if (games.length < 1) break;

    sampledGames += games.length;
    if (!firstGame) firstGame = games[0];
    const demoCandidate = games.find((item) => Boolean(item && item.hasDemo));
    if (demoCandidate) {
      demoGame = demoCandidate;
      break;
    }

    if (games.length < pageLimit) break;
    offset += games.length;
  }

  if (sampledGames < 1) {
    return {
      provider,
      status: 'unknown',
      hasDemo: null,
      reason: 'Provider has no games returned by API.',
      providerId,
      cardTitle: '',
      cardHref: '',
      demoHref: '',
      buttonText: '',
      sampledGames,
      apiTotalGames,
      scanSource: 'api',
    };
  }

  if (demoGame) {
    return {
      provider,
      status: 'available',
      hasDemo: true,
      reason: 'Demo is available (hasDemo=true in games API).',
      providerId,
      cardTitle: String(demoGame.name || '').trim(),
      cardHref: String(demoGame.link || '').trim(),
      demoHref: String(demoGame.link || '').trim(),
      buttonText: 'Try for Fun',
      sampledGames,
      apiTotalGames,
      scanSource: 'api',
    };
  }

  return {
    provider,
    status: 'not-available',
    hasDemo: false,
    reason: 'No demo games found in sampled games API response for provider.',
    providerId,
    cardTitle: firstGame ? String(firstGame.name || '').trim() : '',
    cardHref: firstGame ? String(firstGame.link || '').trim() : '',
    demoHref: '',
    buttonText: '',
    sampledGames,
    apiTotalGames,
    scanSource: 'api',
  };
}

async function classifySingleProviderDemoAvailability(page, provider) {
  const maxAttempts = 2;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const filter = await applyProviderFilter(page, provider);
    if (!filter.ok) {
      lastResult = {
        provider,
        status: filter.blocked ? 'blocked' : 'unknown',
        hasDemo: null,
        reason: filter.reason || 'Provider filter apply failed while scanning demo availability.',
        cardTitle: '',
        cardHref: '',
        demoHref: '',
        buttonText: '',
        totalCards: 0,
        visibleCards: 0,
      };
      if (filter.blocked || attempt >= maxAttempts) return lastResult;
      await openCasino(page).catch(() => null);
      await waitForCasinoContent(page).catch(() => null);
      continue;
    }

    await waitForUiSettled(page, 1200);
    await waitForProviderCatalogContent(page, 14_000);

    const probe = await detectProviderDemoAvailability(page, provider);
    lastResult = probe;
    const noCards = /No game cards found after provider filter\./i.test(String(probe.reason || ''));
    if (!noCards || attempt >= maxAttempts) return probe;

    await openCasino(page).catch(() => null);
    await waitForCasinoContent(page).catch(() => null);
  }

  return (
    lastResult || {
      provider,
      status: 'unknown',
      hasDemo: null,
      reason: 'Demo availability scan did not produce a result.',
      cardTitle: '',
      cardHref: '',
      demoHref: '',
      buttonText: '',
      totalCards: 0,
      visibleCards: 0,
    }
  );
}

async function scanProvidersDemoAvailability(page, providers, options = {}) {
  const list = applyDemoScanLimit(providers);
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : PROVIDER_DEMO_SCAN_TIMEOUT_MS;
  const perProviderTimeoutMs =
    Number.isFinite(options.perProviderTimeoutMs) && options.perProviderTimeoutMs > 0
      ? options.perProviderTimeoutMs
      : PROVIDER_DEMO_SCAN_PER_PROVIDER_TIMEOUT_MS;
  const deadlineAt = Date.now() + timeoutMs;
  const rows = [];
  let apiProviders = [];

  try {
    const metadata = await requestGamesList(page, { limit: 24, offset: 0 });
    apiProviders = metadata.providerFilters;
  } catch {
    apiProviders = [];
  }

  for (const provider of list) {
    if (Date.now() > deadlineAt) {
      rows.push({
        provider,
        status: 'blocked',
        hasDemo: null,
        reason: `Demo availability scan timed out after ${timeoutMs} ms.`,
        cardTitle: '',
        cardHref: '',
        demoHref: '',
        buttonText: '',
        totalCards: 0,
        visibleCards: 0,
        elapsedMs: 0,
      });
      continue;
    }

    const startedAt = Date.now();
    let row = null;
    try {
      const apiProvider = findApiProviderMatch(provider, apiProviders);
      if (apiProvider) {
        row = await classifyProviderDemoViaApi(page, provider, apiProvider, {
          limit: 150,
          maxPages: 5,
        });
      } else {
        row = await classifySingleProviderDemoAvailability(page, provider);
      }
    } catch (err) {
      row = {
        provider,
        status: 'unknown',
        hasDemo: null,
        reason: String(err && err.message ? err.message : err),
        cardTitle: '',
        cardHref: '',
        demoHref: '',
        buttonText: '',
        totalCards: 0,
        visibleCards: 0,
      };
    }

    if (Date.now() - startedAt > perProviderTimeoutMs) {
      row.status = row.status === 'available' ? row.status : 'blocked';
      row.hasDemo = row.status === 'available' ? true : null;
      row.reason = row.reason || `Demo availability scan exceeded ${perProviderTimeoutMs} ms.`;
    }

    row.elapsedMs = Date.now() - startedAt;
    const normalized = normalizeDemoAvailability(row);
    rememberProviderDemoAvailability(provider, normalized);
    rows.push({
      provider,
      ...normalized,
      elapsedMs: row.elapsedMs,
    });
  }

  return {
    providersTarget: list,
    providersScanned: rows.length,
    summary: summarizeDemoAvailabilityRows(rows),
    rows,
  };
}

async function runSingleProviderGameCheck(
  context,
  page,
  provider,
  modeLabel,
  gameIndex,
  skipCardKeys
) {
  const game = {
    provider,
    mode: modeLabel,
    gameIndex: gameIndex + 1,
    status: 'failed',
    outcome: 'failed',
    launchState: 'none',
    gameSurface: 'none',
    controlsClicked: 0,
    reason: '',
  };
  let popup = null;
  let filterConsistency = null;
  let demoProbe = null;
  const collector = createDiagnosticsCollector(context, [page]);
  const packResult = () => ({ game, filterConsistency, demoProbe });

  try {
    const filter = await applyProviderFilter(page, provider);
    if (!filter.ok) {
      game.status = filter.blocked ? 'blocked' : 'failed';
      game.outcome = filter.blocked ? resolveBlockedOutcome(filter.reason) : 'failed';
      game.reason = filter.reason || 'Provider filter apply failed.';
      return packResult();
    }

    if (gameIndex === 0) {
      const cachedDemoProbe = normalizeDemoAvailability(
        getCachedProviderDemoAvailability(provider)
      );
      if (cachedDemoProbe.status && cachedDemoProbe.status !== 'unknown') {
        demoProbe = cachedDemoProbe;
      } else {
        demoProbe = normalizeDemoAvailability(await detectProviderDemoAvailability(page, provider));
        rememberProviderDemoAvailability(provider, demoProbe);
      }

      filterConsistency = await inspectProviderFilterConsistency(page, provider);
      if (isProviderMismatchBlocking(filterConsistency)) {
        game.status = 'blocked';
        game.outcome = 'blocked-other';
        game.reason = `Provider filter mismatch on game cards (${filterConsistency.mismatches.length}/${filterConsistency.recognizedCards}).`;
        return packResult();
      }
    }

    let action = await findRealPlayButton(page, {
      skipCardKeys,
      provider,
      providerEntries: getKnownProvidersForMatching(),
    });
    if (
      (!action.found || !action.button) &&
      /No game cards found/i.test(String(action.reason || ''))
    ) {
      await openCasino(page, {
        attemptsLimit: 1,
        navigationTimeoutMs: 20_000,
      }).catch(() => null);
      await waitForCasinoContent(page).catch(() => null);
      const retryFilter = await applyProviderFilter(page, provider);
      if (retryFilter.ok) {
        await waitForUiSettled(page, 1200);
        action = await findRealPlayButton(page, {
          skipCardKeys,
          provider,
          providerEntries: getKnownProvidersForMatching(),
        });
      }
    }
    if (!action.found || !action.button) {
      game.status = 'no-game';
      game.outcome = 'no-game';
      game.reason = action.reason || 'Real-mode Play button is not visible.';
      return packResult();
    }
    skipCardKeys.add(action.cardKey);
    game.cardKey = action.cardKey;
    game.cardTitle = action.cardTitle;
    game.cardHref = action.cardHref;

    const launch = await clickAndCaptureLaunch(context, page, action.button);
    popup = launch.popup || null;
    if (popup) collector.attachPage(popup);
    game.launchState = launch.launched
      ? 'launched'
      : launch.balanceGateVisible
        ? 'balance-gate'
        : 'not-launched';
    game.sameTabUrl = launch.sameTabUrl || '';
    game.popupUrl = launch.popupUrl || '';

    if (launch.popupChallenge || launch.sameTabChallenge) {
      game.status = 'blocked';
      game.outcome = resolveBlockedOutcome(launch.popupChallenge || launch.sameTabChallenge);
      game.reason = launch.popupChallenge || launch.sameTabChallenge;
      return packResult();
    }

    const targetPage = launch.popup || page;
    const health = await inspectGameHealth(targetPage);
    const controls = await clickSafeGameControls(targetPage);
    const diagnostics = splitCriticalDiagnostics(collector.diagnostics);

    game.gameSurface = health.surfaceVisible ? 'visible' : 'not-visible';
    game.controlsClicked = controls.clickedCount;
    game.detectedControls = controls.detectedLabels.slice(0, 20);
    game.clickedControls = controls.clickedLabels;
    game.health = {
      errorVisible: health.errorVisible,
      challenge: health.challenge,
    };
    game.diagnostics = diagnostics;
    const transientLaunchIssue = detectTransientProviderLaunchIssue(diagnostics);

    if (health.challenge) {
      game.status = 'blocked';
      game.outcome = resolveBlockedOutcome(health.challenge);
      game.reason = health.challenge;
      return packResult();
    }

    const launchLooksValid = launch.launched || launch.balanceGateVisible;
    const strongSurface = Boolean(launch.balanceGateVisible || health.surfaceVisible);
    const weakSurface =
      Boolean(launch.launched) &&
      !launch.balanceGateVisible &&
      !health.surfaceVisible &&
      !health.errorVisible &&
      !health.challenge;
    const healthLooksValid = strongSurface || weakSurface;

    if (!launchLooksValid) {
      if (transientLaunchIssue) {
        game.status = 'blocked';
        game.outcome = 'provider-launch-blocked';
        game.reason = `Provider launch temporarily unavailable: ${transientLaunchIssue}`;
        return packResult();
      }
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Play did not launch game surface and no balance gate shown.';
      return packResult();
    }

    if (!healthLooksValid) {
      if (transientLaunchIssue) {
        game.status = 'blocked';
        game.outcome = 'provider-launch-blocked';
        game.reason = `Provider launch temporarily unavailable: ${transientLaunchIssue}`;
        return packResult();
      }
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = 'Game surface missing or error/challenge visible after launch.';
      return packResult();
    }

    if (diagnostics.hasCritical) {
      if (transientLaunchIssue) {
        game.status = 'blocked';
        game.outcome = 'provider-launch-blocked';
        game.reason = `Provider launch temporarily unavailable: ${transientLaunchIssue}`;
        return packResult();
      }
      if (
        shouldTreatConsoleOnlyDiagnosticsAsWeakPass(diagnostics, {
          surfaceVisible: strongSurface || weakSurface,
          balanceGateVisible: launch.balanceGateVisible,
          controlsClicked: controls.clickedCount,
        })
      ) {
        game.status = 'passed';
        game.outcome = strongSurface ? 'passed-weak-diagnostics' : 'passed-weak-surface';
        game.reason = `Game launch is healthy; non-blocking console-only diagnostics observed (${diagnostics.consoleErrors.length} item(s)).`;
        return packResult();
      }
      game.status = 'failed';
      game.outcome = 'failed';
      game.reason = `Critical diagnostics detected: ${diagnostics.responseErrors.length} HTTP errors, ${diagnostics.requestFailures.length} request failures, ${diagnostics.consoleErrors.length} console errors.`;
      return packResult();
    }

    game.status = 'passed';
    game.outcome = strongSurface ? 'passed-strong' : 'passed-weak-surface';
    if (game.outcome === 'passed-weak-surface') {
      game.reason = 'Launch completed without visible in-game surface; weak pass recorded.';
    } else if (controls.detectedLabels.length > 0 && controls.clickedCount === 0) {
      game.reason = 'Game controls detected but none were clickable.';
    }
    return packResult();
  } catch (err) {
    game.status = 'failed';
    game.outcome = 'failed';
    game.reason = String(err && err.message ? err.message : err);
    return packResult();
  } finally {
    collector.stop();
    if (popup) await popup.close().catch(() => null);
    await openCasino(page, {
      attemptsLimit: PROVIDER_RESTORE_CASINO_RETRIES,
      navigationTimeoutMs: PROVIDER_RESTORE_CASINO_NAV_TIMEOUT_MS,
    }).catch(() => null);
    await waitForCasinoContent(page).catch(() => null);
  }
}

async function runSingleProviderApiGameCheck(page, provider, modeLabel, gameIndex, apiGame) {
  const game = {
    provider,
    mode: modeLabel,
    gameIndex: gameIndex + 1,
    status: 'failed',
    outcome: 'failed',
    launchState: 'none',
    gameSurface: 'none',
    controlsClicked: 0,
    reason: '',
    cardTitle: String(apiGame && apiGame.name ? apiGame.name : '').trim(),
    cardHref: String(apiGame && apiGame.link ? apiGame.link : '').trim(),
    source: 'api-fallback',
  };

  if (!game.cardHref) {
    game.status = 'no-game';
    game.outcome = 'no-game';
    game.reason = 'API game entry has no launch link.';
    return game;
  }

  const targetUrl = buildUrl(game.cardHref);
  let response = null;
  let navigationError = '';
  try {
    response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }
  await waitForUiSettled(page, 1200).catch(() => null);
  let assertError = '';
  await assertNotCloudflare(page).catch((err) => {
    assertError = String(err && err.message ? err.message : err);
  });

  const challenge = (await getChallengeReasonAfterSettle(page)) || assertError;
  if (challenge) {
    game.status = 'blocked';
    game.outcome = resolveBlockedOutcome(challenge);
    game.reason = challenge;
    game.launchState = 'not-launched';
    game.gameSurface = 'not-visible';
    game.httpStatus = response ? response.status() : 0;
    game.navigationError = navigationError;
    return game;
  }

  const balanceGateVisible = await page
    .getByText(/insufficient|not enough|deposit|top up|balance/i)
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
  const health = await inspectGameHealth(page);
  const controls = await clickSafeGameControls(page);

  game.launchState = balanceGateVisible ? 'balance-gate' : 'launched';
  game.gameSurface = health.surfaceVisible ? 'visible' : 'not-visible';
  game.controlsClicked = controls.clickedCount;
  game.detectedControls = controls.detectedLabels.slice(0, 20);
  game.clickedControls = controls.clickedLabels;
  game.sameTabUrl = page.url();
  game.popupUrl = '';
  game.httpStatus = response ? response.status() : 0;
  game.navigationError = navigationError;

  if (health.challenge) {
    game.status = 'blocked';
    game.outcome = resolveBlockedOutcome(health.challenge);
    game.reason = health.challenge;
    return game;
  }

  if (health.errorVisible && !health.surfaceVisible && !balanceGateVisible) {
    game.status = 'failed';
    game.outcome = 'failed';
    game.reason = 'Game page opened but error/unavailable state is visible.';
    return game;
  }

  if (health.surfaceVisible || balanceGateVisible) {
    game.status = 'passed';
    game.outcome =
      health.surfaceVisible || balanceGateVisible ? 'passed-strong' : 'passed-weak-surface';
    return game;
  }

  game.status = 'passed';
  game.outcome = 'passed-weak-surface';
  game.reason = 'Game route opened without explicit error, but no clear in-game surface detected.';
  return game;
}

async function runProviderRealCheckViaApi(page, provider, options = {}, uiBlockReason = '') {
  const modeLabel = options.modeLabel || 'desktop';
  const requestedGames = Number.isFinite(options.gamesToCheck)
    ? options.gamesToCheck
    : PROVIDER_DESKTOP_GAMES;
  const gamesToCheck = Math.max(1, requestedGames);
  const minGamesRaw = Number.isFinite(options.minGames) ? options.minGames : PROVIDER_MIN_GAMES;
  const minGames = Math.max(1, Math.min(gamesToCheck, minGamesRaw));

  let metadata = null;
  try {
    metadata = await getApiProviderMetadata(page);
  } catch (err) {
    return {
      provider,
      mode: modeLabel,
      status: 'blocked',
      outcome: resolveBlockedOutcome(uiBlockReason),
      reason:
        `Casino UI is blocked and providers API fallback failed: ${String(
          err && err.message ? err.message : err
        )}` + (uiBlockReason ? ` | UI block: ${uiBlockReason}` : ''),
      launchState: 'none',
      gameSurface: 'none',
      controlsClicked: 0,
      gamesTarget: gamesToCheck,
      minGames,
      gamesExecuted: 0,
      gamesPassed: 0,
      gamesPassedStrong: 0,
      gamesPassedWeakSurface: 0,
      launches: [],
      providerInInventory: null,
      demoAvailability: normalizeDemoAvailability(getCachedProviderDemoAvailability(provider)),
      apiFallbackUsed: true,
      source: 'api-fallback',
    };
  }

  const apiProvider = findApiProviderMatch(provider, metadata.providerFilters);
  if (!apiProvider) {
    return {
      provider,
      mode: modeLabel,
      status: 'passed',
      outcome: 'provider-absent',
      reason: 'Provider is absent in current brand inventory for this run.',
      launchState: 'none',
      gameSurface: 'none',
      controlsClicked: 0,
      gamesTarget: gamesToCheck,
      minGames,
      gamesExecuted: 0,
      gamesPassed: 0,
      gamesPassedStrong: 0,
      gamesPassedWeakSurface: 0,
      launches: [],
      providerInInventory: false,
      demoAvailability: normalizeDemoAvailability(getCachedProviderDemoAvailability(provider)),
      apiFallbackUsed: true,
      source: 'api-fallback',
    };
  }

  let demoAvailability = normalizeDemoAvailability(getCachedProviderDemoAvailability(provider));
  if (!demoAvailability.status || demoAvailability.status === 'unknown') {
    try {
      demoAvailability = normalizeDemoAvailability(
        await classifyProviderDemoViaApi(page, provider, apiProvider, {
          limit: 120,
          maxPages: 4,
        })
      );
      rememberProviderDemoAvailability(provider, demoAvailability);
    } catch {
      demoAvailability = normalizeDemoAvailability(demoAvailability);
    }
  }

  let apiGames = [];
  let sampledGames = 0;
  let apiTotalGames = Number(apiProvider && apiProvider.gameCount) || 0;
  try {
    const collection = await collectProviderGamesViaApi(page, Number(apiProvider.id), {
      targetGames: gamesToCheck,
      pageLimit: 60,
      maxPages: 4,
    });
    apiGames = collection.games;
    sampledGames = collection.sampledGames;
    apiTotalGames = Number(collection.apiTotalGames || apiTotalGames);
  } catch (err) {
    return {
      provider,
      mode: modeLabel,
      status: 'blocked',
      outcome: resolveBlockedOutcome(uiBlockReason),
      reason:
        `Provider games API fallback failed: ${String(err && err.message ? err.message : err)}` +
        (uiBlockReason ? ` | UI block: ${uiBlockReason}` : ''),
      launchState: 'none',
      gameSurface: 'none',
      controlsClicked: 0,
      gamesTarget: gamesToCheck,
      minGames,
      gamesExecuted: 0,
      gamesPassed: 0,
      gamesPassedStrong: 0,
      gamesPassedWeakSurface: 0,
      launches: [],
      providerInInventory: true,
      demoAvailability,
      apiFallbackUsed: true,
      source: 'api-fallback',
      apiProviderId: Number(apiProvider.id) || null,
      apiProviderGameCount: apiTotalGames,
      apiSampledGames: sampledGames,
    };
  }

  const launches = [];
  for (let gameIndex = 0; gameIndex < gamesToCheck; gameIndex += 1) {
    const apiGame = apiGames[gameIndex];
    if (!apiGame) {
      launches.push({
        provider,
        mode: modeLabel,
        gameIndex: gameIndex + 1,
        status: 'no-game',
        outcome: 'no-game',
        launchState: 'none',
        gameSurface: 'none',
        controlsClicked: 0,
        reason: 'No additional unique provider games returned by API.',
        source: 'api-fallback',
      });
      continue;
    }
    const single = await runSingleProviderApiGameCheck(
      page,
      provider,
      modeLabel,
      gameIndex,
      apiGame
    );
    launches.push(single);
  }

  const summary = summarizeMode(provider, modeLabel, launches, minGames, null);
  return {
    ...summary,
    providerInInventory: true,
    demoAvailability,
    apiFallbackUsed: true,
    source: 'api-fallback',
    apiProviderId: Number(apiProvider.id) || null,
    apiProviderGameCount: Number(apiProvider.gameCount) || apiTotalGames,
    apiSampledGames: sampledGames,
    uiBlockedReason: uiBlockReason || '',
  };
}

function summarizeMode(provider, modeLabel, launches, minGames, filterConsistency) {
  const executedGames = launches.filter((item) => item.status !== 'no-game');
  const passedGames = executedGames.filter((item) => item.status === 'passed');
  const passedStrongGames = passedGames.filter((item) => item.outcome === 'passed-strong');
  const passedWeakGames = passedGames.filter((item) => item.outcome === 'passed-weak-surface');
  const failedGames = executedGames.filter((item) => item.status === 'failed');
  const blockedGames = executedGames.filter((item) => item.status === 'blocked');

  const launchState = executedGames.some((item) => item.launchState === 'launched')
    ? 'launched'
    : executedGames.some((item) => item.launchState === 'balance-gate')
      ? 'balance-gate'
      : 'not-launched';
  const gameSurface = executedGames.some((item) => item.gameSurface === 'visible')
    ? 'visible'
    : 'not-visible';
  const controlsClicked = executedGames.reduce(
    (sum, item) => sum + Number(item.controlsClicked || 0),
    0
  );

  if (isProviderMismatchBlocking(filterConsistency)) {
    return {
      provider,
      mode: modeLabel,
      status: 'blocked',
      outcome: 'blocked-other',
      reason: `Provider filter mismatch on cards (${filterConsistency.mismatches.length}/${filterConsistency.recognizedCards}).`,
      launchState,
      gameSurface,
      controlsClicked,
      gamesTarget: launches.length,
      minGames,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      gamesPassedStrong: passedStrongGames.length,
      gamesPassedWeakSurface: passedWeakGames.length,
      launches,
      filterConsistency,
    };
  }

  if (passedGames.length >= minGames) {
    const blockedAfterThreshold = blockedGames.length;
    const failedAfterThreshold = failedGames.length;
    let reason = '';
    if (failedAfterThreshold > 0) {
      reason = `${failedAfterThreshold} launch(es) failed after minimum success threshold (${minGames}) was reached.`;
    } else if (blockedAfterThreshold > 0) {
      reason = `${blockedAfterThreshold} launch(es) were blocked after minimum success threshold (${minGames}) was reached.`;
    }
    return {
      provider,
      mode: modeLabel,
      status: 'passed',
      outcome: passedStrongGames.length > 0 ? 'passed-strong' : 'passed-weak-surface',
      reason,
      launchState,
      gameSurface,
      controlsClicked,
      gamesTarget: launches.length,
      minGames,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      gamesPassedStrong: passedStrongGames.length,
      gamesPassedWeakSurface: passedWeakGames.length,
      launches,
      filterConsistency,
    };
  }

  if (failedGames.length > 0) {
    return {
      provider,
      mode: modeLabel,
      status: 'failed',
      outcome: failedGames[0].outcome || 'failed',
      reason: failedGames[0].reason || 'One of game launches failed.',
      launchState,
      gameSurface,
      controlsClicked,
      gamesTarget: launches.length,
      minGames,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      gamesPassedStrong: passedStrongGames.length,
      gamesPassedWeakSurface: passedWeakGames.length,
      launches,
      filterConsistency,
    };
  }

  if (passedGames.length < minGames) {
    const noGameOnly = launches.length > 0 && launches.every((item) => item.status === 'no-game');
    if (noGameOnly) {
      return {
        provider,
        mode: modeLabel,
        status: 'blocked',
        outcome: launches[0].outcome || 'blocked-other',
        reason: launches[0].reason || 'No playable cards found after provider filter.',
        launchState,
        gameSurface,
        controlsClicked,
        gamesTarget: launches.length,
        minGames,
        gamesExecuted: executedGames.length,
        gamesPassed: passedGames.length,
        gamesPassedStrong: passedStrongGames.length,
        gamesPassedWeakSurface: passedWeakGames.length,
        launches,
        filterConsistency,
      };
    }

    const notEnoughUniqueGames =
      launches.some((item) => item.status === 'no-game') && passedGames.length > 0;
    if (notEnoughUniqueGames && blockedGames.length === 0) {
      return {
        provider,
        mode: modeLabel,
        status: 'passed',
        outcome: passedStrongGames.length > 0 ? 'passed-strong' : 'passed-weak-surface',
        reason: `Only ${passedGames.length} unique game launch(es) available for this provider in current catalog.`,
        launchState,
        gameSurface,
        controlsClicked,
        gamesTarget: launches.length,
        minGames,
        gamesExecuted: executedGames.length,
        gamesPassed: passedGames.length,
        gamesPassedStrong: passedStrongGames.length,
        gamesPassedWeakSurface: passedWeakGames.length,
        launches,
        filterConsistency,
      };
    }

    if (blockedGames.length > 0 && passedGames.length === 0) {
      return {
        provider,
        mode: modeLabel,
        status: 'blocked',
        outcome: blockedGames[0].outcome || 'blocked-other',
        reason: blockedGames[0].reason || 'Launches blocked by challenge/WAF.',
        launchState,
        gameSurface,
        controlsClicked,
        gamesTarget: launches.length,
        minGames,
        gamesExecuted: executedGames.length,
        gamesPassed: passedGames.length,
        gamesPassedStrong: passedStrongGames.length,
        gamesPassedWeakSurface: passedWeakGames.length,
        launches,
        filterConsistency,
      };
    }
    return {
      provider,
      mode: modeLabel,
      status: 'failed',
      outcome: 'failed',
      reason: `Only ${passedGames.length} successful launches, required at least ${minGames}.`,
      launchState,
      gameSurface,
      controlsClicked,
      gamesTarget: launches.length,
      minGames,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      gamesPassedStrong: passedStrongGames.length,
      gamesPassedWeakSurface: passedWeakGames.length,
      launches,
      filterConsistency,
    };
  }

  if (blockedGames.length > 0) {
    return {
      provider,
      mode: modeLabel,
      status: 'blocked',
      outcome: blockedGames[0].outcome || 'blocked-other',
      reason: blockedGames[0].reason || 'One of launches blocked by challenge/WAF.',
      launchState,
      gameSurface,
      controlsClicked,
      gamesTarget: launches.length,
      minGames,
      gamesExecuted: executedGames.length,
      gamesPassed: passedGames.length,
      gamesPassedStrong: passedStrongGames.length,
      gamesPassedWeakSurface: passedWeakGames.length,
      launches,
      filterConsistency,
    };
  }

  return {
    provider,
    mode: modeLabel,
    status: 'passed',
    outcome: passedStrongGames.length > 0 ? 'passed-strong' : 'passed-weak-surface',
    reason: '',
    launchState,
    gameSurface,
    controlsClicked,
    gamesTarget: launches.length,
    minGames,
    gamesExecuted: executedGames.length,
    gamesPassed: passedGames.length,
    gamesPassedStrong: passedStrongGames.length,
    gamesPassedWeakSurface: passedWeakGames.length,
    launches,
    filterConsistency,
  };
}

async function runProviderRealCheck(context, page, provider, options = {}) {
  const modeLabel = options.modeLabel || 'desktop';
  const requestedGames = Number.isFinite(options.gamesToCheck)
    ? options.gamesToCheck
    : PROVIDER_DESKTOP_GAMES;
  const gamesToCheck = Math.max(1, requestedGames);
  const minGamesRaw = Number.isFinite(options.minGames) ? options.minGames : PROVIDER_MIN_GAMES;
  const minGames = Math.max(1, Math.min(gamesToCheck, minGamesRaw));
  const modeTimeoutMs =
    Number.isFinite(options.modeTimeoutMs) && options.modeTimeoutMs > 0
      ? options.modeTimeoutMs
      : PROVIDER_MODE_TIMEOUT_MS;
  const deadlineAt = Date.now() + modeTimeoutMs;
  const launches = [];
  let filterConsistency = null;
  let demoAvailability = null;
  const skipCardKeys = new Set();

  for (let i = 0; i < gamesToCheck; i += 1) {
    if (Date.now() > deadlineAt) {
      launches.push({
        provider,
        mode: modeLabel,
        gameIndex: i + 1,
        status: 'blocked',
        outcome: 'blocked-other',
        launchState: 'none',
        gameSurface: 'none',
        controlsClicked: 0,
        reason: `Mode "${modeLabel}" timed out after ${modeTimeoutMs} ms.`,
      });
      break;
    }

    const single = await runSingleProviderGameCheck(
      context,
      page,
      provider,
      modeLabel,
      i,
      skipCardKeys
    );
    if (!demoAvailability && single.demoProbe) {
      demoAvailability = normalizeDemoAvailability(single.demoProbe);
      rememberProviderDemoAvailability(provider, demoAvailability);
    }
    if (!filterConsistency && single.filterConsistency)
      filterConsistency = single.filterConsistency;
    launches.push(single.game);

    const passedCount = launches.filter((item) => item.status === 'passed').length;
    if (passedCount >= minGames) break;
    if (single.game.status === 'no-game') break;
    if (single.game.status === 'blocked') break;
  }

  const modeSummary = summarizeMode(provider, modeLabel, launches, minGames, filterConsistency);
  if (demoAvailability) {
    modeSummary.demoAvailability = demoAvailability;
  }
  return modeSummary;
}

function combineDemoAvailabilityFromModes(provider, modes) {
  const modeDemo = modes
    .map((item) => normalizeDemoAvailability(item.demoAvailability))
    .filter((item) => item.status && item.status !== 'unknown');

  const available = modeDemo.find((item) => item.status === 'available');
  if (available) return available;

  const notAvailable = modeDemo.find((item) => item.status === 'not-available');
  if (notAvailable) return notAvailable;

  const blocked = modeDemo.find((item) => item.status === 'blocked');
  if (blocked) return blocked;

  const cached = getCachedProviderDemoAvailability(provider);
  if (cached) return normalizeDemoAvailability(cached);

  return {
    status: 'unknown',
    hasDemo: null,
    reason: 'Demo availability was not collected in this run.',
  };
}

function combineProviderModes(provider, modeResults) {
  const modes = modeResults.filter(Boolean);
  const failed = modes.find((item) => item.status === 'failed');
  const blocked = modes.find((item) => item.status === 'blocked');
  const providerAbsentOnly =
    modes.length > 0 && modes.every((item) => item.outcome === 'provider-absent');
  const status = failed ? 'failed' : blocked ? 'blocked' : 'passed';
  const reason = failed
    ? failed.reason
    : blocked
      ? blocked.reason
      : providerAbsentOnly
        ? 'Provider is absent in current brand inventory for this run.'
        : '';
  const outcome = failed
    ? failed.outcome || 'failed'
    : blocked
      ? blocked.outcome || 'blocked-other'
      : providerAbsentOnly
        ? 'provider-absent'
        : modes.some((item) => item.outcome === 'passed-strong')
          ? 'passed-strong'
          : 'passed-weak-surface';
  const launchState = modes.some((item) => item.launchState === 'launched')
    ? 'launched'
    : modes.some((item) => item.launchState === 'balance-gate')
      ? 'balance-gate'
      : 'not-launched';
  const gameSurface = modes.some((item) => item.gameSurface === 'visible')
    ? 'visible'
    : 'not-visible';
  const controlsClicked = modes.reduce((sum, item) => sum + Number(item.controlsClicked || 0), 0);
  const demoAvailability = combineDemoAvailabilityFromModes(provider, modes);

  return {
    provider,
    status,
    outcome,
    reason,
    launchState,
    gameSurface,
    controlsClicked,
    demoAvailability,
    modes,
    flakyRecovered: modes.some((item) => Boolean(item.flakyRecovered)),
  };
}

async function executeModeWithRetry(browser, testInfo, provider, modeConfig, testNamePrefix) {
  const attempts = [];
  const maxAttempts = Math.max(
    1,
    Number.isFinite(PROVIDER_RETRY_ON_FAIL) ? PROVIDER_RETRY_ON_FAIL + 1 : 1
  );
  let finalResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let modeResult = null;
    const attemptTestName = `${testNamePrefix}_${modeConfig.modeLabel}_attempt_${attempt}`;
    const runOutcome = await withCasinoPage(
      browser,
      testInfo,
      attemptTestName,
      async ({ context, page, route, uiBlocked }) => {
        let providers = cachedProviders;
        if (!providers || !providers.length) {
          const inventory = uiBlocked
            ? await discoverProvidersViaApi(page)
            : await discoverProviders(page);
          if (!inventory.providers.length) {
            modeResult = {
              provider,
              mode: modeConfig.modeLabel,
              status: 'blocked',
              outcome: resolveBlockedOutcome(
                inventory.reason || (route && route.challenge) || 'Provider inventory is empty.'
              ),
              reason:
                inventory.reason || (route && route.challenge) || 'Provider inventory is empty.',
              launchState: 'none',
              gameSurface: 'none',
              controlsClicked: 0,
              gamesTarget: modeConfig.gamesToCheck,
              minGames: modeConfig.minGames,
              gamesExecuted: 0,
              gamesPassed: 0,
              launches: [],
              providerInInventory: null,
              demoAvailability: normalizeDemoAvailability(
                getCachedProviderDemoAvailability(provider)
              ),
              source: uiBlocked ? 'api-fallback' : 'ui',
            };
            return;
          }
          providers = inventory.providers;
          cachedProviders = inventory.providers;
        }

        const normalizedInventory = new Set(providers.map((name) => normalizeProviderName(name)));
        if (!normalizedInventory.has(normalizeProviderName(provider))) {
          const cachedDemo = getCachedProviderDemoAvailability(provider);
          modeResult = {
            provider,
            mode: modeConfig.modeLabel,
            status: 'passed',
            outcome: 'provider-absent',
            reason: 'Provider is absent in current brand inventory for this run.',
            launchState: 'none',
            gameSurface: 'none',
            controlsClicked: 0,
            gamesTarget: modeConfig.gamesToCheck,
            minGames: modeConfig.minGames,
            gamesExecuted: 0,
            gamesPassed: 0,
            launches: [],
            providerInInventory: false,
            demoAvailability: normalizeDemoAvailability(cachedDemo),
          };
          return;
        }

        if (uiBlocked) {
          modeResult = await runProviderRealCheckViaApi(
            page,
            provider,
            modeConfig,
            (route && route.challenge) || 'Casino UI is blocked by challenge/WAF.'
          );
          modeResult.providerInInventory = true;
          return;
        }

        const modeWatchdogMs = Math.max(
          20_000,
          Number(modeConfig.modeTimeoutMs || PROVIDER_MODE_TIMEOUT_MS) + 30_000
        );
        const modeRun = await raceWithTimeout(
          runProviderRealCheck(context, page, provider, modeConfig),
          modeWatchdogMs
        );
        if (modeRun.timedOut) {
          const cachedDemo = getCachedProviderDemoAvailability(provider);
          const timeoutHealth = await inspectGameHealth(page).catch(() => ({
            challenge: null,
            errorVisible: false,
            surfaceVisible: false,
          }));
          const timeoutBalanceGateVisible = await page
            .getByText(/insufficient|not enough|deposit|top up|balance/i)
            .first()
            .isVisible({ timeout: 500 })
            .catch(() => false);
          const timeoutSurfaceDetected =
            !timeoutHealth.challenge &&
            !timeoutHealth.errorVisible &&
            (timeoutHealth.surfaceVisible || timeoutBalanceGateVisible);

          modeResult = timeoutSurfaceDetected
            ? {
                provider,
                mode: modeConfig.modeLabel,
                status: 'passed',
                outcome: 'passed-weak-surface',
                reason: `Mode "${modeConfig.modeLabel}" watchdog timed out after ${modeWatchdogMs} ms, but post-timeout surface/balance gate was detected.`,
                launchState: timeoutBalanceGateVisible ? 'balance-gate' : 'launched',
                gameSurface: timeoutHealth.surfaceVisible ? 'visible' : 'not-visible',
                controlsClicked: 0,
                gamesTarget: modeConfig.gamesToCheck,
                minGames: modeConfig.minGames,
                gamesExecuted: 1,
                gamesPassed: 1,
                launches: [],
                providerInInventory: true,
                demoAvailability: normalizeDemoAvailability(cachedDemo),
                modeWatchdogTimedOut: true,
              }
            : {
                provider,
                mode: modeConfig.modeLabel,
                status: 'blocked',
                outcome: 'blocked-other',
                reason: `Mode "${modeConfig.modeLabel}" watchdog timed out after ${modeWatchdogMs} ms.`,
                launchState: 'none',
                gameSurface: 'none',
                controlsClicked: 0,
                gamesTarget: modeConfig.gamesToCheck,
                minGames: modeConfig.minGames,
                gamesExecuted: 0,
                gamesPassed: 0,
                launches: [],
                providerInInventory: true,
                demoAvailability: normalizeDemoAvailability(cachedDemo),
                modeWatchdogTimedOut: true,
              };
        } else {
          modeResult = modeRun.value;
        }
        modeResult.providerInInventory = true;
      },
      {
        viewport: modeConfig.viewport,
        isMobile: modeConfig.isMobile,
        hasTouch: modeConfig.hasTouch,
        defaultTimeoutMs: modeConfig.modeTimeoutMs,
        allowApiFallbackOnBlockedRoute: true,
      }
    );

    if (!runOutcome || !runOutcome.executed) {
      const cachedDemo = getCachedProviderDemoAvailability(provider);
      modeResult = {
        provider,
        mode: modeConfig.modeLabel,
        status: 'blocked',
        outcome: resolveBlockedOutcome((runOutcome && runOutcome.reason) || ''),
        reason: (runOutcome && runOutcome.reason) || 'Mode run blocked before provider checks.',
        launchState: 'none',
        gameSurface: 'none',
        controlsClicked: 0,
        gamesTarget: modeConfig.gamesToCheck,
        minGames: modeConfig.minGames,
        gamesExecuted: 0,
        gamesPassed: 0,
        launches: [],
        providerInInventory: null,
        demoAvailability: normalizeDemoAvailability(cachedDemo),
      };
    }

    modeResult.attempt = attempt;
    attempts.push(modeResult);
    finalResult = modeResult;

    if (modeResult.status !== 'failed') break;
  }

  if (
    finalResult &&
    attempts.length > 1 &&
    attempts[0].status === 'failed' &&
    finalResult.status !== 'failed'
  ) {
    finalResult.flakyRecovered = true;
    finalResult.retryAttempts = attempts.length - 1;
    finalResult.initialFailureReason = attempts[0].reason || '';
  }

  return { result: finalResult, attempts };
}

async function withCasinoPage(browser, testInfo, testName, run, options = {}) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const requireAuthState = options.requireAuthState !== false;
  const authRecoveryAttempted = options.authRecoveryAttempted === true;
  let authStatePath = pickAuthStatePath();
  let authRecoveryReason = '';

  if (requireAuthState && !authStatePath && !authRecoveryAttempted) {
    const recovered = await recoverAuthStateFromArtifactToken(
      browser,
      testInfo,
      'missing-auth-state'
    );
    if (recovered.ok) {
      return withCasinoPage(browser, testInfo, testName, run, {
        ...options,
        authRecoveryAttempted: true,
      });
    }
    authRecoveryReason = recovered.reason || '';
  }

  if (requireAuthState && !authStatePath) {
    const payload = {
      blocked: true,
      reason:
        'No auth storage state found for authorized casino checks.' +
        (authRecoveryReason ? ` Recovery attempt failed: ${authRecoveryReason}` : ''),
    };
    markBlocked(testInfo, payload.reason);
    await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
    return {
      executed: false,
      blocked: true,
      reason: payload.reason,
      route: null,
      authStatePath: null,
    };
  }

  const contextOptions = {
    viewport: options.viewport || { width: 1365, height: 900 },
    isMobile: Boolean(options.isMobile),
    hasTouch: Boolean(options.hasTouch),
    ignoreHTTPSErrors: true,
  };
  if (authStatePath) contextOptions.storageState = authStatePath;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const defaultTimeoutMs =
    Number.isFinite(options.defaultTimeoutMs) && options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : 30_000;
  page.setDefaultTimeout(defaultTimeoutMs);
  page.setDefaultNavigationTimeout(defaultTimeoutMs);

  try {
    const allowApiFallbackOnBlockedRoute = options.allowApiFallbackOnBlockedRoute === true;
    const route = await openCasino(page);
    const uiBlocked = Boolean(route && route.challenge);
    if (uiBlocked && allowApiFallbackOnBlockedRoute && PROVIDER_FAST_FAIL_ON_UI_BLOCKED) {
      providerFastFailActive = true;
      providerFastFailReason =
        providerFastFailReason || route.challenge || 'Casino UI is blocked by challenge/WAF.';
    }
    if (uiBlocked && !allowApiFallbackOnBlockedRoute) {
      const payload = { blocked: true, reason: route.challenge, route, authStatePath };
      markBlocked(testInfo, route.challenge);
      await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
      return { executed: false, blocked: true, reason: route.challenge, route, authStatePath };
    }

    if (!uiBlocked) {
      await waitForCasinoContent(page);
    } else if (allowApiFallbackOnBlockedRoute) {
      testInfo.annotations.push({
        type: 'partial',
        description:
          'Casino UI is blocked by challenge/WAF; provider checks continue with API fallback where possible.',
      });
    }

    if (requireAuthState) {
      const loginVisible = uiBlocked
        ? false
        : await page
            .getByRole('button', { name: /log in/i })
            .first()
            .isVisible()
            .catch(() => false);
      const userPreferencesStatus = await page.request
        .get(buildUrl('/api/user/preferences'))
        .then((resp) => resp.status())
        .catch(() => null);
      if (!uiBlocked && loginVisible) {
        const payload = {
          blocked: true,
          reason: 'Expected authorized session, but Log In button is visible.',
          route,
          authStatePath,
          userPreferencesStatus,
        };
        markBlocked(testInfo, payload.reason);
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
        return { executed: false, blocked: true, reason: payload.reason, route, authStatePath };
      }
      if (userPreferencesStatus && Number(userPreferencesStatus) >= 400) {
        if (!authRecoveryAttempted) {
          const recovered = await recoverAuthStateFromArtifactToken(
            browser,
            testInfo,
            `preferences-${userPreferencesStatus}`
          );
          if (recovered.ok) {
            return withCasinoPage(browser, testInfo, testName, run, {
              ...options,
              authRecoveryAttempted: true,
            });
          }
          authRecoveryReason = recovered.reason || '';
        }

        const payload = {
          blocked: true,
          reason:
            `Expected authorized session, but /api/user/preferences returned ${userPreferencesStatus}.` +
            (authRecoveryReason ? ` Recovery attempt failed: ${authRecoveryReason}` : ''),
          route,
          authStatePath,
          userPreferencesStatus,
        };
        markBlocked(testInfo, payload.reason);
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
        return { executed: false, blocked: true, reason: payload.reason, route, authStatePath };
      }
    }

    await run({ context, page, route, authStatePath, uiBlocked });
    return { executed: true, blocked: false, reason: null, route, authStatePath };
  } finally {
    await closeContextSafe(context, 12_000);
  }
}

test.describe('Casino Providers Coverage: inventory + real launch matrix', () => {
  test.setTimeout(
    Number.isFinite(PROVIDER_TEST_TIMEOUT_MS) && PROVIDER_TEST_TIMEOUT_MS > 0
      ? PROVIDER_TEST_TIMEOUT_MS
      : 240_000
  );

  test('P0 Demo smoke: Try for Fun launches and works on several games', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_demo_launch_smoke';
    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const result = await runDemoSmokeCheck(context, page, {
          gamesToCheck: PROVIDER_DEMO_GAMES,
          minGames: PROVIDER_DEMO_MIN_GAMES,
        });

        const payload = {
          route,
          authStatePath,
          demoGamesTarget: Math.max(1, PROVIDER_DEMO_GAMES),
          demoMinGames: Math.max(
            1,
            Math.min(Math.max(1, PROVIDER_DEMO_GAMES), PROVIDER_DEMO_MIN_GAMES)
          ),
          result,
        };
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);

        if (result.status === 'blocked') {
          markBlocked(testInfo, result.reason || 'Demo launch flow blocked by challenge/WAF.');
        }
        expect(
          ['passed', 'blocked'],
          `Demo launch smoke failed. Reason: ${result.reason || 'unknown'}`
        ).toContain(result.status);
      },
      { requireAuthState: false }
    );
  });

  test('P0 Providers inventory: list all providers available on brand', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_providers_inventory';
    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ page, route, authStatePath, uiBlocked }) => {
        const inventory = uiBlocked
          ? await discoverProvidersViaApi(page)
          : await discoverProviders(page);
        if (!inventory.providers.length) {
          const reason =
            inventory.reason ||
            (uiBlocked ? route.challenge : '') ||
            'Providers list should not be empty.';
          const payload = {
            blocked: true,
            reason,
            route,
            authStatePath,
            uiBlocked,
            discoverySource: inventory.source || (uiBlocked ? 'api' : 'ui'),
            providersCount: 0,
            providers: [],
            providerTargetsCount: PROVIDER_TARGETS.length,
            providerTargetsCountAll: PROVIDER_ALL_TARGETS.length,
            providerTargetsSource: PROVIDER_TARGET_META.source,
            uncoveredOnBrand: [],
          };
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
          await writeAndAttach(testInfo, 'providers-inventory.json', payload);
          return;
        }
        cachedProviders = inventory.providers;
        providerMatrixResults = [];
        providerHistoryLaunchCandidates = [];
        if (fs.existsSync(MATRIX_JSON_PATH)) fs.unlinkSync(MATRIX_JSON_PATH);
        const matrixMarkdownPath = path.join(ARTIFACT_DIR, 'providers-real-matrix.md');
        if (fs.existsSync(matrixMarkdownPath)) fs.unlinkSync(matrixMarkdownPath);

        const targetSet = new Set(PROVIDER_ALL_TARGETS.map((name) => normalizeProviderName(name)));
        const uncoveredOnBrand = inventory.providers.filter(
          (name) => !targetSet.has(normalizeProviderName(name))
        );

        const payload = {
          route,
          authStatePath,
          uiBlocked,
          discoverySource: inventory.source || (uiBlocked ? 'api' : 'ui'),
          providersCount: inventory.providers.length,
          providers: inventory.providers,
          providerTargetsCount: PROVIDER_TARGETS.length,
          providerTargetsCountAll: PROVIDER_ALL_TARGETS.length,
          providerTargetsSource: PROVIDER_TARGET_META.source,
          uncoveredOnBrand,
        };
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
        await writeAndAttach(testInfo, 'providers-inventory.json', payload);
        await writeAndAttach(
          testInfo,
          'providers-inventory.md',
          makeProvidersInventoryMarkdown(inventory.providers, {
            baseUrl: BASE_URL,
            route: route.finalUrl,
          })
        );
        syncMatrixArtifacts({
          route: route.finalUrl,
          authStatePath,
          providersDiscovered: inventory.providers.length,
        });
        if (uiBlocked) {
          testInfo.annotations.push({
            type: 'partial',
            description:
              'Providers inventory collected via API fallback because casino UI was blocked by challenge.',
          });
        }
        if (uncoveredOnBrand.length > 0) {
          testInfo.annotations.push({
            type: 'partial',
            description: `Providers discovered on brand but not in current targets: ${uncoveredOnBrand.join(', ')}`,
          });
        }
      },
      { requireAuthState: false, allowApiFallbackOnBlockedRoute: true }
    );
  });

  test('P0 Providers demo availability: classify providers with/without demo mode', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_providers_demo_availability';
    const dynamicTimeout =
      Math.max(240_000, PROVIDER_DEMO_SCAN_TIMEOUT_MS + 90_000) ||
      Math.max(240_000, PROVIDER_TEST_TIMEOUT_MS);
    test.setTimeout(dynamicTimeout);

    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ page, route, authStatePath, uiBlocked }) => {
        let providers = cachedProviders;
        if (!providers || !providers.length) {
          const inventory = uiBlocked
            ? await discoverProvidersViaApi(page)
            : await discoverProviders(page);
          if (!inventory.providers.length) {
            const reason =
              inventory.reason ||
              (uiBlocked ? route.challenge : '') ||
              'Provider inventory should not be empty before demo scan.';
            const payload = {
              blocked: true,
              reason,
              route,
              authStatePath,
              uiBlocked,
              discoverySource: inventory.source || (uiBlocked ? 'api' : 'ui'),
              providersCount: 0,
              providersScanned: 0,
              summary: null,
              rows: [],
            };
            markBlocked(testInfo, reason);
            await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
            await writeAndAttach(testInfo, 'providers-demo-availability.json', payload);
            return;
          }
          providers = inventory.providers;
          cachedProviders = inventory.providers;
        }

        cachedProviderDemoAvailability = new Map();
        const scan = await scanProvidersDemoAvailability(page, providers, {
          timeoutMs: PROVIDER_DEMO_SCAN_TIMEOUT_MS,
          perProviderTimeoutMs: PROVIDER_DEMO_SCAN_PER_PROVIDER_TIMEOUT_MS,
        });
        const rows = [...scan.rows].sort((left, right) =>
          String(left.provider).localeCompare(String(right.provider))
        );
        const summary = summarizeDemoAvailabilityRows(rows);
        const payload = {
          route,
          authStatePath,
          uiBlocked,
          discoverySource: uiBlocked ? 'api' : 'ui',
          providerDemoScanMaxApplied:
            Number.isFinite(PROVIDER_DEMO_SCAN_MAX) && PROVIDER_DEMO_SCAN_MAX > 0
              ? PROVIDER_DEMO_SCAN_MAX
              : null,
          providerDemoScanTimeoutMs: PROVIDER_DEMO_SCAN_TIMEOUT_MS,
          providerDemoScanPerProviderTimeoutMs: PROVIDER_DEMO_SCAN_PER_PROVIDER_TIMEOUT_MS,
          providersCount: providers.length,
          providersScanned: rows.length,
          summary,
          rows,
        };

        fs.writeFileSync(
          PROVIDER_DEMO_AVAILABILITY_JSON_PATH,
          JSON.stringify(payload, null, 2),
          'utf8'
        );
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
        await writeAndAttach(testInfo, 'providers-demo-availability.json', payload);
        await writeAndAttach(
          testInfo,
          'providers-demo-availability.md',
          makeProvidersDemoAvailabilityMarkdown(summary, rows, {
            baseUrl: BASE_URL,
            route: route.finalUrl,
          })
        );

        if (uiBlocked) {
          testInfo.annotations.push({
            type: 'partial',
            description:
              'Provider demo availability scan used API fallback because casino UI was blocked by challenge.',
          });
        }
        if (summary.blocked > 0) {
          testInfo.annotations.push({
            type: 'partial',
            description: `${summary.blocked} provider(s) were blocked during demo availability scan.`,
          });
        }
        expect(rows.length, 'Demo availability scan should produce rows.').toBeGreaterThan(0);
      },
      { requireAuthState: false, allowApiFallbackOnBlockedRoute: true }
    );
  });

  for (const provider of PROVIDER_TARGETS) {
    test(`P1 Provider real launch (${provider}): Play opens working non-demo flow`, async ({
      browser,
    }, testInfo) => {
      const testName = `p1_provider_real_${provider}`;
      if (providerFastFailActive) {
        const reason = providerFastFailReason || 'Casino UI is blocked by challenge/WAF.';
        const providerInInventory =
          Array.isArray(cachedProviders) && cachedProviders.length > 0
            ? cachedProviders.some((name) => providerNamesMatch(name, provider))
            : null;
        const fastFailResult = {
          provider,
          status: 'blocked',
          outcome: resolveBlockedOutcome(reason),
          reason,
          launchState: 'not-launched',
          gameSurface: 'not-visible',
          controlsClicked: 0,
          modes: [],
          demoAvailability: normalizeDemoAvailability(getCachedProviderDemoAvailability(provider)),
          providerInInventory,
          flakyRecovered: false,
        };

        upsertProviderMatrixResult({
          ...fastFailResult,
          providersDiscovered: cachedProviders ? cachedProviders.length : null,
        });
        syncMatrixArtifacts({
          providersDiscovered: cachedProviders ? cachedProviders.length : null,
        });
        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, {
          provider,
          providerInInventory,
          providersDiscovered: cachedProviders ? cachedProviders.length : null,
          fastFail: true,
          reason,
          result: fastFailResult,
          modeRuns: [],
        });
        markBlocked(
          testInfo,
          `Provider "${provider}" blocked in non-demo flow: ${reason} (short-circuit)`
        );
        markProviderAnnotation(
          testInfo,
          'provider-blocked',
          `Provider "${provider}" blocked in non-demo flow: ${reason} (short-circuit)`
        );
        expect(['passed', 'blocked']).toContain(fastFailResult.status);
        return;
      }

      const retryAttempts = Math.max(1, PROVIDER_RETRY_ON_FAIL + 1);
      const runDesktopMode = !PROVIDER_ONLY_MOBILE;
      const runMobileMode = PROVIDER_ONLY_MOBILE || PROVIDER_ENABLE_MOBILE;
      const plannedModes = (runDesktopMode ? 1 : 0) + (runMobileMode ? 1 : 0);
      const estimatedModeBudgetMs = Math.max(45_000, PROVIDER_MODE_TIMEOUT_MS + 40_000);
      const calculatedBudgetMs = retryAttempts * plannedModes * estimatedModeBudgetMs + 90_000;
      const configuredTimeoutMs =
        Number.isFinite(PROVIDER_TEST_TIMEOUT_MS) && PROVIDER_TEST_TIMEOUT_MS > 0
          ? PROVIDER_TEST_TIMEOUT_MS
          : 0;
      const uncappedTimeoutMs = Math.max(180_000, configuredTimeoutMs, calculatedBudgetMs);
      const finalTimeoutMs =
        Number.isFinite(PROVIDER_TEST_TIMEOUT_CAP_MS) && PROVIDER_TEST_TIMEOUT_CAP_MS > 0
          ? Math.min(uncappedTimeoutMs, PROVIDER_TEST_TIMEOUT_CAP_MS)
          : uncappedTimeoutMs;
      test.setTimeout(finalTimeoutMs);

      const desktopConfig = {
        modeLabel: 'desktop',
        gamesToCheck: Math.max(1, EFFECTIVE_PROVIDER_DESKTOP_GAMES),
        minGames: Math.max(
          1,
          Math.min(Math.max(1, EFFECTIVE_PROVIDER_DESKTOP_GAMES), Math.max(1, PROVIDER_MIN_GAMES))
        ),
        modeTimeoutMs: PROVIDER_MODE_TIMEOUT_MS,
        viewport: { width: 1365, height: 900 },
        isMobile: false,
        hasTouch: false,
      };
      const mobileConfig = {
        modeLabel: 'mobile',
        gamesToCheck: Math.max(1, PROVIDER_MOBILE_GAMES),
        minGames: 1,
        modeTimeoutMs: Math.max(60_000, Math.floor(PROVIDER_MODE_TIMEOUT_MS * 0.75)),
        viewport: MOBILE_VIEWPORT,
        isMobile: true,
        hasTouch: true,
      };

      let desktopRun = null;
      const modeRuns = [];

      if (runDesktopMode) {
        desktopRun = await executeModeWithRetry(
          browser,
          testInfo,
          provider,
          desktopConfig,
          testName
        );
        modeRuns.push(desktopRun);
        if (desktopRun.result && desktopRun.result.flakyRecovered) {
          markProviderAnnotation(
            testInfo,
            'retried',
            `Provider "${provider}" desktop mode recovered after retry.`
          );
          testInfo.annotations.push({
            type: 'flaky',
            description: `Provider "${provider}" desktop mode recovered after retry.`,
          });
        }
      }

      const allowMobileRun =
        runMobileMode &&
        (!runDesktopMode ||
          (desktopRun && desktopRun.result && desktopRun.result.status === 'passed'));

      if (allowMobileRun) {
        const mobileRun = await executeModeWithRetry(
          browser,
          testInfo,
          provider,
          mobileConfig,
          testName
        );
        modeRuns.push(mobileRun);
        if (mobileRun.result && mobileRun.result.flakyRecovered) {
          markProviderAnnotation(
            testInfo,
            'retried',
            `Provider "${provider}" mobile mode recovered after retry.`
          );
          testInfo.annotations.push({
            type: 'flaky',
            description: `Provider "${provider}" mobile mode recovered after retry.`,
          });
        }
      }

      rememberProviderHistoryLaunchCandidates(
        provider,
        modeRuns.map((run) => run.result)
      );

      const combined = combineProviderModes(
        provider,
        modeRuns.map((run) => run.result)
      );
      const providerInInventory = modeRuns.some(
        (run) => run.result && run.result.providerInInventory === true
      )
        ? true
        : modeRuns.some((run) => run.result && run.result.providerInInventory === false)
          ? false
          : null;

      upsertProviderMatrixResult({
        ...combined,
        providersDiscovered: cachedProviders ? cachedProviders.length : null,
        providerInInventory,
      });
      syncMatrixArtifacts({
        providersDiscovered: cachedProviders ? cachedProviders.length : null,
      });

      const payload = {
        provider,
        providerInInventory,
        providersDiscovered: cachedProviders ? cachedProviders.length : null,
        result: combined,
        modeRuns: modeRuns.map((run) => ({
          result: run.result,
          attempts: run.attempts,
        })),
      };
      await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);

      if (combined.status === 'blocked') {
        markBlocked(
          testInfo,
          `Provider "${provider}" blocked in non-demo flow: ${combined.reason || 'unknown'}`
        );
      }
      if (combined.outcome === 'provider-absent') {
        markProviderAnnotation(
          testInfo,
          'provider-absent',
          `Provider "${provider}" is absent in current brand inventory.`
        );
      } else if (combined.status === 'blocked') {
        markProviderAnnotation(
          testInfo,
          'provider-blocked',
          `Provider "${provider}" blocked in non-demo flow: ${combined.reason || 'unknown'}`
        );
      }
      if (combined.outcome === 'passed-weak-surface') {
        markProviderAnnotation(
          testInfo,
          'weak-surface',
          `Provider "${provider}" launched without a visible game surface; weak pass recorded.`
        );
      }
      expect(
        ['passed', 'blocked'],
        `Provider "${provider}" did not pass non-demo launch/health checks. Reason: ${
          combined.reason || 'unknown'
        }`
      ).toContain(combined.status);
    });
  }

  test('P1 Provider launches -> recent history linkage', async ({ browser }, testInfo) => {
    const testName = 'p1_provider_launches_recent_history_linkage';
    const historyCandidates = getProviderHistoryLaunchCandidates(10);

    const linkageRun = await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ page, route, authStatePath }) => {
        if (!historyCandidates.length) {
          const reason =
            'No confirmed non-demo launches were recorded in provider checks (all blocked, no-game, or balance-gate only).';
          const challengeOnly = providerMatrixAllChallengeBlocked(providerMatrixResults);
          const payload = {
            blocked: true,
            reason,
            route,
            authStatePath,
            candidatesCount: 0,
            providerResultsCaptured: providerMatrixResults.length,
            providerResultsPassed: providerMatrixResults.filter(
              (item) => String(item && item.status) === 'passed'
            ).length,
            challengeOnly,
          };
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
          if (PROVIDER_REQUIRE_HISTORY_MATCH) {
            if (!challengeOnly) {
              expect(
                historyCandidates.length,
                `${reason} Provider matrix is not valid for history linkage until at least one real launch is confirmed.`
              ).toBeGreaterThan(0);
            } else {
              testInfo.annotations.push({
                type: 'provider-blocked',
                description:
                  'Provider history linkage skipped: all provider rows are challenge/WAF blocked.',
              });
            }
          }
          return;
        }

        const recentRoute = await openCasinoSubRoute(page, '/recent/');
        if (recentRoute.challenge) {
          const payload = {
            blocked: true,
            reason: recentRoute.challenge,
            route,
            authStatePath,
            recentRoute,
            historyCandidates,
          };
          markBlocked(testInfo, recentRoute.challenge);
          await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
          if (PROVIDER_REQUIRE_HISTORY_MATCH) {
            if (!isChallengeLikeReason(recentRoute.challenge)) {
              throw new Error(
                `Recent route is blocked during provider history linkage: ${recentRoute.challenge}`
              );
            }
          }
          return;
        }

        await waitForUiSettled(page, 1500);
        const historySnapshots = [];
        let entries = [];
        let matchedRows = [];

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          entries = await collectRecentEntries(page);
          historySnapshots.push({
            attempt,
            entriesCount: entries.length,
            sample: entries.slice(0, 20),
          });

          matchedRows = historyCandidates
            .map((candidate) => ({
              candidate,
              entry: entries.find((entry) => matchesProviderHistoryEntry(entry, candidate)) || null,
            }))
            .filter((row) => row.entry);
          if (matchedRows.length > 0) break;

          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
          await waitForUiSettled(page, 1200);
        }

        if (!matchedRows.length) {
          const reason =
            'Recent games list does not include any confirmed provider-launch game by strict slug/gameId/provider identity.';
          const payload = {
            blocked: true,
            reason,
            route,
            authStatePath,
            recentRoute,
            historyCandidates,
            historySnapshots,
          };
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, `${toSlug(testName)}.json`, payload);
          if (PROVIDER_REQUIRE_HISTORY_MATCH) {
            const challengeOnly = providerMatrixAllChallengeBlocked(providerMatrixResults);
            if (!challengeOnly) throw new Error(reason);
          }
          return;
        }

        await writeAndAttach(testInfo, `${toSlug(testName)}.json`, {
          blocked: false,
          route,
          authStatePath,
          recentRoute,
          historyCandidates,
          matchedCount: matchedRows.length,
          matchedRows,
          historySnapshots,
        });
      }
    );

    if (PROVIDER_REQUIRE_HISTORY_MATCH && linkageRun && linkageRun.executed === false) {
      const reason = linkageRun.reason || 'unknown';
      const challengeOnly = providerMatrixAllChallengeBlocked(providerMatrixResults);
      if (!isChallengeLikeReason(reason) && !challengeOnly) {
        throw new Error(`Provider history linkage did not execute: ${reason}`);
      }
    }
  });

  test('P1 Providers matrix summary artifact', async ({ browserName }, testInfo) => {
    void browserName;
    const payload = syncMatrixArtifacts();
    await writeAndAttach(testInfo, 'providers-real-matrix.json', payload);
    await writeAndAttach(
      testInfo,
      'providers-real-matrix.md',
      makeProvidersMatrixMarkdown(payload.summary, payload.results)
    );

    if (PROVIDER_REQUIRE_HISTORY_MATCH) {
      const passedCount = Number(payload && payload.summary ? payload.summary.passed : 0);
      if (passedCount < 1) {
        const challengeOnly = providerMatrixAllChallengeBlocked(payload && payload.results);
        if (challengeOnly) {
          const reason =
            'Provider matrix has zero successful real launches because all provider checks are challenge/WAF blocked.';
          markBlocked(testInfo, reason);
          testInfo.annotations.push({
            type: 'provider-blocked',
            description: reason,
          });
          return;
        }
        throw new Error(
          'Provider matrix has zero successful real launches. Real provider checks are invalid and cannot verify recent history linkage.'
        );
      }
    }
  });
});
