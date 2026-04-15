function buildPlanPrompt(url, pageInfo) {
  return `
Ты QA engineer. На основе данных страницы составь тест-план.

ОГРАНИЧЕНИЯ:
- Пиши по-русски.
- Выведи строго в Markdown с секциями: P0, P1, P2.
- В каждом P0/P1/P2 дай список тест-кейсов (коротко, по делу).
- Никакого кода.

URL: ${url}

ДАННЫЕ СТРАНИЦЫ (JSON):
${JSON.stringify(pageInfo, null, 2)}
`.trim();
}

function buildTestsPrompt(url, pageInfo, planMd) {
  return `
Сгенерируй Playwright tests для @playwright/test.

ОГРАНИЧЕНИЯ (ВАЖНО):
- Верни РОВНО 3 JS-кодблока: один для P0, один для P1, один для P2.
- Каждый кодблок должен начинаться строкой: // FILE: tests/ai/p0.spec.js (или p1/p2)
- Внутри только валидный JavaScript.
- НЕ добавляй никаких пояснений вне кодблоков.
- Используй Locators (page.locator) и expect(...).toBeVisible/toHaveText/toHaveAttribute.
- Тесты должны быть стабильные: ожидания, без проверки CSS-стилей.
- Базовый URL: ${url}

КОНТЕКСТ СТРАНИЦЫ (JSON):
${JSON.stringify(pageInfo, null, 2)}

ТЕСТ-ПЛАН (Markdown):
${planMd}
`.trim();
}

module.exports = { buildPlanPrompt, buildTestsPrompt };
