const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  // 1) Generate specs (AI)
  run('node analyze/aiGenerateSpecs.js');

  // 2) Sanitize generated P0 (remove markdown fences / preamble)
  run('node analyze/sanitizeGeneratedTest.js tests/ai/p0.spec.js');

  // 3) Normalize P0 (fix common Playwright API mistakes from AI)
  run('node analyze/normalizeP0.js');

  // 4) Run P0 tests
  run('npx playwright test tests/ai/p0.spec.js --reporter=line');

  console.log('\n✅ P0 pipeline complete: PASS');
} catch {
  console.log('\n❌ P0 pipeline complete: FAIL');
  process.exit(1);
}
