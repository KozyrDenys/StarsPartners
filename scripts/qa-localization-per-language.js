const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BRAND_CATALOG = {
  gt: { key: 'gt', slug: 'gt.bet', baseUrl: 'https://gt.bet' },
  likes: { key: 'likes', slug: 'likes.bet', baseUrl: 'https://likes.bet' },
  booms: { key: 'booms', slug: 'booms.bet', baseUrl: 'https://booms.bet' },
  nix: { key: 'nix', slug: 'nix.bet', baseUrl: 'https://nix.bet' },
  starzino: { key: 'starzino', slug: 'starzino.com', baseUrl: 'https://starzino.com' },
  igo: { key: 'igo', slug: 'igo.bet', baseUrl: 'https://igo.bet' },
  chacha: { key: 'chacha', slug: 'chacha.bet', baseUrl: 'https://chacha.bet' },
};

const DEFAULT_ORDER = ['gt', 'likes', 'booms', 'nix', 'starzino', 'igo', 'chacha'];
const VALID_MODES = new Set(['desktop', 'mobile']);

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const divider = trimmed.indexOf('=');
    if (divider === -1) {
      args[trimmed] = '1';
      continue;
    }
    const key = trimmed.slice(0, divider);
    const value = trimmed.slice(divider + 1);
    args[key] = value;
  }
  return args;
}

function resolveBrands(rawBrand) {
  const input = String(rawBrand || 'all')
    .trim()
    .toLowerCase();

  if (!input || input === 'all') return { ok: true, keys: DEFAULT_ORDER.slice() };

  const tokens = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (tokens.length === 0) return { ok: true, keys: DEFAULT_ORDER.slice() };

  const keys = [];
  for (const token of tokens) {
    if (!BRAND_CATALOG[token]) return { ok: false, unknown: token, keys: [] };
    if (!keys.includes(token)) keys.push(token);
  }

  return { ok: true, keys };
}

function resolveModes(rawMode) {
  const mode = String(rawMode || 'mobile')
    .trim()
    .toLowerCase();

  if (mode === 'all') return ['desktop', 'mobile'];
  if (VALID_MODES.has(mode)) return [mode];
  return [];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function boolFrom(input, fallback = false) {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function normalizeLocaleCode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '');
  if (!normalized) return '';
  if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(normalized)) {
    return normalized.slice(0, 2);
  }
  const short = normalized.match(/[a-z]{2}/);
  return short ? short[0] : '';
}

function buildPaths(cwd, brand, mode) {
  const sharedRoot = path.join(cwd, 'projects', brand.slug);
  const modeRoot = path.join(sharedRoot, mode);
  return {
    sharedRoot,
    modeRoot,
    storageState: path.join(sharedRoot, 'storageState.json'),
    testResultsDir: path.join(modeRoot, 'test-results'),
    artifactsDir: path.join(modeRoot, 'artifacts'),
    autotestReportDir: path.join(sharedRoot, 'Autotest report', mode),
    analyzeDir: path.join(modeRoot, 'analyze'),
    localizationDir: path.join(sharedRoot, 'Autotest report', mode, 'localization'),
  };
}

function ensureWorkspace(paths) {
  ensureDir(paths.sharedRoot);
  ensureDir(paths.modeRoot);
  ensureDir(paths.testResultsDir);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.autotestReportDir);
  ensureDir(paths.analyzeDir);
  ensureDir(paths.localizationDir);
}

function runCommand(bin, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(bin, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      resolve({
        code: Number(code || 0),
        durationSec: Math.round((Date.now() - startedAt) / 1000),
      });
    });
  });
}

async function runSaveState({ cwd, brand, mode, paths, dryRun = false }) {
  const mobileMode = mode === 'mobile';
  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_USE_CHROME_CHANNEL: process.env.PW_USE_CHROME_CHANNEL || '1',
    PW_SAVE_STATE_TIMEOUT: process.env.PW_SAVE_STATE_TIMEOUT || '240',
    PW_SAVE_STATE_WARMUP_TIMEOUT: process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || '90',
    PW_SAVE_STATE_WARMUP_ROUTES:
      process.env.PW_SAVE_STATE_WARMUP_ROUTES || '/,/assets/,/casino/,/live-casino/,/sports/',
    PW_SAVE_STATE_WARMUP_STRICT: process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    PW_SAVE_STATE_IS_MOBILE: mobileMode ? '1' : '0',
    PW_SAVE_STATE_VIEWPORT: mobileMode ? '390x844' : '1365x900',
    PW_USER_AGENT: mobileMode
      ? process.env.PW_USER_AGENT ||
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
      : process.env.PW_USER_AGENT || '',
  };

  const args = ['analyze/saveState.js', `${brand.baseUrl}/`, paths.storageState, '--auto'];
  if (dryRun) {
    console.log(`> node ${args.join(' ')}`);
    return { code: 0, durationSec: 0, dryRun: true };
  }
  return runCommand('node', args, { cwd, env });
}

function readInventory(localizationDir) {
  const inventoryPath = path.join(localizationDir, 'localization-language-inventory.json');
  if (!fs.existsSync(inventoryPath)) {
    return {
      path: inventoryPath,
      locales: [],
      rawCount: 0,
      blocked: true,
      reason: 'missing inventory file',
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const options = Array.isArray(payload.options) ? payload.options : [];
    const discovered = [];
    const seen = new Set();

    for (const option of options) {
      const raw =
        (option && (option.code || option.value || option.rawCode || option.text || '')) || '';
      const code = normalizeLocaleCode(raw);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      discovered.push(code);
    }

    return {
      path: inventoryPath,
      locales: discovered,
      rawCount: Number(payload.count || options.length || 0),
      blocked: Boolean(payload.blocked),
      reason: String(payload.reason || ''),
    };
  } catch (error) {
    return {
      path: inventoryPath,
      locales: [],
      rawCount: 0,
      blocked: true,
      reason: String(error && error.message ? error.message : error),
    };
  }
}

function readInventoryWithFallback(paths, mode) {
  const primary = readInventory(paths.localizationDir);
  const primaryUsable = Array.isArray(primary.locales) && primary.locales.length > 0;
  if (primaryUsable) {
    return { ...primary, source: 'current-mode' };
  }

  const fallbackMode = mode === 'mobile' ? 'desktop' : 'mobile';
  const fallbackDir = path.join(paths.sharedRoot, 'Autotest report', fallbackMode, 'localization');
  const fallback = readInventory(fallbackDir);
  const fallbackUsable = Array.isArray(fallback.locales) && fallback.locales.length > 0;
  if (!fallbackUsable) {
    return { ...primary, source: 'current-mode' };
  }

  return {
    ...fallback,
    source: `fallback-${fallbackMode}`,
    fallbackFrom: fallbackMode,
    primaryPath: primary.path,
    primaryReason: primary.reason || '',
  };
}

function copyLocaleArtifacts(paths, locale) {
  const localeTag = normalizeLocaleCode(locale) || String(locale || 'unknown').toLowerCase();
  const files = ['localization-language-inventory.json', 'localization-matrix.json'];

  for (const name of files) {
    const src = path.join(paths.localizationDir, name);
    if (!fs.existsSync(src)) continue;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    const dest = path.join(paths.localizationDir, `${base}.${localeTag}${ext}`);
    try {
      fs.copyFileSync(src, dest);
    } catch {
      // best effort
    }
  }
}

async function runLocalization({
  cwd,
  brand,
  mode,
  browser,
  targetLocales,
  strictBlocked,
  inventoryOnly,
  maxLangs,
  suiteTimeout,
  dryRun,
}) {
  const args = ['scripts/qa-localization-run.js', `--brand=${brand.key}`, `--mode=${mode}`];
  if (browser) args.push(`--browser=${browser}`);
  if (targetLocales) args.push(`--target-locales=${targetLocales}`);
  if (strictBlocked !== undefined) args.push(`--strict-blocked=${strictBlocked ? '1' : '0'}`);
  if (inventoryOnly) args.push('--inventory-only=1');
  if (Number.isFinite(maxLangs)) args.push(`--max-langs=${maxLangs}`);
  if (Number.isFinite(suiteTimeout) && suiteTimeout > 0)
    args.push(`--suite-timeout=${suiteTimeout}`);

  if (dryRun) {
    console.log(`> node ${args.join(' ')}`);
    return { code: 0, durationSec: 0, dryRun: true };
  }

  return runCommand('node', args, { cwd, env: process.env });
}

function writeSummary(paths, summary) {
  ensureDir(paths.artifactsDir);
  const jsonPath = path.join(paths.artifactsDir, 'localization-per-language-summary.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  const mdLines = [
    `# Localization Per-Language Summary (${summary.brand} | ${summary.mode})`,
    '',
    `Generated: ${summary.generatedAt}`,
    `Inventory path: ${summary.inventory.path}`,
    summary.inventory.source ? `Inventory source: ${summary.inventory.source}` : '',
    `Inventory locales: ${summary.inventory.locales.join(', ') || '-'}`,
    `Inventory blocked: ${summary.inventory.blocked ? 'yes' : 'no'}`,
    summary.inventory.reason ? `Inventory reason: ${summary.inventory.reason}` : '',
    summary.inventory.fallbackFrom
      ? `Inventory fallback from: ${summary.inventory.fallbackFrom} (primary: ${summary.inventory.primaryPath || '-'})`
      : '',
    '',
    '| Locale | Status | Duration (s) |',
    '| --- | --- | --- |',
    ...summary.runs.map((item) => {
      const status = item.dryRun ? 'PLANNED' : item.code === 0 ? 'PASSED' : 'FAILED';
      return `| ${item.locale} | ${status} | ${item.durationSec} |`;
    }),
    '',
  ].filter(Boolean);

  const mdPath = path.join(paths.localizationDir, 'localization-per-language-summary.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

  return { jsonPath, mdPath };
}

async function main() {
  const args = parseArgs(process.argv);
  const resolvedBrands = resolveBrands(args.brand || 'all');
  if (!resolvedBrands.ok) {
    console.error(`Unknown --brand value: ${resolvedBrands.unknown}`);
    process.exit(2);
  }

  const modes = resolveModes(args.mode || 'mobile');
  if (!modes.length) {
    console.error('Invalid --mode value. Allowed: desktop, mobile, all');
    process.exit(2);
  }

  const browser = String(args.browser || process.env.PW_BROWSER || 'chromium')
    .trim()
    .toLowerCase();
  const normalizedBrowser = ['chromium', 'firefox', 'webkit'].includes(browser)
    ? browser
    : 'chromium';
  const strictBlocked = boolFrom(args['strict-blocked'], true);
  const prewarm = boolFrom(args.prewarm, true);
  const dryRun = boolFrom(args['dry-run'], false);
  const localeFilter = normalizeLocaleCode(args.locale || '');
  const suiteTimeoutRaw = Number.parseInt(
    String(args['suite-timeout'] || process.env.PW_LOCALIZATION_SUITE_TIMEOUT_MS || '420000'),
    10
  );
  const suiteTimeout =
    Number.isFinite(suiteTimeoutRaw) && suiteTimeoutRaw > 0 ? suiteTimeoutRaw : 420000;

  const cwd = process.cwd();
  const overall = [];
  let hasFailure = false;

  for (const key of resolvedBrands.keys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;

    for (const mode of modes) {
      const paths = buildPaths(cwd, brand, mode);
      ensureWorkspace(paths);

      console.log(`\n=== ${brand.slug} [${mode}] localization per-language ===`);

      if (prewarm) {
        console.log('> saveState prewarm');
        const prewarmResult = await runSaveState({ cwd, brand, mode, paths, dryRun });
        if (prewarmResult.code !== 0) {
          console.log('⚠️  saveState prewarm failed; continuing to inventory discovery.');
        }
      }

      console.log('> inventory discovery');
      const inventoryRun = await runLocalization({
        cwd,
        brand,
        mode,
        browser: normalizedBrowser,
        targetLocales: undefined,
        strictBlocked: false,
        inventoryOnly: true,
        maxLangs: undefined,
        suiteTimeout,
        dryRun,
      });

      const inventory = readInventoryWithFallback(paths, mode);
      let locales = inventory.locales.slice();
      if (localeFilter) {
        locales = locales.filter((item) => item === localeFilter);
      }

      const summary = {
        generatedAt: new Date().toISOString(),
        brand: brand.slug,
        mode,
        browser: normalizedBrowser,
        strictBlocked,
        inventoryRun,
        inventory,
        runs: [],
      };

      if (!locales.length) {
        console.log(
          `⚠️  No locales discovered for ${brand.slug} [${mode}]${localeFilter ? ` after filter ${localeFilter}` : ''}.`
        );
        hasFailure = hasFailure || strictBlocked;
        const saved = writeSummary(paths, summary);
        overall.push({ brand: brand.slug, mode, code: strictBlocked ? 1 : 0, summary: saved });
        continue;
      }

      console.log(`Locales: ${locales.join(', ')}`);
      for (const locale of locales) {
        const run = await runLocalization({
          cwd,
          brand,
          mode,
          browser: normalizedBrowser,
          targetLocales: locale,
          strictBlocked,
          inventoryOnly: false,
          maxLangs: 1,
          suiteTimeout,
          dryRun,
        });
        summary.runs.push({ locale, ...run });
        copyLocaleArtifacts(paths, locale);
        if (run.code !== 0) hasFailure = true;
      }

      const saved = writeSummary(paths, summary);
      const code = summary.runs.some((item) => item.code !== 0) ? 1 : 0;
      overall.push({ brand: brand.slug, mode, code, summary: saved });
    }
  }

  console.log('\n=== Localization Per-Language Summary ===');
  for (const item of overall) {
    const status = item.code === 0 ? 'PASSED' : 'FAILED';
    console.log(`- ${item.brand} [${item.mode}] ${status} | ${item.summary.mdPath}`);
  }

  if (hasFailure) process.exit(1);
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});
