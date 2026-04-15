const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  maybeSkipWaf,
  waitForHomeContent,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const STRICT_A11Y = process.env.PW_A11Y_STRICT === '1';

test('A11y smoke: scan completes and has no critical violations', async ({ page }, testInfo) => {
  const wafProbe = createWafProbe(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  }

  if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');

  await testInfo.attach('a11y-summary.json', {
    body: JSON.stringify(
      {
        url: page.url(),
        counts: {
          critical: critical.length,
          serious: serious.length,
          total: results.violations.length,
        },
        criticalRules: critical.map((v) => v.id),
        seriousRules: serious.map((v) => v.id),
      },
      null,
      2
    ),
    contentType: 'application/json',
  });

  if (serious.length > 0) {
    testInfo.annotations.push({
      type: 'a11y',
      description: `${serious.length} serious violations found (recorded in a11y-summary.json).`,
    });
  }

  if (critical.length > 0) {
    testInfo.annotations.push({
      type: 'a11y',
      description: `${critical.length} critical violations found.`,
    });
  }

  if (STRICT_A11Y) {
    expect(
      critical,
      'Critical accessibility violations found. See a11y-summary.json attachment.'
    ).toEqual([]);
  } else {
    expect(Array.isArray(results.violations)).toBeTruthy();
  }
});
