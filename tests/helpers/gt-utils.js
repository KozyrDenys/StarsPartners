const CLOUD_FLARE_HINTS = [
  /verify you are human/i,
  /checking your browser/i,
  /cloudflare/i,
  /just a moment/i,
  /performing security verification/i,
  /выполнение проверки безопасности/i,
  /один момент/i,
];
const {
  inferCapabilityFromBlockedReason,
  isCapabilityOptionalForBrand,
} = require('./brand-capabilities');
const GEO_BLOCK_HINTS = [
  /cannot be accessed in /i,
  /region not restricted/i,
  /proxy service or vpn/i,
  /we're sorry, but .* cannot be accessed/i,
];
const NON_CRITICAL_WAF_URLS = [/\/(?:server\/)?api\/languages\/thook(?:\/|$|\?)/i];
const CLOUD_FLARE_CHALLENGE_FRAME_SELECTOR =
  'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[title*="challenge" i], iframe[title*="turnstile" i]';

const INFRA_BLOCKED_HINTS = [
  /cloudflare|turnstile|captcha|challenge|waf|cdn-cgi|__cf_chl|token page|forbidden|403/i,
  /no auth state|no authorized storage state|auth storage state|storage state is unavailable/i,
  /expected authorized session|\/api\/user\/preferences returned 401|session was not established/i,
  /temporarily unavailable|backend unavailable|transport negotiation failed|watchdog timed out|cancelled\/aborted before bootstrap/i,
  /internet connection appears to be offline|net::err_internet_disconnected|net::err_network_changed|socket hang up/i,
  /timed out before/i,
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyBlockedType(description) {
  const source = String(description || '');
  if (!source) return 'product';
  return INFRA_BLOCKED_HINTS.some((re) => re.test(source)) ? 'infra' : 'product';
}

function isCriticalWafUrl(url) {
  const value = String(url || '');
  if (!/\/_nuxt\/|\/api\//i.test(value)) return false;
  if (NON_CRITICAL_WAF_URLS.some((re) => re.test(value))) return false;
  return true;
}

async function detectCloudflare(page) {
  const cfUrlPattern = /\/cdn-cgi\/|challenge-platform/i;
  if (cfUrlPattern.test(page.url())) {
    return 'Cloudflare challenge detected (cdn-cgi/challenge).';
  }

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
  const authModalVisible = appRootVisible
    ? await page
        .locator(
          '.t-login-modal, [data-testid="login-modal"], .t-login, .t-signup-modal, [data-testid="signup-modal"], .t-signup'
        )
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false)
    : false;

  for (const re of CLOUD_FLARE_HINTS) {
    const loc = page.getByText(re).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      if (appRootVisible && /cloudflare/i.test(re.source)) {
        continue;
      }
      if (
        authModalVisible &&
        /verify you are human|performing security verification|выполнение проверки безопасности|один момент/i.test(
          re.source
        )
      ) {
        continue;
      }
      return 'Cloudflare challenge detected (challenge text visible).';
    }
  }

  const cfSelectors = [
    '#cf-wrapper',
    'form#challenge-form',
    'iframe[src*="challenge-platform"]',
    'iframe[src*="/cdn-cgi/"]',
    '[id*="challenge-form"]',
  ];

  for (const sel of cfSelectors) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      return 'Cloudflare challenge detected (challenge selector visible).';
    }
  }

  // Some Cloudflare pages render as a blank page with a short token string.
  try {
    const appRoot = await page
      .locator('#app, #__nuxt')
      .first()
      .isVisible()
      .catch(() => false);
    if (!appRoot) {
      const bodyTextRaw = (await page.textContent('body').catch(() => '')) || '';
      const bodyText = bodyTextRaw.trim();
      const compact = bodyText.replace(/\s+/g, '');
      const token = compact.match(/^[a-f0-9]{12,}$/i);
      const tokenInText = bodyText.match(/\b[a-f0-9]{12,}\b/i);
      if ((token || tokenInText) && bodyText.length <= 128) {
        return 'Cloudflare challenge detected (token page).';
      }
    }
  } catch (err) {
    if (err instanceof Error) throw err;
  }

  return null;
}

async function clickTurnstileChallenge(page) {
  const frames = page.locator(CLOUD_FLARE_CHALLENGE_FRAME_SELECTOR);
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

async function tryAutoBypassCloudflare(page, timeoutMs = 22_000) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 22_000;
  const startedAt = Date.now();
  let attemptedInteraction = false;

  while (Date.now() - startedAt < timeout) {
    const detected = await detectCloudflare(page);
    if (!detected) {
      return {
        resolved: true,
        attemptedInteraction,
      };
    }

    const clicked = await clickTurnstileChallenge(page);
    attemptedInteraction = attemptedInteraction || clicked;

    if (!clicked) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => null);
      await delay(900);
      continue;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 7_000 }).catch(() => null);
    await delay(1700);
  }

  return {
    resolved: !(await detectCloudflare(page)),
    attemptedInteraction,
  };
}

async function detectGeoBlock(page) {
  for (const re of GEO_BLOCK_HINTS) {
    const loc = page.getByText(re).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      const bodyText = ((await page.textContent('body').catch(() => '')) || '')
        .replace(/\s+/g, ' ')
        .trim();
      return `Geo restriction detected: ${bodyText.slice(0, 180) || 'access is blocked for current region.'}`;
    }
  }
  return null;
}

async function assertNotCloudflare(page) {
  let detected = await detectCloudflare(page);
  if (detected && process.env.PW_AUTO_BYPASS_CF !== '0') {
    const bypass = await tryAutoBypassCloudflare(
      page,
      Number.parseInt(process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '22000', 10)
    );
    if (bypass.resolved) {
      detected = null;
    } else {
      detected = await detectCloudflare(page);
      if (detected && bypass.attemptedInteraction) {
        detected = `${detected} (auto-bypass attempted).`;
      }
    }
  }

  if (detected) {
    const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
    throw new Error(`${detected} Run: npm run save:state -- ${baseUrl} --auto`);
  }
  const geoBlocked = await detectGeoBlock(page);
  if (geoBlocked) {
    throw new Error(geoBlocked);
  }
}

function createWafProbe(page) {
  const blocked = [];
  const failed = [];

  page.on('response', (resp) => {
    try {
      if (resp.status() !== 403) return;
      const url = resp.url();
      if (isCriticalWafUrl(url) && !blocked.includes(url)) {
        blocked.push(url);
      }
    } catch {
      // ignore
    }
  });

  page.on('requestfailed', (req) => {
    try {
      const url = req.url();
      if (isCriticalWafUrl(url) && !failed.includes(url)) {
        failed.push(url);
      }
    } catch {
      // ignore
    }
  });

  return {
    blocked,
    failed,
  };
}

function formatWafList(list, limit = 5) {
  if (!list || list.length === 0) return null;
  return list.slice(0, limit).join(' | ');
}

async function detectSignupTurnstileStall(page) {
  const modal = page.locator('.t-signup-modal, [data-testid="signup-modal"], .t-signup').first();
  const modalVisible = await modal.isVisible({ timeout: 500 }).catch(() => false);
  if (!modalVisible) return null;

  const step1Btn = modal
    .locator(
      'button:has-text("CONTINUE"), button:has-text("Continue"), [data-testid="proceed-button"]'
    )
    .first();
  const buttonVisible = await step1Btn.isVisible({ timeout: 500 }).catch(() => false);
  if (!buttonVisible) return null;
  const buttonDisabled = await step1Btn.isDisabled().catch(() => false);
  if (!buttonDisabled) return null;

  const tokenInput = modal.locator('input[name="cf-turnstile-response"]').first();
  const tokenCount = await modal
    .locator('input[name="cf-turnstile-response"]')
    .count()
    .catch(() => 0);
  if (tokenCount < 1) return null;

  const tokenValue = (await tokenInput.inputValue().catch(() => '')) || '';
  if (tokenValue.trim().length > 0) return null;

  return 'Cloudflare challenge detected (signup turnstile token not issued).';
}

async function getWafReason(page, probe, error) {
  const message = error && error.message ? String(error.message) : '';
  if (message.includes('Cloudflare challenge detected')) return message;
  if (message.includes('PRECHECK_BLOCKED')) return message;
  if (message.includes('Geo restriction detected')) return message;
  if (message.includes('signup turnstile token not issued')) {
    return 'Cloudflare challenge detected (signup turnstile token not issued).';
  }
  if (
    /toBeEnabled/i.test(message) &&
    /proceed-button|button:has-text\("CONTINUE"\)|button:has-text\("Continue"\)/i.test(message)
  ) {
    return 'Cloudflare challenge detected (signup turnstile token not issued).';
  }
  if (message.includes("locator('#app, #__nuxt').first() to be visible")) {
    return 'App root is not visible (possible WAF/challenge/blank page).';
  }

  const detected = await detectCloudflare(page);
  if (detected) return detected;
  const turnstileStall = await detectSignupTurnstileStall(page);
  if (turnstileStall) return turnstileStall;
  const geoBlocked = await detectGeoBlock(page);
  if (geoBlocked) return geoBlocked;

  const blockedSample = formatWafList(probe && probe.blocked);
  if (blockedSample) return `WAF 403 on critical resources: ${blockedSample}`;

  const failedSample = formatWafList(probe && probe.failed);
  if (failedSample) return `Critical requests failed: ${failedSample}`;

  return null;
}

async function maybeSkipWaf({ page, probe, testInfo, error }) {
  if (process.env.PW_WAF_DIAGNOSTIC === '0') return false;
  const reason = await getWafReason(page, probe, error);
  if (!reason) return false;
  markBlocked(testInfo, reason);
  return true;
}

async function dismissOverlays(page) {
  // Hard-disable known overlays that can intercept clicks
  try {
    await page.addStyleTag({
      content:
        '#onesignal-slidedown-container{display:none!important;pointer-events:none!important;}' +
        '.onesignal-slidedown-container{display:none!important;pointer-events:none!important;}' +
        '[data-testid="pwa-modal"],[data-testid="pwa-popup"]{display:none!important;}',
    });
  } catch {
    // ignore
  }

  const candidates = [
    '#onesignal-slidedown-cancel-button',
    '#onesignal-slidedown-allow-button',
    '[data-testid="pwa-close"]',
    '[aria-label="Close"]',
    '.t-header__pwa-close',
  ];

  for (const selector of candidates) {
    const el = page.locator(selector).first();
    try {
      if (await el.isVisible()) {
        await el.click({ timeout: 1500 });
      }
    } catch {
      // Ignore if not present or not clickable
    }
  }

  // If OneSignal container still exists, remove it via DOM
  try {
    await page.evaluate(() => {
      const el = document.getElementById('onesignal-slidedown-container');
      if (el) el.remove();
    });
  } catch {
    // ignore
  }
}

async function closeModal(modal, page) {
  const closeCandidates = [
    'button:has-text("Close")',
    '[aria-label="Close"]',
    '[data-testid*="close"]',
    '.t-modal__close',
    '.t-modal__close-btn',
    '.modal__close',
  ];

  for (const selector of closeCandidates) {
    const btn = modal.locator(selector).first();
    try {
      const visible = await btn.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        await btn.click({ timeout: 1500 }).catch(() => null);
        return true;
      }
    } catch {
      // try next selector
    }
  }

  try {
    await page.keyboard.press('Escape');
    return true;
  } catch {
    return false;
  }
}

function markBlocked(testInfo, description) {
  const reason = String(description || 'Blocked');
  const capabilityKey = inferCapabilityFromBlockedReason(reason);
  if (capabilityKey && isCapabilityOptionalForBrand(process.env.BASE_URL, capabilityKey)) {
    testInfo.annotations.push({
      type: 'not-applicable',
      description: `Capability "${capabilityKey}" is optional for this brand. ${reason}`,
    });
    testInfo.annotations.push({ type: 'partial', description: reason });
    return;
  }

  const blockedType = classifyBlockedType(reason);
  testInfo.annotations.push({ type: 'blocked', description: reason });
  testInfo.annotations.push({
    type: blockedType === 'infra' ? 'infra-blocked' : 'product-blocked',
    description: reason,
  });
}

async function waitForUiSettled(page, timeoutMs = 1500) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1500;
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout })
    .catch(() => null);
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => null);
  const busy = page
    .locator(
      '.t-loader, .t-preloader, [class*="loader" i], [class*="spinner" i], [aria-busy="true"]'
    )
    .first();
  const busyVisible = await busy.isVisible({ timeout: 300 }).catch(() => false);
  if (busyVisible) {
    await busy.waitFor({ state: 'hidden', timeout }).catch(() => null);
  }
}

async function openSignupModal(page, opts = {}) {
  const modal = page.locator('.t-signup-modal, [data-testid="signup-modal"], .t-signup').first();
  const errorToast = page.getByText(/something went wrong/i).first();
  const retryOnError = opts.retryOnError !== false;
  const maxAttempts = opts.attempts || 3;
  const triggers = [
    '[data-testid="signup-button"]',
    'button:has-text("Sign Up")',
    'button:has-text("Sign up")',
    '.t-sidebar-menu-welcome__button_signin',
    '.t-header__signup',
    '.t-banner-registration__default_action-btn',
    'button:has-text("Sign Up Now")',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await dismissOverlays(page);
    for (const selector of triggers) {
      const btn = page.locator(selector).first();
      try {
        if (await btn.isVisible()) {
          await btn.click();
          await Promise.any([
            modal.waitFor({ state: 'visible', timeout: 2000 }),
            errorToast.waitFor({ state: 'visible', timeout: 2000 }),
            waitForUiSettled(page, 2000),
          ]).catch(() => null);
          if (await modal.isVisible().catch(() => false)) {
            return modal;
          }
          if (await errorToast.isVisible().catch(() => false)) {
            if (!retryOnError) {
              throw new Error(
                'Registration error toast: Something went wrong, please try again later.'
              );
            }
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHomeContent(page);
            break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Registration error toast')) {
          throw err;
        }
      }
    }
  }

  throw new Error('Sign Up modal did not open.');
}

async function openLoginModal(page, opts = {}) {
  const modal = page.locator('.t-login-modal, [data-testid="login-modal"], .t-login').first();
  const errorToast = page.getByText(/something went wrong/i).first();
  const retryOnError = opts.retryOnError !== false;
  const maxAttempts = opts.attempts || 3;
  const loginLabelRe =
    /log\s*in|sign\s*in|connexion|se connecter|anmelden|entrar|iniciar sesi[oó]n|accedi|войти|увійти/i;
  const triggers = [
    '[data-testid="login-button"]',
    '[data-testid*="login" i]',
    '[data-testid*="signin" i]',
    'button:has-text("Log In")',
    'button:has-text("Log in")',
    'button:has-text("Sign In")',
    'button:has-text("Se connecter")',
    'button:has-text("Connexion")',
    'button:has-text("Anmelden")',
    'button:has-text("Entrar")',
    'button:has-text("Войти")',
    'button:has-text("Увійти")',
    'a:has-text("Log In")',
    'a:has-text("Sign In")',
    'a:has-text("Se connecter")',
    'a:has-text("Connexion")',
    'a:has-text("Anmelden")',
    'a:has-text("Entrar")',
    'a:has-text("Войти")',
    'a:has-text("Увійти")',
    '.t-sidebar-menu-welcome__button_login',
    '.t-sidebar-menu-welcome__button_signin',
    '.t-header__login',
    'a[href*="login" i]',
    'a[href*="signin" i]',
    'button[class*="login" i]',
    'a[class*="login" i]',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await dismissOverlays(page);
    for (const selector of triggers) {
      const btn = page.locator(selector).first();
      try {
        if (await btn.isVisible()) {
          await btn.click();
          await Promise.any([
            modal.waitFor({ state: 'visible', timeout: 2000 }),
            errorToast.waitFor({ state: 'visible', timeout: 2000 }),
            waitForUiSettled(page, 2000),
          ]).catch(() => null);
          if (await modal.isVisible().catch(() => false)) {
            return modal;
          }
          if (await errorToast.isVisible().catch(() => false)) {
            if (!retryOnError) {
              throw new Error('Login error toast: Something went wrong, please try again later.');
            }
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHomeContent(page);
            break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Login error toast')) {
          throw err;
        }
      }
    }

    const fallbackCandidates = [
      page.getByRole('button', { name: loginLabelRe }).first(),
      page.getByRole('link', { name: loginLabelRe }).first(),
      page
        .locator('[data-testid*="login" i], [data-testid*="signin" i], [class*="login" i]')
        .first(),
    ];
    for (const candidate of fallbackCandidates) {
      const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;
      await candidate.click({ timeout: 5000 }).catch(() => null);
      await Promise.any([
        modal.waitFor({ state: 'visible', timeout: 2000 }),
        errorToast.waitFor({ state: 'visible', timeout: 2000 }),
        waitForUiSettled(page, 2000),
      ]).catch(() => null);
      if (await modal.isVisible().catch(() => false)) {
        return modal;
      }
    }
  }

  throw new Error('Log In modal did not open.');
}

async function waitForHomeContent(page) {
  await assertNotCloudflare(page);
  const appRoot = page.locator('#app, #__nuxt').first();
  try {
    await appRoot.waitFor({ state: 'visible', timeout: 45000 });
  } catch {
    await assertNotCloudflare(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await appRoot.waitFor({ state: 'visible', timeout: 45000 });
  }

  const gameLinks = page.locator('a.t-game-play__link-demo, a[href^="/casino/"]');
  const mainBanner = page.locator('[data-testid="main-banner"]').first();
  const ctaBanner = page.locator('.t-banner-registration__default_action-btn').first();

  await Promise.any([
    gameLinks.first().waitFor({ state: 'visible', timeout: 60000 }),
    mainBanner.waitFor({ state: 'visible', timeout: 60000 }),
    ctaBanner.waitFor({ state: 'visible', timeout: 60000 }),
  ]);
}

module.exports = {
  assertNotCloudflare,
  createWafProbe,
  detectCloudflare,
  dismissOverlays,
  closeModal,
  markBlocked,
  maybeSkipWaf,
  openLoginModal,
  openSignupModal,
  tryAutoBypassCloudflare,
  waitForHomeContent,
  waitForUiSettled,
};
