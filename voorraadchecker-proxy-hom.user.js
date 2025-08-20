// ==UserScript==
// @name         Voorraadchecker Proxy - HOM
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://b2b.huberholding.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-hom.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-hom.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ============ Shared ============
  const MODELVIEW_URL   = 'https://b2b.huberholding.com/huberholdingb2b/ModellView';
  const ARTICLEVIEW_URL = 'https://b2b.huberholding.com/huberholdingb2b/ArticleView';
  const TIMEOUT_MS  = 20000, KEEPALIVE_MS = 120000;
  const HEARTBEAT_KEY = 'hom_bridge_heartbeat';
  const HB_INTERVAL   = 2500;

  const CHANNELS = [
    { req:'hom_bridge_adv_req',  resp:'hom_bridge_adv_resp',  ping:'hom_bridge_adv_ping',  pong:'hom_bridge_adv_pong'  },
    { req:'hom_bridge_v2_req',   resp:'hom_bridge_v2_resp',   ping:'hom_bridge_v2_ping',   pong:'hom_bridge_v2_pong'   },
    { req:'hom_bridge_v1_req',   resp:'hom_bridge_v1_resp',   ping:'hom_bridge_v1_ping',   pong:'hom_bridge_v1_pong'   },
  ];

  const ON_HOM  = location.hostname.includes('b2b.huberholding.com');
  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const uid = ()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
  const forEachChannel=(fn)=>CHANNELS.forEach(fn);
  const norm=(s='')=>String(s).toLowerCase().trim().replace(/\s+/g,' ');

  // ============ Bridge (HOM) ============
  if (ON_HOM){
    setInterval(()=>{ GM_setValue(HEARTBEAT_KEY, Date.now()); }, HB_INTERVAL);

    forEachChannel(ch=>{
      GM_addValueChangeListener(ch.ping, (_n,_o,msg)=>{
        if (msg==='ping') GM_setValue(ch.pong, 'pong:'+Date.now());
      });
    });

    let busy=false; const q=[];
    forEachChannel(ch=>{
      GM_addValueChangeListener(ch.req, (_n,_o,req)=>{
        if(!req || !req.id || !req.url) return;
        q.push({ ...req, _resp: ch.resp });
        if(!busy) processQueue();
      });
    });

    async function processQueue(){
      busy=true;
      while(q.length){
        const req=q.shift();
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
        await delay(160+Math.random()*220);
      }
      busy=false;
    }

    if (document.readyState!=='loading') console.info('[HOM Bridge] actief op', location.href);
    else document.addEventListener('DOMContentLoaded', ()=>console.info('[HOM Bridge] actief op', location.href));
    return;
  }

  // ============ Client (tool) ============
  if (!ON_TOOL) return;

  // ---- Logger ----
  const Logger={
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    status(id,txt){ if (this.lb()?.resultaat) this.lb().resultaat(String(id), txt); else console.info(`[HOM][${id}] status: ${txt}`); },
    perMaat(id,report){ console.groupCollapsed(`[HOM][${id}] maatvergelijking`); try{ console.table(report.map(r=>({ maat:r.maat, local:r.local, remote:Number.isFinite(r.sup)?r.sup:'—', status:r.actie }))); } finally{ console.groupEnd(); } }
  };

  const CONFIG={ NAV:{ throttleMin:300, throttleMax:800, backoffStart:600, backoffMax:5000, keepAlive:true } };
  const jitter=()=>delay(CONFIG.NAV.throttleMin + Math.random()*(CONFIG.NAV.throttleMax - CONFIG.NAV.throttleMin));
  const bridgeIsOnlineByHeartbeat=(maxAge=5000)=>{ try{ const t=GM_getValue(HEARTBEAT_KEY,0); return t && (Date.now()-t)<maxAge; }catch{ return false; } };

  // ---- Bridge client ----
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
  const httpGET =(url)=>bridgeSend({url});
  const httpPOST=(url,data)=>{
    const body=(typeof data==='string')?data:new URLSearchParams(data).toString();
    return bridgeSend({ url, method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}, body });
  };

  // ---- HTML utils / parsers ----
  const parseHTML=(html)=>new DOMParser().parseFromString(html,'text/html');
  const isLoginPage=(html)=>{ const t=String(html||'').toLowerCase(); return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t); };
  function pickViewState(doc){
    const form=doc.querySelector('form'); if(!form) return null;
    const get=(n)=>form.querySelector(`input[name="${n}"]`)?.value ?? '';
    return { __VIEWSTATE:get('__VIEWSTATE'), __VIEWSTATEGENERATOR:get('__VIEWSTATEGENERATOR'), __EVENTVALIDATION:get('__EVENTVALIDATION') };
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
      let s=0; if(pid && txt.includes(pid)) s+=4; if(color && color.length>=2 && txt.includes(color)) s+=2; if(/HOM|ART\.|ARTICLE|MODELL|MODEL/i.test(txt)) s+=0.5;
      if(s>bestScore){ best={eventTarget}; bestScore=s; }
    }
    return (best && bestScore>=3) ? best : null;
  }
  const articleSummary=(html)=>{ try{ const d=parseHTML(html); const t=d.querySelector('h1, .articleTitle, .product-title')?.textContent?.trim(); const no=d.querySelector('#articleNumber, .articleNo, [id*="lblArticleNo"]')?.textContent?.trim(); return [t,no].filter(Boolean).join(' | ')||'(onbekend)'; }catch{ return '(onbekend)'; } };

  // ---- Aliases ----
  const SIZE_ALIAS={ '2XL':'XXL','XXL':'2XL','3XL':'XXXL','XXXL':'3XL','4XL':'XXXXL','XXXXL':'4XL','XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL' };
  function aliasCandidates(label){
    const raw=String(label||'').trim().toUpperCase();
    const ns =raw.replace(/\s+/g,'');
    const set=new Set([raw,ns]);
    if(SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if(SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);
    if(raw.includes('/')) raw.split('/').map(s=>s.trim()).forEach(x=>{ set.add(x); set.add(x.replace(/\s+/g,'')); if(SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]); });
    return Array.from(set);
  }

  // ---- ArticleView → statusMap ----
  function buildStatusMapFromArticleView(html){
    const map={}; const doc=parseHTML(html);
    const t=(doc.body?.textContent||'').toLowerCase();
    if(t.includes('login') && (t.includes('password')||t.includes('passwort'))) return {};
    const inputs=doc.querySelectorAll('.color-size-grid input.gridAmount');
    inputs.forEach(inp=>{
      const wrap=inp.closest('.p-2.text-center, [id*="_divOID_"]')||inp.parentElement; if(!wrap) return;
      const sizeEl=wrap.querySelector('.gridSize'); const availEl=wrap.querySelector('.gridAvailTxt'); const delivEl=wrap.querySelector('.gridDelivTxt');
      if(!sizeEl) return;
      const size=sizeEl.textContent.trim().toUpperCase();
      const availTxt=(availEl?.textContent||'').trim(); const mm=availTxt.match(/(\d+)\s*$/); const stockNum=mm?parseInt(mm[1],10):0;
      let status='OUT_OF_STOCK'; if(stockNum>0) status='IN_STOCK'; else if(delivEl && delivEl.textContent.trim()) status='LOW';
      for(const key of aliasCandidates(size)) map[key]={ status, stock:stockNum };
    });
    if(Object.keys(map).length===0){
      let m; const sizeRe=/<span[^>]*class="gridSize"[^>]*>([^<]+)/gi, availRe=/<span[^>]*class="gridAvailTxt[^"]*"[^>]*>([^<]+)/gi;
      const sz=[], av=[]; while((m=sizeRe.exec(html))!==null) sz.push(m[1].trim().toUpperCase()); while((m=availRe.exec(html))!==null) av.push(m[1].trim());
      const n=Math.min(sz.length,av.length);
      for(let i=0;i<n;i++){ const s=sz[i], a=av[i]; const mm=a.match(/(\d+)\s*$/); const stock=mm?parseInt(mm[1],10):0; const status=stock>0?'IN_STOCK':'OUT_OF_STOCK'; for(const key of aliasCandidates(s)) map[key]={ status, stock }; }
    }
    return map;
  }

  // ---- Markeren + jump-flash ----
  const resolveRemote=(map,label)=>{ for(const c of aliasCandidates(label)){ if(map[c]) return map[c]; } return undefined; };
  function jumpFlash(el){
    if(!el) return;
    try{
      el.scrollIntoView({ behavior:'smooth', block:'center' });
      const oldBox=el.style.boxShadow;
      el.style.boxShadow='0 0 0 2px rgba(255,255,0,.9), 0 0 12px rgba(255,255,0,.9)';
      setTimeout(()=>{ el.style.boxShadow=oldBox||''; }, 650);
    }catch{}
  }
  function applyRulesAndMark(localTable, statusMap){
    const rows=localTable.querySelectorAll('tbody tr'); const report=[]; let firstMut=null;
    rows.forEach(row=>{
      const maat=(row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local=parseInt((row.children[1]?.textContent||'').trim(),10)||0;
      const remote=resolveRemote(statusMap, maat);
      const st=remote?.status; const stockNum=Number(remote?.stock ?? 0)||0;
      const supVal=(st==='IN_STOCK') ? (stockNum||1) : (st ? 0 : -1);
      const effAvail=supVal>0;

      row.style.background=''; row.style.transition='background-color .25s'; row.title=''; row.classList.remove('status-green','status-red'); delete row.dataset.status;
      let actie='none';
      if(local>0 && (st==='OUT_OF_STOCK'||st==='LOW')){
        row.style.background='#f8d7da'; row.title=(st==='LOW')?'Uitboeken (HOM backorder/laag)':'Uitboeken (HOM uitverkocht)'; row.dataset.status='remove'; row.classList.add('status-red'); actie='uitboeken';
        if(!firstMut) firstMut=row;
      } else if(local===0 && effAvail){
        row.style.background='#d4edda'; row.title='Bijboeken 2 (HOM op voorraad)'; row.dataset.status='add'; row.classList.add('status-green'); actie='bijboeken_2';
        if(!firstMut) firstMut=row;
      } else if(local===0 && !effAvail){
        row.title=(st ? 'Negeren (HOM niet op voorraad)' : 'Negeren (maat onbekend bij HOM → 0)'); actie='negeren';
      }
      report.push({ maat, local, sup:supVal, actie });
    });
    if(firstMut) jumpFlash(firstMut);
    return report;
  }
  const bepaalLogStatus=(report,statusMap)=>{
    const counts=report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {}); const nUit=counts.uitboeken||0, nBij=counts.bijboeken_2||0;
    const leeg=!statusMap || Object.keys(statusMap).length===0; if(leeg) return 'niet-gevonden'; if(report.length>0 && nUit===0 && nBij===0) return 'ok'; return 'afwijking';
  };

  // ---- Advanced flow ----
  async function openArticleViewViaPostback(pidColor){
    const mv=await httpGET(MODELVIEW_URL);
    if (isLoginPage(mv)) throw new Error('LOGIN_REQUIRED');
    const doc=parseHTML(mv); const vs=pickViewState(doc); const item=findModelItem(doc,pidColor);
    if(!vs || !vs.__VIEWSTATE || !item?.eventTarget) throw new Error('TARGET_NOT_FOUND');
    const payload={ __EVENTTARGET:item.eventTarget, __EVENTARGUMENT:'', __VIEWSTATE:vs.__VIEWSTATE, __VIEWSTATEGENERATOR:vs.__VIEWSTATEGENERATOR||'', __EVENTVALIDATION:vs.__EVENTVALIDATION||'' };
    const resp=await httpPOST(MODELVIEW_URL, payload);
    if (isLoginPage(resp)) throw new Error('LOGIN_REQUIRED');
    if (!/gridSize|gridAvailTxt|color-size-grid/i.test(resp)) return await httpGET(ARTICLEVIEW_URL);
    return resp;
  }
  async function runAdvanced(btn){
    if(!bridgeIsOnlineByHeartbeat()){ alert('Bridge offline. Log in bij de leverancier, houdt dat tabblad open en refresh deze pagina.'); return; }
    const quick=await httpGET(ARTICLEVIEW_URL);
    if (isLoginPage(quick)){ alert('Niet ingelogd op HOM. Log in op HOM-tab.'); return; }

    const tables=Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen in #output.'); return; }

    const progress=StockKit.makeProgress(btn); progress.start(tables.length);
    let total=0, idx=0, backoff=CONFIG.NAV.backoffStart;

    for(const table of tables){
      idx++;
      const pidColor=(table.id||'').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pidColor || 'onbekend';
      const anchorId = pidColor || label;

      try{
        const html = await openArticleViewViaPostback(pidColor);
        console.info('[HOM][adv] Geopend voor', pidColor, '→', articleSummary(html));
        const statusMap=buildStatusMapFromArticleView(html);
        if (!statusMap || Object.keys(statusMap).length===0){
          Logger.status(anchorId,'niet-gevonden'); Logger.perMaat(anchorId,[]); progress.setDone(idx);
          await delay(backoff); backoff=Math.min(CONFIG.NAV.backoffMax, backoff*1.5);
          continue;
        }
        const report=applyRulesAndMark(table,statusMap);
        total += report.filter(r=>r.actie==='uitboeken'||r.actie==='bijboeken_2').length;
        Logger.status(anchorId, bepaalLogStatus(report,statusMap));
        Logger.perMaat(anchorId, report);
        backoff=CONFIG.NAV.backoffStart;
      }catch(e){
        console.error('[HOM][adv]', e);
        if (String(e.message||e)==='LOGIN_REQUIRED'){ alert('HOM wil opnieuw inloggen. Stop advanced. Log in en probeer opnieuw.'); break; }
        if (String(e.message||e)==='TARGET_NOT_FOUND'){ Logger.status(anchorId,'niet-gevonden'); Logger.perMaat(anchorId,[]); }
        else { Logger.status(anchorId,'afwijking'); Logger.perMaat(anchorId,[]); }
      }
      progress.setDone(idx);
      await delay(CONFIG.NAV.throttleMin + Math.random()*(CONFIG.NAV.throttleMax - CONFIG.NAV.throttleMin));
      if (backoff>CONFIG.NAV.backoffStart) await delay(backoff);
    }
    progress.success(total);
  }

  // ============ UI mounting (HOM-only) ============
  function cleanupLegacyButton(){
    const legacy = document.querySelectorAll('#adv-hom-btn');
    legacy.forEach(el => {
      // Verwijder ALLES met dit id (oude varianten met inline .dot etc.)
      try{ el.remove(); }catch{}
    });
  }

  function isHomSelected(){
    const sel=document.querySelector('#leverancier-keuze');
    if(!sel) return false; // knop pas mogelijk als er een select is en user HOM kiest
    const val=norm(sel.value||''); const txt=norm(sel.options[sel.selectedIndex]?.text||'');
    const blob = `${val} ${txt}`;
    // ruim: "hom" of "huber" ergens in value/label
    return /\bhom\b/.test(blob) || /huber/.test(blob);
  }

  function ensureButton(){
    let btn=document.getElementById('adv-hom-btn');
    if (btn) return btn;

    btn=document.createElement('button');
    btn.id='adv-hom-btn';
    btn.className='sk-btn';
    btn.type='button';
    btn.textContent='Check HOM Stock';

    // jouw inline stijl + ruimte voor badge
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
    badge.className='hom-badge';
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
    badge.textContent=''; // alleen kleur

    // belangrijk: positioneringscontext voor absolute badge
    btn.style.position = 'fixed'; // fixed is ok (gepositioneerd element)
    btn.appendChild(badge);

    btn.addEventListener('click', ()=>runAdvanced(btn));
    document.body.appendChild(btn);

    // heartbeat → badge-kleur
    const setBadge=(ok)=>{ badge.style.background = ok ? '#24b300' : 'red'; };
    setBadge(bridgeIsOnlineByHeartbeat());
    GM_addValueChangeListener(HEARTBEAT_KEY, (_n,_o,_t)=> setBadge(true));

    return btn;
  }

  function maybeMountOrRemove(){
    const hasTables = !!document.querySelector('#output table');
    const need = isHomSelected();

    const existing = document.getElementById('adv-hom-btn');

    if (need){
      const btn = ensureButton();
      btn.style.display = hasTables ? 'block' : 'none';
    } else {
      if (existing) { try{ existing.remove(); }catch{} }
    }
  }

  function bootUI(){
    // 1) Verwijder legacy knoppen van oudere scripts
    cleanupLegacyButton();

    // 2) Observeer select & output
    const sel=document.querySelector('#leverancier-keuze');
    if (sel) sel.addEventListener('change', maybeMountOrRemove);

    const out=document.querySelector('#output');
    if (out) new MutationObserver(maybeMountOrRemove).observe(out,{ childList:true, subtree:true });

    // 3) Eerste evaluatie
    maybeMountOrRemove();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', bootUI);
  else bootUI();

  // keep-alive
  if (CONFIG.NAV.keepAlive){
    setInterval(()=>{ if(bridgeIsOnlineByHeartbeat()) httpGET(MODELVIEW_URL).catch(()=>{}); }, KEEPALIVE_MS);
  }
})();
