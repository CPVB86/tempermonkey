// ==UserScript==
// @name         Scraper | After Eden
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1.1
// @description  Haal After Eden stock via bcg.fashionportal.shop/itemquantitycal (HTML) en vul #tabs-3 in (DDO admin). Haal EAN via Google Sheet (gid per merk). Hotkey: Ctrl+Shift+A (autosave).
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

  // ========= Config =========
  const BASE = 'https://bcg.fashionportal.shop';
  const STOCK_URL = (itemNumber) =>
    `${BASE}/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;

  const TABLE_SELECTOR       = '#tabs-3 table.options';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  // Supplier PID input (bron voor item_number)
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"], input[name="supplier_pid"]';

  const BTN_ID = 'aftereden-stock-btn';

  // Ctrl+Shift+A = autosave
  const HOTKEY = { ctrl: true, shift: true, alt: false, key: 'a' };

  // ========= Google Sheet (EAN) =========
  const SHEET_ID = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';
  const SHEET_GID_BY_BRAND = {
    aftereden: '1291267370',
  };

  const SHEET_CACHE_TTL_MS = 60 * 60 * 1000;
  const SHEET_AUTHUSER_KEY = 'afteredenSheetAuthUser';

  // ========= Stock mapping =========
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
    if (r <= 0) return 1;

    const adjusted = Math.max(0, r - 4);

    if (adjusted < 2) return 1;
    if (adjusted === 2) return 2;
    if (adjusted === 3) return 3;
    if (adjusted === 4) return 4;
    return 5;
  }

  // ========= Helpers =========
  const $ = (s, root = document) => root.querySelector(s);

  function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        anonymous: false, // <- gebruikt jouw lokale cookies (B2B + Google)
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

  function hasTable() { return !!$(TABLE_SELECTOR); }

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

  function getBrandKey() {
    const t = getBrandTitle().toLowerCase();
    if (t.includes('after eden')) return 'aftereden';
    return '';
  }

  function getSheetGidForBrand() {
    const key = getBrandKey();
    return key ? (SHEET_GID_BY_BRAND[key] || '') : '';
  }

  function isAfterEdenBrand() {
    return getBrandKey() === 'aftereden';
  }

  function getItemNumberFromSupplierPid() {
    const raw = document.querySelector(PID_SELECTOR)?.value || '';
    const pid = String(raw).trim().split(/[\s,;]+/)[0];
    return pid;
  }

  // ========= Sheet cache (zelfde flow als je voorbeeld) =========
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

  // ========= EAN map (Sheet: Size | Ean | Supplier ID) =========
  // Voorbeeld uit jouw sheet:
  // Size   Ean             Supplier ID
  // 70C    0000000000001   10.05.6185-230
  function buildEanMapFromRows_SimpleCols(rows, supplierPidRaw) {
    const eanMap = new Map();
    const pidWanted = normalizePid(supplierPidRaw);

    if (!rows || rows.length < 2) return eanMap;

    // Header-detectie (case-insensitive)
    const header = rows[0].map(c => String(c || '').trim().toLowerCase());
    const idxSize = header.findIndex(h => h === 'size' || h.includes('size'));
    const idxEan  = header.findIndex(h => h === 'ean' || h.includes('ean'));
    const idxPid  = header.findIndex(h => h === 'supplier id' || h.includes('supplier'));

    // Fallback op vaste posities: Size/Ean/Supplier ID
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

  // ========= Stock HTML parsing =========
  function parseHtmlToExactMap(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const headerRow = doc.querySelector('.qty-by-size-3D');
    const bandSizes = headerRow
      ? [...headerRow.querySelectorAll('.size-for.text-center')]
          .map(el => el.textContent.trim())
          .filter(Boolean)
      : [];

    const rows = [...doc.querySelectorAll('.qty-by-size-3D')].slice(1);

    const exactMap = new Map();
    const debugRows = [];

    for (const row of rows) {
      const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
      if (!cup) continue;

      const cells = [...row.querySelectorAll('.add-qty-box')];

      cells.forEach((cell, idx) => {
        const band = bandSizes[idx] || null;
        if (!band) return;

        const qtyLimit = cell.querySelector('.qty-limit');
        const remoteInventory = qtyLimit ? Number(qtyLimit.getAttribute('data-inventory') || '0') : 0;

        const input = cell.querySelector('input.quntity-input');
        const itemVarId = input?.getAttribute('data-itemvarid') || '';

        const status =
          cell.classList.contains('outofstock') || remoteInventory === 0 ? 'outofstock' : 'available';

        const sizeKey = normalizeLocalSize(`${band}${cup}`);
        const adjusted = Math.max(0, (Number(remoteInventory) || 0) - 4);
        const mapped = mapAfterEdenInventoryToLocalStock(remoteInventory);

        exactMap.set(sizeKey, { remoteInventory, adjusted, mapped, itemVarId, status });
        debugRows.push({ size: sizeKey, band, cup, remoteInventory, adjusted, mapped, status, itemVarId });
      });
    }

    console.groupCollapsed('[AfterEden] Remote matrix (parsed + mapped)');
    console.table(debugRows);
    console.groupEnd();

    return { exactMap, bandSizes };
  }

  // ========= Apply =========
  function extractRowSizeKey(row) {
    const sizeInput = row.querySelector('input.product_option_small');
    return normalizeLocalSize(sizeInput?.value || '');
  }

  function applyToTable(exactMap, eanMap) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return { matched: 0, report: [] };

    const rows = table.querySelectorAll('tbody tr');
    let matched = 0;

    const report = [];

    rows.forEach(row => {
      const sizeKey = extractRowSizeKey(row);
      const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');
      const eanInput   = row.querySelector('input[name^="options"][name$="[barcode]"]');

      const localBefore = stockInput ? Number(stockInput.value || 0) : 0;

      const remoteObj = sizeKey ? exactMap.get(sizeKey) : null;

      // ✅ maat ontbreekt remote -> NEGEREN (niet overschrijven)
      if (!remoteObj) {
        report.push({ size: sizeKey || '(leeg)', local: localBefore, action: 'ignored (missing remote)' });
        return;
      }

      const remoteMapped = remoteObj.mapped;
      const remoteInv    = remoteObj.remoteInventory;
      const adjusted     = remoteObj.adjusted;
      const remoteStatus = remoteObj.status || '';

      const remoteEan = (sizeKey && eanMap && eanMap.get(sizeKey)) ? eanMap.get(sizeKey) : '';

      let changed = false;

      if (stockInput) {
        const newStock = String(remoteMapped);
        if (stockInput.value !== newStock) {
          stockInput.value = newStock;
          stockInput.dispatchEvent(new Event('input', { bubbles: true }));
          changed = true;
        }
      }

      if (eanInput && remoteEan) {
        if (String(eanInput.value || '') !== String(remoteEan)) {
          eanInput.value = String(remoteEan);
          eanInput.dispatchEvent(new Event('input', { bubbles: true }));
          changed = true;
        }
      }

      if (changed) matched++;

      report.push({
        size: sizeKey || '(leeg)',
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

  // ========= Button UI =========
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
    const okBrand = isAfterEdenBrand() && !!gid;
    btn.style.display = (okBrand && isTab3Active()) ? '' : 'none';
    btn.disabled = !hasTable();
    btn.style.opacity = hasTable() ? '1' : '.55';
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

      btn.addEventListener('click', () => onScrapeClick(false));
    }
    updateButtonVisibility(btn);
  }

  // ========= Runner =========
  async function onScrapeClick(autoSaveThisRun) {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    if (!isTab3Active()) {
      setBtnState({ text: '❌ Open tab Maten/Opties', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    const gid = getSheetGidForBrand();
    const brandKey = getBrandKey();
    if (!brandKey || !gid) {
      setBtnState({ text: '❌ Geen gid voor dit merk', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    const supplierPidRaw = document.querySelector(PID_SELECTOR)?.value?.trim() || '';
    const itemNumber = getItemNumberFromSupplierPid();
    if (!itemNumber) {
      setBtnState({ text: '❌ Geen Supplier PID', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    const stockUrl = STOCK_URL(itemNumber);
    console.log('[AfterEden] supplierPidRaw:', supplierPidRaw, 'itemNumber:', itemNumber);
    console.log('[AfterEden] Stock URL:', stockUrl);

    setBtnState({ text: `⏳ Stock laden (${brandKey})...`, bg: '#f1c40f', disabled: true, opacity: '.85' });

    try {
      // --- Stock ---
      const res = await gmGet(stockUrl, { 'Accept': 'text/html,*/*' });
      if (res.status < 200 || res.status >= 300) throw new Error(`Stock: HTTP ${res.status}`);

      const html = res.responseText || '';
      const looksWrong = !html.includes('data-inventory=') && /login|sign in|unauthorized/i.test(html);
      if (looksWrong) throw new Error('LOGIN_REQUIRED');

      const { exactMap } = parseHtmlToExactMap(html);

      // --- Sheet / EAN ---
      setBtnState({ text: `⏳ Sheet (EAN) laden (gid ${gid})...`, bg: '#6c757d', disabled: true, opacity: '.85' });

      const raw  = await fetchSheetRawByGid(gid);
      const rows = parseTsv(raw.text);
      console.log('[AfterEden] Sheet rows:', rows.length, 'firstRow:', rows[0]);

      const eanMap = buildEanMapFromRows_SimpleCols(rows, supplierPidRaw);

      // --- Apply ---
      const { matched } = applyToTable(exactMap, eanMap);

      setBtnState({
        text: matched ? `📦 ${matched} rijen gevuld` : '⚠️ 0 rijen gevuld',
        bg: matched ? '#2ecc71' : '#f39c12',
        disabled: false,
        opacity: '1'
      });
      setTimeout(resetBtn, 2500);

      if (autoSaveThisRun && matched > 0) clickUpdateProductButton();
    } catch (e) {
      console.error('[AfterEden]', e);
      const msg = String(e?.message || e);
      if (/LOGIN_REQUIRED/i.test(msg)) alert('Login required. Log in op bcg.fashionportal.shop en probeer opnieuw.');
      setBtnState({ text: '❌ Fout bij ophalen', bg: '#e06666', disabled: false, opacity: '1' });
      setTimeout(resetBtn, 2500);
    }
  }

  // ========= Hotkey =========
  function onScrapeHotkey(e) {
    const target = e.target;
    const tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

    const key = (e.key || '').toLowerCase();
    const match =
      key === HOTKEY.key &&
      !!e.ctrlKey === HOTKEY.ctrl &&
      !!e.shiftKey === HOTKEY.shift &&
      !!e.altKey === HOTKEY.alt;

    if (!match) return;
    if (!isTab3Active()) return;

    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.style.display === 'none' || btn.disabled) return;

    e.preventDefault();
    onScrapeClick(true);
  }

  // ========= Boot =========
  function bootAdmin() {
    ensureButton();

    const observer = new MutationObserver(() => setTimeout(ensureButton, 100));
    try { observer.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch {}

    setInterval(() => {
      const btn = document.getElementById(BTN_ID);
      if (btn) updateButtonVisibility(btn);
    }, 2000);

    if (!window.__afterEdenHotkeyBound) {
      document.addEventListener('keydown', onScrapeHotkey);
      window.__afterEdenHotkeyBound = true;
    }
  }

  bootAdmin();
})();
