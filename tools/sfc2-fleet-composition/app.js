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
        ratios
      };
    });
  }

  function renderMixes() {
    $('#fleetMixList').innerHTML = mixes.map((mix, index) => `<section class="sfc2-mix-card" data-mix-card="${mix.id}">
      <div class="sfc2-mix-head">
        <label>Mix name <input type="text" maxlength="40" data-mix-name value="${escapeHtml(mix.name)}"></label>
        <button class="ghost compact-button" type="button" data-remove-mix="${mix.id}" aria-label="Remove ${escapeHtml(mix.name)}" ${mixes.length === 1 ? 'disabled' : ''}>Remove</button>
      </div>
      <div class="sfc2-mix-ship-grid" id="mix-ratios-${mix.id}"></div>
    </section>`).join('');
    mixes.forEach(mix => renderUnitInputs($(`#mix-ratios-${mix.id}`), combat.ATTACKER_SHIPS, 'ratio', mix.ratios, mix.id));
    $('#addMixBtn').disabled = mixes.length >= 3;
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
    return units.formatCount(Number(value) || 0, 'abbrev');
  }

  function formatResource(value) {
    return formatCount(value);
  }

  function formatCost(cost) {
    const pieces = [
      `${formatResource(cost.ore)} Ore`,
      `${formatResource(cost.crystal)} Crystal`,
      `${formatResource(cost.hydrogen)} Hydrogen`
    ];
    if (cost.credits > 0) pieces.push(`${formatResource(cost.credits)} Credits`);
    return pieces.join(' · ');
  }

  function formatComposition(composition, includeZeros=false) {
    const rows = Object.entries(composition || {})
      .filter(([, count]) => includeZeros || count > 1e-8)
      .map(([name, count]) => `${escapeHtml(name)} ${formatCount(count)}`);
    return rows.length ? rows.join(' · ') : 'None';
  }

  function formatWin(round, probability) {
    if (round === 0) return 'No blocking defenders';
    return `${(probability * 100).toFixed(probability >= 0.999 ? 2 : 1)}% estimated clear by round ${round}`;
  }

  function renderCargoCell(recommendation) {
    return `<div class="sfc2-cargo-options">${recommendation.cargo.map(option => {
      const added = option.additional > 0 ? option.additional : 0;
      const addedCost = optimizer.costOfFleet(added > 0 ? {[option.type]:added} : {});
      const combinedLosses = Object.values(option.snapshot.attackerLosses || option.simulation.attackerLosses)
        .reduce((sum, count) => sum + count, 0);
      const capacityStatus = option.fullyLoaded
        ? `${formatResource(option.capacity)} / ${formatResource(recommendation.cargoRequired)} capacity`
        : `${formatResource(option.capacity)} / ${formatResource(recommendation.cargoRequired)} capacity · short`;
      const battleStatus = option.win ? `clear by round ${option.win.round}` : 'does not meet round limit';
      return `<span><strong>${escapeHtml(option.type)} × ${formatCount(added)}</strong><small>${escapeHtml(capacityStatus)} · ${escapeHtml(formatCost(addedCost))} · ${formatCount(combinedLosses)} combined losses · ${escapeHtml(battleStatus)}</small></span>`;
    }).join('')}</div>`;
  }

  function renderResultRow(mix, recommendation) {
    const mixDescription = formatComposition(recommendation.fleet || mix.ratios);
    const ineffective = recommendation.reason === 'ineffective';
    const resultLabel = recommendation.unavailable
      ? ineffective
        ? `Ineffective vs ${recommendation.ineffectiveTargets.join(', ')} under the 1% shield rule`
        : 'No modeled solution within the 1T search cap'
      : formatWin(recommendation.winRound, recommendation.estimatedWinProbability);
    if (recommendation.unavailable) {
      return `<tr class="${ineffective ? 'sfc2-result-ineffective' : 'sfc2-result-unavailable'}">
        <th scope="row"><strong>${escapeHtml(mix.name)}</strong><small>${mixDescription}</small></th>
        <td>${recommendation.roundLimit} rounds</td>
        <td>${escapeHtml(resultLabel)}</td>
        <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
      </tr>`;
    }
    const losses = Object.values(recommendation.estimatedLosses).reduce((sum, count) => sum + count, 0);
    return `<tr>
      <th scope="row"><strong>${escapeHtml(mix.name)}</strong><small>${mixDescription}</small></th>
      <td>${recommendation.roundLimit} rounds</td>
      <td>${escapeHtml(resultLabel)}</td>
      <td>${formatCount(recommendation.totalShips)}</td>
      <td>${escapeHtml(formatCost(recommendation.buildCost))}</td>
      <td>${formatCount(losses)}<small>${formatComposition(recommendation.estimatedLosses)}</small></td>
      <td>${escapeHtml(formatCost(recommendation.rebuildCost))}</td>
      <td>${renderCargoCell(recommendation)}</td>
    </tr>`;
  }

  function renderComparisonTable(comparisons) {
    const rows = comparisons.flatMap(comparison =>
      comparison.result.recommendations.map(recommendation => renderResultRow(comparison.mix, recommendation))
    ).join('');
    return `<table class="sfc2-results-table">
      <thead><tr><th scope="col">Fleet mix</th><th scope="col">Round limit</th><th scope="col">Estimated result</th><th scope="col">Attack ships</th><th scope="col">Fleet build cost</th><th scope="col">Expected losses</th><th scope="col">Rebuild cost</th><th scope="col">Transports added after losses</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderSummary(comparisons) {
    const ineffective = comparisons
      .map(({mix, result}) => ({mix, targets:result.ineffectiveTargets}))
      .filter(item => item.targets.length);
    if (ineffective.length === comparisons.length) {
      return `No fleet mix can break through: ${ineffective.map(item => `${item.mix.name} cannot damage ${item.targets.join(', ')}`).join('; ')} under the 1% shield ineffectiveness rule. Adding ships in the same ratios will not help; adjust the mix or attacker Weapons Tech.`;
    }
    if (ineffective.length) {
      return `Ineffective mixes under the 1% shield rule: ${ineffective.map(item => `${item.mix.name} vs ${item.targets.join(', ')}`).join('; ')}. Adjust those mixes or attacker Weapons Tech.`;
    }
    const noSolution = comparisons.filter(({result}) => result.recommendations.every(item => item.unavailable));
    if (noSolution.length === comparisons.length) {
      return `No modeled solution for any fleet mix within the 1T ratio-scale search cap. Try different ratios or a lower clear-confidence threshold.`;
    }
    const confidence = comparisons[0].result.confidence;
    const share = `${Math.round(comparisons[0].result.plunderShare * 100)}%`;
    return `Clear threshold ${(confidence * 100).toFixed(1)}% · eligible plunder ${share} · cargo sweeps include expected battle losses`;
  }

  function readInput() {
    const defenders = readUnitInputs('defender');
    const resourceDenLevel = Number($('#resourceDenLevel').value);
    if (!$('#valuesArePlunderable').checked && (!Number.isInteger(resourceDenLevel) || resourceDenLevel < 0 || resourceDenLevel > 1_000_000)) {
      throw new Error('Resource Den level must be a whole number from 0 to 1,000,000.');
    }
    const resources = {
      ore:parseCount($('#resourceOre').value, 'Ore'),
      crystal:parseCount($('#resourceCrystal').value, 'Crystal'),
      hydrogen:parseCount($('#resourceHydrogen').value, 'Hydrogen')
    };
    return {
      defenders,
      attackerTech:readTech('attacker'),
      defenderTech:readTech('defender'),
      confidence:Number($('#winConfidence').value),
      resources,
      valuesArePlunderable:$('#valuesArePlunderable').checked,
      resourceDenLevel,
      atWar:$('#atWar').checked
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

  function calculate() {
    inputStatus.textContent = '';
    try {
      const input = readInput();
      const scenarios = readMixScenarios();
      $('#calculateBtn').disabled = true;
      inputStatus.textContent = 'Calculating expected battles and cargo sweeps…';
      window.setTimeout(() => {
        try {
          const comparisons = scenarios.map(mix => ({mix, result:optimizer.analyze({...input, ratios:mix.ratios})}));
          const hasIneffectiveMix = comparisons.some(item => item.result.ineffectiveTargets.length);
          $('#resultSummary').classList.toggle('sfc2-ineffectiveness-summary', hasIneffectiveMix);
          $('#resultSummary').textContent = renderSummary(comparisons);
          recommendations.innerHTML = renderComparisonTable(comparisons);
          results.classList.remove('hidden');
          inputStatus.textContent = 'Calculation complete.';
          results.scrollIntoView({behavior:'smooth', block:'start'});
        } catch (error) {
          inputStatus.textContent = error.message || 'Calculation failed.';
        } finally {
          $('#calculateBtn').disabled = false;
        }
      }, 20);
    } catch (error) {
      inputStatus.textContent = error.message || 'Check the input values.';
    }
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
    const parsed = reportParser.parseBattleReport(text);
    const roster = parsed.defender || (parsed.hasSideMarkers ? null : parsed.unassigned);
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
    const omittedNames = Object.keys(roster.composition).filter(name => !supportedNames.has(name));
    const unknownLines = reportParser.parseEspionageReport(text).unknown;
    const notes = [`Imported ${supported.length} supported defender unit types.`];
    if (importedTech.length) notes.push(`Updated defender tech: ${importedTech.join(', ')}.`);
    if (omittedNames.length) notes.push(`Omitted unsupported: ${omittedNames.join(', ')}.`);
    if (unknownLines.length) notes.push(`${unknownLines.length} unrecognized line${unknownLines.length === 1 ? '' : 's'} left out.`);
    $('#defenderPasteStatus').textContent = notes.join(' ');
  }

  $('#calculateBtn').addEventListener('click', calculate);
  $('#addMixBtn').addEventListener('click', () => {
    mixes = snapshotMixes();
    if (mixes.length >= 3) return;
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
  $('#parseDefenderBtn').addEventListener('click', () => {
    $('#defenderPasteStatus').textContent = '';
    try {
      importDefenderFleet();
    } catch (error) {
      $('#defenderPasteStatus').textContent = error.message || 'Could not import the pasted defender roster.';
    }
  });
  $('#valuesArePlunderable').addEventListener('change', event => {
    $('#resourceDenLevel').disabled = event.target.checked;
  });
  $('#clearBtn').addEventListener('click', () => {
    document.querySelectorAll('[data-role]').forEach(input => { input.value = '0'; });
    inputStatus.textContent = 'Fleet counts cleared.';
  });
  $('#sampleBtn').addEventListener('click', () => {
    const sampleRatios = {Artemis:4, Athena:1, Hades:1};
    const sampleDefenders = {Hades:20, Artemis:120, 'Laser Cannon':300, 'Gauss Cannon':25};
    mixes = [{id:mixSequence++, name:'Mix 1', ratios:sampleRatios}];
    renderMixes();
    document.querySelectorAll('[data-role="defender"]').forEach(input => { input.value = '0'; });
    for (const [name, value] of Object.entries(sampleDefenders)) setInput('defender', name, value);
    $('#attackerWeapons').value = '10';
    $('#attackerShield').value = '10';
    $('#attackerArmor').value = '10';
    $('#defenderWeapons').value = '10';
    $('#defenderShield').value = '10';
    $('#defenderArmor').value = '10';
    $('#resourceOre').value = '500k';
    $('#resourceCrystal').value = '350k';
    $('#resourceHydrogen').value = '250k';
    $('#valuesArePlunderable').checked = true;
    $('#resourceDenLevel').disabled = true;
    inputStatus.textContent = 'Sample roster loaded. Press Calculate fleet sizes.';
  });
})();
