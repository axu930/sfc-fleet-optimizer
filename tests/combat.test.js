'use strict';

const assert = require('assert');
const combat = require('../js/combat.js');
const optimizer = require('../js/optimizer.js');
const units = require('../js/units.js');

function near(actual, expected, epsilon=1e-9) {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

const config = {
  composition:{Hades:1e7, Athena:5e6, Prometheus:1e6, 'Gauss Cannon':2e7, 'Plasma Cannon':2e6},
  attackerTech:{weapons:20, shield:20, armor:20},
  defenderTech:{weapons:20, shield:20, armor:20},
  survivalTarget:.999,
  rfSigma:0
};

// Locks down pre-refactor behavior for a mixed ship/defense fixture.
const representative = combat.simulate({...config, zeusCount:5e5});
near(representative.zeusSurvival, 0.9999999986994975, 1e-12);
near(representative.dspDestroyedFraction, 0.7747700191663955, 1e-12);
near(representative.threatDestroyedFraction, 0.7747700191663954, 1e-12);
near(representative.initialDefenseRSP, 1_000_000_000);
near(representative.remainingTargets, 8558739.271676973, 1e-6);
assert.strictEqual(representative.roundDetails.length, combat.MAX_ROUNDS);
near(combat.netPoints(representative), representative.destroyedDSP +
  (representative.debrisGenerated - representative.zeusLosses * units.ZEUS_COST) / 1000);

const sweep = optimizer.sweep({...config, points:24});
assert.strictEqual(sweep.points.length, 24);
for (const point of sweep.points) {
  assert(point.zeusSurvival >= 0 && point.zeusSurvival <= 1);
  assert(point.dspDestroyedFraction >= 0 && point.dspDestroyedFraction <= 1 + 1e-10);
  assert(point.threatDestroyedFraction >= 0 && point.threatDestroyedFraction <= 1 + 1e-10);
}
for (let index = 1; index < sweep.points.length; index++) {
  assert(sweep.points[index].dspDestroyedFraction + 1e-8 >= sweep.points[index - 1].dspDestroyedFraction,
    'DSP destruction should be monotone in Zeus count for fixture');
  assert(sweep.points[index].zeusSurvival + 1e-8 >= sweep.points[index - 1].zeusSurvival,
    'Zeus survival should be monotone in Zeus count for fixture');
}

const breakpoint = optimizer.breakpointTable(config, [.5], .999, sweep.range)[0].result;
assert(breakpoint, '50% breakpoint should be reachable');
assert(breakpoint.dspDestroyedFraction >= .5 - 1e-7);
assert(breakpoint.zeusSurvival >= .999 - 1e-7);

const dspOnlyBreakpoint = optimizer.findBreakpoint(config, .90, 0, sweep.range.lo, sweep.range.hi);
assert(dspOnlyBreakpoint, 'DSP-only breakpoint should be reachable without a survival filter');
assert(dspOnlyBreakpoint.dspDestroyedFraction >= .90 - 1e-7);

const survivalBreakpoint = optimizer.findBreakpoint(config, 0, .995, sweep.range.lo, sweep.range.hi);
assert(survivalBreakpoint, 'survival breakpoint should be reachable without a DSP filter');
assert(survivalBreakpoint.zeusSurvival >= .995 - 1e-7);

for (const target of [.90, .95, .99]) {
  const candidate = optimizer.findBreakpoint({...config, rfSigma:2}, target, .999, sweep.range.lo, sweep.range.hi);
  assert(candidate, `${target} recommendation should be reachable`);
  const integerCount = Math.ceil(candidate.zeusCount);
  const checked = combat.simulate({...config, rfSigma:2, zeusCount:integerCount});
  assert(checked.zeusSurvival >= .999, `${target} recommendation should preserve 99.9% survival`);
  assert(checked.dspDestroyedFraction >= target, `${target} recommendation should meet DSP target`);
}

const knee = optimizer.findKnee(sweep.points, .999);
assert(knee, 'knee should exist');
assert(knee.zeusSurvival >= .999 - 1e-10);

const harmless = combat.simulate({
  composition:{'Large Decoy':1e6},
  zeusCount:1e5,
  attackerTech:{weapons:20, shield:20, armor:20},
  defenderTech:{weapons:20, shield:20, armor:20}
});
near(harmless.zeusSurvival, 1);
near(harmless.initialDSP, 0);
near(harmless.destroyedDSP, 0);
near(harmless.initialDebrisPotential, 0);
near(harmless.debrisGenerated, 0);
near(harmless.initialThreat, 0);
near(harmless.threatDestroyedFraction, 1);

// Artemis fire (50) is below 1% of a base Zeus shield (500) and must be ignored.
const ineffectiveFire = combat.simulate({
  composition:{Artemis:1e6},
  zeusCount:1e5,
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0}
});
near(ineffectiveFire.zeusSurvival, 1);
near(ineffectiveFire.initialThreat, 0);

const debris = combat.simulate({
  composition:{Artemis:1},
  zeusCount:1,
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0}
});
near(debris.initialDebrisPotential, 1200);
near(debris.initialDebrisOrePotential, 900);
near(debris.initialDebrisCrystalPotential, 300);
near(debris.npcDebrisGenerated, 1200);
near(debris.npcDebrisOreGenerated, 900);
near(debris.npcDebrisCrystalGenerated, 300);
near(debris.zeusDebrisGenerated, 0);
near(debris.debrisGenerated, 1200);
near(debris.debrisOreGenerated, 900);
near(debris.debrisCrystalGenerated, 300);
assert.strictEqual(debris.dionysusRecyclersNeeded, 1);
near(debris.destroyedDSP, 4);

const ownFleetLoss = combat.simulate({
  composition:{Prometheus:1000},
  zeusCount:1,
  attackerTech:{weapons:0, shield:0, armor:0},
  defenderTech:{weapons:0, shield:0, armor:0}
});
near(ownFleetLoss.zeusLosses, 1);
near(ownFleetLoss.initialZeusDebrisPotential, 2.7e6);
near(ownFleetLoss.initialZeusDebrisOrePotential, 1.5e6);
near(ownFleetLoss.initialZeusDebrisCrystalPotential, 1.2e6);
near(ownFleetLoss.initialTotalDebrisPotential, ownFleetLoss.initialDebrisPotential + ownFleetLoss.initialZeusDebrisPotential);
near(ownFleetLoss.zeusDebrisGenerated, 2.7e6);
near(ownFleetLoss.zeusDebrisOreGenerated, 1.5e6);
near(ownFleetLoss.zeusDebrisCrystalGenerated, 1.2e6);
near(ownFleetLoss.debrisGenerated, ownFleetLoss.npcDebrisGenerated + ownFleetLoss.zeusDebrisGenerated);
assert.strictEqual(ownFleetLoss.dionysusRecyclersNeeded, Math.ceil(ownFleetLoss.debrisGenerated / 20_000));
assert.strictEqual(combat.dionysusRecyclersNeeded(20_000), 1);
assert.strictEqual(combat.dionysusRecyclersNeededForCrystal(1, 20_000), 2);
assert.strictEqual(combat.dionysusRecyclersNeededForCrystal(0, 20_000), 1);

const hugeFleet = combat.simulate({
  composition:{Hades:1e18, 'Gauss Cannon':2e18},
  zeusCount:1e17,
  attackerTech:{weapons:20, shield:20, armor:20},
  defenderTech:{weapons:20, shield:20, armor:20}
});
assert(Number.isFinite(hugeFleet.zeusSurvival));
assert(Number.isFinite(hugeFleet.dspDestroyedFraction));
assert(Number.isFinite(hugeFleet.remainingTargets));

console.log('combat and optimizer tests passed');
