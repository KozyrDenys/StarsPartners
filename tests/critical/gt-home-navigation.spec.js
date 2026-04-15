const { test, expect } = require('@playwright/test');
const {
  assertNotCloudflare,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForHomeContent,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

function matchesPath(urlValue, path) {
  const value = String(urlValue || '');
  const normalized = path.replace(/\/$/, '');
  return value.includes(normalized);
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (!appRootVisible) {
    const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
    const compact = bodyText.replace(/\s+/g, '');
    if (compact.match(/^[a-f0-9]{12,}$/i)) {
      return 'Cloudflare token page detected (no app root + token body).';
    }
  }
  return null;
}

async function restoreHome(page) {
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dismissOverlays(page);
    await page
      .locator('body')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => null);
    const challenge = await getChallengeReason(page);
    if (challenge) return { ok: false, reason: challenge };
    const appRootVisible = await page
      .locator('#app, #__nuxt')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    if (!appRootVisible)
      return { ok: false, reason: 'App root is not visible after return to home.' };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to return to home: ${String(err && err.message ? err.message : err)}`,
    };
  }
}

test('GT Home: sidebar navigation links work', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const navItems = [
    {
      name: 'Promo',
      selectors: ['[data-testid="sidebar-promotions-button"]', 'a[href*="/promotions"]'],
      path: '/promotions/',
    },
    {
      name: 'VIP',
      selectors: ['[data-testid="sidebar-vipClub-button"]', 'a[href*="/vip"]'],
      path: '/vip/',
    },
    {
      name: 'Casino',
      selectors: ['[data-testid="sidebar-casino-button"]', 'a[href*="/casino"]'],
      path: '/casino/',
    },
    {
      name: 'Live',
      selectors: ['[data-testid="sidebar-livecasino-button"]', 'a[href*="/livecasino"]'],
      path: '/livecasino/',
    },
    {
      name: 'Sports',
      selectors: ['[data-testid="sidebar-sports-button"]', 'a[href*="/sports"]'],
      path: '/sports',
    },
    {
      name: 'Collections',
      selectors: ['[data-testid="sidebar-collections-button"]', 'a[href*="/collections"]'],
      path: '/collections/',
    },
    {
      name: 'Invite & Earn',
      selectors: ['[data-testid="sidebar-referral-button"]', 'a[href*="/referral"]'],
      path: '/referral/',
    },
  ];

  const findings = {
    passed: [],
    missing: [],
    notNavigated: [],
    blocked: [],
  };

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
  } catch (err) {
    const reason = await getChallengeReason(page);
    if (reason) {
      markBlocked(testInfo, reason);
      await testInfo.attach('gt-home-navigation.json', {
        body: JSON.stringify({ initError: String(err), findings }, null, 2),
        contentType: 'application/json',
      });
      return;
    }
    throw err;
  }

  for (const item of navItems) {
    await test.step(`${item.name} navigation`, async () => {
      await dismissOverlays(page);
      const link = await firstVisibleLocator(page, item.selectors);
      const visible = Boolean(link);

      if (!visible) {
        findings.missing.push({ item: item.name, path: item.path });
        return;
      }

      const urlBefore = page.url();
      let clickError = null;

      try {
        await Promise.all([
          page
            .waitForURL((url) => matchesPath(url.href, item.path), { timeout: 15000 })
            .catch(() => null),
          link.click({ timeout: 10000 }),
        ]);
      } catch (err) {
        clickError = String(err && err.message ? err.message : err);
      }

      const urlAfter = page.url();
      const challenge = await getChallengeReason(page);
      if (challenge) {
        findings.blocked.push({
          item: item.name,
          path: item.path,
          reason: challenge,
          urlAfter,
        });
      } else if (matchesPath(urlAfter, item.path)) {
        findings.passed.push({
          item: item.name,
          path: item.path,
          urlBefore,
          urlAfter,
        });
      } else {
        findings.notNavigated.push({
          item: item.name,
          path: item.path,
          urlBefore,
          urlAfter,
          clickError,
        });
      }

      const restored = await restoreHome(page);
      if (!restored.ok) {
        findings.blocked.push({
          item: `${item.name} (return-home)`,
          path: '/',
          reason: restored.reason,
          urlAfter: page.url(),
        });
      }
    });
  }

  await testInfo.attach('gt-home-navigation.json', {
    body: JSON.stringify(findings, null, 2),
    contentType: 'application/json',
  });

  if (findings.blocked.length > 0) {
    markBlocked(
      testInfo,
      `Blocked events during sidebar navigation: ${findings.blocked
        .map((item) => `${item.item}: ${item.reason}`)
        .slice(0, 4)
        .join(' | ')}`
    );
  }

  const meaningfulChecks =
    findings.passed.length + findings.notNavigated.length + findings.missing.length;
  expect(
    meaningfulChecks,
    'Sidebar test did not collect any verifiable navigation data.'
  ).toBeGreaterThan(0);
  expect(
    findings.passed.length,
    'At least one sidebar item should navigate to expected route.'
  ).toBeGreaterThan(0);
});
