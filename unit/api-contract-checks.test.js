const assert = require('node:assert/strict');
const test = require('node:test');

const { isEnabledFlag } = require('../tests/helpers/api-contract-checks');

test('strict contract flag accepts the boolean passed by the Playwright test', () => {
  assert.equal(isEnabledFlag(true), true);
  assert.equal(isEnabledFlag('1'), true);
  assert.equal(isEnabledFlag(false), false);
  assert.equal(isEnabledFlag('0'), false);
});
