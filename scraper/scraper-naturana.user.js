// ==UserScript==
// @name         EAN Scraper | Naturana
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.30
// @description  Haal Naturana stock via bridge + EAN via Google Sheet en vul #tabs-3 in (DDO admin). Hotkey: Ctrl+Shift+S (met autosave).
// @match        https://naturana-online.de/*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @run-at       document-start
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-naturana.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ============ Shared ============

  const MODELVIEW_URL   = 'https://naturana-online.de/naturana/ModellView';
  const ARTICLEVIEW_URL = 'https://naturana-online.de/naturana/ArticleView';

  const TIMEOUT_MS   = 20000;
  const KEEPALIVE_MS = 300000; // 5 min

  const HEARTBEAT_KEY = 'naturana_bridge_heartbeat';
  const HB_INTERVAL   = 2500;

  const BRIDGE_CONCURRENCY = 4;

  const CHANNELS = [
    { req:'naturana_bridge_adv_req',  resp:'naturana_bridge_adv_resp',  ping:'naturana_bridge_adv_ping',  pong:'naturana_bridge_adv_pong'  },
    { req:'naturana_bridge_v2_req',   resp:'naturana_bridge_v2_resp',   ping:'naturana_bridge_v2_ping',   pong:'naturana_bridge_v2_pong'   },
    { req:'naturana_bridge_v1_req',   resp:'naturana_bridge_v1_resp',   ping:'naturana_bridge_v1_ping',   pong:'naturana_bridge_v1_pong'   },
  ];

  const ON_NATURANA = location.hostname.includes('naturana-online.de');
  const ON_ADMIN    = location.hostname.includes('dutchdesignersoutlet.com');

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const uid  = ()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
  const forEachChannel=(fn)=>CHANNELS.forEach(fn);
  const norm=(s='')=>String(s).toLowerCase().trim().replace(/\s+/g,' ');

  const parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html');
  const isLoginPage=(html)=>{
    const t=String(html||'').toLowerCase();
    return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t);
  };

  // ============ Bridge (Naturana-tab) ============

  if (ON_NATURANA){
    setInterval(()=>{ GM_setValue(HEARTBEAT_KEY, Date.now()); }, HB_INTERVAL);

    forEachChannel(ch=>{
      GM_addValueChangeListener(ch.ping, (_n,_o,msg)=>{
        if (msg==='ping') GM_setValue(ch.pong, 'pong:'+Date.now());
      });
    });

    const q = [];
    let active = 0;

    async function handleOne(req){
      try{
        const ctrl=new AbortController();
        const to=setTimeout(()=>ctrl.abort(), Math.max(10000, req.timeout||TIMEOUT_MS));
        const res=await fetch(req.url, {
          method:req.method||'GET',
          headers:req.headers||{},
          credentials:'include',
          body:req.body||null,
          signal:ctrl.signal
        });
        const text=await res.text();
        clearTimeout(to);
        GM_setValue(req._resp, { id:req.id, ok:true, status:res.status, text });
      }catch(e){
        GM_setValue(req._resp, { id:req.id, ok:false, error:String(e) });
      }
    }

    function pump(){
      while (active < BRIDGE_CONCURRENCY && q.length){
        const req = q.shift();
        active++;
        handleOne(req).finally(()=>{ active--; pump(); });
      }
    }

    forEachChannel(ch=>{
      GM_addValueChangeListener(ch.req, (_n,_o,req)=>{
        if(!req || !req.id || !req.url) return;
        q.push({ ...req, _resp: ch.resp });
        pump();
      });
    });

    if (document.readyState!=='loading') {
      console.info('[Naturana Bridge] actief op', location.href);
    } else {
      document.addEventListener('DOMContentLoaded', ()=>console.info('[Naturana Bridge] actief op', location.href));
    }
    return;
  }

  // ============ Client (DDO admin) ============

  if (!ON_ADMIN) return;

  // ---- Bridge helpers (admin) ----

  function bridgeSend({url, method='GET', headers={}, body=null, timeout=TIMEOUT_MS}){
    return new Promise((resolve,reject)=>{
      const id=uid(), handles=[], off=()=>handles.forEach(h=>{ try{ GM_removeValueChangeListener(h); }catch{}; });
      let settled=false;
      forEachChannel(ch=>{
        const h=GM_addValueChangeListener(ch.resp, (_n,_o,msg)=>{
          if (settled || !msg || msg.id!==id) return;
          settled=true; off();
          msg.ok ? resolve(msg.text) : reject(new Error(msg.error||'bridge error'));
        });
        handles.push(h);
      });
      forEachChannel(ch=>{ GM_setValue(ch.req, { id, url, method, headers, body, timeout }); });
      setTimeout(()=>{ if(!settled){ off(); reject(new Error('bridge timeout')); } }, timeout+1500);
    });
  }

  const httpGET  =(url)=>bridgeSend({url});
  const httpPOST =(url,data)=>{
    const body=(typeof data==='string')?data:new URLSearchParams(data).toString();
    return bridgeSend({
      url,
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
      body
    });
  };

  const bridgeIsOnlineByHeartbeat=(maxAge=5000)=>{
    try{
      const t=GM_getValue(HEARTBEAT_KEY,0);
      return t && (Date.now()-t)<maxAge;
    }catch{
      return false;
    }
  };

  function pickViewState(doc){
    const form=doc.querySelector('form'); if(!form) return null;
    const get=(n)=>form.querySelector(`input[name="${n}"]`)?.value ?? '';
    return {
      __VIEWSTATE:get('__VIEWSTATE'),
      __VIEWSTATEGENERATOR:get('__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION:get('__EVENTVALIDATION')
    };
  }

  function findModelItem(doc, pidColor){
    const raw=String(pidColor||'').trim();
    const m=raw.match(/^(.+?)-(.*)$/);
    const pid=(m?m[1]:raw).trim().toUpperCase();
    const color=(m?m[2]:'').trim().toUpperCase();
    const links=Array.from(doc.querySelectorAll('a[href*="__doPostBack"]'));
    let best=null, bestScore=-1;
    for(const a of links){
      const href=a.getAttribute('href')||''; const mm=href.match(/__doPostBack\('([^']+)'/); if(!mm) continue;
      const eventTarget=mm[1];
      const cont=a.closest('tr,div,li')||a.parentElement;
      const txt=((a.textContent||'')+' '+(cont?.textContent||'')).toUpperCase().replace(/\s+/g,' ');
      let s=0; if(pid && txt.includes(pid)) s+=4; if(color && color.length>=2 && txt.includes(color)) s+=2;
      if(/NATURANA|ART\.|ARTICLE|MODELL|MODEL/i.test(txt)) s+=0.5;
      if(s>bestScore){ best={eventTarget}; bestScore=s; }
    }
    return (best && bestScore>=3) ? best : null;
  }

  // ---- Size helpers + stock mapping ----

  // Remote → Local (zoals opgegeven)
  const NATURANA_REMOTE_TO_LOCAL = {
    '65':'S',
    '70':'M',
    '75':'L',
    '80':'XL',
    '85':'XXL',
    '90':'XXXL',
    '95':'4XL',
    '100':'5XL',
    '36':'XS',
    '38':'S',
    '40':'M',
    '42':'L',
    '44':'XL',
    '46':'XXL',
    '48':'3XL', // bij twijfel: 3XL; evt. omzetten naar 3L in SIZE_ALIAS
    '50':'4XL',
  };

const SIZE_ALIAS = {
  '2XL':'XXL','XXL':'2XL',
  '3XL':'XXXL','XXXL':'3XL',
  '4XL':'XXXXL','XXXXL':'4XL',
  'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL',
  // extra voor mogelijke 3L-variant
  '3L':'3XL'
};


  function normalizeLocalSize(s){
    return String(s||'').trim().toUpperCase().replace(/\s+/g,'');
  }

  function aliasCandidates(label){
    const raw=String(label||'').trim().toUpperCase();
    const ns =raw.replace(/\s+/g,'');
    const set=new Set([raw,ns]);

    if(SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if(SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);

    if(raw.includes('/')) raw.split('/').map(s=>s.trim()).forEach(x=>{
      set.add(x);
      set.add(x.replace(/\s+/g,''));
      if(SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
    });

    // Remote numeriek → lokale maat toevoegen
    const numericRaw = ns;
    if (/^\d+$/.test(numericRaw) && NATURANA_REMOTE_TO_LOCAL[numericRaw]){
      const loc = NATURANA_REMOTE_TO_LOCAL[numericRaw];
      set.add(loc);
      set.add(loc.replace(/\s+/g,''));
      if (SIZE_ALIAS[loc]) set.add(SIZE_ALIAS[loc]);
    }

    return Array.from(set);
  }

  // mapping: remote → local stock
  function mapNaturanaStockLevel(remoteQty){
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;  // <2
    if (n === 3) return 2; // =3
    if (n === 4) return 3; // =4
    if (n > 4)  return 5;  // >4
    return 0;
  }

  // ---- ArticleView → Map(size → remote qty) ----

  function buildStockMapFromArticleView(html){
    const map = new Map();
    const doc = parseHTML(html);

    const t=(doc.body?.textContent||'').toLowerCase();
    if(t.includes('login') && (t.includes('password')||t.includes('passwort'))) return map;

    const inputs=doc.querySelectorAll('.color-size-grid input.gridAmount');
    inputs.forEach(inp=>{
      const wrap=inp.closest('.p-2.text-center, [id*="_divOID_"]')||inp.parentElement; if(!wrap) return;
      const sizeEl=wrap.querySelector('.gridSize');
      if(!sizeEl) return;

      const size=sizeEl.textContent.trim().toUpperCase();
      let stockNum=parseInt(inp.getAttribute('max') || '0',10);
      if(!Number.isFinite(stockNum) || stockNum<0) stockNum=0;

      for(const key of aliasCandidates(size)){
        const normKey = key.replace(/\s+/g,'');
        const prev = map.get(normKey);
        if(!prev || prev < stockNum){
          map.set(normKey, stockNum);
        }
      }
    });

    // Fallback: regex (zoals in VCP)
    if (map.size === 0){
      let m;
      const sizeRe   = /class="gridSize"[^>]*>([^<]+)/gi;
      const amountRe = /class="gridAmount"[^>]*max="(\d+)"/gi;
      const sz=[], av=[];
      while((m=sizeRe.exec(html))!==null)   sz.push(m[1].trim().toUpperCase());
      while((m=amountRe.exec(html))!==null) av.push(m[1].trim());
      const n=Math.min(sz.length,av.length);
      for(let i=0;i<n;i++){
        const s   = sz[i];
        const num = parseInt(av[i],10) || 0;
        for(const key of aliasCandidates(s)){
          const normKey = key.replace(/\s+/g,'');
          const prev = map.get(normKey);
          if(!prev || prev < num){
            map.set(normKey, num);
          }
        }
      }
    }

    console.log('[Naturana SS&E] stockMap keys:', Array.from(map.keys()));
    return map;
  }

  // ---- ArticleView ophalen via ModelView POSTBACK ----

  async function openArticleViewViaPostback_cached(pidColor, state){
    const ensureFreshMV = async ()=>{
      const mv = await httpGET(MODELVIEW_URL);
      if (isLoginPage(mv)) throw new Error('LOGIN_REQUIRED');
      const doc = parseHTML(mv);
      const vs  = pickViewState(doc);
      if(!vs || !vs.__VIEWSTATE) throw new Error('TARGET_NOT_FOUND');
      state.doc = doc;
      state.vs  = vs;
    };

    if (!state.doc || !state.vs) await ensureFreshMV();

    let item = findModelItem(state.doc, pidColor);
    if (!item) {
      await ensureFreshMV();
      item = findModelItem(state.doc, pidColor);
      if (!item) throw new Error('TARGET_NOT_FOUND');
    }

    const payload = {
      __EVENTTARGET: item.eventTarget,
      __EVENTARGUMENT: '',
      __VIEWSTATE: state.vs.__VIEWSTATE,
      __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR||'',
      __EVENTVALIDATION: state.vs.__EVENTVALIDATION||''
    };

    let resp = await httpPOST(MODELVIEW_URL, payload);
    if (isLoginPage(resp)) throw new Error('LOGIN_REQUIRED');

    if (!/gridSize|gridAmount|color-size-grid/i.test(resp)) {
      await ensureFreshMV();
      const item2 = findModelItem(state.doc, pidColor);
      if (!item2) throw new Error('TARGET_NOT_FOUND');
      const payload2 = {
        __EVENTTARGET: item2.eventTarget,
        __EVENTARGUMENT: '',
        __VIEWSTATE: state.vs.__VIEWSTATE,
        __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR||'',
        __EVENTVALIDATION: state.vs.__EVENTVALIDATION||''
      };
      resp = await httpPOST(MODELVIEW_URL, payload2);
    }

    return resp;
  }

  // ============ Google Sheet (EAN) ============

  const SHEET_ID  = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';
  const SHEET_GID = '0';

  const SHEET_CACHE_KEY    = `naturanaSheetCache:${SHEET_ID}:${SHEET_GID}`;
  const SHEET_AUTHUSER_KEY = 'naturanaSheetAuthUser';
  const SHEET_CACHE_TTL_MS = 60*60*1000; // 1 uur

  function getAuthuserCandidates(){
    const saved = localStorage.getItem(SHEET_AUTHUSER_KEY);
    const base = [0,1,2,3,4,5];
    if (saved !== null && !Number.isNaN(parseInt(saved,10))){
      const r = parseInt(saved,10);
      return [r, ...base.filter(x=>x!==r)];
    }
    return base;
  }

  function readSheetCache(){
    try{
      const j = JSON.parse(localStorage.getItem(SHEET_CACHE_KEY) || 'null');
      if (!j) return null;
      if (Date.now() - j.ts > SHEET_CACHE_TTL_MS) return null;
      return j;
    }catch{
      return null;
    }
  }

  function writeSheetCache(obj){
    try{
      localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(obj));
    }catch{}
  }

  function makeTsvUrl(authuser){
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=tsv&gid=${SHEET_GID}&authuser=${authuser}`;
  }

  function isLikelyHtml(s){
    return /^\s*<!doctype html/i.test(s) || /\b<html\b/i.test(s);
  }

  function parseTsv(tsv){
    const rows = tsv.split(/\r?\n/).map(line => line.split('\t'));
    return rows.filter(r => r.some(cell => cell && cell.trim() !== ''));
  }

  function gmGet(url, headers={}){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method:'GET',
        url,
        headers,
        anonymous:false,
        onload:res=>resolve(res),
        onerror:()=>reject(new Error('Network error')),
        ontimeout:()=>reject(new Error('Timeout')),
      });
    });
  }

  async function fetchSheetRaw({force=false}={}){
    const cache = readSheetCache();
    if (!force && cache){
      console.log('[Naturana SS&E] Sheet cache HIT', {authuser:cache.authuser});
      return {text:cache.text, authuser:cache.authuser, fromCache:true};
    }

    const candidates = getAuthuserCandidates();
    for (const au of candidates){
      const url = makeTsvUrl(au);
      console.log('[Naturana SS&E] Sheet try authuser', au, url);
      const res = await gmGet(url, {
        'Accept':'*/*',
        'Referer':`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`,
      });
      if (res.status>=200 && res.status<300 && res.responseText && !isLikelyHtml(res.responseText)){
        writeSheetCache({text:res.responseText, authuser:au, ts:Date.now()});
        localStorage.setItem(SHEET_AUTHUSER_KEY, String(au));
        console.log('[Naturana SS&E] Sheet OK via authuser', au);
        return {text:res.responseText, authuser:au, fromCache:false};
      }
    }

    if (cache){
      console.warn('[Naturana SS&E] Sheet netwerk faalde → gebruik verlopen cache');
      return {text:cache.text, authuser:cache.authuser, fromCache:true};
    }

    throw new Error('Sheets: geen toegang. Log in met juiste Google-account of publiceer tabblad.');
  }

  /**
   * EAN-map uit rows voor een bepaalde supplier_pid.
   *
   * Kolommen (0-based):
   *  A(0) = sup-deel 1
   *  B(1) = cup / maat-deel (bh)
   *  C(2) = sup-deel 2
   *  E(4) = bandmaat (bh)
   *  G(6) = maat broekje
   *  I(8) = EAN
   *
   * supId = A + "-" + C
   * maat:
   *   - als band+cup: E+B
   *   - anders: G
   * daarna evt. remote→local mapping en normaliseren
   */
function buildEanMapFromRows(rows, supplierPid){
  const eanMap = new Map();
  if (!rows.length) return eanMap;

  const wanted = String(supplierPid || '').trim().toUpperCase()
    .replace(/\s+/g,'')
    .replace(/-+/g,'-');

  for (let i=1;i<rows.length;i++){
    const r = rows[i]; if (!r) continue;
    const A = (r[0] || '').toString().trim(); // kolom A
    const B = (r[1] || '').toString().trim(); // kolom B
    const C = (r[2] || '').toString().trim(); // kolom C
    const E = (r[4] || '').toString().trim(); // kolom E
    const G = (r[6] || '').toString().trim(); // kolom G
    const I = (r[8] || '').toString().trim(); // kolom I (EAN)

    if (!A && !C) continue;
    if (!I) continue;

    const supIdRow = (A + '-' + C).toUpperCase()
      .replace(/\s+/g,'')
      .replace(/-+/g,'-');

    if (supIdRow !== wanted) continue;

    let maatLabel = '';

    const band = E.toUpperCase().replace(/\s+/g,'');
    const cup  = B.toUpperCase().replace(/\s+/g,'');

    const isBand = /^\d{2,3}$/.test(band);
    const isCup  = /^[A-Z]+$/.test(cup);

    if (band && cup && isBand && isCup){
      // BH: band + cup
      maatLabel = band + cup;
    } else {
      // Broekje: kolom G gebruiken
      maatLabel = G.toUpperCase();
    }

    if (!maatLabel) continue;

    // Remote broekmaat → lokale alpha als nodig
    const plain = maatLabel.replace(/\s+/g,'');
    if (/^\d+$/.test(plain) && NATURANA_REMOTE_TO_LOCAL[plain]){
      maatLabel = NATURANA_REMOTE_TO_LOCAL[plain];
    }

    const sizeKey = normalizeLocalSize(maatLabel);
    if (!sizeKey) continue;

    const ean = I.replace(/\D/g,'');
    if (!ean) continue;

    // Hoofdkey
    eanMap.set(sizeKey, ean);

    // Alias-key, zodat 3XL ↔ XXXL / 3L werkt
    const alias = SIZE_ALIAS[sizeKey];
    if (alias){
      const aliasKey = normalizeLocalSize(alias);
      eanMap.set(aliasKey, ean);
    }
  }

  console.log('[Naturana SS&E] EAN map size:', eanMap.size, 'sample:', [...eanMap.entries()].slice(0,10));
  return eanMap;
}


function applyEansToDdo(eanMap){
  const rows = document.querySelectorAll('#tabs-3 table.options tbody tr');
  let updated=0, missing=0;

  rows.forEach(row=>{
    const sizeInput = row.querySelector('td input.product_option_small');
    if (!sizeInput) return;
    const sizeRaw  = sizeInput.value || '';
    const sizeNorm = normalizeLocalSize(sizeRaw);
    if (!sizeNorm) return;

    const ean = eanMap.get(sizeNorm);
    if (!ean){
      missing++;
      return;
    }

    const eanInput = row.querySelector(
      'input[name^="options"][name$="[barcode]"], '+
      'input[name*="[ean]"], input[name*="ean"]'
    );
    if (!eanInput){
      missing++;
      return;
    }

    const newEan = String(ean);
    // Altijd overschrijven
    eanInput.value = newEan;
    eanInput.dispatchEvent(new Event('input',{bubbles:true}));
    updated++;
  });

  console.log('[Naturana SS&E] EAN resultaat:', {updated, missing});
  return {updated, missing};
}

  // ============ Admin UI / knop + hotkey ============

  const BTN_ID              = 'naturana-ssne-btn';
  const TABLE_SELECTOR      = '#tabs-3 table.options';
  const PID_SELECTOR        = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR= '#tabs-1 #select2-brand-container';

  const HOTKEY = { ctrl:true, shift:true, alt:false, key:'s' };

  const $ = (s,root=document)=>root.querySelector(s);

  function getBrandTitle(){
    const c = $(BRAND_TITLE_SELECTOR);
    const titleAttr = c?.getAttribute('title') || '';
    const text      = c?.textContent || '';
    const selectText =
      $('#tabs-1 select[name="brand"] option:checked')?.textContent || '';
    return (titleAttr || text || selectText || '').replace(/\u00A0/g,' ').trim();
  }

  function isNaturanaBrand(){
    const t = getBrandTitle().toLowerCase();
    return !!t && t.includes('naturana');
  }

  function hasTable(){
    return !!$(TABLE_SELECTOR);
  }

  function isTab3Active(){
    const activeByHeader = document.querySelector(
      '#tabs .ui-tabs-active a[href="#tabs-3"], '+
      '#tabs .active a[href="#tabs-3"], '+
      '#tabs li.current a[href="#tabs-3"]'
    );
    if (activeByHeader) return true;

    const panel = $('#tabs-3');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.height !== '0px'
    );
  }

  function setBtnState(opts = {}){
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    if (opts.text != null)    btn.textContent = opts.text;
    if (opts.bg != null)      btn.style.backgroundColor = opts.bg;
    if (opts.disabled != null)btn.disabled = !!opts.disabled;
    if (opts.opacity != null) btn.style.opacity = String(opts.opacity);
  }

  function updateButtonVisibility(btn){
    if (!btn) return;
    const okBrand   = isNaturanaBrand();
    const tableOkay = hasTable();
    const active    = isTab3Active();

    if (okBrand && active){
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }

    btn.disabled      = !tableOkay;
    btn.style.opacity = tableOkay ? '1' : '.55';

    if (!okBrand){
      btn.title = 'Selecteer een merk dat "Naturana" bevat op tab 1.';
    } else if (!active){
      btn.title = 'Ga naar tab Maten/Opties (#tabs-3).';
    } else if (!tableOkay){
      btn.title = 'Wachten tot #tabs-3 geladen is...';
    } else {
      btn.title = 'Haal Naturana stock + EAN op en vul #tabs-3.';
    }
  }

  function resetBtn(){
    setBtnState({
      text: '⛏️ SS&E | Naturana',
      bg:   '#007cba',
      disabled: false,
      opacity: '1'
    });
    const btn = document.getElementById(BTN_ID);
    if (btn) updateButtonVisibility(btn);
  }

  function ensureButton(){
    if (!document.body) return;
    let btn = document.getElementById(BTN_ID);
    if (!btn){
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '⛏️ SS&E | Naturana';
      btn.style.cssText = `
        position: fixed;
        right: 10px;
        top: 10px;
        z-index: 999999;
        padding: 10px 12px;
        background: #007cba;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);
      btn.addEventListener('click', ()=> onScrapeClick(false));
    }
    updateButtonVisibility(btn);
  }

  function clickUpdateProductButton(){
    const saveBtn =
      document.querySelector('input[type="submit"][name="edit"]') ||
      document.querySelector('button[name="edit"]');
    if (!saveBtn){
      console.warn('[Naturana SS&E] Update product button niet gevonden');
      return false;
    }
    console.log('[Naturana SS&E] Autosave: klik op "Update product".');
    saveBtn.click();
    return true;
  }

  // ---- Stock + EAN toepassen + console.table ----

function applyNaturanaToTable(stockMap, eanMap){
  const table = document.querySelector(TABLE_SELECTOR);
  if (!table) return 0;

  const rows = table.querySelectorAll('tbody tr');
  let matched = 0;
  const report = [];

  rows.forEach(row=>{
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;

    const sizeInput = cells[0].querySelector('input.product_option_small');
    const sizeRaw   = sizeInput ? sizeInput.value : '';
    const sizeNorm  = normalizeLocalSize(sizeRaw);

    const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');
    const eanInput   = row.querySelector(
      'input[name^="options"][name$="[barcode]"], '+
      'input[name*="[ean]"], input[name*="ean"]'
    );

    const localBefore = stockInput ? Number(stockInput.value || 0) : 0;

    const remoteQty   = sizeNorm ? (stockMap.get(sizeNorm) || 0) : 0;
    const mappedStock = remoteQty ? mapNaturanaStockLevel(remoteQty) : localBefore;
    const remoteEan   = sizeNorm ? (eanMap.get(sizeNorm) || '') : '';

    let changed = false;

    if (stockInput && remoteQty){
      const newStock = String(mappedStock);
      if (stockInput.value !== newStock){
        stockInput.value = newStock;
        stockInput.dispatchEvent(new Event('input', {bubbles:true}));
        changed = true;
      }
    }

    if (eanInput && remoteEan){
      const newEan = String(remoteEan);
      // Altijd zetten, ook als hij hetzelfde is
      eanInput.value = newEan;
      eanInput.dispatchEvent(new Event('input',{bubbles:true}));
      changed = true;
    }

    if (changed){
      matched++;
      const oldBg = row.style.backgroundColor;
      row.style.transition = 'background-color .4s';
      row.style.backgroundColor = '#d4edda';
      setTimeout(()=>{ row.style.backgroundColor = oldBg || ''; }, 1500);
    }

    report.push({
      size:   sizeRaw || sizeNorm || '(leeg)',
      local:  localBefore,
      remote: remoteQty || 0,
      mapped: remoteQty ? mappedStock : '(geen remote)',
      ean:    remoteEan || ''
    });
  });

  console.groupCollapsed('[Naturana SS&E] Overzicht per maat');
  console.table(report);
  console.groupEnd();

  console.log('[Naturana SS&E] totaal gewijzigde rijen:', matched);
  return matched;
}


  // ---- Hoofdactie ----

  async function onScrapeClick(autoSaveThisRun){
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    if (!isNaturanaBrand()){
      setBtnState({ text:'❌ Merk bevat geen "Naturana"', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!isTab3Active()){
      setBtnState({ text:'❌ Open tab Maten/Opties', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!bridgeIsOnlineByHeartbeat()){
      setBtnState({ text:'❌ Bridge offline', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
      alert('Bridge offline. Log in op Naturana in een ander tabblad met dit script actief en laat dat tabblad open.');
      return;
    }

    const supplierPid = $(PID_SELECTOR)?.value?.trim();
    if (!supplierPid){
      setBtnState({ text:'❌ Geen Supplier PID', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
      return;
    }

    setBtnState({
      text: '⏳ Naturana ArticleView laden...',
      bg: '#f1c40f',
      disabled: true,
      opacity: '.8'
    });

    try{
      // 1) ModelView / ArticleView ophalen
      const mvHtml = await httpGET(MODELVIEW_URL);
      if (isLoginPage(mvHtml)){
        throw new Error('LOGIN_REQUIRED');
      }
      const mvDoc  = parseHTML(mvHtml);
      const state  = { doc: mvDoc, vs: pickViewState(mvDoc) };

      const html = await openArticleViewViaPostback_cached(supplierPid, state);
      const stockMap = buildStockMapFromArticleView(html);

      if (!stockMap || stockMap.size === 0){
        setBtnState({ text:'❌ Geen maten/stock gevonden', bg:'#e06666' });
        setTimeout(resetBtn, 2500);
        return;
      }

      setBtnState({
        text: '⏳ Sheet (EAN) laden...',
        bg: '#6c757d',
        disabled: true,
        opacity: '.8'
      });

      // 2) Sheet ophalen & EAN-map bouwen
      const raw = await fetchSheetRaw({});
      const rows = parseTsv(raw.text);
      const eanMap = buildEanMapFromRows(rows, supplierPid);

      // 3) Toepassen in DDO + tabel loggen
      const matched = applyNaturanaToTable(stockMap, eanMap);

      if (matched === 0){
        setBtnState({ text:'⚠️ 0 rijen gematcht', bg:'#f39c12' });
      } else {
        setBtnState({ text:`📦 ${matched} rijen gevuld`, bg:'#2ecc71' });
      }
      setTimeout(resetBtn, 2500);

      if (autoSaveThisRun){
        if (matched > 0){
          const ok = clickUpdateProductButton();
          if (!ok){
            console.warn('[Naturana SS&E] Autosave mislukt: geen Save-knop gevonden');
          }
        } else {
          console.log('[Naturana SS&E] Autosave overgeslagen: 0 rijen gewijzigd');
        }
      }

    }catch(e){
      console.error('[Naturana SS&E]', e);
      const msg = String(e && e.message || e);
      if (msg === 'LOGIN_REQUIRED'){
        alert('Naturana vraagt opnieuw om in te loggen. Log in in het Naturana-tabblad en probeer opnieuw.');
      }
      setBtnState({ text:'❌ Fout bij ophalen', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
    }
  }

  // ---- Hotkey Ctrl+Shift+S ----

  function onScrapeHotkey(e){
    const target = e.target;
    const tag = target && target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

    const key = (e.key || '').toLowerCase();
    const match =
      key === HOTKEY.key &&
      !!e.ctrlKey === HOTKEY.ctrl &&
      !!e.shiftKey === HOTKEY.shift &&
      !!e.altKey === HOTKEY.alt;

    if (!match) return;
    if (!isTab3Active()) return;

    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.style.display === 'none' || btn.disabled) return;

    e.preventDefault();
    onScrapeClick(true); // met autosave
  }

  // ---- Observer / boot ----

  const observer = new MutationObserver(()=> scheduleEnsureButton());
  let ensureScheduled = false;

  function scheduleEnsureButton(){
    if (ensureScheduled) return;
    ensureScheduled = true;
    setTimeout(()=>{
      ensureScheduled = false;
      ensureButton();
      const btn = document.getElementById(BTN_ID);
      if (btn && hasTable()){
        try{
          observer.disconnect();
        }catch{}
      }
    }, 100);
  }

  function startObserver(){
    const root = document.documentElement || document.body;
    if (!root) return;
    try{
      observer.observe(root,{ childList:true, subtree:true });
    }catch{}
  }

  function bootAdmin(){
    ensureButton();
    startObserver();

    setInterval(()=>{
      const btn = document.getElementById(BTN_ID);
      if (btn) updateButtonVisibility(btn);
    }, 2000);

    if (!window.__naturanaSsenHotkeyBound){
      document.addEventListener('keydown', onScrapeHotkey);
      window.__naturanaSsenHotkeyBound = true;
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bootAdmin);
  } else {
    bootAdmin();
  }

  // Bridge "warm" houden
  setInterval(()=>{
    if (bridgeIsOnlineByHeartbeat()){
      httpGET(MODELVIEW_URL).catch(()=>{});
    }
  }, KEEPALIVE_MS);

})();
