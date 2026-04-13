// ==UserScript==
// @name         DDO | Model Checker Triumph/Sloggi
// @namespace    https://runiversity.nl/
// @version      1.1.0
// @description  Vergelijkt Triumph/Sloggi artikelen op B2B met DDO export en linkt direct naar DDO edit
// @match        https://b2b.triumph.com/products/NL_TriumphPROD*
// @match        https://b2b.triumph.com/products/NL_sloggiPROD*
// @grant        GM_xmlhttpRequest
// @connect      dutchdesignersoutlet.com
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/thriump.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/thriump.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --------------------------------------------------
  // Config
  // --------------------------------------------------
  const BRANDS = {
    triumph: {
      label: 'Triumph',
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=221',
      payload: { format: 'excel_attribute', export: 'Export products' },
    },
    sloggi: {
      label: 'Sloggi',
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=222',
      payload: { format: 'excel_attribute', export: 'Export products' },
    },
  };

  const STORAGE_KEY_PREFIX = 'ddoModelCheckerCacheV2';
  const CACHE_TTL_MS = 15 * 60 * 1000;

  // --------------------------------------------------
  // State
  // --------------------------------------------------
  const state = {
    brandKey: inferBrandFromUrl(),
    ddoMap: null, // Product ID -> DDO edit ID
    observer: null,
    compareTimer: null,
    loading: false,
    minimized: false,
  };

  // --------------------------------------------------
  // Init
  // --------------------------------------------------
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
    }
    #ddo-model-checker select,
    #ddo-model-checker button:not(.ddo-toggle-btn) {
      border: 0;
      border-radius: 8px;
      padding: 8px 10px;
    }
    #ddo-model-checker select {
      flex: 1;
      background: #fff;
      color: #111827;
    }
    #ddo-model-checker button:not(.ddo-toggle-btn) {
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

    .ddo-card-checked {
      outline: 2px solid transparent !important;
      outline-offset: 2px !important;
      position: relative !important;
    }
    .ddo-card-match {
      outline-color: #16a34a !important;
    }
    .ddo-card-miss {
      outline-color: #dc2626 !important;
    }
    .ddo-card-badge {
      position: absolute !important;
      top: 8px !important;
      left: 8px !important;
      z-index: 20 !important;
      border-radius: 999px !important;
      padding: 4px 8px !important;
      font: 12px/1 Arial, sans-serif !important;
      font-weight: 700 !important;
      color: #fff !important;
      box-shadow: 0 4px 12px rgba(0,0,0,.18) !important;
      pointer-events: auto !important;
      text-decoration: none !important;
    }
    .ddo-card-badge.ddo-match {
      background: #16a34a !important;
    }
    .ddo-card-badge.ddo-miss {
      background: #dc2626 !important;
    }
    .ddo-card-badge:hover {
      filter: brightness(1.08);
    }
    .ddo-code-chip {
      margin-top: 6px !important;
      display: inline-block !important;
      padding: 3px 7px !important;
      border-radius: 999px !important;
      background: rgba(17,24,39,.08) !important;
      color: #111827 !important;
      font: 11px/1.2 Arial, sans-serif !important;
      word-break: break-all !important;
    }
  `);

  init();

  async function init() {
    createPanel();
    bindEvents();
    startObserver();

    if (state.brandKey && BRANDS[state.brandKey]) {
      setSelectValue(state.brandKey);
      await loadAndCompare();
    } else {
      setStatus('Kies eerst een merk.');
      setSummary('');
    }
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  function createPanel() {
    if (document.querySelector('#ddo-model-checker')) return;

    const panel = document.createElement('div');
    panel.id = 'ddo-model-checker';
    panel.innerHTML = `
      <div class="ddo-head">
        <div class="ddo-title">Model-checker</div>
        <button id="ddo-toggle-btn" type="button" class="ddo-toggle-btn" title="Minimaliseer">−</button>
      </div>

      <div id="ddo-panel-body">
        <div class="ddo-row">
          <select id="ddo-brand-select">
            <option value="">Kies merk…</option>
            <option value="triumph">Triumph</option>
            <option value="sloggi">Sloggi</option>
          </select>
          <button id="ddo-refresh-btn" type="button">Check</button>
        </div>
        <div id="ddo-status" class="ddo-status">Klaar.</div>
        <div id="ddo-summary" class="ddo-summary"></div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  function bindEvents() {
    const select = document.querySelector('#ddo-brand-select');
    const button = document.querySelector('#ddo-refresh-btn');
    const toggleBtn = document.querySelector('#ddo-toggle-btn');

    select?.addEventListener('change', async () => {
      state.brandKey = select.value || '';
      state.ddoMap = null;
      clearCardMarkers();

      if (!state.brandKey) {
        setStatus('Kies eerst een merk.');
        setSummary('');
        return;
      }

      await loadAndCompare();
    });

    button?.addEventListener('click', async () => {
      if (!state.brandKey) {
        setStatus('Kies eerst een merk.');
        return;
      }
      await loadAndCompare({ forceRefresh: true });
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

  function setSelectValue(value) {
    const select = document.querySelector('#ddo-brand-select');
    if (select) select.value = value;
  }

  // --------------------------------------------------
  // Main flow
  // --------------------------------------------------
  async function loadAndCompare(options = {}) {
    const { forceRefresh = false } = options;

    try {
      setLoading(true);
      setStatus(`Bezig met ophalen van ${BRANDS[state.brandKey].label} export…`);
      setSummary('');

      const ddoMap = await getDDOArticleMap(state.brandKey, forceRefresh);
      state.ddoMap = ddoMap;

      setStatus(`Export geladen. ${ddoMap.size} artikelnummers gevonden in DDO.`);
      runCompare();
    } catch (err) {
      console.error('[DDO Model Checker]', err);
      setStatus(`Fout: ${err.message || err}`);
      setSummary('');
    } finally {
      setLoading(false);
    }
  }

  function runCompare() {
    if (!state.ddoMap || !(state.ddoMap instanceof Map)) {
      setStatus('Geen DDO-data geladen.');
      return;
    }

    const cards = findProductCards();
    let total = 0;
    let matches = 0;
    let misses = 0;

    for (const card of cards) {
      const titleEl = card.querySelector('.product-card__second-title');
      if (!titleEl) continue;

      const raw = titleEl.textContent || '';
      const b2bCode = extractTriumphStyleCode(raw);
      if (!b2bCode) continue;

      total += 1;

      const ddoEditId = state.ddoMap.get(b2bCode) || null;
      const exists = !!ddoEditId;

      markCard(card, exists, b2bCode, ddoEditId);

      if (exists) matches += 1;
      else misses += 1;
    }

    setStatus(`${BRANDS[state.brandKey].label} gecontroleerd.`);
    setSummary(`Cards: ${total} | In DDO: ${matches} | Niet in DDO: ${misses}`);
  }

  // --------------------------------------------------
  // DDO export ophalen + XLSX lezen
  // --------------------------------------------------
  async function getDDOArticleMap(brandKey, forceRefresh = false) {
    const cached = !forceRefresh ? readCache(brandKey) : null;
    if (cached) return new Map(cached);

    const conf = BRANDS[brandKey];
    if (!conf) throw new Error(`Onbekend merk: ${brandKey}`);

    const arrayBuffer = await fetchExport(conf.exportUrl, conf.payload);
    const articleMap = parseDDOMapFromWorkbook(arrayBuffer);

    writeCache(brandKey, [...articleMap.entries()]);
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

  function parseDDOMapFromWorkbook(arrayBuffer) {
    let workbook;
    try {
      workbook = XLSX.read(arrayBuffer, { type: 'array' });
    } catch (err) {
      throw new Error('Excel-bestand kon niet worden gelezen');
    }

    if (!workbook.SheetNames?.length) {
      throw new Error('Geen sheets gevonden in export');
    }

    let bestMap = new Map();
    let debugInfo = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      });

      if (!rows.length) continue;

      const headerRowIndex = rows.findIndex(row =>
        Array.isArray(row) &&
        row.some(cell => String(cell).trim().toLowerCase() === 'product id')
      );

      if (headerRowIndex === -1) {
        debugInfo.push(`${sheetName}: geen header "Product ID" gevonden`);
        continue;
      }

      const headerRow = rows[headerRowIndex].map(cell => String(cell).trim().toLowerCase());
      const productIdIndex = headerRow.findIndex(cell => cell === 'product id');
      const imageIndex = headerRow.findIndex(cell => cell === 'image');

      if (productIdIndex === -1) {
        debugInfo.push(`${sheetName}: geen kolom Product ID`);
        continue;
      }

      if (imageIndex === -1) {
        debugInfo.push(`${sheetName}: geen kolom Image`);
        continue;
      }

      const map = new Map();
      const sample = [
        `${sheetName}: header op rij ${headerRowIndex + 1}, productIdIndex=${productIdIndex}, imageIndex=${imageIndex}`
      ];

      for (let r = headerRowIndex + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;

        const rawProductId = row[productIdIndex];
        const rawImage = row[imageIndex];

        if (!rawProductId || !rawImage) continue;

        const normalizedCode = normalizeDDOCode(String(rawProductId).trim());
        const ddoEditId = extractDDOEditIdFromImageField(String(rawImage).trim());

        if (sample.length < 12) {
          sample.push(
            `r${r + 1}: product="${rawProductId}" -> ${normalizedCode || 'geen match'} | imageId=${ddoEditId || 'geen id'}`
          );
        }

        if (normalizedCode && ddoEditId) {
          map.set(normalizedCode, ddoEditId);
        }
      }

      debugInfo.push(...sample);
      debugInfo.push(`${sheetName}: ${map.size} koppelingen`);

      if (map.size > bestMap.size) {
        bestMap = map;
      }
    }

    console.log('[DDO Model Checker] XLSX debug:', debugInfo);

    if (!bestMap.size) {
      throw new Error('Geen bruikbare Product ID + Image koppelingen gevonden. Check console.');
    }

    return bestMap;
  }

  // --------------------------------------------------
  // DOM compare helpers
  // --------------------------------------------------
  function findProductCards() {
    const titles = Array.from(document.querySelectorAll('.product-card__second-title'));
    const cards = new Set();

    for (const title of titles) {
      const card =
        title.closest('.product-card') ||
        title.closest('[class*="product-card"]') ||
        title.parentElement;

      if (card) cards.add(card);
    }

    return [...cards];
  }

  function markCard(card, exists, code, ddoEditId) {
    card.classList.add('ddo-card-checked');
    card.classList.remove('ddo-card-match', 'ddo-card-miss');
    card.classList.add(exists ? 'ddo-card-match' : 'ddo-card-miss');

    let badge = card.querySelector(':scope > .ddo-card-badge');
    if (!badge) {
      badge = document.createElement(exists ? 'a' : 'div');
      badge.className = 'ddo-card-badge';
      card.appendChild(badge);
    }

    if (exists && badge.tagName !== 'A') {
      const newBadge = document.createElement('a');
      newBadge.className = badge.className;
      badge.replaceWith(newBadge);
      badge = newBadge;
    } else if (!exists && badge.tagName !== 'DIV') {
      const newBadge = document.createElement('div');
      newBadge.className = badge.className;
      badge.replaceWith(newBadge);
      badge = newBadge;
    }

    badge.classList.remove('ddo-match', 'ddo-miss');
    badge.classList.add(exists ? 'ddo-match' : 'ddo-miss');
    badge.textContent = exists ? 'In DDO' : 'Niet in DDO';

    if (exists && ddoEditId) {
      badge.href = `https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${ddoEditId}`;
      badge.target = '_blank';
      badge.rel = 'noopener noreferrer';
      badge.title = `Open DDO product ${ddoEditId}`;
    } else {
      if (typeof badge.removeAttribute === 'function') {
        badge.removeAttribute('href');
        badge.removeAttribute('target');
        badge.removeAttribute('rel');
        badge.removeAttribute('title');
      }
    }

    let chip = card.querySelector(':scope > .ddo-code-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'ddo-code-chip';
      card.appendChild(chip);
    }

    chip.textContent = exists && ddoEditId ? `${code} · ID ${ddoEditId}` : code;
  }

  function clearCardMarkers() {
    document.querySelectorAll('.ddo-card-badge').forEach(el => el.remove());
    document.querySelectorAll('.ddo-code-chip').forEach(el => el.remove());

    document.querySelectorAll('.ddo-card-checked').forEach(card => {
      card.classList.remove('ddo-card-checked', 'ddo-card-match', 'ddo-card-miss');
    });
  }

  // --------------------------------------------------
  // Observer voor SPA / lazy load
  // --------------------------------------------------
  function startObserver() {
    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver(() => {
      if (!state.ddoMap || state.loading) return;
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
      runCompare();
    }, 450);
  }

  // --------------------------------------------------
  // Parsing helpers
  // --------------------------------------------------
  function extractTriumphStyleCode(text) {
    if (!text) return null;

    const cleaned = String(text).replace(/\s+/g, ' ').trim();
    const match = cleaned.match(/\b(\d{6,10})\s+([A-Z0-9]{2,6})\b/i);

    if (!match) return null;

    const article = match[1].trim();
    const color = match[2].trim().toUpperCase();

    return `${article}-${color}`;
  }

  function normalizeDDOCode(value) {
    if (!value) return null;

    let s = String(value).trim().toUpperCase();

    s = s.replace(/[‐-–—]/g, '-');
    s = s.replace(/\s+/g, ' ').trim();

    let m = s.match(/^(\d{6,10})\s*-\s*([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/^(\d{6,10})\s+([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/^(\d{6,10})([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    return null;
  }

  function extractDDOEditIdFromImageField(imageField) {
    if (!imageField) return null;

    const firstUrl = String(imageField).split('|')[0].trim();
    if (!firstUrl) return null;

    const match = firstUrl.match(/\/img\/product\/(\d+)_/i);
    return match ? match[1] : null;
  }

  function inferBrandFromUrl() {
    const url = location.href;
    if (/NL_TriumphPROD/i.test(url)) return 'triumph';
    if (/NL_sloggiPROD/i.test(url)) return 'sloggi';
    return '';
  }

  // --------------------------------------------------
  // Cache
  // --------------------------------------------------
  function getCacheKey(brandKey) {
    return `${STORAGE_KEY_PREFIX}:${brandKey}`;
  }

  function readCache(brandKey) {
    try {
      const raw = localStorage.getItem(getCacheKey(brandKey));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp || !Array.isArray(parsed.items)) return null;

      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed.items;
    } catch {
      return null;
    }
  }

  function writeCache(brandKey, items) {
    try {
      localStorage.setItem(
        getCacheKey(brandKey),
        JSON.stringify({
          timestamp: Date.now(),
          items,
        })
      );
    } catch (err) {
      console.warn('[DDO Model Checker] Cache opslaan mislukt:', err);
    }
  }

  // --------------------------------------------------
  // Utils
  // --------------------------------------------------
  function injectCSS(css) {
    const id = 'ddo-model-checker-style';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
