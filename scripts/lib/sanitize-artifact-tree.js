const fs = require('fs');
const path = require('path');

const { redactSerializedText, redactText } = require('./redact-secrets');

const TEXT_EXTENSIONS = new Set(['.json', '.md', '.txt', '.log', '.ndjson']);

function sanitizeArtifactTree(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return { scanned: 0, sanitized: 0 };

  let scanned = 0;
  let sanitized = 0;
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
      continue;
    }
    if (!stat.isFile() || !TEXT_EXTENSIONS.has(path.extname(current).toLowerCase())) continue;

    scanned += 1;
    const source = fs.readFileSync(current, 'utf8');
    const sanitizedText = current.toLowerCase().endsWith('.json')
      ? redactSerializedText(source)
      : redactText(source);
    if (sanitizedText === source) continue;
    fs.writeFileSync(current, sanitizedText, 'utf8');
    sanitized += 1;
  }

  return { scanned, sanitized };
}

module.exports = { sanitizeArtifactTree };
