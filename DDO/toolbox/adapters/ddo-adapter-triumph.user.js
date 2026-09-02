// ==UserScript==
// @name DDO Toolbox | Adapter | Triumph + Sloggi
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.1
// @description Triumph/Sloggi-locaties, sessie, stock en EAN-parsing voor de DDO Toolbox.
// @match https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @match https://b2b.triumph.com/*
// @grant GM_xmlhttpRequest
// @grant GM_setValue
// @grant GM_getValue
// @connect b2b.triumph.com
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-triumph.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-triumph.user.js
// ==/UserScript==
(() => {
  'use strict';
  const ID='triumph-sloggi', VERSION='1.0.1', SESSION_KEY='ddoTriumphSession';
  const TABLE='#tabs-3 table.options', PID='#tabs-1 input[name="supplier_pid"]', BRAND='#tabs-1 #select2-brand-container';
  const $=(s,r=document)=>r.querySelector(s), norm=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  const decode=e=>{try{return JSON.parse(e.detail||'{}')}catch{return {}}};
  const send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));

  function meta(url){const m=String(url||'').match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);return m?{webstoreId:m[1],cartId:m[2]}:{}}
  function session(){const value=GM_getValue(SESSION_KEY,null);if(!value)return null;if(typeof value==='object')return value;return{auth:String(value),webstoreId:null,cartId:null}}
  function remember(auth,url,via){const token=String(auth||'').trim();if(!/^Bearer\s+/i.test(token))return;const old=session()||{},ids=meta(url),next={auth:token,webstoreId:ids.webstoreId||old.webstoreId||null,cartId:ids.cartId||old.cartId||null};GM_setValue(SESSION_KEY,next);console.info('[DDO Adapter / Triumph] Sessie bijgewerkt via',via)}
  function authorization(headers){if(!headers)return'';if(typeof headers.get==='function')return headers.get('authorization')||headers.get('Authorization')||'';if(Array.isArray(headers))return headers.find(([key])=>/^authorization$/i.test(key))?.[1]||'';return Object.entries(headers).find(([key])=>/^authorization$/i.test(key))?.[1]||''}
  function installSniffer(){
    const originalFetch=window.fetch;
    if(typeof originalFetch==='function')window.fetch=function(resource,init={}){try{const url=typeof resource==='string'?resource:resource?.url,auth=authorization(init.headers)||authorization(resource?.headers);remember(auth,url,'fetch')}catch(error){console.warn('[DDO Adapter / Triumph] Fetch-sniffer:',error)}return originalFetch.apply(this,arguments)};
    const originalOpen=XMLHttpRequest.prototype.open,originalHeader=XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open=function(method,url){this.__ddoTriumphUrl=url;return originalOpen.apply(this,arguments)};
    XMLHttpRequest.prototype.setRequestHeader=function(name,value){if(/^authorization$/i.test(name))remember(value,this.__ddoTriumphUrl,'XHR');return originalHeader.apply(this,arguments)};
    console.info('[DDO Adapter / Triumph] Sessie-sniffer actief. Open een Triumph-product om de sessie te verversen.');
  }
  if(location.hostname==='b2b.triumph.com'){installSniffer();return}

  function brand(){const node=$(BRAND),fallback=$('#tabs-1 select[name="brand"] option:checked'),value=(node?.getAttribute('title')||node?.textContent||fallback?.textContent||'').toLowerCase();return value.includes('triumph')||value.includes('sloggi')}
  function announce(){send('adapter-state',{id:ID,label:'Triumph/Sloggi',version:VERSION,updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/adapters/ddo-adapter-triumph.user.js',priority:90,available:brand(),reason:brand()?'':'Geen Triumph- of Sloggi-merk'})}
  function status(requestId,text,kind='busy',done=false,changed=0,autoSave=false){send('adapter-status',{requestId,text,kind,done,changed,autoSave})}
  function splitPid(value){const pid=String(value||'').trim(),at=pid.lastIndexOf('-');return at>0&&at<pid.length-1?{base:pid.slice(0,at),color:pid.slice(at+1)}:null}
  function getGrid(url,auth){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,headers:{Accept:'application/json, text/plain, */*',Authorization:auth},onload:r=>{if(r.status<200||r.status>=300)return reject(Error(`Triumph HTTP ${r.status}`));try{resolve(JSON.parse(r.responseText))}catch{reject(Error('Ongeldige Triumph-griddata'))}},onerror:()=>reject(Error('Netwerkfout bij Triumph')),ontimeout:()=>reject(Error('Timeout bij Triumph'))}))}
  function productFor(json,color){const products=Array.isArray(json)?json:Array.isArray(json?.products)?json.products:[],wanted=norm(color),matches=products.filter(product=>[product?.userDefinedField1,product?.colorCode].some(code=>norm(code)===wanted));if(matches.length)return matches[0];if(products.length===1){console.warn('[DDO Adapter / Triumph] Geen exacte kleurmatch; enige grid-product gebruikt.');return products[0]}const colors=products.map(product=>product?.userDefinedField1||product?.colorCode).filter(Boolean).join(', ');throw Error(`Kleur ${color} niet gevonden${colors?` · beschikbaar: ${colors}`:''}`)}
  function qty(value){const n=Number(value)||0;return n<=0?0:n<=2?1:n===3?2:n===4?3:5}
  function sizes(json,color){const map=new Map(),product=productFor(json,color);for(const sku of Array.isArray(product?.skus)?product.skus:[]){const band=String(sku?.sizeName||sku?.sizeDisplayName||'').trim(),cup=String(sku?.subSizeName||sku?.subSizeDisplayName||'').trim(),size=norm(cup?band+cup:band),ean=String(sku?.eanCode||sku?.gtin||'').replace(/\D/g,''),level=sku?.stockLevels?.[0],available=Number(level?.quantity??level?.available??level?.qty??0)||0;if(!size||!ean)continue;const old=map.get(size),entry={ean,stock:qty(available),available};if(!old||available>old.available)map.set(size,entry)}return map}
  function input(element,value){element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))}
  function apply(map){let changed=0;document.querySelectorAll(`${TABLE} tbody tr`).forEach(row=>{const size=norm($('input.product_option_small',row)?.value),entry=map.get(size),stock=$('input[name$="[stock]"]',row),ean=$('input[name$="[barcode]"]',row);if(!entry)return;let rowChanged=false;if(stock&&stock.value!==String(entry.stock)){input(stock,entry.stock);rowChanged=true}if(ean&&ean.value!==entry.ean){input(ean,entry.ean);rowChanged=true}if(rowChanged)changed++});return changed}

  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async event=>{const data=decode(event);if(data.id!==ID)return;const pid=splitPid($(PID)?.value),saved=session();if(!pid)return status(data.requestId,'Supplier PID moet eindigen op -kleur','error',true,0,data.autoSave);if(!saved?.auth||!saved.webstoreId||!saved.cartId)return status(data.requestId,'Open eerst een product op Triumph B2B','error',true,0,data.autoSave);try{status(data.requestId,'Triumph-grid laden…');const url=`https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(saved.webstoreId)}/carts/${encodeURIComponent(saved.cartId)}/grid/${encodeURIComponent(pid.base)}/products`,map=sizes(await getGrid(url,saved.auth),pid.color),changed=apply(map);status(data.requestId,`${changed} rijen gevuld`,changed?'success':'error',true,changed,!!data.autoSave)}catch(error){console.error('[DDO Adapter / Triumph]',error);status(data.requestId,error.message||'Ophalen mislukt','error',true,0,data.autoSave)}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();
