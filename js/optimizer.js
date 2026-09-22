(function (root, factory) {
  const combat = typeof module === 'object' && module.exports ? require('./combat.js') : root.SFCCombat;
  const api = factory(combat);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCOptimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (combat) {
  'use strict';

  const {simulate, initialZeusShotFactor} = combat;

  function autoRange(composition, attackerTech, defenderTech, survivalTarget=0.9999, rfSigma=0) {
    const total = Object.values(composition).reduce((sum, count) => sum + count, 0);
    const shotFactor = initialZeusShotFactor(composition);
    const center = Math.max(1, total / Math.max(1, shotFactor));
    const low = Math.max(1, center / 50);
    let high = Math.max(low * 10, center * 20);
    for (let iteration = 0; iteration < 14; iteration++) {
      const result = simulate({composition, zeusCount:high, attackerTech, defenderTech, rfSigma});
      if (result.zeusSurvival >= survivalTarget && (result.initialDSP === 0 || result.dspDestroyedFraction >= 0.999)) break;
      high *= 2;
    }
    return {lo:low, hi:high, center};
  }

  function sweep(input) {
    const pointCount = Math.max(12, Math.min(100, Number(input.points || 45)));
    const range = input.range || autoRange(input.composition, input.attackerTech, input.defenderTech, input.survivalTarget, input.rfSigma);
    const low = Math.max(1, range.lo);
    const high = Math.max(low * 1.0001, range.hi);
    const logLow = Math.log(low);
    const logHigh = Math.log(high);
    const points = [];
    for (let index = 0; index < pointCount; index++) {
      const zeusCount = Math.exp(logLow + (logHigh - logLow) * index / (pointCount - 1));
      points.push(simulate({...input, zeusCount}));
    }
    return {points, range:{lo:low, hi:high}};
  }

  function findBreakpoint(input, destructionFraction, survivalTarget, low, high) {
    function check(zeusCount) {
      const result = simulate({...input, zeusCount});
      return {
        ok:result.zeusSurvival >= survivalTarget && result.dspDestroyedFraction >= destructionFraction,
        result
      };
    }

    let upper = high;
    let upperCheck = check(upper);
    let growthSteps = 0;
    while (!upperCheck.ok && growthSteps < 20) {
      upper *= 2;
      upperCheck = check(upper);
      growthSteps++;
    }
    if (!upperCheck.ok) return null;

    let lower = Math.max(1, low);
    // Ensure low bound is infeasible; if not, shrink it.
    let lowerCheck = check(lower);
    let shrinkSteps = 0;
    while (lowerCheck.ok && lower > 1 && shrinkSteps < 20) {
      upper = lower;
      lower = Math.max(1, lower / 2);
      lowerCheck = check(lower);
      shrinkSteps++;
    }
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = Math.sqrt(lower * upper);
      const middleCheck = check(middle);
      if (middleCheck.ok) upper = middle;
      else lower = middle;
      if (upper / lower < 1.00001) break;
    }
    return check(upper).result;
  }

  function breakpointTable(input, fractions, survivalTarget, range) {
    return fractions.map(fraction => ({
      fraction,
      result:findBreakpoint(input, fraction, survivalTarget, range.lo, range.hi)
    }));
  }

  function findKnee(points, survivalTarget) {
    const feasible = (points || [])
      .filter(point => point.zeusSurvival >= survivalTarget && Number.isFinite(point.zeusCount))
      .slice()
      .sort((left, right) => left.zeusCount - right.zeusCount);
    if (feasible.length < 3) return feasible[0] || null;
    const xValues = feasible.map(point => Math.log(Math.max(1, point.zeusCount)));
    const yValues = feasible.map(point => point.dspDestroyedFraction);
    const xMin = xValues[0];
    const xMax = xValues[xValues.length - 1];
    const yMin = yValues[0];
    const yMax = yValues[yValues.length - 1];
    if (!(xMax > xMin) || !(yMax > yMin + 1e-8)) return feasible[0];
    let best = null;
    for (let index = 1; index < feasible.length - 1; index++) {
      const normalizedX = (xValues[index] - xMin) / (xMax - xMin);
      const normalizedY = (yValues[index] - yMin) / (yMax - yMin);
      const score = normalizedY - normalizedX;
      const deltaY = yValues[index + 1] - yValues[index - 1];
      const deltaX = xValues[index + 1] - xValues[index - 1];
      const gainPer10PctZeus = deltaX > 0 ? deltaY / deltaX * Math.log(1.10) : 0;
      const candidate = {...feasible[index], kneeScore:score, gainPer10PctZeus};
      if (!best || candidate.kneeScore > best.kneeScore) best = candidate;
    }
    return best || feasible[0];
  }

  function frontierMatrix(input, destructionFractions, survivalTargets, range) {
    return survivalTargets.map(survivalTarget => ({
      survivalTarget,
      rows:breakpointTable(input, destructionFractions, survivalTarget, range)
    }));
  }

  return {autoRange, sweep, findBreakpoint, breakpointTable, findKnee, frontierMatrix};
});
