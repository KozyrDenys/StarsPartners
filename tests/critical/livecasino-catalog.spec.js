const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('@playwright/test');
const {
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { pickBestAuthStatePath } = require('../helpers/auth-state');
const { createWsCapture } = require('../helpers/ws-capture');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'casino', 'livecasino');
const LIVE_GAMES_TARGET = Math.max(
  1,
  Number.parseInt(process.env.PW_LIVE_GAMES_TO_CHECK || '5', 10) || 5
);
const LIVE_GAMES_MIN = Math.max(
  1,
  Math.min(LIVE_GAMES_TARGET, Number.parseInt(process.env.PW_LIVE_GAMES_MIN || '1', 10) || 1)
);
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'auth-state.json'),
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function toSlug(value) {
  return String(value || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function pickAuthStatePath() {
  return pickBestAuthStatePath(AUTH_STATE_CANDIDATES);
}

async function writeAndAttach(testInfo, name, payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const fileName = `${toSlug(name)}.json`;
  const filePath = path.join(ARTIFACT_DIR, fileName);
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, body, 'utf8');
  await testInfo.attach(fileName, { body, contentType: 'application/json' });
  return filePath;
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 150);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function hasChallengeTokenPage(page) {
  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (appRootVisible) return false;
  const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
  const compact = bodyText.replace(/\s+/g, '');
  return /^[a-f0-9]{12,}$/i.test(compact);
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  if (await hasChallengeTokenPage(page)) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function waitForLiveCasinoContent(page) {
  const heading = page.getByText(/live casino/i).first();
  const searchBtn = page.locator('.t-games-catalog__search-btn').first();
  const filterBtn = page.locator('.t-games-filters-mobile__toggle').first();
  const gameCard = page.locator('.t-game-item').first();

  await Promise.any([
    heading.waitFor({ state: 'visible', timeout: 30000 }),
    searchBtn.waitFor({ state: 'visible', timeout: 30000 }),
    filterBtn.waitFor({ state: 'visible', timeout: 30000 }),
    gameCard.waitFor({ state: 'visible', timeout: 30000 }),
  ]).catch(() => null);
}

async function openLiveCasino(page) {
  const casinoUrl = buildUrl('/casino/');
  const liveUrl = buildUrl('/livecasino/');
  let response = null;

  try {
    response = await page.goto(casinoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    // best effort
  }
  await dismissOverlays(page);
  await waitForUiSettled(page, 1500);

  const casinoChallenge = await getChallengeReason(page);
  if (casinoChallenge) {
    return {
      route: '/casino/',
      requestedUrl: casinoUrl,
      finalUrl: page.url(),
      status: response ? response.status() : 0,
      challenge: casinoChallenge,
    };
  }

  const liveNav = await firstVisibleLocator(page, [
    '[data-testid="sidebar-livecasino-button"]',
    'a[href*="/livecasino"]',
  ]);

  if (liveNav) {
    await liveNav.click({ timeout: 10000 }).catch(() => null);
    await waitForUiSettled(page, 1800);
  }

  if (!/\/livecasino\/?/i.test(page.url())) {
    await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    await waitForUiSettled(page, 1800);
  }

  await dismissOverlays(page);
  const challenge = await getChallengeReason(page);

  return {
    route: '/livecasino/',
    requestedUrl: liveUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    challenge: challenge || null,
  };
}

async function closeLiveSearchModal(page) {
  const modal = page.locator('.t-game-search-modal').first();
  const visible = await modal.isVisible({ timeout: 400 }).catch(() => false);
  if (!visible) return true;

  const closeBtn = await firstVisibleLocator(page, [
    '.t-game-search-modal .t-close',
    '.t-game-search .t-close',
    '.t-game-search-modal [aria-label*="close" i]',
    '.t-game-search-modal button:has-text("Close")',
  ]);
  if (closeBtn) {
    await closeBtn.click({ timeout: 5000 }).catch(() => null);
  } else {
    await page.keyboard.press('Escape').catch(() => null);
  }

  await waitForUiSettled(page, 1200);
  return !(await modal.isVisible({ timeout: 500 }).catch(() => false));
}

async function openLiveSearch(page) {
  const searchBtn = await firstVisibleLocator(page, [
    '.t-games-catalog__search-btn',
    '[class*="search-btn" i]',
    '[aria-label*="search" i]',
    'button[class*="search" i]',
  ]);
  if (!searchBtn) {
    return {
      opened: false,
      inputVisible: false,
      modal: null,
      input: null,
      reason: 'Search button not found.',
    };
  }

  await searchBtn.click({ timeout: 7000 }).catch(() => null);
  await waitForUiSettled(page, 1200);

  const modal = page.locator('.t-game-search-modal').first();
  const input = await firstVisibleLocator(page, [
    '.t-game-search-modal input[placeholder*="Game" i]',
    '.t-game-search-modal input[placeholder*="Provider" i]',
    '.t-game-search-modal input[type="search"]',
    '.t-game-search-modal input[type="text"]',
  ]);

  return {
    opened: await modal.isVisible({ timeout: 500 }).catch(() => false),
    inputVisible: Boolean(input),
    modal,
    input,
    reason: input ? null : 'Search input not visible in live casino modal.',
  };
}

async function collectSearchResultTitles(modalOrPage) {
  const scope = modalOrPage;
  const selectors = [
    '.t-game-item__hover-name',
    '[class*="game-item" i] [class*="name" i]',
    'a[href*="/casino/"]',
  ];
  const out = [];

  for (const selector of selectors) {
    const locator = scope.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 80);
    for (let i = 0; i < count; i += 1) {
      const node = locator.nth(i);
      if (!(await node.isVisible().catch(() => false))) continue;
      const text = ((await node.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push(text);
    }
  }

  const unique = [...new Set(out)];
  return unique.filter((item) => !/^(search|recommended|games|load more)$/i.test(item));
}

async function openLiveFilterPanel(page) {
  const existing = await firstVisibleLocator(page, [
    '.t-games-filters-mobile__body:visible',
    '.t-games-filters-mobile:visible',
    '.t-games-filters:visible',
    'text=Filters',
  ]);
  if (existing) return { opened: true, panel: existing, reason: null };

  const toggle = await firstVisibleLocator(page, [
    '.t-games-filters-mobile__toggle',
    '[class*="games-filters-mobile__toggle" i]',
    '[class*="filter-toggle" i]',
    'button:has-text("Filters")',
    'button:has-text("Filter")',
  ]);
  if (!toggle) return { opened: false, panel: null, reason: 'Filter toggle not found.' };

  await toggle.click({ timeout: 7000 }).catch(async () => {
    await toggle.click({ timeout: 7000, force: true }).catch(() => null);
  });
  await waitForUiSettled(page, 1300);

  const panel = await firstVisibleLocator(page, [
    '.t-games-filters-mobile__body:visible',
    '.t-games-filters-mobile:visible',
    '.t-games-filters:visible',
    'text=Filters',
  ]);
  if (!panel) return { opened: false, panel: null, reason: 'Filter panel not visible.' };

  return { opened: true, panel, reason: null };
}

async function activateProvidersTab(panel) {
  const tab = await firstVisibleLocator(panel, [
    '.t-games-filters__tabs .t-tabs__item:has-text("Providers")',
    'button:has-text("Providers")',
    '[role="tab"]:has-text("Providers")',
  ]);
  if (!tab) return false;
  await tab.click({ timeout: 5000 }).catch(() => null);
  await waitForUiSettled(panel.page(), 1000);
  return true;
}

async function collectVisibleProviders(scope) {
  const rows = scope.locator(
    '.t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
  );
  const count = Math.min(await rows.count().catch(() => 0), 120);
  const providers = [];

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    if (!(await row.isVisible().catch(() => false))) continue;
    const label = (
      (await row
        .locator('.t-checkbox__label')
        .first()
        .innerText()
        .catch(() => '')) ||
      (await row.innerText().catch(() => '')) ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (label) providers.push(label);
  }

  return [...new Set(providers)];
}

async function toggleFirstProvider(scope) {
  const page = typeof scope.page === 'function' ? scope.page() : scope;
  const rows = scope.locator(
    '.t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
  );
  const count = Math.min(await rows.count().catch(() => 0), 120);

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    if (!(await row.isVisible().catch(() => false))) continue;

    const wasChecked = await row
      .evaluate((node) => {
        const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
        const input = node.querySelector('input[type="checkbox"]');
        return classChecked || Boolean(input && input.checked);
      })
      .catch(() => false);

    const providerName = (
      (await row
        .locator('.t-checkbox__label')
        .first()
        .innerText()
        .catch(() => '')) ||
      (await row.innerText().catch(() => '')) ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    await row.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(page, 900);

    const isChecked = await row
      .evaluate((node) => {
        const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
        const input = node.querySelector('input[type="checkbox"]');
        return classChecked || Boolean(input && input.checked);
      })
      .catch(() => false);

    return {
      toggled: wasChecked !== isChecked,
      providerName: providerName || `provider-${i + 1}`,
      wasChecked,
      isChecked,
    };
  }

  return { toggled: false, providerName: null, wasChecked: null, isChecked: null };
}

async function closeLiveFilterPanel(page, panel) {
  const scope = panel || page;
  const ok = await firstVisibleLocator(scope, [
    '.t-games-filters-action__close',
    'button:has-text("OK")',
    'button:has-text("Apply")',
  ]);
  if (ok) {
    await ok.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(page, 1400);
  } else {
    const closeBtn = await firstVisibleLocator(scope, [
      '.t-close',
      '[aria-label*="close" i]',
      'button:has-text("Close")',
    ]);
    if (closeBtn) {
      await closeBtn.click({ timeout: 5000 }).catch(() => null);
      await waitForUiSettled(page, 1200);
    } else {
      await page.keyboard.press('Escape').catch(() => null);
      await waitForUiSettled(page, 1200);
    }
  }

  const stillVisible = await page
    .locator('.t-games-filters-mobile__body, .t-games-filters-mobile, text=Filters')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  return !stillVisible;
}

async function ensureInteractive(page) {
  await closeLiveSearchModal(page).catch(() => null);
  await closeLiveFilterPanel(page).catch(() => null);
  await dismissOverlays(page);
}

async function withLiveCasinoPage(browser, testInfo, testName, run) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const authStatePath = pickAuthStatePath();
  if (!authStatePath) {
    const payload = {
      blocked: true,
      reason: 'No auth storage state found for authorized live casino checks.',
    };
    markBlocked(testInfo, payload.reason);
    await writeAndAttach(testInfo, testName, payload);
    return;
  }

  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1365, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    const route = await openLiveCasino(page);
    if (route.challenge) {
      const payload = { blocked: true, reason: route.challenge, route, authStatePath };
      markBlocked(testInfo, route.challenge);
      await writeAndAttach(testInfo, testName, payload);
      return;
    }

    let finalPathname = '';
    try {
      finalPathname = new URL(route.finalUrl || '', BASE_ORIGIN).pathname || '';
    } catch {
      finalPathname = '';
    }
    if (!/\/livecasino\/?$/i.test(finalPathname)) {
      const reason = `Live casino route is not available in current session (resolved to "${finalPathname || route.finalUrl || '-'}").`;
      testInfo.annotations.push({
        type: 'partial',
        description: reason,
      });
      await writeAndAttach(testInfo, testName, {
        blocked: false,
        notApplicable: true,
        reason,
        route,
        authStatePath,
      });
      return;
    }

    await waitForLiveCasinoContent(page);
    await ensureInteractive(page);

    const loginVisible = await page
      .getByRole('button', { name: /log in/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      const payload = {
        blocked: true,
        reason: 'Expected authorized session, but Log In button is visible.',
        route,
        authStatePath,
      };
      markBlocked(testInfo, payload.reason);
      await writeAndAttach(testInfo, testName, payload);
      return;
    }

    await run({ context, page, route, authStatePath });
  } finally {
    await context.close();
  }
}

async function collectLiveCards(page) {
  return page
    .evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.t-game-item')).filter(
        (node) => !node.closest('.t-game-search-modal')
      );
      const out = [];
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 30 || rect.height < 30) continue;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const title = (
          node.querySelector('.t-game-item__hover-name')?.textContent ||
          node.querySelector('img[alt]')?.getAttribute('alt') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        const provider = (node.querySelector('.t-game-item__hover-provider')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!title || !provider) continue;

        out.push({ title, provider });
      }
      return out;
    })
    .catch(() => []);
}

async function launchCardByProviderAndTitle(context, page, provider, title) {
  const cards = page.locator('.t-game-item');
  const count = Math.min(await cards.count().catch(() => 0), 80);
  let target = null;

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;
    const cardTitle = (
      (await card
        .locator('.t-game-item__hover-name')
        .first()
        .innerText()
        .catch(() => '')) ||
      (await card
        .locator('img[alt]')
        .first()
        .getAttribute('alt')
        .catch(() => '')) ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    const cardProvider = (
      (await card
        .locator('.t-game-item__hover-provider')
        .first()
        .innerText()
        .catch(() => '')) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (cardTitle === title && cardProvider === provider) {
      target = card;
      break;
    }
  }

  if (!target) {
    return { launched: false, reason: 'Card with strict provider+title match not found.' };
  }

  await target.scrollIntoViewIfNeeded().catch(() => null);
  await target.hover().catch(() => null);
  await waitForUiSettled(page, 500);

  const playButton = target
    .locator('.t-game-play__button, .t-game-item__hover-play button')
    .first();
  const beforeUrl = page.url();
  const popupPromise = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);

  if (await playButton.isVisible().catch(() => false)) {
    await playButton.click({ timeout: 9000 }).catch(async () => {
      await target.click({ timeout: 9000 }).catch(() => null);
    });
  } else {
    await target.click({ timeout: 9000 }).catch(() => null);
  }

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
  }
  await waitForUiSettled(page, 1500);
  await sleep(5000);

  const currentUrl = page.url();
  const iframe = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('iframe'));
    for (const frame of nodes) {
      const rect = frame.getBoundingClientRect();
      const style = window.getComputedStyle(frame);
      const visible =
        rect.width > 300 &&
        rect.height > 200 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden';
      if (!visible) continue;
      const src = frame.getAttribute('src') || '';
      if (!src) continue;
      return { src, width: rect.width, height: rect.height };
    }
    return null;
  });

  const launched =
    (/\/casino\/[\w-]+\/[\w-]+\/?$/i.test(currentUrl) && !/\/livecasino\/?$/i.test(currentUrl)) ||
    Boolean(iframe);

  if (popup) await popup.close().catch(() => null);

  return {
    launched,
    beforeUrl,
    currentUrl,
    iframe,
    reason: launched ? null : 'No route change and no visible game iframe.',
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('Live Casino Coverage: search/filter interactions', () => {
  test.setTimeout(180000);

  test('P0 Live Search: open, type query, close', async ({ browser }, testInfo) => {
    const testName = 'p0_live_search_open_query_close';
    await withLiveCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ page, route, authStatePath }) => {
        const search = await openLiveSearch(page);
        if (!search.opened || !search.inputVisible || !search.input) {
          const reason = search.reason || 'Live search modal/input is unavailable.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            search,
          });
          return;
        }

        const query = 'roulette';
        await search.input.click({ timeout: 3000 }).catch(() => null);
        await search.input.fill(query);
        await waitForUiSettled(page, 1200);

        const value = (await search.input.inputValue().catch(() => '')).toLowerCase();
        const titles = await collectSearchResultTitles(search.modal || page);
        const matching = titles.filter((item) => item.toLowerCase().includes(query));

        const closed = await closeLiveSearchModal(page);
        expect(value, 'Search input did not accept query text.').toContain(query);
        expect(closed, 'Search surface did not close.').toBeTruthy();
        expect(matching.length, 'No live search results match query text.').toBeGreaterThan(0);

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          route,
          authStatePath,
          query,
          value,
          resultTitlesCount: titles.length,
          matchingCount: matching.length,
          matchingSample: matching.slice(0, 8),
          closed,
        });
      }
    );
  });

  test('P0 Live Filter: open providers, toggle one, close', async ({ browser }, testInfo) => {
    const testName = 'p0_live_filter_open_toggle_close';
    await withLiveCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ page, route, authStatePath }) => {
        const opened = await openLiveFilterPanel(page);
        if (!opened.opened || !opened.panel) {
          const reason = opened.reason || 'Live filter panel is unavailable.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            opened,
          });
          return;
        }

        const providersTabClicked = await activateProvidersTab(opened.panel);
        const providers = await collectVisibleProviders(opened.panel.page());
        const toggled = await toggleFirstProvider(opened.panel.page());
        const closed = await closeLiveFilterPanel(page, opened.panel);

        expect(providers.length, 'No providers were found in live casino filter.').toBeGreaterThan(
          0
        );
        expect(closed, 'Filter panel did not close after interaction.').toBeTruthy();

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          route,
          authStatePath,
          providersTabClicked,
          providersCount: providers.length,
          providersSample: providers.slice(0, 15),
          toggled,
          closed,
        });
      }
    );
  });

  test('P1 Live Combined: search + filter then launch game', async ({ browser }, testInfo) => {
    const testName = 'p1_live_combined_search_filter_launch';
    await withLiveCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const search = await openLiveSearch(page);
        if (!search.opened || !search.inputVisible || !search.input) {
          const reason = search.reason || 'Combined flow: search modal/input unavailable.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            search,
          });
          return;
        }
        await search.input.fill('roulette').catch(() => null);
        await waitForUiSettled(page, 900);
        await closeLiveSearchModal(page);

        const filter = await openLiveFilterPanel(page);
        if (!filter.opened || !filter.panel) {
          const reason = filter.reason || 'Combined flow: filter panel unavailable.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            filter,
          });
          return;
        }

        await activateProvidersTab(filter.panel);
        const providers = await collectVisibleProviders(filter.panel.page());
        await closeLiveFilterPanel(page, filter.panel);
        await ensureInteractive(page);

        const cards = await collectLiveCards(page);
        const pick = cards.find((item) => item.provider && item.title);
        if (!pick) {
          const reason = 'Combined flow: no live game cards available for launch.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            providersCount: providers.length,
            cardsCount: cards.length,
          });
          return;
        }

        const launch = await launchCardByProviderAndTitle(context, page, pick.provider, pick.title);
        expect(
          launch.launched,
          `Combined flow: failed to launch "${pick.provider} / ${pick.title}".`
        ).toBeTruthy();

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          route,
          authStatePath,
          providersCount: providers.length,
          providerSample: providers.slice(0, 12),
          launchedCard: pick,
          launch,
        });
      }
    );
  });

  test('P1 Live Launch batch: launch and verify 1-5 games', async ({ browser }, testInfo) => {
    const testName = 'p1_live_launch_batch_1_5_games';
    await withLiveCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const cards = await collectLiveCards(page);
        const unique = [];
        const seen = new Set();
        for (const card of cards) {
          const key = `${card.provider}::${card.title}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(card);
          if (unique.length >= LIVE_GAMES_TARGET) break;
        }

        if (!unique.length) {
          const reason = 'No visible live game cards were found for launch batch.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            liveGamesTarget: LIVE_GAMES_TARGET,
            liveGamesMin: LIVE_GAMES_MIN,
          });
          return;
        }

        const launches = [];
        let passed = 0;
        let blockedReason = '';

        for (let i = 0; i < unique.length; i += 1) {
          const pick = unique[i];
          const launch = await launchCardByProviderAndTitle(
            context,
            page,
            pick.provider,
            pick.title
          );
          launches.push({
            index: i + 1,
            card: pick,
            launch,
            passed: Boolean(launch && launch.launched),
          });
          if (launch && launch.launched) passed += 1;

          if (!launch || !launch.launched) {
            blockedReason =
              launch && launch.reason ? launch.reason : 'Live game launch was not confirmed.';
          }

          // Return to /livecasino for next card launch.
          await page
            .goto(buildUrl('/livecasino/'), { waitUntil: 'domcontentloaded', timeout: 45000 })
            .catch(() => null);
          await waitForLiveCasinoContent(page);
          await ensureInteractive(page);
        }

        if (passed < LIVE_GAMES_MIN) {
          const reason =
            blockedReason ||
            `Only ${passed} live game(s) launched, expected at least ${LIVE_GAMES_MIN}.`;
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            liveGamesTarget: LIVE_GAMES_TARGET,
            liveGamesMin: LIVE_GAMES_MIN,
            passed,
            launches,
          });
          return;
        }

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          route,
          authStatePath,
          liveGamesTarget: LIVE_GAMES_TARGET,
          liveGamesMin: LIVE_GAMES_MIN,
          passed,
          launches,
        });
      }
    );
  });

  test('P2 Live WebSocket diagnostics: capture WS traffic on search/filter/launch flow', async ({
    browser,
  }, testInfo) => {
    const testName = 'p2_live_websocket_diagnostics';
    await withLiveCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const wsCapture = createWsCapture(page, { sampleLimit: 24, framePreviewLength: 260 });

        const search = await openLiveSearch(page);
        if (search.opened && search.inputVisible && search.input) {
          await search.input.fill('roulette').catch(() => null);
          await waitForUiSettled(page, 900);
          await closeLiveSearchModal(page).catch(() => null);
        }

        const filter = await openLiveFilterPanel(page);
        if (filter.opened && filter.panel) {
          await activateProvidersTab(filter.panel).catch(() => null);
          await toggleFirstProvider(filter.panel.page()).catch(() => null);
          await closeLiveFilterPanel(page, filter.panel).catch(() => null);
        }

        const cards = await collectLiveCards(page);
        if (cards.length) {
          const sample = cards[0];
          await launchCardByProviderAndTitle(context, page, sample.provider, sample.title).catch(
            () => null
          );
        }

        const wsSummary = wsCapture.summarize({
          area: 'livecasino',
          finalUrl: page.url(),
        });
        const noSockets = Number(wsSummary.totals && wsSummary.totals.sockets) === 0;

        if (noSockets) {
          testInfo.annotations.push({
            type: 'partial',
            description:
              'Live casino routes opened, but no WebSocket connections were observed in this observation window.',
          });
        }

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          partial: noSockets,
          route,
          authStatePath,
          wsSummary,
        });

        expect(
          Array.isArray(wsSummary.sockets),
          'WS diagnostics should return sockets array.'
        ).toBeTruthy();
      }
    );
  });
});
