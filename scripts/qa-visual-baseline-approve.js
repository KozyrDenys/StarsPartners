#!/usr/bin/env node

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

function normalizeMode(rawMode) {
  const mode = String(rawMode || 'desktop')
    .trim()
    .toLowerCase();
  if (mode === 'all') return ['desktop', 'mobile'];
  if (VALID_MODES.has(mode)) return [mode];
  return [];
}

function resolveBrandKeys(rawBrand) {
  const input = String(rawBrand || 'all')
    .trim()
    .toLowerCase();
  if (!input || input === 'all') return { ok: true, keys: DEFAULT_ORDER.slice() };
  const tokens = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tokens.length) return { ok: true, keys: DEFAULT_ORDER.slice() };
  const keys = [];
  for (const token of tokens) {
    if (!BRAND_CATALOG[token]) return { ok: false, unknown: token, keys: [] };
    if (!keys.includes(token)) keys.push(token);
  }
  return { ok: true, keys };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function modePaths(cwd, brand, mode) {
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
  };
}

function ensureWorkspace(paths) {
  ensureDir(paths.sharedRoot);
  ensureDir(paths.modeRoot);
  ensureDir(paths.testResultsDir);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.autotestReportDir);
  ensureDir(paths.analyzeDir);
}

function runVisualBaseline({ cwd, brand, mode, browser, dryRun = false }) {
  const startedAt = Date.now();
  const paths = modePaths(cwd, brand, mode);
  ensureWorkspace(paths);
  const baselineTag = `${brand.slug}-${mode}`;
  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_BROWSER: browser,
    PW_PROJECT_MATRIX: mode,
    PW_VISUAL_REGRESSION: '1',
    PW_VISUAL_REQUIRED: '1',
    PW_VISUAL_BASELINE_TAG: baselineTag,
    QA_PROJECT_ROOT: paths.modeRoot,
    QA_PROJECT_SLUG: `${brand.slug}-${mode}`,
    QA_TEST_RESULTS_DIR: paths.testResultsDir,
    QA_ARTIFACTS_DIR: paths.artifactsDir,
    QA_AUTOTEST_REPORT_DIR: paths.autotestReportDir,
    QA_ANALYZE_DIR: paths.analyzeDir,
    PW_STORAGE_STATE: paths.storageState,
  };
  const args = [
    'playwright',
    'test',
    'tests/visual/site-visual-smoke.spec.js',
    '--reporter=line',
    '--workers=1',
    '--update-snapshots',
  ];

  if (dryRun) {
    console.log(`\n=== Visual baseline ${brand.slug} [${mode}] (dry-run) ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`PW_BROWSER=${browser}`);
    console.log(`PW_VISUAL_BASELINE_TAG=${baselineTag}`);
    console.log(`> npx ${args.join(' ')}`);
    return Promise.resolve({
      brand: brand.slug,
      mode,
      code: 0,
      durationSec: 0,
      baselineTag,
    });
  }

  return new Promise((resolve) => {
    console.log(`\n=== Visual baseline ${brand.slug} [${mode}] ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`PW_BROWSER=${browser}`);
    console.log(`PW_VISUAL_BASELINE_TAG=${baselineTag}`);
    console.log(`> npx ${args.join(' ')}`);
    const child = spawn('npx', args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code) => {
      resolve({
        brand: brand.slug,
        mode,
        code: Number(code || 0),
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        baselineTag,
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const brandResolved = resolveBrandKeys(args.brand || 'all');
  if (!brandResolved.ok) {
    console.error(`Unknown --brand value: ${brandResolved.unknown}`);
    console.error(`Allowed: ${Object.keys(BRAND_CATALOG).join(', ')}, all`);
    process.exit(2);
  }

  const modes = normalizeMode(args.mode || 'desktop');
  if (!modes.length) {
    console.error('Invalid --mode value. Allowed: desktop, mobile, all');
    process.exit(2);
  }

  const browserRaw = String(args.browser || process.env.PW_BROWSER || 'chromium')
    .trim()
    .toLowerCase();
  const browser = ['chromium', 'firefox', 'webkit'].includes(browserRaw) ? browserRaw : 'chromium';
  const dryRun = args['dry-run'] === '1' || args['dry-run'] === 'true';
  const cwd = process.cwd();
  const results = [];

  for (const key of brandResolved.keys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;
    for (const mode of modes) {
      const result = await runVisualBaseline({ cwd, brand, mode, browser, dryRun });
      results.push(result);
    }
  }

  console.log('\n=== Visual Baseline Summary ===');
  for (const item of results) {
    const status = item.code === 0 ? 'PASSED' : 'FAILED';
    console.log(
      `- ${item.brand} [${item.mode}] ${status} | ${item.durationSec}s | tag=${item.baselineTag}`
    );
  }
  if (results.some((item) => item.code !== 0)) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
