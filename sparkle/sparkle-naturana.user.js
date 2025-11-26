// ==UserScript==
// @name         Sparkle | Naturana
// @version      1.0
// @description  Klikbare ✨ bij het prijsblok om HTML voor DDO te genereren (Naturana)
// @match        https://*/naturana/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-naturana.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Helpers ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const txt = (sel, root = document) => $(sel, root)?.textContent.trim() || '';

  // Veiliger selecteren met starts/ends-with zodat index (_0) geen probleem is
  const byIdLike = (starts, ends) =>
    document.querySelector(`[id^="${starts}"][id$="${ends}"]`);

  const capWords = (s) =>
    s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

  function parsePriceToEuro(str) {
    // '54,95 ' -> '54.95'
    return (str || '').replace(/[^\d.,]/g, '').replace(',', '.').trim();
  }

  // Voorraad op basis van kleurcode / tekst
  function availabilityToStock(card) {
    // 1) Probeer kleurcode (custom property / hidden input)
    let color = '';

    const colorInput = card.querySelector('input[id*="hdfColorCode"]');
    if (colorInput && colorInput.value) {
      color = colorInput.value.trim().toLowerCase();
    } else {
      // fallback: probeer inline style op amount input
      const amount = card.querySelector('.gridAmount');
      const styleAttr = amount?.getAttribute('style') || '';
      const match = styleAttr.match(/--availability-color:\s*([^;]+)/i);
      if (match) {
        color = match[1].trim().toLowerCase();
      }
    }

    if (color) {
      // Legend op Naturana:
      // #2AE849  -> SOFORT
      // #E8B41E  -> RESTBESTÄNDE
      // #1e6ae8  -> MIT LIEFERZEIT
      // #E84D6E  -> AUSVERKAUFT
      if (color === '#2ae849') return 2; // direct leverbaar
      if (color === '#e8b41e') return 1; // restbestände
      if (color === '#1e6ae8') return 1; // met levertijd
      if (color === '#e84d6e') return 0; // uitverkocht
    }

    // 2) Extra fallback op basis van evt. tekst "Bestand X"
    const availTxt = txt('.gridAvailTxt', card);
    const n = Number(String(availTxt).match(/\d+/)?.[0] || 0);
    if (n >= 50) return 2;
    if (n >= 1) return 1;
    return 0;
  }

  function buildMatrix() {
    // Elk size-card is een div[id*="_divOID_"] binnen .color-size-grid
    const cards = $$('.color-size-grid > div[id*="_divOID_"]');

    const rows = [];
    for (const card of cards) {
      const size = txt('.gridSize', card);
      const stock = availabilityToStock(card);
      if (!size || stock === 0) continue;
      rows.push(`<tr><td>${size}</td><td></td><td>${stock}</td></tr>`);
    }

    if (!rows.length) return '';

    return `<div class="pdp-details_matrix"><table>${rows.join('')}</table></div>`;
  }

  function getData() {
    // ArticleNo & ColorNr & ColorName
    const articleNo = byIdLike(
      'cphContent_cphMain_repArticle_wpArticle_',
      '_lblArticleNo_0'
    )?.textContent.trim() || '';

    const colorNr = byIdLike(
      'cphContent_cphMain_repArticle_wpArticle_',
      '_lblColorNr_0'
    )?.textContent.trim() || '';

    const colorName = byIdLike(
      'cphContent_cphMain_repArticle_wpArticle_',
      '_lblColorName_0'
    )?.textContent.trim() || '';

    // Type & Model (zelfde opbouw als HOM)
    const type = byIdLike(
      'cphContent_cphMain_repArticle_wpArticle_',
      '_repDescriptions_0_lblDescValue_0'
    )?.textContent.trim() || '';

    const model = byIdLike(
      'cphContent_cphMain_repArticle_wpArticle_',
      '_repDescriptions_0_lblDescValue_1'
    )?.textContent.trim() || '';

    // RRP: pak eerste UVP in de grid
    const rrpRaw = $('.gridUvp')?.textContent || '';
    const rrp = parsePriceToEuro(rrpRaw);

    // Product title: "$modelnaam $type $kleurnaam"
    const title = capWords(`${model} ${type} ${colorName}`.trim());

    // Supplier/Product code: "ArticleNo-ColorNr"
    const productCode = [articleNo, colorNr].filter(Boolean).join('-');

    return { articleNo, colorNr, colorName, type, model, rrp, title, productCode };
  }

  function buildHTML() {
    const { model, rrp, title, productCode } = getData();
    const matrixHTML = buildMatrix();

    return [
      '<!-- NATURANA EXPORT START -->',
      '<div class="pdp-details">',
      `  <h1 class="pdp-details_heading">${title}</h1>`,
      '  <div class="pdp-details_price">',
      `    <span class="pdp-details_price__offer">€ ${rrp}</span>`,
      '  </div>',
      `  <div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>`,
      `  <div class="pdp-details_model">Model: <span>${model}</span></div>`,
      '  <a href="#" style="display:none;">extern</a>',
      matrixHTML,
      '</div>',
      '<!-- NATURANA EXPORT END -->'
    ].join('\n');
  }

  function insertSparkle() {
    // Plaats ✨ bij eerste UVP-blok
    const priceContainer =
      $('.oidvk') || $('.color-size-grid');

    if (!priceContainer || $('.copy-sparkle-naturana')) return;

    const sparkle = document.createElement('span');
    sparkle.textContent = ' ✨';
    sparkle.className = 'copy-sparkle-naturana';
    sparkle.style.cursor = 'pointer';
    sparkle.style.color = '#0073aa';
    sparkle.style.fontSize = '14px';

    sparkle.addEventListener('click', () => {
      const html = buildHTML();
      navigator.clipboard.writeText(html).then(() => {
        console.log('✅ Naturana Sparkle geëxporteerd.');
      }).catch(err => {
        console.error('❌ Fout bij kopiëren:', err);
      });
    });

    priceContainer.appendChild(sparkle);
  }

  const obs = new MutationObserver(() => insertSparkle());
  obs.observe(document.body, { childList: true, subtree: true });
  insertSparkle();
})();
