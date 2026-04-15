const { initTelemetry, shutdownTelemetry } = require('./telemetry');

const state = initTelemetry();

if (state.sentry || state.otel) {
  const shutdown = async () => {
    await shutdownTelemetry();
  };

  process.on('beforeExit', shutdown);
  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(143);
  });
}
