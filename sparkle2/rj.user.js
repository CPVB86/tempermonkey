// ==UserScript==
// @name         Sparkle 2 | RJ Bodywear
// @version      0.2
// @description  Genereert per kleur-swatch een SPARKLE payload voor Sparkle 2 | DDO importscript.
// @match        https://b2b.rjbodywear.com/*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle-rj.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle-rj.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- Kleine helpers ------------------------------------------------------

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
    // fallback: geen code gevonden
    return { name: clean, code: '' };
  }

  function toPriceString(numLike) {
    if (numLike == null) return '';
    const n = Number(numLike);
    if (!isFinite(n)) return '';
    return n.toFixed(2); // Sparkle normaliseert zelf ,/. → "." is prima
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall back */ }

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
        line-height:1.2;
        border-radius:4px;
        border:1px solid #d35400;
        background:#fff7f0;
        color:#d35400;
        cursor:pointer;
        user-select:none;
      }
      .sparkle-rj-btn:hover {
        background:#ffe1c7;
      }
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
      const cfg = window.AEC && window.AEC.CONFIGURABLE_SIMPLES;
      if (!cfg || typeof cfg !== 'object') return { rrp: '', price: '' };

      const firstKey = Object.keys(cfg)[0];
      const simple = cfg[firstKey];
      if (!simple) return { rrp: '', price: '' };

      const rrp = toPriceString(simple.price);

      let tierPrice = '';
      if (simple.price_tier && typeof simple.price_tier === 'object') {
        const firstTier = Object.values(simple.price_tier)[0];
        if (firstTier && firstTier.price != null) {
          tierPrice = toPriceString(firstTier.price);
        }
      }

      return { rrp, price: tierPrice };
    } catch (err) {
      console.warn('Sparkle RJ: kon RRP/price niet uit AEC.CONFIGURABLE_SIMPLES halen:', err);
      return { rrp: '', price: '' };
    }
  }

  // ---- Description uit de Omschrijving-tab --------------------------------

  function getDescriptionText() {
    const details = document.querySelector('#description');
    if (!details) return '';

    // Probeer eerst de “prose”-container of Magento content-block
    const container =
      details.querySelector('.prose') ||
      details.querySelector('[data-content-type="html"]') ||
      details;

    let text = container.textContent || '';
    // Beetje opschonen: spaties / lege regels
    text = text.replace(/\r/g, '')
               .replace(/\n[ \t]+/g, '\n')
               .replace(/\n{3,}/g, '\n\n')
               .trim();

    return text;
  }

  // ---- SPARKLE payload builder --------------------------------------------

  function buildSparklePayloadForColor(colorInfo) {
  const collectie       = getCellText('Collectie');          // bv. "Allure"  → DIT wordt model
  const shortProdName   = getCellText('Short Product Name'); // bv. "Washington"
  const soortArtikel    = getCellText('Soort artikel');      // bv. "Hemdje met brede schouderbandjes"
  const skuRaw          = getCellText('SKU');                // bv. "32-038-B2B"

  const { name: colorName, code: colorCode } = colorInfo;

  // ProductCode: vervang "B2B" → kleurcode (bv. 000)
  let productCode = skuRaw || '';
  if (productCode && colorCode) {
    const replaced = productCode.replace(/B2B\b/i, colorCode);
    productCode = (replaced === productCode)
      ? `${productCode}-${colorCode}`
      : replaced;
  }

  // Naam / titel: Collectie + Short Product Name + Soort artikel + Kleurnaam
  // → "Allure Washington Hemdje met brede schouderbandjes White"
  const parts = [collectie, shortProdName, soortArtikel, colorName].filter(Boolean);
  const fullName = parts.join(' ').trim();

  const { rrp, price } = getRrpAndPriceForProduct();
  const descriptionText = getDescriptionText();
  const compositionUrl = window.location.href.split('#')[0];
  const reference = '- [ext]';

  const payload = {
    name: fullName,
    title: fullName,
    rrp,
    price,
    productCode,
    modelName: collectie,
    descriptionText,
    compositionUrl,
    reference
  };

  return payload;
}

  function buildSparkleComment(payload) {
    const json = JSON.stringify(payload, null, 2);
    return `<!--SPARKLE:${json}-->`;
  }

  // ---- UI: knoppen per swatch ---------------------------------------------

  function addButtonsToSwatches() {
    ensureStyles();

    const wrappers = document.querySelectorAll('.swatch-wrapper');
    if (!wrappers.length) {
      console.log('Sparkle RJ: geen .swatch-wrapper gevonden (misschien andere template?).');
      return;
    }

    wrappers.forEach(wrapper => {
      const swatchOption = wrapper.querySelector('.swatch-option.color');
      if (!swatchOption) return;

      // Dubbele knop voorkomen
      if (wrapper.querySelector('.sparkle-rj-btn')) return;

      const labelEl = wrapper.querySelector('.swatch-label');
      const labelFromDom = labelEl ? labelEl.textContent.trim() : '';

      const rawLabel =
        swatchOption.getAttribute('data-option-label') ||
        swatchOption.getAttribute('aria-label') ||
        labelFromDom;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sparkle-rj-btn';
      btn.textContent = '✨ Sparkle';

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const colorInfo = parseColorLabel(rawLabel);
        const payload = buildSparklePayloadForColor(colorInfo);
        const sparkleComment = buildSparkleComment(payload);

        console.clear();
        console.log('▶️ SPARKLE payload voor kleur:', rawLabel, payload);
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
          console.warn('Sparkle RJ: kon niet naar klembord schrijven. Payload hierboven in console.');
        }
      });

      wrapper.appendChild(btn);
    });

    console.log('Sparkle RJ: knoppen toegevoegd aan kleur-swatch(es).');
  }

  // ---- Start: wachten tot de PDP geladen is -------------------------------

  function initWhenReady() {
    const checkInterval = setInterval(() => {
      const hasSku = document.querySelector('td[data-th="SKU"]');
      const hasSwatch = document.querySelector('.swatch-wrapper .swatch-option.color');

      if (hasSku && hasSwatch) {
        clearInterval(checkInterval);
        addButtonsToSwatches();
      }
    }, 400);

    // safety timeout
    setTimeout(() => clearInterval(checkInterval), 15000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initWhenReady();
  } else {
    document.addEventListener('DOMContentLoaded', initWhenReady);
  }
})();
