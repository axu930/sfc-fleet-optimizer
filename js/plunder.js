(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCPlunder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const CARMANOR_CARGO = units.UNITS.Carmanor.cargo || 125_000;

  function clamp(value, low=0, high=1) {
    return Math.max(low, Math.min(high, value));
  }

  function expectedWinProbability(result) {
    if (!result || !(result.zeusCount > 0)) return 0;
    const remainingEnemies = Object.entries(result.defenders || {}).reduce((sum, [name, count]) => {
      if (name === 'Hephaestus' || !(count > 0)) return sum;
      return sum + count;
    }, 0);
    const defenderClearedProbability = Math.exp(-remainingEnemies);
    const aliveZeus = Math.max(0, Number(result.zeusCount) - (Number(result.zeusLosses) || 0));
    const attackerSurvivesProbability = result.zeusLosses <= 1e-12
      ? 1
      : 1 - Math.exp(-aliveZeus);
    return clamp(defenderClearedProbability * attackerSurvivesProbability);
  }

  function hasDefenses(composition) {
    return Object.entries(composition || {}).some(([name, count]) =>
      units.UNITS[name] && units.UNITS[name].kind === 'defense' && count > 0
    );
  }

  function plunderWaves(resources, won, zeroDefense) {
    const source = resources || {};
    const shares = !won ? [] : zeroDefense ? [0.5, 0.25, 0.125] : [0.5];
    return shares.map((share, index) => ({
      number:index + 1,
      share,
      ore:(Number(source.ore) || 0) * share,
      crystal:(Number(source.crystal) || 0) * share,
      hydrogen:(Number(source.hydrogen) || 0) * share
    })).map(wave => ({
      ...wave,
      total:wave.ore + wave.crystal + wave.hydrogen,
      carmanors:Math.ceil((wave.ore + wave.crystal + wave.hydrogen) / CARMANOR_CARGO)
    }));
  }

  function expectedPlunder(resources, winProbability, zeroDefense) {
    const conditionalWaves = plunderWaves(resources, true, zeroDefense);
    const expected = {ore:0, crystal:0, hydrogen:0};
    for (const wave of conditionalWaves) {
      expected.ore += wave.ore * winProbability;
      expected.crystal += wave.crystal * winProbability;
      expected.hydrogen += wave.hydrogen * winProbability;
    }
    return {
      resources:expected,
      total:expected.ore + expected.crystal + expected.hydrogen,
      conditionalWaves
    };
  }

  return {CARMANOR_CARGO, expectedWinProbability, hasDefenses, plunderWaves, expectedPlunder};
});
