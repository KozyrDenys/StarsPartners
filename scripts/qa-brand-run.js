const path = require('path');
const fs = require('fs');
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
const HIGH_CLOUDFLARE_BRANDS = new Set(DEFAULT_ORDER);
const VALID_MODES = new Set(['desktop', 'mobile']);

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      args[trimmed] = '1';
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    args[key] = value;
  }
  return args;
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (!mode) return 'desktop';
  if (!VALID_MODES.has(mode)) return '';
  return mode;
}

function resolveBrandKeys(rawBrand) {
  const input = String(rawBrand || 'all')
    .trim()
    .toLowerCase();
  if (!input || input === 'all') return DEFAULT_ORDER.slice();

  const tokens = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (tokens.length === 0) return DEFAULT_ORDER.slice();

  const resolved = [];
  for (const token of tokens) {
    if (!BRAND_CATALOG[token]) return { ok: false, unknown: token, keys: [] };
    if (!resolved.includes(token)) resolved.push(token);
  }
  return { ok: true, keys: resolved };
}

function modePaths(cwd, brand, mode) {
  const sharedRoot = path.join(cwd, 'projects', brand.slug);
  const modeRoot = path.join(sharedRoot, mode);
  const sharedAutotestReportDir = path.join(sharedRoot, 'Autotest report');
  return {
    sharedRoot,
    modeRoot,
    storageState: path.join(sharedRoot, 'storageState.json'),
    testResultsDir: path.join(modeRoot, 'test-results'),
    artifactsDir: path.join(modeRoot, 'artifacts'),
    legacyAutotestReportDir: path.join(modeRoot, 'Autotest report'),
    sharedAutotestReportDir,
    autotestReportDir: path.join(sharedAutotestReportDir, mode),
    analyzeDir: path.join(modeRoot, 'analyze'),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureModeWorkspace(paths) {
  if (!paths) return;
  ensureDir(paths.sharedRoot);
  ensureDir(paths.modeRoot);
  ensureDir(paths.testResultsDir);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.analyzeDir);
  ensureDir(paths.sharedAutotestReportDir);
  ensureDir(paths.autotestReportDir);
}

function migrateLegacyModeReports(paths) {
  const legacyDir = paths.legacyAutotestReportDir;
  const modeDir = paths.autotestReportDir;
  if (!legacyDir || !modeDir) return;
  if (!fs.existsSync(legacyDir)) return;

  ensureDir(modeDir);
  try {
    fs.cpSync(legacyDir, modeDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  } catch {
    // best-effort migration from legacy mode folder
  }
}

function reportExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function updateSharedReportsIndex({ brand, paths }) {
  const reportRoot = paths.sharedAutotestReportDir;
  if (!reportRoot) return;

  ensureDir(reportRoot);
  const modes = ['desktop', 'mobile'];
  const rows = [
    '# Autotest Reports Hub',
    '',
    `Brand: ${brand.slug}`,
    `Updated: ${new Date().toISOString()}`,
    '',
    '| Mode | Report MD | Report HTML | Report PDF | Bugs Index | Screenshots |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const mode of modes) {
    const modeDir = path.join(reportRoot, mode);
    const baseName = brand.slug;
    const mdPath = path.join(modeDir, `${baseName}.md`);
    const htmlPath = path.join(modeDir, `${baseName}.html`);
    const pdfPath = path.join(modeDir, `${baseName}.pdf`);
    const bugsIndexPath = path.join(modeDir, 'Bugs', 'index.md');
    const screenshotsPath = path.join(modeDir, 'Screenshots');
    const legacyMdPath = path.join(reportRoot, `${baseName}.md`);
    const legacyHtmlPath = path.join(reportRoot, `${baseName}.html`);
    const legacyPdfPath = path.join(reportRoot, `${baseName}.pdf`);
    const legacyBugsIndexPath = path.join(reportRoot, 'Bugs', 'index.md');
    const legacyScreenshotsPath = path.join(reportRoot, 'Screenshots');
    const allowLegacyFallback = mode === 'desktop';

    const mdLink = reportExists(mdPath)
      ? `[${baseName}.md](./${mode}/${baseName}.md)`
      : allowLegacyFallback && reportExists(legacyMdPath)
        ? `[${baseName}.md](./${baseName}.md)`
        : '-';
    const htmlLink = reportExists(htmlPath)
      ? `[${baseName}.html](./${mode}/${baseName}.html)`
      : allowLegacyFallback && reportExists(legacyHtmlPath)
        ? `[${baseName}.html](./${baseName}.html)`
        : '-';
    const pdfLink = reportExists(pdfPath)
      ? `[${baseName}.pdf](./${mode}/${baseName}.pdf)`
      : allowLegacyFallback && reportExists(legacyPdfPath)
        ? `[${baseName}.pdf](./${baseName}.pdf)`
        : '-';
    const bugsLink = reportExists(bugsIndexPath)
      ? `[index.md](./${mode}/Bugs/index.md)`
      : allowLegacyFallback && reportExists(legacyBugsIndexPath)
        ? `[index.md](./Bugs/index.md)`
        : '-';
    const screenshotsLink = reportExists(screenshotsPath)
      ? `[Screenshots](./${mode}/Screenshots/)`
      : allowLegacyFallback && reportExists(legacyScreenshotsPath)
        ? `[Screenshots](./Screenshots/)`
        : '-';

    rows.push(
      `| ${mode} | ${mdLink} | ${htmlLink} | ${pdfLink} | ${bugsLink} | ${screenshotsLink} |`
    );
  }

  rows.push('');
  rows.push('Notes:');
  rows.push('- All desktop/mobile reports are stored in this single brand-level folder.');
  rows.push('- Legacy mode folders remain untouched for backward compatibility.');
  rows.push('');

  const indexPath = path.join(reportRoot, 'index.md');
  fs.writeFileSync(indexPath, rows.join('\n'), 'utf8');
}

function buildRunEnv({ brand, mode, cwd }) {
  const paths = modePaths(cwd, brand, mode);
  const isHighCloudflareBrand = HIGH_CLOUDFLARE_BRANDS.has(brand.key);
  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_PROJECT_MATRIX: mode,
    PW_PRECHECK_PROJECT_MATRIX: mode,
    PW_PROVIDER_PROFILE: process.env.PW_PROVIDER_PROFILE || 'extended',
    QA_EXECUTION_MODE: mode,
    QA_PROJECT_ROOT: paths.modeRoot,
    QA_PROJECT_SLUG: `${brand.slug}-${mode}`,
    QA_TEST_RESULTS_DIR: paths.testResultsDir,
    QA_ARTIFACTS_DIR: paths.artifactsDir,
    QA_AUTOTEST_REPORT_DIR: paths.autotestReportDir,
    QA_ANALYZE_DIR: paths.analyzeDir,
    PW_STORAGE_STATE: paths.storageState,
    PW_FORCE_SAVE_STATE_BEFORE_RUN:
      process.env.PW_FORCE_SAVE_STATE_BEFORE_RUN || (isHighCloudflareBrand ? '1' : '0'),
    PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN:
      process.env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN ||
      (isHighCloudflareBrand && !process.env.CI ? '1' : '0'),
    PW_SAVE_STATE_WARMUP_ROUTES:
      process.env.PW_SAVE_STATE_WARMUP_ROUTES || '/,/assets/,/casino/,/casino/recent/',
    PW_SAVE_STATE_WARMUP_STRICT: process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    PW_SAVE_STATE_TIMEOUT: process.env.PW_SAVE_STATE_TIMEOUT || '120',
  };

  if (mode === 'mobile') {
    env.PW_PROVIDER_ONLY_MOBILE = '1';
    env.PW_PROVIDER_ENABLE_MOBILE = '1';
    env.PW_PROVIDER_DEMO_GAMES = process.env.PW_PROVIDER_DEMO_GAMES || '1';
    env.PW_PROVIDER_DEMO_MIN_GAMES = process.env.PW_PROVIDER_DEMO_MIN_GAMES || '1';
    env.PW_PROVIDER_DEMO_SCAN_MAX = process.env.PW_PROVIDER_DEMO_SCAN_MAX || '18';
    env.PW_PROVIDER_SCAN_LIMIT = process.env.PW_PROVIDER_SCAN_LIMIT || '22';
    env.PW_MOBILE_STABILIZE_RERUN = process.env.PW_MOBILE_STABILIZE_RERUN || '1';
    env.PW_SAVE_STATE_TIMEOUT = process.env.PW_SAVE_STATE_TIMEOUT || '150';
    env.PW_AUTO_BYPASS_CF_TIMEOUT_MS = process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '60000';

    // For high-Cloudflare brands mobile precheck often fails despite valid session cookies.
    // Keep run alive to collect actionable coverage from downstream suites.
    if (isHighCloudflareBrand) {
      env.PW_PRECHECK_SOFT = process.env.PW_PRECHECK_SOFT || '1';
      env.PW_SAVE_STATE_TIMEOUT = process.env.PW_SAVE_STATE_TIMEOUT || '240';
      env.PW_SAVE_STATE_WARMUP_TIMEOUT = process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || '90';
    }
  } else {
    env.PW_PROVIDER_ONLY_MOBILE = '0';
  }

  return { env, paths };
}

function runQaAllForBrand({ brand, mode, cwd, dryRun = false }) {
  const startedAt = Date.now();
  const { env, paths } = buildRunEnv({ brand, mode, cwd });
  ensureModeWorkspace(paths);
  migrateLegacyModeReports(paths);
  updateSharedReportsIndex({ brand, paths });

  if (dryRun) {
    console.log(`\n=== ${brand.slug} [${mode}] (dry-run) ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`Workspace: ${paths.modeRoot}`);
    console.log(`Reports Hub: ${paths.sharedAutotestReportDir}`);
    console.log(`Reports Mode Folder: ${paths.autotestReportDir}`);
    console.log(`PW_PROJECT_MATRIX=${env.PW_PROJECT_MATRIX}`);
    console.log(`PW_PRECHECK_PROJECT_MATRIX=${env.PW_PRECHECK_PROJECT_MATRIX}`);
    console.log(`PW_PRECHECK_SOFT=${env.PW_PRECHECK_SOFT || '0'}`);
    console.log(`PW_PROVIDER_ONLY_MOBILE=${env.PW_PROVIDER_ONLY_MOBILE || '0'}`);
    console.log(`PW_SAVE_STATE_TIMEOUT=${env.PW_SAVE_STATE_TIMEOUT || '-'}`);
    console.log(`PW_SAVE_STATE_WARMUP_TIMEOUT=${env.PW_SAVE_STATE_WARMUP_TIMEOUT || '-'}`);
    console.log(
      `PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=${env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN || '0'}`
    );
    console.log('> node scripts/qa-all.js');
    return Promise.resolve({
      brand: brand.slug,
      mode,
      code: 0,
      durationSec: 0,
      reportDir: paths.autotestReportDir,
    });
  }

  return new Promise((resolve) => {
    console.log(`\n=== ${brand.slug} [${mode}] ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`Workspace: ${paths.modeRoot}`);
    console.log(`Reports Hub: ${paths.sharedAutotestReportDir}`);
    console.log(`Reports Mode Folder: ${paths.autotestReportDir}`);
    console.log('> node scripts/qa-all.js');

    const child = spawn('node', ['scripts/qa-all.js'], {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      updateSharedReportsIndex({ brand, paths });
      resolve({
        brand: brand.slug,
        mode,
        code: Number(code || 0),
        durationSec,
        reportDir: paths.autotestReportDir,
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = normalizeMode(args.mode);
  if (!mode) {
    console.error('Invalid --mode value. Allowed: desktop, mobile');
    process.exit(2);
  }

  const resolvedBrands = resolveBrandKeys(args.brand || 'all');
  if (!Array.isArray(resolvedBrands)) {
    if (!resolvedBrands.ok) {
      console.error(`Unknown --brand value: "${resolvedBrands.unknown}".`);
      console.error(`Allowed: ${Object.keys(BRAND_CATALOG).join(', ')}, all`);
      process.exit(2);
    }
  }

  const brandKeys = Array.isArray(resolvedBrands) ? resolvedBrands : resolvedBrands.keys;
  const cwd = process.cwd();
  const dryRun = args['dry-run'] === '1' || args['dry-run'] === 'true';
  const results = [];

  for (const key of brandKeys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;
    // Run sequentially to keep logs/report generation deterministic per brand.
    const result = await runQaAllForBrand({ brand, mode, cwd, dryRun });
    results.push(result);
  }

  const failed = results.filter((item) => item.code !== 0);
  console.log('\n=== Brand Matrix Summary ===');
  for (const item of results) {
    const status = item.code === 0 ? 'PASSED' : 'FAILED';
    console.log(
      `- ${item.brand} [${item.mode}] ${status} | ${item.durationSec}s | ${item.reportDir}`
    );
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
