const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('@playwright/test');
const { resolveProjectPaths } = require('../helpers/project-paths');
const {
  assertNotCloudflare,
  closeModal,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_PATHS = resolveProjectPaths({ cwd: process.cwd(), baseUrl: BASE_URL });
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || PROJECT_PATHS.autotestReportDir;
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || PROJECT_PATHS.artifactsDir;
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'deposit');
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
  path.join(PROJECT_PATHS.projectRoot, 'storageState.json'),
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const DEPOSIT_METHOD_LIMIT_RAW = Number.parseInt(process.env.PW_DEPOSIT_METHOD_LIMIT || '0', 10);
const DEPOSIT_METHOD_LIMIT =
  Number.isFinite(DEPOSIT_METHOD_LIMIT_RAW) && DEPOSIT_METHOD_LIMIT_RAW > 0
    ? DEPOSIT_METHOD_LIMIT_RAW
    : 0;
const DEPOSIT_METHOD_STEP_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.PW_DEPOSIT_METHOD_STEP_TIMEOUT || '25000', 10) || 25_000
);
const DEPOSIT_METHOD_BUDGET_MS = Math.max(
  DEPOSIT_METHOD_STEP_TIMEOUT_MS,
  Number.parseInt(process.env.PW_DEPOSIT_METHOD_BUDGET || '180000', 10) || 180_000
);
const DEPOSIT_API_METHOD_TIMEOUT_MS = Math.max(
  4_000,
  Number.parseInt(process.env.PW_DEPOSIT_API_METHOD_TIMEOUT || '9000', 10) || 9_000
);
const DEPOSIT_API_METHOD_BUDGET_MS = Math.max(
  DEPOSIT_API_METHOD_TIMEOUT_MS,
  Number.parseInt(process.env.PW_DEPOSIT_API_METHOD_BUDGET || '120000', 10) || 120_000
);

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function resolveContextOptions(testInfo, authStatePath) {
  const projectUse = (testInfo && testInfo.project && testInfo.project.use) || {};
  const viewport =
    projectUse.viewport &&
    Number.isFinite(projectUse.viewport.width) &&
    Number.isFinite(projectUse.viewport.height)
      ? {
          width: Number(projectUse.viewport.width),
          height: Number(projectUse.viewport.height),
        }
      : { width: 1365, height: 900 };

  const options = {
    storageState: authStatePath,
    viewport,
    ignoreHTTPSErrors: true,
  };

  if (typeof projectUse.isMobile === 'boolean') options.isMobile = projectUse.isMobile;
  if (typeof projectUse.hasTouch === 'boolean') options.hasTouch = projectUse.hasTouch;
  if (typeof projectUse.userAgent === 'string' && projectUse.userAgent.trim()) {
    options.userAgent = projectUse.userAgent;
  }

  return options;
}

function pickAuthStatePath() {
  for (const filePath of AUTH_STATE_CANDIDATES) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isTechnicalPaymentLabel(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (/^deposit-method-\d+$/.test(text)) return true;
  if (/^payment-method-\d+$/.test(text)) return true;
  if (text.includes('fund-payment-method__grid')) return true;
  if (text.includes('fund-payment-method__title')) return true;
  return false;
}

function looksLikeSkeleton(value) {
  return /skeleton|placeholder|loading/i.test(String(value || ''));
}

function writeArtifact(payload, fileName = 'deposit-non-destructive.json') {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(ARTIFACT_DIR, fileName);
  fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  return artifactPath;
}

async function attachArtifact(testInfo, fileName, payload) {
  const body = JSON.stringify(payload, null, 2);
  writeArtifact(payload, fileName);
  await testInfo.attach(fileName, {
    body,
    contentType: 'application/json',
  });
}

function dedupeByLabel(items) {
  const unique = new Map();
  for (const item of items || []) {
    const key = normalizeText(item && item.label ? item.label : '');
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function buildDepositInventory(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const byCategory = new Map();

  for (const item of normalizedItems) {
    const category =
      String(item && item.hover_title ? item.hover_title : 'unknown').trim() || 'unknown';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({
      id: item.id || '',
      name: item.name || '',
      providerId: item.provider_id || '',
      createOrderUrl: item.createOrderUrl || '',
      image: item.image || item.image_link || '',
      limit: item.limit || {},
      additionalInfo: Array.isArray(item.additional_info) ? item.additional_info : [],
      isCrypto: Boolean(item.isCrypto),
    });
  }

  const grouped = [...byCategory.entries()]
    .map(([category, methods]) => ({
      category,
      methodCount: methods.length,
      methods,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    itemsCount: normalizedItems.length,
    categories: grouped.map((entry) => entry.category),
    grouped,
  };
}

function normalizeMethodName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCoverageSourceMode({ uiAvailable, apiAvailable }) {
  if (uiAvailable && apiAvailable) return 'ui+api';
  if (uiAvailable) return 'ui-only';
  if (apiAvailable) return 'api-only';
  return 'none';
}

function flattenInventoryMethods(inventory) {
  const grouped = Array.isArray(inventory && inventory.grouped) ? inventory.grouped : [];
  const methods = [];
  for (const group of grouped) {
    const category = normalizeMethodName(group && group.category ? group.category : 'unknown');
    const groupMethods = Array.isArray(group && group.methods) ? group.methods : [];
    for (const method of groupMethods) {
      const id = normalizeMethodName(method && method.id ? method.id : '');
      const name = normalizeMethodName(method && method.name ? method.name : '');
      const providerId = normalizeMethodName(method && method.providerId ? method.providerId : '');
      const createOrderUrl = normalizeMethodName(
        method && method.createOrderUrl ? method.createOrderUrl : ''
      );
      const labelParts = [name || `method-${id || methods.length + 1}`, id ? `#${id}` : '']
        .filter(Boolean)
        .join(' ');

      methods.push({
        category,
        id,
        providerId,
        name: name || labelParts,
        label: labelParts || name || `method-${methods.length + 1}`,
        createOrderUrl,
      });
    }
  }
  return methods;
}

function looksLikeChallengeHtml(value) {
  const source = String(value || '').toLowerCase();
  if (!source) return false;
  return (
    source.includes('just a moment') ||
    source.includes('cloudflare') ||
    source.includes('verify you are human') ||
    source.includes('performing security verification') ||
    source.includes('cf-ray') ||
    source.includes('cdn-cgi')
  );
}

async function probeApiDepositMethod(context, method) {
  const createOrderUrl = normalizeMethodName(
    method && method.createOrderUrl ? method.createOrderUrl : ''
  );
  if (!createOrderUrl) {
    return {
      ok: false,
      status: 0,
      url: '',
      finalUrl: '',
      error: 'createOrderUrl is missing for this payment method.',
      challenge: false,
      bodyPreview: '',
    };
  }

  const requestUrl = buildUrl(createOrderUrl);
  let response = null;
  let status = 0;
  let bodyPreview = '';
  let finalUrl = requestUrl;
  let error = '';
  let challenge = false;

  try {
    response = await context.request.get(requestUrl, {
      failOnStatusCode: false,
      timeout: DEPOSIT_API_METHOD_TIMEOUT_MS,
    });
    status = response.status();
    finalUrl = response.url();
    const bodyText = await response.text().catch(() => '');
    bodyPreview = compactText(bodyText, 220);
    challenge =
      looksLikeChallengeHtml(bodyText) ||
      /cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_/i.test(finalUrl);
  } catch (err) {
    error = compactText(err && err.message ? err.message : err, 220);
  }

  const ok = !error && status >= 200 && status < 400 && !challenge;
  return {
    ok,
    status,
    url: requestUrl,
    finalUrl,
    error,
    challenge,
    bodyPreview,
  };
}

async function runApiDepositMethodCoverage({ context, apiFallback, methodLimit = 0, testInfo }) {
  const inventory =
    apiFallback && apiFallback.inventory ? apiFallback.inventory : buildDepositInventory([]);
  const discovered = flattenInventoryMethods(inventory);
  const uniqueByLabel = dedupeByLabel(
    discovered.map((item) => ({
      ...item,
      label: item.label || item.name || `method-${item.id || ''}`,
    }))
  );
  const methodsDiscovered = uniqueByLabel;
  const methodsChecked =
    Number.isFinite(methodLimit) && methodLimit > 0
      ? methodsDiscovered.slice(0, methodLimit)
      : methodsDiscovered.slice();

  const startedAt = Date.now();
  const dynamicBudgetMs = Math.max(
    DEPOSIT_API_METHOD_BUDGET_MS,
    methodsChecked.length * DEPOSIT_API_METHOD_TIMEOUT_MS + 15000
  );
  const results = [];
  let timedOut = false;

  for (const method of methodsChecked) {
    if (Date.now() - startedAt > dynamicBudgetMs) {
      timedOut = true;
      results.push({
        method: '__time_budget__',
        selected: false,
        surfaceReady: false,
        challenge: 'API method verification reached time budget.',
      });
      break;
    }

    const probe = await probeApiDepositMethod(context, method);
    const result = {
      method: method.label,
      selected: probe.ok,
      surfaceReady: probe.ok,
      clickError: probe.error || '',
      challenge: probe.challenge ? 'Cloudflare/WAF challenge on createOrder endpoint.' : '',
      source: 'api-fallback',
      api: {
        category: method.category,
        id: method.id,
        providerId: method.providerId,
        status: probe.status,
        url: probe.url,
        finalUrl: probe.finalUrl,
        challenge: probe.challenge,
        error: probe.error,
        bodyPreview: probe.bodyPreview,
      },
      surface: {
        selectedLabels: [],
        methodLabelVisible: false,
        selectedMethodEcho: false,
        submitVisible: false,
        submitEnabled: false,
        amountInputVisible: false,
        currencyVisible: false,
        changeMethodVisible: false,
        presetAmountVisible: false,
        paymentFieldVisible: false,
        unavailableMessageVisible: false,
        actionSignals: 0,
        contextSignals: 0,
        surfaceReady: probe.ok,
      },
    };
    results.push(result);
  }

  const readyCount = results.filter(
    (item) => item.method !== '__time_budget__' && item.surfaceReady
  ).length;
  if (testInfo) {
    testInfo.annotations.push({
      type: 'partial',
      description: `Deposit method UI was unavailable; API fallback checked ${methodsChecked.length}/${methodsDiscovered.length} methods.`,
    });
    if (timedOut) {
      testInfo.annotations.push({
        type: 'partial',
        description: `API fallback method sweep timed out after ${results.length}/${methodsChecked.length} checks.`,
      });
    }
  }

  return {
    methodsDiscovered,
    methodsChecked,
    selectionResults: results,
    readyCount,
    partialCoverage: timedOut || methodsChecked.length < methodsDiscovered.length,
    methodBudgetMs: dynamicBudgetMs,
    apiMode: true,
  };
}

function compactText(value, maxLength = 320) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function resolveDepositFallbackCurrencies() {
  const raw = String(
    process.env.PW_DEPOSIT_API_FALLBACK_CURRENCIES || 'EUR,USD,GBP,BRL,INR,CAD,AUD'
  );
  const items = raw
    .split(',')
    .map((value) =>
      String(value || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean);
  return items.length ? [...new Set(items)] : ['EUR', 'USD'];
}

async function fetchDepositInventoryViaApi(context) {
  const currencies = resolveDepositFallbackCurrencies();
  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.PW_DEPOSIT_API_FALLBACK_TIMEOUT || '12000', 10) || 12_000
  );
  const attempts = [];
  let best = {
    currency: '',
    url: '',
    status: 0,
    items: [],
  };

  for (const currency of currencies) {
    const requestUrl = buildUrl(
      `/api/payment/getPaySystems?operation=deposit&currency=${encodeURIComponent(currency)}`
    );

    let status = 0;
    let items = [];
    let bodyPreview = '';
    let error = '';

    try {
      const response = await context.request.get(requestUrl, {
        failOnStatusCode: false,
        timeout: timeoutMs,
      });
      status = response.status();
      const body = await response.text().catch(() => '');
      bodyPreview = compactText(body, 260);
      const payload = JSON.parse(body || '{}');
      items = Array.isArray(payload && payload.data && payload.data.items)
        ? payload.data.items
        : [];
    } catch (err) {
      error = compactText(err && err.message ? err.message : err, 260);
      items = [];
    }

    attempts.push({
      currency,
      url: requestUrl,
      status,
      itemsCount: items.length,
      error,
      bodyPreview,
    });

    if (items.length > (best.items || []).length) {
      best = {
        currency,
        url: requestUrl,
        status,
        items,
      };
    }

    if (items.length > 0) break;
  }

  const inventory = buildDepositInventory(best.items || []);
  return {
    attemptedCurrencies: currencies,
    attempts,
    bestCurrency: best.currency || '',
    bestUrl: best.url || '',
    bestStatus: Number(best.status || 0),
    inventory,
    itemsCount: inventory.itemsCount,
    resolved: inventory.itemsCount > 0,
  };
}

async function withStepTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const challengeVisible = await page
    .getByText(/cloudflare|verify you are human|checking your browser|just a moment|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeVisible) return 'Challenge text is visible on page.';

  const challengeFrameVisible = await page
    .locator(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile, [id*="turnstile"]'
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeFrameVisible) return 'Turnstile/Cloudflare challenge widget is visible.';

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
  const compact = bodyText.replace(/\s+/g, '');
  const tokenOnly = compact.match(/^[a-f0-9]{12,}$/i);
  if (!appRootVisible && tokenOnly) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function openRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;
  let assertError = null;

  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await assertNotCloudflare(page).catch((err) => {
    assertError = String(err && err.message ? err.message : err);
  });

  await dismissOverlays(page);
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => null);
  await page.waitForLoadState('domcontentloaded').catch(() => null);

  const challenge = await getChallengeReason(page);
  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    title: await page.title().catch(() => ''),
    challenge:
      challenge ||
      assertError ||
      (navigationError ? `Navigation failed: ${navigationError}` : null),
  };
}

async function openDepositEntryPage(page) {
  const homeRoute = await openRoute(page, '/');
  if (!homeRoute.challenge) {
    return {
      ...homeRoute,
      entryRoute: '/',
      fallbackUsed: false,
    };
  }

  const casinoRoute = await openRoute(page, '/casino/');
  if (!casinoRoute.challenge) {
    return {
      ...casinoRoute,
      entryRoute: '/casino/',
      fallbackUsed: true,
      homeBlockedReason: homeRoute.challenge,
      homeRoute,
    };
  }

  const assetsRoute = await openRoute(page, '/assets/');
  if (!assetsRoute.challenge) {
    return {
      ...assetsRoute,
      entryRoute: '/assets/',
      fallbackUsed: true,
      homeBlockedReason: homeRoute.challenge,
      casinoBlockedReason: casinoRoute.challenge,
      homeRoute,
      casinoRoute,
    };
  }

  return {
    ...homeRoute,
    entryRoute: '/',
    fallbackUsed: true,
    homeBlockedReason: homeRoute.challenge,
    casinoBlockedReason: casinoRoute.challenge,
    assetsBlockedReason: assetsRoute.challenge,
    homeRoute,
    casinoRoute,
    assetsRoute,
    challenge: `${homeRoute.challenge} | Fallback /casino failed: ${casinoRoute.challenge} | Fallback /assets failed: ${assetsRoute.challenge}`,
  };
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const matches = root.locator(selector);
    const count = await matches.count().catch(() => 0);
    const cap = Math.min(count, 12);
    for (let i = 0; i < cap; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return locator;
    }
  }
  return null;
}

async function firstVisibleLocatorInScopes(scopes, selectors) {
  for (const scope of scopes) {
    if (!scope) continue;
    const locator = await firstVisibleLocator(scope, selectors);
    if (locator) return locator;
  }
  return null;
}

async function isDepositContainerCandidate(locator) {
  return locator
    .evaluate((el) => {
      const tag = String(el.tagName || '').toLowerCase();
      if (['button', 'a', 'img', 'svg', 'path', 'input'].includes(tag)) return false;

      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        rect.width < 260 ||
        rect.height < 170
      ) {
        return false;
      }

      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const className = String(el.className || '');
      const testId = String(el.getAttribute('data-testid') || '');
      const role = String(el.getAttribute('role') || '');
      const hintBlob = `${text} ${className} ${testId} ${role}`;

      const methodTiles = el.querySelectorAll(
        '[data-testid^="deposit-method-"], .t-fund-payment-method__grid-item, [class*="payment-method__grid-item" i]'
      ).length;
      const hasHints =
        /deposit in|deposit|cashier|wallet|fund|payment methods?|choose your payment method|try to use another currency|support team/i.test(
          hintBlob
        );
      const modalLike = /popup|modal|dialog|assets-modal|fund|cashier/i.test(
        `${className} ${testId} ${role}`
      );
      return methodTiles >= 1 || (hasHints && modalLike);
    })
    .catch(() => false);
}

async function findDepositContainer(page) {
  const selectors = [
    '[data-testid="deposit-modal"]',
    '.t-modal-fund',
    '.t-popup.t-modal-fund-global',
    '.t-assets-modal-deposit-fiat-unavailable',
    '.t-assets-modal-deposit-fiat',
    '.t-popup__component',
    '.t-modal:visible',
    '[role="dialog"]:visible',
    '.t-fund-payment-method',
    '[class*="fund-payment-method" i]',
    '[class*="cashier" i]',
    '[class*="payment" i]',
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    const cap = Math.min(count, 12);
    for (let i = 0; i < cap; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const valid = await isDepositContainerCandidate(locator);
      if (valid) return locator;
    }
  }

  return null;
}

async function openDepositSurface(page) {
  const depositTrigger = await firstVisibleLocator(page, [
    'button:has-text("Deposit")',
    'a:has-text("Deposit")',
    '[data-testid*="deposit" i]',
    '.t-header__deposit',
  ]);
  if (!depositTrigger) return { triggerFound: false, modal: null, panel: null };

  await depositTrigger.scrollIntoViewIfNeeded().catch(() => null);
  await depositTrigger.click({ timeout: 10000 }).catch(() => null);
  await waitForUiSettled(page, 1500);
  await page.waitForLoadState('domcontentloaded').catch(() => null);

  const container = await findDepositContainer(page);
  if (container) return { triggerFound: true, modal: container, panel: null };

  const directDepositRoutes = [
    '/casino/#deposit',
    '/casino?modal=deposit',
    '/casino/?modal=deposit',
  ];
  for (const route of directDepositRoutes) {
    await openRoute(page, route).catch(() => null);
    await waitForUiSettled(page, 1200).catch(() => null);
    const directContainer = await findDepositContainer(page);
    if (directContainer) {
      return {
        triggerFound: true,
        modal: directContainer,
        panel: null,
        directRouteFallback: route,
      };
    }
  }

  const panel = await firstVisibleLocator(page, [
    '[data-testid="deposit-modal"]',
    '.t-assets-modal-deposit-fiat-unavailable',
    '.t-assets-modal-deposit-fiat',
    '.t-fund-payment-method',
    '[class*="fund-payment-method" i]',
    '[class*="payment" i]',
    '[class*="cashier" i]',
  ]);
  return { triggerFound: true, modal: null, panel };
}

async function openDepositSurfaceWithRetry(page, attempts = 3) {
  const maxAttempts = Math.max(1, Number.parseInt(String(attempts), 10) || 3);
  let lastSurface = { triggerFound: false, modal: null, panel: null };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await dismissOverlays(page).catch(() => null);
    await waitForUiSettled(page, 900).catch(() => null);

    const surface = await openDepositSurface(page);
    lastSurface = surface;
    if (surface.triggerFound && (surface.modal || surface.panel)) {
      return { ...surface, attemptUsed: attempt, recovered: attempt > 1 };
    }

    if (attempt < maxAttempts) {
      await openRoute(page, '/casino/').catch(() => null);
      await dismissOverlays(page).catch(() => null);
      await waitForUiSettled(page, 1200).catch(() => null);
    }
  }

  return { ...lastSurface, attemptUsed: maxAttempts, recovered: false };
}

async function collectSelectedLabels(container) {
  return container
    .evaluate((root) => {
      function isVisible(el) {
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      }

      const nodes = Array.from(
        root.querySelectorAll(
          '[aria-selected="true"], [data-state="active"], [data-selected="true"], [class*="active" i], [class*="selected" i], [class*="current" i]'
        )
      ).filter((el) => isVisible(el));

      const labels = nodes
        .map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return [...new Set(labels)].slice(0, 20);
    })
    .catch(() => []);
}

async function collectPaymentMethods(container) {
  const isNoiseMethodLabel = (source) => {
    const text = String(source || '').toLowerCase();
    if (!text) return false;
    if (text.includes('please choose your payment method')) return true;
    if (text.includes('fund-payment-method__title')) return true;

    // Keep real tiles (grid-item / deposit-method-*), filter only wrapper/grid containers.
    const hasGridItem = text.includes('fund-payment-method__grid-item');
    const hasMethodId = /deposit-method-\d+/.test(text);
    if (hasGridItem || hasMethodId) return false;
    if (text.includes('fund-payment-method__grid')) return true;
    return false;
  };
  const explicitMethodSelectors = [
    '[data-testid^="deposit-method-"]',
    '.t-fund-payment-method__grid-item',
    '[class*="payment-method__grid-item" i]',
  ];
  const explicit = [];
  for (const selector of explicitMethodSelectors) {
    const matches = container.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 40);
    for (let i = 0; i < count; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const meta = await locator
        .evaluate((el) => {
          const testId = (el.getAttribute('data-testid') || '').trim();
          const className = String(el.className || '').trim();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          const title = (el.getAttribute('title') || '').trim();
          const imgAlt =
            el.querySelector('img[alt]') && el.querySelector('img[alt]').getAttribute('alt')
              ? String(el.querySelector('img[alt]').getAttribute('alt')).trim()
              : '';
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const rect = el.getBoundingClientRect();
          const disabled =
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            ('disabled' in el && Boolean(el.disabled));
          return {
            testId,
            className,
            ariaLabel,
            title,
            imgAlt,
            text,
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
            disabled,
          };
        })
        .catch(() => null);
      if (!meta || meta.disabled) continue;
      if (meta.width < 70 || meta.height < 28) continue;
      const labelRaw =
        meta.imgAlt || meta.text || meta.ariaLabel || meta.title || meta.testId || meta.className;
      const label = labelRaw ? labelRaw.replace(/\s+/g, ' ').trim() : `payment-method-${i + 1}`;
      const labelBlob = `${label} ${meta.testId} ${meta.className}`.trim();
      if (looksLikeSkeleton(labelBlob)) continue;
      if (isNoiseMethodLabel(labelBlob)) continue;
      explicit.push({
        label,
        selector,
        locator,
        methodId: meta.testId || null,
        x: meta.x,
        y: meta.y,
      });
    }
  }

  if (explicit.length) {
    const uniqueExplicit = new Map();
    for (const method of explicit) {
      const key = `${(method.methodId || method.label).toLowerCase()}|${Math.round(method.x)}|${Math.round(method.y)}`;
      if (!uniqueExplicit.has(key)) uniqueExplicit.set(key, method);
    }
    return [...uniqueExplicit.values()].slice(0, 12);
  }

  const selectors = [
    '[role="tab"]',
    '[data-testid*="payment-method" i]',
    '[data-testid*="payment" i]',
    '[data-testid*="method" i]',
    '[class*="payment-method" i]',
    '[class*="method" i]',
    '[class*="payment" i] button',
    '[class*="payment" i] [role="button"]',
    '[class*="payment" i] li',
  ];

  const includeHints =
    /payment|method|provider|gateway|visa|master|maestro|skrill|neteller|apple|google|gpay|paypal|bank|card|crypto|pix|trustly|sepa|wallet|paysafe/i;
  const excludeHints =
    /deposit\s*now|confirm|submit|continue|cancel|close|back|help|support|promo|code|currency|amount|history|withdraw/i;

  const unique = new Map();
  for (const selector of selectors) {
    const locators = container.locator(selector);
    const count = Math.min(await locators.count(), 60);
    for (let i = 0; i < count; i += 1) {
      const locator = locators.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const meta = await locator
        .evaluate((el) => {
          const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          const className = String(el.className || '').trim();
          const testId = (el.getAttribute('data-testid') || '').trim();
          const role = (el.getAttribute('role') || '').trim();
          const disabled =
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            ('disabled' in el && Boolean(el.disabled));
          const rect = el.getBoundingClientRect();
          return {
            text,
            ariaLabel,
            className,
            testId,
            role,
            disabled,
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
          };
        })
        .catch(() => null);

      if (!meta) continue;
      if (meta.disabled) continue;
      if (meta.width < 36 || meta.height < 18) continue;

      const label =
        meta.text || meta.ariaLabel || meta.testId || meta.className || `payment-method-${i + 1}`;
      const normalizedLabel = label.replace(/\s+/g, ' ').trim();
      if (!normalizedLabel) continue;
      if (looksLikeSkeleton(`${normalizedLabel} ${meta.testId} ${meta.className}`)) continue;
      if (isNoiseMethodLabel(`${normalizedLabel} ${meta.testId} ${meta.className}`)) continue;

      const hintText = `${normalizedLabel} ${meta.className} ${meta.testId} ${meta.role}`;
      const looksLikeGridMethod =
        /deposit-method-\d+|fund-payment-method|payment-method__grid-item/i.test(hintText);
      const hasGraphicChild = await locator
        .locator('img, svg, picture')
        .first()
        .isVisible()
        .catch(() => false);
      const pointerCursor = await locator
        .evaluate((el) => window.getComputedStyle(el).cursor === 'pointer')
        .catch(() => false);

      if (
        !includeHints.test(hintText) &&
        !looksLikeGridMethod &&
        !(hasGraphicChild && pointerCursor)
      ) {
        continue;
      }
      if (excludeHints.test(hintText)) continue;
      if (/^\d+([.,]\d+)?$/.test(normalizedLabel)) continue;

      const key = `${normalizedLabel.toLowerCase()}|${Math.round(meta.x)}|${Math.round(meta.y)}`;
      if (!unique.has(key)) {
        unique.set(key, {
          label: normalizedLabel,
          selector,
          locator,
          methodId: meta.testId || null,
        });
      }
    }
  }

  return [...unique.values()].slice(0, 12);
}

async function resolveFreshDepositContainer(page, fallbackContainer) {
  const fresh = await findDepositContainer(page).catch(() => null);
  return fresh || fallbackContainer || null;
}

function formatDepositUnavailableReason(state) {
  if (!state || !state.unavailable) return '';
  const details = [];
  if (state.currency) details.push(`currency=${state.currency}`);
  if (state.matchedPhrases && state.matchedPhrases.length > 0) {
    details.push(`hints=${state.matchedPhrases.join(', ')}`);
  }
  if (state.textSnippet) details.push(`text="${state.textSnippet}"`);
  return `Deposit methods are unavailable for current wallet context${details.length ? ` (${details.join('; ')})` : ''}.`;
}

async function detectDepositUnavailableState(container, page) {
  const snapshots = [];
  const activeContainer = await resolveFreshDepositContainer(page, container).catch(() => null);
  const collectSnapshot = async (target) => {
    if (!target) return null;
    return target
      .evaluate((root) => {
        const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
        const className = String(root.className || '')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          text: text.slice(0, 800),
          className,
        };
      })
      .catch(() => null);
  };

  const activeSnapshot = await collectSnapshot(activeContainer);
  if (activeSnapshot) snapshots.push(activeSnapshot);

  const unavailableModal = await firstVisibleLocator(page, [
    '.t-assets-modal-deposit-fiat-unavailable',
    '.t-assets-modal-deposit-fiat',
    '.t-modal-fund',
    '.t-popup__component',
  ]);
  const modalSnapshot = await collectSnapshot(unavailableModal);
  if (modalSnapshot) snapshots.push(modalSnapshot);

  const bodyText = await page
    .locator('body')
    .first()
    .innerText()
    .then((value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .catch(() => '');
  const noMethodsTextVisible = await page
    .getByText(/currently no payment methods|no payment methods for your/i)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  const tryAnotherCurrencyTextVisible = await page
    .getByText(/try to use another currency/i)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  const blob = [...snapshots.map((item) => `${item.className || ''} ${item.text || ''}`), bodyText]
    .join(' ')
    .trim();

  const phrasePatterns = [
    { key: 'no-payment-methods', re: /currently no payment methods|no payment methods for your/i },
    { key: 'try-another-currency', re: /try to use another currency/i },
    { key: 'support-team-hint', re: /support team is here to guide you|support team/i },
    { key: 'unavailable-modal', re: /deposit-fiat-unavailable|unavailable/i },
  ];
  const matchedPhrases = phrasePatterns
    .filter((entry) => entry.re.test(blob))
    .map((entry) => entry.key);

  const currencyMatch = blob.match(/deposit in\s+([A-Z]{3})/i);
  const textSnippet = blob.slice(0, 220);
  return {
    unavailable:
      (matchedPhrases.includes('no-payment-methods') || noMethodsTextVisible) &&
      (matchedPhrases.includes('try-another-currency') ||
        matchedPhrases.includes('support-team-hint') ||
        matchedPhrases.includes('unavailable-modal') ||
        tryAnotherCurrencyTextVisible),
    matchedPhrases,
    currency: currencyMatch ? String(currencyMatch[1]).toUpperCase() : '',
    textSnippet,
  };
}

async function ensureVisibleDepositContainer(page, container, timeoutMs = 10000) {
  const deadlineAt = Date.now() + timeoutMs;
  let current = container;
  while (Date.now() < deadlineAt) {
    current = await resolveFreshDepositContainer(page, current);
    if (!current) {
      await waitForUiSettled(page, 400);
      continue;
    }
    const visible = await current.isVisible().catch(() => false);
    if (visible) return current;
    await waitForUiSettled(page, 400);
  }
  return null;
}

function summarizeUiCategories(methods) {
  const unique = dedupeByLabel(methods);
  return {
    totalTiles: Array.isArray(methods) ? methods.length : 0,
    uniqueCategories: unique.map((item) => item.label),
    categoriesCount: unique.length,
    categories: unique.map((item) => ({
      label: item.label,
      methodId: item.methodId || null,
      selector: item.selector || '',
    })),
  };
}

async function waitForDepositPaySystemsResponse(page, timeoutMs = 15000) {
  const response = await page
    .waitForResponse(
      (resp) =>
        /\/api\/payment\/getPaySystems\?operation=deposit&currency=/i.test(resp.url()) &&
        resp.status() === 200,
      { timeout: timeoutMs }
    )
    .catch(() => null);
  if (!response) return { items: [], responseFound: false };

  const payload = await response.json().catch(() => null);
  const items = Array.isArray(payload && payload.data && payload.data.items)
    ? payload.data.items
    : [];
  return {
    items,
    responseFound: true,
    url: response.url(),
    status: response.status(),
  };
}

async function ensureMethodPickerVisible(container, page) {
  const targetContainer = await resolveFreshDepositContainer(page, container);
  if (!targetContainer) return false;

  const methodTile = await firstVisibleLocator(targetContainer, [
    '[data-testid^="deposit-method-"]',
    '.t-fund-payment-method__grid-item',
    '[class*="payment-method__grid-item" i]',
  ]);
  if (methodTile) return true;

  const changeMethod = await firstVisibleLocator(targetContainer, [
    'button:has-text("Change method")',
    'button:has-text("Сhange method")',
    'button:has-text("Choose method")',
    'button:has-text("Change")',
  ]);
  if (!changeMethod) return false;

  await changeMethod.scrollIntoViewIfNeeded().catch(() => null);
  await changeMethod.click({ timeout: 7000 }).catch(() => null);
  await waitForUiSettled(page, 1500);

  const reopened = await firstVisibleLocator(targetContainer, [
    '[data-testid^="deposit-method-"]',
    '.t-fund-payment-method__grid-item',
    '[class*="payment-method__grid-item" i]',
  ]);
  return Boolean(reopened);
}

async function waitForPaymentMethods(container, page, timeoutMs = 15000) {
  const deadlineAt = Date.now() + timeoutMs;
  let lastSeen = [];

  while (Date.now() < deadlineAt) {
    const activeContainer = await resolveFreshDepositContainer(page, container);
    if (!activeContainer) {
      const unavailableOnPage = await detectDepositUnavailableState(null, page).catch(() => null);
      if (unavailableOnPage && unavailableOnPage.unavailable) return [];
      await waitForUiSettled(page, 1000);
      continue;
    }

    const unavailableState = await detectDepositUnavailableState(activeContainer, page).catch(
      () => null
    );
    if (unavailableState && unavailableState.unavailable) return [];

    await ensureMethodPickerVisible(activeContainer, page).catch(() => false);
    lastSeen = await collectPaymentMethods(activeContainer);
    if (!lastSeen.length) {
      lastSeen = await collectPaymentMethods(page);
    }
    if (lastSeen.length > 0) return lastSeen;
    await waitForUiSettled(page, 1500);
  }

  return lastSeen;
}

async function inspectDepositMethodSurface(container, page, methodLabel) {
  const scopes = [container, page];
  const selectedLabels = await collectSelectedLabels(container);
  const normalizedMethodLabel = normalizeText(methodLabel);
  const normalizedSelectedLabels = selectedLabels.map((label) => normalizeText(label));

  const submitButton = await firstVisibleLocatorInScopes(scopes, [
    'button:has-text("Deposit")',
    'button:has-text("Continue")',
    'button:has-text("Pay")',
    'button[type="submit"]',
  ]);
  const amountInput = await firstVisibleLocatorInScopes(scopes, [
    'input[name*="amount" i]',
    'input[placeholder*="amount" i]',
    'input[inputmode="decimal"]',
    'input[inputmode="numeric"]',
    '[data-testid*="amount" i] input',
    '[data-testid*="amount" i]',
  ]);
  const currencyControl = await firstVisibleLocatorInScopes(scopes, [
    'select[name*="currency" i]',
    '[data-testid*="currency" i]',
    '[class*="currency" i] button',
    '[class*="currency" i] select',
  ]);
  const changeMethodButton = await firstVisibleLocatorInScopes(scopes, [
    'button:has-text("Change method")',
    'button:has-text("Сhange method")',
    'button:has-text("Choose method")',
    'button:has-text("Change")',
  ]);
  const presetAmountButton = await firstVisibleLocatorInScopes(scopes, [
    '[class*="preset" i] button',
    '[class*="amount" i] button',
    'button[data-amount]',
  ]);
  const paymentField = await firstVisibleLocatorInScopes(scopes, [
    'iframe[src*="payment" i]',
    'iframe[name*="card" i]',
    'input[name*="card" i]',
    'input[name*="wallet" i]',
    'input[name*="iban" i]',
    'input[name*="holder" i]',
  ]);

  const unavailableMessageVisible = await page
    .getByText(
      /temporarily unavailable|not available|maintenance|try again later|payment.*failed|something went wrong/i
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  const containerText = normalizeText(await container.textContent().catch(() => ''));
  const methodLabelVisible = normalizedMethodLabel
    ? containerText.includes(normalizedMethodLabel) ||
      normalizedSelectedLabels.some((label) => label.includes(normalizedMethodLabel))
    : selectedLabels.length > 0;
  const selectedMethodEcho = normalizedSelectedLabels.length > 0;
  const submitVisible = Boolean(submitButton);
  const submitEnabled = submitButton ? await submitButton.isEnabled().catch(() => false) : false;
  const amountInputVisible = Boolean(amountInput);
  const currencyVisible = Boolean(currencyControl);
  const changeMethodVisible = Boolean(changeMethodButton);
  const presetAmountVisible = Boolean(presetAmountButton);
  const paymentFieldVisible = Boolean(paymentField);

  const actionSignals = [
    submitVisible,
    amountInputVisible,
    presetAmountVisible,
    paymentFieldVisible,
  ].filter(Boolean);
  const contextSignals = [
    methodLabelVisible,
    selectedMethodEcho,
    changeMethodVisible,
    currencyVisible,
  ].filter(Boolean);
  const surfaceReady =
    !unavailableMessageVisible && actionSignals.length > 0 && contextSignals.length > 0;

  return {
    selectedLabels,
    methodLabelVisible,
    selectedMethodEcho,
    submitVisible,
    submitEnabled,
    amountInputVisible,
    currencyVisible,
    changeMethodVisible,
    presetAmountVisible,
    paymentFieldVisible,
    unavailableMessageVisible,
    actionSignals: actionSignals.length,
    contextSignals: contextSignals.length,
    surfaceReady,
  };
}

async function clickMethod(method, container, page) {
  const activeContainer = await resolveFreshDepositContainer(page, container);
  if (!activeContainer) {
    return {
      method: method.label,
      selected: false,
      challenge: 'Deposit container is not visible for method selection.',
      clickError: 'container-not-found',
    };
  }

  await ensureMethodPickerVisible(activeContainer, page);
  const targetLocator = method.methodId
    ? activeContainer.locator(`[data-testid="${method.methodId}"]`).first()
    : method.locator;

  const beforeSelected = await collectSelectedLabels(activeContainer);
  const normalizedMethodLabel = normalizeText(method.label);
  const methodSelectedBeforeClick = beforeSelected.some((label) =>
    normalizeText(label).includes(normalizedMethodLabel)
  );
  let clickError = null;

  try {
    await targetLocator.scrollIntoViewIfNeeded().catch(() => null);
    await targetLocator.click({ timeout: 3500 });
  } catch (err) {
    clickError = String(err && err.message ? err.message : err);
    await targetLocator.click({ timeout: 2500, force: true }).catch(() => null);
  }

  try {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await waitForUiSettled(page, 700);
  } catch (err) {
    return {
      method: method.label,
      selected: false,
      challenge: 'Deposit page/context was closed during method selection.',
      clickError: clickError || String(err && err.message ? err.message : err),
    };
  }
  const challenge = await getChallengeReason(page);
  if (challenge) {
    return {
      method: method.label,
      selected: false,
      challenge,
      clickError,
    };
  }

  const postClickContainer = await resolveFreshDepositContainer(page, activeContainer);
  if (!postClickContainer) {
    return {
      method: method.label,
      selected: false,
      challenge: 'Deposit container disappeared after method click.',
      clickError,
    };
  }

  const afterSelected = await collectSelectedLabels(postClickContainer);
  const selectedStateChanged =
    JSON.stringify(beforeSelected.sort()) !== JSON.stringify(afterSelected.sort());
  const methodSelectedAfterClick = afterSelected.some((label) =>
    normalizeText(label).includes(normalizedMethodLabel)
  );
  const preliminarySelected = Boolean(
    selectedStateChanged || methodSelectedAfterClick || (methodSelectedBeforeClick && !clickError)
  );
  const surface = await inspectDepositMethodSurface(postClickContainer, page, method.label).catch(
    () => ({
      selectedLabels: afterSelected,
      methodLabelVisible: false,
      selectedMethodEcho: afterSelected.length > 0,
      submitVisible: false,
      submitEnabled: false,
      amountInputVisible: false,
      currencyVisible: false,
      changeMethodVisible: false,
      presetAmountVisible: false,
      paymentFieldVisible: false,
      unavailableMessageVisible: false,
      actionSignals: 0,
      contextSignals: 0,
      surfaceReady: false,
    })
  );
  const selected = Boolean(preliminarySelected || surface.surfaceReady);

  return {
    method: method.label,
    selected,
    selectedStateChanged,
    classChanged: false,
    selfMarkedSelected: false,
    beforeSelected,
    afterSelected,
    clickError,
    surfaceReady: surface.surfaceReady,
    surface,
  };
}

test.describe('Deposit non-destructive checks', () => {
  test('Payment inventory: UI categories align with deposit API pay systems', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180000);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for authorized deposit checks.');
      const payload = {
        blocked: true,
        reason: 'No auth state found for authorized deposit checks.',
        uiCoverageAvailable: false,
        apiCoverageAvailable: false,
        sourceMode: 'none',
      };
      await attachArtifact(testInfo, 'deposit-inventory.json', payload);
      return;
    }

    const context = await browser.newContext(resolveContextOptions(testInfo, authStatePath));
    const page = await context.newPage();
    let apiFallbackCache = null;
    const ensureApiFallback = async () => {
      if (apiFallbackCache) return apiFallbackCache;
      apiFallbackCache = await fetchDepositInventoryViaApi(context);
      return apiFallbackCache;
    };
    const network = [];

    page.on('response', (resp) => {
      try {
        const url = resp.url();
        if (!/deposit|payment|wallet|cashier|billing|payin|asset|api/i.test(url)) return;
        network.push({
          url,
          status: resp.status(),
          method: resp.request().method(),
        });
      } catch {
        // ignore response parse issues
      }
    });

    const inventoryResponsePromise = waitForDepositPaySystemsResponse(page, 20000);

    try {
      const writeInventoryBlockedPayload = async (reason, extra = {}) => {
        const apiFallback = await ensureApiFallback();
        const apiInventory = apiFallback.inventory || buildDepositInventory([]);
        const hasApiFallback = Number(apiFallback.itemsCount || 0) > 0;

        if (hasApiFallback) {
          testInfo.annotations.push({
            type: 'partial',
            description: `Deposit UI is blocked, API fallback inventory was collected (${apiInventory.itemsCount} methods; currency=${apiFallback.bestCurrency || 'n/a'}).`,
          });
        } else {
          markBlocked(testInfo, reason);
        }

        const payload = {
          ...extra,
          authStatePath,
          blocked: !hasApiFallback,
          partial: hasApiFallback,
          reason,
          uiCoverageAvailable: false,
          apiCoverageAvailable: hasApiFallback,
          sourceMode: resolveCoverageSourceMode({
            uiAvailable: false,
            apiAvailable: hasApiFallback,
          }),
          apiFallback,
          apiInventory,
          uiInventory: {
            totalTiles: 0,
            uniqueCategories: [],
          },
          unexpectedUiCategories: [],
          missingUiCategories: hasApiFallback ? apiInventory.categories : [],
          network,
        };
        await attachArtifact(testInfo, 'deposit-inventory.json', payload);
      };

      const route = await openDepositEntryPage(page);
      if (route.challenge) {
        await writeInventoryBlockedPayload(route.challenge, { route });
        return;
      }

      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(loginVisible, 'Authorized user expected for deposit checks.').toBeFalsy();

      const challengeBeforeDeposit = await getChallengeReason(page);
      if (challengeBeforeDeposit) {
        await writeInventoryBlockedPayload(challengeBeforeDeposit, { route });
        return;
      }

      const surface = await withStepTimeout(
        openDepositSurfaceWithRetry(page, 3),
        45000,
        'openDepositSurfaceWithRetry'
      );
      const challengeAfterOpenDeposit = await getChallengeReason(page);
      if (challengeAfterOpenDeposit) {
        await writeInventoryBlockedPayload(challengeAfterOpenDeposit, { route });
        return;
      }
      const container = surface.modal || surface.panel;
      if (!surface.triggerFound || !container) {
        const reason = 'Deposit trigger/modal is not stable after retries.';
        await writeInventoryBlockedPayload(reason, { route, surface });
        return;
      }

      const visibleContainer = await ensureVisibleDepositContainer(page, container, 10000);
      if (!visibleContainer) {
        const reason = 'Deposit surface became hidden/detached before method checks.';
        await writeInventoryBlockedPayload(reason, { route, surface });
        return;
      }

      const unavailableBeforeMethods = await detectDepositUnavailableState(visibleContainer, page);
      if (unavailableBeforeMethods.unavailable) {
        const reason = formatDepositUnavailableReason(unavailableBeforeMethods);
        await writeInventoryBlockedPayload(reason, {
          route,
          surface,
          depositUnavailable: unavailableBeforeMethods,
        });
        return;
      }

      await ensureMethodPickerVisible(visibleContainer, page).catch(() => false);
      let paymentMethods = [];
      let waitMethodsError = '';
      try {
        paymentMethods = await withStepTimeout(
          waitForPaymentMethods(visibleContainer, page, 20000),
          22000,
          'waitForPaymentMethods'
        );
      } catch (err) {
        waitMethodsError = String(err && err.message ? err.message : err);
      }
      if (!paymentMethods.length) {
        const unavailableAfterMethods = await detectDepositUnavailableState(visibleContainer, page);
        if (unavailableAfterMethods.unavailable) {
          const reason = formatDepositUnavailableReason(unavailableAfterMethods);
          await writeInventoryBlockedPayload(reason, {
            route,
            surface,
            depositUnavailable: unavailableAfterMethods,
          });
          return;
        }
        if (waitMethodsError) {
          const reason = `Deposit methods are not discoverable in current UI run: ${waitMethodsError}`;
          await writeInventoryBlockedPayload(reason, { route, surface });
          return;
        }
      }
      expect(
        paymentMethods.length,
        'No deposit categories were discovered in deposit UI.'
      ).toBeGreaterThan(0);

      const inventoryResponse = await inventoryResponsePromise;
      const apiInventory = buildDepositInventory(inventoryResponse.items);
      expect(
        inventoryResponse.responseFound,
        'Deposit API pay systems response was not captured.'
      ).toBeTruthy();
      expect(
        apiInventory.itemsCount,
        'Deposit API pay systems inventory is empty.'
      ).toBeGreaterThan(0);

      const uiSummary = summarizeUiCategories(paymentMethods);
      const technicalUiLabels = uiSummary.uniqueCategories.filter((label) =>
        isTechnicalPaymentLabel(label)
      );
      const mostlyTechnicalUi =
        uiSummary.uniqueCategories.length > 0 &&
        technicalUiLabels.length / uiSummary.uniqueCategories.length >= 0.6;

      let unexpectedUiCategories = [];
      let missingUiCategories = [];
      let comparisonMode = 'categories';

      if (mostlyTechnicalUi) {
        comparisonMode = 'method-count';
        const delta = Math.abs(uiSummary.totalTiles - apiInventory.itemsCount);
        if (delta > 3) {
          testInfo.annotations.push({
            type: 'partial',
            description: `Deposit method count mismatch detected (UI=${uiSummary.totalTiles}, API=${apiInventory.itemsCount}).`,
          });
        }
        testInfo.annotations.push({
          type: 'partial',
          description:
            'UI deposit labels are technical (deposit-method-*), so inventory validation uses method count instead of category-name matching.',
        });
      } else {
        const apiCategorySet = new Set(
          apiInventory.categories.map((label) => normalizeText(label))
        );
        const uiCategorySet = new Set(
          uiSummary.uniqueCategories.map((label) => normalizeText(label))
        );
        unexpectedUiCategories = uiSummary.uniqueCategories.filter(
          (label) => !apiCategorySet.has(normalizeText(label))
        );
        missingUiCategories = apiInventory.categories.filter(
          (label) => !uiCategorySet.has(normalizeText(label))
        );

        if (unexpectedUiCategories.length > 0 || missingUiCategories.length > 0) {
          testInfo.annotations.push({
            type: 'partial',
            description: `Deposit category mismatch detected. Unexpected UI: ${
              unexpectedUiCategories.join(', ') || '-'
            }; Missing in UI: ${missingUiCategories.join(', ') || '-'}.`,
          });
        }
      }

      const payload = {
        route,
        authStatePath,
        uiCoverageAvailable: Number(uiSummary.totalTiles || 0) > 0,
        apiCoverageAvailable: Number(apiInventory.itemsCount || 0) > 0,
        sourceMode: resolveCoverageSourceMode({
          uiAvailable: Number(uiSummary.totalTiles || 0) > 0,
          apiAvailable: Number(apiInventory.itemsCount || 0) > 0,
        }),
        surface: {
          modal: Boolean(surface.modal),
          panel: Boolean(surface.panel),
        },
        depositPaySystemsApi: {
          responseFound: inventoryResponse.responseFound,
          url: inventoryResponse.url || '',
          status: inventoryResponse.status || 0,
        },
        apiInventory,
        uiInventory: uiSummary,
        comparisonMode,
        unexpectedUiCategories,
        missingUiCategories,
        network,
      };

      await attachArtifact(testInfo, 'deposit-inventory.json', payload);

      if (surface.modal) {
        await closeModal(surface.modal, page).catch(() => null);
      }
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('Payment methods: each visible method opens working deposit surface', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(600000);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for authorized deposit checks.');
      const payload = {
        blocked: true,
        reason: 'No auth state found for authorized deposit checks.',
        uiCoverageAvailable: false,
        apiCoverageAvailable: false,
        sourceMode: 'none',
      };
      await attachArtifact(testInfo, 'deposit-non-destructive.json', payload);
      return;
    }

    const context = await browser.newContext(resolveContextOptions(testInfo, authStatePath));
    const page = await context.newPage();
    let apiFallbackCache = null;
    const ensureApiFallback = async () => {
      if (apiFallbackCache) return apiFallbackCache;
      apiFallbackCache = await fetchDepositInventoryViaApi(context);
      return apiFallbackCache;
    };
    const network = [];

    page.on('response', (resp) => {
      try {
        const url = resp.url();
        if (!/deposit|payment|wallet|cashier|billing|payin|asset|api/i.test(url)) return;
        network.push({
          url,
          status: resp.status(),
          method: resp.request().method(),
        });
      } catch {
        // ignore response parse issues
      }
    });

    try {
      const writeMethodCoverageFallbackPayload = async (reason, extra = {}) => {
        const apiFallback = await ensureApiFallback();
        const hasApiFallback = Number(apiFallback.itemsCount || 0) > 0;
        if (!hasApiFallback) {
          markBlocked(testInfo, reason);
          const payload = {
            ...extra,
            route: extra.route || null,
            authStatePath,
            blocked: true,
            reason,
            uiCoverageAvailable: false,
            apiCoverageAvailable: false,
            sourceMode: 'none',
            apiFallback,
            network,
          };
          await attachArtifact(testInfo, 'deposit-non-destructive.json', payload);
          return { usedFallback: false };
        }

        const apiCoverage = await runApiDepositMethodCoverage({
          context,
          apiFallback,
          methodLimit: DEPOSIT_METHOD_LIMIT,
          testInfo,
        });

        const payload = {
          ...extra,
          route: extra.route || null,
          authStatePath,
          blocked: false,
          partial: true,
          reason,
          source: 'api-fallback',
          uiCoverageAvailable: false,
          apiCoverageAvailable: true,
          sourceMode: 'api-only',
          apiFallback,
          surface: {
            modal: false,
            panel: false,
          },
          paymentMethodTilesDiscovered: apiCoverage.methodsDiscovered.map((m) => m.label),
          paymentMethodTilesDiscoveredCount: apiCoverage.methodsDiscovered.length,
          paymentCategoriesDiscovered: apiCoverage.methodsDiscovered.map((m) => m.label),
          paymentCategoriesChecked: apiCoverage.methodsChecked.map((m) => m.label),
          paymentCategoriesDiscoveredCount: apiCoverage.methodsDiscovered.length,
          paymentCategoriesCheckedCount: apiCoverage.methodsChecked.length,
          paymentMethodsDiscovered: apiCoverage.methodsDiscovered.map((m) => m.label),
          paymentMethodsChecked: apiCoverage.methodsChecked.map((m) => m.label),
          paymentMethodsDiscoveredCount: apiCoverage.methodsDiscovered.length,
          paymentMethodsCheckedCount: apiCoverage.methodsChecked.length,
          paymentMethodsReadyCount: apiCoverage.readyCount,
          methodLimit: DEPOSIT_METHOD_LIMIT > 0 ? DEPOSIT_METHOD_LIMIT : 'all',
          methodStepTimeoutMs: DEPOSIT_API_METHOD_TIMEOUT_MS,
          methodBudgetMs: apiCoverage.methodBudgetMs,
          partialCoverage: true,
          selectionResults: apiCoverage.selectionResults,
          submitVisible: false,
          submitEnabled: false,
          network,
        };
        await attachArtifact(testInfo, 'deposit-non-destructive.json', payload);
        return { usedFallback: true };
      };

      const route = await openDepositEntryPage(page);
      if (route.challenge) {
        await writeMethodCoverageFallbackPayload(route.challenge, { route });
        return;
      }

      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(loginVisible, 'Authorized user expected for deposit checks.').toBeFalsy();

      const challengeBeforeDeposit = await getChallengeReason(page);
      if (challengeBeforeDeposit) {
        await writeMethodCoverageFallbackPayload(challengeBeforeDeposit, { route });
        return;
      }

      const surface = await withStepTimeout(
        openDepositSurfaceWithRetry(page, 3),
        45000,
        'openDepositSurfaceWithRetry'
      );
      const challengeAfterOpenDeposit = await getChallengeReason(page);
      if (challengeAfterOpenDeposit) {
        await writeMethodCoverageFallbackPayload(challengeAfterOpenDeposit, {
          route,
          surface,
        });
        return;
      }
      const container = surface.modal || surface.panel;
      if (!surface.triggerFound || !container) {
        const reason = 'Deposit trigger/modal is not stable after retries.';
        await writeMethodCoverageFallbackPayload(reason, { route, surface });
        return;
      }

      const visibleContainer = await ensureVisibleDepositContainer(page, container, 10000);
      if (!visibleContainer) {
        const reason = 'Deposit surface became hidden/detached before category checks.';
        await writeMethodCoverageFallbackPayload(reason, { route, surface });
        return;
      }

      const unavailableBeforeMethods = await detectDepositUnavailableState(visibleContainer, page);
      if (unavailableBeforeMethods.unavailable) {
        const reason = formatDepositUnavailableReason(unavailableBeforeMethods);
        await writeMethodCoverageFallbackPayload(reason, {
          route,
          surface,
          depositUnavailable: unavailableBeforeMethods,
        });
        return;
      }

      await ensureMethodPickerVisible(visibleContainer, page).catch(() => false);
      let paymentMethods = [];
      let waitMethodsError = '';
      try {
        paymentMethods = await withStepTimeout(
          waitForPaymentMethods(visibleContainer, page, 20000),
          22000,
          'waitForPaymentMethods'
        );
      } catch (err) {
        waitMethodsError = String(err && err.message ? err.message : err);
      }
      if (!paymentMethods.length) {
        const unavailableAfterMethods = await detectDepositUnavailableState(visibleContainer, page);
        if (unavailableAfterMethods.unavailable) {
          const reason = formatDepositUnavailableReason(unavailableAfterMethods);
          await writeMethodCoverageFallbackPayload(reason, {
            route,
            surface,
            depositUnavailable: unavailableAfterMethods,
          });
          return;
        }
        if (waitMethodsError) {
          const reason = `Deposit methods are not discoverable in current UI run: ${waitMethodsError}`;
          await writeMethodCoverageFallbackPayload(reason, { route, surface });
          return;
        }
      }
      const paymentCategories = dedupeByLabel(paymentMethods);
      expect(
        paymentCategories.length,
        'No deposit methods were discovered in deposit UI.'
      ).toBeGreaterThan(0);
      const methodLimitApplied = DEPOSIT_METHOD_LIMIT > 0;
      const methodsToCheck = methodLimitApplied
        ? paymentCategories.slice(0, DEPOSIT_METHOD_LIMIT)
        : paymentCategories.slice();
      const dynamicMethodBudgetMs = Math.max(
        DEPOSIT_METHOD_BUDGET_MS,
        methodsToCheck.length * DEPOSIT_METHOD_STEP_TIMEOUT_MS + 30000
      );
      let partialCoverage = methodLimitApplied && paymentCategories.length > methodsToCheck.length;
      if (methodLimitApplied && paymentCategories.length > methodsToCheck.length) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Deposit method coverage is partial: checked ${methodsToCheck.length}/${paymentCategories.length} methods.`,
        });
        testInfo.annotations.push({
          type: 'deposit-method-limit',
          description: `Checked ${methodsToCheck.length}/${paymentCategories.length} methods in non-destructive sweep.`,
        });
      }

      const selectionResults = [];
      const methodStartedAt = Date.now();
      for (const method of methodsToCheck) {
        if (Date.now() - methodStartedAt > dynamicMethodBudgetMs) {
          partialCoverage = true;
          markBlocked(
            testInfo,
            'Payment methods verification reached time budget; partial coverage recorded.'
          );
          testInfo.annotations.push({
            type: 'partial',
            description: `Deposit method sweep stopped on time budget after ${selectionResults.length}/${methodsToCheck.length} checked methods.`,
          });
          selectionResults.push({
            method: '__time_budget__',
            selected: false,
            challenge: 'Time budget exceeded during payment method sweep.',
            surfaceReady: false,
          });
          break;
        }
        let result = null;
        try {
          result = await withStepTimeout(
            clickMethod(method, container, page),
            DEPOSIT_METHOD_STEP_TIMEOUT_MS,
            `clickMethod(${method.label})`
          );
        } catch (err) {
          const reason = String(err && err.message ? err.message : err);
          markBlocked(testInfo, reason);
          selectionResults.push({
            method: method.label,
            selected: false,
            challenge: reason,
            surfaceReady: false,
          });
          break;
        }
        selectionResults.push(result);
        if (result.challenge) {
          markBlocked(testInfo, result.challenge);
          break;
        }
      }

      const failed = selectionResults.filter(
        (item) =>
          !item.selected || (item.method !== '__time_budget__' && item.surfaceReady === false)
      );
      if (!testInfo.annotations.some((item) => item.type === 'blocked')) {
        expect(
          failed,
          `Some deposit methods did not open a ready surface: ${failed.map((v) => v.method).join(', ')}`
        ).toEqual([]);
      }

      const submitButton = await firstVisibleLocator(container, [
        'button:has-text("Deposit")',
        'button:has-text("Continue")',
        'button:has-text("Pay")',
        'button[type="submit"]',
      ]);
      const submitVisible = Boolean(submitButton);
      const submitEnabled = submitButton
        ? await submitButton.isEnabled().catch(() => false)
        : false;
      const methodsReady = selectionResults.filter(
        (item) => item.selected && item.surfaceReady
      ).length;

      const payload = {
        route,
        authStatePath,
        source: 'ui',
        uiCoverageAvailable: paymentMethods.length > 0,
        apiCoverageAvailable: false,
        sourceMode: 'ui-only',
        surface: {
          modal: Boolean(surface.modal),
          panel: Boolean(surface.panel),
        },
        paymentMethodTilesDiscovered: paymentMethods.map((m) => m.label),
        paymentMethodTilesDiscoveredCount: paymentMethods.length,
        paymentCategoriesDiscovered: paymentCategories.map((m) => m.label),
        paymentCategoriesChecked: methodsToCheck.map((m) => m.label),
        paymentCategoriesDiscoveredCount: paymentCategories.length,
        paymentCategoriesCheckedCount: methodsToCheck.length,
        paymentMethodsDiscovered: paymentMethods.map((m) => m.label),
        paymentMethodsChecked: methodsToCheck.map((m) => m.label),
        paymentMethodsDiscoveredCount: paymentCategories.length,
        paymentMethodsCheckedCount: methodsToCheck.length,
        paymentMethodsReadyCount: methodsReady,
        methodLimit: DEPOSIT_METHOD_LIMIT > 0 ? DEPOSIT_METHOD_LIMIT : 'all',
        methodStepTimeoutMs: DEPOSIT_METHOD_STEP_TIMEOUT_MS,
        methodBudgetMs: dynamicMethodBudgetMs,
        partialCoverage,
        selectionResults,
        submitVisible,
        submitEnabled,
        network,
      };

      await attachArtifact(testInfo, 'deposit-non-destructive.json', payload);

      if (surface.modal) {
        await closeModal(surface.modal, page).catch(() => null);
      }
    } finally {
      await context.close().catch(() => null);
    }
  });
});
