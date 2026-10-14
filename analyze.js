const { loadProjectEnv } = require('./scripts/lib/env');

loadProjectEnv();

const { chromium } = require('playwright');
const { ollamaGenerate } = require('./analyze/ollamaChat');
const { getTarget } = require('./analyze/target');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const targetUrl = process.env.BASE_URL || getTarget() || 'https://gt.bet/';
  await page.goto(targetUrl);
  const html = await page.content();

  await browser.close();

  const prompt = `
Ты QA-инженер.
Проанализируй HTML страницы и предложи список UI и функциональных тестов.

HTML:
${html}
`;

  const result = await ollamaGenerate(prompt);
  console.log(result);
})();
