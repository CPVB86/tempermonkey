// ==UserScript==
// @name         DDO | MultiTabber
// @namespace    ddo-tools
// @version      1.0.0
// @description  Shift-select op productcheckboxes en geselecteerde items in nieuwe tabs openen.
// @author       you
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/multitabber.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/multitabber.user.js
// ==/UserScript==

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const table = $('table.control');
  if (!table) return;

  const headerToggle = $('#toggle');

  // --- UI: toolbar ----------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.gap = '8px';
  toolbar.style.alignItems = 'center';
  toolbar.style.margin = '8px 0 12px';
  toolbar.style.flexWrap = 'wrap';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Open selectie in tabbladen';
  openBtn.style.padding = '6px 10px';

  const openOptionsBtn = document.createElement('button');
  openOptionsBtn.type = 'button';
  openOptionsBtn.textContent = "Open 'Options' van selectie in tabbladen";
  openOptionsBtn.style.padding = '6px 10px';

  const countSpan = document.createElement('span');
  countSpan.style.fontWeight = '600';

  const tip = document.createElement('span');
  tip.textContent = 'Houd shift ingedrukt voor een meervoudige selectie.';
  tip.style.opacity = '0.7';
  tip.style.marginLeft = '12px';

  toolbar.append(openBtn, openOptionsBtn, countSpan, tip);
  table.parentElement.insertBefore(toolbar, table);

  // --- Helpers --------------------------------------------------------------
  const getBoxes = () => $$('tbody input[type="checkbox"][name="products[]"]', table);

  function updateCount() {
    const count = getBoxes().filter(cb => cb.checked).length;
    countSpan.textContent = `${count} geselecteerd`;
    openBtn.disabled = count === 0;
    openOptionsBtn.disabled = count === 0;
  }

  function stopRowNav(e) {
    e.stopPropagation();
    if (e.type === 'mousedown') e.preventDefault();
  }

  if (headerToggle) {
    headerToggle.addEventListener('click', stopRowNav, true);
    headerToggle.addEventListener('mousedown', stopRowNav, true);
    headerToggle.addEventListener('change', () => {
      const state = headerToggle.checked;
      getBoxes().forEach(cb => (cb.checked = state));
      updateCount();
    });
  }

  // --- Shift-select ---------------------------------------------------------
  let lastIndex = null;
  let lastShiftState = false;

  table.addEventListener('mousedown', (e) => {
    const cb = e.target.closest('input[type="checkbox"][name="products[]"]');
    if (!cb) return;
    stopRowNav(e);
    lastShiftState = e.shiftKey;
  }, true);

  table.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"][name="products[]"]');
    if (!cb) return;

    const boxes = getBoxes();
    const idx = boxes.indexOf(cb);

    if (lastIndex !== null && (lastShiftState || e.shiftKey)) {
      const [start, end] = [Math.min(lastIndex, idx), Math.max(lastIndex, idx)];
      const state = cb.checked;
      for (let i = start; i <= end; i++) boxes[i].checked = state;
    }

    lastIndex = idx;
    lastShiftState = false;
    updateCount();
  }, true);

  table.addEventListener('click', (e) => {
    const cb = e.target.closest('input[type="checkbox"][name="products[]"]');
    if (cb) stopRowNav(e);
  }, true);

  // --- Open in tabs ---------------------------------------------------------
  function urlForCheckbox(cb, addHashTabs3 = false) {
    const id = cb.value?.trim();
    if (!id) return null;
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('section', 'products');
    u.searchParams.set('action', 'edit');
    u.searchParams.set('id', id);
    if (addHashTabs3) u.hash = 'tabs-3';
    return u.toString();
  }

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  async function openSelected(addHashTabs3) {
    const selected = getBoxes().filter(cb => cb.checked);
    for (let i = 0; i < selected.length; i++) {
      const href = urlForCheckbox(selected[i], addHashTabs3);
      if (href) window.open(href, '_blank', 'noopener');
      await sleep(100); // vaste 100ms delay
    }
  }

  openBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    openSelected(false);
  });

  openOptionsBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    openSelected(true);
  });

  // sneltoetsen
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      openBtn.click();
    }
    if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      openOptionsBtn.click();
    }
  }, true);

  // init
  updateCount();
})();
