const fs = require('fs');
const path = require('path');

const CLOUDFLARE_COOKIE_NAMES = new Set([
  'cf_clearance',
  '__cf_bm',
  '_cfuvid',
  '__cflb',
  'cf_chl_2',
]);

function isCloudflareCookie(cookie) {
  return Boolean(cookie && CLOUDFLARE_COOKIE_NAMES.has(String(cookie.name || '').toLowerCase()));
}

function readStorageState(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const filePath = path.resolve(String(value));
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function uniqueCookies(cookies) {
  const seen = new Set();
  const result = [];
  for (const cookie of cookies || []) {
    if (!cookie || !cookie.name || !cookie.domain) continue;
    const key = `${cookie.name}\u0000${cookie.domain}\u0000${cookie.path || '/'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cookie);
  }
  return result;
}

async function replaceApplicationCookies(context, requestedState) {
  if (!requestedState) return;
  const currentCookies = await context.cookies().catch(() => []);
  const requestedCookies = Array.isArray(requestedState.cookies)
    ? requestedState.cookies.filter((cookie) => !isCloudflareCookie(cookie))
    : [];

  for (const cookie of currentCookies.filter((item) => !isCloudflareCookie(item))) {
    await context.clearCookies({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path || '/',
    });
  }
  const mergedCookies = uniqueCookies(requestedCookies);
  if (mergedCookies.length > 0) await context.addCookies(mergedCookies);
}

function originStorageMap(requestedState) {
  const result = {};
  const origins = Array.isArray(requestedState && requestedState.origins)
    ? requestedState.origins
    : [];
  for (const entry of origins) {
    if (!entry || !entry.origin) continue;
    result[String(entry.origin)] = Array.isArray(entry.localStorage) ? entry.localStorage : [];
  }
  return result;
}

async function protectCloudflareCookiesDuringClear(context, args) {
  const currentCookies = await context.cookies().catch(() => []);
  const filter = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
  const matches = (cookie, key) => {
    const expected = filter && filter[key];
    if (!expected) return true;
    const actual = String(cookie[key] || '');
    return expected instanceof RegExp ? expected.test(actual) : actual === String(expected);
  };
  const removable = currentCookies.filter(
    (cookie) =>
      !isCloudflareCookie(cookie) &&
      matches(cookie, 'name') &&
      matches(cookie, 'domain') &&
      matches(cookie, 'path')
  );
  for (const cookie of removable) {
    await context.clearCookies({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path || '/',
    });
  }
}

function resolveCdpUserAgent(options = {}) {
  const preserveNativeUserAgent =
    process.env.PW_CDP_REUSE_CONTEXT === '1' &&
    String(process.env.PW_CDP_PRESERVE_USER_AGENT || '1') !== '0';
  if (preserveNativeUserAgent) return String(process.env.PW_USER_AGENT || '').trim();
  return String(options.userAgent || '').trim();
}

async function applyPageProfile(page, options, storageByOrigin, baseOrigin) {
  const viewport = options && options.viewport;
  if (viewport && Number(viewport.width) > 0 && Number(viewport.height) > 0) {
    await page
      .setViewportSize({ width: Number(viewport.width), height: Number(viewport.height) })
      .catch(() => null);
  }

  await page.addInitScript(
    ({ stateByOrigin, targetOrigin }) => {
      if (!targetOrigin || globalThis.location.origin !== targetOrigin) return;
      try {
        globalThis.localStorage.clear();
        const entries = stateByOrigin[targetOrigin] || [];
        for (const entry of entries) {
          if (!entry || typeof entry.name !== 'string') continue;
          globalThis.localStorage.setItem(entry.name, String(entry.value || ''));
        }
      } catch {
        // Storage can be unavailable on opaque or sandboxed documents.
      }
    },
    { stateByOrigin: storageByOrigin, targetOrigin: baseOrigin }
  );

  const isMobile = Boolean(options && options.isMobile);
  const hasTouch = Boolean(options && options.hasTouch);
  // Cloudflare clearance is bound to the native Chrome fingerprint. In CDP reuse
  // mode keep that User-Agent even for mobile viewport/touch emulation; replacing
  // it with an iPhone UA invalidates the already solved clearance session.
  const userAgent = resolveCdpUserAgent(options || {});
  if (!isMobile && !hasTouch && !userAgent) return;

  const session = await page
    .context()
    .newCDPSession(page)
    .catch(() => null);
  if (!session) return;
  try {
    if (userAgent) {
      await session.send('Network.setUserAgentOverride', {
        userAgent,
        platform: isMobile ? 'Android' : 'MacIntel',
      });
    }
    if (viewport) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: Number(viewport.width),
        height: Number(viewport.height),
        deviceScaleFactor: isMobile ? 3 : 1,
        mobile: isMobile,
      });
    }
    if (hasTouch || isMobile) {
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
      });
    }
  } finally {
    await session.detach().catch(() => null);
  }
}

function createContextLease(context, options = {}, facadeBrowser, baseUrl = '') {
  const trackedPages = new Set();
  const trackedRoutes = [];
  const trackedListeners = [];
  const requestedState = readStorageState(options.storageState);
  const storageByOrigin = originStorageMap(requestedState);
  let baseOrigin = '';
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    baseOrigin = '';
  }
  let closed = false;

  const lease = new Proxy(context, {
    get(target, property) {
      if (property === '__qaCdpLease') return true;
      if (property === 'browser') return () => facadeBrowser;
      if (property === 'pages') return () => [...trackedPages].filter((page) => !page.isClosed());
      if (property === 'newPage') {
        return async () => {
          if (closed) throw new Error('CDP context lease is already closed.');
          await replaceApplicationCookies(context, requestedState);
          if (options.extraHTTPHeaders) {
            await context.setExtraHTTPHeaders(options.extraHTTPHeaders);
          }
          const page = await context.newPage();
          trackedPages.add(page);
          await applyPageProfile(page, options, storageByOrigin, baseOrigin);
          return page;
        };
      }
      if (property === 'clearCookies') {
        return (...args) => protectCloudflareCookiesDuringClear(context, args);
      }
      if (property === 'route') {
        return async (url, handler, routeOptions) => {
          trackedRoutes.push({ url, handler });
          return context.route(url, handler, routeOptions);
        };
      }
      if (property === 'on' || property === 'addListener' || property === 'once') {
        return (event, handler) => {
          trackedListeners.push({ event, handler });
          context[property](event, handler);
          return lease;
        };
      }
      if (property === 'off' || property === 'removeListener') {
        return (event, handler) => {
          context[property](event, handler);
          return lease;
        };
      }
      if (property === 'close') {
        return async () => {
          if (closed) return;
          closed = true;
          for (const item of trackedRoutes.splice(0)) {
            await context.unroute(item.url, item.handler).catch(() => null);
          }
          for (const item of trackedListeners.splice(0)) {
            context.off(item.event, item.handler);
          }
          const pagesToClose = new Set(trackedPages);
          for (const page of context.pages()) {
            let opener = await page.opener().catch(() => null);
            while (opener) {
              if (trackedPages.has(opener)) {
                pagesToClose.add(page);
                break;
              }
              opener = await opener.opener().catch(() => null);
            }
          }
          await Promise.all([...pagesToClose].map((page) => page.close().catch(() => null)));
          trackedPages.clear();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return lease;
}

function createCdpBrowserFacade(browser, context, options = {}) {
  const baseUrl = String(options.baseUrl || process.env.BASE_URL || '');
  let facade = null;
  facade = new Proxy(browser, {
    get(target, property) {
      if (property === '__qaCdpFacade') return true;
      if (property === 'newContext') {
        return async (contextOptions = {}) =>
          createContextLease(context, contextOptions, facade, baseUrl);
      }
      if (property === 'contexts') return () => [context];
      if (property === 'close') return async () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return facade;
}

module.exports = {
  CLOUDFLARE_COOKIE_NAMES,
  createCdpBrowserFacade,
  createContextLease,
  isCloudflareCookie,
  readStorageState,
  replaceApplicationCookies,
  resolveCdpUserAgent,
};
