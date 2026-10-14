const playwrightTest = require('@playwright/test');

if (process.env.PW_CDP_REUSE_CONTEXT !== '1') {
  module.exports = playwrightTest;
} else {
  const { createCdpBrowserFacade } = require('../helpers/cdp-reuse-context');

  const test = playwrightTest.test.extend({
    browser: [
      async ({ playwright, browserName }, use) => {
        if (browserName !== 'chromium') {
          throw new Error('PW_CDP_REUSE_CONTEXT=1 requires PW_BROWSER=chromium.');
        }
        const endpoint = String(process.env.PW_CDP_ENDPOINT || '').trim();
        if (!endpoint) {
          throw new Error('PW_CDP_REUSE_CONTEXT=1 requires PW_CDP_ENDPOINT.');
        }
        const connectedBrowser = await playwright.chromium.connectOverCDP(endpoint, {
          timeout: Number.parseInt(process.env.PW_CDP_CONNECT_TIMEOUT_MS || '30000', 10),
        });
        const persistentContext = connectedBrowser.contexts()[0];
        if (!persistentContext) {
          throw new Error(`Native Chrome at ${endpoint} has no persistent browser context.`);
        }
        const browser = createCdpBrowserFacade(connectedBrowser, persistentContext, {
          baseUrl: process.env.BASE_URL,
        });
        await use(browser);
        // Do not call browser.close(): the supervisor owns the native Chrome process and
        // keeps the trusted persistent context alive between separately spawned suites.
      },
      { scope: 'worker' },
    ],
    context: async ({ browser, contextOptions }, use) => {
      const context = await browser.newContext(contextOptions || {});
      await use(context);
      await context.close();
    },
    page: async ({ context }, use) => {
      const page = await context.newPage();
      await use(page);
    },
  });

  module.exports = {
    ...playwrightTest,
    test,
  };
}
