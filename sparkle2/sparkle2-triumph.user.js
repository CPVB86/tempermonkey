// ==UserScript==
// @name         Sparkle 2 | Triumph
// @version      2.2
// @description  Klik op de kleur-swatch om SPARKLE export te kopiëren die direct compatible is met Sparkle 2 | DDO.
// @match        https://b2b.triumph.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-triumph.user.js
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Sparkle | Triumph] script geladen (v2.2)');

  const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const capitalizeWords = (str = '') =>
    str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  function getBrandName() {
    const rowNameEl = document.querySelector('.product-row__name');
    const pageTitleEl = document.querySelector('h1, .product-details-information__title');
    const source = (rowNameEl?.textContent || pageTitleEl?.textContent || '').trim();

    if (/^sloggi\s+men\b/i.test(source)) return 'Sloggi Men';
    if (/^sloggi\b/i.test(source)) return 'Sloggi';
    if (/^triumph\b/i.test(source)) return 'Triumph';
    return 'Triumph';
  }

  function stripBrandPrefix(str = '') {
    return String(str)
      .trim()
      .replace(/^sloggi\s+men\s+/i, '')
      .replace(/^sloggi\s+/i, '')
      .replace(/^triumph\s+/i, '')
      .trim();
  }

  function getCompositionUrl() {
    return location.origin + location.pathname;
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
    const colorCode = (parts[1] || '').trim();
    const rawColor = (parts[2] || '').trim();
    const colorName = rawColor ? capitalizeWords(rawColor.toLowerCase()) : '';

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

        return (regularEl.textContent || '').trim();
      }
    }
    return '';
  }

  // ─────────────────────────────────────────────
  // Productinformatie
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
        const value = (valueEl.textContent || '').trim();

        if (title.includes('samenvatting')) {
          result.summary = value;
        } else if (title.includes('materiaal')) {
          result.material = value;
        } else if (title.includes('beschrijving')) {
          result.model = stripBrandPrefix(value);
        }
      });
    }

    const rowNameEl = document.querySelector('.product-row__name');
    if (rowNameEl) {
      const name = stripBrandPrefix((rowNameEl.textContent || '').trim());
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
      const left = (parts[0] || '').trim();
      const right = (parts[1] || '').trim();
      if (left && right) return `${left}-${right}`;
    }

    return raw.replace(/\s+/g, '');
  }

  function buildDescriptionHtml(summary, material) {
    const parts = [];

    if (summary) {
      parts.push(`<p>${escapeHtml(summary).replace(/\r?\n/g, '<br>')}</p>`);
    }

    if (material) {
      parts.push(`<p>Materiaal: ${escapeHtml(material)}</p>`);
    }

    return parts.join('\n').trim();
  }

  function buildDescriptionText(summary, material) {
    const parts = [];

    if (summary) parts.push(summary.trim());
    if (material) parts.push(`Materiaal: ${material.trim()}`);

    return parts.join('\n\n').trim();
  }

  // ─────────────────────────────────────────────
  // SPARKLE payload bouwen voor DDO-reader
  // ─────────────────────────────────────────────
  function buildSparkleComment({
    productCode,
    summary,
    material,
    model,
    colorName,
    price,
    fromGrid,
    swatchLabel,
    rowName
  }) {
    let displayColor = colorName || '';
    if (fromGrid && swatchLabel) {
      displayColor = capitalizeWords(String(swatchLabel).toLowerCase());
    }

    let modelForHeading = model || '';
    if (fromGrid && rowName) {
      modelForHeading = stripBrandPrefix(rowName);
    }

    const brandName = getBrandName();

    const nameParts = [];
    if (modelForHeading) nameParts.push(modelForHeading);
    if (displayColor) nameParts.push(displayColor);

    const supplierTitle = nameParts.join(' ').trim();
    const descriptionHtml = buildDescriptionHtml(summary, material);
    const descriptionText = buildDescriptionText(summary, material);

    const payload = {
      name: supplierTitle || '',
      title: supplierTitle || '',
      rrp: String(price || ''),
      price: '',
      productCode: String(productCode || ''),
      modelName: modelForHeading || '',
      descriptionHtml: descriptionHtml || '',
      descriptionText: descriptionText || '',
      compositionUrl: getCompositionUrl(),
      reference: '[ext]',
      supplierId: String(productCode || ''),
      brand: brandName
    };

    return `<!--SPARKLE:${JSON.stringify(payload)}-->`;
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

    if (!fromGrid || !productCode) {
      productCode = (styleNumber && colorCode)
        ? `${styleNumber}-${colorCode}`
        : (styleNumber || colorCode || '');
    }

    const out = buildSparkleComment({
      productCode,
      summary: info.summary,
      material: info.material,
      model: info.model,
      colorName,
      price,
      fromGrid,
      swatchLabel,
      rowName
    });

    try {
      await navigator.clipboard.writeText(out);
      console.log(
        `[Sparkle | Triumph] Gekopieerd: ProductCode=${productCode} | Model=${info.model} | Color=${colorName} | Swatch="${swatchLabel}" | Price=${price} | fromGrid=${fromGrid}`
      );
    } catch (err) {
      console.error('[Sparkle | Triumph] Kopiëren mislukt:', err);
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
      sparkle.title = 'Klik om SPARKLE export voor deze kleur te kopiëren';
      sparkle.addEventListener('click', onSparkleClick);

      label.insertBefore(sparkle, label.firstChild);
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
