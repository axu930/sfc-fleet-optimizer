'use strict';

const assert = require('assert');
const units = require('../js/units.js');
const analyzer = require('../js/rapid-fire-analyzer.js');

function near(actual, expected, epsilon=1e-12) {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

assert.deepStrictEqual(analyzer.ATTACKERS, [
  'Artemis', 'Apollo', 'Poseidon', 'Athena', 'Ares', 'Hades', 'Prometheus', 'Zeus'
]);
assert(!analyzer.TARGETS.includes('Hephaestus'), 'Hephaestus is not a supported composition target');
assert.strictEqual(analyzer.rating('Hades', 'Athena'), 7);
assert.strictEqual(analyzer.rating('Poseidon', 'Artemis'), 6);
assert.strictEqual(analyzer.rating('Ares', 'Laser Cannon'), 20);
assert.strictEqual(analyzer.rating('Ares', 'Plasma Cannon'), 1);
assert.strictEqual(analyzer.rating('Zeus', 'Hermes Probe'), units.UNITS['Hermes Probe'].zeusRF);
assert.strictEqual(analyzer.rating('Zeus', 'Plasma Cannon'), 1);
assert.strictEqual(analyzer.rating('Hades', 'Large Decoy'), 1);

near(analyzer.expectedShots('Hades', {Athena:1}).totalShots, 7);
near(analyzer.expectedShots('Hades', {Athena:1}).bonusShots, 6);
near(analyzer.expectedShots('Ares', {'Laser Cannon':1}).totalShots, 20);
near(analyzer.expectedShots('Ares', {'Plasma Cannon':1}).totalShots, 1);

const mixed = analyzer.expectedShots('Ares', {'Laser Cannon':3, 'Plasma Cannon':1});
near(mixed.totalShots, 1 / (1 - 0.75 * (19 / 20)));
near(mixed.bonusShots, mixed.totalShots - 1);
near(analyzer.expectedShots('Ares', {'Laser Cannon':30, 'Plasma Cannon':10}).totalShots, mixed.totalShots);
near(analyzer.expectedShots('Ares', {'Laser Cannon':1e300, 'Plasma Cannon':1e300}).totalShots,
  analyzer.expectedShots('Ares', {'Laser Cannon':1, 'Plasma Cannon':1}).totalShots);
assert.throws(() => analyzer.normalizeRatio({}), /positive ratio/);
assert.throws(() => analyzer.normalizeRatio({'Laser Cannon':0}), /positive ratio/);
assert.throws(() => analyzer.normalizeRatio({'Laser Cannon':-1}), /nonnegative/);
assert.throws(() => analyzer.normalizeRatio({NotAUnit:1}), /Unknown target/);
assert.throws(() => analyzer.normalizeRatio({Hephaestus:1}), /Unknown target/);

const memoryStorage = {
  value:null,
  getItem(key) { return key === analyzer.STORAGE_KEY ? this.value : null; },
  setItem(key, value) { if (key === analyzer.STORAGE_KEY) this.value = value; }
};
const savedScenarios = [
  {id:'composition-a', name:'Laser wall', ratio:{'Laser Cannon':3, 'Plasma Cannon':1}},
  {id:'composition-b', name:'Zeus guard', ratio:{Zeus:1}}
];
analyzer.saveScenarios(savedScenarios, memoryStorage);
assert.deepStrictEqual(analyzer.loadScenarios(memoryStorage), savedScenarios);
memoryStorage.value = JSON.stringify([
  {id:'legacy-mixed', name:'Old mixed ratio', ratio:{'Laser Cannon':3, 'Plasma Cannon':1, Hephaestus:4}},
  {id:'legacy-heph-only', name:'Old Hephaestus ratio', ratio:{Hephaestus:1}}
]);
const migratedScenarios = analyzer.loadScenarios(memoryStorage);
assert.deepStrictEqual(migratedScenarios[0].ratio, {'Laser Cannon':0.75, 'Plasma Cannon':0.25});
assert.deepStrictEqual(migratedScenarios[1].ratio, {});
assert.throws(() => analyzer.expectedShots('Ares', migratedScenarios[1].ratio), /positive ratio/);
analyzer.saveScenarios(migratedScenarios, memoryStorage);
assert(JSON.parse(memoryStorage.value).every(scenario => !Object.hasOwn(scenario.ratio, 'Hephaestus')),
  'migrated composition ratios persist without Hephaestus');
assert.deepStrictEqual(analyzer.loadScenarios(memoryStorage), migratedScenarios);
memoryStorage.value = '{invalid json';
assert.deepStrictEqual(analyzer.loadScenarios(memoryStorage), []);
memoryStorage.value = JSON.stringify([{id:'same', name:'A', ratio:{'Laser Cannon':1}}, {id:'same', name:'B', ratio:{Unknown:2, Artemis:-1}}]);
const sanitizedScenarios = analyzer.loadScenarios(memoryStorage);
assert.strictEqual(sanitizedScenarios.length, 2);
assert.notStrictEqual(sanitizedScenarios[0].id, sanitizedScenarios[1].id);
assert.deepStrictEqual(sanitizedScenarios[1].ratio, {});
assert.throws(() => analyzer.saveScenarios({}, memoryStorage), /array/);
assert.throws(() => analyzer.saveScenarios([], null), /storage is unavailable/);

console.log('rapid-fire analyzer tests passed');
