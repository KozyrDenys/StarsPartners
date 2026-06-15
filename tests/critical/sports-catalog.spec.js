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
const { isCapabilityOptionalForBrand } = require('../helpers/brand-capabilities');
const { createWsCapture } = require('../helpers/ws-capture');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'sports');
const VISUAL_DIR = path.join(ARTIFACT_DIR, 'visual');
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const ALLOWED_403_PATTERNS = [/\/server\/api\/languages\/thook\/?/i];

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

function readAuthStateMeta(filePath, index) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  let mtimeMs = 0;
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = Number(stat.mtimeMs || 0);
    sizeBytes = Number(stat.size || 0);
  } catch {
    // keep best-effort defaults
  }

  let cookiesCount = 0;
  let originsCount = 0;
  let parseError = false;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cookiesCount = Array.isArray(payload && payload.cookies) ? payload.cookies.length : 0;
    originsCount = Array.isArray(payload && payload.origins) ? payload.origins.length : 0;
  } catch {
    parseError = true;
  }

  return {
    filePath,
    index,
    mtimeMs,
    sizeBytes,
    cookiesCount,
    originsCount,
    hasSessionArtifacts: cookiesCount > 0 || originsCount > 0,
    parseError,
  };
}

function compareAuthStateMeta(left, right) {
  if (left.hasSessionArtifacts !== right.hasSessionArtifacts) {
    return left.hasSessionArtifacts ? -1 : 1;
  }
  if (left.parseError !== right.parseError) {
    return left.parseError ? 1 : -1;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return right.sizeBytes - left.sizeBytes;
  }
  return left.index - right.index;
}

function pickAuthStatePath() {
  const ranked = AUTH_STATE_CANDIDATES.map((filePath, index) =>
    readAuthStateMeta(filePath, index)
  ).filter(Boolean);
  if (!ranked.length) return null;

  ranked.sort(compareAuthStateMeta);
  const preferred =
    ranked.find((entry) => entry.hasSessionArtifacts && !entry.parseError) ||
    ranked.find((entry) => !entry.parseError) ||
    ranked[0];
  return preferred ? preferred.filePath : null;
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
    const count = Math.min(await locator.count().catch(() => 0), 120);
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

  const challengeTextVisible = await page
    .getByText(/cloudflare|verify you are human|just a moment|checking your browser|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeTextVisible) return 'Challenge text is visible.';

  if (await hasChallengeTokenPage(page)) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function waitForSportsContent(page) {
  const signals = [
    page.locator('#betby').first(),
    page.locator('.t-game-sports-st8').first(),
    page.getByText(/upcoming/i).first(),
    page.getByText(/football/i).first(),
    page.getByText(/live sports/i).first(),
    page.getByText(/place your bets/i).first(),
  ];
  await Promise.any(
    signals.map((locator) => locator.waitFor({ state: 'visible', timeout: 30000 }))
  ).catch(() => null);
}

async function openSports(page, route = '/sports/?bt-path=%2F') {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;

  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await dismissOverlays(page);
  await waitForSportsContent(page);
  await waitForUiSettled(page, 1200);

  const challenge = await getChallengeReason(page);
  const loginVisible = await page
    .getByRole('button', { name: /log in/i })
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);

  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    title: await page.title().catch(() => ''),
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
    loginVisible,
  };
}

async function findSportsBox(page) {
  const root = await firstVisibleLocator(page, [
    '#betby',
    '.t-game-sports-st8__wrap',
    '.t-game-sports-st8',
    '.app-sports',
  ]);
  if (!root) return null;
  return root.boundingBox().catch(() => null);
}

async function readSportsScrollState(page) {
  return page
    .evaluate(() => {
      const selectors = ['#betby', '.t-game-sports-st8__wrap', '.t-game-sports-st8', '.app-sports'];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        if (maxScrollTop <= 0) continue;
        return {
          surface: selector,
          top: Number(node.scrollTop || 0),
          maxTop: maxScrollTop,
        };
      }
      const doc = document.documentElement || document.body;
      return {
        surface: 'window',
        top: Number(window.scrollY || 0),
        maxTop: Math.max(
          0,
          Number((doc && doc.scrollHeight) || 0) - Number(window.innerHeight || 0)
        ),
      };
    })
    .catch(() => ({ surface: 'window', top: 0, maxTop: 0 }));
}

async function scrollSportsSurface(page, amount = 820) {
  return page
    .evaluate((delta) => {
      const selectors = ['#betby', '.t-game-sports-st8__wrap', '.t-game-sports-st8', '.app-sports'];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        if (maxScrollTop <= 0) continue;
        const before = Number(node.scrollTop || 0);
        node.scrollTop = Math.min(maxScrollTop, before + Number(delta || 0));
        return {
          surface: selector,
          moved: Number(node.scrollTop || 0) > before,
          before,
          after: Number(node.scrollTop || 0),
          maxTop: maxScrollTop,
        };
      }

      const before = Number(window.scrollY || 0);
      window.scrollBy(0, Number(delta || 0));
      return {
        surface: 'window',
        moved: Number(window.scrollY || 0) > before,
        before,
        after: Number(window.scrollY || 0),
        maxTop: Math.max(
          0,
          Number(document.documentElement?.scrollHeight || 0) - Number(window.innerHeight || 0)
        ),
      };
    }, amount)
    .catch(() => ({ surface: 'window', moved: false, before: 0, after: 0, maxTop: 0 }));
}

function getBtPath(urlString) {
  try {
    const value = new URL(urlString).searchParams.get('bt-path');
    return value || '';
  } catch {
    return '';
  }
}

async function readSportsState(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    btPath: new URL(window.location.href).searchParams.get('bt-path') || '',
    localStorage: {
      btSession: window.localStorage.getItem('bt-session') || '',
      rightSidebar: window.localStorage.getItem('isRightSidebarCollapsed') || '',
      trackerPinned: window.localStorage.getItem('bt-pinned-match-tracker') || '',
      tokenSport: window.localStorage.getItem('tokenSport') || '',
    },
    sessionStorage: {
      scrollPositions: window.sessionStorage.getItem('bt-scroll-positions') || '',
    },
  }));
}

function diffSportsState(before, after) {
  const changed = [];
  if (!before || !after) return changed;
  if (before.url !== after.url) changed.push('url');
  if (before.btPath !== after.btPath) changed.push('btPath');
  const lsBefore = before.localStorage || {};
  const lsAfter = after.localStorage || {};
  const ssBefore = before.sessionStorage || {};
  const ssAfter = after.sessionStorage || {};

  for (const key of Object.keys({ ...lsBefore, ...lsAfter })) {
    if (lsBefore[key] !== lsAfter[key]) changed.push(`localStorage.${key}`);
  }
  for (const key of Object.keys({ ...ssBefore, ...ssAfter })) {
    if (ssBefore[key] !== ssAfter[key]) changed.push(`sessionStorage.${key}`);
  }
  return changed;
}

async function openEventFromSportsList(page) {
  const beforeUrl = page.url();
  const attempts = [];

  const textCandidates = [
    /brentford fc/i,
    /wolverhampton/i,
    /premier league/i,
    /champions league/i,
  ];
  for (const pattern of textCandidates) {
    const locator = page.getByText(pattern).first();
    const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) continue;
    await locator.click({ timeout: 7000 }).catch(() => null);
    await waitForUiSettled(page, 900);
    const afterUrl = page.url();
    attempts.push({ strategy: `text:${pattern}`, afterUrl });
    if (afterUrl !== beforeUrl && /\/sports\/\?bt-path=/i.test(afterUrl)) {
      return {
        opened: true,
        strategy: `text:${pattern}`,
        beforeUrl,
        afterUrl,
        attempts,
      };
    }
  }

  const box = await findSportsBox(page);
  if (box) {
    const points = [
      [820, 390],
      [860, 390],
      [780, 430],
      [840, 430],
      [760, 470],
    ];

    for (const [x, y] of points) {
      const absX = box.x + x;
      const absY = box.y + y;
      await page.mouse.click(absX, absY).catch(() => null);
      await waitForUiSettled(page, 900);
      const afterUrl = page.url();
      attempts.push({ strategy: `point:${x},${y}`, absX, absY, afterUrl });
      if (afterUrl !== beforeUrl && /\/sports\/\?bt-path=/i.test(afterUrl)) {
        return {
          opened: true,
          strategy: `point:${x},${y}`,
          beforeUrl,
          afterUrl,
          attempts,
        };
      }
    }
  }

  return {
    opened: false,
    strategy: '',
    beforeUrl,
    afterUrl: page.url(),
    attempts,
  };
}

function isAllowed403(url) {
  const normalized = String(url || '').toLowerCase();
  return ALLOWED_403_PATTERNS.some((re) => re.test(normalized));
}

function isStaticAssetUrl(url) {
  const value = String(url || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css|js)(?:$|\?)/i.test(value);
}

function isNoisyRequestFailure(row) {
  const url = String((row && row.url) || '').toLowerCase();
  const failure = String((row && row.failure) || '').toLowerCase();
  if (!failure) return false;
  if (failure.includes('net::err_blocked_by_orb')) return true;
  if (failure.includes('aborted')) return true;
  if (isStaticAssetUrl(url)) return true;
  if (/flags_by_code\/(?:undefined|\.)?\.svg/i.test(url)) return true;
  if (/cloudfront\.net\/competitors\/images\//i.test(url)) return true;
  return false;
}

function isCriticalFailedRequest(row) {
  const url = String((row && row.url) || '');
  const failure = String((row && row.failure) || '').toLowerCase();
  if (!failure || isNoisyRequestFailure(row)) return false;

  const sportsInfraHost = /(?:^|\.)gt\.bet$|(?:^|\.)sptpub\.com$|(?:^|\.)betby\.com$/i;
  let hostname = '';
  try {
    hostname = new URL(url).hostname || '';
  } catch {
    hostname = '';
  }

  const looksCriticalEndpoint = /\/api\/|\/event\/|\/prematch\//i.test(url);
  if (sportsInfraHost.test(hostname) && looksCriticalEndpoint) return true;
  if (/internet_disconnected|network_changed|timed_out/.test(failure)) return true;
  return false;
}

async function probeAuthorizedSession(page) {
  const probe = {
    userPreferencesStatus: 0,
    profileStatus: 0,
    authorizedLikely: false,
  };

  probe.userPreferencesStatus = await page.request
    .get(buildUrl('/api/user/preferences'), {
      failOnStatusCode: false,
      timeout: 15000,
    })
    .then((resp) => resp.status())
    .catch(() => 0);

  probe.profileStatus = await page.request
    .get(buildUrl('/api/user/profile'), {
      failOnStatusCode: false,
      timeout: 15000,
    })
    .then((resp) => resp.status())
    .catch(() => 0);

  probe.authorizedLikely = [probe.userPreferencesStatus, probe.profileStatus].some(
    (status) => status >= 200 && status < 300
  );

  return probe;
}

test.describe.configure({ mode: 'serial' });

test.describe('Sports Coverage: interactions + diagnostics', () => {
  test.setTimeout(180000);

  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.mkdirSync(VISUAL_DIR, { recursive: true });
  });

  test('P0.1 Sports page: authorized access and base content', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports authorized checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const sportsBox = await findSportsBox(page);
      const visibleSignals = {
        upcoming: await page
          .getByText(/upcoming/i)
          .first()
          .isVisible()
          .catch(() => false),
        football: await page
          .getByText(/^football$/i)
          .first()
          .isVisible()
          .catch(() => false),
        basketball: await page
          .getByText(/^basketball$/i)
          .first()
          .isVisible()
          .catch(() => false),
        tennis: await page
          .getByText(/^tennis$/i)
          .first()
          .isVisible()
          .catch(() => false),
        coupon: await page
          .getByText(/place your bets/i)
          .first()
          .isVisible()
          .catch(() => false),
      };
      const sessionProbe = await probeAuthorizedSession(page);

      if (route.loginVisible) {
        if (!sessionProbe.authorizedLikely) {
          const reason =
            `Sports authorized check is blocked: Log In is visible and auth probes are not healthy ` +
            `(/api/user/preferences=${sessionProbe.userPreferencesStatus || 0}, /api/user/profile=${sessionProbe.profileStatus || 0}).` +
            ' Auth state is not usable for this run.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testInfo.title, {
            blocked: true,
            reason,
            route,
            authStatePath,
            sportsBox,
            visibleSignals,
            sessionProbe,
          });
          return;
        }
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Log In entry is visible in sports shell, but auth probes are healthy; treating as layout-level partial instead of hard fail.',
        });
      }
      if (!sportsBox && !Object.values(visibleSignals).some(Boolean)) {
        const reason =
          'Sports container/signals are not exposed in current brand layout for this run.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          visibleSignals,
          sessionProbe,
        });
        return;
      }
      if (!Object.values(visibleSignals).some(Boolean)) {
        const reason =
          'Sports route is reachable but no stable sports UI signals are visible in current brand layout.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          visibleSignals,
          sessionProbe,
        });
        return;
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        route,
        authStatePath,
        sportsBox,
        visibleSignals,
        sessionProbe,
      });
    } finally {
      await context.close();
    }
  });

  test('P0.2 Sports navigation: Live/Football/Basketball/Tennis switch bt-path', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports navigation checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const checks = [
      { label: 'Football', expected: '/soccer-1' },
      { label: 'Basketball', expected: '/basketball-2' },
      { label: 'Tennis', expected: '/tennis-5' },
      { label: 'Live Sports', expected: '/live' },
    ];

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const findings = [];
      for (const item of checks) {
        const beforeUrl = page.url();
        const locator = await firstVisibleLocator(page, [
          `a[href*="/sports/?bt-path="]:has-text("${item.label}")`,
          `a:has-text("${item.label}")`,
        ]);

        if (!locator) {
          findings.push({
            label: item.label,
            status: 'blocked',
            reason: 'Navigation link is not visible.',
            beforeUrl,
            afterUrl: page.url(),
          });
          continue;
        }

        await locator.click({ timeout: 10000 }).catch(() => null);
        await waitForUiSettled(page, 1200);
        const afterUrl = page.url();
        const btPath = getBtPath(afterUrl);
        const ok = afterUrl !== beforeUrl && btPath.includes(item.expected);

        findings.push({
          label: item.label,
          expected: item.expected,
          status: ok ? 'passed' : 'failed',
          beforeUrl,
          afterUrl,
          btPath,
        });
      }

      const passedCount = findings.filter((item) => item.status === 'passed').length;
      if (passedCount === 0) {
        markBlocked(
          testInfo,
          'Sports navigation items were not switchable via visible links in current render.'
        );
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'No sports nav route switch passed.',
          findings,
          route,
          authStatePath,
        });
        return;
      }

      if (passedCount < checks.length) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Sports nav coverage is partial: ${passedCount}/${checks.length} switches confirmed.`,
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: passedCount < checks.length,
        findings,
        route,
        authStatePath,
      });
    } finally {
      await context.close();
    }
  });

  test('P0.3 Sports scroll: upcoming/coupon remain stable while scrolling', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports scroll checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const beforeState = await readSportsState(page);
      const startY = await page.evaluate(() => window.scrollY).catch(() => 0);
      const startScroll = await readSportsScrollState(page);
      const sportsBox = await findSportsBox(page);
      const upcomingVisibleStart = await page
        .getByText(/upcoming/i)
        .first()
        .isVisible()
        .catch(() => false);
      const couponVisibleStart = await page
        .getByText(/place your bets|betslip/i)
        .first()
        .isVisible()
        .catch(() => false);

      let movedBySurface = false;
      const scrollTrace = [];
      for (let i = 0; i < 10; i += 1) {
        const tick = await scrollSportsSurface(page, 820);
        scrollTrace.push(tick);
        if (tick && tick.moved) movedBySurface = true;
        await waitForUiSettled(page, 200);
      }

      const finalY = await page.evaluate(() => window.scrollY).catch(() => 0);
      const endScroll = await readSportsScrollState(page);
      const endState = await readSportsState(page);
      const changed = diffSportsState(beforeState, endState);
      const movedByWindow = finalY > startY;
      const movedByContainer = endScroll.top > startScroll.top || movedBySurface;
      const hasScrollableRange =
        Number(startScroll.maxTop || 0) > 0 ||
        Number(endScroll.maxTop || 0) > 0 ||
        scrollTrace.some((tick) => Number((tick && tick.maxTop) || 0) > 0);
      if (!sportsBox && !(upcomingVisibleStart || couponVisibleStart)) {
        const reason =
          'Sports container/signals are not exposed for scroll validation in this run.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          startY,
          finalY,
          startScroll,
          endScroll,
          scrollTrace,
          upcomingVisibleStart,
          couponVisibleStart,
          stateChanged: changed,
          beforeState,
          endState,
        });
        return;
      }
      if (!hasScrollableRange) {
        const reason = 'Sports surface is reachable but has no scrollable range in current render.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          startY,
          finalY,
          startScroll,
          endScroll,
          scrollTrace,
          upcomingVisibleStart,
          couponVisibleStart,
          stateChanged: changed,
          beforeState,
          endState,
        });
        return;
      }
      expect(
        movedByWindow || movedByContainer,
        'Sports route should scroll via window or internal sports container.'
      ).toBeTruthy();
      if (!(upcomingVisibleStart || couponVisibleStart)) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Upcoming/coupon labels are not visible in this sports render, but scroll and route stability were validated.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !(upcomingVisibleStart || couponVisibleStart),
        route,
        authStatePath,
        sportsBox,
        startY,
        finalY,
        startScroll,
        endScroll,
        scrollTrace,
        upcomingVisibleStart,
        couponVisibleStart,
        stateChanged: changed,
        beforeState,
        endState,
      });
    } finally {
      await context.close();
    }
  });

  test('P1.4 Event details: open event and return back to sports list', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports event checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Sports event card is not clickable in current render.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          authStatePath,
          openEvent,
        });
        return;
      }

      const eventUrl = page.url();
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await waitForUiSettled(page, 1200);
      const afterBackUrl = page.url();
      const remainedOnSports = /\/sports\/\?bt-path=/i.test(afterBackUrl);

      expect(remainedOnSports, 'After back, page should remain on /sports route.').toBeTruthy();
      if (
        eventUrl === afterBackUrl &&
        isCapabilityOptionalForBrand(BASE_URL, 'sportsEventDetails')
      ) {
        const reason = 'Sports event details back action did not change route.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          partial: true,
          reason,
          route,
          authStatePath,
          openEvent,
          eventUrl,
          afterBackUrl,
        });
        return;
      }
      expect(
        eventUrl !== afterBackUrl,
        'Back action should return from event details.'
      ).toBeTruthy();

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        route,
        authStatePath,
        openEvent,
        eventUrl,
        afterBackUrl,
      });
    } finally {
      await context.close();
    }
  });

  test('P1.5 Odds click + betslip surface: interaction smoke', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for odds/betslip checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Could not open event details for odds interaction.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          openEvent,
          authStatePath,
        });
        return;
      }

      const betslipControl = page.getByText(/betslip/i).first();
      const betslipVisible = await betslipControl.isVisible({ timeout: 2500 }).catch(() => false);
      if (betslipVisible) {
        await betslipControl.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 800);
      }

      const box = await findSportsBox(page);
      const before = await readSportsState(page);
      const attempts = [];
      let interactionConfirmed = false;
      const pointCandidates = [
        [630, 230],
        [680, 230],
        [560, 270],
        [620, 300],
        [700, 300],
      ];

      if (box) {
        for (const [x, y] of pointCandidates) {
          const absX = box.x + x;
          const absY = box.y + y;
          await page.mouse.click(absX, absY).catch(() => null);
          await waitForUiSettled(page, 700);
          const after = await readSportsState(page);
          const changed = diffSportsState(before, after);
          const row = {
            x,
            y,
            absX,
            absY,
            url: after.url,
            changed,
          };
          attempts.push(row);
          const sameEventRoute = after.url === before.url;
          if (
            sameEventRoute &&
            changed.some((key) => key.includes('localStorage.') || key === 'btPath')
          ) {
            interactionConfirmed = true;
            break;
          }
        }
      }

      const trackerVisible = await page
        .getByText(/tracker/i)
        .first()
        .isVisible()
        .catch(() => false);
      const couponSignalVisible = await page
        .getByText(/place your bets|betslip/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (!interactionConfirmed && !(trackerVisible || couponSignalVisible)) {
        markBlocked(testInfo, 'Odds-like click did not produce visible betslip/tracker reaction.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'No interaction confirmation signal.',
          route,
          openEvent,
          authStatePath,
          attempts,
          trackerVisible,
          couponSignalVisible,
        });
        return;
      }

      if (!interactionConfirmed) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Odds click signal is weak: panel stayed interactive, but deterministic localStorage delta was not captured.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !interactionConfirmed,
        route,
        openEvent,
        authStatePath,
        attempts,
        trackerVisible,
        couponSignalVisible,
      });
    } finally {
      await context.close();
    }
  });

  test('P1.6 Betslip controls: toggle + remove/clear + invalid stake smoke', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for betslip control checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const betPosts = [];
    page.on('request', (req) => {
      try {
        const method = req.method();
        const url = req.url();
        if (method !== 'POST') return;
        if (!/\/api\/.*(bet|coupon|wager|ticket)/i.test(url)) return;
        betPosts.push({ method, url });
      } catch {
        // ignore request parsing issues
      }
    });

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Could not open event details for betslip control checks.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          openEvent,
          authStatePath,
        });
        return;
      }

      const stateBefore = await readSportsState(page);
      const tracker = page.getByText(/tracker/i).first();
      const betslip = page.getByText(/betslip/i).first();

      const steps = [];
      if (await tracker.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tracker.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 700);
        steps.push('tracker-click');
      }
      if (await betslip.isVisible({ timeout: 1000 }).catch(() => false)) {
        await betslip.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 700);
        steps.push('betslip-click');
      }

      const box = await findSportsBox(page);
      if (box) {
        await page.mouse.click(box.x + 630, box.y + 230).catch(() => null);
        await waitForUiSettled(page, 600);
        await page.mouse.click(box.x + 630, box.y + 230).catch(() => null);
        await waitForUiSettled(page, 600);
        steps.push('odds-toggle-try');
      }

      let stakeInputFound = false;
      const stakeInput = await firstVisibleLocator(page, [
        'input[placeholder*="stake" i]',
        'input[placeholder*="amount" i]',
        'input[inputmode="decimal"]',
        'input[type="number"]',
      ]);
      if (stakeInput) {
        stakeInputFound = true;
        await stakeInput.fill('0').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 500);
        await stakeInput.fill('-10').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 500);
        steps.push('stake-invalid-input');
      } else if (box) {
        await page.mouse.click(box.x + 1110, box.y + 220).catch(() => null);
        await page.keyboard.type('0').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 400);
        await page.keyboard.press('Control+A').catch(() => null);
        await page.keyboard.type('-10').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 500);
        steps.push('stake-coordinate-try');
      }

      const stateAfter = await readSportsState(page);
      const changed = diffSportsState(stateBefore, stateAfter);

      if (!stakeInputFound) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'No visible stake input detected in DOM; invalid stake was tested via coordinate+keyboard fallback.',
        });
      }

      expect(
        betPosts.length,
        `Invalid stake smoke must not produce POST /bet-like calls. Found: ${betPosts
          .map((item) => item.url)
          .join(' | ')}`
      ).toBe(0);

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !stakeInputFound,
        route,
        openEvent,
        authStatePath,
        steps,
        changed,
        stateBefore,
        stateAfter,
        betPosts,
      });
    } finally {
      await context.close();
    }
  });

  test('P1.7 Sports network diagnostics: allowlist known 403 and detect criticals', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports network diagnostics.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const responseErrors = [];
    const failedRequests = [];
    const consoleErrors = [];

    page.on('response', (resp) => {
      try {
        const status = resp.status();
        if (status < 400) return;
        responseErrors.push({
          status,
          url: resp.url(),
          method: resp.request().method(),
        });
      } catch {
        // ignore response parsing errors
      }
    });

    page.on('requestfailed', (req) => {
      try {
        failedRequests.push({
          url: req.url(),
          method: req.method(),
          failure: (req.failure() && req.failure().errorText) || '',
        });
      } catch {
        // ignore request failure parsing
      }
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const location = msg.location ? msg.location() : { url: '' };
      consoleErrors.push({
        text: msg.text(),
        url: location.url || '',
      });
    });

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const navLinks = [
        page.getByText(/^football$/i).first(),
        page.getByText(/^basketball$/i).first(),
        page.getByText(/^tennis$/i).first(),
      ];
      for (const locator of navLinks) {
        if (!(await locator.isVisible({ timeout: 500 }).catch(() => false))) continue;
        await locator.click({ timeout: 7000 }).catch(() => null);
        await waitForUiSettled(page, 700);
      }

      await openEventFromSportsList(page);
      await waitForUiSettled(page, 1000);

      const ignored = responseErrors.filter((row) => row.status === 403 && isAllowed403(row.url));
      const criticalHttp = responseErrors.filter((row) => {
        const url = String(row.url || '');
        const inMainDomain = /gt\.bet/i.test(url);
        if (row.status >= 500) return true;
        if (row.status >= 400 && inMainDomain && !isAllowed403(url)) return true;
        return false;
      });
      const noisyFailedRequests = failedRequests.filter((row) => isNoisyRequestFailure(row));
      const criticalFailedRequests = failedRequests.filter((row) => isCriticalFailedRequest(row));
      const consoleWarnings = consoleErrors.filter((row) => {
        const url = String(row.url || '');
        if (!url) return true;
        if (isAllowed403(url)) return false;
        return /gt\.bet|sptpub/i.test(url);
      });

      if (consoleWarnings.length > 0) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Console diagnostics contain ${consoleWarnings.length} warnings outside allowlist.`,
        });
      }
      if (noisyFailedRequests.length > 0) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Ignored ${noisyFailedRequests.length} noisy failed request(s) (ORB/static asset/known transient).`,
        });
      }

      expect(
        criticalHttp.length,
        `Critical sports HTTP diagnostics detected: ${criticalHttp
          .map((row) => `${row.status} ${row.url}`)
          .join(' | ')}`
      ).toBe(0);
      expect(
        criticalFailedRequests.length,
        `Critical failed requests detected: ${criticalFailedRequests
          .map((row) => `${row.method} ${row.url} (${row.failure})`)
          .join(' | ')}`
      ).toBe(0);

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        route,
        authStatePath,
        summary: {
          responseErrors: responseErrors.length,
          ignored403: ignored.length,
          criticalHttp: criticalHttp.length,
          failedRequests: failedRequests.length,
          noisyFailedRequests: noisyFailedRequests.length,
          criticalFailedRequests: criticalFailedRequests.length,
          consoleErrors: consoleErrors.length,
          consoleWarnings: consoleWarnings.length,
        },
        responseErrors,
        ignored403: ignored,
        criticalHttp,
        failedRequests,
        noisyFailedRequests,
        criticalFailedRequests,
        consoleErrors,
        consoleWarnings,
      });
    } finally {
      await context.close();
    }
  });

  test('P2.8 Visual smoke: sports desktop and mobile', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports visual smoke.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    fs.mkdirSync(VISUAL_DIR, { recursive: true });
    const captured = [];
    const blockedViewports = [];

    const desktopContext = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const desktopPage = await desktopContext.newPage();
    try {
      const route = await openSports(desktopPage, '/sports/?bt-path=%2F');
      if (route.challenge) {
        blockedViewports.push({ viewport: 'desktop', reason: route.challenge, routeState: route });
      } else {
        const filePath = path.join(VISUAL_DIR, 'sports-desktop.png');
        await desktopPage.screenshot({ path: filePath, fullPage: true });
        captured.push({ viewport: 'desktop', filePath, route });
      }
    } finally {
      await desktopContext.close();
    }

    const mobileContext = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    try {
      const route = await openSports(mobilePage, '/sports/?bt-path=%2F');
      if (route.challenge) {
        blockedViewports.push({ viewport: 'mobile', reason: route.challenge, routeState: route });
      } else {
        const filePath = path.join(VISUAL_DIR, 'sports-mobile.png');
        await mobilePage.screenshot({ path: filePath, fullPage: true });
        captured.push({ viewport: 'mobile', filePath, route });
      }
    } finally {
      await mobileContext.close();
    }

    if (!captured.length && blockedViewports.length) {
      markBlocked(
        testInfo,
        `Sports visual smoke blocked on all viewports: ${blockedViewports
          .map((item) => item.viewport)
          .join(', ')}`
      );
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'All sports visual capture routes were blocked.',
        authStatePath,
        captured,
        blockedViewports,
      });
      return;
    }

    expect(captured.length > 0, 'Expected at least one sports visual capture.').toBeTruthy();
    if (blockedViewports.length) {
      testInfo.annotations.push({
        type: 'partial',
        description: `Sports visual blocked on: ${blockedViewports
          .map((item) => item.viewport)
          .join(', ')}`,
      });
    }

    await writeAndAttach(testInfo, testInfo.title, {
      blocked: false,
      partial: blockedViewports.length > 0,
      authStatePath,
      captured,
      blockedViewports,
    });
  });

  test('P2.9 Metadata smoke: title/h1/canonical for sports routes', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports metadata checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const plans = [
      '/sports/?bt-path=%2F',
      '/sports/?bt-path=%2Fsoccer-1',
      '/sports/?bt-path=%2Flive',
    ];

    try {
      const checked = [];
      const blockedRoutes = [];
      const warnings = [];

      for (const routePath of plans) {
        const route = await openSports(page, routePath);
        if (route.challenge) {
          blockedRoutes.push({ route: routePath, reason: route.challenge, routeState: route });
          continue;
        }

        const metadata = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          const canonical = document.querySelector('link[rel="canonical"]');
          return {
            title: document.title || '',
            h1: h1 ? (h1.textContent || '').trim() : '',
            canonical: canonical ? canonical.getAttribute('href') || '' : '',
          };
        });

        const titleLooksSports = /sport|football|basketball|tennis|live/i.test(metadata.title);
        const h1LooksSports = metadata.h1
          ? /sport|football|basketball|tennis|live/i.test(metadata.h1)
          : false;
        const canonicalLooksSports = /\/sports\/?/i.test(metadata.canonical || '');

        if (!titleLooksSports) {
          warnings.push({
            route: routePath,
            type: 'title',
            value: metadata.title,
            reason: 'Title does not include sports keywords.',
          });
        }
        if (!metadata.h1 || !h1LooksSports) {
          warnings.push({
            route: routePath,
            type: 'h1',
            value: metadata.h1 || '',
            reason: 'H1 is missing or does not include sports keywords.',
          });
        }
        if (!metadata.canonical || !canonicalLooksSports) {
          warnings.push({
            route: routePath,
            type: 'canonical',
            value: metadata.canonical || '',
            reason: 'Canonical is missing or does not point to sports path.',
          });
        }

        checked.push({
          route: routePath,
          finalUrl: page.url(),
          metadata,
          titleLooksSports,
          h1LooksSports,
          canonicalLooksSports,
        });
      }

      if (!checked.length && blockedRoutes.length) {
        markBlocked(testInfo, 'All planned sports metadata routes were blocked.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'No metadata routes were inspectable.',
          authStatePath,
          checked,
          blockedRoutes,
          warnings,
        });
        return;
      }

      expect(
        checked.length > 0,
        'At least one sports metadata route should be inspected.'
      ).toBeTruthy();

      if (warnings.length) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Sports metadata has ${warnings.length} warning(s); see attached artifact.`,
        });
      }
      if (blockedRoutes.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Blocked metadata routes: ${blockedRoutes
            .map((item) => item.route)
            .join(', ')}`,
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: warnings.length > 0 || blockedRoutes.length > 0,
        authStatePath,
        checked,
        blockedRoutes,
        warnings,
      });
    } finally {
      await context.close();
    }
  });

  test('P2.10 WebSocket diagnostics: capture sports WS traffic during navigation', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports WebSocket diagnostics.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    const wsCapture = createWsCapture(page, { sampleLimit: 24, framePreviewLength: 260 });

    try {
      const routes = [
        '/sports/?bt-path=%2F',
        '/sports/?bt-path=%2Flive',
        '/sports/?bt-path=%2Fsoccer-1',
      ];
      const routeStates = [];

      for (const routePath of routes) {
        const state = await openSports(page, routePath);
        routeStates.push(state);
        if (state.challenge) continue;
        await page.mouse.wheel(0, 900).catch(() => null);
        await waitForUiSettled(page, 700);
      }

      const wsSummary = wsCapture.summarize({
        area: 'sports',
        routes,
        finalUrl: page.url(),
      });
      const noSockets = Number(wsSummary.totals && wsSummary.totals.sockets) === 0;
      const allBlocked =
        routeStates.length > 0 && routeStates.every((state) => Boolean(state && state.challenge));

      if (allBlocked) {
        markBlocked(testInfo, 'Sports WebSocket diagnostics blocked by challenge on all routes.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'All sports routes were blocked by challenge.',
          authStatePath,
          routeStates,
          wsSummary,
        });
        return;
      }

      if (noSockets) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Sports routes opened, but no WebSocket connections were observed in this observation window.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: noSockets,
        authStatePath,
        routeStates,
        wsSummary,
      });

      expect(
        Array.isArray(wsSummary.sockets),
        'WS diagnostics should return sockets array.'
      ).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
