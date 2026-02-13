// ==UserScript==
// @name         VCP2 | Zetex
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @connect      b2b.zetex.nl
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-zetex.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const BRAND_KEY = 'zetex';

  // -----------------------
  // Tool-side prerequisites
  // -----------------------
  if (ON_TOOL) {
    if (!Core) {
      console.error('[VCP2|Zetex] VCPCore ontbreekt. Check @require vcp-core.js');
      return;
    }
    if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
      console.error('[VCP2|Zetex] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
      return;
    }
  }

  // -----------------------
  // Config / URLs
  // -----------------------
  const CONFIG = {
    ZETEX_BASE_URL: 'https://b2b.zetex.nl',
    ZETEX_PRODUCT_PREFIX: '/webstore/v2/product/Zetex_01',
    uiDelayMs: 40,
  };

  const $ = (s, r=document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Cache: Map<supplierPid -> Map<EANdigits -> remoteQtyOrToken>>
  // (remote here is "free qty" extracted from Zetex, not mapped to target!)
  const PID_CACHE = new Map();

  // -----------------------
  // Logger (status -> logboek, mapping -> console.table)
  // -----------------------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    status(anchorId, txt) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(anchorId), String(txt));
      else console.info(`[Zetex][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[Zetex][${anchorId}] ean-vergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          ean: r.ean,
          local: r.local,
          remote: (r.remoteRaw ?? '—'),
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // -----------------------
  // GM GET (returns {status, text})
  // -----------------------
  function gmGet(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: timeoutMs,
        onload: (resp) => resolve({ status: resp.status, text: resp.responseText || '' }),
        onerror: (err) => reject(err || new Error('Netwerkfout')),
        ontimeout: () => reject(new Error(`timeout @ ${url}`)),
      });
    });
  }

  const isNotFoundHttp = (status) =>
    status === 401 || status === 403 || status === 404 || status === 410 || (status >= 500 && status <= 599);

  // -----------------------
  // Supplier PID helpers (pure)
  // -----------------------
  // "23222-600-6-710" → { base: "23222-600-6", color: "710" }
  function splitSupplierPid(rawPid) {
    const pid = String(rawPid || '').trim();
    if (!pid) return null;

    const idx = pid.lastIndexOf('-');
    if (idx === -1) return null;

    return { base: pid.slice(0, idx), color: pid.slice(idx + 1) };
  }

  function buildProductUrlFromPidParts(parts) {
    if (!parts?.base || !parts?.color) return null;

    return (
      CONFIG.ZETEX_BASE_URL +
      CONFIG.ZETEX_PRODUCT_PREFIX +
      '/' +
      encodeURIComponent(parts.base) +
      '/' +
      encodeURIComponent(parts.color)
    );
  }

  function extractDataUrlFromProductHtml(html) {
    let txt = String(html || '');
    txt = txt.replace(/\\u003f/gi, '?');
    txt = txt.replace(/\\\//g, '/');

    const patterns = [
      /wicketAjaxGet\('([^']*IBehaviorListener\.3-[^']*)'/,
      /"u":"([^"]*IBehaviorListener\.3-[^"]*)"/,
      /["'](\/webstore\/v2\/product\/Zetex_01\/[^"']*IBehaviorListener\.3-[^"']*)["']/
    ];

    for (const re of patterns) {
      const m = re.exec(txt);
      if (!m) continue;

      let url = m[1].replace(/\\\//g, '/');

      if (url.startsWith('/')) url = CONFIG.ZETEX_BASE_URL + url;
      else if (!/^https?:\/\//i.test(url)) url = CONFIG.ZETEX_BASE_URL.replace(/\/$/, '') + '/' + url.replace(/^\//, '');

      return url;
    }

    return null;
  }

  // -----------------------
  // Zetex response parsing -> Map<EANdigits -> remoteQty>
  // -----------------------
  function parseEanQtyMapFromWicketXml(xmlText) {
    const m = String(xmlText || '').match(/"sizes":\s*\{([\s\S]*?)\},"assortments"/);
    if (!m) return new Map();

    let sizesStr = '{' + m[1] + '}';
    sizesStr = sizesStr.replace(/\^/g, '');

    let sizesObj;
    try { sizesObj = JSON.parse(sizesStr); }
    catch { return new Map(); }

    const sizeList = Array.isArray(sizesObj.sizeList) ? sizesObj.sizeList : [];
    const map = new Map();

    for (const item of sizeList) {
      const eanDigits = String(item?.eanCode || '').replace(/\D/g, '');
      if (!eanDigits) continue;

      let qtyRaw = 0;
      const stockLevels = item?.stockLevels?.stockLevelList;
      if (Array.isArray(stockLevels) && stockLevels.length) {
        const lvl = stockLevels[0];
        if (lvl && typeof lvl.quantity !== 'undefined') qtyRaw = Number(lvl.quantity) || 0;
      }

      // ✅ remote qty blijft "raw qty"; mapping gebeurt centraal in StockRules
      map.set(eanDigits, qtyRaw);
    }

    return map;
  }

  async function fetchEanQtyMapForPid(supplierPid) {
    if (PID_CACHE.has(supplierPid)) return PID_CACHE.get(supplierPid);

    const parts = splitSupplierPid(supplierPid);
    if (!parts) throw new Error('TARGET_NOT_FOUND');

    const productUrl = buildProductUrlFromPidParts(parts);
    if (!productUrl) throw new Error('TARGET_NOT_FOUND');

    const res1 = await gmGet(productUrl);
    if (isNotFoundHttp(res1.status)) throw new Error(`HTTP_${res1.status}`);
    if (!(res1.status >= 200 && res1.status < 300)) throw new Error('TARGET_NOT_FOUND');

    const dataUrl = extractDataUrlFromProductHtml(res1.text);
    if (!dataUrl) throw new Error('TARGET_NOT_FOUND');

    const res2 = await gmGet(dataUrl);
    if (isNotFoundHttp(res2.status)) throw new Error(`HTTP_${res2.status}`);
    if (!(res2.status >= 200 && res2.status < 300)) throw new Error('TARGET_NOT_FOUND');

    const map = parseEanQtyMapFromWicketXml(res2.text);
    PID_CACHE.set(supplierPid, map);
    return map;
  }

  // -----------------------
  // Local table parsing (EAN + qty)
  // -----------------------
  function getColumnIndices(table) {
    const headerRow = table.querySelector('thead tr:last-child');
    if (!headerRow) return { eanCol: 2, stockCol: 1 };

    const ths = Array.from(headerRow.children);
    let eanCol = -1;
    let stockCol = -1;

    ths.forEach((th, idx) => {
      const txt = (th.textContent || '').trim().toLowerCase();
      if (eanCol === -1 && txt.includes('ean')) eanCol = idx;
      if (stockCol === -1 && (txt.includes('stock') || txt.includes('voorraad'))) stockCol = idx;
    });

    if (eanCol < 0) eanCol = 2;
    if (stockCol < 0) stockCol = 1;

    return { eanCol, stockCol };
  }

  function readLocalRowsEAN(table) {
    const { eanCol, stockCol } = getColumnIndices(table);
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    const out = [];
    for (const tr of rows) {
      const eanCell = tr.children[eanCol];
      const stockCell = tr.children[stockCol];

      const rawEanTxt = String(eanCell?.textContent || '').trim();
      const eanDigits = rawEanTxt.replace(/\D/g, '');
      const local = parseInt(String(stockCell?.textContent || '').trim(), 10) || 0;

      // maat proberen te pakken voor logging (kolom 0 meestal)
      const maatRaw = String(tr.dataset.size || tr.children?.[0]?.textContent || '').trim();

      out.push({ tr, maat: maatRaw || '', eanRaw: rawEanTxt, eanDigits, local });
    }
    return out;
  }

  function getSkuFromTable(table) {
    const id = String(table.id || '').trim();
    if (id) return id;

    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
    return label || '';
  }

  function getMaxCap(table) {
    try {
      if (typeof Core.getMaxCap === 'function') return Core.getMaxCap(table);
    } catch {}
    return 5;
  }

  // -----------------------
  // ✅ Apply: StockRules mapping + reconcile, Core.markRow
  // -----------------------
  function applyCompareAndMarkEAN(localRows, eanQtyMap, maxCap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, eanRaw, eanDigits, local } of localRows) {
      if (!eanDigits) continue;

      const remoteQty = eanQtyMap.get(eanDigits);
      if (typeof remoteQty !== 'number') continue;

      // ✅ centrale mapping: remoteQty is number
      const target = SR.mapRemoteToTarget(BRAND_KEY, remoteQty, maxCap);
      const res    = SR.reconcile(local, target, maxCap);

      const delta = Number(res?.delta || 0);
      let status = 'ok';

      if (res?.action === 'bijboeken' && delta > 0) {
        Core.markRow(tr, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, remote ${remoteQty})` });
        status = 'bijboeken';
        if (!firstMut) firstMut = tr;

      } else if (res?.action === 'uitboeken' && delta > 0) {
        Core.markRow(tr, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, remote ${remoteQty})` });
        status = 'uitboeken';
        if (!firstMut) firstMut = tr;

      } else {
        Core.markRow(tr, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remoteQty})` });
        status = 'ok';
      }

      report.push({
        maat,
        ean: eanDigits || eanRaw,
        local,
        remoteRaw: remoteQty,
        target,
        delta,
        status
      });
    }

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalStatus(report, eanQtyMap) {
    if (!eanQtyMap || eanQtyMap.size === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  // -----------------------
  // perTable
  // -----------------------
  async function perTable(table) {
    const supplierPid = String(table.id || '').trim();
    const headerText  = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
    const anchorId    = supplierPid || headerText || getSkuFromTable(table) || 'onbekend';

    if (!supplierPid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    let eanQtyMap;
    try {
      eanQtyMap = await fetchEanQtyMapForPid(supplierPid);
    } catch (e) {
      const msg = String(e?.message || e);

      if (/^HTTP_\d+$/i.test(msg)) {
        const status = parseInt(msg.replace(/^HTTP_/i, ''), 10);
        if (Number.isFinite(status) && isNotFoundHttp(status)) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          return 0;
        }
      }

      // parse / target not found / timeout -> niet-gevonden
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    if (!eanQtyMap || eanQtyMap.size === 0) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const localRows = readLocalRowsEAN(table);
    const maxCap = getMaxCap(table);

    const report = applyCompareAndMarkEAN(localRows, eanQtyMap, maxCap);
    Logger.status(anchorId, bepaalStatus(report, eanQtyMap));
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  // -----------------------
  // Run
  // -----------------------
  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable
    });
  }

  // -----------------------
  // Supplier select (Zetex + Pastunette)
  // -----------------------
  function normStr(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[_\s-]+/g, '')
      .trim();
  }

  function isZetexSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return true;
    const v = normStr(sel.value);
    const t = normStr(sel.options[sel.selectedIndex]?.textContent || '');
    return v.includes('zetex') || t.includes('zetex') || v.includes('pastunette') || t.includes('pastunette');
  }

  // -----------------------
  // UI (Core.mountSupplierButton)
  // -----------------------
  if (ON_TOOL) {
    Core.mountSupplierButton({
      id: 'vcp2-zetex-btn',
      text: '🔍 Check Stock | Zetex',
      right: 250,
      top: 8,
      match: () => isZetexSelected(),
      onClick: (btn) => run(btn),
    });
  }

})();
