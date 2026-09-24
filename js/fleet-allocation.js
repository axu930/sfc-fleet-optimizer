(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const combat = typeof module === 'object' && module.exports ? require('./combat.js') : root.SFCCombat;
  const plunder = typeof module === 'object' && module.exports ? require('./plunder.js') : root.SFCPlunder;
  const api = factory(units, combat, plunder);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCFleetAllocation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units, combat, plunder) {
  'use strict';

  const MAX_FRONTIER_STATES = 5_000;
  const CANDIDATE_POINTS = 64;
  const WIN_REFINEMENT_TARGETS = [0.5, 0.9, 0.95, 0.99, 0.999];
  const OBJECTIVES = Object.freeze({
    dsp:{label:'DSP destroyed', value:outcome => outcome.dspDestroyed},
    hydrogen:{label:'Hydrogen raided', value:outcome => outcome.resourcesRaided.hydrogen},
    resourcesDebris:{label:'Resources raided + gross debris', value:outcome => outcome.resourcesRaided.total + outcome.debrisGenerated}
  });

  function parseLocation(value) {
    const match = String(value || '').trim().match(/^\[\s*(\d{1,3})\s*:\s*(\d{1,3})\s*:\s*(\d{1,2})\s*\]$/);
    if (!match) return null;
    const galaxy = Number(match[1]);
    const system = Number(match[2]);
    const planet = Number(match[3]);
    if (galaxy < 1 || galaxy > 100 || system < 1 || system > 500 || planet < 1 || planet > 15) return null;
    return {galaxy, system, planet, normalized:`[${galaxy}:${system}:${planet}]`};
  }

  function expectedLossLimit(availableZeus, enteredPercent) {
    const parsed = Number(enteredPercent);
    const percent = Number.isFinite(parsed) && parsed >= 0 ? Math.min(100, parsed) : 0.1;
    return Math.max(0, availableZeus * percent / 100);
  }

  function candidateCounts(maximum, points=CANDIDATE_POINTS) {
    const max = Math.max(1, Math.floor(Number(maximum)));
    const values = new Set([1, max]);
    if (max <= 96) {
      for (let count = 1; count <= max; count++) values.add(count);
    } else {
      const logMax = Math.log(max);
      for (let index = 0; index < points; index++) {
        const value = Math.exp(logMax * index / (points - 1));
        values.add(Math.max(1, Math.min(max, Math.floor(value))));
      }
    }
    return [...values].sort((left, right) => left - right);
  }

  function isAttackerWin(result) {
    if (!result || !(result.zeusCount > 0) || !(result.zeusCount - result.zeusLosses > 0)) return false;
    return Object.entries(result.defenders || {}).every(([name, count]) =>
      name === 'Hephaestus' || !(count > 1e-10)
    );
  }

  function evaluateTarget(target, zeusCount, config) {
    if (!(zeusCount > 0)) {
      return {
        targetId:target.id,
        location:target.location,
        zeusCount:0,
        zeusLosses:0,
        zeusLossFraction:0,
        zeusSurvival:1,
        winProbability:0,
        definiteWin:false,
        dspDestroyed:0,
        dspDestroyedFraction:0,
        debrisGenerated:0,
        resourcesRaided:{ore:0, crystal:0, hydrogen:0, total:0},
        conditionalPlunder:{ore:0, crystal:0, hydrogen:0, total:0},
        waves:[],
        objectiveValue:0,
        battle:null
      };
    }

    const battle = combat.simulate({
      composition:target.composition || {},
      zeusCount,
      attackerTech:config.attackerTech,
      defenderTech:target.defenderTech || config.defaultDefenderTech,
      rfSigma:config.rfSigma || 0
    });
    const winProbability = plunder.expectedWinProbability(battle);
    const noDefenses = !plunder.hasDefenses(target.composition);
    const calculatedPlunder = plunder.expectedPlunder(target.resources, winProbability, noDefenses);
    const resourcesRaided = calculatedPlunder.resources;
    resourcesRaided.total = resourcesRaided.ore + resourcesRaided.crystal + resourcesRaided.hydrogen;
    const objective = OBJECTIVES[config.objective] || OBJECTIVES.dsp;
    const outcome = {
      targetId:target.id,
      location:target.location,
      zeusCount,
      zeusLosses:battle.zeusLosses,
      zeusLossFraction:battle.zeusLossFraction,
      zeusSurvival:battle.zeusSurvival,
      winProbability,
      definiteWin:isAttackerWin(battle),
      noDefenses,
      dspDestroyed:battle.destroyedDSP,
      dspDestroyedFraction:battle.dspDestroyedFraction,
      debrisGenerated:battle.debrisGenerated,
      debrisOreGenerated:battle.debrisOreGenerated,
      debrisCrystalGenerated:battle.debrisCrystalGenerated,
      resourcesRaided,
      conditionalPlunder:{
        ore:calculatedPlunder.conditionalWaves.reduce((sum, wave) => sum + wave.ore, 0),
        crystal:calculatedPlunder.conditionalWaves.reduce((sum, wave) => sum + wave.crystal, 0),
        hydrogen:calculatedPlunder.conditionalWaves.reduce((sum, wave) => sum + wave.hydrogen, 0),
        total:calculatedPlunder.conditionalWaves.reduce((sum, wave) => sum + wave.total, 0)
      },
      waves:calculatedPlunder.conditionalWaves,
      objectiveValue:0,
      battle
    };
    outcome.objectiveValue = objective.value(outcome);
    return outcome;
  }

  function refineWinThreshold(target, config, low, high, cache, probabilityTarget) {
    let lower = low;
    let upper = high;
    let best = cache.get(upper) || evaluateTarget(target, upper, config);
    cache.set(upper, best);
    for (let iteration = 0; iteration < 64 && upper - lower > 1; iteration++) {
      const middle = Math.floor(lower + (upper - lower) / 2);
      if (middle <= lower || middle >= upper) break;
      let outcome = cache.get(middle);
      if (!outcome) {
        outcome = evaluateTarget(target, middle, config);
        cache.set(middle, outcome);
      }
      if (outcome.winProbability >= probabilityTarget) {
        upper = middle;
        best = outcome;
      } else {
        lower = middle;
      }
    }
    return best;
  }

  function targetOptions(target, config) {
    const cache = new Map();
    const counts = candidateCounts(config.availableZeus);
    let priorCount = 0;
    let priorOutcome = null;
    const thresholdBrackets = new Map();
    const outcomes = [];
    for (const count of counts) {
      const outcome = evaluateTarget(target, count, config);
      cache.set(count, outcome);
      outcomes.push(outcome);
      if (priorOutcome) {
        for (const targetProbability of WIN_REFINEMENT_TARGETS) {
          if (!thresholdBrackets.has(targetProbability) && outcome.winProbability >= targetProbability && priorOutcome.winProbability < targetProbability) {
            thresholdBrackets.set(targetProbability, [priorCount, count]);
          }
        }
      }
      priorCount = count;
      priorOutcome = outcome;
    }
    for (const [targetProbability, bracket] of thresholdBrackets) {
      outcomes.push(refineWinThreshold(target, config, bracket[0], bracket[1], cache, targetProbability));
    }

    const unique = new Map();
    for (const outcome of outcomes) unique.set(outcome.zeusCount, outcome);
    const options = [...unique.values()].filter(outcome =>
      outcome.zeusCount <= config.availableZeus && outcome.zeusLosses <= config.maxExpectedLosses
    );
    if (!options.some(outcome => outcome.zeusCount === 0)) options.unshift(evaluateTarget(target, 0, config));
    return pruneTargetOptions(options);
  }

  function dominates(left, right) {
    const noMoreZeus = left.zeusCount <= right.zeusCount;
    const noMoreLosses = left.zeusLosses <= right.zeusLosses + 1e-10;
    const noLessValue = left.objectiveValue >= right.objectiveValue - 1e-10 * Math.max(1, Math.abs(right.objectiveValue));
    const strict = left.zeusCount < right.zeusCount || left.zeusLosses < right.zeusLosses - 1e-10 || left.objectiveValue > right.objectiveValue + 1e-10 * Math.max(1, Math.abs(right.objectiveValue));
    return noMoreZeus && noMoreLosses && noLessValue && strict;
  }

  function pruneTargetOptions(options) {
    const output = [];
    for (let index = 0; index < options.length; index++) {
      if (options.some((candidate, otherIndex) => otherIndex !== index && dominates(candidate, options[index]))) continue;
      output.push(options[index]);
    }
    return output.sort((left, right) => left.zeusCount - right.zeusCount || left.zeusLosses - right.zeusLosses || right.objectiveValue - left.objectiveValue);
  }

  function upperBound(tree, index) {
    let maximum = -Infinity;
    for (let cursor = index; cursor > 0; cursor -= cursor & -cursor) maximum = Math.max(maximum, tree[cursor]);
    return maximum;
  }

  function updateBound(tree, index, value) {
    for (let cursor = index; cursor < tree.length; cursor += cursor & -cursor) tree[cursor] = Math.max(tree[cursor], value);
  }

  function paretoStates(states) {
    if (states.length < 2) return states;
    const losses = [...new Set(states.map(state => state.losses))].sort((left, right) => left - right);
    const lossIndex = new Map(losses.map((loss, index) => [loss, index + 1]));
    const tree = Array(losses.length + 1).fill(-Infinity);
    states.sort((left, right) => left.zeus - right.zeus || left.losses - right.losses || right.value - left.value);
    const output = [];
    for (const state of states) {
      const index = lossIndex.get(state.losses);
      if (upperBound(tree, index) >= state.value - 1e-10 * Math.max(1, Math.abs(state.value))) continue;
      output.push(state);
      updateBound(tree, index, state.value);
    }
    return output;
  }

  function boundedFrontier(states, maxZeus, maxLosses, limit=MAX_FRONTIER_STATES) {
    if (states.length <= limit) return {states, truncated:false};
    const bins = 32;
    const representatives = new Map();
    for (const state of states) {
      const zeusBin = maxZeus > 0 ? Math.min(bins - 1, Math.floor(state.zeus / maxZeus * bins)) : 0;
      const lossBin = maxLosses > 0 ? Math.min(bins - 1, Math.floor(state.losses / maxLosses * bins)) : 0;
      const key = `${zeusBin}:${lossBin}`;
      const previous = representatives.get(key);
      if (!previous || state.value > previous.value || (state.value === previous.value && (state.losses < previous.losses || (state.losses === previous.losses && state.zeus < previous.zeus)))) representatives.set(key, state);
    }
    const chosen = [...representatives.values()];
    const selected = new Set(chosen);
    states.sort((left, right) => right.value - left.value || left.losses - right.losses || left.zeus - right.zeus);
    for (const state of states) {
      if (selected.size >= limit) break;
      selected.add(state);
    }
    return {states:[...selected], truncated:true};
  }

  function betterFinal(left, right) {
    if (!right) return true;
    const tolerance = 1e-10 * Math.max(1, Math.abs(left.value), Math.abs(right.value));
    if (left.value > right.value + tolerance) return true;
    if (left.value < right.value - tolerance) return false;
    if (left.losses !== right.losses) return left.losses < right.losses;
    return left.zeus < right.zeus;
  }

  function solve(input) {
    const targets = input.targets || [];
    const availableZeus = Math.max(1, Math.floor(Number(input.availableZeus)));
    const maxExpectedLosses = Math.max(0, Number(input.maxExpectedLosses) || 0);
    const config = {
      availableZeus,
      maxExpectedLosses,
      objective:OBJECTIVES[input.objective] ? input.objective : 'dsp',
      attackerTech:input.attackerTech || {weapons:20, shield:20, armor:20},
      defaultDefenderTech:input.defaultDefenderTech || {weapons:20, shield:20, armor:20},
      rfSigma:Number(input.rfSigma) || 0
    };
    const optionsByTarget = targets.map(target => targetOptions(target, config));
    let states = [{zeus:0, losses:0, value:0, choices:[]}];
    let searchTruncated = false;
    for (let index = 0; index < targets.length; index++) {
      const next = [];
      for (const state of states) {
        for (const option of optionsByTarget[index]) {
          const zeus = state.zeus + option.zeusCount;
          const losses = state.losses + option.zeusLosses;
          if (zeus > availableZeus || losses > maxExpectedLosses + 1e-9) continue;
          next.push({zeus, losses, value:state.value + option.objectiveValue, choices:[...state.choices, option]});
        }
      }
      const preBounded = boundedFrontier(next, availableZeus, maxExpectedLosses);
      states = paretoStates(preBounded.states);
      searchTruncated ||= preBounded.truncated;
      const bounded = boundedFrontier(states, availableZeus, maxExpectedLosses);
      states = bounded.states;
      searchTruncated ||= bounded.truncated;
    }
    let best = null;
    for (const state of states) if (betterFinal(state, best)) best = state;
    best ||= {zeus:0, losses:0, value:0, choices:targets.map(target => evaluateTarget(target, 0, config))};
    const allocations = targets.map((target, index) => ({
      target,
      outcome:best.choices[index] || evaluateTarget(target, 0, config)
    }));
    return {
      objective:config.objective,
      objectiveLabel:OBJECTIVES[config.objective].label,
      availableZeus,
      zeusCommitted:best.zeus,
      unusedZeus:Math.max(0, availableZeus - best.zeus),
      expectedZeusLosses:best.losses,
      expectedLossFraction:availableZeus > 0 ? best.losses / availableZeus : 0,
      maxExpectedLosses,
      totalObjectiveValue:best.value,
      allocations,
      candidateCounts:optionsByTarget.map(options => options.length),
      searchTruncated
    };
  }

  return {OBJECTIVES, parseLocation, expectedLossLimit, candidateCounts, expectedWinProbability:plunder.expectedWinProbability, evaluateTarget, targetOptions, solve};
});
