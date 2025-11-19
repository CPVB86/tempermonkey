// ==UserScript==
// @name         EAN Scraper | Zetex
// @version      0.3
// @description  Haal stock + EAN uit Zetex B2B (Wicket JSON) obv Supplier PID + maat en plak ze in #tabs-3.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      b2b.zetex.nl
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scraper-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scraper-zetex.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'zetex-stock-ean-scraper-btn';
  const TABLE_SELECTOR = '#tabs-3 table.options';
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  const ZETEX_BASE_URL = 'https://b2b.zetex.nl';
  const ZETEX_PRODUCT_PREFIX = '/webstore/v2/product/Zetex_01';

  const LOG_PREFIX = '[Stock+EAN Scraper | Zetex]';

  const $ = (s, r = document) => r.querySelector(s);

  // --- Stock mapping (jouw logica) -------------------------------------------

  function mapQtyToStockLevel(qty) {
    const n = Number(qty ?? 0) || 0;

    if (n <= 2) return 1;  // 0, 1 of 2 → 1 stuk
    if (n === 3) return 2; // 2 stuks
    if (n === 4) return 3; // 3 stuks

    return 5;              // 5 of meer
  }

  // --- Brand / pagina helpers -------------------------------------------------

  const getBrandTitle = () =>
    document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || '';

  function isZetexBrand() {
    const title = getBrandTitle().toLowerCase();
    // Pas desnoods aan naar jouw merknaam in de admin
    if (!title) return true; // eventueel altijd tonen
    return (
      title.includes('zetex') ||
      title.includes('pastunette') ||
      title.includes('rebelle') ||
      title.includes('robson')
    );
  }

  function hasTable() {
    return !!document.querySelector(TABLE_SELECTOR);
  }

  // --- Supplier PID → product URL --------------------------------------------

  function splitSupplierPid(rawPid) {
    const pid = String(rawPid || '').trim();
    if (!pid) return null;

    const idx = pid.lastIndexOf('-');
    if (idx === -1) return null;

    return {
      base: pid.slice(0, idx),
      color: pid.slice(idx + 1),
    };
  }

  function buildProductUrlFromPidParts(parts) {
    if (!parts || !parts.base || !parts.color) return null;
    return (
      ZETEX_BASE_URL +
      ZETEX_PRODUCT_PREFIX +
      '/' +
      encodeURIComponent(parts.base) +
      '/' +
      encodeURIComponent(parts.color)
    );
  }

  // --- Normalisatie maten -----------------------------------------------------

  // DDO: S M L XL XXL 3XL 4XL ...
  function normalizeLocalSize(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  // Zetex → DDO (2XL moet XXL worden, rest laten we staan)
  const ZETEX_SIZE_MAP = {
    '2XL': 'XXL',
  };

  function normalizeZetexSize(s) {
    let t = String(s || '').trim().toUpperCase().replace(/\s+/g, '');
    if (ZETEX_SIZE_MAP[t]) t = ZETEX_SIZE_MAP[t];
    return t;
  }

  // --- HTTP helpers (via GM_xmlhttpRequest) -----------------------------------

  function gmGet(url, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      onload: (resp) => {
        if (resp.status >= 200 && resp.status < 300) {
          cb(null, resp.responseText);
        } else {
          cb(
            new Error(
              `HTTP ${resp.status} bij ophalen ${url}`
            ),
            null
          );
        }
      },
      onerror: (err) => {
        cb(err || new Error('Netwerkfout'), null);
      },
    });
  }

  // --- Wicket data-URL uit product HTML halen --------------------------------

  function extractDataUrlFromProductHtml(html) {
    const re = /wicketAjaxGet\('([^']*IBehaviorListener\.3-[^']*)'/;
    const m = re.exec(html);
    if (!m) return null;

    let url = m[1];
    if (url.startsWith('/')) {
      url = ZETEX_BASE_URL + url;
    } else if (!/^https?:\/\//i.test(url)) {
      url = ZETEX_BASE_URL.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
    }
    return url;
  }

  // --- JSON uit Wicket XML/JS payload halen ----------------------------------

  function parseSizesFromWicketXml(xmlText) {
    const m = xmlText.match(/"sizes":\s*\{([\s\S]*?)\},"assortments"/);
    if (!m) {
      console.warn(LOG_PREFIX, 'Geen "sizes" blok gevonden in response');
      return new Map();
    }

    let sizesStr = '{' + m[1] + '}';
    sizesStr = sizesStr.replace(/\^/g, ''); // caretjes weg

    let sizesObj;
    try {
      sizesObj = JSON.parse(sizesStr);
    } catch (e) {
      console.error(LOG_PREFIX, 'JSON parse fout op sizesStr:', e, sizesStr);
      return new Map();
    }

    const sizeList = Array.isArray(sizesObj.sizeList)
      ? sizesObj.sizeList
      : [];

    const map = new Map();

    sizeList.forEach((item) => {
      const rawName = item.name;
      const key = normalizeZetexSize(rawName);
      if (!key) return;

      // EAN
      const eanDigits = String(item.eanCode || '').replace(/\D/g, '');

      // Raw stock quantity → jouw mapping 1/2/3/5
      let qtyRaw = 0;
      const stockLevels = item.stockLevels && item.stockLevels.stockLevelList;
      if (Array.isArray(stockLevels) && stockLevels.length) {
        const lvl = stockLevels[0];
        if (lvl && typeof lvl.quantity !== 'undefined') {
          qtyRaw = Number(lvl.quantity) || 0;
        }
      }

      const stockMapped = mapQtyToStockLevel(qtyRaw);

      map.set(key, {
        ean: eanDigits,
        stock: stockMapped,
      });
    });

    console.info(LOG_PREFIX, 'Zetex sizes → map size:', map.size);
    return map;
  }

  // --- Button + UI -----------------------------------------------------------

  function ensureButton() {
    if (!document.body) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '📦 Zetex stock + EAN';
      btn.style.cssText = `
        position: fixed;
        right: 10px;
        top: 130px;
        z-index: 999999;
        padding: 10px 12px;
        background: #2980b9;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);
      btn.addEventListener('click', onScrapeClick);
    }

    const isZetex = isZetexBrand();
    const tableReady = hasTable();

    btn.style.display = isZetex ? '' : 'none';
    btn.disabled = !tableReady;
    btn.style.opacity = tableReady ? '1' : '.55';
    btn.title = tableReady
      ? 'Haal stock + EAN uit Zetex B2B en plak in #tabs-3'
      : 'Wachten tot #tabs-3 geladen is...';
  }

  function setBtnState(opts = {}) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    if (opts.text != null) btn.textContent = opts.text;
    if (opts.bg != null) btn.style.backgroundColor = opts.bg;
    if (opts.disabled != null) btn.disabled = !!opts.disabled;
    if (opts.opacity != null) btn.style.opacity = String(opts.opacity);
  }

  function resetBtn() {
    const tableReady = hasTable() && isZetexBrand();
    setBtnState({
      text: '📦 Zetex stock + EAN',
      bg: '#2980b9',
      disabled: !tableReady,
      opacity: tableReady ? '1' : '.55',
    });
  }

  // --- Hoofdactie ------------------------------------------------------------

  function onScrapeClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    const supplierPid = document.querySelector(PID_SELECTOR)?.value?.trim();
    if (!supplierPid) {
      setBtnState({
        text: '❌ Geen Supplier PID',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const pidParts = splitSupplierPid(supplierPid);
    if (!pidParts) {
      console.warn(LOG_PREFIX, 'Onverwacht PID-formaat:', supplierPid);
      setBtnState({
        text: '❌ PID-formaat onbekend',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const productUrl = buildProductUrlFromPidParts(pidParts);
    if (!productUrl) {
      setBtnState({
        text: '❌ Geen product-URL',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    setBtnState({
      text: '⏳ Zetex product laden...',
      bg: '#f1c40f',
      disabled: true,
      opacity: '.8',
    });

    console.info(LOG_PREFIX, 'Supplier PID:', supplierPid, '→', productUrl);

    // 1) Productpagina ophalen
    gmGet(productUrl, (err, productHtml) => {
      if (err || !productHtml) {
        console.error(LOG_PREFIX, 'Fout bij laden productpagina:', err);
        setBtnState({
          text: '❌ Product niet geladen',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      // 2) Wicket data-URL zoeken (IBehaviorListener.3-)
      const dataUrl = extractDataUrlFromProductHtml(productHtml);
      if (!dataUrl) {
        console.warn(
          LOG_PREFIX,
          'Geen IBehaviorListener.3- URL gevonden in product-HTML'
        );
        setBtnState({
          text: '❌ Geen data-URL gevonden',
          bg: '#e06666',
        });
        setTimeout(resetBtn, 2500);
        return;
      }

      console.info(LOG_PREFIX, 'Data URL:', dataUrl);

      setBtnState({
        text: '⏳ Zetex data laden...',
        bg: '#f39c12',
      });

      // 3) XML/JS payload ophalen
      gmGet(dataUrl, (err2, xmlText) => {
        if (err2 || !xmlText) {
          console.error(
            LOG_PREFIX,
            'Fout bij laden data-payload:',
            err2
          );
          setBtnState({
            text: '❌ Data niet geladen',
            bg: '#e06666',
          });
          setTimeout(resetBtn, 2500);
          return;
        }

        handleZetexData(xmlText);
      });
    });
  }

  function handleZetexData(xmlText) {
    const sizesMap = parseSizesFromWicketXml(xmlText);
    if (!sizesMap || sizesMap.size === 0) {
      setBtnState({
        text: '❌ Geen maten in data',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) {
      setBtnState({
        text: '❌ #tabs-3 niet klaar',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const rows = table.querySelectorAll('tr');
    let matched = 0;

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      const maatInput = cells[0].querySelector('input.product_option_small');
      const maatRaw = maatInput ? maatInput.value : '';
      const maatNorm = normalizeLocalSize(maatRaw);
      if (!maatNorm) return;

      const entry = sizesMap.get(maatNorm);
      if (!entry) return;

      const { stock, ean } = entry;

      const stockInput = row.querySelector(
        'input[name^="options"][name$="[stock]"]'
      );
      const eanInput = row.querySelector(
        'input[name^="options"][name$="[barcode]"]'
      );

      if (stockInput) {
        stockInput.value = String(stock);
        stockInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (eanInput && ean) {
        eanInput.value = String(ean);
        eanInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      matched++;
    });

    console.info(LOG_PREFIX, `${matched} rijen ingevuld uit Zetex B2B`);
    setBtnState({
      text: `📦 ${matched} rijen gevuld`,
      bg: '#2ecc71',
      disabled: false,
      opacity: '1',
    });
    setTimeout(resetBtn, 2500);
  }

  // --- Observer + lifecycle ---------------------------------------------------

  const observer = new MutationObserver(() => ensureButton());

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'MutationObserver fout:', e);
    }
  }

  window.addEventListener('pageshow', ensureButton);
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureButton();
  });
  window.addEventListener('hashchange', ensureButton);
  window.addEventListener('popstate', ensureButton);

  ensureButton();
  startObserver();
})();
