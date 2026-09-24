'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const units = require('../js/units.js');
const allocation = require('../js/fleet-allocation.js');

const allocationPage = fs.readFileSync(path.join(__dirname, '../tools/fleet-allocation/index.html'), 'utf8');
assert.match(allocationPage, /id="conservativeEstimates" type="checkbox" checked/);
assert.match(allocationPage, /id="objectiveX"[\s\S]*?<option value="dsp" selected>/);
assert.match(allocationPage, /id="objectiveY"[\s\S]*?<option value="" selected>None — optimize Objective X only<\/option>/);
assert.match(allocationPage, /<option value="zeusLosses">Expected Zeus lost \(minimize\)<\/option>/);
assert.match(allocationPage, /id="frontierPointDetails"[\s\S]*?id="allocationFrontierChart"/);
assert.match(fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8'), /\.allocation-mix\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);

assert.deepStrictEqual(allocation.parseLocation('[8:115:3]'), {galaxy:8, system:115, planet:3, normalized:'[8:115:3]'});
assert.deepStrictEqual(allocation.parseLocation('[ 001 : 500 : 15 ]'), {galaxy:1, system:500, planet:15, normalized:'[1:500:15]'});
for (const location of ['[0:1:1]', '[101:1:1]', '[1:0:1]', '[1:501:1]', '[1:1:0]', '[1:1:16]', '8:115:3']) {
  assert.strictEqual(allocation.parseLocation(location), null, location);
}

assert.strictEqual(allocation.expectedLossLimit(1_000_000, undefined), 1_000);
assert.strictEqual(allocation.expectedLossLimit(1_000_000, 0.25), 2_500);
assert.strictEqual(allocation.expectedLossLimit(1_000_000, 200), 1_000_000);
assert.deepStrictEqual(allocation.summarizeFleet({
  Artemis:12,
  Athena:3,
  'Missile Battery':4,
  'Large Decoy':2,
  Unsupported:100
}), {ships:15, defenses:6, dsp:228, invalidShips:false, invalidDefenses:false});
assert.deepStrictEqual(allocation.summarizeFleet({Artemis:NaN, 'Missile Battery':-1}), {
  ships:0, defenses:0, dsp:0, invalidShips:true, invalidDefenses:true
});
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
const sevenZeusOutcome = allocation.evaluateTarget(refinementTarget, 7, refinementConfig);
const topOffOptions = allocation.targetOptions(refinementTarget, refinementConfig);
const toppedOffState = allocation.refineUnusedZeus({
  zeus:7,
  losses:sevenZeusOutcome.zeusLosses,
  value:sevenZeusOutcome.objectiveValue,
  choices:[sevenZeusOutcome]
}, [refinementTarget], [topOffOptions], refinementConfig);
assert(toppedOffState.zeus > 7);
assert(toppedOffState.value > sevenZeusOutcome.objectiveValue);
assert(toppedOffState.losses <= sevenZeusOutcome.zeusLosses);
assert(toppedOffState.choices.every(option => option.zeusCount === 0
  || option.zeusSurvival >= allocation.MIN_ATTACK_SURVIVAL - 1e-12));

const dspOptions = allocation.targetOptions(refinementTarget, refinementConfig);
for (const threshold of allocation.REFINEMENT_TARGETS.dspDestroyed) {
  const crossing = dspOptions.find(option => option.dspDestroyedFraction >= threshold
    && (option.zeusCount === 1 || allocation.evaluateTarget(refinementTarget, option.zeusCount - 1, refinementConfig).dspDestroyedFraction < threshold));
  assert(crossing, `DSP refinement should include the first Zeus count reaching ${threshold * 100}% destruction`);
}
const survivalQualified90Options = allocation.targetOptions(refinementTarget, {
  ...refinementConfig,
  objectiveKeys:['dsp'],
  rfSigma:2
});
const survivalQualified90 = survivalQualified90Options.find(option => option.dspDestroyedFraction >= 0.9
  && option.zeusSurvival >= 0.999);
assert(survivalQualified90, 'target options should expose an attack reaching 90% DSP destruction with at least 99.9% Zeus survival');
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
assert.strictEqual(plan.rfSigma, 0);
const conservativePlan = allocation.solve({
  ...targetConfig,
  rfSigma:2,
  targets:[reportTarget]
});
assert.strictEqual(conservativePlan.rfSigma, 2);

const frontierTargets = [
  {
    id:20,
    location:'[2:10:1]',
    composition:{Athena:100_000},
    defenderTech:{weapons:0, shield:0, armor:0},
    resources:{ore:0, crystal:0, hydrogen:0}
  },
  {
    id:21,
    location:'[2:10:2]',
    composition:{Artemis:1},
    defenderTech:{weapons:0, shield:0, armor:0},
    resources:{ore:0, crystal:0, hydrogen:10_000_000}
  }
];
const frontierConfig = {
  availableZeus:20,
  maxExpectedLosses:20,
  attackerTech:{weapons:20, shield:20, armor:20},
  defaultDefenderTech:{weapons:0, shield:0, armor:0},
  objectives:['dsp', 'hydrogen']
};
const frontier = allocation.solveFrontier({...frontierConfig, targets:frontierTargets});
assert.deepStrictEqual(frontier.objectiveKeys, ['dsp', 'hydrogen']);
assert.strictEqual(frontier.rfSigma, 0);
assert(frontier.points.length >= 2, 'the two objectives should create a genuine trade-off for this fixture');
assert.strictEqual(frontier.searchTruncated, false);
for (const point of frontier.points) {
  assert(point.zeusCommitted <= frontier.availableZeus);
  assert(point.expectedZeusLosses <= frontier.maxExpectedLosses + 1e-9);
  assert.strictEqual(point.allocations.length, frontierTargets.length);
  assert(point.allocations.every(({outcome:attack}) => attack.zeusCount === 0
    || attack.zeusSurvival >= allocation.MIN_ATTACK_SURVIVAL - 1e-12));
  for (const objective of frontier.objectiveKeys) {
    const summed = point.allocations.reduce((sum, attack) => sum + attack.outcome.objectiveValues[objective], 0);
    assert(Math.abs(point.objectiveValues[objective] - summed) <= 1e-8 * Math.max(1, summed));
  }
}
for (let leftIndex = 0; leftIndex < frontier.points.length; leftIndex++) {
  for (let rightIndex = 0; rightIndex < frontier.points.length; rightIndex++) {
    if (leftIndex === rightIndex) continue;
    const left = frontier.points[leftIndex].objectiveValues;
    const right = frontier.points[rightIndex].objectiveValues;
    assert(!(left.dsp >= right.dsp && left.hydrogen >= right.hydrogen
      && (left.dsp > right.dsp || left.hydrogen > right.hydrogen)), 'reported frontier points must be non-dominated');
  }
}
const exhaustivePairs = [];
for (let firstCount = 0; firstCount <= frontierConfig.availableZeus; firstCount++) {
  for (let secondCount = 0; secondCount <= frontierConfig.availableZeus - firstCount; secondCount++) {
    const outcomes = frontierTargets.map((target, index) => allocation.evaluateTarget(
      target,
      index === 0 ? firstCount : secondCount,
      {...frontierConfig, objective:'dsp'}
    ));
    if (outcomes.some(outcome => outcome.zeusCount > 0 && outcome.zeusSurvival < allocation.MIN_ATTACK_SURVIVAL - 1e-12)) continue;
    const losses = outcomes.reduce((sum, outcome) => sum + outcome.zeusLosses, 0);
    if (losses > frontierConfig.maxExpectedLosses + 1e-9) continue;
    exhaustivePairs.push({
      dsp:outcomes.reduce((sum, outcome) => sum + outcome.objectiveValues.dsp, 0),
      hydrogen:outcomes.reduce((sum, outcome) => sum + outcome.objectiveValues.hydrogen, 0)
    });
  }
}
const exhaustiveFrontier = exhaustivePairs.filter(candidate => !exhaustivePairs.some(other =>
  other.dsp >= candidate.dsp && other.hydrogen >= candidate.hydrogen
  && (other.dsp > candidate.dsp || other.hydrogen > candidate.hydrogen)
)).filter((candidate, index, all) => all.findIndex(other =>
  Math.abs(other.dsp - candidate.dsp) < 1e-8 && Math.abs(other.hydrogen - candidate.hydrogen) < 1e-8
) === index);
assert.strictEqual(frontier.points.length, exhaustiveFrontier.length);
for (const expected of exhaustiveFrontier) {
  assert(frontier.points.some(point => Math.abs(point.objectiveValues.dsp - expected.dsp) < 1e-8
    && Math.abs(point.objectiveValues.hydrogen - expected.hydrogen) < 1e-8), 'frontier should match exhaustive small-budget enumeration');
}
assert.deepStrictEqual(allocation.solveFrontier({...frontierConfig, targets:frontierTargets}).objectiveKeys, ['dsp', 'hydrogen']);
const conservativeFrontier = allocation.solveFrontier({...frontierConfig, rfSigma:2, targets:frontierTargets});
assert.strictEqual(conservativeFrontier.rfSigma, 2);
assert(conservativeFrontier.points.length > 0);
assert.throws(() => allocation.solveFrontier({...frontierConfig, objectives:['dsp', 'dsp'], targets:frontierTargets}), /two different supported objectives/);
assert.throws(() => allocation.solveFrontier({...frontierConfig, objectives:['zeusLosses', 'dsp'], targets:frontierTargets}), /Objective X must be maximized/);

const zeusLossTarget = {
  id:22,
  location:'[2:10:3]',
  composition:{Zeus:1_000_000_000},
  defenderTech:{weapons:200, shield:0, armor:0},
  resources:{ore:0, crystal:0, hydrogen:0}
};
const lossFrontier = allocation.solveFrontier({
  availableZeus:10_000_000_000_000,
  maxExpectedLosses:1_000_000_000,
  attackerTech:{weapons:200, shield:20, armor:20},
  defaultDefenderTech:{weapons:200, shield:0, armor:0},
  objectives:['dsp', 'zeusLosses'],
  targets:[zeusLossTarget]
});
assert(lossFrontier.points.length >= 2, 'DSP and expected Zeus lost should expose a trade-off');
assert.strictEqual(allocation.OBJECTIVES.zeusLosses.direction, 'minimize');
for (const point of lossFrontier.points) {
  const summedLosses = point.allocations.reduce((sum, attack) => sum + attack.outcome.objectiveValues.zeusLosses, 0);
  assert(Math.abs(point.objectiveValues.zeusLosses - summedLosses) < 1e-6);
  assert(Math.abs(point.objectiveScores.zeusLosses + summedLosses) < 1e-6);
}
assert(lossFrontier.points[0].objectiveValues.zeusLosses < lossFrontier.points.at(-1).objectiveValues.zeusLosses,
  'frontier points should retain the lower-loss allocation as the better secondary-objective end');

console.log('fleet allocation tests passed');
