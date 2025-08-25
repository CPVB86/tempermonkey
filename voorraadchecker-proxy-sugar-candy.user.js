// ==UserScript==
// @name         Voorraadchecker Proxy - Sugar Candy
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
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

(function(){
  'use strict';

  /** =========================
   *  Config
   *  ========================= */
  const PRODUCT_URLS = [
    { key: 'basic-bra',          url: 'https://b2b.cakelingerie.eu/products/basic-bra' },
    { key: 'basic-bikini-brief', url: 'https://b2b.cakelingerie.eu/products/basic-bikini-brief' },
    { key: 'bestie-bra',         url: 'https://b2b.cakelingerie.eu/products/bestie-bra' },
    { key: 'bestie-brief',       url: 'https://b2b.cakelingerie.eu/products/bestie-brief' },
    { key: 'posh-bra',           url: 'https://b2b.cakelingerie.eu/products/posh-bra' },
    { key: 'nursing-bra',        url: 'https://b2b.cakelingerie.eu/products/nursing-bra' },
  ];

  const TREAT_LT5_AS_ZERO = true;

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

  const C = { GREEN:'#D4EDDA', RED:'#F8D7DA' };

  /** =========================
   *  Net helpers
   *  ========================= */
  function gmGet(url){
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:'GET', url, withCredentials:true,
        headers:{
          'Accept':'text/html,*/*;q=0.8',
          'User-Agent':navigator.userAgent,
          'Referer':'https://b2b.cakelingerie.eu/'
        },
        onload:r=>resolve(r), onerror:e=>reject(e), ontimeout:()=>reject(new Error('Timeout')),
      });
    });
  }
  const parseHTML = html => new DOMParser().parseFromString(html,'text/html');

  /** =========================
   *  Product-URL heuristiek
   *  ========================= */
  function pickProductUrl(headerText){
    const h = (headerText||'').toLowerCase();
    if (h.includes('bikini'))   return PRODUCT_URLS.find(p=>p.key==='basic-bikini-brief').url;
    if (h.includes('bestie') && h.includes('brief')) return PRODUCT_URLS.find(p=>p.key==='bestie-brief').url;
    if (h.includes('bestie'))   return PRODUCT_URLS.find(p=>p.key==='bestie-bra').url;
    if (h.includes('posh'))     return PRODUCT_URLS.find(p=>p.key==='posh-bra').url;
    if (h.includes('nursing'))  return PRODUCT_URLS.find(p=>p.key==='nursing-bra').url;
    return PRODUCT_URLS.find(p=>p.key==='basic-bra').url;
  }

  /** =========================
   *  Basispagina lezen (kleur/cup selects)
   *  ========================= */
  async function loadBasePage(productUrl){
    const r = await gmGet(productUrl);
    if (r.status !== 200 || !r.responseText) return null;
    const doc = parseHTML(r.responseText);
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

  /** =========================
   *  Variant HTML → Map(size->qty)
   *  ========================= */
  async function fetchSizeStocks(productUrl, params){
    const base = new URL(productUrl); base.search='';
    const qs = new URLSearchParams();
    for (const p of params) qs.set(p.name, p.value);
    const variantUrl = `${base.toString()}?${qs.toString()}`;

    const r = await gmGet(variantUrl);
    if (r.status !== 200 || !r.responseText) return { map:null, variantUrl, status:r.status };

    const doc = parseHTML(r.responseText);
    const out = new Map();

    doc.querySelectorAll('input.numberinputbox[data-lblsz]').forEach(inp=>{
      const size = (inp.getAttribute('data-lblsz')||'').trim();
      let qty = parseInt((inp.getAttribute('data-chqt')||'0').trim(),10);
      if (!Number.isFinite(qty)) qty = 0;
      if (TREAT_LT5_AS_ZERO && qty < 5) qty = 0;
      if (size) out.set(size, qty);
    });
    doc.querySelectorAll('.oos-size').forEach(span=>{
      const tr = span.closest('tr');
      const sizeCell = tr?.querySelector('td:nth-child(1)');
      const size = (sizeCell?.textContent||'').trim();
      if (size && !out.has(size)) out.set(size, 0);
    });

    return { map: out, variantUrl, status: r.status };
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

  /** =========================
   *  UI helpers
   *  ========================= */
  function markTick(table){
    try{
      if (window.zetGroenVinkjeOpTabel?.(table)) return;
      if (window.groenVinkje?.mark?.(table)) return;
      const th = table.querySelector('thead th[colspan], thead tr:first-child th:last-child, thead th');
      if (th && !th.querySelector('.header-vinkje')) {
        const span = document.createElement('span');
        span.className = 'header-vinkje';
        span.textContent = '✓';
        span.style.cssText='color:#2ecc71;font-weight:700;float:right;margin-left:12px;font-size:18px;';
        th.appendChild(span);
      }
    }catch{}
  }
  function logResult(id, status){
    const lb = (typeof unsafeWindow!=='undefined' ? unsafeWindow.logboek : window.logboek);
    if (lb?.resultaat) lb.resultaat(id, status);
    else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(id, status);
    else console.info('[logboek]', id, status);
  }
  function colorRow(row, hex, status){
    row.querySelectorAll('td').forEach(td => td.style.background = hex);
    if (status) row.dataset.status = status;
  }

  /** =========================
   *  Main
   *  ========================= */
  async function runSugarCandy(btn){
    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      console.error('[SugarCandy] StockKit niet geladen — afgebroken.');
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }
    const progress = StockKit.makeProgress(btn);

    try{
      const tables = Array.from(document.querySelectorAll('#output table'));
      if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

      progress.start(tables.length);

      let totalChanges = 0;
      let idx = 0;

      for (const table of tables){
        idx++;

        const headerText = table.querySelector('thead th[colspan]')?.textContent || '';
        const m = (headerText||'').match(/(\d{2}-\d{4,}-\d{2})/);
        const suffix = m ? m[1].split('-').pop() : null;

        let changes = 0;

        if (!suffix){
          console.warn('[Sugar] Geen kleurcode in header:', headerText);
          logResult(headerText.trim(), 'afwijking'); markTick(table);
          progress.setDone(idx);
          continue;
        }
        const colorName = COLOR_CODE_MAP[suffix];
        if (!colorName){
          console.warn('[Sugar] Geen mapping voor suffix', suffix, '→ vul COLOR_CODE_MAP aan.');
          logResult(headerText.trim(), 'afwijking'); markTick(table);
          progress.setDone(idx);
          continue;
        }

        const productUrl = pickProductUrl(headerText);

        // 1) Basispagina
        const base = await loadBasePage(productUrl);
        if (!base || !base.doc){
          console.warn('[Sugar] Basispagina niet geladen', productUrl);
          logResult(headerText.trim(), 'afwijking'); markTick(table);
          progress.setDone(idx);
          continue;
        }

        // 2) Kleur value
        const colorInfo = findColorValueByNameFromDoc(base.doc, colorName);
        if (!colorInfo){
          console.warn('[Sugar] Kleur', colorName, 'niet gevonden op', productUrl);
          logResult(headerText.trim(), 'afwijking'); markTick(table);
          progress.setDone(idx);
          continue;
        }

        // 3) Cup-combinaties (0..N)
        const cupOpts = getCupOptionsFromDoc(base.doc);
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

        const results = await Promise.all(fetches);
        const maps = results.map(r => r.map);
        const remoteMerged = mergeMapsMax(maps);
        if (remoteMerged.size === 0){
          console.warn('[Sugar] Geen maten gevonden (kleur:', colorName, ', cups:', cupOpts.map(o=>o.text).join(', '), ')');
          logResult(headerText.trim(), 'afwijking'); markTick(table);
          progress.setDone(idx);
          continue;
        }

        // 4) Vergelijk en kleur
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row=>{
          const tds = row.querySelectorAll('td');
          if (tds.length<3) return;
          const size  = (tds[0].textContent||'').trim();
          const local = parseInt((tds[1].textContent||'0').trim(),10)||0;

          let remote = remoteMerged.get(size);
          if (!Number.isFinite(remote)) remote = 0;

          if (local===0 && remote>0){ colorRow(row, C.GREEN, 'add'); changes++; }
          else if (local>0 && remote===0){ colorRow(row, C.RED, 'remove'); changes++; }
        });

        totalChanges += changes;

        const statusStr = changes > 0 ? 'afwijking' : 'ok';
        logResult(headerText.trim(), statusStr);
        markTick(table);

        progress.setDone(idx);
      }

      // Laat uitsluitend StockKit de knoptekst zetten; geen extra gedrag hier.
      progress.success(totalChanges);
    } catch (e){
      console.error('[Sugar] Fout', e);
      progress.fail(); // StockKit bepaalt de fouttekst/staat
      alert('Sugar Candy check: er ging iets mis. Zie console.');
    }
  }

  /** =========================
   *  UI (knop injectie; geen runtime-knopgedrag)
   *  ========================= */
  function addButton(){
    if (document.getElementById('sugar-btn')) return;

    // Optioneel: centrale CSS (alleen styling, belemmert StockKit niet)
    if (!document.getElementById('stockkit-css')) {
      const link = document.createElement('link');
      link.id = 'stockkit-css';
      link.rel = 'stylesheet';
      link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.id = 'sugar-btn';
    btn.className = 'sk-btn';
    Object.assign(btn.style, {
      position: 'fixed',
      zIndex: '9999',
      display: 'none'
    });
    btn.textContent = '🔍 Check Stock Sugar Candy';
    btn.addEventListener('click', ()=>runSugarCandy(btn));
    document.body.appendChild(btn);

    const $ = s=>document.querySelector(s);
    function outputHasTables(){ const out=$('#output'); return !!out && !!out.querySelector('table'); }
    function isSupplierSelected(){
      const el=$('#leverancier-keuze'); if(!el) return true;
      const v=(el.value||'').trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');
      return v==='sugar-candy' || v==='sugarcandy' || v==='sugar';
    }
    function toggle(){ btn.style.display=(isSupplierSelected()&&outputHasTables())?'block':'none'; }

    const out=$('#output'); if(out) new MutationObserver(toggle).observe(out,{childList:true,subtree:true});
    const select=$('#leverancier-keuze'); if(select) select.addEventListener('change', toggle);
    toggle();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
