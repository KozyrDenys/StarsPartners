const { test, expect } = require('@playwright/test');

test.describe('Base URL generated smoke', () => {
  test('Page title is non-empty', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/.+/);
  });

  test('Body is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });

  test('At least one link exists', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href]').first()).toBeVisible();
  });
});
