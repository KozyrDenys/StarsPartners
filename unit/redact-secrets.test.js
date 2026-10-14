const assert = require('node:assert/strict');
const test = require('node:test');

const { maskEmail, redactObject, redactText } = require('../scripts/lib/redact-secrets');

test('maskEmail keeps the domain while hiding the local part', () => {
  assert.equal(maskEmail('qa-user@example.test'), 'qa*****@example.test');
});

test('redactText removes common credentials and tokens', () => {
  const source = 'Authorization: Bearer abc123 password=hunter2 api_key=top-secret';
  const redacted = redactText(source);
  assert.equal(redacted.includes('abc123'), false);
  assert.equal(redacted.includes('hunter2'), false);
  assert.equal(redacted.includes('top-secret'), false);
});

test('redactText removes JWTs and Cloudflare challenge query tokens', () => {
  const source =
    'wss://example.test/socket?token=eyJhbGciOiJIUzI1NiJ9.payload.signature&__cf_chl_rt_tk=challenge-secret';
  const redacted = redactText(source);
  assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(redacted.includes('challenge-secret'), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactObject handles nested secrets and circular objects', () => {
  const input = { profile: { email: 'person@example.test' }, token: 'secret' };
  input.self = input;
  const result = redactObject(input);
  assert.equal(result.token, '[REDACTED]');
  assert.equal(result.profile.email.includes('person'), false);
  assert.equal(result.self, '[Circular]');
});

test('redactObject preserves repeated non-circular values', () => {
  const shared = { category: 'bankTransfer' };
  const result = redactObject({ first: shared, second: shared });
  assert.deepEqual(result.first, shared);
  assert.deepEqual(result.second, shared);
});

test('redactText removes serialized websocket credentials and private identifiers', () => {
  const source = JSON.stringify({
    auth: 'app-key:signature',
    token: 'eyJheader.payload.partial...',
    player_id: '2691984998671716360',
    channel: 'private-user.6990729',
    url: 'wss://ws.example.test/app/app-key',
  });
  const redacted = redactText(source);
  for (const sensitive of [
    'app-key:signature',
    'eyJheader',
    '2691984998671716360',
    '6990729',
    '/app/app-key',
  ]) {
    assert.equal(redacted.includes(sensitive), false);
  }
});
