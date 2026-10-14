const { test, expect } = require('../fixtures/qa-test');
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  closeModal,
  maybeSkipWaf,
  openSignupModal,
  waitForHomeContent,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

test('Full check: core homepage flow is healthy', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const wafProbe = createWafProbe(page);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  }

  if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

  await test.step('Core UI is visible', async () => {
    await expect(page.locator('body')).toBeVisible();
    await expect(
      page
        .locator(
          '[data-testid="signup-button"], button:has-text("Sign Up"), button:has-text("Sign up")'
        )
        .first()
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="login-button"], button:has-text("Log In")').first()
    ).toBeVisible();

    const sidebar = page.locator('[data-testid="sidebar-aside"], .t-sidebar-menu').first();
    await expect(sidebar).toBeVisible();

    const gameLinks = page.locator('a.t-game-play__link-demo, a[href^="/casino/"]');
    expect(await gameLinks.count()).toBeGreaterThanOrEqual(1);
  });

  await test.step('Signup modal opens and closes', async () => {
    const modal = await openSignupModal(page, { retryOnError: false, attempts: 2 });
    await expect(modal).toBeVisible({ timeout: 15000 });
    await closeModal(modal, page);
    await expect(modal).toBeHidden({ timeout: 15000 });
  });

  await test.step('Primary navigation has links', async () => {
    const navLinks = page.locator(
      '[data-testid^="sidebar-"][data-testid$="-button"], .t-sidebar-menu a[href]'
    );
    expect(await navLinks.count()).toBeGreaterThanOrEqual(3);
  });
});
