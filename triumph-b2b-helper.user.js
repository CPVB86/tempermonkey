// ==UserScript==
// @name         Triumph B2B Helper
// @match        https://b2b.triumph.com/*
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/triumph-b2b-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/triumph-b2b-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PRODUCT_ENV = 'NL_TriumphPROD'; // evt. aanpassen

  function enhance(root = document) {
    root.querySelectorAll('.product-card__title-wrapper').forEach(wrapper => {
      if (wrapper.dataset.openInNewTabDone) return;

      const titleEl = wrapper.querySelector('h4.product-card__title');
      const secondEl = wrapper.querySelector('p.product-card__second-title');
      if (!titleEl || !secondEl) return;

      // Voorbeeld: "10219831 00DK - PEBBLE GREY"
      const raw = secondEl.textContent.trim();
      const beforeDash = raw.split(/\s*-\s*/, 1)[0]; // "10219831 00DK"
      const parts = beforeDash.split(/\s+/);         // ["10219831","00DK"]
      if (parts.length < 2) return;

      const pid = parts[0];
      const color = parts[1];
      const url = `${location.origin}/products/${PRODUCT_ENV}/${pid}/${color}?inStock=true`;

      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'product-card__open-newtab';
      link.title = 'Open product in nieuw tabblad';
      link.textContent = '⧉';
      link.style.marginLeft = '0.4rem';
      link.style.textDecoration = 'none';
      link.style.cursor = 'pointer';

      // Popup van de card blokkeren
      link.addEventListener(
        'click',
        e => {
          e.stopPropagation();
          // geen preventDefault, anders opent de link zelf niet meer
        },
        true
      );

      titleEl.after(link);
      wrapper.dataset.openInNewTabDone = 'true';
    });
  }

  // 1x direct
  enhance();

  // Nog een keer na een kleine delay, voor het geval de grid later verschijnt
  setTimeout(() => enhance(), 1500);
})();
