(function (root) {
  'use strict';

  const U = root.SFCUnits;
  const P = root.SFCBattleReportParser;
  const A = root.SFCFleetAllocation;
  const C = root.SFCSvgCharts;
  const $ = id => document.getElementById(id);
  const targetList = $('targetList');
  const targets = [];
  let nextId = 1;
  let displayFormat = 'abbrev';
  let lastFrontier = null;
  let lastSingleResult = null;
  let lastModels = null;
  let selectedFrontierIndex = 0;

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
    const hadResult = Boolean(lastFrontier || lastSingleResult);
    lastFrontier = null;
    lastSingleResult = null;
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
      const value = target.model.rawCounts[name] ?? U.formatCount(count, 'commas');
      return `<li><span>${escapeHtml(name)}</span><input class="allocation-edit-count" data-edit-kind="unit" data-edit-key="${escapeHtml(name)}" aria-label="${escapeHtml(name)} count" inputmode="decimal" value="${escapeHtml(value)}"></li>`;
    }).join('');
    const resources = ['ore', 'crystal', 'hydrogen'].map(key => {
      const raw = target.model.rawResources[key] ?? (target.model.availableResourceKeys.has(key) ? U.formatCount(target.model.resources[key], 'commas') : '');
      return `<li><span>${key[0].toUpperCase()}${key.slice(1)}</span><input class="allocation-edit-count" data-edit-kind="resource" data-edit-key="${key}" aria-label="${key} resource amount" inputmode="decimal" placeholder="Not found" value="${escapeHtml(raw)}"></li>`;
    }).join('');
    const missingUnits = Object.keys(U.UNITS).filter(name => !Object.prototype.hasOwnProperty.call(target.model.composition, name));
    const addUnitControl = missingUnits.length
      ? `<div class="allocation-add-unit"><select data-add-unit-select aria-label="Unit type to add"><option value="">Add an unlisted unit…</option>${missingUnits.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select><button class="ghost compact-button" type="button" data-action="add-unit" data-target-id="${target.id}">Add unit</button></div>`
      : '';
    const tech = ['weapons', 'shield', 'armor'].map(key => {
      const value = target.model.defenderTech[key];
      const source = target.parsed.tech[key] === undefined ? 'default' : 'report';
      return `<span>${key[0].toUpperCase()}${key.slice(1)} ${escapeHtml(value)} <small>(${source})</small></span>`;
    }).join('');
    const unknown = target.parsed.unknown.length
      ? `<section class="allocation-unparsed"><h4>Review unparsed count lines</h4><ul>${target.parsed.unknown.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul></section>`
      : '';
    return `<div class="allocation-preview-grid">
      <section><h4>Parsed ships and defenses · editable</h4><ul>${unitRows}</ul>${addUnitControl}</section>
      <section><h4>Report resources · editable</h4><ul>${resources}</ul></section>
    </div><p class="allocation-preview-tech"><strong>Combat tech levels:</strong>${tech}</p>${unknown}`;
  }

  function targetSummary(target) {
    const location = target.location || target.model?.location || 'Location not set';
    if (target.model) {
      const totals = A.summarizeFleet(target.model.composition);
      const ships = totals.invalidShips ? 'check counts' : format(totals.ships);
      const defenses = totals.invalidDefenses ? 'check counts' : format(totals.defenses);
      const dsp = totals.invalidShips ? 'check counts' : format(totals.dsp);
      const defenseRSP = totals.invalidDefenses ? 'check counts' : format(totals.defenseRSP);
      const hydrogen = !target.model.availableResourceKeys.has('hydrogen')
        ? 'not reported'
        : Number.isFinite(target.model.resources.hydrogen) && target.model.resources.hydrogen >= 0
          ? format(target.model.resources.hydrogen)
          : 'check amount';
      const zeusEstimate = targetZeusEstimate(target, target.collapsed);
      return `${location} · ${ships} ships · ${defenses} defenses · ${dsp} DSP · ${hydrogen} Hydrogen · ${defenseRSP} Defense RSP${zeusEstimate ? ` · ${zeusEstimate}` : ''}`;
    }
    if (target.status.startsWith('Error:')) return `${location} · ${target.status.slice(7)}`;
    return `${location} · Ships — · Defenses — · Not parsed`;
  }

  function refreshTargetSummary(target) {
    const summary = targetList.querySelector(`[data-target-id="${target.id}"] .allocation-target-summary`);
    if (summary) summary.textContent = targetSummary(target);
  }

  function targetZeusEstimate(target, shouldCalculate=false) {
    if (!target.model) return '';
    const totals = A.summarizeFleet(target.model.composition);
    if (totals.invalidShips || totals.invalidDefenses) return shouldCalculate ? '90% DSP estimate: check counts' : '';
    let availableZeus;
    let maxExpectedLosses;
    let attackerTech;
    let fallbackDefenderTech;
    try {
      availableZeus = readAvailableZeus();
      maxExpectedLosses = A.expectedLossLimit(availableZeus, readLossLimitPercent());
      attackerTech = {
        weapons:readTech('attackerWeapons'),
        shield:readTech('attackerShield'),
        armor:readTech('attackerArmor')
      };
      fallbackDefenderTech = defaultDefenderTech();
    } catch (error) {
      return shouldCalculate ? '90% DSP estimate: check fleet and tech inputs' : '';
    }
    const defenderTech = {...fallbackDefenderTech, ...(target.parsed?.tech || {})};
    const rfSigma = $('conservativeEstimates').checked ? 2 : 0;
    const key = JSON.stringify([target.model.composition, availableZeus, maxExpectedLosses, attackerTech, defenderTech, rfSigma]);
    if (target.zeusEstimate?.key === key) {
      if (target.zeusEstimate.message) return target.zeusEstimate.message;
      return target.zeusEstimate.zeusCount === null
        ? '90% DSP / 99.9% survival: not reached'
        : `90% DSP / 99.9% survival: ~${format(target.zeusEstimate.zeusCount)} Zeus`;
    }
    if (!shouldCalculate) return '';
    if (!(totals.dsp > 0)) {
      target.zeusEstimate = {key, zeusCount:null, message:'No ship DSP to destroy'};
      return target.zeusEstimate.message;
    }
    const model = {
      ...target.model,
      defenderTech
    };
    let options;
    try {
      options = A.targetOptions(model, {
        availableZeus,
        maxExpectedLosses,
        objective:'dsp',
        objectiveKeys:['dsp'],
        attackerTech,
        defaultDefenderTech:fallbackDefenderTech,
        rfSigma
      });
    } catch (error) {
      target.zeusEstimate = {key, zeusCount:null, message:'90% DSP estimate unavailable'};
      return target.zeusEstimate.message;
    }
    const breakpoint = options.find(option => option.zeusCount > 0
      && option.dspDestroyedFraction >= 0.9 - 1e-12
      && option.zeusSurvival >= A.MIN_ATTACK_SURVIVAL - 1e-12);
    target.zeusEstimate = {key, zeusCount:breakpoint ? breakpoint.zeusCount : null};
    return breakpoint
      ? `90% DSP / 99.9% survival: ~${format(breakpoint.zeusCount)} Zeus`
      : '90% DSP / 99.9% survival: not reached';
  }

  function renderTargets() {
    targetList.innerHTML = targets.map((target, index) => `
      <article class="allocation-target panel${target.collapsed ? ' is-collapsed' : ''}" data-target-id="${target.id}">
        <div class="allocation-target-head">
          <h3><span>Target ${index + 1}</span><small class="allocation-target-summary">${escapeHtml(targetSummary(target))}</small></h3>
          <div class="allocation-target-head-actions">
            <button class="ghost compact-button" type="button" data-action="toggle-collapse" data-target-id="${target.id}" aria-expanded="${!target.collapsed}" aria-controls="target-details-${target.id}">${target.collapsed ? 'Expand' : 'Collapse'}</button>
            <button class="ghost compact-button remove-target" type="button" data-action="remove" data-target-id="${target.id}" aria-label="Remove target ${index + 1}" ${targets.length <= 1 ? 'disabled' : ''}>Remove</button>
          </div>
        </div>
        <div id="target-details-${target.id}" class="allocation-target-details">
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
        </div>
      </article>`).join('');
  }

  function parseTarget(target) {
    if (!target.report.trim()) throw new Error('Paste an espionage report for this target.');
    const detectedLocation = P.parseEspionageLocation(target.report);
    if (target.locationSource !== 'manual' && detectedLocation) {
      target.location = detectedLocation.normalized;
      target.locationSource = 'report';
      target.detectedLocation = true;
    }
    const location = A.parseLocation(target.location);
    if (!location) throw new Error(`${target.location || 'This target'} needs a location like [8:115:3] (galaxy 1–100, system 1–500, planet 1–15).`);

    if (!target.parsed || !target.model) {
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
        availableResourceKeys:new Set(Object.keys(parsed.resources)),
        rawCounts:{...parsed.rawCounts},
        rawResources:{...parsed.rawResources}
      };
      const unitCount = Object.keys(composition).length;
      const resourceText = parsed.hasResources
        ? `; resources: ${Object.keys(parsed.resources).join(', ')}`
        : '; no resource values found';
      const unknownText = parsed.unknown.length ? `; review ${parsed.unknown.length} unparsed count line${parsed.unknown.length === 1 ? '' : 's'}` : '';
      const locationText = target.detectedLocation ? `; location detected ${location.normalized}` : '';
      target.status = `Parsed ${unitCount} supported unit types${Object.keys(parsed.tech).length ? '; report tech found' : '; using default NPC tech'}${resourceText}${locationText}${unknownText}.`;
    }
    target.model.location = location.normalized;
    target.model.defenderTech = {...defaultDefenderTech(), ...target.parsed.tech};
    for (const [name, count] of Object.entries(target.model.composition)) {
      if (!U.UNITS[name] || !Number.isFinite(count) || count < 0) throw new Error(`${location.normalized}: check the edited count for ${name}.`);
    }
    for (const [key, value] of Object.entries(target.model.resources)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${location.normalized}: check the edited ${key} amount.`);
    }
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

  function validateObjectiveReports(models, objectiveKeys) {
    const objectives = new Set(objectiveKeys);
    if (!objectives.has('hydrogen') && !objectives.has('resourcesDebris')) return;
    for (const target of models) {
      const label = target.location;
      if (objectives.has('hydrogen') && !target.availableResourceKeys.has('hydrogen')) {
        throw new Error(`${label}: enter a Hydrogen resource value to use the hydrogen objective.`);
      }
      if (objectives.has('resourcesDebris')) {
        const missing = ['ore', 'crystal', 'hydrogen'].filter(key => !target.availableResourceKeys.has(key));
        if (missing.length) throw new Error(`${label}: enter Ore, Crystal, and Hydrogen values for the resources + debris objective (missing ${missing.join(', ')}).`);
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

  function objectiveLabel(key) {
    return ({
      dsp:'NPC ship DSP destroyed',
      hydrogen:'Hydrogen raided',
      resourcesDebris:'Resources raided + gross debris',
      zeusLosses:'Expected Zeus lost'
    })[key] || key;
  }

  function renderAllocationTable(allocations, objectiveKeys) {
    const objectiveHeaders = objectiveKeys.map(key => `<th>${escapeHtml(objectiveLabel(key))}${A.OBJECTIVES[key]?.direction === 'minimize' ? ' <small>(minimize)</small>' : ''}</th>`).join('');
    const rows = allocations.map(({target, outcome}) => {
      const model = target;
      const totalDSP = outcome.battle ? outcome.battle.initialDSP : 0;
      const dspPercent = totalDSP > 0 ? outcome.dspDestroyed / totalDSP : 0;
      const objectiveCells = objectiveKeys.map(key => `<td>${format(outcome.objectiveValues[key])}</td>`).join('');
      return `<tr>
        <td><strong>${escapeHtml(model.location)}</strong></td>
        <td><span class="allocation-copy"><code>${escapeHtml(plainCount(outcome.zeusCount))}</code><button class="copy-count-button" type="button" data-copy-value="${escapeHtml(plainCount(outcome.zeusCount))}" aria-label="Copy Zeus count for ${escapeHtml(model.location)}" title="Copy Zeus count"><span aria-hidden="true">▢</span></button></span></td>
        <td>${format(outcome.zeusLosses)}<small>${percent(outcome.zeusLossFraction)} of Zeus sent</small></td>
        <td>${percent(outcome.winProbability)}</td>
        <td>${format(outcome.dspDestroyed)}<small>${percent(dspPercent)} of target DSP</small></td>
        <td>${groupedDebris(outcome)}</td>
        <td>${groupedResources(outcome.resourcesRaided)}</td>
        <td>${waveOutput(outcome.waves)}</td>
        ${objectiveCells}
      </tr>`;
    }).join('');
    $('allocationTable').innerHTML = `<table class="allocation-table">
      <thead><tr><th>Target</th><th>Zeus to send</th><th>Expected Zeus lost</th><th>Estimated full-win chance</th><th>Expected DSP destroyed</th><th>Gross debris</th><th>Expected resources raided</th><th>Carmanors per wave</th>${objectiveHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderFrontierPointDetails(frontier, point, pointIndex) {
    const [objectiveX, objectiveY] = frontier.objectiveKeys;
    const attacks = point.allocations.map(({target, outcome}) => {
      const count = plainCount(outcome.zeusCount);
      const losses = outcome.zeusCount > 0 ? `${format(outcome.zeusLosses)} lost · ${percent(outcome.zeusSurvival)} survive` : 'No attack';
      return `<li><strong>${escapeHtml(target.location)}</strong><span>${losses}</span><span class="allocation-copy"><code>${escapeHtml(count)}</code><button class="copy-count-button" type="button" data-copy-value="${escapeHtml(count)}" aria-label="Copy Zeus count for ${escapeHtml(target.location)}" title="Copy Zeus count"><span aria-hidden="true">▢</span></button></span></li>`;
    }).join('');
    $('frontierPointDetails').innerHTML = `
      <div class="point-heading"><div><span class="side-label">Frontier point ${pointIndex + 1} of ${frontier.points.length}</span><strong>${escapeHtml(objectiveLabel(objectiveX))}: ${format(point.objectiveValues[objectiveX])} · ${escapeHtml(objectiveLabel(objectiveY))}: ${format(point.objectiveValues[objectiveY])}</strong></div><span class="point-hint">Hover, focus, or click another point to inspect its attack mix</span></div>
      <div class="point-facts allocation-frontier-facts">
        <div><span>${format(point.zeusCommitted)}</span><small>Zeus committed</small></div>
        <div><span>${format(point.unusedZeus)}</span><small>Zeus left unused</small></div>
        <div><span>${format(point.expectedZeusLosses)}</span><small>Expected Zeus lost</small></div>
        <div><span>${percent(point.expectedLossFraction)}</span><small>Of available fleet</small></div>
      </div>
      <h3 class="allocation-mix-heading">Exact attack mix <small>Zeus counts are copyable</small></h3>
      <ul class="allocation-mix">${attacks}</ul>`;
  }

  function renderFrontierMetrics(frontier, point) {
    const totalDSP = point.allocations.reduce((sum, allocation) => sum + allocation.outcome.dspDestroyed, 0);
    const totalDebris = point.allocations.reduce((sum, allocation) => sum + allocation.outcome.debrisGenerated, 0);
    const totalResources = point.allocations.reduce((sum, allocation) => sum + allocation.outcome.resourcesRaided.total, 0);
    const [objectiveX, objectiveY] = frontier.objectiveKeys;
    const tiles = [
      [objectiveLabel(objectiveX), format(point.objectiveValues[objectiveX])],
      [objectiveLabel(objectiveY), format(point.objectiveValues[objectiveY])],
      ['Zeus committed', `${format(point.zeusCommitted)} <small>of ${format(frontier.availableZeus)} available</small>`],
      ['Expected Zeus lost', `${format(point.expectedZeusLosses)} <small>${percent(point.expectedLossFraction)} of available fleet</small>`],
      ['Expected DSP destroyed', format(totalDSP)],
      ['Expected gross debris', format(totalDebris)],
      ['Expected resources raided', format(totalResources)]
    ];
    $('allocationMetrics').innerHTML = tiles.map(([label, value]) => `<div class="metric"><span class="k">${label}</span><span class="v">${value}</span></div>`).join('');
  }

  function renderFrontierPoint(frontier, pointIndex) {
    const point = frontier.points[pointIndex];
    if (!point) return;
    const chart = $('allocationFrontierChart');
    const previous = chart.querySelector(`[data-frontier-point="${selectedFrontierIndex}"]`);
    const selected = chart.querySelector(`[data-frontier-point="${pointIndex}"]`);
    previous?.classList.remove('is-selected');
    previous?.setAttribute('aria-pressed', 'false');
    selected?.classList.add('is-selected');
    selected?.setAttribute('aria-pressed', 'true');
    selectedFrontierIndex = pointIndex;
    renderFrontierMetrics(frontier, point);
    renderFrontierPointDetails(frontier, point, pointIndex);
    renderAllocationTable(point.allocations, frontier.objectiveKeys);

    const warning = $('allocationWarning');
    const lossPercent = point.expectedLossFraction * 100;
    if (lossPercent > 0.1 + 1e-9) {
      warning.textContent = `Caution: expected losses are ${lossPercent.toLocaleString('en-US', {maximumFractionDigits:3})}% of the available Zeus fleet. This exceeds the 0.1% warning threshold.`;
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
      warning.textContent = '';
    }
    if (frontier.searchTruncated) {
      warning.textContent = `${warning.textContent ? `${warning.textContent} ` : ''}The target-combination frontier was bounded for browser performance; the displayed frontier is an approximation from that bounded search.`;
      warning.classList.remove('hidden');
    }
  }

  function renderFrontierChart(frontier) {
    const width = 960;
    const height = 420;
    const margin = {l:92, r:28, t:24, b:68};
    const [objectiveX, objectiveY] = frontier.objectiveKeys;
    const valuesX = frontier.points.map(point => point.objectiveValues[objectiveX]);
    const valuesY = frontier.points.map(point => point.objectiveValues[objectiveY]);
    const xScale = C.createScale([0, Math.max(0, ...valuesX)], [margin.l, width - margin.r], 'log1p');
    const yMinimizes = A.OBJECTIVES[objectiveY]?.direction === 'minimize';
    const yScale = C.createScale([0, Math.max(0, ...valuesY)], yMinimizes ? [margin.t, height - margin.b] : [height - margin.b, margin.t], 'log1p');
    const plotWidth = width - margin.l - margin.r;
    const plotHeight = height - margin.t - margin.b;
    let grid = '';
    for (const value of xScale.ticks(5)) {
      const x = xScale(value);
      grid += C.line({x1:x, y1:margin.t, x2:x, y2:height - margin.b});
      grid += C.text({x, y:height - margin.b + 22, value:format(value)});
    }
    for (const value of yScale.ticks(5)) {
      const y = yScale(value);
      grid += C.line({x1:margin.l, y1:y, x2:width - margin.r, y2:y});
      grid += C.text({x:margin.l - 10, y:y + 4, anchor:'end', value:format(value)});
    }
    const frontierPath = C.linePath(frontier.points,
      point => point.objectiveValues[objectiveX],
      point => point.objectiveValues[objectiveY],
      xScale, yScale);
    const dots = frontier.points.map((point, index) => {
      const xValue = point.objectiveValues[objectiveX];
      const yValue = point.objectiveValues[objectiveY];
      const yGoal = yMinimizes ? ' (lower is better)' : '';
      const label = `Frontier point ${index + 1}: ${objectiveLabel(objectiveX)} ${format(xValue)}, ${objectiveLabel(objectiveY)} ${format(yValue)}${yGoal}, ${format(point.zeusCommitted)} Zeus committed, ${format(point.expectedZeusLosses)} expected losses`;
      return C.circle({
        cx:xScale(xValue), cy:yScale(yValue), r:5,
        className:'chart-dot frontier-dot',
        attributes:{
          tabindex:'0', role:'button', 'aria-label':label,
          'aria-pressed':String(index === selectedFrontierIndex),
          'data-frontier-point':index
        },
        title:label
      });
    }).join('');
    const centerX = margin.l + plotWidth / 2;
    const centerY = margin.t + plotHeight / 2;
    const chart = $('allocationFrontierChart');
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Pareto frontier of ${escapeHtml(objectiveLabel(objectiveX))} versus ${escapeHtml(objectiveLabel(objectiveY))}">${grid}${C.path(frontierPath, 'curve pareto-frontier')}${dots}${C.text({x:centerX, y:height - 12, className:'label', value:`${objectiveLabel(objectiveX)} (log scale)`})}${C.text({x:18, y:centerY, className:'label', transform:`rotate(-90 18 ${centerY})`, value:`${objectiveLabel(objectiveY)}${yMinimizes ? ' (fewer is better)' : ''} (log scale)`})}</svg>`;
    C.bindPointInteractions(chart, {
      selector:'.frontier-dot',
      onPoint:dot => {
        const pointIndex = Number(dot.dataset.frontierPoint);
        if (pointIndex !== selectedFrontierIndex) renderFrontierPoint(frontier, pointIndex);
      }
    });
  }

  function initialFrontierPoint(frontier) {
    let maxX = 1;
    let maxY = 1;
    for (const point of frontier.points) {
      maxX = Math.max(maxX, point.objectiveScores[frontier.objectiveKeys[0]]);
      maxY = Math.max(maxY, point.objectiveScores[frontier.objectiveKeys[1]]);
    }
    return frontier.points.reduce((bestIndex, point, index) => {
      const best = frontier.points[bestIndex];
      const score = point.objectiveScores[frontier.objectiveKeys[0]] / maxX
        + point.objectiveScores[frontier.objectiveKeys[1]] / maxY;
      const bestScore = best.objectiveScores[frontier.objectiveKeys[0]] / maxX
        + best.objectiveScores[frontier.objectiveKeys[1]] / maxY;
      return score > bestScore ? index : bestIndex;
    }, 0);
  }

  function renderResults(frontier, models, preferredIndex=null) {
    const scenario = frontier.rfSigma > 0 ? 'Conservative RF (2σ)' : 'Expected RF';
    $('resultScenario').textContent = `${scenario} · Two-objective Pareto frontier`;
    $('resultHeading').textContent = `${objectiveLabel(frontier.objectiveKeys[0])} vs ${objectiveLabel(frontier.objectiveKeys[1])} across ${models.length} target${models.length === 1 ? '' : 's'}`;
    document.querySelector('.allocation-frontier-point-panel').classList.remove('hidden');
    document.querySelector('.allocation-frontier-panel').classList.remove('hidden');
    document.querySelector('.allocation-results-panel h2').textContent = 'Selected frontier point · detailed plan';
    $('results').classList.remove('hidden');
    const pointIndex = preferredIndex === null ? initialFrontierPoint(frontier) : Math.min(preferredIndex, frontier.points.length - 1);
    selectedFrontierIndex = pointIndex;
    renderFrontierChart(frontier);
    renderFrontierPoint(frontier, pointIndex);
  }

  function renderSingleResults(result, models) {
    const scenario = result.rfSigma > 0 ? 'Conservative RF (2σ)' : 'Expected RF';
    $('resultScenario').textContent = `${scenario} · Single-objective optimum`;
    $('resultHeading').textContent = `Best allocation for ${objectiveLabel(result.objective)} across ${models.length} target${models.length === 1 ? '' : 's'}`;
    document.querySelector('.allocation-frontier-point-panel').classList.add('hidden');
    document.querySelector('.allocation-frontier-panel').classList.add('hidden');
    document.querySelector('.allocation-results-panel h2').textContent = 'Optimal allocation · detailed plan';
    $('results').classList.remove('hidden');
    const totalDSP = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.dspDestroyed, 0);
    const totalDebris = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.debrisGenerated, 0);
    const totalResources = result.allocations.reduce((sum, allocation) => sum + allocation.outcome.resourcesRaided.total, 0);
    const tiles = [
      [objectiveLabel(result.objective), format(result.totalObjectiveValue)],
      ['Zeus committed', `${format(result.zeusCommitted)} <small>of ${format(result.availableZeus)} available</small>`],
      ['Zeus left unused', format(result.unusedZeus)],
      ['Expected Zeus lost', `${format(result.expectedZeusLosses)} <small>${percent(result.expectedLossFraction)} of available fleet</small>`],
      ['Expected DSP destroyed', format(totalDSP)],
      ['Expected gross debris', format(totalDebris)],
      ['Expected resources raided', format(totalResources)]
    ];
    $('allocationMetrics').innerHTML = tiles.map(([label, value]) => `<div class="metric"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`).join('');
    renderAllocationTable(result.allocations, [result.objective]);
    const warning = $('allocationWarning');
    const lossPercent = result.expectedLossFraction * 100;
    const messages = [];
    if (lossPercent > 0.1 + 1e-9) messages.push(`Caution: expected losses are ${lossPercent.toLocaleString('en-US', {maximumFractionDigits:3})}% of the available Zeus fleet. This exceeds the 0.1% warning threshold.`);
    if (result.searchTruncated) messages.push('The target-combination search was bounded for browser performance; this single-objective result is an approximation.');
    warning.textContent = messages.join(' ');
    warning.classList.toggle('hidden', messages.length === 0);
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
      const objectiveX = $('objectiveX').value;
      const objectiveY = $('objectiveY').value;
      const objectives = [objectiveX, objectiveY].filter(Boolean);
      validateObjectiveReports(models, objectives);
      const availableZeus = readAvailableZeus();
      const lossPercent = readLossLimitPercent();
      const maxExpectedLosses = A.expectedLossLimit(availableZeus, lossPercent);
      const config = {
        availableZeus,
        maxExpectedLosses,
        objective:objectiveX,
        objectives,
        rfSigma:$('conservativeEstimates').checked ? 2 : 0,
        attackerTech:{weapons:readTech('attackerWeapons'), shield:readTech('attackerShield'), armor:readTech('attackerArmor')},
        defaultDefenderTech:defaultDefenderTech()
      };
      renderTargets();
      lastModels = models;
      if (objectiveY) {
        if (objectiveX === objectiveY) throw new Error('Choose a different Objective Y, or leave it blank for a single-objective optimum.');
        const result = A.solveFrontier({...config, targets:models});
        lastFrontier = result;
        lastSingleResult = null;
        renderResults(result, models);
      } else {
        const result = A.solve({...config, targets:models});
        lastSingleResult = result;
        lastFrontier = null;
        renderSingleResults(result, models);
      }
      status.className = 'status success';
      const rfScenario = config.rfSigma > 0 ? 'Conservative RF (2σ)' : 'Expected RF';
      status.textContent = `${objectiveY ? 'Pareto frontier' : 'Optimal allocation'} calculated using ${rfScenario} for ${models.length} distinct target${models.length === 1 ? '' : 's'}. Check each location and parsed report above before using the recommendations.`;
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
    refreshTargetSummary(target);
  }

  function handleTargetAction(action, id) {
    const target = targetById(id);
    if (!target) return;
    if (action === 'toggle-collapse') {
      target.collapsed = !target.collapsed;
      const card = targetList.querySelector(`[data-target-id="${target.id}"]`);
      const button = card?.querySelector('[data-action="toggle-collapse"]');
      card?.classList.toggle('is-collapsed', target.collapsed);
      if (button) {
        button.setAttribute('aria-expanded', String(!target.collapsed));
        button.textContent = target.collapsed ? 'Expand' : 'Collapse';
      }
      refreshTargetSummary(target);
      return;
    }
    if (action === 'remove') {
      if (targets.length > 1) targets.splice(targets.indexOf(target), 1);
      invalidateResults();
      renderTargets();
      return;
    }
    if (action === 'add-unit') {
      const card = targetList.querySelector(`[data-target-id="${target.id}"]`);
      const select = card?.querySelector('[data-add-unit-select]');
      const name = select?.value;
      if (!name || !U.UNITS[name] || !target.model) return;
      target.model.composition[name] = 0;
      target.model.rawCounts[name] = '0';
      invalidateResults();
      setTargetStatus(target, `Added ${name}; enter its count below.`);
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
    if (!card) return;
    const target = targetById(card.dataset.targetId);
    if (!target) return;
    if (event.target.dataset.editKind) {
      if (!target.model) return;
      const kind = event.target.dataset.editKind;
      const key = event.target.dataset.editKey;
      const raw = event.target.value;
      const parsedValue = raw.trim() ? P.parseCount(raw) : (kind === 'unit' ? 0 : NaN);
      if (kind === 'unit') {
        target.model.composition[key] = parsedValue;
        target.model.rawCounts[key] = raw;
      } else if (kind === 'resource') {
        target.model.resources[key] = Number.isFinite(parsedValue) ? parsedValue : (raw.trim() ? NaN : 0);
        target.model.rawResources[key] = raw;
        if (raw.trim() && Number.isFinite(parsedValue)) target.model.availableResourceKeys.add(key);
        else target.model.availableResourceKeys.delete(key);
      }
      invalidateResults();
      refreshTargetSummary(target);
      const valid = Number.isFinite(parsedValue) && parsedValue >= 0;
      event.target.classList.toggle('invalid', !valid);
      setTargetStatus(target, valid ? 'Edited values will be used in the next calculation.' : `Enter a valid nonnegative ${kind === 'unit' ? 'ship count' : 'resource amount'}.`, valid ? 'neutral' : 'error');
      return;
    }
    if (!event.target.dataset.field) return;
    target[event.target.dataset.field === 'report' ? 'report' : 'location'] = event.target.value;
    invalidateResults();
    refreshTargetSummary(target);
    if (event.target.dataset.field === 'location') {
      target.locationSource = event.target.value.trim() ? 'manual' : 'report';
      target.detectedLocation = false;
    }
    if (event.target.dataset.field === 'report') {
      target.parsed = null;
      target.model = null;
      if (target.locationSource === 'report') {
        target.location = '';
        target.detectedLocation = false;
        const locationInput = card.querySelector('[data-field="location"]');
        if (locationInput) locationInput.value = '';
      }
      setTargetStatus(target, 'Report changed; parse again or calculate to refresh it.');
      const preview = targetList.querySelector(`[data-target-id="${target.id}"] .allocation-preview`);
      if (preview) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
      }
    }
  });

  targetList.addEventListener('paste', event => {
    if (!event.target.matches('[data-field="report"]')) return;
    const card = event.target.closest('[data-target-id]');
    const target = targetById(card?.dataset.targetId);
    if (!target) return;
    window.setTimeout(() => {
      try {
        const model = parseTarget(target);
        target.model = model;
        setTargetStatus(target, target.status.replace(/^Error: /, ''), 'success');
        $('inputStatus').textContent = '';
      } catch (error) {
        target.collapsed = false;
        setTargetStatus(target, error.message, 'error');
      }
      renderTargets();
    }, 0);
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
    targets.push({id:nextId++, location:'', locationSource:'report', report:'', status:'', collapsed:false});
    renderTargets();
    targetList.lastElementChild?.querySelector('[data-field="location"]')?.focus();
  });
  $('displayFormat').addEventListener('change', event => {
    displayFormat = event.target.value;
    targets.forEach(refreshTargetSummary);
    if (lastFrontier && lastModels) renderResults(lastFrontier, lastModels, selectedFrontierIndex);
    else if (lastSingleResult && lastModels) renderSingleResults(lastSingleResult, lastModels);
  });
  document.querySelector('.allocation-controls').addEventListener('input', invalidateResults);
  document.querySelector('.allocation-controls').addEventListener('change', () => {
    invalidateResults();
    targets.filter(target => target.collapsed).forEach(refreshTargetSummary);
  });
  $('solveBtn').addEventListener('click', solve);
  $('availableZeus').addEventListener('input', () => { $('availableZeus').classList.remove('invalid'); });
  targets.push({id:nextId++, location:'', locationSource:'report', report:'', status:'', collapsed:false});
  renderTargets();
})(typeof globalThis !== 'undefined' ? globalThis : this);
