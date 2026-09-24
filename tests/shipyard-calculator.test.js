'use strict';

const assert = require('assert');
const calculator = require('../js/shipyard-calculator.js');

assert.strictEqual(calculator.parseShipCount('1 septillion'), 10n ** 24n);
assert.strictEqual(calculator.parseShipCount('1Sp'), 10n ** 24n);
assert.strictEqual(calculator.parseShipCount('1,000,000'), 1_000_000n);
assert.strictEqual(calculator.parseShipCount('1.25Sp'), 125n * (10n ** 22n));
assert.strictEqual(calculator.parseShipCount('1e24'), 10n ** 24n);
assert.strictEqual(calculator.parseShipCountWithMagnitude('1', 'septillion'), 10n ** 24n);
assert.strictEqual(calculator.parseShipCountWithMagnitude('1.5', 'million'), 1_500_000n);
assert.strictEqual(calculator.parseShipCountWithMagnitude('1,250', 'thousand'), 1_250_000n);
assert.strictEqual(calculator.parseShipCountWithMagnitude('0.001', 'thousand'), 1n);
assert.strictEqual(calculator.groupDigits(10n ** 24n), '1,000,000,000,000,000,000,000,000');
assert.strictEqual(calculator.formatMagnitude(10n ** 24n), '1 septillion');
assert.throws(() => calculator.parseShipCount('1.1'), /whole number of ships/);
assert.throws(() => calculator.parseShipCount('-1'), /whole build count/);
assert.throws(() => calculator.parseShipCount('1ZZ'), /suffix is not supported/);
assert.throws(() => calculator.parseShipCountWithMagnitude('1m', 'million'), /without a suffix/);
assert.throws(() => calculator.parseShipCountWithMagnitude('1', 'octillion'), /supported count magnitude/);

const oneAthenaAtYardZero = calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:0, foundryLevel:0, assignedDroids:0
});
assert.strictEqual(oneAthenaAtYardZero.oreCrystalPerItem, 60_000n);
assert.strictEqual(oneAthenaAtYardZero.perItemSeconds, 86_400n);
assert.strictEqual(oneAthenaAtYardZero.totalSeconds, 86_400n);

const oneAthenaAtYardOne = calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:1, foundryLevel:0, assignedDroids:0
});
assert.strictEqual(oneAthenaAtYardOne.totalSeconds, 43_200n);

const oneAthenaAtYardTwelve = calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:12, foundryLevel:0, assignedDroids:0
});
assert.strictEqual(oneAthenaAtYardTwelve.totalSeconds, 6_646n);

const oneAthenaAtFoundryOne = calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:0, foundryLevel:1, assignedDroids:0
});
assert.strictEqual(oneAthenaAtFoundryOne.totalSeconds, 43_200n);

const oneAthenaWithDroid = calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:0, foundryLevel:0, assignedDroids:1
});
assert.strictEqual(oneAthenaWithDroid.totalSeconds, 84_706n);
assert.strictEqual(calculator.maxShipyardDroids(0), 1);
assert.strictEqual(calculator.maxShipyardDroids(2), 1);
assert.strictEqual(calculator.maxShipyardDroids(3), 2);
assert.strictEqual(calculator.maxShipyardDroids(6), 3);
assert.throws(() => calculator.calculateBuildTime({
  itemName:'Athena', count:1n, shipyardLevel:0, foundryLevel:0, assignedDroids:2
}), /room for at most 1 Build Droid/);

const septillionCountFromMagnitude = calculator.parseShipCountWithMagnitude('1', 'septillion');
const septillionAthenas = calculator.calculateBuildTime({
  itemName:'Athena', count:septillionCountFromMagnitude, shipyardLevel:0, foundryLevel:0, assignedDroids:0
});
assert.strictEqual(septillionAthenas.countDigits, '1' + '0'.repeat(24));
assert.strictEqual(septillionAthenas.totalSeconds, 86_400n * (10n ** 24n));
assert(calculator.formatDuration(septillionAthenas.totalSeconds).startsWith('2,739,'));
assert.throws(() => calculator.calculateBuildTime({
  itemName:'Athena', count:0n, shipyardLevel:0, foundryLevel:0, assignedDroids:0
}), /at least 1/);

const oneMissileBattery = calculator.calculateBuildTime({
  itemName:'Missile Battery', count:1n, shipyardLevel:0, foundryLevel:0, assignedDroids:0
});
assert.strictEqual(oneMissileBattery.itemKind, 'defense');
assert.strictEqual(oneMissileBattery.oreCrystalPerItem, 2_000n);
assert.strictEqual(oneMissileBattery.totalSeconds, 2_880n);

assert.throws(() => calculator.calculateBuildTime({
  itemName:'Unknown unit', count:1n, shipyardLevel:0, foundryLevel:0, assignedDroids:0
}), /supported ship or defense/);

console.log('shipyard calculator tests passed');
