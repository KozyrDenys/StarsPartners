const path = require('path');
const { URL } = require('url');

function toBrandSlug(baseUrl) {
  try {
    const hostname = new URL(String(baseUrl || '')).hostname || 'brand';
    return (
      String(hostname)
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'brand'
    );
  } catch {
    return 'brand';
  }
}

function resolveProjectPaths(options = {}) {
  const cwd = options.cwd || process.cwd();
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'https://gt.bet/';
  const brandSlug = process.env.QA_PROJECT_SLUG || toBrandSlug(baseUrl);
  const projectRoot = process.env.QA_PROJECT_ROOT || path.join(cwd, 'projects', brandSlug);

  return {
    cwd,
    baseUrl,
    brandSlug,
    projectRoot,
    artifactsDir: process.env.QA_ARTIFACTS_DIR || path.join(projectRoot, 'artifacts'),
    testResultsDir: process.env.QA_TEST_RESULTS_DIR || path.join(projectRoot, 'test-results'),
    autotestReportDir:
      process.env.QA_AUTOTEST_REPORT_DIR || path.join(projectRoot, 'Autotest report'),
    analyzeDir: process.env.QA_ANALYZE_DIR || path.join(projectRoot, 'analyze'),
  };
}

module.exports = {
  toBrandSlug,
  resolveProjectPaths,
};
