(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCCombat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const {UNITS, ZEUS_COST, scaled, rfContinue} = units;
  const RESOLUTION = 20;
  const MAX_ROUNDS = 6;

  function makeState(count, hullMax, shieldMax) {
    const bins = Array.from({length:RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));
    bins[RESOLUTION] = {count, hullSum:count, shieldSum:count * shieldMax, hitWeight:0};
    return {bins, hullMax, shieldMax};
  }

  function stateCount(state) {
    return state.bins.reduce((sum, bin) => sum + bin.count, 0);
  }

  // Abramowitz-Stegun erf approximation, enough for PMF tail work here.
  function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
    return sign * y;
  }

  function normalCDF(value) {
    return 0.5 * (1 + erf(value / Math.SQRT2));
  }

  function renorm(distribution) {
    const sum = distribution.reduce((total, item) => total + item.p, 0);
    if (!(sum > 0)) return [{k:0, p:1}];
    for (const item of distribution) item.p /= sum;
    return distribution;
  }

  function hitDistribution(lambda, killHits) {
    if (!(lambda > 0)) return [{k:0, p:1}];
    killHits = Math.max(1, Math.ceil(killHits));
    if (killHits === 1) return [{k:0, p:Math.exp(-lambda)}, {k:1, p:1-Math.exp(-lambda), tail:true}];

    const output = [];
    if (lambda <= 30) {
      let probability = Math.exp(-lambda);
      let sum = 0;
      const maxUseful = Math.min(killHits - 1, Math.max(8, Math.ceil(lambda + 9*Math.sqrt(lambda) + 8)), 300);
      for (let hits = 0; hits <= maxUseful; hits++) {
        if (hits > 0) probability *= lambda / hits;
        if (probability > 1e-16) output.push({k:hits, p:probability});
        sum += probability;
      }
      const tail = Math.max(0, 1 - sum);
      if (tail > 1e-14) {
        if (maxUseful >= killHits - 1) output.push({k:killHits, p:tail, tail:true});
        else output.push({k:maxUseful + 1, p:tail, approx:true});
      }
      return renorm(output);
    }

    const standardDeviation = Math.sqrt(lambda);
    // If the kill threshold is far below the mean, essentially all ships die.
    if (killHits < lambda - 9 * standardDeviation) return [{k:killHits, p:1, tail:true}];
    const start = Math.max(0, Math.floor(lambda - 8 * standardDeviation));
    const end = Math.min(killHits - 1, Math.ceil(lambda + 8 * standardDeviation), 2000);
    let sum = 0;
    if (start > 0) {
      const lowProbability = normalCDF((start - 0.5 - lambda) / standardDeviation);
      if (lowProbability > 1e-14) {
        output.push({k:start, p:lowProbability, approx:true});
        sum += lowProbability;
      }
    }
    for (let hits = start; hits <= end; hits++) {
      const high = normalCDF((hits + 0.5 - lambda) / standardDeviation);
      const low = normalCDF((hits - 0.5 - lambda) / standardDeviation);
      const probability = Math.max(0, high - low);
      if (probability > 1e-14) {
        output.push({k:hits, p:probability, approx:true});
        sum += probability;
      }
    }
    const tail = Math.max(0, 1 - sum);
    if (tail > 1e-14) output.push({k:killHits, p:tail, tail:true, approx:true});
    return renorm(output);
  }

  function binIndex(hullFraction) {
    if (!(hullFraction > 0)) return 0;
    return Math.max(1, Math.min(RESOLUTION, Math.ceil(hullFraction * RESOLUTION - 1e-12)));
  }

  function applyAttackGroup(state, totalShots, damage, bypassShield=false) {
    const total = stateCount(state);
    if (!(total > 0) || !(totalShots > 0) || !(damage > 0)) return;
    const lambda = totalShots / total;
    const next = Array.from({length:RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));

    for (let index = 1; index <= RESOLUTION; index++) {
      const bin = state.bins[index];
      if (!(bin.count > 0)) continue;
      const averageHullFraction = Math.min(1, Math.max(0, bin.hullSum / bin.count));
      const averageShield = Math.max(0, bin.shieldSum / bin.count);
      const oldHitProbability = Math.min(1, Math.max(0, bin.hitWeight / bin.count));
      const durability = averageHullFraction * state.hullMax + (bypassShield ? 0 : averageShield);
      const killHits = Math.max(1, Math.ceil(durability / damage - 1e-12));
      const distribution = hitDistribution(lambda, killHits);

      for (const outcome of distribution) {
        const mass = bin.count * outcome.p;
        if (!(mass > 0)) continue;
        const hits = outcome.k;
        let hullFraction = averageHullFraction;
        let shield = averageShield;
        if (outcome.tail && hits >= killHits) {
          next[0].count += mass;
          continue;
        }
        const rawDamage = hits * damage;
        if (bypassShield) {
          hullFraction -= rawDamage / state.hullMax;
        } else {
          const absorbed = Math.min(shield, rawDamage);
          shield -= absorbed;
          hullFraction -= (rawDamage - absorbed) / state.hullMax;
        }
        if (!(hullFraction > 0)) {
          next[0].count += mass;
          continue;
        }
        const nextIndex = binIndex(hullFraction);
        const newHitProbability = hits > 0 ? 1 : oldHitProbability;
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
      const hullFraction = Math.min(1, Math.max(0, bin.hullSum / bin.count));
      const hitProbability = Math.min(1, Math.max(0, bin.hitWeight / bin.count));
      const explosionProbability = hullFraction < 0.70 ? hitProbability * (1 - hullFraction) : 0;
      const survivors = bin.count * (1 - explosionProbability);
      if (!(survivors > 0)) continue;
      output[index].count = survivors;
      output[index].hullSum = survivors * hullFraction;
      output[index].shieldSum = survivors * state.shieldMax;
      output[index].hitWeight = 0;
    }
    state.bins = output;
  }

  function applyZeusToHeavy(state, hits, zeusWeapon) {
    applyAttackGroup(state, hits, zeusWeapon, false);
    explodeAndReset(state);
  }

  function threatValue(composition, defenderTech, attackerTech) {
    const zeusShield = scaled(UNITS.Zeus.shield, (attackerTech || {}).shield || 0);
    let total = 0;
    for (const [name, count] of Object.entries(composition || {})) {
      const unit = UNITS[name];
      if (!unit || !(count > 0) || !(unit.weapon > 0)) continue;
      const damage = scaled(unit.weapon, (defenderTech || {}).weapons || 0);
      // The combat engine ignores an individual shot at or below 1% of target shielding.
      if (damage <= 0.01 * zeusShield) continue;
      total += count * damage;
    }
    return total;
  }

  function initialZeusShotFactor(composition) {
    const total = Object.values(composition).reduce((sum, count) => sum + count, 0);
    if (!(total > 0)) return 1;
    let continuation = 0;
    for (const [name, count] of Object.entries(composition)) {
      const unit = UNITS[name];
      continuation += (count / total) * rfContinue(unit ? unit.zeusRF : 1);
    }
    continuation = Math.min(0.999999999999, Math.max(0, continuation));
    return 1 / (1 - continuation);
  }

  function simulate(input) {
    const initialComposition = {...input.composition};
    const initialZeus = Number(input.zeusCount);
    const attackerTech = input.attackerTech || {weapons:0, shield:0, armor:0};
    const defenderTech = input.defenderTech || {weapons:0, shield:0, armor:0};
    const rfSigma = Number(input.rfSigma || 0); // 0 = mean; positive is conservative lower attacker RF.
    if (!(initialZeus > 0)) throw new Error('Zeus count must be positive.');

    const zeusBase = UNITS.Zeus;
    const zeusHull = scaled(zeusBase.hull, attackerTech.armor);
    const zeusShield = scaled(zeusBase.shield, attackerTech.shield);
    const zeusWeapon = scaled(zeusBase.weapon, attackerTech.weapons);
    const zeusState = makeState(initialZeus, zeusHull, zeusShield);

    const defenders = {};
    const heavy = {};
    for (const [name, count] of Object.entries(initialComposition)) {
      if (!(count > 0) || !UNITS[name]) continue;
      defenders[name] = count;
      const unit = UNITS[name];
      const targetHull = scaled(unit.hull, defenderTech.armor);
      const targetShield = scaled(unit.shield, defenderTech.shield);
      const zeusEffective = zeusWeapon > 0.01 * targetShield;
      const oneHit = zeusEffective && zeusWeapon >= targetHull + targetShield;
      if (!oneHit) heavy[name] = makeState(count, targetHull, targetShield);
    }

    const initialDSP = Object.entries(defenders).reduce((sum, [name, count]) => {
      const unit = UNITS[name];
      return sum + (unit.kind === 'ship' ? count * unit.cost / 1000 : 0);
    }, 0);
    const initialShipValue = initialDSP * 1000;
    const initialTargets = Object.values(defenders).reduce((sum, count) => sum + count, 0);
    const initialThreat = threatValue(defenders, defenderTech, attackerTech);
    const roundDetails = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const startDefenders = {};
      for (const [name, count] of Object.entries(defenders)) {
        if (count > 1e-12) startDefenders[name] = count;
      }
      const totalDefenders = Object.values(startDefenders).reduce((sum, count) => sum + count, 0);
      const aliveZeus = stateCount(zeusState);
      if (!(aliveZeus > 1e-12) || !(totalDefenders > 1e-12)) break;

      // Defender fires using start-of-round counts (combat is simultaneous).
      for (const [name, count] of Object.entries(startDefenders)) {
        const unit = UNITS[name];
        const damage = scaled(unit.weapon, defenderTech.weapons);
        if (!(damage > 0)) continue;
        // <= 1% of target shielding is ineffective.
        if (damage <= 0.01 * zeusShield) continue;
        applyAttackGroup(zeusState, count, damage, false);
      }
      explodeAndReset(zeusState);

      // Zeus expected rapid-fire chain against the start-of-round defender mix.
      let continuation = 0;
      for (const [name, count] of Object.entries(startDefenders)) {
        continuation += (count / totalDefenders) * rfContinue(UNITS[name].zeusRF);
      }
      continuation = Math.min(0.999999999999, Math.max(0, continuation));
      let zeusShots = aliveZeus / (1 - continuation);
      // Wiki LBA says final RF shots get a 2% standard-deviation Gaussian variation.
      // In deterministic mode rfSigma=0. Positive values represent a conservative low-shot sensitivity case.
      zeusShots *= Math.max(0, 1 - 0.02 * Math.max(0, rfSigma));
      zeusShots = Math.max(aliveZeus, zeusShots);
      const lambda = zeusShots / totalDefenders;

      for (const [name, countStart] of Object.entries(startDefenders)) {
        const unit = UNITS[name];
        const hits = countStart * lambda;
        if (heavy[name]) {
          const targetShield = scaled(unit.shield, defenderTech.shield);
          if (zeusWeapon > 0.01 * targetShield) applyZeusToHeavy(heavy[name], hits, zeusWeapon);
          defenders[name] = stateCount(heavy[name]);
        } else {
          // In normal AWS ranges this covers every listed unit except Zeus/Hephaestus, matching the wiki.
          defenders[name] = countStart * Math.exp(-lambda);
        }
      }

      const shipDSPRemaining = Object.entries(defenders).reduce((sum, [name, count]) => {
        const unit = UNITS[name];
        return sum + (unit.kind === 'ship' ? count * unit.cost / 1000 : 0);
      }, 0);
      const aliveAfter = stateCount(zeusState);
      const remainingThreat = threatValue(defenders, defenderTech, attackerTech);
      roundDetails.push({
        round,
        aliveZeus:aliveAfter,
        zeusSurvival:aliveAfter / initialZeus,
        totalDefenders:Object.values(defenders).reduce((sum, count) => sum + count, 0),
        dspDestroyed:initialDSP - shipDSPRemaining,
        dspDestroyedFraction:initialDSP > 0 ? (initialDSP - shipDSPRemaining) / initialDSP : 0,
        threatRemaining:remainingThreat,
        threatDestroyedFraction:initialThreat > 0 ? 1 - remainingThreat / initialThreat : 1
      });
    }

    const aliveZeus = stateCount(zeusState);
    const remainingDSP = Object.entries(defenders).reduce((sum, [name, count]) => {
      const unit = UNITS[name];
      return sum + (unit.kind === 'ship' ? count * unit.cost / 1000 : 0);
    }, 0);
    const remainingTargets = Object.values(defenders).reduce((sum, count) => sum + count, 0);
    const destroyedDSP = Math.max(0, initialDSP - remainingDSP);
    const survival = Math.max(0, Math.min(1, aliveZeus / initialZeus));
    return {
      zeusCount:initialZeus,
      zeusSurvival:survival,
      zeusLossFraction:1 - survival,
      zeusLosses:initialZeus - aliveZeus,
      zeusResourcesLost:(initialZeus - aliveZeus) * ZEUS_COST,
      initialDSP,
      destroyedDSP,
      dspDestroyedFraction:initialDSP > 0 ? destroyedDSP / initialDSP : 0,
      initialShipValue,
      remainingTargets,
      targetDestroyedFraction:initialTargets > 0 ? 1 - remainingTargets / initialTargets : 0,
      initialThreat,
      remainingThreat:threatValue(defenders, defenderTech, attackerTech),
      threatDestroyedFraction:initialThreat > 0 ? 1 - threatValue(defenders, defenderTech, attackerTech) / initialThreat : 1,
      efficiencyPerCommittedZeus:initialZeus > 0 ? destroyedDSP / initialZeus : 0,
      efficiencyPerLostZeus:(initialZeus - aliveZeus) > 0 ? destroyedDSP / (initialZeus - aliveZeus) : Infinity,
      roundDetails,
      defenders
    };
  }

  return {simulate, threatValue, initialZeusShotFactor, MAX_ROUNDS};
});
