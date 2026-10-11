(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCRapidFireAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const {UNITS, rfContinue} = units;
  const ATTACKERS = Object.freeze([
    'Artemis', 'Apollo', 'Poseidon', 'Athena', 'Ares', 'Hades', 'Prometheus', 'Zeus'
  ]);
  const TARGETS = Object.freeze(Object.keys(UNITS).filter(name => name !== 'Hephaestus'));
  const TARGET_SET = new Set(TARGETS);
  const STORAGE_KEY = 'sfc-rapid-fire-analyzer-scenarios-v1';

  // Non-Zeus matchups from the SFC2 Wiki Rapid Fire page. A rating of 1 is
  // implicit for every unlisted pairing. Zeus ratings continue to use the
  // canonical zeusRF values already kept with the shared unit statistics.
  const MATCHUPS = Object.freeze({
    Artemis:Object.freeze({'Hermes Probe':5}),
    Apollo:Object.freeze({'Hermes Probe':5, Atlas:3}),
    Poseidon:Object.freeze({'Hermes Probe':5, Artemis:6, 'Missile Battery':10}),
    Athena:Object.freeze({'Hermes Probe':5}),
    Ares:Object.freeze({'Hermes Probe':5, 'Laser Cannon':20, 'Missile Battery':20, 'Particle Cannon':10, 'Pulse Cannon':10}),
    Hades:Object.freeze({'Hermes Probe':5, Athena:7, Apollo:4, Poseidon:4, Atlas:3, Hercules:3, Carmanor:2}),
    Prometheus:Object.freeze({'Hermes Probe':5, 'Laser Cannon':10, Hades:2})
  });

  function rating(attacker, target) {
    if (!UNITS[attacker] || !UNITS[target]) return 1;
    if (attacker === 'Zeus') return Math.max(1, Number(UNITS[target].zeusRF) || 1);
    return Math.max(1, Number((MATCHUPS[attacker] || {})[target]) || 1);
  }

  function normalizeRatio(ratio) {
    if (!ratio || typeof ratio !== 'object' || Array.isArray(ratio)) {
      throw new Error('Enter your fleet composition.');
    }
    const weights = {};
    let largest = 0;
    for (const [name, rawWeight] of Object.entries(ratio)) {
      if (!TARGET_SET.has(name)) throw new Error(`Unknown target unit: ${name}.`);
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight) || weight < 0) throw new Error(`Enter a valid nonnegative ratio for ${name}.`);
      weights[name] = weight;
      largest = Math.max(largest, weight);
    }
    if (!(largest > 0)) throw new Error('Enter a positive ratio for at least one of your units.');

    // Divide before summing so large but finite ratio weights cannot overflow.
    const scaledWeights = {};
    let total = 0;
    for (const [name, weight] of Object.entries(weights)) {
      const scaledWeight = weight / largest;
      scaledWeights[name] = scaledWeight;
      total += scaledWeight;
    }
    const shares = {};
    for (const [name, weight] of Object.entries(scaledWeights)) {
      if (weight > 0) shares[name] = weight / total;
    }
    return shares;
  }

  function expectedShots(attacker, ratio) {
    if (!ATTACKERS.includes(attacker)) throw new Error(`Unsupported attacker: ${attacker}.`);
    const shares = normalizeRatio(ratio);
    let continuationChance = 0;
    for (const [target, share] of Object.entries(shares)) {
      continuationChance += share * rfContinue(rating(attacker, target));
    }
    return {
      totalShots:1 / (1 - continuationChance),
      bonusShots:continuationChance / (1 - continuationChance),
      continuationChance,
      shares
    };
  }

  function loadScenarios(storage) {
    try {
      const serialized = storage && storage.getItem(STORAGE_KEY);
      if (!serialized) return [];
      const parsed = JSON.parse(serialized);
      if (!Array.isArray(parsed)) return [];
      const ids = new Set();
      return parsed.flatMap((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        let ratio = {};
        let hadHephaestus = false;
        if (item.ratio && typeof item.ratio === 'object' && !Array.isArray(item.ratio)) {
          for (const [name, rawWeight] of Object.entries(item.ratio)) {
            const weight = Number(rawWeight);
            if (name === 'Hephaestus') {
              hadHephaestus = true;
              continue;
            }
            if (TARGET_SET.has(name) && Number.isFinite(weight) && weight >= 0) ratio[name] = weight;
          }
        }
        if (hadHephaestus) {
          try { ratio = normalizeRatio(ratio); } catch (error) { ratio = {}; }
        }
        let id = typeof item.id === 'string' && item.id.trim() ? item.id : `saved-scenario-${index + 1}`;
        if (ids.has(id)) {
          const baseId = `saved-scenario-${index + 1}`;
          id = baseId;
          let suffix = 1;
          while (ids.has(id)) id = `${baseId}-${suffix++}`;
        }
        ids.add(id);
        const name = typeof item.name === 'string' && item.name.trim()
          ? item.name.trim().slice(0, 60)
          : `Composition ${index + 1}`;
        return [{id, name, ratio}];
      });
    } catch (error) {
      return [];
    }
  }

  function saveScenarios(scenarios, storage) {
    if (!Array.isArray(scenarios)) throw new Error('Scenarios must be an array.');
    if (!storage || typeof storage.setItem !== 'function') throw new Error('Browser storage is unavailable.');
    storage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  }

  return {ATTACKERS, TARGETS, MATCHUPS, STORAGE_KEY, rating, normalizeRatio, expectedShots, loadScenarios, saveScenarios};
});
