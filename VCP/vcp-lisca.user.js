// ==UserScript==
// @name         VCP | Lisca
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      *
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-lisca.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const TIMEOUT = 15000;
  const CACHE_KEY = 'lisca_csv_cache_v1';
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

  const SHEET_ID = '1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww';
  const GID = '933070542';
  const CSV_URL = (authuser=null, uPath=null) => {
    if (uPath != null) return `https://docs.google.com/u/${uPath}/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    return authuser == null ? base : `${base}&authuser=${authuser}`;
  };

  const $ = (s, r=document) => r.querySelector(s);

  // ---------- Logger (zoals Wacoal) ----------
  const Logger = {
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    status(id, txt, extra){
      // status naar console en logboek (zelfde gedrag als Wacoal)
      console.info(`[Lisca][${id}] status: ${txt}`, extra||'');
      const lb=this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), txt, extra);
      else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(id), txt);
    },
    perMaat(id, report){
      // zelfde per-maat tabel in console als in Wacoal
      console.groupCollapsed(`[Lisca][${id}] maatvergelijking`);
      try{
        const rows = report.map(r => ({ maat:r.maat, local:r.local, remote:Number.isFinite(r.effRemote)?r.effRemote:'—', status:r.actie }));
        console.table(rows);
      } finally { console.groupEnd(); }
    }
  };

  // ---------- Net: CSV ophalen (mini-cache) ----------
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
    const lines = csvText.split(/\r?\n/).filter(Boolean);
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

  // ---------- Normalisatie remote stock (jouw regels) ----------
  // >4  => 5
  // 2..4 => ongewijzigd
  // <2  => 0
  const REMOTE_CAP = 5;           // boven de 4 cap je op 5
  const REMOTE_MIN_AVAILABLE = 2; // 0 of 1 telt als 0

  function normalizeRemote(remote){
    if (remote === undefined) return undefined;
    if (remote > (REMOTE_CAP - 1)) return REMOTE_CAP; // >4 => 5
    if (remote < REMOTE_MIN_AVAILABLE) return 0;       // <2 => 0
    return remote;                                     // 2,3,4
  }

  // ---------- Regels & markering ----------
  function applyLiscaRulesOnTable(table, remoteMap) {
    let changes = 0;
    const counts = { add:0, remove:0, missing_ean_remove:0, ignore_missing_ean_local0:0 };
    const rows = table.querySelectorAll('tbody tr');
    const report = [];

rows.forEach(row => {
  const tds = row.querySelectorAll('td');
  if (tds.length < 3) return;
  const sizeTd  = tds[0];
  const stockTd = tds[1];
  const eanTd   = tds[2];

  [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = ''));
  row.removeAttribute('data-status');

  // ✅ reset voor de zekerheid
  row.dataset.effRemote = '';

  const local  = parseInt((stockTd.textContent || '0').trim(), 10) || 0;
  const ean    = (eanTd.textContent || '').trim();
  const remote = remoteMap.get(ean);            // undefined als niet gevonden
  const effRemote = normalizeRemote(remote);    // jouw regels

  // ✅ hier beschikbaar maken voor mutaties.js
  row.dataset.effRemote = (effRemote === undefined ? '' : String(effRemote));

  let actie = 'none';

  if (effRemote === undefined) {
    if (local === 0) {
      actie = 'ignore_missing_ean_local0';
      counts.ignore_missing_ean_local0++;
      report.push({ maat:(sizeTd.textContent||'').trim(), ean, local, remote, effRemote, actie });
      return; // vroegtijdig stoppen is ok: effRemote stond al in dataset
    }
    [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#FFD966')); // geel
    row.dataset.status = 'remove';
    actie = 'missing_ean_remove';
    counts.missing_ean_remove++; changes++;
  } else if (local > 0 && effRemote === 0) {
    [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#F8D7DA')); // rood
    row.dataset.status = 'remove';
    actie = 'remove';
    counts.remove++; changes++;
  } else if (local === 0 && effRemote > 0) {
    [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#D4EDDA')); // groen
    row.dataset.status = 'add';
    actie = 'add';
    counts.add++; changes++;
  }

  report.push({ maat:(sizeTd.textContent||'').trim(), ean, local, remote, effRemote, actie });
});

    return { changes, counts, report };
  }

  // ---------- Main ----------
  async function runLisca(btn) {
    const progress = window.StockKit.makeProgress(btn);
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);

    const csv = await fetchLiscaCSV();
    const remoteMap = parseCSVtoMap(csv);

    let totalChanges = 0, idx = 0;
    let firstDiffTable = null;

    for (const table of tables) {
      idx++;

      // Wacoal-style anchor: product-ID = table.id
      const pid = (table.id || '').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
      const anchorId = pid || label; // exact zoals Wacoal

      const { changes, counts, report } = applyLiscaRulesOnTable(table, remoteMap);
      totalChanges += changes;

      const status = changes > 0 ? 'afwijking' : 'ok';

      Logger.status(anchorId, status, counts);
      Logger.perMaat(anchorId, report);

      if (!firstDiffTable && changes > 0) firstDiffTable = table;

      progress.setDone(idx);
    }

    progress.success(totalChanges);

    // Auto-scroll naar eerste afwijking + jumpFlash hook (optioneel)
    if (firstDiffTable) {
      firstDiffTable.scrollIntoView({ behavior:'smooth', block:'center' });
      if (typeof window.jumpFlash === 'function') window.jumpFlash(firstDiffTable);
    }
  }

  // ---------- UI ----------
  function addButton(){
    if (document.getElementById('lisca-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css';
      link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.id='lisca-btn';
    btn.className='sk-btn';
    btn.textContent='🔍 Check Stock Lisca';
    Object.assign(btn.style,{ position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click', ()=>runLisca(btn));
    document.body.appendChild(btn);

    const outputHasTables = ()=> !!document.querySelector('#output')?.querySelector('table');

    function isLiscaSelected(){
      const el = document.querySelector('#leverancier-keuze');
      if (!el) return true;
      const v = (el.value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/_/g, '-');
      return v === 'lisca';
    }

    function isBusy(){ return btn.classList.contains('is-busy'); }
    function isTerminal(){
      const t=(btn.textContent||'').trim();
      return /^(?:.*)?Klaar:/u.test(t) || t.includes('❌ Fout');
    }
    function maybeUpdateLabel(){
      if (!isBusy() && !isTerminal()) btn.textContent='🔍 Check Stock Lisca';
    }

    function toggle(){
      btn.style.display = (outputHasTables() && isLiscaSelected()) ? 'block' : 'none';
      if (btn.style.display==='block') maybeUpdateLabel();
    }

    const out=document.querySelector('#output'); if(out) new MutationObserver(toggle).observe(out,{ childList:true, subtree:true });
    const select=document.querySelector('#leverancier-keuze'); if(select) select.addEventListener('change', toggle);
    const upload=document.querySelector('#upload-container'); if(upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
