// ==UserScript==
// @name         Sparkle | Zetex
// @version      1.5
// @description  Klik op de kleurnaam om DDO-HTML te kopiëren (titel, prijs, UNIQUEID-COLORCODE).
// @match        https://b2b.zetex.nl/webstore/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-zetex.user.js
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Sparkle | Zetex] script geladen');

  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));

  const capitalizeWords = (str = '') =>
    str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const escapeHtml = (str = '') =>
    str
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // ─────────────────────────────────────────────
  // Model uit breadcrumb halen (Women / Men / Kids)
  // Geeft 'dames' / 'heren' / 'kids' terug (lowercase)
  // ─────────────────────────────────────────────
  function getModelFromBreadcrumb() {
    const crumbs = $$('.breadcrumb li a');
    if (!crumbs.length) return '';

    const last = crumbs[crumbs.length - 1];
    const raw = (last.textContent || '').trim();
    if (!raw) return '';

    const txt = raw.toLowerCase();

    if (txt.includes('women') || txt.includes('woman')) return 'dames';
    if (txt.includes('men') || txt.includes('man')) return 'heren';
    if (/(kids|children|boys|girls)/i.test(raw)) return 'kids';

    return raw.toLowerCase();
  }

  // ─────────────────────────────────────────────
  // overflow:hidden op .stock_level uitschakelen
  // ─────────────────────────────────────────────
  function fixStockLevelOverflow() {
    const id = 'sparkle-zetex-stock-overflow-fix';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .stock_level {
        overflow: visible !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[Sparkle | Zetex] .stock_level overflow fix toegepast');
  }

  function buildDDOHtml({ title, price, productCode, model }) {
    const modelHtml = model
      ? `\n  <div class="pdp-details_model">Model: <span>${escapeHtml(model)}</span></div>`
      : '';

    return (
`<!-- ZETEX EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${escapeHtml(title)} ${escapeHtml(productCode)}</h1>
  <div class="pdp-details_price">
    <span class="pdp-details_price__offer">€ ${escapeHtml(price)}</span>
  </div>${modelHtml}
  <div class="pdp-details_product-code">Product Code: <span>${escapeHtml(productCode)}</span></div>
  <a href="#" style="display:none;">extern</a>
</div>
<!-- ZETEX EXPORT END -->`
    );
  }

  async function onColorClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const colorSpan = ev.currentTarget;
    const article   = colorSpan.closest('article.product-wrap');
    if (!article) return;

    const nameEl  = article.querySelector('.product--name');
    const idEl    = article.querySelector('.product--unique-id');
    const priceEl = article.querySelector('.og_color-prices .a4f-retail_price');

    const rawName  = (nameEl?.textContent || '').trim();
    const rawColor = (colorSpan.textContent || '').replace('✨', '').trim();
    const uniqueId = (idEl?.textContent || '').trim();
    const rawPrice = (priceEl?.textContent || '').trim();

    let colorCode = '';
    let colorName = '';

    const m = rawColor.match(/^(\S+)\s*-\s*(.+)$/);
    if (m) {
      colorCode = m[1];   // 519
      colorName = m[2];   // blue
    } else {
      colorName = rawColor;
    }

    // model als 'dames' / 'heren' (voor model-div)
    const modelRaw = getModelFromBreadcrumb();

    // Voor in de title: hoofdletter (Dames / Heren)
    const modelForTitle = modelRaw ? capitalizeWords(modelRaw) : '';

    // Titel: MODEL vooraan, dan naam, dan kleur
    const titleParts = [];
    if (modelForTitle) titleParts.push(modelForTitle);
    if (rawName)       titleParts.push(rawName);
    if (colorName)     titleParts.push(capitalizeWords(colorName));

    const title = titleParts.join(' ').trim();

    const productCode = (uniqueId && colorCode)
      ? `${uniqueId}-${colorCode}`   // 23222-618-6-519
      : (uniqueId || colorCode || '');

    const html = buildDDOHtml({
      title,
      price: rawPrice,
      productCode,
      model: modelRaw // in de div blijft het lowercase: dames / heren
    });

    try {
      await navigator.clipboard.writeText(html);
      console.log(`✅ Gekopieerd (Zetex): ${title} | ${productCode} | € ${rawPrice} | model: ${modelRaw}`);
    } catch (err) {
      console.error('❌ Kopiëren mislukt:', err);
      alert('Kon niet naar klembord kopiëren. Sta toegang tot het klembord toe.');
    }
  }

  function decorateColors() {
    const colorSpans = $$('.product--color-code');
    if (!colorSpans.length) {
      console.log('[Sparkle | Zetex] geen .product--color-code gevonden');
      return;
    }

    colorSpans.forEach(span => {
      if (span.dataset.sparkleReady === '1') return;

      let txt = (span.textContent || '').trim();
      if (!txt) return;

      if (!txt.includes('✨')) {
        span.textContent = txt + ' ✨';
      }

      span.style.cursor = 'pointer';
      span.title = 'Klik om DDO-HTML voor deze kleur te kopiëren';
      span.addEventListener('click', onColorClick);

      span.dataset.sparkleReady = '1';
    });

    console.log(`[Sparkle | Zetex] sparkle geactiveerd op ${colorSpans.length} kleurnamen`);
  }

  function init() {
    fixStockLevelOverflow();
    decorateColors();

    const mo = new MutationObserver(() => {
      decorateColors();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    setTimeout(decorateColors, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
