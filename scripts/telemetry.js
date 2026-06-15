const process = require('process');
const Sentry = require('@sentry/node');
const { trace } = require('@opentelemetry/api');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

let sentryEnabled = false;
let tracerProvider = null;

function envBool(name, fallback = false) {
  const raw = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveServiceName() {
  const fromEnv = String(process.env.QA_TELEMETRY_SERVICE || '').trim();
  if (fromEnv) return fromEnv;
  const fromProject = String(process.env.QA_PROJECT_SLUG || '').trim();
  if (fromProject) return `qa-assistant-${fromProject}`;
  return 'qa-assistant';
}

function initSentry() {
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return false;

  const tracesSampleRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.2');
  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'qa',
    release: process.env.SENTRY_RELEASE || process.env.GIT_SHA || 'qa-assistant',
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.2,
  });
  sentryEnabled = true;
  return true;
}

function initOtel() {
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
  if (!endpoint) return false;

  const exporterUrl = endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`;
  const spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: exporterUrl,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? Object.fromEntries(
            String(process.env.OTEL_EXPORTER_OTLP_HEADERS || '')
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
              .map((entry) => {
                const idx = entry.indexOf('=');
                if (idx === -1) return [entry, ''];
                return [entry.slice(0, idx).trim(), entry.slice(idx + 1).trim()];
              })
          )
        : undefined,
    })
  );

  tracerProvider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': resolveServiceName(),
      'service.namespace': 'qa',
      'deployment.environment': process.env.NODE_ENV || 'qa',
    }),
    spanProcessors: [spanProcessor],
  });
  tracerProvider.register();
  return true;
}

function initTelemetry() {
  if (envBool('QA_TELEMETRY_DISABLED', false)) {
    return { sentry: false, otel: false };
  }

  const sentry = initSentry();
  const otel = initOtel();

  if (otel) {
    const tracer = trace.getTracer('qa-assistant-bootstrap');
    const span = tracer.startSpan('qa.telemetry.bootstrap');
    span.setAttribute('qa.telemetry.sentry', sentry);
    span.setAttribute('qa.telemetry.otel', otel);
    span.end();
  }

  if (sentry && envBool('QA_TELEMETRY_VERBOSE', false)) {
    Sentry.captureMessage('QA telemetry initialized', 'info');
  }

  return { sentry, otel };
}

async function shutdownTelemetry() {
  const tasks = [];
  if (sentryEnabled) tasks.push(Sentry.close(2000).catch(() => null));
  if (tracerProvider) tasks.push(tracerProvider.shutdown().catch(() => null));
  await Promise.all(tasks);
}

module.exports = {
  initTelemetry,
  shutdownTelemetry,
};
