const { spawn } = require('child_process');

const args = process.argv.slice(2);
const modeArg = args.find((arg) => !String(arg).startsWith('-'));
const mode = (modeArg || 'assist').toLowerCase();
const loop = args.includes('--loop');
const intervalArg = args.find((arg) => String(arg).startsWith('--interval='));
const intervalSeconds = intervalArg
  ? Number.parseInt(String(intervalArg).split('=')[1], 10)
  : loop
    ? 300
    : 0;

const defaultUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const userAgent = process.env.PW_USER_AGENT || defaultUA;

const modeEnv = {
  auto: {
    PW_PRECHECK_SOFT: '0',
    PW_AUTO_SAVE_STATE: '0',
  },
  assist: {
    PW_PRECHECK_SOFT: '0',
    PW_AUTO_SAVE_STATE: '1',
    PW_USE_CHROME_CHANNEL: '1',
    PW_SLOWMO: '150',
    PW_USER_AGENT: userAgent,
  },
  max: {
    PW_PRECHECK_SOFT: '1',
    PW_AUTO_SAVE_STATE: '1',
    PW_USE_CHROME_CHANNEL: '1',
    PW_SLOWMO: '150',
    PW_USER_AGENT: userAgent,
  },
};

if (!modeEnv[mode]) {
  console.log('Usage: node scripts/agent.js <auto|assist|max> [--loop] [--interval=SECONDS]');
  process.exit(1);
}

function runOnce() {
  return new Promise((resolve) => {
    const env = { ...process.env, ...modeEnv[mode] };
    const child = spawn('npm', ['run', 'qa:all'], { env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  console.log(`\nAgent mode: ${mode}`);
  if (loop) {
    console.log(`Loop enabled. Interval: ${intervalSeconds || 300}s`);
  }

  if (!loop) {
    const code = await runOnce();
    process.exit(code);
  }

  while (loop) {
    const code = await runOnce();
    if (code !== 0) process.exit(code);
    if (intervalSeconds > 0) {
      await sleep(intervalSeconds * 1000);
    }
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
