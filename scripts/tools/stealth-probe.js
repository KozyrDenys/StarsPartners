#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const OUT_DIR = path.join(PROJECT_ARTIFACTS_DIR, 'stealth-probe');
const HEADLESS = process.env.PW_HEADED === '1' ? false : process.env.HEADLESS !== '0';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function detectChallenge(page) {
  const url = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl|cf_chl_|just-a-moment/i.test(url)) {
    return `Challenge URL detected: ${url}`;
  }

  const challengeText = await page
    .getByText(/cloudflare|verify you are human|checking your browser|just a moment|forbidden/i)
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (challengeText) return 'Challenge text is visible.';

  const challengeFrame = await page
    .locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);
  if (challengeFrame) return 'Challenge iframe/widget is visible.';

  return '';
}

async function performHumanLikeActions(page) {
  const viewport = page.viewportSize() || { width: 1365, height: 900 };
  for (let i = 0; i < 5; i += 1) {
    const x = Math.round(Math.random() * Math.max(120, viewport.width - 40)) + 20;
    const y = Math.round(Math.random() * Math.max(160, viewport.height - 40)) + 20;
    await page.mouse.move(x, y, { steps: 12 }).catch(() => null);
    await page.waitForTimeout(200 + Math.round(Math.random() * 250)).catch(() => null);
  }
  await page.mouse.wheel(0, 900).catch(() => null);
  await page.waitForTimeout(550).catch(() => null);
  await page.mouse.wheel(0, -500).catch(() => null);
}

async function main() {
  ensureDir(OUT_DIR);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: process.env.PW_TIMEZONE || 'Europe/Kiev',
    viewport: { width: 1365, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const startedAt = Date.now();
  let navigationError = '';

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await performHumanLikeActions(page);
  } catch (error) {
    navigationError = oneLine(error && error.message ? error.message : error);
  }

  const challenge = await detectChallenge(page).catch(() => '');
  const out = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    finalUrl: page.url(),
    navigationError,
    challenge,
    blocked: Boolean(challenge || navigationError),
    elapsedMs: Date.now() - startedAt,
    headless: HEADLESS,
    tool: 'playwright-extra + puppeteer-extra-plugin-stealth',
  };

  const jsonPath = path.join(OUT_DIR, 'stealth-probe.json');
  const screenshotPath = path.join(OUT_DIR, 'stealth-probe.png');
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

  await context.close().catch(() => null);
  await browser.close().catch(() => null);

  console.log(`Stealth probe JSON: ${jsonPath}`);
  console.log(`Stealth probe screenshot: ${screenshotPath}`);
  console.log(
    `Blocked=${out.blocked} challenge="${out.challenge || '-'}" error="${out.navigationError || '-'}"`
  );
}

main().catch((error) => {
  console.error(oneLine(error && error.message ? error.message : error));
  process.exit(1);
});
