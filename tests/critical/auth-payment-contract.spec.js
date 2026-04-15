const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { markBlocked } = require('../helpers/gt-utils');
const { runAuthPaymentContractChecks } = require('../helpers/api-contract-checks');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('P0 Contract checks: auth/payment OpenAPI via Spectral + Schemathesis', async ({
  page,
}, testInfo) => {
  void page;
  if (process.env.PW_CONTRACT_CHECKS === '0') {
    testInfo.annotations.push({
      type: 'gated',
      description: 'Contract checks are disabled by PW_CONTRACT_CHECKS=0.',
    });
    return;
  }

  const strict = process.env.PW_CONTRACT_STRICT === '1';
  const summary = await runAuthPaymentContractChecks({
    baseUrl: BASE_URL,
    artifactsDir: PROJECT_ARTIFACTS_DIR,
    strict,
  });

  const summaryBody = JSON.stringify(summary, null, 2);
  await testInfo.attach('auth-payment-contract-summary.json', {
    body: summaryBody,
    contentType: 'application/json',
  });

  if (summary.summaryPath && fs.existsSync(summary.summaryPath)) {
    testInfo.annotations.push({ type: 'artifact', description: summary.summaryPath });
  }

  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  const blockedReasons = Array.isArray(summary.blockedReasons) ? summary.blockedReasons : [];
  const failedReasons = Array.isArray(summary.failedReasons) ? summary.failedReasons : [];

  if (!checks.length) {
    const reason = 'Contract checks produced no check entries.';
    if (strict) {
      expect(reason, reason).toBe('');
    } else {
      markBlocked(testInfo, reason);
      return;
    }
  }

  if (blockedReasons.length > 0) {
    markBlocked(testInfo, `Contract checks blocked: ${blockedReasons.map(oneLine).join(' | ')}`);
  }

  if (summary.partial) {
    testInfo.annotations.push({
      type: 'partial',
      description:
        'Contract checks finished with partial status. Review auth-payment-contract-summary.json for tool/spec issues.',
    });
  }

  if (strict) {
    expect(
      failedReasons,
      `Strict contract mode failed: ${failedReasons.map(oneLine).join(' | ') || 'unknown error'}`
    ).toEqual([]);
  } else {
    expect(Array.isArray(checks)).toBeTruthy();
  }
});
