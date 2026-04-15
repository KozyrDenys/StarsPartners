function resolveBrandSlug() {
  const explicit = String(process.env.QA_PROJECT_SLUG || '').trim();
  if (explicit) return explicit;
  const baseUrl = String(process.env.BASE_URL || 'https://gt.bet').trim();
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return 'qa-assistant';
  }
}

function compactIso(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, '-');
}

const brandSlug = resolveBrandSlug();
const mode = String(process.env.PW_PROJECT_MATRIX || 'desktop')
  .trim()
  .toLowerCase();

module.exports = {
  endpoint: String(process.env.RP_ENDPOINT || '').trim(),
  apiKey: String(process.env.RP_API_KEY || process.env.RP_TOKEN || '').trim(),
  token: String(process.env.RP_TOKEN || process.env.RP_API_KEY || '').trim(),
  project: String(process.env.RP_PROJECT || 'default_personal').trim(),
  launch: String(process.env.RP_LAUNCH || `qa-${brandSlug}-${mode}-${compactIso()}`).trim(),
  description: String(
    process.env.RP_DESCRIPTION || 'QA Assistant Playwright run with brand matrix'
  ).trim(),
  mode: String(process.env.RP_MODE || 'DEFAULT').trim(),
  skippedIssue: false,
  includeTestSteps: true,
  launchUuidPrint: true,
  attributes: [
    { key: 'brand', value: brandSlug },
    { key: 'mode', value: mode || 'desktop' },
    { key: 'providerProfile', value: String(process.env.PW_PROVIDER_PROFILE || 'extended') },
  ],
};
