// ==UserScript==
// @name         Stock Check | Sugar Candy
// @namespace    https://dutchdesignersoutlet.nl/
// @version      4.2
// @description  Vergelijk DDO-voorraad met Sugar Candy.
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      b2b.cakelingerie.eu
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-sugar-candy.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-sugar-candy.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-sugar-candy',
      name: 'Stock Check | Sugar Candy',
      version: typeof GM_info !== 'undefined' ? GM_info.script.version : '4.2'
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  registerUserscript();
  if (!Core || typeof Core.runTables !== 'function') {
    console.error('[Stock Check|Sugar Candy] VCPCore ontbreekt.');
    return;
  }

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

  // Kleurcode naar Cake-naam voor headers in de vorm 00-0000-XX.
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
    '63': 'Plum',
    '28': 'Cobalt Blue',
  };

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
      if(g.StockCheckConfig?.detailLogging!==true) return;
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[Sugar][${id}] maatvergelijking`);
      try{
        const rows = report.map(r => ({ maat:r.maat, local:r.local, remote:Number.isFinite(r.sup)?r.sup:'-', status:r.actie }));
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

  function applyRulesAndMark(localTable, remoteMap){
    const rows=localTable.querySelectorAll('tbody tr'); const report=[];
    let firstMut = null;
    rows.forEach(row=>{
      const sizeCell=row.children[0];
      const localCell=row.children[1];
      const maat=(row.dataset.size || sizeCell?.textContent || '').trim().toUpperCase();
      const local=parseInt((localCell?.textContent || '').trim(),10) || 0;

      // remoteMap: Map(size -> qty)
      let sup = remoteMap.has(maat) ? (remoteMap.get(maat)||0) : undefined;
      if (sup === undefined) {
        // Probeer naast "70 D" ook "70D".
        const compact = maat.replace(/\s+/g,'');
        sup = remoteMap.get(compact);
      }
      const supNum = Number(sup ?? 0);
      const isAvail = Number.isFinite(supNum) && supNum > 0;

      Core.clearRowMarks(row);

      let actie='ok';
      let delta=0;
      if (local > 0 && !isAvail){
        delta=local;
        Core.markRow(row,{action:'remove',delta,title:`Uitboeken ${delta} (Sugar Candy niet beschikbaar)`});
        actie='uitboeken';
        if(!firstMut) firstMut=row;
      } else if (local === 0 && isAvail){
        delta=2;
        Core.markRow(row,{action:'add',delta,title:`Bijboeken ${delta} (Sugar Candy beschikbaar)`});
        actie='bijboeken';
        if(!firstMut) firstMut=row;
      } else {
        Core.markRow(row,{action:'none',delta:0,title:`OK (leverancier qty ${supNum})`});
      }
      report.push({ maat, local, sup: isAvail ? supNum : 0, actie, delta });
    });
    if(firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, remoteMap){
    const n=report.length;
    const counts=report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {});
    const nUit=counts.uitboeken||0, nBij=counts.bijboeken||0;
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

  async function perTable(table){
      const headerText = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
      const pid=(table.id||'').trim();
      const label = headerText || pid || 'onbekend';
      const anchorId = pid || label;

      try {
        const m = (headerText||'').match(/(\d{2}-\d{4,}-\d{2})/);
        const suffix = m ? m[1].split('-').pop() : null;
        if (!suffix) { Logger.status(anchorId, 'niet-gevonden'); return 0; }
        const colorName = COLOR_CODE_MAP[suffix];
        if (!colorName) { Logger.status(anchorId, 'niet-gevonden'); return 0; }

        const productUrl = pickProductUrl(headerText);
        const base = await loadBasePage(productUrl);
        const colorInfo = base && base.doc ? findColorValueByNameFromDoc(base.doc, colorName) : null;
        if (!colorInfo){ Logger.status(anchorId, 'niet-gevonden'); return 0; }

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
          return 0;
        }

        const report = applyRulesAndMark(table, remoteMerged);
        const diffs  = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken').length;
        const status = bepaalLogStatus(report, remoteMerged);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);
        return diffs;
      } catch(e){
        console.error('[Sugar] fout:', e);
        Logger.status(anchorId, isNotFoundError(e) ? 'niet-gevonden' : 'afwijking');
        return 0;
      }
  }

  async function run(btn){
    const tables=Array.from(document.querySelectorAll('#output table'));
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
    const dd=$('#leverancier-keuze'); if(!dd) return true;
    const v=(dd.value||'').trim().toLowerCase().replace(/[_\s]+/g,'-');
    return v==='sugar-candy' || v==='sugarcandy' || v==='sugar';
  }

  const { btn } = Core.mountSupplierButton({
    id:'stock-check-sugar-candy-btn',
    text:'Controleer Sugar Candy',
    right:250,
    top:8,
    match:()=>isSupportedSelected(),
    onClick:(button)=>run(button)
  });
  btn.innerHTML='<i class="fa-solid fa-magnifying-glass-chart"></i>';
  btn.setAttribute('aria-label','Controleer voorraad bij Sugar Candy');
  btn.title='Controleer voorraad bij Sugar Candy';
})();
