// ==UserScript==
// @name         Sparkle | Anita
// @version      1.2
// @description  Per kleurvariant een ✨ in cel A1 die DDO-HTML kopieert met juiste VKP-prijs en correcte kleur
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

  // Model = eerste woord van H1 (bv. "Lucia" uit "Lucia Prothesebeha")
  function getModelName(h1Text = '') {
    const first = (h1Text.trim().match(/^[^\s-]+/i) || [])[0] || '';
    return first.trim();
  }

  // Vind alle variant-headers (per kleur)
  function findVariantHeaders() {
    return $$('h2.accordion-header[id^="article-variant-"][id$="-accordion-heading"]');
  }

  // Extract "ARTIKEL-KLEUR" (bv. 4723X-001) uit header-id
  function extractArticleColorCode(headerEl) {
    const id = headerEl?.id || '';
    const m = id.match(/article-variant-([A-Z0-9]+-\d{3})-accordion-heading/i);
    return m ? m[1] : '';
  }

  // Body-element bij een header via aria-controls/data-bs-target
  function getVariantBodyFromHeader(headerEl) {
    const btn = $('button.accordion-button', headerEl);
    if (!btn) return null;
    const ctrl = btn.getAttribute('aria-controls') || btn.getAttribute('data-bs-target')?.replace(/^#/, '');
    if (!ctrl) return null;
    return document.getElementById(ctrl);
  }

  // Header bij een body-id (robuuste koppeling)
  function getHeaderFromBodyId(bodyId) {
    const btn = document.querySelector(
      `h2.accordion-header button[aria-controls="${bodyId}"], h2.accordion-header button[data-bs-target="#${bodyId}"]`
    );
    return btn ? btn.closest('h2.accordion-header') : null;
  }

  // Alfabetische kleurnaam uit header-button
  function getAlphaColorNameFromHeader(headerEl) {
    const btn = $('button.accordion-button', headerEl);
    if (!btn) return '';
    const alt = $('img', btn)?.getAttribute('alt')?.trim();
    if (alt) return alt;
    const parts = (btn.textContent || '').trim().split(/\s+/);
    if (parts.length >= 2) return parts.slice(1).join(' ').trim();
    return '';
  }

  // Prijs (VKP) uit variant-body: td[data-vkp] → data-vkp | .vkp
  function getVkpFromVariantBody(bodyEl) {
    if (!bodyEl) return '';
    const td = $('td[data-vkp]', bodyEl);
    let vkp = td?.getAttribute('data-vkp')?.trim() || (td ? txt('.vkp', td) : '');
    return (vkp || '').replace(/[^\d.,]/g, '').replace(',', '.');
  }

  // DDO HTML
  function buildDDOHtml({ title, price, productCode, model }) {
    return (
`<!-- ANITA EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${title}</h1>
  <div class="pdp-details_price">
    <span class="pdp-details_price__offer">€ ${price}</span>
  </div>
  <div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>
  <div class="pdp-details_model">Model: <span>${model}</span></div>
  <a href="#" style="display:none;">extern</a>
</div>
<!-- ANITA EXPORT END -->`
    );
  }

  // Klikhandler (per variant)
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

    const h1 = txt('.shop-article-header-description h1') || txt('.product-title h1');
    const model = getModelName(h1);
    const productCode = extractArticleColorCode(header);
    const alphaColor = getAlphaColorNameFromHeader(header);
    const price = getVkpFromVariantBody(body);

    const title = `${h1} ${capitalizeWords(alphaColor)}`.trim();
    const html = buildDDOHtml({ title, price, productCode, model });

    try {
      await navigator.clipboard.writeText(html);
      console.log(`✅ Gekopieerd: ${title} | ${productCode} | € ${price}`);
    } catch (err) {
      console.error('❌ Fout bij kopiëren:', err);
      alert('Kon niet naar klembord kopiëren. Check browserrechten.');
    }
  }

  // Voeg ✨ toe in cel A1 van de variant-tabel en koppel aan body/header
  function addSparkles() {
    const headers = findVariantHeaders();
    headers.forEach(header => {
      const body = getVariantBodyFromHeader(header);
      if (!body) return;

      const thA1 = $('table thead tr th', body);
      if (!thA1) return;
      if ($('.copy-sparkle', thA1)) return; // al aanwezig

      const sparkle = document.createElement('span');
      sparkle.textContent = '✨';
      sparkle.className = 'copy-sparkle';
      sparkle.style.cursor = 'pointer';
      sparkle.style.display = 'inline-block';
      sparkle.style.padding = '2px 4px';
      sparkle.style.userSelect = 'none';
      sparkle.title = 'Kopieer DDO-HTML (deze variant)';

      // Leg expliciet de koppeling vast (fix voor verkeerde kleur)
      sparkle.dataset.bodyId = body.id || '';
      sparkle.dataset.headerId = header.id || '';

      sparkle.addEventListener('click', onSparkleClick);
      thA1.appendChild(sparkle);
    });
  }

  // Observeer dynamische wijzigingen
  const mo = new MutationObserver(() => addSparkles());
  mo.observe(document.body, { childList: true, subtree: true });

  // Eerste injectie
  addSparkles();
})();
