const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures/qa-test');
const LanguageDetect = require('languagedetect');
const { franc } = require('franc');
const {
  applyAuthTokenCookie,
  validatePlayerSigninViaCdpTurnstile,
} = require('../helpers/signup-api-fallback');
const {
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  tryAutoBypassCloudflare,
  waitForUiSettled,
} = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BRAND_HOST = (() => {
  try {
    return new URL(BASE_URL).hostname;
  } catch {
    return BASE_URL;
  }
})();
const BASE_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return '';
  }
})();
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const PROJECT_ROOT_DIR = process.env.QA_PROJECT_ROOT
  ? path.resolve(String(process.env.QA_PROJECT_ROOT))
  : process.cwd();
const SHARED_PROJECT_ROOT_DIR = /[\\/](desktop|mobile)$/i.test(PROJECT_ROOT_DIR)
  ? path.dirname(PROJECT_ROOT_DIR)
  : PROJECT_ROOT_DIR;
const SHARED_PROJECT_ARTIFACTS_DIR = path.join(SHARED_PROJECT_ROOT_DIR, 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'localization');
const AUTH_STATE_CANDIDATES = [
  process.env.PW_STORAGE_STATE || '',
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'auth-state.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'registration-auth-state.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'auth-state.json'),
].filter(Boolean);
const AUTH_TOKEN_STATE_CANDIDATES = [
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json'),
].filter(Boolean);
const LOGIN_CREDS_STATE_CANDIDATES = [
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(SHARED_PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json'),
].filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCALIZATION_MAX_LANGS = parseLocaleLimit(process.env.PW_LOCALIZATION_MAX_LANGS || '0');
const LOCALIZATION_TARGET_LOCALES = String(process.env.PW_LOCALIZATION_TARGET_LOCALES || '')
  .split(',')
  .map((item) => mapLocaleCodeToMarkers(item) || normalizeLocaleCode(item))
  .filter(Boolean);
const LOCALIZATION_STRICT_BLOCKED = ['1', 'true', 'on', 'yes'].includes(
  String(process.env.PW_LOCALIZATION_STRICT_BLOCKED || '0')
    .trim()
    .toLowerCase()
);
const ROUTE_DISCOVERY_MAX = toPositiveInt(process.env.PW_LOCALIZATION_ROUTE_MAX || '40', 40);
const ROUTE_DISCOVERY_CLICK_STEPS = toPositiveInt(
  process.env.PW_LOCALIZATION_ROUTE_CLICKS || '14',
  14
);
const ENABLE_LINGUISTIC_CHECKS = !['0', 'false', 'off'].includes(
  String(process.env.PW_LOCALIZATION_LINGUISTIC || '1')
    .trim()
    .toLowerCase()
);
const LINGUISTIC_SAMPLE_PAGES = toPositiveInt(
  process.env.PW_LOCALIZATION_LINGUISTIC_SAMPLE_PAGES || '4',
  4
);
const LINGUISTIC_MAX_TEXT_CHARS = toPositiveInt(
  process.env.PW_LOCALIZATION_LINGUISTIC_MAX_TEXT_CHARS || '2600',
  2600
);
const LINGUISTIC_GRAMMAR_MAX_ISSUES = toPositiveInt(
  process.env.PW_LOCALIZATION_LINGUISTIC_MAX_ISSUES || '10',
  10
);
const LINGUISTIC_TIMEOUT_MS = toPositiveInt(
  process.env.PW_LOCALIZATION_LINGUISTIC_TIMEOUT_MS || '12000',
  12000
);
const LINGUISTIC_API_URL = String(
  process.env.PW_LOCALIZATION_LINGUISTIC_API || 'https://api.languagetool.org/v2/check'
)
  .trim()
  .replace(/\/+$/, '');
const LOCALIZATION_NAV_TIMEOUT_MS = toPositiveInt(
  process.env.PW_LOCALIZATION_NAV_TIMEOUT_MS || '9000',
  9000
);
const LOCALIZATION_SETTLE_WAIT_MS = toPositiveInt(
  process.env.PW_LOCALIZATION_SETTLE_WAIT_MS || '800',
  800
);
const LOCALIZATION_SUITE_TIMEOUT_MS = toPositiveInt(
  process.env.PW_LOCALIZATION_SUITE_TIMEOUT_MS || '720000',
  720000
);
const LANGUAGE_TRIGGER_SELECTORS = [
  '[data-testid="locale-switcher"]',
  '[data-testid="sidebar-lang-selector"]',
  '[data-testid="header-lang-selector"]',
  '[data-testid*="lang" i]',
  '[class*="lang" i][class*="selector" i]',
  'button:has-text("English")',
  'button:has-text("EN")',
];
const LANGUAGE_OPTION_SELECTOR =
  '.t-dropdown__item-option, [role="option"], [role="menuitem"], .t-select__option, .t-dropdown__item';
const PROFILE_PREFERENCES_ROUTES = ['/profile/preferences/', '/profile/settings/', '/settings/'];
const CORE_LOCALIZATION_ROUTES = [
  '/',
  '/sports/?bt-path=%2F',
  '/casino/',
  '/live-casino/',
  '/profile/',
  '/profile/details/',
  '/profile/security/',
  '/profile/preferences/',
  '/assets/',
  '/promotions/',
  '/vip/',
  '/collections/',
  '/favorites/',
  '/recent/',
  '/referral/',
];
const EXTRA_LOCALIZATION_ROUTES = String(process.env.PW_LOCALIZATION_EXTRA_ROUTES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ENGLISH_LEAK_PATTERNS = [
  /\blog in\b/i,
  /\bsign up\b/i,
  /\bsearch\b/i,
  /\bfilter\b/i,
  /\bcasino\b/i,
  /\bsports?\b/i,
  /\bprofile\b/i,
  /\bdeposit\b/i,
];
const LANGUAGE_MARKERS = {
  en: [/\blog in\b/i, /\bsign up\b/i, /\bsports?\b/i, /\bprofile\b/i],
  ru: [/вход|войти|регист|спорт|казино|профил|депозит|бонус/i],
  uk: [/увій|реєстр|спорт|казино|профіл|депозит|бонус/i],
  es: [/iniciar|sesión|registr|deporte|casino|perfil|depósit|bono/i],
  pt: [/entrar|sessão|registr|esport|cassino|perfil|depósit|bônus/i],
  de: [/anmeld|registr|sport|casino|profil|einzahl|bonus/i],
  fr: [/connexion|inscript|sport|casino|profil|dépôt|bonus/i],
  it: [/accedi|registr|sport|casino|profil|deposit|bonus/i],
  el: [/σύνδε|εγγραφ|αθλη|καζίνο|προφίλ|κατάθε|μπόνους/i],
  no: [/logg inn|registrer|sport|kasino|profil|innskudd|bonus/i],
  pl: [/zaloguj|rejestr|sport|kasyno|profil|wpłat|bonus/i],
};
const EXPECTED_DETECT_NAMES = {
  en: ['english'],
  ru: ['russian'],
  uk: ['ukrainian'],
  es: ['spanish'],
  pt: ['portuguese'],
  de: ['german'],
  fr: ['french'],
  it: ['italian'],
  el: ['greek'],
  no: ['norwegian'],
  pl: ['polish'],
};
const EXPECTED_FRANC_CODES = {
  en: ['eng'],
  ru: ['rus'],
  uk: ['ukr'],
  es: ['spa'],
  pt: ['por'],
  de: ['deu', 'ger'],
  fr: ['fra', 'fre'],
  it: ['ita'],
  el: ['ell', 'gre'],
  no: ['nob', 'nor'],
  pl: ['pol'],
};
const LINGUISTIC_LANGUAGE_MAP = {
  en: 'en-US',
  ru: 'ru-RU',
  uk: 'uk-UA',
  es: 'es-ES',
  pt: 'pt-PT',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  el: 'el-GR',
  no: 'no',
  pl: 'pl-PL',
};
const LINGUISTIC_IGNORE_CATEGORY_IDS = new Set([
  'TYPOGRAPHY',
  'CASING',
  'PUNCTUATION',
  'WHITESPACE_RULE',
]);

const detector = new LanguageDetect();
let languageInventory = null;

test.describe.configure({ mode: 'serial' });

test.describe(`Localization: authorized language matrix for ${BRAND_HOST}`, () => {
  test.setTimeout(LOCALIZATION_SUITE_TIMEOUT_MS);

  test('P0 Localization inventory: detect all available language options', async ({
    browser,
  }, testInfo) => {
    const authStatePath = resolveAuthStatePath();
    const contextOptions = {
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
    };
    if (authStatePath) contextOptions.storageState = authStatePath;
    const context = await browser.newContext(contextOptions);

    const payload = {
      baseUrl: BASE_URL,
      generatedAt: new Date().toISOString(),
      authStatePath: authStatePath || '',
      mode: '',
      options: [],
      count: 0,
    };

    try {
      const page = await context.newPage();
      const opened = await openRoute(page, '/');
      payload.open = opened;
      if (!opened.ok) {
        markBlocked(testInfo, opened.reason || 'Home route blocked before language scan.');
        payload.blocked = true;
        payload.reason = opened.reason || 'unknown';
        await attachAndWrite(testInfo, 'localization-language-inventory.json', payload);
        failIfStrictBlocked(testInfo, payload.reason || 'Home route blocked before language scan.');
        return;
      }

      const authState = await isAuthorizedSession(page);
      payload.authorized = authState;
      if (!authState.ok) {
        const tokenRecovery = await tryAuthorizeWithToken(context, page);
        payload.tokenRecovery = tokenRecovery;
        if (!tokenRecovery.ok) {
          markBlocked(testInfo, `Authorized player session is unavailable: ${authState.reason}`);
          payload.blocked = true;
          payload.reason = authState.reason;
          await attachAndWrite(testInfo, 'localization-language-inventory.json', payload);
          failIfStrictBlocked(testInfo, payload.reason || 'Authorized session is unavailable.');
          return;
        }
      }

      const controlResolution = await Promise.race([
        resolveLanguageControl(page)
          .then((value) => ({ ok: true, value }))
          .catch((err) => ({
            ok: false,
            reason: compactText(err && err.message ? err.message : err),
          })),
        sleep(45_000).then(() => ({
          ok: false,
          reason: 'Language control detection timed out after 45s.',
        })),
      ]);
      if (!controlResolution.ok) {
        markBlocked(testInfo, controlResolution.reason || 'Language control detection failed.');
        payload.blocked = true;
        payload.reason = controlResolution.reason || 'Language control detection failed.';
        await attachAndWrite(testInfo, 'localization-language-inventory.json', payload);
        failIfStrictBlocked(testInfo, payload.reason || 'Language control detection failed.');
        return;
      }
      const control = controlResolution.value;
      payload.mode = control.mode;
      payload.control = control.details;

      if (control.mode === 'none') {
        markBlocked(testInfo, 'Language control is not visible for authorized player.');
        payload.blocked = true;
        payload.reason = 'Language control is not visible for authorized player.';
        await attachAndWrite(testInfo, 'localization-language-inventory.json', payload);
        failIfStrictBlocked(testInfo, payload.reason);
        return;
      }

      payload.options = control.options;
      payload.count = control.options.length;
      payload.current = control.current;
      languageInventory = {
        mode: control.mode,
        options: control.options,
      };

      await attachAndWrite(testInfo, 'localization-language-inventory.json', payload);
      expect(
        payload.count,
        'Expected at least two language options for localization validation.'
      ).toBeGreaterThan(1);
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('P1 Localization matrix: routes, buttons and key features use selected locale', async ({
    browser,
  }, testInfo) => {
    if (
      !languageInventory ||
      !Array.isArray(languageInventory.options) ||
      languageInventory.options.length < 2
    ) {
      const payload = {
        baseUrl: BASE_URL,
        generatedAt: new Date().toISOString(),
        blocked: true,
        reason: 'Language inventory is missing. Run P0 localization inventory first.',
        locales: [],
      };
      await attachAndWrite(testInfo, 'localization-matrix.json', payload);
      markBlocked(testInfo, 'Language inventory is missing. Run P0 localization inventory first.');
      failIfStrictBlocked(testInfo, payload.reason);
      return;
    }

    const authStatePath = resolveAuthStatePath();
    const payload = {
      baseUrl: BASE_URL,
      generatedAt: new Date().toISOString(),
      authStatePath: authStatePath || '',
      mode: languageInventory.mode,
      inventoryCount: languageInventory.options.length,
      targetLocales: LOCALIZATION_TARGET_LOCALES.slice(),
      maxLanguages: Number.isFinite(LOCALIZATION_MAX_LANGS) ? LOCALIZATION_MAX_LANGS : 'all',
      routeLimit: ROUTE_DISCOVERY_MAX,
      linguistic: {
        enabled: ENABLE_LINGUISTIC_CHECKS,
        samplePages: LINGUISTIC_SAMPLE_PAGES,
        maxTextChars: LINGUISTIC_MAX_TEXT_CHARS,
        maxIssues: LINGUISTIC_GRAMMAR_MAX_ISSUES,
        timeoutMs: LINGUISTIC_TIMEOUT_MS,
        apiUrl: LINGUISTIC_API_URL,
      },
      locales: [],
    };

    const allOptions = dedupeLanguageOptions(languageInventory.options || []);
    const supported = allOptions.filter((item) => item.code && LANGUAGE_MARKERS[item.code]);
    const candidatePool = supported.length ? supported : allOptions;
    const targetPool = LOCALIZATION_TARGET_LOCALES.length
      ? candidatePool.filter((item) => {
          const rawCode = item.code || item.value || item.rawCode || '';
          const normalized = normalizeLocaleCode(rawCode);
          const mapped = mapLocaleCodeToMarkers(rawCode) || normalized;
          return (
            LOCALIZATION_TARGET_LOCALES.includes(mapped) ||
            LOCALIZATION_TARGET_LOCALES.includes(normalized)
          );
        })
      : candidatePool;
    const candidates = Number.isFinite(LOCALIZATION_MAX_LANGS)
      ? targetPool.slice(0, LOCALIZATION_MAX_LANGS)
      : targetPool.slice();

    if (LOCALIZATION_TARGET_LOCALES.length && !targetPool.length) {
      markBlocked(
        testInfo,
        `No localization options matched requested locales: ${LOCALIZATION_TARGET_LOCALES.join(', ')}.`
      );
      payload.blocked = true;
      payload.reason = `Requested locales not found: ${LOCALIZATION_TARGET_LOCALES.join(', ')}`;
      await attachAndWrite(testInfo, 'localization-matrix.json', payload);
      failIfStrictBlocked(testInfo, payload.reason);
      return;
    }

    if (targetPool.length > candidates.length) {
      testInfo.annotations.push({
        type: 'partial',
        description: `Localization matrix scope limited to ${candidates.length}/${targetPool.length} locales by PW_LOCALIZATION_MAX_LANGS.`,
      });
    }

    if (!candidates.length) {
      markBlocked(testInfo, 'No locale options found for localization matrix.');
      payload.blocked = true;
      payload.reason = 'No locale options found.';
      await attachAndWrite(testInfo, 'localization-matrix.json', payload);
      failIfStrictBlocked(testInfo, payload.reason);
      return;
    }

    for (const option of candidates) {
      const localeEntry = {
        target: option,
        status: 'passed',
        pages: [],
      };

      const contextOptions = {
        viewport: { width: 1365, height: 900 },
        ignoreHTTPSErrors: true,
      };
      if (authStatePath) contextOptions.storageState = authStatePath;
      const context = await browser.newContext(contextOptions);

      try {
        const page = await context.newPage();
        const opened = await openRoute(page, '/');
        if (!opened.ok) {
          localeEntry.status = 'blocked';
          localeEntry.reason = opened.reason;
          payload.locales.push(localeEntry);
          continue;
        }

        const authState = await isAuthorizedSession(page);
        if (!authState.ok) {
          const tokenRecovery = await tryAuthorizeWithToken(context, page);
          localeEntry.tokenRecovery = tokenRecovery;
          if (!tokenRecovery.ok) {
            localeEntry.status = 'blocked';
            localeEntry.reason = authState.reason;
            payload.locales.push(localeEntry);
            continue;
          }
        }

        const switchResult = await switchLanguage(page, option, languageInventory.mode);
        localeEntry.switch = switchResult;
        if (!switchResult.ok) {
          localeEntry.status = 'failed';
          localeEntry.reason = switchResult.reason;
          payload.locales.push(localeEntry);
          continue;
        }

        const routeCatalog = await buildLocalizationRouteCatalog(page);
        localeEntry.routeCatalog = routeCatalog;
        const routesToCheck = Array.isArray(routeCatalog.routes) ? routeCatalog.routes : [];
        const pageMatrix =
          routesToCheck.length > 0
            ? routesToCheck
            : CORE_LOCALIZATION_ROUTES.map((route) => ({
                key: routeKeyFromRoute(route),
                route,
                source: 'core-fallback',
              }));

        for (const pageDef of pageMatrix) {
          const pageResult = await runPageLocalizationCheck(page, pageDef, option);
          localeEntry.pages.push(pageResult);
          if (pageResult.status === 'failed') {
            localeEntry.status = 'failed';
          }
        }

        if (ENABLE_LINGUISTIC_CHECKS && localeEntry.status !== 'blocked') {
          const linguistic = await runLocaleLinguisticQualityCheck(localeEntry, option.code || '');
          localeEntry.linguistic = linguistic;
          if (!linguistic.ok) {
            localeEntry.status = 'failed';
            localeEntry.reason = linguistic.reason || 'Linguistic grammar/quality checks failed.';
          } else if (linguistic.partial && localeEntry.status === 'passed') {
            localeEntry.status = 'partial';
          }
        }

        if (localeEntry.status !== 'failed') {
          const blockedCount = localeEntry.pages.filter((item) => item.status === 'blocked').length;
          if (blockedCount === localeEntry.pages.length) {
            localeEntry.status = 'blocked';
            localeEntry.reason = 'All localization pages were blocked by WAF/challenge.';
          } else if (blockedCount > 0) {
            localeEntry.status = 'partial';
          }
        }

        payload.locales.push(localeEntry);
      } finally {
        await context.close().catch(() => null);
      }
    }

    await attachAndWrite(testInfo, 'localization-matrix.json', payload);

    const failedLocales = payload.locales.filter((item) => item.status === 'failed').length;
    const passedLocales = payload.locales.filter((item) => item.status === 'passed').length;
    const blockedLocales = payload.locales.filter((item) => item.status === 'blocked').length;
    const partialLocales = payload.locales.filter((item) => item.status === 'partial').length;

    if (blockedLocales === payload.locales.length) {
      markBlocked(testInfo, `Localization matrix blocked for all locales (${blockedLocales}).`);
      failIfStrictBlocked(
        testInfo,
        `Localization matrix blocked for all locales (${blockedLocales}).`
      );
      return;
    }

    if (LOCALIZATION_STRICT_BLOCKED && blockedLocales > 0) {
      throw new Error(
        `LOCALIZATION_STRICT_BLOCKED: ${blockedLocales}/${payload.locales.length} locale checks were blocked.`
      );
    }

    if (partialLocales > 0) {
      testInfo.annotations.push({
        type: 'partial',
        description: `Localization matrix partial locales: ${partialLocales}/${payload.locales.length}.`,
      });
    }

    expect(failedLocales, 'Localization matrix contains failed locale checks.').toBe(0);
    expect(
      passedLocales,
      'Expected at least one locale to pass full localization checks.'
    ).toBeGreaterThan(0);
  });
});

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLocaleLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.POSITIVE_INFINITY;
  return parsed;
}

function compactText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLanguageOptions(options) {
  const seen = new Set();
  const result = [];
  for (const option of options || []) {
    if (!option || typeof option !== 'object') continue;
    const text = compactText(option.text || '');
    const value = compactText(option.value || option.rawCode || '');
    const code = compactText(option.code || mapLocaleCodeToMarkers(value) || '');
    if (!text && !value) continue;
    const key = `${code.toLowerCase()}::${text.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...option,
      text: text || localeLabelFromCode(value) || value,
      value,
      code: code || inferLanguageCode(text, value),
    });
  }
  return result;
}

function normalizeInternalRoute(input) {
  const raw = String(input || '').trim();
  if (!raw || /^(mailto:|tel:|javascript:|data:)/i.test(raw)) return '';

  let url;
  try {
    url = new URL(raw, BASE_URL);
  } catch {
    return '';
  }

  if (BASE_ORIGIN && url.origin !== BASE_ORIGIN) return '';

  let pathname = String(url.pathname || '/').replace(/\/{2,}/g, '/');
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  const staticAssetRe =
    /\.(?:png|jpe?g|svg|gif|webp|ico|css|js|map|woff2?|ttf|eot|pdf|zip|xml|txt|mp4|webm)$/i;
  if (staticAssetRe.test(pathname)) return '';
  if (/\/(?:cdn-cgi|api|graphql|socket|ws)\b/i.test(pathname)) return '';

  const localeMatch = pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/i);
  const localePrefix = localeMatch ? `/${localeMatch[1]}` : '';
  const noLocalePath = localePrefix ? pathname.slice(localePrefix.length) || '/' : pathname;

  if (/^\/casino\/[^/]+\/[^/]+/i.test(noLocalePath)) {
    pathname = `${localePrefix}/casino/`;
  } else if (/^\/live-casino\/[^/]+\/[^/]+/i.test(noLocalePath)) {
    pathname = `${localePrefix}/live-casino/`;
  } else if (/^\/sports\/event\//i.test(noLocalePath)) {
    pathname = `${localePrefix}/sports/`;
  }

  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
  if (!pathname) pathname = '/';

  const keepSearch = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?sports\/$/i.test(pathname);
  return keepSearch && url.search ? `${pathname}${url.search}` : pathname;
}

function routeKeyFromRoute(route) {
  const normalized = String(route || '').split('?')[0];
  const key = normalized.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
  return key.toLowerCase();
}

async function collectInternalRoutesFromDom(page) {
  const hrefs = await page
    .evaluate(() => {
      const values = new Set();
      const nodes = document.querySelectorAll('a[href], [data-href], [data-link]');
      for (const node of nodes) {
        const attrs = ['href', 'data-href', 'data-link'];
        for (const attr of attrs) {
          const raw = node.getAttribute && node.getAttribute(attr);
          if (!raw) continue;
          values.add(String(raw));
        }
      }
      return Array.from(values);
    })
    .catch(() => []);

  const normalized = [];
  for (const href of hrefs) {
    const route = normalizeInternalRoute(href);
    if (!route) continue;
    normalized.push(route);
  }
  return Array.from(new Set(normalized));
}

async function collectRoutesFromCurrentView(page, sourceRoute, routeMap) {
  await expandSidebarForLanguage(page).catch(() => null);
  await scrollPageSurface(page, 1800).catch(() => null);
  const discovered = await collectInternalRoutesFromDom(page);
  for (const route of discovered) {
    if (routeMap.size >= ROUTE_DISCOVERY_MAX) break;
    if (!routeMap.has(route)) routeMap.set(route, `dom:${sourceRoute}`);
  }
}

async function buildLocalizationRouteCatalog(page) {
  const routeMap = new Map();
  const sources = [];

  const addSeedRoute = (route, source) => {
    const normalized = normalizeInternalRoute(route);
    if (!normalized || routeMap.size >= ROUTE_DISCOVERY_MAX) return;
    if (!routeMap.has(normalized)) routeMap.set(normalized, source);
  };

  for (const route of CORE_LOCALIZATION_ROUTES) addSeedRoute(route, 'core');
  for (const route of EXTRA_LOCALIZATION_ROUTES) addSeedRoute(route, 'env');

  const seeds = Array.from(new Set([...CORE_LOCALIZATION_ROUTES, ...EXTRA_LOCALIZATION_ROUTES]));
  const maxSeedSteps = Math.max(1, Math.min(ROUTE_DISCOVERY_CLICK_STEPS, seeds.length));

  for (let index = 0; index < maxSeedSteps; index += 1) {
    if (routeMap.size >= ROUTE_DISCOVERY_MAX) break;
    const seed = seeds[index];
    const opened = await openRoute(page, seed, {
      maxAttempts: 1,
      navigationTimeoutMs: 15000,
      settleWaitMs: 900,
    });
    sources.push({
      seed,
      ok: opened.ok,
      reason: opened.ok ? '' : opened.reason || '',
      finalUrl: opened.url || '',
    });
    if (!opened.ok) continue;
    addSeedRoute(seed, 'seed-opened');
    await collectRoutesFromCurrentView(page, seed, routeMap);
  }

  const routes = Array.from(routeMap.entries())
    .slice(0, ROUTE_DISCOVERY_MAX)
    .map(([route, source]) => ({
      key: routeKeyFromRoute(route),
      route,
      source,
    }));

  return {
    routeLimit: ROUTE_DISCOVERY_MAX,
    routeCount: routes.length,
    seedsChecked: Math.min(maxSeedSteps, seeds.length),
    routes,
    sources,
  };
}

function resolveAuthStatePath() {
  return AUTH_STATE_CANDIDATES.find((candidate) => {
    try {
      return Boolean(candidate && fs.existsSync(candidate));
    } catch {
      return false;
    }
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeReadJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseIsoDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveSigninCreds() {
  const candidates = [];
  for (const filePath of LOGIN_CREDS_STATE_CANDIDATES) {
    const payload = safeReadJson(filePath);
    if (!payload) continue;
    const email = compactText(payload.loginEmail || payload.email).toLowerCase();
    const password = String(payload.password || '').trim();
    if (!email || !password) continue;
    let mtime = 0;
    try {
      mtime = Number(fs.statSync(filePath).mtimeMs) || 0;
    } catch {
      mtime = 0;
    }
    const validationReady =
      payload.manualLoginReady === true &&
      String(payload.loginValidationStatus || '')
        .trim()
        .toLowerCase() === 'password-signin-ok';
    const score = Math.max(
      parseIsoDate(payload.loginValidationAt),
      parseIsoDate(payload.generatedAt),
      mtime
    );
    candidates.push({
      email,
      password,
      source: filePath,
      score,
      validationReady,
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.validationReady !== b.validationReady) return a.validationReady ? -1 : 1;
    return b.score - a.score;
  });
  return candidates[0];
}

function resolveAuthToken() {
  for (const candidate of AUTH_TOKEN_STATE_CANDIDATES) {
    const payload = safeReadJson(candidate);
    const token =
      payload && typeof payload.authToken === 'string' && payload.authToken.trim().length >= 12
        ? payload.authToken.trim()
        : '';
    if (token) {
      return { token, source: candidate };
    }
  }
  return { token: '', source: '' };
}

async function tryAuthorizeWithToken(context, page) {
  const attempts = [];
  const tokenState = resolveAuthToken();
  let tokenAuthReason = '';

  if (tokenState.token) {
    try {
      await applyAuthTokenCookie(context, tokenState.token, BASE_URL);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null);
      await waitForUiSettled(page, 1200).catch(() => null);
      await dismissOverlays(page).catch(() => null);
      const authState = await isAuthorizedSession(page);
      attempts.push({
        method: 'token-cookie',
        source: tokenState.source,
        ok: authState.ok,
        reason: authState.reason || '',
      });
      tokenAuthReason = authState.reason || '';
      if (authState.ok) {
        return { ok: true, source: tokenState.source, method: 'token-cookie', attempts };
      }
    } catch (err) {
      attempts.push({
        method: 'token-cookie',
        source: tokenState.source,
        ok: false,
        reason: compactText(err && err.message ? err.message : err),
      });
      tokenAuthReason = compactText(err && err.message ? err.message : err);
    }
  }

  if (/cloudflare|challenge|security verification/i.test(String(tokenAuthReason || ''))) {
    return {
      ok: false,
      reason: `Token recovery blocked by Cloudflare/challenge: ${tokenAuthReason}`,
      source: tokenState.source || '',
      attempts,
    };
  }

  const signinCreds = resolveSigninCreds();
  if (!signinCreds) {
    return {
      ok: false,
      reason: tokenState.token
        ? 'Token recovery did not produce authorized session and no sign-in credentials were found.'
        : 'No auth token/sign-in credentials found in artifacts.',
      source: tokenState.source || '',
      attempts,
    };
  }

  try {
    const previousSigninTimeout = process.env.PW_SIGNIN_CDP_TIMEOUT_MS;
    process.env.PW_SIGNIN_CDP_TIMEOUT_MS =
      process.env.PW_LOCALIZATION_SIGNIN_CDP_TIMEOUT_MS || '35000';
    let signin = null;
    try {
      signin = await validatePlayerSigninViaCdpTurnstile({
        data: {
          email: signinCreds.email,
          password: signinCreds.password,
        },
        baseUrl: BASE_URL,
      });
    } finally {
      if (previousSigninTimeout) {
        process.env.PW_SIGNIN_CDP_TIMEOUT_MS = previousSigninTimeout;
      } else {
        delete process.env.PW_SIGNIN_CDP_TIMEOUT_MS;
      }
    }
    attempts.push({
      method: 'cdp-signin-turnstile',
      source: signinCreds.source,
      ok: Boolean(signin && signin.ok),
      status: signin ? signin.status : 0,
      errorCode:
        signin && signin.body && typeof signin.body.errorCode === 'string'
          ? signin.body.errorCode
          : '',
      errorMessage:
        signin && signin.body && typeof signin.body.errorMessage === 'string'
          ? signin.body.errorMessage
          : '',
    });

    const token =
      signin && signin.ok && signin.body && typeof signin.body.token === 'string'
        ? signin.body.token.trim()
        : '';
    if (!token) {
      return {
        ok: false,
        reason: 'CDP sign-in fallback did not return auth token.',
        source: signinCreds.source,
        attempts,
      };
    }

    await applyAuthTokenCookie(context, token, BASE_URL);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null);
    await waitForUiSettled(page, 1200).catch(() => null);
    await dismissOverlays(page).catch(() => null);
    const authState = await isAuthorizedSession(page);
    if (!authState.ok) {
      return {
        ok: false,
        reason: authState.reason || 'CDP sign-in token did not create authorized session.',
        source: signinCreds.source,
        attempts,
      };
    }
    return {
      ok: true,
      source: signinCreds.source,
      method: 'cdp-signin-turnstile',
      attempts,
    };
  } catch (err) {
    return {
      ok: false,
      reason: compactText(err && err.message ? err.message : err),
      source: signinCreds.source,
      attempts,
    };
  }
}

function inferLanguageCode(text, value = '') {
  const input = `${String(text || '')} ${String(value || '')}`.toLowerCase();
  if (/^en\b|english/.test(input)) return 'en';
  if (/^ru\b|рус|russian/.test(input)) return 'ru';
  if (/^uk\b|укра|укра|ukrainian/.test(input)) return 'uk';
  if (/^es\b|espa|spanish/.test(input)) return 'es';
  if (/^pt\b|portu|portuguese/.test(input)) return 'pt';
  if (/^de\b|deut|german/.test(input)) return 'de';
  if (/^fr\b|fran|french/.test(input)) return 'fr';
  if (/^it\b|ital|italian/.test(input)) return 'it';
  if (/^el\b|ελλ|greek/.test(input)) return 'el';
  if (/^no\b|norge|norwegian/.test(input)) return 'no';
  if (/^pl\b|polski|polish/.test(input)) return 'pl';
  const valueTwo = String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if (/^[a-z]{2}$/.test(valueTwo)) return valueTwo;
  return '';
}

function normalizeLocaleCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

function mapLocaleCodeToMarkers(value) {
  const normalized = normalizeLocaleCode(value);
  if (!normalized) return '';
  if (normalized === 'br') return 'pt';
  if (normalized === 'ua') return 'uk';
  if (normalized === 'cl') return 'es';
  if (normalized === 'de-ch') return 'de';
  if (normalized === 'fr-ca' || normalized === 'ca-fr') return 'fr';
  if (normalized === 'ca-en' || normalized === 'au' || normalized === 'nz' || normalized === 'ie') {
    return 'en';
  }
  const shortCode = normalized.split('-')[0];
  return /^[a-z]{2}$/.test(shortCode) ? shortCode : normalized;
}

function localeLabelFromCode(value) {
  const normalized = normalizeLocaleCode(value);
  if (!normalized) return '';
  return normalized.toUpperCase();
}

function localeCodeAliases(code) {
  const normalized = normalizeLocaleCode(code);
  if (!normalized) return [];

  const aliases = new Set();
  aliases.add(normalized);
  aliases.add(normalized.replace(/-/g, '_'));
  aliases.add(normalized.replace(/_/g, '-'));

  const shortCode = normalized.split('-')[0];
  if (shortCode) aliases.add(shortCode);

  if (normalized === 'pt' || normalized === 'br') {
    aliases.add('pt');
    aliases.add('br');
  }
  if (normalized === 'uk' || normalized === 'ua') {
    aliases.add('uk');
    aliases.add('ua');
  }
  if (normalized === 'fr' || normalized === 'fr-ca' || normalized === 'ca-fr') {
    aliases.add('fr');
    aliases.add('fr-ca');
    aliases.add('ca-fr');
    aliases.add('fr_ca');
  }
  if (normalized === 'de' || normalized === 'de-ch') {
    aliases.add('de');
    aliases.add('de-ch');
  }
  if (normalized === 'es' || normalized === 'cl') {
    aliases.add('es');
    aliases.add('cl');
  }
  if (
    normalized === 'en' ||
    normalized === 'ca-en' ||
    normalized === 'au' ||
    normalized === 'nz' ||
    normalized === 'ie'
  ) {
    aliases.add('en');
    aliases.add('ca-en');
    aliases.add('au');
    aliases.add('nz');
    aliases.add('ie');
  }

  return Array.from(aliases).filter(Boolean);
}

async function writeArtifact(name, payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  return artifactPath;
}

async function attachAndWrite(testInfo, name, payload) {
  await testInfo.attach(name, {
    body: JSON.stringify(payload, null, 2),
    contentType: 'application/json',
  });
  const artifactPath = await writeArtifact(name, payload);
  testInfo.annotations.push({ type: 'artifact', description: artifactPath });
}

function failIfStrictBlocked(testInfo, reason) {
  if (!LOCALIZATION_STRICT_BLOCKED) return;
  const message = compactText(reason || 'Localization step was blocked.');
  testInfo.annotations.push({ type: 'strict-blocked', description: message });
  throw new Error(`LOCALIZATION_STRICT_BLOCKED: ${message}`);
}

async function openRoute(page, route, options = {}) {
  const targetUrl = new URL(route, BASE_URL).toString();
  const autoBypassEnabled = process.env.PW_AUTO_BYPASS_CF !== '0';
  const defaultAttempts = autoBypassEnabled ? 2 : 1;
  const maxAttempts = toPositiveInt(
    options.maxAttempts || String(defaultAttempts),
    defaultAttempts
  );
  const autoBypassTimeoutMs = toPositiveInt(
    process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '22000',
    22000
  );
  const navigationTimeoutMs = toPositiveInt(
    options.navigationTimeoutMs || LOCALIZATION_NAV_TIMEOUT_MS,
    LOCALIZATION_NAV_TIMEOUT_MS
  );
  const settleWaitMs = toPositiveInt(
    options.settleWaitMs || LOCALIZATION_SETTLE_WAIT_MS,
    LOCALIZATION_SETTLE_WAIT_MS
  );
  const result = {
    route,
    targetUrl,
    ok: false,
    url: '',
    status: null,
    title: '',
    reason: '',
    attempts: [],
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let status = null;
    let url = '';
    let title = '';
    let reason = '';

    try {
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs,
      });
      await waitForUiSettled(page, settleWaitMs).catch(() => null);
      await dismissOverlays(page).catch(() => null);
      status = response ? response.status() : null;
      url = page.url();
      title = compactText(await page.title().catch(() => ''));
      const challenge = await detectCloudflare(page).catch(() => null);
      if (challenge) reason = challenge;
    } catch (err) {
      reason = compactText(err && err.message ? err.message : err);
      status = status || 0;
      url = page.url();
      title = compactText(await page.title().catch(() => ''));
    }

    if (!reason) {
      const challenge = await detectCloudflare(page).catch(() => null);
      if (challenge) reason = challenge;
    }
    if (!reason) {
      const bodyText = compactText(await page.textContent('body').catch(() => ''));
      if (/performing security verification|verify you are human|just a moment/i.test(bodyText)) {
        reason = 'Cloudflare challenge detected (security verification page).';
      }
    }

    const challengeLike =
      /__cf_chl|cdn-cgi|challenge|just a moment/i.test(String(url || '')) ||
      /just a moment|attention required/i.test(String(title || '')) ||
      /cloudflare|challenge|security verification/i.test(String(reason || '')) ||
      Number(status || 0) === 403;

    result.attempts.push({ attempt, status, url, title, reason });

    if (challengeLike && autoBypassEnabled) {
      const bypass = await tryAutoBypassCloudflare(page, autoBypassTimeoutMs).catch(() => ({
        resolved: false,
        attemptedInteraction: false,
      }));
      if (bypass && bypass.resolved) {
        await waitForUiSettled(page, settleWaitMs).catch(() => null);
        await dismissOverlays(page).catch(() => null);
        continue;
      }
      if (bypass && bypass.attemptedInteraction && !reason) {
        reason = 'Cloudflare challenge detected (auto-bypass attempted).';
      }
    }

    if (!challengeLike || attempt === maxAttempts) {
      result.status = status;
      result.url = url;
      result.title = title;
      result.reason = reason || (status >= 400 ? `HTTP ${status}` : '');
      break;
    }

    await sleep(1600 + attempt * 400);
  }

  if (!result.reason && result.status && result.status >= 400) {
    result.reason = `HTTP ${result.status}`;
  }
  if (!result.reason) {
    result.ok = true;
  }
  return result;
}

async function isAuthorizedSession(page) {
  const challenge = await detectCloudflare(page).catch(() => null);
  if (challenge) {
    return { ok: false, reason: challenge, challenge: true };
  }

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);

  const loginVisible = await page
    .getByRole('button', { name: /log in/i })
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  const profileHint = await page
    .locator(
      '[href*="/profile"], [href*="/assets"], [data-testid*="avatar" i], [data-testid*="account" i]'
    )
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);

  const hasAuthCookie = await page
    .evaluate(() => {
      const raw = document.cookie || '';
      return /(?:^|;\s*)auth\._token\.local=/.test(raw);
    })
    .catch(() => false);

  if (!loginVisible && profileHint && appRootVisible) {
    return { ok: true, loginVisible, profileHint, hasAuthCookie, appRootVisible };
  }

  const authProbe = await page
    .evaluate(async () => {
      const endpoints = [
        '/api/profile',
        '/api/profile/',
        '/api/user/profile',
        '/api/auth/me',
        '/api/auth/profile',
      ];
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
          });
          const status = response.status;
          if (status === 401 || status === 403) {
            return { ok: false, status, endpoint };
          }
          if (status === 200) {
            return { ok: true, status, endpoint };
          }
        } catch {
          // try next endpoint
        }
      }
      return { ok: false, status: 0, endpoint: '' };
    })
    .catch(() => ({ ok: false, status: 0, endpoint: '' }));

  if (
    hasAuthCookie &&
    appRootVisible &&
    (authProbe.ok || Number(authProbe.status || 0) === 200 || Number(authProbe.status || 0) === 0)
  ) {
    return {
      ok: true,
      loginVisible,
      profileHint,
      hasAuthCookie,
      appRootVisible,
      authProbe,
    };
  }

  const reason = loginVisible
    ? 'Session appears to be guest (Log In is visible).'
    : 'Authorized markers were not detected (profile/auth probe failed).';
  return {
    ok: false,
    reason,
    loginVisible,
    profileHint,
    hasAuthCookie,
    appRootVisible,
    authProbe,
  };
}

async function firstVisibleLocator(scope, selectors) {
  for (const selector of selectors) {
    const matches = scope.locator(selector);
    const count = await matches.count().catch(() => 0);
    const cap = Math.min(count, 8);
    for (let i = 0; i < cap; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return { locator, selector };
    }
  }
  return null;
}

async function collectDropdownOptions(page) {
  return page
    .locator(LANGUAGE_OPTION_SELECTOR)
    .evaluateAll((nodes) => {
      function isVisible(node) {
        const style = window.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      }

      const seen = new Set();
      return nodes
        .filter((node) => isVisible(node))
        .map((node) => ({
          text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
          value: node.getAttribute('value') || node.getAttribute('data-value') || '',
        }))
        .filter((item) => {
          const key = `${item.text}`.toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    })
    .then((items) =>
      items.map((item) => ({
        text: item.text,
        value: item.value,
        code: inferLanguageCode(item.text, item.value),
      }))
    )
    .catch(() => []);
}

async function findDropdownTrigger(page) {
  await expandSidebarForLanguage(page);
  const found = await firstVisibleLocator(page, LANGUAGE_TRIGGER_SELECTORS);
  if (!found) return null;
  return found;
}

async function openLanguageDropdown(page, triggerLocator) {
  await triggerLocator.scrollIntoViewIfNeeded().catch(() => null);
  await triggerLocator.click({ timeout: 7000 }).catch(() => null);
  await waitForUiSettled(page, 900);
  let options = await collectDropdownOptions(page);
  if (options.length > 0) return options;
  await triggerLocator.click({ timeout: 7000, force: true }).catch(() => null);
  await waitForUiSettled(page, 900);
  options = await collectDropdownOptions(page);
  return options;
}

async function selectFromDropdown(page, optionText) {
  const escaped = escapeRegExp(optionText);
  const option = page
    .locator(LANGUAGE_OPTION_SELECTOR)
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
    .first();
  const visible = await option.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) return { ok: false, reason: `Language option "${optionText}" is not visible.` };
  await option.click({ timeout: 8000 }).catch(() => null);
  await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => null);
  await waitForUiSettled(page, 1600);
  return { ok: true };
}

async function findPreferencesSelect(page) {
  for (const route of PROFILE_PREFERENCES_ROUTES) {
    const opened = await openRoute(page, route, {
      maxAttempts: 1,
      navigationTimeoutMs: 12000,
      settleWaitMs: 900,
    });
    if (!opened.ok) continue;

    const select = await firstVisibleLocator(page, ['select', '[class*="language" i] select']);
    if (!select) continue;
    const options = await select.locator
      .locator('option')
      .allTextContents()
      .catch(() => []);
    if (options.length < 2) continue;
    return { route, selector: select.selector, locator: select.locator };
  }
  return null;
}

async function collectSelectOptions(selectLocator) {
  return selectLocator
    .locator('option')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
          value: node.getAttribute('value') || '',
        }))
        .filter((item) => Boolean(item.value || item.text))
    )
    .then((items) =>
      items.map((item) => ({
        text: item.text,
        value: item.value,
        code: inferLanguageCode(item.text, item.value),
      }))
    )
    .catch(() => []);
}

async function discoverNuxtI18nLocales(page) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await page
      .evaluate(() => {
        const nuxt = window.$nuxt || null;
        const i18n = nuxt && nuxt.$i18n ? nuxt.$i18n : null;
        if (!i18n) return null;

        const localesRaw = Array.isArray(i18n.locales) ? i18n.locales : [];
        const current = String(i18n.locale || '').trim();
        const seen = new Set();
        const options = [];
        for (const item of localesRaw) {
          const rawCode =
            typeof item === 'string'
              ? String(item || '').trim()
              : String(
                  (item && (item.code || item.iso || item.name || item.locale || item.value)) || ''
                ).trim();
          if (!rawCode) continue;
          const key = rawCode.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          const name =
            typeof item === 'object' && item
              ? String(item.name || item.label || item.code || item.iso || rawCode)
              : rawCode;
          const iso = typeof item === 'object' && item && item.iso ? String(item.iso) : '';
          const dir = typeof item === 'object' && item && item.dir ? String(item.dir) : '';

          options.push({
            rawCode,
            text: (name || rawCode).trim(),
            iso,
            dir,
          });
        }

        return {
          current,
          options,
        };
      })
      .catch(() => null);

    if (result && Array.isArray(result.options) && result.options.length > 1) {
      return result;
    }
    await sleep(350);
  }

  return null;
}

async function resolveLanguageControl(page) {
  const nuxtLocales = await discoverNuxtI18nLocales(page);
  if (nuxtLocales && Array.isArray(nuxtLocales.options) && nuxtLocales.options.length > 1) {
    const options = nuxtLocales.options.map((item) => ({
      text: compactText(item.text || '') || localeLabelFromCode(item.rawCode),
      value: item.rawCode,
      code: mapLocaleCodeToMarkers(item.rawCode),
      rawCode: item.rawCode,
      iso: item.iso || '',
      dir: item.dir || '',
    }));
    const currentRaw = compactText(nuxtLocales.current || '');
    const currentOption =
      options.find((item) => normalizeLocaleCode(item.value) === normalizeLocaleCode(currentRaw)) ||
      null;
    return {
      mode: 'nuxt-i18n',
      current: currentOption ? currentOption.text : localeLabelFromCode(currentRaw),
      options,
      details: {
        source: 'window.$nuxt.$i18n.locales',
        currentRaw,
      },
    };
  }

  const dropdownTrigger = await findDropdownTrigger(page);
  if (dropdownTrigger) {
    const current = compactText(await dropdownTrigger.locator.innerText().catch(() => ''));
    const options = await openLanguageDropdown(page, dropdownTrigger.locator);
    if (options.length > 1) {
      return {
        mode: 'dropdown',
        current,
        options,
        details: { selector: dropdownTrigger.selector },
      };
    }
  }

  const selectControl = await findPreferencesSelect(page);
  if (selectControl) {
    const options = await collectSelectOptions(selectControl.locator);
    const currentValue = await selectControl.locator.inputValue().catch(() => '');
    const currentOption = options.find((item) => item.value === currentValue) || null;
    return {
      mode: 'select',
      current: currentOption ? currentOption.text : '',
      options,
      details: { route: selectControl.route, selector: selectControl.selector },
    };
  }

  return { mode: 'none', current: '', options: [], details: {} };
}

async function switchLanguage(page, option, mode) {
  if (mode === 'dropdown') {
    const opened = await openRoute(page, '/', {
      maxAttempts: 1,
      navigationTimeoutMs: 15000,
      settleWaitMs: 900,
    });
    if (!opened.ok) return { ok: false, reason: opened.reason || 'Cannot open home route.' };
    await expandSidebarForLanguage(page);
    const trigger = await findDropdownTrigger(page);
    if (!trigger) return { ok: false, reason: 'Language trigger is not visible on home route.' };
    await openLanguageDropdown(page, trigger.locator);
    const selected = await selectFromDropdown(page, option.text);
    if (!selected.ok) return selected;
    const afterLabel = compactText(await trigger.locator.innerText().catch(() => ''));
    const afterUrl = page.url();
    const localeCookies = await collectLocaleCookieValues(page);
    const selectedLower = compactText(option.text).toLowerCase();
    const afterLabelLower = afterLabel.toLowerCase();
    const labelMatch =
      afterLabelLower.includes(selectedLower) || selectedLower.includes(afterLabelLower);
    const code = normalizeLocaleCode(option.code || option.value || option.rawCode || '');
    const pathLower = (() => {
      try {
        return new URL(afterUrl).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const codeAliases = localeCodeAliases(code);
    const urlMatch = codeAliases.some((alias) => pathLower.startsWith(`/${alias}/`));
    const cookieMatch = codeAliases.some((alias) =>
      localeCookies.some((item) => item.toLowerCase().includes(alias))
    );
    const matched = labelMatch || urlMatch || cookieMatch;
    return {
      ok: matched,
      selected: option.text,
      afterLabel,
      afterUrl,
      localeCookies,
      labelMatch,
      urlMatch,
      cookieMatch,
      matched,
      reason: matched
        ? ''
        : `Locale switch is not confirmed (label/url/cookie mismatch) for "${option.text}".`,
    };
  }

  if (mode === 'nuxt-i18n') {
    const targetRaw = compactText(option.value || option.rawCode || option.code || '');
    if (!targetRaw) {
      return { ok: false, reason: `Locale "${option.text}" has no target code.` };
    }

    const setLocaleResult = await page
      .evaluate(async (code) => {
        const nuxt = window.$nuxt || null;
        const i18n = nuxt && nuxt.$i18n ? nuxt.$i18n : null;
        if (!i18n) return { ok: false, reason: 'Nuxt i18n object is not available.' };
        if (typeof i18n.setLocale !== 'function') {
          return { ok: false, reason: 'Nuxt i18n setLocale is unavailable.' };
        }
        try {
          await i18n.setLocale(code);
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            reason: String(err && err.message ? err.message : err),
          };
        }
      }, targetRaw)
      .catch((err) => ({
        ok: false,
        reason: compactText(err && err.message ? err.message : err),
      }));

    if (!setLocaleResult.ok) {
      const routeOpen = await openRoute(page, `/${targetRaw}/`, {
        maxAttempts: 1,
        navigationTimeoutMs: 15000,
        settleWaitMs: 900,
      });
      if (!routeOpen.ok) {
        return {
          ok: false,
          reason:
            `Locale switch failed via nuxt-i18n and route fallback: ${setLocaleResult.reason}; ${routeOpen.reason || ''}`.trim(),
        };
      }
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => null);
    await waitForUiSettled(page, 1400);
    const afterUrl = page.url();
    const localeSignals = await page
      .evaluate(() => {
        const nuxt = window.$nuxt || null;
        const i18nLocale = nuxt && nuxt.$i18n ? String(nuxt.$i18n.locale || '') : '';
        const htmlLang =
          document && document.documentElement ? String(document.documentElement.lang || '') : '';
        const storageValues = [];
        try {
          if (window.localStorage) {
            for (let i = 0; i < window.localStorage.length; i += 1) {
              const key = window.localStorage.key(i);
              if (!key) continue;
              if (!/(locale|lang|i18n)/i.test(String(key))) continue;
              const value = String(window.localStorage.getItem(key) || '').trim();
              if (!value) continue;
              storageValues.push(value);
            }
          }
        } catch {
          // ignore storage access issues
        }
        return { i18nLocale, htmlLang, storageValues };
      })
      .catch(() => ({ i18nLocale: '', htmlLang: '', storageValues: [] }));
    const currentLocale = String(localeSignals.i18nLocale || '').trim();
    const htmlLang = String(localeSignals.htmlLang || '').trim();
    const storageValues = Array.isArray(localeSignals.storageValues)
      ? localeSignals.storageValues.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const localeCookies = await collectLocaleCookieValues(page);
    const pathLower = (() => {
      try {
        return new URL(afterUrl).pathname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const codeAliases = localeCodeAliases(targetRaw);
    if (option.code) {
      for (const alias of localeCodeAliases(option.code)) {
        if (!codeAliases.includes(alias)) codeAliases.push(alias);
      }
    }
    const urlMatch = codeAliases.some((alias) => pathLower.startsWith(`/${alias}/`));
    const defaultLocaleUnprefixed =
      codeAliases.includes('en') && !/^\/[a-z]{2}(?:-[a-z]{2})?\//i.test(pathLower);
    const localeMatch = codeAliases.includes(normalizeLocaleCode(currentLocale));
    const htmlLangMatch = codeAliases.some((alias) =>
      normalizeLocaleCode(htmlLang).startsWith(alias)
    );
    const storageMatch = codeAliases.some((alias) =>
      storageValues.some((value) => normalizeLocaleCode(value).includes(alias))
    );
    const cookieMatch = codeAliases.some((alias) =>
      localeCookies.some((item) => item.toLowerCase().includes(alias))
    );
    const matched =
      urlMatch ||
      localeMatch ||
      cookieMatch ||
      htmlLangMatch ||
      storageMatch ||
      defaultLocaleUnprefixed;

    if (matched) {
      return {
        ok: true,
        selected: option.text,
        targetRaw,
        currentLocale,
        htmlLang,
        storageValues,
        afterUrl,
        localeCookies,
        urlMatch,
        defaultLocaleUnprefixed,
        localeMatch,
        htmlLangMatch,
        storageMatch,
        cookieMatch,
        matched: true,
        reason: '',
      };
    }

    const fallbackCandidates = Array.from(
      new Set(
        [targetRaw, option.code, mapLocaleCodeToMarkers(targetRaw)]
          .map((item) => normalizeLocaleCode(item))
          .filter(Boolean)
      )
    );
    if (fallbackCandidates.includes('en')) fallbackCandidates.unshift('');
    if (!fallbackCandidates.length) fallbackCandidates.push('');

    const fallbackAttempts = [];
    for (const candidate of fallbackCandidates) {
      const route = candidate ? `/${candidate}/` : '/';
      const opened = await openRoute(page, route, {
        maxAttempts: 1,
        navigationTimeoutMs: 8000,
        settleWaitMs: 700,
      });
      const sample = opened.ok ? await collectUiSample(page) : '';
      const analysis = opened.ok ? analyzeSampleLocale(sample, option.code || '') : null;
      const ok = opened.ok && analysis && analysis.ok;
      fallbackAttempts.push({
        route,
        openOk: opened.ok,
        reason: opened.reason || '',
        analysis: analysis || null,
      });
      if (ok) {
        return {
          ok: true,
          selected: option.text,
          targetRaw,
          currentLocale,
          htmlLang,
          storageValues,
          afterUrl: page.url(),
          localeCookies,
          urlMatch,
          defaultLocaleUnprefixed,
          localeMatch,
          htmlLangMatch,
          storageMatch,
          cookieMatch,
          matched: true,
          fallbackValidated: true,
          fallbackRoute: route,
          fallbackAttempts,
          reason: '',
        };
      }
    }

    return {
      ok: false,
      selected: option.text,
      targetRaw,
      currentLocale,
      htmlLang,
      storageValues,
      afterUrl,
      localeCookies,
      urlMatch,
      defaultLocaleUnprefixed,
      localeMatch,
      htmlLangMatch,
      storageMatch,
      cookieMatch,
      matched: false,
      fallbackAttempts,
      reason: `Locale switch is not confirmed for "${targetRaw}" (url/locale/htmlLang/storage/cookie mismatch).`,
    };
  }

  if (mode === 'select') {
    const selectControl = await findPreferencesSelect(page);
    if (!selectControl) {
      return {
        ok: false,
        reason: 'Language select control is not reachable in profile preferences.',
      };
    }

    const targetValue = option.value || option.code || '';
    if (!targetValue) {
      return { ok: false, reason: `Locale "${option.text}" has no selectable value/code.` };
    }

    await selectControl.locator.selectOption(targetValue).catch(() => null);
    await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => null);
    await waitForUiSettled(page, 1300);
    const afterValue = await selectControl.locator.inputValue().catch(() => '');
    return {
      ok: String(afterValue) === String(targetValue),
      selected: option.text,
      afterValue,
      expected: targetValue,
      reason:
        String(afterValue) === String(targetValue)
          ? ''
          : `Select value mismatch: expected=${targetValue}, got=${afterValue}`,
    };
  }

  return { ok: false, reason: `Unsupported language control mode: ${mode}` };
}

async function collectLocaleCookieValues(page) {
  return page
    .evaluate(() => document.cookie || '')
    .then((raw) =>
      String(raw)
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const divider = entry.indexOf('=');
          return divider >= 0 ? entry.slice(divider + 1) : '';
        })
        .filter(Boolean)
    )
    .catch(() => []);
}

async function expandSidebarForLanguage(page) {
  const appClass = await page
    .locator('.app')
    .first()
    .getAttribute('class', { timeout: 1200 })
    .catch(() => '');
  const isCollapsed = /(^|\s)collapsed(\s|$)/i.test(String(appClass || ''));
  if (!isCollapsed) return;

  const toggleSelectors = [
    '[data-testid="sidebar-burger-button"]',
    '[data-testid="header-burger-button"]',
    '.t-header__toggle',
    'button[aria-label*="menu" i]',
    'button[class*="burger" i]',
  ];

  for (const selector of toggleSelectors) {
    const toggle = page.locator(selector).first();
    const visible = await toggle.isVisible({ timeout: 600 }).catch(() => false);
    if (!visible) continue;
    await toggle.click({ timeout: 6000 }).catch(() => null);
    await waitForUiSettled(page, 900).catch(() => null);
    const nextClass = await page
      .locator('.app')
      .first()
      .getAttribute('class', { timeout: 1200 })
      .catch(() => '');
    const stillCollapsed = /(^|\s)collapsed(\s|$)/i.test(String(nextClass || ''));
    if (!stillCollapsed) return;
  }
}

async function clickFirstVisible(page, selectors) {
  const found = await firstVisibleLocator(page, selectors);
  if (!found) return { clicked: false, selector: '' };
  await found.locator.scrollIntoViewIfNeeded().catch(() => null);
  await found.locator.click({ timeout: 7000 }).catch(() => null);
  await waitForUiSettled(page, 700).catch(() => null);
  return { clicked: true, selector: found.selector };
}

async function runPageLocalizationCheck(page, pageDef, localeOption) {
  const result = {
    page: pageDef.key,
    route: pageDef.route,
    source: pageDef.source || 'dynamic',
    status: 'passed',
    interaction: { clicked: false, selector: '' },
    scroll: null,
    analysis: null,
  };

  const quickOpen = await openRoute(page, pageDef.route, {
    maxAttempts: 1,
    navigationTimeoutMs: 15000,
    settleWaitMs: 900,
  });
  result.open = quickOpen;
  if (!quickOpen.ok) {
    result.status = 'blocked';
    result.reason = quickOpen.reason;
    return result;
  }

  result.scroll = await scrollPageSurface(page, 2200);
  result.interaction = await exercisePageControls(page, pageDef.key);
  const sample = await collectUiSample(page);
  result.sample = sample.slice(0, 1200);

  const analysis = analyzeSampleLocale(sample, localeOption.code || '');
  result.analysis = analysis;
  if (!analysis.ok) {
    result.status = 'failed';
    result.reason = analysis.reason;
  }

  return result;
}

async function scrollPageSurface(page, distance = 1800) {
  return page
    .evaluate(async (scrollDistance) => {
      const before = {
        y: window.scrollY || window.pageYOffset || 0,
        height: document.documentElement ? document.documentElement.scrollHeight : 0,
      };
      const steps = 6;
      const increment = Math.max(120, Math.floor(Number(scrollDistance || 1200) / steps));
      for (let i = 0; i < steps; i += 1) {
        window.scrollBy(0, increment);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
      const after = {
        y: window.scrollY || window.pageYOffset || 0,
        height: document.documentElement ? document.documentElement.scrollHeight : 0,
      };
      return {
        before,
        after,
        moved: after.y !== before.y,
      };
    }, distance)
    .catch(() => ({
      before: { y: 0, height: 0 },
      after: { y: 0, height: 0 },
      moved: false,
    }));
}

async function exercisePageControls(page, key) {
  if (key === 'home') {
    return clickFirstVisible(page, ['header a[href*="/casino"]', 'header a[href*="/sports"]']);
  }
  if (key === 'sports') {
    return clickFirstVisible(page, [
      '[data-testid*="sports" i] button',
      '[class*="sports" i] button',
      '[class*="sports" i] [role="tab"]',
    ]);
  }
  if (key === 'casino') {
    const searchClick = await clickFirstVisible(page, [
      '[data-testid*="search" i]',
      '.t-search__button',
      '.t-games-search__button',
    ]);
    if (searchClick.clicked) {
      await clickFirstVisible(page, [
        '[data-testid*="close" i]',
        '.t-search__close',
        '.t-modal__close',
      ]);
      return searchClick;
    }
    return clickFirstVisible(page, [
      '[data-testid*="filter" i]',
      '.t-games-filters__button',
      '.t-games-filter__button',
    ]);
  }
  if (key === 'livecasino') {
    return clickFirstVisible(page, [
      '[data-testid*="search" i]',
      '[data-testid*="filter" i]',
      '.t-games-filters__button',
    ]);
  }
  if (key === 'profile') {
    return clickFirstVisible(page, [
      '[href*="/profile/security"]',
      '[href*="/profile/preferences"]',
      '[data-testid*="profile" i] a',
    ]);
  }
  if (key === 'deposit') {
    return clickFirstVisible(page, [
      '.t-pay-system-item',
      '[data-testid*="pay-system" i]',
      '[class*="pay-system" i] button',
    ]);
  }
  return clickFirstVisible(page, [
    '[data-testid*="search" i]',
    '[data-testid*="filter" i]',
    '[role="tab"]',
    'button',
    'a[href]',
  ]);
}

async function collectUiSample(page) {
  return page
    .locator('h1, h2, h3, button, [role="button"], a[href], label, [data-testid]')
    .evaluateAll((nodes) => {
      const seen = new Set();
      const lines = [];
      for (const node of nodes) {
        const style = window.getComputedStyle(node);
        if (!style || style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(text);
        if (lines.length >= 120) break;
      }
      return lines.join(' | ');
    })
    .catch(() => '');
}

function toLocaleLanguageCode(code) {
  const normalized = mapLocaleCodeToMarkers(code || '') || normalizeLocaleCode(code || '');
  return LINGUISTIC_LANGUAGE_MAP[normalized] || '';
}

function normalizeLinguisticText(input, maxLen = LINGUISTIC_MAX_TEXT_CHARS) {
  const clean = compactText(String(input || ''))
    .replace(/\s*\|\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.slice(0, Math.max(120, maxLen));
}

function collectLinguisticHeuristics(text) {
  const issues = [];
  if (!text) return { issues, severeCount: 0 };

  if (/(?:Ã.|Â|â€™|â€œ|â€|Ð.|Ñ.)/.test(text)) {
    issues.push({
      severity: 'high',
      code: 'mojibake',
      message: 'Possible encoding artifacts (mojibake) detected.',
    });
  }

  if (/\{\{[^}]+\}\}|\{[a-z0-9_.-]{2,}\}|%\d*\$?[sd]/i.test(text)) {
    issues.push({
      severity: 'medium',
      code: 'placeholder-leak',
      message: 'Template placeholder tokens are visible in localized UI text.',
    });
  }

  if (/[!?.,:;]{4,}/.test(text)) {
    issues.push({
      severity: 'low',
      code: 'punctuation-repeat',
      message: 'Repeated punctuation sequence detected.',
    });
  }

  const openRound = (text.match(/\(/g) || []).length;
  const closeRound = (text.match(/\)/g) || []).length;
  const openSquare = (text.match(/\[/g) || []).length;
  const closeSquare = (text.match(/]/g) || []).length;
  const openCurly = (text.match(/\{/g) || []).length;
  const closeCurly = (text.match(/}/g) || []).length;
  if (
    Math.abs(openRound - closeRound) > 2 ||
    Math.abs(openSquare - closeSquare) > 1 ||
    Math.abs(openCurly - closeCurly) > 1
  ) {
    issues.push({
      severity: 'medium',
      code: 'brackets-unbalanced',
      message: 'Potentially unbalanced brackets in localized UI text.',
    });
  }

  const severeCount = issues.filter((item) => item.severity === 'high').length;
  return { issues, severeCount };
}

function trimLanguageToolContext(context) {
  const text = compactText(context || '');
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

async function runLanguageToolGrammarCheck(text, localeCode) {
  const language = toLocaleLanguageCode(localeCode);
  if (!language) {
    return {
      ok: true,
      skipped: true,
      partial: true,
      reason: `No grammar API mapping for locale "${localeCode || 'unknown'}".`,
      language,
      issueCount: 0,
      matches: [],
    };
  }

  const payload = new globalThis.URLSearchParams();
  payload.set('language', language);
  payload.set('text', text);

  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), LINGUISTIC_TIMEOUT_MS);
  try {
    const response = await fetch(LINGUISTIC_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: true,
        skipped: true,
        partial: true,
        reason: `Grammar API unavailable (${response.status}).`,
        language,
        status: response.status,
        issueCount: 0,
        matches: [],
      };
    }

    const body = await response.json().catch(() => ({}));
    const rawMatches = Array.isArray(body.matches) ? body.matches : [];
    const filteredMatches = rawMatches
      .filter((match) => {
        const categoryId = String(
          match && match.rule && match.rule.category && match.rule.category.id
        )
          .trim()
          .toUpperCase();
        if (LINGUISTIC_IGNORE_CATEGORY_IDS.has(categoryId)) return false;
        const contextText = String(
          match && match.context && match.context.text ? match.context.text : ''
        )
          .trim()
          .toLowerCase();
        if (/https?:\/\/|www\.|@/.test(contextText)) return false;
        return true;
      })
      .slice(0, 40);

    const issueCount = filteredMatches.length;
    const topIssues = filteredMatches.slice(0, 8).map((item) => ({
      message: compactText(item && item.message ? item.message : ''),
      category: compactText(
        item && item.rule && item.rule.category && item.rule.category.name
          ? item.rule.category.name
          : item && item.rule && item.rule.category && item.rule.category.id
            ? item.rule.category.id
            : ''
      ),
      context: trimLanguageToolContext(item && item.context ? item.context.text : ''),
      replacements: Array.isArray(item && item.replacements)
        ? item.replacements
            .slice(0, 3)
            .map((entry) => compactText(entry && entry.value ? entry.value : ''))
            .filter(Boolean)
        : [],
    }));

    const ok = issueCount <= LINGUISTIC_GRAMMAR_MAX_ISSUES;
    return {
      ok,
      skipped: false,
      partial: false,
      reason: ok
        ? ''
        : `Grammar issues exceed threshold: ${issueCount} > ${LINGUISTIC_GRAMMAR_MAX_ISSUES}.`,
      language,
      issueCount,
      matches: topIssues,
    };
  } catch (error) {
    return {
      ok: true,
      skipped: true,
      partial: true,
      reason: `Grammar API check skipped: ${compactText(
        error && error.message ? error.message : error
      )}`,
      language,
      issueCount: 0,
      matches: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runLocaleLinguisticQualityCheck(localeEntry, localeCode) {
  const samples = (localeEntry.pages || [])
    .filter((item) => item && item.status !== 'blocked')
    .map((item) => compactText(item.sample || ''))
    .filter((item) => item.length >= 24);
  const uniqueSamples = Array.from(new Set(samples));
  const selectedSamples = uniqueSamples.slice(0, LINGUISTIC_SAMPLE_PAGES);
  const text = normalizeLinguisticText(selectedSamples.join(' | '), LINGUISTIC_MAX_TEXT_CHARS);

  if (text.length < 120) {
    return {
      ok: true,
      skipped: true,
      partial: true,
      reason: 'Insufficient text sample for linguistic grammar check.',
      sampleLength: text.length,
      sampledPages: selectedSamples.length,
      heuristics: { issues: [], severeCount: 0 },
      grammar: null,
    };
  }

  const heuristics = collectLinguisticHeuristics(text);
  const grammar = await runLanguageToolGrammarCheck(text, localeCode);
  const heuristicsFailed = heuristics.severeCount > 0;
  const grammarFailed = !grammar.ok && !grammar.skipped;
  const ok = !heuristicsFailed && !grammarFailed;
  const reason = !ok
    ? [
        heuristicsFailed ? 'Heuristic linguistic anomalies detected.' : '',
        grammarFailed ? grammar.reason : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return {
    ok,
    partial: Boolean(grammar.partial),
    skipped: false,
    reason,
    sampleLength: text.length,
    sampledPages: selectedSamples.length,
    heuristics,
    grammar,
  };
}

function analyzeSampleLocale(sample, code) {
  const text = compactText(sample);
  if (text.length < 30) {
    return {
      ok: false,
      reason: 'Localized UI sample is too short for reliable language validation.',
      sampleLength: text.length,
      markerMatched: false,
      detected: [],
      englishLeakCount: 0,
    };
  }

  const markers = LANGUAGE_MARKERS[code] || [];
  const markerMatched = markers.some((re) => re.test(text));
  const detected = detector
    .detect(text, 4)
    .map((item) => String(item && item[0] ? item[0] : '').toLowerCase())
    .filter(Boolean);
  const expectedNames = EXPECTED_DETECT_NAMES[code] || [];
  const detectorMatched = expectedNames.some((name) => detected.includes(name));
  const expectedFranc = EXPECTED_FRANC_CODES[code] || [];
  const francCode = (() => {
    try {
      return franc(text, { minLength: 40 });
    } catch {
      return 'und';
    }
  })();
  const francMatched = expectedFranc.includes(francCode);
  const englishLeakCount = ENGLISH_LEAK_PATTERNS.filter((re) => re.test(text)).length;

  if (code === 'en') {
    const englishOk = markerMatched || detectorMatched || francMatched;
    return {
      ok: englishOk,
      reason: englishOk ? '' : 'English locale markers were not detected.',
      markerMatched,
      detectorMatched,
      francMatched,
      francCode,
      detected,
      englishLeakCount,
      sampleLength: text.length,
    };
  }

  const ok = markerMatched || detectorMatched || francMatched;
  if (!ok) {
    return {
      ok: false,
      reason: `Locale "${code || 'unknown'}" was not confirmed by markers/detector/franc.`,
      markerMatched,
      detectorMatched,
      francMatched,
      francCode,
      detected,
      englishLeakCount,
      sampleLength: text.length,
    };
  }

  if (englishLeakCount >= 6 && !markerMatched) {
    return {
      ok: false,
      reason: `Locale "${code || 'unknown'}" still contains many English UI tokens (${englishLeakCount}).`,
      markerMatched,
      detectorMatched,
      francMatched,
      francCode,
      detected,
      englishLeakCount,
      sampleLength: text.length,
    };
  }

  return {
    ok: true,
    reason: '',
    markerMatched,
    detectorMatched,
    francMatched,
    francCode,
    detected,
    englishLeakCount,
    sampleLength: text.length,
  };
}
