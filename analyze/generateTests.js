const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, 'qa-report.md');
const outputDir = path.join(__dirname, '../tests/ai');

if (!fs.existsSync(reportPath)) {
  console.error('❌ Missing file: analyze/qa-report.md');
  console.error('Run AI review first: node analyze/aiReview.js');
  process.exit(1);
}

const raw = fs.readFileSync(reportPath, 'utf8');

function extractCode(text) {
  const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : '';
}

// Split by P0 / P1 / P2 headings (markdown or plain)
function sectionAfter(label) {
  const re = new RegExp(`\\b${label}\\b[\\s\\S]*?(?=\\bP[012]\\b|$)`, 'i');
  const m = raw.match(re);
  return m ? m[0] : '';
}

const p0 = extractCode(sectionAfter('P0'));
const p1 = extractCode(sectionAfter('P1'));
const p2 = extractCode(sectionAfter('P2'));

fs.mkdirSync(outputDir, { recursive: true });

fs.writeFileSync(path.join(outputDir, 'p0.spec.js'), p0);
fs.writeFileSync(path.join(outputDir, 'p1.spec.js'), p1);
fs.writeFileSync(path.join(outputDir, 'p2.spec.js'), p2);

console.log('✅ Tests generated from analyze/qa-report.md:');
console.log('- tests/ai/p0.spec.js');
console.log('- tests/ai/p1.spec.js');
console.log('- tests/ai/p2.spec.js');

if (!p0)
  console.warn('⚠️ p0.spec.js is empty (qa-report.md may not contain a JS code block under P0)');
