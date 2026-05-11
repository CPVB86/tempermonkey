// ==UserScript==
// @name         DDO | Paste2Select
// @namespace    ddo-tools
// @version      1.1.0
// @description  Vinkt orders aan op basis van order-ID's op het klembord
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=orders&action=viewstatus&id=10
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/paste2select.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/paste2select.user.js
// ==/UserScript==

(function () {
  'use strict';

  function parseOrderIds(text) {
    return new Set(
      String(text || '')
        .split(/\s+/)
        .map(v => v.trim())
        .filter(v => /^\d+$/.test(v))
    );
  }

  async function selectOrdersFromClipboard() {
    let text = '';

    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }

    const wantedIds = parseOrderIds(text);
    if (!wantedIds.size) return;

    document
      .querySelectorAll('input[type="checkbox"][name="orders[]"]')
      .forEach(cb => {
        const orderId = String(cb.value || '').trim();

        if (wantedIds.has(orderId)) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
  }

  function addButton() {
    const table = document.querySelector('table.control');
    if (!table) return;

    const wrapper = document.createElement('div');
    wrapper.style.margin = '0 0 10px 0';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✅ Selecteer orders van klembord';
    btn.addEventListener('click', selectOrdersFromClipboard);

    wrapper.appendChild(btn);
    table.parentNode.insertBefore(wrapper, table);
  }

  addButton();

})();
