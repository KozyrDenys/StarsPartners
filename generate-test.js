const { chromium } = require('playwright');
const fs = require('fs');
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
Ты Senior QA Automation Engineer.
На основе HTML страницы сгенерируй Playwright автотест на JavaScript.

Требования:
- Используй @playwright/test
- Один describe блок
- Минимум 3 expect проверки
- Проверка title
- Проверка наличия текста "Example Domain"
- Проверка ссылки

HTML:
${html}

Ответ верни ТОЛЬКО кодом без пояснений.
`;

  const result = await ollamaGenerate(prompt);

  fs.writeFileSync('tests/ai/example.spec.js', result);
  console.log('✅ Autotest generated: tests/ai/example.spec.js');
})();
