#!/usr/bin/env node

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

function main() {
  const brokerBaseUrl = required('PACT_BROKER_BASE_URL');
  const pacticipant = required('PACT_PACTICIPANT');
  const version = required('PACT_VERSION');
  const toEnvironment = required('PACT_TO_ENVIRONMENT');
  const brokerToken = optional('PACT_BROKER_TOKEN');
  const brokerUsername = optional('PACT_BROKER_USERNAME');
  const brokerPassword = optional('PACT_BROKER_PASSWORD');

  const args = [
    'pact-broker',
    'can-i-deploy',
    '--broker-base-url',
    brokerBaseUrl,
    '--pacticipant',
    pacticipant,
    '--version',
    version,
    '--to-environment',
    toEnvironment,
  ];

  if (brokerToken) {
    args.push('--broker-token', brokerToken);
  } else if (brokerUsername && brokerPassword) {
    args.push('--broker-username', brokerUsername, '--broker-password', brokerPassword);
  }

  console.log(
    `Checking can-i-deploy for pacticipant=${pacticipant}, version=${version}, env=${toEnvironment}`
  );
  const result = spawnSync('npx', args, { stdio: 'inherit', env: process.env });
  process.exit(Number(result.status || 0));
}

main();
