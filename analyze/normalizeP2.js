const { normalizeGeneratedSpec } = require('./normalizeGeneratedSpec');

try {
  const out = normalizeGeneratedSpec('tests/ai/p2.spec.js', 'P2');
  console.log(`✅ Normalized P2 (AI output kept): ${out}`);
} catch (e) {
  console.error('❌ normalizeP2 failed:', e?.message || e);
  process.exit(1);
}
