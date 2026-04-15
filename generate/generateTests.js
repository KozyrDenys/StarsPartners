// generate/generateTests.js
const fs = require('fs');

const baseUrl = process.env.BASE_URL || 'https://gt.bet/';

let testFile = `
import { test, expect } from '@playwright/test';

test.describe('Generated tests for Base URL', () => {

  test('Page title is non-empty', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/.+/);
  });

  test('Body is visible', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });

  test('At least one link exists', async ({ page }) => {
    await page.goto('${baseUrl}', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href]').first()).toBeVisible();
  });

});
`;

fs.writeFileSync('tests/ai/generated.spec.js', testFile.trim() + '\n');

console.log('✅ Tests generated: tests/ai/generated.spec.js');
