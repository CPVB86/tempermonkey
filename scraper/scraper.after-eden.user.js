// ==UserScript==
// @name         Stock Scraper | After Eden (FashionPortal)
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0.4
// @description  Haal After Eden stock via bcg.fashionportal.shop/itemquantitycal (HTML) en vul #tabs-3 in (DDO admin). Gebruikt Supplier PID als item_number. Hotkey: Ctrl+Shift+A (autosave).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        GM_xmlhttpRequest
// @connect      bcg.fashionportal.shop
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

  // ========= Stock mapping =========
  // Rule:
  // 1) Trek altijd 4 af van remote inventory (min 0)
  // 2) Op adjusted waarde:
  //    - <2  => 1
  //    - 2   => 2
  //    - 3   => 3
  //    - 4   => 4
  //    - 5   => 5
  //    - >5  => 5
  // 3) Remote = 0 -> ook 1 (maar alleen als de maat WEL bestaat in remote matrix)
  // 4) Maat ontbreekt in remote matrix -> NEGEREN (laat local ongemoeid)
  function mapAfterEdenInventoryToLocalStock(remoteInventory) {
    const r = Number(remoteInventory) || 0;

    // expliciet: 0 => 1
    if (r <= 0) return 1;

    const adjusted = Math.max(0, r - 4);

    if (adjusted < 2) return 1;
    if (adjusted === 2) return 2;
    if (adjusted === 3) return 3;
    if (adjusted === 4) return 4;
    return 5; // adjusted >= 5
  }

  // ========= Helpers =========
  const $ = (s, root = document) => root.querySelector(s);

  function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        anonymous: false, // <- gebruikt jouw lokale cookies
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  function normalizeLocalSize(s) {
    return String(s || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/–|—/g, '-');
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

  function isAfterEdenBrand() {
    const t = getBrandTitle().toLowerCase();
    return t.includes('after eden');
  }

  function getItemNumberFromSupplierPid() {
    const raw = document.querySelector(PID_SELECTOR)?.value || '';
    const pid = String(raw).trim().split(/[\s,;]+/)[0];
    return pid;
  }

  function parseHtmlToExactMap(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // header row met bandmaten (70/75/80/85)
    const headerRow = doc.querySelector('.qty-by-size-3D');
    const bandSizes = headerRow
      ? [...headerRow.querySelectorAll('.size-for.text-center')]
          .map(el => el.textContent.trim())
          .filter(Boolean)
      : [];

    // vervolg rows: per cup-letter links, dan cellen
    const rows = [...doc.querySelectorAll('.qty-by-size-3D')].slice(1);

    // exactMap: "70B" -> { remoteInventory, adjusted, mapped, itemVarId, status }
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

        const sizeKey = normalizeLocalSize(`${band}${cup}`); // "70B"
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

  function extractRowSizeKey(row) {
    const sizeInput = row.querySelector('input.product_option_small');
    return normalizeLocalSize(sizeInput?.value || '');
  }

  function applyToTable(exactMap) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return { matched: 0, report: [] };

    const rows = table.querySelectorAll('tbody tr');
    let matched = 0;

    const report = [];

    rows.forEach(row => {
      const sizeKey = extractRowSizeKey(row); // "70B" / "80C" etc
      const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');

      const localBefore = stockInput ? Number(stockInput.value || 0) : 0;

      const remoteObj = sizeKey ? exactMap.get(sizeKey) : null;

      // ✅ Cruciaal: maat ontbreekt remote -> NEGEREN (niet overschrijven)
      if (!remoteObj) {
        report.push({
          size: sizeKey || '(leeg)',
          local: localBefore,
          action: 'ignored (missing remote)'
        });
        return;
      }

      const remoteMapped = remoteObj.mapped;
      const remoteInv    = remoteObj.remoteInventory;
      const adjusted     = remoteObj.adjusted;
      const remoteStatus = remoteObj.status || '';

      let changed = false;

      if (stockInput) {
        const newStock = String(remoteMapped);
        if (stockInput.value !== newStock) {
          stockInput.value = newStock;
          stockInput.dispatchEvent(new Event('input', { bubbles: true }));
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
        action: changed ? 'updated' : 'no-change'
      });
    });

    console.groupCollapsed('[AfterEden] Apply report');
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
    setBtnState({ text: '⛏️ Stock | After Eden', bg: '#007cba', disabled: false, opacity: '1' });
    const btn = document.getElementById(BTN_ID);
    if (btn) updateButtonVisibility(btn);
  }

  function updateButtonVisibility(btn) {
    if (!btn) return;

    const okBrand = isAfterEdenBrand();
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
      btn.textContent = '⛏️ Stock | After Eden';
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

    const itemNumber = getItemNumberFromSupplierPid();
    if (!itemNumber) {
      setBtnState({ text: '❌ Geen Supplier PID', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    const url = STOCK_URL(itemNumber);
    console.log('[AfterEden] itemNumber:', itemNumber);
    console.log('[AfterEden] Stock URL:', url);

    setBtnState({ text: '⏳ Stock laden...', bg: '#f1c40f', disabled: true, opacity: '.85' });

    try {
      const res = await gmGet(url, { 'Accept': 'text/html,*/*' });
      if (res.status < 200 || res.status >= 300) throw new Error(`Stock: HTTP ${res.status}`);

      const html = res.responseText || '';
      const looksWrong = !html.includes('data-inventory=') && /login|sign in|unauthorized/i.test(html);
      if (looksWrong) throw new Error('LOGIN_REQUIRED');

      const { exactMap } = parseHtmlToExactMap(html);

      const { matched } = applyToTable(exactMap);

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
