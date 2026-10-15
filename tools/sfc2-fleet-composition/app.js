(function () {
  'use strict';

  const combat = window.SFC2Combat;
  const optimizer = window.SFC2Optimizer;
  const units = window.SFCUnits;
  const reportParser = window.SFCBattleReportParser;
  const charts = window.SFCSvgCharts;
  const $ = selector => document.querySelector(selector);
  const inputStatus = $('#inputStatus');
  const results = $('#results');
  const recommendations = $('#recommendations');
  const waveTwoRecommendations = $('#waveTwoRecommendations');
  const costTradeoffChart = $('#costTradeoffChart');
  const costTradeoffDetails = $('#costTradeoffDetails');
  const costTradeoffStatus = $('#costTradeoffStatus');
  let currentComparisons = null;
  let lastCalculation = null;
  let tradeoffPointByKey = new Map();
  let selectedTradeoffKey = null;
  let displayedTradeoffPoint = null;
  let tradeoffWeights = {ore:1, crystal:1.5, hydrogen:3};
  let calculationSequence = 0;
  let mixSequence = 1;
  let mixes = [{id:mixSequence++, name:'Mix 1', ratios:{}}];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }

  function renderUnitInputs(container, names, role, values={}, mixId=null) {
    container.innerHTML = names.map(name => {
      const unit = combat.UNITS[name];
      const attributes = `${Math.round(unit.weapon)} weapon · ${units.formatCount(unit.hull, 'commas')} hull · ${units.formatCount(unit.shield, 'commas')} shield`;
      const cargo = combat.cargoCapacity(name) > 0 ? ` · ${units.formatCount(combat.cargoCapacity(name), 'commas')} cargo` : '';
      const label = role === 'ratio' ? 'Ratio weight' : 'Defender count';
      const type = role === 'ratio' ? 'number' : 'text';
      const step = role === 'ratio' ? ' step="1" min="0" max="1000000000"' : ' inputmode="decimal"';
      return `<label class="sfc2-unit-row">
        <span class="sfc2-unit-name">${escapeHtml(name)}<small>${attributes}${cargo}</small></span>
        <input type="${type}"${step} value="${role === 'ratio' ? escapeHtml(values[name] ?? 0) : '0'}" data-role="${role}" data-unit="${escapeHtml(name)}"${mixId == null ? '' : ` data-mix-id="${mixId}"`} aria-label="${label}: ${escapeHtml(name)}">
      </label>`;
    }).join('');
  }

  function snapshotMixes() {
    return [...document.querySelectorAll('[data-mix-card]')].map((card, index) => {
      const id = Number(card.dataset.mixCard);
      const ratios = {};
      card.querySelectorAll('[data-role="ratio"]').forEach(input => { ratios[input.dataset.unit] = input.value; });
      return {
        id,
        name:card.querySelector('[data-mix-name]').value.trim() || `Mix ${index + 1}`,
        ratios,
        collapsed:!card.querySelector('[data-mix-collapse]').open
      };
    });
  }

  function renderMixes() {
    $('#fleetMixList').innerHTML = mixes.map((mix, index) => `<section class="sfc2-mix-card" data-mix-card="${mix.id}">
      <div class="sfc2-mix-head">
        <label>Mix name <input type="text" maxlength="40" data-mix-name value="${escapeHtml(mix.name)}"></label>
        <button class="ghost compact-button" type="button" data-remove-mix="${mix.id}" aria-label="Remove ${escapeHtml(mix.name)}" ${mixes.length === 1 ? 'disabled' : ''}>Remove</button>
      </div>
      <details class="sfc2-mix-collapse" data-mix-collapse ${mix.collapsed ? '' : 'open'}>
        <summary>Fleet composition</summary>
        <div class="sfc2-mix-ship-grid" id="mix-ratios-${mix.id}"></div>
      </details>
    </section>`).join('');
    mixes.forEach(mix => renderUnitInputs($(`#mix-ratios-${mix.id}`), combat.ATTACKER_SHIPS, 'ratio', mix.ratios, mix.id));
  }

  renderMixes();
  renderUnitInputs($('#defenderShipInputs'), combat.DEFENDER_SHIPS, 'defender');
  renderUnitInputs($('#defenderDefenseInputs'), combat.DEFENSES, 'defender');

  function parseCount(raw, label) {
    const value = String(raw || '').replace(/,/g, '').trim();
    if (!value) return 0;
    const match = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-zA-Z]+)?$/i);
    if (!match) throw new Error(`${label} must be a non-negative number (for example 250000, 1.2m, or 3e6).`);
    const base = Number(match[1]);
    const power = match[2] ? units.countSuffixPower(match[2]) : 0;
    if (!Number.isFinite(base) || base < 0 || power == null) throw new Error(`${label} is not a valid count.`);
    const result = base * Math.pow(10, power);
    if (!Number.isFinite(result)) throw new Error(`${label} is too large to calculate.`);
    return result;
  }

  function readUnitInputs(role) {
    const output = {};
    document.querySelectorAll(`[data-role="${role}"]`).forEach(input => {
      const name = input.dataset.unit;
      const value = role === 'ratio' ? Number(input.value) : parseCount(input.value, name);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be zero or a positive number.`);
      if (role === 'ratio' && (!Number.isInteger(value) || value > 1_000_000_000)) throw new Error(`${name} ratio must be a whole number from 0 to 1,000,000,000.`);
      if (role === 'defender' && !Number.isInteger(value)) throw new Error(`${name} defender count must be a whole number of ships or defenses.`);
      if (value > 0) output[name] = value;
    });
    return output;
  }

  function readTech(prefix) {
    const tech = {};
    for (const [key, suffix] of [['weapons','Weapons'], ['shield','Shield'], ['armor','Armor']]) {
      const value = Number($(`#${prefix}${suffix}`).value);
      if (!Number.isInteger(value) || value < 0 || value > 1_000_000) throw new Error(`${prefix === 'attacker' ? 'Your' : 'Defender'} ${suffix} tech must be a whole number from 0 to 1,000,000.`);
      tech[key] = value;
    }
    return tech;
  }

  function formatCount(value) {
    return units.formatCount(Number(value) || 0, 'abbrev-up');
  }

  function formatResource(value) {
    return formatCount(value);
  }

  function formatCost(cost, separateLines=false) {
    const pieces = [
      `${formatResource(cost.ore)} Ore`,
      `${formatResource(cost.crystal)} Cry`,
      `${formatResource(cost.hydrogen)} Hyd`
    ];
    if (cost.credits > 0) pieces.push(`${formatResource(cost.credits)} Credits`);
    return pieces.map(escapeHtml).join(separateLines ? '<br>' : ' · ');
  }

  function formatComposition(composition, includeZeros=false) {
    const rows = Object.entries(composition || {})
      .filter(([, count]) => includeZeros || count > 1e-8)
      .map(([name, count]) => `${escapeHtml(name)} ${formatCount(count)}`);
    return rows.length ? rows.join('<br>') : 'None';
  }

  function plainCount(value) {
    return Math.ceil(Math.max(0, Number(value) || 0)).toLocaleString('en-US', {
      useGrouping:false,
      maximumFractionDigits:0
    });
  }

  async function copyText(button, value, defaultTitle='Copy exact ship count') {
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch (error) { /* Fall through to the legacy copy path. */ }
    if (!copied) {
      try {
        const fallback = document.createElement('textarea');
        fallback.value = value;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        copied = document.execCommand('copy');
        fallback.remove();
      } catch (error) {
        copied = false;
      }
    }
    const icon = button.querySelector('[aria-hidden="true"]');
    const originalText = button.dataset.originalText || button.textContent;
    if (!button.dataset.originalText) button.dataset.originalText = originalText;
    if (icon) icon.textContent = copied ? '✓' : '!';
    else button.textContent = copied ? 'Copied' : originalText;
    button.classList.toggle('copied', copied);
    button.title = copied ? 'Copied' : defaultTitle;
    if (copied) window.setTimeout(() => {
      if (!button.isConnected) return;
      const currentIcon = button.querySelector('[aria-hidden="true"]');
      if (currentIcon) currentIcon.textContent = '⧉';
      else button.textContent = button.dataset.originalText || originalText;
      button.classList.remove('copied');
      button.title = defaultTitle;
    }, 1100);
  }

  function copyFleetCount(button) {
    return copyText(button, button.dataset.copyCount);
  }

  function fleetSignature(fleet) {
    return Object.entries(fleet || {})
      .filter(([, count]) => Number(count) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => name + ':' + Math.ceil(Number(count)).toString())
      .join('|');
  }

  function simulationWinRound(simulation, confidence) {
    const defenderCount = Object.values(simulation?.initialDefenders || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const attackerCount = Object.values(simulation?.initialAttackers || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
    if (!(defenderCount > 0)) return attackerCount > 0 ? 0 : null;
    const clear = (simulation?.roundDetails || []).find(detail => detail.estimatedWinProbability >= confidence);
    return clear ? clear.round : null;
  }

  function tradeoffPointFromModel(mix, mixIndex, model, roundLimit=null) {
    const cargo = model.cargo?.[0];
    const fleet = cargo?.fleet || model.fleet || {};
    const simulation = cargo?.simulation || model.simulation;
    const losses = cargo?.snapshot?.attackerLosses || model.estimatedLosses || simulation?.attackerLosses || {};
    return {
      key:mixIndex + ':' + fleetSignature(fleet),
      mix,
      mixIndex,
      scale:Number(model.scale) || 1,
      combatFleet:model.combatFleet || model.fleet || {},
      fleet,
      losses,
      simulation,
      winRound:simulationWinRound(simulation, model.confidence || optimizer.DEFAULT_CLEAR_CONFIDENCE),
      buildCost:optimizer.costOfFleet(fleet),
      rebuildCost:optimizer.costOfFleet(losses),
      roundLimits:roundLimit == null ? [] : [roundLimit],
      sampledIntervals:[]
    };
  }

  function buildTradeoffData(mixInput, mix, result, mixIndex) {
    const pointsByFleet = new Map();
    const anchors = new Map();
    const cacheByCombatFleet = new Map();
    const missing = [];

    function register(point, roundLimit=null, interval=null) {
      let stored = pointsByFleet.get(point.key);
      if (!stored) {
        stored = point;
        pointsByFleet.set(point.key, stored);
      }
      if (roundLimit != null && !stored.roundLimits.includes(roundLimit)) stored.roundLimits.push(roundLimit);
      if (interval && !stored.sampledIntervals.includes(interval)) stored.sampledIntervals.push(interval);
      return stored;
    }

    for (const roundLimit of [6, 5, 4, 3]) {
      const recommendation = result.recommendations.find(item => item.roundLimit === roundLimit);
      if (!recommendation || recommendation.unavailable || !recommendation.cargo?.[0]) {
        missing.push({roundLimit, reason:recommendation?.reason || 'unavailable'});
        continue;
      }
      const point = register(tradeoffPointFromModel(mix, mixIndex, recommendation, roundLimit), roundLimit);
      anchors.set(roundLimit, {recommendation, point});
      cacheByCombatFleet.set(fleetSignature(recommendation.fleet), {point});
    }

    const segments = [];
    const orderedLimits = [6, 5, 4, 3];
    for (let index = 0; index < orderedLimits.length - 1; index++) {
      const upperLimit = orderedLimits[index];
      const lowerLimit = orderedLimits[index + 1];
      const upperAnchor = anchors.get(upperLimit);
      const lowerAnchor = anchors.get(lowerLimit);
      if (!upperAnchor || !lowerAnchor) continue;
      const lowerScale = Math.min(upperAnchor.recommendation.scale, lowerAnchor.recommendation.scale);
      const upperScale = Math.max(upperAnchor.recommendation.scale, lowerAnchor.recommendation.scale);
      const interval = upperLimit + '–' + lowerLimit + ' round thresholds';
      const segment = [upperAnchor.point];
      for (const scale of optimizer.intermediateScales(lowerScale, upperScale, 2)) {
        const sampledCombatFleet = Object.fromEntries(Object.entries(result.ratios).map(([name, ratio]) => [name, ratio * scale]));
        const combatKey = fleetSignature(sampledCombatFleet);
        let cached = cacheByCombatFleet.get(combatKey);
        if (!cached) {
          const model = optimizer.analyzeAtScale(mixInput, result.ratios, scale);
          const point = tradeoffPointFromModel(mix, mixIndex, model);
          cached = {model, point:register(point, null, interval)};
          cacheByCombatFleet.set(combatKey, cached);
        } else if (cached.point) {
          register(cached.point, null, interval);
        } else {
          cached.point = register(tradeoffPointFromModel(mix, mixIndex, cached.model), null, interval);
        }
        segment.push(cached.point);
      }
      segment.push(lowerAnchor.point);
      const uniqueSegment = [...new Map(segment.map(point => [point.key, point])).values()]
        .sort((left, right) => left.scale - right.scale);
      segments.push(uniqueSegment);
    }

    return {
      mix,
      mixIndex,
      points:[...pointsByFleet.values()],
      segments,
      missing
    };
  }

  function renderAttackingFleetCell(recommendation) {
    const ships = Object.entries(recommendation.fleet || {}).filter(([, count]) => count > 1e-8);
    const breakdown = ships.map(([name, count]) => {
      const exact = plainCount(count);
      return `<span class="sfc2-attack-fleet-line">
        <span>${escapeHtml(name)} ${formatCount(count)}</span>
        <button class="copy-count-button" type="button" data-copy-count="${exact}" aria-label="Copy exact ${escapeHtml(name)} count" title="Copy exact ship count"><span aria-hidden="true">⧉</span></button>
      </span>`;
    }).join('');
    const transport = recommendation.cargo?.[0];
    const transportCount = Math.max(0, Number(transport?.additional) || 0);
    const transportLine = transport ? `<span class="sfc2-attack-fleet-line">
      <span>${escapeHtml(transport.type)} transport ${formatCount(transportCount)}</span>
      <button class="copy-count-button" type="button" data-copy-count="${plainCount(transportCount)}" aria-label="Copy exact ${escapeHtml(transport.type)} transport count" title="Copy exact ship count"><span aria-hidden="true">⧉</span></button>
    </span>` : '';
    return `<div class="sfc2-attack-fleet"><strong>${formatCount(recommendation.totalShips + transportCount)} total</strong>${breakdown}${transportLine}</div>`;
  }

  function renderResultRow(mix, recommendation, includeRoundLimit) {
    const ineffective = recommendation.reason === 'ineffective';
    if (recommendation.unavailable) {
      return `<tr class="${ineffective ? 'sfc2-result-ineffective' : 'sfc2-result-unavailable'}">
        <th scope="row"><strong>${escapeHtml(mix.name)}</strong></th>
        ${includeRoundLimit ? `<td>${recommendation.roundLimit} rounds</td>` : ''}
        <td class="sfc2-attack-ships-cell">—</td><td>—</td><td>—</td><td>—</td>
      </tr>`;
    }
    const transportInclusiveLosses = recommendation.cargo?.[0]?.snapshot?.attackerLosses || recommendation.estimatedLosses;
    const losses = Object.values(transportInclusiveLosses).reduce((sum, count) => sum + count, 0);
    const rebuildCost = optimizer.costOfFleet(transportInclusiveLosses);
    return `<tr>
      <th scope="row"><strong>${escapeHtml(mix.name)}</strong></th>
      ${includeRoundLimit ? `<td>${recommendation.roundLimit} rounds</td>` : ''}
      <td class="sfc2-attack-ships-cell">${renderAttackingFleetCell(recommendation)}</td>
      <td>${formatCost(recommendation.buildCost, true)}</td>
      <td>${formatCount(losses)}<small>${formatComposition(transportInclusiveLosses)}</small></td>
      <td>${formatCost(rebuildCost, true)}</td>
    </tr>`;
  }

  function renderComparisonTable(comparisons, roundLimit) {
    const includeRoundLimit = comparisons.length === 1;
    const rows = comparisons.flatMap(comparison =>
      comparison.result.recommendations
        .filter(recommendation => recommendation.roundLimit === roundLimit)
        .map(recommendation => renderResultRow(comparison.mix, recommendation, includeRoundLimit))
    ).join('');
    return `<table class="sfc2-results-table${includeRoundLimit ? ' sfc2-single-mix' : ''}">
      <thead><tr><th scope="col">Fleet mix</th>${includeRoundLimit ? '<th scope="col">Round limit</th>' : ''}<th scope="col">Attack ships</th><th scope="col">Fleet build cost</th><th scope="col">Expected losses</th><th scope="col">Rebuild cost</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderSummary(comparisons, roundLimit) {
    const ineffective = comparisons
      .map(({mix, result}) => ({mix, targets:result.ineffectiveTargets}))
      .filter(item => item.targets.length);
    if (ineffective.length === comparisons.length) {
      return `No fleet mix can break through: ${ineffective.map(item => `${item.mix.name} cannot damage ${item.targets.join(', ')}`).join('; ')} under the 1% shield ineffectiveness rule. Adding ships in the same ratios will not help; adjust the mix or attacker Weapons Tech.`;
    }
    if (ineffective.length) {
      return `Ineffective mixes under the 1% shield rule: ${ineffective.map(item => `${item.mix.name} vs ${item.targets.join(', ')}`).join('; ')}. Adjust those mixes or attacker Weapons Tech.`;
    }
    const noSolution = comparisons.filter(({result}) => {
      const recommendation = result.recommendations.find(item => item.roundLimit === roundLimit);
      return !recommendation || recommendation.unavailable;
    });
    if (noSolution.length === comparisons.length) {
      return `No modeled solution found for any fleet mix within ${roundLimit} rounds at the 99.9% clear target. Try different ratios.`;
    }
    return `Fleet sizes target ${Math.round(optimizer.DEFAULT_CLEAR_CONFIDENCE * 1000) / 10}% clear confidence · cargo uses ${Math.round(optimizer.PLUNDER_SHARE * 100)}% of visible resources`;
  }

  function renderSelectedResults(comparisons) {
    const roundLimit = Number($('#roundFilter').value);
    const hasIneffectiveMix = comparisons.some(item => item.result.ineffectiveTargets.length);
    $('#resultSummary').classList.toggle('sfc2-ineffectiveness-summary', hasIneffectiveMix);
    $('#resultSummary').textContent = renderSummary(comparisons, roundLimit);
    recommendations.innerHTML = renderComparisonTable(comparisons, roundLimit);
    const waveTwoComparisons = comparisons.map(({mix, waveTwoResult}) => {
      const recommendation = waveTwoResult.recommendations.find(item => item.roundLimit === roundLimit);
      return {mix, result:{recommendations:[recommendation || {roundLimit, unavailable:true}]}};
    });
    waveTwoRecommendations.innerHTML = renderComparisonTable(waveTwoComparisons, roundLimit);
    renderCostTradeoff(comparisons);
  }

  function readCostWeights() {
    const weights = {};
    for (const [name, id] of [['ore', 'costWeightOre'], ['crystal', 'costWeightCrystal'], ['hydrogen', 'costWeightHydrogen']]) {
      const raw = document.getElementById(id).value.trim();
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < 0) throw new Error(name[0].toUpperCase() + name.slice(1) + ' weight must be a number that is zero or greater.');
      weights[name] = value;
    }
    if (!(weights.ore > 0 || weights.crystal > 0 || weights.hydrogen > 0)) {
      throw new Error('At least one Ore-equivalent weight must be greater than zero.');
    }
    return weights;
  }

  function tradeoffRoundLabel(point) {
    if (point.winRound === 0) return 'No defender targets';
    if (point.winRound == null) return 'No 99.9% clear within 6 rounds';
    return 'Clears in ' + point.winRound + ' rounds';
  }

  function costResourceBreakdown(cost, oreEquivalent) {
    return '<div class="sfc2-cost-resource-breakdown">' +
      '<span>' + formatResource(cost.ore) + ' Ore</span>' +
      '<span>' + formatResource(cost.crystal) + ' Cry</span>' +
      '<span>' + formatResource(cost.hydrogen) + ' Hyd</span>' +
      '<strong>' + formatResource(oreEquivalent) + ' Ore-equivalent</strong>' +
    '</div>';
  }

  function renderTradeoffPointDetails(point, weights) {
    if (!point) {
      return '<p class="hint">Hover or focus a chart point to see exact fleet counts and expected costs. Select a point to keep its details open.</p>';
    }
    const initialOreEq = optimizer.oreEquivalent(point.buildCost, weights);
    const replacementOreEq = optimizer.oreEquivalent(point.rebuildCost, weights);
    const fleetEntries = Object.entries(point.fleet || {}).filter(([, count]) => Number(count) > 0);
    const orderedFleet = fleetEntries.sort(([left], [right]) => {
      const leftIndex = combat.ATTACKER_SHIPS.indexOf(left);
      const rightIndex = combat.ATTACKER_SHIPS.indexOf(right);
      return (leftIndex < 0 ? 100 : leftIndex) - (rightIndex < 0 ? 100 : rightIndex);
    });
    const fleetRows = orderedFleet.map(([name, count]) => {
      const label = optimizer.TRANSPORTS.includes(name) ? name + ' transport' : name;
      const exact = plainCount(count);
      return '<li class="sfc2-cost-fleet-row"><span>' + escapeHtml(label) + '</span><code>' + exact +
        '</code><button class="copy-count-button" type="button" data-copy-count="' + exact +
        '" aria-label="Copy exact ' + escapeHtml(label) + ' count" title="Copy exact ship count"><span aria-hidden="true">⧉</span></button></li>';
    }).join('');
    const thresholds = point.roundLimits.length
      ? 'Minimum-threshold point: ' + point.roundLimits.sort((left, right) => right - left).map(value => value + ' rounds').join(', ')
      : 'Intermediate sample' + (point.sampledIntervals.length ? ' between ' + point.sampledIntervals.join(', ') : '');
    return '<div class="sfc2-cost-detail-heading"><h3>' + escapeHtml(point.mix.name) + '</h3><span>' +
      escapeHtml(tradeoffRoundLabel(point)) + ' · ' + escapeHtml(thresholds) + '</span></div>' +
      '<div class="sfc2-cost-detail-grid">' +
        '<section class="sfc2-cost-detail-card"><h4>Attacking fleet</h4>' +
          (fleetRows ? '<ul class="sfc2-cost-fleet-list">' + fleetRows + '</ul>' : '<p class="hint">No attacking ships.</p>') +
          '<button class="ghost sfc2-cost-copy-all" type="button" data-copy-all-fleet>Copy full fleet</button>' +
        '</section>' +
        '<section class="sfc2-cost-detail-card"><h4>Initial fleet cost</h4>' +
          costResourceBreakdown(point.buildCost, initialOreEq) +
        '</section>' +
        '<section class="sfc2-cost-detail-card"><h4>Expected replacement cost</h4>' +
          costResourceBreakdown(point.rebuildCost, replacementOreEq) +
        '</section>' +
      '</div>';
  }

  function costDomain(values) {
    let low = Math.min(...values);
    let high = Math.max(...values);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
    const padding = low === high ? Math.max(Math.abs(high) * 0.05, 1) : (high - low) * 0.08;
    low = Math.max(0, low - padding);
    high += padding;
    if (!(high > low)) high = low + 1;
    return [low, high];
  }

  function pointAccessibilityLabel(point, weights) {
    const initial = formatCount(optimizer.oreEquivalent(point.buildCost, weights)) + ' Ore-equivalent initial cost';
    const replacement = formatCount(optimizer.oreEquivalent(point.rebuildCost, weights)) + ' Ore-equivalent replacement cost';
    return point.mix.name + ', ' + tradeoffRoundLabel(point) + ', ' + initial + ', ' + replacement;
  }

  function hideTradeoffTooltip() {
    const tooltip = costTradeoffChart.querySelector('.chart-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
  }

  function showTradeoffTooltip(element, event, interaction, point, weights) {
    const tooltip = costTradeoffChart.querySelector('.chart-tooltip');
    if (!tooltip) return;
    const initial = formatCount(optimizer.oreEquivalent(point.buildCost, weights));
    const replacement = formatCount(optimizer.oreEquivalent(point.rebuildCost, weights));
    tooltip.innerHTML = '<strong>' + escapeHtml(point.mix.name) + '</strong>' +
      '<span>' + escapeHtml(tradeoffRoundLabel(point)) + '</span>' +
      '<span>Initial fleet: ' + initial + ' Ore-equivalent</span>' +
      '<span>Expected replacement: ' + replacement + ' Ore-equivalent</span>';
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'true');
    const chartRect = costTradeoffChart.getBoundingClientRect();
    const pointRect = element.getBoundingClientRect();
    const usePointer = interaction === 'hover' || interaction === 'click';
    const clientX = usePointer && Number.isFinite(event?.clientX) && event.clientX
      ? event.clientX
      : pointRect.left + pointRect.width / 2;
    const clientY = usePointer && Number.isFinite(event?.clientY) && event.clientY
      ? event.clientY
      : pointRect.top + pointRect.height / 2;
    const scrollLeft = costTradeoffChart.scrollLeft;
    const leftMin = scrollLeft + 8;
    const leftMax = scrollLeft + costTradeoffChart.clientWidth - tooltip.offsetWidth - 8;
    const left = Math.max(leftMin, Math.min(leftMax, clientX - chartRect.left + scrollLeft + 12));
    const top = Math.max(8, Math.min(costTradeoffChart.clientHeight - tooltip.offsetHeight - 8,
      clientY - chartRect.top + costTradeoffChart.scrollTop + 12));
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function renderCostTradeoff(comparisons) {
    if (!charts || !costTradeoffChart) return;
    try {
      tradeoffWeights = readCostWeights();
      costTradeoffStatus.textContent = '';
    } catch (error) {
      costTradeoffStatus.textContent = error.message;
      return;
    }

    const series = comparisons.map(item => item.tradeoff).filter(Boolean);
    const allPoints = series.flatMap(item => item.points);
    const missing = series.flatMap(item => item.missing.map(entry =>
      item.mix.name + ', ' + entry.roundLimit + ' rounds (' + entry.reason + ')'
    ));
    tradeoffPointByKey = new Map(allPoints.map(point => [point.key, point]));
    if (!tradeoffPointByKey.has(selectedTradeoffKey)) selectedTradeoffKey = null;

    if (!allPoints.length) {
      costTradeoffChart.innerHTML = '<p class="hint">No available Wave 1 round recommendations can be plotted for these fleet mixes.</p>' +
        '<div class="chart-tooltip hidden" aria-hidden="true"></div>';
      costTradeoffStatus.textContent = missing.length
        ? 'Unavailable thresholds omitted: ' + missing.join('; ') + '.'
        : 'No chartable recommendations are available.';
      displayedTradeoffPoint = null;
      costTradeoffDetails.innerHTML = renderTradeoffPointDetails(null, tradeoffWeights);
      charts.bindPointInteractions(costTradeoffChart, {
        selector:'[data-cost-point]',
        onPoint:() => {},
        onLeave:() => {}
      });
      return;
    }

    const width = 960;
    const height = 520;
    const margin = {left:88, right:24, top:26, bottom:74};
    const xValues = allPoints.map(point => optimizer.oreEquivalent(point.buildCost, tradeoffWeights));
    const yValues = allPoints.map(point => optimizer.oreEquivalent(point.rebuildCost, tradeoffWeights));
    const xScale = charts.createScale(costDomain(xValues), [margin.left, width - margin.right]);
    const yScale = charts.createScale(costDomain(yValues), [height - margin.bottom, margin.top]);
    let grid = '';
    for (const tick of yScale.ticks(5)) {
      const y = yScale(tick);
      grid += charts.line({x1:margin.left, y1:y, x2:width - margin.right, y2:y, className:'gridline'});
      grid += charts.text({x:margin.left - 10, y:y + 4, value:formatCount(tick), anchor:'end', className:'axis'});
    }
    for (const tick of xScale.ticks(5)) {
      const x = xScale(tick);
      grid += charts.line({x1:x, y1:margin.top, x2:x, y2:height - margin.bottom, className:'gridline'});
      grid += charts.text({x, y:height - margin.bottom + 20, value:formatCount(tick), className:'axis'});
    }

    const pointIndex = new Map(allPoints.map((point, index) => [point.key, index]));
    const paths = series.map(item => {
      const hue = Math.round((189 + item.mixIndex * 137.508) % 360);
      return item.segments.map(segment => {
        if (segment.length < 2) return '';
        const path = charts.linePath(
          segment,
          point => optimizer.oreEquivalent(point.buildCost, tradeoffWeights),
          point => optimizer.oreEquivalent(point.rebuildCost, tradeoffWeights),
          xScale,
          yScale
        );
        return charts.path(path, 'curve sfc2-cost-line', {'style':'--sfc2-series-hue:' + hue});
      }).join('');
    }).join('');
    const dots = series.map(item => {
      const hue = Math.round((189 + item.mixIndex * 137.508) % 360);
      return item.points.map(point => {
        const index = pointIndex.get(point.key);
        const x = optimizer.oreEquivalent(point.buildCost, tradeoffWeights);
        const y = optimizer.oreEquivalent(point.rebuildCost, tradeoffWeights);
        const selected = selectedTradeoffKey === point.key;
        const label = pointAccessibilityLabel(point, tradeoffWeights);
        const circle = charts.circle({
          cx:xScale(x),
          cy:yScale(y),
          r:5.5,
          className:'chart-dot sfc2-cost-dot',
          attributes:{'style':'--sfc2-series-hue:' + hue},
          title:''
        });
        return '<g class="sfc2-cost-point' + (selected ? ' is-selected' : '') + '" data-cost-point="' + index +
          '" tabindex="0" role="button" aria-label="' + charts.escapeXml(label) + '" aria-pressed="' +
          (selected ? 'true' : 'false') + '">' + circle + '</g>';
      }).join('');
    }).join('');
    const svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" role="group" ' +
      'aria-label="Wave 1 initial fleet Ore-equivalent cost versus expected replacement Ore-equivalent cost">' +
      grid + paths + dots +
      charts.text({x:(margin.left + width - margin.right) / 2, y:height - 12, value:'Initial fleet cost (Ore-equivalent)', className:'label'}) +
      charts.text({x:18, y:(margin.top + height - margin.bottom) / 2, value:'Expected replacement cost (Ore-equivalent)', className:'label', transform:'rotate(-90 18 ' + ((margin.top + height - margin.bottom) / 2) + ')'}) +
      '</svg>';
    const legend = '<div class="sfc2-cost-legend" aria-label="Fleet mix legend">' + series.map(item => {
      const hue = Math.round((189 + item.mixIndex * 137.508) % 360);
      return '<span class="sfc2-cost-legend-item"><span class="sfc2-cost-legend-swatch" style="--sfc2-series-hue:' + hue +
        '" aria-hidden="true"></span>' + escapeHtml(item.mix.name) + '</span>';
    }).join('') + '</div>';
    costTradeoffChart.innerHTML = svg + legend + '<div class="chart-tooltip hidden" aria-hidden="true"></div>';
    costTradeoffStatus.textContent = (missing.length
      ? 'Unavailable thresholds omitted: ' + missing.join('; ') + '. '
      : '') + 'Two log-spaced intermediate fleet sizes are simulated between each adjacent available threshold pair. Costs include selected transports and expected losses.';

    charts.bindPointInteractions(costTradeoffChart, {
      selector:'[data-cost-point]',
      onPoint:(element, event, interaction) => {
        const point = allPoints[Number(element.dataset.costPoint)];
        if (!point) return;
        if (interaction === 'click' || interaction === 'keyboard') selectedTradeoffKey = point.key;
        displayedTradeoffPoint = point;
        costTradeoffDetails.innerHTML = renderTradeoffPointDetails(point, tradeoffWeights);
        showTradeoffTooltip(element, event, interaction, point, tradeoffWeights);
        costTradeoffChart.querySelectorAll('[data-cost-point]').forEach(candidate => {
          const isSelected = allPoints[Number(candidate.dataset.costPoint)]?.key === selectedTradeoffKey;
          candidate.classList.toggle('is-selected', isSelected);
          candidate.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
      },
      onLeave:() => {
        hideTradeoffTooltip();
        const selected = tradeoffPointByKey.get(selectedTradeoffKey);
        if (selected) {
          displayedTradeoffPoint = selected;
          costTradeoffDetails.innerHTML = renderTradeoffPointDetails(displayedTradeoffPoint, tradeoffWeights);
        }
      }
    });
    const selected = tradeoffPointByKey.get(selectedTradeoffKey);
    displayedTradeoffPoint = selected || null;
    costTradeoffDetails.innerHTML = renderTradeoffPointDetails(displayedTradeoffPoint, tradeoffWeights);
  }

  function readInput() {
    const defenders = readUnitInputs('defender');
    const resources = {
      ore:parseCount($('#resourceOre').value, 'Ore'),
      crystal:parseCount($('#resourceCrystal').value, 'Crystal'),
      hydrogen:parseCount($('#resourceHydrogen').value, 'Hydrogen')
    };
    return {
      defenders,
      attackerTech:readTech('attacker'),
      defenderTech:readTech('defender'),
      confidence:optimizer.DEFAULT_CLEAR_CONFIDENCE,
      transportType:$('#transportType').value,
      resources
    };
  }

  function readMixScenarios() {
    const scenarios = [];
    [...document.querySelectorAll('[data-mix-card]')].forEach((card, index) => {
      const ratios = {};
      card.querySelectorAll('[data-role="ratio"]').forEach(input => {
        const name = input.dataset.unit;
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value > 1_000_000_000) {
          throw new Error(`${name} ratio in Mix ${index + 1} must be a whole number from 0 to 1,000,000,000.`);
        }
        if (value > 0) ratios[name] = value;
      });
      if (Object.keys(ratios).length) {
        scenarios.push({
          id:Number(card.dataset.mixCard),
          name:card.querySelector('[data-mix-name]').value.trim() || `Mix ${index + 1}`,
          ratios
        });
      }
    });
    if (!scenarios.length) throw new Error('Enter a positive ratio in at least one fleet mix.');
    return scenarios;
  }

  function runAnalysis(input, scenarios, {filterUpdate=false, scroll=false}={}) {
    const sequence = ++calculationSequence;
    if (filterUpdate) {
      $('#resultFilterStatus').textContent = 'Updating recommendations…';
    } else {
      $('#calculateBtn').disabled = true;
      inputStatus.textContent = 'Calculating fleets, cargo, and Wave 1 cost tradeoffs…';
    }
    window.setTimeout(() => {
      if (sequence !== calculationSequence) return;
      try {
        const comparisons = scenarios.map((mix, index) => {
          const mixInput = {...input, ratios:mix.ratios};
          const result = optimizer.analyze(mixInput);
          const waveTwoResult = optimizer.analyzeWaveTwo(mixInput, result);
          const tradeoff = buildTradeoffData(mixInput, mix, result, index);
          return {mix, result, waveTwoResult, tradeoff};
        });
        currentComparisons = comparisons;
        renderSelectedResults(comparisons);
        results.classList.remove('hidden');
        if (filterUpdate) {
          $('#resultFilterStatus').textContent = 'Recommendations updated.';
        } else {
          inputStatus.textContent = 'Calculation complete.';
          $('#resultFilterStatus').textContent = '';
        }
        if (scroll) results.scrollIntoView({behavior:'smooth', block:'start'});
      } catch (error) {
        if (filterUpdate) {
          $('#resultFilterStatus').textContent = error.message || 'Could not update recommendations.';
        } else {
          inputStatus.textContent = error.message || 'Calculation failed.';
        }
      } finally {
        if (sequence === calculationSequence && !filterUpdate) $('#calculateBtn').disabled = false;
      }
    }, 20);
  }

  function calculate() {
    inputStatus.textContent = '';
    try {
      const input = readInput();
      const scenarios = readMixScenarios();
      lastCalculation = {input, scenarios};
      runAnalysis(input, scenarios, {scroll:true});
    } catch (error) {
      inputStatus.textContent = error.message || 'Check the input values.';
    }
  }

  function updateCalculationFilters() {
    if (!lastCalculation) return;
    const input = {
      ...lastCalculation.input,
      transportType:$('#transportType').value
    };
    runAnalysis(input, lastCalculation.scenarios, {filterUpdate:true});
  }

  function setInput(role, name, value, mixId=null) {
    const input = [...document.querySelectorAll(`[data-role="${role}"]`)].find(item =>
      item.dataset.unit === name && (mixId == null || Number(item.dataset.mixId) === Number(mixId))
    );
    if (input) input.value = String(value);
  }

  function importDefenderFleet() {
    const text = $('#defenderPaste').value.trim();
    if (!text) throw new Error('Paste a defender roster or report first.');
    const battleReport = reportParser.parseBattleReport(text);
    const espionageReport = reportParser.parseEspionageReport(text);
    const roster = battleReport.defender || (battleReport.hasSideMarkers ? null : battleReport.unassigned);
    if (!roster || !Object.keys(roster.composition).length) {
      throw new Error('No defender fleet was found. Paste a defender section or an unmarked defender roster.');
    }

    const supportedNames = new Set([...combat.DEFENDER_SHIPS, ...combat.DEFENSES]);
    const supported = Object.entries(roster.composition).filter(([name, count]) => supportedNames.has(name) && count > 0);
    if (!supported.length) throw new Error('The pasted roster has no supported defender ships or defenses.');

    document.querySelectorAll('[data-role="defender"]').forEach(input => { input.value = '0'; });
    supported.forEach(([name, count]) => setInput('defender', name, count));
    const importedTech = [];
    for (const key of ['weapons', 'shield', 'armor']) {
      if (!Object.prototype.hasOwnProperty.call(roster.tech, key)) continue;
      const suffix = key[0].toUpperCase() + key.slice(1);
      $(`#defender${suffix}`).value = String(roster.tech[key]);
      importedTech.push(`${suffix} ${roster.tech[key]}`);
    }
    if (espionageReport.hasResources) {
      for (const key of ['ore', 'crystal', 'hydrogen']) {
        const suffix = key[0].toUpperCase() + key.slice(1);
        const value = espionageReport.rawResources[key] ||
          (espionageReport.resources[key] === undefined ? '0' : String(espionageReport.resources[key]));
        $(`#resource${suffix}`).value = value;
      }
    }
    const omittedNames = Object.keys(roster.composition).filter(name => !supportedNames.has(name));
    const unknownLines = espionageReport.unknown;
    const notes = [`Imported ${supported.length} supported defender unit types.`];
    if (importedTech.length) notes.push(`Updated defender tech: ${importedTech.join(', ')}.`);
    if (espionageReport.hasResources) notes.push('Updated Ore, Crystal, and Hydrogen from the report.');
    if (omittedNames.length) notes.push(`Omitted unsupported: ${omittedNames.join(', ')}.`);
    if (unknownLines.length) notes.push(`${unknownLines.length} unrecognized line${unknownLines.length === 1 ? '' : 's'} left out.`);
    $('#defenderPasteStatus').textContent = notes.join(' ');
  }

  $('#calculateBtn').addEventListener('click', calculate);
  $('#roundFilter').addEventListener('change', () => {
    if (currentComparisons) {
      renderSelectedResults(currentComparisons);
      $('#resultFilterStatus').textContent = `Showing victories within ${$('#roundFilter').value} rounds.`;
    }
  });
  $('#transportType').addEventListener('change', updateCalculationFilters);
  ['costWeightOre', 'costWeightCrystal', 'costWeightHydrogen'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (currentComparisons) renderCostTradeoff(currentComparisons);
    });
  });
  $('#addMixBtn').addEventListener('click', () => {
    mixes = snapshotMixes();
    const id = mixSequence++;
    mixes.push({id, name:`Mix ${id}`, ratios:{}});
    renderMixes();
  });
  $('#fleetMixList').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-mix]');
    if (!button || mixes.length <= 1) return;
    mixes = snapshotMixes().filter(mix => mix.id !== Number(button.dataset.removeMix));
    renderMixes();
  });
  recommendations.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-count]');
    if (button) copyFleetCount(button);
  });
  costTradeoffDetails.addEventListener('click', event => {
    const countButton = event.target.closest('[data-copy-count]');
    if (countButton) {
      copyFleetCount(countButton);
      return;
    }
    const fullFleetButton = event.target.closest('[data-copy-all-fleet]');
    if (fullFleetButton && displayedTradeoffPoint) {
      const rows = Object.entries(displayedTradeoffPoint.fleet || {}).filter(([, count]) => Number(count) > 0);
      const fleetText = rows.map(([name, count]) => {
        const label = optimizer.TRANSPORTS.includes(name) ? name + ' transport' : name;
        return label + ': ' + plainCount(count);
      }).join('\n');
      copyText(fullFleetButton, fleetText, 'Copy full fleet');
    }
  });
  $('#parseDefenderBtn').addEventListener('click', () => {
    $('#defenderPasteStatus').textContent = '';
    try {
      importDefenderFleet();
      $('#defenderPasteBox').open = false;
    } catch (error) {
      $('#defenderPasteStatus').textContent = error.message || 'Could not import the pasted defender roster.';
    }
  });
  $('#clearBtn').addEventListener('click', () => {
    document.querySelectorAll('[data-role="defender"]').forEach(input => { input.value = '0'; });
    inputStatus.textContent = 'Defender counts cleared.';
  });
})();
