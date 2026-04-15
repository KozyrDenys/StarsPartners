const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ollamaGenerate } = require('./ollamaChat');

const OUT_DIR = path.join(process.env.QA_PROJECT_DIR || process.cwd(), 'analyze', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function collect(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleMessages = [];
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleMessages.push({ type: 'pageerror', text: String(err) }));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const title = await page.title();
  const finalUrl = page.url();

  const html = await page.content();
  const screenshotPath = path.join(OUT_DIR, 'page.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();

  const info = {
    requestedUrl: url,
    finalUrl,
    title,
    htmlSnippet: html.slice(0, 12000), // ограничим размер
    consoleMessages: consoleMessages.slice(0, 50),
    screenshotPath,
  };

  const jsonPath = path.join(OUT_DIR, 'pageInfo.json');
  fs.writeFileSync(jsonPath, JSON.stringify(info, null, 2), 'utf8');

  return { info, jsonPath, screenshotPath };
}

async function runTask(taskText, url) {
  const { info } = await collect(url);

  const prompt = `
Ты QA-инженер. У тебя есть задача от пользователя:

ЗАДАЧА:
${taskText}

ДАННЫЕ О СТРАНИЦЕ:
- requestedUrl: ${info.requestedUrl}
- finalUrl: ${info.finalUrl}
- title: ${info.title}
- consoleMessages: ${JSON.stringify(info.consoleMessages, null, 2)}
- htmlSnippet:
${info.htmlSnippet}

Сделай:
1) Короткий QA-отчёт (что проверил, что увидел, риски).
2) Тест-план: P0/P1/P2 (по 3-8 пунктов).
3) Если уместно — предложи 3-6 автотестов Playwright (@playwright/test) для P0.
Ответ дай на русском, структурировано.
`.trim();

  const answer = await ollamaGenerate(prompt);
  const reportPath = path.join(OUT_DIR, 'taskReport.md');
  fs.writeFileSync(reportPath, answer, 'utf8');

  return { answer, reportPath };
}

// CLI usage:
// node analyze/taskRunner.js "<task text>" "<url>"
if (require.main === module) {
  const taskText = process.argv[2] || '';
  const url = process.argv[3] || 'https://example.com';
  runTask(taskText, url)
    .then(({ answer, reportPath }) => {
      console.log('✅ Report saved:', reportPath);
      console.log('\n' + answer);
    })
    .catch((e) => {
      console.error('❌ taskRunner error:', e);
      process.exit(1);
    });
}

module.exports = { runTask };
