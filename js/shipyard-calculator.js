(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCShipyardCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const MULTIPLIER_POWERS = Object.freeze({
    ones:0, thousand:3, million:6, billion:9, trillion:12,
    quadrillion:15, quintillion:18, sextillion:21, septillion:24
  });
  const MAGNITUDES = [
    ['nonillion',30], ['octillion',27], ['septillion',24], ['sextillion',21],
    ['quintillion',18], ['quadrillion',15], ['trillion',12], ['billion',9],
    ['million',6], ['thousand',3]
  ];

  function parseShipCount(value) {
    return parseCount(value, 0, true);
  }

  function parseShipCountWithMagnitude(value, magnitude='ones') {
    if (!Object.prototype.hasOwnProperty.call(MULTIPLIER_POWERS, magnitude)) {
      throw new TypeError('Choose a supported count magnitude.');
    }
    return parseCount(value, MULTIPLIER_POWERS[magnitude], magnitude === 'ones');
  }

  function parseCount(value, multiplierPower, allowSuffix) {
    if (typeof value === 'bigint') {
      if (value < 0n) throw new RangeError('Ship count cannot be negative.');
      return value * (10n ** BigInt(multiplierPower));
    }

    const source = String(value == null ? '' : value).trim();
    const match = source.match(/^((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d+))?(?:[eE]([+-]?\d+))?\s*([a-z]+)?$/i);
    if (!match) throw new TypeError('Enter a whole build count, optionally using commas or a supported suffix.');

    const exponent = Number(match[3] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
      throw new RangeError('Scientific notation exponent must be between -1,000 and 1,000.');
    }
    const suffix = match[4] || '';
    if (!allowSuffix && suffix) {
      throw new TypeError('Enter the amount without a suffix when using the magnitude selector.');
    }
    const suffixPower = units.countSuffixPower(suffix);
    if (suffixPower === null) {
      throw new TypeError('That ship-count suffix is not supported.');
    }

    const fraction = match[2] || '';
    const coefficientText = (match[1].replace(/,/g, '') + fraction).replace(/^0+(?=\d)/, '');
    const coefficient = BigInt(coefficientText);
    const scale = suffixPower - fraction.length + exponent + multiplierPower;
    if (scale >= 0) return coefficient * (10n ** BigInt(scale));

    const divisor = 10n ** BigInt(-scale);
    if (coefficient % divisor !== 0n) throw new RangeError('Ship count must resolve to a whole number of ships.');
    return coefficient / divisor;
  }

  function groupDigits(value) {
    const digits = typeof value === 'bigint' ? value.toString() : String(value);
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatMagnitude(value) {
    const count = typeof value === 'bigint' ? value : BigInt(value);
    for (const [name, exponent] of MAGNITUDES) {
      const magnitude = 10n ** BigInt(exponent);
      if (count < magnitude) continue;
      const hundredths = (count * 100n + magnitude / 2n) / magnitude;
      const whole = hundredths / 100n;
      const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
      return `${fraction ? `${whole}.${fraction}` : whole.toString()} ${name}`;
    }
    return groupDigits(count);
  }

  function maxShipyardDroids(shipyardLevel) {
    const level = Number(shipyardLevel);
    if (!Number.isSafeInteger(level) || level < 0) throw new RangeError('Shipyard level must be a non-negative whole number.');
    return 1 + Math.floor(level / 3);
  }

  function validateLevel(value, label) {
    const level = Number(value);
    if (!Number.isSafeInteger(level) || level < 0 || level > 1000) {
      throw new RangeError(`${label} must be a whole number from 0 to 1,000.`);
    }
    return level;
  }

  function roundFraction(numerator, denominator) {
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return quotient + (remainder * 2n >= denominator ? 1n : 0n);
  }

  function calculateBuildTime({itemName, count, shipyardLevel, foundryLevel, assignedDroids=0}) {
    const unit = units.UNITS[itemName];
    if (!unit || (unit.kind !== 'ship' && unit.kind !== 'defense')) {
      throw new TypeError('Choose a supported ship or defense.');
    }

    const quantity = typeof count === 'bigint' ? count : parseShipCount(count);
    if (quantity < 1n) throw new RangeError('Enter a build count of at least 1.');

    const yard = validateLevel(shipyardLevel, 'Shipyard level');
    const foundry = validateLevel(foundryLevel, 'Foundry level');
    const droids = Number(assignedDroids);
    if (!Number.isSafeInteger(droids) || droids < 0) throw new RangeError('Build Droid count must be a non-negative whole number.');
    const droidSlots = maxShipyardDroids(yard);
    if (droids > droidSlots) throw new RangeError(`This Shipyard has room for at most ${droidSlots} Build Droid${droidSlots === 1 ? '' : 's'}.`);

    const ore = BigInt(unit.ore || 0);
    const crystal = BigInt(unit.crystal || 0);
    const oreCrystalPerItem = ore + crystal;
    const foundryMultiplier = 2n ** BigInt(foundry);
    const speedHundredths = 50n + BigInt(droids);
    const denominator = 2500n * BigInt(yard + 1) * foundryMultiplier * speedHundredths;
    const secondsNumeratorPerItem = oreCrystalPerItem * 50n * 3600n;
    const perItemSeconds = roundFraction(secondsNumeratorPerItem, denominator);
    const totalSeconds = roundFraction(secondsNumeratorPerItem * quantity, denominator);

    return {
      itemName,
      itemKind:unit.kind,
      count:quantity,
      countDigits:quantity.toString(),
      orePerItem:ore,
      crystalPerItem:crystal,
      oreCrystalPerItem,
      shipyardLevel:yard,
      foundryLevel:foundry,
      assignedDroids:droids,
      droidSlots,
      perItemSeconds,
      totalSeconds
    };
  }

  function formatDuration(value) {
    let remaining = typeof value === 'bigint' ? value : BigInt(value);
    if (remaining < 0n) throw new RangeError('Duration cannot be negative.');
    if (remaining === 0n) return '0 seconds';

    const unitsInSeconds = [['year',31536000n],['day',86400n],['hour',3600n],['minute',60n],['second',1n]];
    const parts = [];
    for (const [label, unit] of unitsInSeconds) {
      const amount = remaining / unit;
      remaining %= unit;
      if (amount > 0n) parts.push(`${groupDigits(amount)} ${label}${amount === 1n ? '' : 's'}`);
      if (parts.length === 3) break;
    }
    return parts.join(' · ');
  }

  return {parseShipCount, parseShipCountWithMagnitude, groupDigits, formatMagnitude, maxShipyardDroids, calculateBuildTime, formatDuration};
});
