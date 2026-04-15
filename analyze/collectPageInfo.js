// analyze/collectPageInfo.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function safeMkdir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new TypeError(`outDir must be a string, got: ${typeof dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function safeWrite(filePath, content) {
  safeMkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function resolveStorageState() {
  const envPath = (process.env.PW_STORAGE_STATE || '').trim();
  if (!envPath) return null;

  const baseDir = process.env.QA_PROJECT_DIR || process.cwd();
  const abs = path.isAbsolute(envPath) ? envPath : path.join(baseDir, envPath);

  if (!fs.existsSync(abs)) return null;
  return abs;
}

function isHeadlessFromEnv(defaultValue = true) {
  const v = (process.env.HEADLESS || '').trim();
  if (!v) return defaultValue;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * collectPageInfo(url, opts)
 * opts:
 *  - outDir: string (required)
 *  - headless: boolean (default: from env HEADLESS, else true)
 *  - timeoutMs: number (default 20000)
 *  - waitUntil: 'domcontentloaded'|'load'|'networkidle' (default domcontentloaded)
 */
async function collectPageInfo(url, opts = {}) {
  const {
    outDir,
    headless = isHeadlessFromEnv(true),
    timeoutMs = 20000,
    waitUntil = 'domcontentloaded',
  } = opts;

  safeMkdir(outDir);

  const storageStatePath = resolveStorageState();

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    storageStatePath ? { storageState: storageStatePath } : {}
  );
  const page = await context.newPage();

  page.setDefaultTimeout(timeoutMs);

  // --- runtime diagnostics ---
  const consoleErrors = [];
  const requestFails = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    try {
      if (msg.type() === 'error') {
        consoleErrors.push({
          text: msg.text(),
          location: msg.location?.() || null,
        });
      }
    } catch {
      // ignore console event parsing errors
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push({ message: String(err?.message || err) });
  });

  page.on('requestfailed', (req) => {
    const f = req.failure?.();
    requestFails.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      errorText: f?.errorText || '',
    });
  });

  await page.goto(url, { waitUntil });

  // --- DOM snapshot ---
  const data = await page.evaluate(() => {
    const pickText = (el) => (el?.innerText || el?.textContent || '').trim();

    const title = document.title || '';

    const h1 = Array.from(document.querySelectorAll('h1'))
      .map(pickText)
      .filter(Boolean)
      .slice(0, 20);

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({
        text: (a.textContent || '').trim(),
        href: a.getAttribute('href') || '',
      }))
      .filter((x) => x.href)
      .slice(0, 200);

    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      )
    )
      .map((el) => ({
        text: pickText(el),
        id: el.id || '',
        name: el.getAttribute('name') || '',
        type: (el.getAttribute('type') || '').toLowerCase(),
        tag: (el.tagName || '').toLowerCase(),
      }))
      .filter((b) => b.text || b.id || b.name)
      .slice(0, 200);

    const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .map((el) => ({
        id: el.id || '',
        name: el.getAttribute('name') || '',
        type: (el.getAttribute('type') || '').toLowerCase(),
        placeholder: el.getAttribute('placeholder') || '',
        tag: (el.tagName || '').toLowerCase(),
      }))
      .filter((i) => i.id || i.name || i.placeholder || i.type)
      .slice(0, 200);

    return { title, h1, links, buttons, inputs };
  });

  // --- artifacts ---
  await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: true });
  const html = await page.content();
  safeWrite(path.join(outDir, 'page.html'), html);

  // full payload
  const full = {
    scannedAt: new Date().toISOString(),
    url,
    outDir,
    storageStateUsed: Boolean(storageStatePath),
    ...data,
    consoleErrors,
    pageErrors,
    requestFails,
  };

  safeWrite(path.join(outDir, 'pageInfo.full.json'), JSON.stringify(full, null, 2));

  // compact payload (как у тебя сейчас, но корректно)
  const compact = {
    url,
    title: data.title,
    h1Count: data.h1.length,
    linksCount: data.links.length,
    buttonsCount: data.buttons.length,
    inputsCount: data.inputs.length,
    outDir,
    storageStateUsed: Boolean(storageStatePath),
    consoleErrorsCount: consoleErrors.length + pageErrors.length,
    requestFailsCount: requestFails.length,
  };

  safeWrite(path.join(outDir, 'pageInfo.json'), JSON.stringify(compact, null, 2));

  await context.close();
  await browser.close();

  return compact;
}

module.exports = { collectPageInfo };
