const { test, expect } = require('@playwright/test');
const { detectCloudflare, dismissOverlays } = require('../helpers/gt-utils');

async function skipIfBlocked(page, testInfo) {
  const reason = await detectCloudflare(page).catch(() => null);
  if (!reason) return false;
  testInfo.skip(true, reason);
  return true;
}

test.describe('AI P2 smoke', () => {
  test('desktop and mobile home render without fatal UI loss', async ({ browser }, testInfo) => {
    const desktop = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const states = [];

    try {
      for (const [label, context] of [
        ['desktop', desktop],
        ['mobile', mobile],
      ]) {
        const page = await context.newPage();
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const blocked = await detectCloudflare(page).catch(() => null);
        if (blocked) {
          states.push({ label, blocked });
          continue;
        }

        await dismissOverlays(page);
        await expect(page.locator('body')).toBeVisible();
        const hasSidebar = await page
          .locator('[data-testid="sidebar-aside"], .t-sidebar-menu')
          .first()
          .isVisible()
          .catch(() => false);
        const hasMainLink = await page.locator('a[href]').first().isVisible().catch(() => false);
        states.push({ label, blocked: null, hasSidebar, hasMainLink });
      }
    } finally {
      await desktop.close();
      await mobile.close();
    }

    if (states.every((state) => state.blocked)) {
      testInfo.skip(true, states.map((state) => state.blocked).join(' | '));
      return;
    }

    const healthy = states.filter((state) => !state.blocked && (state.hasSidebar || state.hasMainLink));
    expect(healthy.length).toBeGreaterThan(0);
  });
});
