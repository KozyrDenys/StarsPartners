const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Usage: node analyze/sanitizeGeneratedTest.js <file>');
  process.exit(1);
}

const filePath = path.resolve(process.argv[2]);
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

// 1) Remove markdown fences by line filtering (no regex)
let lines = content.split('\n').filter((l) => !l.trim().startsWith('```'));

// 2) Drop preamble: keep from first "code-like" line
function isCodeStart(line) {
  const t = line.trim();
  return (
    t.startsWith('import ') ||
    t.startsWith('const ') ||
    t.startsWith('let ') ||
    t.startsWith('var ') ||
    t.startsWith('require(') ||
    t.startsWith('test(') ||
    t.startsWith('test.describe')
  );
}

let startIdx = lines.findIndex(isCodeStart);
if (startIdx >= 0) lines = lines.slice(startIdx);

// 3) Join back
content = lines.join('\n');

// 4) Fix common broken locator typo: locator('h1)) -> locator('h1')
content = content.replace("locator('h1))", "locator('h1')");

// 5) Replace a couple of common chai fragments (keep minimal)
content = content.replace('.to.be.ok()', '.toBeTruthy()');

// 6) Normalize
content = content.trim() + '\n';

fs.writeFileSync(filePath, content);
console.log(`✅ Sanitized: ${filePath}`);
