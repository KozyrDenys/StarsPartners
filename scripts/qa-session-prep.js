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
  return VALID_MODES.has(mode) ? mode : '';
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
  return {
    sharedRoot,
    modeRoot,
    storageState: path.join(sharedRoot, 'storageState.json'),
    profileDir: path.join(sharedRoot, '.pw-profile', mode),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runSaveState({ brand, mode, cwd, auto = false }) {
  const paths = modePaths(cwd, brand, mode);
  ensureDir(paths.sharedRoot);
  ensureDir(paths.modeRoot);
  ensureDir(path.dirname(paths.storageState));
  ensureDir(paths.profileDir);

  const mobile = mode === 'mobile';
  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_PROJECT_MATRIX: mode,
    PW_PRECHECK_PROJECT_MATRIX: mode,
    QA_EXECUTION_MODE: mode,
    QA_PROJECT_ROOT: paths.modeRoot,
    QA_PROJECT_SLUG: `${brand.slug}-${mode}`,
    PW_STORAGE_STATE: paths.storageState,
    PW_SAVE_STATE_PERSISTENT: process.env.PW_SAVE_STATE_PERSISTENT || '1',
    PW_SAVE_STATE_PROFILE_DIR: process.env.PW_SAVE_STATE_PROFILE_DIR || paths.profileDir,
    PW_SAVE_STATE_TIMEOUT: process.env.PW_SAVE_STATE_TIMEOUT || (mobile ? '240' : '180'),
    PW_SAVE_STATE_WARMUP_TIMEOUT:
      process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || (mobile ? '90' : '75'),
    PW_SAVE_STATE_WARMUP_ROUTES:
      process.env.PW_SAVE_STATE_WARMUP_ROUTES || '/,/assets/,/casino/,/casino/recent/',
    PW_SAVE_STATE_WARMUP_STRICT: process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    PW_SAVE_STATE_VIEWPORT: process.env.PW_SAVE_STATE_VIEWPORT || (mobile ? '390x844' : '1365x900'),
    PW_SAVE_STATE_IS_MOBILE: process.env.PW_SAVE_STATE_IS_MOBILE || (mobile ? '1' : '0'),
    PW_AUTO_BYPASS_CF_TIMEOUT_MS: process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '60000',
    PW_USE_CHROME_CHANNEL: process.env.PW_USE_CHROME_CHANNEL || '1',
  };

  const args = ['analyze/saveState.js', `${brand.baseUrl}/`, paths.storageState];
  if (auto) args.push('--auto');

  return new Promise((resolve) => {
    console.log(`\n=== Session prep: ${brand.slug} [${mode}] ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`StorageState=${paths.storageState}`);
    console.log(`Profile=${paths.profileDir}`);
    console.log(`Mode=${auto ? 'auto' : 'manual'}`);
    console.log(`> node ${args.join(' ')}`);

    const child = spawn('node', args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(Number(code || 0)));
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
  const auto = args.auto === '1' || args.auto === 'true';
  const cwd = process.cwd();
  const failed = [];

  for (const key of brandKeys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;
    const code = await runSaveState({ brand, mode, cwd, auto });
    if (code !== 0) failed.push({ brand: brand.slug, mode, code });
  }

  if (failed.length > 0) {
    console.log('\n=== Session prep summary ===');
    for (const item of failed) {
      console.log(`- ${item.brand} [${item.mode}] FAILED (code=${item.code})`);
    }
    process.exit(1);
  }

  console.log('\n✅ Session prep completed.');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
