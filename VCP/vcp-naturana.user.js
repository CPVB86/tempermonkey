// ==UserScript==
// @name         VCP | Naturana
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met Naturana remote stock via bridge + exacte kleurselectie (ModellView → ArticleView)
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://naturana-online.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-naturana.user.js
// ==/UserScript==

(() => {
  'use strict';

  // =========================
  // Config / URLs
  // =========================
  const MODELVIEW_URL    = 'https://naturana-online.de/naturana/ModellView';
  const ARTICLEVIEW_URL  = 'https://naturana-online.de/naturana/ArticleView';

  const TIMEOUT_MS   = 20000;
  const KEEPALIVE_MS = 300000; // 5 min

  const HEARTBEAT_KEY = 'naturana_bridge_heartbeat';
  const HB_INTERVAL   = 2500;

  // Bridge tuning
  const BRIDGE_CONCURRENCY = 4;

  // Client tuning
  const CONFIG = {
    NAV: {
      throttleMin: 250,
      throttleMax: 750,
      backoffStart: 600,
      backoffMax: 5000,
      keepAlive: true,
      clientConcurrency: 3,
    }
  };

  const CHANNELS = [
    { req:'naturana_bridge_adv_req',  resp:'naturana_bridge_adv_resp',  ping:'naturana_bridge_adv_ping',  pong:'naturana_bridge_adv_pong'  },
    { req:'naturana_bridge_v2_req',   resp:'naturana_bridge_v2_resp',   ping:'naturana_bridge_v2_ping',   pong:'naturana_bridge_v2_pong'   },
    { req:'naturana_bridge_v1_req',   resp:'naturana_bridge_v1_resp',   ping:'naturana_bridge_v1_ping',   pong:'naturana_bridge_v1_pong'   },
  ];

  const ON_NATURANA = location.hostname.includes('naturana-online.de');
  const ON_TOOL     = location.hostname.includes('lingerieoutlet.nl');

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const uid = ()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
  const jitter=()=>delay(CONFIG.NAV.throttleMin + Math.random()*(CONFIG.NAV.throttleMax - CONFIG.NAV.throttleMin));

  const parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html');
  const isLoginPage=(html)=>{
    const t=String(html||'').toLowerCase();
    return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t);
  };

  // =========================
  // Bridge (Naturana tab)
  // =========================
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

    if (document.readyState!=='loading') console.info('[Naturana Bridge] actief op', location.href);
    else document.addEventListener('DOMContentLoaded', ()=>console.info('[Naturana Bridge] actief op', location.href));

    return;
  }

  // =========================
  // Client (Voorraadchecker tool)
  // =========================
  if (!ON_TOOL) return;

  // ---- Logger (StockKit logboek) ----
  const Logger={
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    status(id,txt){ if (this.lb()?.resultaat) this.lb().resultaat(String(id), txt); else console.info(`[NAT][${id}] status: ${txt}`); },
    perMaat(id,report){
      console.groupCollapsed(`[NAT][${id}] maatvergelijking`);
      try{ console.table(report.map(r=>({ maat:r.maat, local:r.local, remote:r.remote, desired:r.desired, actie:r.actie }))); }
      finally{ console.groupEnd(); }
    }
  };

  const bridgeIsOnlineByHeartbeat=(maxAge=5000)=>{
    try{
      const t=GM_getValue(HEARTBEAT_KEY,0);
      return t && (Date.now()-t)<maxAge;
    }catch{
      return false;
    }
  };

  // ---- Bridge client ----
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

  // =========================
  // ASP.NET helpers
  // =========================
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
    try{ return new URL(act || '', fallbackUrl).toString(); }
    catch{ return fallbackUrl; }
  }

  function serializeForm(form){
    const payload = {};
    if (!form || !form.elements) return payload;

    for (const el of Array.from(form.elements)){
      if (!el || !el.name) continue;

      const tag  = (el.tagName || '').toLowerCase();
      const type = (el.type || '').toLowerCase();

      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;

      if (tag === 'select' && el.multiple){
        const sel = Array.from(el.options).filter(o=>o.selected).map(o=>o.value);
        if (sel.length) payload[el.name] = sel[0];
        continue;
      }
      payload[el.name] = el.value ?? '';
    }
    return payload;
  }

  function addImageSubmit(payload, imageName){
    payload[`${imageName}.x`] = '1';
    payload[`${imageName}.y`] = '1';
  }

  // =========================
  // Maat helpers
  // =========================
  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    '3L':'3XL',
    'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL'
  };

  function normalizeSize(s){
    return String(s||'').trim().toUpperCase().replace(/\s+/g,'');
  }

  function aliasCandidates(label){
    const raw = String(label||'').trim().toUpperCase();
    const ns  = raw.replace(/\s+/g,'');
    const set = new Set([raw, ns]);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);

    if (raw.includes('/')){
      raw.split('/').map(x=>x.trim()).filter(Boolean).forEach(x=>{
        set.add(x);
        set.add(x.replace(/\s+/g,''));
        if (SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
      });
    }
    return Array.from(set);
  }

  // Naturana mapping (jouw SS&E mapping)
  function mapNaturanaStockLevel(remoteQty){
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 0;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n > 4)  return 5;
    return 0;
  }

  // =========================
  // Exact model match (pid-color) → postback target
  // (zelfde methodiek als jouw Naturana EAN Scraper)
  // =========================
  function findModelItemExact(doc, pidColor){
    const raw = String(pidColor||'').trim().toUpperCase();
    const m = raw.match(/^(.+?)-(.*)$/);
    const pid   = (m ? m[1] : raw).trim();
    const color = (m ? m[2] : '').trim();
    const colorDigits = color.replace(/\D/g,'');

    if (!pid || !colorDigits) return null;

    const spans = Array.from(doc.querySelectorAll('span[id*="lblArticleNo"]'));
    const exactSpans = spans.filter(sp => (sp.textContent||'').trim() === pid);
    if (!exactSpans.length) return null;

    for (const sp of exactSpans){
      const col = sp.closest('.mod-container-col');
      if (!col) continue;

      const a = col.querySelector('a[id*="linkArticleNo"][href*="__doPostBack"]');
      const href = a?.getAttribute('href') || '';
      const mm = href.match(/__doPostBack\('([^']+)'\s*,\s*'([^']*)'\)/i);
      if (!mm) continue;

      return { pid, colorDigits, eventTarget:mm[1], eventArg:(mm[2]||'') };
    }
    return null;
  }

  // =========================
  // ArticleView: kies exacte kleur op basis van .art-color-no
  // =========================
  async function ensureArticleViewColor(html, colorDigits, fallbackUrl){
    const doc = parseHTML(html);

    const current =
      (doc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (doc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    if (String(current).replace(/\D/g,'') === String(colorDigits)){
      return html;
    }

    const colorBlocks = Array.from(doc.querySelectorAll('.art-color'));
    const wantedBlock = colorBlocks.find(b=>{
      const n = (b.querySelector('.art-color-no')?.textContent || '').trim();
      return String(n).replace(/\D/g,'') === String(colorDigits);
    });
    if (!wantedBlock) throw new Error('TARGET_NOT_FOUND');

    const img = wantedBlock.querySelector('input[type="image"][name*="btnSelectColor"]');
    const imgName = img?.getAttribute('name') || '';
    if (!imgName) throw new Error('TARGET_NOT_FOUND');

    const form = doc.querySelector('form');
    if (!form) throw new Error('TARGET_NOT_FOUND');

    const actionUrl = getFormAction(doc, fallbackUrl);
    const payload = serializeForm(form);

    if (!('__EVENTTARGET' in payload)) payload.__EVENTTARGET = '';
    if (!('__EVENTARGUMENT' in payload)) payload.__EVENTARGUMENT = '';

    addImageSubmit(payload, imgName);

    const resp = await httpPOST(actionUrl, payload);
    if (isLoginPage(resp)) throw new Error('LOGIN_REQUIRED');

    if (!/gridSize|gridAmount|color-size-grid/i.test(resp)) {
      throw new Error('TARGET_NOT_FOUND');
    }

    const checkDoc = parseHTML(resp);
    const after =
      (checkDoc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (checkDoc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    if (String(after).replace(/\D/g,'') !== String(colorDigits)){
      throw new Error('TARGET_NOT_FOUND');
    }

    return resp;
  }

  // =========================
  // ArticleView → stockMap(sizeKey => remoteQty)
  // =========================
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

      const sizeKey = normalizeSize(rawSize);

      const rawMax =
        inp.getAttribute('max') ??
        inp.getAttribute('data-max') ??
        inp.dataset?.max ??
        inp.getAttribute('value') ??
        inp.value ??
        '0';

      let stockNum = parseInt(String(rawMax).trim(), 10);
      if (!Number.isFinite(stockNum) || stockNum < 0) stockNum = 0;

      // set + aliases
      for (const key of aliasCandidates(sizeKey)){
        map.set(normalizeSize(key), stockNum);
      }
    }
    return map;
  }

  const resolveRemoteQty=(map,label)=>{
    for (const c of aliasCandidates(label)){
      const k = normalizeSize(c);
      if (map.has(k)) return map.get(k);
    }
    return undefined;
  };

  // =========================
  // Navigation: ModellView → ArticleView (postback) + kleur guard
  // =========================
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

    let item = findModelItemExact(state.doc, pidColor);
    if (!item){
      await ensureFreshMV();
      item = findModelItemExact(state.doc, pidColor);
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
    if (!/art-color|color-size-grid|gridSize|gridAmount/i.test(resp1)) throw new Error('TARGET_NOT_FOUND');

    // 2) ensure exact color
    const resp2 = await ensureArticleViewColor(resp1, item.colorDigits, ARTICLEVIEW_URL);
    return resp2;
  }

  // =========================
  // Apply rules + mark rows in tool table
  // =========================
  function jumpFlash(el){
    if(!el) return;
    try{
      el.scrollIntoView({ behavior:'smooth', block:'center' });
      const old=el.style.boxShadow;
      el.style.boxShadow='0 0 0 2px rgba(255,255,0,.9), 0 0 12px rgba(255,255,0,.9)';
      setTimeout(()=>{ el.style.boxShadow=old||''; }, 650);
    }catch{}
  }

  function applyRulesAndMark(localTable, stockMap){
    const rows=localTable.querySelectorAll('tbody tr');
    const report=[];
    let firstMut=null;

    rows.forEach(row=>{
      const maat=(row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local=parseInt((row.children[1]?.textContent||'').trim(),10)||0;

      const remoteQty = resolveRemoteQty(stockMap, maat);
      const remote = (typeof remoteQty === 'number') ? remoteQty : -1;

      // desired local stocklevel volgens Naturana regels
      const desired = (remote >= 0) ? mapNaturanaStockLevel(remote) : null;

      // reset styling
      row.style.background='';
      row.style.transition='background-color .25s';
      row.title='';
      row.classList.remove('status-green','status-red');
      delete row.dataset.status;

      let actie='none';

      if (desired === null){
        row.title='Negeren (maat onbekend bij Naturana)';
        actie='negeren';
      } else if (local > desired){
        const diff = local - desired;
        row.style.background='#f8d7da';
        row.title=`Uitboeken ${diff} → naar ${desired} (Naturana qty: ${remote})`;
        row.dataset.status='remove';
        row.classList.add('status-red');
        actie='uitboeken';
        if(!firstMut) firstMut=row;
      } else if (local < desired){
        const diff = desired - local;
        row.style.background='#d4edda';
        row.title=`Bijboeken ${diff} → naar ${desired} (Naturana qty: ${remote})`;
        row.dataset.status='add';
        row.classList.add('status-green');
        actie='bijboeken';
        if(!firstMut) firstMut=row;
      } else {
        row.title=`OK (local=${local}, Naturana qty=${remote}, desired=${desired})`;
        actie='ok';
      }

      report.push({ maat, local, remote, desired, actie });
    });

    if(firstMut) jumpFlash(firstMut);
    return report;
  }

  const bepaalLogStatus=(report, stockMap)=>{
    const leeg = !stockMap || (stockMap instanceof Map ? stockMap.size===0 : false);
    if (leeg) return 'niet-gevonden';

    const heeftMutaties = report.some(r => r.actie === 'uitboeken' || r.actie === 'bijboeken');
    if (report.length>0 && !heeftMutaties) return 'ok';
    return 'afwijking';
  };

  // =========================
  // p-limit
  // =========================
  function pLimit(n){
    const queue = [];
    let active = 0;
    const next = ()=>{
      if (active>=n || queue.length===0) return;
      active++;
      const {fn, resolve, reject} = queue.shift();
      fn().then(resolve, reject).finally(()=>{ active--; next(); });
    };
    return (fn)=> new Promise((resolve, reject)=>{
      queue.push({fn, resolve, reject});
      next();
    });
  }

  // =========================
  // Main runner (advanced)
  // =========================
 async function runAdvanced(btn){
  if(!bridgeIsOnlineByHeartbeat()){
    alert('Bridge offline. Log in bij Naturana, houd dat tabblad open en refresh deze pagina.');
    return;
  }

  const tables=Array.from(document.querySelectorAll('#output table'));
  if (!tables.length){
    alert('Geen tabellen in #output.');
    return;
  }

  // helper: harde timeout zodat niks ooit minuten kan hangen
  const withTimeout = (p, ms, label='timeout') =>
    Promise.race([
      p,
      new Promise((_, rej)=>setTimeout(()=>rej(new Error(label)), ms))
    ]);

  // init ModelView state
  const mvHtml = await httpGET(MODELVIEW_URL);
  if (isLoginPage(mvHtml)){
    alert('Niet ingelogd op Naturana. Log in op Naturana-tab.');
    return;
  }
  const mvDoc = parseHTML(mvHtml);
  const state = { doc: mvDoc, vs: pickViewState(mvDoc) };

  const progress=StockKit.makeProgress(btn);
  progress.start(tables.length);

  const limit = pLimit(CONFIG.NAV.clientConcurrency);

  let idx=0, totalMut=0;
  let backoff=CONFIG.NAV.backoffStart;

  // ✅ ZET DEZE TRY/FINALLY HIER: om de hele batch heen
  try{
    await Promise.allSettled(tables.map(table => limit(async ()=>{
      const pidColor=(table.id||'').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pidColor || 'onbekend';
      const anchorId = pidColor || label;

      await jitter();

      try{
        // ✅ per tabel een hard plafond (bijv. 45s)
        const html = await withTimeout(
          openArticleViewViaPostback_cached(pidColor, state),
          45000,
          'TABLE_TIMEOUT'
        );

        const stockMap = buildStockMapFromArticleView(html);

        if (!stockMap || stockMap.size===0){
          Logger.status(anchorId,'niet-gevonden');
          Logger.perMaat(anchorId,[]);
          return;
        }

        const report = applyRulesAndMark(table, stockMap);
        totalMut += report.filter(r=>r.actie==='uitboeken' || r.actie==='bijboeken').length;

        Logger.status(anchorId, bepaalLogStatus(report, stockMap));
        Logger.perMaat(anchorId, report);

        backoff=CONFIG.NAV.backoffStart;

      }catch(e){
        console.error('[NAT][adv]', e);
        const emsg = String(e.message||e);

        if (emsg==='LOGIN_REQUIRED'){
          Logger.status(anchorId,'niet-gevonden');
          Logger.perMaat(anchorId,[]);
          // niet throwen → we willen afronden, niet de hele batch killen
          return;
        }

        if (emsg==='TARGET_NOT_FOUND' || emsg==='TABLE_TIMEOUT'){
          Logger.status(anchorId,'niet-gevonden');
          Logger.perMaat(anchorId,[]);
        } else {
          Logger.status(anchorId,'afwijking');
          Logger.perMaat(anchorId,[]);
        }
      } finally {
        progress.setDone(++idx);

        // ✅ geen “eindeloze” backoff op het eind
        if (idx < tables.length){
          await delay(backoff);
          if (backoff < CONFIG.NAV.backoffMax) backoff=Math.min(CONFIG.NAV.backoffMax, backoff*1.2);
        }
      }
    })));
  } finally {
    // ✅ DIT GARANDEERT “afsluiten”, óók bij errors/timeouts
    progress.success(totalMut);
  }
}

  // =========================
  // UI mounting
  // =========================
  const norm=(s='')=>String(s).toLowerCase().trim().replace(/\s+/g,' ');

  function isNaturanaSelected(){
    const sel=document.querySelector('#leverancier-keuze');
    if(!sel) return false;
    const val=norm(sel.value||'');
    const txt=norm(sel.options[sel.selectedIndex]?.text||'');
    const blob = `${val} ${txt}`;
    return /\bnaturana\b/i.test(blob);
  }

  function cleanupLegacyButton(){
    const legacy = document.querySelectorAll('#adv-naturana-btn');
    legacy.forEach(el => { try{ el.remove(); }catch{} });
  }

  function ensureButton(){
    let btn=document.getElementById('adv-naturana-btn');
    if (btn) return btn;

    btn=document.createElement('button');
    btn.id='adv-naturana-btn';
    btn.className='sk-btn';
    btn.type='button';
    btn.textContent='Check Naturana Stock';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      right: '250px',
      zIndex: '9999',
      display: 'none',
      paddingRight: '26px'
    });

    // badge
    const badge=document.createElement('span');
    badge.className='naturana-badge';
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-6px',
      right: '-7px',
      minWidth: '18px',
      height: '18px',
      borderRadius: '50%',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '700',
      lineHeight: '18px',
      textAlign: 'center',
      boxShadow: '0 0 0 2px #fff',
      pointerEvents: 'none',
      background: 'red'
    });
    badge.textContent='';

    btn.appendChild(badge);
    btn.addEventListener('click', ()=>runAdvanced(btn));
    document.body.appendChild(btn);

    const setBadge=(ok)=>{ badge.style.background = ok ? '#24b300' : 'red'; };
    setBadge(bridgeIsOnlineByHeartbeat());
    GM_addValueChangeListener(HEARTBEAT_KEY, ()=> setBadge(true));

    return btn;
  }

  function maybeMountOrRemove(){
    const hasTables = !!document.querySelector('#output table');
    const need = isNaturanaSelected();
    const existing = document.getElementById('adv-naturana-btn');

    if (need){
      const btn = ensureButton();
      btn.style.display = hasTables ? 'block' : 'none';
    } else {
      if (existing) { try{ existing.remove(); }catch{} }
    }
  }

  function bootUI(){
    cleanupLegacyButton();

    const sel=document.querySelector('#leverancier-keuze');
    if (sel) sel.addEventListener('change', maybeMountOrRemove);

    const out=document.querySelector('#output');
    if (out) new MutationObserver(maybeMountOrRemove).observe(out,{ childList:true, subtree:true });

    maybeMountOrRemove();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bootUI);
  else bootUI();

  // keep-alive ping
  if (CONFIG.NAV.keepAlive){
    setInterval(()=>{ if(bridgeIsOnlineByHeartbeat()) httpGET(MODELVIEW_URL).catch(()=>{}); }, KEEPALIVE_MS);
  }
})();
