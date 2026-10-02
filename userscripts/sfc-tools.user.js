// ==UserScript==
// @name         SFC Tools Espionage Inbox
// @namespace    https://axu930.github.io/sfc-fleet-optimizer/
// @version      1.0.1
// @description  Save Starfleet Commander espionage reports locally and import them into SFC Tools.
// @homepageURL  https://axu930.github.io/sfc-fleet-optimizer/
// @downloadURL  https://raw.githubusercontent.com/axu930/sfc-fleet-optimizer/main/userscripts/sfc-tools.user.js
// @updateURL    https://raw.githubusercontent.com/axu930/sfc-fleet-optimizer/main/userscripts/sfc-tools.user.js
// @match        https://playstarfleet.com/messages*
// @match        https://*.playstarfleet.com/messages*
// @match        https://axu930.github.io/sfc-fleet-optimizer/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'sfc-tools-report-inbox-v1';
  const EVENTS = {
    request:'sfctools:report-inbox:request',
    available:'sfctools:report-inbox:available',
    remove:'sfctools:report-inbox:delete'
  };
  const REPORT_CONTENT_SELECTOR = '.message_content .text';
  const GAME_REPORT_SELECTOR = 'article, section, div, td, pre, li, table';
  const REPORT_MARKER = /\bships?\s*:?/i;
  const UNIT_MARKER = /\b(?:Hermes|Artemis|Athena|Ares|Zeus|Hades|Poseidon|Atlas|Carmanor|Gaia|Hephaestus|Dionysus|Zagreus|Apollo|Prometheus|Charon|Hercules|Missile Battery|Laser Cannon|Pulse Cannon|Particle Cannon|Gauss Cannon|Plasma Cannon|Large Decoy|Decoy)\b/i;
  let writeQueue = Promise.resolve();
  let scanQueued = false;

  function isGameMessagesPage() {
    const host = location.hostname.toLowerCase();
    const isGameHost = host === 'playstarfleet.com' || host.endsWith('.playstarfleet.com');
    return isGameHost && /^\/messages(?:\/|$)/i.test(location.pathname);
  }

  function parseDetail(event) {
    if (typeof event.detail !== 'string') return event.detail || {};
    try { return JSON.parse(event.detail); } catch (error) { return {}; }
  }

  function dispatch(name, payload) {
    document.dispatchEvent(new CustomEvent(name, {detail:JSON.stringify(payload)}));
  }

  function hasStorageApi() {
    return (typeof GM !== 'undefined' && typeof GM.getValue === 'function' && typeof GM.setValue === 'function')
      || (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');
  }

  async function readInbox() {
    if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
      const value = await GM.getValue(STORAGE_KEY, '[]');
      return decodeInbox(value);
    }
    if (typeof GM_getValue === 'function') return decodeInbox(await GM_getValue(STORAGE_KEY, '[]'));
    throw new Error('Userscript manager storage is unavailable.');
  }

  function decodeInbox(value) {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  async function writeInbox(reports) {
    const value = JSON.stringify(reports);
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
      await GM.setValue(STORAGE_KEY, value);
      return;
    }
    if (typeof GM_setValue === 'function') {
      await GM_setValue(STORAGE_KEY, value);
      return;
    }
    throw new Error('Userscript manager storage is unavailable.');
  }

  function updateInbox(change) {
    const operation = writeQueue.then(async () => {
      const reports = await readInbox();
      const next = change(reports);
      await writeInbox(next);
      return next;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function respond(requestId, reports, error='') {
    dispatch(EVENTS.available, {requestId, reports, error});
  }

  document.addEventListener(EVENTS.request, async event => {
    const payload = parseDetail(event);
    try {
      respond(String(payload.requestId || ''), await readInbox());
    } catch (error) {
      respond(String(payload.requestId || ''), [], 'Userscript storage is unavailable. Confirm the SFC Tools userscript is enabled in your manager.');
    }
  });

  document.addEventListener(EVENTS.remove, async event => {
    const payload = parseDetail(event);
    const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(String) : []);
    try {
      const reports = await updateInbox(current => current.filter(report => !ids.has(String(report.id))));
      respond(String(payload.requestId || ''), reports);
    } catch (error) {
      respond(String(payload.requestId || ''), [], 'Could not update userscript storage.');
    }
  });

  function randomId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const values = new Uint32Array(4);
    cryptoApi.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
  }

  function reportText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('[data-sfc-tools-control]').forEach(control => control.remove());
    return String(clone.innerText || clone.textContent || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
  }

  function looksLikeEspionageReport(text) {
    return text.length >= 20 && text.length <= 60000
      && REPORT_MARKER.test(text)
      && UNIT_MARKER.test(text)
      && /\d/.test(text);
  }

  function extractLocation(text, node) {
    const match = text.match(/\[\s*(\d{1,3})\s*:\s*(\d{1,3})\s*:\s*(\d{1,2})([me]?)\s*\]/i);
    if (match) return `[${Number(match[1])}:${Number(match[2])}:${Number(match[3])}${match[4].toLowerCase()}]`;
    for (const link of node.querySelectorAll('a[href]')) {
      try {
        const url = new URL(link.href, location.href);
        const galaxy = Number(url.searchParams.get('galaxy'));
        const system = Number(url.searchParams.get('solar_system') || url.searchParams.get('system'));
        const planet = Number(url.searchParams.get('planet'));
        if (galaxy > 0 && system > 0 && planet > 0) return `[${galaxy}:${system}:${planet}]`;
      } catch (error) { /* Ignore unrelated links. */ }
    }
    return '';
  }

  function makeSaveControl(node) {
    if (node.dataset.sfcToolsReportDetected === 'true' || node.closest('[data-sfc-tools-control]')) return;
    node.dataset.sfcToolsReportDetected = 'true';
    const control = document.createElement('div');
    control.dataset.sfcToolsControl = 'true';
    control.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;padding:7px 9px;border:1px solid #57a9c7;border-radius:6px;background:#102532;color:#eef8fc;font:13px/1.4 system-ui,sans-serif;';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Save for SFC Tools';
    button.style.cssText = 'border:0;border-radius:5px;padding:6px 10px;background:#6bd5ff;color:#03111a;font:600 13px system-ui,sans-serif;cursor:pointer;';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    control.append(button, status);
    if (node.parentNode) node.insertAdjacentElement('afterend', control);
    else node.appendChild(control);

    button.addEventListener('click', async () => {
      if (!hasStorageApi()) {
        status.textContent = 'Userscript storage is unavailable in this manager.';
        return;
      }
      button.disabled = true;
      status.textContent = 'Saving locally…';
      try {
        const text = reportText(node);
        if (!looksLikeEspionageReport(text)) throw new Error('This report no longer looks like a supported espionage report.');
        const report = {
          id:randomId(),
          text,
          location:extractLocation(text, node),
          capturedAt:new Date().toISOString()
        };
        const reports = await updateInbox(current => [report, ...current]);
        status.textContent = `Saved locally · ${reports.length} report${reports.length === 1 ? '' : 's'} in inbox`;
        button.textContent = 'Saved';
      } catch (error) {
        status.textContent = error.message || 'Could not save this report.';
        button.disabled = false;
      }
    });
  }

  function scanReports() {
    scanQueued = false;
    if (!document.body) return;
    const knownReportContent = Array.from(document.querySelectorAll(REPORT_CONTENT_SELECTOR));
    const scanNodes = knownReportContent.length
      ? knownReportContent
      : Array.from(document.querySelectorAll(GAME_REPORT_SELECTOR));
    const candidates = scanNodes
      .filter(node => node.dataset.sfcToolsReportDetected !== 'true' && !node.closest('[data-sfc-tools-control]'))
      .map(node => ({node, text:reportText(node)}))
      .filter(item => looksLikeEspionageReport(item.text));
    const matches = new Set(candidates.map(item => item.node));
    for (const {node} of candidates) {
      if (node.querySelector('[data-sfc-tools-report-detected="true"]')) continue;
      const hasMatchingChild = Array.from(node.querySelectorAll(GAME_REPORT_SELECTOR)).some(child => matches.has(child));
      if (!hasMatchingChild) makeSaveControl(node);
    }
  }

  function queueScan() {
    if (scanQueued || !isGameMessagesPage()) return;
    scanQueued = true;
    window.requestAnimationFrame(scanReports);
  }

  if (isGameMessagesPage()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueScan, {once:true});
    else queueScan();
    const observer = new MutationObserver(queueScan);
    const observeRoot = () => {
      if (document.body) observer.observe(document.body, {childList:true, subtree:true});
      else document.addEventListener('DOMContentLoaded', observeRoot, {once:true});
    };
    observeRoot();
  }
})();
