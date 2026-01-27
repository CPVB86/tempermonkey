// ==UserScript==
// @name         Mey | Discount Summa
// @namespace    https://runiversity.nl/
// @version      1.2.0
// @description  Adds a stable button on collection tiles to open the item in a new tab (survives re-renders).
// @match        https://www.meyb2b.com/*
// @match        https://meyb2b.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function parsePrice(text) {
    if (!text) return NaN;
    // haal alles weg behalve cijfers, komma, punt
    const cleaned = text.replace(/[^\d.,]/g, '').trim();
    // EU-notatie: komma = decimaal
    // maak er een JS-getal van
    const normalized = cleaned
      .replace(/\./g, '')   // haal duizendtallen punten weg (voor de zekerheid)
      .replace(',', '.');   // komma -> punt
    return Number(normalized);
  }

  function calcDiscountPercent(finalPrice, originalPrice) {
    if (!isFinite(finalPrice) || !isFinite(originalPrice) || originalPrice <= 0) return null;
    if (finalPrice >= originalPrice) return 0;
    const pct = Math.round((1 - (finalPrice / originalPrice)) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  function enhance(root = document) {
    const nodes = root.querySelectorAll('div.price.discount');
    nodes.forEach((wrap) => {
      // voorkom dubbel toevoegen
      if (wrap.querySelector('.ddo-discount-percent')) return;

      const finalEl = wrap.querySelector('.finalPrice');
      const origEl  = wrap.querySelector('.originalPrice');
      if (!finalEl || !origEl) return;

      const finalPrice = parsePrice(finalEl.textContent);
      const originalPrice = parsePrice(origEl.textContent);

      const pct = calcDiscountPercent(finalPrice, originalPrice);
      if (pct === null) return;

      const badge = document.createElement('span');
      badge.className = 'ddo-discount-percent';
      badge.textContent = ` -${pct}%`;
      badge.style.marginLeft = '6px';
      badge.style.fontWeight = '700';

      // achter original price plakken (of kies finalEl als je dat liever hebt)
      origEl.insertAdjacentElement('afterend', badge);
    });
  }

  // eerste run
  enhance();

  // als de backend dynamisch laadt: observeer DOM-wijzigingen
  const obs = new MutationObserver(() => enhance());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
