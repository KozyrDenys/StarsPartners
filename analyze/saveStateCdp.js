const { loadProjectEnv } = require('../scripts/lib/env');

loadProjectEnv();

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function resolveChromeExecutable() {
  const explicit = process.env.PW_CDP_CHROME_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta');
  } else if (process.platform === 'linux') {
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/google-chrome-stable');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/chromium-browser');
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function waitForDevTools(port, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }

      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/json/version',
          timeout: 1500,
        },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve(true);
            return;
          }
          setTimeout(poll, 300);
        }
      );
      req.on('error', () => setTimeout(poll, 300));
      req.on('timeout', () => {
        req.destroy();
        setTimeout(poll, 300);
      });
    };

    poll();
  });
}

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch {
    // best-effort cleanup
  }
}

function expandHome(value) {
  return String(value || '').replace(/^~(?=$|\/|\\)/, process.env.HOME || os.homedir());
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

function parseViewport(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [width, height] = raw
    .replace(/[,; ]+/g, 'x')
    .split(/x/i)
    .map((item) => Number.parseInt(item, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function formatWindowSize(viewport) {
  if (!viewport) return '1365,900';
  return `${viewport.width},${viewport.height}`;
}

function defaultMobileUserAgent() {
  return (
    process.env.PW_CDP_USER_AGENT ||
    process.env.PW_USER_AGENT ||
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  );
}

function chromeUserAgentMetadata(userAgent) {
  const chromeMatch = String(userAgent || '').match(/(?:Chrome|CriOS)\/(\d+)/i);
  if (!chromeMatch) return undefined;
  const major = chromeMatch[1] || '123';
  return {
    brands: [
      { brand: 'Google Chrome', version: major },
      { brand: 'Chromium', version: major },
      { brand: 'Not:A-Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Google Chrome', version: `${major}.0.0.0` },
      { brand: 'Chromium', version: `${major}.0.0.0` },
      { brand: 'Not:A-Brand', version: '24.0.0.0' },
    ],
    platform: /iphone|ipad|ios/i.test(userAgent) ? 'iOS' : 'Android',
    platformVersion: /iphone|ipad|ios/i.test(userAgent) ? '15.0.0' : '10.0.0',
    architecture: '',
    model: /iphone|ipad|ios/i.test(userAgent) ? 'iPhone' : '',
    mobile: true,
  };
}

function defaultProfileDir(url) {
  let slug = 'brand';
  try {
    slug = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'brand';
  } catch {
    // keep fallback
  }
  return path.join(process.cwd(), 'projects', slug, '.chrome-cdp-profile');
}

async function applyPageDeviceProfile(page, { viewport, isMobile, userAgent }) {
  if (viewport) {
    await page.setViewportSize(viewport).catch(() => null);
  }

  const session = await page
    .context()
    .newCDPSession(page)
    .catch(() => null);
  if (!session) return;

  try {
    if (userAgent) {
      const userAgentMetadata = isMobile ? chromeUserAgentMetadata(userAgent) : undefined;
      await session.send('Network.setUserAgentOverride', {
        userAgent,
        platform: isMobile ? 'iPhone' : 'MacIntel',
        ...(userAgentMetadata ? { userAgentMetadata } : {}),
      });
    }

    if (viewport) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: isMobile ? 3 : 1,
        mobile: Boolean(isMobile),
      });
    }

    if (isMobile) {
      await session.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
      });
    }
  } finally {
    await session.detach().catch(() => null);
  }
}

async function isReady(page) {
  const selectors = [
    '#app, #__nuxt',
    '[data-testid="signup-button"]',
    '[data-testid="login-button"]',
    'button:has-text("Sign Up")',
    'button:has-text("Log In")',
    '#app .t-header',
    'header.t-header',
  ];

  for (const selector of selectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function hasChallenge(page) {
  if (/cdn-cgi|challenge-platform|__cf_chl|cf_chl_|__cf_bm=/i.test(page.url())) return true;
  const body = await page.textContent('body').catch(() => '');
  return /cloudflare|verify you are human|checking your browser|just a moment/i.test(
    String(body || '')
  );
}

async function waitForEnter(message) {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive TTY is required. Run this command from a local terminal.');
  }

  console.log(message);
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
}

function splitWarmupRoutes(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function makeAbsoluteUrl(baseUrl, route) {
  try {
    return new URL(route, baseUrl).toString();
  } catch {
    return route;
  }
}

async function waitUntilReadyOrManual(page, label) {
  let pageReady = await isReady(page);
  let challenge = await hasChallenge(page);
  while (!pageReady || challenge) {
    console.log('');
    if (challenge) {
      console.log(`Cloudflare challenge is still visible${label ? ` on ${label}` : ''}.`);
    } else {
      console.log(`App root is not visible yet${label ? ` on ${label}` : ''}.`);
    }
    await waitForEnter(
      'Complete Cloudflare in the opened Chrome window, wait for the real site, then press Enter here.'
    );
    pageReady = await isReady(page);
    challenge = await hasChallenge(page);
  }
}

(async () => {
  const args = process.argv.slice(2);
  const nonFlags = args.filter((arg) => !String(arg || '').startsWith('-'));
  const url = nonFlags[0] || process.env.BASE_URL || 'https://gt.bet/';
  const out = nonFlags[1] || process.env.PW_STORAGE_STATE || 'storageState.json';
  const chromeExecutable = resolveChromeExecutable();
  if (!chromeExecutable) {
    throw new Error('Google Chrome executable was not found. Set PW_CDP_CHROME_PATH.');
  }

  const portFromEnv = Number.parseInt(process.env.PW_CDP_PORT || '', 10);
  const port =
    Number.isFinite(portFromEnv) && portFromEnv > 0
      ? portFromEnv
      : 9333 + Math.floor(Math.random() * 500);
  const profileDir = expandHome(process.env.PW_CDP_PROFILE_DIR || defaultProfileDir(url));
  const isMobile = envFlag('PW_CDP_IS_MOBILE') || envFlag('PW_SAVE_STATE_IS_MOBILE');
  const viewport =
    parseViewport(process.env.PW_CDP_VIEWPORT || '') ||
    parseViewport(process.env.PW_SAVE_STATE_VIEWPORT || '') ||
    parseViewport(process.env.PW_CDP_WINDOW_SIZE || '') ||
    (isMobile ? { width: 390, height: 844 } : { width: 1365, height: 900 });
  const windowSize = process.env.PW_CDP_WINDOW_SIZE || formatWindowSize(viewport);
  const configuredUserAgent =
    process.env.PW_CDP_USER_AGENT ||
    process.env.PW_USER_AGENT ||
    (isMobile ? defaultMobileUserAgent() : '');
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${windowSize}`,
    '--new-window',
    ...(configuredUserAgent ? [`--user-agent=${configuredUserAgent}`] : []),
    'about:blank',
  ];

  console.log(`Chrome: ${chromeExecutable}`);
  console.log(`Profile: ${profileDir}`);
  console.log(`URL: ${url}`);
  console.log(`Output: ${path.resolve(out)}`);
  console.log(`CDP: http://127.0.0.1:${port}`);
  console.log(`Device: ${isMobile ? 'mobile' : 'desktop'} ${viewport.width}x${viewport.height}`);
  if (configuredUserAgent) console.log(`UserAgent: ${configuredUserAgent}`);

  const chromeProc = spawn(chromeExecutable, chromeArgs, {
    stdio: 'ignore',
    detached: false,
  });

  let browser = null;
  try {
    const ready = await waitForDevTools(port);
    if (!ready) throw new Error(`Chrome DevTools endpoint was not ready on port ${port}.`);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await applyPageDeviceProfile(page, {
      viewport,
      isMobile,
      userAgent: configuredUserAgent,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    await waitUntilReadyOrManual(page, url);

    const warmupRoutes = splitWarmupRoutes(process.env.PW_CDP_WARMUP_ROUTES || '');
    for (const route of warmupRoutes) {
      const warmupUrl = makeAbsoluteUrl(url, route);
      console.log('');
      console.log(`Warmup route: ${warmupUrl}`);
      await page.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {
        // The manual wait below will surface unresolved challenge/navigation states.
      });
      await waitUntilReadyOrManual(page, warmupUrl);
    }

    const userAgent = await page.evaluate(() => globalThis.navigator.userAgent).catch(() => '');
    const outPath = path.resolve(out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await context.storageState({ path: outPath });
    console.log(`Saved: ${outPath}`);
    if (userAgent) {
      const metaPath = `${outPath}.cdp-meta.json`;
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            url,
            userAgent,
            requestedUserAgent: configuredUserAgent || '',
            isMobile,
            viewport,
            profileDir,
            storageState: outPath,
          },
          null,
          2
        ),
        'utf8'
      );
      console.log(`Metadata: ${metaPath}`);
      console.log(`Use this for the next run: PW_USER_AGENT=${JSON.stringify(userAgent)}`);
    }
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
    killProcess(chromeProc);
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
