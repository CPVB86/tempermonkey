// ==UserScript==
// @name         DDO | Model Checker Chantelle
// @namespace    https://runiversity.nl/
// @version      1.2.0
// @description  Vergelijkt Chantelle artikelen op B2B met DDO export + NME export
// @match        https://chantelle-lingerie.my.site.com/*
// @grant        GM_xmlhttpRequest
// @connect      dutchdesignersoutlet.com
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/chantelle.user.js
// ==/UserScript==

(function () {
  'use strict';

  const EXPORTS = {
    ddo: {
      label: 'DDO',
      tagId: 237,
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=237',
      payload: { format: 'excel', export: 'Export products' },
      statusText: 'In DDO',
    },
    nme: {
      label: 'NME',
      tagId: 240,
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=240',
      payload: { format: 'excel', export: 'Export products' },
      statusText: 'NME',
    },
  };

  const STORAGE_KEY_PREFIX = 'ddoModelCheckerCacheV8:chantelle';
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const IMAGE_PREFIX = 'https://www.dutchdesignersoutlet.com/img/product/';

  const SHEET_PREFERRED = 'Parent';
  const COL_IMAGE = 1;
  const COL_PRODUCT_ID = 3;
  const HEADER_ROW_INDEX = 0;

  const STATUS = {
    DDO: 'In DDO',
    NME: 'NME',
    MISS: 'Niet in DDO',
  };

  const state = {
    ddoMap: null,
    nmeMap: null,
    observer: null,
    compareTimer: null,
    loading: false,
    minimized: false,
  };

  injectCSS(`
    #ddo-model-checker {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      width: 340px;
      max-width: calc(100vw - 32px);
      background: #111827;
      color: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.28);
      padding: 14px;
      font: 13px/1.4 Arial, sans-serif;
    }

    #ddo-model-checker * {
      box-sizing: border-box;
      font: inherit;
    }

    #ddo-model-checker .ddo-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    #ddo-model-checker .ddo-title {
      font-weight: 700;
      font-size: 14px;
      margin: 0;
    }

    #ddo-model-checker .ddo-toggle-btn {
      background: rgba(255,255,255,.12);
      color: #fff;
      border: 0;
      border-radius: 8px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-weight: 700;
      line-height: 1;
    }

    #ddo-model-checker .ddo-toggle-btn:hover {
      background: rgba(255,255,255,.2);
    }

    #ddo-model-checker .ddo-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    #ddo-model-checker button:not(.ddo-toggle-btn) {
      border: 0;
      border-radius: 8px;
      padding: 8px 10px;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
      white-space: nowrap;
    }

    #ddo-model-checker button:disabled {
      opacity: .65;
      cursor: wait;
    }

    #ddo-model-checker .ddo-status {
      background: rgba(255,255,255,.08);
      border-radius: 8px;
      padding: 8px 10px;
      min-height: 38px;
      word-break: break-word;
    }

    #ddo-model-checker .ddo-summary {
      margin-top: 8px;
      font-size: 12px;
      opacity: .95;
      white-space: pre-wrap;
    }

    #ddo-remove-matches-btn {
      background: #dc2626 !important;
    }

    #ddo-export-csv-btn {
      background: #059669 !important;
    }

    #ddo-remove-matches-btn:hover,
    #ddo-refresh-btn:hover,
    #ddo-export-csv-btn:hover {
      filter: brightness(1.08);
    }

    .ddo-card-checked {
      outline: 2px solid transparent !important;
      outline-offset: 2px !important;
      position: relative !important;
      transition: outline-color .2s ease !important;
    }

    .ddo-card-match {
      outline-color: #16a34a !important;
    }

    .ddo-card-nme {
      outline-color: #111111 !important;
    }

    .ddo-card-miss {
      outline-color: #dc2626 !important;
    }

    .ddo-card-match .cc_grid_image_container,
    .ddo-card-match .thumbnail,
    .ddo-card-match .couponImage,
    .ddo-card-nme .cc_grid_image_container,
    .ddo-card-nme .thumbnail,
    .ddo-card-nme .couponImage {
      opacity: 0.45 !important;
      transition: opacity .2s ease !important;
    }

    .ddo-card-match:hover .cc_grid_image_container,
    .ddo-card-match:hover .thumbnail,
    .ddo-card-match:hover .couponImage,
    .ddo-card-nme:hover .cc_grid_image_container,
    .ddo-card-nme:hover .thumbnail,
    .ddo-card-nme:hover .couponImage {
      opacity: 0.72 !important;
    }

    .ddo-card-checked .cc_grid_product_info,
    .ddo-card-checked .cc_grid_product_info *,
    .ddo-card-checked .cc_price_container,
    .ddo-card-checked .cc_price_container *,
    .ddo-card-checked .cc_product_grid_actions,
    .ddo-card-checked .cc_product_grid_actions * {
      opacity: 1 !important;
    }

    .ddo-card-checked::before {
      content: attr(data-ddo-status);
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 20;
      border-radius: 999px;
      padding: 4px 8px;
      font: 12px/1 Arial, sans-serif;
      font-weight: 700;
      color: #fff;
      box-shadow: 0 4px 12px rgba(0,0,0,.18);
      pointer-events: none;
      user-select: none;
    }

    .ddo-card-match::before {
      background: #16a34a;
    }

    .ddo-card-nme::before {
      background: #111111;
    }

    .ddo-card-miss::before {
      background: #dc2626;
    }

    .ddo-card-checked::after {
      content: attr(data-ddo-code);
      position: absolute;
      left: 8px;
      bottom: 8px;
      max-width: calc(100% - 16px);
      display: inline-block;
      padding: 3px 7px;
      border-radius: 999px;
      background: rgba(255,255,255,.92);
      color: #111827;
      font: 11px/1.2 Arial, sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      user-select: none;
      z-index: 20;
    }

    .ddo-pdp-pill {
      display: inline-flex;
      align-items: center;
      margin-left: 10px;
      padding: 3px 10px;
      border-radius: 999px;
      font: 12px/1.2 Arial, sans-serif;
      font-weight: 700;
      vertical-align: middle;
      white-space: nowrap;
      color: #fff;
    }

    .ddo-pdp-pill--match {
      background: #16a34a;
    }

    .ddo-pdp-pill--nme {
      background: #111111;
    }

    .ddo-pdp-pill--miss {
      background: #dc2626;
    }
  `);

  init();
  initPageSizeExtension();

  async function init() {
    createPanel();
    bindEvents();
    enableNativeModifierClick();
    startObserver();
    await loadAndCompare();
    applyPDPBadge();
  }

  function createPanel() {
    if (document.querySelector('#ddo-model-checker')) return;

    const panel = document.createElement('div');
    panel.id = 'ddo-model-checker';
    panel.innerHTML = `
      <div class="ddo-head">
        <div class="ddo-title">Model-checker Chantelle</div>
        <button id="ddo-toggle-btn" type="button" class="ddo-toggle-btn" title="Minimaliseer">−</button>
      </div>

      <div id="ddo-panel-body">
        <div class="ddo-row">
          <button id="ddo-refresh-btn" type="button">Check</button>
          <button id="ddo-remove-matches-btn" type="button">Verwijder In DDO</button>
          <button id="ddo-export-csv-btn" type="button">Export CSV</button>
        </div>

        <div id="ddo-status" class="ddo-status">Klaar.</div>
        <div id="ddo-summary" class="ddo-summary"></div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  function bindEvents() {
    const button = document.querySelector('#ddo-refresh-btn');
    const removeBtn = document.querySelector('#ddo-remove-matches-btn');
    const exportBtn = document.querySelector('#ddo-export-csv-btn');
    const toggleBtn = document.querySelector('#ddo-toggle-btn');

    button?.addEventListener('click', async () => {
      await loadAndCompare({ forceRefresh: true });
    });

    removeBtn?.addEventListener('click', () => {
      const removed = removeMatchedCards();
      setStatus(`${removed} cards met "In DDO" verwijderd.`);
    });

    exportBtn?.addEventListener('click', () => {
      const count = exportGridUrlsToCSV();
      setStatus(`${count} product-URL's geëxporteerd naar CSV.`);
    });

    toggleBtn?.addEventListener('click', () => {
      state.minimized = !state.minimized;
      const body = document.querySelector('#ddo-panel-body');
      const btn = document.querySelector('#ddo-toggle-btn');

      if (!body || !btn) return;

      if (state.minimized) {
        body.style.display = 'none';
        btn.textContent = '+';
        btn.title = 'Open';
      } else {
        body.style.display = '';
        btn.textContent = '−';
        btn.title = 'Minimaliseer';
      }
    });
  }

  function enableNativeModifierClick() {
    if (document.documentElement.dataset.ddoModifierClickBound === 'true') return;
    document.documentElement.dataset.ddoModifierClickBound = 'true';

    document.addEventListener('click', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.defaultPrevented) return;

      const link = event.target.closest('a[href*="ccrz__ProductDetails"]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      const absoluteUrl = new URL(href, location.origin).toString();

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      window.open(absoluteUrl, '_blank', 'noopener');
    }, true);

    document.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;

      const link = event.target.closest('a[href*="ccrz__ProductDetails"]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      const absoluteUrl = new URL(href, location.origin).toString();

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      window.open(absoluteUrl, '_blank', 'noopener');
    }, true);
  }

  function setStatus(text) {
    const el = document.querySelector('#ddo-status');
    if (el) el.textContent = text;
  }

  function setSummary(text) {
    const el = document.querySelector('#ddo-summary');
    if (el) el.textContent = text;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const btn = document.querySelector('#ddo-refresh-btn');
    if (btn) btn.disabled = isLoading;
  }

  async function loadAndCompare(options = {}) {
    const { forceRefresh = false } = options;

    try {
      setLoading(true);
      setStatus('Bezig met ophalen van DDO + NME export…');
      setSummary('');

      const [ddoMap, nmeMap] = await Promise.all([
        getArticleMap('ddo', forceRefresh),
        getArticleMap('nme', forceRefresh),
      ]);

      state.ddoMap = ddoMap;
      state.nmeMap = nmeMap;

      setStatus(`Exports geladen. DDO: ${ddoMap.size} | NME: ${nmeMap.size}`);
      runCompare();
    } catch (err) {
      console.error('[DDO Model Checker] Error:', err);
      setStatus(`Fout: ${err.message || err}`);
      setSummary('');
    } finally {
      setLoading(false);
    }
  }

  function runCompare() {
    if (!state.ddoMap || !state.nmeMap) {
      setStatus('Geen exportdata geladen.');
      return;
    }

    const cards = findProductCards();
    let total = 0;
    let matches = 0;
    let nmes = 0;
    let misses = 0;

    for (const card of cards) {
      const code = extractChantelleCodeFromCard(card);
      if (!code) continue;

      total += 1;

      const result = getStatusForCode(code);
      markCard(card, result, code);

      if (result.status === STATUS.NME) nmes += 1;
      else if (result.status === STATUS.DDO) matches += 1;
      else misses += 1;
    }

    setStatus('Chantelle gecontroleerd.');
    setSummary(`Cards: ${total} | In DDO: ${matches} | NME: ${nmes} | Niet in DDO: ${misses}`);
    applyPDPBadge();
  }

  function getStatusForCode(code) {
    const nmeInfo = state.nmeMap.get(code);
    if (nmeInfo) {
      return {
        status: STATUS.NME,
        productId: nmeInfo.productId || null,
        ddoEditId: nmeInfo.ddoEditId || null,
      };
    }

    const ddoInfo = state.ddoMap.get(code);
    if (ddoInfo) {
      return {
        status: STATUS.DDO,
        productId: ddoInfo.productId || null,
        ddoEditId: ddoInfo.ddoEditId || null,
      };
    }

    return {
      status: STATUS.MISS,
      productId: null,
      ddoEditId: null,
    };
  }

  function applyPDPBadge() {
    if (!state.ddoMap || !state.nmeMap) return;

    const pdpItems = Array.from(document.querySelectorAll('.product_detail_item'));
    if (!pdpItems.length) return;

    for (const item of pdpItems) {
      const titleEl = item.querySelector('h4.product_title.cc_product_title, h4.product_title');
      if (!titleEl) continue;

      const code = extractChantelleCodeFromPDP(item);
      if (!code) continue;

      const result = getStatusForCode(code);
      upsertPDPBadge(titleEl, result.status);
    }
  }

  function extractChantelleCodeFromPDP(item) {
    if (!item) return null;

    const candidates = [];

    if (item.dataset?.sku) {
      candidates.push(item.dataset.sku);
    }

    const skuValue = item.querySelector('.sku .value.cc_value, .cc_sku .cc_value');
    if (skuValue?.textContent) {
      candidates.push(skuValue.textContent);
    }

    const colorLinks = item.querySelectorAll('#color a[href*="sku="]');
    for (const link of colorLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/[?&]sku=([^&]+)/i);
      if (match && match[1]) {
        try {
          candidates.push(decodeURIComponent(match[1]));
        } catch {
          candidates.push(match[1]);
        }
      }
    }

    for (const value of candidates) {
      const normalized = normalizeDDOCode(value);
      if (normalized) return normalized;
    }

    return null;
  }

  function upsertPDPBadge(titleEl, status) {
    if (!titleEl) return;

    let pill = titleEl.querySelector('.ddo-pdp-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'ddo-pdp-pill';
      titleEl.appendChild(pill);
    }

    pill.classList.remove('ddo-pdp-pill--match', 'ddo-pdp-pill--nme', 'ddo-pdp-pill--miss');

    if (status === STATUS.NME) {
      pill.classList.add('ddo-pdp-pill--nme');
      pill.textContent = STATUS.NME;
    } else if (status === STATUS.DDO) {
      pill.classList.add('ddo-pdp-pill--match');
      pill.textContent = STATUS.DDO;
    } else {
      pill.classList.add('ddo-pdp-pill--miss');
      pill.textContent = STATUS.MISS;
    }
  }

  async function getArticleMap(exportKey, forceRefresh = false) {
    const cached = !forceRefresh ? readCache(exportKey) : null;
    if (cached) return new Map(cached);

    const conf = EXPORTS[exportKey];
    if (!conf) throw new Error(`Onbekende export: ${exportKey}`);

    const arrayBuffer = await fetchExport(conf.exportUrl, conf.payload);
    const articleMap = parseArticleMapFromWorkbook(arrayBuffer);

    writeCache(exportKey, [...articleMap.entries()]);
    return articleMap;
  }

  function fetchExport(url, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        data: new URLSearchParams(payload).toString(),
        responseType: 'arraybuffer',
        timeout: 60000,
        onload: (res) => {
          try {
            if (res.status !== 200) {
              throw new Error(`HTTP ${res.status} bij export ophalen`);
            }
            if (!res.response || !res.response.byteLength) {
              throw new Error('Lege export ontvangen');
            }
            resolve(res.response);
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('Netwerkfout bij export ophalen')),
        ontimeout: () => reject(new Error('Timeout bij export ophalen')),
      });
    });
  }

  function exportGridUrlsToCSV() {
    const rows = getGridExportRows();

    if (!rows.length) {
      setStatus('Geen product-URL\'s gevonden in de grid.');
      return 0;
    }

    const csvRows = [['URL', 'Status']];
    for (const row of rows) {
      csvRows.push([row.url, row.status]);
    }

    const csv = toCSV(csvRows);
    const filename = `chantelle-grid-urls-${formatDateForFilename(new Date())}.csv`;

    downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
    return rows.length;
  }

  function getGridExportRows() {
    const cards = findProductCards();
    const rows = [];
    const seen = new Set();

    for (const card of cards) {
      const link = card.querySelector('.cc_product_link a[href*="ccrz__ProductDetails"]');
      if (!link) continue;

      const href = link.getAttribute('href') || '';
      const cleanUrl = buildCleanProductUrl(href);
      if (!cleanUrl || seen.has(cleanUrl)) continue;

      const code = extractChantelleCodeFromCard(card);
      const result = code ? getStatusForCode(code) : { status: STATUS.MISS };

      rows.push({
        url: cleanUrl,
        status: result.status,
      });

      seen.add(cleanUrl);
    }

    return rows;
  }

  function toCSV(rows) {
    return rows
      .map(cols => cols.map(escapeCSVValue).join(','))
      .join('\n');
  }

  function escapeCSVValue(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n;]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function buildCleanProductUrl(rawHref) {
    if (!rawHref) return null;

    try {
      const url = new URL(rawHref, location.origin);
      const sku = url.searchParams.get('sku');
      if (!sku) return null;

      return `${url.origin}${url.pathname}?sku=${encodeURIComponent(sku)}`;
    } catch {
      return null;
    }
  }

  function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  function formatDateForFilename(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');

    return `${y}${m}${d}-${hh}${mm}`;
  }

  function initPageSizeExtension() {
    applyPageSizeExtension();

    const observer = new MutationObserver(() => {
      applyPageSizeExtension();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function applyPageSizeExtension() {
    const select = document.querySelector('.cc_page_size_control');
    if (!select) return;

    const total = getTotalProductCount();
    if (!total) return;

    const exists = Array.from(select.options).some(option => option.value === String(total));
    if (exists) return;

    const totalOption = document.createElement('option');
    totalOption.value = String(total);
    totalOption.textContent = `${total} resultaten`;
    select.appendChild(totalOption);
  }

  function getTotalProductCount() {
    const el = document.querySelector('.cc_product_results_tagline');
    if (!el) return null;

    const text = el.textContent || '';
    const match = text.match(/van\s+(\d+)\s+producten/i);

    return match ? parseInt(match[1], 10) : null;
  }

  function parseArticleMapFromWorkbook(arrayBuffer) {
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: 'array' });
    } catch (err) {
      throw new Error('Excel-bestand kon niet worden gelezen');
    }

    if (!workbook.SheetNames?.length) {
      throw new Error('Geen sheets gevonden in export');
    }

    const preferredNames = [];
    if (workbook.SheetNames.includes(SHEET_PREFERRED)) {
      preferredNames.push(SHEET_PREFERRED);
    }
    for (const name of workbook.SheetNames) {
      if (!preferredNames.includes(name)) preferredNames.push(name);
    }

    let bestMap = new Map();

    for (const sheetName of preferredNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      });

      if (!rows.length) continue;

      const map = new Map();

      for (let r = HEADER_ROW_INDEX + 1; r < rows.length; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        const rawImage = row[COL_IMAGE];
        const rawProductId = row[COL_PRODUCT_ID];

        if (rawProductId == null || rawProductId === '') continue;

        const normalizedCode = normalizeDDOCode(rawProductId);
        if (!normalizedCode) continue;

        const ddoEditId = extractDDOEditIdFromImageField(rawImage);
        const productId = extractProductIdFromImageField(rawImage);

        map.set(normalizedCode, {
          ddoEditId: ddoEditId || null,
          productId: productId || null,
        });
      }

      if (map.size > bestMap.size) {
        bestMap = map;
      }

      if (sheetName === SHEET_PREFERRED && map.size > 0) {
        break;
      }
    }

    if (!bestMap.size) {
      throw new Error('Geen bruikbare Product ID koppelingen gevonden.');
    }

    return bestMap;
  }

  function findProductCards() {
    return Array.from(document.querySelectorAll('.cc_product_item.cc_grid_item'));
  }

  function extractChantelleCodeFromCard(card) {
    if (!card) return null;

    const candidates = [];

    const couponImage = card.querySelector('.couponImage[data-id]');
    if (couponImage?.dataset?.id) {
      candidates.push(couponImage.dataset.id);
    }

    const stockBtn = card.querySelector('.CLCheckStock[id]');
    if (stockBtn?.id) {
      candidates.push(stockBtn.id);
    }

    const productLink = card.querySelector('.cc_product_link a[data-id]');
    if (productLink?.dataset?.id) {
      candidates.push(productLink.dataset.id);
    }

    const refValue = extractReferenceText(card);
    if (refValue) {
      candidates.push(refValue);
    }

    for (const value of candidates) {
      const normalized = normalizeDDOCode(value);
      if (normalized) return normalized;
    }

    return null;
  }

  function extractReferenceText(card) {
    const labels = Array.from(card.querySelectorAll('.cc_product_sku'));
    for (const el of labels) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;

      if (/^C[0-9A-Z]+-[0-9A-Z]+$/i.test(text)) {
        return text;
      }

      const match = text.match(/Referentie:\s*([A-Z0-9]+-[A-Z0-9]+)/i);
      if (match) return match[1];
    }
    return null;
  }

  function markCard(card, result, code) {
    card.classList.add('ddo-card-checked');
    card.classList.remove('ddo-card-match', 'ddo-card-nme', 'ddo-card-miss');

    if (result.status === STATUS.NME) {
      card.classList.add('ddo-card-nme');
    } else if (result.status === STATUS.DDO) {
      card.classList.add('ddo-card-match');
    } else {
      card.classList.add('ddo-card-miss');
    }

    card.dataset.ddoStatus = result.status;
    card.dataset.ddoCode = buildCardCodeLabel(code, result.productId);
  }

  function buildCardCodeLabel(code, productId) {
    return productId ? `${code} · PID ${productId}` : code;
  }

  function clearCardMarkers() {
    document.querySelectorAll('.ddo-card-checked').forEach(card => {
      card.classList.remove('ddo-card-checked', 'ddo-card-match', 'ddo-card-nme', 'ddo-card-miss');
      delete card.dataset.ddoStatus;
      delete card.dataset.ddoCode;
    });
  }

  function removeMatchedCards() {
    const cards = document.querySelectorAll('.ddo-card-match');
    let removed = 0;

    cards.forEach(card => {
      card.remove();
      removed++;
    });

    const remainingCards = findProductCards();
    let total = 0;
    let matches = 0;
    let nmes = 0;
    let misses = 0;

    for (const card of remainingCards) {
      if (!card.classList.contains('ddo-card-checked')) continue;
      total++;
      if (card.classList.contains('ddo-card-match')) matches++;
      else if (card.classList.contains('ddo-card-nme')) nmes++;
      else if (card.classList.contains('ddo-card-miss')) misses++;
    }

    setSummary(`Cards: ${total} | In DDO: ${matches} | NME: ${nmes} | Niet in DDO: ${misses}`);
    return removed;
  }

  function startObserver() {
    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver(() => {
      if (!state.ddoMap || !state.nmeMap || state.loading) return;
      debounceCompare();
    });

    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function debounceCompare() {
    clearTimeout(state.compareTimer);
    state.compareTimer = setTimeout(() => {
      clearCardMarkers();
      runCompare();
    }, 450);
  }

  function normalizeDDOCode(value) {
    if (value == null) return null;

    let s = String(value).trim().toUpperCase();
    if (!s) return null;

    s = s.replace(/[‐-–—]/g, '-');
    s = s.replace(/\s+/g, ' ').trim();

    let m = s.match(/^([A-Z0-9]+)\s*-\s*([A-Z0-9]{2,10})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/^([A-Z0-9]+)\s+([A-Z0-9]{2,10})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/\b([A-Z0-9]+)\s*[- ]\s*([A-Z0-9]{2,10})\b/);
    if (m) return `${m[1]}-${m[2]}`;

    return null;
  }

  function extractDDOEditIdFromImageField(imageField) {
    if (imageField == null) return null;

    const text = String(imageField).trim();
    if (!text) return null;

    const firstPart = text.split('|')[0].trim();
    if (!firstPart.startsWith(IMAGE_PREFIX)) return null;

    const rest = firstPart.slice(IMAGE_PREFIX.length);
    const match = rest.match(/^(\d{5,6})/);

    return match ? match[1] : null;
  }

  function extractProductIdFromImageField(imageField) {
    if (imageField == null) return null;

    const text = String(imageField).trim();
    if (!text) return null;

    const firstPart = text.split('|')[0].trim();
    if (!firstPart.startsWith(IMAGE_PREFIX)) return null;

    const rest = firstPart.slice(IMAGE_PREFIX.length);
    const match = rest.match(/^(\d{6})/);

    return match ? match[1] : null;
  }

  function getCacheKey(exportKey) {
    return `${STORAGE_KEY_PREFIX}:${exportKey}`;
  }

  function readCache(exportKey) {
    try {
      const raw = localStorage.getItem(getCacheKey(exportKey));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp || !Array.isArray(parsed.items)) return null;
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;

      return parsed.items;
    } catch {
      return null;
    }
  }

  function writeCache(exportKey, items) {
    try {
      localStorage.setItem(
        getCacheKey(exportKey),
        JSON.stringify({
          timestamp: Date.now(),
          items,
        })
      );
    } catch (err) {
      console.warn('[DDO Model Checker] Cache opslaan mislukt:', err);
    }
  }

  function injectCSS(css) {
    const id = 'ddo-model-checker-style';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
