// ==UserScript==
// @name         Sparkle 2 | After Eden
// @version      1.3
// @description  Kopieert een SPARKLE payload naar het klembord (After Eden / fashionportal) + clipboard fallback.
// @match        https://bcg.fashionportal.shop/item/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-aftereden.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-aftereden.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_CLASS = 'copy-sparkle';
  const BUTTON_TEXT = '✨';

  // --- Payload builder ---
  function buildSparklePayload() {
    const productCode = readSupplierId();
    if (!productCode) return null;

    const color = readColorText(); // "230 Dazzling blue"
    const productType = readProductTypeText(); // "Voorgevormde beugelbeha met kant ..."
    const modelName = readModelFromBullets(); // "Milou"

    // Name/title: "Milou Voorgevormde beugelbeha Dazzling Blue"
    const typeShort = shortTypeFromProductType(productType); // "Voorgevormde beugelbeha"
    const colorName = colorNameFromColor(color);             // "Dazzling Blue"
    const productName =
      [modelName, typeShort, colorName].filter(Boolean).join(' ').trim() ||
      readFallbackTitle();

    const rrpRaw = readCatalogPriceRaw();

    // ✅ Description: bullets + verhaaltje
    const descriptionText = buildCombinedDescription();

    const reference = document.querySelector('a') ? ' - [ext]' : '';
    const compositionUrl = location.href;

    // wholesale price meestal niet aanwezig; leeg is ok
    const priceRaw = readWholesalePriceRaw();

    return {
      name: productName,
      rrp: normalizePrice(rrpRaw),
      price: normalizePrice(priceRaw),
      productCode,
      modelName,
      descriptionText,
      compositionUrl,
      reference,

      // extra (harmless)
      color,
      productType
    };
  }

  // --- Extractors (After Eden DOM) ---
  function readSupplierId() {
    const v = findCategoryValueByLabel(/^artikel\s*:/i);
    return (v || '').trim();
  }

  function readCatalogPriceRaw() {
    return findCategoryValueByLabel(/^catalogusprijs\s*:/i) || '';
  }

  function readWholesalePriceRaw() {
    return findCategoryValueByLabel(/^prijs\s*:/i) || '';
  }

  function readColorText() {
    const labels = Array.from(document.querySelectorAll('label'));
    for (const l of labels) {
      const txt = (l.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^kleur\s*:/i.test(txt)) continue;
      const span = l.querySelector('span');
      const v = (span?.textContent || '').replace(/\s+/g, ' ').trim();
      if (v) return v;
      return txt.replace(/^kleur\s*:/i, '').trim();
    }
    return '';
  }

  function readProductTypeText() {
    const h = document.querySelector('h3.mb-0');
    return (h?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function readModelFromBullets() {
    const bullets = readBullets();
    return (bullets[0] || '').trim();
  }

  function readDescriptionStoryText() {
    const el = document.querySelector('#fashion-tab-content #description');
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function readBullets() {
    const wrap = document.querySelector('.product-attrubutes');
    if (!wrap) return [];
    const vals = Array.from(wrap.querySelectorAll('.attribute-wrapper .attribute-value'))
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    // Dedup, preserve order
    const seen = new Set();
    const out = [];
    for (const v of vals) {
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function buildCombinedDescription() {
    const bullets = readBullets();
    const story = readDescriptionStoryText();

    const bulletBlock = bullets.length
      ? bullets.map(b => `• ${b}`).join('\n')
      : '';

    // bullets + lege regel + story (als die er is)
    if (bulletBlock && story) return `${bulletBlock}\n\n${story}`.trim();
    if (bulletBlock) return bulletBlock.trim();
    return (story || '').trim();
  }

  function findCategoryValueByLabel(labelRegex) {
    const cats = document.querySelectorAll('.pro-category.d-flex');
    for (const c of cats) {
      const left = c.querySelector('.col-md-6:nth-child(1)') || c.querySelector('.col-md-6.px-0');
      const label = (left?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!labelRegex.test(label)) continue;

      const cols = c.querySelectorAll('.col-md-6.px-0');
      const right = cols?.[1] || c.querySelector('.col-md-6:nth-child(2)');
      const value = (right?.textContent || '').replace(/\s+/g, ' ').trim();
      return value;
    }

    const spans = document.querySelectorAll('.pro-category .dark-txt');
    for (const s of spans) {
      const t = (s.textContent || '').replace(/\s+/g, ' ').trim();
      if (!labelRegex.test(t)) continue;
      const wrap = s.closest('.pro-category');
      if (!wrap) continue;
      const cols = wrap.querySelectorAll('.col-md-6.px-0');
      const right = cols?.[1];
      const value = (right?.textContent || '').replace(/\s+/g, ' ').trim();
      return value;
    }

    return '';
  }

  function shortTypeFromProductType(productType) {
    const t = (productType || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = t.match(/^(.*?)(?:\s+met\s+|$)/i);
    return (m?.[1] || t).trim();
  }

  function colorNameFromColor(colorText) {
    const t = (colorText || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const noCode = t.replace(/^\d+\s+/, '').trim();
    if (!noCode) return '';
    return noCode
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function readFallbackTitle() {
    const h1 = document.querySelector('h1');
    const t1 = (h1?.textContent || '').replace(/\s+/g, ' ').trim();
    if (t1) return t1;
    return (document.title || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePrice(text) {
    const cleaned = (text || '').replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';
    if (cleaned.includes(',') && cleaned.includes('.')) {
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');
      if (lastComma > lastDot) return cleaned.replace(/\./g, '').replace(',', '.');
      return cleaned.replace(/,/g, '');
    }
    return cleaned.replace(',', '.');
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  // --- Clipboard: modern + fallback ---
  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: 'clipboard' };
      }
    } catch (e) {
      console.warn('[Sparkle] clipboard.writeText failed, fallback to execCommand:', e);
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';

      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand('copy');
      ta.remove();

      if (!ok) throw new Error('execCommand returned false');
      return { ok: true, method: 'execCommand' };
    } catch (e) {
      return { ok: false, method: 'none', error: e };
    }
  }

  // --- Action ---
  async function copySparklePayload(reason = 'unknown') {
    const payload = buildSparklePayload();
    if (!payload) {
      console.error('❌ Sparkle: verplichte velden niet gevonden (productCode).');
      return;
    }

    if (!payload.name || !payload.rrp || !payload.productCode) {
      console.error('❌ Sparkle: payload mist verplichte velden:', payload);
      return;
    }

    const text = toSparkleComment(payload);
    const res = await copyTextToClipboard(text);

    if (res.ok) {
      console.log(`✅ SPARKLE payload gekopieerd (${reason}) [${res.method}]:`, payload);
    } else {
      console.error('❌ Fout bij kopiëren (ook fallback faalde):', res.error);
    }
  }

  // --- UI ---
  function insertButton() {
    const h3 = document.querySelector('h3.mb-0');
    const anchor =
      h3 ||
      document.querySelector('.product-details') ||
      document.body;

    if (!anchor) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const btn = document.createElement('h5');
    btn.className = BUTTON_CLASS;
    btn.textContent = BUTTON_TEXT;
    Object.assign(btn.style, {
      cursor: 'pointer',
      marginTop: '5px',
      fontWeight: 'normal',
      fontSize: '14px',
      color: '#0073aa',
      userSelect: 'none'
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copySparklePayload('click');
    });

    if (h3?.insertAdjacentElement) h3.insertAdjacentElement('afterend', btn);
    else anchor.prepend(btn);
  }

  // Hotkey: Ctrl+Shift+Z / Cmd+Shift+Z
  document.addEventListener('keydown', (e) => {
    const keyZ = (e.key?.toLowerCase() === 'z') || (e.code === 'KeyZ');
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK || !keyZ) return;

    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
    if (editable) return;

    e.preventDefault();
    copySparklePayload('hotkey');
  });

  const observer = new MutationObserver(insertButton);
  observer.observe(document.body, { childList: true, subtree: true });

  insertButton();
})();
