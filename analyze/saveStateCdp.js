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

function defaultProfileDir(url) {
  let slug = 'brand';
  try {
    slug = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'brand';
  } catch {
    // keep fallback
  }
  return path.join(process.cwd(), 'projects', slug, '.chrome-cdp-profile');
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
  const windowSize = process.env.PW_CDP_WINDOW_SIZE || '1365,900';
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${windowSize}`,
    '--new-window',
    url,
  ];

  console.log(`Chrome: ${chromeExecutable}`);
  console.log(`Profile: ${profileDir}`);
  console.log(`URL: ${url}`);
  console.log(`Output: ${path.resolve(out)}`);
  console.log(`CDP: http://127.0.0.1:${port}`);

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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);

    let pageReady = await isReady(page);
    let challenge = await hasChallenge(page);
    while (!pageReady || challenge) {
      console.log('');
      if (challenge) {
        console.log('Cloudflare challenge is still visible.');
      } else {
        console.log('App root is not visible yet.');
      }
      await waitForEnter(
        'Complete Cloudflare in the opened Chrome window, wait for the real site, then press Enter here.'
      );
      pageReady = await isReady(page);
      challenge = await hasChallenge(page);
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
