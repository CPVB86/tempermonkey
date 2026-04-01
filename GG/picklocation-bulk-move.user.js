// ==UserScript==
// @name         GG | Picklocation Bulk Move
// @version      1.1
// @description  Knop bij "Gekoppelde producten": zoekt per picklocation op [ext]/[nme], zet length op 100, selecteert alles, kiest bulk actie en juiste doellocatie.
// @author       C. P. v. Beek
// @match        https://fm-e-warehousing.goedgepickt.nl/picklocations/view/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/picklocation-bulk-move.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/picklocation-bulk-move.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SS_KEY = 'gg_pickloc_bulkmove_resume';

  const PAGE_CONFIG = {
    'bf8eb54a-2780-429a-b9b9-56a0362c78bf': {
      searchTerm: '[ext]',
      targetLocation: 'Extern',
      buttonTitle: 'Zoek op [ext], zet op 100, selecteer alles, bulk actie → Verplaats naar voorraadlocatie → Extern'
    },
    '34e0554c-6d94-4c03-82be-4013c00eb63d': {
      searchTerm: '[nme]',
      targetLocation: '00. NME',
      buttonTitle: 'Zoek op [nme], zet op 100, selecteer alles, bulk actie → Verplaats naar voorraadlocatie → 00. NME'
    }
  };

  // ---------- helpers ----------
  const domReady = () => new Promise(res => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return res();
    document.addEventListener('DOMContentLoaded', res, { once: true });
  });

  const waitFor = (selector, { root = document, timeout = 15000, poll = 150 } = {}) =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        const el = root.querySelector(selector);
        if (el) return resolve(el);
        if (performance.now() - start > timeout) return reject(new Error(`Timeout waiting for ${selector}`));
        setTimeout(tick, poll);
      })();
    });

  const waitForCondition = (fn, { timeout = 15000, poll = 150 } = {}) =>
    new Promise((resolve, reject) => {
      const start = performance.now();
      (function tick() {
        try {
          if (fn()) return resolve(true);
        } catch (_) {}
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
    if (!selectEl) return false;
    const opt = Array.from(selectEl.options).find(o => o.value === value);
    if (!opt) return false;
    selectEl.value = value;
    trigger(selectEl, 'input');
    trigger(selectEl, 'change');
    return true;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      padding: '10px 14px',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '13px',
      zIndex: 999999,
      boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function getPageId() {
    const match = location.pathname.match(/\/picklocations\/view\/([a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  function getConfig() {
    const pageId = getPageId();
    return pageId ? PAGE_CONFIG[pageId] : null;
  }

  // ---------- flow ----------
  async function step0_applySearch(searchTerm) {
    if (!searchTerm) return;

    const input = await waitFor('#productPicklocationSearch');

    if (input.value !== searchTerm) {
      input.focus();
      input.value = searchTerm;
      trigger(input, 'input');
      trigger(input, 'change');
      trigger(input, 'keyup');
      trigger(input, 'search');
      input.blur();
    }

    // Wacht tot zoeken klaar is
    await waitForCondition(() => {
      const processing = document.querySelector('#productsLinkedToPicklocationDatatable_processing');
      const busy = processing && processing.style && processing.style.display !== 'none';
      return !busy;
    }, { timeout: 10000 }).catch(() => true);

    await new Promise(r => setTimeout(r, 250));
  }

  async function step1_setLength100() {
    const lenSel = await waitFor('select[name="productsLinkedToPicklocationDatatable_length"]');
    if (lenSel.value !== '100') {
      sessionStorage.setItem(SS_KEY, 'afterLength');
      setSelectValue(lenSel, '100');
      await new Promise(r => setTimeout(r, 250));
    } else {
      sessionStorage.removeItem(SS_KEY);
    }

    await waitForCondition(() => {
      const s = document.querySelector('select[name="productsLinkedToPicklocationDatatable_length"]');
      if (!s || s.value !== '100') return false;
      const processing = document.querySelector('#productsLinkedToPicklocationDatatable_processing');
      const busy = processing && processing.style && processing.style.display !== 'none';
      return !busy;
    }).catch(() => true);
  }

  async function step3_chooseBulkActionMoveTo() {
    const bulk = await waitFor('#bulkActionsSelect');
    await waitForCondition(() => !document.querySelector('#bulkActionsSelect')?.disabled)
      .catch(() => true);

    setSelectValue(bulk, 'moveTo');
    trigger(bulk, 'change');
    await new Promise(r => setTimeout(r, 200));
  }

  async function step4_chooseTargetLocation(targetLocation) {
    const moveWrap = await waitFor('div.bulkActionsSelect.bulkMoveTo.topActions');
    const fancy = await waitFor('.form-control.fancy-input', { root: moveWrap });
    const valueHolder = fancy.querySelector('.value-holder') || fancy;
    const dropdown = fancy.querySelector('.fancy-input-dropdown');

    click(valueHolder);
    await new Promise(r => setTimeout(r, 100));

    const filter = fancy.querySelector('.filter-input');
    if (filter) {
      filter.focus();
      filter.value = targetLocation;
      filter.setSelectionRange(filter.value.length, filter.value.length);
      trigger(filter, 'input');
      trigger(filter, 'keyup');
      trigger(filter, 'change');
      await new Promise(r => setTimeout(r, 180));
    }

    await waitForCondition(() => {
      const items = fancy.querySelectorAll('.dropdown-item.option, .dropdown-item');
      return Array.from(items).some(i => {
        const txt = (i.textContent || '').trim().toLowerCase();
        return txt === targetLocation.toLowerCase() || txt.includes(targetLocation.toLowerCase());
      });
    }, { timeout: 10000 });

    const items = Array.from(fancy.querySelectorAll('.dropdown-item.option, .dropdown-item'));

    const normalizedTarget = targetLocation.trim().toLowerCase();
    const pickedItem =
      items.find(i => (i.textContent || '').trim().toLowerCase() === normalizedTarget) ||
      items.find(i => (i.textContent || '').trim().toLowerCase().includes(normalizedTarget));

    if (!pickedItem) {
      toast(`Bulk Move: "${targetLocation}" staat niet in de dropdown.`);
      return;
    }

    click(pickedItem);

    const pickedLabel = (pickedItem.textContent || '').trim();
    const vh = fancy.querySelector('.value-holder');
    if (vh && pickedLabel) vh.textContent = pickedLabel;

    document.body.click();
    toast(`Bulk Move: locatie → ${targetLocation} ✔`);
  }

  async function stabilizeSelectAllDatatable({
    stableMs = 900,
    maxWait = 15000,
    keepAliveMs = 6000,
  } = {}) {
    const table = await waitFor('#productsLinkedToPicklocationDatatable');
    const tbody = table.querySelector('tbody') || table;

    const processingEl = () => document.querySelector('#productsLinkedToPicklocationDatatable_processing');
    const isBusy = () => {
      const p = processingEl();
      return p && p.style && p.style.display !== 'none';
    };

    const rowCount = () => (table.querySelectorAll('tbody tr').length || 0);

    const start = Date.now();
    let lastCount = rowCount();
    let lastChange = Date.now();

    while (Date.now() - start < maxWait) {
      const c = rowCount();
      if (c !== lastCount) {
        lastCount = c;
        lastChange = Date.now();
      }

      if (!isBusy() && c > 0 && (Date.now() - lastChange) >= stableMs) break;
      await new Promise(r => setTimeout(r, 150));
    }

    const clickSelectAll = () => {
      const checkAll = document.querySelector('input.checkAllProducts');
      if (!checkAll) return false;
      if (!checkAll.checked) click(checkAll);
      return true;
    };

    clickSelectAll();

    const guardUntil = Date.now() + keepAliveMs;

    const mo = new MutationObserver(() => {
      if (Date.now() > guardUntil) return;
      const checkAll = document.querySelector('input.checkAllProducts');
      if (checkAll && !checkAll.checked) click(checkAll);
    });

    mo.observe(tbody, { childList: true, subtree: true });

    while (Date.now() < guardUntil) {
      const checkAll = document.querySelector('input.checkAllProducts');
      if (checkAll && !checkAll.checked) click(checkAll);

      if (isBusy()) {
        await waitForCondition(() => !isBusy()).catch(() => true);
      }

      await new Promise(r => setTimeout(r, 250));
    }

    mo.disconnect();
  }

  async function runAll() {
    const cfg = getConfig();

    if (!cfg) {
      toast('Bulk Move: geen configuratie voor deze picklocation.');
      return;
    }

    try {
      await step0_applySearch(cfg.searchTerm);
      await step1_setLength100();
      await stabilizeSelectAllDatatable({ stableMs: 900, keepAliveMs: 8000 });
      await step3_chooseBulkActionMoveTo();
      await step4_chooseTargetLocation(cfg.targetLocation);
    } catch (e) {
      console.warn('[GG Picklocation Bulk Move] fout:', e);
      toast('Bulk Move: niet alles gevonden (check console).');
    } finally {
      sessionStorage.removeItem(SS_KEY);
    }
  }

  // ---------- UI inject ----------
  function injectButton() {
    if (document.getElementById('gg-pickloc-bulkmove-btn')) return;

    const cfg = getConfig();
    if (!cfg) return;

    const h3s = Array.from(document.querySelectorAll('h3.m-portlet__head-text'));
    const targetH3 = h3s.find(h => (h.textContent || '').replace(/\s+/g, ' ').trim() === 'Gekoppelde producten');
    if (!targetH3) return;

    const btn = document.createElement('button');
    btn.id = 'gg-pickloc-bulkmove-btn';
    btn.type = 'button';
    btn.textContent = '⇢';
    btn.title = cfg.buttonTitle;

    Object.assign(btn.style, {
      cursor: 'pointer',
      marginLeft: '10px',
      width: '28px',
      height: '28px',
      lineHeight: '26px',
      borderRadius: '8px',
      border: '1px solid #2e6fdb',
      background: '#3b82f6',
      color: '#fff',
      fontSize: '14px',
      fontWeight: '700',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      padding: '0',
      verticalAlign: 'middle',
    });

    btn.addEventListener('click', runAll);
    targetH3.appendChild(btn);
  }

  // init
  (async function init() {
    await domReady();
    injectButton();

    if (sessionStorage.getItem(SS_KEY) === 'afterLength') {
      setTimeout(runAll, 300);
    }

    const mo = new MutationObserver(() => injectButton());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
