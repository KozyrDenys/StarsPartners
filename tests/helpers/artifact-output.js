const { redactObject, redactText } = require('../../scripts/lib/redact-secrets');

function sanitizeArtifactPayload(payload) {
  return typeof payload === 'string' ? redactText(payload) : redactObject(payload);
}

function serializeArtifactPayload(payload) {
  const sanitized = sanitizeArtifactPayload(payload);
  return typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);
}

module.exports = {
  sanitizeArtifactPayload,
  serializeArtifactPayload,
};
