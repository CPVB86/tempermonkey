// ==UserScript==
// @name         Voorraadchecker Proxy - Charlie Choe
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      vangennip.itsperfect.it
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-charlie-choe.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-charlie-choe.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    TIMEOUT: 15000,
    LOG: { status:'both', perMaat:'console', debug:false },
    RULES: { addThreshold: 5 }, // remote >4 => bijboeken_2
  };

  // ---------- Helpers ----------
  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const $=(s,r=document)=>r.querySelector(s);
  const norm=(s='')=>String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');

  // Alleen deze helper is toegevoegd: 'Age:' prefix weghalen
 const stripPrefixAfterColon = (s) => String(s || '').replace(/^\s*[^:]*:\s*/, '');

  // PID: laatste numerieke segment uit table.id of data-vg-pid
  function extractPidFromTable(table){
    if (table?.dataset?.vgPid && /^\d+$/.test(table.dataset.vgPid)) return table.dataset.vgPid.trim();
    const rawId=(table?.id||'').trim();
    const m = rawId.match(/[-_](\d+)\D*$/);
    if (m) return m[1];
    if (/^\d+$/.test(rawId)) return rawId;
    return '';
  }

  // ---------- Logger / Logboek ----------
  const Logger = {
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    _on(mode,kind){ const m=(CONFIG.LOG[kind]||'off').toLowerCase(); return m===mode || m==='both'; },
    status(id,txt){
      const sid=String(id);
      if (this._on('console','status')) console.info(`[CharlieChoe][${sid}] status: ${txt}`);
      if (this._on('logboek','status')){
        const lb=this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(sid, txt);
      }
    },
    perMaat(id,report){
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[CharlieChoe][${id}] maatvergelijking`);
      try{
        console.table(report.map(r=>({ maat:r.maat, local:r.local, remote:r.remote ?? '—', status:r.actie })));
      } finally { console.groupEnd(); }
    },
    debug(...a){ if(CONFIG.LOG.debug) console.info('[CharlieChoe][debug]', ...a); }
  };

  // ---------- GM fetch ----------
  function gmFetch(url){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET',
        url,
        withCredentials:true,
        timeout:CONFIG.TIMEOUT,
        headers:{
          'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'X-Requested-With':'XMLHttpRequest',
          'User-Agent': navigator.userAgent,
          'Referer': 'https://vangennip.itsperfect.it/webshop/shop'
        },
        onload:(r)=> (r.status>=200 && r.status<400) ? resolve(r.responseText||'') : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject, ontimeout:()=>reject(new Error('timeout'))
      });
    });
  }

  // ---------- PDP fetch (single pattern) ----------
  const PDP_URL = (pid)=>`https://vangennip.itsperfect.it/webshop/shop/p_id=${encodeURIComponent(pid)}/`;
  async function fetchProductPageHTML(pid){
    const url=PDP_URL(pid);
    const html=await gmFetch(url); // op netwerffout gooit dit, anders string (kan leeg zijn)
    return html || '';
  }

  // ---------- Parser (v5 + legacy fallback) ----------
  function parseRemoteStockFromPDP(html){
    if (!html) return {};
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // v5 matrix
    let matrix = doc.querySelector('.product-matrix');
    if (matrix){
const headerMaten = Array
  .from(matrix.querySelectorAll('thead .product-matrix__header.product-matrix__size, thead th.product-matrix__size'))
  .map(th => th.textContent.trim())
  .filter(Boolean)
  .map(stripPrefixAfterColon);

      const rows = Array.from(matrix.querySelectorAll('tbody tr'));
      const totals = Object.fromEntries(headerMaten.map(m => [m.toUpperCase(), 0]));

      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td.product-matrix__size, td.size'));
        cells.forEach((cell, idx) => {
          const maat = (headerMaten[idx]||'').toUpperCase();
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

    // legacy quick_insert layout (soms nog aanwezig in PDP-DOM)
    const legacy = doc.querySelector('table.tableShoppingBag');
    if (legacy){
const headerMaten = Array.from(legacy.querySelectorAll('thead tr:nth-child(1) th.size'))
  .map(th => th.textContent.trim())
  .filter(Boolean)
  .map(stripPrefixAfterColon);
      const firstBodyRow = legacy.querySelector('tbody tr');
      const qtyCells = firstBodyRow ? firstBodyRow.querySelectorAll('td.quantity') : [];
      const map = {};
      const n = Math.min(headerMaten.length, qtyCells.length);
      for (let i=0;i<n;i++){
        const maat = headerMaten[i].toUpperCase();
        const stockTxt = qtyCells[i]?.querySelector('.stock')?.textContent.trim() ?? '';
        const stock = (stockTxt.includes('>') || stockTxt.includes('+')) ? 100 : (parseInt(stockTxt.replace(/[^\d]/g,''),10) || 0);
        map[maat]=stock;
      }
      return map;
    }

    // niks bruikbaars
    return {};
  }

  // ---------- Vergelijkingsregels + markeren ----------
  // - Uitboeken (rood):   local > 0 && remote == 0       → data-status='remove' + .status-red
  // - Bijboeken (groen):  local == 0 && remote > 4       → data-status='add'    + .status-green
  // - Negeren:            local == 0 && remote <= 4      → geen data-status
  // - Maat onbekend bij VG: markeer als remove als local>0, anders negeren (vg_missing)
  function applyRulesAndMark(localTable, remoteMap){
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];

    rows.forEach(row => {
      const sizeCell  = row.children[0];
      const localCell = row.children[1];
      const maat  = (row.dataset.size || sizeCell?.textContent || '').trim().toUpperCase();
      const local = parseInt((localCell?.textContent || '').trim(),10) || 0;

      const rem = (typeof remoteMap[maat] === 'number') ? remoteMap[maat] : undefined;

      // reset styles + status
      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green','status-red');
      delete row.dataset.status;

      let actie = 'none';

      if (typeof rem === 'number'){
        if (local > 0 && rem === 0){
          row.style.background = '#f8d7da';
          row.title = 'Uitboeken (VG=0)';
          row.dataset.status = 'remove';
          row.classList.add('status-red');
          actie = 'uitboeken';
        } else if (local === 0 && rem > (CONFIG.RULES.addThreshold-1)){
          row.style.background = '#d4edda';
          row.title = `Bijboeken 2 (VG>${CONFIG.RULES.addThreshold-1})`;
          row.dataset.status = 'add';
          row.classList.add('status-green');
          actie = 'bijboeken_2';
        } else if (local === 0 && rem <= (CONFIG.RULES.addThreshold-1)){
          row.title = `Negeren (VG<=${CONFIG.RULES.addThreshold-1} en lokaal 0)`;
          actie = 'negeren';
        }
      } else {
        row.title = 'Maat niet gevonden bij leverancier';
        if (local > 0){
          row.style.background = '#f8d7da';
          row.dataset.status = 'remove';
          row.classList.add('status-red');
        }
        actie = 'vg_missing';
      }

      report.push({ maat, local, remote: rem, actie });
    });

    return report;
  }

  function bepaalLogStatus(report, remoteMap){
    const counts = report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {});
    const remoteLeeg = !remoteMap || Object.keys(remoteMap).length===0;
    if (remoteLeeg) return 'niet-gevonden';
    if ((counts.uitboeken||0)===0 && (counts.bijboeken_2||0)===0) return 'ok';
    return 'afwijking';
  }

  // ---------- Main ----------
  async function run(btn){
    if (typeof StockKit==='undefined' || !StockKit.makeProgress){
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }

    const progress = StockKit.makeProgress(btn);
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);
    let totalMutations=0, ok=0, fail=0, idx=0;

    for (const table of tables){
      idx++;

      const pid   = extractPidFromTable(table);
      const anchorId = table.id || pid || `row-${idx}`; // logboek target = table.id
      // const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || anchorId;

      try {
        if (!pid){
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const html   = await fetchProductPageHTML(pid);
        const remote = parseRemoteStockFromPDP(html);

        if (!remote || Object.keys(remote).length===0){
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const report = applyRulesAndMark(table, remote);
        const diffs  = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, remote);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);

        ok++;
      } catch(e){
        console.error('[CharlieChoe] fout:', e);
        const isNotFound = /http\s(?:403|404|410|5\d{2})/i.test(String(e?.message||'')); // netwerk/HTTP → niet-gevonden
        Logger.status(anchorId, isNotFound ? 'niet-gevonden' : 'afwijking');
        if (isNotFound) Logger.perMaat(anchorId, []);
        fail++;
      }

      progress.setDone(idx);
      await delay(80);
    }

    progress.success(totalMutations);
  }

  // ---------- UI / knop ----------
  const SUPPORTED_BRANDS = new Set(['charlie choe','charlie','charlie-choe']);
  function getSelectedBrandLabel(){
    const sel=$('#leverancier-keuze');
    if(!sel) return 'Charlie Choe';
    const opt=sel.options[sel.selectedIndex];
    let label=(opt?.text||'').trim();
    if(!label || /kies\s+leverancier/i.test(label) || /^-+\s*kies/i.test(label)) label=(sel.value||'').trim();
    return label || 'Charlie Choe';
  }
  function isSupportedSelected(){
    const dd=$('#leverancier-keuze');
    if(!dd) return true;
    const byValue=norm(dd.value||'');
    const byText =norm((dd.options[dd.selectedIndex]?.text||''));
    return SUPPORTED_BRANDS.has(byValue) || SUPPORTED_BRANDS.has(byText);
  }

  function addButton(){
    if (document.getElementById('check-charlie-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css'; link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.id='check-charlie-btn';
    btn.className='sk-btn';
    btn.textContent=`🔍 Check stock ${getSelectedBrandLabel()}`;
    Object.assign(btn.style,{ position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click', ()=>run(btn));
    document.body.appendChild(btn);

    const outputHasTables=()=> !!document.querySelector('#output table');
    function isBusy(){ return btn.classList.contains('is-busy'); }
    function isTerminal(){ const t=(btn.textContent||'').trim(); return /^.*Klaar:/.test(t) || t.includes('❌ Fout'); }
    function maybeUpdateLabel(){ if(!isBusy() && !isTerminal()) btn.textContent=`🔍 Check stock ${getSelectedBrandLabel()}`; }

    function toggle(){
      btn.style.display = (outputHasTables() && isSupportedSelected()) ? 'block' : 'none';
      if(btn.style.display==='block') maybeUpdateLabel();
    }

    const out=$('#output'); if(out) new MutationObserver(()=>{ toggle(); }).observe(out,{ childList:true, subtree:true });
    const select=$('#leverancier-keuze'); if(select) select.addEventListener('change', ()=>{ maybeUpdateLabel(); toggle(); });
    const upload=$('#upload-container'); if(upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
