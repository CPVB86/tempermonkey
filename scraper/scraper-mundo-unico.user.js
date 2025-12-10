// ==UserScript==
// @name         EAN Scraper | Mundo Unico
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.20
// @description  Haal Colomoda EAN's + stock via supplier PID (Mundo Unico) en vul #tabs-3 in (DDO admin). Hotkey: Ctrl+Shift+S + autosave.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        GM_xmlhttpRequest
// @connect      www.colomoda.eu
// @run-at       document-end
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-mundo-unico.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-mundo-unico.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const COL_BASE = 'https://www.colomoda.eu';

  const TABLE_SELECTOR        = '#tabs-3 table.options';
  const PID_SELECTOR          = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR  = '#tabs-1 #select2-brand-container';
  const HOTKEY = { ctrl: true, shift: true, alt: false, key: 's' };

  const BTN_ID = 'colomoda-ean-btn';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Helpers ----------

  function httpGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Accept': 'application/json, text/javascript,*/*;q=0.1' },
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            return reject(new Error(`HTTP ${res.status} for ${url}`));
          }
          try {
            const json = JSON.parse(res.responseText);
            resolve(json);
          } catch (e) {
            reject(new Error('JSON parse error: ' + e));
          }
        },
        onerror: () => reject(new Error('Network error: ' + url)),
        ontimeout: () => reject(new Error('Timeout: ' + url))
      });
    });
  }

  function normalizeSize(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/^SIZE[:\s]+/, '')  // "Size: M" → "M"
      .replace(/\s+/g, '');
  }

  function clickUpdateProductButton() {
    const btn =
      document.querySelector('input[type="submit"][name="edit"]') ||
      document.querySelector('button[name="edit"]');
    if (!btn) {
      console.warn('[EAN Scraper | Colomoda] Geen save-knop gevonden');
      return false;
    }
    console.log('[EAN Scraper | Colomoda] Autosave: klik op "Update product".');
    btn.click();
    return true;
  }

  function isTab3Active() {
    const headerActive = document.querySelector(
      '#tabs .ui-tabs-active a[href="#tabs-3"], ' +
      '#tabs .active a[href="#tabs-3"], ' +
      '#tabs li.current a[href="#tabs-3"]'
    );
    if (headerActive) return true;
    const panel = document.getElementById('tabs-3');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.height !== '0px';
  }

  function hasTable() {
    return !!$(TABLE_SELECTOR);
  }

  function getBrandTitle() {
    const c = $(BRAND_TITLE_SELECTOR);
    const titleAttr = c?.getAttribute('title') || '';
    const text      = c?.textContent || '';
    const selectText =
      $('#tabs-1 select[name="brand"] option:checked')?.textContent || '';
    return (titleAttr || text || selectText || '').replace(/\u00A0/g, ' ').trim();
  }

  function isMundoUnicoBrand() {
    const t = getBrandTitle().toLowerCase();
    return !!t && t.includes('mundo unico');
  }

// als leverancier 0 stock heeft → altijd 1 zetten lokaal
function mapRemoteToLocalStock(remoteQty, _localBefore = 0) {
  const n = Number(remoteQty) || 0;

  if (n <= 0) return 1; // leverancier 0 → toch 1 in DDO
  if (n <= 2) return 1; // 1–2
  if (n === 3) return 2; // 3
  if (n === 4) return 3; // 4
  if (n > 4)  return 5; // >4

  return 1;
}

  // ---------- Colomoda logic ----------

 async function findProductSlugByCode(code) {
  const searchPath = `/search/${encodeURIComponent(code)}/`;
  const jsonUrl    = `${COL_BASE}${searchPath}?format=json`;

  console.log('[EAN Scraper | Colomoda] Search JSON URL:', jsonUrl);

  const data = await httpGetJson(jsonUrl);

  const page       = data.page || {};
  const collection = data.collection || {};
  const candidates = [];

  // 🔹 Echte producten staan hier:
  if (collection.products) {
    candidates.push(...Object.values(collection.products));
  }

  // 🔹 Extra fallback: sommige JSON’s hebben ook hier nog producten
  if (page.products) {
    candidates.push(...Object.values(page.products));
  }
  if (page.recent) {
    candidates.push(...Object.values(page.recent));
  }

  if (!candidates.length) {
    console.warn('[EAN Scraper | Colomoda] Geen producten in JSON voor code', code, data);
    throw new Error(`Geen resultaten voor code "${code}"`);
  }

  const normCode = String(code || '').trim().toUpperCase();

  // Eerst exact matchen op artikelcode
  const matchExact = candidates.find(
    p => String(p.code || '').trim().toUpperCase() === normCode
  );

  const picked = matchExact || candidates[0];

  if (!picked || !picked.url) {
    throw new Error(`Geen product-URL gevonden voor code "${code}"`);
  }

  console.log('[EAN Scraper | Colomoda] Found product slug via JSON:', picked.url);
  return picked.url; // bv. "mundo-unico-bancal-boxershort.html"
}


  async function getVariantsFromProductSlug(slug) {
    const prodUrl = `${COL_BASE}/${slug}?format=json`;
    console.log('[EAN Scraper | Colomoda] Product JSON URL:', prodUrl);
    const data = await httpGetJson(prodUrl);

    const product = data.product;
    if (!product || !product.variants) {
      throw new Error('Geen product/varianten in product JSON');
    }

    const variants = Object.values(product.variants).map(v => ({
      id: v.id,
      code: v.code,
      title: v.title,          // maat, bv. "M" of "XL"
      sizeKey: normalizeSize(v.title),
      ean: v.ean || '',
      sku: v.sku || '',
      stockLevel: v.stock && typeof v.stock.level === 'number'
        ? v.stock.level
        : 0
    }));

    console.log('[EAN Scraper | Colomoda] Variants:', variants);
    return variants;
  }

  // ---------- Toepassen in DDO ----------

 function applyToDdoTable(variants) {
  const table = document.querySelector(TABLE_SELECTOR);
  if (!table) {
    console.warn('[EAN Scraper | Colomoda] Geen #tabs-3 table.options gevonden');
    return 0;
  }

  // Map: sizeKey → variant
  const varMap = new Map();
  for (const v of variants) {
    if (!v.sizeKey) continue;
    if (!varMap.has(v.sizeKey)) {
      varMap.set(v.sizeKey, v);
    }
  }

  const rows = $$('tbody tr', table);
  const report = [];
  let changed = 0;

  rows.forEach((row, idx) => {
    const sizeInput = row.querySelector('td input.product_option_small');
    if (!sizeInput) return;

    const sizeRaw  = sizeInput.value || '';
    const sizeNorm = normalizeSize(sizeRaw);
    if (!sizeNorm) return;

    // Iets ruimer zoeken naar stockvelden
    const stockInput =
      row.querySelector('input[name^="options"][name$="[stock]"]') ||
      row.querySelector('input[name*="[stock]"]') ||
      row.querySelector('input[name*="stock"]');

    const eanInput = row.querySelector(
      'input[name^="options"][name$="[barcode]"], ' +
      'input[name*="[ean]"], input[name*="ean"]'
    );

    const variant = varMap.get(sizeNorm);

    if (!variant) {
      report.push({
        row: idx,
        size: sizeRaw,
        match: 'geen variant',
        remoteQty: 0,
        mappedStock: '(nvt)',
        ean: ''
      });
      return;
    }

    const remoteQty   = variant.stockLevel || 0;
    const mappedStock = mapRemoteToLocalStock(remoteQty, 0);
    const ean         = variant.ean ? String(variant.ean).trim() : '';

    let rowChanged = false;

    // STOCK: altijd schrijven (ook bij 0 → wordt 1 gemapt)
    if (stockInput) {
      const newStock = String(mappedStock);
      console.log(
        `[EAN Scraper | Colomoda] rij ${idx} maat ${sizeRaw}: stock = ${remoteQty} → mapped ${newStock}`
      );
      stockInput.value = newStock;
      stockInput.dispatchEvent(new Event('input', { bubbles: true }));
      rowChanged = true;
    } else {
      console.warn(
        `[EAN Scraper | Colomoda] rij ${idx} maat ${sizeRaw}: géén stockInput gevonden`
      );
    }

    // EAN: altijd schrijven als we er één hebben
    if (eanInput && ean) {
      console.log(
        `[EAN Scraper | Colomoda] rij ${idx} maat ${sizeRaw}: EAN = ${ean}`
      );
      eanInput.value = ean;
      eanInput.dispatchEvent(new Event('input', { bubbles: true }));
      rowChanged = true;
    } else if (!eanInput) {
      console.warn(
        `[EAN Scraper | Colomoda] rij ${idx} maat ${sizeRaw}: géén eanInput gevonden`
      );
    }

    if (rowChanged) {
      changed++;
      const oldBg = row.style.backgroundColor;
      row.style.transition = 'background-color .4s';
      row.style.backgroundColor = '#d4edda';
      setTimeout(() => {
        row.style.backgroundColor = oldBg || '';
      }, 1500);
    }

    report.push({
      row: idx,
      size: sizeRaw,
      match: 'OK',
      remoteQty,
      mappedStock,
      ean
    });
  });

  console.groupCollapsed('[EAN Scraper | Colomoda] Resultaat per maat');
  console.table(report);
  console.groupEnd();

  console.log('[EAN Scraper | Colomoda] Aantal rijen overschreven:', changed);
  return changed;
}

  // ---------- Hoofdactie ----------

async function runColomodaScrape(autoSave) {
  try {
    if (!isMundoUnicoBrand()) {
      console.warn('[EAN Scraper | Colomoda] Merk is niet "Mundo Unico" → abort.');
      return;
    }

    if (!isTab3Active()) {
      console.warn('[EAN Scraper | Colomoda] Tab #tabs-3 niet actief → abort.');
      return;
    }

    if (!hasTable()) {
      console.warn('[EAN Scraper | Colomoda] Geen maten/opties tabel gevonden → abort.');
      return;
    }

    const pidInput = $(PID_SELECTOR);
    const supplierPid = pidInput && pidInput.value ? pidInput.value.trim() : '';
    if (!supplierPid) {
      console.warn('[EAN Scraper | Colomoda] Geen Supplier PID op tab 1 → abort.');
      return;
    }

    console.log('[EAN Scraper | Colomoda] Start voor Supplier PID:', supplierPid);

    const slug     = await findProductSlugByCode(supplierPid);
    const variants = await getVariantsFromProductSlug(slug);

    const changed = applyToDdoTable(variants);

    console.log(
      `[EAN Scraper | Colomoda] Klaar: ${changed} rijen overschreven voor PID ${supplierPid}`
    );

    if (autoSave && changed > 0) {
      // kleine delay zodat alle DOM-updates "settlen"
      setTimeout(() => {
        clickUpdateProductButton();
      }, 200);
    }

  } catch (e) {
    console.error('[EAN Scraper | Colomoda] Fout:', e);
  }
}

  // ---------- Button visibility ----------

  function updateButtonVisibility() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const visible = isMundoUnicoBrand() && isTab3Active() && hasTable();

    btn.style.display = visible ? '' : 'none';

    if (!hasTable()) {
      btn.title = 'Wachten tot #tabs-3 geladen is...';
    } else if (!isTab3Active()) {
      btn.title = 'Ga naar tab Maten/Opties (#tabs-3).';
    } else if (!isMundoUnicoBrand()) {
      btn.title = 'Button alleen zichtbaar bij merk "Mundo Unico".';
    } else {
      btn.title = 'Haalt EAN + stock (mapped) uit Colomoda.\nHotkey: Ctrl+Shift+S (met autosave).';
    }
  }

  // ---------- Hotkey (Ctrl+Shift+S) ----------

  function onKeydown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
      return; // niet triggeren als iemand typt
    }

    const key = (e.key || '').toLowerCase();
    const match =
      key === HOTKEY.key &&
      !!e.ctrlKey === HOTKEY.ctrl &&
      !!e.shiftKey === HOTKEY.shift &&
      !!e.altKey === HOTKEY.alt;

    if (!match) return;
    if (!isTab3Active()) return;
    if (!isMundoUnicoBrand()) return;

    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.style.display === 'none' || btn.disabled) return;

    e.preventDefault();
    console.log('[EAN Scraper | Colomoda] Hotkey Ctrl+Shift+S');
    runColomodaScrape(true); // met autosave
  }

  // ---------- Knop ----------

  function addButton() {
    if (!document.body) return;
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⛏️ EAN+Stock | Colomoda';
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 10px;
      z-index: 999999;
      padding: 8px 10px;
      background: #152e4f;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
      font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    btn.addEventListener('click', () => runColomodaScrape(false));
    document.body.appendChild(btn);

    updateButtonVisibility();
  }

  function boot() {
    addButton();
    document.addEventListener('keydown', onKeydown);

    // Poll elke 2s om button visibility te updaten bij tab/merk wijzigingen
    setInterval(updateButtonVisibility, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
