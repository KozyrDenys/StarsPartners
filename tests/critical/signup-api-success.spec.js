const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  maybeSkipWaf,
  openSignupModal,
  waitForHomeContent,
} = require('../helpers/gt-utils');
const {
  applyAuthTokenCookie,
  isSignupTurnstileBlockedError,
  registerPlayerViaApi,
  validatePlayerSigninViaCdpTurnstile,
} = require('../helpers/signup-api-fallback');
const { createRegistrationData, maskValue } = require('../helpers/registration-data');
const { SignupRegistrationPage } = require('../page-objects/signup-registration-page');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const SHORT_RUN_TAG = `c${Date.now().toString(36).slice(-6)}`;
const SIGNIN_VALIDATION_ENABLED = process.env.PW_SIGNUP_VALIDATE_SIGNIN !== '0';
const SIGNIN_VALIDATION_TIMEOUT_MS = Number.parseInt(
  process.env.PW_SIGNUP_VALIDATE_SIGNIN_TIMEOUT_MS || '90000',
  10
);

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchProfileEmailByToken(page, token) {
  const safeToken = oneLine(token);
  if (!safeToken) return '';

  const url = new URL('/api/user/profile', BASE_URL).toString();
  const response = await page.request
    .get(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization: `Bearer ${safeToken}`,
      },
      failOnStatusCode: false,
      timeout: 20_000,
    })
    .catch(() => null);
  if (!response || response.status() >= 400) return '';

  const payload = await response.json().catch(() => null);
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : null;
  if (!data) return '';
  return oneLine(data.email || data.login || data.username || data.userName || '').toLowerCase();
}

function writeRegistrationData(data, validation = {}) {
  const volatileDir = PROJECT_TEST_RESULTS_DIR;
  const volatilePath = path.join(volatileDir, 'registration-data.json');
  const stableDir = PROJECT_ARTIFACTS_DIR;
  const currentRunPath = path.join(stableDir, 'registration-data-current-run.json');
  const stablePath = path.join(stableDir, 'last-registered-player.json');
  const manualReadyPath = path.join(stableDir, 'last-manual-login-player.json');
  const candidatePath = path.join(stableDir, 'last-login-candidate.txt');
  const validationStatus = oneLine(validation.status || 'unverified') || 'unverified';
  const manualLoginReady =
    validation.manualLoginReady === true || validationStatus.toLowerCase() === 'password-signin-ok';
  const loginEmail = oneLine(validation.loginEmail || data.email || '').toLowerCase();
  const profileEmail = oneLine(validation.profileEmail || '').toLowerCase();
  const validationAt = oneLine(validation.validatedAt || '');

  const payload = {
    source: 'tests/critical/signup-api-success.spec.js',
    generatedAt: new Date().toISOString(),
    email: data.email,
    loginEmail: loginEmail || data.email,
    profileEmail,
    emailDateDisplay: data.emailDateDisplay || '',
    password: data.password,
    passwordMasked: maskValue(data.password),
    firstName: data.firstName,
    lastName: data.lastName,
    country: data.country,
    city: data.city,
    address: data.address,
    dateOfBirth: `${data.dd}.${data.mm}.${data.yyyy}`,
    phoneMasked: maskValue(data.phone, 1),
    authToken: data.authToken || '',
    authTokenMasked: data.authToken ? maskValue(data.authToken) : '',
    manualLoginReady,
    loginValidationStatus: validationStatus,
    loginValidationMethod: oneLine(validation.method || ''),
    loginValidationReason:
      oneLine(validation.reason) ||
      'Credentials were created, but password-based sign-in has not been validated yet.',
    loginValidationAt: validationAt,
    lastLoginCheckStatus: validationStatus,
    lastLoginCheckMethod: oneLine(validation.method || ''),
    lastLoginCheckReason:
      oneLine(validation.reason) ||
      'Credentials were created, but password-based sign-in has not been validated yet.',
    lastLoginCheckAt: validationAt || new Date().toISOString(),
  };

  try {
    fs.mkdirSync(volatileDir, { recursive: true });
    fs.writeFileSync(volatilePath, JSON.stringify(payload, null, 2), 'utf8');
    fs.mkdirSync(stableDir, { recursive: true });
    fs.writeFileSync(currentRunPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(stablePath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(
      candidatePath,
      `email=${payload.loginEmail || data.email}\npassword=${data.password}\nstatus=${validationStatus}\n`,
      'utf8'
    );
    if (manualLoginReady) {
      fs.writeFileSync(manualReadyPath, JSON.stringify(payload, null, 2), 'utf8');
    } else if (fs.existsSync(manualReadyPath)) {
      fs.unlinkSync(manualReadyPath);
    }
  } catch {
    // best-effort only
  }
}

function assertSignupApiResponse(signupApi) {
  expect(signupApi, 'No signup API response captured (UI or fallback).').toBeTruthy();
  expect(signupApi.status, 'POST /api/auth/signup should return 200.').toBe(200);
  expect(
    signupApi.body && typeof signupApi.body === 'object',
    'Signup API body should be JSON object.'
  ).toBeTruthy();

  const userId = Number(signupApi.body.userId);
  expect(
    Number.isFinite(userId) && userId > 0,
    'Signup API should return positive userId.'
  ).toBeTruthy();
  expect(
    typeof signupApi.body.token === 'string' && signupApi.body.token.length >= 10,
    'Signup API should return token.'
  ).toBeTruthy();
}

async function validateSigninAfterSignup({ page, data, signupToken, testInfo }) {
  const signupProfileEmail = await fetchProfileEmailByToken(page, signupToken);
  if (!SIGNIN_VALIDATION_ENABLED) {
    return {
      manualLoginReady: false,
      status: 'unverified',
      method: '',
      reason: 'Password sign-in validation is disabled by PW_SIGNUP_VALIDATE_SIGNIN=0.',
      validatedAt: '',
      loginEmail: signupProfileEmail || data.email,
      profileEmail: signupProfileEmail || '',
    };
  }

  const signinValidationTimeoutMs =
    Number.isFinite(SIGNIN_VALIDATION_TIMEOUT_MS) && SIGNIN_VALIDATION_TIMEOUT_MS > 0
      ? SIGNIN_VALIDATION_TIMEOUT_MS
      : 90_000;
  const signinValidation = await Promise.race([
    validatePlayerSigninViaCdpTurnstile({
      data,
      baseUrl: BASE_URL,
    }),
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            status: 0,
            body: {
              errorCode: 'SIGNIN_VALIDATION_TIMEOUT',
              errorMessage: `CDP sign-in validation exceeded ${signinValidationTimeoutMs} ms.`,
            },
            source: 'cdp-signin-turnstile',
          }),
        signinValidationTimeoutMs
      )
    ),
  ]);
  await testInfo.attach('signup-signin-validation.json', {
    body: JSON.stringify(signinValidation, null, 2),
    contentType: 'application/json',
  });

  if (!signinValidation || !signinValidation.ok) {
    const reason = `Password sign-in validation failed after signup (status=${signinValidation ? signinValidation.status : 0}).`;
    testInfo.annotations.push({
      type: 'login-validation',
      description: reason,
    });
    return {
      manualLoginReady: false,
      status: 'signin-validation-failed',
      method: 'cdp-signin-turnstile',
      reason,
      validatedAt: new Date().toISOString(),
      loginEmail: signupProfileEmail || data.email,
      profileEmail: signupProfileEmail || '',
    };
  }

  const signinToken =
    signinValidation && signinValidation.body && typeof signinValidation.body.token === 'string'
      ? signinValidation.body.token
      : '';
  const profileEmail = await fetchProfileEmailByToken(page, signinToken || signupToken);
  const loginEmail = profileEmail || signupProfileEmail || data.email;
  return {
    manualLoginReady: true,
    status: 'password-signin-ok',
    method: 'cdp-signin-turnstile',
    reason: 'Password sign-in validated via CDP Turnstile flow.',
    validatedAt: new Date().toISOString(),
    loginEmail,
    profileEmail: profileEmail || signupProfileEmail || '',
  };
}

async function persistRegistrationWithValidation({ page, data, signupToken, testInfo }) {
  const validation = await validateSigninAfterSignup({
    page,
    data,
    signupToken,
    testInfo,
  });
  writeRegistrationData(
    {
      ...data,
      authToken: signupToken,
    },
    validation
  );
}

test('Sign Up API: successful registration returns token and userId', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);

  const data = createRegistrationData({
    emailSuffix: SHORT_RUN_TAG,
  });

  const wafProbe = createWafProbe(page);
  const signupApiResponses = [];
  let fallbackSignup = null;
  let fallbackTried = false;

  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const method = resp.request().method();
      if (method !== 'POST') return;
      if (!/\/api\/auth\/signup(?:\?|$)/i.test(url)) return;

      const contentType = resp.headers()['content-type'] || '';
      let body = null;
      if (contentType.includes('application/json')) {
        body = await resp.json().catch(() => null);
      } else {
        body = await resp.text().catch(() => null);
      }

      signupApiResponses.push({
        url,
        status: resp.status(),
        statusText: resp.statusText(),
        body,
      });
    } catch {
      // ignore response parsing issues
    }
  });

  try {
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);

    const modal = await openSignupModal(page);
    await expect(modal).toBeVisible({ timeout: 15000 });
    const errorToast = page.getByText(/something went wrong/i).first();

    const signupPage = new SignupRegistrationPage(page, modal);
    try {
      await signupPage.completeRegistration(data, {
        errorToast,
        annotate: (description) => testInfo.annotations.push({ type: 'debug', description }),
      });

      const outcome = await signupPage.waitForOutcome();
      if (outcome === 'error') {
        throw new Error('Registration UI returned an error state (already exists/invalid).');
      }
    } catch (err) {
      if (!isSignupTurnstileBlockedError(err)) throw err;
      fallbackTried = true;
      fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL });
      expect(
        fallbackSignup.ok,
        `Signup API fallback failed: status=${fallbackSignup.status} body=${JSON.stringify(
          fallbackSignup.body
        )}`
      ).toBeTruthy();
      await applyAuthTokenCookie(page.context(), fallbackSignup.body.token, BASE_URL);
      testInfo.annotations.push({
        type: 'debug',
        description: `Signup fallback used: status=${fallbackSignup.status}, userId=${fallbackSignup.body.userId}`,
      });
    }

    const signupApi = fallbackSignup || signupApiResponses.at(-1);
    assertSignupApiResponse(signupApi);

    await persistRegistrationWithValidation({
      page,
      data,
      signupToken: signupApi.body.token,
      testInfo,
    });
  } catch (err) {
    if (!fallbackTried) {
      fallbackTried = true;
      fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL }).catch(
        () => null
      );
      if (fallbackSignup && fallbackSignup.ok) {
        await applyAuthTokenCookie(page.context(), fallbackSignup.body.token, BASE_URL);
        testInfo.annotations.push({
          type: 'debug',
          description: `Signup fallback used after UI error: status=${fallbackSignup.status}, userId=${fallbackSignup.body.userId}`,
        });
        assertSignupApiResponse(fallbackSignup);
        await persistRegistrationWithValidation({
          page,
          data,
          signupToken: fallbackSignup.body.token,
          testInfo,
        });
        return;
      }
    }

    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  }
});
