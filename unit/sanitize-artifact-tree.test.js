const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sanitizeArtifactTree } = require('../scripts/lib/sanitize-artifact-tree');

test('sanitizeArtifactTree rewrites report text files but leaves binary files untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-artifact-redaction-'));
  try {
    const jsonPath = path.join(root, 'result.json');
    const imagePath = path.join(root, 'image.png');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ password: 'plain-secret', url: 'https://x.test/?__cf_chl_rt_tk=cf-secret' })
    );
    fs.writeFileSync(imagePath, Buffer.from([0, 1, 2, 3]));

    const result = sanitizeArtifactTree(root);
    const sanitized = fs.readFileSync(jsonPath, 'utf8');
    assert.equal(result.scanned, 1);
    assert.equal(result.sanitized, 1);
    assert.equal(sanitized.includes('plain-secret'), false);
    assert.equal(sanitized.includes('cf-secret'), false);
    assert.deepEqual(fs.readFileSync(imagePath), Buffer.from([0, 1, 2, 3]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
