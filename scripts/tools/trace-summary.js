#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.log('Usage: node scripts/tools/trace-summary.js <path-to-trace.zip>');
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTraceLines(zipPath) {
  const candidateFiles = ['trace.trace', 'trace.network', '0-trace.trace'];
  for (const entry of candidateFiles) {
    const result = spawnSync('unzip', ['-p', zipPath, entry], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    });
    if (result.status === 0 && result.stdout) {
      return { entry, lines: result.stdout.split('\n') };
    }
  }
  return { entry: '', lines: [] };
}

function parseJsonLine(line) {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function main() {
  const zipPathArg = process.argv[2];
  if (!zipPathArg) {
    usage();
    process.exit(1);
  }

  const zipPath = path.resolve(zipPathArg);
  if (!fs.existsSync(zipPath)) {
    console.error(`Trace archive not found: ${zipPath}`);
    process.exit(1);
  }

  const { entry, lines } = readTraceLines(zipPath);
  if (!lines.length) {
    console.error(`Could not extract trace events from ${zipPath}.`);
    process.exit(2);
  }

  const summary = {
    traceZip: zipPath,
    sourceEntry: entry,
    totalEvents: 0,
    actions: 0,
    actionErrors: 0,
    consoleErrors: 0,
    pageErrors: 0,
    requestFailed: 0,
    request4xx5xx: 0,
    samples: {
      actionErrors: [],
      consoleErrors: [],
      pageErrors: [],
      requestFailed: [],
      request4xx5xx: [],
    },
  };

  for (const line of lines) {
    const event = parseJsonLine(line);
    if (!event || typeof event !== 'object') continue;
    summary.totalEvents += 1;

    if (event.type === 'action') {
      summary.actions += 1;
      const errorText = oneLine(event.error || event.metadata?.error || '');
      if (errorText) {
        summary.actionErrors += 1;
        if (summary.samples.actionErrors.length < 5) {
          summary.samples.actionErrors.push({
            apiName: oneLine(event.apiName || ''),
            error: errorText,
          });
        }
      }
      continue;
    }

    if (event.type !== 'event') continue;
    const method = String(event.method || '').toLowerCase();
    const params = event.params || {};

    if (method.includes('console')) {
      const text = oneLine(params.text || params.message?.text || '');
      const level = String(params.type || params.level || '').toLowerCase();
      if (/error|assert/.test(level) || /error/i.test(text)) {
        summary.consoleErrors += 1;
        if (summary.samples.consoleErrors.length < 5) {
          summary.samples.consoleErrors.push({ level, text });
        }
      }
    }

    if (method.includes('pageerror') || method.includes('weberror')) {
      const text = oneLine(params.error?.message || params.message || '');
      summary.pageErrors += 1;
      if (summary.samples.pageErrors.length < 5) {
        summary.samples.pageErrors.push(text || 'Unknown page error');
      }
    }

    if (method.includes('requestfailed')) {
      const url = oneLine(params.request?.url || params.url || '');
      const errorText = oneLine(params.failureText || params.errorText || params.error || '');
      summary.requestFailed += 1;
      if (summary.samples.requestFailed.length < 5) {
        summary.samples.requestFailed.push({ url, error: errorText });
      }
    }

    if (method.includes('response')) {
      const status = Number(params.response?.status || params.status || 0);
      if (status >= 400) {
        const url = oneLine(params.response?.url || params.url || '');
        summary.request4xx5xx += 1;
        if (summary.samples.request4xx5xx.length < 5) {
          summary.samples.request4xx5xx.push({ status, url });
        }
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main();
