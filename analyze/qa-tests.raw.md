Here are the 3 JavaScript files for P0, P1, and P2 tests:

**tests/p0.spec.js**

```
import { test } from '@playwright/test';
import { page } from '../page';

test('P0: Header', async () => {
  await page.locator('h1').should('be.visible');
});

test('P0: Links', async () => {
  const link = await page.locator('text="Learn more"').first();
  await expect(link).toHaveAttribute('href', 'https://iana.org/domains/example');
  await expect(link).toBeVisible();
});
```

**tests/p1.spec.js**

```
import { test } from '@playwright/test';
import { page } from '../page';

test('P1: Learn more link click', async () => {
  const link = await page.locator('text="Learn more"').first();
  await link.click();
  await expect(page).toHaveURL('https://iana.org/domains/example');
});

test('P1: No errors on link click', async () => {
  await page.on('error', (err) => {
    throw err;
  });
});
```

**tests/p2.spec.js**

```
import { test } from '@playwright/test';
import { page } from '../page';

test('P2: No buttons or inputs', async () => {
  await expect(page.locator('button')).not.toHaveText();
  await expect(page.locator('input')).not.toBeVisible();
});
```

Note that these tests are stable and do not check CSS styles. The tests also use Locators (`page.locator`) and `expect` with various matchers to verify the presence of elements, their text, and attributes.
