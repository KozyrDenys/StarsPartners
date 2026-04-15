const { normalizeGeneratedSpec } = require('./normalizeGeneratedSpec');

try {
  const out = normalizeGeneratedSpec('tests/ai/p0.spec.js', 'P0');
  console.log(`✅ Normalized P0 (AI output kept): ${out}`);
} catch (e) {
  console.error('❌ normalizeP0 failed:', e?.message || e);
  process.exit(1);
}
