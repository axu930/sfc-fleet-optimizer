(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCShipyardCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const COUNT_SUFFIX_POWERS = Object.freeze({
    '':0, k:3, m:6, b:9, t:12, q:15, qa:15, quadrillion:15,
    qi:18, quintillion:18, sx:21, sextillion:21, sp:24, septillion:24
  });
  const MAGNITUDES = [
    ['nonillion',30], ['octillion',27], ['septillion',24], ['sextillion',21],
    ['quintillion',18], ['quadrillion',15], ['trillion',12], ['billion',9],
    ['million',6], ['thousand',3]
  ];

  function parseShipCount(value) {
    if (typeof value === 'bigint') {
      if (value < 0n) throw new RangeError('Ship count cannot be negative.');
      return value;
    }

    const source = String(value == null ? '' : value).trim();
    const match = source.match(/^((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d+))?(?:[eE]([+-]?\d+))?\s*([a-z]+)?$/i);
    if (!match) throw new TypeError('Enter a whole ship count, optionally using commas or a supported suffix.');

    const exponent = Number(match[3] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
      throw new RangeError('Scientific notation exponent must be between -1,000 and 1,000.');
    }
    const suffix = (match[4] || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COUNT_SUFFIX_POWERS, suffix)) {
      throw new TypeError('That ship-count suffix is not supported.');
    }

    const fraction = match[2] || '';
    const coefficientText = (match[1].replace(/,/g, '') + fraction).replace(/^0+(?=\d)/, '');
    const coefficient = BigInt(coefficientText);
    const scale = COUNT_SUFFIX_POWERS[suffix] - fraction.length + exponent;
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

  function calculateBuildTime({shipName, count, shipyardLevel, foundryLevel, assignedDroids=0}) {
    const unit = units.UNITS[shipName];
    if (!unit || unit.kind !== 'ship') throw new TypeError('Choose a supported ship.');

    const quantity = typeof count === 'bigint' ? count : parseShipCount(count);
    if (quantity < 1n) throw new RangeError('Enter a ship count of at least 1.');

    const yard = validateLevel(shipyardLevel, 'Shipyard level');
    const foundry = validateLevel(foundryLevel, 'Foundry level');
    const droids = Number(assignedDroids);
    if (!Number.isSafeInteger(droids) || droids < 0) throw new RangeError('Build Droid count must be a non-negative whole number.');
    const droidSlots = maxShipyardDroids(yard);
    if (droids > droidSlots) throw new RangeError(`This Shipyard has room for at most ${droidSlots} Build Droid${droidSlots === 1 ? '' : 's'}.`);

    const ore = BigInt(unit.ore || 0);
    const crystal = BigInt(unit.crystal || 0);
    const oreCrystalPerShip = ore + crystal;
    const foundryMultiplier = 2n ** BigInt(foundry);
    const speedHundredths = 50n + BigInt(droids);
    const denominator = 2500n * BigInt(yard + 1) * foundryMultiplier * speedHundredths;
    const secondsNumeratorPerShip = oreCrystalPerShip * 50n * 3600n;
    const perShipSeconds = roundFraction(secondsNumeratorPerShip, denominator);
    const totalSeconds = roundFraction(secondsNumeratorPerShip * quantity, denominator);

    return {
      shipName,
      count:quantity,
      countDigits:quantity.toString(),
      orePerShip:ore,
      crystalPerShip:crystal,
      oreCrystalPerShip,
      shipyardLevel:yard,
      foundryLevel:foundry,
      assignedDroids:droids,
      droidSlots,
      perShipSeconds,
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

  return {parseShipCount, groupDigits, formatMagnitude, maxShipyardDroids, calculateBuildTime, formatDuration};
});
