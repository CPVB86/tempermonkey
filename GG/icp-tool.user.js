// ==UserScript==
// @name         ICP Tool
// @version      1.3
// @description  Knop op Incoming Products de selectvelden voorbereid.
// @author       C. P. v. Beek
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming-products*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/icp-tool.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/icp-tool-ddo.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- helpers ----------
  const domReady = () => new Promise(res => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return res();
    document.addEventListener('DOMContentLoaded', res, { once: true });
  });

  const waitFor = (selector, { root = document, timeout = 12000, poll = 150 } = {}) =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        const el = root.querySelector(selector);
        if (el) return resolve(el);
        if (performance.now() - start > timeout) return reject(new Error(`Timeout waiting for ${selector}`));
        setTimeout(tick, poll);
      })();
    });

  const waitForCondition = (fn, { timeout = 12000, poll = 150 } = {}) =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        try { if (fn()) return resolve(true); } catch (_) {}
        if (performance.now() - start > timeout) return reject(new Error('Timeout waiting for condition'));
        setTimeout(tick, poll);
      })();
    });

  const trigger = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));
  const click = (el) => {
    if (!el) return;
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
  };

  function setSelectValue(selectEl, value) {
    if (!selectEl) return;
    const hasOption = Array.from(selectEl.options).some(o => o.value === value);
    if (!hasOption) return;
    selectEl.value = value;
    trigger(selectEl, 'change');
    trigger(selectEl, 'input');

    // bootstrap-select bijwerken (indien aanwezig)
    try {
      const $ = window.jQuery || window.$;
      if ($ && $(selectEl).selectpicker) {
        $(selectEl).selectpicker('val', value).trigger('changed.bs.select');
      } else {
        // minimale UI-sync fallback
        const wrapper = selectEl.closest('.bootstrap-select');
        const btn = wrapper && wrapper.querySelector('button[role="button"]');
        const label = wrapper && wrapper.querySelector('.filter-option-inner');
        const text = (selectEl.selectedOptions[0] || {}).text || '';
        if (btn) btn.title = text;
        if (label) label.textContent = text;
      }
    } catch (_) { /* ignore */ }
  }

  function setInputValue(inputEl, value) {
    if (!inputEl) return;
    inputEl.value = value;
    trigger(inputEl, 'input');
    trigger(inputEl, 'change');
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', right: '16px', bottom: '16px',
      padding: '10px 14px', background: 'rgba(0,0,0,0.85)', color: '#fff',
      borderRadius: '8px', fontSize: '13px', zIndex: 999999,
      boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  // --- fancy otherLocation selectie via custom dropdown ---
  async function selectFancyOtherLocation(label = '00. Extern') {
    const fancy = await waitFor('.fancy-input-otherLocation');
    const valueHolder = fancy.querySelector('.value-holder');
    const dropdown = fancy.querySelector('.fancy-input-dropdown');

    // Open de dropdown als hij dicht is (triggert lazy-load)
    if (dropdown && dropdown.style.display === 'none') {
      click(valueHolder || fancy);
      // wacht mini-tikje zodat DOM items kunnen verschijnen
      await new Promise(r => setTimeout(r, 50));
    }

    // Indien filter aanwezig, filter op label (verkort de lijst / triggert remote)
    const filter = fancy.querySelector('.filter-input');
    if (filter) {
      filter.value = label.split(' ').pop(); // bv. "Extern"
      filter.setSelectionRange(filter.value.length, filter.value.length);
      trigger(filter, 'input');
      trigger(filter, 'keyup');
    }

    // Wacht tot onze optie in de lijst staat
    await waitForCondition(() =>
      !!fancy.querySelector(`.dropdown-item.option[data-key="${CSS.escape(label)}"]`)
    );

    const item = fancy.querySelector(`.dropdown-item.option[data-key="${CSS.escape(label)}"]`);
    if (!item) return false;

    // Klik de optie
    click(item);

    // UI fallback: value-holder bijwerken
    if (valueHolder) valueHolder.textContent = label;

    // Dropdown sluiten (klik buiten)
    document.body.click();
    return true;
  }

  // --- hoofdactie bij button ---
  async function applyStockCheckDefaults() {
    try {
      const bulkReason = await waitFor('#bulk_reason').catch(() => null);
      const otherReason = await waitFor('#other_reason').catch(() => null);
      const inboundLocation = await waitFor('#inbound_location').catch(() => null);

      if (bulkReason) setSelectValue(bulkReason, 'other');             // Reden -> Anders
      if (otherReason) setInputValue(otherReason, 'Stock Check');      // Other reason text
      if (inboundLocation) {
        setSelectValue(inboundLocation, 'otherLocation');              // Inkomende locatie -> andere
        trigger(inboundLocation, 'change');                            // toon vervolgveld
      }

      // Wacht tot fancy-container zichtbaar is en kies "00. Extern"
      const ok = await selectFancyOtherLocation('00. Extern').catch(() => false);

      toast(ok
        ? 'Stock Check Logger: velden + "00. Extern" ingevuld ✔'
        : 'Stock Check Logger: velden ingevuld; locatie niet gevonden.'
      );
    } catch (e) {
      console.warn('[Stock Check Logger] fout:', e);
      toast('Stock Check Logger: niet alle velden gevonden.');
    }
  }

  function injectButton() {
    if (document.getElementById('stock-check-logger-btn')) return;

    const header = document.querySelector('.m-portlet__head-text') || document.body;

    const btn = document.createElement('button');
    btn.id = 'stock-check-logger-btn';
    btn.type = 'button';
    btn.textContent = 'ICP Tool';
    btn.title = 'Vul Reden, Other reason en Inkomende locatie ("00. Extern") automatisch in';
    Object.assign(btn.style, {
      cursor: 'pointer',
      marginLeft: '8px',
      padding: '6px 10px',
      borderRadius: '8px',
      border: '1px solid #2e6fdb',
      background: '#3b82f6',
      color: '#fff',
      fontSize: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    });

    btn.addEventListener('click', applyStockCheckDefaults);

    if (header !== document.body) {
      const wrap = document.createElement('span');
      wrap.style.marginLeft = '10px';
      wrap.appendChild(btn);
      header.parentElement.appendChild(wrap);
    } else {
      Object.assign(btn.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999 });
      document.body.appendChild(btn);
    }
  }

  // init
  (async function init() {
    await domReady();
    injectButton();

    // Als de pagina dynamisch wisselt, probeer de knop opnieuw te plaatsen
    const mo = new MutationObserver(() => injectButton());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
