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
assert.strictEqual(allocation.survivalForComparison(0.999989), 0.999989);
assert.strictEqual(allocation.survivalForComparison(0.99999), 1);
assert.strictEqual(allocation.survivalForComparison(1), 1);
assert.deepStrictEqual(allocation.REFINEMENT_TARGETS.dspDestroyed, [0.5, 0.9, 0.95, 0.99, 0.999]);
assert.deepStrictEqual(allocation.REFINEMENT_TARGETS.winProbability, [0.9, 0.95, 0.99, 0.999]);
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

const refinementTarget = {
  id:9,
  location:'[1:1:1]',
  composition:{Artemis:10_000},
  defenderTech:{weapons:0, shield:0, armor:0},
  resources:{ore:1_000_000, crystal:1_000_000, hydrogen:1_000_000}
};
const refinementConfig = {
  ...targetConfig,
  availableZeus:1_000,
  maxExpectedLosses:1_000
};
assert.strictEqual(allocation.MIN_ATTACK_SURVIVAL, 0.999);
const highRiskTarget = {
  ...refinementTarget,
  id:12,
  composition:{Athena:100},
  defenderTech:{weapons:100, shield:0, armor:0}
};
const highRiskConfig = {
  ...refinementConfig,
  availableZeus:100,
  maxExpectedLosses:100,
  defaultDefenderTech:{weapons:100, shield:0, armor:0}
};
const safeAttackOptions = allocation.targetOptions(highRiskTarget, highRiskConfig);
assert(safeAttackOptions.some(option => option.zeusCount === 0));
assert(safeAttackOptions.some(option => option.zeusCount > 0));
assert(safeAttackOptions.every(option => option.zeusCount === 0
  || option.zeusSurvival >= allocation.MIN_ATTACK_SURVIVAL - 1e-12));
const firstSafeAttack = safeAttackOptions.filter(option => option.zeusCount > 0)
  .sort((left, right) => left.zeusCount - right.zeusCount)[0];
assert(allocation.evaluateTarget(highRiskTarget, firstSafeAttack.zeusCount - 1, highRiskConfig).zeusSurvival
  < allocation.MIN_ATTACK_SURVIVAL);

const dspOptions = allocation.targetOptions(refinementTarget, refinementConfig);
for (const threshold of allocation.REFINEMENT_TARGETS.dspDestroyed) {
  const crossing = dspOptions.find(option => option.dspDestroyedFraction >= threshold
    && (option.zeusCount === 1 || allocation.evaluateTarget(refinementTarget, option.zeusCount - 1, refinementConfig).dspDestroyedFraction < threshold));
  assert(crossing, `DSP refinement should include the first Zeus count reaching ${threshold * 100}% destruction`);
}
const raidConfig = {...refinementConfig, objective:'hydrogen'};
const raidOptions = allocation.targetOptions(refinementTarget, raidConfig);
for (const threshold of allocation.REFINEMENT_TARGETS.winProbability) {
  const crossing = raidOptions.find(option => option.winProbability >= threshold
    && (option.zeusCount === 1 || allocation.evaluateTarget(refinementTarget, option.zeusCount - 1, raidConfig).winProbability < threshold));
  assert(crossing, `Raid refinement should include the first Zeus count reaching ${threshold * 100}% win probability`);
}

const smallTargets = [
  {...refinementTarget, id:10, location:'[1:1:2]', composition:{Artemis:1_000, Athena:100}, defenderTech:{weapons:100, shield:0, armor:0}},
  {...refinementTarget, id:11, location:'[1:1:3]', composition:{Athena:100, Poseidon:50}, defenderTech:{weapons:200, shield:0, armor:0}}
];
const smallConfig = {...targetConfig, availableZeus:10, maxExpectedLosses:2};
const optimizedSmallPlan = allocation.solve({...smallConfig, targets:smallTargets});
let exhaustiveBestValue = 0;
for (let firstCount = 0; firstCount <= smallConfig.availableZeus; firstCount++) {
  for (let secondCount = 0; secondCount <= smallConfig.availableZeus - firstCount; secondCount++) {
    const firstOutcome = allocation.evaluateTarget(smallTargets[0], firstCount, smallConfig);
    const secondOutcome = allocation.evaluateTarget(smallTargets[1], secondCount, smallConfig);
    if ((firstCount > 0 && firstOutcome.zeusSurvival < allocation.MIN_ATTACK_SURVIVAL - 1e-12)
      || (secondCount > 0 && secondOutcome.zeusSurvival < allocation.MIN_ATTACK_SURVIVAL - 1e-12)) continue;
    if (firstOutcome.zeusLosses + secondOutcome.zeusLosses > smallConfig.maxExpectedLosses + 1e-9) continue;
    exhaustiveBestValue = Math.max(exhaustiveBestValue, firstOutcome.objectiveValue + secondOutcome.objectiveValue);
  }
}
assert(Math.abs(optimizedSmallPlan.totalObjectiveValue - exhaustiveBestValue) < 1e-8);
assert(optimizedSmallPlan.expectedZeusLosses <= smallConfig.maxExpectedLosses + 1e-9);
assert(optimizedSmallPlan.allocations.every(({outcome:attack}) => attack.zeusCount === 0
  || attack.zeusSurvival >= allocation.MIN_ATTACK_SURVIVAL - 1e-12));
assert.strictEqual(optimizedSmallPlan.searchTruncated, false);

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
assert(plan.allocations.every(({outcome:attack}) => attack.zeusCount === 0
  || attack.zeusSurvival >= allocation.MIN_ATTACK_SURVIVAL - 1e-12));
assert.strictEqual(plan.allocations.length, 1);
assert.strictEqual(plan.objective, 'dsp');

console.log('fleet allocation tests passed');
