const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function isValidJsModule(code) {
  const tempPath = path.join(
    os.tmpdir(),
    `qa-ai-normalize-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.js`
  );

  try {
    fs.writeFileSync(tempPath, code, 'utf8');
    const check = spawnSync(process.execPath, ['--check', tempPath], {
      encoding: 'utf8',
    });
    return check.status === 0;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
  }
}

function normalizeGeneratedSpec(targetFile, label = 'spec') {
  const PROJECT_DIR = process.env.QA_PROJECT_DIR || process.cwd();
  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(PROJECT_DIR, targetFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (!content || !content.trim()) {
    throw new Error(`${label}: generated file is empty`);
  }

  // Remove markdown fences and leading prose if model leaked formatting.
  const lines = content
    .replace(/^\uFEFF/, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('```'));

  let normalized = lines.join('\n');

  normalized = normalized
    .replace(/\.to\.be\.ok\(\)/g, '.toBeTruthy()')
    .replace(/locator\('h1\)\)/g, "locator('h1')")
    .replace(/locator\("h1\)\)/g, 'locator("h1")');

  const hasPlaywrightImport =
    normalized.includes("from '@playwright/test'") ||
    normalized.includes("require('@playwright/test')");
  if (!hasPlaywrightImport) {
    normalized = `import { test, expect } from '@playwright/test';\n\n${normalized}`;
  }

  if (new RegExp('Example Domain|iana\\.org/domains/example', 'i').test(normalized)) {
    throw new Error(
      `${label}: output references Example Domain and is not suitable for target tests`
    );
  }

  if (!isValidJsModule(normalized)) {
    const linesFromEnd = normalized.split('\n');
    while (linesFromEnd.length > 0 && !isValidJsModule(linesFromEnd.join('\n'))) {
      linesFromEnd.pop();
    }
    normalized = linesFromEnd.join('\n');
  }

  if (!isValidJsModule(normalized)) {
    throw new Error(`${label}: normalized output is not valid JavaScript`);
  }

  if (!/\btest\s*\(/.test(normalized) && !/\btest\.describe\s*\(/.test(normalized)) {
    throw new Error(`${label}: no Playwright tests found after normalization`);
  }

  normalized = normalized.trim() + '\n';
  fs.writeFileSync(filePath, normalized, 'utf8');

  return filePath;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node analyze/normalizeGeneratedSpec.js <file> [label]');
    process.exit(1);
  }

  try {
    const label = process.argv[3] || 'spec';
    const out = normalizeGeneratedSpec(file, label);
    console.log(`✅ Normalized ${label}: ${out}`);
  } catch (e) {
    console.error(`❌ normalizeGeneratedSpec failed: ${e?.message || e}`);
    process.exit(1);
  }
}

module.exports = { normalizeGeneratedSpec };
