const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { resolveProjectPaths, toBrandSlug } = require('../tests/helpers/project-paths');

test('toBrandSlug normalizes URL hostnames', () => {
  assert.equal(toBrandSlug('https://WWW.Example.COM/path'), 'www.example.com');
  assert.equal(toBrandSlug('not a URL'), 'brand');
});

test('resolveProjectPaths creates a consistent project layout', () => {
  const previous = {
    QA_ANALYZE_DIR: process.env.QA_ANALYZE_DIR,
    QA_ARTIFACTS_DIR: process.env.QA_ARTIFACTS_DIR,
    QA_AUTOTEST_REPORT_DIR: process.env.QA_AUTOTEST_REPORT_DIR,
    QA_PROJECT_ROOT: process.env.QA_PROJECT_ROOT,
    QA_PROJECT_SLUG: process.env.QA_PROJECT_SLUG,
    QA_TEST_RESULTS_DIR: process.env.QA_TEST_RESULTS_DIR,
  };
  for (const name of Object.keys(previous)) delete process.env[name];

  try {
    const root = path.resolve('/tmp/qa-project-paths-test');
    const result = resolveProjectPaths({ cwd: root, baseUrl: 'https://brand.example/path' });
    assert.equal(result.brandSlug, 'brand.example');
    assert.equal(result.projectRoot, path.join(root, 'projects', 'brand.example'));
    assert.equal(result.testResultsDir, path.join(result.projectRoot, 'test-results'));
    assert.equal(result.autotestReportDir, path.join(result.projectRoot, 'Autotest report'));
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
