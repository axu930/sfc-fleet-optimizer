'use strict';

const assert = require('assert');
const parser = require('../js/battle-report-parser.js');

function near(actual, expected, epsilon=1e-9) {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

near(parser.parseCount('2.5M'), 2.5e6);
near(parser.parseCount('10Qi'), 1e19);
near(parser.parseCount('3e12'), 3e12);
near(parser.parseCount('1 quadrillion'), 1e15);
assert(Number.isNaN(parser.parseCount('-1')));
assert(Number.isNaN(parser.parseCount('12ZZ')));

const roster = parser.parseRoster(`Athena Class Battleship 50M
10M Hades
Gauss Cannon = 2M
Hades: 5M
not a unit: 5`);
assert.strictEqual(roster.composition.Athena, 50e6);
assert.strictEqual(roster.composition.Hades, 15e6);
assert.strictEqual(roster.composition['Gauss Cannon'], 2e6);
assert.strictEqual(roster.unknown.length, 1);

const battleReport = parser.parseBattleReport(`Combat Report
Attacker Alex [1:2:3]
Weapons: 20 Shield: 19 Armor: 18
Zeus Class 1,000,000

Defender NPC
Weapons: 12 Shield: 13 Armor: 14
Athena Class Battleship 50,000
Hades Class Battleship 20,000
Gauss Cannon 100,000
Large Decoy 1
Round 1
Attacker
Zeus 900,000`);
assert.strictEqual(battleReport.attacker.composition.Zeus, 1e6);
assert.deepStrictEqual(battleReport.attacker.tech, {weapons:20, shield:19, armor:18});
assert.strictEqual(battleReport.defender.composition.Athena, 50000);
assert.strictEqual(battleReport.defender.composition.Hades, 20000);
assert.strictEqual(battleReport.defender.composition['Gauss Cannon'], 100000);
assert.strictEqual(battleReport.defender.composition['Large Decoy'], 1);
assert.strictEqual(battleReport.defender.tech.weapons, 12);
assert.strictEqual(battleReport.defender.stoppedAtRound, true);

const copiedTable = parser.parseBattleReport(`Attacker
Weapons Shield Armor
20 20 20
Zeus Artemis Hades
1,000 2,000 3,000
Defender
Weapons Shield Armor
12 13 14
Athena Hades Gauss Cannon Plasma Cannon Large Decoy
50M 20M 100M 2M 1`);
assert.deepStrictEqual(copiedTable.attacker.tech, {weapons:20, shield:20, armor:20});
assert.strictEqual(copiedTable.attacker.composition.Zeus, 1000);
assert.strictEqual(copiedTable.attacker.composition.Artemis, 2000);
assert.strictEqual(copiedTable.attacker.composition.Hades, 3000);
assert.strictEqual(copiedTable.defender.composition.Athena, 50e6);
assert.strictEqual(copiedTable.defender.composition.Hades, 20e6);
assert.strictEqual(copiedTable.defender.composition['Gauss Cannon'], 100e6);
assert.strictEqual(copiedTable.defender.composition['Plasma Cannon'], 2e6);
assert.strictEqual(copiedTable.defender.composition['Large Decoy'], 1);
assert.deepStrictEqual(copiedTable.defender.tech, {weapons:12, shield:13, armor:14});

const noMarkers = parser.parseBattleReport(`Athena
Hades
50,000
20,000`);
assert(noMarkers.unassigned);
assert.strictEqual(noMarkers.unassigned.composition.Athena, 50000);
assert.strictEqual(noMarkers.unassigned.composition.Hades, 20000);

// A later side snapshot must never replace or add to the initial fleet.
const repeatedSnapshots = parser.parseBattleReport(`Attacker
Zeus 1,000
Defender
Athena 500
Round 1
Attacker
Zeus 900
Defender
Athena 400`);
assert.strictEqual(repeatedSnapshots.attacker.composition.Zeus, 1000);
assert.strictEqual(repeatedSnapshots.defender.composition.Athena, 500);

console.log('parser tests passed');
