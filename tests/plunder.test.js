'use strict';

const assert = require('assert');
const plunder = require('../js/plunder.js');

assert.strictEqual(plunder.CARMANOR_CARGO, 125_000);
assert.strictEqual(plunder.expectedWinProbability({zeusCount:10, zeusLosses:0, defenders:{}}), 1);
assert(plunder.expectedWinProbability({zeusCount:10, zeusLosses:0, defenders:{Artemis:1}}) > 0.36);
assert(plunder.expectedWinProbability({zeusCount:10, zeusLosses:0, defenders:{Artemis:30}}) < 1e-10);
assert.strictEqual(plunder.hasDefenses({Artemis:1, 'Missile Battery':1}), true);
assert.strictEqual(plunder.hasDefenses({Artemis:1}), false);

const waves = plunder.plunderWaves({ore:800_000, crystal:400_000, hydrogen:80_000}, true, true);
assert.deepStrictEqual(waves.map(wave => wave.share), [0.5, 0.25, 0.125]);
assert.deepStrictEqual(waves.map(wave => wave.total), [640_000, 320_000, 160_000]);
assert.deepStrictEqual(waves.map(wave => wave.carmanors), [6, 3, 2]);
assert.deepStrictEqual(plunder.plunderWaves({ore:800, crystal:400, hydrogen:80}, true, false).map(wave => wave.share), [0.5]);
assert.deepStrictEqual(plunder.plunderWaves({ore:800}, false, true), []);

const expected = plunder.expectedPlunder({ore:800, crystal:400, hydrogen:80}, 0.25, true);
assert.strictEqual(expected.resources.ore, 175);
assert.strictEqual(expected.resources.crystal, 87.5);
assert.strictEqual(expected.resources.hydrogen, 17.5);

console.log('plunder tests passed');
