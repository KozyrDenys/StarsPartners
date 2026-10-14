const { test, expect } = require('../fixtures/qa-test');
const {
  openSignupModal,
  assertNotCloudflare,
  closeModal,
  createWafProbe,
  dismissOverlays,
  maybeSkipWaf,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

test('Sign Up modal opens and closes', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  const wafProbe = createWafProbe(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);

    const modal = await openSignupModal(page, { retryOnError: false, attempts: 2 });
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: test.info().outputPath('signup-open.png'),
      fullPage: true,
    });
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

    const currentModal = page
      .locator('.t-signup-modal, [data-testid="signup-modal"], .t-signup:has(input)')
      .first();
    const closed = await closeModal(currentModal, page);

    expect(
      closed,
      'Signup modal close flow did not finish, including exit confirmation.'
    ).toBeTruthy();
    await expect(currentModal).toBeHidden({ timeout: 15000 });
    await page.screenshot({
      path: test.info().outputPath('signup-closed.png'),
      fullPage: true,
    });
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  } finally {
    await context.close().catch(() => null);
  }
});
