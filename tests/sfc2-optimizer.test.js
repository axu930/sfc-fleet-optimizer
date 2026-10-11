'use strict';

const assert = require('assert');
const optimizer = require('../js/sfc2-optimizer.js');
const combat = require('../js/sfc2-combat.js');
function near(actual, expected, tolerance=1e-8) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

assert.deepStrictEqual(optimizer.normalizeRatios({Athena:5, Hades:10}), {Athena:1, Hades:2});
assert.throws(() => optimizer.normalizeRatios({Charon:1}), /positive ratio/);

const denApplied = optimizer.protectWithResourceDen({ore:400_000, crystal:140_000, hydrogen:100_000}, 8);
assert.deepStrictEqual(denApplied, {ore:372_500, crystal:112_500, hydrogen:72_500});
assert.deepStrictEqual(
  optimizer.plunderPool({resources:{ore:400_000, crystal:140_000, hydrogen:100_000}, resourceDenLevel:8, atWar:false}),
  {ore:186_250, crystal:56_250, hydrogen:36_250}
);
const warPool = optimizer.plunderPool({resources:{ore:100, crystal:50, hydrogen:25}, valuesArePlunderable:true, atWar:true});
near(warPool.ore, 55);
near(warPool.crystal, 27.5);
near(warPool.hydrogen, 13.75);
const balancedLoot = optimizer.allocatePlunder({ore:500, crystal:20, hydrogen:100}, 150);
near(balancedLoot.ore, 65);
near(balancedLoot.crystal, 20);
near(balancedLoot.hydrogen, 65);

const result = optimizer.analyze({
  ratios:{Athena:10},
  defenders:{'Laser Cannon':1},
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0},
  confidence:0.95,
  resources:{ore:150_000, crystal:150_000, hydrogen:150_000},
  valuesArePlunderable:true,
  atWar:false
});
assert.deepStrictEqual(result.recommendations.map(item => item.roundLimit), [3, 4, 5, 6]);
for (const recommendation of result.recommendations) {
  assert.strictEqual(recommendation.scale, 1);
  assert.strictEqual(recommendation.winRound, 1);
  assert(recommendation.estimatedWinProbability >= 0.95);
  near(recommendation.estimatedLosses.Athena, 0);
  const options = Object.fromEntries(recommendation.cargo.map(item => [item.type, item]));
  assert.strictEqual(options.Atlas.additional, 45);
  assert.strictEqual(options.Hercules.additional, 9);
  assert.strictEqual(options.Carmanor.additional, 2);
  for (const option of Object.values(options)) {
    assert(option.fullyLoaded, `${option.type} should provide full expected cargo capacity`);
    assert(option.win, `${option.type} should preserve the selected round-limit result`);
    assert(option.capacity >= recommendation.cargoRequired);
    assert.strictEqual(option.fleet.Athena, 1, 'cargo sizing keeps the original attacking fleet fixed');
  }
}

console.log('SFC2 optimizer tests passed');
