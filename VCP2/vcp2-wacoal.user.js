// ==UserScript==
// @name         VCP2 | Wacoal new
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.7
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_addStyle
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @run-at       document-idle
// @connect      b2b.wacoal-europe.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-wacoal.user.js
// ==/UserScript==

(() => {
  'use strict';

GM_addStyle(`
  #vcp2-wacoal-recheck-btn {
    right: 470px !important;
    top: 8px !important;
    display: none !important;
  }

  #vcp2-wacoal-recheck-btn.vcp-show {
    display: inline-flex !important;
  }

  #vcp2-wacoal-export-checken-btn {
    right: 650px !important;
    top: 8px !important;
  }
`);

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR = g.StockRules;

  if (!Core) {
    console.error('[VCP2|Wacoal] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }

  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|Wacoal] StockRules ontbreekt of incompleet. Check @require stockrules.js');
    return;
  }

  const TIMEOUT = 15000;

  const DEBUG_REMOTE_KEYS = false;
  const DEBUG_PER_MAAT = false;

  const SUPPORTED_BRANDS = new Set([
    'wacoal', 'freya', 'freya swim', 'fantasie', 'fantasie swim',
    'elomi', 'elomi swim', 'wacoal group'
  ]);

  const $ = (s, r = document) => r.querySelector(s);

  const norm = (s = '') =>
    String(s).toLowerCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

  const cleanSize = (s = '') =>
    String(s).toUpperCase().trim().replace(/\s+/g, '').replace(/[^0-9A-Z/]/g, '');

  const cleanPid = (s = '') =>
    String(s).trim();

  function getLocalMaat(row) {
    const visible = row.children[0]?.textContent || '';
    const dataSize = row.dataset.size || '';
    return cleanSize(visible || dataSize);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },

    status(id, txt) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), txt);
      else console.info(`[Wacoal][${id}] status: ${txt}`);
    },

    perMaat(id, report) {
      if (!DEBUG_PER_MAAT) return;

      console.groupCollapsed(`[Wacoal][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remoteStatus: r.remoteStatus || '—',
          remote: r.remote ?? '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally {
        console.groupEnd();
      }
    }
  };

  let recheckButtonUpdateTimer = null;

  function scheduleRecheckButtonVisibility() {
    clearTimeout(recheckButtonUpdateTimer);
    recheckButtonUpdateTimer = setTimeout(updateRecheckButtonVisibility, 100);
  }

  function updateRecheckButtonVisibility() {
  const btn = document.querySelector('#vcp2-wacoal-recheck-btn');
  if (!btn) return;

  const count = document.querySelectorAll(
    '#output table[data-wacoal-checken="1"]'
  ).length;

  const isRunning = btn.dataset.running === '1';

  if (!isRunning) {
    btn.textContent = `🔁 Herchecken: ${count}`;
  }

  btn.classList.toggle('vcp-show', count > 0);
}

  function setTableChecken(table, isChecken) {
    if (isChecken) {
      table.dataset.wacoalChecken = '1';
    } else {
      delete table.dataset.wacoalChecken;
    }

    scheduleRecheckButtonVisibility();
  }

  function setCheckenStatus(anchorId) {
    Logger.status(anchorId, 'checken');
  }

  function gmFetchOnce(url, meta = {}) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        fetch: true,
        timeout: TIMEOUT,
        headers: {
          Accept: 'application/json'
        },

        onload: r => {
          resolve({
            ok: true,
            status: r.status,
            statusText: r.statusText || '',
            headers: r.responseHeaders || '',
            text: r.responseText || '',
            finalUrl: r.finalUrl || url,
            duration: Date.now() - startedAt
          });
        },

        onerror: r => {
          reject({
            type: 'onerror',
            url,
            meta,
            duration: Date.now() - startedAt,
            status: r?.status,
            statusText: r?.statusText,
            finalUrl: r?.finalUrl,
            responseHeaders: r?.responseHeaders,
            responseText: r?.responseText,
            raw: r
          });
        },

        ontimeout: r => {
          reject({
            type: 'timeout',
            url,
            meta,
            duration: Date.now() - startedAt,
            timeout: TIMEOUT,
            raw: r
          });
        }
      });
    });
  }

  async function gmFetch(url, meta = {}) {
    try {
      console.info(`[VCP2|Wacoal][REQUEST TRY 1/1]`, meta.pid || '', url);

      const res = await gmFetchOnce(url, {
        ...meta,
        attempt: 1
      });

      console.info(
        '[VCP2|Wacoal][REQUEST OK]',
        meta.pid || '',
        `HTTP ${res.status}`,
        `${res.duration}ms`,
        `length=${res.text.length}`
      );

      return res;

    } catch (e) {
      console.warn(
        `[VCP2|Wacoal][REQUEST FAILED 1/1]`,
        meta.pid || '',
        e
      );

      throw {
        type: 'request_failed_once',
        url,
        meta,
        attempts: 1,
        lastError: e
      };
    }
  }

  function classifyWacoalResponse(res) {
    const status = Number(res?.status ?? 0);
    const text = String(res?.text || '').trim();
    const lower = text.toLowerCase();

    if (!text) {
      return { type: 'request_error', reason: 'lege response' };
    }

    if (status === 404 || status === 410) {
      return { type: 'not_found', reason: `HTTP ${status}` };
    }

    if (lower.startsWith('<!doctype') || lower.startsWith('<html') || lower.includes('<html')) {
      return { type: 'not_found', reason: 'HTML response in plaats van JSON' };
    }

    try {
      const json = JSON.parse(text);

      if (json && Array.isArray(json.sizeData)) {
        return { type: 'json', json };
      }

      return { type: 'not_found', reason: 'JSON zonder sizeData' };

    } catch (e) {
      return { type: 'not_found', reason: 'geen geldige JSON' };
    }
  }

  function getEffectiveRemoteStock(stockLevel, wacoalStatusRaw) {
    const ws = String(wacoalStatusRaw || '').toUpperCase().trim();
    const qty = Number(stockLevel || 0) || 0;

    return ws === 'IN_STOCK' ? qty : 0;
  }

  function buildStatusMap(json) {
    const map = {};

    if (!json?.is2DSizing) {
      for (const cell of (json?.sizeData || [])) {
        const sizeEU = cleanSize(cell?.countrySizeMap?.EU || cell?.globalSize || '');
        if (!sizeEU) continue;

        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = String(cell?.stock?.wacoalstockStatus || '').toUpperCase();
        const effectiveStock = getEffectiveRemoteStock(stockLevel, wacoal);

        map[sizeEU] = {
          status: wacoal || 'UNKNOWN',
          stock: effectiveStock,
          wacoal
        };
      }

      return map;
    }

    for (const row of (json?.sizeData || [])) {
      for (const cell of (row?.sizeFitData || [])) {
        const bandEU = String(cell?.countrySizeMap?.EU || '').trim();
        const cupEU = String(cell?.countryFitMap?.EU || '').trim();

        if (!bandEU || !cupEU) continue;

        const key = cleanSize(`${bandEU}${cupEU}`);
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = String(cell?.stock?.wacoalstockStatus || '').toUpperCase();
        const effectiveStock = getEffectiveRemoteStock(stockLevel, wacoal);

        map[key] = {
          status: wacoal || 'UNKNOWN',
          stock: effectiveStock,
          wacoal
        };
      }
    }

    return map;
  }

  function resolveRemote(map, label) {
    const raw = cleanSize(label);

    if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];

    const m = raw.match(/^(\d+)([A-Z]{1,2}(?:\/[A-Z]{1,2})+)$/);

    if (m) {
      const band = m[1];
      const cups = m[2].split('/');
      let best = null;

      for (const cup of cups) {
        const k = cleanSize(`${band}${cup}`);
        if (map[k] && (!best || map[k].stock > best.stock)) best = map[k];
      }

      if (best) return best;
    }

    if (raw.includes('/')) {
      let best = null;

      for (const part of raw.split('/').map(cleanSize)) {
        const cand = map[part];
        if (cand && (!best || cand.stock > best.stock)) best = cand;
      }

      if (best) return best;
    }

    return undefined;
  }

  function markAllLocalAsRemove(table, reason = 'niet gevonden bij Wacoal') {
    const rows = table.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat = getLocalMaat(row);
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      if (local > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta: local,
          title: `Uitboeken ${local} (${reason})`
        });

        if (!firstMut) firstMut = row;

        report.push({
          maat,
          local,
          remoteStatus: 'NOT_FOUND',
          remote: 'not found',
          target: 0,
          delta: local,
          status: 'uitboeken'
        });

      } else {
        Core.markRow(row, {
          action: 'none',
          delta: 0,
          title: `Geen lokale voorraad (${reason})`
        });

        report.push({
          maat,
          local,
          remoteStatus: 'NOT_FOUND',
          remote: 'not found',
          target: 0,
          delta: 0,
          status: 'ok'
        });
      }
    });

    if (firstMut) Core.jumpFlash(firstMut);

    return report;
  }

  function markAllLocalAsUncertain(table, reason = 'niet betrouwbaar opgehaald') {
    const rows = table.querySelectorAll('tbody tr');
    const report = [];

    rows.forEach(row => {
      const maat = getLocalMaat(row);
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      Core.markRow(row, {
        action: 'none',
        delta: 0,
        title: `Niet muteren (${reason})`
      });

      report.push({
        maat,
        local,
        remoteStatus: 'REQUEST_ERROR',
        remote: 'request error',
        target: NaN,
        delta: 0,
        status: 'checken'
      });
    });

    return report;
  }

  function applyRulesAndMark(localTable, statusMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat = getLocalMaat(row);
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = resolveRemote(statusMap, maat);
      const supplierQty = remoteEntry ? (Number(remoteEntry.stock ?? 0) || 0) : 0;

      const target = remoteEntry
        ? (supplierQty > 0 ? SR.mapRemoteToTarget('wacoal', supplierQty, 5) : 0)
        : 0;

      const res = SR.reconcile(local, target, 5);
      const delta = res.delta;

      let status = 'ok';

      if (res.action === 'bijboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'add',
          delta,
          title: `Bijboeken ${delta} (target ${target}, supplier qty ${supplierQty})`
        });

        status = 'bijboeken';
        if (!firstMut) firstMut = row;

      } else if (res.action === 'uitboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta,
          title: remoteEntry
            ? `Uitboeken ${delta} (target ${target}, supplier qty ${supplierQty})`
            : `Uitboeken ${delta} (maat niet gevonden bij Wacoal)`
        });

        status = 'uitboeken';
        if (!firstMut) firstMut = row;

      } else {
        Core.markRow(row, {
          action: 'none',
          delta: 0,
          title: remoteEntry
            ? `OK (target ${target}, supplier qty ${supplierQty})`
            : 'OK / geen lokale voorraad (maat niet gevonden bij Wacoal)'
        });
      }

      report.push({
        maat,
        local,
        remoteStatus: remoteEntry?.wacoal || remoteEntry?.status || 'NOT_FOUND',
        remote: remoteEntry ? supplierQty : 'not found',
        target,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);

    return report;
  }

  function bepaalLogStatus(report) {
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  async function perTable(table) {
    const pid = (table.id || '').trim();

    const label =
      table.querySelector('thead th[colspan]')?.textContent?.trim()
      || pid
      || 'onbekend';

    const anchorId = pid || label;

    if (!pid) {
      const report = markAllLocalAsRemove(table, 'geen productcode');

      setTableChecken(table, false);
      Logger.status(anchorId, bepaalLogStatus(report));
      Logger.perMaat(anchorId, report);

      return report.filter(r => r.status === 'uitboeken').length;
    }

    const url = `https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(pid)}`;

    try {
      const res = await gmFetch(url, { pid, anchorId });
      const classified = classifyWacoalResponse(res);

      if (classified.type === 'not_found') {
        const report = markAllLocalAsRemove(table, classified.reason);

        setTableChecken(table, false);
        Logger.status(
          anchorId,
          report.some(r => r.status === 'uitboeken') ? 'afwijking' : 'niet-gevonden'
        );

        Logger.perMaat(anchorId, report);

        return report.filter(r => r.status === 'uitboeken').length;
      }

      if (classified.type === 'request_error') {
        const report = markAllLocalAsUncertain(table, classified.reason);

        setTableChecken(table, true);
        setCheckenStatus(anchorId);
        Logger.perMaat(anchorId, report);

        return 0;
      }

      const json = classified.json;
      const statusMap = buildStatusMap(json);

      if (DEBUG_REMOTE_KEYS) {
        console.groupCollapsed(`[Wacoal][${anchorId}] remote keys`);
        console.log(Object.keys(statusMap));
        console.groupEnd();
      }

      if (!statusMap || Object.keys(statusMap).length === 0) {
        const report = markAllLocalAsRemove(table, 'geen stockdata bij Wacoal');

        setTableChecken(table, false);
        Logger.status(
          anchorId,
          report.some(r => r.status === 'uitboeken') ? 'afwijking' : 'niet-gevonden'
        );

        Logger.perMaat(anchorId, report);

        return report.filter(r => r.status === 'uitboeken').length;
      }

      const report = applyRulesAndMark(table, statusMap);
      const status = bepaalLogStatus(report);

      setTableChecken(table, false);
      Logger.status(anchorId, status);
      Logger.perMaat(anchorId, report);

      return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;

    } catch (e) {
      console.group(`[VCP2|Wacoal][PER TABLE CATCH] ${anchorId}`);
      console.error('pid:', pid);
      console.error('url:', url);
      console.error('error:', e);
      console.groupEnd();

      const report = markAllLocalAsUncertain(
        table,
        'request mislukt na retries - niet muteren'
      );

      setTableChecken(table, true);
      setCheckenStatus(anchorId);
      Logger.perMaat(anchorId, report);

      return 0;
    } finally {
      await sleep(0);
    }
  }

  async function runTables(btn, tables) {
    await Core.runTables({
      btn,
      tables,
      concurrency: 1,
      perTable
    });

    updateRecheckButtonVisibility();
  }

  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    await runTables(btn, tables);
  }

async function rerunChecken(btn) {
  const tables = Array.from(
    document.querySelectorAll(
      '#output table[data-wacoal-checken="1"]'
    )
  );

  if (!tables.length) {
    console.info(
      '[VCP2|Wacoal] Geen checken-items gevonden.'
    );

    updateRecheckButtonVisibility();
    return;
  }

  console.info(
    `[VCP2|Wacoal] Hercheck ${tables.length} checken-item(s).`
  );

  btn.dataset.running = '1';

  try {
    await runTables(btn, tables);

  } finally {
    delete btn.dataset.running;

    updateRecheckButtonVisibility();
  }
}

function getTableHeaderCell(table) {
  return table.querySelector('thead th[colspan]');
}

function getTableMeta(table) {
  const th = table.querySelector(
    'thead th[colspan]'
  );

  const raw =
    th?.childNodes?.[0]?.textContent?.trim()
    || '';

  const supplierPid = cleanPid(
    table.id || ''
  );

  let model = '';
  let color = '';

  const match = raw.match(
    /^(.+?)\s+([^-–]+)$/
  );

  if (match) {
    model = match[1].trim();
    color = match[2].trim();

  } else {
    model = raw.trim();
  }

  const productLink =
    th?.querySelector(
      'a[href*="section=products"]'
    );

  let localProductId = '';

  if (productLink) {

    const href =
      productLink.getAttribute(
        'href'
      ) || '';

    const m = href.match(
      /id=([0-9]+)/
    );

    if (m) {
      localProductId = m[1];

    } else {
      localProductId =
        (
          productLink.textContent
          || ''
        ).trim();
    }
  }

  return {
    model,
    color,
    supplierPid,
    localProductId
  };
}

function getCheckenTables() {
  return Array.from(document.querySelectorAll('#output table[data-wacoal-checken="1"]'));
}

function getValueFromRow(row, keys = []) {
  for (const key of keys) {
    if (row.dataset?.[key]) return String(row.dataset[key]).trim();

    const el = row.querySelector(
      `[data-${key}], input[name*="${key}" i], input[id*="${key}" i], [name*="${key}" i], [id*="${key}" i]`
    );

    if (el) {
      const val = el.value || el.dataset?.[key] || el.textContent || '';
      if (String(val).trim()) return String(val).trim();
    }
  }

  return '';
}

function getRowEAN(row) {
  const direct = getValueFromRow(row, [
    'ean',
    'barcode',
    'gtin'
  ]);

  if (direct) return direct;

  const txt = row.textContent || '';
  const match = txt.match(/\b\d{8,14}\b/);

  return match ? match[0] : '';
}

function getCheckenExportRows() {
  const rows = [];

  for (const table of getCheckenTables()) {
    const meta = getTableMeta(table);

    if (!meta.supplierPid) continue;

    const trList = Array.from(table.querySelectorAll('tbody tr'));

    for (const row of trList) {
      const maat = getLocalMaat(row);
      const stock = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      rows.push([
        '',                    // A leeg
        meta.model,            // B Model, bijv. Brianna
        meta.supplierPid,      // C Product ID leverancier, bijv. EL8085BLK
        meta.color,            // D Color, bijv. Zwart
        maat,                  // E Size
        stock,                 // F Stock
        '',                    // G Advice Price
        '',                    // H Price
        getRowEAN(row),        // I EAN
        meta.localProductId    // J lokale Product ID, bijv. 37045
      ]);
    }
  }

  return rows;
}

function exportCheckenXlsx() {
  if (typeof XLSX === 'undefined') {
    alert('XLSX-library is niet geladen. Exporteren kan niet.');
    return;
  }

  const header = [
    '',
    'Model',
    'Product ID',
    'Color',
    'Size',
    'Stock',
    'Advice Price',
    'Price',
    'EAN',
    'Product ID'
  ];

  const rows = getCheckenExportRows();

  if (!rows.length) {
    alert('Geen checken-items om te exporteren.');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Variant');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `variant_wacoal_checken_${date}.xlsx`);

  console.info(`[VCP2|Wacoal] ${rows.length} checken-regel(s) geëxporteerd.`);
}

  function isSupportedSelected() {
    const dd = $('#leverancier-keuze');
    if (!dd) return true;

    const byValue = norm(dd.value || '');
    const byText = norm(dd.options?.[dd.selectedIndex]?.text || '');

    return SUPPORTED_BRANDS.has(byValue) || SUPPORTED_BRANDS.has(byText);
  }

  Core.mountSupplierButton({
    id: 'vcp2-wacoal-btn',
    text: '🔍 Check Stock | Wacoal',
    right: 250,
    top: 8,
    match: () => isSupportedSelected(),
    onClick: btn => run(btn)
  });

  Core.mountSupplierButton({
    id: 'vcp2-wacoal-recheck-btn',
    text: '🔁 Herchecken: 0',
    right: 470,
    top: 8,
    match: () => isSupportedSelected(),
    onClick: btn => rerunChecken(btn)
  });

  Core.mountSupplierButton({
  id: 'vcp2-wacoal-export-checken-btn',
  text: '💾 Download Checkers',
  right: 650,
  top: 8,
  match: () => isSupportedSelected(),
  onClick: () => exportCheckenXlsx()
});

  updateRecheckButtonVisibility();

})();
