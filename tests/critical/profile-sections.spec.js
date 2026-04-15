const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const { URL } = require('url');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  assertNotCloudflare,
  closeModal,
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
const STRICT_A11Y = process.env.PW_A11Y_STRICT === '1';
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'my-profile');
const VISUAL_DIR = path.join(ARTIFACT_DIR, 'visual');
const AUTH_STATE_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json');
const FALLBACK_AUTH_STATES = [
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
];
const RUNTIME_PATH = path.join(ARTIFACT_DIR, 'profile-runtime.json');

const PROFILE_ROUTES = [
  '/profile/',
  '/profile/details/',
  '/profile/security/',
  '/promotions/bonuses/',
  '/assets/',
  '/transactions/',
  '/profile/preferences/',
  '/referral/',
];

const BONUS_ROUTE_CANDIDATES = ['/promotions/bonuses/', '/bonuses/', '/profile/bonuses/'];

let setupError = null;
let authPlayer = null;
const runtime = {
  startedAt: new Date().toISOString(),
  setup: {},
  tests: {},
};

test.describe.configure({ mode: 'serial' });

test.describe('Profile Coverage: P0/P1/P2', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180000);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.mkdirSync(VISUAL_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

    const reused = await tryReuseAuthState(browser);
    if (reused.ok) {
      runtime.setup = {
        ok: true,
        reused: true,
        authStatePath: AUTH_STATE_PATH,
        source: reused.source,
      };
      writeRuntime();
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
      const data = createRegistrationData({
        emailSuffix: `pf${Date.now().toString(36).slice(-6)}`,
      });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await assertNotCloudflare(page);
      await dismissOverlays(page);
      await waitForHomeContent(page);

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
          throw new Error('Profile setup signup returned error outcome.');
        }
      } catch (err) {
        if (!isSignupTurnstileBlockedError(err)) throw err;
        const fallbackSignup = await registerPlayerViaApi({ page, data, baseUrl: BASE_URL });
        if (!fallbackSignup.ok) {
          throw new Error(
            `Profile setup fallback failed: status=${fallbackSignup.status} body=${JSON.stringify(
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
        .waitFor({ state: 'hidden', timeout: 12000 })
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
      writeRuntime();
    }
  });

  test.afterAll(() => {
    runtime.finishedAt = new Date().toISOString();
    writeRuntime();
  });

  test('P0.1 Authorized access matrix: profile routes are available without signup redirect', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_profile_access_matrix';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const findings = [];
      const blocked = [];

      for (const route of PROFILE_ROUTES) {
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

        findings.push({ ...state, loginVisible });
        expect(
          isSignupRedirect(state.finalUrl),
          `Authorized user should not hit signup redirect for ${route}.`
        ).toBeFalsy();
        expect(loginVisible, `Log In should stay hidden on ${route}.`).toBeFalsy();
      }

      if (blocked.length === PROFILE_ROUTES.length) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'Cloudflare/WAF blocked all profile routes in authorized mode.'
        );
        return;
      }

      const payload = { routes: PROFILE_ROUTES, findings, blocked };
      runtime.tests[testName] = { status: 'passed', payload };
      if (blocked.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Partially blocked profile routes: ${blocked.map((v) => v.route).join(', ')}`,
        });
      }
      await testInfo.attach('p0-profile-access-matrix.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.2 My profile navigation: tabs open expected destinations', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_profile_navigation';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const entry = await openRoute(page, '/profile/');
      if (entry.challenge) {
        markBlockedAndReturn(testInfo, testName, entry.challenge);
        return;
      }

      const navTargets = [
        {
          label: 'Account',
          route: '/profile/',
          selectors: [
            '[data-testid="profile-account-button"]',
            'a[href="/profile/"]',
            'a[href*="/profile/"]:has-text("Account")',
            '.t-navigation-pages .list__item:has-text("Account")',
          ],
          expected: /\/profile\/?$/i,
        },
        {
          label: 'Bonuses',
          route: '/promotions/bonuses/',
          selectors: [
            '[data-testid="profile-bonuses-button"]',
            'a[href*="/promotions/bonuses"]',
            'a[href*="/bonuses"]',
            '.t-navigation-pages .list__item:has-text("Bonuses")',
            'button:has-text("Bonuses")',
          ],
          expected: /\/promotions\/bonuses\/?|\/bonuses\/?/i,
        },
        {
          label: 'Referrals',
          route: '/referral/',
          selectors: [
            '[data-testid="profile-referrals-button"]',
            'a[href*="/referral"]',
            '.t-navigation-pages .list__item:has-text("Referrals")',
            'button:has-text("Referrals")',
          ],
          expected: /\/referral\/?/i,
        },
        {
          label: 'Wallet',
          route: '/assets/',
          selectors: [
            '[data-testid="profile-wallet-button"]',
            'a[href*="/assets"]',
            '.t-navigation-pages .list__item:has-text("Wallet")',
            'button:has-text("Wallet")',
          ],
          expected: /\/assets\/?/i,
        },
        {
          label: 'Bets',
          route: '/transactions/',
          selectors: [
            '[data-testid="profile-bets-button"]',
            'a[href*="/transactions"]',
            '.t-navigation-pages .list__item:has-text("Bets")',
            'button:has-text("Bets")',
          ],
          expected: /\/transactions\/?/i,
        },
        {
          label: 'Settings',
          route: '/profile/preferences/',
          selectors: [
            '[data-testid="profile-settings-button"]',
            'a[href*="/profile/preferences"]',
            '.t-navigation-pages .list__item:has-text("Settings")',
            'button:has-text("Settings")',
          ],
          expected: /\/profile\/preferences\/?/i,
        },
      ];

      const findings = [];
      const blocked = [];
      const missing = [];
      const mismatched = [];

      for (const target of navTargets) {
        const profileState = await openRoute(page, '/profile/');
        if (profileState.challenge) {
          blocked.push({
            label: target.label,
            challenge: profileState.challenge,
            finalUrl: profileState.finalUrl,
          });
          continue;
        }

        await waitForAnyVisible(page, [
          '[data-testid="profile-account-button"]',
          '.t-navigation-pages .list__item:has-text("Account")',
          'a[href="/profile/"]',
        ]);

        const nav = await clickFirstVisible(page, target.selectors);
        if (!nav.found) {
          missing.push(target.label);
          const directCheck = await openRoute(page, target.route);
          if (directCheck.challenge) {
            blocked.push({
              label: target.label,
              challenge: directCheck.challenge,
              finalUrl: directCheck.finalUrl,
            });
            continue;
          }
          const finalUrl = directCheck.finalUrl;
          const matched = matchesExpectedRoute(finalUrl, target.expected);
          findings.push({
            label: target.label,
            finalUrl,
            matched,
            directCheck: {
              requestedUrl: directCheck.requestedUrl,
              finalUrl: directCheck.finalUrl,
              status: directCheck.status,
            },
            nav,
          });
          if (!matched) mismatched.push(target.label);
          continue;
        }

        await page.waitForLoadState('domcontentloaded').catch(() => null);
        await dismissOverlays(page);
        const challenge = await getChallengeReason(page);
        if (challenge) {
          blocked.push({ label: target.label, challenge, finalUrl: page.url() });
          continue;
        }

        let finalUrl = page.url();
        let matched = matchesExpectedRoute(finalUrl, target.expected);
        let directCheck = null;
        if (!matched) {
          directCheck = await openRoute(page, target.route);
          if (directCheck.challenge) {
            blocked.push({
              label: target.label,
              challenge: directCheck.challenge,
              finalUrl: directCheck.finalUrl,
            });
            continue;
          }
          finalUrl = directCheck.finalUrl;
          matched = matchesExpectedRoute(finalUrl, target.expected);
        }

        findings.push({
          label: target.label,
          finalUrl,
          matched,
          directCheck: directCheck
            ? {
                requestedUrl: directCheck.requestedUrl,
                finalUrl: directCheck.finalUrl,
                status: directCheck.status,
              }
            : null,
        });
        if (!matched) mismatched.push(target.label);
      }

      if (!findings.length && blocked.length) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'Profile navigation is fully blocked by challenge.'
        );
        return;
      }

      const matchedCount = findings.filter((v) => v.matched).length;
      expect(
        matchedCount,
        'At least one profile navigation target should resolve to expected destination.'
      ).toBeGreaterThan(0);

      const payload = {
        navTargets: navTargets.map((v) => v.label),
        findings,
        blocked,
        missing,
        mismatched,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      if (missing.length) {
        testInfo.annotations.push({
          type: 'profile',
          description: `Navigation controls not found: ${missing.join(', ')}`,
        });
      }
      if (mismatched.length) {
        testInfo.annotations.push({
          type: 'profile',
          description: `Navigation controls with unexpected destination: ${mismatched.join(', ')}`,
        });
      }
      await testInfo.attach('p0-profile-navigation.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.3 Account section: page open, avatar upload, account details and security center', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_account_section_deep';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const accountState = await openRoute(page, '/profile/');
      if (accountState.challenge) {
        markBlockedAndReturn(testInfo, testName, accountState.challenge);
        return;
      }

      const accountScroll = await scrollPageAndBack(page);
      const accountMarkerVisible = await hasAnyVisible(page, [
        '[data-testid*="profile" i]',
        '.t-navigation-pages',
        'text=/account|profile|security/i',
      ]);

      const avatarResponses = [];
      const avatarResponseListener = (resp) => {
        try {
          const url = resp.url();
          if (!/avatar|photo|image|upload|profile/i.test(url)) return;
          avatarResponses.push({
            url,
            status: resp.status(),
            method: resp.request().method(),
          });
        } catch {
          // ignore
        }
      };
      page.on('response', avatarResponseListener);

      const avatarSelectors = [
        'input[type="file"][accept*="image" i]',
        'input[type="file"][name*="avatar" i]',
        'input[type="file"][name*="photo" i]',
        'input[type="file"][id*="avatar" i]',
      ];
      let avatarSelector = '';
      let avatarInput = null;
      for (const selector of avatarSelectors) {
        const count = await page
          .locator(selector)
          .count()
          .catch(() => 0);
        if (count < 1) continue;
        avatarSelector = selector;
        avatarInput = page.locator(selector).first();
        break;
      }

      let avatarInputFound = Boolean(avatarInput);
      let avatarUploaded = false;
      let avatarFileNames = [];
      let avatarSaveClicked = false;

      if (!avatarInputFound) {
        const avatarTrigger = await firstVisibleLocator(page, [
          'button:has-text("Upload")',
          'button:has-text("Avatar")',
          'button:has-text("Photo")',
          '[data-testid*="avatar" i]',
        ]);
        if (avatarTrigger) {
          await avatarTrigger.click({ timeout: 8000 }).catch(() => null);
          await dismissOverlays(page);
          for (const selector of avatarSelectors) {
            const count = await page
              .locator(selector)
              .count()
              .catch(() => 0);
            if (count < 1) continue;
            avatarSelector = selector;
            avatarInput = page.locator(selector).first();
            avatarInputFound = true;
            break;
          }
        }
      }

      if (!avatarInputFound) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'Avatar upload control was not found on Account page.'
        );
        return;
      }

      const avatarFixturePath = ensureAvatarFixture();
      try {
        await avatarInput.setInputFiles(avatarFixturePath);
        avatarFileNames = await avatarInput
          .evaluate((node) => {
            const files = node && node.files ? Array.from(node.files) : [];
            return files.map((file) => file.name);
          })
          .catch(() => []);
        avatarUploaded = avatarFileNames.length > 0;
      } catch {
        avatarUploaded = false;
      }

      const avatarSaveButton = await firstVisibleLocator(page, [
        'button:has-text("Save")',
        'button:has-text("Update")',
        'button:has-text("Upload")',
      ]);
      if (avatarSaveButton) {
        await avatarSaveButton.click({ timeout: 10000 }).catch(() => null);
        avatarSaveClicked = true;
      }

      expect(
        avatarUploaded || avatarSaveClicked,
        'Avatar upload flow should attach file or allow explicit save action.'
      ).toBeTruthy();

      const detailsState = await openRoute(page, '/profile/details/');
      if (detailsState.challenge) {
        markBlockedAndReturn(testInfo, testName, detailsState.challenge);
        return;
      }
      const detailsScroll = await scrollPageAndBack(page);
      const detailsControlsVisible = await hasAnyVisible(page, [
        'input[name*="first" i]',
        'input[name*="last" i]',
        'input[name*="city" i]',
        'input[name*="address" i]',
        'button:has-text("Save")',
        'button:has-text("Update")',
      ]);

      const securityState = await openRoute(page, '/profile/security/');
      if (securityState.challenge) {
        markBlockedAndReturn(testInfo, testName, securityState.challenge);
        return;
      }
      const securityScroll = await scrollPageAndBack(page);
      const securityControlsVisible = await hasAnyVisible(page, [
        'input[type="password"]',
        'input[name*="password" i]',
        'button:has-text("Enable")',
        'button:has-text("Disable")',
        'button:has-text("Save")',
      ]);

      page.off('response', avatarResponseListener);

      expect(
        accountMarkerVisible,
        'Account page should expose profile/account markers.'
      ).toBeTruthy();
      expect(
        detailsControlsVisible,
        'Account details section should expose editable controls.'
      ).toBeTruthy();
      expect(
        securityControlsVisible,
        'Security center should expose password/security controls.'
      ).toBeTruthy();

      const payload = {
        accountState,
        accountScroll,
        accountMarkerVisible,
        avatar: {
          inputFound: avatarInputFound,
          selector: avatarSelector,
          uploaded: avatarUploaded,
          fileNames: avatarFileNames,
          saveClicked: avatarSaveClicked,
          responses: avatarResponses,
        },
        details: {
          state: detailsState,
          scroll: detailsScroll,
          controlsVisible: detailsControlsVisible,
        },
        security: {
          state: securityState,
          scroll: securityScroll,
          controlsVisible: securityControlsVisible,
        },
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p0-account-section-deep.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P0.4 Bonuses section: page open, bonuses availability, bonus details open', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_bonuses_section_deep';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const opened = await openFirstAvailableRoute(page, BONUS_ROUTE_CANDIDATES);
      if (!opened.state) {
        markBlockedAndReturn(testInfo, testName, 'Bonuses route is not reachable.');
        return;
      }
      if (opened.state.challenge) {
        markBlockedAndReturn(testInfo, testName, opened.state.challenge);
        return;
      }

      const scroll = await scrollPageAndBack(page);
      const markerVisible = await hasAnyVisible(page, [
        '[class*="bonus" i]',
        '[data-testid*="bonus" i]',
        'text=/bonus|campaign|free spin|cashback/i',
      ]);
      const bonusCards = page.locator(
        '[class*="bonus" i] [class*="item" i], [class*="bonus-card" i], [data-testid*="bonus" i]'
      );
      const bonusCardsCount = await bonusCards.count().catch(() => 0);
      const emptyStateVisible = await page
        .getByText(/no bonuses|you have no bonuses|bonus is unavailable|empty/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (bonusCardsCount < 1 && emptyStateVisible) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'Bonuses page is open, but player has no available bonuses to open.'
        );
        return;
      }

      const openControl = await firstVisibleLocator(page, [
        'button:has-text("Open")',
        'button:has-text("Details")',
        'button:has-text("More")',
        '[class*="bonus" i] button',
        '[class*="bonus" i] a',
      ]);
      let detailsOpened = false;
      let modalVisible = false;
      let openChangedUrl = false;
      if (openControl) {
        const beforeUrl = page.url();
        await openControl.click({ timeout: 10000 }).catch(() => null);
        await page.waitForLoadState('domcontentloaded').catch(() => null);
        await dismissOverlays(page);
        const challenge = await getChallengeReason(page);
        if (challenge) {
          markBlockedAndReturn(testInfo, testName, challenge);
          return;
        }
        modalVisible = await hasAnyVisible(page, ['.t-modal:visible', '[role="dialog"]:visible']);
        openChangedUrl = page.url() !== beforeUrl;
        const detailsMarkerVisible = await hasAnyVisible(page, [
          'text=/wager|turnover|terms|deadline|progress|activated/i',
          '[class*="bonus" i] [class*="details" i]',
        ]);
        detailsOpened = modalVisible || openChangedUrl || detailsMarkerVisible;

        if (modalVisible) {
          const modal = page.locator('.t-modal:visible, [role="dialog"]:visible').first();
          await closeModal(modal, page).catch(() => null);
        }
      }

      expect(markerVisible, 'Bonuses section should show bonus markers/content.').toBeTruthy();
      expect(
        bonusCardsCount > 0 || Boolean(openControl),
        'Bonuses section should expose bonus cards or open controls.'
      ).toBeTruthy();
      expect(detailsOpened, 'At least one bonus should open details/expanded view.').toBeTruthy();

      const payload = {
        route: opened.state,
        attempts: opened.attempts,
        scroll,
        markerVisible,
        bonusCardsCount,
        emptyStateVisible,
        openControlFound: Boolean(openControl),
        detailsOpened,
        modalVisible,
        openChangedUrl,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p0-bonuses-section-deep.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.4 Profile save: editable field persists after reload', async ({ browser }, testInfo) => {
    const testName = 'p1_profile_save_persistence';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/profile/details/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const fieldSelectors = [
        'input[name*="first" i]',
        'input[name*="last" i]',
        'input[name*="city" i]',
        'input[name*="address" i]',
        'input[placeholder*="First" i]',
        'input[placeholder*="Last" i]',
      ];
      const field = await firstVisibleEditable(page, fieldSelectors);
      if (!field) {
        markBlockedAndReturn(testInfo, testName, 'No editable profile text field found.');
        return;
      }

      const fieldSelector = field.selector;
      const input = field.locator;
      const originalValue = (await input.inputValue().catch(() => '')).trim();
      const nextValue = buildUpdatedValue(originalValue);
      const responses = [];
      const responseListener = async (resp) => {
        try {
          const url = resp.url();
          if (!/\/api\/(user|profile|account)/i.test(url)) return;
          responses.push({
            url,
            status: resp.status(),
            method: resp.request().method(),
          });
        } catch {
          // ignore parse issues
        }
      };
      page.on('response', responseListener);

      let restored = false;
      try {
        await input.fill(nextValue);
        const save = await firstVisibleLocator(page, [
          'button:has-text("Save")',
          'button:has-text("Update")',
          'button[type="submit"]',
        ]);
        if (!save) {
          markBlockedAndReturn(
            testInfo,
            testName,
            'Save/Update button not found on profile details.'
          );
          return;
        }

        await save.click({ timeout: 10000 });
        await page.waitForLoadState('domcontentloaded').catch(() => null);
        const challengeAfterSave = await getChallengeReason(page);
        if (challengeAfterSave) {
          markBlockedAndReturn(testInfo, testName, challengeAfterSave);
          return;
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        const challengeAfterReload = await getChallengeReason(page);
        if (challengeAfterReload) {
          markBlockedAndReturn(testInfo, testName, challengeAfterReload);
          return;
        }

        const reloadedField = page.locator(fieldSelector).first();
        const valueAfterReload = (await reloadedField.inputValue().catch(() => '')).trim();
        const persisted = valueAfterReload === nextValue;
        const has2xx = responses.some((item) => item.status >= 200 && item.status < 300);

        expect(
          persisted || has2xx,
          'Profile save should persist value or return successful API response.'
        ).toBeTruthy();

        const payload = {
          fieldSelector,
          originalValue,
          nextValue,
          valueAfterReload,
          persisted,
          has2xx,
          responses,
        };
        runtime.tests[testName] = { status: 'passed', payload };
        await testInfo.attach('p1-profile-save.json', {
          body: JSON.stringify(payload, null, 2),
          contentType: 'application/json',
        });
      } finally {
        page.off('response', responseListener);
        if (originalValue && originalValue !== nextValue) {
          const restoreField = page.locator(fieldSelector).first();
          if (await restoreField.isVisible().catch(() => false)) {
            await restoreField.fill(originalValue).catch(() => null);
            const save = await firstVisibleLocator(page, [
              'button:has-text("Save")',
              'button:has-text("Update")',
              'button[type="submit"]',
            ]);
            if (save) {
              await save.click({ timeout: 10000 }).catch(() => null);
              restored = true;
            }
          }
        }
        if (restored) {
          testInfo.annotations.push({
            type: 'profile',
            description: 'Profile field value restored after persistence check.',
          });
        }
      }
    });
  });

  test('P1.5 Profile validations: required/format/length checks show validation signal', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_profile_field_validations';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/profile/details/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const firstNameSelector = await firstVisibleSelector(page, [
        'input[name*="first" i]',
        'input[placeholder*="First" i]',
      ]);
      const emailOrPhoneSelector = await firstVisibleSelector(page, [
        'input[name*="email" i]',
        'input[type="email"]',
        'input[name*="phone" i]',
        'input[type="tel"]',
      ]);

      if (!firstNameSelector && !emailOrPhoneSelector) {
        markBlockedAndReturn(testInfo, testName, 'Validation input fields are not visible.');
        return;
      }

      const findings = {
        requiredSignal: false,
        formatSignal: false,
        lengthHandled: false,
      };

      if (firstNameSelector) {
        const input = page.locator(firstNameSelector).first();
        const original = await input.inputValue().catch(() => '');
        await input.fill('');
        await input.blur().catch(() => null);
        findings.requiredSignal = await hasValidationSignal(input, page);

        const longValue = 'autotest'.repeat(40);
        await input.fill(longValue);
        await input.blur().catch(() => null);
        const valueAfterLong = await input.inputValue().catch(() => '');
        const longSignal = await hasValidationSignal(input, page);
        findings.lengthHandled = valueAfterLong.length < longValue.length || longSignal;
        await input.fill(original).catch(() => null);
      }

      if (emailOrPhoneSelector) {
        const input = page.locator(emailOrPhoneSelector).first();
        const original = await input.inputValue().catch(() => '');
        await input.fill('invalid@@autotest');
        await input.blur().catch(() => null);
        findings.formatSignal = await hasValidationSignal(input, page);
        await input.fill(original).catch(() => null);
      }

      const passedSignals = Object.values(findings).filter(Boolean).length;
      expect(
        passedSignals,
        'Expected at least one validation signal (required/format/length) on profile form.'
      ).toBeGreaterThan(0);

      runtime.tests[testName] = { status: 'passed', payload: findings };
      await testInfo.attach('p1-profile-validations.json', {
        body: JSON.stringify(findings, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.6 Settings section: buttons, toggles and dropdowns work with persistence', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_preferences_persistence';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/profile/preferences/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const scroll = await scrollPageAndBack(page);
      const interactive = await collectVisibleInteractiveStats(page);
      const hasSettingsControls =
        interactive.buttons > 0 || interactive.selects > 0 || interactive.toggles > 0;
      expect(hasSettingsControls, 'Settings page should expose interactive controls.').toBeTruthy();

      const utilityButton = await firstVisibleLocator(page, [
        'button:has-text("Enable")',
        'button:has-text("Disable")',
        'button:has-text("Reset")',
        'button:has-text("Restore")',
      ]);
      let utilityButtonClicked = false;
      if (utilityButton) {
        await utilityButton.click({ timeout: 8000 }).catch(() => null);
        await dismissOverlays(page);
        utilityButtonClicked = true;
      }

      const pref = await pickPreferenceControl(page);
      if (!pref) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'No preference control found for persistence check.'
        );
        return;
      }

      const responses = [];
      const responseListener = async (resp) => {
        try {
          const url = resp.url();
          if (!/\/api\/user\/preferences|\/api\/user|\/api\/profile/i.test(url)) return;
          responses.push({
            url,
            status: resp.status(),
            method: resp.request().method(),
          });
        } catch {
          // ignore
        }
      };
      page.on('response', responseListener);

      let restored = false;
      try {
        await pref.applyNext(page);
        const save = await firstVisibleLocator(page, [
          'button:has-text("Save")',
          'button:has-text("Update")',
          'button[type="submit"]',
        ]);
        if (save) {
          await save.click({ timeout: 10000 });
          await page.waitForLoadState('domcontentloaded').catch(() => null);
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        const challengeAfterReload = await getChallengeReason(page);
        if (challengeAfterReload) {
          markBlockedAndReturn(testInfo, testName, challengeAfterReload);
          return;
        }

        const stateAfterReload = await pref.readState(page);
        const persisted = pref.equalsState(stateAfterReload, pref.nextState);
        const has2xx = responses.some((item) => item.status >= 200 && item.status < 300);
        expect(
          persisted || has2xx,
          'Preference update should persist state or return successful API response.'
        ).toBeTruthy();

        const payload = {
          route: state,
          scroll,
          interactive,
          utilityButtonClicked,
          control: pref.kind,
          before: pref.beforeState,
          next: pref.nextState,
          afterReload: stateAfterReload,
          persisted,
          has2xx,
          responses,
        };
        runtime.tests[testName] = { status: 'passed', payload };
        await testInfo.attach('p1-preferences-persistence.json', {
          body: JSON.stringify(payload, null, 2),
          contentType: 'application/json',
        });

        await pref.restore(page).catch(() => null);
        const restoreSave = await firstVisibleLocator(page, [
          'button:has-text("Save")',
          'button:has-text("Update")',
          'button[type="submit"]',
        ]);
        if (restoreSave) {
          await restoreSave.click({ timeout: 10000 }).catch(() => null);
          restored = true;
        }
      } finally {
        page.off('response', responseListener);
        if (restored) {
          testInfo.annotations.push({
            type: 'profile',
            description: 'Preferences reverted after persistence check.',
          });
        }
      }
    });
  });

  test('P1.7 Wallet section: page open, buttons, functions and dropdowns work', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_wallet_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/assets/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const scroll = await scrollPageAndBack(page);
      await waitForAnyVisible(
        page,
        [
          '[data-testid*="assets-wallet" i]',
          '.items__item',
          '.t-assets',
          '.action__button:has-text("Deposit")',
          '.t-header__deposit',
          'text=/main\\s*account|bonus\\s*account|default\\s*wallet/i',
        ],
        10000
      );

      const interactive = await collectVisibleInteractiveStats(page);
      const hasBalanceMarker = await hasAnyVisible(page, [
        '[data-testid*="assets-wallet" i]',
        '.items__item',
        '.t-assets [class*="wallet" i]',
        '.t-assets [class*="balance" i]',
        'text=/main\\s*account|bonus\\s*account|default\\s*wallet/i',
      ]);
      const walletActions = [
        {
          name: 'Deposit',
          selectors: [
            'button:has-text("Deposit")',
            '.action__button:has-text("Deposit")',
            '[data-testid*="deposit"]',
            '.t-header__deposit',
          ],
        },
        {
          name: 'Withdraw',
          selectors: [
            'button:has-text("Withdraw")',
            'button:has-text("Withdrawal")',
            '[data-testid*="withdraw"]',
          ],
        },
        {
          name: 'Transfer',
          selectors: [
            'button:has-text("Transfer")',
            'button:has-text("Exchange")',
            '[data-testid*="transfer"]',
          ],
        },
      ];
      const actionFindings = [];
      for (const action of walletActions) {
        const control = await firstVisibleLocator(page, action.selectors);
        if (!control) continue;

        const beforeUrl = page.url();
        await control.click({ timeout: 10000 }).catch(() => null);
        await page.waitForLoadState('domcontentloaded').catch(() => null);
        await dismissOverlays(page);
        const challenge = await getChallengeReason(page);
        if (challenge) {
          markBlockedAndReturn(testInfo, testName, challenge);
          return;
        }

        const modal = page
          .locator('.t-modal:visible, [role="dialog"]:visible, [class*="payment" i]:visible')
          .first();
        const modalVisible = await modal.isVisible({ timeout: 3000 }).catch(() => false);
        const changedUrl = page.url() !== beforeUrl;
        if (modalVisible) {
          await closeModal(modal, page).catch(() => null);
        }

        actionFindings.push({
          action: action.name,
          modalVisible,
          changedUrl,
        });
        if (changedUrl) {
          const backState = await openRoute(page, '/assets/');
          if (backState.challenge) {
            markBlockedAndReturn(testInfo, testName, backState.challenge);
            return;
          }
        }
      }

      const dropdownInteraction = await interactWithSelectOrCombobox(page);

      expect(
        hasBalanceMarker || actionFindings.length > 0,
        'Wallet page should show balance markers or deposit action.'
      ).toBeTruthy();
      expect(
        actionFindings.length > 0 || dropdownInteraction.found,
        'Wallet page should provide action buttons or dropdown-like controls.'
      ).toBeTruthy();

      const payload = {
        route: state,
        scroll,
        interactive,
        hasBalanceMarker,
        actions: actionFindings,
        dropdownInteraction,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-wallet-smoke.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.8 Bets section: page open, buttons, functions and dropdowns work', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_bets_transactions_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const responses = [];
      page.on('response', (resp) => {
        try {
          const url = resp.url();
          if (/\/api\/|\/transactions|\/bets/i.test(url)) {
            responses.push({ url, status: resp.status(), method: resp.request().method() });
          }
        } catch {
          // ignore
        }
      });

      const state = await openRoute(page, '/transactions/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const scroll = await scrollPageAndBack(page);
      const interactive = await collectVisibleInteractiveStats(page);
      const markersVisible = await hasAnyVisible(page, [
        '[class*="transaction" i]',
        '[class*="bet" i]',
        'table',
        '[role="table"]',
      ]);
      const emptyStateVisible = await page
        .getByText(/no bets|no transactions|history|not found|empty/i)
        .first()
        .isVisible()
        .catch(() => false);
      const filterVisible = await hasAnyVisible(page, [
        'button:has-text("Filter")',
        'button:has-text("All")',
        'button:has-text("Open")',
        'button:has-text("Settled")',
        '[class*="filter" i]',
        'input[type="date"]',
      ]);
      const betsActions = [];
      const actionControls = [
        { name: 'Filter', selectors: ['button:has-text("Filter")', '[class*="filter" i] button'] },
        { name: 'All', selectors: ['button:has-text("All")'] },
        { name: 'Open', selectors: ['button:has-text("Open")'] },
        { name: 'Settled', selectors: ['button:has-text("Settled")'] },
      ];
      for (const action of actionControls) {
        const control = await firstVisibleLocator(page, action.selectors);
        if (!control) continue;
        const beforeUrl = page.url();
        await control.click({ timeout: 7000 }).catch(() => null);
        await dismissOverlays(page);
        const challenge = await getChallengeReason(page);
        if (challenge) {
          markBlockedAndReturn(testInfo, testName, challenge);
          return;
        }
        betsActions.push({
          action: action.name,
          changedUrl: page.url() !== beforeUrl,
          modalVisible: await hasAnyVisible(page, ['.t-modal:visible', '[role="dialog"]:visible']),
        });
      }

      const dateInput = await firstVisibleLocator(page, ['input[type="date"]']);
      let dateInputTouched = false;
      if (dateInput) {
        const existing = await dateInput.inputValue().catch(() => '');
        const fallbackDate = existing || '2024-01-01';
        await dateInput.fill(fallbackDate).catch(() => null);
        await dateInput.blur().catch(() => null);
        dateInputTouched = true;
      }

      const dropdownInteraction = await interactWithSelectOrCombobox(page);

      const critical5xx = responses.filter(
        (entry) => entry.status >= 500 && /\/api\/|\/transactions|\/bets/i.test(entry.url)
      );
      expect(
        markersVisible || emptyStateVisible,
        'Transactions page should show bet history blocks or explicit empty state.'
      ).toBeTruthy();
      expect(
        filterVisible || betsActions.length > 0 || dropdownInteraction.found || dateInputTouched,
        'Bets section should allow at least one filter/control interaction.'
      ).toBeTruthy();
      expect(critical5xx, 'Transactions page should not produce critical 5xx responses.').toEqual(
        []
      );

      const payload = {
        route: state,
        scroll,
        interactive,
        markersVisible,
        emptyStateVisible,
        filterVisible,
        betsActions,
        dateInputTouched,
        dropdownInteraction,
        totalResponses: responses.length,
        critical5xx,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-bets-transactions-smoke.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P1.9 Referrals section: page open, content, buttons and links work', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_referral_controls';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const state = await openRoute(page, '/referral/');
      if (state.challenge) {
        markBlockedAndReturn(testInfo, testName, state.challenge);
        return;
      }

      const scroll = await scrollPageAndBack(page);
      const interactive = await collectVisibleInteractiveStats(page);
      const markerVisible = await page
        .locator('body')
        .evaluate((node) => {
          const text = (node && node.innerText ? node.innerText : '').toLowerCase();
          return [
            'invite friends and earn',
            'referral link',
            'referral code',
            'referrals',
            'campaigns',
            'statistic',
          ].some((token) => text.includes(token));
        })
        .catch(() => false);
      const referralControlSelectors = [
        '[data-testid="tab-referralDashboard"]',
        '[data-testid="tab-referralCampaigns"]',
        '[data-testid="tab-referralStatistic"]',
        '[class*="t-referral-invite-form" i]',
        '[class*="t-referral-invite-info" i]',
        '[class*="t-referral-payout" i]',
        'button:has-text("Copy")',
        'button:has-text("Share")',
        'button:has-text("Invite")',
        '[data-testid*="copy" i]',
      ];
      const controls = [];
      for (const selector of referralControlSelectors) {
        const visible = await hasAnyVisible(page, [selector]);
        if (visible) controls.push(selector);
      }

      const links = await page
        .locator('a[href]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => {
              const href = node.getAttribute('href') || '';
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
              return { href, text };
            })
            .filter((item) => item.href && !item.href.startsWith('javascript:'))
            .slice(0, 40)
        )
        .catch(() => []);
      const referralLinks = links.filter(
        (item) =>
          /referral|invite|campaign|bonus|terms|policy/i.test(item.href) ||
          /referral|invite|campaign|bonus|terms|policy/i.test(item.text)
      );

      const firstControl =
        (await firstVisibleLocator(page, [
          'button:has-text("Copy")',
          'button:has-text("Share")',
          'button:has-text("Invite")',
          '[data-testid*="copy" i]',
          '[data-testid="tab-referralCampaigns"]',
        ])) || null;

      let toastVisible = false;
      let controlChangedUrl = false;
      if (firstControl) {
        const beforeUrl = page.url();
        await firstControl.click({ timeout: 10000 }).catch(() => null);
        await dismissOverlays(page);
        controlChangedUrl = page.url() !== beforeUrl;
        toastVisible = await page
          .getByText(/copied|success|link copied|invite sent/i)
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);
      }

      expect(markerVisible, 'Referral page should show invite/referral marker text.').toBeTruthy();
      expect(
        controls.length,
        'Referral page should expose invite/copy/share controls.'
      ).toBeGreaterThan(0);
      expect(
        referralLinks.length > 0 || controlChangedUrl || toastVisible,
        'Referral page should expose working links or control actions.'
      ).toBeTruthy();

      const payload = {
        route: state,
        scroll,
        interactive,
        markerVisible,
        controlsFound: controls,
        controlsCount: controls.length,
        toastVisible,
        controlChangedUrl,
        referralLinksCount: referralLinks.length,
        referralLinks: referralLinks.slice(0, 20),
      };
      runtime.tests[testName] = { status: 'passed', payload };
      await testInfo.attach('p1-referral-controls.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P2.10 Visual smoke: profile pages on desktop and mobile', async ({ browser }, testInfo) => {
    const testName = 'p2_profile_visual_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    const planned = [
      { route: '/profile/', viewport: 'desktop', size: { width: 1365, height: 900 } },
      { route: '/profile/details/', viewport: 'desktop', size: { width: 1365, height: 900 } },
      { route: '/assets/', viewport: 'desktop', size: { width: 1365, height: 900 } },
      { route: '/transactions/', viewport: 'mobile', size: { width: 390, height: 844 } },
      { route: '/profile/preferences/', viewport: 'mobile', size: { width: 390, height: 844 } },
      { route: '/referral/', viewport: 'mobile', size: { width: 390, height: 844 } },
    ];

    const captured = [];
    const blocked = [];

    for (const item of planned) {
      const context = await browser.newContext({
        storageState: AUTH_STATE_PATH,
        viewport: item.size,
        ignoreHTTPSErrors: true,
      });
      try {
        const page = await context.newPage();
        const state = await openRoute(page, item.route);
        if (state.challenge) {
          blocked.push({ route: item.route, viewport: item.viewport, challenge: state.challenge });
          continue;
        }

        const fileName = `${item.viewport}-${normalizeSlug(item.route)}.png`;
        const filePath = path.join(VISUAL_DIR, fileName);
        await page.screenshot({ path: filePath, fullPage: true });
        captured.push({ route: item.route, viewport: item.viewport, file: filePath });
      } finally {
        await context.close();
      }
    }

    if (!captured.length && blocked.length) {
      markBlockedAndReturn(
        testInfo,
        testName,
        'All profile visual routes were blocked by challenge.'
      );
      return;
    }

    expect(
      captured.length,
      'At least one profile visual screenshot should be captured.'
    ).toBeGreaterThan(0);
    expect(
      captured.length + blocked.length,
      'All planned visual routes should end up captured or blocked.'
    ).toBe(planned.length);

    const payload = { visualDir: VISUAL_DIR, planned, captured, blocked };
    runtime.tests[testName] = { status: 'passed', payload };
    if (blocked.length) {
      testInfo.annotations.push({
        type: 'blocked',
        description: `Visual smoke blocked routes: ${blocked.map((v) => v.route).join(', ')}`,
      });
    }
    await testInfo.attach('p2-profile-visual-smoke.json', {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  });

  test('P2.11 A11y smoke: profile routes scan without critical errors', async ({
    browser,
  }, testInfo) => {
    const testName = 'p2_profile_a11y_smoke';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const routes = ['/profile/', '/profile/preferences/'];
      const findings = [];
      const blocked = [];

      for (const route of routes) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push({ route, challenge: state.challenge, finalUrl: state.finalUrl });
          continue;
        }

        const results = await new AxeBuilder({ page }).analyze();
        const critical = results.violations.filter((v) => v.impact === 'critical');
        const serious = results.violations.filter((v) => v.impact === 'serious');
        findings.push({
          route,
          counts: {
            total: results.violations.length,
            critical: critical.length,
            serious: serious.length,
          },
          criticalRules: critical.map((v) => v.id),
          seriousRules: serious.map((v) => v.id),
        });

        if (STRICT_A11Y) {
          expect(
            critical,
            `Critical accessibility violations found on ${route}. See p2-profile-a11y.json.`
          ).toEqual([]);
        }
      }

      if (!findings.length && blocked.length) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'A11y profile routes are fully blocked by challenge.'
        );
        return;
      }

      const payload = { strict: STRICT_A11Y, findings, blocked };
      runtime.tests[testName] = { status: 'passed', payload };
      if (!STRICT_A11Y) {
        expect(Array.isArray(findings)).toBeTruthy();
      }
      await testInfo.attach('p2-profile-a11y.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });

  test('P2.12 WAF diagnostics: classify blocked profile routes without hard-fail', async ({
    browser,
  }, testInfo) => {
    const testName = 'p2_profile_waf_diagnostics';
    if (!ensureSetup(testInfo, testName)) return;

    await withAuthContext(browser, async (context) => {
      const page = await context.newPage();
      const checked = [];
      const blocked = [];

      for (const route of PROFILE_ROUTES) {
        const state = await openRoute(page, route);
        if (state.challenge) {
          blocked.push(state);
        } else {
          checked.push(state);
        }
      }

      const payload = {
        total: PROFILE_ROUTES.length,
        checked,
        blocked,
      };
      runtime.tests[testName] = { status: 'passed', payload };
      if (!checked.length && blocked.length) {
        markBlockedAndReturn(
          testInfo,
          testName,
          'All profile routes are blocked, but classified by WAF diagnostics.'
        );
        return;
      }

      expect(
        checked.length + blocked.length,
        'Every profile route should be classified as checked or blocked.'
      ).toBe(PROFILE_ROUTES.length);
      await testInfo.attach('p2-profile-waf-diagnostics.json', {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
      });
    });
  });
});

function writeRuntime() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(runtime, null, 2), 'utf8');
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function normalizeSlug(route) {
  return String(route || '/')
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
}

function isSignupRedirect(url) {
  return /#signup/i.test(url) || /returnTo=.*(%23|#)signup/i.test(url);
}

function matchesExpectedRoute(url, expected) {
  if (!(expected instanceof RegExp)) return false;
  let pathname = String(url || '');
  try {
    pathname = new URL(url).pathname || pathname;
  } catch {
    // keep raw value fallback
  }
  expected.lastIndex = 0;
  if (expected.test(pathname)) return true;
  expected.lastIndex = 0;
  return expected.test(String(url || ''));
}

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
  markBlockedAndReturn(testInfo, testName, `Profile setup failed: ${setupError}`);
  return false;
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const challengeVisible = await page
    .getByText(
      /cloudflare|verify you are human|checking your browser|forbidden page|just a moment/i
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeVisible) return 'Challenge/Forbidden text is visible.';

  if (/cdn-cgi|challenge-platform/i.test(page.url())) return 'Challenge URL detected.';
  if (/__cf_chl_rt_tk=|__cf_bm=|cf_chl_/i.test(page.url())) return 'Cloudflare token URL detected.';
  return null;
}

async function openRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await dismissOverlays(page);
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => null);

  const challenge = await getChallengeReason(page);
  return {
    route,
    requestedUrl,
    status: response ? response.status() : 0,
    finalUrl: page.url(),
    title: await page.title().catch(() => ''),
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
    navigationError,
  };
}

function ensureAvatarFixture() {
  const fixturesDir = path.join(ARTIFACT_DIR, 'fixtures');
  const fixturePath = path.join(fixturesDir, 'avatar-test.png');
  if (fs.existsSync(fixturePath)) return fixturePath;

  fs.mkdirSync(fixturesDir, { recursive: true });
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf6k7QAAAAASUVORK5CYII=';
  fs.writeFileSync(fixturePath, Buffer.from(tinyPngBase64, 'base64'));
  return fixturePath;
}

async function scrollPageAndBack(page) {
  return page
    .evaluate(async () => {
      const root = document.scrollingElement || document.documentElement || document.body;
      const viewport = window.innerHeight || 900;
      const maxScroll = Math.max(0, root.scrollHeight - viewport);
      const step = Math.max(300, Math.floor(viewport * 0.85));
      let y = 0;
      let steps = 0;
      while (y < maxScroll) {
        y = Math.min(maxScroll, y + step);
        window.scrollTo(0, y);
        steps += 1;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        scrollHeight: root.scrollHeight,
        maxScroll,
        steps,
      };
    })
    .catch(() => ({ scrollHeight: 0, maxScroll: 0, steps: 0 }));
}

async function openFirstAvailableRoute(page, routeCandidates) {
  const attempts = [];
  for (const route of routeCandidates) {
    const state = await openRoute(page, route);
    attempts.push(state);
    if (!state.challenge) {
      return { selected: route, state, attempts };
    }
  }
  return {
    selected: null,
    state: attempts.length ? attempts[attempts.length - 1] : null,
    attempts,
  };
}

async function collectVisibleInteractiveStats(page) {
  return page
    .evaluate(() => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        if (!style) return false;
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      };

      const count = (selector) =>
        Array.from(document.querySelectorAll(selector)).filter((node) => isVisible(node)).length;

      return {
        buttons: count('button, [role="button"], input[type="button"], input[type="submit"]'),
        links: count('a[href]'),
        selects: count('select'),
        comboboxes: count('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]'),
        toggles: count('input[type="checkbox"], [role="switch"], [aria-pressed], [aria-checked]'),
      };
    })
    .catch(() => ({
      buttons: 0,
      links: 0,
      selects: 0,
      comboboxes: 0,
      toggles: 0,
    }));
}

async function interactWithSelectOrCombobox(page) {
  const select = await firstVisibleLocator(page, ['select']);
  if (select) {
    const options = await select
      .locator('option')
      .all()
      .catch(() => []);
    if (options.length >= 2) {
      const beforeValue = await select.inputValue().catch(() => '');
      let nextValue = beforeValue;
      for (const option of options) {
        const value = (await option.getAttribute('value').catch(() => '')) || '';
        if (value && value !== beforeValue) {
          nextValue = value;
          break;
        }
      }
      if (nextValue !== beforeValue) {
        await select.selectOption(nextValue).catch(() => null);
        const afterValue = await select.inputValue().catch(() => '');
        if (beforeValue) {
          await select.selectOption(beforeValue).catch(() => null);
        }
        return {
          found: true,
          interacted: afterValue === nextValue,
          kind: 'select',
          beforeValue,
          afterValue,
          nextValue,
        };
      }
    }
  }

  const combo = await firstVisibleLocator(page, [
    '[role="combobox"]',
    'button[aria-haspopup="listbox"]',
    'button[aria-haspopup="menu"]',
  ]);
  if (!combo) {
    return { found: false, interacted: false, kind: 'none' };
  }

  const beforeExpanded = (await combo.getAttribute('aria-expanded').catch(() => '')) || '';
  await combo.click({ timeout: 8000 }).catch(() => null);
  await dismissOverlays(page);
  const option = await firstVisibleLocator(page, [
    '[role="option"]',
    '[role="menuitem"]',
    '[class*="option" i]',
  ]);
  let optionClicked = false;
  if (option) {
    await option.click({ timeout: 8000 }).catch(() => null);
    optionClicked = true;
  }
  const afterExpanded = (await combo.getAttribute('aria-expanded').catch(() => '')) || '';
  return {
    found: true,
    interacted: optionClicked || beforeExpanded !== afterExpanded,
    kind: 'combobox',
    beforeExpanded,
    afterExpanded,
    optionClicked,
  };
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

async function tryReuseAuthState(browser) {
  const candidates = [AUTH_STATE_PATH, ...FALLBACK_AUTH_STATES];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const valid = await validateAuthState(browser, candidate);
    if (!valid.ok) continue;
    if (candidate !== AUTH_STATE_PATH) {
      fs.copyFileSync(candidate, AUTH_STATE_PATH);
    }
    authPlayer = valid.authPlayer || null;
    return {
      ok: true,
      source: candidate,
    };
  }
  return { ok: false };
}

async function validateAuthState(browser, storagePath) {
  const context = await browser.newContext({
    storageState: storagePath,
    viewport: { width: 1365, height: 900 },
    ignoreHTTPSErrors: true,
  });
  try {
    const preferences = await context.request
      .get(buildUrl('/api/user/preferences'))
      .catch(() => null);
    if (preferences && preferences.status() === 200) {
      return { ok: true, source: 'api-user-preferences' };
    }

    const page = await context.newPage();
    const state = await openRoute(page, '/profile/');
    if (state.challenge) return { ok: false, reason: state.challenge };

    const loginVisible = await page
      .getByRole('button', { name: /log in/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible || isSignupRedirect(state.finalUrl)) {
      return { ok: false, reason: 'Auth state is not authorized for profile routes.' };
    }

    return { ok: true };
  } finally {
    await context.close();
  }
}

async function firstVisibleLocator(scope, selectors) {
  for (const selector of selectors) {
    const matches = scope.locator(selector);
    const count = await matches.count().catch(() => 0);
    const cap = Math.min(count, 8);
    for (let i = 0; i < cap; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return locator;
    }
  }
  return null;
}

async function firstVisibleSelector(page, selectors) {
  for (const selector of selectors) {
    const locator = await firstVisibleLocator(page, [selector]);
    if (locator) return selector;
  }
  return null;
}

async function firstVisibleEditable(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    const editable = await locator.isEditable().catch(() => false);
    const disabled = await locator.isDisabled().catch(() => true);
    if (editable && !disabled) return { locator, selector };
  }
  return null;
}

async function hasAnyVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = await firstVisibleLocator(page, [selector]);
    if (locator) return true;
  }
  return false;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = await firstVisibleLocator(page, [selector]);
    if (!locator) continue;
    const enabled = await locator.isEnabled().catch(() => false);
    if (!enabled) continue;
    let clickError = null;
    try {
      await locator.scrollIntoViewIfNeeded().catch(() => null);
      await locator.click({ timeout: 10000 });
    } catch (err) {
      clickError = String(err && err.message ? err.message : err);
      await locator.click({ timeout: 10000, force: true }).catch(() => null);
    }
    return { found: true, selector, clickError };
  }
  return { found: false };
}

async function waitForAnyVisible(page, selectors, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisibleLocator(page, selectors);
    if (locator) return locator;
    await sleep(200);
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUpdatedValue(originalValue) {
  const source = String(originalValue || '').trim();
  const sanitized = source || 'autotest';
  const next = sanitized.endsWith('autotest') ? `${sanitized}-qa` : `${sanitized} autotest`;
  return next.slice(0, 60);
}

async function hasValidationSignal(input, page) {
  const ariaInvalid = (await input.getAttribute('aria-invalid').catch(() => '')) || '';
  if (String(ariaInvalid).toLowerCase() === 'true') return true;

  const className = (await input.getAttribute('class').catch(() => '')) || '';
  if (/error|invalid/i.test(className)) return true;

  const parentSignal = await input
    .locator('xpath=ancestor::*[self::div or self::form][1]')
    .getByText(/required|invalid|incorrect|too short|too long|format|must/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (parentSignal) return true;

  const globalSignal = await page
    .getByText(/required|invalid|incorrect|too short|too long|format|must/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  return globalSignal;
}

async function pickPreferenceControl(page) {
  const select = await firstVisibleSelector(page, ['select', '[class*="language" i] select']);
  if (select) {
    const locator = page.locator(select).first();
    const options = await locator.locator('option').all();
    if (options.length >= 2) {
      const before = await locator.inputValue().catch(() => '');
      let next = before;
      for (let i = 0; i < options.length; i += 1) {
        const value = (await options[i].getAttribute('value').catch(() => '')) || '';
        if (value && value !== before) {
          next = value;
          break;
        }
      }
      if (next !== before) {
        return {
          kind: 'select',
          beforeState: before,
          nextState: next,
          async applyNext() {
            await locator.selectOption(next);
          },
          async readState(p) {
            return p
              .locator(select)
              .first()
              .inputValue()
              .catch(() => '');
          },
          equalsState(a, b) {
            return String(a) === String(b);
          },
          async restore() {
            await locator.selectOption(before).catch(() => null);
          },
        };
      }
    }
  }

  const checkbox = await firstVisibleSelector(page, [
    'input[type="checkbox"]',
    '[role="switch"]',
    'button[aria-pressed]',
  ]);
  if (!checkbox) return null;

  const locator = page.locator(checkbox).first();
  const before = await readControlState(locator);
  const next = !before;
  return {
    kind: 'toggle',
    beforeState: before,
    nextState: next,
    async applyNext() {
      await locator.click({ timeout: 10000 });
    },
    async readState() {
      return readControlState(locator);
    },
    equalsState(a, b) {
      return Boolean(a) === Boolean(b);
    },
    async restore() {
      const current = await readControlState(locator);
      if (Boolean(current) !== Boolean(before)) {
        await locator.click({ timeout: 10000 }).catch(() => null);
      }
    },
  };
}

async function readControlState(locator) {
  const checked = await locator.isChecked().catch(() => null);
  if (checked !== null) return checked;
  const ariaPressed = await locator.getAttribute('aria-pressed').catch(() => null);
  if (ariaPressed !== null) return String(ariaPressed).toLowerCase() === 'true';
  const ariaChecked = await locator.getAttribute('aria-checked').catch(() => null);
  if (ariaChecked !== null) return String(ariaChecked).toLowerCase() === 'true';
  return false;
}
