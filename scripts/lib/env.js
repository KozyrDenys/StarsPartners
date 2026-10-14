const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');

const BOOLEAN_KEYS = [
  'CI',
  'HEADLESS',
  'PW_HEADED',
  'PW_INCLUDE_A11Y',
  'PW_INCLUDE_DESTRUCTIVE',
  'PW_INCLUDE_VISUAL',
  'PW_REPORT_HTML',
  'PW_REPORT_JSON',
  'PW_REPORT_JUNIT',
  'PW_VISUAL_REGRESSION',
  'QA_ENV_STRICT',
  'QA_TELEMETRY_DISABLED',
];

const POSITIVE_INTEGER_KEYS = [
  'PW_PROVIDER_TEST_TIMEOUT',
  'PW_PROVIDER_MODE_TIMEOUT',
  'PW_PROVIDER_MAX',
  'PW_PROVIDER_MIN_GAMES',
  'PW_PROVIDER_DESKTOP_GAMES',
  'PW_PROVIDER_MOBILE_GAMES',
];

const URL_KEYS = [
  'BASE_URL',
  'SENTRY_DSN',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'QA_AUTH_OPENAPI_URL',
  'QA_PAYMENT_OPENAPI_URL',
];
const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const PROJECT_PROFILES = new Set(['desktop', 'mobile']);

class EnvironmentValidationError extends Error {
  constructor(errors) {
    super(`Invalid QA environment:\n- ${errors.join('\n- ')}`);
    this.name = 'EnvironmentValidationError';
    this.errors = errors;
  }
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validateUrl(name, value, errors) {
  if (!hasValue(value)) return;
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      errors.push(`${name} must use http or https`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function validateEnvironment(env = process.env) {
  const errors = [];

  for (const name of URL_KEYS) validateUrl(name, env[name], errors);

  for (const name of BOOLEAN_KEYS) {
    if (
      hasValue(env[name]) &&
      !['0', '1', 'true', 'false'].includes(String(env[name]).toLowerCase())
    ) {
      errors.push(`${name} must be one of: 0, 1, true, false`);
    }
  }

  for (const name of POSITIVE_INTEGER_KEYS) {
    if (!hasValue(env[name])) continue;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(`${name} must be a non-negative integer`);
    }
  }

  if (hasValue(env.PW_BROWSER) && !BROWSERS.has(String(env.PW_BROWSER).toLowerCase())) {
    errors.push('PW_BROWSER must be one of: chromium, firefox, webkit');
  }

  if (hasValue(env.PW_PROJECT_MATRIX) && String(env.PW_PROJECT_MATRIX).toLowerCase() !== 'all') {
    const profiles = String(env.PW_PROJECT_MATRIX)
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!profiles.length || profiles.some((profile) => !PROJECT_PROFILES.has(profile))) {
      errors.push('PW_PROJECT_MATRIX must contain desktop, mobile, or all');
    }
  }

  const browserStackUser = hasValue(env.BROWSERSTACK_USERNAME);
  const browserStackKey = hasValue(env.BROWSERSTACK_ACCESS_KEY);
  if (browserStackUser !== browserStackKey) {
    errors.push('BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set together');
  }

  const cloudflareAccessClientId = hasValue(env.CF_ACCESS_CLIENT_ID);
  const cloudflareAccessClientSecret = hasValue(env.CF_ACCESS_CLIENT_SECRET);
  if (cloudflareAccessClientId !== cloudflareAccessClientSecret) {
    errors.push('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together');
  }

  const qaBypassHeaderName = hasValue(env.PW_QA_BYPASS_HEADER_NAME);
  const qaBypassHeaderValue = hasValue(env.PW_QA_BYPASS_HEADER_VALUE);
  if (qaBypassHeaderName !== qaBypassHeaderValue) {
    errors.push('PW_QA_BYPASS_HEADER_NAME and PW_QA_BYPASS_HEADER_VALUE must be set together');
  }

  if (hasValue(env.PW_EXTRA_HTTP_HEADERS_JSON)) {
    try {
      const parsed = JSON.parse(String(env.PW_EXTRA_HTTP_HEADERS_JSON));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('PW_EXTRA_HTTP_HEADERS_JSON must be a JSON object');
      }
    } catch {
      errors.push('PW_EXTRA_HTTP_HEADERS_JSON must be valid JSON');
    }
  }

  return errors;
}

function loadProjectEnv(options = {}) {
  const target = options.env || process.env;
  const filePath = path.resolve(
    options.filePath || path.join(options.cwd || process.cwd(), '.env')
  );
  let loaded = false;

  if (fs.existsSync(filePath)) {
    const values = parseEnv(fs.readFileSync(filePath, 'utf8'));
    for (const [name, value] of Object.entries(values)) {
      if (options.override || target[name] === undefined) target[name] = value;
    }
    loaded = true;
  }

  const errors = validateEnvironment(target);
  const strict =
    options.strict ?? !['0', 'false'].includes(String(target.QA_ENV_STRICT || '1').toLowerCase());
  if (strict && errors.length) throw new EnvironmentValidationError(errors);

  return { errors, filePath, loaded };
}

module.exports = {
  EnvironmentValidationError,
  loadProjectEnv,
  validateEnvironment,
};
