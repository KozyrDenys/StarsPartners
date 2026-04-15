const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run('node analyze/aiGenerateSpecs.js');
  run('node analyze/sanitizeGeneratedTest.js tests/ai/p2.spec.js');
  run('node analyze/normalizeP2.js');
  run('npx playwright test tests/ai/p2.spec.js --reporter=line');

  console.log('\n✅ P2 pipeline complete: PASS');
} catch {
  console.log('\n❌ P2 pipeline complete: FAIL');
  process.exit(1);
}
