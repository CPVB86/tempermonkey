// ==UserScript==
// @name         Sparkle | Sapph
// @version      1.0
// @description  Klik op de kleur-swatch om SPARKLE v2 comment te kopiëren (RRP-prijs, Product Code, samenvatting, materiaal, model).
// @match        https://sapph.prod.webstore.colect.io/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2.sapph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2.sapph.user.js
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Sparkle | Sapph] script geladen (v1)');

  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

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

  function stripBrandPrefix(str = '') {
    return str
      .replace(/^sloggi\s+men\s+/i, '')
      .replace(/^sloggi\s+/i, '')
      .replace(/^triumph\s+/i, '')
      .replace(/^sapph\s+/i, '');
  }

  function getCleanCompositionUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('inStock');
      return url.toString();
    } catch (err) {
      return window.location.href.replace(/[?&]inStock=true\b/, '').replace(/\?$/, '');
    }
  }

  // ─────────────────────────────────────────────
  // Style + kleurcode + kleurnaam uit description:
  // 10004928 - 0026 - SKIN
  // ─────────────────────────────────────────────
  function getStyleColorInfo() {
    const p = document.querySelector('.product-details-information__description');
    if (!p) return { styleNumber: '', colorCode: '', colorName: '' };

    const txt = (p.textContent || '').trim();
    if (!txt) return { styleNumber: '', colorCode: '', colorName: '' };

    const parts = txt.split(/\s*-\s*/);
    const styleNumber = (parts[0] || '').trim();
    const colorCode   = (parts[1] || '').trim();
    const rawColor    = (parts[2] || '').trim();

    const colorName = capitalizeWords(rawColor.toLowerCase());

    return { styleNumber, colorCode, colorName };
  }

  // ─────────────────────────────────────────────
  // RRP-prijs zoeken
  // Werkt zowel voor Triumph-achtige blokken als de Sapph-HTML die je stuurde
  // ─────────────────────────────────────────────
  function getPrice() {
    const priceBlocks = $$('.product-price');
    if (!priceBlocks.length) return '';

    for (const block of priceBlocks) {
      const labelEl = block.querySelector('.product-price__item.label');
      const regularEl = block.querySelector('.product-price__item.regular');

      if (!labelEl || !regularEl) continue;

      const labelText = (labelEl.textContent || '').trim().toUpperCase();
      if (labelText === 'RRP') {
        return (regularEl.textContent || '').trim();
      }
    }

    return '';
  }

  // ─────────────────────────────────────────────
  // Productinformatie (samenvatting, materiaal, model)
  // ─────────────────────────────────────────────
  function getProductInfo() {
    const result = { summary: '', material: '', model: '' };

    const section = document.querySelector(
      'section.product-details-information__section.productinformatie'
    );

    if (section) {
      const fields = $$('.product-details-extra-field', section);

      fields.forEach(field => {
        const titleEl = field.querySelector('.product-details-extra-field__title');
        const valueEl = field.querySelector('.product-details-extra-field__value');
        if (!titleEl || !valueEl) return;

        const title = (titleEl.textContent || '').trim().toLowerCase();

        if (title.includes('samenvatting')) {
          result.summary = (valueEl.textContent || '').trim();
        } else if (title.includes('materiaal')) {
          result.material = (valueEl.textContent || '').trim();
        } else if (title.includes('beschrijving')) {
          let txt = (valueEl.textContent || '').trim();
          txt = stripBrandPrefix(txt);
          result.model = txt;
        }
      });
    }

    // Override model met product-row__name als die bestaat
    const rowNameEl = document.querySelector('.product-row__name');
    if (rowNameEl) {
      let name = (rowNameEl.textContent || '').trim();
      name = stripBrandPrefix(name);
      if (name) result.model = name;
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // Productcode uit grid-rij:
  // "10151218 - 0003" → "10151218-0003"
  // ─────────────────────────────────────────────
  function getProductCodeFromRow(row) {
    if (!row) return '';
    const idEl = row.querySelector('.product-row__id');
    if (!idEl) return '';

    const raw = (idEl.textContent || '').trim();
    if (!raw) return '';

    const parts = raw.split('-');
    if (parts.length >= 2) {
      const left  = (parts[0] || '').trim();
      const right = (parts[1] || '').trim();
      if (left && right) return `${left}-${right}`;
    }

    return raw.replace(/\s+/g, '');
  }

  // ─────────────────────────────────────────────
  // SPARKLE v2 comment bouwen
  // Output: <!--SPARKLE:{...}-->
  // ─────────────────────────────────────────────
  function buildSparkleV2Comment({
    productCode,
    summary,
    material,
    model,
    colorName,
    price,
    fromGrid,
    swatchLabel,
    rowName,
    compositionUrl
  }) {
    let displayColor = colorName || '';
    if (fromGrid && swatchLabel) {
      displayColor = capitalizeWords((swatchLabel || '').toLowerCase());
    }

    let modelForHeading = model || '';
    if (fromGrid && rowName) {
      let cleaned = rowName.trim();
      cleaned = stripBrandPrefix(cleaned);
      modelForHeading = cleaned;
    }

    const nameParts = [];
    if (modelForHeading) nameParts.push(modelForHeading);
    if (displayColor) nameParts.push(displayColor);
    const name = nameParts.join(' ').trim();

    const summaryEscaped  = escapeHtml(summary || '').replace(/\r?\n/g, '<br>');
    const materialEscaped = escapeHtml(material || '');

    const descriptionHtmlParts = [];
    if (summaryEscaped) descriptionHtmlParts.push(`<p>${summaryEscaped}</p>`);
    if (materialEscaped) descriptionHtmlParts.push(`<p>Materiaal: ${materialEscaped}</p>`);
    const descriptionHtml = descriptionHtmlParts.join('\n');

    const modelName = (modelForHeading || '').trim();

    const payload = {
      name: name || '',
      rrp: (price || '').toString(),
      productCode: (productCode || '').toString(),
      modelName: modelName || '',
      descriptionHtml: descriptionHtml || '',
      compositionUrl: (compositionUrl || '').toString(),
      reference: ' - [ext]',
      supplierId: (productCode || '').toString()
    };

    const json = JSON.stringify(payload);
    return `<!--SPARKLE:${json}-->`;
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

    let swatchLabel = '';
    if (label) swatchLabel = (label.textContent || '').replace('✨', '').trim();

    const fromGrid = button.classList.contains('product-row__swatch');

    let rowName = '';
    let productCode = '';

    if (fromGrid) {
      const row = button.closest('.product-row');
      const nameEl = row?.querySelector('.product-row__name');
      if (nameEl) rowName = (nameEl.textContent || '').trim();
      productCode = getProductCodeFromRow(row);
    }

    const { styleNumber, colorCode, colorName } = getStyleColorInfo();
    const info = getProductInfo();
    const price = getPrice();
    const compositionUrl = getCleanCompositionUrl();

    if (!fromGrid || !productCode) {
      productCode = (styleNumber && colorCode)
        ? `${styleNumber}-${colorCode}`
        : (styleNumber || colorCode || '');
    }

    const out = buildSparkleV2Comment({
      productCode,
      summary: info.summary,
      material: info.material,
      model: info.model,
      colorName,
      price,
      fromGrid,
      swatchLabel,
      rowName,
      compositionUrl
    });

    try {
      await navigator.clipboard.writeText(out);
      console.log(
        `[Sparkle | Sapph] Gekopieerd(v2): ProductCode=${productCode} | Model=${info.model} | HeadingModel=${rowName || info.model} | Color=${colorName} | Swatch="${swatchLabel}" | Price=${price} | fromGrid=${fromGrid} | compositionUrl=${compositionUrl}`
      );
    } catch (err) {
      console.error('[Sparkle | Sapph] Kopiëren mislukt:', err);
      alert('Kon niet naar klembord kopiëren. Sta toegang tot het klembord toe.');
    }
  }

  // ─────────────────────────────────────────────
  // ✨ vóór de kleur-tekst plaatsen
  // ─────────────────────────────────────────────
  function decorateSwatches() {
    const buttons = $$('.product-swatch');
    if (!buttons.length) return;

    buttons.forEach(btn => {
      if (btn.dataset.sparkleReady === '1') return;

      const label = btn.querySelector('.product-swatch__label');
      if (!label) return;

      const sparkle = document.createElement('span');
      sparkle.textContent = '✨ ';
      sparkle.style.cursor = 'pointer';
      sparkle.title = 'Klik om SPARKLE v2 export voor deze kleur te kopiëren';
      sparkle.addEventListener('click', onSparkleClick);

      label.insertBefore(sparkle, label.firstChild);

      btn.dataset.sparkleReady = '1';
    });

    console.log(`[Sparkle | Sapph] sparkle geactiveerd op ${buttons.length} kleur-swatch(es)`);
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
