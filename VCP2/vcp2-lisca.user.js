// ==UserScript==
// @name         VCP2 | Lisca
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      *
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-lisca.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const TIMEOUT = 15000;

  // 1-op-1 uit originele script:
  const CACHE_KEY = 'lisca_csv_cache_v1';
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

  // 1-op-1 uit originele script:
  const SHEET_ID = '1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww';
  const GID = '933070542';
  const CSV_URL = (authuser=null, uPath=null) => {
    if (uPath != null) return `https://docs.google.com/u/${uPath}/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    return authuser == null ? base : `${base}&authuser=${authuser}`;
  };

  // ---------- Core hooks ----------
  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) { console.warn('[VCP2 Lisca] VCPCore ontbreekt. Laad vcp-core.js server-side.'); return; }
  if (!SR || typeof SR.reconcile !== 'function') { console.warn('[VCP2 Lisca] StockRules ontbreekt. Laad stockRules.js server-side.'); return; }

  // ---------- Logger (zelfde gedrag als je andere scripts) ----------
  const Logger = {
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    status(id, txt, extra){
  const lb=this.lb();
  if (lb?.resultaat) lb.resultaat(String(id), txt, extra);
  else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(id), txt);
},
    perMaat(id, report){
      console.groupCollapsed(`[Lisca][${id}] maatvergelijking`);
      try{
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.actie
        })));
      } finally { console.groupEnd(); }
    }
  };

  // ---------- Net: CSV ophalen (1-op-1 uit origineel) ----------
  function gmFetch(url, responseType='text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        withCredentials: true,
        timeout: TIMEOUT,
        headers: { 'Accept':'text/csv,text/plain,*/*;q=0.8', 'User-Agent': navigator.userAgent },
        onload: r => resolve(r),
        onerror: e => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  function loadCache() {
    const raw = GM_getValue(CACHE_KEY, null);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    return (Date.now() - t <= CACHE_TTL_MS) ? data : null;
  }

  function saveCache(csv) {
    GM_setValue(CACHE_KEY, JSON.stringify({ t: Date.now(), data: csv }));
  }

  // ✅ 1-op-1 overgenomen uit originele script
  async function fetchLiscaCSV() {
    const cached = loadCache();
    if (cached) return cached;

    for (let au=0; au<=4; au++){
      const url = CSV_URL(au, null);
      const r = await gmFetch(url,'text');
      if (r?.status===200 && typeof r.responseText==='string' && r.responseText.trim() && !r.responseText.trim().startsWith('<')) {
        saveCache(r.responseText); return r.responseText;
      }
      const uUrl = CSV_URL(null, au);
      const r2 = await gmFetch(uUrl,'text');
      if (r2?.status===200 && typeof r2.responseText==='string' && r2.responseText.trim() && !r2.responseText.trim().startsWith('<')) {
        saveCache(r2.responseText); return r2.responseText;
      }
    }
    throw new Error('CSV niet beschikbaar');
  }

  // ---------- CSV → Map(EAN -> stock) (F=EAN, G=stock) ----------
  function parseCSVtoMap(csvText) {
    const lines = String(csvText || '').split(/\r?\n/).filter(Boolean);
    const map = new Map();
    for (let i=0;i<lines.length;i++){
      const row = lines[i].split(',');
      const ean = (row[5]||'').trim();
      const stockStr = (row[6]||'').trim();
      if (!ean) continue;
      const stock = parseInt(stockStr,10);
      map.set(ean, Number.isFinite(stock)? stock : 0);
    }
    return map;
  }

  // ---------- Normalisatie remote stock (zoals je originele Lisca regels) ----------
  // >4 => 5, 2..4 => ongewijzigd, <2 => 0
  function normalizeRemote(remote){
    if (remote === undefined) return undefined;
    if (remote > 4) return 5;
    if (remote < 2) return 0;
    return remote;
  }

  // ---------- Regels & markering (mutaties.js contract via VCPCore) ----------
  function applyLiscaRulesOnTable(table, remoteMap) {
    let changes = 0;
    const counts = { bijboeken:0, uitboeken:0, missing_ean_remove:0, ignore_missing_ean_local0:0, ok:0 };
    const rows = table.querySelectorAll('tbody tr');
    const report = [];
    let firstMarkedRow = null;

    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 3) return;

      const sizeTd  = tds[0];
      const stockTd = tds[1];
      const eanTd   = tds[2];

      const maat  = (sizeTd.textContent || '').trim();
      const local = parseInt((stockTd.textContent || '0').trim(), 10) || 0;
      const ean   = (eanTd.textContent || '').trim();

      Core.clearRowMarks(row);
      [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = ''));

      const remoteRaw = ean ? remoteMap.get(ean) : undefined; // undefined als niet gevonden
      const target = normalizeRemote(remoteRaw);              // undefined | 0..5

      // EAN ontbreekt/geen match → origineel gedrag: als local>0 geel + remove (alles), als local=0 negeren
      if (!ean || target === undefined) {
        if (local === 0) {
          counts.ignore_missing_ean_local0++;
          report.push({ maat, local, remote: remoteRaw, target: NaN, actie: 'negeren', delta: 0 });
          return;
        }

        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#FFD966')); // geel
        Core.markRow(row, { action: 'remove', delta: local, title: 'Uitboeken (EAN ontbreekt/geen match)' });
        counts.missing_ean_remove++;
        changes++;
        if (!firstMarkedRow) firstMarkedRow = row;

        report.push({ maat, local, remote: remoteRaw, target: NaN, actie: 'uitboeken', delta: local });
        return;
      }

      // Gebruik jouw centrale reconcile (local -> target, cap 5)
      const res = SR.reconcile(local, target, 5);

      if (res.action === 'bijboeken' && res.delta > 0) {
        Core.markRow(row, { action: 'add', delta: res.delta, title: `Bijboeken ${res.delta} (target ${target})` });
        counts.bijboeken++; changes++;
        if (!firstMarkedRow) firstMarkedRow = row;
        report.push({ maat, local, remote: remoteRaw, target, actie: 'bijboeken', delta: res.delta });
        return;
      }

      if (res.action === 'uitboeken' && res.delta > 0) {
        Core.markRow(row, { action: 'remove', delta: res.delta, title: `Uitboeken ${res.delta} (target ${target})` });
        counts.uitboeken++; changes++;
        if (!firstMarkedRow) firstMarkedRow = row;
        report.push({ maat, local, remote: remoteRaw, target, actie: 'uitboeken', delta: res.delta });
        return;
      }

      counts.ok++;
      Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target})` });
      report.push({ maat, local, remote: remoteRaw, target, actie: 'ok', delta: 0 });
    });

    if (firstMarkedRow) Core.jumpFlash(firstMarkedRow);
    return { changes, counts, report };
  }

  function bepaalStatus(changes){ return changes > 0 ? 'afwijking' : 'ok'; }

  // ---------- Main ----------
  async function runLisca(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    let csv, remoteMap;
    try {
      csv = await fetchLiscaCSV();        // ✅ 1-op-1 originele methode
      remoteMap = parseCSVtoMap(csv);
    } catch (e) {
      console.error('[Lisca] CSV fetch/parse error', e);
      alert('Lisca CSV niet beschikbaar');
      return;
    }

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable: async (table) => {
        const pid = (table.id || '').trim();
        const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
        const anchorId = pid || label;

        const { changes, counts, report } = applyLiscaRulesOnTable(table, remoteMap);

        Logger.status(anchorId, bepaalStatus(changes), counts);
        Core.logReport('Lisca', anchorId, report);

        return changes;
      }
    });
  }

  // ---------- UI ----------
  Core.mountSupplierButton({
    id: 'lisca-btn',
    text: '🔍 Check Stock | Lisca',
    right: 250,
    top: 8,
    match: /\blisca\b/i,
    onClick: (btn) => runLisca(btn)
  });

})();
