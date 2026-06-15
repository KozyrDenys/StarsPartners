#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Pact CLI is provided by @pact-foundation/pact-node in this project.
require.resolve('@pact-foundation/pact-node/package.json');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return value;
}

function optional(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function hasPacts(pactDir) {
  if (!fs.existsSync(pactDir)) return false;
  const entries = fs.readdirSync(pactDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(pactDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) return true;
    if (entry.isDirectory() && hasPacts(fullPath)) return true;
  }
  return false;
}

function main() {
  const brokerBaseUrl = required('PACT_BROKER_BASE_URL');
  const pactDir = optional('PACT_PACTS_DIR', path.join(process.cwd(), 'contracts', 'pacts'));
  const consumerVersion = optional(
    'PACT_CONSUMER_VERSION',
    optional('GIT_SHA', new Date().toISOString())
  );
  const branch = optional('PACT_BRANCH', optional('GIT_BRANCH', 'main'));
  const brokerToken = optional('PACT_BROKER_TOKEN');
  const brokerUsername = optional('PACT_BROKER_USERNAME');
  const brokerPassword = optional('PACT_BROKER_PASSWORD');

  if (!hasPacts(pactDir)) {
    console.error(`No pact files found in: ${pactDir}`);
    process.exit(2);
  }

  const args = [
    'pact-broker',
    'publish',
    pactDir,
    '--broker-base-url',
    brokerBaseUrl,
    '--consumer-app-version',
    consumerVersion,
    '--branch',
    branch,
  ];

  if (brokerToken) {
    args.push('--broker-token', brokerToken);
  } else if (brokerUsername && brokerPassword) {
    args.push('--broker-username', brokerUsername, '--broker-password', brokerPassword);
  }

  console.log(`Publishing pacts from ${pactDir} to ${brokerBaseUrl}`);
  const result = spawnSync('npx', args, { stdio: 'inherit', env: process.env });
  process.exit(Number(result.status || 0));
}

main();
