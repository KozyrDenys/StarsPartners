const { test, expect } = require('../fixtures/qa-test');
const fs = require('fs');
const path = require('path');
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  markBlocked,
  maybeSkipWaf,
  openLoginModal,
  waitForHomeContent,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { validatePlayerSigninViaCdpTurnstile } = require('../helpers/signup-api-fallback');
const {
  getGmailApiConfigFromEnv,
  normalizeEmail,
  pollForResetLink,
} = require('../helpers/gmail-api');
const { maskValue } = require('../helpers/registration-data');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');

const PLAYER_PATHS = [
  path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json'),
];
const MANUAL_READY_PLAYER_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json');
const LOGIN_CANDIDATE_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-login-candidate.txt');

const MAIL_TIMEOUT_MS = Number.parseInt(
  process.env.PW_FORGOT_PASSWORD_MAIL_TIMEOUT || '240000',
  10
);
const MAIL_POLL_MS = Number.parseInt(process.env.PW_FORGOT_PASSWORD_MAIL_POLL || '5000', 10);

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function pickPlayerCredentials() {
  const candidates = [];
  for (const filePath of PLAYER_PATHS) {
    const payload = readJson(filePath);
    if (!payload || typeof payload !== 'object') continue;
    const email = normalizeEmail(payload.loginEmail || payload.email);
    const password = oneLine(payload.password);
    if (!email || !password) continue;
    const mtimeMs = fs.existsSync(filePath) ? Number(fs.statSync(filePath).mtimeMs || 0) : 0;
    candidates.push({
      filePath,
      mtimeMs,
      data: payload,
      email,
      password,
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

function makeNewPassword() {
  const tag = Date.now().toString(36).slice(-6);
  return `QaReset!${tag}A9`;
}

async function attachJson(testInfo, name, payload) {
  const body = JSON.stringify(payload, null, 2);
  await testInfo.attach(name, {
    body,
    contentType: 'application/json',
  });
}

async function openForgotPasswordSurface(page) {
  const forgotSelectors = [
    'a:has-text("Forgot Password")',
    'a:has-text("Forgot password")',
    'button:has-text("Forgot Password")',
    'button:has-text("Forgot password")',
    'a:has-text("Reset password")',
    'button:has-text("Reset password")',
    '[data-testid*="forgot" i]',
    '[href*="forgot" i]',
    '[href*="reset" i]',
  ];

  for (const selector of forgotSelectors) {
    const button = page.locator(selector).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(page, 1200);
    const emailInput = page
      .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
      .first();
    if (await emailInput.isVisible().catch(() => false)) {
      return { ok: true, reason: '', route: page.url() };
    }
  }

  const fallbackRoutes = [
    '/forgot-password',
    '/auth/forgot-password',
    '/#forgot-password',
    '/#reset',
  ];
  for (const route of fallbackRoutes) {
    const target = new URL(route, BASE_URL).toString();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await waitForUiSettled(page, 1000);
    const emailInput = page
      .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
      .first();
    if (await emailInput.isVisible().catch(() => false)) {
      return { ok: true, reason: '', route: page.url() };
    }
  }

  return { ok: false, reason: 'Forgot password form is not discoverable.' };
}

async function submitForgotPassword(page, email) {
  const emailInput = page
    .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
    .first();
  if (!(await emailInput.isVisible().catch(() => false))) {
    return { ok: false, reason: 'Forgot password email input is not visible.' };
  }

  await emailInput.fill(email);
  await waitForUiSettled(page, 400);

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Send")',
    'button:has-text("Reset")',
    'button:has-text("Recover")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
  ];
  let submitted = false;
  for (const selector of submitSelectors) {
    const button = page.locator(selector).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 5000 }).catch(() => null);
    submitted = true;
    break;
  }
  if (!submitted) {
    await emailInput.press('Enter').catch(() => null);
    submitted = true;
  }

  if (!submitted) {
    return { ok: false, reason: 'Forgot password submit action is not available.' };
  }

  await waitForUiSettled(page, 1200);
  const feedbackVisible = await page
    .getByText(/check your email|email sent|instructions|reset link|message sent/i)
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  return {
    ok: true,
    reason: '',
    feedbackVisible,
    routeAfterSubmit: page.url(),
  };
}

async function applyResetPasswordViaLink(page, link, newPassword) {
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitForUiSettled(page, 1500);
  await dismissOverlays(page);

  const passwordInputs = page.locator('input[type="password"]');
  const count = Math.min(await passwordInputs.count().catch(() => 0), 4);
  let filled = 0;
  for (let i = 0; i < count; i += 1) {
    const input = passwordInputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    await input.fill(newPassword).catch(() => null);
    filled += 1;
  }

  if (filled === 0) {
    return { ok: false, reason: 'Reset password fields are not visible on reset page.' };
  }

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Save")',
    'button:has-text("Reset")',
    'button:has-text("Change")',
    'button:has-text("Update")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
  ];

  let submitted = false;
  for (const selector of submitSelectors) {
    const button = page.locator(selector).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 6000 }).catch(() => null);
    submitted = true;
    break;
  }

  if (!submitted) {
    await passwordInputs
      .first()
      .press('Enter')
      .catch(() => null);
  }

  await waitForUiSettled(page, 1600);
  const successVisible = await page
    .getByText(/password.*(changed|updated|saved|success)|successfully/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  return {
    ok: true,
    reason: '',
    successVisible,
    routeAfterReset: page.url(),
  };
}

function updatePlayerArtifacts({ email, basePlayer, newPassword, validation }) {
  const targetEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  const updatedPayload = {
    ...(basePlayer || {}),
    source: 'tests/destructive/forgot-password.spec.js',
    generatedAt: now,
    email: basePlayer && basePlayer.email ? basePlayer.email : targetEmail,
    loginEmail: targetEmail,
    password: newPassword,
    passwordMasked: maskValue(newPassword),
    manualLoginReady: validation.ok === true,
    loginValidationStatus: validation.status || '',
    loginValidationMethod: validation.method || '',
    loginValidationReason: validation.reason || '',
    loginValidationAt: now,
    lastLoginCheckStatus: validation.status || '',
    lastLoginCheckMethod: validation.method || '',
    lastLoginCheckReason: validation.reason || '',
    lastLoginCheckAt: now,
    lastPasswordResetAt: now,
    lastPasswordResetMethod: 'forgot-password-email-link',
  };

  for (const filePath of PLAYER_PATHS) {
    const payload = readJson(filePath);
    const payloadEmail = normalizeEmail(payload && (payload.loginEmail || payload.email));
    if (payload && payloadEmail && payloadEmail !== targetEmail) continue;
    writeJson(filePath, { ...(payload || {}), ...updatedPayload });
  }

  fs.mkdirSync(path.dirname(LOGIN_CANDIDATE_PATH), { recursive: true });
  fs.writeFileSync(
    LOGIN_CANDIDATE_PATH,
    `email=${targetEmail}\npassword=${newPassword}\nstatus=${validation.status || ''}\n`,
    'utf8'
  );

  if (validation.ok) {
    writeJson(MANUAL_READY_PLAYER_PATH, updatedPayload);
  }
}

test('Forgot password flow: request reset by email and sign in with new password', async ({
  page,
}, testInfo) => {
  test.setTimeout(480000);

  const gmail = getGmailApiConfigFromEnv();
  if (!gmail.ok) {
    markBlocked(
      testInfo,
      `Gmail API credentials are not configured: missing ${gmail.missing.join(', ')}.`
    );
    await attachJson(testInfo, 'forgot-password-config.json', {
      blocked: true,
      reason: 'Missing Gmail API configuration.',
      missing: gmail.missing,
    });
    return;
  }

  const player = pickPlayerCredentials();
  if (!player) {
    markBlocked(testInfo, 'No registered player with email/password found in artifacts.');
    await attachJson(testInfo, 'forgot-password-player.json', {
      blocked: true,
      reason: 'No player credentials found in artifacts.',
      searchedPaths: PLAYER_PATHS,
    });
    return;
  }

  const flow = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    playerEmail: player.email,
    playerSource: player.filePath,
    newPasswordMasked: '',
    steps: {},
  };

  const wafProbe = createWafProbe(page);
  const resetRequestedAt = Date.now();
  const newPassword = makeNewPassword();
  flow.newPasswordMasked = maskValue(newPassword);

  try {
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

    await openLoginModal(page);
    await waitForUiSettled(page, 900);

    const forgotSurface = await openForgotPasswordSurface(page);
    flow.steps.openForgotSurface = forgotSurface;
    if (!forgotSurface.ok) {
      markBlocked(testInfo, forgotSurface.reason);
      await attachJson(testInfo, 'forgot-password-flow.json', flow);
      return;
    }

    const submitResult = await submitForgotPassword(page, player.email);
    flow.steps.submitForgotPassword = submitResult;
    if (!submitResult.ok) {
      markBlocked(testInfo, submitResult.reason);
      await attachJson(testInfo, 'forgot-password-flow.json', flow);
      return;
    }

    const mailResult = await pollForResetLink({
      config: gmail,
      targetEmail: player.email,
      baseUrl: BASE_URL,
      afterTsMs: resetRequestedAt,
      timeoutMs: MAIL_TIMEOUT_MS,
      pollIntervalMs: MAIL_POLL_MS,
    });
    flow.steps.mailLookup = {
      found: mailResult.found,
      query: mailResult.query,
      message: mailResult.message,
    };
    await attachJson(testInfo, 'forgot-password-mail.json', flow.steps.mailLookup);

    if (!mailResult.found || !mailResult.link) {
      markBlocked(
        testInfo,
        `Reset email was not found in Gmail inbox within ${Math.floor(MAIL_TIMEOUT_MS / 1000)}s.`
      );
      await attachJson(testInfo, 'forgot-password-flow.json', flow);
      return;
    }

    const resetResult = await applyResetPasswordViaLink(page, mailResult.link, newPassword);
    flow.steps.applyReset = {
      ...resetResult,
      resetLinkHost: (() => {
        try {
          return new URL(mailResult.link).hostname;
        } catch {
          return '';
        }
      })(),
    };
    if (!resetResult.ok) {
      markBlocked(testInfo, resetResult.reason);
      await attachJson(testInfo, 'forgot-password-flow.json', flow);
      return;
    }

    const signinValidation = await validatePlayerSigninViaCdpTurnstile({
      data: {
        email: player.email,
        password: newPassword,
      },
      baseUrl: BASE_URL,
    });
    flow.steps.signinValidation = signinValidation;
    await attachJson(testInfo, 'forgot-password-signin-validation.json', signinValidation);

    if (!signinValidation.ok) {
      const errorCode = oneLine(signinValidation.body && signinValidation.body.errorCode);
      const reason = oneLine(
        (signinValidation.body && signinValidation.body.errorMessage) ||
          'Sign-in validation failed.'
      );
      if (/credentials_not_valid/i.test(errorCode)) {
        expect(
          signinValidation.ok,
          `Reset password was applied but new credentials are invalid: ${reason}`
        ).toBeTruthy();
      }
      markBlocked(
        testInfo,
        `Sign-in validation after reset did not complete: ${errorCode || reason}`
      );
      await attachJson(testInfo, 'forgot-password-flow.json', flow);
      return;
    }

    updatePlayerArtifacts({
      email: player.email,
      basePlayer: player.data,
      newPassword,
      validation: {
        ok: true,
        status: 'password-signin-ok',
        method: 'forgot-password + cdp-signin-turnstile',
        reason: 'Password reset via email link completed and sign-in succeeded.',
      },
    });

    flow.finishedAt = new Date().toISOString();
    await attachJson(testInfo, 'forgot-password-flow.json', flow);
  } catch (error) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error })) return;
    throw error;
  }
});
