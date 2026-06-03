// ==UserScript==
// @name         GG | Paste2Select
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.1.1
// @description  Vinkt GoedGepickt-orders aan op basis van ordernummers op het klembord + kopieert zichtbare orders.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/paste2select.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/paste2select.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TABLE_SELECTOR = '#order_index_datatable';
  const BUTTON_WRAP_ID = 'gg-paste2select-wrap';

  function parseOrderIds(text) {
    return new Set(
      String(text || '')
        .split(/\s+/)
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
    );
  }

  function getDatatable() {
    if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.dataTable) {
      return null;
    }

    try {
      return window.jQuery(TABLE_SELECTOR).DataTable();
    } catch {
      return null;
    }
  }

  function getOrderIdFromRowNode(row) {
    const link = row.querySelector('td.external_id a, td:nth-child(3) a');
    return link ? link.textContent.trim() : '';
  }

  function setCheckbox(cb, checked) {
    if (!cb || cb.checked === checked) return;

    cb.checked = checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }

async function paste2Select(btn) {
  let text = '';

  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }

  const wantedIds = parseOrderIds(text);
  if (!wantedIds.size) return;

  let selectedCount = 0;

  const handleRow = row => {
    const orderId = getOrderIdFromRowNode(row);
    const cb = row.querySelector('input.orders[name="orders[]"]');

    if (wantedIds.has(orderId) && cb) {
      if (!cb.checked) selectedCount++;
      setCheckbox(cb, true);
    }
  };

  const dt = getDatatable();

  if (dt) {
    dt.rows({ filter: 'applied' }).every(function () {
      const node = this.node();
      if (node) handleRow(node);
    });
  } else {
    document.querySelectorAll(`${TABLE_SELECTOR} tbody tr`).forEach(handleRow);
  }

  btn.textContent = `${selectedCount} orders geselecteerd`;
}

async function copy2Select(btn) {
  const ids = [];

  const handleRow = row => {
    const cb = row.querySelector('input.orders[name="orders[]"]');
    if (!cb || !cb.checked) return;

    const orderId = getOrderIdFromRowNode(row);
    if (orderId) ids.push(orderId);
  };

  const dt = getDatatable();

  if (dt) {
    dt.rows({ filter: 'applied' }).every(function () {
      const node = this.node();
      if (node) handleRow(node);
    });
  } else {
    document.querySelectorAll(`${TABLE_SELECTOR} tbody tr`).forEach(handleRow);
  }

  if (!ids.length) return;

  try {
    await navigator.clipboard.writeText(ids.join('\n'));
    btn.textContent = `${ids.length} orders gekopieerd`;
  } catch {
    return;
  }
}

  function createButton(label, onClick) {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className = 'btn btn-primary ml-2';
    btn.textContent = label;

    btn.style.whiteSpace = 'nowrap';
    btn.style.height = '40px';
    btn.style.lineHeight = '1';
    btn.style.padding = '0 10px';
    btn.style.fontSize = '13px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';

    btn.addEventListener('click', onClick);

    return btn;
  }

  function addButtons() {
    if (document.getElementById(BUTTON_WRAP_ID)) return;

    const header = document.querySelector('.orders-index-table-header');
    const table = document.querySelector(TABLE_SELECTOR);

    if (!header && !table) return;

    const target =
      header?.querySelector('.orders-index-search-container') ||
      header ||
      table.parentNode;

    const wrap = document.createElement('div');

    wrap.id = BUTTON_WRAP_ID;
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.marginLeft = '4px';

    const pasteBtn = createButton('📋 Paste2Select', function () {
  paste2Select(pasteBtn);
});

const copyBtn = createButton('📄 Copy2Select', function () {
  copy2Select(copyBtn);
});

    wrap.appendChild(pasteBtn);
    wrap.appendChild(copyBtn);

    target.appendChild(wrap);
  }

  addButtons();

})();
