(function () {
  'use strict';

  const combat = window.SFC2Combat;
  const optimizer = window.SFC2Optimizer;
  const units = window.SFCUnits;
  const reportParser = window.SFCBattleReportParser;
  const $ = selector => document.querySelector(selector);
  const inputStatus = $('#inputStatus');
  const results = $('#results');
  const recommendations = $('#recommendations');
  let currentComparisons = null;
  let lastCalculation = null;
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

  async function copyFleetCount(button) {
    const value = button.dataset.copyCount;
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
    if (icon) icon.textContent = copied ? '✓' : '!';
    button.classList.toggle('copied', copied);
    button.title = copied ? 'Copied' : 'Copy exact ship count';
    if (copied) window.setTimeout(() => {
      if (!button.isConnected) return;
      const currentIcon = button.querySelector('[aria-hidden="true"]');
      if (currentIcon) currentIcon.textContent = '⧉';
      button.classList.remove('copied');
      button.title = 'Copy exact ship count';
    }, 1100);
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
      inputStatus.textContent = 'Calculating expected battles and selected transport cargo…';
    }
    window.setTimeout(() => {
      if (sequence !== calculationSequence) return;
      try {
        const comparisons = scenarios.map(mix => ({mix, result:optimizer.analyze({...input, ratios:mix.ratios})}));
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
  $('#parseDefenderBtn').addEventListener('click', () => {
    $('#defenderPasteStatus').textContent = '';
    try {
      importDefenderFleet();
    } catch (error) {
      $('#defenderPasteStatus').textContent = error.message || 'Could not import the pasted defender roster.';
    }
  });
  $('#clearBtn').addEventListener('click', () => {
    document.querySelectorAll('[data-role="defender"]').forEach(input => { input.value = '0'; });
    inputStatus.textContent = 'Defender counts cleared.';
  });
})();
