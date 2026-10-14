const assert = require('node:assert/strict');
const test = require('node:test');

const { serializeArtifactPayload } = require('../tests/helpers/artifact-output');

test('serializeArtifactPayload redacts report attachments without mutating the source', () => {
  const source = {
    email: 'qa-player@example.test',
    password: 'plain-secret',
    url: 'https://example.test/?__cf_chl_rt_tk=challenge-secret',
  };
  const serialized = serializeArtifactPayload(source);

  assert.equal(serialized.includes('plain-secret'), false);
  assert.equal(serialized.includes('challenge-secret'), false);
  assert.equal(serialized.includes('qa-player'), false);
  assert.equal(source.password, 'plain-secret');
});
