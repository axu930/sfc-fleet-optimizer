(function (root, factory) {
  const combat = typeof module === 'object' && module.exports ? require('./sfc2-combat.js') : root.SFC2Combat;
  const api = factory(combat);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFC2Optimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (combat) {
  'use strict';

  const ROUND_LIMITS = Object.freeze([4, 5, 6]);
  const TRANSPORTS = Object.freeze(['Atlas', 'Hercules', 'Carmanor']);
  const DEFAULT_TRANSPORT = 'Carmanor';
  const DEFAULT_CLEAR_CONFIDENCE = 0.999;
  const PLUNDER_SHARE = 0.5;
  // Far beyond plausible in-game counts, while keeping expected-value
  // arithmetic and the derived combat/cost values finite in JavaScript.
  const MAX_SCALE = 1e100;

  function integerGcd(left, right) {
    let a = Math.abs(Math.trunc(left));
    let b = Math.abs(Math.trunc(right));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function normalizeRatios(ratios={}) {
    const selected = Object.entries(ratios)
      .map(([name, value]) => [name, Math.trunc(Number(value))])
      .filter(([name, value]) => combat.ATTACKER_SHIPS.includes(name) && Number.isFinite(value) && value > 0);
    if (!selected.length) throw new Error('Enter a positive ratio for at least one attacking ship.');
    const divisor = selected.reduce((gcd, [, value]) => integerGcd(gcd, value), 0) || 1;
    return Object.fromEntries(selected.map(([name, value]) => [name, value / divisor]));
  }

  function scaledFleet(ratios, scale) {
    return Object.fromEntries(Object.entries(ratios).map(([name, ratio]) => [name, ratio * scale]));
  }

  function addCompositions(left={}, right={}) {
    const combined = {...left};
    for (const [name, count] of Object.entries(right)) combined[name] = (combined[name] || 0) + count;
    return combined;
  }

  function sumCounts(counts={}) {
    return Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
  }

  function sumResources(resources={}) {
    return (Number(resources.ore) || 0) + (Number(resources.crystal) || 0) + (Number(resources.hydrogen) || 0);
  }

  function costOfFleet(composition={}) {
    const total = {ore:0, crystal:0, hydrogen:0, credits:0};
    for (const [name, count] of Object.entries(composition)) {
      const cost = combat.buildCost(name);
      if (!cost || !(count > 0)) continue;
      total.ore += count * cost.ore;
      total.crystal += count * cost.crystal;
      total.hydrogen += count * cost.hydrogen;
      total.credits += count * cost.credits;
    }
    return total;
  }

  function firstWinRound(simulation, roundLimit, confidence) {
    const initialBlockingDefenders = sumCounts(simulation.initialDefenders);
    if (!(initialBlockingDefenders > 0)) {
      const attackers = sumCounts(simulation.initialAttackers);
      return attackers > 0 ? {round:0, probability:1} : null;
    }
    for (const detail of simulation.roundDetails || []) {
      if (detail.round > roundLimit) break;
      if (detail.estimatedWinProbability >= confidence) {
        return {round:detail.round, probability:detail.estimatedWinProbability};
      }
    }
    return null;
  }

  function roundSnapshot(simulation, round) {
    if (round === 0) {
      return {
        attackers:simulation.initialAttackers,
        defenders:simulation.initialDefenders,
        attackerLosses:Object.fromEntries(Object.keys(simulation.initialAttackers).map(name => [name, 0]))
      };
    }
    const detail = (simulation.roundDetails || []).find(item => item.round === round);
    return detail || {
      attackers:simulation.remainingAttackers,
      defenders:simulation.remainingDefenders,
      attackerLosses:simulation.attackerLosses
    };
  }

  function qualifies(simulation, limit, confidence) {
    return Boolean(firstWinRound(simulation, limit, confidence));
  }

  function findMinimumCount(evaluate, qualifies, initialHigh=1) {
    let high = Math.min(MAX_SCALE, Math.max(1, Math.ceil(Number(initialHigh) || 1)));
    let low = 0;
    let highResult = evaluate(high);

    while (!qualifies(highResult) && high < MAX_SCALE) {
      low = high;
      const next = Math.min(MAX_SCALE, high * 2);
      if (!(next > high)) break;
      high = next;
      highResult = evaluate(high);
    }
    if (!qualifies(highResult)) return null;

    if (high <= Number.MAX_SAFE_INTEGER) {
      let integerLow = Math.floor(low);
      let integerHigh = Math.ceil(high);
      while (integerHigh - integerLow > 1) {
        const middle = Math.floor(integerLow + (integerHigh - integerLow) / 2);
        if (qualifies(evaluate(middle))) integerHigh = middle;
        else integerLow = middle;
      }
      return integerHigh;
    }

    // At very large counts, integer steps are smaller than Number precision.
    // Bisect the bracket by its geometric midpoint, as the Zeus optimizer does.
    if (low === 0) {
      if (qualifies(evaluate(1))) return 1;
      low = 1;
    }
    for (let iteration = 0; iteration < 128; iteration++) {
      if (high / low <= 1 + 1e-12) break;
      const middle = Math.exp((Math.log(low) + Math.log(high)) / 2);
      if (!(middle > low && middle < high)) break;
      if (qualifies(evaluate(middle))) high = middle;
      else low = middle;
    }
    return Math.ceil(high);
  }

  function findFleetForRound(input, ratios, roundLimit, confidence, cache) {
    function evaluate(scale) {
      if (!cache.has(scale)) {
        cache.set(scale, combat.simulate({
          attackers:scaledFleet(ratios, scale),
          defenders:input.defenders,
          attackerTech:input.attackerTech,
          defenderTech:input.defenderTech
        }));
      }
      return cache.get(scale);
    }

    const scale = findMinimumCount(
      evaluate,
      simulation => qualifies(simulation, roundLimit, confidence)
    );
    if (scale == null) return null;

    const fleet = scaledFleet(ratios, scale);
    const simulation = evaluate(scale);
    const win = firstWinRound(simulation, roundLimit, confidence);
    const snapshot = roundSnapshot(simulation, win.round);
    const rebuildCost = costOfFleet(snapshot.attackerLosses);
    return {
      roundLimit,
      scale,
      fleet,
      totalShips:sumCounts(fleet),
      buildCost:costOfFleet(fleet),
      estimatedLosses:snapshot.attackerLosses,
      rebuildCost,
      winRound:win.round,
      estimatedWinProbability:win.probability,
      remainingAttackers:snapshot.attackers,
      simulation
    };
  }

  function plunderPool(input={}) {
    const resources = input.resources || {};
    return {
      ore:Math.floor(Math.max(0, Number(resources.ore) || 0) * PLUNDER_SHARE),
      crystal:Math.floor(Math.max(0, Number(resources.crystal) || 0) * PLUNDER_SHARE),
      hydrogen:Math.floor(Math.max(0, Number(resources.hydrogen) || 0) * PLUNDER_SHARE)
    };
  }

  function allocatePlunder(pool={}, cargoCapacity=0) {
    const taken = {ore:0, crystal:0, hydrogen:0};
    let available = Math.max(0, Number(cargoCapacity) || 0);
    const remaining = Object.fromEntries(Object.keys(taken).map(name => [name, Math.max(0, Number(pool[name]) || 0)]));
    const total = sumResources(remaining);
    if (available >= total) return {...remaining};
    let active = Object.keys(remaining).filter(name => remaining[name] > 0);
    while (available > 1e-8 && active.length) {
      const equalShare = available / active.length;
      const smallest = active.reduce((best, name) => remaining[name] < remaining[best] ? name : best, active[0]);
      const amount = Math.min(equalShare, remaining[smallest]);
      for (const name of active) {
        const take = Math.min(amount, remaining[name]);
        taken[name] += take;
        remaining[name] -= take;
        available -= take;
      }
      active = active.filter(name => remaining[name] > 1e-8);
      if (amount < equalShare && !active.length) break;
    }
    return taken;
  }

  function winningSnapshot(simulation, roundLimit, confidence) {
    const win = firstWinRound(simulation, roundLimit, confidence);
    const round = win ? win.round : roundLimit;
    return {win, round, snapshot:roundSnapshot(simulation, round)};
  }

  function findTransportCount(input, recommendation, lockedFleet, type, pool, confidence) {
    const neededCargo = sumResources(pool);
    const roundLimit = recommendation.roundLimit;
    const cache = new Map();
    function evaluate(additional) {
      if (!cache.has(additional)) {
        const fleet = addCompositions(lockedFleet, additional > 0 ? {[type]:additional} : {});
        const simulation = combat.simulate({
          attackers:fleet,
          defenders:input.defenders,
          attackerTech:input.attackerTech,
          defenderTech:input.defenderTech
        });
        const state = winningSnapshot(simulation, roundLimit, confidence);
        const capacity = combat.cargoCapacityForSurvivors(state.snapshot.attackers);
        cache.set(additional, {additional, fleet, simulation, capacity, win:state.win, round:state.round, snapshot:state.snapshot});
      }
      return cache.get(additional);
    }

    const baseline = evaluate(0);
    if (baseline.capacity >= neededCargo - 1e-7) {
      return {...baseline, cargoTaken:allocatePlunder(pool, baseline.capacity), fullyLoaded:true};
    }
    if (!(neededCargo > 0)) return {...baseline, cargoTaken:allocatePlunder(pool, baseline.capacity), fullyLoaded:true};

    const additional = findMinimumCount(
      evaluate,
      result => result.capacity >= neededCargo - 1e-7,
      Math.ceil((neededCargo - baseline.capacity) / combat.cargoCapacity(type))
    );
    const final = evaluate(additional == null ? MAX_SCALE : additional);
    return {
      ...final,
      fullyLoaded:additional != null && final.capacity >= neededCargo - 1e-7,
      cargoTaken:allocatePlunder(pool, final.capacity)
    };
  }

  function analyze(input={}) {
    const ratios = normalizeRatios(input.ratios);
    const confidence = Math.max(0.5, Math.min(0.9999, Number(input.confidence) || DEFAULT_CLEAR_CONFIDENCE));
    const transportType = TRANSPORTS.includes(input.transportType) ? input.transportType : DEFAULT_TRANSPORT;
    const cache = new Map();
    const ineffectiveTargets = combat.ineffectiveDefenderTargets(
      scaledFleet(ratios, 1), input.defenders, input.attackerTech, input.defenderTech
    );
    const recommendations = ROUND_LIMITS.map(roundLimit => {
      const recommendation = ineffectiveTargets.length
        ? null
        : findFleetForRound(input, ratios, roundLimit, confidence, cache);
      if (!recommendation) return {
        roundLimit,
        unavailable:true,
        reason:ineffectiveTargets.length ? 'ineffective' : 'search-limit',
        ineffectiveTargets
      };
      const pool = plunderPool(input);
      const cargo = [{
        type:transportType,
        cargoPerShip:combat.cargoCapacity(transportType),
        ...findTransportCount(input, recommendation, recommendation.fleet, transportType, pool, confidence)
      }];
      return {...recommendation, cargoPool:pool, cargoRequired:sumResources(pool), cargo};
    });
    return {ratios, confidence, transportType, recommendations, ineffectiveTargets};
  }

  return {
    ROUND_LIMITS, TRANSPORTS, DEFAULT_CLEAR_CONFIDENCE, PLUNDER_SHARE, normalizeRatios, scaledFleet, costOfFleet,
    plunderPool, allocatePlunder, analyze
  };
});
