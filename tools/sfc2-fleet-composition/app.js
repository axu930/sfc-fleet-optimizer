(function () {
  'use strict';

  const combat = window.SFC2Combat;
  const optimizer = window.SFC2Optimizer;
  const units = window.SFCUnits;
  const $ = selector => document.querySelector(selector);
  const inputStatus = $('#inputStatus');
  const results = $('#results');
  const recommendations = $('#recommendations');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }

  function renderUnitInputs(container, names, role) {
    container.innerHTML = names.map(name => {
      const unit = combat.UNITS[name];
      const attributes = `${Math.round(unit.weapon)} weapon · ${units.formatCount(unit.hull, 'commas')} hull · ${units.formatCount(unit.shield, 'commas')} shield`;
      const cargo = combat.cargoCapacity(name) > 0 ? ` · ${units.formatCount(combat.cargoCapacity(name), 'commas')} cargo` : '';
      const label = role === 'ratio' ? 'Ratio weight' : 'Defender count';
      const type = role === 'ratio' ? 'number' : 'text';
      const step = role === 'ratio' ? ' step="1" min="0" max="1000000000"' : ' inputmode="decimal"';
      return `<label class="sfc2-unit-row">
        <span class="sfc2-unit-name">${escapeHtml(name)}<small>${attributes}${cargo}</small></span>
        <input type="${type}"${step} value="0" data-role="${role}" data-unit="${escapeHtml(name)}" aria-label="${label}: ${escapeHtml(name)}">
      </label>`;
    }).join('');
  }

  renderUnitInputs($('#attackerRatioInputs'), combat.ATTACKER_SHIPS, 'ratio');
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

  function formatCount(value, fractionDigits=2) {
    const count = Number(value) || 0;
    const digits = Math.abs(count) < 1 ? Math.max(fractionDigits, 4) : fractionDigits;
    return count.toLocaleString('en-US', {maximumFractionDigits:digits});
  }

  function formatResource(value) {
    return formatCount(value, 0);
  }

  function formatCost(cost) {
    const pieces = [
      `Ore ${formatResource(cost.ore)}`,
      `Crystal ${formatResource(cost.crystal)}`,
      `Hydrogen ${formatResource(cost.hydrogen)}`
    ];
    if (cost.credits > 0) pieces.push(`Credits ${formatResource(cost.credits)}`);
    return pieces.join(' · ');
  }

  function formatComposition(composition, includeZeros=false) {
    const rows = Object.entries(composition || {})
      .filter(([, count]) => includeZeros || count > 1e-8)
      .map(([name, count]) => `${escapeHtml(name)} ${formatCount(count)}`);
    return rows.length ? rows.join(' · ') : 'None';
  }

  function formatResources(resources) {
    return `Ore ${formatResource(resources.ore)} · Crystal ${formatResource(resources.crystal)} · Hydrogen ${formatResource(resources.hydrogen)}`;
  }

  function formatWin(round, probability) {
    if (round === 0) return 'No blocking defenders';
    return `${(probability * 100).toFixed(probability >= 0.999 ? 2 : 1)}% estimated clear by round ${round}`;
  }

  function statusForCargo(option, recommendation) {
    if (!option.fullyLoaded) return 'Search limit reached before full cargo';
    if (!option.win) return `Cargo fits, but misses the ${recommendation.roundLimit}-round clear target`;
    return `Expected capacity covers full plunder; clear by round ${option.win.round}`;
  }

  function renderCargoRows(recommendation) {
    const rows = recommendation.cargo.map(option => {
      const losses = Object.values(option.snapshot.attackerLosses || option.simulation.attackerLosses).reduce((sum, value) => sum + value, 0);
      const additional = option.additional > 0 ? formatCount(option.additional, 0) : '0';
      const cargoLabel = option.fullyLoaded
        ? `${formatResource(option.capacity)} / ${formatResource(recommendation.cargoRequired)}`
        : `${formatResource(option.capacity)} / ${formatResource(recommendation.cargoRequired)} (short)`;
      const rebuilt = optimizer.costOfFleet(option.additional > 0 ? {[option.type]:option.additional} : {});
      return `<tr>
        <th scope="row">${escapeHtml(option.type)}</th>
        <td>${additional}</td>
        <td>${cargoLabel}</td>
        <td>${formatResources(option.cargoTaken)}</td>
        <td>${escapeHtml(statusForCargo(option, recommendation))}</td>
        <td>${formatCost(rebuilt)}</td>
        <td>${formatCount(losses)}</td>
      </tr>`;
    }).join('');
    return `<div class="sfc2-table-wrap"><table class="sfc2-cargo-table">
      <thead><tr><th>Extra transport</th><th>Added</th><th>Expected cargo / pool</th><th>Estimated loot if won</th><th>Battle check</th><th>Added build cost</th><th>Total expected losses</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderRecommendation(recommendation, confidence) {
    if (recommendation.unavailable) {
      return `<article class="panel sfc2-recommendation-card unavailable">
        <div class="sfc2-card-title"><h3>Within ${recommendation.roundLimit} rounds</h3><span>No modeled solution</span></div>
        <p class="hint">The bounded search reached 1 trillion ratio bundles without meeting ${(confidence * 100).toFixed(1)}% estimated clear confidence.</p>
      </article>`;
    }

    const mix = formatComposition(recommendation.fleet);
    const losses = formatComposition(recommendation.estimatedLosses);
    const baselineCapacity = combat.cargoCapacityForSurvivors(recommendation.remainingAttackers);
    return `<article class="panel sfc2-recommendation-card">
      <div class="sfc2-card-title">
        <div><p class="eyebrow">Minimum ratio bundle × ${formatCount(recommendation.scale, 0)}</p><h3>Clear within ${recommendation.roundLimit} rounds</h3></div>
        <span class="sfc2-round-pill">${escapeHtml(formatWin(recommendation.winRound, recommendation.estimatedWinProbability))}</span>
      </div>
      <div class="sfc2-metric-grid">
        <div><span>Attack ships</span><strong>${formatCount(recommendation.totalShips)}</strong></div>
        <div><span>Fleet build cost</span><strong>${formatCost(recommendation.buildCost)}</strong></div>
        <div><span>Expected ship losses</span><strong>${formatCount(Object.values(recommendation.estimatedLosses).reduce((sum, count) => sum + count, 0))}</strong></div>
        <div><span>Expected rebuild cost</span><strong>${formatCost(recommendation.rebuildCost)}</strong></div>
      </div>
      <p class="sfc2-mix"><strong>Fleet mix:</strong> ${mix}</p>
      <details class="sfc2-details">
        <summary>Losses by ship and cargo sweep</summary>
        <p class="sfc2-detail-line"><strong>Expected losses by ship:</strong> ${losses}</p>
        <p class="sfc2-detail-line"><strong>Base fleet cargo after expected losses:</strong> ${formatResource(baselineCapacity)} capacity. The eligible plunder pool is ${formatResource(recommendation.cargoRequired)} (${formatResources(recommendation.cargoPool)}).</p>
        <p class="sfc2-detail-line">Cargo options keep this attacking ratio fleet fixed, add only the named hauler, and simulate the combined fleet. Estimated loot assumes the attack wins; expected losses in the table include the fixed attack fleet and added transport.</p>
        ${renderCargoRows(recommendation)}
      </details>
    </article>`;
  }

  function readInput() {
    const ratios = readUnitInputs('ratio');
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
      ratios,
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

  function calculate() {
    inputStatus.textContent = '';
    try {
      const input = readInput();
      $('#calculateBtn').disabled = true;
      inputStatus.textContent = 'Calculating expected battles and cargo sweeps…';
      window.setTimeout(() => {
        try {
          const result = optimizer.analyze(input);
          const share = `${Math.round(result.plunderShare * 100)}%`;
          $('#resultSummary').textContent = `Clear threshold ${(result.confidence * 100).toFixed(1)}% · eligible plunder ${share} · cargo estimates include expected battle losses`;
          recommendations.innerHTML = result.recommendations.map(item => renderRecommendation(item, result.confidence)).join('');
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

  function setInput(role, name, value) {
    const input = [...document.querySelectorAll(`[data-role="${role}"]`)].find(item => item.dataset.unit === name);
    if (input) input.value = String(value);
  }

  $('#calculateBtn').addEventListener('click', calculate);
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
    document.querySelectorAll('[data-role]').forEach(input => { input.value = '0'; });
    for (const [name, value] of Object.entries(sampleRatios)) setInput('ratio', name, value);
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
