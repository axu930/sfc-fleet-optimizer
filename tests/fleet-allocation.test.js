'use strict';

const assert = require('assert');
const units = require('../js/units.js');
const allocation = require('../js/fleet-allocation.js');

assert.deepStrictEqual(allocation.parseLocation('[8:115:3]'), {galaxy:8, system:115, planet:3, normalized:'[8:115:3]'});
assert.deepStrictEqual(allocation.parseLocation('[ 001 : 500 : 15 ]'), {galaxy:1, system:500, planet:15, normalized:'[1:500:15]'});
for (const location of ['[0:1:1]', '[101:1:1]', '[1:0:1]', '[1:501:1]', '[1:1:0]', '[1:1:16]', '8:115:3']) {
  assert.strictEqual(allocation.parseLocation(location), null, location);
}

assert.strictEqual(allocation.expectedLossLimit(1_000_000, undefined), 1_000);
assert.strictEqual(allocation.expectedLossLimit(1_000_000, 0.25), 2_500);
assert.strictEqual(allocation.expectedLossLimit(1_000_000, 200), 1_000_000);
assert(units.UNITS.Carmanor.cargo >= 125_000);

const sampled = allocation.candidateCounts(1_000_000);
assert(sampled.length <= 64);
assert.strictEqual(sampled[0], 1);
assert.strictEqual(sampled[sampled.length - 1], 1_000_000);
assert.deepStrictEqual(allocation.candidateCounts(4), [1, 2, 3, 4]);

const reportTarget = {
  id:1,
  location:'[8:115:3]',
  composition:{Artemis:100_000},
  defenderTech:{weapons:0, shield:0, armor:0},
  resources:{ore:1_000_000, crystal:500_000, hydrogen:2_000_000}
};
const targetConfig = {
  availableZeus:100_000,
  maxExpectedLosses:100,
  objective:'dsp',
  attackerTech:{weapons:20, shield:20, armor:20},
  defaultDefenderTech:{weapons:0, shield:0, armor:0}
};
const outcome = allocation.evaluateTarget(reportTarget, 100, targetConfig);
assert(outcome.dspDestroyed >= 0);
assert(outcome.debrisGenerated >= outcome.debrisOreGenerated);
assert(outcome.debrisGenerated >= outcome.debrisCrystalGenerated);
assert(outcome.zeusLosses >= 0);
assert.strictEqual(outcome.location, '[8:115:3]');

const undefendedTarget = {
  id:2,
  location:'[8:115:4]',
  composition:{Artemis:1},
  defenderTech:{weapons:0, shield:0, armor:0},
  resources:{ore:1_000_000, crystal:500_000, hydrogen:2_000_000}
};
const hydrogenOutcome = allocation.evaluateTarget(undefendedTarget, 1, {
  ...targetConfig,
  objective:'hydrogen'
});
assert.strictEqual(hydrogenOutcome.noDefenses, true);
assert.strictEqual(hydrogenOutcome.waves.length, 3);
assert.strictEqual(hydrogenOutcome.conditionalPlunder.hydrogen, 1_750_000);
assert.strictEqual(hydrogenOutcome.resourcesRaided.hydrogen, 1_750_000);
assert(hydrogenOutcome.waves.every(wave => Number.isInteger(wave.carmanors)));

const defendedTarget = {...undefendedTarget, composition:{'Missile Battery':1}};
const defendedOutcome = allocation.evaluateTarget(defendedTarget, 1, {
  ...targetConfig,
  objective:'hydrogen'
});
assert.strictEqual(defendedOutcome.noDefenses, false);
assert.strictEqual(defendedOutcome.waves.length, 1);
assert.strictEqual(defendedOutcome.conditionalPlunder.hydrogen, 1_000_000);

const plan = allocation.solve({
  ...targetConfig,
  targets:[reportTarget]
});
assert(plan.zeusCommitted <= plan.availableZeus);
assert(plan.expectedZeusLosses <= plan.maxExpectedLosses + 1e-9);
assert.strictEqual(plan.allocations.length, 1);
assert.strictEqual(plan.objective, 'dsp');

console.log('fleet allocation tests passed');
