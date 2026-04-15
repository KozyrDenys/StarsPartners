const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  // 1) Generate specs via AI
  run('node analyze/aiGenerateSpecs.js');

  // 2) Sanitize generated P1 (убираем markdown, мусор)
  run('node analyze/sanitizeGeneratedTest.js tests/ai/p1.spec.js');

  // 3) Normalize P1 (ElementHandle -> Locator, expect fixes)
  run('node analyze/normalizeP1.js');

  // 4) Run P1 tests
  run('npx playwright test tests/ai/p1.spec.js --reporter=line');

  console.log('\n✅ P1 pipeline complete: PASS');
} catch {
  console.log('\n❌ P1 pipeline complete: FAIL');
  process.exit(1);
}
