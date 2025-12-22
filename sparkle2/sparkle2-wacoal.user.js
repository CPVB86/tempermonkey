// ==UserScript==
// @name         Sparkle 2 | Wacoal
// @version      1.0
// @description  Kopieert een SPARKLE payload naar het klembord.
// @match        https://b2b.wacoal-europe.com/b2b/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle2/sparkle2-wacoal.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_CLASS = 'copy-sparkle';
  const BUTTON_TEXT = '✨';

  // --- Payload builder ---
  function buildSparklePayload() {
    const root = document.querySelector('.pdp-details');
    if (!root) return null;

    const gtm = readGtmProduct();
    const productName =
      (gtm?.name || '').trim() ||
      (root.querySelector('.pdp-details_heading')?.textContent.trim() || '');

    const rrpRaw = root.querySelector('.pdp-details_price__offer')?.textContent || '';
    const priceRaw = root.querySelector('.pdp-details_price__discounted')?.textContent || '';

    const productCode =
      (gtm?.id || '').trim() ||
      ([...root.querySelectorAll('.pdp-details_product-code')]
        .find(p => (p.textContent || '').includes('Product Code'))
        ?.querySelector('span')?.textContent.trim() || '');

    const descriptionText = root.querySelector('.pdp-details_description')?.textContent.trim() || '';
    const reference = root.querySelector('a') ? ' - [ext]' : '';
    const compositionUrl = location.href;

    // Receiver best-match: use full productName as modelName.
    const modelName = productName;

    return {
      name: productName,
      rrp: normalizePrice(rrpRaw),
      price: normalizePrice(priceRaw),
      productCode,
      modelName,
      descriptionText,
      compositionUrl,
      reference
    };
  }

  function normalizePrice(text) {
    const cleaned = (text || '').replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';
    return cleaned.replace(',', '.');
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  // --- GTM extraction (tolerant; data attr is JS-ish, not JSON) ---
  function readGtmProduct() {
    const el = document.querySelector('data-gtm-proxy[data]');
    if (!el) return null;

    const raw = el.getAttribute('data') || '';
    if (!raw) return null;

    const id = matchSingleQuoted(raw, /\bid\s*:\s*'([^']+)'/i);
    const name = matchSingleQuoted(raw, /\bname\s*:\s*'([^']+)'/i);

    if (!id && !name) return null;
    return { id: id || '', name: name || '' };
  }

  function matchSingleQuoted(text, re) {
    const m = text.match(re);
    return m?.[1] || '';
  }

  // --- Clipboard action ---
  async function copySparklePayload(reason = 'unknown') {
    const payload = buildSparklePayload();
    if (!payload) {
      console.error('❌ Sparkle: .pdp-details niet gevonden.');
      return;
    }

    if (!payload.name || !payload.rrp || !payload.productCode) {
      console.error('❌ Sparkle: payload mist verplichte velden:', payload);
      return;
    }

    try {
      await navigator.clipboard.writeText(toSparkleComment(payload));
      console.log(`✅ SPARKLE payload gekopieerd (${reason}):`, payload);
    } catch (err) {
      console.error('❌ Fout bij kopiëren:', err);
    }
  }

  // --- UI ---
  function insertButton() {
    const root = document.querySelector('.pdp-details');
    const heading = root?.querySelector('h1');
    if (!root || !heading) return;
    if (root.querySelector(`.${BUTTON_CLASS}`)) return;

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

    heading.insertAdjacentElement('afterend', btn);
  }

  // Hotkey: Ctrl+Shift+Z / Cmd+Shift+Z
  document.addEventListener('keydown', (e) => {
    const keyZ = (e.key?.toLowerCase() === 'z') || (e.code === 'KeyZ');
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK || !keyZ) return;

    // Avoid disrupting typing in fields
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
