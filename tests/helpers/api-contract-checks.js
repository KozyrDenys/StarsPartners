const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;

function compactText(value, maxLength = 4000) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function normalizePath(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (path.isAbsolute(text)) return text;
  return path.resolve(process.cwd(), text);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function hasCommand(command) {
  try {
    const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      timeout: timeoutMs,
      maxBuffer: 30 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      ok: result.status === 0,
      status: typeof result.status === 'number' ? result.status : 1,
      signal: result.signal || '',
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
      error: result.error ? compactText(result.error.message || result.error) : '',
    };
  } catch (error) {
    return {
      ok: false,
      status: 1,
      signal: '',
      stdout: '',
      stderr: '',
      timedOut: false,
      error: compactText(error && error.message ? error.message : error),
    };
  }
}

function isOpenApiPayload(content) {
  const text = String(content || '').trim();
  if (!text) return false;

  if (/^\{/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      return Boolean(parsed && (parsed.openapi || parsed.swagger));
    } catch {
      return false;
    }
  }

  return /(^|\n)\s*(openapi|swagger)\s*:\s*['"]?\d/i.test(text);
}

async function fetchText(url, timeoutMs = 20_000) {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`OpenAPI fetch timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    const response = await Promise.race([
      fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json, application/yaml, text/yaml, text/plain, */*',
        },
      }),
      timeoutPromise,
    ]);
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      error: compactText(error && error.message ? error.message : error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extensionByHint(url, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('yaml') || ct.includes('yml')) return '.yaml';
  if (ct.includes('json')) return '.json';

  const urlPath = String(url || '').toLowerCase();
  if (urlPath.endsWith('.yaml') || urlPath.endsWith('.yml')) return '.yaml';
  return '.json';
}

function resolveSpecCandidates(kind, baseUrl) {
  const upper = String(kind || '').toUpperCase();
  const fileEnvCandidates = [
    process.env[`QA_${upper}_OPENAPI_PATH`],
    process.env[`QA_${upper}_OPENAPI_FILE`],
    process.env[`QA_${upper}_OPENAPI`],
  ]
    .map((value) => normalizePath(value))
    .filter(Boolean);

  const urlEnvCandidates = [
    process.env[`QA_${upper}_OPENAPI_URL`],
    process.env[`QA_${upper}_OPENAPI_SCHEMA_URL`],
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const localCandidates = [
    path.join(process.cwd(), 'contracts', 'openapi', `${kind}.json`),
    path.join(process.cwd(), 'contracts', 'openapi', `${kind}.yaml`),
    path.join(process.cwd(), 'contracts', 'openapi', `${kind}.yml`),
  ];

  const fallbackUrlPaths = [
    `/openapi/${kind}.json`,
    `/openapi/${kind}.yaml`,
    `/api/openapi/${kind}.json`,
    `/api/openapi/${kind}.yaml`,
    `/swagger/${kind}.json`,
    `/swagger/${kind}.yaml`,
  ];

  const fallbackUrls = [];
  for (const route of fallbackUrlPaths) {
    try {
      fallbackUrls.push(new URL(route, baseUrl).toString());
    } catch {
      // ignore malformed base url
    }
  }

  return {
    fileCandidates: [...new Set([...fileEnvCandidates, ...localCandidates])],
    urlCandidates: [...new Set([...urlEnvCandidates, ...fallbackUrls])],
  };
}

async function resolveOpenApiSpec({ kind, baseUrl, openApiDir }) {
  const candidates = resolveSpecCandidates(kind, baseUrl);
  const attempts = [];

  for (const filePath of candidates.fileCandidates) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    const valid = isOpenApiPayload(text);
    attempts.push({ source: 'file', target: filePath, valid });
    if (!valid) continue;

    const ext = path.extname(filePath) || '.json';
    const outputPath = path.join(openApiDir, `${kind}${ext}`);
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, text, 'utf8');
    return {
      ok: true,
      kind,
      specPath: outputPath,
      source: `file:${filePath}`,
      attempts,
    };
  }

  for (const url of candidates.urlCandidates) {
    if (!url) continue;
    const response = await fetchText(url, 20_000);
    const valid = response.ok && isOpenApiPayload(response.body);
    attempts.push({
      source: 'url',
      target: url,
      status: response.status,
      ok: response.ok,
      valid,
      error: response.error || '',
    });
    if (!valid) continue;

    const ext = extensionByHint(url, response.headers['content-type'] || '');
    const outputPath = path.join(openApiDir, `${kind}${ext}`);
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, response.body, 'utf8');
    return {
      ok: true,
      kind,
      specPath: outputPath,
      source: `url:${url}`,
      attempts,
    };
  }

  return {
    ok: false,
    kind,
    attempts,
    reason:
      'OpenAPI schema was not found. Provide QA_AUTH_OPENAPI_URL/QA_PAYMENT_OPENAPI_URL or local contracts/openapi/*.json|yaml.',
  };
}

function buildSpectralSummary(rawResult) {
  let parsed = null;
  if (rawResult.stdout) {
    try {
      parsed = JSON.parse(rawResult.stdout);
    } catch {
      parsed = null;
    }
  }

  const issues = Array.isArray(parsed)
    ? parsed.map((entry) => ({
        code: entry.code || '',
        message: compactText(entry.message || ''),
        severity: entry.severity,
        path: Array.isArray(entry.path) ? entry.path.join('.') : '',
      }))
    : [];

  return {
    ok: rawResult.ok,
    exitCode: rawResult.status,
    timedOut: rawResult.timedOut,
    signal: rawResult.signal,
    issuesCount: issues.length,
    issuesSample: issues.slice(0, 20),
    stderr: compactText(rawResult.stderr, 2000),
    error: compactText(rawResult.error, 600),
    outputPreview: compactText(rawResult.stdout, 2000),
  };
}

function runSpectralLint({ specPath, rulesetPath, timeoutMs }) {
  const result = runCommand(
    'npx',
    [
      '--yes',
      '@stoplight/spectral-cli',
      'lint',
      specPath,
      '--ruleset',
      rulesetPath,
      '--format',
      'json',
    ],
    { timeoutMs }
  );
  return buildSpectralSummary(result);
}

function runSchemathesis({ specPath, baseUrl, timeoutMs, maxExamples, preferDocker = true }) {
  const baseOrigin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return String(baseUrl || '').trim();
    }
  })();

  const directCommand = hasCommand('schemathesis') ? 'schemathesis' : hasCommand('st') ? 'st' : '';

  if (directCommand) {
    const direct = runCommand(
      directCommand,
      ['run', specPath, '--base-url', baseOrigin, '--max-examples', String(maxExamples)],
      { timeoutMs }
    );
    return {
      mode: directCommand,
      ok: direct.ok,
      exitCode: direct.status,
      timedOut: direct.timedOut,
      signal: direct.signal,
      stderr: compactText(direct.stderr, 2200),
      outputPreview: compactText(direct.stdout, 2400),
      error: compactText(direct.error, 600),
    };
  }

  if (preferDocker && hasCommand('docker')) {
    const cwd = process.cwd();
    const relativeSpec = path.relative(cwd, specPath).split(path.sep).join('/');
    const docker = runCommand(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${cwd}:/work`,
        '-w',
        '/work',
        'schemathesis/schemathesis:stable',
        'run',
        `/work/${relativeSpec}`,
        '--base-url',
        baseOrigin,
        '--max-examples',
        String(maxExamples),
      ],
      { timeoutMs }
    );

    return {
      mode: 'docker',
      ok: docker.ok,
      exitCode: docker.status,
      timedOut: docker.timedOut,
      signal: docker.signal,
      stderr: compactText(docker.stderr, 2200),
      outputPreview: compactText(docker.stdout, 2400),
      error: compactText(docker.error, 600),
    };
  }

  return {
    mode: 'unavailable',
    ok: false,
    exitCode: 127,
    timedOut: false,
    signal: '',
    stderr: '',
    outputPreview: '',
    error:
      'Schemathesis CLI is unavailable. Install schemathesis (`pip install schemathesis`) or Docker.',
  };
}

async function runAuthPaymentContractChecks(options = {}) {
  const baseUrl = String(options.baseUrl || process.env.BASE_URL || 'https://gt.bet/').trim();
  const artifactsDir = normalizePath(
    options.artifactsDir || process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts')
  );
  const contractsDir = path.join(artifactsDir, 'contracts');
  const openApiDir = path.join(contractsDir, 'openapi');
  const outputsDir = path.join(contractsDir, 'outputs');
  const rulesetPath =
    normalizePath(options.rulesetPath) ||
    path.join(process.cwd(), 'contracts', 'spectral-ruleset.yaml');
  const timeoutMs = parsePositiveInt(
    options.timeoutMs || process.env.PW_CONTRACT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const maxExamples = parsePositiveInt(
    options.maxExamples || process.env.PW_CONTRACT_MAX_EXAMPLES,
    20
  );
  const strictSource =
    typeof options.strict !== 'undefined' ? options.strict : process.env.PW_CONTRACT_STRICT || '0';
  const strict = String(strictSource) === '1';

  ensureDir(openApiDir);
  ensureDir(outputsDir);

  const summary = {
    source: 'tests/helpers/api-contract-checks.js',
    generatedAt: new Date().toISOString(),
    baseUrl,
    strict,
    rulesetPath,
    maxExamples,
    timeoutMs,
    checks: [],
    blockedReasons: [],
    failedReasons: [],
  };

  for (const kind of ['auth', 'payment']) {
    const item = {
      kind,
      openApi: null,
      spectral: null,
      schemathesis: null,
      status: 'pending',
      note: '',
    };

    const resolved = await resolveOpenApiSpec({ kind, baseUrl, openApiDir });
    item.openApi = resolved;

    if (!resolved.ok) {
      item.status = 'blocked';
      item.note = resolved.reason || 'OpenAPI schema was not resolved.';
      summary.blockedReasons.push(`${kind}: ${item.note}`);
      summary.checks.push(item);
      continue;
    }

    if (!fs.existsSync(rulesetPath)) {
      item.spectral = {
        ok: false,
        exitCode: 127,
        issuesCount: 0,
        issuesSample: [],
        error: `Spectral ruleset not found: ${rulesetPath}`,
      };
    } else {
      item.spectral = runSpectralLint({ specPath: resolved.specPath, rulesetPath, timeoutMs });
    }

    item.schemathesis = runSchemathesis({
      specPath: resolved.specPath,
      baseUrl,
      timeoutMs,
      maxExamples,
      preferDocker: String(process.env.PW_CONTRACT_SCHEMATHESIS_DOCKER || '1') !== '0',
    });

    const spectralFailed = !item.spectral.ok;
    const schemathesisFailed = !item.schemathesis.ok;

    if (spectralFailed || schemathesisFailed) {
      item.status = strict ? 'failed' : 'partial';
      const reasons = [];
      if (spectralFailed) reasons.push('spectral lint issues');
      if (schemathesisFailed) reasons.push('schemathesis run issues');
      item.note = reasons.join(' + ');
      if (strict) {
        summary.failedReasons.push(`${kind}: ${item.note}`);
      }
    } else {
      item.status = 'passed';
      item.note = 'Spectral lint and Schemathesis run completed successfully.';
    }

    const detailsPath = path.join(outputsDir, `${kind}-contract-check.json`);
    fs.writeFileSync(detailsPath, JSON.stringify(item, null, 2), 'utf8');
    item.detailsPath = detailsPath;

    summary.checks.push(item);
  }

  summary.ok = summary.failedReasons.length === 0;
  summary.blocked = summary.blockedReasons.length > 0;
  summary.partial = summary.checks.some((item) => item.status === 'partial');

  const summaryPath = path.join(outputsDir, 'auth-payment-contract-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  summary.summaryPath = summaryPath;

  return summary;
}

module.exports = {
  runAuthPaymentContractChecks,
  readJsonSafe,
};
