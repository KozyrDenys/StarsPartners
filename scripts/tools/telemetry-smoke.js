#!/usr/bin/env node

const { trace } = require('@opentelemetry/api');
const Sentry = require('@sentry/node');
const { initTelemetry, shutdownTelemetry } = require('../telemetry');

async function main() {
  const state = initTelemetry();
  console.log(`Telemetry initialized: sentry=${state.sentry} otel=${state.otel}`);

  if (!state.sentry && !state.otel) {
    console.log(
      'Set SENTRY_DSN and/or OTEL_EXPORTER_OTLP_ENDPOINT to enable telemetry smoke checks.'
    );
    return;
  }

  const tracer = trace.getTracer('qa-assistant-telemetry-smoke');
  const span = tracer.startSpan('qa.telemetry.smoke');
  span.setAttribute('qa.tool', 'telemetry-smoke');
  span.setAttribute('qa.mode', process.env.PW_PROJECT_MATRIX || 'desktop');
  span.end();

  if (state.sentry) {
    Sentry.captureMessage('QA telemetry smoke event', 'info');
    console.log('Sentry event captured (async flush on shutdown).');
  }
}

main()
  .then(() => shutdownTelemetry())
  .catch(async (error) => {
    console.error(error && error.message ? error.message : error);
    await shutdownTelemetry().catch(() => null);
    process.exit(1);
  });
