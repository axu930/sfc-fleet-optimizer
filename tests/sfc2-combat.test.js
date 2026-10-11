'use strict';

const assert = require('assert');
const combat = require('../js/sfc2-combat.js');

assert(combat.ATTACKER_SHIPS.includes('Artemis'));
assert(combat.ATTACKER_SHIPS.includes('Shadow Probe'));
assert(!combat.ATTACKER_SHIPS.includes('Charon'));
assert(!combat.DEFENDER_SHIPS.includes('Charon'));
assert(!combat.UNITS.Charon, 'ships absent from SFC2 are removed from the active catalog');
assert(!combat.ATTACKER_SHIPS.includes('Hephaestus'));
assert(!combat.DEFENDER_SHIPS.includes('Hephaestus'));
assert(!combat.UNITS.Hephaestus, 'Hephaestus is outside the analyzer scope');
assert(combat.DEFENDER_SHIPS.includes('Helios Class Solar Satellite'));
assert.strictEqual(combat.rapidFireRating('Hades', 'Athena'), 7);
assert.strictEqual(combat.rapidFireRating('Poseidon', 'Artemis'), 6);
assert.strictEqual(combat.rapidFireRating('Ares', 'Laser Cannon'), 20);
assert.strictEqual(combat.rapidFireRating('Artemis', 'Shadow Probe'), 5);
assert.strictEqual(combat.rapidFireRating('Gaia', 'Genesis Solar Satellite'), 5);
assert.strictEqual(combat.rapidFireRating('Laser Cannon', 'Shadow Probe'), 1);
assert.strictEqual(combat.rapidFireRating('Zeus', 'Plasma Cannon'), 1);
assert.strictEqual(combat.rapidFireRating('Zeus', 'Shadow Probe'), 1250);
assert.strictEqual(combat.cargoCapacity('Artemis'), 50);
assert.strictEqual(combat.cargoCapacity('Carmanor'), 125_000);
assert.strictEqual(combat.buildCost('Shadow Probe').credits, 20_000);
assert.strictEqual(combat.buildCost('Helios Class Solar Satellite').hydrogen, 500);
assert.strictEqual(combat.canCarryPlunder('Hermes Probe'), false);

const noDamage = combat.simulate({
  attackers:{Artemis:1_000_000},
  defenders:{'Large Decoy':1_000_000}
});
assert.strictEqual(noDamage.remainingDefenders['Large Decoy'], 1_000_000,
  'Artemis shots at a Large Decoy bounce under the 1% shield rule');
assert.strictEqual(noDamage.roundDetails.length, 6);

const simultaneous = combat.simulate({
  attackers:{Athena:10},
  defenders:{'Laser Cannon':1}
});
assert(simultaneous.roundDetails[0].defenders['Laser Cannon'] < 0.001,
  'the Athena fleet fires during the round the Laser Cannon is effectively destroyed');
assert(Math.abs(simultaneous.roundDetails[0].attackers.Athena - 10) < 1e-8,
  'the Laser Cannon shot is absorbed by the Athena shield');

const repeatedHullDamage = combat.simulate({
  attackers:{Athena:1},
  defenders:{'Gauss Cannon':1}
});
assert(repeatedHullDamage.roundDetails[2].defenders['Gauss Cannon'] < repeatedHullDamage.roundDetails[1].defenders['Gauss Cannon'],
  'hull damage and explosion risk continue to resolve after fractional expected losses');

assert.strictEqual(combat.battleWinProbability({Athena:1}, {Athena:1}, {}, {}), 1);
assert.strictEqual(combat.cargoCapacityForSurvivors({Athena:1, 'Hermes Probe':1}), 1_500);

console.log('SFC2 combat tests passed');
