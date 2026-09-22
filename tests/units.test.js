'use strict';

const assert = require('assert');
const units = require('../js/units.js');

const value = 9.45e15;
assert.strictEqual(units.formatCount(value, 'raw'), '9450000000000000');
assert.strictEqual(units.formatCount(value, 'commas'), '9,450,000,000,000,000');
assert.strictEqual(units.formatCount(value, 'scientific'), '9.45e+15');
assert.strictEqual(units.formatCount(value, 'words'), '9.45 quadrillion');
assert.strictEqual(units.formatCount(value, 'abbrev'), '9.45q');

const abbreviations = [
  [1e3, '1k'], [1e6, '1m'], [1e9, '1b'], [1e12, '1t'], [1e15, '1q'],
  [1e18, '1Q'], [1e21, '1s'], [1e24, '1S'], [1e27, '1o'], [1e30, '1n']
];
for (const [number, expected] of abbreviations) {
  assert.strictEqual(units.formatCount(number, 'abbrev'), expected);
}

console.log('unit formatting tests passed');
