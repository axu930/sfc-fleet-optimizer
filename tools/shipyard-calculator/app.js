(function () {
  'use strict';

  const M = window.SFCShipyardCalculator;
  const $ = id => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat('en-US');

  function populateBuildables() {
    const units = Object.entries(window.SFCUnits.UNITS);
    const optionsFor = kind => units
      .filter(([, unit]) => unit.kind === kind)
      .map(([name]) => `<option value="${name}">${name}</option>`)
      .join('');
    $('buildItem').innerHTML = `<optgroup label="Ships">${optionsFor('ship')}</optgroup><optgroup label="Defenses">${optionsFor('defense')}</optgroup>`;
    $('buildItem').value = 'Zeus';
  }

  function updateDroidCapacity() {
    const level = Number($('shipyardLevel').value);
    const fillAllSlots = $('assumeAllDroids').checked;
    $('assignedDroids').disabled = fillAllSlots;
    if (!Number.isSafeInteger(level) || level < 0) {
      $('droidSlotsHint').textContent = 'Enter a valid Shipyard level to see its worker slots.';
      $('assignedDroids').removeAttribute('max');
      return;
    }
    try {
      const slots = M.maxShipyardDroids(level);
      $('assignedDroids').max = String(slots);
      if (fillAllSlots) $('assignedDroids').value = String(slots);
      $('droidSlotsHint').textContent = fillAllSlots
        ? `Assuming all ${slots} worker slot${slots === 1 ? ' is' : 's are'} filled (${slots * 2}% extra build speed). Uncheck to choose fewer.`
        : `This Shipyard has ${slots} worker slot${slots === 1 ? '' : 's'}; each assigned Build Droid adds 2% speed.`;
    } catch (error) {
      $('droidSlotsHint').textContent = error.message;
    }
  }

  function setStatus(message, isError=false) {
    $('buildStatus').textContent = message;
    $('buildStatus').className = isError ? 'status error' : 'status success';
  }

  function calculate(event) {
    if (event) event.preventDefault();
    updateDroidCapacity();
    try {
      const itemName = $('buildItem').value;
      const count = M.parseShipCountWithMagnitude($('itemCount').value, $('countMagnitude').value);
      const assignedDroids = $('assumeAllDroids').checked
        ? M.maxShipyardDroids($('shipyardLevel').value)
        : $('assignedDroids').value;
      const result = M.calculateBuildTime({
        itemName,
        count,
        shipyardLevel:$('shipyardLevel').value,
        foundryLevel:$('foundryLevel').value,
        assignedDroids
      });

      $('totalBuildTime').textContent = M.formatDuration(result.totalSeconds);
      $('perItemTime').textContent = `${M.formatDuration(result.perItemSeconds)} per ${itemName}`;
      $('resourceCost').textContent = `${numberFormat.format(result.oreCrystalPerItem)} resources`;
      $('workerSlots').textContent = `${result.assignedDroids} / ${result.droidSlots} used`;
      $('copyCountText').value = result.countDigits;
      $('copyCountButton').dataset.copyCount = result.countDigits;
      $('copyCountButton').disabled = false;
      const groupedCount = M.groupDigits(result.count);
      const itemLabel = result.itemKind === 'defense' ? 'defense' : 'ship';
      const pluralLabel = result.itemKind === 'defense' ? 'defenses' : 'ships';
      $('countReview').textContent = result.count < 1000n
        ? `${groupedCount} ${result.count === 1n ? itemLabel : pluralLabel}`
        : `${groupedCount} · ${M.formatMagnitude(result.count)} ${pluralLabel}`;
      setStatus('Estimate updated. Check the grouped count before copying.');
    } catch (error) {
      $('totalBuildTime').textContent = '—';
      $('perItemTime').textContent = '';
      $('resourceCost').textContent = '—';
      $('workerSlots').textContent = '—';
      $('copyCountText').value = '';
      $('copyCountButton').dataset.copyCount = '';
      $('copyCountButton').disabled = true;
      $('countReview').textContent = '';
      setStatus(error.message, true);
    }
  }

  async function copyCount(button) {
    const value = button.dataset.copyCount;
    if (!value) return;
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch (error) { /* Use the legacy copy path below. */ }
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
    button.title = copied ? 'Copied exact build count' : 'Copy failed';
    setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove('copied');
      button.title = button.getAttribute('aria-label') || 'Copy exact build count';
    }, 1400);
  }

  populateBuildables();
  updateDroidCapacity();
  $('buildForm').addEventListener('submit', calculate);
  $('shipyardLevel').addEventListener('input', updateDroidCapacity);
  $('assumeAllDroids').addEventListener('change', () => {
    updateDroidCapacity();
    calculate();
  });
  $('countMagnitude').addEventListener('change', calculate);
  $('copyCountButton').addEventListener('click', event => copyCount(event.currentTarget));
  $('copyCountButton').disabled = true;
  calculate();
})();
