// ==UserScript==
// @name DDO Toolbox | Adapter | Lisca
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.1
// @description Exacte Lisca/Lisca Swimwear EAN- en stockkoppeling voor de DDO Toolbox.
// @match https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant GM_xmlhttpRequest
// @connect docs.google.com
// @connect googleusercontent.com
// @connect *.googleusercontent.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-lisca.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-lisca.user.js
// ==/UserScript==
(() => {
  'use strict';
  const ID='lisca',VERSION='1.0.1',SHEET='1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww',GID='933070542',TTL=120000,CACHE_SCHEMA=2;
  const TABLE='#tabs-3 table.options',PID='#tabs-1 input[name="supplier_pid"]',BRAND='#tabs-1 #select2-brand-container';
  const $=(selector,root=document)=>root.querySelector(selector),decode=event=>{try{return JSON.parse(event.detail||'{}')}catch{return {}}},send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  let sheetMemory=null;
  function normSize(value){let size=String(value||'').toUpperCase().replace(/\s+/g,'').replace(/\(.*?\)/g,'').trim();if(size==='2XL')return'XXL';const xl=size.match(/^(\d+)XL$/);if(xl)size='X'.repeat(Number(xl[1]))+'L';return size}
  function normColor(value){const color=String(value||'').trim().toUpperCase();return /^\d+$/.test(color)?String(Number(color)):color}
  function parsePid(value){const match=String(value||'').trim().toUpperCase().match(/^(\d+)\s*-\s*([A-Z0-9]+)$/);return match?{article:match[1],color:normColor(match[2]),cacheId:`${match[1]}-${normColor(match[2])}`}:{article:'',color:'',cacheId:''}}
  function isLisca(){const node=$(BRAND),selected=$('#tabs-1 select[name="brand"] option:checked'),value=(node?.getAttribute('title')||node?.textContent||selected?.textContent||'').trim().toLowerCase();return /\blisca\b/.test(value)}
  function announce(){const available=isLisca();send('adapter-state',{id:ID,label:'Lisca',version:VERSION,updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-lisca.user.js',priority:70,available,reason:available?'':'Geen Lisca-merk'})}
  function status(requestId,text,kind='busy',done=false,changed=0,autoSave=false){send('adapter-status',{requestId,text,kind,done,changed,autoSave})}
  function get(url){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,withCredentials:true,timeout:20000,headers:{Accept:'text/csv,text/plain,*/*;q=0.8'},onload:response=>resolve(response),onerror:()=>reject(Error('Netwerkfout bij Lisca-sheet')),ontimeout:()=>reject(Error('Timeout bij Lisca-sheet'))}))}
  const validSheet=response=>response?.status===200&&typeof response.responseText==='string'&&response.responseText.trim()&&!/^\s*</.test(response.responseText);
  async function sheet(force){if(!force&&sheetMemory&&Date.now()-sheetMemory.time<TTL)return sheetMemory.text;const urls=[`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`];for(let user=0;user<=9;user++)urls.push(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}&authuser=${user}`,`https://docs.google.com/u/${user}/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`);for(const url of urls){try{const response=await get(url);if(validSheet(response)){sheetMemory={time:Date.now(),text:response.responseText};return sheetMemory.text}}catch{}}throw Error('Geen toegang tot de Lisca EAN-sheet')}
  function csv(text){const rows=[];let field='',row=[],quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){field+='"';i++}else if(char==='"')quoted=false;else field+=char}else if(char==='"')quoted=true;else if(char===','){row.push(field);field=''}else if(char==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(char!=='\r')field+=char}row.push(field);rows.push(row);return rows}
  function stock(raw){if(String(raw??'').trim()==='')return null;const value=Number.parseInt(raw,10);if(!Number.isFinite(value))return null;if(value<=2)return 1;if(value===3)return 2;if(value===4)return 3;return 5}
  function sizeKey(base,cupIndex){const index=Number.parseInt(cupIndex||'0',10);if(!Number.isInteger(index)||index<0||index>26)return'';if(index===0)return normSize(base);return normSize(`${base}${String.fromCharCode(64+index)}`)}
  function buildMap(text,pid){const map=new Map();for(const columns of csv(text)){const article=String(columns[0]||'').trim(),color=normColor(columns[2]),size=sizeKey(columns[4],columns[3]);if(article!==pid.article||color!==pid.color||!size)continue;const rawEan=String(columns[5]||'').trim(),ean=/^\d{8,14}$/.test(rawEan)?rawEan:'',mappedStock=stock(columns[6]),entry={ean,stock:mappedStock,row:columns};if(!ean&&!Number.isFinite(mappedStock))continue;const known=map.get(size);if(!known){map.set(size,entry);continue}if(known.ean&&ean&&known.ean!==ean)throw Error(`Conflicterende exacte Lisca-EAN voor ${size}`);if(Number.isFinite(known.stock)&&Number.isFinite(mappedStock)&&known.stock!==mappedStock)throw Error(`Conflicterende exacte Lisca-stock voor ${size}`);map.set(size,{ean:known.ean||ean,stock:Number.isFinite(known.stock)?known.stock:mappedStock,row:known.row})}return map}
  const cacheKey=pid=>`ddoLisca:${pid.cacheId}`;
  function readCache(pid){try{const cached=JSON.parse(localStorage.getItem(cacheKey(pid))||'null');if(!cached||cached.schema!==CACHE_SCHEMA||Date.now()-cached.time>TTL||!Array.isArray(cached.entries))return null;return new Map(cached.entries)}catch{return null}}
  function writeCache(pid,map){try{localStorage.setItem(cacheKey(pid),JSON.stringify({schema:CACHE_SCHEMA,time:Date.now(),entries:[...map.entries()].map(([size,value])=>[size,{ean:value.ean,stock:value.stock}])}))}catch(error){console.warn('[DDO Adapter / Lisca] Compacte cache kon niet worden opgeslagen.',error)}}
  async function data(pid,force){if(!force){const cached=readCache(pid);if(cached)return cached}const map=buildMap(await sheet(!!force),pid);if(map.size)writeCache(pid,map);return map}
  function input(element,value){element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))}
  function apply(map){let changed=0;const unmatched=[];document.querySelectorAll(`${TABLE} tbody tr`).forEach(row=>{const sizeField=$('input.product_option_small',row)||$('td:first-child select,td:first-child input',row),rawSize=sizeField?.value||$('td:first-child',row)?.textContent,size=normSize(rawSize),entry=map.get(size),ean=$('input[name$="[barcode]"]',row),stockInput=$('input[name$="[stock]"]',row);if(!entry){if(size)unmatched.push({local:String(rawSize||'').trim(),normalized:size});return}let altered=false;if(ean&&entry.ean&&ean.value!==entry.ean){input(ean,entry.ean);altered=true}if(stockInput&&Number.isFinite(entry.stock)&&stockInput.value!==String(entry.stock)){input(stockInput,entry.stock);altered=true}if(altered)changed++});if(unmatched.length)console.warn('[DDO Adapter / Lisca] Lokale maten zonder exacte sheetmatch',{unmatched,remoteSizes:[...map.keys()]});return changed}
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async event=>{const request=decode(event);if(request.id!==ID)return;const pid=parsePid($(PID)?.value);if(!pid.article||!pid.color)return status(request.requestId,'Lisca Supplier PID vereist exact ARTIKEL-KLEUR','error',true,0,request.autoSave);try{status(request.requestId,request.forceRefresh?'Lisca-sheet vernieuwen…':'Lisca-cache controleren…');const map=await data(pid,!!request.forceRefresh);if(!map.size)return status(request.requestId,'Geen exacte Lisca-regels voor dit product','error',true,0,request.autoSave);const changed=apply(map);status(request.requestId,`${changed} rijen exact gevuld`,'success',true,changed,!!request.autoSave)}catch(error){console.error('[DDO Adapter / Lisca]',error);status(request.requestId,error.message||'Ophalen mislukt','error',true,0,request.autoSave)}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();
