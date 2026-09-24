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
  const LEFTOVER_FRACTIONS = Object.freeze([0.01, 0.03, 0.1, 0.25, 0.5]);
  const MAX_LEFTOVER_REFINEMENT_PASSES = 4;
  const MIN_ATTACK_SURVIVAL = 0.999;
  const REFINEMENT_TARGETS = Object.freeze({
    dspDestroyed:Object.freeze([0.5, 0.9, 0.95, 0.99, 0.999]),
    winProbability:Object.freeze([0.9, 0.95, 0.99, 0.999])
  });
  // Treat survival at 99.999% or better as equivalent to 100% in comparisons.
  const SURVIVAL_SATURATION = 0.99999;
  const OBJECTIVES = Object.freeze({
    dsp:{label:'DSP destroyed', value:outcome => outcome.dspDestroyed},
    hydrogen:{label:'Hydrogen raided', value:outcome => outcome.resourcesRaided.hydrogen},
    resourcesDebris:{label:'Resources raided + gross debris', value:outcome => outcome.resourcesRaided.total + outcome.debrisGenerated}
  });

  function objectiveValues(outcome) {
    return Object.fromEntries(Object.entries(OBJECTIVES).map(([key, objective]) => [key, objective.value(outcome)]));
  }

  function chosenObjectives(config) {
    const keys = Array.isArray(config.objectiveKeys) && config.objectiveKeys.length
      ? config.objectiveKeys
      : [config.objective || 'dsp'];
    return [...new Set(keys.filter(key => OBJECTIVES[key]))];
  }

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

  function survivalForComparison(survival) {
    const rate = Math.max(0, Math.min(1, Number(survival) || 0));
    return rate >= SURVIVAL_SATURATION ? 1 : rate;
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
      const outcome = {
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
        debrisOreGenerated:0,
        debrisCrystalGenerated:0,
        resourcesRaided:{ore:0, crystal:0, hydrogen:0, total:0},
        conditionalPlunder:{ore:0, crystal:0, hydrogen:0, total:0},
        waves:[],
        objectiveValue:0,
        battle:null
      };
      outcome.objectiveValues = objectiveValues(outcome);
      outcome.objectiveValue = outcome.objectiveValues[config.objective] ?? outcome.objectiveValues.dsp;
      return outcome;
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
    outcome.objectiveValues = objectiveValues(outcome);
    outcome.objectiveValue = outcome.objectiveValues[config.objective] ?? objective.value(outcome);
    return outcome;
  }

  function refineThreshold(target, config, low, high, cache, metric, threshold) {
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
      if (outcome[metric] >= threshold) {
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
    const objectiveKeys = chosenObjectives(config);
    let priorCount = 0;
    let priorOutcome = null;
    const thresholdBrackets = new Map();
    const outcomes = [];
    // Refine thresholds for each selected objective so the frontier keeps
    // useful target-level breakpoints between its logarithmic fleet samples.
    const thresholds = [
      {metric:'zeusSurvival', value:MIN_ATTACK_SURVIVAL},
      ...(objectiveKeys.includes('dsp') || objectiveKeys.includes('resourcesDebris')
        ? REFINEMENT_TARGETS.dspDestroyed.map(value => ({metric:'dspDestroyedFraction', value}))
        : []),
      ...(objectiveKeys.includes('hydrogen') || objectiveKeys.includes('resourcesDebris')
        ? REFINEMENT_TARGETS.winProbability.map(value => ({metric:'winProbability', value}))
        : [])
    ];
    for (const count of counts) {
      const outcome = evaluateTarget(target, count, config);
      cache.set(count, outcome);
      outcomes.push(outcome);
      if (priorOutcome) {
        for (const {metric, value} of thresholds) {
          const key = `${metric}:${value}`;
          if (!thresholdBrackets.has(key) && outcome[metric] >= value && priorOutcome[metric] < value) {
            thresholdBrackets.set(key, {low:priorCount, high:count, metric, value});
          }
        }
      }
      priorCount = count;
      priorOutcome = outcome;
    }
    for (const bracket of thresholdBrackets.values()) {
      outcomes.push(refineThreshold(target, config, bracket.low, bracket.high, cache, bracket.metric, bracket.value));
    }

    const unique = new Map();
    for (const outcome of outcomes) unique.set(outcome.zeusCount, outcome);
    const options = [...unique.values()].filter(outcome =>
      outcome.zeusCount <= config.availableZeus
      && outcome.zeusLosses <= config.maxExpectedLosses
      && (outcome.zeusCount === 0 || outcome.zeusSurvival >= MIN_ATTACK_SURVIVAL - 1e-12)
    );
    if (!options.some(outcome => outcome.zeusCount === 0)) options.unshift(evaluateTarget(target, 0, config));
    return pruneTargetOptions(options, objectiveKeys);
  }

  function dominates(left, right, objectiveKeys=['dsp']) {
    const noMoreZeus = left.zeusCount <= right.zeusCount;
    const noMoreLosses = left.zeusLosses <= right.zeusLosses + 1e-10;
    const noLessValue = objectiveKeys.every(key => left.objectiveValues[key]
      >= right.objectiveValues[key] - 1e-10 * Math.max(1, Math.abs(right.objectiveValues[key])));
    const leftSurvival = survivalForComparison(left.zeusSurvival);
    const rightSurvival = survivalForComparison(right.zeusSurvival);
    const noLessSurvival = leftSurvival >= rightSurvival - 1e-12;
    const strictValue = objectiveKeys.some(key => left.objectiveValues[key]
      > right.objectiveValues[key] + 1e-10 * Math.max(1, Math.abs(right.objectiveValues[key])));
    const strict = left.zeusCount < right.zeusCount || left.zeusLosses < right.zeusLosses - 1e-10
      || strictValue
      || leftSurvival > rightSurvival + 1e-12;
    return noMoreZeus && noMoreLosses && noLessValue && noLessSurvival && strict;
  }

  function pruneTargetOptions(options, objectiveKeys=['dsp']) {
    const output = [];
    for (let index = 0; index < options.length; index++) {
      if (options.some((candidate, otherIndex) => otherIndex !== index && dominates(candidate, options[index], objectiveKeys))) continue;
      output.push(options[index]);
    }
    return output.sort((left, right) => left.zeusCount - right.zeusCount || left.zeusLosses - right.zeusLosses || right.objectiveValue - left.objectiveValue);
  }

  function lowerBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBoundValue(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle] <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function lowerBoundDescending(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle] > target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function countAtLeastDescending(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle] >= target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function stateSurvival(state) {
    if (!(state.zeus > 0)) return 1;
    return survivalForComparison((state.zeus - state.losses) / state.zeus);
  }

  // Offline 2D Fenwick tree: query the best value with no more losses and
  // at least as much capped survival among states already sorted by Zeus.
  function paretoIndex(states) {
    const losses = [...new Set(states.map(state => state.losses))].sort((left, right) => left - right);
    const nodes = Array.from({length:losses.length + 1}, () => ({values:[], tree:[]}));
    for (const state of states) {
      const lossPosition = lowerBound(losses, state.losses) + 1;
      const survival = stateSurvival(state);
      for (let cursor = lossPosition; cursor < nodes.length; cursor += cursor & -cursor) {
        nodes[cursor].values.push(survival);
      }
    }
    for (let index = 1; index < nodes.length; index++) {
      const node = nodes[index];
      node.values = [...new Set(node.values)].sort((left, right) => right - left);
      node.tree = Array(node.values.length + 1).fill(-Infinity);
    }

    return {
      query(loss, survival) {
        let best = -Infinity;
        for (let cursor = upperBoundValue(losses, loss + 1e-10); cursor > 0; cursor -= cursor & -cursor) {
          const node = nodes[cursor];
          for (let inner = countAtLeastDescending(node.values, survival - 1e-12); inner > 0; inner -= inner & -inner) {
            best = Math.max(best, node.tree[inner]);
          }
        }
        return best;
      },
      update(loss, survival, value) {
        const lossPosition = lowerBound(losses, loss) + 1;
        for (let cursor = lossPosition; cursor < nodes.length; cursor += cursor & -cursor) {
          const node = nodes[cursor];
          const survivalPosition = lowerBoundDescending(node.values, survival) + 1;
          for (let inner = survivalPosition; inner < node.tree.length; inner += inner & -inner) {
            node.tree[inner] = Math.max(node.tree[inner], value);
          }
        }
      }
    };
  }

  function paretoStates(states) {
    if (states.length < 2) return states;
    states.sort((left, right) => left.zeus - right.zeus || left.losses - right.losses
      || stateSurvival(right) - stateSurvival(left) || right.value - left.value);
    const index = paretoIndex(states);
    const output = [];
    const seen = new Set();
    for (const state of states) {
      const survival = stateSurvival(state);
      const key = `${state.zeus}:${state.losses}:${survival}:${state.value}`;
      if (seen.has(key)) continue;
      if (index.query(state.losses, survival) >= state.value - 1e-10 * Math.max(1, Math.abs(state.value))) continue;
      output.push(state);
      seen.add(key);
      index.update(state.losses, survival, state.value);
    }
    return output;
  }

  // For two objectives, this index finds an earlier state with no more losses,
  // at least as much objective X, and at least as much objective Y.
  function multiObjectiveParetoIndex(states) {
    const losses = [...new Set(states.map(state => state.losses))].sort((left, right) => left - right);
    const nodes = Array.from({length:losses.length + 1}, () => ({xValues:[], tree:[]}));
    for (const state of states) {
      const lossPosition = lowerBound(losses, state.losses) + 1;
      for (let cursor = lossPosition; cursor < nodes.length; cursor += cursor & -cursor) {
        nodes[cursor].xValues.push(state.values[0]);
      }
    }
    for (let index = 1; index < nodes.length; index++) {
      const node = nodes[index];
      node.xValues = [...new Set(node.xValues)].sort((left, right) => right - left);
      node.tree = Array(node.xValues.length + 1).fill(-Infinity);
    }

    return {
      query(loss, objectiveX) {
        let bestObjectiveY = -Infinity;
        for (let cursor = upperBoundValue(losses, loss + 1e-10); cursor > 0; cursor -= cursor & -cursor) {
          const node = nodes[cursor];
          for (let inner = countAtLeastDescending(node.xValues, objectiveX); inner > 0; inner -= inner & -inner) {
            bestObjectiveY = Math.max(bestObjectiveY, node.tree[inner]);
          }
        }
        return bestObjectiveY;
      },
      update(loss, objectiveX, objectiveY) {
        const lossPosition = lowerBound(losses, loss) + 1;
        for (let cursor = lossPosition; cursor < nodes.length; cursor += cursor & -cursor) {
          const node = nodes[cursor];
          const xPosition = lowerBoundDescending(node.xValues, objectiveX) + 1;
          for (let inner = xPosition; inner < node.tree.length; inner += inner & -inner) {
            node.tree[inner] = Math.max(node.tree[inner], objectiveY);
          }
        }
      }
    };
  }

  function paretoMultiObjectiveStates(states) {
    if (states.length < 2) return states;
    states.sort((left, right) => left.zeus - right.zeus || left.losses - right.losses
      || right.values[0] - left.values[0] || right.values[1] - left.values[1]
      || stateSurvival(right) - stateSurvival(left));
    const index = multiObjectiveParetoIndex(states);
    const output = [];
    const seen = new Set();
    for (const state of states) {
      const key = `${state.zeus}:${state.losses}:${state.values[0]}:${state.values[1]}`;
      if (seen.has(key)) continue;
      const xTolerance = 1e-10 * Math.max(1, Math.abs(state.values[0]));
      const yTolerance = 1e-10 * Math.max(1, Math.abs(state.values[1]));
      if (index.query(state.losses, state.values[0] - xTolerance) >= state.values[1] - yTolerance) continue;
      output.push(state);
      seen.add(key);
      index.update(state.losses, state.values[0], state.values[1]);
    }
    return output;
  }

  function paretoObjectiveFrontier(states) {
    const sorted = states.slice().sort((left, right) => right.values[0] - left.values[0]
      || right.values[1] - left.values[1] || left.losses - right.losses
      || stateSurvival(right) - stateSurvival(left) || left.zeus - right.zeus);
    const output = [];
    let bestObjectiveY = -Infinity;
    for (const state of sorted) {
      if (bestObjectiveY === -Infinity) {
        output.push(state);
        bestObjectiveY = state.values[1];
        continue;
      }
      const tolerance = 1e-10 * Math.max(1, Math.abs(state.values[1]), Math.abs(bestObjectiveY));
      if (state.values[1] <= bestObjectiveY + tolerance) continue;
      output.push(state);
      bestObjectiveY = state.values[1];
    }
    return output.sort((left, right) => left.values[0] - right.values[0] || right.values[1] - left.values[1]);
  }

  function betterMultiObjectiveBucket(left, right, xWeight, yWeight, maxX, maxY) {
    if (!right) return true;
    const leftScore = xWeight * left.values[0] / maxX + yWeight * left.values[1] / maxY;
    const rightScore = xWeight * right.values[0] / maxX + yWeight * right.values[1] / maxY;
    if (Math.abs(leftScore - rightScore) > 1e-12) return leftScore > rightScore;
    if (left.values[0] !== right.values[0]) return left.values[0] > right.values[0];
    if (left.values[1] !== right.values[1]) return left.values[1] > right.values[1];
    if (left.losses !== right.losses) return left.losses < right.losses;
    if (stateSurvival(left) !== stateSurvival(right)) return stateSurvival(left) > stateSurvival(right);
    return left.zeus < right.zeus;
  }

  function boundedMultiObjectiveFrontier(states, maxZeus, maxLosses, limit=MAX_FRONTIER_STATES) {
    if (states.length <= limit) return {states, truncated:false};
    const bins = 32;
    let maxX = 1;
    let maxY = 1;
    for (const state of states) {
      maxX = Math.max(maxX, state.values[0]);
      maxY = Math.max(maxY, state.values[1]);
    }
    const selectors = [[1, 0], [0, 1], [0.5, 0.5], [0.75, 0.25]];
    const representatives = new Map();
    for (const state of states) {
      const zeusBin = maxZeus > 0 ? Math.min(bins - 1, Math.floor(state.zeus / maxZeus * bins)) : 0;
      const lossBin = maxLosses > 0 ? Math.min(bins - 1, Math.floor(state.losses / maxLosses * bins)) : 0;
      for (let selector = 0; selector < selectors.length; selector++) {
        const [xWeight, yWeight] = selectors[selector];
        const key = `${zeusBin}:${lossBin}:${selector}`;
        const previous = representatives.get(key);
        if (betterMultiObjectiveBucket(state, previous, xWeight, yWeight, maxX, maxY)) representatives.set(key, state);
      }
    }
    const selected = new Set(representatives.values());
    const balancedScore = state => 0.5 * state.values[0] / maxX + 0.5 * state.values[1] / maxY;
    states.sort((left, right) => balancedScore(right) - balancedScore(left)
      || left.losses - right.losses || stateSurvival(right) - stateSurvival(left) || left.zeus - right.zeus);
    for (const state of states) {
      if (selected.size >= limit) break;
      selected.add(state);
    }
    return {states:[...selected], truncated:true};
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
      if (betterFinal(state, previous)) representatives.set(key, state);
    }
    const chosen = [...representatives.values()];
    const selected = new Set(chosen);
    states.sort((left, right) => right.value - left.value || left.losses - right.losses
      || stateSurvival(right) - stateSurvival(left) || left.zeus - right.zeus);
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
    const leftSurvival = stateSurvival(left);
    const rightSurvival = stateSurvival(right);
    if (Math.abs(leftSurvival - rightSurvival) > 1e-12) return leftSurvival > rightSurvival;
    return left.zeus < right.zeus;
  }

  function refineUnusedZeus(initial, targets, optionsByTarget, config) {
    let best = initial;
    for (let pass = 0; pass < MAX_LEFTOVER_REFINEMENT_PASSES; pass++) {
      const unused = config.availableZeus - best.zeus;
      if (unused < 1) break;

      const additions = new Set([unused]);
      for (const fraction of LEFTOVER_FRACTIONS) {
        additions.add(Math.min(unused, Math.max(1, Math.ceil(config.availableZeus * fraction))));
      }
      let refined = best;

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const previous = best.choices[targetIndex];
        const candidates = new Map();
        for (const option of optionsByTarget[targetIndex]) {
          const addition = option.zeusCount - previous.zeusCount;
          if (addition > 0 && addition <= unused) candidates.set(option.zeusCount, option);
        }
        for (const addition of additions) {
          const count = previous.zeusCount + addition;
          if (count <= config.availableZeus && !candidates.has(count)) {
            candidates.set(count, evaluateTarget(targets[targetIndex], count, config));
          }
        }

        for (const [count, outcome] of candidates) {
          const addition = count - previous.zeusCount;
          const losses = best.losses - previous.zeusLosses + outcome.zeusLosses;
          if (best.zeus + addition > config.availableZeus
            || losses > config.maxExpectedLosses + 1e-9
            || outcome.zeusSurvival < MIN_ATTACK_SURVIVAL - 1e-12) continue;
          const choices = best.choices.slice();
          choices[targetIndex] = outcome;
          const candidate = {
            zeus:best.zeus + addition,
            losses,
            value:best.value - previous.objectiveValue + outcome.objectiveValue,
            choices
          };
          if (betterFinal(candidate, refined)) refined = candidate;
        }
      }

      if (refined === best) break;
      best = refined;
    }
    return best;
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
    best = refineUnusedZeus(best, targets, optionsByTarget, config);
    const allocations = targets.map((target, index) => ({
      target,
      outcome:best.choices[index] || evaluateTarget(target, 0, config)
    }));
    return {
      objective:config.objective,
      objectiveLabel:OBJECTIVES[config.objective].label,
      rfSigma:config.rfSigma,
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

  function solveFrontier(input) {
    const targets = input.targets || [];
    const requestedObjectives = input.objectives || [input.objectiveX, input.objectiveY];
    const objectiveKeys = requestedObjectives.every(Boolean) ? requestedObjectives.slice() : ['dsp', 'hydrogen'];
    if (objectiveKeys.length !== 2 || objectiveKeys[0] === objectiveKeys[1]
      || objectiveKeys.some(key => !OBJECTIVES[key])) {
      throw new Error('Choose two different supported objectives for the frontier.');
    }

    const availableZeus = Math.max(1, Math.floor(Number(input.availableZeus)));
    const maxExpectedLosses = Math.max(0, Number(input.maxExpectedLosses) || 0);
    const config = {
      availableZeus,
      maxExpectedLosses,
      objective:objectiveKeys[0],
      objectiveKeys,
      attackerTech:input.attackerTech || {weapons:20, shield:20, armor:20},
      defaultDefenderTech:input.defaultDefenderTech || {weapons:20, shield:20, armor:20},
      rfSigma:Number(input.rfSigma) || 0
    };
    const optionsByTarget = targets.map(target => targetOptions(target, config));
    let states = [{zeus:0, losses:0, values:[0, 0], choices:[]}];
    let searchTruncated = false;
    for (let index = 0; index < targets.length; index++) {
      const next = [];
      for (const state of states) {
        for (const option of optionsByTarget[index]) {
          const zeus = state.zeus + option.zeusCount;
          const losses = state.losses + option.zeusLosses;
          if (zeus > availableZeus || losses > maxExpectedLosses + 1e-9) continue;
          next.push({
            zeus,
            losses,
            values:[
              state.values[0] + option.objectiveValues[objectiveKeys[0]],
              state.values[1] + option.objectiveValues[objectiveKeys[1]]
            ],
            choices:[...state.choices, option]
          });
        }
      }
      const preBounded = boundedMultiObjectiveFrontier(next, availableZeus, maxExpectedLosses);
      states = paretoMultiObjectiveStates(preBounded.states);
      searchTruncated ||= preBounded.truncated;
      const bounded = boundedMultiObjectiveFrontier(states, availableZeus, maxExpectedLosses);
      states = bounded.states;
      searchTruncated ||= bounded.truncated;
    }

    // The DP is deliberately bounded for browser performance. Revisit the
    // objective endpoints and a balanced point, then try topping up unused
    // Zeus in small scenarios to refine those representative plans.
    const approximateFrontier = paretoObjectiveFrontier(states);
    const scalarOptionsByObjective = Object.fromEntries(objectiveKeys.map(objective => [objective,
      optionsByTarget.map(options => options.map(option => ({
        ...option,
        objectiveValue:option.objectiveValues[objective]
      })))
    ]));
    const seeds = new Set();
    if (approximateFrontier.length) {
      seeds.add(approximateFrontier[0]);
      seeds.add(approximateFrontier[approximateFrontier.length - 1]);
      let maxX = 1;
      let maxY = 1;
      for (const state of approximateFrontier) {
        maxX = Math.max(maxX, state.values[0]);
        maxY = Math.max(maxY, state.values[1]);
      }
      let balanced = approximateFrontier[0];
      let balancedScore = -Infinity;
      for (const state of approximateFrontier) {
        const score = state.values[0] / maxX + state.values[1] / maxY;
        if (score > balancedScore) {
          balanced = state;
          balancedScore = score;
        }
      }
      seeds.add(balanced);
    }

    const refinedStates = [];
    for (const seed of seeds) {
      for (let objectiveIndex = 0; objectiveIndex < objectiveKeys.length; objectiveIndex++) {
        const objective = objectiveKeys[objectiveIndex];
        const scalarSeed = {
          ...seed,
          value:seed.values[objectiveIndex],
          choices:seed.choices.map(outcome => ({
            ...outcome,
            objectiveValue:outcome.objectiveValues[objective]
          }))
        };
        const refined = refineUnusedZeus(scalarSeed, targets, scalarOptionsByObjective[objective], {...config, objective});
        refined.values = objectiveKeys.map(key => refined.choices.reduce((sum, outcome) => sum + outcome.objectiveValues[key], 0));
        refinedStates.push(refined);
      }
    }
    if (refinedStates.length) states = paretoMultiObjectiveStates([...states, ...refinedStates]);

    const finalFrontier = paretoObjectiveFrontier(states);
    const points = finalFrontier.map((state, index) => ({
      index,
      objectiveValues:Object.fromEntries(objectiveKeys.map((key, objectiveIndex) => [key, state.values[objectiveIndex]])),
      zeusCommitted:state.zeus,
      unusedZeus:Math.max(0, availableZeus - state.zeus),
      expectedZeusLosses:state.losses,
      expectedLossFraction:availableZeus > 0 ? state.losses / availableZeus : 0,
      allocations:targets.map((target, targetIndex) => ({target, outcome:state.choices[targetIndex]}))
    }));

    return {
      objectiveKeys,
      objectives:objectiveKeys.map(key => ({key, label:OBJECTIVES[key].label})),
      availableZeus,
      maxExpectedLosses,
      rfSigma:config.rfSigma,
      points,
      searchTruncated
    };
  }

  return {OBJECTIVES, REFINEMENT_TARGETS, MIN_ATTACK_SURVIVAL, parseLocation, expectedLossLimit, survivalForComparison, candidateCounts, expectedWinProbability:plunder.expectedWinProbability, evaluateTarget, targetOptions, refineUnusedZeus, solve, solveFrontier};
});
