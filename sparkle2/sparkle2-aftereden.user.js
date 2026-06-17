// ==UserScript==
// @name         Sparkle 2 | After Eden
// @version      1.4
// @description  Kopieert een SPARKLE payload per kleurvariant naar het klembord.
// @match        https://bcg.fashionportal.shop/item/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_CLASS = 'copy-sparkle-color';

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePrice(text) {
    const cleaned = String(text || '').replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';

    if (cleaned.includes(',') && cleaned.includes('.')) {
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');

      if (lastComma > lastDot) {
        return cleaned.replace(/\./g, '').replace(',', '.');
      }

      return cleaned.replace(/,/g, '');
    }

    return cleaned.replace(',', '.');
  }

  function colorNameFromColor(colorText) {
    const t = cleanText(colorText);
    if (!t) return '';

    const noCode = t.replace(/^\d+\s+/, '').trim();
    if (!noCode) return '';

    return noCode
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  function shortTypeFromProductType(productType) {
    const t = cleanText(productType);
    if (!t) return '';

    const m = t.match(/^(.*?)(?:\s+met\s+|$)/i);
    return cleanText(m?.[1] || t);
  }

  function compositionUrlFromProductCode(productCode) {
    const cleanCode = String(productCode || '').replace(/\D/g, '');

    return cleanCode
      ? `https://bcg.fashionportal.shop/item/${cleanCode}`
      : '';
  }

  function readBullets() {
    const wrap = document.querySelector('.product-attrubutes');
    if (!wrap) return [];

    const vals = Array.from(
      wrap.querySelectorAll('.attribute-wrapper .attribute-value')
    )
      .map(el => cleanText(el.textContent))
      .filter(Boolean);

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

  function readModelFromBullets() {
    const bullets = readBullets();
    return cleanText(bullets[0]);
  }

  function readDescriptionStoryText() {
    const el = document.querySelector('#fashion-tab-content #description');
    return cleanText(el?.textContent);
  }

  function buildCombinedDescription() {
    const bullets = readBullets();
    const story = readDescriptionStoryText();

    const bulletBlock = bullets.length
      ? bullets.map(b => `• ${b}`).join('\n')
      : '';

    if (bulletBlock && story) return `${bulletBlock}\n\n${story}`.trim();
    if (bulletBlock) return bulletBlock.trim();

    return story.trim();
  }

  function readFallbackTitle() {
    const h1 = document.querySelector('h1');
    const t1 = cleanText(h1?.textContent);
    if (t1) return t1;

    return cleanText(document.title);
  }

  function readProductTypeFromModal(colorWrap) {
    const modal = colorWrap.closest('.modal-content') || document;

    return (
      cleanText(modal.querySelector('#qountatyselector h5')?.textContent) ||
      cleanText(document.querySelector('h3.mb-0')?.textContent)
    );
  }

  function readListPriceFromColorWrap(colorWrap) {
    const blocks = colorWrap.querySelectorAll('.total-amt');

    for (const block of blocks) {
      const text = cleanText(block.textContent);

      if (!/list\s*price/i.test(text)) continue;

      const match = text.match(/(\d+[.,]\d{2})/);

      if (match) {
        return match[1];
      }
    }

    console.warn('⚠️ Sparkle: geen List Price gevonden', colorWrap);
    return '';
  }

  function readFirstWholesalePriceFromColorWrap(colorWrap) {
    const input = colorWrap.querySelector('input[type="hidden"][name^="proprice_"]');
    return cleanText(input?.value);
  }

  function buildSparklePayloadFromColorWrap(colorWrap) {
    const productCode = cleanText(
      colorWrap.querySelector('.pro-sku .nuMber')?.textContent
    );

    const color = cleanText(
      colorWrap.querySelector('.pro-sku p')?.textContent
    );

    const productType = readProductTypeFromModal(colorWrap);
    const modelName = readModelFromBullets();

    const typeShort = shortTypeFromProductType(productType);
    const colorName = colorNameFromColor(color);

    const productName =
      [modelName, typeShort, colorName].filter(Boolean).join(' ').trim() ||
      [typeShort, colorName].filter(Boolean).join(' ').trim() ||
      readFallbackTitle();

    const rrpRaw = readListPriceFromColorWrap(colorWrap);
    const priceRaw = readFirstWholesalePriceFromColorWrap(colorWrap);

    return {
      name: productName,
      rrp: normalizePrice(rrpRaw),
      price: normalizePrice(priceRaw),
      productCode,
      modelName,
      descriptionText: buildCombinedDescription(),
      compositionUrl: compositionUrlFromProductCode(productCode),
      reference: ' - [ext]',
      color,
      productType
    };
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: 'clipboard' };
      }
    } catch (e) {
      console.warn('[Sparkle] clipboard.writeText failed, fallback:', e);
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

  async function copySparklePayloadForColor(colorWrap, reason = 'color-click') {
    const payload = buildSparklePayloadFromColorWrap(colorWrap);

    const requiredFields = {
      name: payload.name,
      rrp: payload.rrp,
      productCode: payload.productCode
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key);

    if (missingFields.length) {
      console.error(
        `❌ Sparkle: verplichte velden ontbreken: ${missingFields.join(', ')}`,
        { missingFields, payload, colorWrap }
      );
      return;
    }

    const text = toSparkleComment(payload);
    const res = await copyTextToClipboard(text);

    if (res.ok) {
      console.log(
        `✅ SPARKLE payload gekopieerd (${reason}) [${res.method}]:`,
        payload
      );
    } else {
      console.error('❌ Sparkle: fout bij kopiëren:', res.error);
    }
  }

  function insertColorSparkleButtons() {
    const wraps = document.querySelectorAll('#qountatyselector .selectqty-wrap');

    wraps.forEach((wrap) => {
      if (wrap.querySelector(`.${BUTTON_CLASS}`)) return;

      const skuBlock = wrap.querySelector('.pro-sku');
      if (!skuBlock) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BUTTON_CLASS;
      btn.textContent = '✨ Sparkle';

      Object.assign(btn.style, {
        cursor: 'pointer',
        marginTop: '4px',
        padding: '3px 8px',
        fontSize: '12px',
        border: '1px solid #0073aa',
        borderRadius: '4px',
        background: '#fff',
        color: '#0073aa'
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copySparklePayloadForColor(wrap, 'color-click');
      });

      skuBlock.appendChild(btn);
    });
  }

  const observer = new MutationObserver(insertColorSparkleButtons);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  insertColorSparkleButtons();
})();
