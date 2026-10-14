const { test, expect } = require('../fixtures/qa-test');
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
} = require('../helpers/signup-api-fallback');
const { createRegistrationData, maskValue } = require('../helpers/registration-data');
const { SignupRegistrationPage } = require('../page-objects/signup-registration-page');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');

function writeRegistrationData(data) {
  const volatileDir = PROJECT_TEST_RESULTS_DIR;
  const volatilePath = path.join(volatileDir, 'registration-data.json');
  const stableDir = PROJECT_ARTIFACTS_DIR;
  const currentRunPath = path.join(stableDir, 'registration-data-current-run.json');
  const stablePath = path.join(stableDir, 'last-registered-player.json');
  const manualReadyPath = path.join(stableDir, 'last-manual-login-player.json');
  const candidatePath = path.join(stableDir, 'last-login-candidate.txt');
  const payload = {
    source: 'tests/destructive/signup-full.spec.js',
    generatedAt: new Date().toISOString(),
    email: data.email,
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
    manualLoginReady: false,
    loginValidationStatus: 'unverified',
    loginValidationMethod: '',
    loginValidationReason:
      'Credentials were created, but password-based sign-in has not been validated yet.',
    loginValidationAt: '',
  };

  try {
    fs.mkdirSync(volatileDir, { recursive: true });
    fs.writeFileSync(volatilePath, JSON.stringify(payload, null, 2), 'utf8');
    fs.mkdirSync(stableDir, { recursive: true });
    fs.writeFileSync(currentRunPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(stablePath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(
      candidatePath,
      `email=${data.email}\npassword=${data.password}\nstatus=unverified-password-signin\n`,
      'utf8'
    );
    if (fs.existsSync(manualReadyPath)) fs.unlinkSync(manualReadyPath);
  } catch {
    // Best-effort only; do not fail test on report metadata writes.
  }
}

function writeRegistrationNetwork(payload) {
  const outDir = PROJECT_TEST_RESULTS_DIR;
  const outPath = path.join(outDir, 'registration-network.json');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

function annotate(testInfo, type, description) {
  testInfo.annotations.push({ type, description });
}

test('Sign Up flow: create new player (prod)', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const data = createRegistrationData();

  const wafProbe = createWafProbe(page);
  const diagnostics = {
    responseErrors: [],
    failedRequests: [],
    consoleErrors: [],
    authResponses: [],
    toastErrors: [],
  };

  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const method = resp.request().method();
      const contentType = resp.headers()['content-type'] || '';
      const isAuth = /signup|register|auth|user|account|profile/i.test(url);

      if (resp.status() >= 400) {
        let body = '';
        if (contentType.includes('application/json')) {
          body = JSON.stringify(await resp.json().catch(() => null));
        } else {
          body = (await resp.text().catch(() => ''))?.slice(0, 500) || '';
        }
        diagnostics.responseErrors.push({
          url,
          status: resp.status(),
          statusText: resp.statusText(),
          method,
          body,
        });
      } else if (isAuth && method === 'POST') {
        let body = '';
        if (contentType.includes('application/json')) {
          body = JSON.stringify(await resp.json().catch(() => null));
        }
        diagnostics.authResponses.push({
          url,
          status: resp.status(),
          statusText: resp.statusText(),
          method,
          body,
        });
      }
    } catch {
      // ignore listener errors
    }
  });

  page.on('requestfailed', (req) => {
    diagnostics.failedRequests.push({
      url: req.url(),
      method: req.method(),
      errorText: req.failure()?.errorText || '',
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      diagnostics.consoleErrors.push(msg.text());
    }
  });

  try {
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

    const modal = await openSignupModal(page);
    await expect(modal).toBeVisible({ timeout: 15000 });

    const signupPage = new SignupRegistrationPage(page, modal);
    const errorToast = page.getByText(/something went wrong/i).first();
    let usedFallback = false;
    let fallbackAuthToken = '';

    try {
      await signupPage.completeRegistration(data, {
        errorToast,
        annotate: (description) => annotate(testInfo, 'debug', description),
      });

      const outcome = await signupPage.waitForOutcome();

      if (outcome === 'error') {
        throw new Error(
          'Registration failed: account already exists or invalid data. Use a unique email.'
        );
      }

      if (!outcome) {
        annotate(
          testInfo,
          'registration',
          'No definitive success/OTP/close signal detected after signup.'
        );
      }
    } catch (err) {
      if (!isSignupTurnstileBlockedError(err)) throw err;
      const fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL });
      if (!fallbackSignup.ok) {
        throw new Error(
          `Signup API fallback failed: status=${fallbackSignup.status} body=${JSON.stringify(
            fallbackSignup.body
          )}`
        );
      }
      await applyAuthTokenCookie(page.context(), fallbackSignup.body.token, BASE_URL);
      fallbackAuthToken = String(fallbackSignup.body.token || '');
      diagnostics.authResponses.push({
        url: fallbackSignup.url,
        status: fallbackSignup.status,
        statusText: 'fallback',
        method: 'POST',
        body: JSON.stringify(fallbackSignup.body),
      });
      annotate(
        testInfo,
        'debug',
        `Signup fallback used: status=${fallbackSignup.status}, userId=${fallbackSignup.body.userId}`
      );
      usedFallback = true;
    }

    if (usedFallback) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
    }

    writeRegistrationData({
      ...data,
      authToken: fallbackAuthToken,
    });
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  } finally {
    const hasDiagnostics =
      diagnostics.responseErrors.length ||
      diagnostics.failedRequests.length ||
      diagnostics.consoleErrors.length ||
      diagnostics.authResponses.length ||
      diagnostics.toastErrors.length;
    if (hasDiagnostics) writeRegistrationNetwork(diagnostics);
  }
});
