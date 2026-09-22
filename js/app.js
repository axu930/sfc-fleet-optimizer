(function () {
  'use strict';

  const M = Object.assign({}, window.SFCUnits, window.SFCBattleReportParser, window.SFCCombat, window.SFCOptimizer);
  const $ = id => document.getElementById(id);
  const SAMPLE = {
    Hades:1e8,
    Athena:5e7,
    Prometheus:1e7,
    'Gauss Cannon':2e8,
    'Plasma Cannon':2e7,
    'Large Decoy':1
  };
  const SCENARIOS = [
    {key:'expected', label:'Expected RF', rfSigma:0},
    {key:'conservative', label:'Conservative RF (2σ)', rfSigma:2}
  ];
  const POINT_COUNT = 64;
  const RANGE_SURVIVAL_TARGET = 0.9999;

  let displayFormat = 'abbrev';
  let lastScenarios = null;
  let lastReportParse = null;
  let lastRunConfig = null;
  let lastRange = null;
  let lastPoint = null;
  let lastPointScenario = null;
  let useConservativeRecommendations = false;
  let useCrystalHarvestingOnly = false;

  function formatCount(value) {
    return M.formatCount(value, displayFormat);
  }

  function debrisPair(ore, crystal) {
    return `${formatCount(ore)} ore · ${formatCount(crystal)} crystal`;
  }

  function debrisPairMarkup(ore, crystal) {
    return `<span class="debris-pair"><span>${formatCount(ore)} ore</span><span>${formatCount(crystal)} crystal</span></span>`;
  }

  function tech(prefix) {
    return {
      weapons:+$(prefix + 'w').value || 0,
      shield:+$(prefix + 's').value || 0,
      armor:+$(prefix + 'a').value || 0
    };
  }

  function pct(value, digits=3) {
    if (!Number.isFinite(value)) return '—';
    return (100 * value).toLocaleString(undefined, {
      minimumFractionDigits:Math.min(2, digits),
      maximumFractionDigits:digits
    }) + '%';
  }

  function number(value, digits=2) {
    return Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits:digits}) : '—';
  }

  function copyCount(value) {
    return Number.isFinite(value)
      ? Math.max(0, Math.ceil(value)).toLocaleString('en-US', {useGrouping:false, maximumFractionDigits:0})
      : '';
  }

  async function copyZeusCount(button) {
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
    const original = button.innerHTML;
    button.innerHTML = copied ? '<span aria-hidden="true">✓</span>' : '<span aria-hidden="true">!</span>';
    button.classList.toggle('copied', copied);
    button.title = copied ? 'Copied Zeus count' : 'Copy failed';
    setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove('copied');
      button.title = button.getAttribute('aria-label') || 'Copy Zeus count';
    }, 1400);
  }

  function unitInputId(name) {
    return 'unit-' + M.normalize(name);
  }

  function renderUnitInputs() {
    const groups = {ship:[], defense:[]};
    for (const [name, unit] of Object.entries(M.UNITS)) groups[unit.kind].push(name);
    for (const [kind, targetId] of [['ship','shipInputs'], ['defense','defenseInputs']]) {
      $(targetId).innerHTML = groups[kind].map(name => `
        <label class="unit-input" for="${unitInputId(name)}">
          <span>${name}</span>
          <input id="${unitInputId(name)}" data-unit="${name}" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="${name} count">
        </label>`).join('');
    }
  }

  function readComposition() {
    const composition = {};
    const invalid = [];
    for (const input of document.querySelectorAll('[data-unit]')) {
      const raw = input.value.trim();
      input.classList.remove('invalid');
      if (!raw) continue;
      const count = M.parseCount(raw);
      if (!Number.isFinite(count)) {
        input.classList.add('invalid');
        invalid.push(input.dataset.unit);
      } else if (count > 0) {
        composition[input.dataset.unit] = count;
      }
    }
    return {composition, invalid};
  }

  function setComposition(composition, rawCounts={}) {
    for (const input of document.querySelectorAll('[data-unit]')) {
      const name = input.dataset.unit;
      const count = composition && composition[name];
      input.value = count > 0 ? (rawCounts[name] || String(count)) : '';
      input.classList.remove('invalid');
    }
    updateInputSummary();
  }

  function updateInputSummary() {
    const {composition, invalid} = readComposition();
    const entries = Object.entries(composition);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const shipDSP = entries.reduce((sum, [name, count]) => {
      const unit = M.UNITS[name];
      return sum + (unit.kind === 'ship' ? count * unit.cost / 1000 : 0);
    }, 0);
    const summary = invalid.length
      ? `${invalid.length} invalid unit count${invalid.length === 1 ? '' : 's'}`
      : `${entries.length} populated classes · ${formatCount(total)} total units · ${formatCount(shipDSP)} modeled ship DSP`;
    $('inputSummary').textContent = summary;
    $('inputSummary').className = invalid.length ? 'fleet-summary error' : 'fleet-summary';
    return {composition, invalid};
  }

  function reportSideCard(label, key, data) {
    if (!data || !Object.keys(data.composition || {}).length) return '';
    const entries = Object.entries(data.composition);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const techs = data.tech || {};
    const techBits = [['W',techs.weapons], ['S',techs.shield], ['A',techs.armor]]
      .filter(([, value]) => Number.isFinite(value))
      .map(([name, value]) => `${name}${value}`);
    const list = entries.slice(0, 7)
      .map(([name, count]) => `<li><span>${name}</span><strong>${formatCount(count)}</strong></li>`)
      .join('');
    const more = entries.length > 7 ? `<li class="more"><span>+ ${entries.length - 7} more classes</span></li>` : '';
    return `<article class="report-side-card">
      <div class="report-side-head"><div><span class="side-label">${label}</span><strong>${entries.length} types · ${formatCount(total)} units</strong></div><span class="tech-pill">${techBits.length ? techBits.join(' · ') : 'AWS not detected'}</span></div>
      <ul>${list}${more}</ul>
    </article>`;
  }

  function reportSides(parsed) {
    const available = [];
    if (parsed && parsed.attacker && Object.keys(parsed.attacker.composition).length) available.push(['Attacker','attacker',parsed.attacker]);
    if (parsed && parsed.defender && Object.keys(parsed.defender.composition).length) available.push(['Defender','defender',parsed.defender]);
    if (parsed && parsed.unassigned && Object.keys(parsed.unassigned.composition).length) available.push(['Detected fleet','unassigned',parsed.unassigned]);
    return available;
  }

  function renderReportPreview(available=reportSides(lastReportParse)) {
    if (!available.length) {
      $('reportPreview').classList.add('hidden');
      return;
    }
    $('reportPreview').innerHTML = available.map(([label, key, data]) => reportSideCard(label, key, data)).join('');
    $('reportPreview').classList.remove('hidden');
  }

  function parseReport() {
    const text = $('reportText').value.trim();
    if (!text) {
      $('reportStatus').textContent = 'Paste a report first.';
      $('reportStatus').className = 'status error';
      $('reportPreview').classList.add('hidden');
      return;
    }
    const parsed = M.parseBattleReport(text);
    lastReportParse = parsed;
    const available = reportSides(parsed);
    if (!available.length) {
      $('reportStatus').textContent = 'No supported ship or defense classes were recognized.';
      $('reportStatus').className = 'status error';
      $('reportPreview').classList.add('hidden');
      return;
    }
    const selected = available.find(([, key]) => key === 'defender') || available.find(([, key]) => key === 'attacker') || available[0];
    applyReportSide(selected[1]);
    $('reportStatus').textContent = `Filled the NPC table from ${selected[0].toLowerCase()} (${Object.keys(selected[2].composition).length} classes).`;
    $('reportStatus').className = 'status success';
    renderReportPreview(available);
  }

  function applyReportSide(key) {
    const data = lastReportParse && lastReportParse[key];
    if (!data || !Object.keys(data.composition || {}).length) return;
    setComposition(data.composition, data.rawCounts || {});
    const detectedTech = data.tech || {};
    if (Number.isFinite(detectedTech.weapons)) $('dw').value = detectedTech.weapons;
    if (Number.isFinite(detectedTech.shield)) $('ds').value = detectedTech.shield;
    if (Number.isFinite(detectedTech.armor)) $('da').value = detectedTech.armor;
    const foundTech = ['weapons','shield','armor'].filter(name => Number.isFinite(detectedTech[name])).length;
    $('reportStatus').textContent = `Filled ${Object.keys(data.composition).length} unit classes${foundTech === 3 ? ' and NPC AWS tech' : foundTech ? ' and detected NPC tech' : ''}.`;
    $('reportStatus').className = 'status success';
    $('inputSummary').scrollIntoView({behavior:'smooth', block:'center'});
  }

  function sharedRange(config) {
    const ranges = SCENARIOS.map(scenario => M.autoRange(
      config.composition,
      config.attackerTech,
      config.defenderTech,
      RANGE_SURVIVAL_TARGET,
      scenario.rfSigma
    ));
    return {
      lo:Math.min(...ranges.map(range => range.lo)),
      hi:Math.max(...ranges.map(range => range.hi))
    };
  }

  function renderMetrics(datasets) {
    const first = datasets[0].sweep.points[0];
    const cards = [
      ['Max DSP', formatCount(first.initialDSP)],
      ['Max Debris', debrisPairMarkup(first.initialDebrisOrePotential, first.initialDebrisCrystalPotential)],
      ['Expected Dionysus needed at max', formatCount(datasets[0].sweep.points[datasets[0].sweep.points.length - 1].dionysusRecyclersNeeded)],
      ['Defense RSP', formatCount(first.initialDefenseRSP)]
    ];
    $('metrics').innerHTML = cards.map(([label, value]) => `<div class="metric"><span class="k">${label}</span><span class="v">${value}</span></div>`).join('');
  }

  function renderPointDetails(point, scenario) {
    if (!point) return;
    lastPoint = point;
    lastPointScenario = scenario;
    const zeusLosses = Math.max(0, point.zeusLosses);
    $('pointDetails').innerHTML = `
      <div class="point-heading"><div><span class="side-label">${scenario.label}</span><strong>${formatCount(point.zeusCount)} Zeus committed</strong></div><span class="point-hint">Hover either chart to inspect another point</span></div>
      <div class="point-facts">
        <div><span>${pct(point.zeusSurvival, 5)}</span><small>Zeus survival</small></div>
        <div><span>${formatCount(zeusLosses)}</span><small>Expected Zeus lost</small></div>
        <div><span>${pct(point.dspDestroyedFraction)}</span><small>NPC DSP destroyed</small></div>
        <div><span>${formatCount(point.destroyedDSP)}</span><small>Actual DSP destroyed</small></div>
        <div>${debrisPairMarkup(point.npcDebrisOreGenerated, point.npcDebrisCrystalGenerated)}<small>NPC debris generated</small></div>
        <div>${debrisPairMarkup(point.zeusDebrisOreGenerated, point.zeusDebrisCrystalGenerated)}<small>Own Zeus debris</small></div>
        <div>${debrisPairMarkup(point.debrisOreGenerated, point.debrisCrystalGenerated)}<small>Total debris generated</small></div>
        <div><span>${formatCount(point.dionysusRecyclersNeeded)}</span><small>Dionysus recyclers needed</small></div>
        <div><span>${pct(point.threatDestroyedFraction)}</span><small>Threat removed</small></div>
      </div>`;
  }

  function integerDspRecommendation(config, scenario, destructionTarget, range) {
    const candidate = M.findBreakpoint(
      {...config, rfSigma:scenario.rfSigma},
      destructionTarget,
      0,
      range.lo,
      range.hi
    );
    if (!candidate) return null;
    let count = Math.max(1, Math.ceil(candidate.zeusCount));
    let result = M.simulate({...config, rfSigma:scenario.rfSigma, zeusCount:count});
    let guard = 0;
    while (result.dspDestroyedFraction < destructionTarget && guard < 1000) {
      const nextCount = Math.max(count + 1, Math.ceil(count * 1.000001));
      if (nextCount === count) break;
      count = nextCount;
      result = M.simulate({...config, rfSigma:scenario.rfSigma, zeusCount:count});
      guard++;
    }
    return result.dspDestroyedFraction >= destructionTarget ? result : null;
  }

  function integerSurvivalRecommendation(config, scenario, survivalTarget, range) {
    const candidate = M.findBreakpoint(
      {...config, rfSigma:scenario.rfSigma},
      0,
      survivalTarget,
      range.lo,
      range.hi
    );
    if (!candidate) return null;
    let count = Math.max(1, Math.ceil(candidate.zeusCount));
    let result = M.simulate({...config, rfSigma:scenario.rfSigma, zeusCount:count});
    let guard = 0;
    while (result.zeusSurvival < survivalTarget && guard < 1000) {
      const nextCount = Math.max(count + 1, Math.ceil(count * 1.000001));
      if (nextCount === count) break;
      count = nextCount;
      result = M.simulate({...config, rfSigma:scenario.rfSigma, zeusCount:count});
      guard++;
    }
    return result.zeusSurvival >= survivalTarget ? result : null;
  }

  function recommendationTableRows(config, scenario, targets, range, mode) {
    const copyControl = (result, label, className='') => {
      if (!Number.isFinite(result)) return '—';
      const value = copyCount(result);
      return `<div class="recommendation-copy"><input class="recommendation-count ${className}" readonly value="${value}" aria-label="${label}"><button class="copy-count-button" type="button" data-copy-count="${value}" aria-label="Copy ${label}" title="Copy ${label}"><span aria-hidden="true">⧉</span></button></div>`;
    };
    const zeusLossMarkup = result => result
      ? `<span class="recommendation-pair"><span>${formatCount(Math.max(0, result.zeusLosses))} Zeus</span><span>${pct(Math.max(0, result.zeusLossFraction), 3)} of fleet</span></span>`
      : '—';
    const dionysusNeeded = result => {
      if (!result) return NaN;
      const crystalRecyclers = M.dionysusRecyclersNeededForCrystal(result.debrisOreGenerated, result.debrisCrystalGenerated);
      return useCrystalHarvestingOnly ? crystalRecyclers : result.dionysusRecyclersNeeded;
    };
    const dspMarkup = result => result
      ? `<span class="recommendation-pair"><span>${pct(result.dspDestroyedFraction, 3)} of max</span><span>${formatCount(result.destroyedDSP)} DSP</span></span>`
      : '—';
    const dspRows = targets.map(target => {
      const result = integerDspRecommendation(config, scenario, target, range);
      return `<tr><th scope="row">${pct(target, 0)}</th>
        <td data-label="Zeus needed">${copyControl(result && result.zeusCount, `Zeus count for ${pct(target, 0)} DSP`, useConservativeRecommendations ? 'conservative-count' : '')}</td>
        <td data-label="Expected Zeus lost">${zeusLossMarkup(result)}</td>
        <td data-label="Expected debris">${result ? debrisPairMarkup(result.debrisOreGenerated, result.debrisCrystalGenerated) : '—'}</td>
        <td data-label="Expected Dionysus needed">${copyControl(dionysusNeeded(result), `Expected Dionysus needed for ${pct(target, 0)} DSP`)}</td>
        <td data-label="Net points">${result ? formatCount(M.netPoints(result)) : '—'}</td></tr>`;
    }).join('');
    if (mode === 'dsp') return dspRows;

    return targets.map(target => {
      const result = integerSurvivalRecommendation(config, scenario, target, range);
      return `<tr><th scope="row">${pct(target, 3)}</th>
        <td data-label="Zeus needed">${copyControl(result && result.zeusCount, `Zeus count for ${pct(target, 3)} survival`, useConservativeRecommendations ? 'conservative-count' : '')}</td>
        <td data-label="Expected Zeus lost">${zeusLossMarkup(result)}</td>
        <td data-label="Expected DSP">${dspMarkup(result)}</td>
        <td data-label="Expected debris">${result ? debrisPairMarkup(result.debrisOreGenerated, result.debrisCrystalGenerated) : '—'}</td>
        <td data-label="Expected Dionysus needed">${copyControl(dionysusNeeded(result), `Expected Dionysus needed for ${pct(target, 1)} survival`)}</td>
        <td data-label="Net points">${result ? formatCount(M.netPoints(result)) : '—'}</td></tr>`;
    }).join('');
  }

  function renderRecommendations(config, range) {
    const dspTargets = [0.90, 0.95, 0.99];
    const survivalTargets = [0.99, 0.999, 0.99999];
    const scenario = useConservativeRecommendations ? SCENARIOS[1] : SCENARIOS[0];
    const dspRows = recommendationTableRows(config, scenario, dspTargets, range, 'dsp');
    const survivalRows = recommendationTableRows(config, scenario, survivalTargets, range, 'survival');
    $('recommendations').innerHTML = `
      <section class="recommendation-table-section">
        <h3>DSP target</h3>
        <div class="table-wrap"><table class="recommendation-table"><thead><tr><th>DSP target</th><th>Zeus needed<br><small>copyable</small></th><th>Expected Zeus lost<br><small>count and %</small></th><th>Expected debris</th><th>Expected Dionysus needed<br><small>copyable</small></th><th>Net points</th></tr></thead><tbody>${dspRows}</tbody></table></div>
      </section>
      <section class="recommendation-table-section">
        <h3>Zeus survival rate</h3>
        <div class="table-wrap"><table class="recommendation-table"><thead><tr><th>Survival threshold</th><th>Zeus needed<br><small>copyable</small></th><th>Expected Zeus lost<br><small>count and %</small></th><th>Expected DSP<br><small>% of max and absolute</small></th><th>Expected debris</th><th>Expected Dionysus needed<br><small>copyable</small></th><th>Net points</th></tr></thead><tbody>${survivalRows}</tbody></table></div>
      </section>`;
  }

  function refreshDisplayFormat() {
    displayFormat = $('displayFormat').value;
    updateInputSummary();
    renderReportPreview();
    if (!lastScenarios) return;
    renderMetrics(lastScenarios);
    renderChart('survivalChart', lastScenarios, 'zeusSurvival', 'Zeus survival', 'survival');
    renderChart('commitmentChart', lastScenarios, 'dspDestroyedFraction', 'NPC ship DSP destroyed', 'dsp');
    renderRecommendations(lastRunConfig, lastRange);
    renderPointDetails(lastPoint, lastPointScenario);
  }

  function tooltipMarkup(point, scenario) {
    const zeusLosses = Math.max(0, point.zeusLosses);
    return `<strong>${scenario.label}</strong><span>${formatCount(point.zeusCount)} Zeus</span><span>${formatCount(zeusLosses)} Zeus lost</span><span>${pct(point.zeusSurvival, 5)} survival</span><span>${formatCount(point.destroyedDSP)} DSP (${pct(point.dspDestroyedFraction)})</span><span>${debrisPairMarkup(point.debrisOreGenerated, point.debrisCrystalGenerated)} debris</span><span>${formatCount(point.dionysusRecyclersNeeded)} Dionysus recyclers</span>`;
  }

  function renderChart(containerId, datasets, yKey, yLabel, mode) {
    const width = 960;
    const height = 420;
    const margin = {l:72, r:24, t:24, b:58};
    const allPoints = datasets.flatMap(dataset => dataset.sweep.points);
    const logs = allPoints.map(point => Math.log10(Math.max(1, point.zeusCount)));
    const values = allPoints.map(point => point[yKey]);
    const xMin = Math.min(...logs);
    const xMax = Math.max(...logs);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const yMin = mode === 'survival' ? Math.max(0, valueMin > 0.9 ? valueMin - Math.max(0.0001, (1 - valueMin) * 0.08) : 0) : 0;
    const yMax = mode === 'survival' ? 1 : Math.min(1, Math.max(0.1, valueMax * 1.03));
    const x = value => margin.l + (width - margin.l - margin.r) * (value - xMin) / (xMax - xMin || 1);
    const y = value => height - margin.b - (height - margin.t - margin.b) * (value - yMin) / (yMax - yMin || 1);

    let grid = '';
    for (let index = 0; index <= 5; index++) {
      const logValue = xMin + (xMax - xMin) * index / 5;
      grid += `<line x1="${x(logValue)}" y1="${margin.t}" x2="${x(logValue)}" y2="${height - margin.b}" class="gridline"/><text x="${x(logValue)}" y="${height - margin.b + 23}" text-anchor="middle" class="axis">${formatCount(Math.pow(10, logValue))}</text>`;
    }
    for (let index = 0; index <= 5; index++) {
      const value = yMin + (yMax - yMin) * index / 5;
      const digits = mode === 'survival' && value > 0.999 ? 3 : mode === 'survival' ? 1 : 0;
      grid += `<line x1="${margin.l}" y1="${y(value)}" x2="${width - margin.r}" y2="${y(value)}" class="gridline"/><text x="${margin.l - 10}" y="${y(value) + 4}" text-anchor="end" class="axis">${(100 * value).toFixed(digits)}%</text>`;
    }

    const curves = datasets.map(dataset => {
      const path = dataset.sweep.points.map((point, index) => `${index ? 'L' : 'M'}${x(Math.log10(Math.max(1, point.zeusCount))).toFixed(2)},${y(point[yKey]).toFixed(2)}`).join(' ');
      const dots = dataset.sweep.points.map((point, index) => {
        const label = `${dataset.label}: ${formatCount(point.zeusCount)} Zeus, ${formatCount(Math.max(0, point.zeusLosses))} Zeus lost, ${pct(point.zeusSurvival, 5)} survival, ${formatCount(point.destroyedDSP)} DSP destroyed, ${debrisPair(point.debrisOreGenerated, point.debrisCrystalGenerated)} debris, ${formatCount(point.dionysusRecyclersNeeded)} Dionysus recyclers`;
        return `<circle cx="${x(Math.log10(Math.max(1, point.zeusCount)))}" cy="${y(point[yKey])}" r="4.5" class="chart-dot ${dataset.key}" tabindex="0" role="button" aria-label="${label}" data-scenario="${dataset.key}" data-point="${index}"><title>${label}</title></circle>`;
      }).join('');
      return `<path d="${path}" class="curve ${dataset.key}"/>${dots}`;
    }).join('');

    const container = $(containerId);
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${grid}${curves}<text x="${(margin.l + width - margin.r) / 2}" y="${height - 10}" text-anchor="middle" class="label">Zeus committed (log scale)</text><text x="18" y="${(margin.t + height - margin.b) / 2}" text-anchor="middle" transform="rotate(-90 18 ${(margin.t + height - margin.b) / 2})" class="label">${yLabel}</text></svg><div class="chart-tooltip hidden" role="status"></div>`;
    bindChartInteractions(container, datasets);
  }

  function bindChartInteractions(container, datasets) {
    const tooltip = container.querySelector('.chart-tooltip');
    const byKey = Object.fromEntries(datasets.map(dataset => [dataset.key, dataset]));
    const show = (dot, event) => {
      const dataset = byKey[dot.dataset.scenario];
      const point = dataset.sweep.points[Number(dot.dataset.point)];
      tooltip.innerHTML = tooltipMarkup(point, dataset);
      tooltip.classList.remove('hidden');
      const containerRect = container.getBoundingClientRect();
      const dotRect = dot.getBoundingClientRect();
      const clientX = event && Number.isFinite(event.clientX) ? event.clientX : dotRect.left + dotRect.width / 2;
      const clientY = event && Number.isFinite(event.clientY) ? event.clientY : dotRect.top;
      const scrollLeft = container.scrollLeft || 0;
      const scrollTop = container.scrollTop || 0;
      const cursorX = clientX - containerRect.left + scrollLeft;
      const cursorY = clientY - containerRect.top + scrollTop;
      const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
      const horizontalInset = 8;
      const verticalInset = 8;
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const visibleLeft = scrollLeft + horizontalInset;
      const visibleRight = scrollLeft + container.clientWidth - horizontalInset;
      const visibleTop = scrollTop + verticalInset;
      const visibleBottom = scrollTop + container.clientHeight - verticalInset;
      const left = clamp(cursorX - tooltipWidth / 2, visibleLeft, visibleRight - tooltipWidth);
      const aboveTop = cursorY - tooltipHeight - 12;
      const belowTop = cursorY + 12;
      const top = clamp(aboveTop < visibleTop && belowTop + tooltipHeight <= visibleBottom ? belowTop : aboveTop, visibleTop, visibleBottom - tooltipHeight);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      renderPointDetails(point, dataset);
    };
    const hide = () => tooltip.classList.add('hidden');
    for (const dot of container.querySelectorAll('.chart-dot')) {
      dot.addEventListener('pointerenter', event => show(dot, event));
      dot.addEventListener('pointermove', event => show(dot, event));
      dot.addEventListener('pointerleave', hide);
      dot.addEventListener('focus', event => show(dot, event));
      dot.addEventListener('blur', hide);
    }
  }

  function exportCSV() {
    if (!lastScenarios) return;
    const header = ['scenario','rf_sigma','zeus_count','zeus_survival','zeus_losses','dsp_destroyed','dsp_destroyed_fraction','npc_debris_generated','npc_debris_ore_generated','npc_debris_crystal_generated','zeus_debris_generated','zeus_debris_ore_generated','zeus_debris_crystal_generated','debris_generated','debris_ore_generated','debris_crystal_generated','dionysus_recyclers_needed','threat_destroyed_fraction'];
    const lines = [header.join(',')];
    for (const dataset of lastScenarios) {
      for (const point of dataset.sweep.points) {
        lines.push([
          dataset.key,
          dataset.rfSigma,
          point.zeusCount,
          point.zeusSurvival,
          Math.max(0, point.zeusLosses),
          point.destroyedDSP,
          point.dspDestroyedFraction,
          point.npcDebrisGenerated,
          point.npcDebrisOreGenerated,
          point.npcDebrisCrystalGenerated,
          point.zeusDebrisGenerated,
          point.zeusDebrisOreGenerated,
          point.zeusDebrisCrystalGenerated,
          point.debrisGenerated,
          point.debrisOreGenerated,
          point.debrisCrystalGenerated,
          point.dionysusRecyclersNeeded,
          point.threatDestroyedFraction
        ].join(','));
      }
    }
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sfc-zeus-commitment-curves.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function run() {
    const parsed = updateInputSummary();
    if (parsed.invalid.length) {
      $('inputStatus').textContent = `Fix the highlighted count${parsed.invalid.length === 1 ? '' : 's'} before calculating.`;
      $('inputStatus').className = 'status error';
      return;
    }
    if (!Object.keys(parsed.composition).length) {
      $('inputStatus').textContent = 'Enter at least one NPC unit count.';
      $('inputStatus').className = 'status error';
      return;
    }
    const config = {
      composition:parsed.composition,
      attackerTech:tech('a'),
      defenderTech:tech('d')
    };
    $('runBtn').disabled = true;
    $('runBtn').textContent = 'Calculating…';
    try {
      const range = sharedRange(config);
      const datasets = SCENARIOS.map(scenario => ({
        ...scenario,
        sweep:M.sweep({...config, rfSigma:scenario.rfSigma, points:POINT_COUNT, range})
      }));
      lastScenarios = datasets;
      lastRunConfig = config;
      lastRange = range;
      renderMetrics(datasets);
      renderChart('survivalChart', datasets, 'zeusSurvival', 'Zeus survival', 'survival');
      renderChart('commitmentChart', datasets, 'dspDestroyedFraction', 'NPC ship DSP destroyed', 'dsp');
      renderRecommendations(config, range);
      const initialPoint = datasets[0].sweep.points[Math.floor(datasets[0].sweep.points.length * 0.75)];
      renderPointDetails(initialPoint, datasets[0]);
      $('results').classList.remove('hidden');
      $('inputStatus').textContent = `Calculated ${POINT_COUNT} shared commitment points for both RF scenarios.`;
      $('inputStatus').className = 'status success';
      $('results').scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) {
      $('inputStatus').textContent = error.message || String(error);
      $('inputStatus').className = 'status error';
    } finally {
      $('runBtn').disabled = false;
      $('runBtn').textContent = 'Calculate curves';
    }
  }

  renderUnitInputs();
  setComposition(SAMPLE);
  $('sampleBtn').addEventListener('click', () => setComposition(SAMPLE));
  $('clearBtn').addEventListener('click', () => setComposition({}));
  $('displayFormat').addEventListener('change', refreshDisplayFormat);
  $('conservativeRecommendations').addEventListener('change', event => {
    useConservativeRecommendations = event.target.checked;
    if (lastRunConfig && lastRange) renderRecommendations(lastRunConfig, lastRange);
  });
  $('crystalHarvestingOnly').addEventListener('change', event => {
    useCrystalHarvestingOnly = event.target.checked;
    if (lastRunConfig && lastRange) renderRecommendations(lastRunConfig, lastRange);
  });
  $('parseReportBtn').addEventListener('click', parseReport);
  $('reportPreview').addEventListener('click', event => {
    const button = event.target.closest('[data-report-side]');
    if (button) applyReportSide(button.dataset.reportSide);
  });
  $('runBtn').addEventListener('click', run);
  $('exportBtn').addEventListener('click', exportCSV);
  $('recommendations').addEventListener('click', event => {
    const button = event.target.closest('[data-copy-count]');
    if (button) copyZeusCount(button);
  });
  $('shipInputs').addEventListener('input', updateInputSummary);
  $('defenseInputs').addEventListener('input', updateInputSummary);
})();
