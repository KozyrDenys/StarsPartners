const { devices } = require('@playwright/test');

const DESKTOP_VIEWPORT = { width: 1365, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const IPHONE_PROFILE = devices['iPhone 13'] || {};

function isMobileMatrix() {
  const mode = String(process.env.QA_EXECUTION_MODE || process.env.PW_PROJECT_MATRIX || '')
    .trim()
    .toLowerCase();
  return mode === 'mobile' || mode === 'm';
}

function resolveExtraHTTPHeaders() {
  const headers = {};
  const rawHeaders = String(process.env.PW_EXTRA_HTTP_HEADERS_JSON || '').trim();
  if (rawHeaders) {
    try {
      const parsed = JSON.parse(rawHeaders);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          const normalizedKey = String(key || '').trim();
          if (!normalizedKey || value === undefined || value === null) continue;
          headers[normalizedKey] = String(value);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`PW_EXTRA_HTTP_HEADERS_JSON is not valid JSON and will be ignored: ${message}`);
    }
  }

  const bypassHeaderName = String(process.env.PW_QA_BYPASS_HEADER_NAME || '').trim();
  const bypassHeaderValue = String(process.env.PW_QA_BYPASS_HEADER_VALUE || '').trim();
  if (bypassHeaderName && bypassHeaderValue) headers[bypassHeaderName] = bypassHeaderValue;

  const cloudflareAccessClientId = String(process.env.CF_ACCESS_CLIENT_ID || '').trim();
  const cloudflareAccessClientSecret = String(process.env.CF_ACCESS_CLIENT_SECRET || '').trim();
  if (cloudflareAccessClientId && cloudflareAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cloudflareAccessClientId;
    headers['CF-Access-Client-Secret'] = cloudflareAccessClientSecret;
  }

  return Object.keys(headers).length ? headers : undefined;
}

/**
 * @param {import('@playwright/test').BrowserContextOptions} [overrides]
 * @returns {import('@playwright/test').BrowserContextOptions}
 */
function resolveMatrixContextOptions(overrides = {}) {
  const matrixOptions = isMobileMatrix()
    ? {
        ...IPHONE_PROFILE,
        viewport: MOBILE_VIEWPORT,
        isMobile: true,
        hasTouch: true,
      }
    : {
        viewport: DESKTOP_VIEWPORT,
        isMobile: false,
        hasTouch: false,
      };

  const configuredHeaders = resolveExtraHTTPHeaders();
  const overrideHeaders = overrides.extraHTTPHeaders;
  const extraHTTPHeaders =
    configuredHeaders || overrideHeaders
      ? { ...(configuredHeaders || {}), ...(overrideHeaders || {}) }
      : undefined;

  return {
    ...matrixOptions,
    ignoreHTTPSErrors: true,
    ...overrides,
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
  };
}

module.exports = {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  isMobileMatrix,
  resolveExtraHTTPHeaders,
  resolveMatrixContextOptions,
};
