// ==UserScript==
// @name DDO Toolbox | Adapter | Anita/Rosa Faia
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.0
// @description Exacte Anita/Rosa Faia-stock uit B2B en EAN uit de Anita-sheet voor de DDO Toolbox.
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @grant GM_xmlhttpRequest
// @connect b2b.anita.com
// @connect docs.google.com
// @connect googleusercontent.com
// @connect *.googleusercontent.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-anita.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-anita.user.js
// ==/UserScript==
(() => {
  'use strict';
  const ID='anita',VERSION='1.0.0',UPDATE='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-anita.user.js';
  const SHEET='1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68',GID='2033780105',TTL=3600000;
  const TABLE='#tabs-3 table.options',PID='#tabs-1 input[name="supplier_pid"]',BRAND='#tabs-1 #select2-brand-container',AUTH_KEY='ddoAnitaAuthuser';
  let memory=null;
  const $=(selector,root=document)=>root.querySelector(selector);
  const decode=event=>{try{return JSON.parse(event.detail||'{}')}catch{return {}}};
  const send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  const norm=value=>String(value??'').toUpperCase().replace(/\s+/g,'').trim();
  const size=value=>{const text=norm(value).replace(/[^A-Z0-9]/g,'');const bandCup=text.match(/^(\d{1,3})([A-Z]{1,3})$/),cupBand=text.match(/^([A-Z]{1,3})(\d{1,3})$/);return bandCup?`${Number(bandCup[1])}${bandCup[2]}`:cupBand?`${Number(cupBand[2])}${cupBand[1]}`:text};
  const brand=()=>($(BRAND)?.getAttribute('title')||$(BRAND)?.textContent||$('#tabs-1 select[name="brand"] option:checked')?.textContent||'').toLowerCase();
  const isAnita=()=>/\banita\b|\brosa\s*faia\b/.test(brand());
  function pid(value){const raw=String(value??'').trim().toUpperCase().replace(/[_\s]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');const match=raw.match(/^(?:([A-Z]\d)-)?([A-Z0-9]+(?:-[A-Z0-9]+)*)-(\d{3})[A-Z]*$/);if(!match)throw Error(`Supplier PID vereist artikel plus 3-cijferige kleurcode: ${raw||'leeg'}`);return{article:match[2],color:match[3],koll:match[1]||''}}
  function announce(){const available=isAnita();send('adapter-state',{id:ID,label:'Anita/Rosa Faia',version:VERSION,updateUrl:UPDATE,priority:75,available,reason:available?'':'Geen Anita/Rosa Faia-merk'})}
  function status(request,text,kind='busy',done=false,changed=0){send('adapter-status',{requestId:request.requestId,text,kind,done,changed,autoSave:!!request.autoSave})}
  function get(url,accept='*/*'){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,withCredentials:true,timeout:25000,headers:{Accept:accept},onload:response=>resolve(response),onerror:()=>reject(Error('Netwerkfout')),ontimeout:()=>reject(Error('Timeout'))}))}

  function csv(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field);rows.push(row);row=[];field=''}else if(c!=='\r')field+=c}row.push(field);rows.push(row);return rows.filter(r=>r.some(v=>String(v).trim()))}
  const parseRows=(kind,text)=>kind==='tsv'?text.split(/\r?\n/).map(line=>line.split('\t')).filter(row=>row.some(v=>v.trim())):csv(text);
  function sheetKey(item){return`ddoAnitaSheet:${item.koll}:${item.article}:${item.color}`}
  function readSheet(item){try{const data=JSON.parse(localStorage.getItem(sheetKey(item))||'null');return data?.version===1&&Date.now()-data.time<TTL&&Array.isArray(data.entries)?new Map(data.entries):null}catch{return null}}
  function saveSheet(item,map){try{localStorage.setItem(sheetKey(item),JSON.stringify({version:1,time:Date.now(),entries:[...map]}))}catch(error){console.warn('[DDO Adapter / Anita] Compacte cache niet opgeslagen',error)}}
  function authUsers(){const saved=Number(localStorage.getItem(AUTH_KEY));return[...new Set([Number.isInteger(saved)&&saved>=0&&saved<=5?saved:0,0,1,2,3,4,5])]}
  async function sheetRows(){for(const user of authUsers())for(const kind of ['tsv','csv']){const path=kind==='tsv'?`export?format=tsv&gid=${GID}&authuser=${user}`:`gviz/tq?tqx=out:csv&gid=${GID}&authuser=${user}`;try{const response=await get(`https://docs.google.com/spreadsheets/d/${SHEET}/${path}`);if(response.status!==200||!response.responseText?.trim()||/^\s*</.test(response.responseText))continue;localStorage.setItem(AUTH_KEY,String(user));return parseRows(kind,response.responseText)}catch{}}throw Error('Anita-sheet niet bereikbaar; controleer het ingelogde Google-account')}
  function sheetMap(rows,item){if(!rows.length)throw Error('Anita-sheet is leeg');const h=rows[0].map(v=>String(v).trim().toLowerCase()),find=(...labels)=>h.findIndex(v=>labels.includes(v));let ix={koll:find('koll','prefix'),article:find('artikelnummer','artikel nr','artikel','artikelcode','model','modelnummer','model nr'),color:find('kleurcode','kleur code','color code','fbnr','kleur'),cup:find('cup','cupmaat','cup size'),band:find('maat','band','bandmaat','size'),ean:find('ean','barcode')};const withKoll=ix.koll>=0||rows.slice(1,20).some(row=>/^M[345]$/.test(norm(row[0])));if(ix.koll<0&&withKoll)ix.koll=0;if(ix.article<0)ix.article=withKoll?1:0;if(ix.color<0)ix.color=withKoll?3:2;if(ix.cup<0)ix.cup=withKoll?5:4;if(ix.band<0)ix.band=withKoll?6:5;if(ix.ean<0)ix.ean=withKoll?7:6;const map=new Map();for(const row of rows.slice(1)){const rawArticle=norm(row[ix.article]),parts=rawArticle.match(/^(?:(M[345])-)?([A-Z0-9]+(?:-[A-Z0-9]+)*?)(?:-(\d{3}))?$/),article=parts?.[2]||rawArticle,color=/^\d{3}$/.test(norm(row[ix.color]))?norm(row[ix.color]):parts?.[3]||'',koll=norm(row[ix.koll])||parts?.[1]||'';if(article!==item.article||color!==item.color||(item.koll&&koll!==item.koll))continue;const band=norm(row[ix.band]),cup=norm(row[ix.cup]),key=size(band&&cup?`${band}${cup}`:band||cup),ean=String(row[ix.ean]||'').trim();if(!key||!/^\d{8,14}$/.test(ean))continue;const old=map.get(key);if(old&&old!==ean)throw Error(`Conflicterende exacte Anita-EAN voor ${key}`);map.set(key,ean)}return map}
  async function eans(item,force){if(!force){const cached=readSheet(item);if(cached)return cached;if(memory?.key===sheetKey(item)&&Date.now()-memory.time<TTL)return memory.map}const map=sheetMap(await sheetRows(),item);if(map.size){memory={key:sheetKey(item),time:Date.now(),map};saveSheet(item,map)}return map}

  function stockNumber(td){const input=td.querySelector('input[data-in-stock]'),node=input||td.querySelector('[data-in-stock]')||(td.hasAttribute('data-in-stock')?td:null);if(!node)return null;const raw=node.getAttribute('data-in-stock');return /^\d+$/.test(String(raw||'').trim())?Number(raw):null}
  const mappedStock=n=>n===null?null:n<3?1:n===3?3:n===4?4:5;
  const band=value=>/^\d{1,3}$/.test(norm(value)),cup=value=>/^[A-Z]{1,3}$/.test(norm(value)),splitCup=value=>/^[A-Z]{1,2}[/-][A-Z]{1,2}$/.test(norm(value)),single=value=>/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/.test(norm(value)),combo=value=>/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)[/-](XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)$/.test(norm(value));
  function cellSize(rowLabel,colLabel,td){
    const r=norm(rowLabel),c=norm(colLabel),explicit=td.getAttribute('data-size')||td.querySelector('[data-size]')?.getAttribute('data-size')||td.getAttribute('data-band')&&`${td.getAttribute('data-band')}${td.getAttribute('data-cup')||''}`;
    if(band(r)&&(cup(c)||splitCup(c)))return size(`${r}${c}`);
    if(band(c)&&(cup(r)||splitCup(r)))return size(`${c}${r}`);
    if(combo(r)||single(r))return size(r);
    if(combo(c)||single(c))return size(c);
    if(explicit)return size(explicit);
    if(band(r)&&!band(c)&&!cup(c)&&!splitCup(c))return size(r);
    if(band(c)&&!band(r)&&!cup(r)&&!splitCup(r))return size(c);
    return '';
  }
  function stockMap(html,item){const doc=new DOMParser().parseFromString(html,'text/html'),tables=[...doc.querySelectorAll('table[data-x="do-not-delete"][data-color-number]')].filter(table=>table.getAttribute('data-color-number')===item.color),map=new Map();if(!tables.length)throw Error(`Geen exacte Anita-kleurtabel voor ${item.color}`);for(const table of tables){const heads=[...table.querySelectorAll('thead tr')].map(row=>[...row.querySelectorAll('th')].map(th=>th.textContent.trim())).sort((a,b)=>b.reduce((score,label)=>score+Number(band(label)||cup(label)||splitCup(label)||single(label)||combo(label)),0)-a.reduce((score,label)=>score+Number(band(label)||cup(label)||splitCup(label)||single(label)||combo(label)),0))[0]||[];for(const row of table.querySelectorAll('tbody tr')){const label=row.querySelector('th')?.textContent.trim()||'',cells=[...row.querySelectorAll('td')],columns=heads.length===cells.length+1?heads.slice(1):heads.slice(-cells.length);cells.forEach((td,index)=>{const key=cellSize(label,columns[index]||'',td),value=mappedStock(stockNumber(td));if(!key||value===null)return;const known=map.get(key);if(known!==undefined&&known!==value)throw Error(`Conflicterende exacte Anita-stock voor ${key}`);map.set(key,value)})}}return map}
  async function stocks(item){const url=new URL('https://b2b.anita.com/nl/shop/441/');url.search=new URLSearchParams({fssc:'N',vsas:'',koll:item.koll,form:'',vacp:'',arnr:item.article,vakn:'',sicht:'S',fbnr:item.color}).toString();const response=await get(url.href,'text/html,application/xhtml+xml');if(response.status!==200||!response.responseText)throw Error(`Anita B2B gaf HTTP ${response.status}`);return stockMap(response.responseText,item)}
  function setInput(field,value){const next=String(value);if(!field||field.value===next)return false;field.value=next;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));return true}
  function apply(stock,ean){let changed=0,matched=0;const missing=[];document.querySelectorAll(`${TABLE} tbody tr`).forEach(row=>{const raw=$('input.product_option_small',row)?.value||$('td:first-child input',row)?.value||$('td:first-child',row)?.textContent,key=size(raw);if(!key)return;const barcode=ean.get(key),amount=stock.get(key);if(barcode===undefined&&amount===undefined){missing.push(raw?.trim());return}matched++;let altered=false;if(barcode!==undefined)altered=setInput($('input[name$="[barcode]"]',row),barcode)||altered;if(amount!==undefined)altered=setInput($('input[name$="[stock]"]',row),amount)||altered;if(altered)changed++});if(missing.length)console.warn('[DDO Adapter / Anita] Maten zonder exacte match',missing);return{changed,matched,missing:missing.length}}
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async event=>{const request=decode(event);if(request.id!==ID)return;let item;try{item=pid($(PID)?.value)}catch(error){status(request,error.message,'error',true);return}try{status(request,'Anita-stock en EAN ophalen…');const stock=await stocks(item),ean=await eans(item,!!request.forceRefresh);if(!stock.size&&!ean.size)throw Error('Geen exacte stock- of EAN-matches');const result=apply(stock,ean);status(request,`${result.changed} rijen aangepast · ${result.missing} zonder match`,'success',true,result.changed)}catch(error){console.error('[DDO Adapter / Anita]',error);status(request,error.message||'Anita ophalen mislukt','error',true)}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();
