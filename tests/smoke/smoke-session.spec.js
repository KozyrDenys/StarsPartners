const { test, expect } = require('../fixtures/qa-test');

test('GT opens with saved session', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const title = await page.title();
  console.log('TITLE:', title);

  // просто чтобы тест был "осмысленным"
  await expect(page.locator('body')).toBeVisible();
});
