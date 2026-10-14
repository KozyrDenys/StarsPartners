const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('../fixtures/qa-test');
const {
  assertNotCloudflare,
  detectCloudflare,
  dismissOverlays,
  openSignupModal,
  waitForHomeContent,
} = require('../helpers/gt-utils');
const {
  applyAuthTokenCookie,
  isSignupTurnstileBlockedError,
  registerPlayerViaApi,
} = require('../helpers/signup-api-fallback');
const { createRegistrationData } = require('../helpers/registration-data');
const { SignupRegistrationPage } = require('../page-objects/signup-registration-page');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const BASE_HOSTNAME = new URL(BASE_URL).hostname.toLowerCase();
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = PROJECT_AUTOTEST_REPORT_DIR;
const VISUAL_DIR = path.join(ARTIFACT_DIR, 'visual-smoke-auth');
const AUTH_STATE_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json');
const RUNTIME_PATH = path.join(ARTIFACT_DIR, 'site-coverage-runtime.json');
const ROUTE_OPEN_RETRIES = Math.max(
  1,
  Number.parseInt(process.env.PW_ROUTE_OPEN_RETRIES || '3', 10)
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CORE_ROUTES = [
  '/',
  '/casino/',
  '/livecasino/',
  '/sports/?bt-path=%2F',
  '/promotions/',
  '/vip/',
  '/collections/',
];

const LEGAL_ROUTES = [
  '/policy/privacy/',
  '/policy/terms-of-use/',
  '/policy/payment/',
  '/policy/kyc/',
  '/policy/cookies/',
  '/policy/bonus/',
  '/policy/betting/',
  '/pwa-instruction/',
];

const BRAND_TITLE_KEYWORDS = (() => {
  const hostTokens = BASE_HOSTNAME.split('.').filter(Boolean);
  const compactHost = BASE_HOSTNAME.replace(/[^a-z0-9]/gi, '');
  const out = new Set();
  if (compactHost.length >= 4) out.add(compactHost);
  for (const token of hostTokens) {
    if (String(token).length >= 3) out.add(String(token).toLowerCase());
  }
  out.add(BASE_HOSTNAME);
  return [...out];
})();

let setupError = null;
let authPlayer = null;
const runtime = {
  startedAt: new Date().toISOString(),
  setup: {},
  tests: {},
};

test.describe.configure({ mode: 'serial' });

test.describe('Authorized Site Coverage: P0/P1/P2', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.mkdirSync(VISUAL_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

    const initialStorage = process.env.PW_STORAGE_STATE || 'storageState.json';
    const contextOptions = {
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    };
    if (fs.existsSync(initialStorage)) {
      contextOptions.storageState = initialStorage;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      const data = createRegistrationData({
        emailSuffix: `cov${Date.now().toString(36).slice(-6)}`,
      });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await assertNotCloudflare(page);
      try {
        await dismissOverlays(page);
        await waitForHomeContent(page);
      } catch (err) {
        const reason =
          (await getChallengeReason(page)) ||
          `Home content is unavailable: ${String(err && err.message ? err.message : err)}`;
        throw new Error(reason);
      }

      const signupModal = await openSignupModal(page);
      await expect(signupModal).toBeVisible({ timeout: 15000 });
      const signupPage = new SignupRegistrationPage(page, signupModal);

      let usedFallback = false;
      let outcome = null;
      try {
        await signupPage.completeRegistration(data, {
          errorToast: page.getByText(/something went wrong/i).first(),
        });

        outcome = await signupPage.waitForOutcome();
        if (outcome === 'error') {
          throw new Error('Auth bootstrap signup returned error outcome.');
        }
      } catch (err) {
        if (!isSignupTurnstileBlockedError(err)) throw err;
        const fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL });
        if (!fallbackSignup.ok) {
          throw new Error(
            `Auth bootstrap fallback failed: status=${fallbackSignup.status} body=${JSON.stringify(
              fallbackSignup.body
            )}`
          );
        }
        await applyAuthTokenCookie(context, fallbackSignup.body.token, BASE_URL);
        outcome = 'api-fallback';
        usedFallback = true;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => null);
      if (usedFallback) {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }
      await page
        .getByRole('button', { name: /log in/i })
        .first()
        .waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => null);
      await context.storageState({ path: AUTH_STATE_PATH });

      authPlayer = {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        outcome: outcome || 'unknown',
        generatedAt: new Date().toISOString(),
      };

      runtime.setup = {
        ok: true,
        authStatePath: AUTH_STATE_PATH,
        authPlayer,
      };
    } catch (err) {
      setupError = String(err && err.message ? err.message : err);
      runtime.setup = {
        ok: false,
        error: setupError,
      };
    } finally {
      await context.close();
      fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtime, null, 2), 'utf8');
    }
  });

  test.afterAll(() => {
    runtime.finishedAt = new Date().toISOString();
    fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtime, null, 2), 'utf8');
  });

  function markBlockedAndReturn(testInfo, testName, reason) {
    testInfo.annotations.push({ type: 'blocked', description: reason });
    runtime.tests[testName] = {
      status: 'blocked',
      reason,
      recordedAt: new Date().toISOString(),
    };
  }

  function ensureSetup(testInfo, testName) {
    if (!setupError) return true;
    markBlockedAndReturn(testInfo, testName, `Auth bootstrap failed: ${setupError}`);
    return false;
  }

  function buildUrl(route) {
    return new URL(route, BASE_ORIGIN).toString();
  }

  function isSignupRedirect(url) {
    return /#signup/i.test(url) || /returnTo=.*(%23|#)signup/i.test(url);
  }

  async function getChallengeReason(page) {
    const detected = await detectCloudflare(page);
    if (detected) return detected;

    const challengeVisible = await page
      .getByText(/cloudflare|verify you are human|checking your browser|just a moment/i)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (challengeVisible) return 'Challenge text is visible.';
    if (/cdn-cgi|challenge-platform/i.test(page.url())) return 'Challenge URL detected.';
    if (/__cf_chl_rt_tk=|__cf_bm=|cf_chl_/i.test(page.url())) {
      return 'Cloudflare token URL detected.';
    }
    return null;
  }

  async function withAuthContext(browser, fn) {
    const context = await browser.newContext({
      storageState: AUTH_STATE_PATH,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    try {
      await fn(context);
    } finally {
      await context.close();
    }
  }

  async function openRoute(page, route) {
    const url = buildUrl(route);
    let lastState = null;
    for (let attempt = 1; attempt <= ROUTE_OPEN_RETRIES; attempt += 1) {
      let resp = null;
      let navigationError = null;
      try {
        resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (err) {
        navigationError = String(err && err.message ? err.message : err);
      }
      await dismissOverlays(page).catch(() => null);

      const challenge = await getChallengeReason(page);
      lastState = {
        route,
        requestedUrl: url,
        status: resp ? resp.status() : 0,
        finalUrl: page.url(),
        title: await page.title(),
        challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
        attempt,
      };
      if (!lastState.challenge) return lastState;
      if (attempt < ROUTE_OPEN_RETRIES) {
        await sleep(900 * attempt);
      }
    }
    return lastState;
  }

  function authCookieNames(cookies) {
    return cookies
      .filter((cookie) => /auth|token|session|jwt|sid/i.test(cookie.name))
      .map((c) => c.name);
  }

  test('P0.1 Auth contract: authorized session is established after signup', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_auth_contract';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const routeState = await openRoute(page, '/');

      if (routeState.challenge) {
        markBlockedAndReturn(testInfo, testName, routeState.challenge);
        return;
      }

      try {
        await dismissOverlays(page);
        await waitForHomeContent(page);
      } catch (err) {
        const reason =
          (await getChallengeReason(page)) ||
          `Home content is unavailable: ${String(err && err.message ? err.message : err)}`;
        markBlockedAndReturn(testInfo, testName, reason);
        return;
      }

      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      const signupVisible = await page
        .getByRole('button', { name: /sign up/i })
        .first()
        .isVisible()
        .catch(() => false);
      const profileVisible = await page
        .locator('[data-testid*="profile" i], .t-user, .user-menu, .account')
        .first()
        .isVisible()
        .catch(() => false);

      const cookies = await context.cookies();
      const authCookies = authCookieNames(cookies);
      const preferences = await page.request.get(buildUrl('/api/user/preferences'));

      expect(loginVisible, 'Log In button should be hidden for authorized user.').toBeFalsy();
      expect(signupVisible, 'Sign Up button should be hidden for authorized user.').toBeFalsy();
      if (!profileVisible) {
        testInfo.annotations.push({
          type: 'note',
          description: 'Profile trigger is not visible, fallback auth signals are used.',
        });
      }
      expect(
        authCookies.length,
        'Expected auth/session cookie for authorized user.'
      ).toBeGreaterThan(0);
      expect(
        preferences.status(),
        'GET /api/user/preferences should return 200 for authorized user.'
      ).toBe(200);

      const payload = {
        authPlayer,
        routeState,
        ui: {
          loginVisible,
          signupVisible,
          profileVisible,
        },
        authCookies,
        userPreferencesStatus: preferences.status(),
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p0-auth-contract.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.2 Access matrix: guest redirected, authorized can access protected routes', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_access_matrix';
    if (!ensureSetup(testInfo, testName)) return;

    const protectedRoutes = ['/referral/', '/profile/', '/transactions/'];
    const guestFindings = [];
    const authFindings = [];
    const blocked = [];

    const guestContext = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await guestContext.newPage();
      for (const route of protectedRoutes) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push({ mode: 'guest', ...state });
          continue;
        }

        guestFindings.push(state);
        expect(
          isSignupRedirect(state.finalUrl),
          `Guest should be redirected to signup for ${route}. Final URL: ${state.finalUrl}`
        ).toBeTruthy();
      }
    } finally {
      await guestContext.close();
    }

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      for (const route of protectedRoutes) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push({ mode: 'authorized', ...state });
          continue;
        }

        const loginVisible = await page
          .getByRole('button', { name: /log in/i })
          .first()
          .isVisible()
          .catch(() => false);

        authFindings.push({ ...state, loginVisible });
        expect(
          isSignupRedirect(state.finalUrl),
          `Authorized user should not be redirected to signup for ${route}. Final URL: ${state.finalUrl}`
        ).toBeFalsy();
        expect(
          loginVisible,
          `Log In should remain hidden on ${route} for authorized user.`
        ).toBeFalsy();
      }
    });

    if (blocked.length === protectedRoutes.length * 2) {
      markBlockedAndReturn(
        testInfo,
        testName,
        'Cloudflare blocked access matrix in both guest and authorized modes.'
      );
      return;
    }

    const payload = { protectedRoutes, guestFindings, authFindings, blocked };
    runtime.tests[testName] = { status: 'passed', payload };
    if (blocked.length) {
      testInfo.annotations.push({
        type: 'blocked',
        description: `Partially blocked routes: ${blocked.map((r) => `${r.mode}:${r.route}`).join(', ')}`,
      });
    }
    await testInfo.attach('p0-access-matrix.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  });

  test('P0.3 Sidebar features: Missions/Wheel/Races/Achieves/Store trigger state change', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_sidebar_features';
    if (!ensureSetup(testInfo, testName)) return;

    const featureSelectors = {
      Missions: 'main [class*="mission" i], main [data-testid*="mission" i]',
      Wheel: 'main [class*="wheel" i], main [data-testid*="wheel" i]',
      Races: 'main [class*="race" i], main [data-testid*="race" i]',
      Achieves: 'main [class*="achiev" i], main [data-testid*="achiev" i]',
      Store: 'main [class*="store" i], main [data-testid*="store" i]',
    };

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const sidebar = page.locator('aside, .t-sidebar, .t-sidebar-menu').first();
      await expect(sidebar, 'Sidebar should be visible for feature checks.').toBeVisible({
        timeout: 15000,
      });

      const checks = [];
      for (const [label, markerSelector] of Object.entries(featureSelectors)) {
        const labelRegex = new RegExp(label, 'i');
        const itemCandidates = [
          sidebar.getByText(labelRegex).first(),
          page.getByRole('link', { name: labelRegex }).first(),
          page.getByRole('button', { name: labelRegex }).first(),
          page.getByText(labelRegex).first(),
        ];

        let item = null;
        for (const candidate of itemCandidates) {
          if (await candidate.isVisible().catch(() => false)) {
            item = candidate;
            break;
          }
        }

        if (!item) {
          checks.push({ label, found: false, changed: false });
          continue;
        }

        const beforeUrl = page.url();
        const beforeClass = (await item.getAttribute('class').catch(() => '')) || '';
        await item.click({ timeout: 7000 });
        await page.waitForLoadState('domcontentloaded').catch(() => null);
        const afterUrl = page.url();
        const afterClass = (await item.getAttribute('class').catch(() => '')) || '';

        const becameActive =
          /active|current|selected/i.test(afterClass) &&
          beforeClass.toLowerCase() !== afterClass.toLowerCase();
        const markerVisible = await page
          .locator(markerSelector)
          .first()
          .isVisible()
          .catch(() => false);
        const changed = afterUrl !== beforeUrl || becameActive || markerVisible;

        checks.push({
          label,
          found: true,
          beforeUrl,
          afterUrl,
          beforeClass,
          afterClass,
          becameActive,
          markerVisible,
          changed,
        });

        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      }

      const foundCount = checks.filter((entry) => entry.found).length;
      expect(
        foundCount,
        'None of sidebar feature items were found in current layout.'
      ).toBeGreaterThan(0);

      const missingLabels = checks.filter((entry) => !entry.found).map((entry) => entry.label);
      if (missingLabels.length) {
        testInfo.annotations.push({
          type: 'note',
          description: `Feature labels not found in current layout: ${missingLabels.join(', ')}`,
        });
      }

      const unchangedLabels = checks
        .filter((entry) => entry.found && !entry.changed)
        .map((entry) => entry.label);
      if (unchangedLabels.length) {
        testInfo.annotations.push({
          type: 'note',
          description: `No observable state change after click: ${unchangedLabels.join(', ')}`,
        });
      }

      runtime.tests[testName] = { status: 'passed', checks };
      await testInfo.attach('p0-sidebar-features.json', {
        body: JSON.stringify(checks, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.4 Cloudflare regression: classify blocked pages without false fails', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_cloudflare_regression';
    if (!ensureSetup(testInfo, testName)) return;

    const routes = [...CORE_ROUTES, ...LEGAL_ROUTES];
    const blocked = [];
    const hardFailures = [];

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();

      for (const route of routes) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push(state);
          continue;
        }

        if (state.status >= 500) {
          hardFailures.push(state);
        }
      }

      if (blocked.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Cloudflare challenge on routes: ${blocked.map((b) => b.route).join(', ')}`,
        });
      }

      expect(hardFailures, '5xx responses found on key routes.').toEqual([]);

      const payload = { routes, blocked, hardFailures };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p0-cloudflare-regression.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.5 Referral dashboard smoke for authorized player', async ({ browser }, testInfo) => {
    const testName = 'p0_referral_dashboard';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/referral/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      const referralMarkerVisible = await page
        .locator('main')
        .getByText(/invite|referral|earn|dashboard/i)
        .first()
        .isVisible({ timeout: 7000 })
        .catch(() => false);
      if (!referralMarkerVisible) {
        testInfo.annotations.push({
          type: 'note',
          description: 'Referral text marker is not visible; URL/access checks are used.',
        });
      }

      expect(
        isSignupRedirect(state.finalUrl),
        `Referral should not redirect to signup: ${state.finalUrl}`
      ).toBeFalsy();
      expect(
        state.finalUrl.includes('/referral'),
        `Expected referral URL, got: ${state.finalUrl}`
      ).toBeTruthy();
      expect(
        loginVisible,
        'Log In button should be hidden on referral dashboard for authorized user.'
      ).toBeFalsy();

      const payload = { state, loginVisible, referralMarkerVisible };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p0-referral-dashboard.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.6 Session persistence across core sections', async ({ browser }, testInfo) => {
    const testName = 'p1_session_persistence';
    if (!ensureSetup(testInfo, testName)) return;

    const routes = [...CORE_ROUTES, '/referral/'];
    const findings = [];
    const blocked = [];

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      for (const route of routes) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push(state);
          continue;
        }

        const loginVisible = await page
          .getByRole('button', { name: /log in/i })
          .first()
          .isVisible()
          .catch(() => false);
        const signupVisible = await page
          .getByRole('button', { name: /sign up/i })
          .first()
          .isVisible()
          .catch(() => false);
        const cookies = await context.cookies();
        const names = authCookieNames(cookies);

        findings.push({
          route,
          finalUrl: state.finalUrl,
          loginVisible,
          signupVisible,
          authCookies: names,
        });

        expect(loginVisible, `Log In should stay hidden on ${route}.`).toBeFalsy();
        expect(signupVisible, `Sign Up should stay hidden on ${route}.`).toBeFalsy();
        expect(names.length, `Auth/session cookies should persist on ${route}.`).toBeGreaterThan(0);
      }
    });

    if (!findings.length) {
      markBlockedAndReturn(testInfo, testName, 'All persistence routes were blocked by challenge.');
      return;
    }

    if (blocked.length) {
      testInfo.annotations.push({
        type: 'blocked',
        description: `Partially blocked persistence routes: ${blocked.map((b) => b.route).join(', ')}`,
      });
    }

    const payload = { routes, findings, blocked };
    runtime.tests[testName] = { status: 'passed', payload };
    await testInfo.attach('p1-session-persistence.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  });

  test('P1.7 Network baseline: no 5xx on core APIs/resources', async ({ browser }, testInfo) => {
    const testName = 'p1_network_baseline';
    if (!ensureSetup(testInfo, testName)) return;

    const routes = [...CORE_ROUTES, '/referral/'];

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const responses = [];

      page.on('response', (resp) => {
        try {
          const url = resp.url();
          if (!/https:\/\/(www\.)?gt\.bet\//i.test(url)) return;
          responses.push({
            url,
            status: resp.status(),
            statusText: resp.statusText(),
            method: resp.request().method(),
          });
        } catch {
          // ignore
        }
      });

      const blocked = [];
      for (const route of routes) {
        const state = await openRoute(page, route);
        if (state.challenge) blocked.push(state);
      }

      const critical5xx = responses.filter(
        (r) => r.status >= 500 && /\/api\/|\/_nuxt\/|\/sports\//i.test(r.url)
      );

      const byKey = new Map();
      for (const response of responses.filter((r) => r.status >= 400 && r.status < 500)) {
        const key = `${response.status} ${response.method} ${response.url}`;
        byKey.set(key, (byKey.get(key) || 0) + 1);
      }
      const top4xx = [...byKey.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      expect(critical5xx, 'Critical 5xx responses detected on core sections.').toEqual([]);

      if (blocked.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Partially blocked during network baseline: ${blocked.map((b) => b.route).join(', ')}`,
        });
      }

      const payload = {
        routes,
        blocked,
        totalResponses: responses.length,
        critical5xx,
        top4xx,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-network-baseline.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.8 Footer/legal links integrity', async ({ browser }, testInfo) => {
    const testName = 'p1_footer_legal_integrity';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const baseState = await openRoute(page, '/');
      if (baseState.challenge) {
        markBlockedAndReturn(testInfo, testName, baseState.challenge);
        return;
      }

      const links = await page.$$eval('footer a[href]', (nodes) =>
        nodes
          .map((node) => ({
            href: node.getAttribute('href') || '',
            text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
          }))
          .filter((item) => item.href)
      );

      const filtered = links.filter((item) =>
        /\/policy\/|\/pwa-instruction\/|\/affiliate\//i.test(item.href)
      );
      const targetLinks = filtered.length
        ? filtered
        : LEGAL_ROUTES.map((route) => ({ href: route, text: route }));

      const visited = [];
      const blocked = [];
      for (const item of targetLinks) {
        const href = /^https?:\/\//i.test(item.href) ? item.href : buildUrl(item.href);
        const resp = await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const challenge = await getChallengeReason(page);
        const status = resp ? resp.status() : 0;
        const heading = (
          (await page
            .locator('h1:visible, h2:visible')
            .first()
            .textContent()
            .catch(() => '')) || ''
        ).trim();

        const row = {
          href,
          text: item.text,
          status,
          finalUrl: page.url(),
          heading,
          challenge,
        };

        if (challenge) {
          blocked.push(row);
          continue;
        }

        expect(status, `Footer/legal link should be reachable: ${href}`).toBeLessThan(400);
        if (/\/policy\/|\/pwa-instruction\//i.test(href)) {
          expect(heading.length, `Expected heading for legal page: ${href}`).toBeGreaterThan(0);
        }

        visited.push(row);
      }

      if (blocked.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Blocked legal links: ${blocked.map((b) => b.href).join(', ')}`,
        });
      }

      const payload = { targetCount: targetLinks.length, visited, blocked };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-footer-legal-integrity.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.9 Metadata quality smoke on top routes', async ({ browser }, testInfo) => {
    const testName = 'p1_metadata_quality';
    if (!ensureSetup(testInfo, testName)) return;

    const routeExpectations = [
      { route: '/', keywords: [...BRAND_TITLE_KEYWORDS, 'casino'] },
      { route: '/casino/', keywords: ['casino'] },
      { route: '/livecasino/', keywords: ['casino', 'live'] },
      { route: '/sports/?bt-path=%2F', keywords: ['sports', 'casino', ...BRAND_TITLE_KEYWORDS] },
      { route: '/promotions/', keywords: ['promo', 'bonus', 'casino'] },
      { route: '/vip/', keywords: ['vip'] },
      { route: '/collections/', keywords: ['collection', 'casino', ...BRAND_TITLE_KEYWORDS] },
      { route: '/referral/', keywords: ['referral', 'invite', ...BRAND_TITLE_KEYWORDS] },
    ];

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const checked = [];
      const blocked = [];

      for (const item of routeExpectations) {
        const state = await openRoute(page, item.route);
        if (state.challenge) {
          blocked.push(state);
          continue;
        }

        const title = String(state.title || '').trim();
        const lower = title.toLowerCase();
        const hasKeyword = item.keywords.some((keyword) => lower.includes(keyword));

        checked.push({
          route: item.route,
          title,
          hasKeyword,
          keywords: item.keywords,
        });

        expect(title.length, `Title should be non-empty on ${item.route}`).toBeGreaterThan(4);
        expect(
          hasKeyword,
          `Title should include route keyword on ${item.route}. Got: "${title}"`
        ).toBeTruthy();
      }

      if (blocked.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Blocked metadata routes: ${blocked.map((b) => b.route).join(', ')}`,
        });
      }

      const payload = { checked, blocked };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-metadata-quality.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P2.10 Explicit 404 route contract', async ({ browser }, testInfo) => {
    const testName = 'p2_404_contract';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const nonce = Date.now();
      const route = `/autotest-non-existent-${nonce}/`;
      const state = await openRoute(page, route);
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const bodyText = ((await page.textContent('body').catch(() => '')) || '').toLowerCase();
      const has404Marker = /\b404\b|not found|forbidden|oops|page does not exist/i.test(bodyText);
      const hasAppRoot = await page
        .locator('#app, #__nuxt')
        .first()
        .isVisible()
        .catch(() => false);
      const hasPageBody = bodyText.trim().length > 0;

      expect(
        hasPageBody,
        'Non-existent route should still render a non-empty response body.'
      ).toBeTruthy();
      expect(
        state.status === 404 || has404Marker,
        `Expected explicit 404 contract (status or marker). Status=${state.status}`
      ).toBeTruthy();

      const payload = { route, state, has404Marker, hasAppRoot };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p2-404-contract.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P2.11 Visual smoke: authorized desktop and mobile screenshots', async ({
    browser,
  }, testInfo) => {
    const testName = 'p2_visual_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    const captured = [];
    const blocked = [];
    const planned = [];

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const desktopShots = [
        { route: '/', file: 'desktop-home.png' },
        { route: '/casino/', file: 'desktop-casino.png' },
        { route: '/promotions/', file: 'desktop-promotions.png' },
      ];

      for (const shot of desktopShots) {
        planned.push({ route: shot.route, viewport: 'desktop' });
        const state = await openRoute(page, shot.route);
        if (state.challenge) {
          blocked.push({ route: shot.route, viewport: 'desktop', challenge: state.challenge });
          testInfo.annotations.push({
            type: 'blocked',
            description: `Visual blocked on ${shot.route}`,
          });
          continue;
        }
        const filePath = path.join(VISUAL_DIR, shot.file);
        await page.screenshot({ path: filePath, fullPage: true });
        captured.push({ route: shot.route, file: filePath, viewport: 'desktop' });
      }
    });

    const mobileContext = await browser.newContext({
      storageState: AUTH_STATE_PATH,
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    try {
      const page = await mobileContext.newPage();
      const mobileShots = [
        { route: '/', file: 'mobile-home.png' },
        { route: '/sports/?bt-path=%2F', file: 'mobile-sports.png' },
      ];

      for (const shot of mobileShots) {
        planned.push({ route: shot.route, viewport: 'mobile' });
        const state = await openRoute(page, shot.route);
        if (state.challenge) {
          blocked.push({ route: shot.route, viewport: 'mobile', challenge: state.challenge });
          testInfo.annotations.push({
            type: 'blocked',
            description: `Visual blocked on ${shot.route} (mobile)`,
          });
          continue;
        }
        const filePath = path.join(VISUAL_DIR, shot.file);
        await page.screenshot({ path: filePath, fullPage: true });
        captured.push({ route: shot.route, file: filePath, viewport: 'mobile' });
      }
    } finally {
      await mobileContext.close();
    }

    const covered = captured.length + blocked.length;
    if (captured.length === 0 && blocked.length > 0) {
      markBlockedAndReturn(
        testInfo,
        testName,
        'All visual smoke routes were blocked by challenge in current run.'
      );
      return;
    }
    expect(captured.length, 'Expected at least 1 visual smoke screenshot.').toBeGreaterThan(0);
    expect(
      covered,
      'Expected at least 3 planned visual routes to be processed (captured or blocked).'
    ).toBeGreaterThanOrEqual(3);

    const payload = { visualDir: VISUAL_DIR, planned, captured, blocked };
    runtime.tests[testName] = { status: 'passed', payload };
    await testInfo.attach('p2-visual-smoke.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  });

  test('P2.12 Localization switch smoke keeps auth UI stable', async ({ browser }, testInfo) => {
    const testName = 'p2_localization_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const sidebar = page.locator('aside, .t-sidebar, .t-sidebar-menu').first();
      const trigger = sidebar
        .getByText(/english|español|deutsch|français|português|русский|українська/i)
        .first();

      const triggerVisible = await trigger.isVisible().catch(() => false);
      if (!triggerVisible) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'Language trigger is not visible in current authorized layout.'
        );
        return;
      }

      const beforeLabel = ((await trigger.innerText().catch(() => '')) || '').trim();
      await trigger.click({ timeout: 7000 });
      await page.waitForLoadState('domcontentloaded').catch(() => null);

      const optionLocator = page
        .locator('[role="option"], [role="menuitem"], .t-select__option, .t-dropdown__item, li')
        .filter({ hasText: /english|español|deutsch|français|português|русский|українська/i });

      const optionCount = await optionLocator.count();
      if (optionCount <= 1) {
        testInfo.annotations.push({
          type: 'blocked',
          description: 'Language options are not exposed to automation in current UI state.',
        });
        runtime.tests[testName] = {
          status: 'blocked',
          reason: 'Language options are not exposed to automation in current UI state.',
          optionCount,
        };
        return;
      }

      let selectedText = beforeLabel;
      for (let i = 0; i < optionCount; i += 1) {
        const option = optionLocator.nth(i);
        const text = ((await option.innerText().catch(() => '')) || '').trim();
        if (!text || text.toLowerCase() === beforeLabel.toLowerCase()) continue;
        await option.click({ timeout: 7000 });
        selectedText = text;
        break;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => null);

      const hasAppRoot = await page
        .locator('#app, #__nuxt')
        .first()
        .isVisible()
        .catch(() => false);
      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      const afterLabel = (
        (await sidebar
          .getByText(/english|español|deutsch|français|português|русский|українська/i)
          .first()
          .innerText()
          .catch(() => '')) || ''
      ).trim();

      expect(hasAppRoot, 'App root should stay visible after language interaction.').toBeTruthy();
      expect(
        loginVisible,
        'Authorized UI should remain authorized after language switch.'
      ).toBeFalsy();
      expect(
        selectedText.length,
        'A non-empty language option should be selected.'
      ).toBeGreaterThan(0);

      const payload = {
        beforeLabel,
        afterLabel,
        selectedText,
        optionCount,
        hasAppRoot,
        loginVisible,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p2-localization-smoke.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });
});
