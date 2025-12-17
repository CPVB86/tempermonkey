// ==UserScript==
// @name         EAN Scraper | Naturana
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2
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

  const MODELVIEW_URL    = 'https://naturana-online.de/naturana/ModellView';
  const ARTICLEVIEW_URL  = 'https://naturana-online.de/naturana/ArticleView';

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

  const uid  = ()=>Math.random().toString(36).slice(2)+Date.now().toString(36);

  const parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html');
  const isLoginPage=(html)=>{
    const t=String(html||'').toLowerCase();
    return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t);
  };

  // ============ Bridge (Naturana-tab) ============

  if (ON_NATURANA){
    setInterval(()=>{ GM_setValue(HEARTBEAT_KEY, Date.now()); }, HB_INTERVAL);

    CHANNELS.forEach(ch=>{
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

    CHANNELS.forEach(ch=>{
      GM_addValueChangeListener(ch.req, (_n,_o,req)=>{
        if(!req || !req.id || !req.url) return;
        q.push({ ...req, _resp: ch.resp });
        pump();
      });
    });

    return;
  }

  // ============ Client (DDO admin) ============

  if (!ON_ADMIN) return;

  // ---- Bridge helpers (admin) ----

  function bridgeSend({url, method='GET', headers={}, body=null, timeout=TIMEOUT_MS}){
    return new Promise((resolve,reject)=>{
      const id=uid(), handles=[];
      const off=()=>handles.forEach(h=>{ try{ GM_removeValueChangeListener(h); }catch{}; });
      let settled=false;

      CHANNELS.forEach(ch=>{
        const h=GM_addValueChangeListener(ch.resp, (_n,_o,msg)=>{
          if (settled || !msg || msg.id!==id) return;
          settled=true; off();
          msg.ok ? resolve(msg.text) : reject(new Error(msg.error||'bridge error'));
        });
        handles.push(h);
      });

      CHANNELS.forEach(ch=>{ GM_setValue(ch.req, { id, url, method, headers, body, timeout }); });

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

  function getFormAction(doc, fallbackUrl){
    const form = doc.querySelector('form');
    const act  = (form?.getAttribute('action') || '').trim();
    const base = fallbackUrl;
    try{
      return new URL(act || '', base).toString();
    }catch{
      return base;
    }
  }

  // ✅ NIEUW: serialize complete ASP.NET form-state (incl. ScriptManager fields etc.)
  function serializeForm(form){
    const payload = {};
    if (!form || !form.elements) return payload;

    const els = Array.from(form.elements);
    for (const el of els){
      if (!el || !el.name) continue;

      const name = el.name;
      const tag  = (el.tagName || '').toLowerCase();
      const type = (el.type || '').toLowerCase();

      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;

      if (tag === 'select' && el.multiple){
        const sel = Array.from(el.options).filter(o=>o.selected).map(o=>o.value);
        if (sel.length){
          payload[name] = sel[0]; // meestal niet relevant hier; keep simple
        }
        continue;
      }

      payload[name] = el.value ?? '';
    }
    return payload;
  }

  function addImageSubmit(payload, imageName){
    payload[`${imageName}.x`] = '1';
    payload[`${imageName}.y`] = '1';
  }

  // ==========================
  // findModelItem: EXACT model ONLY (kleur pas op ArticleView)
  // ==========================
  function findModelItem(doc, pidColor){
    const raw = String(pidColor||'').trim().toUpperCase();
    const m = raw.match(/^(.+?)-(.*)$/);
    const pid   = (m ? m[1] : raw).trim();
    const color = (m ? m[2] : '').trim();

    const colorDigits = color.replace(/\D/g,'');
    if (!pid || !colorDigits) return null;

    const spans = Array.from(doc.querySelectorAll('span[id*="lblArticleNo"]'));
    const exactSpans = spans.filter(sp => (sp.textContent||'').trim() === pid);

    console.log('[findModelItem] exactSpans', { pidColor: raw, pid, color: colorDigits, count: exactSpans.length });

    if (!exactSpans.length){
      console.warn('[findModelItem EXACT] NO MODEL SPAN MATCH', { pidColor: raw, pid, color: colorDigits });
      return null;
    }

    for (const sp of exactSpans){
      const col = sp.closest('.mod-container-col');
      if (!col) continue;

      const a = col.querySelector('a[id*="linkArticleNo"][href*="__doPostBack"]');
      const href = a?.getAttribute('href') || '';
      const mm = href.match(/__doPostBack\('([^']+)'\s*,\s*'([^']*)'\)/i);
      if (!mm) continue;

      return { pid, colorDigits, postType:'event', eventTarget:mm[1], eventArg:(mm[2]||'') };
    }

    console.warn('[findModelItem EXACT] NO POSTBACK LINK FOUND', { pidColor: raw, pid, color: colorDigits });
    return null;
  }

  // ==========================
  // ArticleView: select EXACT color via .art-color-no
  // ==========================
  async function ensureArticleViewColor(html, colorDigits, fallbackUrl){
    const doc = parseHTML(html);

    const current =
      (doc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (doc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    if (String(current).replace(/\D/g,'') === String(colorDigits)){
      console.log('[ensureArticleViewColor] already on color', { current, colorDigits });
      return html;
    }

    const colorBlocks = Array.from(doc.querySelectorAll('.art-color'));
    const wantedBlock = colorBlocks.find(b=>{
      const n = (b.querySelector('.art-color-no')?.textContent || '').trim();
      return String(n).replace(/\D/g,'') === String(colorDigits);
    });

    if (!wantedBlock){
      console.warn('[ensureArticleViewColor] COLOR NOT FOUND ON ARTICLEVIEW', { colorDigits, blocks: colorBlocks.length });
      throw new Error('TARGET_NOT_FOUND');
    }

    const img = wantedBlock.querySelector('input[type="image"][name*="btnSelectColor"]');
    const imgName = img?.getAttribute('name') || '';
    if (!imgName){
      console.warn('[ensureArticleViewColor] btnSelectColor not found', { colorDigits });
      throw new Error('TARGET_NOT_FOUND');
    }

    const form = doc.querySelector('form');
    if (!form){
      console.warn('[ensureArticleViewColor] NO FORM');
      throw new Error('TARGET_NOT_FOUND');
    }

    // ✅ cruciaal: post naar ArticleView, en stuur ALLE form fields mee
    const actionUrl = getFormAction(doc, fallbackUrl);

    const payload = serializeForm(form);

    // ASP.NET verwacht deze vaak; als ze ontbreken: toevoegen
    if (!('__EVENTTARGET' in payload)) payload.__EVENTTARGET = '';
    if (!('__EVENTARGUMENT' in payload)) payload.__EVENTARGUMENT = '';

    // ✅ simulate imagebutton click
    addImageSubmit(payload, imgName);

    console.log('[ensureArticleViewColor] POST', { actionUrl, imgName, colorDigits, keys: Object.keys(payload).length });

    const resp = await httpPOST(actionUrl, payload);
    if (isLoginPage(resp)) throw new Error('LOGIN_REQUIRED');

    const checkDoc = parseHTML(resp);
    const after =
      (checkDoc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (checkDoc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    console.log('[ensureArticleViewColor] AFTER', { after, want: colorDigits });

    if (!/gridSize|gridAmount|color-size-grid/i.test(resp)) {
      throw new Error('TARGET_NOT_FOUND');
    }

    return resp;
  }

  // ---- Size helpers ----

  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    '3L':'3XL'
  };

  function normalizeLocalSize(s){
    return String(s||'').trim().toUpperCase().replace(/\s+/g,'');
  }

  function mapNaturanaStockLevel(remoteQty){
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n > 4)  return 5;
    return 0;
  }

  // ---- ArticleView → stockMap ----

  function buildStockMapFromArticleView(html){
    const map = new Map();
    const doc = parseHTML(html);

    const tiles = Array.from(doc.querySelectorAll('.color-size-grid .p-2.text-center, .color-size-grid [id*="_divOID_"]'));
    for (const tile of tiles){
      const sizeEl = tile.querySelector('.gridSize');
      const inp    = tile.querySelector('input.gridAmount');
      if (!sizeEl || !inp) continue;

      const rawSize = (sizeEl.textContent || '').trim().toUpperCase();
      if (!rawSize) continue;

      const sizeKey = normalizeLocalSize(rawSize);

      const rawMax =
        inp.getAttribute('max') ??
        inp.getAttribute('data-max') ??
        inp.dataset?.max ??
        inp.getAttribute('value') ??
        inp.value ??
        '0';

      let stockNum = parseInt(String(rawMax).trim(), 10);
      if (!Number.isFinite(stockNum) || stockNum < 0) stockNum = 0;

      map.set(sizeKey, stockNum);
    }

    console.log('[Naturana SS&E] stockMap size:', map.size);
    return map;
  }

  // ---- ArticleView ophalen via ModelView POST ----

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
    console.log('[findModelItem]', { supplierPid: pidColor, item });

    if (!item) {
      await ensureFreshMV();
      item = findModelItem(state.doc, pidColor);
      console.log('[findModelItem retry]', { supplierPid: pidColor, item });
      if (!item) throw new Error('TARGET_NOT_FOUND');
    }

    // 1) open model => ArticleView
    const payload = {
      __EVENTTARGET: item.eventTarget || '',
      __EVENTARGUMENT: item.eventArg || '',
      __VIEWSTATE: state.vs.__VIEWSTATE,
      __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR||'',
      __EVENTVALIDATION: state.vs.__EVENTVALIDATION||''
    };

    const resp1 = await httpPOST(MODELVIEW_URL, payload);
    if (isLoginPage(resp1)) throw new Error('LOGIN_REQUIRED');

    if (!/art-color|color-size-grid|gridSize|gridAmount/i.test(resp1)) {
      throw new Error('TARGET_NOT_FOUND');
    }

    // 2) ensure exact color on ArticleView
    const resp2 = await ensureArticleViewColor(resp1, item.colorDigits, ARTICLEVIEW_URL);

    const d2 = parseHTML(resp2);
    const after =
      (d2.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (d2.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';
    if (String(after).replace(/\D/g,'') !== String(item.colorDigits)){
      console.warn('[ColorGuard] wrong color after selection', { want:item.colorDigits, got:after });
      throw new Error('TARGET_NOT_FOUND');
    }

    return resp2;
  }

  // ============ Google Sheet (EAN) ============

  const SHEET_ID  = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';
  const SHEET_GID = '0';

  const SHEET_CACHE_KEY    = `naturanaSheetCache:${SHEET_ID}:${SHEET_GID}`;
  const SHEET_AUTHUSER_KEY = 'naturanaSheetAuthUser';
  const SHEET_CACHE_TTL_MS = 60*60*1000;

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
    try{ localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(obj)); }catch{}
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
      return {text:cache.text, authuser:cache.authuser, fromCache:true};
    }

    const candidates = getAuthuserCandidates();
    for (const au of candidates){
      const url = makeTsvUrl(au);
      const res = await gmGet(url, {
        'Accept':'*/*',
        'Referer':`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`,
      });
      if (res.status>=200 && res.status<300 && res.responseText && !isLikelyHtml(res.responseText)){
        writeSheetCache({text:res.responseText, authuser:au, ts:Date.now()});
        localStorage.setItem(SHEET_AUTHUSER_KEY, String(au));
        return {text:res.responseText, authuser:au, fromCache:false};
      }
    }

    if (cache){
      return {text:cache.text, authuser:cache.authuser, fromCache:true};
    }

    throw new Error('Sheets: geen toegang. Log in met juiste Google-account of publiceer tabblad.');
  }

  function buildEanMapFromRows(rows, supplierPid){
    const eanMap = new Map();
    if (!rows.length) return eanMap;

    const wanted = String(supplierPid || '').trim().toUpperCase()
      .replace(/\s+/g,'')
      .replace(/-+/g,'-');

    for (let i=1;i<rows.length;i++){
      const r = rows[i]; if (!r) continue;

      const A = (r[0] || '').toString().trim();
      const C = (r[2] || '').toString().trim();
      const E = (r[4] || '').toString().trim();
      const G = (r[6] || '').toString().trim();
      const I = (r[8] || '').toString().trim();

      if (!A && !C) continue;
      if (!I) continue;

      const supIdRow = (A + '-' + C).toUpperCase()
        .replace(/\s+/g,'')
        .replace(/-+/g,'-');

      if (supIdRow !== wanted) continue;

      const maatLabel = (E || G || '').toUpperCase().trim();
      if (!maatLabel) continue;

      const sizeKey = normalizeLocalSize(maatLabel);
      if (!sizeKey) continue;

      const ean = I.replace(/\D/g,'');
      if (!ean) continue;

      eanMap.set(sizeKey, ean);

      const alias = SIZE_ALIAS[sizeKey];
      if (alias){
        eanMap.set(normalizeLocalSize(alias), ean);
      }
    }

    console.log('[Naturana SS&E] EAN map size:', eanMap.size, 'sample:', [...eanMap.entries()].slice(0,10));
    return eanMap;
  }

  // ============ Admin UI / apply ============

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

  function hasTable(){ return !!$(TABLE_SELECTOR); }

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
    return style.display !== 'none' && style.visibility !== 'hidden' && style.height !== '0px';
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

    btn.style.display = (okBrand && active) ? '' : 'none';
    btn.disabled      = !tableOkay;
    btn.style.opacity = tableOkay ? '1' : '.55';
  }

  function resetBtn(){
    setBtnState({ text:'⛏️ SS&E | Naturana', bg:'#007cba', disabled:false, opacity:'1' });
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
        position: fixed; right: 10px; top: 10px; z-index: 999999;
        padding: 10px 12px; background: #007cba; color: #fff;
        border: none; border-radius: 8px; cursor: pointer;
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
    if (!saveBtn) return false;
    saveBtn.click();
    return true;
  }

  function applyNaturanaToTable(stockMap, eanMap){
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return 0;

    const rows = table.querySelectorAll('tbody tr');
    let matched = 0;
    const report = [];

    rows.forEach(row=>{
      const sizeInput = row.querySelector('input.product_option_small');
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

      if (stockInput && remoteQty > 0){
        const newStock = String(mappedStock);
        if (stockInput.value !== newStock){
          stockInput.value = newStock;
          stockInput.dispatchEvent(new Event('input', {bubbles:true}));
          changed = true;
        }
      }

      if (eanInput && remoteEan){
        eanInput.value = String(remoteEan);
        eanInput.dispatchEvent(new Event('input',{bubbles:true}));
        changed = true;
      }

      if (changed) matched++;

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

    return matched;
  }

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

    setBtnState({ text:'⏳ Naturana ArticleView laden...', bg:'#f1c40f', disabled:true, opacity:'.8' });

    try{
      const mvHtml = await httpGET(MODELVIEW_URL);
      if (isLoginPage(mvHtml)) throw new Error('LOGIN_REQUIRED');

      const mvDoc  = parseHTML(mvHtml);
      const state  = { doc: mvDoc, vs: pickViewState(mvDoc) };

      const html = await openArticleViewViaPostback_cached(supplierPid, state);
      const stockMap = buildStockMapFromArticleView(html);

      setBtnState({ text:'⏳ Sheet (EAN) laden...', bg:'#6c757d', disabled:true, opacity:'.8' });

      const raw = await fetchSheetRaw({});
      const rows = parseTsv(raw.text);
      const eanMap = buildEanMapFromRows(rows, supplierPid);

      const matched = applyNaturanaToTable(stockMap, eanMap);

      setBtnState({ text: matched ? `📦 ${matched} rijen gevuld` : '⚠️ 0 rijen gevuld', bg: matched ? '#2ecc71' : '#f39c12' });
      setTimeout(resetBtn, 2500);

      if (autoSaveThisRun && matched > 0){
        clickUpdateProductButton();
      }
    }catch(e){
      console.error('[Naturana SS&E]', e);
      setBtnState({ text:'❌ Fout bij ophalen', bg:'#e06666' });
      setTimeout(resetBtn, 2500);
    }
  }

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
    onScrapeClick(true);
  }

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
        try{ observer.disconnect(); }catch{}
      }
    }, 100);
  }

  function startObserver(){
    const root = document.documentElement || document.body;
    if (!root) return;
    try{ observer.observe(root,{ childList:true, subtree:true }); }catch{}
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

  setInterval(()=>{
    if (bridgeIsOnlineByHeartbeat()){
      httpGET(MODELVIEW_URL).catch(()=>{});
    }
  }, KEEPALIVE_MS);

})();
