(function () {
  'use strict';

  const M = window.SFCShipyardCalculator;
  const $ = id => document.getElementById(id);
  const numberFormat = new Intl.NumberFormat('en-US');

  function populateShips() {
    const ships = Object.entries(window.SFCUnits.UNITS).filter(([, unit]) => unit.kind === 'ship');
    $('shipName').innerHTML = ships.map(([name]) => `<option value="${name}">${name}</option>`).join('');
    $('shipName').value = 'Zeus';
  }

  function updateDroidCapacity() {
    const level = Number($('shipyardLevel').value);
    if (!Number.isSafeInteger(level) || level < 0) {
      $('droidSlotsHint').textContent = 'Enter a valid Shipyard level to see its worker slots.';
      $('assignedDroids').removeAttribute('max');
      return;
    }
    try {
      const slots = M.maxShipyardDroids(level);
      $('assignedDroids').max = String(slots);
      $('droidSlotsHint').textContent = `This Shipyard has ${slots} worker slot${slots === 1 ? '' : 's'}; each assigned Build Droid adds 2% speed.`;
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
      const shipName = $('shipName').value;
      const count = M.parseShipCount($('shipCount').value);
      const result = M.calculateBuildTime({
        shipName,
        count,
        shipyardLevel:$('shipyardLevel').value,
        foundryLevel:$('foundryLevel').value,
        assignedDroids:$('assignedDroids').value
      });

      $('totalBuildTime').textContent = M.formatDuration(result.totalSeconds);
      $('perShipTime').textContent = `${M.formatDuration(result.perShipSeconds)} per ${shipName}`;
      $('resourceCost').textContent = `${numberFormat.format(result.oreCrystalPerShip)} resources`;
      $('workerSlots').textContent = `${result.assignedDroids} / ${result.droidSlots} used`;
      $('copyCountText').value = result.countDigits;
      $('copyCountButton').dataset.copyCount = result.countDigits;
      $('copyCountButton').disabled = false;
      const groupedCount = M.groupDigits(result.count);
      $('countReview').textContent = result.count < 1000n
        ? `${groupedCount} ${result.count === 1n ? 'ship' : 'ships'}`
        : `${groupedCount} · ${M.formatMagnitude(result.count)} ships`;
      setStatus('Estimate updated. Check the grouped count before copying.');
    } catch (error) {
      $('totalBuildTime').textContent = '—';
      $('perShipTime').textContent = '';
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
    button.title = copied ? 'Copied exact ship count' : 'Copy failed';
    setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove('copied');
      button.title = button.getAttribute('aria-label') || 'Copy exact ship count';
    }, 1400);
  }

  populateShips();
  updateDroidCapacity();
  $('buildForm').addEventListener('submit', calculate);
  $('shipyardLevel').addEventListener('input', updateDroidCapacity);
  $('copyCountButton').addEventListener('click', event => copyCount(event.currentTarget));
  $('copyCountButton').disabled = true;
  calculate();
})();
