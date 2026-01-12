// ==UserScript==
// @name         GG | Tabber
// @version      1.2
// @description  Opent producten in eigen tabbladen - view, edit of stock
// @match        https://fm-e-warehousing.goedgepickt.nl/picklocations/view*
// @match        https://fm-e-warehousing.goedgepickt.nl/products*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/tabber.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/tabber.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'gp-open-checked-products-li';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ✔ Werkt op /picklocations (input.products) én /products (input.productToDetach)
  // ✖ Negeert "select all"
  const CHECKBOX_SELECTOR = [
    'input.productToDetach[type="checkbox"]:checked',
    'input.products[type="checkbox"]:checked',
  ].join(',');

  function getUuidFromRow(cb) {
    // 1) dataset.uuid (zoals in jouw snippet)
    if (cb?.dataset?.uuid) return cb.dataset.uuid;

    // 2) fallback: uit view-link halen
    const tr = cb.closest('tr');
    const a = tr && tr.querySelector('a[href^="/products/view/"]');
    if (a) {
      const m = a.getAttribute('href').match(/\/products\/view\/([a-f0-9-]{36})/i);
      if (m) return m[1];
    }
    return null;
  }

  function buildUrls(mode) {
    const boxes = $$(CHECKBOX_SELECTOR)
      // extra safeguard: check-all eruit (op sommige pagina’s kan die ook “checked” zijn)
      .filter(cb => !cb.classList.contains('bulkDeleteProductCheckAll'));

    return boxes.map(cb => {
      const uuid = getUuidFromRow(cb);     // bijv. e6ae093f-...
      const stockId = cb.value || '';      // bijv. 4321028 (kan per pagina anders zijn)
      let path = null;

      if (!uuid) return null;

      if (mode === 'settings') {
        path = `/products/edit/${uuid}`;
      } else if (mode === 'edit') {
        // Let op: stockId verschilt per pagina. Als edit-stock jouw stockId nodig heeft: top.
        // Als die route alleen uuid wil, dan valt 'ie automatisch terug.
        path = stockId
          ? `/products/edit-stock/${uuid}/${stockId}`
          : `/products/edit-stock/${uuid}`;
      } else {
        path = `/products/view/${uuid}`;
      }

      return new URL(path, location.origin).href;
    }).filter(Boolean);
  }

  function openUrls(urls) {
    if (urls.length === 0) {
      alert('Geen producten geselecteerd.');
      return;
    }
    if (urls.length > 10 && !confirm(`Je staat op het punt ${urls.length} tabbladen te openen. Doorgaan?`)) {
      return;
    }
    urls.forEach((u, i) => setTimeout(() => window.open(u, '_blank', 'noopener'), i * 120));
  }

  function handleClick(e) {
    e.preventDefault();
    const mode = e.altKey ? 'edit' : (e.shiftKey ? 'settings' : 'view');
    openUrls(buildUrls(mode));
  }

  function addTopbarButton() {
    const navUl = $(".m-stack__item.m-topbar__nav-wrapper ul.m-topbar__nav");
    if (!navUl || $(`#${BTN_ID}`, navUl)) return;

    const li = document.createElement("li");
    li.id = BTN_ID;
    li.className = "m-nav__item m-topbar__notifications";

    const a = document.createElement("a");
    a.href = "#";
    a.className = "m-nav__link";
    a.title = "Open geselecteerde producten in tabs (Klik: View • Alt: Edit-stock • Shift: Settings)";

    const span = document.createElement("span");
    span.className = "m-nav__link-icon";

    const i = document.createElement("i");
    i.className = "fas fa-external-link-alt";
    span.appendChild(i);

    a.appendChild(span);
    li.appendChild(a);

    navUl.insertBefore(li, navUl.firstChild);
    a.addEventListener("click", handleClick);
  }

  addTopbarButton();

  const obs = new MutationObserver(() => addTopbarButton());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
