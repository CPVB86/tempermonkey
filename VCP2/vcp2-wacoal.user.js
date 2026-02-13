// ==UserScript==
// @name         VCP2 | Wacoal
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      b2b.wacoal-europe.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-wacoal.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) {
    console.error('[VCP2|Wacoal] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|Wacoal] StockRules ontbreekt of incompleet. Check @require stockrules.js');
    return;
  }

  // ---------- Config ----------
  const TIMEOUT = 15000;

  const SUPPORTED_BRANDS = new Set([
    'wacoal','freya','freya swim','fantasie','fantasie swim','elomi','elomi swim'
  ]);

  const $ = (s, r=document) => r.querySelector(s);
  const norm = (s='') => String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');

  // ---------- Logger (status -> logboek; mapping -> console) ----------
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
      console.groupCollapsed(`[Wacoal][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remoteStatus: r.remoteStatus || '—',
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // ---------- Helpers ----------
  function gmFetch(url){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET',
        url,
        withCredentials:true,
        timeout: TIMEOUT,
        headers:{
          'Accept':'application/json,text/html;q=0.8,*/*;q=0.5',
          'User-Agent': navigator.userAgent
        },
        onload:(r)=> (r.status>=200 && r.status<400)
          ? resolve(r.responseText||'')
          : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject,
        ontimeout:()=>reject(new Error(`timeout @ ${url}`))
      });
    });
  }

  function isNotFoundError(err){
    const msg = String(err?.message || err || '').toUpperCase();

    // hard HTTP codes (auth/blocked/removed)
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;

    // ✅ alle 5xx behandelen als niet-gevonden
    if (/HTTP\s5\d{2}/.test(msg)) return true;

    // lege/ongeldige response (HTML ipv JSON, etc.)
    if (/SYNTAXERROR/.test(msg)) return true;
    if (/UNEXPECTED\s+TOKEN/.test(msg)) return true;

    // expliciete teksten
    if (msg.includes('NO_RESULTS')) return true;
    if (msg.includes('NOT FOUND')) return true;

    return false;
  }

  // ✅ STRICT: alleen letterlijk IN_STOCK telt als "in stock"
  // Alles anders (incl. WITHIN_STAGE1/2/3) => remote stock = 0
  function isWacoalInStockStrict(wacoalStatusRaw){
    const ws = String(wacoalStatusRaw || '').toUpperCase().trim();
    return ws === 'IN_STOCK';
  }

  // ---------- JSON -> statusMap (wacoalstockStatus leidend) ----------
  function buildStatusMap(json){
    const map = {};

    // 1D sizing
    if (!json?.is2DSizing){
      for (const cell of (json?.sizeData || [])) {
        const sizeEU = (cell?.countrySizeMap?.EU || cell?.globalSize || '')
          .toString().trim().toUpperCase();
        if (!sizeEU) continue;

        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = String(cell?.stock?.wacoalstockStatus || '').toUpperCase();

        const inStock = isWacoalInStockStrict(wacoal);
        const status  = inStock ? 'IN_STOCK' : 'OUT_OF_STOCK';
        const stock   = inStock ? stockLevel : 0;

        map[sizeEU] = { status, stock, wacoal };
      }
      return map;
    }

    // 2D sizing
    for (const row of (json?.sizeData || [])) {
      for (const cell of (row?.sizeFitData || [])) {
        const bandEU = (cell?.countrySizeMap?.EU||'').toString().trim();
        const cupEU  = (cell?.countryFitMap?.EU ||'').toString().trim();
        if (!bandEU || !cupEU) continue;

        const key = `${bandEU}${cupEU}`.toUpperCase();
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = String(cell?.stock?.wacoalstockStatus || '').toUpperCase();

        const inStock = isWacoalInStockStrict(wacoal);
        const status  = inStock ? 'IN_STOCK' : 'OUT_OF_STOCK';
        const stock   = inStock ? stockLevel : 0;

        map[key] = { status, stock, wacoal };
      }
    }

    return map;
  }

  // resolveRemote: toleranties + slash-cups
  function resolveRemote(map, label){
    const raw = String(label||'').trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];

    const nospace = raw.replace(/\s+/g,'');
    if (Object.prototype.hasOwnProperty.call(map, nospace)) return map[nospace];

    // 75G/H -> best of the two
    const m = raw.match(/^(\d+)\s*([A-Z]{1,2}(?:\/[A-Z]{1,2})+)$/);
    if (m) {
      const band = m[1];
      const cups = m[2].split('/');
      const rank = x => x==='IN_STOCK'?1 : x==='OUT_OF_STOCK'?0 : -1;

      let best = null;
      for (const cup of cups) {
        const k = `${band}${cup}`.toUpperCase();
        if (map[k] && (!best || rank(map[k].status) > rank(best.status))) best = map[k];
      }
      if (best) return best;
    }

    if (raw.includes('/')) {
      const rank = x => x==='IN_STOCK'?1 : x==='OUT_OF_STOCK'?0 : -1;
      let best = null;

      for (const part of raw.split('/').map(s => s.trim())) {
        const k1 = part.toUpperCase();
        const k2 = part.replace(/\s+/g,'').toUpperCase();
        const cand = map[k1] || map[k2];
        if (cand && (!best || rank(cand.status) > rank(best.status))) best = cand;
      }
      if (best) return best;
    }

    return undefined;
  }

  // ---------- Apply rules (VCPCore row marks + StockRules reconcile) ----------
  function applyRulesAndMark(localTable, statusMap){
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat  = (row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = resolveRemote(statusMap, maat);

      // ✅ resumé rule:
      // IN_STOCK => logica toepassen met stock
      // NIET IN_STOCK => remote stock 0
      const supplierQty = (remoteEntry?.status === 'IN_STOCK')
        ? (Number(remoteEntry?.stock ?? 0) || 0)
        : 0;

      // target policy:
      // - remoteEntry bestaat: supplierQty>0 => mapRemoteToTarget, anders 0
      // - onbekend: target null => local>0 remove all else ignore
      let target = null;
      if (remoteEntry) {
        target = (supplierQty > 0) ? SR.mapRemoteToTarget('wacoal', supplierQty, 5) : 0;
      } else {
        target = null;
      }

      let status = 'ok';
      let delta = 0;

      if (target === null) {
        if (local > 0) {
          delta = local;
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (maat onbekend bij Wacoal)` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: 'Negeren (maat onbekend bij Wacoal)' });
          status = 'negeren';
        }
      } else {
        const res = SR.reconcile(local, target, 5);
        delta = res.delta;

        if (res.action === 'bijboeken' && delta > 0) {
          Core.markRow(row, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'bijboeken';
          if (!firstMut) firstMut = row;

        } else if (res.action === 'uitboeken' && delta > 0) {
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;

        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, supplier qty ${supplierQty})` });
          status = 'ok';
        }
      }

      report.push({
        maat,
        local,
        remoteStatus: remoteEntry?.wacoal || remoteEntry?.status || '',
        remote: supplierQty,
        target: Number.isFinite(target) ? target : NaN,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, statusMap){
    const remoteLeeg = !statusMap || Object.keys(statusMap).length === 0;
    if (remoteLeeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  // ---------- perTable ----------
  async function perTable(table){
    const pid = (table.id || '').trim();
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
    const anchorId = pid || label;

    if (!pid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const url = `https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(pid)}`;

    try {
      const jsonText = await gmFetch(url);

      let json;
      try {
        json = JSON.parse(jsonText);
      } catch (e) {
        // HTML/lege response => niet-gevonden
        throw new Error(`SyntaxError: bad JSON @ ${url}`);
      }

      const statusMap = buildStatusMap(json);
      if (!statusMap || Object.keys(statusMap).length === 0) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      const report = applyRulesAndMark(table, statusMap);
      const status = bepaalLogStatus(report, statusMap);
      Logger.status(anchorId, status);
      Logger.perMaat(anchorId, report);

      return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;

    } catch (e) {
      // ✅ 500 / parse / 404 etc => niet-gevonden
      if (isNotFoundError(e)) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      // echte afwijking
      console.error('[VCP2|Wacoal] fout:', anchorId, e);
      Logger.status(anchorId, 'afwijking');
      Logger.perMaat(anchorId, []);
      return 0;
    }
  }

  // ---------- run ----------
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

  // ---------- Supplier match ----------
  function isSupportedSelected(){
    const dd = $('#leverancier-keuze');
    if (!dd) return true;
    const byValue = norm(dd.value || '');
    const byText  = norm(dd.options?.[dd.selectedIndex]?.text || '');
    return SUPPORTED_BRANDS.has(byValue) || SUPPORTED_BRANDS.has(byText);
  }

  // ---------- UI ----------
  Core.mountSupplierButton({
    id: 'vcp2-wacoal-btn',
    text: '🔍 Check Stock | Wacoal',
    right: 250,
    top: 8,
    match: () => isSupportedSelected(),
    onClick: (btn) => run(btn)
  });

})();
