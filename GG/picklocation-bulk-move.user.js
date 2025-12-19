// ==UserScript==
// @name         GG | Picklocation Bulk Move
// @version      1.0
// @description  Knop bij "Gekoppelde producten": zet length op 100, selecteert alles, kiest bulk actie + locatie Extern.
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
      position: 'fixed', right: '16px', bottom: '16px',
      padding: '10px 14px', background: 'rgba(0,0,0,0.85)', color: '#fff',
      borderRadius: '8px', fontSize: '13px', zIndex: 999999,
      boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------- flow ----------
  async function step1_setLength100() {
    const lenSel = await waitFor('select[name="productsLinkedToPicklocationDatatable_length"]');
    if (lenSel.value !== '100') {
      sessionStorage.setItem(SS_KEY, 'afterLength');
      setSelectValue(lenSel, '100');

      // DataTables verandert vaak zonder hard reload; geef ’m even tijd.
      await new Promise(r => setTimeout(r, 250));
    } else {
      sessionStorage.removeItem(SS_KEY);
    }

    // Wacht tot DataTables “klaar” voelt: processing weg, of meer rows aanwezig, of value echt 100.
    await waitForCondition(() => {
      const s = document.querySelector('select[name="productsLinkedToPicklocationDatatable_length"]');
      if (!s || s.value !== '100') return false;
      const processing = document.querySelector('#productsLinkedToPicklocationDatatable_processing');
      const busy = processing && processing.style && processing.style.display !== 'none';
      return !busy;
    }).catch(() => true);
  }

  async function step2_selectAll() {
    const label = await waitFor('label.datatable_checkbox input.checkAllProducts');
    if (!label.checked) click(label);
    await waitForCondition(() => document.querySelector('input.checkAllProducts')?.checked === true)
      .catch(() => true);
  }

  async function step3_chooseBulkActionMoveTo() {
    const bulk = await waitFor('#bulkActionsSelect');
    // disabled verdwijnt meestal zodra er een selectie is
    await waitForCondition(() => !document.querySelector('#bulkActionsSelect')?.disabled)
      .catch(() => true);

    // waarde lijkt "moveTo"
    setSelectValue(bulk, 'moveTo');
    // soms is UI “fancy” en luistert ook op click/blur; mini nudge:
    trigger(bulk, 'change');
    await new Promise(r => setTimeout(r, 200));
  }

 async function step4_chooseExtern() {
  const moveWrap = await waitFor('div.bulkActionsSelect.bulkMoveTo.topActions');

  // De fancy container die de dropdown bestuurt
  const fancy = await waitFor('.form-control.fancy-input', { root: moveWrap });
  const valueHolder = fancy.querySelector('.value-holder') || fancy;
  const dropdown = fancy.querySelector('.fancy-input-dropdown');

  // Open dropdown (triggert vaak lazy-load)
  if (dropdown && dropdown.style.display === 'none') {
    click(valueHolder);
    await new Promise(r => setTimeout(r, 80));
  } else {
    // soms staat display niet op none maar is hij nog "dicht" — toch even klikken
    click(valueHolder);
    await new Promise(r => setTimeout(r, 80));
  }

  // Typ in filter om Extern snel te vinden / remote te triggeren
  const filter = fancy.querySelector('.filter-input');
  if (filter) {
    filter.value = 'Extern';
    filter.setSelectionRange(filter.value.length, filter.value.length);
    trigger(filter, 'input');
    trigger(filter, 'keyup');
    await new Promise(r => setTimeout(r, 120));
  }

  // Wacht tot er een klikbare optie verschijnt
  await waitForCondition(() => {
    const items = fancy.querySelectorAll('.dropdown-item.option, .dropdown-item');
    return Array.from(items).some(i => /extern/i.test((i.textContent || '').trim()));
  });

  const items = Array.from(fancy.querySelectorAll('.dropdown-item.option, .dropdown-item'));
  const externItem = items.find(i => /extern/i.test((i.textContent || '').trim()));

  if (!externItem) {
    toast('Bulk Move: "Extern" staat niet in de dropdown.');
    return;
  }

  // Klik de echte dropdown-item (dit is de belangrijke stap)
  click(externItem);

  // Kleine UI fallback (value-holder bijwerken als het niet vanzelf gaat)
  const pickedLabel = (externItem.textContent || '').trim();
  const vh = fancy.querySelector('.value-holder');
  if (vh && pickedLabel) vh.textContent = pickedLabel;

  // Dropdown sluiten (klik buiten)
  document.body.click();

  toast('Bulk Move: locatie → Extern ✔');
}
async function stabilizeSelectAllDatatable({
  stableMs = 900,     // hoe lang rowcount stil moet staan
  maxWait = 15000,    // totale maximale wachttijd
  keepAliveMs = 6000, // na select-all nog even bewaken
} = {}) {

  const table = await waitFor('#productsLinkedToPicklocationDatatable');
  const tbody = table.querySelector('tbody') || table;

  const processingEl = () => document.querySelector('#productsLinkedToPicklocationDatatable_processing');
  const isBusy = () => {
    const p = processingEl();
    return p && p.style && p.style.display !== 'none';
  };

  const rowCount = () => (table.querySelectorAll('tbody tr').length || 0);

  // 1) Wacht totdat de tabel "stabiel" is: rowcount verandert niet meer gedurende stableMs, en niet busy.
  const start = Date.now();
  let lastCount = rowCount();
  let lastChange = Date.now();

  while (Date.now() - start < maxWait) {
    const c = rowCount();
    if (c !== lastCount) {
      lastCount = c;
      lastChange = Date.now();
    }
    // stabiel als: niet busy + rowcount al stableMs niet veranderd + minimaal 1 row
    if (!isBusy() && c > 0 && (Date.now() - lastChange) >= stableMs) break;

    await new Promise(r => setTimeout(r, 150));
  }

  // 2) Nu pas select-all (met “fresh query”)
  const clickSelectAll = () => {
    const checkAll = document.querySelector('input.checkAllProducts');
    if (!checkAll) return false;
    if (!checkAll.checked) click(checkAll);
    return true;
  };

  clickSelectAll();

  // 3) Bewaak voor redraw-resets: als hij uitvalt, zet hem weer aan.
  const guardUntil = Date.now() + keepAliveMs;

  const mo = new MutationObserver(() => {
    if (Date.now() > guardUntil) return;
    const checkAll = document.querySelector('input.checkAllProducts');
    if (checkAll && !checkAll.checked) click(checkAll);
  });

  mo.observe(tbody, { childList: true, subtree: true });

  // extra interval-check (soms komt reset zonder DOM-mutation die we zien)
  while (Date.now() < guardUntil) {
    const checkAll = document.querySelector('input.checkAllProducts');
    if (checkAll && !checkAll.checked) click(checkAll);

    // als processing weer aan gaat, even laten uitrazen
    if (isBusy()) {
      await waitForCondition(() => !isBusy()).catch(() => true);
    }

    await new Promise(r => setTimeout(r, 250));
  }

  mo.disconnect();
}

  async function runAll() {
    try {
await step1_setLength100();

// NIET meteen step2_selectAll doen; eerst stabiliseren + selecteren
await stabilizeSelectAllDatatable({ stableMs: 900, keepAliveMs: 8000 });

await step3_chooseBulkActionMoveTo();
await step4_chooseExtern();
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

    const h3s = Array.from(document.querySelectorAll('h3.m-portlet__head-text'));
    const targetH3 = h3s.find(h => (h.textContent || '').replace(/\s+/g, ' ').trim() === 'Gekoppelde producten');
    if (!targetH3) return;

    const btn = document.createElement('button');
    btn.id = 'gg-pickloc-bulkmove-btn';
    btn.type = 'button';
    btn.textContent = '⇢';
    btn.title = 'Zet op 100, selecteer alles, bulk actie → Verplaats naar voorraadlocatie → Extern';
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

    // als er écht een hard reload is gebeurd na lengte=100:
    if (sessionStorage.getItem(SS_KEY) === 'afterLength') {
      // kleine delay zodat de tabel rustig kan initialiseren
      setTimeout(runAll, 300);
    }

    const mo = new MutationObserver(() => injectButton());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
