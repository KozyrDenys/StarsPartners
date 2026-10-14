const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  isMobileMatrix,
  resolveExtraHTTPHeaders,
  resolveMatrixContextOptions,
} = require('../tests/helpers/context-options');

const originalExecutionMode = process.env.QA_EXECUTION_MODE;
const originalProjectMatrix = process.env.PW_PROJECT_MATRIX;
const originalExtraHeaders = process.env.PW_EXTRA_HTTP_HEADERS_JSON;
const originalBypassHeaderName = process.env.PW_QA_BYPASS_HEADER_NAME;
const originalBypassHeaderValue = process.env.PW_QA_BYPASS_HEADER_VALUE;
const originalCloudflareAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
const originalCloudflareAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

afterEach(() => {
  if (originalExecutionMode === undefined) delete process.env.QA_EXECUTION_MODE;
  else process.env.QA_EXECUTION_MODE = originalExecutionMode;
  if (originalProjectMatrix === undefined) delete process.env.PW_PROJECT_MATRIX;
  else process.env.PW_PROJECT_MATRIX = originalProjectMatrix;
  if (originalExtraHeaders === undefined) delete process.env.PW_EXTRA_HTTP_HEADERS_JSON;
  else process.env.PW_EXTRA_HTTP_HEADERS_JSON = originalExtraHeaders;
  if (originalBypassHeaderName === undefined) delete process.env.PW_QA_BYPASS_HEADER_NAME;
  else process.env.PW_QA_BYPASS_HEADER_NAME = originalBypassHeaderName;
  if (originalBypassHeaderValue === undefined) delete process.env.PW_QA_BYPASS_HEADER_VALUE;
  else process.env.PW_QA_BYPASS_HEADER_VALUE = originalBypassHeaderValue;
  if (originalCloudflareAccessClientId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
  else process.env.CF_ACCESS_CLIENT_ID = originalCloudflareAccessClientId;
  if (originalCloudflareAccessClientSecret === undefined)
    delete process.env.CF_ACCESS_CLIENT_SECRET;
  else process.env.CF_ACCESS_CLIENT_SECRET = originalCloudflareAccessClientSecret;
});

test('adds Cloudflare Access service-token headers only when the pair is complete', () => {
  process.env.CF_ACCESS_CLIENT_ID = 'client-id';
  process.env.CF_ACCESS_CLIENT_SECRET = 'client-secret';

  assert.deepEqual(resolveExtraHTTPHeaders(), {
    'CF-Access-Client-Id': 'client-id',
    'CF-Access-Client-Secret': 'client-secret',
  });

  delete process.env.CF_ACCESS_CLIENT_SECRET;
  assert.equal(resolveExtraHTTPHeaders(), undefined);
});

test('merges configured QA bypass headers into manually created contexts', () => {
  process.env.PW_EXTRA_HTTP_HEADERS_JSON = JSON.stringify({
    'X-Shared': 'base',
    'X-Override': 'old',
  });
  process.env.PW_QA_BYPASS_HEADER_NAME = 'X-QA-Bypass';
  process.env.PW_QA_BYPASS_HEADER_VALUE = 'secret';

  assert.deepEqual(resolveExtraHTTPHeaders(), {
    'X-Shared': 'base',
    'X-Override': 'old',
    'X-QA-Bypass': 'secret',
  });
  assert.deepEqual(
    resolveMatrixContextOptions({ extraHTTPHeaders: { 'X-Override': 'new' } }).extraHTTPHeaders,
    { 'X-Shared': 'base', 'X-Override': 'new', 'X-QA-Bypass': 'secret' }
  );
});

test('uses desktop defaults outside a mobile run', () => {
  delete process.env.QA_EXECUTION_MODE;
  process.env.PW_PROJECT_MATRIX = 'desktop';

  const options = resolveMatrixContextOptions({ storageState: 'state.json' });

  assert.equal(isMobileMatrix(), false);
  assert.deepEqual(options.viewport, DESKTOP_VIEWPORT);
  assert.equal(options.isMobile, false);
  assert.equal(options.hasTouch, false);
  assert.equal(options.storageState, 'state.json');
});

test('uses the complete mobile device profile for a mobile run', () => {
  process.env.QA_EXECUTION_MODE = 'mobile';
  process.env.PW_PROJECT_MATRIX = 'desktop';

  const options = resolveMatrixContextOptions();

  assert.equal(isMobileMatrix(), true);
  assert.deepEqual(options.viewport, MOBILE_VIEWPORT);
  assert.equal(options.isMobile, true);
  assert.equal(options.hasTouch, true);
  assert.match(options.userAgent, /iPhone|Mobile/i);
  assert.ok(Number(options.deviceScaleFactor) > 1);
});

test('allows an intentional visual viewport override', () => {
  process.env.QA_EXECUTION_MODE = 'mobile';

  const options = resolveMatrixContextOptions({ viewport: { width: 800, height: 600 } });

  assert.deepEqual(options.viewport, { width: 800, height: 600 });
  assert.equal(options.isMobile, true);
});
