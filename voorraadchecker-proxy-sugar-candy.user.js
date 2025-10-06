// ==UserScript==
// @name         Voorraadchecker Proxy - Sugar Candy
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      b2b.cakelingerie.eu
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-sugar-candy.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-sugar-candy.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:   'both',    // 'console' | 'logboek' | 'both' | 'off'
      perMaat:  'console', // maten-overzicht in console
      debug:    false,
    },
    treatLt5AsZero: true,
    uiDelayMs: 80
  };

  const TIMEOUT = 15000;

  // Product-URL heuristiek
  const PRODUCT_URLS = [
    { key: 'basic-bra',          url: 'https://b2b.cakelingerie.eu/products/basic-bra' },
    { key: 'basic-bikini-brief', url: 'https://b2b.cakelingerie.eu/products/basic-bikini-brief' },
    { key: 'bestie-bra',         url: 'https://b2b.cakelingerie.eu/products/bestie-bra' },
    { key: 'bestie-brief',       url: 'https://b2b.cakelingerie.eu/products/bestie-brief' },
    { key: 'posh-bra',           url: 'https://b2b.cakelingerie.eu/products/posh-bra' },
    { key: 'nursing-bra',        url: 'https://b2b.cakelingerie.eu/products/nursing-bra' },
  ];

  // kleurcode → naam op Cake (voor header parsing 00-0000-XX)
  const COLOR_CODE_MAP = {
    '05': 'Rosewood',
    '07': 'Beige',
    '06': 'Black',
    '03': 'Stone',
    '09': 'Hot Pink',
    '14': 'Clay',
    '15': 'Lavender',
    '20': 'Baby Blue',
    '43': 'Forest Green',
    '45': 'Pink',
    '31': 'Lemon',
  };

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const $=(s,r=document)=>r.querySelector(s);

  // ---------- Logger (zelfde patroon als Wacoal) ----------
  const Logger={
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    _on(mode,kind){ const m=(CONFIG.LOG[kind]||'off').toLowerCase(); return m===mode || m==='both'; },
    status(id,txt){
      const sid=String(id);
      if(this._on('console','status')) console.info(`[Sugar][${sid}] status: ${txt}`);
      if(this._on('logboek','status')){
        const lb=this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(sid, txt);
      }
    },
    perMaat(id,report){
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[Sugar][${id}] maatvergelijking`);
      try{
        const rows = report.map(r => ({ maat:r.maat, local:r.local, remote:Number.isFinite(r.sup)?r.sup:'—', status:r.actie }));
        console.table(rows);
      } finally { console.groupEnd(); }
    },
    debug(...a){ if(CONFIG.LOG.debug) console.info('[Sugar][debug]', ...a); }
  };

  // ---------- GM helpers ----------
  function gmFetch(url){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET', url, withCredentials:true, timeout:TIMEOUT,
        headers:{
          'Accept':'text/html,*/*;q=0.8',
          'User-Agent':navigator.userAgent,
          'Referer':'https://b2b.cakelingerie.eu/'
        },
        onload:(r)=> (r.status>=200 && r.status<400) ? resolve(r.responseText||'') : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject, ontimeout:()=>reject(new Error(`timeout @ ${url}`))
      });
    });
  }
  const parseHTML = html => new DOMParser().parseFromString(html,'text/html');

  // ---------- Cake helpers ----------
  function pickProductUrl(headerText){
    const h=(headerText||'').toLowerCase();
    if (h.includes('bikini'))   return PRODUCT_URLS.find(p=>p.key==='basic-bikini-brief').url;
    if (h.includes('bestie') && h.includes('brief')) return PRODUCT_URLS.find(p=>p.key==='bestie-brief').url;
    if (h.includes('bestie'))   return PRODUCT_URLS.find(p=>p.key==='bestie-bra').url;
    if (h.includes('posh'))     return PRODUCT_URLS.find(p=>p.key==='posh-bra').url;
    if (h.includes('nursing'))  return PRODUCT_URLS.find(p=>p.key==='nursing-bra').url;
    return PRODUCT_URLS.find(p=>p.key==='basic-bra').url;
  }

  async function loadBasePage(productUrl){
    const html = await gmFetch(productUrl);
    const doc = parseHTML(html);
    return { doc };
  }

  function findColorValueByNameFromDoc(doc, colorName){
    const sel = doc.querySelector('select[name="group[3]"], select#group_3, select[data-product-attribute="3"]');
    if (!sel) return null;
    const want = String(colorName||'').trim().toLowerCase();
    let hit = null;
    sel.querySelectorAll('option').forEach(opt=>{
      const text=(opt.textContent||'').trim().toLowerCase();
      const val =(opt.value||'').trim();
      if (!val) return;
      if (text===want || text.includes(want)) hit = { value: val, selectName: sel.name || 'group[3]' };
    });
    return hit;
  }

  function getCupOptionsFromDoc(doc){
    const sel = doc.querySelector('select[name="group[8]"], select#group_8, select[data-product-attribute="8"]');
    if (!sel) return [];
    const out = [];
    sel.querySelectorAll('option').forEach(opt=>{
      const val = (opt.value||'').trim();
      const txt = (opt.textContent||'').trim();
      if (val) out.push({ value: val, text: txt, selectName: sel.name || 'group[8]' });
    });
    return out;
  }

  async function fetchSizeStocks(productUrl, params){
    const base = new URL(productUrl); base.search='';
    const qs = new URLSearchParams();
    for (const p of params) qs.set(p.name, p.value);
    const variantUrl = `${base.toString()}?${qs.toString()}`;

    const html = await gmFetch(variantUrl);
    const doc = parseHTML(html);
    const out = new Map();

    doc.querySelectorAll('input.numberinputbox[data-lblsz]').forEach(inp=>{
      const size = (inp.getAttribute('data-lblsz')||'').trim();
      let qty = parseInt((inp.getAttribute('data-chqt')||'0').trim(),10);
      if (!Number.isFinite(qty)) qty = 0;
      if (CONFIG.treatLt5AsZero && qty < 5) qty = 0;
      if (size) out.set(size.toUpperCase(), qty);
    });
    doc.querySelectorAll('.oos-size').forEach(span=>{
      const tr = span.closest('tr');
      const sizeCell = tr?.querySelector('td:nth-child(1)');
      const size = (sizeCell?.textContent||'').trim().toUpperCase();
      if (size && !out.has(size)) out.set(size, 0);
    });

    return out;
  }

  function mergeMapsMax(maps){
    const merged = new Map();
    for (const m of maps){
      if (!m) continue;
      m.forEach((qty, size)=>{
        const cur = merged.get(size) || 0;
        merged.set(size, Math.max(cur, qty));
      });
    }
    return merged;
  }

  // ---------- UI helpers / badges ----------
  function setBadge(table, status){
    const b = window.StockKit?.Badges;
    if (b?.setForTable) { b.setForTable(table, status); return; }
    // fallback badge
    const th = table.querySelector('thead th[colspan], thead tr:first-child th:last-child, thead th');
    if (!th) return;
    let tag = th.querySelector('.sk-badge');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'sk-badge';
      tag.style.cssText = 'margin-left:8px;padding:2px 6px;border-radius:10px;font-size:12px;vertical-align:middle';
      th.appendChild(tag);
    }
    const palette = {
      'ok':            {bg:'#e7f7ee', fg:'#1b7f44', txt:'OK'},
      'afwijking':     {bg:'#fff4d6', fg:'#8a6d00', txt:'Afwijking'},
      'niet-gevonden': {bg:'#fde2e1', fg:'#a11a16', txt:'Niet gevonden'},
    };
    const p = palette[status] || palette['ok'];
    tag.textContent = p.txt; tag.style.background = p.bg; tag.style.color = p.fg;
  }

  function applyRulesAndMark(localTable, remoteMap){
    const rows=localTable.querySelectorAll('tbody tr'); const report=[];
    rows.forEach(row=>{
      const sizeCell=row.children[0];
      const localCell=row.children[1];
      const maat=(row.dataset.size || sizeCell?.textContent || '').trim().toUpperCase();
      const local=parseInt((localCell?.textContent || '').trim(),10) || 0;

      // remoteMap: Map(size -> qty)
      let sup = remoteMap.has(maat) ? (remoteMap.get(maat)||0) : undefined;
      if (sup === undefined) {
        // probeer 70 D → 70D
        const compact = maat.replace(/\s+/g,'');
        sup = remoteMap.get(compact);
      }
      const supNum = Number(sup ?? 0);
      const isAvail = Number.isFinite(supNum) && supNum > 0;

      row.style.background=''; row.style.transition='background-color .25s';
      row.title=''; row.classList.remove('status-green','status-red'); delete row.dataset.status;

      let actie='none';
      if (local > 0 && !isAvail){
        row.style.background='#f8d7da'; row.title='Uitboeken (Sugar: 0)';
        row.dataset.status='remove'; row.classList.add('status-red'); actie='uitboeken';
      } else if (local === 0 && isAvail){
        row.style.background='#d4edda'; row.title='Bijboeken 2 (Sugar >0)';
        row.dataset.status='add'; row.classList.add('status-green'); actie='bijboeken_2';
      } else {
        actie='negeren';
      }
      report.push({ maat, local, sup: isAvail ? supNum : 0, actie });
    });
    return report;
  }

  function bepaalLogStatus(report, remoteMap){
    const n=report.length;
    const counts=report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {});
    const nUit=counts.uitboeken||0, nBij=counts.bijboeken_2||0;
    const remoteLeeg = !remoteMap || remoteMap.size===0;
    if (remoteLeeg) return 'niet-gevonden';
    if (n>0 && nUit===0 && nBij===0) return 'ok';
    return 'afwijking';
  }

  function isNotFoundError(err){
    const msg = String(err && err.message || '').toUpperCase();
    if (/HTTP\s(403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
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

      const headerText = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
      const pid=(table.id||'').trim();
      const label = headerText || pid || 'onbekend';
      const anchorId = pid || label;

      try {
        // Kleur uit header → naam
        const m = (headerText||'').match(/(\d{2}-\d{4,}-\d{2})/);
        const suffix = m ? m[1].split('-').pop() : null;
        if (!suffix) { Logger.status(anchorId, 'niet-gevonden'); setBadge(table,'niet-gevonden'); progress.setDone(idx); continue; }
        const colorName = COLOR_CODE_MAP[suffix];
        if (!colorName) { Logger.status(anchorId, 'niet-gevonden'); setBadge(table,'niet-gevonden'); progress.setDone(idx); continue; }

        // Product URL heuristiek
        const productUrl = pickProductUrl(headerText);

        // Basis & selects laden
        const base = await loadBasePage(productUrl);
        const colorInfo = base && base.doc ? findColorValueByNameFromDoc(base.doc, colorName) : null;
        if (!colorInfo){ Logger.status(anchorId, 'niet-gevonden'); setBadge(table,'niet-gevonden'); progress.setDone(idx); continue; }

        const cupOpts = base.doc ? getCupOptionsFromDoc(base.doc) : [];
        const fetches = [];
        if (cupOpts.length === 0){
          fetches.push(fetchSizeStocks(productUrl, [{name: colorInfo.selectName, value: colorInfo.value}]));
        } else {
          for (const cup of cupOpts){
            fetches.push(fetchSizeStocks(productUrl, [
              { name: colorInfo.selectName, value: colorInfo.value },
              { name: cup.selectName,      value: cup.value }
            ]));
          }
        }

        const maps = await Promise.all(fetches);
        const remoteMerged = mergeMapsMax(maps);
        if (!remoteMerged || remoteMerged.size===0){
          Logger.status(anchorId, 'niet-gevonden');
          setBadge(table,'niet-gevonden');
          progress.setDone(idx);
          continue;
        }

        // Vergelijking & markering
        const report = applyRulesAndMark(table, remoteMerged);
        const diffs  = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, remoteMerged);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);
        setBadge(table, status);

        ok++;
      } catch(e){
        console.error('[Sugar] fout:', e);
        if (isNotFoundError(e)) {
          Logger.status(anchorId, 'niet-gevonden'); setBadge(table,'niet-gevonden');
        } else {
          Logger.status(anchorId, 'afwijking'); setBadge(table,'afwijking');
        }
        fail++;
      }

      progress.setDone(idx);
      await delay(CONFIG.uiDelayMs);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) console.info(`[Sugar] verwerkt: ${ok+fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`);
  }

  // ---------- UI ----------
  function getSelectedBrandLabel(){
    const sel=$('#leverancier-keuze');
    if(!sel) return 'Sugar Candy';
    const opt=sel.options[sel.selectedIndex];
    let label=(opt?.text||'').trim();
    if(!label || /kies\s+leverancier/i.test(label) || /^-+\s*kies/i.test(label)) label=(sel.value||'').trim();
    return label || 'Sugar Candy';
  }

  function isSupportedSelected(){
    const dd=$('#leverancier-keuze'); if(!dd) return true;
    const v=(dd.value||'').trim().toLowerCase().replace(/[_\s]+/g,'-');
    return v==='sugar-candy' || v==='sugarcandy' || v==='sugar';
  }

  function addButton(){
    if (document.getElementById('check-sugar-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css'; link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.id='check-sugar-btn';
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
