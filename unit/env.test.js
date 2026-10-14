const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  EnvironmentValidationError,
  loadProjectEnv,
  validateEnvironment,
} = require('../scripts/lib/env');

test('validateEnvironment accepts a valid minimal configuration', () => {
  assert.deepEqual(
    validateEnvironment({
      BASE_URL: 'https://example.test',
      PW_BROWSER: 'chromium',
      PW_PROJECT_MATRIX: 'desktop,mobile',
      PW_VISUAL_REGRESSION: '1',
      PW_PROVIDER_MAX: '0',
    }),
    []
  );
});

test('validateEnvironment reports invalid values without exposing their contents', () => {
  const errors = validateEnvironment({
    BASE_URL: 'secret-value',
    PW_BROWSER: 'netscape',
    PW_PROJECT_MATRIX: 'desktop,tablet',
    PW_PROVIDER_MAX: '-1',
  });

  assert.equal(errors.length, 4);
  assert.equal(errors.join(' ').includes('secret-value'), false);
});

test('loadProjectEnv loads .env without overwriting an existing variable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-env-test-'));
  const filePath = path.join(directory, '.env');
  fs.writeFileSync(filePath, 'BASE_URL=https://from-file.test\nPW_BROWSER=webkit\n');
  const env = { BASE_URL: 'https://existing.test' };

  try {
    const result = loadProjectEnv({ env, filePath });
    assert.equal(result.loaded, true);
    assert.equal(env.BASE_URL, 'https://existing.test');
    assert.equal(env.PW_BROWSER, 'webkit');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadProjectEnv throws a typed validation error in strict mode', () => {
  assert.throws(
    () => loadProjectEnv({ env: { PW_BROWSER: 'invalid' }, filePath: '/not/present/.env' }),
    EnvironmentValidationError
  );
});

test('requires Cloudflare Access service-token credentials as a pair', () => {
  assert.deepEqual(validateEnvironment({ CF_ACCESS_CLIENT_ID: 'client-id' }), [
    'CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together',
  ]);
  assert.deepEqual(
    validateEnvironment({
      CF_ACCESS_CLIENT_ID: 'client-id',
      CF_ACCESS_CLIENT_SECRET: 'client-secret',
    }),
    []
  );
});

test('validates QA bypass header pairs and extra-header JSON without exposing values', () => {
  const errors = validateEnvironment({
    PW_QA_BYPASS_HEADER_NAME: 'X-QA-Bypass',
    PW_EXTRA_HTTP_HEADERS_JSON: 'private-invalid-json',
  });

  assert.deepEqual(errors, [
    'PW_QA_BYPASS_HEADER_NAME and PW_QA_BYPASS_HEADER_VALUE must be set together',
    'PW_EXTRA_HTTP_HEADERS_JSON must be valid JSON',
  ]);
  assert.equal(errors.join(' ').includes('private-invalid-json'), false);
});
