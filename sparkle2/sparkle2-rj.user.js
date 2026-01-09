// ==UserScript==
// @name         Sparkle 2 | RJ Bodywear
// @version      0.5
// @description  Genereert per kleur (of single color) een SPARKLE payload voor Sparkle 2 | DDO importscript.
// @match        https://b2b.rjbodywear.com/*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle-rj.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle-rj.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- Kleine helpers ------------------------------------------------------

  // Stock uitlezen uit een single-attribute size tabel (geen kleuren)
  function getStockForSingleColorTable() {
    const res = {};
    const rows = document.querySelectorAll('tbody.swatch-attribute.size tr.swatch-attribute-options');
    if (!rows.length) return res;

    rows.forEach(row => {
      const sizeEl = row.querySelector('.swatch-option.text');
      const qtyCell = row.querySelector('td.pmt-quantity');
      if (!sizeEl || !qtyCell) return;

      const sizeLabel = (sizeEl.getAttribute('data-option-label') || sizeEl.textContent || '').trim();
      const stockEl = qtyCell.querySelector('.pmt-stock-status');
      if (!stockEl) return;

      const stock = parseInt(stockEl.textContent.trim(), 10);
      if (!isNaN(stock)) {
        res[sizeLabel] = stock; // bv. { S: 15, M: 21, ... }
      }
    });

    return res;
  }

  function addButtonSingleColor() {
    ensureStyles();

    // container met de maattabel
    const optContainer = document.querySelector('.relative.mb-6 .swatch-opt') ||
                         document.querySelector('.swatch-opt');
    if (!optContainer) {
      console.log('Sparkle RJ: geen swatch-opt container gevonden voor single-color.');
      return;
    }

    // dubbel voorkomen
    if (optContainer.querySelector('.sparkle-rj-btn-single')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sparkle-rj-btn sparkle-rj-btn-single';
    btn.textContent = '✨ Sparkle';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // single-color: kleur uit data-th="Kleur", zonder kleurcode in de naam
      const rawColor = getCellText('Kleur');         // bv. "Black 007"
      const colorInfo = parseColorLabel(rawColor);  // → { name: "Black", code: "007" }

      const payload = buildSparklePayloadForColor(colorInfo);
      const stockBySize = getStockForSingleColorTable();
      payload.stockBySize = stockBySize; // optioneel, maar lekker voor logging / toekomst

      const sparkleComment = buildSparkleComment(payload);

      console.clear();
      console.log('▶️ SPARKLE payload (single color):', payload);
      console.log('📦 Stock per maat (single color):', stockBySize);

      const ok = await copyToClipboard(sparkleComment);

      if (ok) {
        btn.classList.add('copied');
        btn.textContent = '✅ Gekopieerd';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = '✨ Sparkle';
        }, 1500);
      } else {
        btn.textContent = '⚠️ Kopieer handmatig (console)';
      }
    });

    // Plaats de knop net onder de "Product Opties" titel, of anders boven de tabel
    const title = optContainer.previousElementSibling;
    if (title && title.tagName === 'H2') {
      title.insertAdjacentElement('afterend', btn);
    } else {
      optContainer.insertAdjacentElement('beforebegin', btn);
    }

    console.log('Sparkle RJ: single-color Sparkle knop toegevoegd.');
  }

  function getCellText(thLabel) {
    const el = document.querySelector(`td[data-th="${thLabel}"]`);
    return el ? el.textContent.trim() : '';
  }

  function parseColorLabel(label) {
    const clean = (label || '').trim();
    // bv. "White 000" → name="White", code="000"
    const m = clean.match(/^(.*?)[\s-]*([0-9]{3})\s*$/);
    if (m) {
      return { name: m[1].trim(), code: m[2] };
    }
    return { name: clean, code: '' };
  }

  function toPriceString(numLike) {
    if (numLike == null) return '';
    const n = Number(numLike);
    if (!isFinite(n)) return '';
    return n.toFixed(2);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureStyles() {
    if (document.getElementById('sparkle-rj-style')) return;
    const style = document.createElement('style');
    style.id = 'sparkle-rj-style';
    style.textContent = `
      .sparkle-rj-btn {
        display:inline-flex;
        align-items:center;
        gap:4px;
        margin-top:4px;
        margin-left:4px;
        padding:2px 6px;
        font-size:11px;
        border-radius:4px;
        border:1px solid #d35400;
        background:#fff7f0;
        color:#d35400;
        cursor:pointer;
        user-select:none;
      }
      .sparkle-rj-btn:hover { background:#ffe1c7; }
      .sparkle-rj-btn.copied {
        border-color:#27ae60;
        color:#27ae60;
        background:#eafaf1;
      }
    `;
    document.head.appendChild(style);
  }

  // ---- RRP / Price uit AEC.CONFIGURABLE_SIMPLES ----------------------------

  function getRrpAndPriceForProduct() {
    try {
      const cfg = window.AEC?.CONFIGURABLE_SIMPLES;
      if (!cfg) return { rrp: '', price: '' };

      const simple = cfg[Object.keys(cfg)[0]];
      if (!simple) return { rrp: '', price: '' };

      const rrp = toPriceString(simple.price);

      let tierPrice = '';
      if (simple.price_tier) {
        const firstTier = Object.values(simple.price_tier)[0];
        if (firstTier?.price != null) tierPrice = toPriceString(firstTier.price);
      }

      return { rrp, price: tierPrice };
    } catch (err) {
      console.warn('Sparkle RJ: kon prijsdata niet lezen:', err);
      return { rrp: '', price: '' };
    }
  }

  // ---- Description uit de Omschrijving-tab --------------------------------

  function getDescriptionText() {
    const details = document.querySelector('#description');
    if (!details) return '';

    const container =
      details.querySelector('.prose') ||
      details.querySelector('[data-content-type="html"]') ||
      details;

    let text = container.textContent || '';

    return text
      .replace(/\r/g, '')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---- Stock helpers voor multi-color tabel --------------------------------

  // Map col-id → maatlabel (106 → "S", etc.)
  function getSizeMap() {
    const map = {};
    const headerRow = document.querySelector('thead.swatch-attribute.size tr.swatch-attribute-options');
    if (!headerRow) return map;

    const sizeCells = headerRow.querySelectorAll('th .swatch-option.text');
    sizeCells.forEach(cell => {
      const colId = cell.getAttribute('data-option-id'); // 106, 107, ...
      const label = (cell.getAttribute('data-option-label') || cell.textContent || '').trim();
      if (colId && label) map[colId] = label;
    });

    return map;
  }

  // Stock per maat uit één kleur-rij
  function getStockForRow(row) {
    const res = {};
    if (!row) return res;

    const sizeMap = getSizeMap();
    const cells = row.querySelectorAll('td.pmt-quantity');

    cells.forEach(td => {
      const colId = td.getAttribute('data-col-id'); // 106, 107, ...
      const sizeLabel = sizeMap[colId] || colId;
      const stockEl = td.querySelector('.pmt-stock-status');
      if (!stockEl) return;
      const stock = parseInt(stockEl.textContent.trim(), 10);
      if (!isNaN(stock)) {
        res[sizeLabel] = stock; // bv. { S: 37, M: 12, ... }
      }
    });

    return res;
  }

  // ---- SPARKLE payload builder --------------------------------------------

  function buildSparklePayloadForColor(colorInfo) {
    const collectie       = getCellText('Collectie');          // bv. "Allure"  → MODEL
    const shortProdName   = getCellText('Short Product Name'); // bv. "Washington"
    const soortArtikel    = getCellText('Soort artikel');      // bv. "Hemdje met brede..."
    const skuRaw          = getCellText('SKU');                // bv. "32-038-B2B"

    const { name: colorName, code: colorCode } = colorInfo;    // name zonder code, code = 3-cijferige kleurcode

    let productCode = skuRaw || '';
    if (productCode && colorCode) {
      const replaced = productCode.replace(/B2B\b/i, colorCode);
      productCode = (replaced === productCode)
        ? `${productCode}-${colorCode}`
        : replaced;
    }

    // Titelstring opbouw
    const parts = [collectie, shortProdName, soortArtikel, colorName].filter(Boolean);
    const fullName = parts.join(' ').trim();

    const { rrp, price } = getRrpAndPriceForProduct();
    const descriptionText = getDescriptionText();
    const compositionUrl = window.location.href.split('#')[0];
    const reference = '- [ext]';

    return {
      name: fullName,
      title: fullName,
      rrp,
      price,
      productCode,
      modelName: collectie,   // MODEL = Collectie
      descriptionText,
      compositionUrl,
      reference
    };
  }

  function buildSparkleComment(payload) {
    return `<!--SPARKLE:${JSON.stringify(payload, null, 2)}-->`;
  }

  // ---- UI: knoppen per swatch / fallback single color ---------------------

  function addButtonsToSwatches() {
    ensureStyles();

    // Multi-color: kleur-swatch aanwezig?
    const colorSwatches = document.querySelectorAll('.swatch-wrapper .swatch-option.color');
    if (colorSwatches.length) {
      colorSwatches.forEach(swatchOption => {
        const wrapper = swatchOption.closest('
