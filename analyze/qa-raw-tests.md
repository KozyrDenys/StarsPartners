Here are the Playwright tests for @playwright/test:

**p0.spec.js**

```js
import { test, expect } from '@playwright/test';

test('page title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('h1')).toHaveText('Example Domain');
});

test('header title', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('h1')).toBeVisible();
});

test('learn more link', async ({ page }) => {
  await page.goto('https://example.com');
  const learnMoreLink = page.locator('a[href="https://iana.org/domains/example"]');
  await expect(learnMoreLink).toBeVisible();
});
```

**p1.spec.js**

```js
import { test, expect } from '@playwright/test';

test('no buttons', async ({ page }) => {
  await page.goto('https://example.com');
  const buttons = page.locator('button');
  await expect(buttons).toHaveCount(0);
});

test('no inputs', async ({ page }) => {
  await page.goto('https://example.com');
  const inputs = page.locator('input');
  await expect(inputs).toHaveCount(0);
});

test('no forms', async ({ page }) => {
  await page.goto('https://example.com');
  const forms = page.locator('form');
  await expect(forms).toHaveCount(0);
});
```

**p2.spec.js**

```js
import { test, expect } from '@playwright/test';

test('learn more link click', async ({ page }) => {
  await page.goto('https://example.com');
  const learnMoreLink = page.locator('a[href="https://iana.org/domains/example"]');
  await learnMoreLink.click();
  // TODO: verify that the correct page is opened
});

test('other elements', async ({ page }) => {
  await page.goto('https://example.com');
  // TODO: add more tests for other elements (e.g. images)
});
```
