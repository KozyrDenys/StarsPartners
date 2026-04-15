const fs = require('fs');
const path = require('path');

const PROJECT_DIR = process.env.QA_PROJECT_DIR || process.cwd();
const TARGET_FILE = path.join(PROJECT_DIR, 'analyze', 'target.json');

function setTarget(url) {
  fs.mkdirSync(path.dirname(TARGET_FILE), { recursive: true });
  fs.writeFileSync(TARGET_FILE, JSON.stringify({ url }, null, 2), 'utf8');
  return url;
}

function getTarget() {
  try {
    const raw = fs.readFileSync(TARGET_FILE, 'utf8');
    const data = JSON.parse(raw);
    return (data.url || '').trim();
  } catch {
    return '';
  }
}

module.exports = { setTarget, getTarget, TARGET_FILE };
