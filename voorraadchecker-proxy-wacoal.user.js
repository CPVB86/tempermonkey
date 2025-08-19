// ==UserScript==
// @name         Voorraadchecker Proxy - Wacoal Group
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock (Wacoal Group) — knop/progress via StockKit, geen inline-overschrijvingen.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      b2b.wacoal-europe.com
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js?v=2025-08-13-1
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-wacoal.user.js
// ==/UserScript==


(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:   'both',    // 'console' | 'logboek' | 'both' | 'off'
      perMaat:  'console', // maten-overzicht in console
      debug:    false,
    }
  };

  const TIMEOUT = 15000;

  const SUPPORTED_BRANDS = new Set([
    'wacoal','freya','freya swim','fantasie','fantasie swim','elomi','elomi swim'
  ]);

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const $=(s,r=document)=>r.querySelector(s);
  const norm=(s='')=>String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');

  // ---------- Logger (als Anita) ----------
  const Logger={
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    _on(mode,kind){ const m=(CONFIG.LOG[kind]||'off').toLowerCase(); return m===mode || m==='both'; },
    status(id,txt){
      const sid=String(id);
      if(this._on('console','status')) console.info(`[Wacoal][${sid}] status: ${txt}`);
      if(this._on('logboek','status')){
        const lb=this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(sid, txt);
      }
    },
    perMaat(id,report){
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[Wacoal][${id}] maatvergelijking`);
      try{
        const rows = report.map(r => ({ maat:r.maat, local:r.local, remote:Number.isFinite(r.sup)?r.sup:'—', status:r.actie }));
        console.table(rows);
      } finally { console.groupEnd(); }
    },
    debug(...a){ if(CONFIG.LOG.debug) console.info('[Wacoal][debug]', ...a); }
  };

  // ---------- GM fetch ----------
  function gmFetch(url){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET', url, withCredentials:true, timeout:TIMEOUT,
        headers:{ 'Accept':'application/json,text/html;q=0.8,*/*;q=0.5', 'User-Agent': navigator.userAgent },
        onload:(r)=> (r.status>=200 && r.status<400) ? resolve(r.responseText||'') : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject, ontimeout:()=>reject(new Error(`timeout @ ${url}`))
      });
    });
  }

  // ---------- JSON → status-map ----------
  function statusFromWacoal(wacoalStatus, stockLevel){
    const s=String(wacoalStatus||'').toUpperCase();
    if (s==='IN_STOCK') return 'IN_STOCK';
    if (s==='WITHIN_STAGE1' || s==='WITHIN_STAGE2') return 'LOW';
    if (s==='OUT_OF_STOCK') return 'OUT_OF_STOCK';
    return (stockLevel>0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
  }

  function buildStatusMap(json){
    const map={};
    if(!json?.is2DSizing){
      for(const cell of (json?.sizeData||[])){
        const sizeEU=(cell?.countrySizeMap?.EU || cell?.globalSize || '').toString().trim().toUpperCase();
        if(!sizeEU) continue;
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = cell?.stock?.wacoalstockStatus || (stockLevel>0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
        const status = statusFromWacoal(wacoal, stockLevel);
        map[sizeEU]={ status, stock: stockLevel };
      }
      return map;
    }
    for(const row of (json?.sizeData||[])){
      for(const cell of (row?.sizeFitData||[])){
        const bandEU=(cell?.countrySizeMap?.EU||'').toString().trim();
        const cupEU =(cell?.countryFitMap?.EU ||'').toString().trim();
        if(!bandEU || !cupEU) continue;
        const key=`${bandEU}${cupEU}`.toUpperCase();
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = cell?.stock?.wacoalstockStatus || (stockLevel>0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
        const status = statusFromWacoal(wacoal, stockLevel);
        map[key]={ status, stock: stockLevel };
      }
    }
    return map;
  }

  function resolveRemote(map,label){
    const raw=String(label||'').trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(map,raw)) return map[raw];
    const nospace=raw.replace(/\s+/g,'');
    if (Object.prototype.hasOwnProperty.call(map,nospace)) return map[nospace];
    const m=raw.match(/^(\d+)\s*([A-Z]{1,2}(?:\/[A-Z]{1,2})+)$/);
    if(m){
      const band=m[1]; const cups=m[2].split('/');
      let best=null; const rank=x=>x==='IN_STOCK'?2:x==='LOW'?1:x==='OUT_OF_STOCK'?0:-1;
      for(const cup of cups){ const k=`${band}${cup}`; if(map[k] && (!best || rank(map[k].status)>rank(best.status))) best=map[k]; }
      if(best) return best;
    }
    if(raw.includes('/')){
      const rank=x=>x==='IN_STOCK'?2:x==='LOW'?1:x==='OUT_OF_STOCK'?0:-1; let best=null;
      for(const part of raw.split('/').map(s=>s.trim())){
        const k1=part, k2=part.replace(/\s+/g,'');
        const cand = map[k1]||map[k2];
        if(cand && (!best || rank(cand.status)>rank(best.status))) best=cand;
      }
      if(best) return best;
    }
    return undefined;
  }

  function applyRulesAndMark(localTable, statusMap){
    const rows=localTable.querySelectorAll('tbody tr'); const report=[];
    rows.forEach(row=>{
      const sizeCell=row.children[0];
      const localCell=row.children[1];
      const maat=(row.dataset.size || sizeCell?.textContent || '').trim().toUpperCase();
      const local=parseInt((localCell?.textContent || '').trim(),10) || 0;

      const remote = resolveRemote(statusMap, maat);
      const st = remote?.status; const stockNum = Number(remote?.stock ?? 0) || 0;
      const supVal = (st==='IN_STOCK') ? (stockNum||1) : (st ? 0 : -1);
      const effAvail = supVal>0;

      row.style.background=''; row.style.transition='background-color .25s';
      row.title=''; row.classList.remove('status-green','status-red'); delete row.dataset.status;

      let actie='none';
      if (local > 0 && (st==='OUT_OF_STOCK' || st==='LOW')){
        row.style.background='#f8d7da'; row.title = (st==='LOW') ? 'Uitboeken (Wacoal laag)' : 'Uitboeken (Wacoal uitverkocht)';
        row.dataset.status='remove'; row.classList.add('status-red'); actie='uitboeken';
      } else if (local === 0 && effAvail){
        row.style.background='#d4edda'; row.title='Bijboeken 2 (Wacoal op voorraad)';
        row.dataset.status='add'; row.classList.add('status-green'); actie='bijboeken_2';
      } else if (local === 0 && !effAvail){
        row.title = (st ? 'Negeren (Wacoal niet op voorraad)' : 'Negeren (maat onbekend bij Wacoal → 0)'); actie='negeren';
      }
      report.push({ maat, local, sup: supVal, actie });
    });
    return report;
  }

  function bepaalLogStatus(report, statusMap){
    const n=report.length;
    const counts=report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {});
    const nUit=counts.uitboeken||0, nBij=counts.bijboeken_2||0;
    const remoteLeeg=!statusMap || Object.keys(statusMap).length===0;
    if (remoteLeeg) return 'niet-gevonden';
    if (n>0 && nUit===0 && nBij===0) return 'ok';
    return 'afwijking';
  }

  // ---------- Error helpers ----------
  function isNotFoundError(err){
    const msg = String(err && err.message || '').toUpperCase();
    if (/HTTP\s(404|410)/.test(msg)) return true;       // niet-bestaand product
    if (/HTTP\s5\d{2}/.test(msg)) return true;         // server error → behandel als niet-gevonden (legacy/retired)
    if (/SYNTAXERROR/.test(msg)) return true;            // lege/ongeldige JSON
    return false;
  }

  // ---------- Main ----------
  async function run(btn){
    if (typeof StockKit==='undefined' || !StockKit.makeProgress){
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }

    const progress=StockKit.makeProgress(btn);
    const tables=Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);
    let totalMutations=0, ok=0, fail=0, idx=0;

    for (const table of tables){
      idx++;

      const pid=(table.id||'').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
      const anchorId = pid || label;

      try {
        if(!pid){
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const url=`https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(pid)}`;
        const jsonText=await gmFetch(url);
        const json=JSON.parse(jsonText);

        const statusMap = buildStatusMap(json);
        if (!statusMap || Object.keys(statusMap).length===0){
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const report = applyRulesAndMark(table, statusMap);
        const diffs  = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, statusMap);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);

        ok++;
      } catch(e){
        console.error('[Wacoal] fout:', e);
        if (isNotFoundError(e)) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
        } else {
          Logger.status(anchorId, 'afwijking');
        }
        fail++;
      }

      progress.setDone(idx);
      await delay(80);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) console.info(`[Wacoal] verwerkt: ${ok+fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`);
  }

  // ---------- UI ----------
  function getSelectedBrandLabel(){
    const sel=$('#leverancier-keuze');
    if(!sel) return 'Wacoal';
    const opt=sel.options[sel.selectedIndex];
    let label=(opt?.text||'').trim();
    if(!label || /kies\s+leverancier/i.test(label) || /^-+\s*kies/i.test(label)) label=(sel.value||'').trim();
    return label || 'Wacoal';
  }

  function isSupportedSelected(){
    const dd=$('#leverancier-keuze');
    if(!dd) return true;
    const byValue=norm(dd.value||'');
    const byText =norm((dd.options[dd.selectedIndex]?.text||''));
    return SUPPORTED_BRANDS.has(byValue) || SUPPORTED_BRANDS.has(byText);
  }

  function addButton(){
    if (document.getElementById('check-wacoal-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css'; link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.id='check-wacoal-btn';
    btn.className='sk-btn';
    btn.textContent=`🔍 Check stock ${getSelectedBrandLabel()}`;
    Object.assign(btn.style,{ position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click', ()=>run(btn));
    document.body.appendChild(btn);

    const outputHasTables=()=> !!document.querySelector('#output table');
    function isBusy(){ return btn.classList.contains('is-busy'); }
    function isTerminal(){ const t=(btn.textContent||'').trim(); return /^(?:.*)?Klaar:/u.test(t) || t.includes('❌ Fout'); }
    function maybeUpdateLabel(){ if(!isBusy() && !isTerminal()) btn.textContent=`🔍 Check stock ${getSelectedBrandLabel()}`; }

    function toggle(){
      btn.style.display = (outputHasTables() && isSupportedSelected()) ? 'block' : 'none';
      if(btn.style.display==='block') maybeUpdateLabel();
    }

    const out=$('#output'); if(out) new MutationObserver(toggle).observe(out,{ childList:true, subtree:true });
    const select=$('#leverancier-keuze'); if(select) select.addEventListener('change', ()=>{ maybeUpdateLabel(); toggle(); });
    const upload=$('#upload-container'); if(upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
