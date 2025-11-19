// ==UserScript==
// @name         Zetex Brandidentifier
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0
// @description  Schrijf het merk achter het artikelnummer op de categoriepagina bij Zetex B2B.
// @match        https://b2b.zetex.nl/webstore/v2/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/zetex-brandidentifier.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/zetex-brandidentifier.user.js
// ==/UserScript==

(function () {
  'use strict';

  function getBrandFromArticleNumber(articleNumber) {
    if (!articleNumber) return null;

    // Verwacht formaat: 45199-308-0 -> we pakken de middelste "308"
    const parts = articleNumber.split('-');
    if (parts.length < 2) return null;

    const seriesCode = parseInt(parts[1], 10);
    if (Number.isNaN(seriesCode)) return null;

    // Mapping volgens jouw beschrijving:
    // 100-199  Pastunette
    // 200-299  Pastunette Premium
    // 300-serie Pastunette (hier als 300-399 geïnterpreteerd)
    // 400-serie Rebelle
    // 500-serie Pastunette Heren
    // 600-serie Rebelle
    // 700 & 800-serie Robson
    if (seriesCode >= 100 && seriesCode <= 199) return 'Pastunette';
    if (seriesCode >= 200 && seriesCode <= 299) return 'Pastunette Premium';
    if (seriesCode >= 300 && seriesCode <= 399) return 'Pastunette';
    if (seriesCode >= 400 && seriesCode <= 499) return 'Rebelle';
    if (seriesCode >= 500 && seriesCode <= 599) return 'Pastunette Heren';
    if (seriesCode >= 600 && seriesCode <= 699) return 'Rebelle';
    if (seriesCode >= 700 && seriesCode <= 899) return 'Robson';

    return null;
  }

  function processProductCards(root = document) {
    const nodes = root.querySelectorAll('.card__product--text .product-name');

    nodes.forEach(p => {
      if (p.dataset.brandAdded === '1') return; // al gedaan

      const originalText = p.textContent.trim();
      if (!originalText) return;

      // Als er al een merk achter staat, niks doen
      if (originalText.includes('–') || originalText.includes(' - ')) {
        p.dataset.brandAdded = '1';
        return;
      }

      const brand = getBrandFromArticleNumber(originalText);
      if (!brand) {
        p.dataset.brandAdded = '1';
        return;
      }

      // Vorm: "45199-308-0 – Pastunette"
      p.textContent = `${originalText} \u2013 ${brand}`;
      p.dataset.brandAdded = '1';
    });
  }

  // Eerste run na load
  processProductCards();

  // Voor als de site producten dynamisch laadt (infinite scroll, SPA, etc.)
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) { // ELEMENT_NODE
            processProductCards(node);
          }
        });
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
