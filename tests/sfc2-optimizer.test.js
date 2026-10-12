'use strict';

const assert = require('assert');
const optimizer = require('../js/sfc2-optimizer.js');
const combat = require('../js/sfc2-combat.js');
function near(actual, expected, tolerance=1e-8) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

assert.deepStrictEqual(optimizer.normalizeRatios({Athena:5, Hades:10}), {Athena:1, Hades:2});
assert.throws(() => optimizer.normalizeRatios({Charon:1}), /positive ratio/);
assert.deepStrictEqual(combat.ATTACKER_SHIPS, ['Artemis', 'Apollo', 'Poseidon', 'Athena', 'Hades', 'Ares', 'Prometheus', 'Zeus']);
assert.strictEqual(optimizer.DEFAULT_CLEAR_CONFIDENCE, 0.999);
assert.strictEqual(optimizer.PLUNDER_SHARE, 0.5);
assert.deepStrictEqual(optimizer.normalizeRatios({Atlas:100, Artemis:2}), {Artemis:1},
  'transport ships cannot be included in attacking fleet ratios');

assert.deepStrictEqual(
  optimizer.plunderPool({resources:{ore:400_000, crystal:140_000, hydrogen:100_000}}),
  {ore:200_000, crystal:70_000, hydrogen:50_000}
);
const plunderPool = optimizer.plunderPool({resources:{ore:101, crystal:50, hydrogen:25}});
assert.deepStrictEqual(plunderPool, {ore:50, crystal:25, hydrogen:12},
  'cargo pool is half of each visible resource amount, rounded down to whole resources');
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
});
assert.deepStrictEqual(result.recommendations.map(item => item.roundLimit), [3, 4, 5, 6]);
for (const recommendation of result.recommendations) {
  assert.strictEqual(recommendation.scale, 1);
  assert.strictEqual(recommendation.winRound, 1);
  assert(recommendation.estimatedWinProbability >= 0.95);
  near(recommendation.estimatedLosses.Athena, 0);
  const options = Object.fromEntries(recommendation.cargo.map(item => [item.type, item]));
  assert.strictEqual(options.Carmanor.additional, 2);
  assert.strictEqual(recommendation.cargoRequired, 225_000);
  assert.strictEqual(recommendation.cargo.length, 1, 'default output should size only Carmanor transports');
  for (const option of Object.values(options)) {
    assert(option.fullyLoaded, `${option.type} should provide full expected cargo capacity`);
    assert(option.win, `${option.type} should preserve the selected round-limit result`);
    assert(option.capacity >= recommendation.cargoRequired);
    assert.strictEqual(option.fleet.Athena, 1, 'cargo sizing keeps the original attacking fleet fixed');
  }
}

const atlasSelection = optimizer.analyze({
  ratios:{Athena:1},
  defenders:{'Laser Cannon':1},
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0},
  confidence:0.95,
  transportType:'Atlas',
  resources:{ore:150_000, crystal:150_000, hydrogen:150_000},
});
assert.strictEqual(atlasSelection.transportType, 'Atlas');
assert(atlasSelection.recommendations.every(item => item.cargo.length === 1 && item.cargo[0].type === 'Atlas'),
  'the selected transport type should be the only cargo option in the results');
assert(atlasSelection.recommendations.every(item => item.cargo[0].additional === 45),
  'transport cargo requirements should use the selected Atlas capacity');

const attackerCargo = optimizer.analyze({
  ratios:{Artemis:1},
  defenders:{},
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0},
  resources:{ore:80, crystal:0, hydrogen:0}
});
assert.strictEqual(attackerCargo.confidence, optimizer.DEFAULT_CLEAR_CONFIDENCE,
  'the default fleet target should be 99.9% clear confidence');
assert(attackerCargo.recommendations.every(item => item.cargo[0].additional === 0),
  'surviving attacking ships should cover a plunder pool that fits their own cargo holds');
assert(attackerCargo.recommendations.every(item => item.cargo[0].capacity === combat.cargoCapacity('Artemis')),
  'cargo availability should include surviving attacking ships');

const waveTwo = optimizer.simulateWaveTwo({
  defenders:{Artemis:8, 'Laser Cannon':4, 'Pulse Cannon':2},
  attackerTech:{weapons:18, shield:18, armor:18},
  defenderTech:{weapons:18, shield:18, armor:18},
  confidence:0.95,
  resources:{ore:1_000, crystal:800, hydrogen:400}
}, {
  roundLimit:5,
  fleet:{Athena:4},
  totalShips:4,
  buildCost:optimizer.costOfFleet({Athena:4}),
  cargo:[{
    type:'Atlas', additional:3, cargoPerShip:combat.cargoCapacity('Atlas'),
    fleet:{Athena:4, Atlas:3}, cargoTaken:{ore:200, crystal:100, hydrogen:100}
  }]
});
assert.deepStrictEqual(waveTwo.simulation.initialDefenders, {'Laser Cannon':3, 'Pulse Cannon':2},
  'Wave 2 clears defender ships and rounds each remaining defense up from its 70% value');
assert.deepStrictEqual(waveTwo.simulation.initialAttackers, {Athena:4, Atlas:3},
  'Wave 2 reuses the complete first-wave fleet, including the selected transports');
assert.deepStrictEqual(waveTwo.cargoPool, {ore:400, crystal:350, hydrogen:150},
  'Wave 2 plunder is half of each resource amount remaining after Wave 1 loot');
assert.strictEqual(waveTwo.cargo[0].additional, 3);
assert(waveTwo.estimatedLosses && Object.keys(waveTwo.estimatedLosses).length,
  'Wave 2 reports losses from its own battle simulation');

const ineffective = optimizer.analyze({
  ratios:{Artemis:1},
  defenders:{'Large Decoy':1},
  attackerTech:{weapons:0},
  defenderTech:{weapons:0, shield:15, armor:0},
  confidence:0.95,
  resources:{ore:0, crystal:0, hydrogen:0}
});
assert.deepStrictEqual(ineffective.ineffectiveTargets, ['Large Decoy'],
  'equal weapon damage and 1% shield threshold is ineffective');
assert(ineffective.recommendations.every(item => item.unavailable && item.reason === 'ineffective'),
  'an ineffective ratio mix should be identified without a fleet-size search');

const effective = optimizer.analyze({
  ratios:{Prometheus:1},
  defenders:{'Large Decoy':1},
  attackerTech:{weapons:0},
  defenderTech:{weapons:0, shield:15, armor:0},
  confidence:0.95,
  resources:{ore:0, crystal:0, hydrogen:0}
});
assert.deepStrictEqual(effective.ineffectiveTargets, [],
  'a mix with a weapon above the 1% shield threshold can break through');

const largeFleet = optimizer.analyze({
  ratios:{Prometheus:1},
  defenders:{'Laser Cannon':2_000_000_000_000_000_000},
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0},
  confidence:0.95,
  resources:{ore:0, crystal:0, hydrogen:0}
});
assert(largeFleet.recommendations.every(item => !item.unavailable && item.scale > Number.MAX_SAFE_INTEGER),
  'logarithmic fleet search should find solutions beyond the previous 1T cap and safe-integer range');
assert(largeFleet.recommendations.every(item => item.estimatedWinProbability >= 0.95),
  'large-fleet recommendations should still satisfy the clear-confidence threshold');

console.log('SFC2 optimizer tests passed');
