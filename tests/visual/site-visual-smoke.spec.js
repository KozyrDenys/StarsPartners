const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures/qa-test');
const {
  assertNotCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet';
const VISUAL_REGRESSION = process.env.PW_VISUAL_REGRESSION === '1';
const VISUAL_BASELINE_TAG = (() => {
  const projectMatrix = String(process.env.PW_PROJECT_MATRIX || 'desktop')
    .trim()
    .toLowerCase();
  const defaultTag = (() => {
    try {
      return `${new URL(BASE_URL).hostname}-${projectMatrix}`;
    } catch {
      return `brand-${projectMatrix}`;
    }
  })();
  const raw = String(process.env.PW_VISUAL_BASELINE_TAG || defaultTag)
    .trim()
    .toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
})();
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'visual');

const ROUTES = [
  { slug: 'home', route: '/' },
  { slug: 'casino', route: '/casino/' },
  { slug: 'live-casino', route: '/live-casino/' },
  { slug: 'sports', route: '/sports/' },
];

function buildUrl(route) {
  return new URL(route, BASE_URL).toString();
}

test.describe('Visual smoke: capture + optional snapshot assertions', () => {
  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  for (const item of ROUTES) {
    test(`Visual route ${item.slug}: page loads and screenshot is captured`, async ({
      page,
    }, testInfo) => {
      await page.goto(buildUrl(item.route), { waitUntil: 'domcontentloaded', timeout: 60_000 });

      try {
        await assertNotCloudflare(page);
      } catch (err) {
        markBlocked(testInfo, err instanceof Error ? err.message : 'Cloudflare/WAF detected.');
        return;
      }

      await dismissOverlays(page);
      await waitForUiSettled(page, 1200);

      const appRoot = page.locator('#app, #__nuxt').first();
      const appVisible = await appRoot.isVisible().catch(() => false);
      if (!appVisible) {
        markBlocked(testInfo, 'App root is not visible.');
        return;
      }

      const screenshotPath = path.join(ARTIFACT_DIR, `visual-${item.slug}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await testInfo.attach(`visual-${item.slug}.png`, {
        path: screenshotPath,
        contentType: 'image/png',
      });

      const imageSize = fs.statSync(screenshotPath).size;
      expect(imageSize, `Screenshot for ${item.slug} should not be empty.`).toBeGreaterThan(10_000);

      if (!VISUAL_REGRESSION) return;

      const target = page.locator('header, .t-header, main').first();
      const targetVisible = await target.isVisible().catch(() => false);
      if (!targetVisible) {
        markBlocked(testInfo, 'Visual baseline target is not visible.');
        return;
      }

      await expect(target).toHaveScreenshot(`baseline-${VISUAL_BASELINE_TAG}-${item.slug}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.35,
      });
    });
  }
});
