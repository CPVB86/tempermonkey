// ==UserScript==
// @name         VCP2 | Charlie Choe
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      vangennip.itsperfect.it
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-charlie-choe.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-charlie-choe.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) {
    console.error('[VCP2|CharlieChoe] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|CharlieChoe] StockRules ontbreekt of incompleet. Check @require stockrules.js');
    return;
  }

  // ---------- Config ----------
  const TIMEOUT = 15000;
  const SUPPORTED = new Set(['charlie choe','charlie','charlie-choe']);

  const $ = (s, r=document) => r.querySelector(s);
  const norm = (s='') => String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
  const stripPrefixAfterColon = (s) => String(s || '').replace(/^\s*[^:]*:\s*/, '');

  function normSizeKey(raw){
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g,'');
  }

  // PID: laatste numerieke segment uit table.id of data-vg-pid
  function extractPidFromTable(table){
    if (table?.dataset?.vgPid && /^\d+$/.test(table.dataset.vgPid)) return table.dataset.vgPid.trim();
    const rawId=(table?.id||'').trim();
    const m = rawId.match(/[-_](\d+)\D*$/);
    if (m) return m[1];
    if (/^\d+$/.test(rawId)) return rawId;
    return '';
  }

  // ---------- Logger (status -> logboek; mapping -> console) ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    status(id, txt, extra) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), String(txt), extra);
      else console.info(`[CharlieChoe][${id}] status: ${txt}`, extra || '');
    },
    perMaat(id, report) {
      console.groupCollapsed(`[CharlieChoe][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat:   r.maat,
          local:  r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta:  Number.isFinite(r.delta)  ? r.delta  : '—',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // ---------- GM fetch ----------
  function gmFetch(url){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET',
        url,
        withCredentials:true,
        timeout: TIMEOUT,
        headers:{
          'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'X-Requested-With':'XMLHttpRequest',
          'User-Agent': navigator.userAgent,
          'Referer': 'https://vangennip.itsperfect.it/webshop/shop'
        },
        onload:(r)=> (r.status>=200 && r.status<400)
          ? resolve(r.responseText||'')
          : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject,
        ontimeout:()=>reject(new Error('timeout'))
      });
    });
  }

  const PDP_URL = (pid)=>`https://vangennip.itsperfect.it/webshop/shop/p_id=${encodeURIComponent(pid)}/`;
  async function fetchProductPageHTML(pid){
    return (await gmFetch(PDP_URL(pid))) || '';
  }

  // ---------- Parser (matrix + legacy) ----------
  function parseRemoteStockFromPDP(html){
    if (!html) return {};
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // v5 matrix
    const matrix = doc.querySelector('.product-matrix');
    if (matrix){
      const headerMaten = Array
        .from(matrix.querySelectorAll('thead .product-matrix__header.product-matrix__size, thead th.product-matrix__size'))
        .map(th => th.textContent.trim())
        .filter(Boolean)
        .map(stripPrefixAfterColon)
        .map(normSizeKey);

      const rows = Array.from(matrix.querySelectorAll('tbody tr'));
      const totals = Object.fromEntries(headerMaten.map(m => [m, 0]));

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td.product-matrix__size, td.size'));
        cells.forEach((cell, idx) => {
          const maat = headerMaten[idx] || '';
          if (!maat) return;

          const inp = cell.querySelector('input.core-input-quantity, input[data-limit]');
          const limitAttr = inp?.getAttribute('data-limit');
          let stock = 0;

          if (limitAttr != null) {
            stock = parseInt(limitAttr, 10) || 0;
          } else {
            const span = cell.querySelector('span.stock');
            stock = parseInt(span?.textContent?.replace(/[^\d]/g,''),10) || 0;
          }

          totals[maat] = (totals[maat] || 0) + stock;
        });
      });

      return totals;
    }

    // legacy quick_insert
    const legacy = doc.querySelector('table.tableShoppingBag');
    if (legacy){
      const headerMaten = Array.from(legacy.querySelectorAll('thead tr:nth-child(1) th.size'))
        .map(th => th.textContent.trim())
        .filter(Boolean)
        .map(stripPrefixAfterColon)
        .map(normSizeKey);

      const firstBodyRow = legacy.querySelector('tbody tr');
      const qtyCells = firstBodyRow ? firstBodyRow.querySelectorAll('td.quantity') : [];
      const map = {};
      const n = Math.min(headerMaten.length, qtyCells.length);

      for (let i=0;i<n;i++){
        const maat = headerMaten[i];
        const stockTxt = qtyCells[i]?.querySelector('.stock')?.textContent?.trim() ?? '';
        const stock = (stockTxt.includes('>') || stockTxt.includes('+'))
          ? 100
          : (parseInt(stockTxt.replace(/[^\d]/g,''),10) || 0);

        map[maat] = stock;
      }
      return map;
    }

    return {};
  }

  // ---------- Error helpers ----------
  function isNotFoundError(err){
    const msg = String(err?.message || err || '').toUpperCase();
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
    if (/UNEXPECTED\s+TOKEN/.test(msg)) return true; // HTML ipv parsing/JSON errors
    return false;
  }

  // ---------- Per-table ----------
  function applyVcp2RulesAndMark(table, remoteMap, anchorId){
    const rows = table.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat  = normSizeKey(row.dataset.size || row.children[0]?.textContent || '');
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteQty = (typeof remoteMap[maat] === 'number') ? remoteMap[maat] : undefined;

      let target = null;
      let status = 'ok';
      let delta  = 0;

      if (typeof remoteQty === 'number') {
        target = SR.mapRemoteToTarget('charliechoe', remoteQty, 5);
        const res = SR.reconcile(local, target, 5);
        delta = res.delta;

        if (res.action === 'bijboeken' && delta > 0) {
          Core.markRow(row, { action:'add', delta, title:`Bijboeken ${delta} (target ${target}, supplier qty ${remoteQty})` });
          status = 'bijboeken';
          if (!firstMut) firstMut = row;
        } else if (res.action === 'uitboeken' && delta > 0) {
          Core.markRow(row, { action:'remove', delta, title:`Uitboeken ${delta} (target ${target}, supplier qty ${remoteQty})` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action:'none', delta:0, title:`OK (target ${target}, supplier qty ${remoteQty})` });
          status = 'ok';
        }
      } else {
        // maat niet gevonden bij leverancier
        if (local > 0) {
          delta = local;
          Core.markRow(row, { action:'remove', delta, title:`Uitboeken ${delta} (maat onbekend bij leverancier)` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action:'none', delta:0, title:`Negeren (maat onbekend bij leverancier)` });
          status = 'negeren';
        }
      }

      report.push({
        maat,
        local,
        remote: Number.isFinite(remoteQty) ? remoteQty : NaN,
        target: Number.isFinite(target) ? target : NaN,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    const remoteLeeg = !remoteMap || Object.keys(remoteMap).length === 0;
    const tableStatus = remoteLeeg ? 'niet-gevonden' : (diffs === 0 ? 'ok' : 'afwijking');

    Logger.status(anchorId, tableStatus);
    Logger.perMaat(anchorId, report);

    return diffs;
  }

  async function perTable(table){
    const pid = extractPidFromTable(table);
    const anchorId = (table.id || '').trim() || pid || 'onbekend';

    if (!pid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    try {
      const html = await fetchProductPageHTML(pid);
      const remote = parseRemoteStockFromPDP(html);

      if (!remote || Object.keys(remote).length === 0) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      return applyVcp2RulesAndMark(table, remote, anchorId);
    } catch (e) {
      console.error('[VCP2|CharlieChoe] fout:', e);
      Logger.status(anchorId, isNotFoundError(e) ? 'niet-gevonden' : 'afwijking');
      Logger.perMaat(anchorId, []);
      return 0;
    }
  }

  async function run(btn){
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable
    });
  }

  // ---------- UI ----------
  function isSupportedSelected(){
    const dd = $('#leverancier-keuze');
    if (!dd) return true;
    const byValue = norm(dd.value || '');
    const byText  = norm(dd.options?.[dd.selectedIndex]?.text || '');
    return SUPPORTED.has(byValue) || SUPPORTED.has(byText);
  }

  Core.mountSupplierButton({
    id:   'vcp2-charlie-choe-btn',
    text: '🔍 Check Stock | Charlie Choe',
    right: 250,
    top: 8,
    match: () => isSupportedSelected(),
    onClick: (btn) => run(btn)
  });

})();
