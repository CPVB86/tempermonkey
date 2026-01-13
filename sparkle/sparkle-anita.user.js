// ==UserScript==
// @name         Sparkle | Anita
// @version      1.5
// @description  Per kleurvariant een ✨ in cel A1 die SPARKLE-JSON kopieert (productCode + url + prijs/kleur)
// @match        https://*.anita.com/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-anita.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Helpers ---
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (s, r = document) => ($(s, r)?.textContent || '').trim();

  function capitalizeWords(str = '') {
    return str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  function normalizeMoney(str = '') {
    const cleaned = String(str).replace(/[^\d.,]/g, '').trim();
    if (!cleaned) return '';
    if (cleaned.includes('.') && cleaned.includes(',')) {
      return cleaned.replace(/\./g, '').replace(',', '.');
    }
    return cleaned.replace(',', '.');
  }

  function stripLeadingStyle(str = '') {
    return String(str).replace(/^\s*style\s+/i, '').trim();
  }

  // ModelName: eerste woord NA "Style"
  function getModelName(h1Text = '') {
    const cleaned = stripLeadingStyle(h1Text);
    const first = (cleaned.match(/^[^\s-]+/i) || [])[0] || '';
    return first.trim();
  }

  // Vind alle variant-headers (per kleur)
  function findVariantHeaders() {
    return $$('h2.accordion-header[id^="article-variant-"][id$="-accordion-heading"]');
  }

  // Body-element bij een header via aria-controls/data-bs-target
  function getVariantBodyFromHeader(headerEl) {
    const btn = $('button.accordion-button', headerEl);
    if (!btn) return null;
    const ctrl = btn.getAttribute('aria-controls') || btn.getAttribute('data-bs-target')?.replace(/^#/, '');
    if (!ctrl) return null;
    return document.getElementById(ctrl);
  }

  // Header bij een body-id
  function getHeaderFromBodyId(bodyId) {
    const btn = document.querySelector(
      `h2.accordion-header button[aria-controls="${bodyId}"], h2.accordion-header button[data-bs-target="#${bodyId}"]`
    );
    return btn ? btn.closest('h2.accordion-header') : null;
  }

  // Alfabetische kleurnaam uit header-button (img alt of tekst)
  function getAlphaColorNameFromHeader(headerEl) {
    const btn = $('button.accordion-button', headerEl);
    if (!btn) return '';
    const alt = $('img', btn)?.getAttribute('alt')?.trim();
    if (alt) return alt;

    const raw = (btn.textContent || '').trim();
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) return parts.slice(1).join(' ').trim();
    return raw;
  }

  // Kleurcode (bijv. "305") uit header-id: article-variant-XXXX-305-accordion-heading
function getColorCodeFromHeaderId(headerEl) {
  const id = headerEl?.id || '';
  // pakt de laatste -NNN- vlak vóór "-accordion-heading"
  const m = id.match(/-([0-9]{3})-accordion-heading$/i);
  return m ? m[1] : '';
}

  // Artikelnummer basis uit H2: "Artikelnummer M6 6220" -> "M6-6220"
  function getArticleBaseFromH2() {
    const h2 = txt('.shop-article-header-description h2') || txt('.shop-article-header-description .h2') || '';
    // Pak "Artikelnummer" + code
    // Voorbeelden: "Artikelnummer M6 6220", "Artikelnummer M6-6220"
    const m = h2.match(/artikelnummer\s+([A-Z0-9]+)[\s-]*([A-Z0-9]+)/i);
    if (!m) return '';
    return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  }

  // Prijs (VKP) uit variant-body
  function getVkpFromVariantBody(bodyEl) {
    if (!bodyEl) return '';
    const td = $('td[data-vkp]', bodyEl);
    const vkp = td?.getAttribute('data-vkp')?.trim() || (td ? txt('.vkp', td) : '');
    return normalizeMoney(vkp);
  }

  // RRP fallback naar price
  function findRrp(priceFallback = '') {
    const candidates = ['[data-rrp]', '[data-uvp]', '.rrp', '.uvp', '.recommended-price'];
    for (const sel of candidates) {
      const el = $(sel);
      if (!el) continue;
      const v = el.getAttribute('data-rrp') || el.getAttribute('data-uvp') || el.textContent;
      const m = normalizeMoney(v);
      if (m) return m;
    }
    return priceFallback || '';
  }

  function findDescriptionText() {
    const candidates = [
      '.shop-article-description',
      '.product-description',
      '.pdp-description',
      '#description',
      '[data-description]'
    ];
    for (const sel of candidates) {
      const el = $(sel);
      if (!el) continue;
      const t = (el.getAttribute('data-description') || el.textContent || '').trim();
      if (t && t.length >= 20) return t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    return '';
  }

  // --- SPARKLE output ---
  // IMPORTANT: minified JSON (1 regel), anders pakt je input-script hem vaak niet
  function buildSparkleComment(payloadObj) {
    const json = JSON.stringify(payloadObj); // <- geen pretty print
    return `<!--SPARKLE:${json}-->`;
  }

  async function onSparkleClick(ev) {
    ev.stopPropagation();
    ev.preventDefault();
    ev.stopImmediatePropagation?.();

    const spark = ev.currentTarget;
    const bodyId = spark?.dataset?.bodyId;
    const headerId = spark?.dataset?.headerId;

    const body = bodyId ? document.getElementById(bodyId) : null;
    let header = headerId ? document.getElementById(headerId) : null;
    if (!header && bodyId) header = getHeaderFromBodyId(bodyId);
    if (!body || !header) return;

    const rawH1 = txt('.shop-article-header-description h1') || txt('.product-title h1') || txt('h1');
    const h1 = stripLeadingStyle(rawH1);

    const alphaColor = getAlphaColorNameFromHeader(header);
    const colorCode = getColorCodeFromHeaderId(header);

    const modelName = getModelName(rawH1);

    const price = getVkpFromVariantBody(body);
    const rrp = findRrp(price);

    // productCode = "M6-6220-305"
    const base = getArticleBaseFromH2();
    const productCode = [base, colorCode].filter(Boolean).join('-');

    // compositionUrl = huidige pagina
    const compositionUrl = location.href;

    const title = `${h1} ${capitalizeWords(alphaColor)}`.trim();
    const name = title;

    const payload = {
      name,
      title,
      rrp: rrp || '',
      price: price || '',
      productCode: productCode || '',
      modelName: modelName || '',
      descriptionText: findDescriptionText() || '',
      compositionUrl,
      reference: '- [ext]'
    };

    const sparkleComment = buildSparkleComment(payload);

    try {
      await navigator.clipboard.writeText(sparkleComment);
      console.log(`✅ SPARKLE gekopieerd: ${title} | ${productCode || '(geen productCode)'} | € ${price}`);
    } catch (err) {
      console.error('❌ Fout bij kopiëren:', err);
      alert('Kon niet naar klembord kopiëren. Check browserrechten.');
    }
  }

  function addSparkles() {
    const headers = findVariantHeaders();
    headers.forEach(header => {
      const body = getVariantBodyFromHeader(header);
      if (!body) return;

      const thA1 = $('table thead tr th', body);
      if (!thA1) return;
      if ($('.copy-sparkle', thA1)) return;

      const sparkle = document.createElement('span');
      sparkle.textContent = '✨';
      sparkle.className = 'copy-sparkle';
      sparkle.style.cursor = 'pointer';
      sparkle.style.display = 'inline-block';
      sparkle.style.padding = '2px 4px';
      sparkle.style.userSelect = 'none';
      sparkle.title = 'Kopieer SPARKLE JSON (deze variant)';

      sparkle.dataset.bodyId = body.id || '';
      sparkle.dataset.headerId = header.id || '';

      sparkle.addEventListener('click', onSparkleClick);
      thA1.appendChild(sparkle);
    });
  }

  const mo = new MutationObserver(() => addSparkles());
  mo.observe(document.body, { childList: true, subtree: true });

  addSparkles();
})();
