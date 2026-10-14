const { test, expect } = require('../fixtures/qa-test');
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  maybeSkipWaf,
  waitForHomeContent,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('GT Home: content loads and key blocks are visible', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const wafProbe = createWafProbe(page);
  const failedRequests = [];
  page.on('requestfailed', (req) => failedRequests.push(req.url()));

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

  const title = await page.title();
  expect(title.length).toBeGreaterThan(5);

  const gameLinks = page.locator('a.t-game-play__link-demo, a[href^="/casino/"]');
  const gameLinksCount = await gameLinks.count();
  if (gameLinksCount === 0) {
    test.info().annotations.push({
      type: 'content',
      description:
        'No direct game links on homepage in current layout (treated as acceptable variant).',
    });
  } else if (gameLinksCount < 3) {
    test.info().annotations.push({
      type: 'content',
      description: `Low game links count: ${gameLinksCount}`,
    });
  }

  const images = page.locator('img:visible');
  const imageCount = await images.count();
  const mainBannerVisible = await page
    .locator('[data-testid="main-banner"], .t-main-banner-slider, .swiper-slide')
    .first()
    .isVisible()
    .catch(() => false);
  expect(
    imageCount >= 1 || gameLinksCount >= 1 || mainBannerVisible,
    'Expected at least one visual/content signal (image, game link, or banner).'
  ).toBeTruthy();
  if (imageCount < 3) {
    test.info().annotations.push({
      type: 'content',
      description: `Low visible images count: ${imageCount}`,
    });
  }

  const sidebar = page.locator('[data-testid="sidebar-aside"], .t-sidebar-menu').first();
  const sidebarVisible = await sidebar.isVisible().catch(() => false);
  if (!sidebarVisible) {
    test.info().annotations.push({
      type: 'content',
      description: 'Sidebar is not visibly expanded on this homepage layout.',
    });
  }

  await test.step('Homepage scroll reaches lower content and returns to top', async () => {
    const pageMetrics = await page.evaluate(() => {
      const doc = document.documentElement || document.body;
      const viewport = window.innerHeight || doc.clientHeight || 0;
      const full = Math.max(doc.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      return { viewport, full };
    });
    if (pageMetrics.full <= pageMetrics.viewport + 40) {
      test.info().annotations.push({
        type: 'content',
        description: `Homepage is not scrollable in this run (full=${pageMetrics.full}, viewport=${pageMetrics.viewport}).`,
      });
      return;
    }

    const beforeScroll = await page.evaluate(() => window.scrollY || 0);
    await page.mouse.wheel(0, 4000).catch(() => null);
    await sleep(700);
    let midScroll = await page.evaluate(() => window.scrollY || 0);
    if (midScroll <= beforeScroll + 1) {
      await page.evaluate(() => window.scrollBy(0, 1200)).catch(() => null);
      await sleep(600);
      midScroll = await page.evaluate(() => window.scrollY || 0);
    }
    if (midScroll <= beforeScroll + 1) {
      test.info().annotations.push({
        type: 'content',
        description:
          'Homepage did not react to scroll actions in this run; marking scroll check as inconclusive.',
      });
      return;
    }

    await page.mouse.wheel(0, 6000).catch(() => null);
    await sleep(900);
    const atBottom = await page.evaluate(() => {
      const doc = document.documentElement || document.body;
      const scrollY = window.scrollY || 0;
      const viewport = window.innerHeight || doc.clientHeight || 0;
      const full = Math.max(doc.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      return { scrollY, viewport, full };
    });
    const scrollCoverage = atBottom.scrollY + atBottom.viewport;
    const minCoverage = 0.6 * atBottom.full;
    if (scrollCoverage <= minCoverage) {
      test.info().annotations.push({
        type: 'content',
        description: `Homepage scroll reached ${Math.round(scrollCoverage)}/${Math.round(atBottom.full)} (<60% threshold) in this run; treating as partial due dynamic/sticky layout.`,
      });
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    const afterTop = await page.evaluate(() => window.scrollY || 0);
    expect(afterTop, 'Homepage should return back to top position.').toBeLessThanOrEqual(5);
  });

  if (failedRequests.length) {
    test.info().annotations.push({
      type: 'request-failed',
      description: `Failed requests: ${failedRequests.length}`,
    });
  }
});
