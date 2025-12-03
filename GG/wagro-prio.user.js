// ==UserScript==
// @name         GG | WaGro Prio
// @namespace    gg-wagro-prio
// @version      1.3
// @description  Zet WaGro-locatie op prioriteit 1 en randomiseert de rest (>1). Plaatst knop in header naast "Voorraad overzicht" en disabled de knop als WaGro al 1 is.
// @match        https://fm-e-warehousing.goedgepickt.nl/products/view/*
// @run-at       document-idle
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/wagro-prio.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/wagro-prio.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'gg-wagro-button';
  const TABLE_SEL = '#m_datatable_stock';

  /** Utility: wacht tot een selector bestaat **/
  function waitFor(selector, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout waiting for ' + selector)); }, timeoutMs);
    });
  }

  /** DOM helpers **/
  function triggerChange(selectEl) {
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pickRandomAvailableGreaterThan1(selectEl) {
    const options = Array.from(selectEl.options)
      .map(o => parseInt(o.value, 10))
      .filter(n => Number.isFinite(n) && n > 1);
    if (!options.length) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  function setPriority(selectEl, value) {
    const hasValue = Array.from(selectEl.options).some(o => o.value == value);
    if (!hasValue) return false;
    if (String(selectEl.value) === String(value)) return true; // al goed
    selectEl.value = String(value);
    triggerChange(selectEl);
    return true;
  }

  /** WaGro detection **/
  function findWaGroSelect() {
    const rows = document.querySelectorAll(`${TABLE_SEL} tbody tr`);
    for (const row of rows) {
      const nameCell = row.querySelector('td:nth-child(1) a');
      const select = row.querySelector('select.prio_select');
      if (!nameCell || !select) continue;
      const name = (nameCell.textContent || '').trim();
      if (name.startsWith('WaGro')) return select; // neem de eerste match
    }
    return null;
  }

  /** Button state **/
  function setButtonDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    if (disabled) {
      btn.classList.remove('btn-success');
      btn.classList.add('btn-secondary', 'disabled');
      btn.style.opacity = '0.65';
      btn.style.pointerEvents = 'none';
      btn.title = 'WaGro staat al op prioriteit 1';
    } else {
      btn.classList.remove('btn-secondary', 'disabled');
      btn.classList.add('btn-success');
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      btn.title = 'Zet WaGro → 1 en randomiseer de rest';
    }
  }

  function updateButtonState() {
    const btn = document.getElementById(BTN_ID);
    const wagroSel = findWaGroSelect();
    const isOnOne = wagroSel && String(wagroSel.value) === '1';
    setButtonDisabled(btn, isOnOne);
  }

  /** Actie: zet WaGro → 1 en randomiseert de rest **/
  function processTable() {
    const btn = document.getElementById(BTN_ID);
    if (btn && btn.disabled) return; // al op 1

    const rows = document.querySelectorAll(`${TABLE_SEL} tbody tr`);
    if (!rows.length) { alert('Geen voorraadregels gevonden.'); return; }

    let wagroFound = false;

    rows.forEach(row => {
      const nameCell = row.querySelector('td:nth-child(1) a');
      const select = row.querySelector('select.prio_select');
      if (!nameCell || !select) return;

      const name = (nameCell.textContent || '').trim();

      if (name.startsWith('WaGro')) {
        wagroFound = true;
        // Probeer 1, zo niet beschikbaar dan laagste optie
        const ok = setPriority(select, 1);
        if (!ok) {
          const nums = Array.from(select.options)
            .map(o => parseInt(o.value, 10))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
          if (nums.length) setPriority(select, nums[0]);
        }
      } else {
        const rnd = pickRandomAvailableGreaterThan1(select);
        if (rnd !== null) setPriority(select, rnd);
      }
    });

    if (!wagroFound) console.warn('Geen WaGro-rij gevonden.');

    // her-evalueer stato
    updateButtonState();
  }

  /** Injectie van de knop in de header naast "Voorraad overzicht" **/
  function injectButton() {
    if (document.getElementById(BTN_ID)) return;

    // Vind de H3 met tekst "Voorraad overzicht"
    const headers = Array.from(document.querySelectorAll('h3.m-portlet__head-text'));
    const headerH3 = headers.find(h => (h.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes('voorraad overzicht'));

    const portletHead = headerH3 ? headerH3.closest('.m-portlet__head') : null;
    let tools = portletHead ? portletHead.querySelector('.m-portlet__head-tools') : null;
    if (!tools && portletHead) {
      tools = document.createElement('div');
      tools.className = 'm-portlet__head-tools';
      portletHead.appendChild(tools);
    }

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⚡ WaGro → 1 (random rest)';
    btn.className = 'btn btn-sm m-btn m-btn--pill btn-success';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', processTable);

    if (tools) {
      tools.appendChild(btn);
    } else if (headerH3 && headerH3.parentElement) {
      headerH3.parentElement.insertBefore(btn, headerH3.nextSibling);
    } else {
      // fallback: floating
      btn.style.position = 'fixed';
      btn.style.right = '16px';
      btn.style.bottom = '16px';
      document.body.appendChild(btn);
    }

    // init state
    updateButtonState();

    // luister naar wijzigingen in de tabel
    const table = document.querySelector(TABLE_SEL);
    if (table) {
      table.addEventListener('change', e => {
        if (e.target && e.target.matches('select.prio_select')) updateButtonState();
      });
    }
  }

  /** Bootstrapping **/
  function main() {
    // wacht tot header of tabel er is
    Promise.race([
      waitFor('.m-portlet__head', 15000),
      waitFor(TABLE_SEL, 15000)
    ]).then(() => {
      injectButton();
    }).catch(() => {
      // laatste redmiddel: toch proberen
      injectButton();
    });
  }

  // Start
  main();

})();

// --- Late-load watcher: disable button when WaGro is already 1 ---
(function(){
  const BTN_ID = 'gg-wagro-button';
  const TABLE_SEL = '#m_datatable_stock';

  function getWaGroSelect(){
    const rows = document.querySelectorAll('#m_datatable_stock tbody tr');
    for (const row of rows){
      const nameCell = row.querySelector('td:nth-child(1) a');
      const select = row.querySelector('select.prio_select');
      if (!nameCell || !select) continue;
      const name = (nameCell.textContent || '').trim();
      if (name.startsWith('WaGro')) return select;
    }
    return null;
  }

  function sync(){
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const sel = getWaGroSelect();
    const isOnOne = sel && String(sel.value) === '1';
    btn.disabled = !!isOnOne;
    if (isOnOne){
      btn.classList.remove('btn-success');
      btn.classList.add('btn-secondary','disabled');
      btn.style.opacity = '0.65';
      btn.style.pointerEvents = 'none';
      btn.title = 'WaGro staat al op prioriteit 1';
    }
  }

  // Quick warm-up: check frequently for the first 10s (rows often arrive later)
  const trySync = setInterval(sync, 500);
  setTimeout(()=>clearInterval(trySync), 10000);

  // Observe dynamic table changes
  const table = document.querySelector(TABLE_SEL);
  if (table){
    const tb = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table;
    const mo = new MutationObserver(sync);
    mo.observe(tb, { childList: true, subtree: true, characterData: true });
    table.addEventListener('change', e => {
      if (e.target && e.target.matches('select.prio_select')) sync();
    });
  }
})();

