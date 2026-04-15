const { test, expect } = require('@playwright/test');
const { detectCloudflare, dismissOverlays } = require('../helpers/gt-utils');

async function skipIfBlocked(page, testInfo) {
  const reason = await detectCloudflare(page).catch(() => null);
  if (!reason) return false;
  testInfo.skip(true, reason);
  return true;
}

test.describe('AI P1 smoke', () => {
  test('auth entry points are reachable', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (await skipIfBlocked(page, testInfo)) return;
    await dismissOverlays(page);

    const signUp = page
      .locator('[data-testid="signup-button"], button:has-text("Sign Up"), button:has-text("Sign up")')
      .first();
    const login = page
      .locator('[data-testid="login-button"], button:has-text("Log In"), button:has-text("Log in")')
      .first();

    await expect(signUp.or(login).first()).toBeVisible();
  });

  test('main content has navigable links', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (await skipIfBlocked(page, testInfo)) return;
    await dismissOverlays(page);

    const links = page.locator('a[href]');
    await expect(links.first()).toBeVisible();
    expect(await links.count()).toBeGreaterThan(3);
  });
});
