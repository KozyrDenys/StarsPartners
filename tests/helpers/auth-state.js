const fs = require('fs');

function readAuthStateMeta(filePath, index) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  let mtimeMs = 0;
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = Number(stat.mtimeMs || 0);
    sizeBytes = Number(stat.size || 0);
  } catch {
    // best-effort metadata
  }

  let cookiesCount = 0;
  let originsCount = 0;
  let parseError = false;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cookiesCount = Array.isArray(payload && payload.cookies) ? payload.cookies.length : 0;
    originsCount = Array.isArray(payload && payload.origins) ? payload.origins.length : 0;
  } catch {
    parseError = true;
  }

  return {
    filePath,
    index,
    mtimeMs,
    sizeBytes,
    cookiesCount,
    originsCount,
    hasSessionArtifacts: cookiesCount > 0 || originsCount > 0,
    parseError,
  };
}

function compareAuthStateMeta(left, right) {
  if (left.hasSessionArtifacts !== right.hasSessionArtifacts) {
    return left.hasSessionArtifacts ? -1 : 1;
  }
  if (left.parseError !== right.parseError) {
    return left.parseError ? 1 : -1;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return right.sizeBytes - left.sizeBytes;
  }
  return left.index - right.index;
}

function pickBestAuthStatePath(candidates) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((filePath, index) => readAuthStateMeta(filePath, index))
    .filter(Boolean);
  if (!ranked.length) return null;

  ranked.sort(compareAuthStateMeta);
  const preferred =
    ranked.find((entry) => entry.hasSessionArtifacts && !entry.parseError) ||
    ranked.find((entry) => !entry.parseError) ||
    ranked[0];
  return preferred ? preferred.filePath : null;
}

module.exports = {
  compareAuthStateMeta,
  pickBestAuthStatePath,
  readAuthStateMeta,
};
