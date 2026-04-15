#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECTS_ROOT = path.join(process.cwd(), 'projects');
const OUT_DIR = path.join(PROJECTS_ROOT, 'dashboard', 'log-index');
const OUT_INDEX_JSON = path.join(OUT_DIR, 'run-index.json');
const OUT_EVENTS_NDJSON = path.join(OUT_DIR, 'qa-run-events.ndjson');
const MAX_FILES_PER_DIR = toPositiveInt(process.env.QA_LOG_INDEX_MAX_FILES_PER_DIR || '30', 30);
const LOKI_URL = String(process.env.LOKI_PUSH_URL || 'http://127.0.0.1:3100/loki/api/v1/push');
const STRICT = process.env.QA_LOG_INDEX_STRICT === '1';

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const divider = trimmed.indexOf('=');
    if (divider === -1) {
      args[trimmed] = '1';
      continue;
    }
    const key = trimmed.slice(0, divider);
    const value = trimmed.slice(divider + 1);
    args[key] = value;
  }
  return args;
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function inferMode(runPath, brandSlug = '') {
  const slug = String(brandSlug || '').toLowerCase();
  if (slug.endsWith('-mobile')) return 'mobile';
  if (slug.endsWith('-desktop')) return 'desktop';
  if (/[\\/]mobile[\\/]/i.test(runPath)) return 'mobile';
  if (/[\\/]desktop[\\/]/i.test(runPath)) return 'desktop';
  return 'legacy';
}

function normalizeArtifactRecords(rawArtifacts) {
  if (!rawArtifacts || typeof rawArtifacts !== 'object') return [];
  const records = [];
  for (const [artifactKey, artifactValue] of Object.entries(rawArtifacts)) {
    if (!artifactValue || typeof artifactValue !== 'object') continue;
    records.push({
      key: oneLine(artifactKey || ''),
      path: oneLine(artifactValue.path || ''),
      exists: Boolean(artifactValue.exists),
      bytes: Number.isFinite(Number(artifactValue.bytes)) ? Number(artifactValue.bytes) : 0,
    });
  }
  return records;
}

function normalizeTimestamp(value) {
  const ts = Date.parse(String(value || ''));
  if (Number.isFinite(ts)) return new Date(ts).toISOString();
  return new Date().toISOString();
}

function toNs(isoTs) {
  const ms = Date.parse(String(isoTs || ''));
  const safeMs = Number.isFinite(ms) ? ms : Date.now();
  return `${BigInt(Math.floor(safeMs)) * 1000000n}`;
}

function collectRunFilesFromDir(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const files = fs
    .readdirSync(runsDir)
    .filter((item) => item.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, MAX_FILES_PER_DIR)
    .map((fileName) => path.join(runsDir, fileName));
  return files;
}

function collectRunFiles() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];

  const runFiles = [];
  const brands = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'dashboard')
    .map((entry) => entry.name)
    .sort();

  for (const brand of brands) {
    const brandRoot = path.join(PROJECTS_ROOT, brand);
    runFiles.push(
      ...collectRunFilesFromDir(path.join(brandRoot, 'desktop', 'artifacts', 'history', 'runs'))
    );
    runFiles.push(
      ...collectRunFilesFromDir(path.join(brandRoot, 'mobile', 'artifacts', 'history', 'runs'))
    );
    runFiles.push(...collectRunFilesFromDir(path.join(brandRoot, 'artifacts', 'history', 'runs')));
  }

  return Array.from(new Set(runFiles));
}

function buildEvents(runPayload, runPath) {
  const ts = normalizeTimestamp(runPayload.timestamp);
  const mode = inferMode(runPath, runPayload.brandSlug);
  const runId = oneLine(runPayload.runId || path.basename(runPath, '.json') || '');
  const artifacts = normalizeArtifactRecords(runPayload.artifacts);
  const runEvent = {
    kind: 'qa-run',
    timestamp: ts,
    runId,
    brandSlug: oneLine(runPayload.brandSlug || ''),
    baseUrl: oneLine(runPayload.baseUrl || ''),
    mode,
    runStatus: oneLine(runPayload.runStatus || 'UNKNOWN'),
    totals: runPayload.totals || {},
    runPath,
  };

  const phaseEvents = [];
  const phases =
    runPayload.phases && typeof runPayload.phases === 'object' ? runPayload.phases : {};
  for (const [phase, summary] of Object.entries(phases)) {
    phaseEvents.push({
      kind: 'qa-phase',
      timestamp: normalizeTimestamp(summary.generatedAt || ts),
      runId,
      brandSlug: runEvent.brandSlug,
      baseUrl: runEvent.baseUrl,
      mode,
      runStatus: runEvent.runStatus,
      phase: oneLine(phase),
      summary: summary || {},
      runPath,
    });
  }

  const artifactEvents = artifacts.map((artifact) => ({
    kind: 'qa-artifact',
    timestamp: ts,
    runId,
    brandSlug: runEvent.brandSlug,
    baseUrl: runEvent.baseUrl,
    mode,
    runStatus: runEvent.runStatus,
    artifact: artifact.key,
    artifactPath: artifact.path,
    exists: artifact.exists,
    bytes: artifact.bytes,
    runPath,
  }));

  const kpiEvent = runPayload.kpi
    ? {
        kind: 'qa-kpi',
        timestamp: ts,
        runId,
        brandSlug: runEvent.brandSlug,
        baseUrl: runEvent.baseUrl,
        mode,
        runStatus: runEvent.runStatus,
        valid: Boolean(runPayload.kpi.valid),
        failedChecks: Array.isArray(runPayload.kpi.failedChecks)
          ? runPayload.kpi.failedChecks.length
          : 0,
        runPath,
      }
    : null;

  return { runEvent, phaseEvents, artifactEvents, kpiEvent, artifacts, runId };
}

function writeArtifacts(events, runs, options = {}) {
  ensureDir(OUT_DIR);
  const append = options.append === true;
  const ndjson = events.map((item) => JSON.stringify(item)).join('\n');
  if (append && fs.existsSync(OUT_EVENTS_NDJSON)) {
    const prefix = fs.statSync(OUT_EVENTS_NDJSON).size > 0 ? '\n' : '';
    fs.appendFileSync(OUT_EVENTS_NDJSON, `${prefix}${ndjson}`, 'utf8');
  } else {
    fs.writeFileSync(OUT_EVENTS_NDJSON, ndjson ? `${ndjson}\n` : '', 'utf8');
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    eventCount: events.length,
    eventsFile: OUT_EVENTS_NDJSON,
    runs,
  };
  fs.writeFileSync(OUT_INDEX_JSON, JSON.stringify(payload, null, 2), 'utf8');
}

async function pushToLoki(events) {
  if (!events.length) return { ok: true, sent: 0, status: 0, error: '' };

  const streamsMap = new Map();
  for (const event of events) {
    const labels = {
      app: 'qa-assistant',
      kind: oneLine(event.kind || 'event'),
      brand: oneLine(event.brandSlug || 'unknown'),
      mode: oneLine(event.mode || 'legacy'),
      phase: oneLine(event.phase || 'all'),
    };
    const key = JSON.stringify(labels);
    if (!streamsMap.has(key)) streamsMap.set(key, { stream: labels, values: [] });
    streamsMap.get(key).values.push([toNs(event.timestamp), JSON.stringify(event)]);
  }

  const body = {
    streams: Array.from(streamsMap.values()),
  };

  try {
    const response = await fetch(LOKI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return {
        ok: false,
        sent: events.length,
        status: response.status,
        error: oneLine(await response.text()),
      };
    }
    return { ok: true, sent: events.length, status: response.status, error: '' };
  } catch (error) {
    return {
      ok: false,
      sent: events.length,
      status: 0,
      error: oneLine(error && error.message ? error.message : error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runArg = oneLine(args.run || '');
  const append =
    args.append === '1' || args.append === 'true' || process.env.QA_LOG_INDEX_APPEND === '1';
  const shouldPush = args.push === '1' || args.push === 'true' || process.env.LOKI_PUSH === '1';

  const runFiles = runArg ? [path.resolve(runArg)] : collectRunFiles();
  const runs = [];
  const events = [];

  for (const runPath of runFiles) {
    const payload = readJson(runPath);
    if (!payload || typeof payload !== 'object') continue;
    const built = buildEvents(payload, runPath);
    runs.push({
      runId: built.runId,
      runPath,
      brandSlug: oneLine(payload.brandSlug || ''),
      baseUrl: oneLine(payload.baseUrl || ''),
      runStatus: oneLine(payload.runStatus || 'UNKNOWN'),
      mode: inferMode(runPath, payload.brandSlug),
      timestamp: normalizeTimestamp(payload.timestamp),
      phaseCount: built.phaseEvents.length,
      artifactCount: built.artifacts.length,
      existingArtifacts: built.artifacts.filter((item) => item.exists).length,
      totals: payload.totals || {},
    });
    events.push(built.runEvent, ...built.phaseEvents, ...built.artifactEvents);
    if (built.kpiEvent) events.push(built.kpiEvent);
  }

  writeArtifacts(events, runs, { append: append || Boolean(runArg) });
  console.log(`Log index updated: ${OUT_INDEX_JSON}`);
  console.log(`NDJSON events: ${OUT_EVENTS_NDJSON}`);
  console.log(`Indexed runs: ${runs.length}; events: ${events.length}`);

  if (!shouldPush) return;
  const pushed = await pushToLoki(events);
  if (!pushed.ok) {
    console.error(`Loki push failed (status=${pushed.status}): ${pushed.error || 'unknown error'}`);
    if (STRICT) process.exit(1);
    return;
  }
  console.log(`Loki push OK: ${pushed.sent} events -> ${LOKI_URL} (status=${pushed.status})`);
}

main().catch((error) => {
  console.error(oneLine(error && error.message ? error.message : error));
  process.exit(1);
});
