// ==UserScript==
// @name         Voorraadchecker Proxy - Lisca
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      *
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js?v=2025-08-13-1
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  /** =========================
   *  Config
   *  ========================= */
  const SHEET_ID = '1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww';
  const GID = '933070542';
  const CSV_URL = (authuser=null, uPath=null) => {
    if (uPath != null) return `https://docs.google.com/u/${uPath}/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    return authuser == null ? base : `${base}&authuser=${authuser}`;
  };

  /** =========================
   *  Net: CSV ophalen
   *  ========================= */
  function gmFetch(url, responseType='text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType, withCredentials: true,
        headers: { 'Accept':'text/csv,text/plain,*/*;q=0.8', 'User-Agent': navigator.userAgent },
        onload: r => resolve(r), onerror: e => reject(e), ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }
  async function fetchLiscaCSV() {
    for (let au=0; au<=4; au++){
      const url = CSV_URL(au, null);
      const r = await gmFetch(url,'text').catch(e=>e);
      if (r?.status===200 && typeof r.responseText==='string' && r.responseText.trim() && !r.responseText.trim().startsWith('<')) return r.responseText;
      const uUrl = CSV_URL(null, au);
      const r2 = await gmFetch(uUrl,'text').catch(e=>e);
      if (r2?.status===200 && typeof r2.responseText==='string' && r2.responseText.trim() && !r2.responseText.trim().startsWith('<')) return r2.responseText;
    }
    throw new Error('Kon CSV niet ophalen (controleer Google-accounttoegang).');
  }

  /** =========================
   *  CSV → Map(EAN -> stock) (F=EAN, G=stock)
   *  ========================= */
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

  /** =========================
   *  Kleuren & statusregels
   *  ========================= */
  function applyLiscaRulesOnTable(table, remoteMap) {
    let changes = 0;
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

      const local = parseInt((stockTd.textContent || '0').trim(), 10) || 0;
      const ean = (eanTd.textContent || '').trim();
      const remote = remoteMap.get(ean); // undefined als niet gevonden
      const effRemote = (remote === undefined) ? undefined : (remote < 5 ? 0 : remote); // drempel <5 => 0

      let actie = 'none';

      if (effRemote === undefined) {
        if (local === 0) {
          actie = 'ignore_missing_ean_local0';
          report.push({ maat: (sizeTd.textContent||'').trim(), ean, local, remote, effRemote, actie });
          return;
        }
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#FFD966')); // geel
        row.dataset.status = 'remove';
        actie = 'missing_ean_remove';
        changes++;
      } else if (local > 0 && effRemote === 0) {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#F8D7DA')); // rood
        row.dataset.status = 'remove';
        actie = 'remove';
        changes++;
      } else if (local === 0 && effRemote > 0) {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#D4EDDA')); // groen
        row.dataset.status = 'add';
        actie = 'add';
        changes++; // << tel 'add' mee als mutatie
      }

      report.push({
        maat: (sizeTd.textContent||'').trim(),
        ean,
        local,
        remote,
        effRemote,
        actie
      });
    });

    return { changes, report };
  }

  /** =========================
   *  Groen vinkje (met fallback + retry)
   *  ========================= */
  function addHeaderTickFallback(table){
    try {
      let th =
        table.querySelector('thead th[colspan]') ||
        table.querySelector('thead tr:first-child th:last-child') ||
        table.querySelector('thead th');

      if (!th) return false;
      if (th.querySelector('.header-vinkje')) return true;

      const span = document.createElement('span');
      span.className = 'header-vinkje';
      if (document.querySelector('.fa, .fas, .fa-solid')) {
        span.innerHTML = `<i class="fas fa-check" style="color:#2ecc71; font-size:18px; float:right; margin-left:12px;"></i>`;
      } else {
        span.textContent = '✓';
        span.style.cssText = 'color:#2ecc71; font-weight:700; float:right; margin-left:12px; font-size:18px;';
      }
      th.appendChild(span);
      return true;
    } catch { return false; }
  }
  function markTick(table) {
    let tries = 0;
    (function attempt(){
      try {
        if (typeof window.zetGroenVinkjeOpTabel === 'function') {
          const ok = window.zetGroenVinkjeOpTabel(table);
          if (ok) return;
        } else if (window.groenVinkje?.mark) {
          const ok = window.groenVinkje.mark(table);
          if (ok) return;
        }
        const placed = addHeaderTickFallback(table);
        if (placed) return;
      } catch {}
      if (tries++ < 15) setTimeout(attempt, 120); // retry alleen voor vinkje (niet voor de knop)
    })();
  }

  /** =========================
   *  Logboek-koppeling
   *  ========================= */
  function logResult(id, status) {
    const lb = (typeof unsafeWindow !== 'undefined' ? unsafeWindow.logboek : window.logboek);
    if (lb?.resultaat) lb.resultaat(id, status);
    else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
      unsafeWindow.voegLogregelToe(id, status);
    } else {
      console.info('[logboek]', id, status);
    }
  }

  /** =========================
   *  Main
   *  ========================= */
  async function runLisca(btn) {
    // Alleen StockKit — geen fallback/timeout/reset
    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      console.error('[Lisca] StockKit niet geladen — afgebroken.');
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }
    const progress = StockKit.makeProgress(btn);

    try {
      const tables = Array.from(document.querySelectorAll('#output table'));
      if (!tables.length) { alert('Geen tabellen gevonden in #output.'); return; }

      progress.start(tables.length);

      const csv = await fetchLiscaCSV();
      const remoteMap = parseCSVtoMap(csv);

      let totalChanges = 0, idx = 0;
      for (const table of tables) {
        idx++;
        const label = table.querySelector('thead th[colspan="3"]')?.textContent?.trim() || table.id || `table#${idx}`;

        const { changes } = applyLiscaRulesOnTable(table, remoteMap);
        totalChanges += changes;

        const status = changes > 0 ? 'afwijking' : 'ok';
        logResult(label, status);
        markTick(table);

        progress.setDone(idx);
      }

      // Laat uitsluitend StockKit de eindtekst zetten; geef het getal mee
      progress.success(totalChanges); // toont "Klaar: {totalChanges} mutaties"
    } catch (e) {
      console.error('[Lisca] Fout:', e);
      progress.fail(); // StockKit bepaalt fout-tekst/staat
      alert('Lisca check: er ging iets mis. Zie console.');
    }
  }

  /** =========================
   *  UI
   *  ========================= */
 function addButton() {
  if (document.getElementById('lisca-btn')) return;

  // Optioneel: centrale StockKit CSS voor uniforme styling
  if (!document.getElementById('stockkit-css')) {
    const link = document.createElement('link');
    link.id = 'stockkit-css';
    link.rel = 'stylesheet';
    link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
    document.head.appendChild(link);
  }

  const btn = document.createElement('button');
  btn.id = 'lisca-btn';
  btn.className = 'sk-btn';
  btn.textContent = '🔍 Check Stock Lisca';
  Object.assign(btn.style, {
    position: 'fixed',
    top: '8px',
    right: '250px',
    zIndex: '9999',
    display: 'none'
  });
  btn.addEventListener('click', () => runLisca(btn));
  document.body.appendChild(btn);

  const $ = s => document.querySelector(s);

  function outputHasTables() {
    const out = $('#output');
    return !!out && !!out.querySelector('table');
  }

  function isLiscaSelected() {
    const el = $('#leverancier-keuze');
    if (!el) return true; // als er geen dropdown is, knop niet blokkeren
    const v = (el.value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/_/g, '-');
    return v === 'lisca';
  }

  function toggle() {
    btn.style.display = (isLiscaSelected() && outputHasTables()) ? 'block' : 'none';
  }

  // Reageer op wijzigingen in #output (tabellen komen/gaan)
  const out = $('#output');
  if (out) new MutationObserver(toggle).observe(out, { childList: true, subtree: true });

  // Reageer op selectie-wijziging
  const select = $('#leverancier-keuze');
  if (select) select.addEventListener('change', toggle);

  // Als upload-sectie de weergave beïnvloedt, luister daar ook naar
  const upload = $('#upload-container');
  if (upload) new MutationObserver(toggle).observe(upload, { attributes: true, attributeFilter: ['style', 'class'] });

  // Initial toggle
  toggle();
}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
