// analyze/runAnalysis.js

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const targetUrl = process.env.BASE_URL || 'https://gt.bet/';
  await page.goto(targetUrl);

  const result = {
    title: await page.title(),
    h1: await page.textContent('h1'),
    links: await page.$$eval('a', (links) => links.map((a) => a.getAttribute('href'))),
  };

  console.log('🔍 Page analysis result:\n');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
