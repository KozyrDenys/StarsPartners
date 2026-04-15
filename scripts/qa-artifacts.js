const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Buffer } = require('buffer');
const { chromium } = require('playwright');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');

const cwd = process.cwd();
const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
const projectPaths = resolveProjectPaths({ cwd, baseUrl });

const reportDir = projectPaths.testResultsDir;
const phaseReportsDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const phaseTestResultsDir = path.join(projectPaths.artifactsDir, 'phase-test-results');
const reportPath = path.join(reportDir, 'report.json');
const autotestReportDir = projectPaths.autotestReportDir;

const screenshotsRoot = path.join(autotestReportDir, 'Screenshots');
const screenshotsAllDir = path.join(screenshotsRoot, 'All');
const screenshotsFailDir = path.join(screenshotsRoot, 'Fail');
const bugsRoot = path.join(autotestReportDir, 'Bugs');

const phaseReportCandidates = [
  {
    phase: 'precheck',
    paths: [
      path.join(phaseReportsDir, 'precheck-report.json'),
      path.join(reportDir, 'precheck-report.json'),
    ],
  },
  {
    phase: 'home',
    paths: [
      path.join(phaseReportsDir, 'home-report.json'),
      path.join(reportDir, 'home-report.json'),
    ],
  },
  {
    phase: 'registration',
    paths: [
      path.join(phaseReportsDir, 'registration-report.json'),
      path.join(reportDir, 'registration-report.json'),
    ],
  },
  {
    phase: 'auth',
    paths: [
      path.join(phaseReportsDir, 'auth-report.json'),
      path.join(reportDir, 'auth-report.json'),
    ],
  },
  {
    phase: 'profile',
    paths: [
      path.join(phaseReportsDir, 'profile-report.json'),
      path.join(reportDir, 'profile-report.json'),
    ],
  },
  {
    phase: 'deposit',
    paths: [
      path.join(phaseReportsDir, 'deposit-report.json'),
      path.join(reportDir, 'deposit-report.json'),
    ],
  },
  {
    phase: 'withdraw',
    paths: [
      path.join(phaseReportsDir, 'withdraw-report.json'),
      path.join(reportDir, 'withdraw-report.json'),
    ],
  },
  {
    phase: 'sidebar',
    paths: [
      path.join(phaseReportsDir, 'sidebar-report.json'),
      path.join(reportDir, 'sidebar-report.json'),
    ],
  },
  {
    phase: 'sports',
    paths: [
      path.join(phaseReportsDir, 'sports-report.json'),
      path.join(reportDir, 'sports-report.json'),
    ],
  },
  {
    phase: 'casino',
    paths: [
      path.join(phaseReportsDir, 'casino-report.json'),
      path.join(reportDir, 'casino-report.json'),
    ],
  },
  {
    phase: 'livecasino',
    paths: [
      path.join(phaseReportsDir, 'livecasino-report.json'),
      path.join(reportDir, 'livecasino-report.json'),
    ],
  },
  {
    phase: 'security',
    paths: [
      path.join(phaseReportsDir, 'security-report.json'),
      path.join(reportDir, 'security-report.json'),
    ],
  },
  {
    phase: 'contracts',
    paths: [
      path.join(phaseReportsDir, 'contracts-report.json'),
      path.join(reportDir, 'contracts-report.json'),
    ],
  },
  {
    phase: 'nightlyextras',
    paths: [
      path.join(phaseReportsDir, 'nightlyextras-report.json'),
      path.join(reportDir, 'nightlyextras-report.json'),
    ],
  },
  {
    phase: 'a11y',
    paths: [
      path.join(phaseReportsDir, 'a11y-report.json'),
      path.join(reportDir, 'a11y-report.json'),
    ],
  },
  {
    phase: 'visual',
    paths: [
      path.join(phaseReportsDir, 'visual-report.json'),
      path.join(reportDir, 'visual-report.json'),
    ],
  },
  {
    phase: 'main',
    paths: [
      path.join(phaseReportsDir, 'main-report.json'),
      path.join(reportDir, 'main-report.json'),
    ],
  },
  {
    phase: 'destructive',
    paths: [
      path.join(phaseReportsDir, 'destructive-report.json'),
      path.join(reportDir, 'destructive-report.json'),
    ],
  },
];

const imageExtRe = /\.(png|jpe?g|webp|gif|bmp)$/i;
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);
const safeRootIgnoreNames = new Set(['node_modules', '.git', 'Screenshots', 'Bugs']);

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function stripAnsi(value) {
  const input = String(value || '');
  let output = '';
  let i = 0;

  while (i < input.length) {
    const charCode = input.charCodeAt(i);
    if (charCode === 27) {
      i += 1;
      if (input[i] === '[') {
        i += 1;
        while (i < input.length) {
          const code = input.charCodeAt(i);
          if (code >= 64 && code <= 126) {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      continue;
    }

    output += input[i];
    i += 1;
  }

  return output;
}

function oneLine(value) {
  return stripAnsi(value).replace(/\s+/g, ' ').trim();
}

function slugify(value, max = 96) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'item';
  return slug.slice(0, max);
}

function sanitizeFileName(name) {
  const ext = path.extname(name || '');
  const base = path.basename(name || '', ext);
  const safeBase = slugify(base, 120) || 'file';
  const safeExt = ext && /^[.a-z0-9_-]+$/i.test(ext) ? ext.toLowerCase() : '';
  return `${safeBase}${safeExt}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function isSubPath(filePath, rootPath) {
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(rootPath);
  return absFile === absRoot || absFile.startsWith(`${absRoot}${path.sep}`);
}

function toAbsolutePath(filePath) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function firstFileByBasename(rootPath, fileName) {
  if (!rootPath || !fileName || !fs.existsSync(rootPath)) return '';
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) return fullPath;
    }
  }

  return '';
}

function resolveAttachmentPath(attachmentPath, phase) {
  if (!attachmentPath) return '';
  const direct = toAbsolutePath(attachmentPath);
  if (direct && fs.existsSync(direct)) return direct;

  const phaseRoot = path.join(phaseTestResultsDir, String(phase || ''));
  if (!fs.existsSync(phaseRoot)) return '';

  const normalized = String(attachmentPath).replace(/\\/g, '/');
  const marker = '/test-results/';
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  let relativeFromTestResults = '';

  if (markerIndex >= 0) {
    relativeFromTestResults = normalized.slice(markerIndex + marker.length);
  } else if (normalized.toLowerCase().startsWith('test-results/')) {
    relativeFromTestResults = normalized.slice('test-results/'.length);
  }

  if (relativeFromTestResults) {
    const candidate = path.join(phaseRoot, relativeFromTestResults);
    if (fs.existsSync(candidate)) return candidate;
  }

  return firstFileByBasename(phaseRoot, path.basename(normalized));
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const attachmentPath = String(attachment.path || '');
  return imageExtRe.test(attachmentPath);
}

function uniquePath(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const name = path.basename(basePath, ext);
  let index = 1;
  while (true) {
    const candidate = path.join(dir, `${name}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    index += 1;
  }
}

function copyFileSafe(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  ensureDir(path.dirname(targetPath));
  const destination = uniquePath(targetPath);
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

function writeBodyAttachment(body, contentType, targetPathWithoutExt) {
  if (typeof body !== 'string' || !body.length) return '';
  const ext = extensionFromContentType(contentType);
  const targetPath = uniquePath(`${targetPathWithoutExt}${ext}`);
  ensureDir(path.dirname(targetPath));

  try {
    const bytes = Buffer.from(body, 'base64');
    fs.writeFileSync(targetPath, bytes);
    return targetPath;
  } catch {
    fs.writeFileSync(targetPath, body, 'utf8');
    return targetPath;
  }
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png')) return '.png';
  if (type.includes('image/jpeg')) return '.jpg';
  if (type.includes('image/webp')) return '.webp';
  if (type.includes('application/json')) return '.json';
  if (type.includes('text/html')) return '.html';
  if (type.includes('text/plain')) return '.txt';
  if (type.includes('application/zip')) return '.zip';
  if (type.includes('application/pdf')) return '.pdf';
  return '.bin';
}

function collectAnnotations(test, results) {
  const entries = [];
  const seen = new Set();
  const raw = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : [])),
  ];

  for (const annotation of raw) {
    const type = oneLine(annotation && annotation.type ? annotation.type : 'note') || 'note';
    const description = oneLine(annotation && annotation.description ? annotation.description : '');
    const key = `${type}:${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ type, description });
  }

  return entries;
}

function uniquePathParts(parts) {
  const unique = [];
  for (const part of parts || []) {
    const text = oneLine(part);
    if (!text) continue;
    if (unique[unique.length - 1] !== text) unique.push(text);
  }
  return unique;
}

function collectTestsFromSuite(suite, phase, acc = [], suitePath = []) {
  if (!suite) return acc;
  const nextSuitePath = suite.title ? [...suitePath, suite.title] : suitePath;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      const specFile = spec.file || spec.location?.file || '';
      const specTitle = oneLine(spec.title || '');
      const specPath = uniquePathParts([...nextSuitePath, specTitle]);

      for (const test of spec.tests || []) {
        const results = Array.isArray(test.results) ? test.results : [];
        const final = results[results.length - 1] || {};
        const title = oneLine(test.title || specTitle || '(untitled)');
        const explicitTitlePath = Array.isArray(test.titlePath)
          ? uniquePathParts(test.titlePath)
          : uniquePathParts([...specPath, title]);

        const errorMessage =
          oneLine(final.error?.message) ||
          oneLine(final.errors?.[0]?.message) ||
          oneLine(
            results
              .flatMap((result) => result.errors || [])
              .map((error) => error?.message || '')
              .find(Boolean)
          );

        acc.push({
          phase,
          title,
          titlePath: explicitTitlePath.join(' > ') || title,
          file: specFile,
          projectName: oneLine(test.projectName || final.projectName || ''),
          status: final.status || test.status || 'unknown',
          error: errorMessage,
          annotations: collectAnnotations(test, results),
          attachments: Array.isArray(final.attachments) ? final.attachments : [],
          stdout: Array.isArray(final.stdout) ? final.stdout : [],
          stderr: Array.isArray(final.stderr) ? final.stderr : [],
        });
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) collectTestsFromSuite(child, phase, acc, nextSuitePath);
  }

  return acc;
}

function loadReportSources() {
  const phaseSources = phaseReportCandidates
    .map((entry) => {
      for (const candidatePath of entry.paths) {
        const data = readJson(candidatePath);
        if (data) return { phase: entry.phase, path: candidatePath, data };
      }
      return null;
    })
    .filter(Boolean);

  if (phaseSources.length) return phaseSources;

  const fallback = readJson(reportPath);
  if (fallback) {
    return [{ phase: 'latest', path: reportPath, data: fallback }];
  }

  return [];
}

function walkImages(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const found = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (safeRootIgnoreNames.has(entry.name)) continue;
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (imageExtRe.test(entry.name)) found.push(fullPath);
    }
  }

  return found;
}

function groupedAllDestination(sourcePath) {
  if (isSubPath(sourcePath, autotestReportDir)) {
    const rel = path.relative(autotestReportDir, sourcePath);
    return path.join(screenshotsAllDir, 'autotest-report', rel);
  }
  if (isSubPath(sourcePath, reportDir)) {
    const rel = path.relative(reportDir, sourcePath);
    return path.join(screenshotsAllDir, 'test-results', rel);
  }
  if (isSubPath(sourcePath, phaseReportsDir)) {
    const rel = path.relative(phaseReportsDir, sourcePath);
    return path.join(screenshotsAllDir, 'phase-reports', rel);
  }
  if (isSubPath(sourcePath, projectPaths.analyzeDir)) {
    const rel = path.relative(projectPaths.analyzeDir, sourcePath);
    return path.join(screenshotsAllDir, 'analyze', rel);
  }
  if (isSubPath(sourcePath, projectPaths.artifactsDir)) {
    const rel = path.relative(projectPaths.artifactsDir, sourcePath);
    return path.join(screenshotsAllDir, 'artifacts', rel);
  }
  return path.join(screenshotsAllDir, 'misc', path.basename(sourcePath));
}

function formatOutput(outputEntries) {
  if (!Array.isArray(outputEntries) || outputEntries.length === 0) return '';
  return outputEntries
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return oneLine(entry && (entry.text || entry.message || JSON.stringify(entry)));
    })
    .filter(Boolean)
    .join('\n');
}

function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s|)]+/gi;
  const source = String(text || '');
  let match = re.exec(source);
  while (match) {
    urls.push(match[0]);
    match = re.exec(source);
  }
  return urls;
}

function pushNetworkCandidate(list, candidate) {
  if (!candidate || !candidate.url) return;
  const normalized = {
    url: String(candidate.url || ''),
    method: oneLine(candidate.method || ''),
    status: Number.isFinite(Number(candidate.status)) ? Number(candidate.status) : null,
    statusText: oneLine(candidate.statusText || ''),
    errorText: oneLine(candidate.errorText || ''),
    consoleError: oneLine(candidate.consoleError || ''),
    source: oneLine(candidate.source || ''),
  };
  const key = JSON.stringify(normalized);
  if (list.keys.has(key)) return;
  list.keys.add(key);
  list.items.push(normalized);
}

function collectNetworkFromJson(value, list, sourceLabel) {
  if (!value || typeof value !== 'object') return;
  const stack = [value];
  let guard = 0;

  while (stack.length > 0 && guard < 5000) {
    guard += 1;
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current.url === 'string') {
      pushNetworkCandidate(list, {
        url: current.url,
        method: current.method,
        status: current.status,
        statusText: current.statusText,
        errorText: current.errorText,
        source: sourceLabel,
      });
    }

    if (current.location && typeof current.location.url === 'string' && current.text) {
      pushNetworkCandidate(list, {
        url: current.location.url,
        consoleError: current.text,
        source: sourceLabel,
      });
    }

    for (const valueItem of Object.values(current)) {
      if (valueItem && typeof valueItem === 'object') stack.push(valueItem);
    }
  }
}

function pickPrimaryNetwork(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const highPriority = candidates.find(
    (item) =>
      (typeof item.status === 'number' && item.status >= 400) || item.errorText || item.consoleError
  );
  return highPriority || candidates[0];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asRelative(absolutePath, root) {
  const rel = path.relative(root, absolutePath);
  return rel.split(path.sep).join('/');
}

function dedupeStrings(items) {
  const output = [];
  const seen = new Set();
  for (const raw of items || []) {
    const value = oneLine(raw || '');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function inferExecutionMode(test) {
  const envMode = oneLine(process.env.QA_EXECUTION_MODE || '').toLowerCase();
  if (envMode === 'mobile' || envMode === 'desktop') return envMode;

  const projectName = oneLine(test && test.projectName ? test.projectName : '').toLowerCase();
  if (projectName.includes('mobile')) return 'mobile';
  if (projectName.includes('desktop')) return 'desktop';

  const titlePath = oneLine(test && test.titlePath ? test.titlePath : '').toLowerCase();
  if (/\[mobile\]|\bmobile\b/.test(titlePath)) return 'mobile';
  if (/\[desktop\]|\bdesktop\b/.test(titlePath)) return 'desktop';

  return 'desktop';
}

function inferAreaContext(test) {
  const fileLower = String(test.file || '').toLowerCase();
  const titleLower = oneLine(`${test.titlePath || ''} ${test.title || ''}`).toLowerCase();
  const phaseLower = String(test.phase || '').toLowerCase();

  if (
    fileLower.includes('livecasino') ||
    phaseLower === 'livecasino' ||
    /\blive casino\b/.test(titleLower)
  ) {
    return { key: 'livecasino', label: 'Live Casino', route: '/live-casino' };
  }
  if (fileLower.includes('casino') || phaseLower === 'casino' || /\bcasino\b/.test(titleLower)) {
    return { key: 'casino', label: 'Casino', route: '/casino' };
  }
  if (fileLower.includes('sports') || phaseLower === 'sports' || /\bsports?\b/.test(titleLower)) {
    return { key: 'sports', label: 'Sports', route: '/sports' };
  }
  if (fileLower.includes('deposit') || phaseLower === 'deposit' || /\bdeposit\b/.test(titleLower)) {
    return { key: 'deposit', label: 'Deposit', route: '/deposit' };
  }
  if (
    fileLower.includes('withdraw') ||
    phaseLower === 'withdraw' ||
    /\bwithdraw\b|\bcashout\b/.test(titleLower)
  ) {
    return { key: 'withdraw', label: 'Withdraw', route: '/assets' };
  }
  if (
    fileLower.includes('profile') ||
    phaseLower === 'profile' ||
    phaseLower === 'security' ||
    /\bmy profile\b|\bsecurity\b/.test(titleLower)
  ) {
    return { key: 'profile', label: 'My Profile', route: '/profile' };
  }
  if (
    fileLower.includes('contract') ||
    phaseLower === 'contracts' ||
    /\bcontract\b|\bopenapi\b|\bschemathesis\b|\bspectral\b/.test(titleLower)
  ) {
    return { key: 'contracts', label: 'Contracts', route: '/api' };
  }
  if (fileLower.includes('sidebar') || phaseLower === 'sidebar' || /\bsidebar\b/.test(titleLower)) {
    return { key: 'sidebar', label: 'Sidebar', route: '/' };
  }
  if (
    fileLower.includes('signup') ||
    phaseLower === 'registration' ||
    /\bregistration\b|\bsign[\s-]?up\b/.test(titleLower)
  ) {
    return { key: 'registration', label: 'Registration', route: '/' };
  }
  if (
    fileLower.includes('login') ||
    phaseLower === 'auth' ||
    /\blog[\s-]?in\b|\bauth\b/.test(titleLower)
  ) {
    return { key: 'auth', label: 'Login', route: '/' };
  }
  if (
    fileLower.includes('home') ||
    fileLower.includes('precheck') ||
    phaseLower === 'home' ||
    phaseLower === 'precheck'
  ) {
    return { key: 'home', label: 'Home', route: '/' };
  }
  return { key: phaseLower || 'main', label: 'Application', route: '/' };
}

function inferUserState({ test, area }) {
  const titleLower = oneLine(`${test.titlePath || ''} ${test.title || ''}`).toLowerCase();
  const phaseLower = String(test.phase || '').toLowerCase();

  if (/\bguest\b/.test(titleLower)) return 'guest';
  if (/\bauthorized\b|\blogged in\b|\blog in\b|\bsigned in\b/.test(titleLower)) return 'authorized';
  if (/\bregistration\b|\bsign[\s-]?up\b/.test(titleLower)) return 'guest';
  if (area.key === 'auth' || area.key === 'home' || area.key === 'registration') return 'guest';
  if (area.key === 'profile' || area.key === 'deposit' || area.key === 'sports')
    return 'authorized';
  if (
    area.key === 'casino' &&
    /\breal\b|\bnon-demo\b|\bfavorites?\b|\bhistory\b|\brecent\b|\bplay opens\b/.test(titleLower)
  ) {
    return 'authorized';
  }
  if (phaseLower === 'sidebar' && /\bauthorized\b/.test(titleLower)) return 'authorized';
  return 'guest';
}

function extractProviderName(title) {
  const normalizedTitle = oneLine(title || '');
  const providerMatch =
    normalizedTitle.match(/provider[^()]*\(([^)]+)\)/i) ||
    normalizedTitle.match(/real launch \(([^)]+)\)/i) ||
    normalizedTitle.match(/launch \(([^)]+)\)/i);
  return providerMatch ? oneLine(providerMatch[1]) : '';
}

function inferExpectedResult({ area, title, providerName }) {
  const titleLower = oneLine(title || '').toLowerCase();
  if (providerName && /\bprovider\b.*\breal launch\b|\bnon-demo\b/.test(titleLower)) {
    return `Game from provider "${providerName}" opens in non-demo mode and remains stable (no request failures or critical console errors).`;
  }
  if (/\bdemo\b|\btry for fun\b/.test(titleLower)) {
    return 'Selected game opens in demo mode and the game surface remains stable.';
  }
  if (/\bsearch\b/.test(titleLower)) {
    return 'Search control opens, accepts input, and returns expected results without UI/runtime errors.';
  }
  if (/\bfilter\b/.test(titleLower)) {
    return 'Filter panel opens, selected filter is applied, and catalog/list updates correctly.';
  }
  if (area.key === 'deposit') {
    return 'Deposit surface opens and visible payment methods are interactive without runtime errors.';
  }
  if (area.key === 'profile') {
    return 'Profile section opens and all targeted controls are interactive without validation/runtime issues.';
  }
  if (area.key === 'sports') {
    return 'Sports page opens and targeted interactions complete without route/UI/network blockers.';
  }
  if (/\blive chat\b/.test(titleLower)) {
    return 'Live chat widget opens and the target chat interaction completes successfully.';
  }
  return 'Scenario completes successfully without UI/runtime/network critical errors.';
}

function buildManualReproPlan({ test, commandHint, primaryNetwork }) {
  const area = inferAreaContext(test);
  const userState = inferUserState({ test, area });
  const executionMode = inferExecutionMode(test);
  const title = oneLine(test.titlePath || test.title || '');
  const titleLower = title.toLowerCase();
  const providerName = extractProviderName(title);

  const preconditions = [
    `Brand URL: ${baseUrl}`,
    `Execution mode: ${executionMode}`,
    userState === 'authorized'
      ? 'Use an existing player account that can sign in on this brand.'
      : 'Use a guest session (not authorized).',
  ];
  if (test.projectName) {
    preconditions.push(`Playwright project: ${test.projectName}.`);
  }
  if (area.route && area.route !== '/') {
    preconditions.push(`Target area is reachable: ${area.route}.`);
  }
  if (providerName) {
    preconditions.push(`Provider is present in current catalog: ${providerName}.`);
  }
  if (primaryNetwork && primaryNetwork.url) {
    preconditions.push('Open browser DevTools (Network tab) before final action.');
  }

  const steps = [
    `Open ${baseUrl} in a clean browser session and wait for the homepage to finish loading.`,
  ];
  if (executionMode === 'mobile') {
    steps.push('Use mobile viewport/device emulation (390x844) before starting interactions.');
  }

  if (userState === 'authorized') {
    steps.push('Sign in with an existing player account.');
  } else if (userState === 'guest') {
    steps.push('Stay logged out (guest mode).');
  }

  if (area.key === 'casino') {
    steps.push('Open the "Casino" page.');
  } else if (area.key === 'livecasino') {
    steps.push('Open the "Live Casino" page.');
  } else if (area.key === 'sports') {
    steps.push('Open the "Sports" page.');
  } else if (area.key === 'profile') {
    steps.push('Open "My Profile".');
  } else if (area.key === 'deposit') {
    steps.push('Open deposit/cashier surface from header/profile wallet.');
  } else if (area.key === 'sidebar') {
    steps.push('Open sidebar navigation menu.');
  } else if (area.key === 'registration') {
    steps.push('Open the sign-up form.');
  } else if (area.key === 'auth') {
    steps.push('Open the login form.');
  }

  if (providerName && /\bprovider\b.*\breal launch\b|\bnon-demo\b/.test(titleLower)) {
    steps.push(`Open providers filter and select "${providerName}".`);
    steps.push(`Launch any game from "${providerName}" using "Play" (not demo mode).`);
    steps.push('Wait up to 90 seconds for game iframe/surface to become stable.');
  } else if (providerName && /\bdemo\b|\btry for fun\b/.test(titleLower)) {
    steps.push(`Open providers filter and select "${providerName}".`);
    steps.push(`Launch any game from "${providerName}" using "Try for Fun"/demo.`);
  } else if (/\bsearch\b/.test(titleLower)) {
    steps.push('Open search control, enter a query, and apply it.');
  } else if (/\bfilter\b/.test(titleLower)) {
    steps.push('Open filters, apply one value, and verify resulting catalog/list update.');
  } else if (/\blive chat\b/.test(titleLower)) {
    steps.push('Open live chat widget and complete the interaction required by this case.');
  } else if (/\bavatar\b/.test(titleLower)) {
    steps.push('In Account section, upload avatar and save changes.');
  } else if (/\bsettings\b|\btoggle\b|\bdropdown\b/.test(titleLower)) {
    steps.push('In the target section, change setting/toggle/dropdown and apply changes.');
  } else {
    steps.push(`Repeat user actions from the case title: "${test.title || title}".`);
  }

  if (primaryNetwork && primaryNetwork.url) {
    steps.push(`Monitor request(s) related to: ${primaryNetwork.url}`);
  }
  steps.push('Compare observed behavior with "Actual Result" section below.');

  return {
    executionMode,
    preconditions: dedupeStrings(preconditions),
    steps: dedupeStrings(steps),
    expectedResult: inferExpectedResult({ area, title, providerName }),
    commandHint,
  };
}

function buildBugMarkdown({
  bugId,
  test,
  commandHint,
  manualPlan,
  actualResult,
  primaryNetwork,
  networkCandidates,
  screenshotRelPath,
  copiedAttachments,
  stdoutText,
  stderrText,
}) {
  const lines = [];
  lines.push(`# Bug ${bugId}`);
  lines.push('');
  lines.push('## Bug');
  lines.push('');
  lines.push(`- Phase: ${test.phase}`);
  lines.push(`- Test: ${test.titlePath || test.title}`);
  lines.push(`- File: ${test.file || '-'}`);
  lines.push(`- Status: ${test.status}`);
  lines.push(`- Project: ${test.projectName || '-'}`);
  lines.push(`- Execution mode: ${manualPlan.executionMode || '-'}`);
  lines.push('');
  lines.push('## Preconditions');
  lines.push('');
  for (const precondition of manualPlan.preconditions || []) {
    lines.push(`- ${precondition}`);
  }
  lines.push('');
  lines.push('## Steps To Reproduce (Manual)');
  lines.push('');
  for (let index = 0; index < (manualPlan.steps || []).length; index += 1) {
    lines.push(`${index + 1}. ${manualPlan.steps[index]}`);
  }
  lines.push('');
  lines.push('## Quick Re-Run (Automation)');
  lines.push('');
  lines.push(`- Command: \`${commandHint}\``);
  lines.push('');
  lines.push('## Actual Result');
  lines.push('');
  lines.push(actualResult || 'No explicit error message captured.');
  lines.push('');
  lines.push('## Expected Result');
  lines.push('');
  lines.push(
    manualPlan.expectedResult ||
      'Scenario should complete successfully without runtime errors or critical diagnostics.'
  );
  lines.push('');
  lines.push('## Triggering Network Request');
  lines.push('');
  if (primaryNetwork) {
    lines.push(`- URL: ${primaryNetwork.url}`);
    lines.push(`- Method: ${primaryNetwork.method || '-'}`);
    lines.push(`- Status: ${primaryNetwork.status != null ? primaryNetwork.status : '-'}`);
    lines.push(`- Status Text: ${primaryNetwork.statusText || '-'}`);
    lines.push(`- Error: ${primaryNetwork.errorText || primaryNetwork.consoleError || '-'}`);
    lines.push(`- Source: ${primaryNetwork.source || '-'}`);
  } else {
    lines.push('- Network trigger not found in available artifacts.');
  }
  lines.push('');
  lines.push('## Logs');
  lines.push('');
  if (stdoutText) {
    lines.push('### stdout');
    lines.push('');
    lines.push('```text');
    lines.push(stdoutText);
    lines.push('```');
    lines.push('');
  }
  if (stderrText) {
    lines.push('### stderr');
    lines.push('');
    lines.push('```text');
    lines.push(stderrText);
    lines.push('```');
    lines.push('');
  }
  if (!stdoutText && !stderrText) {
    lines.push('No stdout/stderr logs captured for final test attempt.');
    lines.push('');
  }

  lines.push('## Evidence');
  lines.push('');
  if (screenshotRelPath) lines.push(`- Screenshot: ${screenshotRelPath}`);
  else lines.push('- Screenshot: not found');
  if (copiedAttachments.length > 0) {
    for (const item of copiedAttachments) {
      lines.push(`- Attachment: ${item.relPath}`);
    }
  } else {
    lines.push('- Attachment: none');
  }
  if (networkCandidates.length > 0) {
    lines.push(`- Network records extracted: ${networkCandidates.length}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildBugHtml({
  bugId,
  test,
  commandHint,
  manualPlan,
  actualResult,
  primaryNetwork,
  networkCandidates,
  screenshotRelPath,
  copiedAttachments,
  stdoutText,
  stderrText,
}) {
  const screenshotBlock = screenshotRelPath
    ? `<div class="card"><h3>Screenshot</h3><img src="${escapeHtml(
        screenshotRelPath
      )}" alt="Bug screenshot" /></div>`
    : '<div class="card"><h3>Screenshot</h3><p>No screenshot found.</p></div>';

  const attachmentsHtml =
    copiedAttachments.length > 0
      ? `<ul>${copiedAttachments
          .map((item) => `<li>${escapeHtml(item.relPath)}</li>`)
          .join('')}</ul>`
      : '<p>No attachments copied.</p>';

  const networkRows =
    networkCandidates.length > 0
      ? networkCandidates
          .slice(0, 30)
          .map(
            (item) => `<tr>
      <td>${escapeHtml(item.url)}</td>
      <td>${escapeHtml(item.method || '-')}</td>
      <td>${escapeHtml(item.status != null ? String(item.status) : '-')}</td>
      <td>${escapeHtml(item.errorText || item.consoleError || '-')}</td>
      <td>${escapeHtml(item.source || '-')}</td>
    </tr>`
          )
          .join('')
      : '<tr><td colspan="5">No network records found.</td></tr>';

  const primaryNetworkHtml = primaryNetwork
    ? `<ul>
      <li><strong>URL:</strong> ${escapeHtml(primaryNetwork.url)}</li>
      <li><strong>Method:</strong> ${escapeHtml(primaryNetwork.method || '-')}</li>
      <li><strong>Status:</strong> ${
        primaryNetwork.status != null ? escapeHtml(String(primaryNetwork.status)) : '-'
      }</li>
      <li><strong>Status Text:</strong> ${escapeHtml(primaryNetwork.statusText || '-')}</li>
      <li><strong>Error:</strong> ${escapeHtml(
        primaryNetwork.errorText || primaryNetwork.consoleError || '-'
      )}</li>
      <li><strong>Source:</strong> ${escapeHtml(primaryNetwork.source || '-')}</li>
    </ul>`
    : '<p>Network trigger not found in available artifacts.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bug ${escapeHtml(bugId)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
      h1, h2, h3 { margin: 0 0 8px 0; }
      section { margin: 0 0 20px 0; }
      .meta { background: #f5f5f5; padding: 12px; border-radius: 8px; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 8px 0; }
      code, pre { font-family: Menlo, Monaco, Consolas, monospace; font-size: 12px; }
      pre { background: #f7f7f7; border: 1px solid #ddd; padding: 8px; border-radius: 6px; white-space: pre-wrap; }
      img { max-width: 100%; border: 1px solid #ccc; border-radius: 6px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; }
      th { background: #f0f0f0; text-align: left; }
      .muted { color: #666; }
    </style>
  </head>
  <body>
    <h1>Bug ${escapeHtml(bugId)}</h1>
    <section class="meta">
      <div><strong>Phase:</strong> ${escapeHtml(test.phase)}</div>
      <div><strong>Test:</strong> ${escapeHtml(test.titlePath || test.title)}</div>
      <div><strong>File:</strong> ${escapeHtml(test.file || '-')}</div>
      <div><strong>Status:</strong> ${escapeHtml(test.status)}</div>
      <div><strong>Project:</strong> ${escapeHtml(test.projectName || '-')}</div>
      <div><strong>Execution mode:</strong> ${escapeHtml(manualPlan.executionMode || '-')}</div>
    </section>

    <section>
      <h2>Preconditions</h2>
      <ul>
        ${(manualPlan.preconditions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </section>

    <section>
      <h2>Steps To Reproduce (Manual)</h2>
      <ol>
        ${(manualPlan.steps || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ol>
    </section>

    <section>
      <h2>Quick Re-Run (Automation)</h2>
      <p>Run: <code>${escapeHtml(commandHint)}</code></p>
    </section>

    <section>
      <h2>Actual Result</h2>
      <pre>${escapeHtml(actualResult || 'No explicit error message captured.')}</pre>
    </section>

    <section>
      <h2>Expected Result</h2>
      <p>${escapeHtml(
        manualPlan.expectedResult ||
          'Scenario should pass without runtime errors and without critical diagnostics.'
      )}</p>
    </section>

    <section>
      <h2>Triggering Network Request</h2>
      ${primaryNetworkHtml}
    </section>

    <section>
      <h2>Evidence</h2>
      ${screenshotBlock}
      <div class="card">
        <h3>Attachments</h3>
        ${attachmentsHtml}
      </div>
    </section>

    <section>
      <h2>Logs</h2>
      ${
        stdoutText
          ? `<h3>stdout</h3><pre>${escapeHtml(stdoutText)}</pre>`
          : '<p class="muted">No stdout logs captured.</p>'
      }
      ${
        stderrText
          ? `<h3>stderr</h3><pre>${escapeHtml(stderrText)}</pre>`
          : '<p class="muted">No stderr logs captured.</p>'
      }
    </section>

    <section>
      <h2>Network Records (${networkCandidates.length})</h2>
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th>Method</th>
            <th>Status</th>
            <th>Error</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${networkRows}</tbody>
      </table>
    </section>
  </body>
</html>
`;
}

async function exportPdfFromHtml(page, htmlPath, pdfPath) {
  ensureDir(path.dirname(pdfPath));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
  });
}

function safeCommandHint(test) {
  const grepTitle = String(test.title || '').replace(/"/g, '\\"');
  let testFile = test.file || '';
  if (testFile && !fs.existsSync(path.resolve(cwd, testFile))) {
    const prefixed = path.join('tests', testFile);
    if (fs.existsSync(path.resolve(cwd, prefixed))) testFile = prefixed;
  }
  if (!testFile) return `BASE_URL=${baseUrl} npm run qa:all`;
  return `BASE_URL=${baseUrl} npx playwright test ${testFile} --grep "${grepTitle}" --workers=1`;
}

function loadAllTests() {
  const sources = loadReportSources();
  const tests = [];
  for (const source of sources) {
    for (const suite of source.data && Array.isArray(source.data.suites)
      ? source.data.suites
      : []) {
      collectTestsFromSuite(suite, source.phase, tests);
    }
  }
  return tests;
}

function gatherAttachmentScreenshotPaths(tests) {
  const set = new Set();
  for (const test of tests) {
    for (const attachment of test.attachments || []) {
      if (!isImageAttachment(attachment)) continue;
      if (!attachment.path) continue;
      const abs = resolveAttachmentPath(attachment.path, test.phase);
      if (abs && fs.existsSync(abs)) set.add(abs);
    }
  }
  return set;
}

function gatherProjectScreenshotPaths() {
  const set = new Set();
  const roots = [autotestReportDir, reportDir, projectPaths.analyzeDir, projectPaths.artifactsDir];

  for (const root of roots) {
    for (const filePath of walkImages(root)) {
      if (isSubPath(filePath, screenshotsRoot)) continue;
      if (isSubPath(filePath, bugsRoot)) continue;
      set.add(filePath);
    }
  }

  return set;
}

function dedupeEvidence(items) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.sourcePath || item.copiedPath || item.relPath;
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

async function main() {
  const tests = loadAllTests();
  const failedTests = tests.filter((test) => failureStatuses.has(test.status));

  cleanDir(screenshotsAllDir);
  cleanDir(screenshotsFailDir);
  cleanDir(bugsRoot);

  const allScreenshotSources = new Set([
    ...gatherProjectScreenshotPaths(),
    ...gatherAttachmentScreenshotPaths(tests),
  ]);

  const groupedScreenshots = [];
  for (const source of Array.from(allScreenshotSources).sort((a, b) => a.localeCompare(b))) {
    const target = groupedAllDestination(source);
    const copied = copyFileSafe(source, target);
    if (!copied) continue;
    groupedScreenshots.push({
      source,
      grouped: copied,
      groupedRelative: asRelative(copied, screenshotsRoot),
    });
  }

  const bugEntries = [];
  const pdfJobs = [];

  {
    let bugIndex = 0;
    for (const test of failedTests) {
      bugIndex += 1;
      const executionMode = inferExecutionMode(test);
      const bugId = `${String(bugIndex).padStart(3, '0')}-${slugify(
        `${executionMode}-${test.phase}-${test.titlePath || test.title}`
      )}`;
      const bugDir = path.join(bugsRoot, bugId);
      const evidenceDir = path.join(bugDir, 'evidence');
      const failDir = path.join(screenshotsFailDir, bugId);
      ensureDir(evidenceDir);
      ensureDir(failDir);

      const copiedScreenshots = [];
      const copiedAttachments = [];

      for (const attachment of test.attachments || []) {
        const attachmentName = sanitizeFileName(attachment.name || 'attachment');
        if (attachment.path) {
          const sourcePath = resolveAttachmentPath(attachment.path, test.phase);
          if (sourcePath && fs.existsSync(sourcePath)) {
            const attachmentBaseName = path.basename(attachmentName, path.extname(attachmentName));
            const sourceExt =
              path.extname(sourcePath) || extensionFromContentType(attachment.contentType);
            const copiedToEvidence = copyFileSafe(
              sourcePath,
              path.join(evidenceDir, `${attachmentBaseName}${sourceExt}`)
            );

            if (copiedToEvidence) {
              copiedAttachments.push({
                name: attachment.name || path.basename(copiedToEvidence),
                contentType: attachment.contentType || '',
                sourcePath,
                copiedPath: copiedToEvidence,
                relPath: asRelative(copiedToEvidence, bugDir),
              });
            }

            if (isImageAttachment(attachment)) {
              const copiedToFail = copyFileSafe(
                sourcePath,
                path.join(failDir, path.basename(sourcePath))
              );
              const copiedToBugScreens = copyFileSafe(
                sourcePath,
                path.join(bugDir, 'screenshots', path.basename(sourcePath))
              );
              if (copiedToFail) {
                copiedScreenshots.push({
                  sourcePath,
                  failPath: copiedToFail,
                  bugPath: copiedToBugScreens || '',
                });
              }
              if (copiedToBugScreens) {
                copiedAttachments.push({
                  name: 'screenshot',
                  contentType: attachment.contentType || 'image/png',
                  sourcePath,
                  copiedPath: copiedToBugScreens,
                  relPath: asRelative(copiedToBugScreens, bugDir),
                });
              }
            }
          }
        } else if (attachment.body) {
          const bodyPath = writeBodyAttachment(
            attachment.body,
            attachment.contentType,
            path.join(evidenceDir, attachmentName || 'attachment')
          );
          if (bodyPath) {
            copiedAttachments.push({
              name: attachment.name || path.basename(bodyPath),
              contentType: attachment.contentType || '',
              sourcePath: '',
              copiedPath: bodyPath,
              relPath: asRelative(bodyPath, bugDir),
            });
          }
        }
      }

      if (copiedScreenshots.length === 0) {
        fs.writeFileSync(
          path.join(failDir, 'NO_SCREENSHOT.txt'),
          'Failure screenshot was not found in available artifacts for this test.',
          'utf8'
        );
      }

      const annotationsText = test.annotations
        .map((item) => `${item.type}: ${item.description}`)
        .filter(Boolean)
        .join('\n');
      const stdoutText = formatOutput(test.stdout);
      const stderrText = formatOutput(test.stderr);
      const actualResult = oneLine([test.error, annotationsText].filter(Boolean).join(' | '));

      const network = { items: [], keys: new Set() };
      for (const url of extractUrls(test.error)) {
        pushNetworkCandidate(network, {
          url,
          source: 'error-message',
        });
      }
      for (const annotation of test.annotations) {
        for (const url of extractUrls(annotation.description)) {
          pushNetworkCandidate(network, {
            url,
            source: `annotation:${annotation.type}`,
          });
        }
      }
      for (const attachment of copiedAttachments) {
        if (!/\.json$/i.test(attachment.copiedPath)) continue;
        const payload = readJson(attachment.copiedPath);
        if (!payload) continue;
        collectNetworkFromJson(payload, network, `attachment:${attachment.name}`);
      }
      const networkCandidates = network.items.slice(0, 60);
      const primaryNetwork = pickPrimaryNetwork(networkCandidates);

      const screenshotRelPath =
        copiedScreenshots.length > 0
          ? asRelative(copiedScreenshots[0].bugPath || copiedScreenshots[0].failPath, bugDir)
          : '';

      const commandHint = safeCommandHint(test);
      const manualPlan = buildManualReproPlan({
        test,
        commandHint,
        primaryNetwork,
      });
      const markdown = buildBugMarkdown({
        bugId,
        test,
        commandHint,
        manualPlan,
        actualResult,
        primaryNetwork,
        networkCandidates,
        screenshotRelPath,
        copiedAttachments: dedupeEvidence(copiedAttachments),
        stdoutText,
        stderrText,
      });
      const html = buildBugHtml({
        bugId,
        test,
        commandHint,
        manualPlan,
        actualResult,
        primaryNetwork,
        networkCandidates,
        screenshotRelPath,
        copiedAttachments: dedupeEvidence(copiedAttachments),
        stdoutText,
        stderrText,
      });

      const markdownPath = path.join(bugDir, 'bug.md');
      const htmlPath = path.join(bugDir, 'bug.html');
      const pdfPath = path.join(bugDir, 'bug.pdf');
      const metadataPath = path.join(bugDir, 'bug.json');
      const networkPath = path.join(bugDir, 'network-evidence.json');
      const logsPath = path.join(bugDir, 'logs.txt');

      fs.writeFileSync(markdownPath, markdown, 'utf8');
      fs.writeFileSync(htmlPath, html, 'utf8');
      fs.writeFileSync(
        networkPath,
        JSON.stringify({ primary: primaryNetwork, records: networkCandidates }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        logsPath,
        [
          `Error: ${test.error || '-'}`,
          '',
          'Annotations:',
          annotationsText || '-',
          '',
          'stdout:',
          stdoutText || '-',
          '',
          'stderr:',
          stderrText || '-',
        ].join('\n'),
        'utf8'
      );

      const metadata = {
        bugId,
        phase: test.phase,
        file: test.file,
        projectName: test.projectName || '',
        executionMode: manualPlan.executionMode || inferExecutionMode(test),
        title: test.title,
        titlePath: test.titlePath,
        status: test.status,
        error: test.error || '',
        annotations: test.annotations,
        commandHint,
        manualReproduction: manualPlan,
        screenshotCount: copiedScreenshots.length,
        attachments: dedupeEvidence(copiedAttachments).map((item) => ({
          name: item.name,
          contentType: item.contentType,
          relPath: item.relPath,
          sourcePath: item.sourcePath || '',
        })),
        primaryNetwork,
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      pdfJobs.push({ htmlPath, pdfPath });

      bugEntries.push({
        bugId,
        phase: test.phase,
        status: test.status,
        projectName: test.projectName || '',
        executionMode: manualPlan.executionMode || inferExecutionMode(test),
        title: test.titlePath || test.title,
        file: test.file || '-',
        folder: bugDir,
        pdfPath,
        markdownPath,
        htmlPath,
        screenshotCount: copiedScreenshots.length,
        primaryNetwork,
      });
    }
  }

  if (pdfJobs.length > 0) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      for (const job of pdfJobs) {
        await exportPdfFromHtml(page, job.htmlPath, job.pdfPath);
      }
    } finally {
      await page.close().catch(() => null);
      await browser.close().catch(() => null);
    }
  }

  const screenshotManifestPath = path.join(screenshotsRoot, 'manifest.json');
  fs.writeFileSync(
    screenshotManifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalGrouped: groupedScreenshots.length,
        grouped: groupedScreenshots.map((item) => ({
          source: item.source,
          groupedRelative: item.groupedRelative,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  const bugsIndexPath = path.join(bugsRoot, 'index.json');
  fs.writeFileSync(
    bugsIndexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalBugs: bugEntries.length,
        bugs: bugEntries.map((entry) => ({
          bugId: entry.bugId,
          phase: entry.phase,
          status: entry.status,
          projectName: entry.projectName || '',
          executionMode: entry.executionMode || '',
          title: entry.title,
          file: entry.file,
          folder: entry.folder,
          pdfPath: entry.pdfPath,
          screenshotCount: entry.screenshotCount,
          primaryNetwork: entry.primaryNetwork || null,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  const bugsIndexMd = [
    '# Bugs Index',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total bugs: ${bugEntries.length}`,
    '',
    '| Bug ID | Phase | Mode | Status | Test | File | PDF | Screenshots |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...bugEntries.map(
      (entry) =>
        `| ${entry.bugId} | ${entry.phase} | ${entry.executionMode || '-'} | ${entry.status} | ${entry.title.replace(
          /\|/g,
          '\\|'
        )} | ${String(entry.file || '-').replace(/\|/g, '\\|')} | ${asRelative(
          entry.pdfPath,
          bugsRoot
        )} | ${entry.screenshotCount} |`
    ),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(bugsRoot, 'index.md'), bugsIndexMd, 'utf8');

  const screenshotsReadme = [
    '# Screenshots Hub',
    '',
    '- `All/`: all discovered screenshots grouped in one place.',
    '- `Fail/`: screenshots only for tests in failed/timedOut/interrupted status.',
    '',
    `Total grouped screenshots: ${groupedScreenshots.length}`,
    `Total failure tests: ${failedTests.length}`,
    '',
    'Manifest: `manifest.json`',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(screenshotsRoot, 'README.md'), screenshotsReadme, 'utf8');

  console.log(`Screenshots grouped: ${groupedScreenshots.length}`);
  console.log(`Failure screenshots folders: ${failedTests.length}`);
  console.log(`Bug dossiers generated: ${bugEntries.length}`);
  console.log(`Screenshots hub: ${screenshotsRoot}`);
  console.log(`Bugs folder: ${bugsRoot}`);
}

main().catch((error) => {
  console.error(`qa-artifacts failed: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
