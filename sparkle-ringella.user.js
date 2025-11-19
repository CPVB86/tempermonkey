// ==UserScript==
// @name         Sparkle | Ringella
// @version      1.1
// @description  Per kleurvariant een ✨ achter de kleurnaam die DDO-HTML kopieert met titel (H1 + kleurnaam), RRP, productcode (ITEM-COLOR), model (Dames/Heren) én leverancier-omschrijving.
// @match        https://b2b.ringella.com/ItemView.action*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle-ringella.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle-ringella.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (s, r = document) => ($(s, r)?.textContent || '').trim();

  const normalizePrice = (raw = '') =>
    (raw || '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.');

  const capitalizeWords = (str = '') =>
    str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  // H1 titel: productnaam bovenaan
  function getH1Title() {
    return txt('.b2b_itemview h1.itemViewDescription') || txt('h1');
  }

  // SPID / itemnummer: span.infoHeadline == "Item" gevolgd door waarde
function getSPID() {
  // 1) Proberen via de item-info box (meertalig: Item / Artikel / Art.-Nr.)
  const spans = $$('.b2b_itemview span.infoHeadline');
  for (const s of spans) {
    const label = (s.textContent || '').trim().toLowerCase();
    if (
      label.includes('item') ||
      label.includes('artikel') ||
      label.includes('art.-nr') ||
      label.includes('artikel-nr')
    ) {
      const n = s.nextElementSibling?.textContent.trim() || '';
      if (n) return n;
    }
  }

  // 2) Fallback: haal het artikelnummer uit de breadcrumb, bv. "Artikel: 5571206"
  const bc = document.getElementById('breadcrumbs');
  if (bc) {
    const links = bc.querySelectorAll('a');
    for (const a of links) {
      const t = (a.textContent || '').trim();
      if (/artikel\s*:/i.test(t)) {
        const m = t.match(/(\d{4,})/);
        if (m) return m[1];
      }
    }
  }

  return '';
}

  // Adviesprijs: uit RRP-rij (recommendedGrossPriceRow)
  function getAdvicePrice() {
    const row = $('tr.recommendedGrossPriceRow');
    if (!row) return '';
    const cell = row.querySelector('td.text-align_right');
    if (!cell) return '';
    return normalizePrice(cell.textContent);
  }

  // Model uit broodkruimel: Women -> Dames, Men -> Heren
  function getModelFromBreadcrumbs() {
    const bc = $('#breadcrumbs');
    if (!bc) return '';
    const text = bc.textContent.toLowerCase();
    if (text.includes('women')) return 'Dames';
    if (text.includes('men')) return 'Heren';
    return '';
  }

  // Omschrijving: blok onder "Description of product"
  function getSupplierDescriptionHTML() {
    const el = document.querySelector('.itemViewInfoText');
    if (!el) return '';

    // Clone zodat we niet aan de live DOM zitten
    const clone = el.cloneNode(true);

    // Verwijder alleen de "Description of product"-heading
    clone.querySelectorAll('h3.clearfix').forEach(h3 => {
      const label = (h3.textContent || '').trim().toLowerCase();
      if (label.includes('description of product')) {
        h3.remove();
      }
    });

    let html = (clone.innerHTML || '').trim();
    // Strip alleen scripts, laat <br> en andere opmaak staan
    html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    return html;
  }

  // DDO HTML opbouw
  function buildDDOHtml({ title, price, productCode, descriptionHTML, model }) {
    const modelBlock = model
      ? `\n  <div class="pdp-details_model">Model: <span>${model}</span></div>`
      : '';

    const descBlock = descriptionHTML
      ? `\n  <div class="pdp-details_description"> ${descriptionHTML}</div>`
      : '';

    return (
`<!-- RINGELLA EXPORT START -->
<div class="pdp-details">
  <h1 class="pdp-details_heading">${model} ${title}</h1>
  <div class="pdp-details_price">
    <span class="pdp-details_price__offer">€ ${price}</span>
  </div>
  <div class="pdp-details_product-code">Product Code: <span>${productCode}</span></div>${modelBlock}${descBlock}
  <a href="#" style="display:none;">extern</a>
</div>
<!-- RINGELLA EXPORT END -->`
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
    const model = getModelFromBreadcrumbs();

const productCode = spid && colorId ? `${spid}-${colorId}` : (spid || '');

// titel + kleurnaam + "-SPID-COLOR"
const suffix =
  spid && colorId ? ` ${spid}-${colorId}` :
  spid ? ` - ${spid}` :
  '';

const title = `${h1} ${capitalizeWords(colorName || '')}${suffix}`.trim();

    const html = buildDDOHtml({ title, price, productCode, descriptionHTML, model });

    try {
      await navigator.clipboard.writeText(html);
      console.log(
        `✅ Gekopieerd (Ringella): ${title} | ${productCode} | € ${price}${model ? ` | ${model}` : ''}${descriptionHTML ? ' | met omschrijving' : ''}`
      );
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

  // Kleurinfo halen uit de horizontale maat-/kleurenmatrix
  function addSparkles() {
    const container = document.getElementById('horizontalSize');
    if (!container) return;

    // Elke kleurregel heeft class "colorAndInputFieldRow"
    const rows = container.querySelectorAll('tr.colorAndInputFieldRow');
    if (!rows.length) return;

    rows.forEach(row => {
      // Eerste cel bevat de kleurinfo: "324 bordeaux" etc.
      const firstCell = row.querySelector('td.tablesaw-cell-persist');
      if (!firstCell) return;

      // Voorkom dubbele sparkles
      if (firstCell.querySelector('.copy-sparkle')) return;

      // Titel-attribuut is het meest betrouwbaar: "324 bordeaux"
      const titleAttr = firstCell.getAttribute('title') || '';
      const rawText   = titleAttr || firstCell.textContent.trim();

      let colorId = '';
      let colorName = '';

      // Verwacht patroon: "<code> <naam>", bv. "324 bordeaux"
      const m = rawText.trim().match(/^(\S+)\s+(.+)$/);
      if (m) {
        colorId = m[1];
        colorName = m[2];
      } else {
        // Fallback: als er geen nette split is, alles als naam
        colorName = rawText;
      }

      const spark = makeSparkle({ colorId, colorName });
      firstCell.appendChild(spark);
    });
  }

  const mo = new MutationObserver(() => addSparkles());
  mo.observe(document.body, { childList: true, subtree: true });

  addSparkles();
})();
