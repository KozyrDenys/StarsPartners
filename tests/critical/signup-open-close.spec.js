const { test, expect } = require('@playwright/test');
const {
  openSignupModal,
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  maybeSkipWaf,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

test('Sign Up modal opens and closes', async ({ page }, testInfo) => {
  const wafProbe = createWafProbe(page);
  await page.setViewportSize({ width: 1365, height: 900 });
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
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  }

  if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

  const modal = page.locator('.t-signup-modal, [data-testid="signup-modal"], .t-signup').first();

  const closeCandidates = [
    'button:has-text("Close")',
    '[aria-label="Close"]',
    '[data-testid*="close"]',
    '.t-modal__close',
    '.t-modal__close-btn',
    '.modal__close',
  ];

  let closed = false;
  for (const selector of closeCandidates) {
    const btn = modal.locator(selector).first();
    try {
      if (await btn.isVisible()) {
        await btn.click();
        closed = true;
        break;
      }
    } catch {
      // Ignore and try next selector
    }
  }

  if (!closed) {
    await page.keyboard.press('Escape');
  }

  await expect(modal).toBeHidden({ timeout: 15000 });
  await page.screenshot({
    path: test.info().outputPath('signup-closed.png'),
    fullPage: true,
  });
});
