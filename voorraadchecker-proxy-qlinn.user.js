// ==UserScript==
// @name         Voorraadchecker Proxy - Q-LINN
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      q-linn.com
// @connect      www.q-linn.com
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-qlinn.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-qlinn.user.js
// ==/UserScript==

(() => {
  'use strict';

  /* ---------------- CONFIG ---------------- */
  const CONFIG = {
    LOG: { status:'both', perMaat:'console', debug:false },
    TIMEOUT_MS: 8000,
    TABLE_CONCURRENCY: 4,      // parallel producten
    ENABLE_PER_TERM_FALLBACK: false, // traag → standaard uit
    TREAT_LT_AS_ZERO: false,   // zet true als je <LT_THRESHOLD als 0 wilt behandelen
    LT_THRESHOLD: 5,
    CACHE_TTL_MS: 10 * 60 * 1000
  };

  const BASE = 'https://www.q-linn.com';
  const SUPPLIER = 'Q-LINN';
  const CONTENT = 'application/x-www-form-urlencoded; charset=UTF-8';

  /* --------- PID → product URL --------- */
  const PID_MAP = {
    'QL-SO01': 'https://www.q-linn.com/sportstring-kopen/thong-olive/',
    'QL-SO02': 'https://www.q-linn.com/sportstring-kopen/thong-black/',
    'QL-SO03': 'https://www.q-linn.com/sportstring-kopen/thong-deep-red/',
    'QL-SO04': 'https://www.q-linn.com/sportstring-kopen/thong-violet-ice/',
    'QL-SO05': 'https://www.q-linn.com/sportstring-kopen/ladies-boxer-olive/',
    'QL-SO06': 'https://www.q-linn.com/sportstring-kopen/ladies-boxer-black/',
    'QL-SO07': 'https://www.q-linn.com/sportondergoed-dames/ladies-sport-boxershort-violet-ice/',
    'QL-SO08': 'https://www.q-linn.com/sportstring-kopen/ladies-boxer-deep-red/',
    'QAMS/STE': 'https://www.q-linn.com/omtrek-65/amsterdam-sport-bh-steel/',
    'QAMS/LBL': 'https://www.q-linn.com/blauw/amsterdam-sport-bh-light-blue/',
    'QAMS/VIO': 'https://www.q-linn.com/huidskleur/amsterdam-sport-bh-violet-ice/',
    'QCAN/BLACK': 'https://www.q-linn.com/sport-bh/cannes-high-impact-sportbeha-black/',
    'QCAN/RED': 'https://www.q-linn.com/postoperatieve-bh/cannes-high-impact-sportbeha-deep-red/',
    'QBAR/OLIVE': 'https://www.q-linn.com/sport-bh/barcelona-hi-sport-bh-olive/',
    'QBAR/VIO': 'https://www.q-linn.com/huidskleur/barcelona-hi-sport-bh-violet-ice/',
    'QBAR/ANT': 'https://www.q-linn.com/zwart/barcelona-hi-sport-bh-antraciet/',
    'QABOD/ANT': 'https://www.q-linn.com/sportlegging/sportlegging-antraciet/',
    'QTHI/ANT': 'https://www.q-linn.com/sportlegging/sportlegging-antraciet/',
  };

  const ALLOWED_SUPPLIERS = new Set(['q-linn']);

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const norm = (s='')=>String(s).trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');

  /* ---------------- Logger ---------------- */
  const Logger = {
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    _on(mode,kind){ const m=(CONFIG.LOG[kind]||'off').toLowerCase(); return m===mode || m==='both'; },
    status(id,txt){
      const sid=String(id);
      if (this._on('console','status')) console.info(`[Q-LINN][${sid}] status: ${txt}`);
      const lb=this.lb(); if (this._on('logboek','status') && lb && typeof lb.resultaat==='function') lb.resultaat(sid, txt);
    },
    perMaat(id,report){
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[Q-LINN][${id}] maatvergelijking`);
      try { console.table(report.map(r=>({ maat:r.maat, local:r.local, remote:r.sup, actie:r.actie }))); }
      finally { console.groupEnd(); }
    },
    debug(...a){ if(CONFIG.LOG.debug) console.info('[Q-LINN][debug]', ...a); }
  };

  /* ---------------- Net ---------------- */
  function gmGET(url, accept='text/html'){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET', url, withCredentials:false, timeout:CONFIG.TIMEOUT_MS,
        headers:{ 'Accept': accept },
        onload:r => (r.status>=200&&r.status<300) ? resolve(r.responseText||'') : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject, ontimeout:()=>reject(new Error(`timeout @ ${url}`))
      });
    });
  }
  function gmPOST(url, data, referer){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'POST', url, withCredentials:false, timeout:CONFIG.TIMEOUT_MS,
        data: (data instanceof URLSearchParams) ? data.toString() : String(data||''),
        headers:{ 'Content-Type': CONTENT, 'Accept': 'application/json,*/*;q=0.8', ...(referer?{Referer:referer}:{}) },
        onload:r => (r.status>=200&&r.status<300) ? resolve(r.responseText||'') : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror:reject, ontimeout:()=>reject(new Error(`timeout @ ${url}`))
      });
    });
  }

  /* ------------- Cache (qty map per URL) ------------- */
  const Cache = {
    get(url){
      try{
        const raw = sessionStorage.getItem(`qlinn:qtymap:${url}`); if (!raw) return null;
        const o = JSON.parse(raw); if (!o || (Date.now()-o.t) > CONFIG.CACHE_TTL_MS) return null;
        return new Map(o.v);
      }catch{ return null; }
    },
    set(url, map){
      try{
        sessionStorage.setItem(`qlinn:qtymap:${url}`, JSON.stringify({ t:Date.now(), v:Array.from(map.entries()) }));
      }catch{}
    }
  };

  /* ------------- URL / header resolver ------------- */
  function resolveProductFromTable(table){
    const header = table.querySelector('thead th[colspan], thead th');
    const text = header ? (header.textContent || '') : '';
    const pidMatch = text.match(/[A-Z0-9/.-]{4,}/);
    const pid = pidMatch ? pidMatch[0] : null;
    const url = pid && PID_MAP[pid] ? PID_MAP[pid] : (PID_MAP['QAMS/LBL'] && /amsterdam.*light\s*blue/i.test(text) ? PID_MAP['QAMS/LBL'] : null);
    return { label: text.trim(), url };
  }

  /* ------------- Parsers ------------- */
function parseIvpaSet(html){
  const doc = new DOMParser().parseFromString(html,'text/html');
  // Pak ALLE ivpa size-achtige attributen (bh-maat, maat, size)
  const blocks = Array.from(doc.querySelectorAll('.ivpa-opt.ivpa_attribute'))
    .filter(b => {
      const a = (b.getAttribute('data-attribute')||'').toLowerCase();
      return /bh.?maat|bh-?maat|^pa_maat$|size/.test(a);
    });
  if (!blocks.length) return null;

  const set = new Set();
  for (const blk of blocks){
    const terms = blk.querySelectorAll('.ivpa-terms .ivpa_term');
    terms.forEach(t => {
      const raw = (t.getAttribute('data-term') || t.textContent || '').trim();
      if (!raw) return;
      // Normaliseer: BH (70E → 70e), anders XS/S/M/.. → lower
      let key;
      const up = raw.toUpperCase();
      const m = up.match(/^(\d{2,3})\s*([A-Z]{1,2})$/) || up.match(/^(\d{2,3})([A-Z]{1,2})$/);
      if (m) key = `${m[1]}${m[2]}`.toLowerCase(); else key = raw.replace(/\s+/g,'').toLowerCase();

      const cls = t.className || '';
      if (/\bivpa_instock\b/i.test(cls)) set.add(key);
      if (/\bivpa_outofstock\b/i.test(cls)) set.delete(key);
    });
  }
  return set.size ? set : null;
}


function scrapeInlineVariations(html){
  const doc = new DOMParser().parseFromString(html,'text/html');

  // 1) Standaard Woo: data-product_variations op het formulier
  const form = doc.querySelector('form.variations_form');
  if (form){
    const dpv = form.getAttribute('data-product_variations');
    if (dpv && dpv !== 'false'){
      try{
        const arr = JSON.parse(dpv);
        if (Array.isArray(arr) && arr.length) return arr;
      }catch{}
    }
  }

  // 2) IVPA plugin: data-variations op .ivpa-register (HTML-escaped JSON)
  const ivpaReg = doc.querySelector('.ivpa-register[data-variations]');
  if (ivpaReg){
    try{
      let s = ivpaReg.getAttribute('data-variations') || '';
      // decode HTML entities minimaal
      s = s.replace(/&quot;/g,'"').replace(/&amp;/g,'&');
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length){
        // Vorm ze gelijk aan Woo-variaties
        return arr.map(v => ({
          variation_id: v.variation_id,
          attributes: v.attributes || {},
          is_in_stock: typeof v.is_in_stock === 'boolean' ? v.is_in_stock : null,
          availability_html: v.availability_html || '',
          max_qty: (typeof v.stock === 'number') ? v.stock : null
        }));
      }
    }catch{}
  }
  return null;
}


  function parseAvailabilityObj(v){
    const html = String((v && v.availability_html) || '');
    let qty = null, inStock = null;
    if (typeof v.is_in_stock === 'boolean') inStock = v.is_in_stock;
    if (html){
      const d = new DOMParser().parseFromString(html,'text/html');
      const t = (d.body && d.body.textContent) ? d.body.textContent : '';
      const m = t.match(/(\d+)/); if (m) qty = parseInt(m[1],10);
      if (inStock === null) inStock = /class=["']stock\s+in-stock/.test(html);
    }
    if (qty === null && typeof v.max_qty === 'number') qty = v.max_qty;
    if (qty === null && inStock === true) qty = 1;
    if (qty === null && inStock === false) qty = 0;
    return { qty, inStock };
  }

  function pickSizeTermKey(variation){
    const attrs = variation && variation.attributes ? variation.attributes : {};
    let key = null;
    for (const k in attrs){
      if (/bh.?maat|bh-?maat|maat|size/i.test(k)) { key = k; break; }
    }
    if (!key){ const ks = Object.keys(attrs); key = ks.length ? ks[0] : null; }
    if (!key) return null;
    const val = (attrs[key] || '').toString().toLowerCase(); // '70e'
    return val;
  }

  function ajaxUrlFromHtml(html){
    const m = html.match(/wc_add_to_cart_variation_params\s*=\s*{[^}]*"wc_ajax_url"\s*:\s*"([^"]+)"/);
    return m ? m[1].replace(/\\\//g,'/') : `${BASE}/?wc-ajax=%%endpoint%%`;
  }
  const buildAjaxUrl = (base, ep) => (base.includes('%%endpoint%%') ? base.replace('%%endpoint%%', ep) : `${BASE}/?wc-ajax=${ep}`);

  /* ------------- Qty map builders ------------- */
  async function buildQtyMapFast(productUrl){
    // cache hit?
    const cached = Cache.get(productUrl);
    if (cached) return cached;

    const html = await gmGET(productUrl);

    // 0) supersnel: IVPA-classes → boolean beschikbaarheid
    const ivpa = parseIvpaSet(html);
    if (ivpa){
      const map = new Map();
      ivpa.forEach(k => map.set(k, 1)); // 1 = “beschikbaar”; geen aantallen nodig voor regels
      Cache.set(productUrl, map);
      return map;
    }

    // 1) inline data-product_variations
    const inline = scrapeInlineVariations(html);
    if (inline){
      const map = new Map();
      for (const v of inline){
        const key = pickSizeTermKey(v); if (!key) continue;
        const { qty, inStock } = parseAvailabilityObj(v);
        const val = Number.isFinite(qty) ? qty : (inStock ? 1 : 0);
        map.set(key, Math.max(map.get(key)||0, val));
      }
      if (map.size){
        Cache.set(productUrl, map);
        return map;
      }
    }

    // 2) bulk get_variations (1 call)
    const ajaxBase = ajaxUrlFromHtml(html);
    const productId = (html.match(/postid-(\d+)/)||[])[1] ||
                      ($('form.variations_form input[name="product_id"]', new DOMParser().parseFromString(html,'text/html'))?.value) || '';
    const nonce =
      (html.match(/"wc_ajax_nonce"\s*:\s*"([a-f0-9]+)"/i)||[])[1] ||
      (html.match(/"ajax_nonce"\s*:\s*"([a-f0-9]+)"/i)||[])[1] || null;

    if (productId){
      const p = new URLSearchParams(); p.set('product_id', productId); if (nonce) p.set('security', nonce);
      try{
        const txt = await gmPOST(buildAjaxUrl(ajaxBase, 'get_variations'), p, productUrl);
        if (txt && txt !== '0'){
          const arr = JSON.parse(txt);
          if (Array.isArray(arr) && arr.length){
            const map = new Map();
            for (const v of arr){
              const key = pickSizeTermKey(v); if (!key) continue;
              const { qty, inStock } = parseAvailabilityObj(v);
              const val = Number.isFinite(qty) ? qty : (inStock ? 1 : 0);
              map.set(key, Math.max(map.get(key)||0, val));
            }
            if (map.size){
              Cache.set(productUrl, map);
              return map;
            }
          }
        }
      }catch(e){ /* ignore → evt. fallback */ }
    }

    // 3) optionele per-term fallback (traag) — standaard UIT
    if (CONFIG.ENABLE_PER_TERM_FALLBACK){
      const terms = collectTermsFromPage(html);
      const map = await perTermFallback(productId, nonce, productUrl, ajaxBase, terms);
      if (map.size){ Cache.set(productUrl, map); return map; }
    }

    return new Map(); // nothing found
  }

  function collectTermsFromPage(html){
    // haal terms uit IVPA of inline variations; anders leeg
    const out = new Set();
    const set = parseIvpaSet(html); if (set) set.forEach(k=>out.add(k));
    const inline = scrapeInlineVariations(html);
    if (inline) for (const v of inline){ const k = pickSizeTermKey(v); if (k) out.add(k); }
    return Array.from(out);
  }

  async function perTermFallback(productId, nonce, referer, ajaxBase, terms){
    const map = new Map();
    const attrName = 'attribute_pa_bh-maat';
    async function one(term){
      const p = new URLSearchParams();
      p.set('product_id', productId); p.set(`attributes[${attrName}]`, term); if (nonce) p.set('security', nonce);
      try{
        const txt = await gmPOST(buildAjaxUrl(ajaxBase,'get_variation'), p, referer);
        const json = JSON.parse(txt);
        const { qty, inStock } = parseAvailabilityObj(json);
        map.set(term, Number.isFinite(qty) ? qty : (inStock ? 1 : 0));
      }catch{ map.set(term, -1); }
    }
    // kleine parallelisatie
    const queue = terms.slice();
    const workers = Array.from({length:3}, async ()=>{ while(queue.length){ await one(queue.shift()); } });
    await Promise.all(workers);
    return map;
  }

  /* ------------- Vergelijk & markeer ------------- */
  function explodeCompositeTerm(label){
    const t = String(label||'').toUpperCase();
    const band = (t.match(/^(\d{2,3})/)||[])[1];
    const cups = t.match(/[A-Z]{1,2}/g) || [];
    return band && cups.length ? cups.map(c => `${band}${c.toLowerCase()}`) : [t.replace(/\s+/g,'').toLowerCase()];
  }

  function applyRulesAndMark(table, qtyByTerm){
    const rows = table.querySelectorAll('tbody tr'); const report=[];
    for (const row of rows){
      const sizeCell=row.children[0], localCell=row.children[1];
      const maat=(row.dataset.size || (sizeCell?sizeCell.textContent:'') || '').trim();
      const local=parseInt(((localCell?localCell.textContent:'')||'0').trim(),10)||0;

      // reset
      row.style.background=''; row.style.transition='background-color .25s';
      row.title=''; row.classList.remove('status-green','status-red'); delete row.dataset.status;

      // bepaal beste remote qty over samengestelde cups
      const terms = explodeCompositeTerm(maat);
      let best = -1;
      for (const t of terms){
        const q = qtyByTerm.get(t);
        if (typeof q === 'number' && q > best) best = q;
      }

      const eff = (CONFIG.TREAT_LT_AS_ZERO && best >= 0 && best < CONFIG.LT_THRESHOLD) ? 0 : best;

      let actie='negeren';
      if (local===0 && eff>0){
        row.style.background='#d4edda'; row.title=`Bijboeken 2 (leverancier: ${best<0?'?':best})`;
        row.dataset.status='add'; row.classList.add('status-green'); actie='bijboeken_2';
      } else if (local>0 && (eff===0 || best===0)){
        row.style.background='#f8d7da'; row.title=`Uitboeken (leverancier: ${best<0?'0/laag':best})`;
        row.dataset.status='remove'; row.classList.add('status-red'); actie='uitboeken';
      }
      report.push({ maat, local, sup: (best<0?'?':best), actie });
    }
    return report;
  }

  const badgeStatus = (report, hasRemote) => !hasRemote ? 'niet-gevonden'
                                : report.some(r => r.actie==='uitboeken' || r.actie==='bijboeken_2') ? 'afwijking' : 'ok';

  /* ------------- Main (parallel per tabel) ------------- */
  async function processTable(table, progress, idx){
    const { url, label } = resolveProductFromTable(table);
    const anchorId = table.id || url || label || `table-${idx}`;

    if (!url){
      Logger.status(anchorId, 'niet-gevonden'); Logger.perMaat(anchorId, []); progress.setDone(idx); return 0;
    }

    try{
      const qtyByTerm = await buildQtyMapFast(url);
      if (!qtyByTerm || qtyByTerm.size===0){
        Logger.status(anchorId, 'niet-gevonden'); Logger.perMaat(anchorId, []); progress.setDone(idx); return 0;
      }

      const report = applyRulesAndMark(table, qtyByTerm);
      const diffs = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken_2').length;

      Logger.status(anchorId, badgeStatus(report, qtyByTerm.size>0));
      Logger.perMaat(anchorId, report);
      progress.setDone(idx);
      return diffs;
    } catch (e){
      console.error('[Q-LINN] fout:', e);
      Logger.status(anchorId, 'afwijking'); progress.setDone(idx);
      return 0;
    }
  }

  async function run(btn){
    if (typeof StockKit==='undefined' || !StockKit.makeProgress){
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    // worker-pool voor tabellen
    let idx = 0, totalMutations = 0;
    async function worker(){
      while(idx < tables.length){
        const myIdx = ++idx;
        const t = tables[myIdx-1];
        totalMutations += await processTable(t, progress, myIdx);
      }
    }
    const N = Math.max(1, Math.min(CONFIG.TABLE_CONCURRENCY, tables.length));
    await Promise.all(Array.from({length:N}, worker));

    progress.success(totalMutations);
  }

  /* ------------- UI ------------- */
  function isAllowedSupplierSelected(){
    const dd = document.getElementById('leverancier-keuze');
    if (!dd) return true;
    const opt = dd.options[dd.selectedIndex] || null;
    const byValue = norm(dd.value || '');
    const byText  = norm(opt ? (opt.text || '') : '');
    return ALLOWED_SUPPLIERS.has(byValue.replace(/\*+$/,'')) || ALLOWED_SUPPLIERS.has(byText.replace(/\*+$/,''))
        || /^q[\- ]?linn/.test(byValue) || /^q[\- ]?linn/.test(byText);
  }

  function addButton(){
    if (document.getElementById('check-qlinn-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link = document.createElement('link'); link.id='stockkit-css'; link.rel='stylesheet';
      link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.id = 'check-qlinn-btn';
    btn.className = 'sk-btn';
    btn.textContent = '🔍 Check stock';
    Object.assign(btn.style, { position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click', () => run(btn));
    document.body.appendChild(btn);

    const outputHasTables = () => !!document.querySelector('#output table');
    function toggle(){ btn.style.display = (outputHasTables() && isAllowedSupplierSelected()) ? 'block' : 'none'; }

    const out = document.getElementById('output');
    if (out) new MutationObserver(toggle).observe(out, { childList:true, subtree:true });

    const select = document.getElementById('leverancier-keuze');
    if (select) select.addEventListener('change', toggle);

    const upload = document.getElementById('upload-container');
    if (upload) new MutationObserver(toggle).observe(upload, { attributes:true, attributeFilter:['style','class'] });

    toggle();
  }
  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
