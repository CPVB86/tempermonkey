// ==UserScript==
// @name         Van Gennip PDP Sparkle
// @version      1.1
// @description  Voeg een klikbare ✨ toe achter de favoriet-button om HTML voor DDO te genereren
// @match        https://vangennip.itsperfect.it/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gennip-pdp-sparkle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gennip-pdp-sparkle.user.js
// ==/UserScript==

(function () {
  'use strict';

  /*** Helpers ***/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $all = (sel, root = document) => [...root.querySelectorAll(sel)];

  const getText = (selector) => $(selector)?.textContent.trim() || '';

  const getSpecValueById = (id) =>
    $(`#${id} .spec__value, #${id} .value`)?.textContent.trim() || '';

  const capitalizeWords = (str) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  // p_id uit de URL (werkt voor .../p_id=29551 en ook als het een querystring is)
  function getPidFromUrl() {
    const m = location.href.match(/p_id=(\d+)/i);
    return m ? m[1] : '';
  }

  /*** Matrix helpers ***/
  function getActiveMatrixRow() {
    const matrix = $('.product-matrix.js-product-matrix');
    if (!matrix) return null;
    return $('tbody tr.background-color-hover', matrix) || $('tbody tr', matrix);
  }

  function getColorName() {
    const row = getActiveMatrixRow();
    return row ? getText('.item__color_name') || '' : (getText('.colorName, .color-name') || getSpecValueById('color_name') || '');
  }

  function getColorCode() {
    const row = getActiveMatrixRow();
    return row ? getText('.item__color_number') || '' : (getText('.colorNumber, .color-number') || getSpecValueById('color_number') || '');
  }

  // Prijs: eerst specifiek uit .price__retail span; dan fallbacks
  function getPrice() {
    let txt = getText('.price__retail span');
    if (!txt) {
      // fallbacks
      txt = getText('.product-matrix__price') ||
            getText('.salesListPrice span') ||
            getText('.product__price .price') ||
            getText('.price__now') ||
            getText('[itemprop="price"]') ||
            getText('.price');
    }
    if (!txt) return '';
    // Strip valuta/ruimtes: "€ 21,99" -> "21,99"
    const cleaned = txt.replace(/[^\d,.-]/g, '').replace(/\s+/g, '').trim();
    // Laat de komma staan voor weergave in HTML (we voegen zelf "€ " toe)
    return cleaned || '';
  }

  // Voorraadmatrix uit inputs in actieve rij
  // Mapping: >4 → 5; <2 → 0; 2|3|4 → exact
  function extractStockMatrix() {
    const row = getActiveMatrixRow();
    if (!row) return '';

    const inputs = $all('td.product-matrix__size input.js-size-input', row);
    if (!inputs.length) return '';

    const rows = inputs.map((input) => {
      const size = input.getAttribute('data-size')?.trim() || '';
      const limitAttr = input.getAttribute('data-limit'); // nieuwe attribuutnaam
      let limit = parseInt(limitAttr || '0', 10);
      if (isNaN(limit)) limit = 0;

      let stock;
      if (limit > 4) stock = 5;
      else if (limit < 2) stock = 1;
      else stock = limit; // 2,3,4

      return size ? `<tr><td>${size}</td><td></td><td>${stock}</td></tr>` : '';
    }).filter(Boolean);

    return `<div class="pdp-details_matrix"><table>${rows.join('')}</table></div>`;
  }

  /*** ✨ na 'Artikelinformatie' ***/
  function findArtikelinformatieHeader() {
    for (const el of $all('.component__header.js-comp-header')) {
      const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (text === 'artikelinformatie') return el;
    }
    return null;
  }

  function buildSparkle() {
    const sparkle = document.createElement('span');
    sparkle.textContent = ' ✨';
    sparkle.className = 'copy-sparkle';
    sparkle.style.cursor = 'pointer';
    sparkle.style.color = '#0073aa';
    sparkle.style.fontWeight = 'normal';
    sparkle.style.fontSize = '14px';
    sparkle.title = 'Kopieer DDO HTML';

    sparkle.addEventListener('click', () => {
      const thema         = getSpecValueById('thema');
      const merk          = getSpecValueById('brand');
      const artikelgroep  = getSpecValueById('item_group');
      const artikelnummer = getSpecValueById('item_number') || getSpecValueById('itemNumber');
      const adviesprijs   = getPrice(); // bv. "21,99"

      const h1        = getText('.spec__title h1') || '';
      const kleur     = getColorName();
      const colorCode = getColorCode();

      const p_ID = getPidFromUrl();
      const productCode = [artikelnummer, colorCode, p_ID].filter(Boolean).join('-');

// NIEUW (geen merk in titel)
const baseTitle = h1 || (artikelgroep || '');
const rawTitle = [thema, baseTitle, kleur].filter(Boolean).join(' ').trim();

      const title = capitalizeWords(rawTitle);
      const matrixHTML = extractStockMatrix();

      const html =
        `<!-- VANGENNIP EXPORT START -->\n` +
        `<div class="pdp-details">\n` +
        `  <h1 class="pdp-details_heading">${title}</h1>\n` +
        `  <div class="pdp-details_price">\n` +
        `    <span class="pdp-details_price__offer">€ ${adviesprijs}</span>\n` +
        `  </div>\n` +
        `  <div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>\n` +
        `  <div class="pdp-details_model">Model: <span>${thema}</span></div>\n` +
        `  <a href="#" style="display:none;">extern</a>\n` +
        `${matrixHTML}\n` +
        `</div>\n` +
        `<!-- VANGENNIP EXPORT END -->`;

      navigator.clipboard.writeText(html).then(() => {
        console.log(`✅ Geëxporteerd: ${title}`);
      }).catch((err) => {
        console.error('❌ Fout bij kopiëren:', err);
      });
    });

    return sparkle;
  }

  function insertSparkleButton() {
    if (document.querySelector('.copy-sparkle')) return; // voorkom duplicaten
    const header = findArtikelinformatieHeader();
    if (!header) return;
    header.insertAdjacentElement('afterend', buildSparkle());
  }

  /*** Init ***/
  const observer = new MutationObserver(() => insertSparkleButton());
  observer.observe(document.body, { childList: true, subtree: true });
  insertSparkleButton();
})();
