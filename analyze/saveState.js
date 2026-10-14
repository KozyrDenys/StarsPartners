const { loadProjectEnv } = require('../scripts/lib/env');
const { resolveExtraHTTPHeaders } = require('../tests/helpers/context-options');

loadProjectEnv();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function uniqueList(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeWarmupRoute(route) {
  const value = String(route || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function parseViewport(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/x/i, 'x');
  const [w, h] = normalized.split('x').map((item) => Number.parseInt(item, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function getDefaultUserAgent() {
  return String(process.env.PW_USER_AGENT || '').trim();
}

async function isAnySelectorVisible(page, selectors) {
  for (const selector of selectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function isCloudflareChallenge(page) {
  if (/cdn-cgi|challenge-platform/i.test(page.url())) return true;

  const bodyText =
    (await page
      .textContent('body')
      .then((txt) => txt || '')
      .catch(() => '')) || '';

  return /just a moment|checking your browser|verify you are human|cloudflare/i.test(bodyText);
}

async function clickTurnstileChallenge(page) {
  const frameSelector =
    'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[title*="challenge" i], iframe[title*="turnstile" i]';
  const frames = page.locator(frameSelector);
  const count = await frames.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const iframeLocator = frames.nth(i);
    const iframeHandle = await iframeLocator.elementHandle().catch(() => null);
    if (!iframeHandle) continue;

    const frame = await iframeHandle.contentFrame().catch(() => null);
    if (frame) {
      const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
      const visibleCheckbox = await checkbox.isVisible({ timeout: 800 }).catch(() => false);
      if (visibleCheckbox) {
        await checkbox.click({ force: true, timeout: 2000 }).catch(() => null);
        return true;
      }
    }

    const box = await iframeHandle.boundingBox().catch(() => null);
    if (!box) continue;

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 8 }).catch(() => null);
    await page.mouse.click(x, y, { delay: 120 }).catch(() => null);
    return true;
  }

  return false;
}

async function waitForPageReady(page, selectors, timeoutMs, opts = {}) {
  const { autoBypass = false } = opts;
  const startedAt = Date.now();
  let lastChallengeLogAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (await isAnySelectorVisible(page, selectors)) {
      return true;
    }

    if (!autoBypass) {
      await page.waitForTimeout(800);
      continue;
    }

    const challenge = await isCloudflareChallenge(page);
    if (challenge) {
      const now = Date.now();
      if (now - lastChallengeLogAt > 3000) {
        console.log('⚠️  Cloudflare challenge detected. Trying automatic Turnstile interaction...');
        lastChallengeLogAt = now;
      }

      const clicked = await clickTurnstileChallenge(page);
      if (clicked) {
        await page.waitForTimeout(2000);
        continue;
      }
    }

    await page.waitForTimeout(800);
  }

  return false;
}

async function warmupRoutes(page, options = {}) {
  const baseUrl = String(options.baseUrl || '');
  const routes = Array.isArray(options.routes) ? options.routes : [];
  if (!routes.length) return;

  const selectors = Array.isArray(options.selectors) ? options.selectors : ['#app, #__nuxt'];
  const auto = options.auto === true;
  const autoBypass = options.autoBypass !== false;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 45_000;
  const strict = options.strict === true;

  for (const rawRoute of routes) {
    const normalizedRoute = normalizeWarmupRoute(rawRoute);
    if (!normalizedRoute) continue;

    let targetUrl = normalizedRoute;
    if (!/^https?:\/\//i.test(normalizedRoute)) {
      targetUrl = new URL(normalizedRoute, baseUrl).toString();
    }

    console.log(`\n• Warmup route: ${targetUrl}`);
    let navigationError = '';
    await page
      .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      .catch((err) => {
        navigationError = String(err && err.message ? err.message : err);
      });

    const ready = await waitForPageReady(page, selectors, timeoutMs, { autoBypass });
    if (ready) continue;

    const reason = navigationError
      ? `Warmup route is not ready: ${navigationError}`
      : 'Warmup route is not ready (challenge may still be active).';
    if (strict) {
      throw new Error(`${reason} Route: ${targetUrl}`);
    }
    console.log(`⚠️  ${reason}`);

    if (!auto && process.stdin.isTTY) {
      console.log('   Продолжай вручную и затем нажми Enter, чтобы идти дальше.');
      process.stdin.resume();
      await new Promise((res) => process.stdin.once('data', res));
    }
  }
}

(async () => {
  const args = process.argv.slice(2);
  const nonFlags = args.filter((a) => !String(a || '').startsWith('-'));

  const url = nonFlags[0] || process.env.BASE_URL || 'https://gt.bet/';
  const out = nonFlags[1] || process.env.PW_STORAGE_STATE || 'storageState.json';
  const auto =
    args.includes('--auto') || args.includes('--auto-wait') || process.env.AUTO_WAIT === '1';
  const autoBypass = process.env.PW_SAVE_STATE_AUTO_BYPASS !== '0';

  const timeoutArg = args.find((a) => String(a || '').startsWith('--timeout='));
  const timeoutParsed = timeoutArg
    ? Number.parseInt(String(timeoutArg).split('=')[1], 10)
    : Number.parseInt(process.env.PW_SAVE_STATE_TIMEOUT || '120', 10);
  const autoTimeoutSec = Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? timeoutParsed : 120;
  const autoTimeoutMs = autoTimeoutSec * 1000;
  const routesArg = args.find((a) => String(a || '').startsWith('--routes='));
  const rawWarmupRoutes = routesArg
    ? String(routesArg).slice('--routes='.length)
    : process.env.PW_SAVE_STATE_WARMUP_ROUTES || '';
  const warmupRoutesList = uniqueList(
    splitCsv(rawWarmupRoutes).map(normalizeWarmupRoute).filter(Boolean)
  );
  const warmupTimeoutParsed = Number.parseInt(process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || '45', 10);
  const warmupTimeoutMs =
    Number.isFinite(warmupTimeoutParsed) && warmupTimeoutParsed > 0
      ? warmupTimeoutParsed * 1000
      : 45_000;
  const warmupStrict = process.env.PW_SAVE_STATE_WARMUP_STRICT === '1';

  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const useChromeChannel = process.env.PW_USE_CHROME_CHANNEL === '1' && fs.existsSync(chromePath);
  const launchOptions = useChromeChannel
    ? { headless: false, channel: 'chrome' }
    : { headless: false };
  const persistentProfileDir = String(process.env.PW_SAVE_STATE_PROFILE_DIR || '')
    .trim()
    .replace(/^~(?=$|\/|\\)/, process.env.HOME || '');
  const usePersistentContext =
    process.env.PW_SAVE_STATE_PERSISTENT === '1' && persistentProfileDir.length > 0;
  const parsedViewport = parseViewport(process.env.PW_SAVE_STATE_VIEWPORT || '');
  const contextViewport = parsedViewport || { width: 1365, height: 900 };
  const mobileContext = process.env.PW_SAVE_STATE_IS_MOBILE === '1';

  const configuredUserAgent = getDefaultUserAgent();
  const extraHTTPHeaders = resolveExtraHTTPHeaders();
  const contextOptions = {
    locale: process.env.PW_LOCALE || 'en-US',
    viewport: contextViewport,
    isMobile: mobileContext,
    hasTouch: mobileContext,
    ...(configuredUserAgent ? { userAgent: configuredUserAgent } : {}),
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
  };

  let browser = null;
  let context = null;
  if (usePersistentContext) {
    fs.mkdirSync(persistentProfileDir, { recursive: true });
    context = await chromium.launchPersistentContext(persistentProfileDir, {
      ...launchOptions,
      ...contextOptions,
    });
  } else {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext(contextOptions);
  }
  const page = context.pages()[0] || (await context.newPage());
  const readySelectors = [
    '#app, #__nuxt',
    '[data-testid="signup-button"]',
    '[data-testid="login-button"]',
    'button:has-text("Sign Up")',
    'button:has-text("Log In")',
    '#app .t-header',
    'header.t-header',
  ];

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  console.log(`\nURL: ${url}`);
  console.log(`Output: ${path.resolve(out)}`);
  if (usePersistentContext) {
    console.log(`Profile: ${path.resolve(persistentProfileDir)} (persistent)`);
  }

  if (!auto) {
    if (!process.stdin.isTTY) {
      throw new Error('Non-interactive session detected. Use --auto or set AUTO_WAIT=1.');
    }

    console.log('\n1) Пройди Cloudflare/логин вручную в открывшемся окне.');
    console.log('2) Когда увидишь нормальную страницу — вернись в терминал и нажми Enter.\n');

    process.stdin.resume();
    await new Promise((res) => process.stdin.once('data', res));
  } else {
    console.log('\n1) Скрипт попробует автоматически пройти Cloudflare challenge (Turnstile).');
    console.log('2) Если challenge сложный — можно помочь вручную в открывшемся окне.\n');
    console.log(`Auto wait timeout: ${autoTimeoutSec}s`);

    const ready = await waitForPageReady(page, readySelectors, autoTimeoutMs, { autoBypass });
    if (!ready) {
      throw new Error(
        `Auto wait timeout after ${autoTimeoutSec}s. Cloudflare challenge is still active; rerun save:state and complete challenge manually.`
      );
    }
  }

  if (warmupRoutesList.length > 0) {
    console.log(`\nWarmup routes: ${warmupRoutesList.join(', ')}`);
    await warmupRoutes(page, {
      baseUrl: url,
      routes: warmupRoutesList,
      selectors: readySelectors,
      timeoutMs: warmupTimeoutMs,
      auto,
      autoBypass,
      strict: warmupStrict,
    });
  }

  const state = await context.storageState();
  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2), 'utf8');
  console.log(`✅ Saved: ${outPath}`);

  await context.close();
  if (browser) {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
