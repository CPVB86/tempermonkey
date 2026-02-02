// ==UserScript==
// @name         Scraper | After Eden
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.2.3
// @description  Haal After Eden/Elbrina stock via bcg.fashionportal.shop/itemquantitycal (HTML) en vul #tabs-3 in (DDO admin). Haal EAN via Google Sheet (gid). Hotkeys: Ctrl+Shift+A (all+autosave), Ctrl+Shift+E (EAN only), Ctrl+Shift+S (Stock only). Scoped op juiste kleur/variant via selectqty-wrap match op SKU.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        GM_xmlhttpRequest
// @connect      bcg.fashionportal.shop
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @run-at       document-end
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-aftereden.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-aftereden.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_ADMIN = location.hostname.includes('dutchdesignersoutlet.com');
  if (!ON_ADMIN) return;

  /******************************************************************
   * CONFIG
   ******************************************************************/
  const BASE = 'https://bcg.fashionportal.shop';
  const STOCK_URL = (itemNumber) =>
    `${BASE}/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;

  const TABLE_SELECTOR       = '#tabs-3 table.options';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  // Supplier PID input (bron voor item_number)
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"], input[name="supplier_pid"]';

  const BTN_ID = 'aftereden-stock-btn';

  /******************************************************************
   * GOOGLE SHEET (EAN)
   ******************************************************************/
  const SHEET_ID = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';
  const SHEET_GID_BY_BRAND = {
    aftereden: '1291267370',
    elbrina:   '1291267370', // zelfde sheet/gid (pas aan als Elbrina later een eigen gid krijgt)
  };

  const SHEET_CACHE_TTL_MS = 60 * 60 * 1000;
  const SHEET_AUTHUSER_KEY = 'afteredenSheetAuthUser';

  /******************************************************************
   * STOCK MAPPING
   ******************************************************************/
  // Rule:
  // 1) Trek altijd 4 af van remote inventory (min 0)
  // 2) Op adjusted waarde:
  //    - <2  => 1
  //    - 2   => 2
  //    - 3   => 3
  //    - 4   => 4
  //    - >=5 => 5
  // 3) Remote = 0 -> ook 1 (maar alleen als de maat WEL bestaat in remote matrix)
  // 4) Maat ontbreekt in remote matrix -> NEGEREN (laat local ongemoeid)
  function mapAfterEdenInventoryToLocalStock(remoteInventory) {
    const r = Number(remoteInventory) || 0;

    // remote bestaat (we zitten alleen in mapping als maat in remote bestaat)
    if (r <= 0) return 1;

    const adjusted = Math.max(0, r - 4);

    if (adjusted < 2) return 1;
    if (adjusted === 2) return 2;
    if (adjusted === 3) return 3;
    if (adjusted === 4) return 4;
    return 5;
  }

  /******************************************************************
   * HELPERS
   ******************************************************************/
  const $ = (s, root = document) => root.querySelector(s);

  function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        anonymous: false, // gebruikt jouw lokale cookies (B2B + Google)
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  function isLikelyHtml(s) {
    return /^\s*<!doctype html/i.test(s) || /\b<html\b/i.test(s);
  }

  function parseTsv(tsv) {
    const rows = tsv.split(/\r?\n/).map(line => line.split('\t'));
    return rows.filter(r => r.some(cell => (cell || '').trim() !== ''));
  }

  function normalizeLocalSize(s) {
    return String(s || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/–|—/g, '-');
  }

  function normalizePid(s) {
    return String(s || '').trim();
  }

  function hasTable() { return !!$(TABLE_SELECTOR); }

  function isTab3Active() {
    const activeByHeader = document.querySelector(
      '#tabs .ui-tabs-active a[href="#tabs-3"], ' +
      '#tabs .active a[href="#tabs-3"], ' +
      '#tabs li.current a[href="#tabs-3"]'
    );
    if (activeByHeader) return true;

    const panel = $('#tabs-3');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.height !== '0px';
  }

  function isTypingTarget(ev) {
    const t = ev.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function clickUpdateProductButton() {
    const saveBtn =
      document.querySelector('input[type="submit"][name="edit"]') ||
      document.querySelector('button[name="edit"]');
    if (!saveBtn) return false;
    saveBtn.click();
    return true;
  }

  function getBrandTitle() {
    const c = $(BRAND_TITLE_SELECTOR);
    const titleAttr = c?.getAttribute('title') || '';
    const text      = c?.textContent || '';
    const selectText = $('#tabs-1 select[name="brand"] option:checked')?.textContent || '';
    return (titleAttr || text || selectText || '').replace(/\u00A0/g, ' ').trim();
  }

  // ✅ beschikbaar voor alle merken beginnend met "After Eden" + ook Elbrina
  function getBrandKey() {
    const t = getBrandTitle().toLowerCase();

    if (t.startsWith('after eden') || t.includes('after eden')) return 'aftereden';
    if (t.startsWith('elbrina') || t.includes('elbrina')) return 'elbrina';

    return '';
  }

  function getSheetGidForBrand() {
    const key = getBrandKey();
    return key ? (SHEET_GID_BY_BRAND[key] || '') : '';
  }

  function isAllowedBrand() {
    return !!getBrandKey() && !!getSheetGidForBrand();
  }

  function getItemNumberFromSupplierPid() {
    const raw = document.querySelector(PID_SELECTOR)?.value || '';
    const pid = String(raw).trim().split(/[\s,;]+/)[0];
    return pid; // item_number = exact supplier_pid
  }

  /******************************************************************
   * FIX: Strict bra size parsing (AA ≠ A)
   ******************************************************************/
  function parseBraSizeKey(raw) {
    const s = normalizeLocalSize(raw);
    const m = s.match(/^(\d{2,3})([A-Z]+)$/);
    if (!m) return null;
    const band = m[1];
    const cup  = m[2];
    return { band, cup, key: `${band}|${cup}` };
  }

  function toBraKeyOrFallback(sizeRaw) {
    const p = parseBraSizeKey(sizeRaw);
    return p ? p.key : normalizeLocalSize(sizeRaw);
  }

  /******************************************************************
   * FIX: Scope remote HTML to the correct selectqty-wrap (color/variant)
   * - Response bevat meerdere selectqty-wrap blokken (018/017/019...)
   * - We matchen op de zichtbare SKU in .pro-sku .nuMber
   ******************************************************************/
  function normalizeItemNumber(s) {
    // maakt 80.04-0001-018 gelijk aan 80.04.0001-018
    return String(s || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ''); // alleen letters/cijfers
  }

  function findBestItemScope(doc, itemNumberRaw) {
    const want = normalizeItemNumber(itemNumberRaw);

    // 1) Betrouwbaar: match op de zichtbare SKU binnen elke selectqty-wrap
    const wraps = [...doc.querySelectorAll('.selectqty-wrap')];
    for (const w of wraps) {
      const skuText = w.querySelector('.pro-sku .nuMber')?.textContent || '';
      if (normalizeItemNumber(skuText) === want) return w;
    }

    // 2) Fallback: match op hidden parent_item_no
    const hidden = doc.querySelector('input[name="parent_item_no"]')?.getAttribute('value') || '';
    if (normalizeItemNumber(hidden) === want) {
      // Vaak hoort de eerste wrap bij de parent (zoals in jouw voorbeeld)
      return wraps[0] || null;
    }

    return null;
  }

  /******************************************************************
   * ROBUST INVENTORY READ
   ******************************************************************/
  function readRemoteInventoryFromBox(box) {
    const qtyLimit = box.querySelector('.qty-limit');
    const input = box.querySelector('input.quntity-input');

    const invA = qtyLimit?.getAttribute('data-inventory');
    const invB = qtyLimit?.dataset?.inventory;
    const invC = input?.getAttribute('data-title');
    const invD = input?.dataset?.title;

    const raw = (invA ?? invB ?? invC ?? invD ?? '0');
    const cleaned = String(raw).trim().replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  /******************************************************************
   * SHEET CACHE
   ******************************************************************/
  function sheetCacheKeyForGid(gid) {
    return `afteredenSheetCache:${SHEET_ID}:${gid}`;
  }

  function readSheetCache(gid) {
    try {
      const j = JSON.parse(localStorage.getItem(sheetCacheKeyForGid(gid)) || 'null');
      if (!j) return null;
      if (Date.now() - j.ts > SHEET_CACHE_TTL_MS) return null;
      return j;
    } catch { return null; }
  }

  function writeSheetCache(gid, obj) {
    try { localStorage.setItem(sheetCacheKeyForGid(gid), JSON.stringify(obj)); } catch {}
  }

  function getAuthuserCandidates() {
    const saved = localStorage.getItem(SHEET_AUTHUSER_KEY);
    const base = [0,1,2,3,4,5];
    if (saved !== null && !Number.isNaN(parseInt(saved, 10))) {
      const r = parseInt(saved, 10);
      return [r, ...base.filter(x => x !== r)];
    }
    return base;
  }

  function makeTsvUrl(gid, authuser) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=tsv&gid=${gid}&authuser=${authuser}`;
  }

  async function fetchSheetRawByGid(gid) {
    const cache = readSheetCache(gid);
    if (cache) return { text: cache.text, authuser: cache.authuser, fromCache: true };

    for (const au of getAuthuserCandidates()) {
      const url = makeTsvUrl(gid, au);
      const res = await gmGet(url, {
        'Accept': '*/*',
        'Referer': `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${gid}#gid=${gid}`,
      });

      if (res.status >= 200 && res.status < 300 && res.responseText && !isLikelyHtml(res.responseText)) {
        writeSheetCache(gid, { text: res.responseText, authuser: au, ts: Date.now() });
        localStorage.setItem(SHEET_AUTHUSER_KEY, String(au));
        return { text: res.responseText, authuser: au, fromCache: false };
      }
    }

    if (cache) return { text: cache.text, authuser: cache.authuser, fromCache: true };
    throw new Error('Sheets: geen toegang. Log in met juiste Google-account of maak tabblad (tijdelijk) publiek.');
  }

  /******************************************************************
   * EAN MAP (Sheet: Size | Ean | Supplier ID)
   ******************************************************************/
  function buildEanMapFromRows_SimpleCols(rows, supplierPidRaw) {
    const eanMap = new Map();
    const pidWanted = normalizePid(supplierPidRaw);

    if (!rows || rows.length < 2) return eanMap;

    const header = rows[0].map(c => String(c || '').trim().toLowerCase());
    const idxSize = header.findIndex(h => h === 'size' || h.includes('size'));
    const idxEan  = header.findIndex(h => h === 'ean' || h.includes('ean'));
    const idxPid  = header.findIndex(h => h === 'supplier id' || h.includes('supplier'));

    const sizeI = idxSize >= 0 ? idxSize : 0;
    const eanI  = idxEan  >= 0 ? idxEan  : 1;
    const pidI  = idxPid  >= 0 ? idxPid  : 2;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;

      const colSize = String(r[sizeI] || '').trim();
      const colEan  = String(r[eanI]  || '').trim();
      const colPid  = String(r[pidI]  || '').trim();

      if (!colSize || !colEan || !colPid) continue;
      if (normalizePid(colPid) !== pidWanted) continue;

      const sizeKey = normalizeLocalSize(colSize);
      const ean = colEan.replace(/\D/g, '');
      if (!sizeKey || !ean) continue;

      eanMap.set(sizeKey, ean);
    }

    console.log('[AfterEden] EAN map size:', eanMap.size, 'pid:', pidWanted);
    return eanMap;
  }

  /******************************************************************
   * STOCK HTML PARSING (scoped)
   ******************************************************************/
  function parseHtmlToMaps(html, { itemNumber = '' } = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const scope = itemNumber ? findBestItemScope(doc, itemNumber) : null;
    if (itemNumber && scope) {
      const skuTxt = scope.querySelector('.pro-sku .nuMber')?.textContent?.trim();
      console.log('[AfterEden] ✅ Scoped parse to:', skuTxt || '(unknown sku)');
    } else if (itemNumber && !scope) {
      console.warn('[AfterEden] ⚠️ No matching selectqty-wrap for itemNumber:', itemNumber, '→ parsing ALL (risk mismatch)');
    }

    const root = scope || doc;

    const exactMap = new Map(); // BH: key = "band|cup"
    const oneDMap  = new Map(); // "S" "M" "L" etc
    const debugRows = [];

    // ---- A) 3D matrix ----
    const headerRow = root.querySelector('.qty-by-size-3D');
    const bandSizes = headerRow
      ? [...headerRow.querySelectorAll('.size-for.text-center')]
          .map(el => el.textContent.trim())
          .filter(Boolean)
      : [];

    const matrixRows = [...root.querySelectorAll('.qty-by-size-3D')].slice(1);

    if (bandSizes.length && matrixRows.length) {
      for (const row of matrixRows) {
        const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
        if (!cup) continue;

        const cells = [...row.querySelectorAll('.add-qty-box')];

        cells.forEach((cell, idx) => {
          const band = bandSizes[idx] || null;
          if (!band) return;

          const remoteInventory = readRemoteInventoryFromBox(cell);
          const input = cell.querySelector('input.quntity-input');
          const itemVarId = input?.getAttribute('data-itemvarid') || '';

          const status =
            cell.classList.contains('outofstock') || remoteInventory === 0 ? 'outofstock' : 'available';

          const sizeRaw = `${band}${cup}`;
          const braObj  = parseBraSizeKey(sizeRaw);
          const braKey  = braObj ? braObj.key : normalizeLocalSize(sizeRaw);

          const adjusted = Math.max(0, (Number(remoteInventory) || 0) - 4);
          const mapped = mapAfterEdenInventoryToLocalStock(remoteInventory);

          exactMap.set(braKey, { remoteInventory, adjusted, mapped, itemVarId, status, __bra: braObj });

          debugRows.push({
            type: '3D',
            size: sizeRaw,
            key: braKey,
            band,
            cup,
            remoteInventory,
            adjusted,
            mapped,
            status,
            itemVarId
          });
        });
      }
    }

    // ---- B) 1D list sizes ----
    const listWraps = [...root.querySelectorAll('.qty-by-size.qty-by-size-list, .qty-by-size-list')];

    for (const wrap of listWraps) {
      const boxes = [...wrap.querySelectorAll('.add-qty-box')];
      for (const box of boxes) {
        const sizeRaw = box.querySelector('.size-for')?.textContent?.trim();
        if (!sizeRaw) continue;

        const sizeKey = normalizeLocalSize(sizeRaw);
        const remoteInventory = readRemoteInventoryFromBox(box);

        const input = box.querySelector('input.quntity-input');
        const itemVarId = input?.getAttribute('data-itemvarid') || '';

        const status =
          box.classList.contains('outofstock') || remoteInventory === 0 ? 'outofstock' : 'available';

        const adjusted = Math.max(0, (Number(remoteInventory) || 0) - 4);
        const mapped = mapAfterEdenInventoryToLocalStock(remoteInventory);

        oneDMap.set(sizeKey, { remoteInventory, adjusted, mapped, itemVarId, status });

        debugRows.push({
          type: '1D',
          size: sizeKey,
          remoteInventory,
          adjusted,
          mapped,
          status,
          itemVarId
        });
      }
    }

    console.groupCollapsed('[AfterEden] Remote sizes (parsed + mapped)');
    console.table(debugRows);
    console.groupEnd();

    return { exactMap, oneDMap };
  }

  /******************************************************************
   * APPLY
   ******************************************************************/
  function extractRowSizeInfo(row) {
    const sizeInput = row.querySelector('input.product_option_small');
    const raw = sizeInput?.value || '';
    return {
      raw,
      normalized: normalizeLocalSize(raw),
      bra: parseBraSizeKey(raw),
      key: toBraKeyOrFallback(raw),
    };
  }

  function applyToTable(exactMap, oneDMap, eanMap, { doEan = true, doStock = true } = {}) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return { matched: 0, report: [] };

    const rows = table.querySelectorAll('tbody tr');
    let matched = 0;
    const report = [];

    rows.forEach(row => {
      const sizeInfo  = extractRowSizeInfo(row);
      const sizeKey   = sizeInfo.key;

      const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');
      const eanInput   = row.querySelector('input[name^="options"][name$="[barcode]"]');

      const localBefore = stockInput ? Number(stockInput.value || 0) : 0;

      const remoteObj =
        (sizeKey ? exactMap.get(sizeKey) : null) ||
        (sizeInfo.normalized ? oneDMap.get(sizeInfo.normalized) : null) ||
        null;

      if (!remoteObj) {
        report.push({ size: sizeInfo.normalized || '(leeg)', local: localBefore, action: 'ignored (missing remote)' });
        return;
      }

      // 🧱 HARD BLOCK: AA mag NOOIT als A gematcht worden (of andersom)
      if (sizeInfo.bra && remoteObj.__bra) {
        const l = sizeInfo.bra;
        const r = remoteObj.__bra;
        if (l.band !== r.band || l.cup !== r.cup) {
          report.push({
            size: sizeInfo.normalized || '(leeg)',
            local: localBefore,
            action: `blocked (cup mismatch local ${l.band}${l.cup} vs remote ${r.band}${r.cup})`
          });
          return;
        }
      }

      const remoteMapped = remoteObj.mapped;
      const remoteInv    = remoteObj.remoteInventory;
      const adjusted     = remoteObj.adjusted;
      const remoteStatus = remoteObj.status || '';

      const remoteEan = (sizeInfo.normalized && eanMap && eanMap.get(sizeInfo.normalized))
        ? eanMap.get(sizeInfo.normalized)
        : '';

      let changed = false;

      if (doStock && stockInput) {
        const newStock = String(remoteMapped);
        if (stockInput.value !== newStock) {
          stockInput.value = newStock;
          stockInput.dispatchEvent(new Event('input', { bubbles: true }));
          changed = true;
        }
      }

      if (doEan && eanInput && remoteEan) {
        if (String(eanInput.value || '') !== String(remoteEan)) {
          eanInput.value = String(remoteEan);
          eanInput.dispatchEvent(new Event('input', { bubbles: true }));
          changed = true;
        }
      }

      if (changed) matched++;

      report.push({
        size: sizeInfo.normalized || '(leeg)',
        local: localBefore,
        remote: remoteInv,
        adjusted,
        mapped: remoteMapped,
        status: remoteStatus,
        ean: remoteEan || '',
        action: changed ? 'updated' : 'no-change'
      });
    });

    console.groupCollapsed('[AfterEden] Apply report (stock + ean)');
    console.table(report);
    console.groupEnd();

    return { matched, report };
  }

  /******************************************************************
   * BUTTON UI
   ******************************************************************/
  function setBtnState(opts = {}) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (opts.text != null)     btn.textContent = opts.text;
    if (opts.bg != null)       btn.style.backgroundColor = opts.bg;
    if (opts.disabled != null) btn.disabled = !!opts.disabled;
    if (opts.opacity != null)  btn.style.opacity = String(opts.opacity);
  }

  function resetBtn() {
    setBtnState({ text: '⛏️ SS&E | After Eden', bg: '#007cba', disabled: false, opacity: '1' });
    const btn = document.getElementById(BTN_ID);
    if (btn) updateButtonVisibility(btn);
  }

  function updateButtonVisibility(btn) {
    if (!btn) return;

    const gid = getSheetGidForBrand();
    const okBrand = isAllowedBrand() && !!gid;
    btn.style.display = (okBrand && isTab3Active()) ? '' : 'none';
    btn.disabled = !hasTable();
    btn.style.opacity = hasTable() ? '1' : '.55';

    const bk = getBrandKey();
    const label = bk === 'elbrina' ? '⛏️ SS&E | Elbrina' : '⛏️ SS&E | After Eden';
    if (!btn.disabled && btn.textContent && btn.textContent.includes('SS&E')) {
      if (!/⏳|📦|⚠️|❌/u.test(btn.textContent)) btn.textContent = label;
    }
  }

  function ensureButton() {
    if (!document.body) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '⛏️ SS&E | After Eden';
      btn.style.cssText = `
        position: fixed; right: 10px; top: 10px; z-index: 999999;
        padding: 10px 12px; background: #007cba; color: #fff;
        border: none; border-radius: 8px; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);

      // Button click = run all, no autosave
      btn.addEventListener('click', () => run({ mode: 'all', autosave: false }));
    }
    updateButtonVisibility(btn);
  }

  /******************************************************************
   * RUNNER (MEY-style)
   ******************************************************************/
  async function run({ mode = 'all', autosave = false } = {}) {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    console.groupCollapsed(`[AfterEden] Run — ${mode}${autosave ? ' + autosave' : ''}`);

    if (!isTab3Active()) {
      setBtnState({ text: '❌ Open tab Maten/Opties', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      console.groupEnd();
      return;
    }

    const gid = getSheetGidForBrand();
    const brandKey = getBrandKey();
    if (!brandKey || !gid) {
      setBtnState({ text: '❌ Geen gid voor dit merk', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      console.groupEnd();
      return;
    }

    const supplierPidRaw = document.querySelector(PID_SELECTOR)?.value?.trim() || '';
    const itemNumber = getItemNumberFromSupplierPid();
    if (!itemNumber) {
      setBtnState({ text: '❌ Geen Supplier PID', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      console.groupEnd();
      return;
    }

    const stockUrl = STOCK_URL(itemNumber);
    console.log('[AfterEden] brandKey:', brandKey, 'supplierPidRaw:', supplierPidRaw, 'itemNumber:', itemNumber);
    console.log('[AfterEden] Stock URL:', stockUrl);

    const doEan = (mode === 'all' || mode === 'ean');
    const doStock = (mode === 'all' || mode === 'stock');

    setBtnState({ text: `⏳ Stock laden (${brandKey})...`, bg: '#f1c40f', disabled: true, opacity: '.85' });

    try {
      // --- Stock ---
      const res = await gmGet(stockUrl, { 'Accept': 'text/html,*/*' });
      if (res.status < 200 || res.status >= 300) throw new Error(`Stock: HTTP ${res.status}`);

      const html = res.responseText || '';
      const looksWrong = !html.includes('data-inventory=') && /login|sign in|unauthorized/i.test(html);
      if (looksWrong) throw new Error('LOGIN_REQUIRED');

      // ✅ Scoped parsing: only correct selectqty-wrap for this itemNumber
      const { exactMap, oneDMap } = parseHtmlToMaps(html, { itemNumber });

      // --- Sheet / EAN ---
      let eanMap = new Map();
      if (doEan) {
        setBtnState({ text: `⏳ Sheet (EAN) laden (gid ${gid})...`, bg: '#6c757d', disabled: true, opacity: '.85' });

        const raw  = await fetchSheetRawByGid(gid);
        const rows = parseTsv(raw.text);
        console.log('[AfterEden] Sheet rows:', rows.length, 'firstRow:', rows[0]);

        eanMap = buildEanMapFromRows_SimpleCols(rows, supplierPidRaw);
      }

      // --- Apply ---
      const { matched } = applyToTable(exactMap, oneDMap, eanMap, { doEan, doStock });

      setBtnState({
        text: matched ? `📦 ${matched} rijen gevuld` : '⚠️ 0 rijen gevuld',
        bg: matched ? '#2ecc71' : '#f39c12',
        disabled: false,
        opacity: '1'
      });
      setTimeout(resetBtn, 2500);

      if (autosave && matched > 0) {
        setTimeout(() => clickUpdateProductButton(), 150);
      }
    } catch (e) {
      console.error('[AfterEden]', e);
      const msg = String(e?.message || e);
      if (/LOGIN_REQUIRED/i.test(msg)) alert('Login required. Log in op bcg.fashionportal.shop en probeer opnieuw.');
      setBtnState({ text: '❌ Fout bij ophalen', bg: '#e06666', disabled: false, opacity: '1' });
      setTimeout(resetBtn, 2500);
    } finally {
      console.groupEnd();
    }
  }

  /******************************************************************
   * HOTKEYS (MEY-style)
   ******************************************************************/
  function bindHotkeysOnce() {
    if (window.__afterEdenHotkeysBound) return;

    window.addEventListener('keydown', (ev) => {
      if (!document.querySelector('#tabs-3')) return;
      if (isTypingTarget(ev)) return;

      // alleen als brand ok is + tab3 actief + button zichtbaar/bruikbaar
      if (!isAllowedBrand()) return;
      if (!isTab3Active()) return;

      const btn = document.getElementById(BTN_ID);
      if (!btn || btn.style.display === 'none' || btn.disabled) return;

      const k = (ev.key || '').toLowerCase();

      // Ctrl + Shift + A  → all + autosave
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === 'a') {
        ev.preventDefault();
        run({ mode: 'all', autosave: true });
        return;
      }

      // Ctrl + Shift + E → EAN only
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === 'e') {
        ev.preventDefault();
        run({ mode: 'ean', autosave: false });
        return;
      }

      // Ctrl + Shift + S → Stock only
      if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === 's') {
        ev.preventDefault();
        run({ mode: 'stock', autosave: false });
        return;
      }
    }, true);

    window.__afterEdenHotkeysBound = true;
  }

  /******************************************************************
   * BOOT
   ******************************************************************/
  function bootAdmin() {
    ensureButton();

    const observer = new MutationObserver(() => setTimeout(ensureButton, 100));
    try { observer.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch {}

    setInterval(() => {
      const btn = document.getElementById(BTN_ID);
      if (btn) updateButtonVisibility(btn);
    }, 2000);

    bindHotkeysOnce();
  }

  bootAdmin();
})();
