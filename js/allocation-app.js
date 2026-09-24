(function (root) {
  'use strict';

  const U = root.SFCUnits;
  const P = root.SFCBattleReportParser;
  const A = root.SFCFleetAllocation;
  const $ = id => document.getElementById(id);
  const targetList = $('targetList');
  const targets = [];
  let nextId = 1;
  let displayFormat = 'abbrev';
  let lastResult = null;
  let lastModels = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]);
  }

  function format(value) {
    return U.formatCount(Number(value) || 0, displayFormat);
  }

  function plainCount(value) {
    if (!Number.isFinite(value) || value <= 0) return '0';
    return BigInt(Math.floor(value)).toString();
  }

  function percent(value, digits=3) {
    return `${(Number(value) * 100).toLocaleString('en-US', {maximumFractionDigits:digits})}%`;
  }

  function targetById(id) {
    return targets.find(target => target.id === Number(id));
  }

  function invalidateResults() {
    const hadResult = Boolean(lastResult);
    lastResult = null;
    lastModels = null;
    $('results').classList.add('hidden');
    if (hadResult) {
      $('inputStatus').className = 'status';
      $('inputStatus').textContent = 'Inputs changed. Calculate again to refresh the allocation.';
    }
  }

  function parsedPreview(target) {
    if (!target.model || !target.parsed) return '';
    const unitRows = Object.entries(target.model.composition).map(([name, count]) => {
      const value = target.parsed.rawCounts[name] || U.formatCount(count, 'commas');
      return `<li><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></li>`;
    }).join('');
    const resources = ['ore', 'crystal', 'hydrogen'].map(key => {
      const raw = target.parsed.rawResources[key];
      return `<li><span>${key[0].toUpperCase()}${key.slice(1)}</span><strong>${raw ? escapeHtml(raw) : (target.parsed.resources[key] === undefined ? 'Not found' : U.formatCount(target.parsed.resources[key], 'commas'))}</strong></li>`;
    }).join('');
    const tech = ['weapons', 'shield', 'armor'].map(key =>
      `${key[0].toUpperCase()}${key.slice(1)} ${target.model.defenderTech[key]}`
    ).join(' · ');
    const unknown = target.parsed.unknown.length
      ? `<section class="allocation-unparsed"><h4>Review unparsed count lines</h4><ul>${target.parsed.unknown.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></section>`
      : '';
    return `<div class="allocation-preview-grid">
      <section><h4>Parsed ships and defenses</h4><ul>${unitRows}</ul></section>
      <section><h4>Report resources</h4><ul>${resources}</ul></section>
    </div><p class="allocation-preview-tech">NPC tech used: ${escapeHtml(tech)}${Object.keys(target.parsed.tech).length ? ' (from report)' : ' (default inputs)'}</p>${unknown}`;
  }

  function renderTargets() {
    targetList.innerHTML = targets.map((target, index) => `
      <article class="allocation-target panel" data-target-id="${target.id}">
        <div class="allocation-target-head">
          <h3>Target ${index + 1}</h3>
          <button class="ghost compact-button remove-target" type="button" data-action="remove" data-target-id="${target.id}" aria-label="Remove target ${index + 1}" ${targets.length <= 1 ? 'disabled' : ''}>Remove</button>
        </div>
        <label class="location-input">Planet location
          <input data-field="location" value="${escapeHtml(target.location)}" placeholder="[8:115:3]" autocomplete="off" spellcheck="false">
        </label>
        <label>Espionage report
          <textarea data-field="report" class="allocation-report" spellcheck="false" placeholder="Paste this planet's ship, defense, tech, and resource report here…">${escapeHtml(target.report)}</textarea>
        </label>
        <div class="allocation-target-actions">
          <button class="ghost compact-button" type="button" data-action="parse" data-target-id="${target.id}">Parse report</button>
          <span class="status target-status" data-target-status="${target.id}" role="status" aria-live="polite">${escapeHtml(target.status || 'Paste one report for this target.')}</span>
        </div>
        <div class="allocation-preview ${target.model ? '' : 'hidden'}">${parsedPreview(target)}</div>
      </article>`).join('');
  }

  function parseTarget(target) {
    const location = A.parseLocation(target.location);
    if (!location) throw new Error(`${target.location || 'A target'} needs a location like [8:115:3] (galaxy 1–100, system 1–500, planet 1–15).`);
    if (!target.report.trim()) throw new Error(`${location.normalized} needs an espionage report.`);

    const parsed = P.parseEspionageReport(target.report);
    const composition = Object.fromEntries(Object.entries(parsed.composition)
      .filter(([name, count]) => U.UNITS[name] && Number(count) > 0));
    if (!Object.keys(composition).length) throw new Error(`${location.normalized}: no supported ship or defense counts were found in the report.`);

    target.parsed = parsed;
    target.model = {
      id:target.id,
      location:location.normalized,
      composition,
      defenderTech:{...defaultDefenderTech(), ...parsed.tech},
      resources:{ore:Number(parsed.resources.ore) || 0, crystal:Number(parsed.resources.crystal) || 0, hydrogen:Number(parsed.resources.hydrogen) || 0},
      hasResources:parsed.hasResources,
      parsedResourceKeys:Object.keys(parsed.resources),
      rawCounts:{...parsed.rawCounts},
      rawResources:{...parsed.rawResources}
    };
    const unitCount = Object.keys(composition).length;
    const resourceText = parsed.hasResources
      ? `; resources: ${target.model.parsedResourceKeys.join(', ')}`
      : '; no resource values found';
    const unknownText = parsed.unknown.length ? `; review ${parsed.unknown.length} unparsed count line${parsed.unknown.length === 1 ? '' : 's'}` : '';
    target.status = `Parsed ${unitCount} supported unit types${Object.keys(parsed.tech).length ? '; report tech found' : '; using default NPC tech'}${resourceText}${unknownText}.`;
    return target.model;
  }

  function defaultDefenderTech() {
    return {
      weapons:readTech('defenderWeapons'),
      shield:readTech('defenderShield'),
      armor:readTech('defenderArmor')
    };
  }

  function readTech(id) {
    const value = Number($(id).value);
    if (!Number.isFinite(value) || value < 0) throw new Error('Technology values must be zero or greater.');
    return value;
  }

  function readAvailableZeus() {
    const value = P.parseCount($('availableZeus').value);
    if (!Number.isFinite(value) || value < 1) throw new Error('Enter an available Zeus fleet of at least 1.');
    return Math.floor(value);
  }

  function readLossLimitPercent() {
    const field = $('lossLimitPercent');
    if (!field.value.trim()) return 0.1;
    const value = Number(field.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Maximum expected Zeus losses must be between 0 and 100%.');
    return value;
  }

  function validateObjectiveReports(models, objective) {
    if (objective === 'dsp') return;
    for (const target of models) {
      const label = target.location;
      if (objective === 'hydrogen' && !target.parsedResourceKeys.includes('hydrogen')) {
        throw new Error(`${label}: add a Hydrogen resource value to use the hydrogen objective.`);
      }
      if (objective === 'resourcesDebris') {
        const missing = ['ore', 'crystal', 'hydrogen'].filter(key => !target.parsedResourceKeys.includes(key));
        if (missing.length) throw new Error(`${label}: the resources + debris objective needs Ore, Crystal, and Hydrogen values (missing ${missing.join(', ')}).`);
      }
    }
  }

  function groupedResources(resources) {
    return `<span class="allocation-pair"><span>Ore ${format(resources.ore)}</span><span>Crystal ${format(resources.crystal)}</span><span>Hydrogen ${format(resources.hydrogen)}</span></span>`;
  }

  function groupedDebris(outcome) {
    return `<span class="allocation-pair"><span>Ore ${format(outcome.debrisOreGenerated)}</span><span>Crystal ${format(outcome.debrisCrystalGenerated)}</span></span>`;
  }

  function waveOutput(waves) {
    if (!waves.length) return '—';
    return `<span class="allocation-pair">${waves.map(wave => `<span>Wave ${wave.number}: ${format(wave.carmanors)}</span>`).join('')}</span><small>if each wave is won</small>`;
  }

  function renderAllocationTable(result) {
    const rows = result.allocations.map(({target, outcome}) => {
      const model = target.model;
      const totalDSP = outcome.battle ? outcome.battle.initialDSP : 0;
      const dspPercent = totalDSP > 0 ? outcome.dspDestroyed / totalDSP : 0;
      return `<tr>
        <td><strong>${escapeHtml(model.location)}</strong></td>
        <td><span class="allocation-copy"><code>${escapeHtml(plainCount(outcome.zeusCount))}</code><button class="copy-count-button" type="button" data-copy-value="${escapeHtml(plainCount(outcome.zeusCount))}" aria-label="Copy Zeus count for ${escapeHtml(model.location)}" title="Copy Zeus count"><span aria-hidden="true">▢</span></button></span></td>
        <td>${format(outcome.zeusLosses)}<small>${percent(outcome.zeusLossFraction)} of Zeus sent</small></td>
        <td>${percent(outcome.winProbability)}</td>
        <td>${format(outcome.dspDestroyed)}<small>${percent(dspPercent)} of target DSP</small></td>
        <td>${groupedDebris(outcome)}</td>
        <td>${groupedResources(outcome.resourcesRaided)}</td>
        <td>${waveOutput(outcome.waves)}</td>
        <td>${format(outcome.objectiveValue)}</td>
      </tr>`;
    }).join('');
    $('allocationTable').innerHTML = `<table class="allocation-table">
      <thead><tr><th>Target</th><th>Zeus to send</th><th>Expected Zeus lost</th><th>Estimated full-win chance</th><th>Expected DSP destroyed</th><th>Gross debris</th><th>Expected resources raided</th><th>Carmanors per wave</th><th>Objective contribution</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderResults(result, objective, models) {
    const totalDSP = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.dspDestroyed, 0);
    const totalDebris = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.debrisGenerated, 0);
    const totalResources = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.resourcesRaided.total, 0);
    const totalHydrogen = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.resourcesRaided.hydrogen, 0);
    const tiles = [
      ['Optimized objective', `${format(result.totalObjectiveValue)} <small>${escapeHtml(result.objectiveLabel)}</small>`],
      ['Zeus committed', `${format(result.zeusCommitted)} <small>of ${format(result.availableZeus)} available</small>`],
      ['Zeus left unused', format(result.unusedZeus)],
      ['Expected Zeus lost', `${format(result.expectedZeusLosses)} <small>${percent(result.expectedLossFraction)} of available fleet</small>`],
      ['Expected DSP destroyed', format(totalDSP)],
      ['Expected gross debris', format(totalDebris)],
      ['Expected resources raided', format(totalResources)],
      ['Expected Hydrogen raided', format(totalHydrogen)]
    ];
    $('allocationMetrics').innerHTML = tiles.map(([label, value]) => `<div class="metric"><span class="k">${label}</span><span class="v">${value}</span></div>`).join('');
    $('resultHeading').textContent = `${result.objectiveLabel} across ${models.length} target${models.length === 1 ? '' : 's'}`;
    renderAllocationTable(result);

    const warning = $('allocationWarning');
    const lossPercent = result.expectedLossFraction * 100;
    if (lossPercent > 0.1 + 1e-9) {
      warning.textContent = `Caution: expected losses are ${lossPercent.toLocaleString('en-US', {maximumFractionDigits:3})}% of the available Zeus fleet. This exceeds the 0.1% warning threshold.`;
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
      warning.textContent = '';
    }
    if (result.searchTruncated) {
      warning.textContent = `${warning.textContent ? `${warning.textContent} ` : ''}The target-combination frontier was bounded for browser performance; the result is the best allocation found in that bounded search.`;
      warning.classList.remove('hidden');
    }
    $('results').classList.remove('hidden');
  }

  function solve() {
    const status = $('inputStatus');
    status.className = 'status';
    status.textContent = 'Parsing reports and searching allocations…';
    try {
      if (!targets.length) throw new Error('Add at least one target.');
      const models = targets.map(parseTarget);
      const locations = models.map(target => target.location);
      if (new Set(locations).size !== locations.length) throw new Error('Each location can only appear once; Zeus attacks are not repeated on a target.');
      const objective = $('objective').value;
      validateObjectiveReports(models, objective);
      const availableZeus = readAvailableZeus();
      const lossPercent = readLossLimitPercent();
      const maxExpectedLosses = A.expectedLossLimit(availableZeus, lossPercent);
      const config = {
        availableZeus,
        maxExpectedLosses,
        objective,
        attackerTech:{weapons:readTech('attackerWeapons'), shield:readTech('attackerShield'), armor:readTech('attackerArmor')},
        defaultDefenderTech:defaultDefenderTech()
      };
      const result = A.solve({...config, targets:models});
      renderTargets();
      lastResult = result;
      lastModels = models;
      renderResults(result, objective, models);
      status.className = 'status success';
      status.textContent = `Allocation calculated for ${models.length} distinct target${models.length === 1 ? '' : 's'}. Check each location and parsed report above before using the recommendations.`;
      $('results').scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) {
      status.className = 'status error';
      status.textContent = error.message || 'Unable to calculate this allocation.';
      const badTarget = targets.find(target => target.status.startsWith('Error:'));
      if (badTarget) renderTargets();
    }
  }

  function setTargetStatus(target, message, state='neutral') {
    target.status = `${state === 'error' ? 'Error: ' : ''}${message}`;
    const status = targetList.querySelector(`[data-target-status="${target.id}"]`);
    if (status) {
      status.textContent = target.status;
      status.classList.toggle('error', state === 'error');
      status.classList.toggle('success', state === 'success');
    }
  }

  function handleTargetAction(action, id) {
    const target = targetById(id);
    if (!target) return;
    if (action === 'remove') {
      if (targets.length > 1) targets.splice(targets.indexOf(target), 1);
      invalidateResults();
      renderTargets();
      return;
    }
    if (action === 'parse') {
      try {
        const model = parseTarget(target);
        setTargetStatus(target, target.status.replace(/^Error: /, ''), 'success');
        target.model = model;
        $('inputStatus').textContent = '';
        renderTargets();
      } catch (error) {
        setTargetStatus(target, error.message, 'error');
      }
    }
  }

  targetList.addEventListener('input', event => {
    const card = event.target.closest('[data-target-id]');
    if (!card || !event.target.dataset.field) return;
    const target = targetById(card.dataset.targetId);
    if (!target) return;
    target[event.target.dataset.field === 'report' ? 'report' : 'location'] = event.target.value;
    invalidateResults();
    if (event.target.dataset.field === 'report') {
      target.parsed = null;
      target.model = null;
      setTargetStatus(target, 'Report changed; parse again or calculate to refresh it.');
      const preview = targetList.querySelector(`[data-target-id="${target.id}"] .allocation-preview`);
      if (preview) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
      }
    }
  });

  targetList.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) handleTargetAction(button.dataset.action, button.dataset.targetId);
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-value]');
    if (!button) return;
    const value = button.dataset.copyValue;
    try {
      await navigator.clipboard.writeText(value);
      button.classList.add('copied');
      button.title = 'Copied';
      window.setTimeout(() => { button.classList.remove('copied'); button.title = 'Copy Zeus count'; }, 1200);
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = value;
      document.body.append(temporary);
      temporary.select();
      document.execCommand('copy');
      temporary.remove();
    }
  });

  $('addTargetBtn').addEventListener('click', () => {
    invalidateResults();
    targets.push({id:nextId++, location:'', report:'', status:''});
    renderTargets();
    targetList.lastElementChild?.querySelector('[data-field="location"]')?.focus();
  });
  $('displayFormat').addEventListener('change', event => {
    displayFormat = event.target.value;
    if (lastResult && lastModels) renderResults(lastResult, lastResult.objective, lastModels);
  });
  document.querySelector('.allocation-controls').addEventListener('input', invalidateResults);
  document.querySelector('.allocation-controls').addEventListener('change', invalidateResults);
  $('solveBtn').addEventListener('click', solve);
  $('availableZeus').addEventListener('input', () => { $('availableZeus').classList.remove('invalid'); });
  targets.push({id:nextId++, location:'', report:'', status:''});
  renderTargets();
})(typeof globalThis !== 'undefined' ? globalThis : this);
