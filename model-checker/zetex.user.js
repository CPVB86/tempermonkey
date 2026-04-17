// ==UserScript==
// @name         DDO | Model Checker Zetex
// @namespace    https://runiversity.nl/
// @version      1.0.1
// @description  Vergelijkt Zetex artikelen op B2B met DDO export
// @match        https://b2b.zetex.nl/products*
// @grant        GM_xmlhttpRequest
// @connect      dutchdesignersoutlet.com
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/zetex.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SOURCES = {
    stock: {
      label: 'Zetex Stock',
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=224',
      payload: { format: 'excel', export: 'Export products' },
    },
    preorder: {
      label: 'Zetex Pre-order',
      exportUrl: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=224',
      payload: { format: 'excel', export: 'Export products' },
    },
  };

  const STORAGE_KEY_PREFIX = 'ddoModelCheckerCacheZetexV1';
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const IMAGE_PREFIX = 'https://www.dutchdesignersoutlet.com/img/product/';

  const SHEET_PREFERRED = 'Parent';
  const COL_IMAGE = 1;
  const COL_PRODUCT_ID = 3;
  const HEADER_ROW_INDEX = 0;

  const state = {
    sourceKey: inferSourceFromUrl(),
    ddoMap: null,
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

    #ddo-remove-matches-btn {
      background: #dc2626 !important;
    }

    #ddo-remove-matches-btn:hover {
      filter: brightness(1.08);
    }

    #ddo-favorite-remaining-btn {
      background: #db2777 !important;
      min-width: 42px;
      width: 42px;
      height: 36px;
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      padding: 0 !important;
    }

    #ddo-favorite-remaining-btn:hover {
      filter: brightness(1.08);
    }

    #ddo-favorite-remaining-btn svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: currentColor;
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

    .ddo-card-miss {
      outline-color: #dc2626 !important;
    }

    .ddo-card-match .product-image-wrapper,
    .ddo-card-match .product-card__image,
    .ddo-card-match .product-card__media,
    .ddo-card-match .product-image,
    .ddo-card-match .card-images,
    .ddo-card-match .card-images__image {
      opacity: 0.45 !important;
      transition: opacity .2s ease !important;
    }

    .ddo-card-match:hover .product-image-wrapper,
    .ddo-card-match:hover .product-card__image,
    .ddo-card-match:hover .product-card__media,
    .ddo-card-match:hover .product-image,
    .ddo-card-match:hover .card-images,
    .ddo-card-match:hover .card-images__image {
      opacity: 0.72 !important;
    }

    .ddo-card-checked .product-details-wrapper,
    .ddo-card-checked .product-details-wrapper *,
    .ddo-card-checked .product-card__title-wrapper,
    .ddo-card-checked .product-card__title-wrapper *,
    .ddo-card-checked .card-prices,
    .ddo-card-checked .card-prices *,
    .ddo-card-checked .card-swatches,
    .ddo-card-checked .card-swatches * {
      opacity: 1 !important;
    }

    .ddo-card-checked::before {
      content: attr(data-ddo-status);
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 2;
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
      z-index: 2;
    }
  `);

  init();

  async function init() {
    createPanel();
    bindEvents();
    startObserver();

    if (state.sourceKey && SOURCES[state.sourceKey]) {
      setSelectValue(state.sourceKey);
      await loadAndCompare();
    } else {
      setStatus('Kies eerst een bron.');
      setSummary('');
    }
  }

  function createPanel() {
    if (document.querySelector('#ddo-model-checker')) return;

    const panel = document.createElement('div');
    panel.id = 'ddo-model-checker';
    panel.innerHTML = `
      <div class="ddo-head">
        <div class="ddo-title">Model-checker Zetex</div>
        <button id="ddo-toggle-btn" type="button" class="ddo-toggle-btn" title="Minimaliseer">−</button>
      </div>

      <div id="ddo-panel-body">
        <div class="ddo-row">
          <select id="ddo-source-select">
            <option value="">Kies bron…</option>
            <option value="stock">Stock</option>
            <option value="preorder">Pre-order</option>
          </select>
          <button id="ddo-refresh-btn" type="button">Check</button>
        </div>

        <div class="ddo-row">
          <button id="ddo-remove-matches-btn" type="button">Verwijder In DDO</button>
          <button
            id="ddo-favorite-remaining-btn"
            type="button"
            title="Markeer resterende cards als favoriet"
            aria-label="Markeer resterende cards als favoriet"
          >
            <svg viewBox="1 1 22 22" aria-hidden="true">
              <path d="M18.794 6.3653C17.1859 4.75714 14.5788 4.75714 12.9708 6.3653L12.0001 7.33589L11.0295 6.36547C9.42133 4.75731 6.8141 4.75731 5.20612 6.36547C3.59796 7.97362 3.59796 10.5807 5.20612 12.1888L6.17671 13.1589L12.0001 18.9823L17.8234 13.1589L18.7939 12.1888C20.4022 10.5807 20.4022 7.97345 18.794 6.3653ZM15.8823 13.1593L12.0001 17.0414L8.11806 13.1593L6.17705 11.2182C5.10489 10.1463 5.10489 8.40805 6.17705 7.33571C7.24921 6.26372 8.98725 6.26372 10.0592 7.33571L12.0001 9.27706L13.9413 7.33589C15.0132 6.2639 16.7514 6.2639 17.8234 7.33589C18.8954 8.40822 18.8954 10.1461 17.8234 11.2184L15.8823 13.1593Z"></path>
            </svg>
          </button>
        </div>

        <div id="ddo-status" class="ddo-status">Klaar.</div>
        <div id="ddo-summary" class="ddo-summary"></div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  function bindEvents() {
    const select = document.querySelector('#ddo-source-select');
    const button = document.querySelector('#ddo-refresh-btn');
    const removeBtn = document.querySelector('#ddo-remove-matches-btn');
    const favoriteBtn = document.querySelector('#ddo-favorite-remaining-btn');
    const toggleBtn = document.querySelector('#ddo-toggle-btn');

    select?.addEventListener('change', async () => {
      state.sourceKey = select.value || '';
      state.ddoMap = null;
      clearCardMarkers();

      if (!state.sourceKey) {
        setStatus('Kies eerst een bron.');
        setSummary('');
        return;
      }

      await loadAndCompare();
    });

    button?.addEventListener('click', async () => {
      if (!state.sourceKey) {
        setStatus('Kies eerst een bron.');
        return;
      }
      await loadAndCompare({ forceRefresh: true });
    });

    removeBtn?.addEventListener('click', () => {
      const removed = removeMatchedCards();
      setStatus(`${removed} cards met "In DDO" verwijderd.`);
    });

    favoriteBtn?.addEventListener('click', async () => {
      setStatus('Bezig met resterende cards als favoriet markeren…');
      const favorited = await favoriteRemainingCards();
      setStatus(`${favorited} resterende cards als favoriet gemarkeerd.`);
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
    const select = document.querySelector('#ddo-source-select');
    if (select) select.value = value;
  }

  async function loadAndCompare(options = {}) {
    const { forceRefresh = false } = options;

    try {
      setLoading(true);
      setStatus(`Bezig met ophalen van ${SOURCES[state.sourceKey].label} export…`);
      setSummary('');

      const ddoMap = await getDDOArticleMap(state.sourceKey, forceRefresh);
      state.ddoMap = ddoMap;

      setStatus(`Export geladen. ${ddoMap.size} artikelnummers gevonden in DDO.`);
      runCompare();
    } catch (err) {
      console.error('[DDO Model Checker Zetex] Error:', err);
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
      const b2bCode = extractStyleCode(raw);
      if (!b2bCode) continue;

      total += 1;

      const exists = state.ddoMap.has(b2bCode);
      const ddoEditId = state.ddoMap.get(b2bCode) || null;

      markCard(card, exists, b2bCode, ddoEditId);

      if (exists) matches += 1;
      else misses += 1;
    }

    setStatus(`${SOURCES[state.sourceKey].label} gecontroleerd.`);
    setSummary(`Cards: ${total} | In DDO: ${matches} | Niet in DDO: ${misses}`);
  }

  async function getDDOArticleMap(sourceKey, forceRefresh = false) {
    const cached = !forceRefresh ? readCache(sourceKey) : null;
    if (cached) return new Map(cached);

    const conf = SOURCES[sourceKey];
    if (!conf) throw new Error(`Onbekende bron: ${sourceKey}`);

    const arrayBuffer = await fetchExport(conf.exportUrl, conf.payload);
    const articleMap = parseDDOMapFromWorkbook(arrayBuffer);

    writeCache(sourceKey, [...articleMap.entries()]);
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
        const ddoEditId = extractDDOEditIdFromImageField(rawImage);

        if (normalizedCode) {
          map.set(normalizedCode, ddoEditId || null);
        }
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

    card.dataset.ddoStatus = exists
      ? (ddoEditId ? 'In DDO' : 'In DDO (geen foto)')
      : 'Niet in DDO';

    card.dataset.ddoCode = exists && ddoEditId
      ? `${code} · ID ${ddoEditId}`
      : code;
  }

  function clearCardMarkers() {
    document.querySelectorAll('.ddo-card-checked').forEach(card => {
      card.classList.remove('ddo-card-checked', 'ddo-card-match', 'ddo-card-miss');
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
    let misses = 0;

    for (const card of remainingCards) {
      if (!card.querySelector('.product-card__second-title')) continue;
      if (!card.classList.contains('ddo-card-checked')) continue;

      total++;
      if (card.classList.contains('ddo-card-match')) matches++;
      if (card.classList.contains('ddo-card-miss')) misses++;
    }

    setSummary(`Cards: ${total} | In DDO: ${matches} | Niet in DDO: ${misses}`);
    return removed;
  }

  async function favoriteRemainingCards() {
    const cards = findProductCards();
    let favorited = 0;
    let foundButtons = 0;

    for (const card of cards) {
      if (!card.classList.contains('ddo-card-miss')) continue;

      const favBtn =
        card.querySelector('button.card-actions__favorite-icon') ||
        card.querySelector('.card-actions__favorite-icon') ||
        card.querySelector('button.product-card__favorite-icon') ||
        card.querySelector('.product-card__favorite-icon') ||
        card.querySelector('button[class*="favorite"]');

      if (!favBtn) continue;
      foundButtons++;

      if (isFavoriteActive(favBtn)) continue;

      try {
        favBtn.scrollIntoView({ block: 'center', inline: 'center' });
      } catch {}

      triggerSafeClick(favBtn);
      await wait(220);

      if (!isFavoriteActive(favBtn)) {
        triggerSafeClick(favBtn);
        await wait(320);
      }

      if (isFavoriteActive(favBtn)) {
        favorited++;
      }
    }

    console.log('[DDO Model Checker Zetex] favoriteRemainingCards', {
      cards: cards.length,
      foundButtons,
      favorited
    });

    return favorited;
  }

  function isFavoriteActive(btn) {
    if (!btn) return false;

    const ariaPressed = btn.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;

    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (
      ariaLabel.includes('remove') ||
      ariaLabel.includes('saved') ||
      ariaLabel.includes('favorited') ||
      ariaLabel.includes('favourite')
    ) {
      return true;
    }

    return (
      btn.classList.contains('is-active') ||
      btn.classList.contains('active') ||
      btn.classList.contains('selected') ||
      btn.classList.contains('is-selected') ||
      btn.classList.contains('favorited')
    );
  }

  function triggerSafeClick(el) {
    if (!el) return;

    const win = el.ownerDocument?.defaultView || window;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win,
      button: 0,
      buttons: 1
    };

    try { el.focus?.({ preventScroll: true }); } catch {}

    try { el.dispatchEvent(new MouseEvent('mouseenter', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseover', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousemove', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch {}

    try { el.click?.(); } catch {}
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  function extractStyleCode(text) {
    if (!text) return null;

    const cleaned = String(text).replace(/\s+/g, ' ').trim().toUpperCase();

    // Zetex voorbeeld:
    // 3342-606-4 ZBA 718 - Green
    let m = cleaned.match(/\b(\d{3,6}(?:-\d{1,6}){1,4})\s+([A-Z0-9]{2,6})\b/);
    if (m) return `${m[1]}-${m[2]}`;

    // Triumph/Sloggi stijl:
    // 10215995 M008
    m = cleaned.match(/\b(\d{6,10})\s+([A-Z0-9]{2,6})\b/);
    if (m) return `${m[1]}-${m[2]}`;

    return null;
  }

  function normalizeDDOCode(value) {
    if (value == null) return null;

    let s = String(value).trim().toUpperCase();
    if (!s) return null;

    s = s.replace(/[‐–—]/g, '-');
    s = s.replace(/\s+/g, ' ').trim();

    let m;

    // Zetex met spatie:
    // 3342-606-4 ZBA
    m = s.match(/^(\d{3,6}(?:-\d{1,6}){1,4})\s+([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    // Zetex al met laatste koppelteken:
    // 3342-606-4-ZBA
    m = s.match(/^(\d{3,6}(?:-\d{1,6}){1,4})-([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    // Triumph/Sloggi klassiek:
    m = s.match(/^(\d{6,10})\s*-\s*([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/^(\d{6,10})\s+([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/^(\d{6,10})([A-Z0-9]{2,6})$/);
    if (m) return `${m[1]}-${m[2]}`;

    // Fallback: pak ergens in de string
    m = s.match(/\b(\d{3,6}(?:-\d{1,6}){1,4})\s+([A-Z0-9]{2,6})\b/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/\b(\d{6,10})\s*[- ]\s*([A-Z0-9]{2,6})\b/);
    if (m) return `${m[1]}-${m[2]}`;

    return null;
  }

  function extractDDOEditIdFromImageField(imageField) {
    if (imageField == null) return null;

    const text = String(imageField).trim();
    if (!text) return null;

    const firstPart = text.split('|')[0].trim();
    if (!firstPart) return null;
    if (!firstPart.startsWith(IMAGE_PREFIX)) return null;

    const rest = firstPart.slice(IMAGE_PREFIX.length);
    const match = rest.match(/^(\d{5,6})/);

    return match ? match[1] : null;
  }

  function inferSourceFromUrl() {
    const url = location.href;
    if (/\/products\/Zetex_01\//i.test(url)) return 'stock';
    if (/\/products\/Zetex_02\//i.test(url)) return 'preorder';
    return '';
  }

  function getCacheKey(sourceKey) {
    return `${STORAGE_KEY_PREFIX}:${sourceKey}`;
  }

  function readCache(sourceKey) {
    try {
      const raw = localStorage.getItem(getCacheKey(sourceKey));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp || !Array.isArray(parsed.items)) return null;
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;

      return parsed.items;
    } catch {
      return null;
    }
  }

  function writeCache(sourceKey, items) {
    try {
      localStorage.setItem(
        getCacheKey(sourceKey),
        JSON.stringify({
          timestamp: Date.now(),
          items,
        })
      );
    } catch (err) {
      console.warn('[DDO Model Checker Zetex] Cache opslaan mislukt:', err);
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
