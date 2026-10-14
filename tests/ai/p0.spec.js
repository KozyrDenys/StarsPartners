const { test, expect } = require('../fixtures/qa-test');
const { detectCloudflare, dismissOverlays } = require('../helpers/gt-utils');

async function skipIfBlocked(page, testInfo) {
  const reason = await detectCloudflare(page).catch(() => null);
  if (!reason) return false;
  testInfo.skip(true, reason);
  return true;
}

test.describe('AI P0 smoke', () => {
  test('home renders app root', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (await skipIfBlocked(page, testInfo)) return;
    await dismissOverlays(page);

    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('#app, #__nuxt').first()).toBeVisible({ timeout: 15000 });
  });

  test('title and key navigation are visible', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (await skipIfBlocked(page, testInfo)) return;
    await dismissOverlays(page);

    await expect(page).toHaveTitle(/.+/);
    await expect(
      page
        .locator(
          '[data-testid="sidebar-aside"], .t-sidebar-menu, a[href*="/casino"], a[href*="/sports"]'
        )
        .first()
    ).toBeVisible();
  });
});
