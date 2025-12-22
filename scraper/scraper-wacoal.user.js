// ==UserScript==
// @name         EAN Scraper | Wacoal Group
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.6.0
// @description  Haal Wacoal Group stock via pdpOrderForm (band-only of band+cup) + EAN via Google Sheet (gid per merk, vaste kolommen A/E/F). Vul #tabs-3 in (DDO admin). Hotkey: Ctrl+Shift+W (autosave).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @match        https://b2b.wacoal-europe.com/*
// @grant        GM_xmlhttpRequest
// @connect      b2b.wacoal-europe.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @run-at       document-end
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-wacoal.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_ADMIN = location.hostname.includes('dutchdesignersoutlet.com');
  if (!ON_ADMIN) return;

  // ========= Config =========
  const SHEET_ID = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';

  // ✅ uitbreidbaar
  const SHEET_GID_BY_BRAND = {
    wacoal: '890980427',
    freya:  '62174747',
    // voeg later merken toe
  };

  const STOCK_URL = (supplierPidBase) =>
    `https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(supplierPidBase)}`;

  const TABLE_SELECTOR       = '#tabs-3 table.options';
  const PID_SELECTOR         = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  const BTN_ID = 'wacoalgroup-sse-btn';

  // ✅ Ctrl+Shift+S = autosave (géén cache reset)
  const HOTKEY = { ctrl: true, shift: true, alt: false, key: 's' };

  const SHEET_CACHE_TTL_MS = 60 * 60 * 1000;
  const SHEET_AUTHUSER_KEY = 'wacoalgroupSheetAuthUser';

  // ========= Helpers =========
  const $ = (s, root = document) => root.querySelector(s);

  function gmGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        anonymous: false,
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

  function baseSupplierPid(raw) {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    const first = s.split(/[\s,;]+/)[0];
    const cut = first.split('-')[0];
    return cut.replace(/[^A-Z0-9]/g, '');
  }

  // Naturana mapping
  function mapNaturanaStockLevel(remoteQty) {
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n > 4)  return 5;
    return 0;
  }

  function getStockLevel(node) {
    const n = Number(node?.stock?.stockLevel ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  function getStage(node) {
    return String(node?.stock?.wacoalstockStatus || '').toUpperCase().trim();
  }

  // ✅ Rule:
  // - stage ontbreekt + level<=0 => 0
  // - stage === IN_STOCK:
  //     - level>0 => Naturana mapping
  //     - level<=0 => 1
  // - anders (WITHIN_STAGE1/2/...) => 1
  function mapWacoalStock(node) {
    const lvl = getStockLevel(node);
    const st  = getStage(node);

    if (!st && lvl <= 0) return 0;

    if (st === 'IN_STOCK') {
      if (lvl > 0) return mapNaturanaStockLevel(lvl);
      return 1;
    }

    if (st) return 1;
    return lvl > 0 ? mapNaturanaStockLevel(lvl) : 0;
  }

  function stageRank(stage) {
    const s = String(stage || '').toUpperCase();
    if (s === 'IN_STOCK') return 4;
    if (s === 'WITHIN_STAGE1') return 3;
    if (s === 'WITHIN_STAGE2') return 2;
    if (s) return 1;
    return 0;
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
    if (t.includes('wacoal')) return 'wacoal';
    if (t.includes('freya'))  return 'freya';
    return '';
  }

  function getSheetGidForBrand() {
    const key = getBrandKey();
    return key ? (SHEET_GID_BY_BRAND[key] || '') : '';
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

  function clickUpdateProductButton() {
    const saveBtn =
      document.querySelector('input[type="submit"][name="edit"]') ||
      document.querySelector('button[name="edit"]');
    if (!saveBtn) return false;
    saveBtn.click();
    return true;
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
    setBtnState({ text: '⛏️ SS&E | Wacoal Group', bg: '#007cba', disabled: false, opacity: '1' });
    const btn = document.getElementById(BTN_ID);
    if (btn) updateButtonVisibility(btn);
  }

  function updateButtonVisibility(btn) {
    if (!btn) return;
    const okBrand = !!getBrandKey() && !!getSheetGidForBrand();
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
      btn.textContent = '⛏️ SS&E | Wacoal Group';
      btn.style.cssText = `
        position: fixed; right: 10px; top: 10px; z-index: 999999;
        padding: 10px 12px; background: #007cba; color: #fff;
        border: none; border-radius: 8px; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);

      // ✅ button click: cache reset + force refresh, no autosave
      btn.addEventListener('click', () => onScrapeClick(false, true));
    }
    updateButtonVisibility(btn);
  }

  // ========= Sheet cache reset =========
  function resetSheetCacheForAllGids() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(`wacoalgroupSheetCache:${SHEET_ID}:`))
        .forEach(k => localStorage.removeItem(k));
      console.log('[SS&E] Sheet cache cleared (button click)');
    } catch (e) {
      console.warn('[SS&E] Sheet cache clear failed', e);
    }
  }

  function sheetCacheKeyForGid(gid) {
    return `wacoalgroupSheetCache:${SHEET_ID}:${gid}`;
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

  async function fetchSheetRawByGid(gid, { force = false } = {}) {
    const cache = readSheetCache(gid);
    if (!force && cache) return { text: cache.text, authuser: cache.authuser, fromCache: true };

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

  // ========= EAN map (A/E/F) =========
  // Sheet columns:
  // A = SKU Code
  // E = BarCode (EAN)
  // F = EU Size (maat)
  function buildEanMapFromRows_FixedCols(rows, supplierPidBase) {
    const eanMap = new Map();
    const pid1 = baseSupplierPid(supplierPidBase);
    const pid2 = pid1.replace(/^WA/, '');

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;

      const colA_sku  = String(r[0] || '').trim().toUpperCase();
      const colE_ean  = String(r[4] || '').trim();
      const colF_size = String(r[5] || '').trim();
      if (!colA_sku || !colE_ean || !colF_size) continue;

      const skuNorm = colA_sku.replace(/[^A-Z0-9]/g, '');
      const starts =
        (pid1 && skuNorm.startsWith(pid1)) ||
        (pid2 && skuNorm.startsWith(pid2));
      if (!starts) continue;

      const sizeKey = normalizeLocalSize(colF_size);
      const ean = colE_ean.replace(/\D/g, '');
      if (!sizeKey || !ean) continue;

      eanMap.set(sizeKey, ean);
    }

    console.log('[SS&E] EAN map size:', eanMap.size, 'pid:', baseSupplierPid(supplierPidBase));
    return eanMap;
  }

  // ========= Stock fetch =========
  async function fetchStockJson(supplierPidBase) {
    const url = STOCK_URL(supplierPidBase);
    console.log('[SS&E] Stock URL:', url);

    const res = await gmGet(url, { 'Accept': 'application/json, text/plain, */*' });
    console.log('[SS&E] Stock HTTP:', res.status, 'len:', (res.responseText || '').length);

    if (res.status < 200 || res.status >= 300) throw new Error(`Stock: HTTP ${res.status}`);

    const text = res.responseText || '';
    if (isLikelyHtml(text)) throw new Error('LOGIN_REQUIRED');

    try { return JSON.parse(text); }
    catch {
      console.warn('[SS&E] Stock JSON parse fail, first 300 chars:', text.slice(0, 300));
      throw new Error('Stock: JSON parse error');
    }
  }

  // ========= Stock parsing (STRICT) =========
  // 1D: sizeData nodes have countrySizeMap.EU directly (band-only or S/M/L)
  // 2D: sizeData nodes have countrySizeMap=null and variants are inside sizeFitData[]
  function buildStockMapsFromWacoalJson_Strict(json) {
    const bandMap  = new Map(); // "70" or "S" -> best {mapped, stockLevel, stage}
    const exactMap = new Map(); // "70D" -> best {mapped, stockLevel, stage}

    const sizeData = Array.isArray(json?.sizeData) ? json.sizeData : [];
    const is2D = !!json?.is2DSizing;

    console.log('[SS&E] Stock JSON root keys:', json && typeof json === 'object' ? Object.keys(json) : '(not object)');
    console.log('[SS&E] is2DSizing:', is2D, 'sizeData len:', sizeData.length);

    const variantRows = [];
    let bandSeen = 0, cupSeen = 0;

    if (is2D) {
      // ✅ STRICT 2D: ignore bandNode.countrySizeMap (it is null). Only parse variants.
      for (const bandNode of sizeData) {
        const fits = Array.isArray(bandNode?.sizeFitData) ? bandNode.sizeFitData : [];
        for (const v of fits) {
          // skip empty placeholders where maps are null
          const euBandRaw = v?.countrySizeMap?.EU;
          const euCupRaw  = v?.countryFitMap?.EU;

          const band = normalizeLocalSize(euBandRaw);
          const cup  = normalizeLocalSize(euCupRaw);

          if (!band || !cup) continue; // <- this will drop the "available:false countrySizeMap:null" entries

          const key = normalizeLocalSize(`${band}${cup}`); // "70D"

          const mapped = mapWacoalStock(v);
          const lvl    = getStockLevel(v);
          const st     = getStage(v);

          cupSeen++;

          // exactMap (70D)
          const p = exactMap.get(key);
          if (!p || mapped > p.mapped || (mapped === p.mapped && stageRank(st) > stageRank(p.stage))) {
            exactMap.set(key, { mapped, stockLevel: lvl, stage: st });
          }

          // bandMap best-of-band (70)
          const bp = bandMap.get(band);
          if (!bp || mapped > bp.mapped || (mapped === bp.mapped && stageRank(st) > stageRank(bp.stage))) {
            bandMap.set(band, { mapped, stockLevel: lvl, stage: st });
          }

          variantRows.push({
            type: '2D',
            size: key,
            band,
            cup,
            stockLevel: lvl,
            mapped,
            stage: st,
            sku: v?.sku || v?.code || ''
          });
        }
      }
    } else {
      // ✅ 1D: band-only or S/M/L on bandNode itself
      for (const bandNode of sizeData) {
        const band = normalizeLocalSize(bandNode?.countrySizeMap?.EU);
        if (!band) continue;

        bandSeen++;

        const mapped = mapWacoalStock(bandNode);
        const lvl = getStockLevel(bandNode);
        const st = getStage(bandNode);

        const prev = bandMap.get(band);
        if (!prev || mapped > prev.mapped || (mapped === prev.mapped && stageRank(st) > stageRank(prev.stage))) {
          bandMap.set(band, { mapped, stockLevel: lvl, stage: st });
        }

        variantRows.push({
          type: '1D',
          size: band,
          stockLevel: lvl,
          mapped,
          stage: st,
          sku: bandNode?.sku || bandNode?.code || ''
        });
      }
    }

    console.log('[SS&E] parsed bandSeen:', bandSeen, 'cupSeen:', cupSeen);
    console.groupCollapsed('[SS&E] Remote variants (incl stage)');
    console.table(variantRows);
    console.groupEnd();

    console.log('[SS&E] bandMap:', bandMap.size, 'sample:', [...bandMap.entries()].slice(0, 10));
    console.log('[SS&E] exactMap:', exactMap.size, 'sample:', [...exactMap.entries()].slice(0, 10));
    return { bandMap, exactMap };
  }

  // ========= Apply =========
  function extractRowSizeKey(row) {
    const sizeInput = row.querySelector('input.product_option_small');
    return normalizeLocalSize(sizeInput?.value || '');
  }

  function applyToTable(bandMap, exactMap, eanMap) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return 0;

    const rows = table.querySelectorAll('tbody tr');
    let matched = 0;

    const report = [];

    rows.forEach(row => {
      const sizeKey = extractRowSizeKey(row); // "70" / "S" / "70D"
      const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');
      const eanInput   = row.querySelector('input[name^="options"][name$="[barcode]"]');

      const localBefore = stockInput ? Number(stockInput.value || 0) : 0;

      const remoteObj =
        (sizeKey && exactMap.get(sizeKey)) ||
        (sizeKey && bandMap.get(sizeKey)) ||
        null;

      const remoteMapped = remoteObj?.mapped ?? 0;
      const remoteLevel  = remoteObj?.stockLevel ?? 0;
      const remoteStage  = remoteObj?.stage || '';

      const remoteEan = (sizeKey && eanMap.get(sizeKey)) || '';

      let changed = false;

      if (stockInput) {
        const newStock = String(remoteMapped || 0);
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
        remoteMapped,
        remoteLevel,
        stage: remoteStage,
        ean: remoteEan || ''
      });
    });

    console.groupCollapsed('[SS&E] Overzicht per maat (incl stage)');
    console.table(report);
    console.groupEnd();

    return matched;
  }

  // ========= Runner =========
  async function onScrapeClick(autoSaveThisRun, resetCacheThisRun) {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    const gid = getSheetGidForBrand();
    const brandKey = getBrandKey();
    if (!brandKey || !gid) {
      setBtnState({ text: '❌ Geen gid voor dit merk', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!isTab3Active()) {
      setBtnState({ text: '❌ Open tab Maten/Opties', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    const supplierPidRaw = $(PID_SELECTOR)?.value?.trim();
    const supplierPidBase = baseSupplierPid(supplierPidRaw);
    if (!supplierPidBase) {
      setBtnState({ text: '❌ Geen Supplier PID', bg: '#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    console.log('[SS&E] supplierPidRaw:', supplierPidRaw, 'supplierPidBase:', supplierPidBase);

    if (resetCacheThisRun) resetSheetCacheForAllGids();

    setBtnState({ text: `⏳ Stock laden (${brandKey})...`, bg: '#f1c40f', disabled: true, opacity: '.8' });

    try {
      const stockJson = await fetchStockJson(supplierPidBase);
      const { bandMap, exactMap } = buildStockMapsFromWacoalJson_Strict(stockJson);

      setBtnState({ text: `⏳ Sheet (EAN) laden (gid ${gid})...`, bg: '#6c757d', disabled: true, opacity: '.8' });

      const raw  = await fetchSheetRawByGid(gid, { force: !!resetCacheThisRun });
      const rows = parseTsv(raw.text);
      console.log('[SS&E] Sheet rows:', rows.length, 'firstRow:', rows[0]);

      const eanMap = buildEanMapFromRows_FixedCols(rows, supplierPidBase);

      const matched = applyToTable(bandMap, exactMap, eanMap);

      setBtnState({
        text: matched ? `📦 ${matched} rijen gevuld` : '⚠️ 0 rijen gevuld',
        bg: matched ? '#2ecc71' : '#f39c12',
        disabled: false,
        opacity: '1'
      });
      setTimeout(resetBtn, 2500);

      if (autoSaveThisRun && matched > 0) clickUpdateProductButton();
    } catch (e) {
      console.error('[SS&E]', e);
      const msg = String(e?.message || e);
      if (/LOGIN_REQUIRED/i.test(msg)) alert('Login required. Log in op b2b.wacoal-europe.com en probeer opnieuw.');
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
    // ✅ hotkey = autosave, GEEN cache reset
    onScrapeClick(true, false);
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

    if (!window.__wacoalgroupSseHotkeyBound) {
      document.addEventListener('keydown', onScrapeHotkey);
      window.__wacoalgroupSseHotkeyBound = true;
    }
  }

  bootAdmin();

})();
