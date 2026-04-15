const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // главное: выключаем “терминальные эффекты”
      CI: '1',
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      // Playwright: не пытаться красиво рисовать
      PW_TEST_NO_TERMINAL: '1',
    },
  });
}

try {
  // 1) Генерация спеков (AI)
  run('node analyze/aiGenerateSpecs.js');

  // 2) Санитайз + нормализация
  run('node analyze/sanitizeGeneratedTest.js tests/ai/p0.spec.js');
  run('node analyze/normalizeP0.js');

  run('node analyze/sanitizeGeneratedTest.js tests/ai/p1.spec.js');
  run('node analyze/normalizeP1.js');

  run('node analyze/sanitizeGeneratedTest.js tests/ai/p2.spec.js');
  run('node analyze/normalizeP2.js');

  // 3) Прогон тестов с “тихими” репортерами (без спиннеров)
  run('npx playwright test tests/ai/p0.spec.js --reporter=line');
  run('npx playwright test tests/ai/p1.spec.js --reporter=line');
  run('npx playwright test tests/ai/p2.spec.js --reporter=line');

  console.log('\n✅ ALL PIPELINES COMPLETE: PASS');
} catch {
  console.log('\n❌ ALL PIPELINES COMPLETE: FAIL');
  process.exit(1);
}
