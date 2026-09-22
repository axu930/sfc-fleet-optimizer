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

const espionageReport = parser.parseBattleReport(`RED II'S SHIPS:

- Hermes Class Probe: 9,223,372,036,854,766,243
- Artemis Class Fighter: 9,223,372,036,854,775,807
- Atlas Class Cargo: 9,223,372,036,854,775,807
- Apollo Class Fighter: 9,223,372,036,854,775,807
- Zagreus Class Recycler: 9,223,372,036,854,775,807
- Charon Class Transport: 9,223,372,036,854,775,807
- Hercules Class Cargo: 9,223,372,036,854,775,807
- Dionysus Class Recycler: 50,000,000,000,000,000,000
- Poseidon Class Cruiser: 9,223,372,036,854,775,807
- Carmanor Class Cargo: 9,223,372,036,854,775,807
- Gaia Class Colony Ship: 9,213,372,036,854,775,807
- Athena Class Battleship: 9,223,170,865,227,418,270
- Ares Class Bomber: 9,223,372,036,854,775,800
- Hades Class Battleship: 9,223,372,023,729,253,158
- Prometheus Class Destroyer: 9,223,372,036,854,775,807
- Zeus Class: 9,223,372,036,853,566,866
- Hephaestus Class Attack Platform: 1

TECHS:

- Laser Tech: 22
- Armor Tech: 26
- Weapons Tech: 26
- Shield Tech: 26
- Particle Tech: 20
- Jet Drive: 26
- A.I. Tech: 25
- Energy Tech: 21
- Espionage Tech: 25
- Pulse Drive: 23
- Plasma Tech: 18
- FTL Tech: 19
- Expedition Tech: 17
- Warp Drive: 22
- Advanced Research Communication Network: 12`);
assert(espionageReport.unassigned);
assert.strictEqual(Object.keys(espionageReport.unassigned.composition).length, 17);
assert.deepStrictEqual(espionageReport.unassigned.tech, {armor:26, weapons:26, shield:26});
for (const falseUnit of ['Laser Cannon','Particle Cannon','Pulse Cannon','Plasma Cannon']) {
  assert.strictEqual(espionageReport.unassigned.composition[falseUnit], undefined);
}
assert.strictEqual(espionageReport.unassigned.composition.Hephaestus, 1);
assert.strictEqual(espionageReport.unassigned.rawCounts.Hermes, undefined);
assert.strictEqual(espionageReport.unassigned.rawCounts['Hermes Probe'], '9,223,372,036,854,766,243');
near(espionageReport.unassigned.composition.Dionysus, 5e19, 1);

console.log('parser tests passed');
