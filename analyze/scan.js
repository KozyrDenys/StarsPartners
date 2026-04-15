// analyze/scan.js
const fs = require('fs');
const path = require('path');

const { collectPageInfo } = require('./collectPageInfo');
// ollamaGenerate можешь оставить, даже если пока не используешь
const { ollamaGenerate } = require('./ollamaChat');

const PROJECT_DIR = process.env.QA_PROJECT_DIR || process.cwd();
const ANALYZE_DIR = path.join(PROJECT_DIR, 'analyze');
const RUNS_DIR = path.join(ANALYZE_DIR, 'runs');

// HEADLESS: по умолчанию 1 (true). Если в env "0" или "false" → false
const DEFAULT_HEADLESS = !/^(0|false)$/i.test(String(process.env.HEADLESS || '1'));
const VALID_WAIT_UNTIL = new Set(['domcontentloaded', 'load', 'networkidle']);

function safeMkdir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new TypeError(`safeMkdir: dir must be a string, got ${typeof dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

function write(filePath, content) {
  safeMkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeTimeout(value, fallback = 20000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeWaitUntil(value, fallback = 'domcontentloaded') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return VALID_WAIT_UNTIL.has(normalized) ? normalized : fallback;
}

// (опционально, на потом) простой промпт под тест-план
function buildPlanPrompt(url, pageInfo) {
  return [
    `Ты — QA Engineer. Составь тест-план по странице.`,
    ``,
    `URL: ${url}`,
    ``,
    `Данные со страницы (JSON):`,
    JSON.stringify(pageInfo, null, 2),
    ``,
    `Выдай markdown: разделы P0/P1/P2, риски, идеи автотестов.`,
  ].join('\n');
}

async function scan(url, opts = {}) {
  const headless = typeof opts.headless === 'boolean' ? opts.headless : DEFAULT_HEADLESS;
  const timeoutMs = normalizeTimeout(opts.timeoutMs, 20000);
  const waitUntil = normalizeWaitUntil(opts.waitUntil, 'domcontentloaded');

  safeMkdir(RUNS_DIR);

  const runDir = path.join(RUNS_DIR, nowStamp());
  safeMkdir(runDir);

  // 1) сбор данных страницы
  const pageInfo = await collectPageInfo(url, {
    outDir: runDir,
    headless,
    timeoutMs,
    waitUntil,
  });

  // 2) сохранить артефакт
  const pageInfoPath = path.join(runDir, 'pageInfo.json');
  write(pageInfoPath, JSON.stringify(pageInfo, null, 2));

  // 3) (опционально) генерация тест-плана через Ollama
  // Если пока не нужно — закомментируй блок ниже
  try {
    const plan = await ollamaGenerate(buildPlanPrompt(url, pageInfo));
    write(path.join(runDir, 'qa-plan.md'), plan);
  } catch {
    // не роняем scan, если Ollama временно недоступна
  }

  // 4) компактный вывод (как у тебя)
  return {
    url: pageInfo.url || url,
    outDir: runDir,
    title: pageInfo.title || '',
    h1Count: pageInfo.h1Count ?? 0,
    linksCount: pageInfo.linksCount ?? 0,
    buttonsCount: pageInfo.buttonsCount ?? 0,
    inputsCount: pageInfo.inputsCount ?? 0,
    storageStateUsed: Boolean(pageInfo.storageStateUsed),
    consoleErrorsCount: pageInfo.consoleErrorsCount ?? 0,
    requestFailsCount: pageInfo.requestFailsCount ?? 0,
    headless,
    timeoutMs,
    waitUntil,
  };
}

module.exports = { scan };
