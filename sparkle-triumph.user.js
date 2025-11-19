// ==UserScript==
// @name         Sparkle | Triumph
// @version      0.6
// @description  Klik op de kleur-swatch om DDO-HTML te kopiëren (RSP-prijs, Product Code, samenvatting, materiaal, model).
// @match        https://b2b.triumph.com/products/NL_TriumphPROD/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle-triumph.user.js
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Sparkle | Triumph] script geladen');

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

  // ─────────────────────────────────────────────
  // Style + kleurcode + kleurnaam uit description:
  // 10004928 - 0026 - SKIN
  // ─────────────────────────────────────────────
  function getStyleColorInfo() {
    const p = document.querySelector('.product-details-information__description');
    if (!p) {
      return { styleNumber: '', colorCode: '', colorName: '' };
    }

    const txt = (p.textContent || '').trim();
    if (!txt) {
      return { styleNumber: '', colorCode: '', colorName: '' };
    }

    const parts = txt.split(/\s*-\s*/); // [ '10004928', '0026', 'SKIN' ]
    const styleNumber = (parts[0] || '').trim();
    const colorCode   = (parts[1] || '').trim();
    const rawColor    = (parts[2] || '').trim();

    const colorName = capitalizeWords(rawColor.toLowerCase());

    return { styleNumber, colorCode, colorName };
  }

  // ─────────────────────────────────────────────
  // RSP-prijs pakken UIT HET JUISTE BLOK
  // ─────────────────────────────────────────────
  function getPrice() {
    const wrapper = document.querySelector('.product-details-information__prices');
    if (!wrapper) return '';

    const priceBlocks = $$('.product-price', wrapper);
    for (const block of priceBlocks) {
      const labelEl = block.querySelector('.product-price__item.label');
      if (!labelEl) continue;

      const labelText = (labelEl.textContent || '').trim().toUpperCase();
      if (labelText === 'RSP') {
        const regularEl = block.querySelector('.product-price__item.regular');
        if (!regularEl) continue;
        const txt = (regularEl.textContent || '').trim();
        return txt; // "62.95"
      }
    }

    return '';
  }

  // ─────────────────────────────────────────────
  // Productinformatie (samenvatting, materiaal, model)
  // ─────────────────────────────────────────────
  function getProductInfo() {
    const result = {
      summary: '',
      material: '',
      model: ''
    };

    const section = document.querySelector(
      'section.product-details-information__section.productinformatie'
    );
    if (!section) {
      return result;
    }

    const fields = $$('.product-details-extra-field', section);

    fields.forEach(field => {
      const titleEl = field.querySelector('.product-details-extra-field__title');
      const valueEl = field.querySelector('.product-details-extra-field__value');
      if (!titleEl || !valueEl) return;

      const title = (titleEl.textContent || '').trim().toLowerCase();

      if (title.includes('samenvatting')) {
        const txt = (valueEl.textContent || '').trim();
        result.summary = txt;
      } else if (title.includes('materiaal')) {
        const txt = (valueEl.textContent || '').trim();
        result.material = txt;
      } else if (title.includes('beschrijving')) {
        const txt = (valueEl.textContent || '').trim();
        result.model = txt;
      }
    });

    return result;
  }

  // ─────────────────────────────────────────────
  // DDO-HTML bouwen (Zetex-achtige structuur)
  // - Titel:
  //   - hoofd-swatch: Model + colorName (uit description)
  //   - grid-swatch:  Model + kleur uit swatch-label (SKIN → Skin)
  // ─────────────────────────────────────────────
  function buildDDOHtmlTriumph({
    productCode,
    summary,
    material,
    model,
    colorName,
    price,
    fromGrid,
    swatchLabel
  }) {
    const safeModel       = escapeHtml(model || '');
    const safeProductCode = escapeHtml(productCode || '');
    const safePrice       = escapeHtml(price || '');

    // Kleur bepalen voor heading
    let displayColor = colorName || '';
    if (fromGrid && swatchLabel) {
      displayColor = capitalizeWords((swatchLabel || '').toLowerCase());
    }
    const safeDisplayColor = escapeHtml(displayColor || '');

    const summaryEscaped  = escapeHtml(summary || '').replace(/\r?\n/g, '<br>');
    const materialEscaped = escapeHtml(material || '');

    const descriptionHtmlParts = [];
    if (summaryEscaped) {
      descriptionHtmlParts.push(`<p>${summaryEscaped}</p>`);
    }
    if (materialEscaped) {
      descriptionHtmlParts.push(`<p>Materiaal: ${materialEscaped}</p>`);
    }
    const descriptionHtml = descriptionHtmlParts.join('\n    ');

    const h1Parts = [];
    if (safeModel)        h1Parts.push(safeModel);
    if (safeDisplayColor) h1Parts.push(safeDisplayColor);
    const heading = h1Parts.join(' ');

    const modelHtml = safeModel
      ? `  <div class="pdp-details_model">Model: <span>${safeModel}</span></div>\n`
      : '';

    const codeHtml = safeProductCode
      ? `  <div class="pdp-details_product-code">Product Code: <span>${safeProductCode}</span></div>\n`
      : '';

    const priceHtml = safePrice
      ? `  <div class="pdp-details_price">\n    <span class="pdp-details_price__offer">€ ${safePrice}</span>\n  </div>\n`
      : '';

    return (
`<!-- TRIUMPH EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${heading}</h1>
${priceHtml}${modelHtml}${codeHtml}  <div class="pdp-details_description">
    ${descriptionHtml}
  </div>
  <a href="#" style="display:none;">extern</a>
</div>
<!-- TRIUMPH EXPORT END -->`
    );
  }

  // ─────────────────────────────────────────────
  // Click op ✨ bij de kleur-swatch
  // ─────────────────────────────────────────────
  async function onSparkleClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const sparkle = ev.currentTarget;
    const label = sparkle.closest('.product-swatch__label');
    const button = label?.closest('button.product-swatch');
    if (!button) return;

    // Swatch-labeltekst (zonder ✨)
    let swatchLabel = '';
    if (label) {
      swatchLabel = (label.textContent || '').replace('✨', '').trim();
    }

    const fromGrid = button.classList.contains('product-row__swatch');

    const { styleNumber, colorCode, colorName } = getStyleColorInfo();
    const info  = getProductInfo();
    const price = getPrice();

    // ProductCode = 10004928-0026
    const productCode = (styleNumber && colorCode)
      ? `${styleNumber}-${colorCode}`
      : (styleNumber || colorCode || '');

    const html = buildDDOHtmlTriumph({
      productCode,
      summary: info.summary,
      material: info.material,
      model: info.model,
      colorName,
      price,
      fromGrid,
      swatchLabel
    });

    try {
      await navigator.clipboard.writeText(html);
      console.log(
        `[Sparkle | Triumph] Gekopieerd: ProductCode=${productCode} | Model=${info.model} | Color=${colorName} | Swatch="${swatchLabel}" | Price=${price} | fromGrid=${fromGrid}`
      );
    } catch (err) {
      console.error('[Sparkle | Triumph] Kopiëren mislukt:', err);
      alert('Kon niet naar klembord kopiëren. Sta toegang tot het klembord toe.');
    }
  }

  // ─────────────────────────────────────────────
  // ✨ bij de kleur-swatch plaatsen
  // ─────────────────────────────────────────────
  function decorateSwatches() {
    const buttons = $$('.product-swatch');
    if (!buttons.length) return;

    buttons.forEach(btn => {
      if (btn.dataset.sparkleReady === '1') return;

      const label = btn.querySelector('.product-swatch__label');
      if (!label) return;

      const sparkle = document.createElement('span');
      sparkle.textContent = ' ✨';
      sparkle.style.cursor = 'pointer';
      sparkle.title = 'Klik om DDO-HTML voor deze kleur te kopiëren';
      sparkle.addEventListener('click', onSparkleClick);

      label.appendChild(sparkle);
      btn.dataset.sparkleReady = '1';
    });

    console.log(`[Sparkle | Triumph] sparkle geactiveerd op ${buttons.length} kleur-swatch(es)`);
  }

  function init() {
    decorateSwatches();

    const mo = new MutationObserver(() => {
      decorateSwatches();
    });

    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
