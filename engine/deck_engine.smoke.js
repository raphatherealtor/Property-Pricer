/* ============================================================================
 * deck_engine.smoke.js — Node smoke tests for the locked v1.6 visual engine.
 * ----------------------------------------------------------------------------
 * Run:  node deck_engine.smoke.js
 * Verifies the spec-exact survival knots, kappa fixed points, survival-weighted
 * E[discount|κ], anchored-offer net semantics, direction coherence across the
 * $600k–$750k slider, convex cost of testing, and prints a numeric readout
 * table at the default demo inputs.
 * ========================================================================== */
'use strict';

const path = require('path');
const Deck = require(path.join(__dirname, 'deck_controller.js'));
const { Engine, SelfTest, VERSION, _helpers } = Deck;

console.log('deck_controller ' + VERSION + ' loaded from ' + __filename + '\n');

/* 1) Deterministic engine assertions ---------------------------------------- */
const report = SelfTest.run(function (name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
});

console.log('\nEngine assertions: ' + (report.total - report.failed) + '/' + report.total + ' passed\n');

/* 2) Numeric readout table over the slider grid ------------------------------ */
const baselineValue = 660000;
const closedMedianDomDays = 42;
const kT = Engine.kappaT(closedMedianDomDays);

console.log('Scenario table (baseline $660k · closed med DOM 42 d · κ_t = ' + kT.toFixed(3) + ')');
console.log('ask      ratio  κ_eff  E[DOM]  P(>120d) P(≤2wk) E[disc]  expected offer   net@ask       cost');
for (let ask = 600000; ask <= 750000; ask += 25000) {
  const s = Engine.scenario({ baselineValue, targetAsk: ask, closedMedianDomDays });
  console.log(
    String(ask).padStart(7) + ' ' +
    (s.r * 100).toFixed(1).padStart(5) + '%' +
    s.kappaEff.toFixed(2).padStart(6) +
    String(Math.round(s.domDays)).padStart(6) + 'd' +
    (s.p120 * 100).toFixed(1).padStart(8) + '%' +
    (s.p2wk * 100).toFixed(1).padStart(8) + '%' +
    (s.discount * 100).toFixed(2).padStart(8) + '%' +
    _helpers.fmtMoney(Math.round(s.expectedOffer)).padStart(16) +
    _helpers.fmtMoney(Math.round(s.netTarget)).padStart(13) +
    (s.costOfTesting > 0
      ? _helpers.fmtMoney(Math.round(s.costOfTesting)).padStart(11)
      : '      $0'.padStart(11))
  );
}

console.log('\nKey spec constants:');
console.log('  base median        = ' + Engine.baseMedianWeeks().toFixed(4) + ' wk (expect 27.1282)');
console.log('  E[discount|κ_t]    = ' + (Engine.discountFraction(kT) * 100).toFixed(4) + '% (survival-weighted)');
console.log('  E[discount|κ_eff]  = ' +
  (Engine.discountFraction(Engine.kappaEff(750000, baselineValue, closedMedianDomDays)) * 100).toFixed(4) +
  '% @ ask $750k (dilated)');
console.log('  κ_t @ 189.9 d      = ' + Engine.kappaT(189.9).toFixed(4) + ' (expect ≈ 0.6896)');
console.log('  anchored net       = ' + _helpers.fmtMoney(Math.round(Engine.netExpected(baselineValue, baselineValue, kT))));
console.log('  cost @ +3%         = ' + _helpers.fmtMoney(Math.round(Engine.scenario({
  baselineValue, closedMedianDomDays, targetAsk: Math.round(baselineValue * 1.03) }).costOfTesting)));
console.log('  cost @ +20%        = ' + _helpers.fmtMoney(Math.round(Engine.scenario({
  baselineValue, closedMedianDomDays, targetAsk: Math.round(baselineValue * 1.20) }).costOfTesting)));

if (report.failed > 0) {
  console.error('\nSMOKE TEST FAILED — ' + report.failed + ' assertion(s) failing.');
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED.');
process.exit(0);
