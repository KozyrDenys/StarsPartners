const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');
const { resolveExtraHTTPHeaders } = require('../tests/helpers/context-options');
const { createCdpBrowserFacade } = require('../tests/helpers/cdp-reuse-context');

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!String(token || '').startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      args[body] = '1';
    } else {
      args[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }
  return args;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toUrl(baseUrl, route) {
  const value = String(route || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value.startsWith('/') ? value : `/${value}`, baseUrl).toString();
}

function isChallengeLike(value) {
  return /cloudflare|turnstile|captcha|challenge|cdn-cgi|__cf_chl|just a moment|verify you are human|security verification/i.test(
    String(value || '')
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function readStorageStatePath(candidate) {
  const value = String(candidate || '').trim();
  if (!value) return '';
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? resolved : '';
}

async function routeProbe(page, baseUrl, route, timeoutMs) {
  const targetUrl = toUrl(baseUrl, route);
  const network = [];
  const onResponse = (response) => {
    const status = response.status();
    if (status !== 401 && status !== 403) return;
    network.push({
      url: response.url(),
      status,
      method: response.request().method(),
    });
  };

  page.on('response', onResponse);
  let response = null;
  let error = '';
  try {
    response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await delay(1000);
  } catch (err) {
    error = String(err && err.message ? err.message : err);
  } finally {
    page.off('response', onResponse);
  }

  const finalUrl = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = ((await page.textContent('body').catch(() => '')) || '').slice(0, 2000);
  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  const status = response ? response.status() : 0;
  const blocked =
    status === 403 ||
    isChallengeLike(finalUrl) ||
    isChallengeLike(title) ||
    isChallengeLike(bodyText) ||
    network.some((item) => item.status === 403);

  return {
    route,
    requestedUrl: targetUrl,
    finalUrl,
    status,
    title,
    appRootVisible,
    blocked,
    reason: blocked
      ? `WAF/challenge detected on ${route}: status=${status || '-'}, title=${title || '-'}`
      : '',
    error,
    network,
  };
}

async function depositApiProbe(context, baseUrl, currencies, timeoutMs) {
  const attempts = [];
  for (const currency of currencies) {
    const url = new URL('/api/payment/getPaySystems', baseUrl);
    url.searchParams.set('operation', 'deposit');
    url.searchParams.set('currency', currency);
    let status = 0;
    let bodyPreview = '';
    let itemsCount = 0;
    let error = '';
    try {
      const response = await context.request.get(url.toString(), { timeout: timeoutMs });
      status = response.status();
      bodyPreview = (await response.text().catch(() => '')).slice(0, 500);
      const json = JSON.parse(bodyPreview);
      const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
      itemsCount = items.length;
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }
    attempts.push({
      currency,
      url: url.toString(),
      status,
      itemsCount,
      unauthorized: status === 401,
      forbidden: status === 403,
      challenge: isChallengeLike(bodyPreview),
      error,
      bodyPreview,
    });
    if (status === 200 && itemsCount > 0) break;
  }

  const best = attempts.find((item) => item.status === 200 && item.itemsCount > 0);
  const blocked = attempts.some((item) => item.status === 403 || item.challenge);
  return {
    attemptedCurrencies: currencies,
    attempts,
    itemsCount: best ? best.itemsCount : 0,
    bestCurrency: best ? best.currency : '',
    blocked: !best && blocked,
    reason: best
      ? ''
      : `Deposit getPaySystems did not return usable methods (${attempts
          .map((item) => `${item.currency}:${item.status || item.error || 'unknown'}`)
          .join(', ')})`,
  };
}

(async () => {
  const args = parseArgs(process.argv);
  const label = String(args.label || 'waf-guard');
  const baseUrl = String(args['base-url'] || process.env.BASE_URL || '').trim();
  if (!baseUrl) {
    console.error('BASE_URL is required.');
    process.exit(2);
  }

  const routes = splitCsv(args.routes || '/,/casino/');
  const currencies = splitCsv(
    args.currencies || process.env.PW_DEPOSIT_CURRENCIES || 'EUR,USD,GBP,BRL,INR,CAD,AUD'
  );
  const checkDepositApi = args['deposit-api'] === '1';
  const timeoutMs = Math.max(
    5000,
    Number.parseInt(args.timeout || process.env.PW_WAF_GUARD_TIMEOUT_MS || '15000', 10) || 15000
  );
  const outPath = String(args.out || '').trim();
  const browserName = String(args.browser || process.env.PW_BROWSER || 'chromium').toLowerCase();
  const storageStatePath = readStorageStatePath(
    args['storage-state'] || process.env.PW_STORAGE_STATE
  );
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const cdpEndpoint = String(process.env.PW_CDP_ENDPOINT || '').trim();
  const reuseCdpContext = process.env.PW_CDP_REUSE_CONTEXT === '1' && cdpEndpoint;
  const connectedBrowser = reuseCdpContext
    ? await chromium.connectOverCDP(cdpEndpoint)
    : await browserType.launch({ headless: process.env.PW_HEADED !== '1' });
  const extraHTTPHeaders = resolveExtraHTTPHeaders();
  const contextOptions = {
    locale: process.env.PW_LOCALE || 'en-US',
    ...(process.env.PW_USER_AGENT ? { userAgent: process.env.PW_USER_AGENT } : {}),
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
  };
  if (storageStatePath) contextOptions.storageState = storageStatePath;
  const persistentContext = reuseCdpContext ? connectedBrowser.contexts()[0] : null;
  if (reuseCdpContext && !persistentContext) {
    throw new Error(`Native Chrome at ${cdpEndpoint} has no persistent browser context.`);
  }
  const browser = reuseCdpContext
    ? createCdpBrowserFacade(connectedBrowser, persistentContext, { baseUrl })
    : connectedBrowser;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const routeResults = [];
  for (const route of routes) {
    routeResults.push(await routeProbe(page, baseUrl, route, timeoutMs));
  }

  const depositApi = checkDepositApi
    ? await depositApiProbe(context, baseUrl, currencies, timeoutMs)
    : null;

  await context.close().catch(() => null);
  if (!reuseCdpContext) await browser.close();

  const blockedRoutes = routeResults.filter((item) => item.blocked);
  const blocked = blockedRoutes.length > 0 || Boolean(depositApi && depositApi.blocked);
  const payload = {
    label,
    generatedAt: new Date().toISOString(),
    baseUrl,
    browser: browserName,
    cdpReuseContext: Boolean(reuseCdpContext),
    storageStatePath: storageStatePath || '',
    routes: routeResults,
    depositApi,
    blocked,
    reason: [
      ...blockedRoutes.map((item) => item.reason),
      depositApi && depositApi.blocked ? depositApi.reason : '',
    ]
      .filter(Boolean)
      .join(' | '),
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(payload, null, 2), 'utf8');
  }

  if (blocked) {
    console.error(`WAF guard blocked: ${payload.reason}`);
    process.exit(2);
  }

  console.log(
    `WAF guard passed: ${label}; routes=${routeResults.length}; depositApi=${
      depositApi ? depositApi.itemsCount : 'not-checked'
    }`
  );
})();
