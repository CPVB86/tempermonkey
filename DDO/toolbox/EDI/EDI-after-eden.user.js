// ==UserScript==
// @name DDO Toolbox | EDI | After Eden
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.10
// @description Modelcheck, Product, Maten, ordermodule en Stock Check voor After Eden / Elbrina.
// @match https://bcg.fashionportal.shop/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @match https://lingerieoutlet.nl/tools/stockv4/*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_download
// @connect docs.google.com
// @connect googleusercontent.com
// @connect *.googleusercontent.com
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_info
// @grant unsafeWindow
// @connect bcg.fashionportal.shop
// @connect dutchdesignersoutlet.com
// @connect www.dutchdesignersoutlet.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-idle
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-after-eden.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-after-eden.user.js
// ==/UserScript==
(() => {
'use strict';
// BEGIN SHARED EDI (generated; edit EDI/shared.js)
// Shared EDI contract. Bundled into userscripts by build-edi.cjs.
const DDO_EDI = (() => {
  function normalizeSize(value) {
    let size = String(value ?? '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '');
    size = ({'XL/2L':'XL/XXL','XL/2XL':'XL/XXL','3L/4L':'3XL/4XL'})[size] || size;
    return size.replace(/\b([2-5])XL\b/g, (_, n) => 'X'.repeat(Number(n)) + 'L');
  }
  function sizeCandidates(value) {
    const size = normalizeSize(value), match = size.match(/^(X{2,5})L$/);
    return match ? [size, `${match[1].length}XL`] : [size];
  }
  function parseEAN(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('input[type="password"]')) throw Error('Log eerst in bij LingaDore B2B');
    const values = new Set();
    for (const row of doc.querySelectorAll('tr')) {
      const label = row.querySelector('th,td');
      if (!/\bean\b/i.test(label?.textContent || '')) continue;
      const value = label.nextElementSibling?.textContent?.trim() || '';
      if (/^\d{8,14}$/.test(value)) values.add(value);
    }
    if (values.size > 1) throw Error('Meerdere EAN-codes voor één variant');
    return [...values][0] || '';
  }
  function variantMap(entries) {
    const map = new Map();
    for (const entry of entries) {
      const size = normalizeSize(entry.size), ean = String(entry.ean || '');
      if (!size || !/^\d{8,14}$/.test(ean)) throw Error('Ongeldige maat/EAN-regel');
      if (map.has(size) && map.get(size).ean !== ean) throw Error(`Conflicterende EAN voor ${size}`);
      map.set(size, {...entry, size, ean});
    }
    return map;
  }
  function eanTSV(entries, supplierId) {
    if (/[\t\r\n]/.test(supplierId)) throw Error('Ongeldig Supplier ID');
    return [...variantMap(entries).values()].map(e => `${e.size}\t${e.ean}\t${supplierId}`).join('\n');
  }
  const productClipboard = payload => `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  const sizesClipboard = (source, supplierId, sizes) => JSON.stringify({source, orderId:false, supplierId, sizes:[...new Set(sizes.map(normalizeSize))]}, null, 2);
  const theme = `
    #edi-lingadore{background:#fff;color:#25313b;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0002;font:12px/1.25 system-ui}
    #edi-lingadore [hidden]{display:none!important}
    #edi-lingadore .edi-head{min-height:28px;padding:0 8px;background:#263746;color:#fff;border:0;touch-action:none}
    #edi-lingadore .edi-version{font-size:9px;color:#fff}
    #edi-lingadore .edi-icon-btn{color:#fff;border-radius:4px}
    #edi-lingadore .edi-icon-btn:hover{background:#ffffff22}
    #edi-lingadore .edi-btn,#edi-lingadore .edi-action{border:0;border-radius:4px;background:#0877b9;color:#fff;font:600 11px/1.15 system-ui;min-height:27px;padding:4px 7px}
    #edi-lingadore .edi-btn:hover:not(:disabled),#edi-lingadore .edi-action:hover:not(:disabled){background:#18864b;color:#fff}
    #edi-lingadore .edi-danger{background:#c83939}
    #edi-lingadore button:disabled{background:#d6dce1;color:#7b858d;opacity:1;cursor:not-allowed}
    #edi-lingadore .edi-status{background:#f4f7f9;color:#56616a;border-radius:4px;font-size:10px}
    #edi-lingadore .edi-match-ok{color:#18864b}
    #edi-lingadore .edi-match-miss{color:#c83939}
    #edi-lingadore .edi-body{max-height:calc(100vh - 65px);overflow:auto}
  `;
  const isCartPage = () => /(?:^|\/)(?:cart|basket|winkelwagentje|winkelwagen|shopping-?cart|shopping-?basket)(?:\/|$)/i.test(location.pathname);
  // One supplier-panel layout, based on LingaDore. Applied after supplier CSS.
  const layout = `
    #edi-lingadore [hidden]{display:none!important}
    #edi-lingadore .edi-head{min-height:28px;padding:0 8px;gap:8px}
    #edi-lingadore .edi-title{display:flex;align-items:center;gap:8px;font-weight:700;flex:1;min-width:0}
    #edi-lingadore .edi-version{font-size:9px;font-weight:400;flex:none}
    #edi-lingadore .edi-icon-btn{width:26px!important;min-height:26px;padding:0;font:14px/26px system-ui;background:transparent;border:0;flex:none}
    #edi-lingadore .edi-body{padding:10px}
    #edi-lingadore .edi-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:8px}
    #edi-lingadore .edi-status{min-height:24px;padding:5px 7px;margin-bottom:8px;font-size:10px}
    #edi-lingadore .edi-pdp-meta{display:flex;align-items:baseline;gap:6px;margin:0 0 8px;font-size:12px;font-weight:400;color:#5f6368}
    #edi-lingadore .edi-pdp-meta strong{color:#202124;font-weight:400}
    #edi-lingadore .edi-summary{color:#5f6368;font-size:11px;margin:-2px 0 8px}
    #edi-lingadore .edi-colors{display:flex;flex-direction:column;gap:4px}
    #edi-lingadore .edi-color-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;min-height:34px;padding:3px 4px;border:1px solid transparent;border-radius:7px}
    #edi-lingadore .edi-color-row.edi-active{background:#f8f9fa;border-color:#e3e6e8}
    #edi-lingadore .edi-color-main{display:flex;flex-direction:row;align-items:center;flex-wrap:nowrap;min-width:0;gap:7px;font-size:11px}
    #edi-lingadore .edi-color-select{display:flex;align-items:center;gap:7px;min-width:0;padding:2px 0;border:0;background:transparent;text-align:left;color:#202124}
    #edi-lingadore .edi-swatch{width:17px;height:17px;flex:0 0 17px;border-radius:50%;border:1px solid #0003;background:#e5e7eb}
    #edi-lingadore .edi-color-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}
    #edi-lingadore .edi-match{margin-left:auto;font-size:10px;white-space:nowrap;flex:none}
    #edi-lingadore .edi-match a{color:inherit;text-decoration:none}
    #edi-lingadore .edi-actions{display:flex;gap:3px;flex-wrap:nowrap}
    #edi-lingadore details.edi-module{border:0;margin:0;padding:0}
    #edi-lingadore details.edi-module+details.edi-module{border-top:1px solid #dfe5e9;margin-top:8px;padding-top:8px}
    #edi-lingadore .edi-module>summary{cursor:pointer;font-size:12px;font-weight:600;margin:0 0 8px;padding:0}
    #edi-lingadore .edi-module-note{font-size:11px;line-height:1.4;margin:0;color:#5f6368}
  `;
  return {normalizeSize, sizeCandidates, parseEAN, variantMap, eanTSV, productClipboard, sizesClipboard, theme, layout, isCartPage};
})();

// END SHARED EDI
// Shared After Eden Sheet reader; used on supplier and DDO pages.
const AE_EAN = (() => {
  const sheet='1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68', gid='1291267370';
  let cached=null, pending=null;
  const size=value=>{const s=DDO_EDI.normalizeSize(value);return /^(ONE?SIZE|OS|O\/S)$/.test(s)?'1':s;};
  function parse(text,pid){
    const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim()).map(x=>x.split('\t').map(v=>v.trim().replace(/^"(.*)"$/,'$1')));
    const header=rows.shift()?.map(x=>x.toLowerCase())||[];
    const si=header.indexOf('size'),ei=header.indexOf('ean'),pi=header.indexOf('supplier id');
    if([si,ei,pi].some(i=>i<0))throw Error('EAN-sheet mist Size, Ean of Supplier ID');
    return DDO_EDI.variantMap(rows.filter(r=>r[pi]?.toUpperCase()===pid.trim().toUpperCase()).map(r=>({size:size(r[si]),ean:r[ei]})));
  }
  function request(url){return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,anonymous:false,timeout:12000,onload:resolve,onerror:()=>reject(Error('Netwerkfout bij EAN-sheet')),ontimeout:()=>reject(Error('Timeout bij EAN-sheet'))}));}
  async function load(force){
    if(!force&&cached&&Date.now()-cached.time<3600000)return cached.text;
    if(pending)return pending;
    pending=(async()=>{
      const saved=Number(localStorage.getItem('afteredenSheetAuthUser')||0);
      for(const account of [...new Set([saved,0,1,2,3,4,5])]){
        const r=await request(`https://docs.google.com/spreadsheets/d/${sheet}/export?format=tsv&gid=${gid}&authuser=${account}`);
        if(r.status!==200||!r.responseText||/<(?:!doctype|html|form)\b/i.test(r.responseText))continue;
        parse(r.responseText,''); // Validate schema before caching.
        cached={text:r.responseText,time:Date.now()};localStorage.setItem('afteredenSheetAuthUser',String(account));return cached.text;
      }
      throw Error('Geen toegang tot EAN-sheet; log in met het juiste Google-account');
    })();
    try{return await pending;}finally{pending=null;}
  }
  async function get(pid,sizes,force=false){
    const map=parse(await load(force),pid),wanted=[...new Set(sizes.map(size))];
    const missing=wanted.filter(s=>!map.has(s));
    if(missing.length)throw Error(`Geen EAN voor ${pid}: ${missing.join(', ')}`);
    if(!wanted.length)throw Error('Geen maten gevonden');
    return wanted.map(s=>map.get(s));
  }
  return {size,parse,get};
})();
(() => {
  if(location.hostname!=='www.dutchdesignersoutlet.com'||window.top!==window.self)return;
  const $=(s,r=document)=>r.querySelector(s),send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  const brand=()=>/after\s*eden|elbrina/i.test($('#select2-brand-container')?.textContent||$('select[name="brand"] option:checked')?.textContent||'');
  const pid=()=>$('input[name="supplier_pid"]')?.value.trim()||'';
  const rows=table=>[...table.querySelectorAll('tr')].flatMap(row=>{const input=$('input[name$="[barcode]"]',row),cell=$('td',row);if(!input||!cell)return [];return [{input,size:AE_EAN.size($('input,select',cell)?.value??cell.textContent)}];});
  let busy=false;
  const announce=()=>send('adapter-state',{id:'after-eden',label:'After Eden / Elbrina',version:'1.0.10',updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-after-eden.user.js',priority:70,available:brand(),capabilities:['ean','edi']});
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async event=>{
    let request;try{request=JSON.parse(event.detail);}catch{return;}if(request.id!=='after-eden')return;
    const status=(text,kind='busy',done=false,changed=0)=>send('adapter-status',{requestId:request.requestId,text,kind,done,changed,autoSave:done&&kind==='success'&&!!request.autoSave});
    if(busy)return status('After Eden is al bezig','error',true);busy=true;
    try{
      const table=$('#tabs-3 table.options'),original=pid();if(!brand()||!table||!original)throw Error('Open een After Eden / Elbrina product met Supplier ID en maten');
      const before=rows(table);status('After Eden EAN-sheet ophalen');
      const entries=await AE_EAN.get(original,before.map(r=>r.size),!!request.forceRefresh),map=DDO_EDI.variantMap(entries),current=rows(table);
      if(!table.isConnected||table!==$('#tabs-3 table.options')||pid()!==original||!brand()||current.length!==before.length||before.some((r,i)=>r.input!==current[i].input||r.size!==current[i].size))throw Error('Product of maten gewijzigd; start opnieuw');
      let changed=0;for(const row of before){const ean=map.get(row.size).ean;if(row.input.value===ean)continue;row.input.value=ean;row.input.dispatchEvent(new Event('input',{bubbles:true}));row.input.dispatchEvent(new Event('change',{bubbles:true}));changed++;}
      status(`${changed} EAN-rijen gevuld · voorraad ongewijzigd`,'success',true,changed);
    }catch(e){status(e.message,'error',true);}finally{busy=false;}
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();

const AE_PRODUCT = (() => {
  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePrice(text) {
    const cleaned = String(text || '').replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';

    if (cleaned.includes(',') && cleaned.includes('.')) {
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');

      if (lastComma > lastDot) {
        return cleaned.replace(/\./g, '').replace(',', '.');
      }

      return cleaned.replace(/,/g, '');
    }

    return cleaned.replace(',', '.');
  }

  function colorNameFromColor(colorText) {
    const t = cleanText(colorText);
    if (!t) return '';

    const noCode = t.replace(/^\d+\s+/, '').trim();
    if (!noCode) return '';

    return noCode
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  function shortTypeFromProductType(productType) {
    const t = cleanText(productType);
    if (!t) return '';

    const m = t.match(/^(.*?)(?:\s+met\s+|$)/i);
    return cleanText(m?.[1] || t);
  }

  function compositionUrlFromProductCode(productCode) {
    const cleanCode = String(productCode || '').replace(/\D/g, '');

    return cleanCode
      ? `https://bcg.fashionportal.shop/item/${cleanCode}`
      : '';
  }

  function readBullets() {
    const wrap = document.querySelector('.product-attrubutes');
    if (!wrap) return [];

    const vals = Array.from(
      wrap.querySelectorAll('.attribute-wrapper .attribute-value')
    )
      .map(el => cleanText(el.textContent))
      .filter(Boolean);

    const seen = new Set();
    const out = [];

    for (const v of vals) {
      const k = v.toLowerCase();
      if (seen.has(k)) continue;

      seen.add(k);
      out.push(v);
    }

    return out;
  }

  function readModelFromBullets() {
    const bullets = readBullets();
    return cleanText(bullets[0]);
  }

  function readDescriptionStoryText() {
    const el = document.querySelector('#fashion-tab-content #description');
    return cleanText(el?.textContent);
  }

  function buildCombinedDescription() {
    const bullets = readBullets();
    const story = readDescriptionStoryText();

    const bulletBlock = bullets.length
      ? bullets.map(b => `• ${b}`).join('\n')
      : '';

    if (bulletBlock && story) return `${bulletBlock}\n\n${story}`.trim();
    if (bulletBlock) return bulletBlock.trim();

    return story.trim();
  }

  function readFallbackTitle() {
    const h1 = document.querySelector('h1');
    const t1 = cleanText(h1?.textContent);
    if (t1) return t1;

    return cleanText(document.title);
  }

  function readProductTypeFromModal(colorWrap) {
    const modal = colorWrap.closest('.modal-content') || document;

    return (
      cleanText(modal.querySelector('#qountatyselector h5')?.textContent) ||
      cleanText(document.querySelector('h3.mb-0')?.textContent)
    );
  }

function readListPriceFromColorWrap(colorWrap) {
  const blocks = colorWrap.querySelectorAll('.total-amt');

  for (const block of blocks) {
    const labelEl = block.querySelector('span.d-block');
    const label = cleanText(labelEl?.textContent);

    if (!/^(catalogusprijs|list\s*price)$/i.test(label)) {
      continue;
    }

    // De prijs staat in het element direct ná de label
    const valueContainer = labelEl?.nextElementSibling;
    const valueSpan = valueContainer?.querySelector('span');

    const value = cleanText(valueSpan?.textContent);

    if (value) {
      console.log(`✅ Sparkle RRP gevonden [${label}]:`, value);
      return value;
    }

    // fallback voor afwijkende HTML
    const text = cleanText(block.textContent);
    const match = text.match(/(\d+[.,]\d{2})/);

    if (match) {
      console.log(`✅ Sparkle RRP gevonden via fallback [${label}]:`, match[1]);
      return match[1];
    }
  }

  console.warn('⚠️ Sparkle: geen Catalogusprijs/List Price gevonden', colorWrap);
  return '';
}

  function readFirstWholesalePriceFromColorWrap(colorWrap) {
    const input = colorWrap.querySelector('input[type="hidden"][name^="proprice_"]');
    return cleanText(input?.value);
  }

  function buildSparklePayloadFromColorWrap(colorWrap) {
    const productCode = cleanText(
      colorWrap.querySelector('.pro-sku .nuMber')?.textContent
    );

    const color = cleanText(
      colorWrap.querySelector('.pro-sku p')?.textContent
    );

    const productType = readProductTypeFromModal(colorWrap);
    const modelName = readModelFromBullets();

    const typeShort = shortTypeFromProductType(productType);
    const colorName = colorNameFromColor(color);

    const productName =
      [modelName, typeShort, colorName].filter(Boolean).join(' ').trim() ||
      [typeShort, colorName].filter(Boolean).join(' ').trim() ||
      readFallbackTitle();

    const rrpRaw = readListPriceFromColorWrap(colorWrap);
    const priceRaw = readFirstWholesalePriceFromColorWrap(colorWrap);

    return {
      name: productName,
      rrp: normalizePrice(rrpRaw),
      price: normalizePrice(priceRaw),
      productCode,
      modelName,
      descriptionText: buildCombinedDescription(),
      compositionUrl: compositionUrlFromProductCode(productCode),
      reference: ' - [ext]',
      color,
      productType
    };
  }


return {build:buildSparklePayloadFromColorWrap};
})();

(() => {
  'use strict';
  const ID='after-eden', VERSION='1.0.10', BASE='https://bcg.fashionportal.shop';
  const UPDATE='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-after-eden.user.js';
  if(window.top!==window.self)return;
  if(location.origin!==BASE)return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function code(value) {
    const s=String(value??'').normalize('NFKC').replace(/[‐‑‒–—]/g,'-').trim().toUpperCase();
    const match=s.match(/^([A-Z0-9]+(?:\.[A-Z0-9]+)+)\s*-\s*([A-Z0-9]{2,10})$/);
    return match?`${match[1]}-${match[2]}`:'';
  }
  function size(value) {
    let s=String(value??'').trim().toUpperCase().replace(/\s+/g,'').replace(/_/g,'');
    if(/^ONESIZES?$/.test(s))return '1';
    s=s.replace(/LARGE$/,'L').replace(/^([2-5])X$/,'$1XL');
    return DDO_EDI.normalizeSize(s);
  }
  const wrapCode=wrap=>code($('.pro-sku .nuMber, .pro-sku .number, .pro-sku span',wrap)?.textContent);
  function inventory(cell) {
    const node=cell.matches('[data-inventory]')?cell:$('.qty-limit[data-inventory], [data-inventory]',cell);
    const raw=node?.getAttribute('data-inventory');
    if(raw==null||!raw.trim())return null;
    const n=Number(raw.replace(',','.'));return Number.isFinite(n)&&n>=0?n:null;
  }
  function variants(wrap) {
    const map=new Map();
    const add=(raw,cell)=>{
      const key=size(raw);if(!key)return;
      const input=$('input[name^="proquantity_"]',cell),qty=inventory(cell);
      const previous=map.get(key);
      if(previous && (previous.input?.name!==input?.name||previous.qty!==qty))throw Error(`Dubbele/tegenstrijdige maat ${key}`);
      map.set(key,{size:key,input,qty});
    };
    for(const container of $$('.qty-by-size',wrap)) {
      const rows=$$('.qty-by-size-3D',container);
      if(rows.length) {
        const bands=$$('.size-for:not(.cup-size)',rows[0]).map(e=>clean(e.textContent));
        for(const row of rows.slice(1)) {
          const cup=clean($('.cup-size',row)?.textContent);if(!cup)continue;
          const cells=$$('.add-qty-box',row);
          if(cells.length!==bands.length)throw Error('Onvolledige cupmatrix; maten niet betrouwbaar te koppelen');
          cells.forEach((cell,i)=>add(bands[i]+cup,cell));
        }
      } else for(const cell of $$('.add-qty-box',container))add($('.size-for',cell)?.textContent,cell);
    }
    return map;
  }
  async function clipboard(value) {
    if(typeof GM_setClipboard==='function')return GM_setClipboard(value,'text');
    return navigator.clipboard.writeText(value);
  }
  const CACHE='edi:after-eden:ddo:v1',BRANDS=[20,72,51,21,148];
  const state={map:null,checking:false,rows:[],ordering:false,checkEpoch:0};
  function exportMap(buffer) {
    let workbook;try{workbook=XLSX.read(buffer,{type:'array'});}catch{throw Error('DDO-export niet leesbaar; controleer de DDO-login');}
    const map=new Map();
    for(const sheet of workbook.SheetNames||[]) {
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,raw:false,defval:'',blankrows:false});
      if(!rows.length)continue;
      const heads=rows[0].map(h=>clean(h).toLowerCase().replace(/[ _-]/g,''));
      const ci=['supplierpid','supplierproductid','productid'].map(h=>heads.indexOf(h)).find(i=>i>=0);
      const ii=['image','images','imageurl','afbeelding'].map(h=>heads.indexOf(h)).find(i=>i>=0);
      if(ci===undefined)continue;
      for(const row of rows.slice(1)) {
        const pid=code(row[ci]);if(!pid)continue;
        const image=String(row[ii]||'').split('|')[0].trim();
        const id=image.match(/^https:\/\/www\.dutchdesignersoutlet\.com\/img\/product\/(\d{5,6})(?=\D|$)/)?.[1]||'';
        if(!map.has(pid)||id)map.set(pid,{id});
      }
    }
    if(!map.size)throw Error('Geen After Eden/Elbrina-codes in export; controleer Product ID / Supplier PID-kolommen');
    return map;
  }
  function exportBrand(id) {
    return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:`https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=${id}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},data:'format=excel&export=Export+products',responseType:'arraybuffer',timeout:60000,
      onload:r=>{try{if(r.status!==200)throw Error(`Merk ${id}: HTTP ${r.status}`);resolve(exportMap(r.response));}catch(e){reject(e);}},onerror:()=>reject(Error(`Netwerkfout merk ${id}`)),ontimeout:()=>reject(Error(`Timeout merk ${id}`))}));
  }
  async function check(force=false) {
    if(DDO_EDI.isCartPage()||state.checking)return;
    state.checking=true;const epoch=++state.checkEpoch;$('#ae-check').disabled=true;$('#ae-refresh').disabled=true;$('#ae-reset').disabled=true;
    try {
      let cached;try{cached=JSON.parse(localStorage.getItem(CACHE));}catch{}
      const fromCache=!force&&cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries);
      if(fromCache)state.map=new Map(cached.entries);
      else {
        let complete=0;status(`DDO-exports ophalen: 0/${BRANDS.length}`);
        const maps=await Promise.all(BRANDS.map(async id=>{const result=await exportBrand(id);if(epoch===state.checkEpoch)status(`DDO-exports opgehaald: ${++complete}/${BRANDS.length} · merk ${id}`);return result;}));
        state.map=new Map(maps.flatMap(m=>[...m]));
        try{localStorage.setItem(CACHE,JSON.stringify({time:Date.now(),entries:[...state.map]}));}catch{}
      }
      status(fromCache?'DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.':`Modelcheck actief · ${state.map.size} DDO-producten geladen · alle ${BRANDS.length} merken`);renderColors();
    }catch(e){++state.checkEpoch;state.map=null;status(e.message,true);renderColors();}
    finally{state.checking=false;$('#ae-check').disabled=false;$('#ae-refresh').disabled=!state.map;$('#ae-reset').disabled=false;}
  }
  function status(text,error=false){$('#ae-status').textContent=text;$('#ae-status').style.color=error?'#c83939':'';}
  function orderStatus(text,error=false){
    const log=$('#ae-order-log'),entry=document.createElement('div');
    entry.textContent=text;entry.className=error?'edi-log-error':'';log.append(entry);
    while(log.children.length>100)log.firstElementChild.remove();
    log.scrollTop=log.scrollHeight;
  }
  function liveWraps(){return $$('.selectqty-wrap').filter(w=>!w.closest('#edi-after-eden')&&w.getClientRects().length);}
  function gallery(pid,root=document){
    const urls=new Map();
    for(const link of root.querySelectorAll('.pro-zoom .easyzoom a[href]')){
      if(link.closest('.slick-cloned'))continue;
      const url=new URL(link.getAttribute('href'),BASE),name=decodeURIComponent(url.pathname.split('/').pop());
      if(url.origin!==BASE||!/^\/item\/(?:additional_image\/)?[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname))continue;
      const match=name.match(/^(.+)_(\d+)_/);
      if(!match||code(match[1])!==pid)continue;
      urls.set(url.href,{url:url.href,name,index:Number(match[2])});
    }
    return [...urls.values()].sort((a,b)=>a.index-b.index);
  }
  async function photos(pid){
    let images=gallery(pid);
    if(!images.length){
      const digits=pid.replace(/\D/g,'');if(!/^\d{11}$/.test(digits))throw Error('Geen fotogallery voor deze artikelcode');
      const response=await fetch(`${BASE}/item/${digits}`,{credentials:'same-origin',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`Fotogallery HTTP ${response.status}`);
      images=gallery(pid,new DOMParser().parseFromString(await response.text(),'text/html'));
    }
    if(!images.length)throw Error(`Geen originele foto's voor ${pid}; controleer B2B-login`);
    if(typeof GM_download!=='function')throw Error('Installeer de nieuwste adapter met downloadrechten');
    for(const [i,img] of images.entries()){
      status(`${pid}: foto ${i+1}/${images.length} downloaden`);
      await new Promise((resolve,reject)=>GM_download({url:img.url,name:`${pid}_${i+1}.${img.name.split(".").pop().toLowerCase()}`,saveAs:false,timeout:30000,onload:resolve,onerror:()=>reject(Error(`Foto ${i+1} mislukt; controleer downloadrechten`)),ontimeout:()=>reject(Error(`Foto ${i+1}: timeout`))}));
    }
    status(`${pid}: ${images.length} foto's gedownload`);
  }
  function renderColors() {
    const host=$('#ae-colors');if(!host||DDO_EDI.isCartPage())return;
    const wraps=liveWraps(),seen=new Set(),groups=new Map();host.replaceChildren();
    for(const wrap of wraps) {
      const pid=wrapCode(wrap);if(!pid||seen.has(pid))continue;seen.add(pid);
      const name=clean($('.pro-sku p',wrap)?.textContent),match=state.map?.get(pid);
      const split=pid.lastIndexOf('-'),model=pid.slice(0,split),color=pid.slice(split+1);
      const colorName=name===color?'':name.startsWith(color+' ')?name.slice(color.length).trim():name;
      if(!groups.has(model)){
        const group=document.createElement('div');group.className='edi-model-group';
        const heading=document.createElement('div');heading.className='edi-pdp-meta';heading.innerHTML=`<strong>${escape(model)}</strong>`;group.append(heading);
        const summary=document.createElement('div');summary.className='edi-summary';group.append(summary);
        const colors=document.createElement('div');colors.className='edi-colors';group.append(colors);
        groups.set(model,group);host.append(group);
      }
      const row=document.createElement('div');row.className='edi-color-row edi-active';row.dataset.pid=pid;
      row.innerHTML=`<div class="edi-color-main"><span class="edi-color-select"><span class="edi-swatch"></span><span class="edi-color-label" title="${escape(color+' '+colorName)}">${escape(color)} ${escape(colorName)}</span></span><span class="edi-match ${state.map?(match?'edi-match-ok':'edi-match-miss'):''}">${state.map?(match?`✓ ${escape(match.id||'Aanwezig')}`:'× Ontbreekt'):'—'}</span></div><div class="edi-actions"><button type="button" class="edi-action" data-action="product">Product</button><button type="button" class="edi-action" data-action="sizes">Maten</button><button type="button" class="edi-action" data-action="ean">EAN</button><button type="button" class="edi-action" data-action="photos">Foto’s</button></div>`;
      if(match?.id){const label=$('.edi-match',row),link=document.createElement('a');link.textContent=label.textContent;link.href=`https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(match.id)}`;link.target='_blank';link.rel='noopener';label.replaceChildren(link);}
      $('[data-action="product"]',row).onclick=async()=>{try{if(!wrap.isConnected)throw Error('Modal gewijzigd; open opnieuw');const payload=AE_PRODUCT.build(wrap);if(code(payload.productCode)!==pid)throw Error('Product gewijzigd');await clipboard(DDO_EDI.productClipboard(payload));status(`${pid}: productgegevens gekopieerd`);}catch(e){status(e.message,true);}};
      $('[data-action="sizes"]',row).onclick=async()=>{try{const sizes=[...variants(wrap).keys()];if(!sizes.length)throw Error('Geen maten gevonden');await clipboard(DDO_EDI.sizesClipboard('After Eden / Elbrina',pid,sizes));status(`${pid}: ${sizes.length} maten gekopieerd`);}catch(e){status(e.message,true);}};
      $('[data-action="ean"]',row).onclick=async()=>{try{status(`${pid}: EAN-sheet ophalen`);const sizes=[...variants(wrap).keys()],entries=await AE_EAN.get(pid,sizes);if(!wrap.isConnected||wrapCode(wrap)!==pid)throw Error('Product gewijzigd; start opnieuw');await clipboard(DDO_EDI.eanTSV(entries,pid));status(`${pid}: ${entries.length} EAN-codes gekopieerd`);}catch(e){status(e.message,true);}};
      $('[data-action="photos"]',row).onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await photos(pid);}catch(e){status(e.message,true);}finally{button.disabled=false;}};
      $('.edi-colors',groups.get(model)).append(row);
    }
    for(const [model,group] of groups){
      const rows=$$('.edi-color-row',group),matches=rows.filter(r=>state.map?.has(r.dataset.pid)).length;
      if(state.map)for(const [pid,match] of state.map){
        if(!pid.startsWith(model+'-')||seen.has(pid))continue;
        const row=document.createElement('div');row.className='edi-color-row';row.dataset.pid=pid;
        row.innerHTML=`<div class="edi-color-main"><span class="edi-color-select"><span class="edi-swatch"></span><span class="edi-color-label" title="Alleen in DDO gevonden">${escape(pid.slice(model.length+1))} Alleen in DDO gevonden</span></span><span class="edi-match edi-match-ok">✓ ${escape(match.id||'Aanwezig')}</span></div><div class="edi-actions"><button class="edi-action" disabled>Product</button><button class="edi-action" disabled>Maten</button><button class="edi-action" disabled>EAN</button><button class="edi-action" disabled>Foto’s</button></div>`;
        $('.edi-colors',group).append(row);
      }
      $('.edi-summary',group).textContent=state.map?`${matches}/${rows.length} leverancierskleuren in DDO · ${matches===rows.length?'alle kleuren aanwezig':`${rows.length-matches} ontbreken`}`:'Nog niet gecontroleerd in DDO. Klik op Controleer in DDO.';
    }
    if(!seen.size)host.textContent=location.pathname.startsWith('/basket')?'Plak hieronder de orderregels.':'Open een product of kleurmodal om Product en Maten te kopiëren.';
  }
  function productRef(raw) {
    let text=clean(raw);
    if(/^https?:|^\//i.test(text)) {
      const url=new URL(text,BASE);
      if(url.origin!==BASE||!/^\/item\/\d{11}\/?$/.test(url.pathname))throw Error('Gebruik een FashionPortal /item/ URL met 11 cijfers');
      const digits=url.pathname.split('/')[2];text=`${digits.slice(0,2)}.${digits.slice(2,4)}.${digits.slice(4,8)}-${digits.slice(8)}`;
    }
    const pid=code(text);if(!pid)throw Error('Artikel vereist volledige model-kleurcode');return pid;
  }
  function parseRows(text) {
    const rows=String(text).split(/\r?\n/).filter(l=>l.trim()).map((line,i)=>{
      const cells=line.split('\t');if(cells.length!==3)throw Error(`Regel ${i+1}: verwacht artikel/URL, maat en aantal (tabs)`);
      const pid=productRef(cells[0]),maat=size(cells[1]),quantity=Number(cells[2].trim());
      if(!maat||!Number.isSafeInteger(quantity)||quantity<=0)throw Error(`Regel ${i+1}: maat en positief geheel aantal vereist`);
      return {pid,size:maat,quantity,state:'ready',detail:'Klaar voor controle'};
    });
    if(!rows.length)throw Error('Geen orderregels');return rows;
  }
  function renderOrder() {
    const body=$('#ae-order-rows');body.replaceChildren();
    for(const row of state.rows) {
      const tr=document.createElement('tr');
      for(const key of ['pid','size','quantity']){const td=tr.insertCell(),input=document.createElement('input');input.value=row[key];input.disabled=state.ordering||row.state==='sent'||row.state==='uncertain';input.setAttribute('aria-label',key);input.oninput=()=>{row[key]=input.value;row.state='ready';row.detail='Opnieuw controleren';};td.append(input);}
      const td=tr.insertCell();td.textContent=row.state==='sent'?'✓':row.state==='uncertain'?'?':row.state==='error'?'×':'·';td.title=row.detail;
      body.append(tr);
    }
    $('#ae-add-basket').disabled=state.ordering||!state.rows.some(r=>r.state==='ready'||r.state==='error');
    $('#ae-paste').disabled=state.ordering;$('#ae-add-row').disabled=state.ordering;
  }
  async function matrix(pid) {
    const response=await fetch(`${BASE}/itemquantitycal?item_number=${encodeURIComponent(pid)}&price_type=stockitem`,{credentials:'same-origin',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Matrix HTTP ${response.status}`);
    const doc=new DOMParser().parseFromString(await response.text(),'text/html');
    if(doc.querySelector('input[type="password"]'))throw Error('Log eerst in bij FashionPortal');
    const hits=$$('.selectqty-wrap',doc).filter(w=>wrapCode(w)===pid);
    if(hits.length!==1)throw Error(`Verwacht één exacte kleur ${pid}; gevonden: ${hits.length}`);
    const wrap=hits[0],form=wrap.closest('form');
    if(!form)throw Error('Geen basketformulier in de matrix');
    const action=new URL(form.getAttribute('action')||'/basket',BASE);
    if(action.origin!==BASE||action.pathname.replace(/\/$/,'')!=='/basket')throw Error('Onverwacht basketformulier');
    return {wrap,form,action:action.href,map:variants(wrap)};
  }
  function bodyFor(form,wrap,quantities) {
    const body=new URLSearchParams(),ids=new Set([...quantities.keys()].map(name=>name.slice('proquantity_'.length)));
    for(const field of $$('input,select,textarea',form)) {
      if(!field.name||field.disabled||['submit','button','file'].includes(field.type)||(['checkbox','radio'].includes(field.type)&&!field.checked))continue;
      const block=field.closest('.selectqty-wrap');if(block&&block!==wrap)continue;
      if(field.name.startsWith('proquantity_')){if(quantities.has(field.name))body.set(field.name,String(quantities.get(field.name)));continue;}
      if(field.name.startsWith('proprice_')&&!ids.has(field.name.slice(9)))continue;
      body.append(field.name,field.value||'');
    }
    return body;
  }
  function responseConfirmsProduct(result,pid){
    if(!Array.isArray(result?.products))return false;
    const split=pid.lastIndexOf('-'),model=pid.slice(0,split),color=pid.slice(split+1);
    const compact=value=>String(value??'').toUpperCase().replace(/[.\s-]/g,'');
    return result.products.some(p=>{
      // The original order tool also reads FIRSTLINE/SECONDLINE/THIRDLINE.
      // Match whole codes/tokens, never a substring in a description or price.
      const item=compact(p.ITEMNUMBER),wanted=compact(model);
      if(item===compact(pid))return true;
      const lines=[p.FIRSTLINE,p.SECONDLINE,p.THIRDLINE].map(v=>String(v??'').trim().toUpperCase());
      const tokens=lines.flatMap(line=>line.split(/[\s:;,|()[\]]+/).filter(Boolean));
      if(tokens.some(token=>compact(token)===compact(pid)))return true;
      const modelFound=item===wanted||tokens.some(token=>compact(token)===wanted);
      const colorFound=String(p.COLOR??'').trim().toUpperCase()===color||tokens.includes(color);
      return modelFound&&colorFound;
    });
  }
  async function addToBasket() {
    if(!DDO_EDI.isCartPage())return orderStatus('Ordermodule is alleen actief op het winkelmandje.',true);
    if(state.ordering)return;state.ordering=true;renderOrder();
    try {
      const active=state.rows.filter(r=>r.state==='ready'||r.state==='error'),groups=new Map();
      for(const row of active){const parsed=parseRows(`${row.pid}\t${row.size}\t${row.quantity}`)[0];Object.assign(row,parsed);if(!groups.has(row.pid))groups.set(row.pid,[]);groups.get(row.pid).push(row);}
      for(const [pid,rows] of groups) {
        let data,quantities=new Map();
        try {
          orderStatus(`${pid}: exacte maten en voorraad controleren…`);data=await matrix(pid);
          for(const row of rows){const variant=data.map.get(size(row.size));if(!variant?.input||variant.input.disabled||variant.input.readOnly)throw Error(`Maat ${row.size} niet bestelbaar`);row.inputName=variant.input.name;quantities.set(row.inputName,(quantities.get(row.inputName)||0)+row.quantity);}
          for(const row of rows){const v=data.map.get(row.size),total=quantities.get(row.inputName);const max=v.input.getAttribute('max');if(v.qty!==null&&total>v.qty)throw Error(`Onvoldoende voorraad ${row.size}: ${v.qty}`);if(max!==null&&max!==''&&Number.isFinite(Number(max))&&total>Number(max))throw Error(`Maximum overschreden voor ${row.size}`);}
        }catch(e){rows.forEach(r=>{r.state='error';r.detail=e.message;});orderStatus(e.message,true);renderOrder();continue;}
        // Once a POST is attempted its rows cannot be retried by another click.
        rows.forEach(r=>{r.state='uncertain';r.detail='Aanvraag gestart; controleer mandje voordat je opnieuw toevoegt';});renderOrder();
        try {
          const response=await fetch(data.action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:bodyFor(data.form,data.wrap,quantities).toString(),signal:AbortSignal.timeout(20000)});
          const text=await response.text();
          if(!response.ok||/onvoldoende voorraad|insufficient stock|niet voldoende voorraad|maximaal beschikbare hoeveelheid|quantity.*adjusted|type=["']password/i.test(text))throw Error('Basketantwoord vereist controle; voeg deze regels niet opnieuw toe');
          let result;try{result=JSON.parse(text);}catch{}
          const exactProduct=responseConfirmsProduct(result,pid);
          if(!result||result.status===false||result.success===false||result.error||(result.status!==true&&result.success!==true&&!exactProduct))throw Error('Aanvraag verstuurd, maar winkelmandantwoord niet herkend; controleer het winkelmandje. Niet opnieuw toevoegen.');
          rows.forEach(r=>{r.state='sent';r.detail='Toevoegen bevestigd door leverancier';});orderStatus(`${pid}: toevoegen bevestigd door leverancier`);
        }catch(e){rows.forEach(r=>r.detail=e.message);orderStatus(`${pid}: ${e.message}`,true);}
        renderOrder();
      }
      const sent=state.rows.filter(r=>r.state==='sent').length,failed=state.rows.filter(r=>r.state==='error').length,uncertain=state.rows.filter(r=>r.state==='uncertain').length;
      orderStatus(`Verwerking klaar: ${sent} verwerkt, ${failed} niet toegevoegd, ${uncertain} te controleren.`,failed+uncertain>0);
      if(active.length>0&&state.rows.every(row=>row.state==='sent'))location.assign(`${BASE}/basket`);
    }catch(e){orderStatus(e.message,true);}
    finally{state.ordering=false;renderOrder();}
  }
  function init() {
    if($('#edi-after-eden'))return;
    const style=document.createElement('style');style.textContent=`
      #edi-after-eden,#edi-after-eden :where(*){all:revert;box-sizing:border-box}
      #edi-after-eden :where(*){font:inherit;color:inherit;letter-spacing:normal;text-transform:none}
      #edi-after-eden :where(*::before,*::after){content:none}
    `+DDO_EDI.theme.replaceAll('#edi-lingadore','#edi-after-eden')+`
      #edi-after-eden{position:fixed;top:18px;right:18px;width:430px;max-width:calc(100vw - 24px);z-index:2147483000;overflow:hidden}#edi-after-eden *{box-sizing:border-box}#edi-after-eden .edi-head{display:flex;align-items:center;gap:8px;cursor:move;font-weight:700}#edi-after-eden .edi-head strong{flex:1}#edi-after-eden .edi-icon-btn{background:transparent;border:0;cursor:pointer}#edi-after-eden .edi-body{padding:8px}#edi-after-eden .edi-toolbar{display:flex;gap:5px;margin-bottom:8px}#edi-after-eden .edi-status{padding:6px;margin-bottom:8px}#edi-after-eden .edi-color-row{padding:6px 4px;border-bottom:1px solid #edf1f4;display:grid;gap:6px}#edi-after-eden .edi-color-main{display:flex;gap:6px;flex-wrap:wrap;font-size:11px}#edi-after-eden .edi-match{margin-left:auto}#edi-after-eden .edi-actions{display:flex;gap:4px;flex-wrap:wrap}#edi-after-eden a{color:inherit}#edi-after-eden details{border-top:1px solid #dfe5e9;margin-top:8px;padding-top:8px}#edi-after-eden summary{cursor:pointer;font-weight:600;margin-bottom:8px}#edi-after-eden table{width:100%;table-layout:fixed;border-collapse:collapse}#edi-after-eden th{text-align:left;font-size:10px}#edi-after-eden th:first-child{width:45%}#edi-after-eden th:last-child{width:20px}#edi-after-eden td{padding:3px}#edi-after-eden input{width:100%;min-width:0;font:11px system-ui;padding:3px;border:1px solid #cbd5df}#edi-after-eden.edi-minimized .edi-body{display:none}#edi-after-eden.edi-minimized{width:220px}
      #edi-after-eden{margin:0;padding:0;text-align:left;direction:ltr}
      #edi-after-eden .edi-head{min-height:38px;padding:6px 8px;flex-wrap:nowrap}
      #edi-after-eden .edi-head strong{min-width:0;font-size:12px;line-height:1.3}
      #edi-after-eden .edi-version{flex:none;white-space:nowrap}
      #edi-after-eden button{width:auto!important;min-width:0!important;max-width:100%;height:auto!important;margin:0!important;float:none!important;position:static!important;letter-spacing:normal!important;text-transform:none!important;white-space:normal!important;cursor:pointer}
      #edi-after-eden .edi-icon-btn{flex:0 0 26px!important;width:26px!important;min-height:26px;padding:0;font:18px/26px system-ui}
      #edi-after-eden .edi-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
      #edi-after-eden .edi-body{min-width:0;overflow-x:hidden;overflow-wrap:anywhere}
      #edi-after-eden .edi-color-main>*{min-width:0}
      #edi-after-eden p{margin:8px 0;font-size:11px;line-height:1.4}
      #edi-after-eden input{height:26px;max-width:100%;background:#fff;color:#25313b;border-radius:3px}
      #edi-after-eden button:disabled{cursor:not-allowed}
      #edi-after-eden [hidden]{display:none!important}
      #edi-after-eden #ae-edi{margin-top:0;padding-top:0;border-top:0}
      #edi-after-eden summary{padding:3px 0;font-size:12px}
      #edi-after-eden .edi-pdp-meta{font-weight:700;font-size:13px;margin:8px 4px 5px}
      #edi-after-eden .edi-color-row{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;min-height:34px;padding:3px 4px;border:1px solid transparent;border-radius:7px}
      #edi-after-eden .edi-color-row:hover{background:#f8f9fa;border-color:#e3e6e8}
      #edi-after-eden .edi-color-main{min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
      #edi-after-eden .edi-color-label{font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #edi-after-eden .edi-match{margin-left:0;font-size:9px}
      #edi-after-eden .edi-order-log{max-height:120px;overflow-y:auto;line-height:1.4}
      #edi-after-eden .edi-order-log>div+div{border-top:1px solid #e3e6e8;margin-top:4px;padding-top:4px}
      #edi-after-eden .edi-log-error{color:#c83939}
    `;style.textContent+=DDO_EDI.layout.replaceAll('#edi-lingadore','#edi-after-eden');document.head.append(style);
    const panel=document.createElement('section');panel.id='edi-after-eden';
    panel.innerHTML=`<div class="edi-head"><div class="edi-title">Toolbox · After Eden / Elbrina<span class="edi-version">v${VERSION}</span></div><button type="button" class="edi-icon-btn" id="ae-collapse" aria-label="Inklappen">−</button></div><div class="edi-body"><details class="edi-module" id="ae-edi" open><summary>EDI-module</summary><div class="edi-toolbar"><button type="button" class="edi-btn" id="ae-check">Controleer in DDO</button><button type="button" class="edi-btn" id="ae-refresh" disabled>Opnieuw checken</button><button type="button" class="edi-btn edi-danger" id="ae-reset">Reset</button></div><div class="edi-status" id="ae-status" role="status">Modelcheck wacht op startsignaal.</div><div id="ae-colors"></div></details><details class="edi-module" id="ae-order"><summary>Ordermodule</summary><div class="edi-toolbar"><button type="button" class="edi-btn" id="ae-paste">Plak orderregels</button><button type="button" class="edi-btn" id="ae-add-basket" disabled>In winkelmandje</button></div><div class="edi-status edi-order-log" id="ae-order-log" role="log" aria-label="Orderlogboek" aria-live="polite"></div><p>Artikel/URL · maat · aantal, gescheiden door tabs.</p><table><thead><tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr></thead><tbody id="ae-order-rows"></tbody></table><button type="button" class="edi-btn" id="ae-add-row">+ Regel</button></details></div>`;
    document.body.append(panel);
    const save=()=>{try{localStorage.setItem('edi:after-eden:ui:v1',JSON.stringify({left:panel.offsetLeft,top:panel.offsetTop,min:panel.classList.contains('edi-minimized')}));}catch{}};
    try{const stored=JSON.parse(localStorage.getItem('edi:after-eden:ui:v1'));if(stored){panel.classList.toggle('edi-minimized',!!stored.min);panel.style.left=Math.max(0,Math.min(Number(stored.left)||0,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(Number(stored.top)||0,innerHeight-panel.offsetHeight))+'px';panel.style.right='auto';}}catch{}
    window.addEventListener('resize',()=>{if(panel.style.left)panel.style.left=Math.max(0,Math.min(panel.offsetLeft,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(panel.offsetTop,innerHeight-panel.offsetHeight))+'px';});
    const collapse=$('#ae-collapse'),setCollapse=()=>{collapse.textContent=panel.classList.contains('edi-minimized')?'+':'−';};setCollapse();collapse.onclick=()=>{panel.classList.toggle('edi-minimized');setCollapse();save();};
    const head=$('.edi-head',panel);head.onpointerdown=e=>{if(e.target.closest('button'))return;const x=e.clientX-panel.offsetLeft,y=e.clientY-panel.offsetTop;head.setPointerCapture(e.pointerId);head.onpointermove=event=>{panel.style.left=Math.max(0,Math.min(event.clientX-x,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(event.clientY-y,innerHeight-panel.offsetHeight))+'px';panel.style.right='auto';};head.onpointerup=()=>{head.onpointermove=null;save();};};
    $('#ae-reset').onclick=()=>{if(state.checking)return;localStorage.removeItem(CACHE);state.map=null;$('#ae-refresh').disabled=true;status('Cache geleegd. Modelcheck staat stil.');renderColors();};$('#ae-check').onclick=()=>check(false);$('#ae-refresh').onclick=()=>check(true);
    $('#ae-paste').onclick=async()=>{if(!DDO_EDI.isCartPage())return;try{state.rows=parseRows(await navigator.clipboard.readText());renderOrder();orderStatus(`${state.rows.length} orderregels geladen`);}catch(e){orderStatus(e.message,true);}};
    $('#ae-add-row').onclick=()=>{if(!DDO_EDI.isCartPage())return;state.rows.push({pid:'',size:'',quantity:1,state:'ready',detail:''});renderOrder();};$('#ae-add-basket').onclick=addToBasket;
    const cart=DDO_EDI.isCartPage();$('#ae-order').hidden=!cart;$('#ae-order').open=cart;$('#ae-edi').hidden=cart;$('#ae-edi').open=!cart;orderStatus('Plak orderregels of voeg een regel toe.');
    try{const cached=JSON.parse(localStorage.getItem(CACHE));if(!cart&&cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries)){state.map=new Map(cached.entries);$('#ae-refresh').disabled=false;status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');}}catch{}
    renderColors();
    if(cart)return;
    let timer;new MutationObserver(records=>{if(records.some(r=>!panel.contains(r.target))){clearTimeout(timer);timer=setTimeout(renderColors,150);}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','aria-hidden']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

(() => {
  'use strict';
  if (location.hostname !== 'lingerieoutlet.nl' || !location.pathname.startsWith('/tools/stockv4/')) return;

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-after-eden',
      name: 'Stock Check | After Eden',
      version: '4.2' // Embedded Stock Check module version; independent of the EDI bundle.
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  registerUserscript();

  if (!Core) {
    console.info('[Stock Check|After Eden] VCPCore ontbreekt.');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.info('[Stock Check|After Eden] StockRules ontbreekt of is incompleet.');
    return;
  }

  // ---------- Config ----------
  const TIMEOUT = 15000;
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
  const CACHE_PREFIX = 'stock_check_after_eden_html_cache_v1:';
  const BASE = 'https://bcg.fashionportal.shop';
  const QUIET = true;

  const STOCK_URL = (itemNumber) =>
    `${BASE}/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;

  const $ = (s, r = document) => r.querySelector(s);
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

  function debugConsole(level, ...args) {
    if (QUIET) {
      if (level === 'error') console.info(...args);
      else if (typeof console[level] === 'function') console[level](...args);
      else console.log(...args);
      return;
    }
    if (typeof console[level] === 'function') console[level](...args);
    else console.log(...args);
  }

  // ---------- Helpers ----------
  function extractColorCode(pid) {
    const m = String(pid || '').trim().match(/-([A-Za-z0-9]{2,})$/);
    return m ? m[1] : '';
  }

  function normalizeSize(s) {
    const cleaned = String(s || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\u2013|\u2014/g, '-')
      .replace(/_/g, '');

    // keep legacy behavior: ONESIZE -> "1"
    if (/^ONESIZES?$/.test(cleaned)) return '1';
    return cleaned;
  }

  // ---------- Logger ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    status(id, txt, extra) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), String(txt), extra);
      else console.info(`[AfterEden][${id}] status: ${txt}`, extra || '');
    },
    perMaat(id, report) {
      if (g.StockCheckConfig?.detailLogging !== true) return;
      if (!report?.length) return;
      console.groupCollapsed(`[AfterEden][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          pid: r.pid,
          kleurcode: r.kleurcode,
          maat: r.maat,
          local: r.local,
          remoteQty: (r.remotePresent ? r.remoteQty : '-'),
          target: Number.isFinite(r.target) ? r.target : '-',
          delta: Number.isFinite(r.delta) ? r.delta : '-',
          status: r.status
        })));
      } finally {
        console.groupEnd();
      }
    }
  };

  // ---------- Net ----------
  function gmFetch(url, responseType = 'text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        anonymous: false,
        timeout: TIMEOUT,
        headers: { 'Accept': 'text/html,*/*;q=0.8' },
        onload: r => resolve(r),
        onerror: e => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ---------- Cache ----------
  function cacheKey(itemNumber) {
    return `${CACHE_PREFIX}${String(itemNumber || '').trim()}`;
  }

  function loadCache(itemNumber) {
    const raw = GM_getValue(cacheKey(itemNumber), null);
    if (!raw) return null;
    try {
      const { t, data } = JSON.parse(raw);
      return (Date.now() - t <= CACHE_TTL_MS) ? data : null;
    } catch {
      return null;
    }
  }

  function saveCache(itemNumber, html) {
    GM_setValue(cacheKey(itemNumber), JSON.stringify({ t: Date.now(), data: html }));
  }

  async function fetchAfterEdenHTML(itemNumber) {
    const cached = loadCache(itemNumber);
    if (cached) return cached;

    const url = STOCK_URL(itemNumber);
    const r = await gmFetch(url, 'text');
    const txt = (r?.responseText || '');

    if (r?.status !== 200 || !txt.trim()) {
      throw new Error(`AfterEden HTML HTTP ${r?.status || '??'}`);
    }

    const looksLikeLogin = /login|sign in|unauthorized/i.test(txt);
    if (looksLikeLogin) throw new Error('LOGIN_REQUIRED');

    const hasInventorySignals =
      txt.includes('data-inventory') ||
      txt.includes('qty-by-size') ||
      txt.includes('add-qty-box') ||
      txt.includes('selectqty-wrap') ||
      txt.includes('nuMber');

    if (!hasInventorySignals) throw new Error('NO_INVENTORY_IN_HTML');

    saveCache(itemNumber, txt);
    return txt;
  }

  // ---------- STRICT inventory read ----------
  // Alleen data-inventory telt.
  function readRemoteInventoryFromBox_STRICT(box) {
    const invEl =
      box.querySelector('.qty-limit[data-inventory]') ||
      box.querySelector('[data-inventory]') ||
      null;

    const raw = invEl?.getAttribute('data-inventory') ?? invEl?.dataset?.inventory;
    if (raw == null) return { present: false, qty: null };

    const cleaned = String(raw).trim().replace(',', '.');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { present: false, qty: null };

    return { present: true, qty: n };
  }

  // ---------- Exact wrapper pick: PID match ----------
  function findSelectWrapByExactPid(doc, pid) {
    const wraps = [...doc.querySelectorAll('.selectqty-wrap')];
    const target = String(pid || '').trim();

    const hits = [];
    for (const w of wraps) {
      const n = w.querySelector('.pro-sku .nuMber')?.textContent || '';
      const number = n.trim();
      if (number === target) hits.push(w);
    }

    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`AMBIGUOUS_PID_WRAP:${target}:${hits.length}`);
    throw new Error(`PID_WRAP_NOT_FOUND:${target}`);
  }

  function readKleurLabelFromWrap(wrap) {
    return wrap.querySelector('.pro-sku p')?.textContent?.trim() || '';
  }

  // ---------- Parse within wrapper ----------
  function parseWrapToQtyMap(wrap, pid, kleurcode) {
    const m = new Map();
    const dbg = [];

    // ---- 1D ----
    const list = wrap.querySelector('.qty-by-size.qty-by-size-list, .qty-by-size-list');
    if (list) {
      const boxes = [...list.querySelectorAll('.add-qty-box')];
      for (const box of boxes) {
        const sizeRaw = box.querySelector('.size-for')?.textContent?.trim();
        if (!sizeRaw) continue;

        const sizeKey = normalizeSize(sizeRaw);
        const r = readRemoteInventoryFromBox_STRICT(box);

        if (!r.present) {
          dbg.push({ pid, kleurcode, type: '1D', size: sizeKey, present: false, qty: null });
          continue;
        }

        const remoteQty = r.qty;
        m.set(sizeKey, { qty: remoteQty });
        dbg.push({ pid, kleurcode, type: '1D', size: sizeKey, present: true, qty: remoteQty });
      }
    }

    // ---- 3D ----
    const matrixContainer = wrap.querySelector('.row.qty-by-size.scroll-design, .qty-by-size.scroll-design, .qty-by-size');
    if (matrixContainer && matrixContainer.querySelector('.qty-by-size-3D')) {
      const headerRow = matrixContainer.querySelector('.qty-by-size-3D');
      const bandSizes = headerRow
        ? [...headerRow.querySelectorAll('.size-for.text-center')].map(el => el.textContent.trim()).filter(Boolean)
        : [];

      const rows3d = [...matrixContainer.querySelectorAll('.qty-by-size-3D')].slice(1);

      if (bandSizes.length && rows3d.length) {
        for (const row of rows3d) {
          const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
          if (!cup) continue;

          const cells = [...row.querySelectorAll('.add-qty-box')];
          cells.forEach((cell, idx) => {
            const band = bandSizes[idx];
            if (!band) return;

            const sizeKey = normalizeSize(`${band}${cup}`);
            const r = readRemoteInventoryFromBox_STRICT(cell);

            if (!r.present) {
              dbg.push({ pid, kleurcode, type: '3D', size: sizeKey, present: false, qty: null });
              return;
            }

            const remoteQty = r.qty;
            const prev = m.get(sizeKey);

            if (!prev || remoteQty > prev.qty) {
              m.set(sizeKey, { qty: remoteQty });
            }

            dbg.push({ pid, kleurcode, type: '3D', size: sizeKey, present: true, qty: remoteQty });
          });
        }
      }
    }

    return m;
  }

  function parseAfterEdenHTMLtoMap(htmlText, pid) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const kleurcode = extractColorCode(pid);

    const wrap = findSelectWrapByExactPid(doc, pid);
    const kleurLabel = readKleurLabelFromWrap(wrap);

    if (kleurcode && kleurLabel) {
      const labelCode = (kleurLabel.match(/^([A-Za-z0-9]+)/)?.[1] || '').trim();
      if (labelCode && labelCode !== kleurcode) {
        throw new Error(`KLEURCODE_MISMATCH:pid=${pid}:kleurcode=${kleurcode}:label=${labelCode}`);
      }
    }

    const qtyMap = parseWrapToQtyMap(wrap, pid, kleurcode);
    return { qtyMap, kleurcode, kleurLabel };
  }

  // ---------- Apply rules ----------
  function applyRulesOnTable(table, qtyMap, pid, kleurcode, brandKey) {
    const rows = table.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => Core.clearRowMarks(row));

    rows.forEach(row => {
      const sizeTd = row.children?.[0];
      const stockTd = row.children?.[1];
      if (!sizeTd || !stockTd) return;

      const maatRaw = (row.dataset.size || sizeTd.textContent || '').trim();
      const maat = normalizeSize(maatRaw);
      const local = parseInt((stockTd.textContent || '0').trim(), 10) || 0;

      const remoteObj = qtyMap.get(maat);

      // STRICT: als maat niet in remote => niets doen
      if (!remoteObj) {
        report.push({
          pid,
          kleurcode,
          maat,
          local,
          remotePresent: false,
          remoteQty: undefined,
          target: NaN,
          delta: 0,
          status: 'ignored_missing_remote'
        });
        return;
      }

      const remoteQty = Number(remoteObj.qty ?? 0);
      const target = SR.mapRemoteToTarget(brandKey, remoteQty, 5);
      const res = SR.reconcile(local, target, 5);

      const delta = res.delta || 0;
      let status = 'ok';

      if (res.action === 'bijboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'add',
          delta,
          title: `Bijboeken ${delta} (target ${target}, remoteQty ${remoteQty})`
        });
        status = 'bijboeken';
        if (!firstMut) firstMut = row;
      } else if (res.action === 'uitboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta,
          title: `Uitboeken ${delta} (target ${target}, remoteQty ${remoteQty})`
        });
        status = 'uitboeken';
        if (!firstMut) firstMut = row;
      } else {
        Core.markRow(row, {
          action: 'none',
          delta: 0,
          title: `OK (target ${target}, remoteQty ${remoteQty})`
        });
        status = 'ok';
      }

      report.push({
        pid,
        kleurcode,
        maat,
        local,
        remotePresent: true,
        remoteQty,
        target,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return { diffs, report };
  }

  function logStatusFromReport(report, qtyMap) {
    const remoteLeeg = !qtyMap || qtyMap.size === 0;
    if (remoteLeeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  function isNotFoundError(err) {
    const msg = String(err?.message || err || '').toUpperCase();
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
    if (/UNEXPECTED\s+TOKEN/.test(msg)) return true;
    if (msg.includes('NO_INVENTORY_IN_HTML')) return true;
    if (msg.includes('PID_WRAP_NOT_FOUND')) return true;
    return false;
  }

  // ---------- Per-table ----------
  async function perTableFactory(brandKey) {
    return async function perTable(table) {
      const pid = (table.id || '').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
      const anchorId = pid || label;

      if (!pid) {
        Logger.status(anchorId, 'niet-gevonden');
        return 0;
      }

      const kleurcode = extractColorCode(pid);

      try {
        const html = await fetchAfterEdenHTML(pid);
        const { qtyMap, kleurLabel } = parseAfterEdenHTMLtoMap(html, pid);

        if (!qtyMap || qtyMap.size === 0) {
          Logger.status(anchorId, 'niet-gevonden', { kleurcode, kleurLabel });
          return 0;
        }

        const { diffs, report } = applyRulesOnTable(table, qtyMap, pid, kleurcode, brandKey);

        Logger.status(anchorId, logStatusFromReport(report, qtyMap), {
          kleurcode,
          kleurLabel,
          diffs,
          missingRemote: report.filter(r => r.status === 'ignored_missing_remote').length
        });
        Logger.perMaat(anchorId, report);

        return diffs;

      } catch (e) {
        const msg = String(e?.message || e);

        debugConsole('info', '[AfterEden]', {
          pid,
          kleurcode,
          status: isNotFoundError(e) ? 'niet-gevonden' : 'afwijking',
          message: msg
        });

        Logger.status(
          anchorId,
          isNotFoundError(e) ? 'niet-gevonden' : 'afwijking',
          { error: msg, kleurcode }
        );

        return 0;
      }
    };
  }

  // ---------- UI / Supplier selection ----------
  function getSelectedSupplierText() {
    const sel = $('#leverancier-keuze');
    if (!sel) return '';
    return String(sel.options?.[sel.selectedIndex]?.text || sel.value || '').trim();
  }

  function isAfterEdenSelected() {
    const sel = $('#leverancier-keuze');
    if (!sel) return false;
    const blob = `${norm(sel.value || '')} ${norm(getSelectedSupplierText())}`;
    return blob.includes('after') && blob.includes('eden');
  }

  function isElbrinaSelected() {
    const sel = $('#leverancier-keuze');
    if (!sel) return false;
    const blob = `${norm(sel.value || '')} ${norm(getSelectedSupplierText())}`;
    return blob.includes('elbrina');
  }

  function resolveBrandKey() {
    return (isElbrinaSelected() ? 'elbrina' : 'aftereden');
  }

  function resolveButtonLabel() {
    return isElbrinaSelected() ? 'Elbrina' : 'After Eden';
  }

  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    const brandKey = resolveBrandKey();
    const perTable = await perTableFactory(brandKey);

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable
    });
  }

  const { btn } = Core.mountSupplierButton({
    id: 'stock-check-after-eden-btn',
    text: 'Controleer After Eden',
    right: 250,
    top: 8,
    match: () => {
      const hasTables = !!document.querySelector('#output table');
      return hasTables && (isAfterEdenSelected() || isElbrinaSelected());
    },
    onClick: (btn) => run(btn)
  });
  btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i>';
  btn.setAttribute('aria-label', 'Controleer voorraad bij After Eden');
  btn.title = 'Controleer voorraad bij After Eden';

})();

})();
