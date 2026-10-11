(function () {
  'use strict';

  const U = window.SFCUnits;
  const M = window.SFCRapidFireAnalyzer;
  const $ = id => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits:3});
  const percentFormat = new Intl.NumberFormat('en-US', {style:'percent', maximumFractionDigits:2});

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }

  function newScenario(index) {
    return {id:`scenario-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name:`Composition ${index}`, ratio:{}};
  }

  function loadScenarios() {
    let restored = [];
    try { restored = M.loadScenarios(localStorage); } catch (error) { /* Use a fresh bag when storage is unavailable. */ }
    return restored.length ? restored : [newScenario(1)];
  }

  let scenarios = loadScenarios();

  function saveScenarios() {
    try {
      M.saveScenarios(scenarios, localStorage);
      $('scenarioStatus').textContent = `${scenarios.length} ratio bag${scenarios.length === 1 ? '' : 's'} saved in this browser.`;
      $('scenarioStatus').className = 'status success';
    } catch (error) {
      $('scenarioStatus').textContent = 'Browser storage is unavailable; changes remain only until this page closes.';
      $('scenarioStatus').className = 'status error';
    }
  }

  function scenarioName(scenario, index) {
    const name = scenario.name.trim() || `Composition ${index + 1}`;
    return `${index + 1}. ${name}`;
  }

  function ratioInput(name, ratio) {
    const unitId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<label class="rf-ratio-input" for="${escapeHtml(unitId)}-${escapeHtml(ratio.id)}">
      <span>${escapeHtml(name)}</span>
          <input id="${escapeHtml(unitId)}-${escapeHtml(ratio.id)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(ratio.ratio[name] == null ? '0' : ratio.ratio[name])}" data-ratio-unit="${escapeHtml(name)}" data-scenario-id="${escapeHtml(ratio.id)}" aria-label="${escapeHtml(name)} ratio weight">
    </label>`;
  }

  function renderScenarios() {
    $('scenarioList').innerHTML = scenarios.map((scenario, index) => {
      const ships = Object.entries(U.UNITS).filter(([, unit]) => unit.kind === 'ship');
      const defenses = Object.entries(U.UNITS).filter(([, unit]) => unit.kind === 'defense');
      return `<article class="panel rf-scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
        <div class="rf-scenario-card-head">
          <label class="rf-name-input" for="scenario-name-${escapeHtml(scenario.id)}">Ratio bag name
            <input id="scenario-name-${escapeHtml(scenario.id)}" type="text" maxlength="60" value="${escapeHtml(scenario.name)}" data-scenario-name="${escapeHtml(scenario.id)}">
          </label>
          <button class="ghost rf-remove-button" type="button" data-remove-scenario="${escapeHtml(scenario.id)}" aria-label="Remove ${escapeHtml(scenario.name)}">Remove</button>
        </div>
        <details class="rf-ratio-group" open>
          <summary>Ships</summary>
          <div class="rf-ratio-grid">${ships.map(([name]) => ratioInput(name, scenario)).join('')}</div>
        </details>
        <details class="rf-ratio-group" open>
          <summary>Defenses</summary>
          <div class="rf-ratio-grid">${defenses.map(([name]) => ratioInput(name, scenario)).join('')}</div>
        </details>
      </article>`;
    }).join('');
    $('scenarioList').querySelectorAll('[data-remove-scenario]').forEach(button => {
      button.disabled = scenarios.length === 1;
      button.title = button.disabled ? 'At least one ratio bag is required' : 'Remove this ratio bag';
    });
  }

  function techValues() {
    return {
      weapons:$('weaponsTech').value,
      shield:$('shieldTech').value,
      armor:$('armorTech').value
    };
  }

  function display(value) {
    return Number.isFinite(value) ? numberFormat.format(value) : '—';
  }

  function renderScenarioResults() {
    const rows = [];
    scenarios.forEach((scenario, index) => {
      let error = '';
      const values = {};
      try {
        for (const attacker of M.ATTACKERS) values[attacker] = M.expectedShots(attacker, scenario.ratio);
      } catch (caught) {
        error = caught.message;
      }
      for (const attacker of M.ATTACKERS) {
        const result = values[attacker];
        rows.push(`<tr>
          <th scope="row">${escapeHtml(scenarioName(scenario, index))}</th>
          <td>${escapeHtml(attacker)}</td>
          <td>${result ? display(result.totalShots) : '—'}</td>
          <td>${result ? display(result.bonusShots) : '—'}</td>
          ${attacker === M.ATTACKERS[0] ? `<td class="rf-scenario-error" rowspan="${M.ATTACKERS.length}">${escapeHtml(error || 'Valid ratio')}</td>` : ''}
        </tr>`);
      }
    });
    $('scenarioResults').innerHTML = `<table class="rf-table rf-scenario-results-table">
      <thead><tr><th scope="col">Defending ratio</th><th scope="col">Attacker</th><th scope="col">Expected total shots</th><th scope="col">Bonus shots</th><th scope="col">Bag status</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
  }

  function renderMatchupGrid() {
    const tech = techValues();
    const rows = [];
    let error = '';
    try {
      for (const attacker of M.ATTACKERS) {
        for (const target of Object.keys(U.UNITS)) {
          const matchup = M.matchupStats(attacker, target, tech);
          rows.push(`<tr>
            <th scope="row">${escapeHtml(attacker)}</th>
            <td>${escapeHtml(target)}</td>
            <td>${matchup.rapidFire > 1 ? `×${display(matchup.rapidFire)}` : '—'}</td>
            <td>${percentFormat.format(matchup.continuationChance)}</td>
            <td>${display(matchup.weaponDamage)}</td>
            <td>${display(matchup.targetHull)}</td>
            <td>${display(matchup.targetShield)}</td>
            <td class="${matchup.passesShieldRule ? 'rf-pass' : 'rf-bounce'}">${matchup.passesShieldRule ? 'Effective' : 'Ineffective'}</td>
            <td>${display(matchup.effectiveDamage)}</td>
          </tr>`);
        }
      }
    } catch (caught) {
      error = caught.message;
    }
    $('techStatus').textContent = error;
    $('techStatus').className = error ? 'status error' : 'status';
    $('matchupGrid').innerHTML = `<table class="rf-table rf-matchup-table">
      <thead><tr><th scope="col">Attacker</th><th scope="col">Target</th><th scope="col">RF rating</th><th scope="col">Continue chance</th><th scope="col">Damage / shot</th><th scope="col">Target hull</th><th scope="col">Target shield</th><th scope="col">1% rule</th><th scope="col">Effective damage / shot</th></tr></thead>
      <tbody>${error ? `<tr><td colspan="9" class="rf-grid-error">${escapeHtml(error)}</td></tr>` : rows.join('')}</tbody>
    </table>`;
  }

  function updateResults() {
    renderScenarioResults();
    renderMatchupGrid();
  }

  function addScenario() {
    scenarios.push(newScenario(scenarios.length + 1));
    renderScenarios();
    saveScenarios();
    updateResults();
  }

  $('scenarioList').addEventListener('input', event => {
    const target = event.target;
    const id = target.dataset.scenarioName || target.dataset.scenarioId;
    if (!id) return;
    const scenario = scenarios.find(item => item.id === id);
    if (!scenario) return;
    if (target.dataset.scenarioName) scenario.name = target.value.slice(0, 60);
    if (target.dataset.ratioUnit) {
      const value = target.value === '' ? 0 : Number(target.value);
      scenario.ratio[target.dataset.ratioUnit] = value;
    }
    saveScenarios();
    updateResults();
  });

  $('scenarioList').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-scenario]');
    if (!button || scenarios.length <= 1) return;
    scenarios = scenarios.filter(item => item.id !== button.dataset.removeScenario);
    renderScenarios();
    saveScenarios();
    updateResults();
  });

  $('addScenario').addEventListener('click', addScenario);
  ['weaponsTech', 'shieldTech', 'armorTech'].forEach(id => $(id).addEventListener('input', updateResults));

  renderScenarios();
  updateResults();
  saveScenarios();
})();
