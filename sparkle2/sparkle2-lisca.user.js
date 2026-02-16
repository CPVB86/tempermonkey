// ==UserScript==
// @name         Sparkle 2 | Lisca
// @version      2.2.1
// @description  Kopieert een <!--SPARKLE:{...}--> payload (V2) voor de DDO verwerker. Klik ✨ onder de H1.
// @match        https://b2b-eu.lisca.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MARKUP_FACTOR = 2.5;

  const $ = (sel, root = document) => root.querySelector(sel);

  function toTitleCase(s = '') {
    return (s || '')
      .replace(/[»«]/g, '')
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  function normalizeSku(sku = '') {
    let s = (sku || '').trim();
    if (!s) return '';
    if (s.length > 6) s = s.slice(0, 6) + '-' + s.slice(6);
    return s;
  }

  function parsePriceText(txt = '') {
    const cleaned = (txt || '')
      .replace(/\s+/g, ' ')
      .replace(/[^\d,\.]/g, '')
      .trim();
    if (!cleaned) return NaN;

    const asDot = cleaned.replace(',', '.');
    const n = parseFloat(asDot);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2);
  }

  function pickDescription() {
    const candidates = [
      '.product.attribute.description .value',
      '.product.attribute.overview .value',
      '.product-info-main .product.attribute.description .value',
      '.product-info-main .product.attribute.overview .value',
      '#description .value',
      '#description',
      '.product.info.detailed .description .value',
      '.product.info.detailed .product.attribute.description .value',
    ];

    for (const sel of candidates) {
      const el = $(sel);
      if (!el) continue;

      const html = (el.innerHTML || '').trim();
      const text = (el.textContent || '').trim();

      if (html && html.replace(/<[^>]+>/g, '').trim().length > 0) {
        return { descriptionHtml: html, descriptionText: '' };
      }
      if (text) {
        return { descriptionHtml: '', descriptionText: text };
      }
    }

    return { descriptionHtml: '', descriptionText: '' };
  }

  function buildPayload() {
    const h1Text =
      $('.page-title-wrapper .base')?.textContent.trim() ||
      $('.page-title-wrapper h1')?.textContent.trim() ||
      '';

    // Modelnaam uit lisca-produc-id
    const rawModelLine = $('.lisca-produc-id')?.textContent.trim() || '';
    const modelMatch = rawModelLine.match(/^([^\-\n]+)/);
    const modelRaw = modelMatch ? modelMatch[1].trim() : '';
    const modelName = toTitleCase(modelRaw);

    // Haal titeldeel uit H1 zonder model
    const titlePart = h1Text
      .replace(/[»«]/g, '')
      .replace(modelRaw ? new RegExp(modelRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, '')
      .trim();

    const titleClean = toTitleCase(titlePart);

    // Kleur uit selected option
    const kleurRaw = $('.related-list-selected-option')?.textContent.trim() || '';
    const kleurClean = toTitleCase(kleurRaw.replace(/^[^\-]+\s*-\s*/, ''));

    const computedName = `${modelName} ${titleClean} ${kleurClean}`.replace(/\s+/g, ' ').trim();

    // SKU / productCode
    const form = $('.product-add-form form');
    const skuRaw = form?.getAttribute('data-product-sku') || '';
    const productCode = normalizeSku(skuRaw);

    // Prijzen: old + final
    const oldEl = $('.product-info-price .old-price .price');
    const finalEl =
      $('.product-info-price .special-price .price') ||
      $('.product-info-price .price-final_price .price') ||
      $('.product-info-price .final-price .price') ||
      $('.product-info-price .price');

    const oldBase = parsePriceText(oldEl?.textContent || '');
    const finalBase = parsePriceText(finalEl?.textContent || '');

    let rrp = '';
    let price = '';

    const oldMarked = Number.isFinite(oldBase) ? oldBase * MARKUP_FACTOR : NaN;
    const finalMarked = Number.isFinite(finalBase) ? finalBase * MARKUP_FACTOR : NaN;

    if (Number.isFinite(oldMarked) && Number.isFinite(finalMarked) && finalMarked < oldMarked) {
      rrp = fmtMoney(oldMarked);
      price = fmtMoney(finalMarked);
    } else if (Number.isFinite(finalMarked)) {
      rrp = fmtMoney(finalMarked);
      price = '';
    } else if (Number.isFinite(oldMarked)) {
      rrp = fmtMoney(oldMarked);
      price = '';
    } else {
      rrp = '';
      price = '';
    }

    // Description
    const { descriptionHtml, descriptionText } = pickDescription();

    // ✅ Requested changes:
    const compositionUrl = location.href; // url van de pagina
    const reference = ' - [ext]';                 // ext

    const payload = {
      name: computedName,
      title: computedName,
      rrp,
      price,
      productCode,
      modelName,
      descriptionHtml,
      descriptionText,
      compositionUrl,
      reference,

      _sparkle: {
        source: 'Lisca',
        v: 2,
        ts: new Date().toISOString()
      }
    };

    return payload;
  }

  function payloadToClipboardText(payload) {
    return `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  }

  async function copySparkle() {
    const payload = buildPayload();
    const text = payloadToClipboardText(payload);
    await navigator.clipboard.writeText(text);
    console.log('✅ SPARKLE V2 gekopieerd:', payload);
  }

  function insertLiscaCopyButton() {
    const heading = $('.page-title-wrapper h1');
    if (!heading || $('.copy-sparkle')) return;

    const copyBtn = document.createElement('h5');
    copyBtn.textContent = '✨';
    copyBtn.className = 'copy-sparkle';
    Object.assign(copyBtn.style, {
      cursor: 'pointer',
      marginTop: '5px',
      fontWeight: 'normal',
      fontSize: '14px',
      color: '#0073aa',
      userSelect: 'none'
    });

    copyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        await new Promise(r => setTimeout(r, 250));
        await copySparkle();
      } catch (err) {
        console.error('❌ Fout bij kopiëren SPARKLE V2:', err);
      }
    });

    heading.insertAdjacentElement('afterend', copyBtn);
  }

  const observer = new MutationObserver(() => insertLiscaCopyButton());
  observer.observe(document.body, { childList: true, subtree: true });
  insertLiscaCopyButton();
})();
