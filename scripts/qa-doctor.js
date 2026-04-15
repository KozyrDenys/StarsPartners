#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = new Set(process.argv.slice(2));
const isPreflight = args.has('--preflight');
const isStrict = isPreflight || args.has('--strict') || process.env.QA_DOCTOR_STRICT === '1';
const jsonOutput = args.has('--json');
const skipBrowserCheck = process.env.QA_DOCTOR_SKIP_BROWSER === '1';

const launchTimeoutMs = toPositiveInt(process.env.QA_DOCTOR_LAUNCH_TIMEOUT_MS, 60_000);
const navigationTimeoutMs = toPositiveInt(process.env.QA_DOCTOR_NAV_TIMEOUT_MS, 20_000);
const supportedNodeMajors = parseNodeMajors(process.env.QA_NODE_LTS_MAJORS || '20,22');

const checks = [];
const extraPathEntries = (() => {
  const items = [];
  const homeDir = process.env.HOME || '';
  if (homeDir) items.push(path.join(homeDir, '.local', 'bin'));
  items.push(path.join(process.cwd(), 'node_modules', '.bin'));

  const seen = new Set();
  return items.filter((item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
})();
const mergedPath = `${extraPathEntries.join(':')}${extraPathEntries.length ? ':' : ''}${
  process.env.PATH || ''
}`;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNodeMajors(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function runShell(command) {
  return spawnSync('/bin/zsh', ['-lc', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: mergedPath,
    },
  });
}

function commandExists(command) {
  const result = runShell(`command -v ${command}`);
  return result.status === 0;
}

function addCheck({ id, name, status, severity, message, details }) {
  checks.push({
    id,
    name,
    status,
    severity,
    message,
    details: details || '',
  });
}

function readNvmrcVersion() {
  const nvmPath = path.join(process.cwd(), '.nvmrc');
  if (!fs.existsSync(nvmPath)) return null;

  const raw = String(fs.readFileSync(nvmPath, 'utf8') || '')
    .split('\n')[0]
    .trim();
  if (!raw) return null;

  const match = raw.match(/(\d{2})/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function checkNodeVersion() {
  const rawVersion = process.versions && process.versions.node ? process.versions.node : '';
  const major = Number.parseInt(String(rawVersion).split('.')[0], 10);
  const expectedFromNvm = readNvmrcVersion();

  if (!Number.isFinite(major)) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: 'Unable to parse current Node.js version.',
      details: `process.versions.node=${rawVersion}`,
    });
    return;
  }

  if (!supportedNodeMajors.includes(major)) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: `Node.js ${rawVersion} is outside supported LTS set (${supportedNodeMajors.join(', ')}).`,
      details: 'Switch Node to LTS (recommended: 20) via nvm/fnm/volta.',
    });
    return;
  }

  if (Number.isFinite(expectedFromNvm) && expectedFromNvm !== major) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: `Node.js ${rawVersion} does not match .nvmrc major (${expectedFromNvm}).`,
      details: 'Run: nvm use (or equivalent).',
    });
    return;
  }

  addCheck({
    id: 'node-version',
    name: 'Node.js Version',
    status: 'pass',
    severity: 'critical',
    message: `Node.js ${rawVersion} is within supported LTS set (${supportedNodeMajors.join(', ')}).`,
    details: expectedFromNvm ? `.nvmrc=${expectedFromNvm}` : 'No .nvmrc pin found.',
  });
}

function checkPlaywrightCli() {
  const result = runShell('npx playwright --version');
  if (result.status !== 0) {
    addCheck({
      id: 'playwright-cli',
      name: 'Playwright CLI',
      status: 'fail',
      severity: 'critical',
      message: 'Playwright CLI is not available.',
      details: String(result.stderr || result.stdout || '').trim(),
    });
    return;
  }

  addCheck({
    id: 'playwright-cli',
    name: 'Playwright CLI',
    status: 'pass',
    severity: 'critical',
    message: String(result.stdout || '').trim() || 'Playwright CLI is available.',
  });
}

function checkCommand(name, options = {}) {
  const severity = options.severity || 'medium';
  const expected = options.expected || '';

  if (!commandExists(name)) {
    addCheck({
      id: `cmd-${name}`,
      name: `Command: ${name}`,
      status: options.missingStatus || 'warn',
      severity,
      message: `${name} is not installed or not in PATH.`,
      details: expected,
    });
    return;
  }

  let details = '';
  if (options.versionCmd) {
    const versionResult = runShell(options.versionCmd);
    details = String(versionResult.stdout || versionResult.stderr || '').trim();
  }

  addCheck({
    id: `cmd-${name}`,
    name: `Command: ${name}`,
    status: 'pass',
    severity,
    message: `${name} is available.`,
    details,
  });
}

function checkJavaRuntime() {
  const defaultResult = runShell('java -version');
  const defaultOutput = String(defaultResult.stderr || defaultResult.stdout || '').trim();
  const looksMissing =
    defaultResult.status !== 0 || /unable to locate a java runtime/i.test(defaultOutput);

  if (!looksMissing) {
    addCheck({
      id: 'java-runtime',
      name: 'Java Runtime',
      status: 'pass',
      severity: 'medium',
      message: 'Java runtime is available.',
      details: defaultOutput.split('\n').slice(0, 2).join(' | '),
    });
    return;
  }

  const fallbackCandidates = [
    '/opt/homebrew/opt/openjdk/bin/java',
    '/usr/local/opt/openjdk/bin/java',
  ];

  for (const candidate of fallbackCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const fallbackResult = runShell(`"${candidate}" -version`);
    if (fallbackResult.status === 0) {
      addCheck({
        id: 'java-runtime',
        name: 'Java Runtime',
        status: 'warn',
        severity: 'medium',
        message: 'Java runtime is installed but not present in PATH.',
        details: `${candidate} | Add OpenJDK bin to PATH before Allure/ZAP runs.`,
      });
      return;
    }
  }

  addCheck({
    id: 'java-runtime',
    name: 'Java Runtime',
    status: 'warn',
    severity: 'medium',
    message: 'Java runtime is missing. Allure/ZAP CLI flows may fail.',
    details: defaultOutput || 'Install OpenJDK (recommended: 21).',
  });
}

function checkAllure() {
  if (commandExists('allure')) {
    const result = runShell('allure --version');
    addCheck({
      id: 'allure-cli',
      name: 'Allure CLI',
      status: 'pass',
      severity: 'medium',
      message: 'Allure CLI is available.',
      details: String(result.stdout || result.stderr || '').trim(),
    });
    return;
  }

  const npxResult = runShell('npx --yes allure --version');
  if (npxResult.status === 0) {
    addCheck({
      id: 'allure-cli',
      name: 'Allure CLI',
      status: 'pass',
      severity: 'medium',
      message: 'Allure CLI is available via project dependency (npx allure).',
      details: String(npxResult.stdout || npxResult.stderr || '').trim(),
    });
    return;
  }

  addCheck({
    id: 'allure-cli',
    name: 'Allure CLI',
    status: 'warn',
    severity: 'medium',
    message: 'Allure CLI is not installed.',
    details: 'Install via Homebrew: brew install allure',
  });
}

function checkDocker() {
  if (!commandExists('docker')) {
    addCheck({
      id: 'docker-cli',
      name: 'Docker CLI',
      status: 'warn',
      severity: 'medium',
      message: 'Docker CLI is not installed.',
      details: 'Install Docker Desktop or docker+colima for reproducible security/perf layers.',
    });
    return;
  }

  const version = runShell('docker --version');
  const info = runShell('docker info --format "{{.ServerVersion}}"');
  const daemonOk = info.status === 0;

  addCheck({
    id: 'docker-cli',
    name: 'Docker CLI',
    status: daemonOk ? 'pass' : 'warn',
    severity: 'medium',
    message: daemonOk
      ? 'Docker CLI and daemon are available.'
      : 'Docker CLI is available but daemon is not reachable.',
    details: [
      String(version.stdout || version.stderr || '').trim(),
      String(info.stderr || '').trim(),
    ]
      .filter(Boolean)
      .join(' | '),
  });
}

function checkZap() {
  const zapPath = '/Applications/ZAP.app/Contents/Java/zap.sh';
  if (!fs.existsSync(zapPath)) {
    addCheck({
      id: 'zap-cli',
      name: 'OWASP ZAP',
      status: 'warn',
      severity: 'low',
      message: 'ZAP app binary was not found at default macOS path.',
      details: `Expected path: ${zapPath}`,
    });
    return;
  }

  addCheck({
    id: 'zap-cli',
    name: 'OWASP ZAP',
    status: 'pass',
    severity: 'low',
    message: 'ZAP binary is available.',
    details: zapPath,
  });
}

async function checkBrowserLaunchPreflight() {
  if (skipBrowserCheck) {
    addCheck({
      id: 'browser-preflight',
      name: 'Browser Launch Preflight',
      status: 'warn',
      severity: 'critical',
      message: 'Browser launch preflight was skipped by QA_DOCTOR_SKIP_BROWSER=1.',
    });
    return;
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    addCheck({
      id: 'browser-preflight',
      name: 'Browser Launch Preflight',
      status: 'fail',
      severity: 'critical',
      message: 'Unable to require Playwright module.',
      details: String((error && error.message) || error || ''),
    });
    return;
  }

  const engines = [
    { name: 'chromium', api: playwright.chromium },
    { name: 'webkit', api: playwright.webkit },
  ];

  for (const engine of engines) {
    let browser = null;
    let context = null;
    try {
      browser = await engine.api.launch({
        headless: true,
        timeout: launchTimeoutMs,
      });
      context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('data:text/html,<title>qa-doctor-ok</title><h1>ok</h1>', {
        timeout: navigationTimeoutMs,
      });
      const title = await page.title();

      addCheck({
        id: `browser-${engine.name}`,
        name: `Browser Launch: ${engine.name}`,
        status: 'pass',
        severity: 'critical',
        message: `${engine.name} launched successfully.`,
        details: `title=${title}`,
      });
    } catch (error) {
      addCheck({
        id: `browser-${engine.name}`,
        name: `Browser Launch: ${engine.name}`,
        status: 'fail',
        severity: 'critical',
        message: `${engine.name} failed to launch in preflight.`,
        details: String((error && error.message) || error || ''),
      });
    } finally {
      try {
        if (context) await context.close();
      } catch {
        // best-effort cleanup
      }
      try {
        if (browser) await browser.close();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function printHumanReport() {
  const statusIcon = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
  };

  console.log('\nQA Doctor Report');
  console.log(`Mode: ${isPreflight ? 'preflight' : 'audit'}${isStrict ? ' (strict)' : ''}`);
  console.log('');

  for (const check of checks) {
    const icon = statusIcon[check.status] || check.status.toUpperCase();
    const details = check.details ? ` | ${check.details}` : '';
    console.log(`[${icon}] [${check.severity}] ${check.name}: ${check.message}${details}`);
  }

  const totals = checks.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  console.log('');
  console.log(
    `Summary: pass=${totals.pass} warn=${totals.warn} fail=${totals.fail} (checks=${checks.length})`
  );
}

function shouldFailProcess() {
  const failed = checks.filter((item) => item.status === 'fail');
  if (!failed.length) return false;

  if (isStrict) return true;
  return failed.some((item) => item.severity === 'critical');
}

(async () => {
  checkNodeVersion();
  checkPlaywrightCli();

  checkCommand('mitmdump', {
    severity: 'low',
    versionCmd: 'mitmdump --version | head -n 1',
  });
  checkCommand('mitmweb', {
    severity: 'low',
    versionCmd: 'mitmweb --version | head -n 1',
  });
  checkCommand('jq', {
    severity: 'low',
    versionCmd: 'jq --version',
  });
  checkCommand('fd', {
    severity: 'low',
    versionCmd: 'fd --version | head -n 1',
    expected: 'Install via Homebrew: brew install fd',
  });
  checkCommand('bat', {
    severity: 'low',
    versionCmd: 'bat --version | head -n 1',
    expected: 'Install via Homebrew: brew install bat',
  });
  checkCommand('delta', {
    severity: 'low',
    versionCmd: 'delta --version | head -n 1',
    expected: 'Install via Homebrew: brew install git-delta',
  });
  checkCommand('http', {
    severity: 'low',
    versionCmd: 'http --version | head -n 1',
    expected: 'Install via Homebrew: brew install httpie',
  });
  checkCommand('gron', {
    severity: 'low',
    versionCmd: 'gron --version | head -n 1',
    expected: 'Install via Homebrew: brew install gron',
  });
  checkCommand('hyperfine', {
    severity: 'low',
    versionCmd: 'hyperfine --version | head -n 1',
    expected: 'Install via Homebrew: brew install hyperfine',
  });
  checkCommand('yq', {
    severity: 'low',
    versionCmd: 'yq --version',
  });
  checkCommand('k6', {
    severity: 'low',
    versionCmd: 'k6 version',
  });
  checkCommand('magick', {
    severity: 'low',
    versionCmd: 'magick -version | head -n 1',
  });
  checkCommand('newman', {
    severity: 'low',
    versionCmd: 'npx newman -v',
  });
  checkCommand('adb', {
    severity: 'low',
    versionCmd: 'adb version | head -n 1',
  });
  checkCommand('scrcpy', {
    severity: 'low',
    versionCmd: 'scrcpy --version | head -n 1',
  });
  checkCommand('websocat', {
    severity: 'low',
    versionCmd: 'websocat --version | head -n 1',
  });
  checkCommand('proxyman-cli', {
    severity: 'low',
    versionCmd: 'proxyman-cli --version | head -n 1',
    expected: 'Install Proxyman app/cask to enable proxyman-cli.',
  });
  checkCommand('tshark', {
    severity: 'low',
    versionCmd: 'tshark --version | head -n 1',
    expected:
      'Install Wireshark CLI (`brew install wireshark`). Optional GUI app: `brew install --cask wireshark-app`.',
  });
  checkCommand('schemathesis', {
    severity: 'medium',
    versionCmd: 'schemathesis --version || st --version',
    expected: 'Install via pipx (`pipx install schemathesis`) or pip (`pip install schemathesis`).',
  });
  checkCommand('spectral', {
    severity: 'medium',
    versionCmd: 'spectral --version',
    expected:
      'Install via npm (`npm i -D @stoplight/spectral-cli`) or globally (`npm i -g @stoplight/spectral-cli`).',
  });
  checkCommand('ffmpeg', {
    severity: 'low',
    versionCmd: 'ffmpeg -version | head -n 1',
  });

  checkJavaRuntime();
  checkAllure();
  checkZap();
  checkDocker();

  await checkBrowserLaunchPreflight();

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: isPreflight ? 'preflight' : 'audit',
    strict: isStrict,
    checks,
    summary: checks.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      { pass: 0, warn: 0, fail: 0 }
    ),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport();
  }

  process.exit(shouldFailProcess() ? 1 : 0);
})();
