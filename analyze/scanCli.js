// analyze/scanCli.js
const { scan } = require('./scan');

function pickArg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1) return process.argv[idx + 1] ?? def;

  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);

  return def;
}

function getUrlArg() {
  // process.argv = [node, script, ...args]
  const args = process.argv.slice(2);

  // URL = первый аргумент, который НЕ флаг и НЕ значение флага
  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (!a) continue;
    if (a.startsWith('--')) {
      // пропускаем значение после "--timeout 20000" и т.п.
      const name = a.replace(/^--/, '');
      if (['timeout', 'wait'].includes(name) && args[i + 1] && !args[i + 1].startsWith('--')) i++;
      continue;
    }

    return a;
  }

  return null;
}

async function main() {
  const url = getUrlArg();
  const headed = process.argv.includes('--headed');
  const headless = !headed;

  const timeoutMs = Number(pickArg('timeout', '20000'));
  const waitUntil = pickArg('wait', 'domcontentloaded');

  if (!url) {
    console.error(
      'Usage: node analyze/scanCli.js <url> [--headed] [--timeout 20000] [--wait domcontentloaded]'
    );
    process.exit(2);
  }

  try {
    const result = await scan(url, { headless, timeoutMs, waitUntil });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(String(e?.stack || e?.message || e));
    process.exit(1);
  }
}

main();
