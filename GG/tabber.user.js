// ==UserScript==
// @name         GG / Tabber
// @version      1.1
// @description  Opent producten in eigen tabbladen - view, edit of stock
// @match        https://fm-e-warehousing.goedgepickt.nl/picklocations/view*
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

  function buildUrls(mode) {
    const boxes = $$('input.products[type="checkbox"]:checked');
    return boxes.map(cb => {
      const uuid = cb.dataset.uuid;         // bijv. 2254d87b-...
      const stockId = cb.value;             // bijv. 5264605
      let path = null;

      if (mode === 'settings') {
        path = `/products/edit/${uuid}`;
      } else if (uuid) {
        path = (mode === 'edit')
          ? `/products/edit-stock/${uuid}/${stockId}`
          : `/products/view/${uuid}`;
      } else {
        // Fallback: pak de view-link uit de rij
        const tr = cb.closest('tr');
        const a = tr && tr.querySelector('a[href*="/products/view/"]');
        if (a) path = a.getAttribute('href');
      }

      return path ? new URL(path, location.origin).href : null;
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
    // kleine spreiding helpt soms tegen popup-blockers
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
    i.className = "fas fa-external-link-alt"; // FA5 is aanwezig op de site
    span.appendChild(i);

    a.appendChild(span);
    li.appendChild(a);

    // Helemaal links toevoegen
    navUl.insertBefore(li, navUl.firstChild);

    a.addEventListener("click", handleClick);
  }

  // inital load
  addTopbarButton();

  // opnieuw toevoegen als topbar/DOM re-rendered wordt
  const obs = new MutationObserver(() => addTopbarButton());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
