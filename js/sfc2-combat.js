(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFC2Combat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const {UNITS: SHARED_UNITS, scaled, rfContinue} = units;
  const RESOLUTION = 20;
  const MAX_ROUNDS = 6;
  const POISSON_MAX_LAMBDA = 20;
  const SFC2_ONLY_UNITS = Object.freeze({
    'Shadow Probe': {kind:'ship', hull:100, shield:0, weapon:0, ore:0, crystal:0, hydrogen:0, cost:0, cargo:5, credits:20_000, zeusRF:1250},
    'Helios Class Solar Satellite': {kind:'ship', hull:200, shield:1, weapon:1, ore:0, crystal:2_000, hydrogen:500, cost:2_500, cargo:0, stationary:true, zeusRF:1250},
    'Genesis Solar Satellite': {kind:'ship', hull:200, shield:1, weapon:1, ore:0, crystal:0, hydrogen:0, cost:0, cargo:0, credits:10_000, stationary:true, zeusRF:1250}
  });

  const EXCLUDED_FROM_ANALYZER = new Set(['Charon', 'Hephaestus']);
  const UNITS = Object.freeze(Object.fromEntries(
    Object.entries({...SHARED_UNITS, ...SFC2_ONLY_UNITS}).filter(([name]) => !EXCLUDED_FROM_ANALYZER.has(name))
  ));
  const CARGO = Object.freeze({
    'Hermes Probe':5, 'Shadow Probe':5,
    Artemis:50, Atlas:5_000, Apollo:100, Zagreus:5_000,
    Hercules:25_000, Dionysus:20_000, Gaia:7_500, Carmanor:125_000,
    Poseidon:800, Athena:1_500, Ares:500, Hades:750, Prometheus:2_000,
    Zeus:1_000_000,
    'Missile Battery':0, 'Laser Cannon':0, 'Pulse Cannon':0,
    'Particle Cannon':0, 'Gauss Cannon':0, 'Plasma Cannon':0,
    Decoy:0, 'Large Decoy':0,
    'Helios Class Solar Satellite':0, 'Genesis Solar Satellite':0
  });
  const NON_PLUNDERING_SHIPS = new Set([
    'Hermes Probe', 'Shadow Probe',
    'Helios Class Solar Satellite', 'Genesis Solar Satellite'
  ]);
  const ATTACKER_SHIPS = Object.freeze([
    'Artemis', 'Apollo', 'Poseidon', 'Athena', 'Hades', 'Ares', 'Prometheus', 'Zeus'
  ]);
  const DEFENDER_SHIPS = Object.freeze(Object.keys(UNITS).filter(name =>
    UNITS[name].kind === 'ship'
  ));
  const DEFENSES = Object.freeze(Object.keys(UNITS).filter(name => UNITS[name].kind === 'defense'));

  const UNIVERSAL_FODDER = new Set([
    'Hermes Probe', 'Shadow Probe', 'Helios Class Solar Satellite', 'Genesis Solar Satellite'
  ]);
  const NO_RAPID_FIRE_SHIPS = new Set([
    'Hermes Probe', 'Shadow Probe', 'Helios Class Solar Satellite', 'Genesis Solar Satellite'
  ]);
  const RAPID_FIRE = Object.freeze({
    Apollo: Object.freeze({Atlas:3}),
    Poseidon: Object.freeze({Artemis:6, 'Missile Battery':10}),
    Ares: Object.freeze({'Missile Battery':20, 'Laser Cannon':20, 'Pulse Cannon':10, 'Particle Cannon':10}),
    Hades: Object.freeze({Athena:7, Apollo:4, Poseidon:4, Atlas:3, Hercules:3, Carmanor:2}),
    Prometheus: Object.freeze({Hades:2, 'Laser Cannon':10})
  });

  function unitNames(kind) {
    if (kind === 'attacker') return ATTACKER_SHIPS.slice();
    if (kind === 'defender') return [...DEFENDER_SHIPS, ...DEFENSES];
    if (kind === 'ship') return DEFENDER_SHIPS.slice();
    if (kind === 'defense') return DEFENSES.slice();
    return Object.keys(UNITS);
  }

  function rapidFireRating(shooterName, targetName) {
    if (shooterName === 'Zeus') return Math.max(1, Number(UNITS[targetName] && UNITS[targetName].zeusRF) || 1);
    const shooter = UNITS[shooterName];
    if (UNIVERSAL_FODDER.has(targetName) && shooter && shooter.kind === 'ship' && !NO_RAPID_FIRE_SHIPS.has(shooterName)) return 5;
    return Math.max(1, Number((RAPID_FIRE[shooterName] || {})[targetName]) || 1);
  }

  function cargoCapacity(name) {
    return Math.max(0, Number(CARGO[name]) || 0);
  }

  function canCarryPlunder(name) {
    return !NON_PLUNDERING_SHIPS.has(name) && cargoCapacity(name) > 0;
  }

  function buildCost(name) {
    const unit = UNITS[name];
    if (!unit) return null;
    return {
      ore:Number(unit.ore) || 0,
      crystal:Number(unit.crystal) || 0,
      hydrogen:Number(unit.hydrogen != null ? unit.hydrogen : Math.max(0, (Number(unit.cost) || 0) - (Number(unit.ore) || 0) - (Number(unit.crystal) || 0))),
      credits:Number(unit.credits) || 0
    };
  }

  function ineffectiveDefenderTargets(attackers, defenders, attackerTech={}, defenderTech={}) {
    const activeAttackers = Object.entries(attackers || {}).filter(([name, count]) =>
      Number(count) > 0 && ATTACKER_SHIPS.includes(name)
    );
    return Object.entries(defenders || {})
      .filter(([name, count]) => Number(count) > 0 && UNITS[name])
      .filter(([targetName]) => !activeAttackers.some(([attackerName]) => {
        const attacker = UNITS[attackerName];
        const target = UNITS[targetName];
        const weaponDamage = scaled(attacker.weapon, attackerTech.weapons);
        const targetShield = scaled(target.shield, defenderTech.shield);
        return weaponDamage > 0.01 * targetShield;
      }))
      .map(([name]) => name);
  }

  function makeState(count, hullMax, shieldMax) {
    const bins = Array.from({length:RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));
    bins[RESOLUTION] = {count, hullSum:count, shieldSum:count * shieldMax, hitWeight:0};
    return {bins, hullMax, shieldMax};
  }

  function stateCount(state) {
    return state.bins.reduce((sum, bin) => sum + bin.count, 0);
  }

  function bucketHullFraction(index) {
    if (!(index > 0)) return 0;
    return Math.max(0, Math.min(1, (index - 0.5) / RESOLUTION));
  }

  function binIndex(hullFraction) {
    if (!(hullFraction > 0)) return 0;
    return Math.max(1, Math.min(RESOLUTION, Math.ceil(hullFraction * RESOLUTION - 1e-12)));
  }

  function normalSurvival(value) {
    if (value < 0) return 1 - normalSurvival(-value);
    if (value >= 2) {
      let denominator = value;
      for (let term = 19; term >= 1; term--) denominator = value + term / denominator;
      return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI) / denominator;
    }
    const x = value / Math.SQRT2;
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const t = 1 / (1 + p * x);
    const erfc = (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
    return 0.5 * erfc;
  }

  function normalCDF(value) {
    return value < 0 ? normalSurvival(-value) : 1 - normalSurvival(value);
  }

  function normalIntervalProbability(lower, upper) {
    if (lower >= 0) return Math.max(0, normalSurvival(lower) - normalSurvival(upper));
    return Math.max(0, normalCDF(upper) - normalCDF(lower));
  }

  function addResidualToMode(distribution, lambda, killHits) {
    const sum = distribution.reduce((total, item) => total + item.p, 0);
    if (!(sum > 0)) return [{k:0, p:1}];
    const modeHits = Math.min(killHits, Math.floor(lambda + 0.5));
    const mode = distribution.find(item => item.k === modeHits) ||
      distribution.reduce((largest, item) => item.p > largest.p ? item : largest);
    mode.p += 1 - sum;
    return distribution;
  }

  function hitDistribution(lambda, killHits) {
    if (!(lambda > 0)) return [{k:0, p:1}];
    killHits = Math.max(1, Math.ceil(killHits));
    if (killHits === 1) {
      return addResidualToMode([
        {k:0, p:Math.exp(-lambda)},
        {k:1, p:1-Math.exp(-lambda), tail:true}
      ], lambda, killHits);
    }

    if (lambda <= POISSON_MAX_LAMBDA) {
      const output = [];
      let probability = Math.exp(-lambda);
      let sum = 0;
      const maxUseful = Math.min(killHits - 1, Math.max(8, Math.ceil(lambda + 9*Math.sqrt(lambda) + 8)), 300);
      for (let hits = 0; hits <= maxUseful; hits++) {
        if (hits > 0) probability *= lambda / hits;
        output.push({k:hits, p:probability});
        sum += probability;
      }
      const tail = Math.max(0, 1 - sum);
      if (tail > 1e-14) {
        if (maxUseful >= killHits - 1) output.push({k:killHits, p:tail, tail:true});
        else output.push({k:maxUseful + 1, p:tail, approx:true});
      }
      return addResidualToMode(output, lambda, killHits);
    }

    const standardDeviation = Math.sqrt(lambda);
    if (killHits < lambda - 9 * standardDeviation) return [{k:killHits, p:1, tail:true}];
    const deathProbability = normalSurvival((killHits - 0.5 - lambda) / standardDeviation);
    const output = [];
    if (deathProbability > 1e-14) output.push({k:killHits, p:deathProbability, tail:true, approx:true});
    const survivorProbability = 1 - deathProbability;
    if (survivorProbability > 1e-14) {
      output.push({k:Math.min(killHits - 1, Math.floor(lambda)), p:survivorProbability, approx:true});
    }
    return addResidualToMode(output, lambda, killHits);
  }

  function binomialHitDistribution(trials, hitProbability, killHits) {
    if (!(trials > 0) || !(hitProbability > 0)) return [{k:0, p:1}];
    if (hitProbability >= 1) return [{k:trials, p:1, tail:trials >= killHits}];
    if (!Number.isInteger(trials) || trials > 200) return null;
    const output = [];
    let probability = Math.pow(1 - hitProbability, trials);
    let sum = 0;
    const maxHits = Math.min(trials, killHits - 1);
    for (let hits = 0; hits <= maxHits; hits++) {
      if (hits > 0) probability *= ((trials - hits + 1) / hits) * (hitProbability / (1 - hitProbability));
      output.push({k:hits, p:probability});
      sum += probability;
    }
    if (killHits <= trials) output.push({k:killHits, p:Math.max(0, 1 - sum), tail:true});
    return addResidualToMode(output, trials * hitProbability, killHits);
  }

  function applyAttackGroup(state, totalShots, damage, exactTrials=null, totalTargets=0) {
    const total = stateCount(state);
    if (!(total > 0) || !(totalShots > 0) || !(damage > 0)) return;
    if (damage <= 0.01 * state.shieldMax) return;
    const lambda = totalShots / total;
    const next = Array.from({length:RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));

    for (let index = 1; index <= RESOLUTION; index++) {
      const bin = state.bins[index];
      if (!(bin.count > 0)) continue;
      const averageHullFraction = Math.min(1, Math.max(0, bin.hullSum / bin.count));
      const averageShield = Math.max(0, bin.shieldSum / bin.count);
      const oldHitProbability = Math.min(1, Math.max(0, bin.hitWeight / bin.count));
      const durability = averageHullFraction * state.hullMax + averageShield;
      const killHits = Math.max(1, Math.ceil(durability / damage - 1e-12));
      const exactProbability = exactTrials != null && totalTargets > 0 ? 1 / totalTargets : 0;
      const distribution = exactTrials != null
        ? binomialHitDistribution(exactTrials, exactProbability, killHits) || hitDistribution(lambda, killHits)
        : hitDistribution(lambda, killHits);

      for (const outcome of distribution) {
        const mass = bin.count * outcome.p;
        if (!(mass > 0)) continue;
        const hits = outcome.k;
        if (outcome.tail && hits >= killHits) {
          next[0].count += mass;
          continue;
        }
        const rawDamage = hits * damage;
        const absorbed = Math.min(averageShield, rawDamage);
        const shield = averageShield - absorbed;
        const hullFraction = averageHullFraction - (rawDamage - absorbed) / state.hullMax;
        if (!(hullFraction > 0)) {
          next[0].count += mass;
          continue;
        }
        const nextIndex = binIndex(hullFraction);
        const newHitProbability = rawDamage > averageShield ? 1 : oldHitProbability;
        next[nextIndex].count += mass;
        next[nextIndex].hullSum += mass * hullFraction;
        next[nextIndex].shieldSum += mass * shield;
        next[nextIndex].hitWeight += mass * newHitProbability;
      }
    }
    state.bins = next;
  }

  function explodeAndReset(state) {
    const output = Array.from({length:RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));
    for (let index = 1; index <= RESOLUTION; index++) {
      const bin = state.bins[index];
      if (!(bin.count > 0)) continue;
      const averageHullFraction = Math.min(1, Math.max(0, bin.hullSum / bin.count));
      const explosionHullFraction = bucketHullFraction(index);
      const hitProbability = Math.min(1, Math.max(0, bin.hitWeight / bin.count));
      const explosionProbability = explosionHullFraction < 0.70
        ? hitProbability * (1 - explosionHullFraction)
        : 0;
      const survivors = bin.count * (1 - explosionProbability);
      if (!(survivors > 0)) continue;
      output[index].count = survivors;
      output[index].hullSum = survivors * averageHullFraction;
      output[index].shieldSum = survivors * state.shieldMax;
      output[index].hitWeight = 0;
    }
    state.bins = output;
  }

  function countsFromStates(states) {
    return Object.fromEntries(Object.entries(states).map(([name, state]) => [name, stateCount(state)]));
  }

  function totalCount(counts) {
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  }

  function probabilityAnySurvives(initial, remaining) {
    let logAllDead = 0;
    for (const [name, initialCountRaw] of Object.entries(initial || {})) {
      const initialCount = Math.max(0, Number(initialCountRaw) || 0);
      if (!(initialCount > 0)) continue;
      const remainingCount = Math.max(0, Number(remaining && remaining[name]) || 0);
      const survivalFraction = Math.max(0, Math.min(1, remainingCount / initialCount));
      if (survivalFraction >= 1) return 1;
      if (survivalFraction > 0) logAllDead += initialCount * Math.log1p(-survivalFraction);
    }
    return Math.max(0, Math.min(1, -Math.expm1(logAllDead)));
  }

  function battleWinProbability(initialAttackers, remainingAttackers, initialDefenders, remainingDefenders) {
    const attackerSurvives = probabilityAnySurvives(initialAttackers, remainingAttackers);
    const defendersCleared = 1 - probabilityAnySurvives(initialDefenders, remainingDefenders);
    return Math.max(0, Math.min(1, attackerSurvives * defendersCleared));
  }

  function makeStates(composition, tech) {
    const states = {};
    for (const [name, rawCount] of Object.entries(composition || {})) {
      const count = Math.max(0, Number(rawCount) || 0);
      const unit = UNITS[name];
      if (!unit || count <= 0) continue;
      states[name] = makeState(
        count,
        scaled(unit.hull, tech.armor),
        scaled(unit.shield, tech.shield)
      );
    }
    return states;
  }

  function makeFirePlans(shooterCounts, targetCounts, shooterTech, targetTech) {
    const targetTotal = totalCount(targetCounts);
    if (!(targetTotal > 0)) return [];
    const plans = [];
    for (const [shooterName, shooterCount] of Object.entries(shooterCounts)) {
      const shooter = UNITS[shooterName];
      const damage = scaled(shooter && shooter.weapon, shooterTech.weapons);
      if (!(shooterCount > 0) || !(damage > 0) || !shooter) continue;
      let continuation = 0;
      for (const [targetName, targetCount] of Object.entries(targetCounts)) {
        if (!(targetCount > 0)) continue;
        const target = UNITS[targetName];
        const fullShield = scaled(target.shield, targetTech.shield);
        const effective = damage > 0.01 * fullShield;
        if (!effective) continue;
        continuation += targetCount / targetTotal * rfContinue(rapidFireRating(shooterName, targetName));
      }
      continuation = Math.min(0.999999999999, Math.max(0, continuation));
      const totalShots = shooterCount / (1 - continuation);
      for (const [targetName, targetCount] of Object.entries(targetCounts)) {
        if (!(targetCount > 0)) continue;
        const exactTrials = continuation === 0 && Number.isInteger(shooterCount) ? shooterCount : null;
        plans.push({targetName, shots:totalShots * targetCount / targetTotal, damage, exactTrials, targetTotal});
      }
    }
    return plans;
  }

  function applyFirePlans(states, plans) {
    for (const plan of plans) {
      const state = states[plan.targetName];
      if (state) applyAttackGroup(state, plan.shots, plan.damage, plan.exactTrials, plan.targetTotal);
    }
  }

  function lossesFromCounts(initial, remaining) {
    const losses = {};
    for (const [name, count] of Object.entries(initial)) {
      losses[name] = Math.max(0, count - (Number(remaining[name]) || 0));
    }
    return losses;
  }

  function simulate(input={}) {
    const attackerTech = input.attackerTech || {};
    const defenderTech = input.defenderTech || {};
    const initialAttackers = Object.fromEntries(Object.entries(input.attackers || {}).filter(([, count]) => Number(count) > 0));
    const initialDefenders = Object.fromEntries(Object.entries(input.defenders || {}).filter(([, count]) => Number(count) > 0));
    const attackerStates = makeStates(initialAttackers, attackerTech);
    const defenderStates = makeStates(initialDefenders, defenderTech);
    const roundDetails = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const startAttackers = countsFromStates(attackerStates);
      const startDefenders = countsFromStates(defenderStates);
      const attackerStartTotal = totalCount(startAttackers);
      const defenderStartTotal = totalCount(startDefenders);
      const blockingDefenders = totalCount(startDefenders);
      if (!(attackerStartTotal > 1e-12) || !(blockingDefenders > 1e-12)) break;

      // Both fire plans use start-of-round counts, so ships lost in this round still shoot.
      const attackerPlans = makeFirePlans(startAttackers, startDefenders, attackerTech, defenderTech);
      const defenderPlans = makeFirePlans(startDefenders, startAttackers, defenderTech, attackerTech);
      applyFirePlans(defenderStates, attackerPlans);
      applyFirePlans(attackerStates, defenderPlans);
      for (const state of Object.values(attackerStates)) explodeAndReset(state);
      for (const state of Object.values(defenderStates)) explodeAndReset(state);

      const remainingAttackers = countsFromStates(attackerStates);
      const remainingDefenders = countsFromStates(defenderStates);
      const attackersLeft = totalCount(remainingAttackers);
      const defendersLeft = totalCount(remainingDefenders);
      roundDetails.push({
        round,
        attackers:remainingAttackers,
        defenders:remainingDefenders,
        expectedAttackersRemaining:attackersLeft,
        expectedDefendersRemaining:defendersLeft,
        estimatedWinProbability:battleWinProbability(initialAttackers, remainingAttackers, initialDefenders, remainingDefenders),
        attackerLosses:lossesFromCounts(initialAttackers, remainingAttackers),
        defenderLosses:lossesFromCounts(initialDefenders, remainingDefenders)
      });
      if (!(attackersLeft > 1e-12) || !(defendersLeft > 1e-12)) break;
    }

    const remainingAttackers = countsFromStates(attackerStates);
    const remainingDefenders = countsFromStates(defenderStates);
    return {
      initialAttackers,
      initialDefenders,
      remainingAttackers,
      remainingDefenders,
      attackerLosses:lossesFromCounts(initialAttackers, remainingAttackers),
      defenderLosses:lossesFromCounts(initialDefenders, remainingDefenders),
      expectedAttackersRemaining:totalCount(remainingAttackers),
      expectedDefendersRemaining:totalCount(remainingDefenders),
      estimatedWinProbability:battleWinProbability(initialAttackers, remainingAttackers, initialDefenders, remainingDefenders),
      roundDetails,
      maxRounds:MAX_ROUNDS
    };
  }

  function cargoCapacityForSurvivors(composition) {
    return Object.entries(composition || {}).reduce((sum, [name, count]) =>
      sum + (canCarryPlunder(name) ? Math.max(0, Number(count) || 0) * cargoCapacity(name) : 0), 0);
  }

  return {
    UNITS, SFC2_ONLY_UNITS, ATTACKER_SHIPS, DEFENDER_SHIPS, DEFENSES,
    unitNames, rapidFireRating, cargoCapacity, canCarryPlunder, buildCost,
    ineffectiveDefenderTargets, simulate, probabilityAnySurvives, battleWinProbability, cargoCapacityForSurvivors,
    MAX_ROUNDS
  };
});
