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
  const mode = String(rawMode || 'desktop')
    .trim()
    .toLowerCase();

  if (mode === 'all') return ['desktop', 'mobile'];
  if (VALID_MODES.has(mode)) return [mode];
  return [];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeShardArg(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^\d+\/\d+$/.test(raw)) return '';
  const [indexRaw, totalRaw] = raw.split('/').map((item) => Number.parseInt(item, 10));
  if (!Number.isFinite(indexRaw) || !Number.isFinite(totalRaw)) return '';
  if (totalRaw <= 1 || indexRaw <= 0 || indexRaw > totalRaw) return '';
  return `${indexRaw}/${totalRaw}`;
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

function runLocalization({
  cwd,
  brand,
  mode,
  maxLangs,
  routeMax,
  routeClicks,
  navTimeout,
  settleWait,
  linguistic,
  linguisticMaxIssues,
  linguisticSamplePages,
  linguisticMaxTextChars,
  linguisticTimeout,
  linguisticApi,
  suiteTimeout,
  shardArg,
  targetLocales,
  strictBlocked,
  inventoryOnly = false,
  browser = 'webkit',
  dryRun = false,
}) {
  const startedAt = Date.now();
  const paths = buildPaths(cwd, brand, mode);
  ensureWorkspace(paths);

  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_BROWSER: browser,
    PW_PROJECT_MATRIX: mode,
    QA_PROJECT_ROOT: paths.modeRoot,
    QA_PROJECT_SLUG: `${brand.slug}-${mode}`,
    QA_TEST_RESULTS_DIR: paths.testResultsDir,
    QA_ARTIFACTS_DIR: paths.artifactsDir,
    QA_AUTOTEST_REPORT_DIR: paths.autotestReportDir,
    QA_ANALYZE_DIR: paths.analyzeDir,
    PW_STORAGE_STATE: paths.storageState,
  };

  if (maxLangs !== undefined) env.PW_LOCALIZATION_MAX_LANGS = String(maxLangs);
  if (routeMax !== undefined) env.PW_LOCALIZATION_ROUTE_MAX = String(routeMax);
  if (routeClicks !== undefined) env.PW_LOCALIZATION_ROUTE_CLICKS = String(routeClicks);
  if (navTimeout !== undefined) env.PW_LOCALIZATION_NAV_TIMEOUT_MS = String(navTimeout);
  if (settleWait !== undefined) env.PW_LOCALIZATION_SETTLE_WAIT_MS = String(settleWait);
  if (linguistic !== undefined) env.PW_LOCALIZATION_LINGUISTIC = String(linguistic);
  if (linguisticMaxIssues !== undefined) {
    env.PW_LOCALIZATION_LINGUISTIC_MAX_ISSUES = String(linguisticMaxIssues);
  }
  if (linguisticSamplePages !== undefined) {
    env.PW_LOCALIZATION_LINGUISTIC_SAMPLE_PAGES = String(linguisticSamplePages);
  }
  if (linguisticMaxTextChars !== undefined) {
    env.PW_LOCALIZATION_LINGUISTIC_MAX_TEXT_CHARS = String(linguisticMaxTextChars);
  }
  if (linguisticTimeout !== undefined) {
    env.PW_LOCALIZATION_LINGUISTIC_TIMEOUT_MS = String(linguisticTimeout);
  }
  if (linguisticApi !== undefined) env.PW_LOCALIZATION_LINGUISTIC_API = String(linguisticApi);
  if (suiteTimeout !== undefined) env.PW_LOCALIZATION_SUITE_TIMEOUT_MS = String(suiteTimeout);
  if (shardArg) env.PW_PLAYWRIGHT_SHARD = String(shardArg);
  if (targetLocales) env.PW_LOCALIZATION_TARGET_LOCALES = String(targetLocales);
  if (strictBlocked !== undefined) env.PW_LOCALIZATION_STRICT_BLOCKED = String(strictBlocked);

  const args = [
    'playwright',
    'test',
    'tests/localization/brand-localization.spec.js',
    '--reporter=line',
    '--workers=1',
  ];
  if (inventoryOnly) {
    args.push('--grep');
    args.push('P0 Localization inventory');
  }
  if (shardArg) args.push(`--shard=${shardArg}`);

  if (dryRun) {
    console.log(`\n=== Localization ${brand.slug} [${mode}] (dry-run) ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`QA_PROJECT_ROOT=${paths.modeRoot}`);
    if (maxLangs !== undefined) console.log(`PW_LOCALIZATION_MAX_LANGS=${maxLangs}`);
    if (routeMax !== undefined) console.log(`PW_LOCALIZATION_ROUTE_MAX=${routeMax}`);
    if (routeClicks !== undefined) console.log(`PW_LOCALIZATION_ROUTE_CLICKS=${routeClicks}`);
    if (navTimeout !== undefined) console.log(`PW_LOCALIZATION_NAV_TIMEOUT_MS=${navTimeout}`);
    if (settleWait !== undefined) console.log(`PW_LOCALIZATION_SETTLE_WAIT_MS=${settleWait}`);
    if (linguistic !== undefined) console.log(`PW_LOCALIZATION_LINGUISTIC=${linguistic}`);
    if (linguisticMaxIssues !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_MAX_ISSUES=${linguisticMaxIssues}`);
    }
    if (linguisticSamplePages !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_SAMPLE_PAGES=${linguisticSamplePages}`);
    }
    if (linguisticMaxTextChars !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_MAX_TEXT_CHARS=${linguisticMaxTextChars}`);
    }
    if (linguisticTimeout !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_TIMEOUT_MS=${linguisticTimeout}`);
    }
    if (linguisticApi !== undefined) console.log(`PW_LOCALIZATION_LINGUISTIC_API=${linguisticApi}`);
    if (suiteTimeout !== undefined) {
      console.log(`PW_LOCALIZATION_SUITE_TIMEOUT_MS=${suiteTimeout}`);
    }
    if (targetLocales) console.log(`PW_LOCALIZATION_TARGET_LOCALES=${targetLocales}`);
    if (strictBlocked !== undefined) {
      console.log(`PW_LOCALIZATION_STRICT_BLOCKED=${strictBlocked}`);
    }
    if (inventoryOnly) console.log('Localization scope: inventory only (P0)');
    if (shardArg) console.log(`PW_PLAYWRIGHT_SHARD=${shardArg}`);
    console.log(`PW_BROWSER=${browser}`);
    console.log(`> npx ${args.join(' ')}`);
    return Promise.resolve({
      brand: brand.slug,
      mode,
      code: 0,
      durationSec: 0,
      reportDir: paths.autotestReportDir,
    });
  }

  return new Promise((resolve) => {
    console.log(`\n=== Localization ${brand.slug} [${mode}] ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`QA_PROJECT_ROOT=${paths.modeRoot}`);
    if (maxLangs !== undefined) console.log(`PW_LOCALIZATION_MAX_LANGS=${maxLangs}`);
    if (routeMax !== undefined) console.log(`PW_LOCALIZATION_ROUTE_MAX=${routeMax}`);
    if (routeClicks !== undefined) console.log(`PW_LOCALIZATION_ROUTE_CLICKS=${routeClicks}`);
    if (navTimeout !== undefined) console.log(`PW_LOCALIZATION_NAV_TIMEOUT_MS=${navTimeout}`);
    if (settleWait !== undefined) console.log(`PW_LOCALIZATION_SETTLE_WAIT_MS=${settleWait}`);
    if (linguistic !== undefined) console.log(`PW_LOCALIZATION_LINGUISTIC=${linguistic}`);
    if (linguisticMaxIssues !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_MAX_ISSUES=${linguisticMaxIssues}`);
    }
    if (linguisticSamplePages !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_SAMPLE_PAGES=${linguisticSamplePages}`);
    }
    if (linguisticMaxTextChars !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_MAX_TEXT_CHARS=${linguisticMaxTextChars}`);
    }
    if (linguisticTimeout !== undefined) {
      console.log(`PW_LOCALIZATION_LINGUISTIC_TIMEOUT_MS=${linguisticTimeout}`);
    }
    if (linguisticApi !== undefined) console.log(`PW_LOCALIZATION_LINGUISTIC_API=${linguisticApi}`);
    if (suiteTimeout !== undefined) {
      console.log(`PW_LOCALIZATION_SUITE_TIMEOUT_MS=${suiteTimeout}`);
    }
    if (targetLocales) console.log(`PW_LOCALIZATION_TARGET_LOCALES=${targetLocales}`);
    if (strictBlocked !== undefined) {
      console.log(`PW_LOCALIZATION_STRICT_BLOCKED=${strictBlocked}`);
    }
    if (inventoryOnly) console.log('Localization scope: inventory only (P0)');
    if (shardArg) console.log(`PW_PLAYWRIGHT_SHARD=${shardArg}`);

    const child = spawn('npx', args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      resolve({
        brand: brand.slug,
        mode,
        code: Number(code || 0),
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        reportDir: paths.autotestReportDir,
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const brandResolved = resolveBrands(args.brand || 'all');
  if (!brandResolved.ok) {
    console.error(`Unknown --brand value: ${brandResolved.unknown}`);
    console.error(`Allowed: ${Object.keys(BRAND_CATALOG).join(', ')}, all`);
    process.exit(2);
  }

  const modes = resolveModes(args.mode || 'desktop');
  if (!modes.length) {
    console.error('Invalid --mode value. Allowed: desktop, mobile, all');
    process.exit(2);
  }

  const maxLangs = Number.parseInt(String(args['max-langs'] || ''), 10);
  const normalizedMaxLangs = Number.isFinite(maxLangs) && maxLangs >= 0 ? maxLangs : 0;
  const routeMax = Number.parseInt(String(args['route-max'] || ''), 10);
  const normalizedRouteMax = Number.isFinite(routeMax) && routeMax > 0 ? routeMax : undefined;
  const routeClicks = Number.parseInt(String(args['route-clicks'] || ''), 10);
  const normalizedRouteClicks =
    Number.isFinite(routeClicks) && routeClicks > 0 ? routeClicks : undefined;
  const navTimeout = Number.parseInt(String(args['nav-timeout'] || ''), 10);
  const normalizedNavTimeout =
    Number.isFinite(navTimeout) && navTimeout > 0 ? navTimeout : undefined;
  const settleWait = Number.parseInt(String(args['settle-wait'] || ''), 10);
  const normalizedSettleWait =
    Number.isFinite(settleWait) && settleWait > 0 ? settleWait : undefined;
  const linguisticRaw =
    args.linguistic !== undefined ? String(args.linguistic).trim().toLowerCase() : '';
  const normalizedLinguistic =
    linguisticRaw === ''
      ? undefined
      : ['1', 'true', 'on', 'yes'].includes(linguisticRaw)
        ? '1'
        : ['0', 'false', 'off', 'no'].includes(linguisticRaw)
          ? '0'
          : undefined;
  const linguisticMaxIssues = Number.parseInt(String(args['linguistic-max-issues'] || ''), 10);
  const normalizedLinguisticMaxIssues =
    Number.isFinite(linguisticMaxIssues) && linguisticMaxIssues > 0
      ? linguisticMaxIssues
      : undefined;
  const linguisticSamplePages = Number.parseInt(String(args['linguistic-sample-pages'] || ''), 10);
  const normalizedLinguisticSamplePages =
    Number.isFinite(linguisticSamplePages) && linguisticSamplePages > 0
      ? linguisticSamplePages
      : undefined;
  const linguisticMaxTextChars = Number.parseInt(
    String(args['linguistic-max-text-chars'] || ''),
    10
  );
  const normalizedLinguisticMaxTextChars =
    Number.isFinite(linguisticMaxTextChars) && linguisticMaxTextChars > 0
      ? linguisticMaxTextChars
      : undefined;
  const linguisticTimeout = Number.parseInt(String(args['linguistic-timeout'] || ''), 10);
  const normalizedLinguisticTimeout =
    Number.isFinite(linguisticTimeout) && linguisticTimeout > 0 ? linguisticTimeout : undefined;
  const linguisticApi = String(args['linguistic-api'] || '').trim();
  const normalizedLinguisticApi = linguisticApi ? linguisticApi : undefined;
  const suiteTimeout = Number.parseInt(
    String(args['suite-timeout'] || process.env.PW_LOCALIZATION_SUITE_TIMEOUT_MS || ''),
    10
  );
  const normalizedSuiteTimeout =
    Number.isFinite(suiteTimeout) && suiteTimeout > 0 ? suiteTimeout : undefined;
  const targetLocales = String(args['target-locales'] || '').trim();
  const normalizedTargetLocales = targetLocales || undefined;
  const strictBlockedRaw = String(args['strict-blocked'] || '')
    .trim()
    .toLowerCase();
  const normalizedStrictBlocked =
    strictBlockedRaw === ''
      ? undefined
      : ['1', 'true', 'yes', 'on'].includes(strictBlockedRaw)
        ? '1'
        : ['0', 'false', 'no', 'off'].includes(strictBlockedRaw)
          ? '0'
          : undefined;
  const inventoryOnly = ['1', 'true', 'yes', 'on'].includes(
    String(args['inventory-only'] || '')
      .trim()
      .toLowerCase()
  );
  const browser = String(args.browser || process.env.PW_BROWSER || 'webkit')
    .trim()
    .toLowerCase();
  const normalizedBrowser = ['chromium', 'firefox', 'webkit'].includes(browser)
    ? browser
    : 'webkit';
  const shardFromArg = normalizeShardArg(args.shard || '');
  const shardFromEnv = normalizeShardArg(process.env.PW_PLAYWRIGHT_SHARD || '');
  const shardTotalRaw = Number.parseInt(
    String(args['shard-total'] || process.env.PW_LOCALIZATION_SHARD_TOTAL || ''),
    10
  );
  const shardIndexRaw = Number.parseInt(
    String(args['shard-index'] || process.env.PW_LOCALIZATION_SHARD_INDEX || ''),
    10
  );
  let normalizedShard = shardFromArg || shardFromEnv;
  if (!normalizedShard && Number.isFinite(shardTotalRaw) && shardTotalRaw > 1) {
    const safeIndex = Number.isFinite(shardIndexRaw) && shardIndexRaw > 0 ? shardIndexRaw : 1;
    const boundedIndex = Math.min(safeIndex, shardTotalRaw);
    normalizedShard = `${boundedIndex}/${shardTotalRaw}`;
  }
  const dryRun = args['dry-run'] === '1' || args['dry-run'] === 'true';

  const cwd = process.cwd();
  const results = [];

  for (const key of brandResolved.keys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;

    for (const mode of modes) {
      const result = await runLocalization({
        cwd,
        brand,
        mode,
        maxLangs: normalizedMaxLangs,
        routeMax: normalizedRouteMax,
        routeClicks: normalizedRouteClicks,
        navTimeout: normalizedNavTimeout,
        settleWait: normalizedSettleWait,
        linguistic: normalizedLinguistic,
        linguisticMaxIssues: normalizedLinguisticMaxIssues,
        linguisticSamplePages: normalizedLinguisticSamplePages,
        linguisticMaxTextChars: normalizedLinguisticMaxTextChars,
        linguisticTimeout: normalizedLinguisticTimeout,
        linguisticApi: normalizedLinguisticApi,
        suiteTimeout: normalizedSuiteTimeout,
        shardArg: normalizedShard,
        targetLocales: normalizedTargetLocales,
        strictBlocked: normalizedStrictBlocked,
        inventoryOnly,
        browser: normalizedBrowser,
        dryRun,
      });
      results.push(result);
    }
  }

  console.log('\n=== Localization Summary ===');
  for (const item of results) {
    const status = item.code === 0 ? 'PASSED' : 'FAILED';
    console.log(
      `- ${item.brand} [${item.mode}] ${status} | ${item.durationSec}s | ${item.reportDir}`
    );
  }

  const hasFailed = results.some((item) => item.code !== 0);
  if (hasFailed) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
