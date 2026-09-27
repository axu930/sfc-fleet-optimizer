(function () {
  'use strict';

  const EVENTS = {
    request:'sfctools:report-inbox:request',
    available:'sfctools:report-inbox:available',
    remove:'sfctools:report-inbox:delete',
    import:'sfctools:report-inbox:import'
  };
  const pending = new Map();
  let requestSequence = 0;

  function emit(name, payload) {
    document.dispatchEvent(new CustomEvent(name, {detail:JSON.stringify(payload)}));
  }

  function readDetail(event) {
    if (typeof event.detail !== 'string') return event.detail || {};
    try { return JSON.parse(event.detail); } catch (error) { return {}; }
  }

  function cleanReports(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(report => report && typeof report.id === 'string' && typeof report.text === 'string' && report.text.trim())
      .map(report => ({
        id:report.id,
        text:report.text,
        location:typeof report.location === 'string' ? report.location : '',
        capturedAt:typeof report.capturedAt === 'string' ? report.capturedAt : ''
      }));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeButton(label, className, onClick) {
    const button = element('button', className, label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function createInbox(mount) {
    const mode = mount.dataset.mode === 'multiple' ? 'multiple' : 'single';
    const label = mode === 'multiple' ? 'Import selected targets' : 'Import selected report';
    const bar = element('div', 'report-inbox-bar');
    const openButton = makeButton('Saved reports', 'ghost report-inbox-open', () => requestReports(true));
    const status = element('span', 'report-inbox-status', 'Local userscript inbox · reports stay until you delete them.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    bar.append(openButton, status);
    mount.appendChild(bar);

    const dialog = element('dialog', 'report-inbox-dialog');
    dialog.setAttribute('aria-labelledby', `report-inbox-title-${mount.dataset.mode || 'single'}`);
    const header = element('div', 'report-inbox-dialog-head');
    const title = element('h2', '', 'Saved espionage reports');
    title.id = `report-inbox-title-${mount.dataset.mode || 'single'}`;
    const closeButton = makeButton('Close', 'ghost compact-button', () => dialog.close());
    header.append(title, closeButton);
    const description = element('p', 'hint', mode === 'multiple'
      ? 'Choose reports to append as target cards. Existing targets stay in place; enter a location on the target card if one was not detected.'
      : 'Choose one report to fill the Zeus Optimizer NPC fleet.');
    const list = element('div', 'report-inbox-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', mode === 'multiple' ? 'Saved reports to import' : 'Saved report to import');
    const empty = element('p', 'report-inbox-empty hidden', 'No saved reports yet. Save a report from the game first.');
    const footer = element('div', 'report-inbox-footer');
    const footerStatus = element('span', 'status report-inbox-dialog-status', '');
    footerStatus.setAttribute('role', 'status');
    footerStatus.setAttribute('aria-live', 'polite');
    const actions = element('div', 'report-inbox-actions');
    const refreshButton = makeButton('Refresh', 'ghost compact-button', () => requestReports(false));
    const deleteButton = makeButton('Delete selected', 'ghost compact-button', deleteSelected);
    const clearButton = makeButton('Clear inbox', 'ghost compact-button', clearInbox);
    const importButton = makeButton(label, 'primary inline-primary', importSelected);
    importButton.disabled = true;
    actions.append(refreshButton, deleteButton, clearButton, importButton);
    footer.append(footerStatus, actions);
    dialog.append(header, description, list, empty, footer);
    document.body.appendChild(dialog);

    let reports = [];
    let latestRequestId = '';
    let timer = 0;

    function setStatus(message, state='') {
      status.textContent = message;
      status.className = `report-inbox-status${state ? ` ${state}` : ''}`;
    }

    function setDialogStatus(message, state='') {
      footerStatus.textContent = message;
      footerStatus.className = `status report-inbox-dialog-status${state ? ` ${state}` : ''}`;
    }

    function selectedIds() {
      return Array.from(list.querySelectorAll('input[type="checkbox"], input[type="radio"]:checked'))
        .filter(input => input.checked)
        .map(input => input.value);
    }

    function refreshButtons() {
      const selected = selectedIds();
      importButton.disabled = selected.length === 0;
      deleteButton.disabled = selected.length === 0;
      importButton.textContent = mode === 'multiple'
        ? `Import ${selected.length} selected target${selected.length === 1 ? '' : 's'}`
        : 'Import selected report';
    }

    function renderReports() {
      list.replaceChildren();
      empty.classList.toggle('hidden', reports.length > 0);
      deleteButton.disabled = reports.length === 0;
      clearButton.disabled = reports.length === 0;
      for (const [index, report] of reports.entries()) {
        const row = element('div', 'report-inbox-row');
        const input = document.createElement('input');
        input.type = mode === 'multiple' ? 'checkbox' : 'radio';
        input.name = `report-inbox-selection-${mount.dataset.mode || 'single'}`;
        input.id = `report-inbox-choice-${mount.dataset.mode || 'single'}-${index}`;
        input.value = report.id;
        input.addEventListener('change', refreshButtons);
        const details = element('label', 'report-inbox-report-details');
        details.htmlFor = input.id;
        const primary = element('strong', 'report-inbox-location', report.location || 'Location not detected');
        const secondary = element('small', 'report-inbox-captured', report.capturedAt
          ? `Saved ${new Date(report.capturedAt).toLocaleString()}`
          : 'Saved date unavailable');
        details.append(primary, secondary);
        const remove = makeButton('Delete', 'ghost compact-button report-inbox-row-delete', event => {
          removeReports([report.id]);
        });
        row.append(input, details, remove);
        list.appendChild(row);
      }
      refreshButtons();
    }

    function requestReports(openDialog) {
      if (openDialog && !dialog.open) dialog.showModal();
      setStatus('Loading saved reports…');
      setDialogStatus('Loading saved reports…');
      const requestId = `${Date.now()}-${++requestSequence}`;
      latestRequestId = requestId;
      pending.set(requestId, {instance, timer:window.setTimeout(() => {
        pending.delete(requestId);
        if (latestRequestId !== requestId) return;
        setStatus('Userscript storage did not respond. Install or enable the SFC Tools userscript, then reload this page.', 'error');
        setDialogStatus('Userscript storage did not respond. Install or enable the SFC Tools userscript, then reload this page.', 'error');
      }, 1800)});
      emit(EVENTS.request, {requestId});
    }

    function removeReports(ids) {
      if (!ids.length) return;
      setDialogStatus('Removing saved reports…');
      const requestId = `${Date.now()}-${++requestSequence}`;
      latestRequestId = requestId;
      pending.set(requestId, {instance, timer:window.setTimeout(() => {
        pending.delete(requestId);
        setDialogStatus('Could not update the inbox. Check that the userscript is enabled.', 'error');
      }, 1800)});
      emit(EVENTS.remove, {requestId, ids});
    }

    function deleteSelected() {
      const selected = selectedIds();
      if (selected.length) removeReports(selected);
    }

    function clearInbox() {
      if (!reports.length || !window.confirm(`Delete all ${reports.length} saved reports?`)) return;
      removeReports(reports.map(report => report.id));
    }

    function importSelected() {
      const chosen = new Set(selectedIds());
      const selected = reports.filter(report => chosen.has(report.id));
      if (!selected.length) return;
      if (mode === 'single' && selected.length !== 1) {
        setDialogStatus('Select exactly one report.', 'error');
        return;
      }
      emit(EVENTS.import, {mode, reports:selected});
      dialog.close();
      setDialogStatus('');
    }

    const instance = {setStatus, setDialogStatus, renderReports, get reports() { return reports; }, set reports(value) { reports = cleanReports(value); }};
    mount.dataset.inboxReady = 'true';
    return {instance, requestReports};
  }

  const instances = [];
  for (const mount of document.querySelectorAll('[data-report-inbox]')) instances.push(createInbox(mount));

  document.addEventListener(EVENTS.available, event => {
    const payload = readDetail(event);
    const request = pending.get(String(payload.requestId || ''));
    if (!request) return;
    window.clearTimeout(request.timer);
    pending.delete(String(payload.requestId));
    const instance = request.instance;
    if (payload.error) {
      instance.setStatus(String(payload.error), 'error');
      instance.setDialogStatus(String(payload.error), 'error');
      return;
    }
    instance.reports = payload.reports;
    instance.renderReports();
    const count = instance.reports.length;
    instance.setStatus(`${count} saved report${count === 1 ? '' : 's'} in this browser.`, count ? 'success' : '');
    instance.setDialogStatus(count ? '' : 'Save an espionage report from the game to get started.');
  });

  window.SFCToolsReportInbox = {events:EVENTS};
})(typeof globalThis !== 'undefined' ? globalThis : this);
