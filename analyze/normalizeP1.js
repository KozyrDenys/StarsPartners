const { normalizeGeneratedSpec } = require('./normalizeGeneratedSpec');

try {
  const out = normalizeGeneratedSpec('tests/ai/p1.spec.js', 'P1');
  console.log(`✅ Normalized P1 (AI output kept): ${out}`);
} catch (e) {
  console.error('❌ normalizeP1 failed:', e?.message || e);
  process.exit(1);
}
