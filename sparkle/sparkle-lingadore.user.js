// ==UserScript==
// @name         Sparkle | LingaDore
// @version      1.2
// @description  Per kleurvariant een ✨ achter de kleurnummer-h5 die DDO-HTML kopieert met titel (H1 + kleurnaam), adviesverkoopprijs, productcode (SPID-kleurnr) én leverancier-omschrijving.
// @match        https://b2b.lingadore.com/catalog/item/*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-lingadore.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-lingadore.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (s, r = document) => ($(s, r)?.textContent || '').trim();

  const normalizePrice = (raw = '') =>
    (raw || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');

  const capitalizeWords = (str = '') =>
    str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  function getH1Title() {
    return txt('.product-header-block h1') || txt('h1');
  }

  function getSPID() {
    return txt('.product-header-block h3') || '';
  }

  function getAdvicePrice() {
    const items = $$('.info-block--item');
    for (const el of items) {
      const label = txt('div:nth-child(1)', el).replace(/\s+/g, ' ').toLowerCase();
      if (label.includes('adviesverkoopprijs')) {
        const val = txt('div:nth-child(2)', el);
        return normalizePrice(val);
      }
    }
    const anyEuro = document.body.textContent.match(/€\s*[\d.,]+/);
    return anyEuro ? normalizePrice(anyEuro[0]) : '';
  }

  function getSupplierDescriptionHTML() {
    const items = $$('.info-block--item');
    for (const el of items) {
      const label = txt('div:nth-child(1)', el).replace(/\s+/g, ' ').toLowerCase();
      if (label.includes('omschrijving')) {
        const valEl = $('div:nth-child(2)', el);
        if (!valEl) continue;
        // Neem HTML over (bewaar eventuele opmaak van leverancier)
        let html = (valEl.innerHTML || '').trim();
        // Eenvoudige sanity: strip eventuele <script> blokken
        html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
        return html;
      }
    }
    return '';
  }

  function buildDDOHtml({ title, price, productCode, descriptionHTML }) {
    const descBlock = descriptionHTML
      ? `\n  <div class="pdp-details_description"> ${descriptionHTML}</div>`
      : '';
    return (
`<!-- LINGADORE EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${title}</h1>
  <div class="pdp-details_price">
    <span class="pdp-details_price__offer">€ ${price}</span>
  </div>
  <div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>${descBlock}
  <a href="#" style="display:none;">extern</a>
</div>
<!-- LINGADORE EXPORT END -->`
    );
  }

  async function onSparkleClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const spark = ev.currentTarget;
    const colorId = spark?.dataset?.colorId || '';
    const colorName = spark?.dataset?.colorName || '';

    const h1 = getH1Title();
    const spid = getSPID();
    const price = getAdvicePrice();
    const descriptionHTML = getSupplierDescriptionHTML();

    const productCode = spid && colorId ? `${spid}-${colorId}` : (spid || '');
    const title = `${h1} ${capitalizeWords(colorName || '')}`.trim();

    const html = buildDDOHtml({ title, price, productCode, descriptionHTML });

    try {
      await navigator.clipboard.writeText(html);
      console.log(`✅ Gekopieerd: ${title} | ${productCode} | € ${price}${descriptionHTML ? ' | met omschrijving' : ''}`);
    } catch (err) {
      console.error('❌ Kopiëren mislukt:', err);
      alert('Kon niet naar klembord kopiëren. Sta toegang tot het klembord toe.');
    }
  }

  function makeSparkle({ colorId, colorName }) {
    const span = document.createElement('span');
    span.textContent = ' ✨';
    span.className = 'copy-sparkle';
    span.style.cursor = 'pointer';
    span.style.userSelect = 'none';
    span.title = 'Kopieer DDO-HTML voor deze kleur';
    span.dataset.colorId = colorId || '';
    span.dataset.colorName = colorName || '';
    span.addEventListener('click', onSparkleClick);
    return span;
  }

  function addSparkles() {
    const rows = $$('.item-row.style_row');
    if (!rows.length) return;

    rows.forEach(row => {
      const colorId = row.getAttribute('data-color-id') || row.getAttribute('data-color') || '';
      let colorName = '';
      const colorEl = $('.item-colors .color[data-description]', row);
      if (colorEl) colorName = colorEl.getAttribute('data-description') || '';
      if (!colorName) colorName = txt('.item-colors p', row);

      const h5 = $('.item-colors h5', row);
      if (!h5) return;
      if (h5.querySelector('.copy-sparkle')) return;

      const spark = makeSparkle({ colorId, colorName });
      h5.appendChild(spark);
    });
  }

  const mo = new MutationObserver(() => addSparkles());
  mo.observe(document.body, { childList: true, subtree: true });

  addSparkles();
})();
