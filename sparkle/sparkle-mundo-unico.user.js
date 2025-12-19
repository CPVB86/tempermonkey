// ==UserScript==
// @name         Sparkle | Mundo Unico
// @version      1.0
// @description  Kopieer DDO-HTML (titel, model, prijs, Supplier ID, EAN, SKU) vanaf Colomoda Mundo Unico productpagina's.
// @match        https://www.colomoda.eu/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-colomoda-mundo-unico.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-colomoda-mundo-unico.user.js
// ==/UserScript==

(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (str = '') =>
    str
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const capitalizeWords = (str = '') =>
    str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  // ─────────────────────────────
  // Titel + model + prijs + specs
  // ─────────────────────────────

  function getRawTitle() {
    const h1 = $('h1.d-none.d-md-block');
    if (!h1) return '';
    return (h1.textContent || '').trim();
  }

  // Strip alle "Mundo Unico"/"Mundo unico" uit de titel
  function stripBrandFromTitle(raw) {
    if (!raw) return '';
    let t = raw.replace(/mundo\s+unico/gi, '').trim();
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  }
    const capitalizeFirst = (str = '') => {
  const s = (str || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
};


  // Model afleiden uit de titel (stuk vóór “boxers”, “brief”, etc.)
  function deriveModelFromTitle(strippedTitle) {
    if (!strippedTitle) return '';

    const lower = strippedTitle.toLowerCase();
    const markers = [
      ' boxershort',
      ' boxer short',
      ' boxers medio',
      ' boxers',
      ' boxer',
      ' briefs',
      ' brief',
      ' jockstrap',
      ' thong',
      ' tanga',
      ' microfiber',
      ' microfibre',
      ' cotton',
      ' leggings',
      ' t-shirt',
      ' tee',
      ' tank',
      ' swim',
      ' swimwear',
      ' slip'
    ];

    let idx = -1;
    for (const m of markers) {
      const i = lower.indexOf(m);
      if (i !== -1 && (idx === -1 || i < idx)) {
        idx = i;
      }
    }

    let base;
    if (idx !== -1) {
      base = strippedTitle.slice(0, idx).trim();
    } else {
      base = strippedTitle.split(/\s+/)[0] || '';
    }
    if (!base) return '';

    return capitalizeWords(base);
  }

  function getPriceText() {
    const el = $('.price-incl.bold') || $('.price-incl');
    if (!el) return '';
    const raw = (el.textContent || '').trim(); // bv. "€15,10"
    // alles behalve cijfers, punt en komma verwijderen
    const cleaned = raw.replace(/[^\d.,]/g, '');
    return cleaned;
  }

  function getSpecs() {
    const out = { articleNumber: '', ean: '', sku: '' };
    const holders = $$('.content-fold-overflow .spec-holder');

    holders.forEach(h => {
      const tEl = h.querySelector('.spec-title');
      const vEl = h.querySelector('.spec-value');
      if (!tEl || !vEl) return;

      const title = (tEl.textContent || '').trim().toLowerCase();
      const value = (vEl.textContent || '').trim();

      if (title.includes('article')) {
        out.articleNumber = value;
      } else if (title.includes('ean')) {
        out.ean = value;
      } else if (title.includes('sku')) {
        out.sku = value;
      }
    });

    return out;
  }

  // ─────────────────────────────
  // HTML opbouwen voor DDO
  // ─────────────────────────────

function buildDDOHtmlColomoda({ title, model, price, articleNumber, ean, sku }) {
  const safeTitle   = escapeHtml(title || '');
  const safeModel   = escapeHtml(model || '');
  const safePrice   = escapeHtml(price || '');
  const safeArt     = escapeHtml(articleNumber || '');
  const safeEan     = escapeHtml(ean || '');
  const safeSku     = escapeHtml(sku || '');

  const priceHtml = safePrice
    ? `  <div class="pdp-details_price">
    <span class="pdp-details_price__offer">€ ${safePrice}</span>
  </div>
`
    : '';

  const modelHtml = safeModel
    ? `  <div class="pdp-details_model">Model: <span>${safeModel}</span></div>
`
    : '';

  // 🔴 BELANGRIJK:
  // Label MOET "Product Code" bevatten, anders ziet Sparkle | DDO 'm niet.
  const articleHtml = safeArt
    ? `  <div class="pdp-details_product-code">Product Code: <span>${safeArt}</span></div>
`
    : '';

  const eanHtml = safeEan
    ? `  <div class="pdp-details_ean">EAN: <span>${safeEan}</span></div>
`
    : '';

  const skuHtml = safeSku
    ? `  <div class="pdp-details_sku">SKU: <span>${safeSku}</span></div>
`
    : '';

  // Productomschrijving bewust leeg
  const descriptionHtml = '';

  // 🔗 Verborgen link:
  // - zorgt dat reference " - [ext]" wordt (Sparkle | DDO ziet <a>)
  // - class="url" zorgt dat composition = externe URL wordt
  const url = location.href;

  return (
`<!-- COLOMODA EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${safeTitle}</h1>
${priceHtml}${modelHtml}${articleHtml}${eanHtml}${skuHtml}  <div class="pdp-details_description">
    ${descriptionHtml}
  </div>
  <a class="url" href="${escapeHtml(url)}" style="display:none;">extern</a>
</div>
<!-- COLOMODA EXPORT END -->`
  );
}


  // ─────────────────────────────
  // Sparkle knop + actie
  // ─────────────────────────────

  function createSparkleButton() {
    if (document.getElementById('sparkle-colomoda-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'sparkle-colomoda-btn';
    btn.type = 'button';
    btn.textContent = '✨ Sparkle | Mundo Unico';
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 10px;
      z-index: 999999;
      padding: 8px 10px;
      background: #152e4f;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
      font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    btn.addEventListener('click', onSparkleClick);
    document.body.appendChild(btn);
  }

  async function onSparkleClick(ev) {
    ev.preventDefault();

    const btn = ev.currentTarget;
    const originalText = btn.textContent;

    try {
      const rawTitle = getRawTitle();
      if (!rawTitle || !/mundo\s+unico/i.test(rawTitle)) {
        console.warn('[Sparkle | Colomoda] Geen Mundo Unico titel gevonden, abort.');
        return;
      }

      const strippedTitle = capitalizeFirst(stripBrandFromTitle(rawTitle));
      const model         = deriveModelFromTitle(strippedTitle);
      const price         = getPriceText();
      const specs         = getSpecs();

      const html = buildDDOHtmlColomoda({
        title: strippedTitle || rawTitle,
        model,
        price,
        articleNumber: specs.articleNumber,
        ean: specs.ean,
        sku: specs.sku
      });

      await navigator.clipboard.writeText(html);

      console.log('[Sparkle | Colomoda] Gekopieerd naar klembord:', {
        title: strippedTitle || rawTitle,
        model,
        price,
        articleNumber: specs.articleNumber,
        ean: specs.ean,
        sku: specs.sku
      });

      btn.textContent = '✅ Gekopieerd!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);

    } catch (err) {
      console.error('[Sparkle | Colomoda] Kopiëren mislukt:', err);
      // geen alerts/prompt, alleen console
      btn.textContent = '⚠️ Kopieerfout';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  }

  // ─────────────────────────────
  // Init
  // ─────────────────────────────

  function init() {
    const rawTitle = getRawTitle();
    if (!rawTitle) return;
    if (!/mundo\s+unico/i.test(rawTitle)) {
      // alleen actief maken op Mundo Unico-producten
      return;
    }
    createSparkleButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
