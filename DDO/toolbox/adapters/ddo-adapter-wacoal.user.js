// ==UserScript==
// @name DDO Toolbox | Adapter | Wacoal Group
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.1.3
// @description Wacoal-locaties, brondata en parsing voor de DDO Toolbox.
// @match https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant GM_xmlhttpRequest
// @connect b2b.wacoal-europe.com
// @connect docs.google.com
// @connect googleusercontent.com
// @connect *.googleusercontent.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-wacoal.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-wacoal.user.js
// ==/UserScript==
(() => {
  'use strict';
  const ID='wacoal-group', VERSION='1.1.3', SHEET='1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68', GID='869563904';
  const TABLE='#tabs-3 table.options', PID='#tabs-1 input[name="supplier_pid"]', BRAND='#tabs-1 #select2-brand-container', TTL=3600000;
  const $=(s,r=document)=>r.querySelector(s), norm=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'').replace(/[–—]/g,'-').replace(/^XL\/2L$/,'XL/XXL');
  let memorySheetCache=null;
  try{
    localStorage.removeItem(`ddoWacoalSheet:${SHEET}:${GID}`);
    localStorage.removeItem(`ddoAdapterWacoalSheet:${SHEET}:${GID}`);
  }catch{}
  const decode=e=>{try{return JSON.parse(e.detail||'{}')}catch{return {}}}, send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  function basePid(v){const first=String(v||'').trim().toUpperCase().split(/[\s,;]+/)[0]||'';return first.split('-')[0].replace(/[^A-Z0-9]/g,'')}
  function brandKey(){const n=$(BRAND),v=(n?.getAttribute('title')||n?.textContent||'').toLowerCase();if(/freya[ -]swim/.test(v))return'freya-swim';if(/elomi[ -]swim/.test(v))return'elomi-swim';if(/fantasie[ -]swim/.test(v))return'fantasie-swim';return['wacoal','freya','elomi','fantasie'].find(x=>v.includes(x))||''}
  function announce(){send('adapter-state',{id:ID,label:'Wacoal',version:VERSION,updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-wacoal.user.js',priority:100,available:!!brandKey(),reason:brandKey()?'':'Geen Wacoal Group-merk'})}
  function status(req,text,kind='busy',done=false,changed=0,autoSave=false){send('adapter-status',{requestId:req,text,kind,done,changed,autoSave})}
  function get(url,headers={}){return new Promise((ok,no)=>GM_xmlhttpRequest({method:'GET',url,headers,anonymous:false,onload:ok,onerror:()=>no(Error('Netwerkfout')),ontimeout:()=>no(Error('Timeout'))}))}
  const html=t=>/^\s*<!doctype html/i.test(t)||/<html\b/i.test(t);
  function qty(n){n=Number(n)||0;return n<=0?0:n<=2?1:n===3?2:n===4?3:5}
  const level=n=>Number(n?.stock?.stockLevel)||0, stage=n=>String(n?.stock?.wacoalstockStatus||'').toUpperCase().trim();
  function mapped(n){const l=level(n),s=stage(n);if(!s&&l<=0)return 0;if(s==='IN_STOCK')return l>0?qty(l):1;return s?1:qty(l)}
  const rank=s=>({IN_STOCK:4,WITHIN_STAGE1:3,WITHIN_STAGE2:2})[String(s||'').toUpperCase()]||(s?1:0);
  function best(map,key,node){const x={mapped:mapped(node),stage:stage(node)},old=map.get(key);if(!old||x.mapped>old.mapped||(x.mapped===old.mapped&&rank(x.stage)>rank(old.stage)))map.set(key,x)}
  function parseStock(json){const exact=new Map(),band=new Map(),data=Array.isArray(json?.sizeData)?json.sizeData:[];if(json?.is2DSizing)data.forEach(b=>(b?.sizeFitData||[]).forEach(v=>{const size=norm(v?.countrySizeMap?.EU),cup=norm(v?.countryFitMap?.EU);if(size&&cup){best(exact,norm(size+cup),v);best(band,size,v)}}));else data.forEach(v=>{const size=norm(v?.countrySizeMap?.EU);if(size)best(band,size,v)});return{exact,band}}
  async function stock(pid){const r=await get(`https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(pid)}`,{Accept:'application/json'});if(r.status<200||r.status>=300)throw Error(`Stock HTTP ${r.status}`);if(html(r.responseText))throw Error('Log eerst in bij Wacoal B2B');try{return JSON.parse(r.responseText)}catch{throw Error('Ongeldige stockdata')}}
  async function sheet(force){
    if(!force&&memorySheetCache&&Date.now()-memorySheetCache.ts<TTL)return memorySheetCache.text;
    let saved=NaN;
    try{saved=Number(localStorage.getItem('ddoWacoalAuthUser'))}catch{}
    const users=[...new Set([Number.isFinite(saved)?saved:0,0,1,2,3,4,5])];
    for(const user of users){
      const r=await get(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=tsv&gid=${GID}&authuser=${user}`,{Accept:'*/*'});
      if(r.status>=200&&r.status<300&&r.responseText&&!html(r.responseText)){
        const fresh={text:r.responseText,ts:Date.now()};
        memorySheetCache=fresh;
        try{localStorage.setItem('ddoWacoalAuthUser',String(user))}catch{}
        return fresh.text;
      }
    }
    throw Error('Geen toegang tot de Wacoal EAN-sheet');
  }
  function eans(tsv,pid){const map=new Map(),p1=basePid(pid),p2=p1.replace(/^WA/,'');tsv.split(/\r?\n/).slice(1).forEach(line=>{const c=line.split('\t'),sku=String(c[2]||'').toUpperCase().replace(/[^A-Z0-9]/g,''),ean=String(c[1]||'').replace(/\D/g,''),size=norm(c[0]);if(size&&ean&&(sku.startsWith(p1)||(p2&&sku.startsWith(p2))))map.set(size,ean)});return map}
  const eanCacheKey=pid=>`ddoWacoalEans:${basePid(pid)}`;
  function readEanCache(pid){try{const cache=JSON.parse(localStorage.getItem(eanCacheKey(pid))||'null');if(!cache||Date.now()-cache.ts>TTL||!Array.isArray(cache.entries))return null;return new Map(cache.entries)}catch{return null}}
  function writeEanCache(pid,map){if(!map.size)return;try{localStorage.setItem(eanCacheKey(pid),JSON.stringify({ts:Date.now(),entries:[...map.entries()]}))}catch(error){console.warn('[DDO Adapter / Wacoal] Compacte EAN-cache kon niet worden opgeslagen.',error)}}
  async function getEans(pid,force){if(!force){const cached=readEanCache(pid);if(cached)return{map:cached,fromCache:true}}const map=eans(await sheet(!!force),pid);writeEanCache(pid,map);return{map,fromCache:false}}
  function input(el,v){el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
  function apply(s,e){let changed=0;document.querySelectorAll(`${TABLE} tbody tr`).forEach(row=>{const size=norm($('input.product_option_small',row)?.value),sv=s.exact.get(size)||s.band.get(size),ev=e.get(size),si=$('input[name$="[stock]"]',row),ei=$('input[name$="[barcode]"]',row);let yes=false;if(si&&sv&&si.value!==String(sv.mapped)){input(si,sv.mapped);yes=true}if(ei&&ev&&ei.value!==ev){input(ei,ev);yes=true}if(yes)changed++});return changed}
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async e=>{const d=decode(e);if(d.id!==ID)return;const pid=basePid($(PID)?.value);if(!pid)return status(d.requestId,'Geen Supplier PID','error',true,0,d.autoSave);try{status(d.requestId,'Wacoal stock laden…');const json=await stock(pid);status(d.requestId,d.forceRefresh?'EAN-sheet vernieuwen…':'EAN-cache controleren…');const eanResult=await getEans(pid,!!d.forceRefresh),changed=apply(parseStock(json),eanResult.map);status(d.requestId,`${changed} rijen gevuld${eanResult.fromCache?' · EAN-cache':''}`,changed?'success':'error',true,changed,!!d.autoSave)}catch(err){console.error('[DDO Adapter / Wacoal]',err);status(d.requestId,err.message||'Ophalen mislukt','error',true)}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();
