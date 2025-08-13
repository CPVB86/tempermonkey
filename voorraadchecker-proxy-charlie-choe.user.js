// ==UserScript==
// @name         Voorraadchecker Proxy - Charlie Choe
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      vangennip.itsperfect.it
// @run-at       document-idle
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-charlie-choe.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-charlie-choe.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Config ----------
  const QUICK_URL = (p_id) =>
    `https://vangennip.itsperfect.it/inc/webshop/FTS/shop/ajax/quick_insert.php?p_id=${encodeURIComponent(p_id)}`;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Tampermonkey GM fetch ----------
  function fetchViaGM(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        withCredentials: true,
        timeout: 12000,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://vangennip.itsperfect.it/webshop/shop'
        },
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) return resolve(r.responseText || '');
          reject(new Error(`GM fetch failed: ${r.status}`));
        },
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error('GM fetch timeout')),
      });
    });
  }

  // ---------- Logboek ----------
  function getLogboek(){
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) return unsafeWindow.logboek;
    return window.logboek;
  }

  function logResultaat(tableOrId, status) {
    const lb = getLogboek();
    if (lb?.resultaat) { lb.resultaat(tableOrId, status); return; }
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
      unsafeWindow.voegLogregelToe(String(tableOrId), status); return;
    }
    console.info('[logboek niet gevonden]', tableOrId, status);
  }

  // ---------- Parse quick_insert HTML naar { maat -> stock } ----------
  function parseRemoteStock(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table.tableShoppingBag');
    if (!table) {
      console.warn('[parse] Geen table.tableShoppingBag gevonden');
      console.debug('[parse] snippet:', html.slice(0, 400).replace(/\s+/g, ' '), '…');
      return {};
    }

    const headerMaten = Array.from(
      table.querySelectorAll('thead tr:nth-child(1) th.size')
    ).map(th => th.textContent.trim()).filter(Boolean);

    const firstBodyRow = table.querySelector('tbody tr');
    const qtyCells = firstBodyRow ? firstBodyRow.querySelectorAll('td.quantity') : [];

    const map = {};
    const n = Math.min(headerMaten.length, qtyCells.length);
    for (let i = 0; i < n; i++) {
      const maat = headerMaten[i];
      const stockTxt = qtyCells[i]?.querySelector('.stock')?.textContent.trim() ?? '';
      const stock = (stockTxt.includes('>') || stockTxt.includes('+'))
        ? 100
        : (parseInt(stockTxt.replace(/[^\d]/g, ''), 10) || 0);
      map[maat] = stock;
    }
    return map;
  }

  // ---------- Regels toepassen + markeren ----------
  // - Uitboeken (rood): wij > 0 && VG == 0        -> data-status='remove'
  // - Bijboeken (groen): wij == 0 && VG > 4       -> data-status='add'
  // - Negeren:         wij == 0 && VG < 5         -> geen data-status
  function applyRulesAndMark(localTable, remoteMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];

    rows.forEach(row => {
      const sizeCell = row.children[0];
      const localCell = row.children[1];
      if (!sizeCell || !localCell) return;

      const maat  = (row.dataset.size || sizeCell.textContent || '').trim();
      const local = parseInt((localCell.textContent || '').trim(), 10) || 0;
      const vg    = remoteMap[maat];
      const hasVG = typeof vg === 'number';

      // reset styles + status
      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green','status-red');
      delete row.dataset.status;

      let actie = 'none';

      if (hasVG) {
        if (local > 0 && vg === 0) {
          row.style.background = '#f8d7da'; // rood
          row.title = 'Uitboeken (VG=0)';
          row.dataset.status = 'remove';
          row.classList.add('status-red');
          actie = 'uitboeken';
        } else if (local === 0 && vg > 4) {
          row.style.background = '#d4edda'; // groen
          row.title = 'Bijboeken 2 (VG>4)';
          row.dataset.status = 'add';
          row.classList.add('status-green');
          actie = 'bijboeken_2';
        } else if (local === 0 && vg < 5) {
          row.title = 'Negeren (VG<5 en lokaal 0)';
          actie = 'negeren';
        }
      } else {
        row.title = 'Maat niet gevonden bij leverancier';
        if (local > 0) {
          row.style.background = '#f8d7da';
          row.dataset.status = 'remove';
          row.classList.add('status-red');
        }
        actie = 'vg_missing';
      }

      report.push({ maat, local, vg, actie });
    });

    console.table(report);
    return report;
  }

  // --- Hulpfunctie: bepaal logstatus ---
  function bepaalLogStatus(report, remoteMap) {
    const n = report.length;
    const counts = report.reduce((acc, r) => {
      acc[r.actie] = (acc[r.actie] || 0) + 1;
      return acc;
    }, {});
    const nUit  = counts.uitboeken    || 0;
    const nBij  = counts.bijboeken_2  || 0;
    const nMiss = counts.vg_missing   || 0;
    const remoteLeeg = !remoteMap || Object.keys(remoteMap).length === 0;
    if (remoteLeeg || (n > 0 && nMiss === n)) return 'niet-gevonden';
    if (nUit === 0 && nBij === 0 && nMiss === 0) return 'ok';
    return 'afwijking';
  }

  // ---------- Main ----------
  async function run(btn) {
    // Alleen StockKit — geen fallback/timeout/reset
    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      console.error('[VG] StockKit niet geladen — afgebroken.');
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }
    const progress = StockKit.makeProgress(btn);

    // Supplier check (genormaliseerd); blokkeer niet als dropdown ontbreekt
    const dd = document.getElementById('leverancier-keuze');
    if (dd) {
      const v = (dd.value || '').trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');
      if (!(v === 'charlie-choe' || v === 'charlie')) {
        console.warn('[VG] run() overgeslagen: leverancier ≠ charlie-choe');
        return;
      }
    }

    getLogboek()?.show?.();

    const tables = Array.from(document.querySelectorAll('#output table'));
    console.group('[VG-Compare GM x Logboek] Start');
    console.info('Gevonden tabellen in #output:', tables.length);

    if (!tables.length) { alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);

    let totalMutations = 0;
    let ok = 0, fail = 0, idx = 0;

    for (const table of tables) {
      idx++;

      const p_id =
        table.dataset.vgPid ||
        (table.id?.includes('-') ? table.id.split('-').pop() : table.id);

      const label =
        table.querySelector('thead th[colspan="3"]')?.textContent?.trim() ||
        table.id || p_id || 'onbekend';

      console.groupCollapsed(`⏳ ${label} (p_id=${p_id || 'n.v.t.'})`);

      try {
        if (!p_id) {
          logResultaat(table.id || label, 'niet-gevonden');
          console.warn('Geen p_id; tabel overgeslagen.');
          console.groupEnd();
          progress.setDone(idx);
          continue;
        }

        const url = QUICK_URL(p_id);
        const html = await fetchViaGM(url);
        const remoteMap = parseRemoteStock(html);

        const report = applyRulesAndMark(table, remoteMap);

        // tel mutaties (add/remove)
        const diffs = report.filter(r => r.actie === 'uitboeken' || r.actie === 'bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, remoteMap);
        logResultaat(table.id || label, status);

        ok++;
        console.groupEnd();
        await delay(100);
      } catch (e) {
        console.error('Fout bij verwerken:', e);
        logResultaat(table.id || label, 'afwijking');
        fail++;
        console.groupEnd();
      }

      progress.setDone(idx);
    }

    console.info(`[VG] Samenvatting → verwerkt: ${ok + fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`);
    console.groupEnd();

    // Alleen StockKit bepaalt eindtekst; geef het getal mee
    progress.success(totalMutations); // "Klaar: {totalMutations} mutaties"
  }

  // ---------- UI ----------
  function addButton() {
    if (document.getElementById('check-charlie-choe-btn')) return;

    // StockKit CSS (optioneel, voor uniforme styling)
    if (!document.getElementById('stockkit-css')) {
      const link = document.createElement('link');
      link.id = 'stockkit-css';
      link.rel = 'stylesheet';
      link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.textContent = '🔍 Check Stock Charlie Choe';
    btn.id = 'check-charlie-choe-btn';
    btn.className = 'sk-btn';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      right: '250px',
      zIndex: '9999',
      display: 'none'
    });
    btn.addEventListener('click', () => run(btn));
    document.body.appendChild(btn);

    const $ = (sel) => document.querySelector(sel);

    function outputHasTables() {
      return !!$('#output') && $('#output').querySelector('table') !== null;
    }
    function isSupplierSelected() {
      const dd = $('#leverancier-keuze');
      if (!dd) return true; // dropdown ontbreekt → niet blokkeren
      const v = (dd.value || '').trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');
      return (v === 'charlie-choe' || v === 'charlie');
    }
    function toggleButtonVisibility() {
      btn.style.display = (isSupplierSelected() && outputHasTables()) ? 'block' : 'none';
    }

    const out = $('#output');
    if (out) new MutationObserver(toggleButtonVisibility).observe(out, { childList: true, subtree: true });

    const select = $('#leverancier-keuze');
    if (select) select.addEventListener('change', toggleButtonVisibility);

    const upload = $('#upload-container');
    if (upload) new MutationObserver(toggleButtonVisibility).observe(upload, { attributes: true, attributeFilter: ['style', 'class'] });

    toggleButtonVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }

})();
