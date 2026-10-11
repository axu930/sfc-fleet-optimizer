(function () {
  'use strict';

  const U = window.SFCUnits;
  const M = window.SFCRapidFireAnalyzer;
  const $ = id => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits:3});

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
      const ships = M.TARGETS.filter(name => U.UNITS[name].kind === 'ship').map(name => [name, U.UNITS[name]]);
      const defenses = M.TARGETS.filter(name => U.UNITS[name].kind === 'defense').map(name => [name, U.UNITS[name]]);
      return `<article class="panel rf-scenario-card" data-scenario-id="${escapeHtml(scenario.id)}">
        <div class="rf-scenario-card-head">
          <label class="rf-name-input" for="scenario-name-${escapeHtml(scenario.id)}">Composition name
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
      button.title = button.disabled ? 'At least one composition is required' : 'Remove this composition';
    });
  }

  function display(value) {
    return Number.isFinite(value) ? numberFormat.format(value) : '—';
  }

  function renderScenarioResults() {
    const rows = scenarios.map((scenario, index) => {
      let error = '';
      const values = {};
      try {
        for (const attacker of M.ATTACKERS) values[attacker] = M.expectedShots(attacker, scenario.ratio);
      } catch (caught) {
        error = caught.message;
      }
      const cells = M.ATTACKERS.map(attacker => {
        const result = values[attacker];
        if (!result) return '<td class="rf-shot-cell" aria-label="Unavailable">—</td>';
        return `<td class="rf-shot-cell" aria-label="${display(result.totalShots)} total shots; ${display(result.bonusShots)} bonus shots">
          <span class="rf-shot-total">${display(result.totalShots)}</span>
          <span class="rf-shot-bonus">+${display(result.bonusShots)} bonus</span>
        </td>`;
      }).join('');
      return `<tr>
        <th scope="row"><span class="rf-composition-name">${escapeHtml(scenarioName(scenario, index))}</span>${error ? `<span class="rf-scenario-error">${escapeHtml(error)}</span>` : ''}</th>
        ${cells}
      </tr>`;
    });
    $('scenarioResults').innerHTML = `<table class="rf-table rf-scenario-results-table">
      <thead><tr><th scope="col">Your composition</th>${M.ATTACKERS.map(attacker => `<th scope="col">${escapeHtml(attacker)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
  }

  function updateResults() {
    renderScenarioResults();
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
  renderScenarios();
  updateResults();
  saveScenarios();
})();
