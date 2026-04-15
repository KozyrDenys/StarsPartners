const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('@playwright/test');
const {
  assertNotCloudflare,
  closeModal,
  detectCloudflare,
  dismissOverlays,
  openSignupModal,
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
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_ROOT = PROJECT_AUTOTEST_REPORT_DIR;
const SWEEP_DIR = path.join(ARTIFACT_ROOT, 'button-sweep');
const AUTH_STATE_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json');

const MAX_ROUTES = toPositiveInt(process.env.PW_BUTTON_MAX_ROUTES, 12);
const MAX_BUTTONS_PER_ROUTE = toPositiveInt(process.env.PW_BUTTON_MAX_BUTTONS, 15);
const MAX_ROUTE_DEPTH = toPositiveInt(process.env.PW_BUTTON_MAX_ROUTE_DEPTH, 4);
const REUSE_AUTH_STATE = process.env.PW_BUTTON_REUSE_STATE !== '0';

const SEED_ROUTES = [
  '/',
  '/casino/',
  '/livecasino/',
  '/sports/?bt-path=%2F',
  '/promotions/',
  '/vip/',
  '/collections/',
  '/referral/',
  '/pwa-instruction/',
  '/policy/privacy/',
  '/policy/terms-of-use/',
  '/policy/payment/',
  '/policy/kyc/',
  '/policy/cookies/',
  '/policy/bonus/',
  '/policy/betting/',
];

const runtime = {
  startedAt: new Date().toISOString(),
  settings: {
    maxRoutes: MAX_ROUTES,
    maxButtonsPerRoute: MAX_BUTTONS_PER_ROUTE,
    maxRouteDepth: MAX_ROUTE_DEPTH,
  },
  setup: {},
  guest: null,
  authorized: null,
};

let setupError = null;
let authPlayer = null;

test.describe.configure({ mode: 'serial' });

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeRoute(input) {
  try {
    const url = new URL(input, BASE_ORIGIN);
    if (url.origin !== BASE_ORIGIN) return null;
    url.hash = '';
    const pathname = url.pathname.replace(/\/{2,}/g, '/');
    const search = url.search || '';
    return pathname === '/' ? `/${search}` : `${pathname.replace(/\/?$/, '/')}${search}`;
  } catch {
    return null;
  }
}

function routeDepth(route) {
  const clean = String(route || '').split('?')[0];
  if (clean === '/') return 0;
  return clean
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function isProbablyFile(route) {
  return /\.[a-z0-9]{2,8}(\?|$)/i.test(route);
}

function hasLongNumericSegment(route) {
  const clean = String(route || '').split('?')[0];
  const segments = clean.split('/').filter(Boolean);
  return segments.some((segment) => /^[0-9a-f-]{10,}$/i.test(segment));
}

function isRouteEligible(route) {
  if (!route || typeof route !== 'string') return false;
  if (!route.startsWith('/')) return false;
  if (/\/(?:api|cdn-cgi|_nuxt)\//i.test(route)) return false;
  if (/^(mailto:|tel:|javascript:)/i.test(route)) return false;
  if (isProbablyFile(route)) return false;
  if (hasLongNumericSegment(route)) return false;
  if (routeDepth(route) > MAX_ROUTE_DEPTH && !route.startsWith('/policy/')) return false;
  return true;
}

function routeChanged(beforeUrl, afterUrl) {
  const before = normalizeRoute(beforeUrl);
  const after = normalizeRoute(afterUrl);
  return before !== after;
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

async function openRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => null);
  let challenge = await detectCloudflare(page).catch(() => null);
  if (navigationError && !challenge) {
    challenge = `Navigation failed: ${navigationError}`;
  }

  return {
    route,
    requestedUrl,
    status: response ? response.status() : 0,
    finalUrl: page.url(),
    title: await page.title(),
    challenge,
    navigationError,
  };
}

async function collectInternalRoutes(page) {
  const hrefs = await page.$$eval('a[href]', (nodes) =>
    nodes
      .map((node) => node.getAttribute('href') || '')
      .map((href) => href.trim())
      .filter(Boolean)
  );

  const routes = new Set();
  for (const href of hrefs) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const normalized = normalizeRoute(href);
    if (!isRouteEligible(normalized)) continue;
    routes.add(normalized);
  }
  return [...routes];
}

async function listVisibleButtons(page) {
  const items = await page.evaluate(() => {
    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
    }

    function attrEscape(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < 0 || rect.right < 0) return false;
      return true;
    }

    function buildCssPath(el) {
      const testId = el.getAttribute('data-testid');
      if (testId) return `[data-testid="${attrEscape(testId)}"]`;
      if (el.id) return `#${cssEscape(el.id)}`;

      const parts = [];
      let node = el;

      while (node && node.nodeType === 1 && parts.length < 7) {
        const tag = node.tagName.toLowerCase();
        let part = tag;
        const nodeTestId = node.getAttribute('data-testid');
        if (nodeTestId) {
          part += `[data-testid="${attrEscape(nodeTestId)}"]`;
          parts.unshift(part);
          break;
        }
        if (node.id) {
          part += `#${cssEscape(node.id)}`;
          parts.unshift(part);
          break;
        }

        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(
            (child) => child.tagName === node.tagName
          );
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(node);
            if (idx >= 0) part += `:nth-of-type(${idx + 1})`;
          }
        }

        parts.unshift(part);
        node = parent;
      }

      return parts.join(' > ');
    }

    const nodes = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      )
    );

    return nodes
      .filter((node) => isVisible(node))
      .map((node, index) => {
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        const ariaLabel = (node.getAttribute('aria-label') || '').trim();
        const name = (node.getAttribute('name') || '').trim();
        const value = (node.getAttribute('value') || '').trim();
        const disabledAttr =
          node.hasAttribute('disabled') ||
          node.getAttribute('aria-disabled') === 'true' ||
          node.getAttribute('disabled') === 'true';
        const selector = buildCssPath(node);
        const role = (node.getAttribute('role') || '').trim();
        const type = (node.getAttribute('type') || node.tagName || '').toLowerCase();
        const label =
          text || ariaLabel || name || value || `${node.tagName.toLowerCase()}-${index + 1}`;
        const key = [selector, text, ariaLabel, name, role, type].join('|');

        return {
          key,
          label,
          selector,
          type,
          role,
          text,
          ariaLabel,
          disabled: Boolean(disabledAttr),
        };
      });
  });

  const unique = new Map();
  for (const item of items) {
    if (!item || !item.key || !item.selector) continue;
    if (!unique.has(item.key)) {
      unique.set(item.key, item);
    }
  }
  return [...unique.values()];
}

async function closeTransientUi(page) {
  await dismissOverlays(page);

  const dialogCandidates = [
    '.t-signup-modal',
    '.t-login-modal',
    '[role="dialog"]',
    '.t-modal',
    '.modal',
  ];
  for (const selector of dialogCandidates) {
    const modal = page.locator(selector).first();
    const visible = await modal.isVisible().catch(() => false);
    if (!visible) continue;
    await closeModal(modal, page);
  }

  const closers = [
    'button:has-text("Close")',
    'button:has-text("Got it")',
    'button:has-text("Accept")',
    '[aria-label="Close"]',
  ];
  for (const selector of closers) {
    const btn = page.locator(selector).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click({ timeout: 2000 }).catch(() => null);
  }
}

async function clickButton(page, route, button) {
  const beforeUrl = page.url();
  const locator = page.locator(button.selector).first();
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) {
    return {
      status: 'not-visible',
      button: button.label,
      selector: button.selector,
      beforeUrl,
      afterUrl: page.url(),
      changedRoute: false,
    };
  }

  const disabled = await locator.isDisabled().catch(() => button.disabled);
  if (disabled) {
    return {
      status: 'disabled',
      button: button.label,
      selector: button.selector,
      beforeUrl,
      afterUrl: page.url(),
      changedRoute: false,
    };
  }

  let clickError = null;
  try {
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    await locator.click({ timeout: 6000 });
  } catch (err) {
    clickError = err;
    await locator.click({ timeout: 6000, force: true }).catch(() => null);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await closeTransientUi(page);
  const challenge = await detectCloudflare(page);
  const afterUrl = page.url();
  const changedRoute = routeChanged(beforeUrl, afterUrl);

  return {
    status: clickError ? 'clicked-with-fallback' : 'clicked',
    button: button.label,
    selector: button.selector,
    beforeUrl,
    afterUrl,
    changedRoute,
    challenge,
    error: clickError ? String(clickError.message || clickError) : null,
  };
}

async function clickButtonsOnRoute(page, route) {
  const seen = new Set();
  const log = [];

  for (let iteration = 0; iteration < MAX_BUTTONS_PER_ROUTE * 3; iteration += 1) {
    const visibleButtons = await listVisibleButtons(page);
    const available = visibleButtons.filter((item) => !seen.has(item.key));
    const next = available.find((item) => !item.disabled) || available[0];
    if (!next) break;

    seen.add(next.key);
    const clickResult = await clickButton(page, route, next);
    log.push(clickResult);

    if (clickResult.challenge) {
      break;
    }

    if (clickResult.changedRoute) {
      const state = await openRoute(page, route);
      if (state.challenge) {
        log.push({
          status: 'blocked-while-returning',
          route,
          challenge: state.challenge,
          afterUrl: state.finalUrl,
        });
        break;
      }
      await closeTransientUi(page);
    }

    if (seen.size >= MAX_BUTTONS_PER_ROUTE) break;
  }

  const clicked = log.filter(
    (row) => row.status === 'clicked' || row.status === 'clicked-with-fallback'
  ).length;
  const failed = log.filter((row) => row.status === 'not-visible').length;
  const disabled = log.filter((row) => row.status === 'disabled').length;

  return {
    route,
    totalTried: log.length,
    clicked,
    failed,
    disabled,
    log,
  };
}

async function crawlAndClick(context, mode, testInfo) {
  const queue = [];
  const queued = new Set();
  const visited = new Set();
  const blockedRoutes = [];
  const routeReports = [];

  for (const seed of SEED_ROUTES) {
    const normalized = normalizeRoute(seed);
    if (!normalized || queued.has(normalized) || !isRouteEligible(normalized)) continue;
    queue.push(normalized);
    queued.add(normalized);
  }

  const page = await context.newPage();
  try {
    while (queue.length > 0 && visited.size < MAX_ROUTES) {
      const route = queue.shift();
      if (!route || visited.has(route)) continue;
      visited.add(route);

      const state = await openRoute(page, route);
      if (state.challenge) {
        blockedRoutes.push(state);
        continue;
      }

      await closeTransientUi(page);
      const discovered = await collectInternalRoutes(page);
      for (const candidate of discovered) {
        if (!candidate || visited.has(candidate) || queued.has(candidate)) continue;
        if (!isRouteEligible(candidate)) continue;
        queue.push(candidate);
        queued.add(candidate);
      }

      const routeSweep = await clickButtonsOnRoute(page, route);
      routeReports.push({
        route,
        state,
        discoveredRoutes: discovered,
        sweep: routeSweep,
      });
    }
  } finally {
    await page.close();
  }

  const totalClicked = routeReports.reduce((acc, row) => acc + row.sweep.clicked, 0);
  const totalTried = routeReports.reduce((acc, row) => acc + row.sweep.totalTried, 0);
  const totalDisabled = routeReports.reduce((acc, row) => acc + row.sweep.disabled, 0);
  const totalFailed = routeReports.reduce((acc, row) => acc + row.sweep.failed, 0);

  if (!routeReports.length && blockedRoutes.length) {
    testInfo.annotations.push({
      type: 'blocked',
      description: `${mode}: all routes were blocked by Cloudflare challenge.`,
    });
  }

  return {
    mode,
    startedAt: new Date().toISOString(),
    limits: {
      maxRoutes: MAX_ROUTES,
      maxButtonsPerRoute: MAX_BUTTONS_PER_ROUTE,
      maxRouteDepth: MAX_ROUTE_DEPTH,
    },
    visitedRoutes: [...visited],
    blockedRoutes,
    routeReports,
    totals: {
      routesVisited: routeReports.length,
      routesBlocked: blockedRoutes.length,
      buttonsTried: totalTried,
      buttonsClicked: totalClicked,
      buttonsDisabled: totalDisabled,
      buttonsFailed: totalFailed,
    },
  };
}

async function ensureAuthorizedState(browser) {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  fs.mkdirSync(SWEEP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  if (REUSE_AUTH_STATE && fs.existsSync(AUTH_STATE_PATH)) {
    runtime.setup = {
      ok: true,
      reused: true,
      authStatePath: AUTH_STATE_PATH,
    };
    return;
  }

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
    const data = createRegistrationData({ emailSuffix: `bs${Date.now().toString(36).slice(-6)}` });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await page.locator('body').first().waitFor({ state: 'visible', timeout: 15000 });

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
        throw new Error('Button sweep auth bootstrap: signup returned error outcome.');
      }
    } catch (err) {
      if (!isSignupTurnstileBlockedError(err)) throw err;
      const fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL });
      if (!fallbackSignup.ok) {
        throw new Error(
          `Button sweep auth fallback failed: status=${fallbackSignup.status} body=${JSON.stringify(
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
      reused: false,
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
  }
}

function writeSweepArtifact(name, payload) {
  fs.mkdirSync(SWEEP_DIR, { recursive: true });
  const filePath = path.join(SWEEP_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

test.describe('Button Sweep: guest and authorized', () => {
  test.beforeAll(async ({ browser }) => {
    await ensureAuthorizedState(browser);
  });

  test.afterAll(() => {
    runtime.finishedAt = new Date().toISOString();
    writeSweepArtifact('button-sweep-runtime.json', runtime);
  });

  test('Button sweep: guest mode clicks visible buttons across pages', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(15 * 60 * 1000);
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });

    try {
      const report = await crawlAndClick(context, 'guest', testInfo);
      runtime.guest = report;
      const pathToArtifact = writeSweepArtifact('guest-button-sweep.json', report);
      await testInfo.attach('guest-button-sweep.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      if (report.totals.routesVisited === 0 && report.totals.routesBlocked > 0) {
        testInfo.annotations.push({
          type: 'blocked',
          description: 'Guest sweep blocked on all routes by challenge.',
        });
        return;
      }

      expect(
        report.totals.routesVisited,
        'Guest sweep should visit at least 1 route.'
      ).toBeGreaterThan(0);
      expect(
        report.totals.buttonsTried,
        `Guest sweep did not collect any buttons. Artifact: ${pathToArtifact}`
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('Button sweep: authorized mode clicks visible buttons across pages', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(15 * 60 * 1000);
    if (setupError) {
      testInfo.annotations.push({
        type: 'blocked',
        description: `Authorized sweep setup failed: ${setupError}`,
      });
      return;
    }

    const context = await browser.newContext({
      storageState: AUTH_STATE_PATH,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });

    try {
      const report = await crawlAndClick(context, 'authorized', testInfo);
      report.authPlayer = authPlayer;
      runtime.authorized = report;
      const pathToArtifact = writeSweepArtifact('authorized-button-sweep.json', report);
      await testInfo.attach('authorized-button-sweep.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      if (report.totals.routesVisited === 0 && report.totals.routesBlocked > 0) {
        testInfo.annotations.push({
          type: 'blocked',
          description: 'Authorized sweep blocked on all routes by challenge.',
        });
        return;
      }

      expect(
        report.totals.routesVisited,
        'Authorized sweep should visit at least 1 route.'
      ).toBeGreaterThan(0);
      expect(
        report.totals.buttonsTried,
        `Authorized sweep did not collect any buttons. Artifact: ${pathToArtifact}`
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
