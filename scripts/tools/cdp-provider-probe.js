const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const endpoint = String(process.env.PW_CDP_ENDPOINT || '').trim();
  if (!endpoint) throw new Error('PW_CDP_ENDPOINT is required.');
  const baseUrl = String(process.env.BASE_URL || 'https://booms.bet').trim();
  const route = String(process.argv[2] || '/casino/100hp/air-jet-356351').trim();
  const targetUrl = new URL(route, baseUrl).toString();
  const outputDir = path.resolve('output/playwright');
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Persistent CDP context was not found.');
  const page = await context.newPage();
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(5000);
    const controls = await page
      .locator('button:visible, a:visible, [role="button"]:visible')
      .evaluateAll((nodes) =>
        nodes.slice(0, 120).map((node) => ({
          tag: node.tagName.toLowerCase(),
          text: String(node.innerText || node.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160),
          href: node.tagName === 'A' ? node.href : '',
          testId: node.getAttribute('data-testid') || '',
          className: String(node.className || '').slice(0, 180),
        }))
      );
    const bodyText = String((await page.textContent('body').catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    const payload = {
      generatedAt: new Date().toISOString(),
      targetUrl,
      finalUrl: page.url(),
      title: await page.title(),
      challenge: /just a moment|verify you are human|checking your browser|cloudflare/i.test(
        bodyText
      ),
      appRootVisible: await page
        .locator('#app, #__nuxt')
        .first()
        .isVisible()
        .catch(() => false),
      controls,
    };
    const jsonPath = path.join(outputDir, 'booms-provider-cdp-probe.json');
    const screenshotPath = path.join(outputDir, 'booms-provider-cdp-probe.png');
    fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ jsonPath, screenshotPath, ...payload }, null, 2));
  } finally {
    await page.close().catch(() => null);
    // The native Chrome supervisor owns the browser lifecycle.
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
