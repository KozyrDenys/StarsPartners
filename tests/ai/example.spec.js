const { test, expect } = require('@playwright/test');

test.describe('Base URL smoke', () => {
  test('should have non-empty title', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/.+/);
  });

  test('should have visible content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have at least one link', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href]').first()).toBeVisible();
  });
});
