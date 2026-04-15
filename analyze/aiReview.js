const fs = require('fs');
const { ollamaGenerate } = require('./ollamaChat');
const { getTarget } = require('./target');

const html = fs.readFileSync('analyze/page.html', 'utf8');
const targetUrl = process.env.BASE_URL || getTarget() || 'https://gt.bet/';

const prompt = `
Ты — Senior QA Engineer.
Проанализируй HTML страницы ниже и:
1. Предложи функциональные тесты
2. Предложи UI тесты
3. Найди edge cases
4. Выдели риски (P0 / P1 / P2)

URL:
${targetUrl}

HTML:
${html}
`;

(async () => {
  const result = await ollamaGenerate(prompt);
  fs.writeFileSync('analyze/qa-report.md', result);
  console.log('✅ QA-отчёт сохранён в analyze/qa-report.md');
})().catch((e) => {
  console.error('❌ aiReview failed:', e?.message || e);
  process.exit(1);
});
