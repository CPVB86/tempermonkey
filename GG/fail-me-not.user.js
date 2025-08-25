// ==UserScript==
// @name         GG / Fail me Not
// @version      1.0
// @description  Verwijderd alle succesvolle en dubbele-failed ean codes zodat een nice-and-clean overzicht overblijft
// @author       C. P. v. Beek
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming-products
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/fail-me-not.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/fail-me-not.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TABLE_SELECTOR = '.table.scanned_tasks_table';
  const TBODY_SELECTOR = '.scanned_tasks_body';
  const FAILED_TR_SELECTOR = 'tr.failed_tr';
  const BARCODE_TD_SELECTOR = '.barcode_td';
  const NO_SCANS_SELECTOR = 'tr.no_scans';



  // Styles for the floating button
  const styles = `
    .failed-counter-btn {
      position: fixed;
      right: 20px;
      bottom: 60px;
      z-index: 99999;
      border: 0;
      border-radius: 5px;
      padding: 10px 15px;
      font: 600 14px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: #fff;
      box-shadow: 0 6px 20px rgba(0,0,0,.15);
      cursor: pointer;
      transition: background-color .2s ease, transform .05s ease;
    }
    .failed-counter-btn:active { transform: translateY(1px); }
    .failed-counter-btn.green { background-color: #16a34a; } /* groen */
    .failed-counter-btn.red   { background-color: #dc2626; } /* rood  */
  `;

  function injectStyles() {
    if (document.getElementById('failed-counter-styles')) return;
    const s = document.createElement('style');
    s.id = 'failed-counter-styles';
    s.textContent = styles;
    document.head.appendChild(s);
  }

  function ensureButton() {
    let btn = document.getElementById('failed-counter-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'failed-counter-btn';
      btn.className = 'failed-counter-btn green';
      btn.textContent = '❌ 0';
      btn.title = 'Verwijderd alle succesvolle en dubbele-failed ean codes zodat een nice-and-clean overzicht overblijft';
      btn.addEventListener('click', onButtonClick);
      document.body.appendChild(btn);
    }
    return btn;
  }

  function getBarcodeFromTd(td) {
    return (td?.getAttribute('data-barcode') || td?.textContent || '').trim();
  }

  // Unieke failed tellen
  function getUniqueFailedCount(root) {
    const failedTds = root.querySelectorAll(`${FAILED_TR_SELECTOR} ${BARCODE_TD_SELECTOR}`);
    const set = new Set();
    failedTds.forEach(td => {
      const code = getBarcodeFromTd(td);
      if (code) set.add(code);
    });
    return set.size;
  }

  function updateButton(root) {
    const btn = ensureButton();
    const count = getUniqueFailedCount(root);
    btn.textContent = `❌ ${count}`;
    btn.classList.toggle('red', count > 0);
    btn.classList.toggle('green', count === 0);
  }

  // Verwijder succesvolle scans (alle rijen met barcode_td die géén failed/no_scans zijn)
  function removeSuccessfulScans(root) {
    const tbody = root.querySelector(TBODY_SELECTOR);
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'))
      .filter(tr =>
        !tr.classList.contains('failed_tr') &&
        !tr.classList.contains('no_scans') &&
        tr.querySelector(BARCODE_TD_SELECTOR)
      );
    rows.forEach(tr => tr.remove());
  }

  // Dedupliceer failed: per barcode één laten staan (de eerste in DOM-orde)
  function collapseFailedDuplicates(root) {
    const tbody = root.querySelector(TBODY_SELECTOR) || root;
    const failedRows = Array.from(tbody.querySelectorAll(FAILED_TR_SELECTOR));
    const seen = new Set();

    for (const tr of failedRows) {
      const td = tr.querySelector(BARCODE_TD_SELECTOR);
      const code = getBarcodeFromTd(td);
      if (!code) continue;

      if (seen.has(code)) {
        tr.remove(); // duplicate -> weg
      } else {
        seen.add(code); // eerste -> bewaren
      }
    }
  }

  function onButtonClick() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return;
    removeSuccessfulScans(table);
    collapseFailedDuplicates(table);
    updateButton(table);
  }

  function observeTbody(tbody) {
    const obs = new MutationObserver(() => updateButton(tbody.closest(TABLE_SELECTOR) || document));
    obs.observe(tbody, { childList: true, subtree: true, attributes: true });
    return obs;
  }

  function waitForTable() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (table) return Promise.resolve(table);
    return new Promise(resolve => {
      const mo = new MutationObserver(() => {
        const t = document.querySelector(TABLE_SELECTOR);
        if (t) { mo.disconnect(); resolve(t); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  (async function init() {
    injectStyles();
    ensureButton();

    const table = await waitForTable();
    const tbody = table.querySelector(TBODY_SELECTOR) || table.tBodies[0] || table;

    updateButton(table);
    observeTbody(tbody);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateButton(table);
    });

    setInterval(() => {
      if (document.body.contains(table)) updateButton(table);
    }, 1500);
  })();

})();
