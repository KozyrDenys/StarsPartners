const fs = require('fs');
const path = require('path');
const { ollamaGenerate } = require('./ollamaChat');
const { getTarget } = require('./target');
const { collectPageInfo } = require('./collectPageInfo');

const htmlPath = path.join(__dirname, 'page.html');
const outDir = path.join(__dirname, '../tests/ai');
const targetUrl = process.env.BASE_URL || getTarget() || 'https://gt.bet/';

async function refreshHtmlSnapshot(url) {
  try {
    await collectPageInfo(url, {
      outDir: __dirname,
      headless: true,
      timeoutMs: Number.parseInt(process.env.PW_NAV_TIMEOUT || '60000', 10),
      waitUntil: 'domcontentloaded',
    });
  } catch (e) {
    if (!fs.existsSync(htmlPath)) throw e;
    console.warn(
      `⚠️ Failed to refresh page snapshot (${e?.message || e}). Falling back to existing analyze/page.html`
    );
  }
}

async function ask(priorityLabel, requirements, html) {
  const prompt = `
You are a Senior QA Automation Engineer.
Generate a Playwright test file in JavaScript using @playwright/test.

STRICT RULES:
- Output ONLY valid JavaScript code.
- No markdown fences.
- No explanations.
- Use: import { test, expect } from '@playwright/test';
- Tests must be deterministic and not flaky.
- Always use page.goto('/') and do not hardcode any external URLs.
- Never use Example Domain / IANA assertions.
- Do not use page.$, page.$x, page.$$eval, ElementHandle or raw XPath arrays.
- Use regex for href checks when appropriate.

Target: ${targetUrl}

Priority: ${priorityLabel}
Requirements:
${requirements}

HTML:
${html}
`;

  return ollamaGenerate(prompt);
}

(async () => {
  await refreshHtmlSnapshot(targetUrl);

  if (!fs.existsSync(htmlPath)) {
    console.error('❌ Missing analyze/page.html after snapshot refresh.');
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });

  const p0 = await ask(
    'P0',
    `- Page loads
- Title is non-empty
- At least one visible link exists`,
    html
  );

  const p1 = await ask(
    'P1',
    `- Primary auth actions are visible (Sign Up / Log In or similar)
- Basic accessibility smoke checks (page has headings or landmark elements)`,
    html
  );

  const p2 = await ask(
    'P2',
    `- Cosmetic/UX checks (layout responsiveness hints, no obvious empty blocks)`,
    html
  );

  fs.writeFileSync(path.join(outDir, 'p0.spec.js'), p0.trim() + '\n');
  fs.writeFileSync(path.join(outDir, 'p1.spec.js'), p1.trim() + '\n');
  fs.writeFileSync(path.join(outDir, 'p2.spec.js'), p2.trim() + '\n');

  console.log(
    '✅ AI generated spec files: tests/ai/p0.spec.js, tests/ai/p1.spec.js, tests/ai/p2.spec.js'
  );
})().catch((e) => {
  console.error('❌ aiGenerateSpecs failed:', e?.message || e);
  process.exit(1);
});
