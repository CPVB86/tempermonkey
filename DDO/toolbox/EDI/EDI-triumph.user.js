// ==UserScript==
// @name DDO Toolbox | EDI | Triumph + Sloggi
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.1.6
// @description Triumph/Sloggi EDI: modelcheck, Product, Maten, EAN, foto’s, DDO stock en Stock Check.
// @match https://b2b.triumph.com/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @match https://lingerieoutlet.nl/tools/stockv4/*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_info
// @grant unsafeWindow
// @grant GM_addValueChangeListener
// @grant GM_removeValueChangeListener
// @connect b2b.triumph.com
// @connect dutchdesignersoutlet.com
// @connect www.dutchdesignersoutlet.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-start
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-triumph.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-triumph.user.js
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
    #edi-lingadore .edi-color-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;min-height:34px;padding:3px 4px;border:1px solid #e3e6e8;border-radius:7px;background:#f8f9fa}
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
const TRI_API=(()=>{
  const origin='https://b2b.triumph.com',key='ddoTriumphSession';
  const norm=value=>DDO_EDI.normalizeSize(value);
  const split=pid=>{const m=String(pid||'').trim().toUpperCase().match(/^(\d{6,10})\s*-\s*([A-Z0-9]{2,6})$/);if(!m)throw Error('Supplier ID vereist model-kleur');return {model:m[1],color:m[2]};};
  function remember(auth,url){
    let u;try{u=new URL(url,origin);}catch{return;}
    const ids=u.pathname.match(/^\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    if(u.origin!==origin||!ids||!/^Bearer\s+/i.test(auth||''))return;
    GM_setValue(key,{auth,webstoreId:ids[1],cartId:ids[2]});
  }
  function header(headers){if(!headers)return '';if(typeof headers.get==='function')return headers.get('authorization');if(Array.isArray(headers))return headers.find(([k])=>/^authorization$/i.test(k))?.[1];return Object.entries(headers).find(([k])=>/^authorization$/i.test(k))?.[1];}
  if(location.origin===origin){
    const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
    const fetch=page.fetch;if(fetch)page.fetch=function(input,init){try{remember(header(init?.headers)||header(input?.headers),typeof input==='string'?input:input?.url);}catch{}return fetch.apply(this,arguments);};
    const proto=page.XMLHttpRequest.prototype,open=proto.open,setHeader=proto.setRequestHeader;
    proto.open=function(method,url){this.__ediTriUrl=url;return open.apply(this,arguments);};
    proto.setRequestHeader=function(name,value){if(/^authorization$/i.test(name))try{remember(value,this.__ediTriUrl);}catch{}return setHeader.apply(this,arguments);};
  }
  function stock(n){return n<=0?0:n<=2?1:n===3?2:n===4?3:5;}
  function parse(json,color){
    const list=Array.isArray(json)?json:json?.products;
    if(!Array.isArray(list))throw Error('Ongeldige Triumph-griddata');
    const hits=list.filter(p=>[p.userDefinedField1,p.colorCode].some(c=>norm(c)===norm(color)));
    if(hits.length!==1)throw Error(`Verwacht één exacte kleur ${color}; gevonden: ${hits.length}`);
    const map=new Map();for(const sku of hits[0].skus||[]){
      const size=norm(String(sku.sizeName||sku.sizeDisplayName||'')+String(sku.subSizeName||sku.subSizeDisplayName||''));if(!size)continue;
      const ean=String(sku.eanCode||sku.gtin||'').trim(),level=sku.stockLevels?.[0],raw=level?.quantity??level?.available??level?.qty;
      const available=raw===null||raw===undefined||raw===''?null:Number(raw);
      const entry={size,ean:/^\d{8,14}$/.test(ean)?ean:'',stock:available!==null&&Number.isFinite(available)&&available>=0?stock(available):null};
      const old=map.get(size);if(old&&(old.ean!==entry.ean||old.stock!==entry.stock))throw Error(`Tegenstrijdige maat ${size}`);map.set(size,entry);
    }
    if(!map.size)throw Error('Geen maten in de grid');return map;
  }
  async function get(pid){
    const {model,color}=split(pid),s=GM_getValue(key,null);
    if(!s?.auth||!s.webstoreId||!s.cartId)throw Error('Open of herlaad eerst een product op Triumph B2B om de sessie te laden');
    const url=`${origin}/api/shop/webstores/${encodeURIComponent(s.webstoreId)}/carts/${encodeURIComponent(s.cartId)}/grid/${encodeURIComponent(model)}/products`;
    const json=await new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,headers:{Accept:'application/json',Authorization:s.auth},timeout:20000,onload:r=>{try{if(r.status!==200)throw Error(`Triumph HTTP ${r.status}; controleer B2B-login`);resolve(JSON.parse(r.responseText));}catch(e){reject(e);}},onerror:()=>reject(Error('Netwerkfout bij Triumph')),ontimeout:()=>reject(Error('Timeout bij Triumph'))}));
    return parse(json,color);
  }
  return {get,parse,split};
})();
(()=>{
  if(location.hostname!=='www.dutchdesignersoutlet.com'||window.top!==window.self)return;
  const $=(s,r=document)=>r.querySelector(s),send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  const brand=()=>/triumph|sloggi/i.test($('#tabs-1 #select2-brand-container')?.textContent||$('select[name="brand"] option:checked')?.textContent||'');
  const pid=()=>$('input[name="supplier_pid"]')?.value.trim()||'';
  const rows=table=>[...table.querySelectorAll('tbody tr')].flatMap(row=>{const field=$('input.product_option_small',row),ean=$('input[name$="[barcode]"]',row),stock=$('input[name$="[stock]"]',row);return field&&(ean||stock)?[{size:DDO_EDI.normalizeSize(field.value),ean,stock}]:[];});
  const announce=()=>send('adapter-state',{id:'triumph-sloggi',label:'Triumph/Sloggi',version:'1.1.6',updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-triumph.user.js',priority:90,available:brand(),capabilities:['ean','stock','edi']});
  let busy=false;
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',async e=>{
    let request;try{request=JSON.parse(e.detail);}catch{return;}if(request.id!=='triumph-sloggi')return;
    const status=(text,kind='busy',done=false,changed=0)=>send('adapter-status',{requestId:request.requestId,text,kind,done,changed,autoSave:done&&kind==='success'&&!!request.autoSave});
    if(busy)return status('Triumph is al bezig','error',true);busy=true;
    try{
      const table=$('#tabs-3 table.options'),original=pid();if(!brand()||!table)throw Error('Open Triumph/Sloggi producttab 3');
      const before=rows(table);if(!before.length)throw Error('Geen maten gevonden');status('Triumph-grid laden…');const map=await TRI_API.get(original);
      for(const r of before){const v=map.get(r.size);if(!v||r.ean&&!v.ean||r.stock&&v.stock===null)throw Error(`Onvolledige gegevens voor ${r.size}; niets gewijzigd`);}
      const now=rows(table);if(!table.isConnected||table!==$('#tabs-3 table.options')||pid()!==original||!brand()||now.length!==before.length||before.some((r,i)=>r.size!==now[i].size||r.ean!==now[i].ean||r.stock!==now[i].stock))throw Error('Product of maten gewijzigd; start opnieuw');
      let changed=0;for(const r of before){let update=false;for(const name of ['ean','stock']){const field=r[name],value=String(map.get(r.size)[name]);if(field&&field.value!==value){field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));update=true;}}if(update)changed++;}
      status(`${changed} rijen gevuld`,'success',true,changed);
    }catch(e){status(e.message,'error',true);}finally{busy=false;}
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();

const TRI_PRODUCT = (()=>{
  const $$ = (sel, root = document) =>
    Array.from((root || document).querySelectorAll(sel));

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  function getBrandName() {
    const rowNameEl = document.querySelector('.product-row__name');
    const pageTitleEl = document.querySelector(
      'h1, .product-details-information__title'
    );

    const source = (
      rowNameEl?.textContent ||
      pageTitleEl?.textContent ||
      ''
    ).trim();

    if (/^sloggi\s+men\b/i.test(source)) return 'Sloggi Men';
    if (/^sloggi\b/i.test(source)) return 'Sloggi';
    if (/^triumph\b/i.test(source)) return 'Triumph';

    return 'Triumph';
  }

  function getMarketCode() {
    const pathMatch = location.pathname.match(
      /^\/(?:products|favorites-lists)\/([^/]+)/i
    );

    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    const brand = getBrandName();

    if (/^sloggi/i.test(brand)) {
      return 'NL_SloggiPROD';
    }

    return 'NL_TriumphPROD';
  }

  function stripBrandPrefix(str = '') {
    return String(str)
      .trim()
      .replace(/^sloggi\s+men\s+/i, '')
      .replace(/^sloggi\s+/i, '')
      .replace(/^triumph\s+/i, '')
      .trim();
  }

  function normalizeWhitespace(str = '') {
    return String(str)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCompositionUrl(productCode = '') {
    const code = String(productCode || '').trim();

    const match = code.match(/^(\d+)-([A-Za-z0-9]+)$/);

    if (!match) {
      console.warn(
        '[Sparkle | Triumph] Ongeldige productCode voor compositionUrl:',
        code
      );
      return '';
    }

    const [, styleNumber, colorCode] = match;

    const brand = getBrandName();

    const market = /^sloggi/i.test(brand)
      ? 'NL_SloggiPROD'
      : 'NL_TriumphPROD';

    return `https://b2b.triumph.com/products/${market}/${styleNumber}/${colorCode}`;
  }

  function getStyleColorInfo() {
    const candidates = [...document.querySelectorAll('.product-details-information__description')];
    const p = candidates.find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

    if (!p) {
      return {
        styleNumber: '',
        colorCode: '',
        colorName: ''
      };
    }

    const txt = (p.textContent || '').trim();

    if (!txt) {
      return {
        styleNumber: '',
        colorCode: '',
        colorName: ''
      };
    }

    const parts = txt.split(/\s*-\s*/);

    const styleNumber = (parts[0] || '').trim();
    const colorCode = (parts[1] || '').trim();
    const colorName = (parts.slice(2).join(' - ') || '').trim();

    const route = location.pathname.match(/^\/products\/[^/]+\/(\d{6,10})\/([A-Z0-9]{2,6})(?:\/|$)/i);
    if(route){
      const currentColor=route[2].toUpperCase();
      const label=[...document.querySelectorAll('button.product-swatch .product-swatch__label')].map(el=>(el.textContent||'').trim()).find(text=>text.toUpperCase().startsWith(currentColor+' '));
      return {styleNumber:route[1],colorCode:currentColor,colorName:label?label.slice(currentColor.length).trim():(colorCode.toUpperCase()===currentColor?colorName:'')};
    }
    return {styleNumber,colorCode,colorName};
  }

  function getPrice() {
    const wrapper = document.querySelector(
      '.product-details-information__prices'
    );

    if (!wrapper) {
      return '';
    }

    const priceBlocks = $$('.product-price', wrapper);

    for (const block of priceBlocks) {
      const labelEl = block.querySelector(
        '.product-price__item.label'
      );

      if (!labelEl) {
        continue;
      }

      const labelText = (labelEl.textContent || '')
        .trim()
        .toUpperCase();

      if (labelText === 'RSP') {
        const regularEl = block.querySelector(
          '.product-price__item.regular'
        );

        if (!regularEl) {
          continue;
        }

        return (regularEl.textContent || '').trim();
      }
    }

    return '';
  }

  function getProductInfo() {
    const result = {
      summary: '',
      material: '',
      model: ''
    };

    const section = document.querySelector(
      'section.product-details-information__section.productinformatie'
    );

    if (section) {
      const fields = $$('.product-details-extra-field', section);

      fields.forEach(field => {
        const titleEl = field.querySelector(
          '.product-details-extra-field__title'
        );

        const valueEl = field.querySelector(
          '.product-details-extra-field__value'
        );

        if (!titleEl || !valueEl) {
          return;
        }

        const title = (titleEl.textContent || '')
          .trim()
          .toLowerCase();

        const value = (valueEl.textContent || '').trim();

        if (title.includes('samenvatting')) {
          result.summary = value;
        } else if (title.includes('materiaal')) {
          result.material = value;
        } else if (title.includes('beschrijving')) {
          result.model = stripBrandPrefix(value);
        }
      });
    }

    const rowNameEl = document.querySelector('.product-row__name');

    if (rowNameEl) {
      const name = stripBrandPrefix(
        (rowNameEl.textContent || '').trim()
      );

      if (name) {
        result.model = name;
      }
    }

    return result;
  }

  function getProductCodeFromRow(row) {
    if (!row) {
      return '';
    }

    const idEl = row.querySelector('.product-row__id');

    if (!idEl) {
      return '';
    }

    const raw = (idEl.textContent || '').trim();

    if (!raw) {
      return '';
    }

    const parts = raw.split('-');

    if (parts.length >= 2) {
      const left = (parts[0] || '').trim();
      const right = (parts[1] || '').trim();

      if (left && right) {
        return `${left}-${right}`;
      }
    }

    return raw.replace(/\s+/g, '');
  }

  function buildDescriptionHtml(summary, material) {
    const parts = [];

    if (summary) {
      parts.push(
        `<p>${escapeHtml(summary).replace(/\r?\n/g, '<br>')}</p>`
      );
    }

    if (material) {
      parts.push(
        `<p>Materiaal: ${escapeHtml(material)}</p>`
      );
    }

    return parts.join('\n').trim();
  }

  function buildDescriptionText(summary, material) {
    const parts = [];

    if (summary) {
      parts.push(summary.trim());
    }

    if (material) {
      parts.push(`Materiaal: ${material.trim()}`);
    }

    return parts.join('\n\n').trim();
  }

  function buildSparkleComment({
    productCode,
    summary,
    material,
    model,
    rowName,
    swatchLabel,
    price
  }) {
    const modelForHeading = normalizeWhitespace(
      stripBrandPrefix(rowName || model || '')
    );

    const variantPart = normalizeWhitespace(
      swatchLabel || ''
    );

    const supplierTitle = normalizeWhitespace(
      [modelForHeading, variantPart]
        .filter(Boolean)
        .join(' ')
    );

    const payload = {
      name: supplierTitle || '',
      title: supplierTitle || '',
      rrp: String(price || ''),
      price: '',
      productCode: String(productCode || ''),
      modelName: modelForHeading || '',
      descriptionHtml: buildDescriptionHtml(
        summary,
        material
      ),
      descriptionText: buildDescriptionText(
        summary,
        material
      ),
      compositionUrl: getCompositionUrl(productCode),
      reference: '[ext]',
      supplierId: String(productCode || ''),
      brand: getBrandName()
    };

    return `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  }

  function toTitleCase(str = '') {
    return String(str)
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  }


  function rowFor(pid){
    return [...document.querySelectorAll('.product-row')].find(row=>getProductCodeFromRow(row).toUpperCase()===pid);
  }
  function build(pid){
    const current=getStyleColorInfo(),row=rowFor(pid),selected=`${current.styleNumber}-${current.colorCode}`.toUpperCase()===pid;
    if(!selected&&!row)throw Error('Geen productgegevens voor deze kleur; selecteer de kleur eerst');
    const sameModel=current.styleNumber===pid.split('-')[0];
    const info=sameModel?getProductInfo():{summary:'',material:'',model:''};
    const rowName=row?.querySelector('.product-row__name')?.textContent?.trim()||info.model;
    const rowColor=(row?.querySelector('.product-row__id')?.textContent||'').split(/\s*-\s*/).slice(2).join(' - ').trim();
    // Use the product model’s displayed RSP for every colour of that model.
    return buildSparkleComment({productCode:pid,summary:info.summary,material:info.material,model:rowName,rowName,swatchLabel:toTitleCase(rowColor||(selected?current.colorName:'')),price:sameModel?getPrice():''});
  }
  return {build,info:getStyleColorInfo,hasRow:pid=>!!rowFor(pid)};
})();

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  let Core = g.VCPCore;
  let SR   = g.StockRules;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-triumph',
      name: 'Stock Check | Triumph & Sloggi',
      version: '4.3'
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  const ON_TOOL    = location.hostname.includes('lingerieoutlet.nl');
  const ON_TRIUMPH = location.hostname.includes('b2b.triumph.com');

  const HEARTBEAT_KEY   = 'triumph_bridge_heartbeat';
  const AUTH_HEADER_KEY = 'triumph_bridge_auth_header';

  const TIMEOUT_MS = 20000;

  const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  // Hulpfunctie: webstoreId en cartId uit Triumph API-URL halen
  function extractMetaFromUrl(url) {
    if (!url) return {};
    const m = String(url).match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    if (!m) return {};
    return { webstoreId: m[1], cartId: m[2] };
  }

  // ========================================================================
  // 1) BRIDGE OP TRIUMPH (auth-capture + grid-call)
  // ========================================================================
  if (ON_TRIUMPH) {
    const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    let pageFetch = null;

    // Heartbeat
    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    function storeAuth(val, via, meta) {
      if (!val) return;
      const auth = String(val).trim();
      if (!/^bearer\s+/i.test(auth)) return;

      let prevRaw = null;
      try { prevRaw = GM_getValue(AUTH_HEADER_KEY, null); } catch {}

      let prev = null;
      if (prevRaw && typeof prevRaw === 'object') prev = prevRaw;
      else if (typeof prevRaw === 'string') prev = { auth: prevRaw };

      const session = {
        auth,
        webstoreId: (meta && meta.webstoreId) || (prev && prev.webstoreId) || null,
        cartId:     (meta && meta.cartId)     || (prev && prev.cartId)     || null
      };

      try { GM_setValue(AUTH_HEADER_KEY, session); } catch {}
      // console debug ok op triumph-tab
      try {
        console.info(
          '[Triumph-bridge][DEBUG]',
          via,
          'Authorization captured:',
          auth.slice(0, 22) + '...',
          '| webstoreId:',
          session.webstoreId || '-',
          '| cartId:',
          session.cartId || '-'
        );
      } catch {}
    }

    function extractAuthFromHeaders(headers) {
      if (!headers) return null;

      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get('Authorization') || headers.get('authorization') || null;
      }

      if (Array.isArray(headers)) {
        for (const [k, v] of headers) if (/^authorization$/i.test(k)) return v;
      }

      if (typeof headers === 'object') {
        for (const k of Object.keys(headers)) if (/^authorization$/i.test(k)) return headers[k];
      }

      return null;
    }

    // fetch-hook
    (function hookFetchForAuth() {
      try {
        const orig = w.fetch;
        if (!orig) return;

        pageFetch = orig.bind(w);

        w.fetch = function patchedFetch(input, init = {}) {
          try {
            const auth = extractAuthFromHeaders(init.headers);
            if (auth) {
              let urlStr = '';
              if (typeof input === 'string') urlStr = input;
              else if (input && typeof input.url === 'string') urlStr = input.url;
              const meta = extractMetaFromUrl(urlStr);
              storeAuth(auth, 'via fetch', meta);
            }
          } catch {}
          return pageFetch(input, init);
        };

        console.info('[Triumph-bridge] fetch-hook actief in page-context');
      } catch (e) {
        console.warn('[Triumph-bridge] kon fetch niet hooken:', e);
      }
    })();

    // XHR-hook
    (function hookXHRForAuth() {
      try {
        const OrigXHR = w.XMLHttpRequest;
        if (!OrigXHR) return;

        function XHRProxy() {
          const xhr = new OrigXHR();
          const origSetRequestHeader = xhr.setRequestHeader;
          const origOpen             = xhr.open;

          xhr._bridgeUrl = '';

          xhr.open = function (method, url) {
            try { xhr._bridgeUrl = url; } catch {}
            return origOpen.apply(this, arguments);
          };

          xhr.setRequestHeader = function (name, value) {
            try {
              if (/^authorization$/i.test(name)) {
                const meta = extractMetaFromUrl(xhr._bridgeUrl);
                storeAuth(value, 'via XHR', meta);
              }
            } catch {}
            return origSetRequestHeader.apply(this, arguments);
          };

          return xhr;
        }

        XHRProxy.prototype = OrigXHR.prototype;
        w.XMLHttpRequest = XHRProxy;

        console.info('[Triumph-bridge] XHR-hook actief in page-context');
      } catch (e) {
        console.warn('[Triumph-bridge] kon XHR niet hooken:', e);
      }
    })();

    async function fetchTriumphGrid(styleId, cartId, timeout = TIMEOUT_MS) {
      const raw = GM_getValue(AUTH_HEADER_KEY, null);

      let auth = null;
      let sessionStore = null;
      let sessionCart  = null;

      if (raw && typeof raw === 'object') {
        auth         = raw.auth || null;
        sessionStore = raw.webstoreId || null;
        sessionCart  = raw.cartId || null;
      } else {
        auth = raw;
      }

      if (!sessionStore) {
        throw new Error('Geen webstoreId gevonden in Triumph-session. Laat eerst een grid-call lopen op b2b.triumph.com.');
      }

      const effectiveCartId = cartId || sessionCart;
      if (!effectiveCartId) {
        throw new Error('Geen cartId gevonden in Triumph-session. Laat eerst een grid-call lopen op b2b.triumph.com.');
      }

      const url =
        `https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(sessionStore)}` +
        `/carts/${encodeURIComponent(effectiveCartId)}` +
        `/grid/${encodeURIComponent(styleId)}/products`;

      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), timeout);

      const headers = { 'Accept': 'application/json, text/plain, */*' };
      if (auth) headers['Authorization'] = auth;

      const f = pageFetch || w.fetch.bind(w);
      const res = await f(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: ctrl.signal
      });

      clearTimeout(to);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }

    GM_addValueChangeListener('triumph_bridge_req', (_name, _old, req) => {
      if (!req || !req.id || !req.styleId) return;

      (async () => {
        try {
          const text = await fetchTriumphGrid(req.styleId, req.cartId, req.timeout || TIMEOUT_MS);
          GM_setValue('triumph_bridge_resp', { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue('triumph_bridge_resp', { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    if (document.readyState !== 'loading') console.info('[Triumph-bridge] actief op', location.href);
    else document.addEventListener('DOMContentLoaded', () => console.info('[Triumph-bridge] actief op', location.href));

    return;
  }

  // ========================================================================
  // 2) CLIENT OP TOOL
  // ========================================================================
  if (!ON_TOOL) return;

  function initTool() {
    Core = g.VCPCore;
    SR = g.StockRules;

  const Logger = {
    lb() {
      try {
        return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
          ? unsafeWindow.logboek
          : window.logboek;
      } catch {
        return window.logboek;
      }
    },
    status(id, txt) {
      const lb = this.lb();
      if (lb && typeof lb.resultaat === 'function') lb.resultaat(String(id), txt);
      else console.info(`[Triumph][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      if (g.StockCheckConfig?.detailLogging !== true) return;
      console.groupCollapsed(`[Triumph][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '-',
          target: Number.isFinite(r.target) ? r.target : '-',
          delta: Number.isFinite(r.delta) ? r.delta : '-',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  function bridgeIsOnlineByHeartbeat(maxAge = 5000) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAge;
    } catch {
      return false;
    }
  }

  function bridgeSessionReady() {
    try {
      const session = GM_getValue(AUTH_HEADER_KEY, null);
      return !!(
        session &&
        typeof session === 'object' &&
        session.webstoreId &&
        session.cartId
      );
    } catch {
      return false;
    }
  }

  function bridgeIsReady() {
    return bridgeIsOnlineByHeartbeat() && bridgeSessionReady();
  }

  function installHeartbeatBadge(btn) {
    if (!btn || btn.querySelector('.supplier-bridge-badge')) return;

    btn.style.position = 'relative';
    const badge = document.createElement('span');
    badge.className = 'supplier-bridge-badge';
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);

    const update = () => {
      const ready = bridgeIsReady();
      badge.classList.toggle('is-online', ready);
      btn.dataset.bridgeOnline = ready ? '1' : '0';
      if (!btn.classList.contains('is-busy')) {
        btn.title = ready
          ? 'Controleer voorraad bij Triumph of Sloggi'
          : 'Open de ingelogde Triumph B2B-tab en bezoek een product';
      }
    };

    update();
    try { GM_addValueChangeListener(HEARTBEAT_KEY, update); } catch {}
    try { GM_addValueChangeListener(AUTH_HEADER_KEY, update); } catch {}
    setInterval(update, 3000);
  }

  function bridgeGetGrid(styleId, cartId, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = uid();

      let handle = GM_addValueChangeListener('triumph_bridge_resp', (_name, _old, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        msg.ok ? resolve(msg.text) : reject(new Error(msg.error || 'bridge error'));
      });

      GM_setValue('triumph_bridge_req', { id, styleId, cartId, timeout });

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  // GRID cache
  const gridCache = new Map();
  async function getGrid(styleId, cartId) {
    const key = `${cartId || 'session'}:${styleId}`;
    if (gridCache.has(key)) return gridCache.get(key);

    const p = bridgeGetGrid(styleId, cartId).then(text => {
      try { return JSON.parse(text); } catch { return []; }
    }).catch(err => {
      gridCache.delete(key);
      throw err;
    });

    gridCache.set(key, p);
    return p;
  }

  // --- Size aliasing (same as your cleaned set) ---
  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL'
  };

  function aliasCandidates(label) {
    const raw = String(label || '').trim().toUpperCase();
    const ns  = raw.replace(/\s+/g, '');
    const set = new Set([raw, ns]);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);

    if (raw.includes('/')) {
      raw.split('/').map(s => s.trim()).forEach(x => {
        if (!x) return;
        set.add(x);
        set.add(x.replace(/\s+/g, ''));
        if (SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
      });
    }
    return Array.from(set);
  }

  function resolveRemote(statusMap, label) {
    for (const c of aliasCandidates(label)) if (statusMap && statusMap[c]) return statusMap[c];
    return undefined;
  }

// Triumph GRID JSON naar statusMap voor een kleur.
//
// BELANGRIJK:
// Alleen de ACTUELE/eerste stockLevel bepaalt de voorraad.
//
// Voorbeelden:
//   vandaag: 0 OUT_OF_STOCK
//   november: 22 HIGH_STOCK
//   december: 50 HIGH_STOCK
//
// => stock = 0 / OUT_OF_STOCK
//
// Toekomstige leveringen worden dus NIET meegenomen.
//
function buildStatusMapFromTriumphGrid(productsJson, wantedColorCode) {
  const list = Array.isArray(productsJson)
    ? productsJson
    : (productsJson && Array.isArray(productsJson.products))
      ? productsJson.products
      : [];

  const wanted = String(wantedColorCode || '').padStart(4, '0');
  const map = {};

  const products = list.filter(p =>
    String(p.colorCode || '').padStart(4, '0') === wanted
  );

  products.forEach(prod => {
    (prod.skus || []).forEach(sku => {

      // ---------------------------------------------------
      // MAATLABEL
      // ---------------------------------------------------

      let label = (sku.simpleSizeName || '').trim().toUpperCase();

      if (!label) {
        const base = String(sku.sizeName || '').trim().toUpperCase();
        const cup  = String(sku.subSizeName || '').trim().toUpperCase();

        label = (base + (cup || '')).trim();
      }

      if (!label) return;


      // ---------------------------------------------------
      // STOCKLEVELS
      // ---------------------------------------------------

      const levels = Array.isArray(sku.stockLevels)
        ? [...sku.stockLevels]
        : [];


      // Geen stockdata = uitverkocht
      if (!levels.length) {
        for (const key of aliasCandidates(label)) {
          map[key] = {
            status: 'OUT_OF_STOCK',
            stock: 0
          };
        }

        return;
      }


      // ---------------------------------------------------
      // CHRONOLOGISCH SORTEREN
      // ---------------------------------------------------

      levels.sort((a, b) => {
        const da = Date.parse(a?.startDate || '9999-12-31');
        const db = Date.parse(b?.startDate || '9999-12-31');

        return da - db;
      });


      // ---------------------------------------------------
      // EERSTE LEVEL = ACTUELE VOORRAAD
      // ---------------------------------------------------

      const current = levels[0] || {};


      const indicator = String(
        current.remainingQuantityIndicator
        ??
        current.quantityIndicator
        ??
        ''
      ).trim().toUpperCase();


      // remainingQuantity heeft voorkeur indien aanwezig.
      const rawQty = Number(
        current.remainingQuantity
        ??
        current.quantity
        ??
        0
      );


      // ---------------------------------------------------
      // OUT_OF_STOCK IS ALTIJD 0
      //
      // Dus bijvoorbeeld:
      //
      // 2026-09-03  0  OUT_OF_STOCK
      // 2026-11-26 22  HIGH_STOCK
      // 2026-12-28 50  HIGH_STOCK
      //
      // wordt NIET 72 maar 0.
      // ---------------------------------------------------

      let totalQty = 0;
      let status = 'OUT_OF_STOCK';

      if (
        indicator !== 'OUT_OF_STOCK' &&
        Number.isFinite(rawQty) &&
        rawQty > 0
      ) {
        totalQty = rawQty;
        status = 'IN_STOCK';
      }


      // ---------------------------------------------------
      // ALIASES OPSLAAN
      // ---------------------------------------------------

      for (const key of aliasCandidates(label)) {
        const existing = map[key];

        if (!existing) {
          map[key] = {
            status,
            stock: totalQty
          };

        } else {

          // Bij meerdere overeenkomende SKU's:
          // actuele positieve voorraad heeft voorrang.
          if (
            status === 'IN_STOCK' &&
            existing.status !== 'IN_STOCK'
          ) {
            existing.status = 'IN_STOCK';
            existing.stock = totalQty;

          } else if (
            status === 'IN_STOCK' &&
            existing.status === 'IN_STOCK'
          ) {
            existing.stock = Math.max(
              Number(existing.stock) || 0,
              totalQty
            );
          }
        }
      }
    });
  });

  return map;
}

  function applyRulesAndMark(localTable, statusMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat = (row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = resolveRemote(statusMap, maat);
      const supplierQty = Number(remoteEntry?.stock) || 0;
      const st          = remoteEntry?.status; // IN_STOCK/OUT_OF_STOCK/undefined

      // target policy:
      // - IN_STOCK: mapRemoteToTarget('triumph', supplierQty, 5)
      // - OUT_OF_STOCK: target 0
      // - unknown: target null -> if local>0 remove all, else ignore
      let target = null;
      if (st === 'IN_STOCK') target = SR.mapRemoteToTarget('triumph', supplierQty, 5);
      else if (st === 'OUT_OF_STOCK') target = 0;
      else target = null;

      let status = 'ok';
      let delta = 0;

      if (target === null) {
        if (local > 0) {
          delta = local;
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (maat onbekend bij Triumph)` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: 'Negeren (maat onbekend bij Triumph)' });
          status = 'negeren';
        }
      } else {
        const res = SR.reconcile(local, target, 5);
        delta = res.delta;

        if (res.action === 'bijboeken' && delta > 0) {
          Core.markRow(row, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'bijboeken';
          if (!firstMut) firstMut = row;
        } else if (res.action === 'uitboeken' && delta > 0) {
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, supplier qty ${supplierQty})` });
          status = 'ok';
        }
      }

      report.push({
        maat,
        local,
        remote: supplierQty,
        target: Number.isFinite(target) ? target : NaN,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, statusMap) {
    const leeg = !statusMap || Object.keys(statusMap).length === 0;
    if (leeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  async function perTable(table) {
    const tableId = (table.id || '').trim();
    const anchorId = tableId || 'onbekend';

    // verwacht: STIJL-KLEUR (bijv 10123-0123)
    const m = tableId.match(/^(\d+)-([0-9A-Z]{3,4})$/i);
    if (!m) {
      Logger.status(anchorId, 'niet-gevonden (id niet in vorm STIJL-KLEUR)');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const styleId   = m[1];
    const colorCode = m[2].toUpperCase();

    const cartId = undefined; // altijd session cart

    const json = await getGrid(styleId, cartId);
    const statusMap = buildStatusMapFromTriumphGrid(json, colorCode);

    if (!statusMap || Object.keys(statusMap).length === 0) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const report = applyRulesAndMark(table, statusMap);
    Logger.status(anchorId, bepaalLogStatus(report, statusMap));
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  async function runTriumph(btn) {
    if (!bridgeIsOnlineByHeartbeat()) {
      btn.dataset.skState = 'fail';
      alert(
        'Triumph-bridge offline.\n' +
        'Open een b2b.triumph.com-tab, log in, bezoek een product (zodat hun grid-call loopt),\n' +
        'dan hier opnieuw proberen.'
      );
      return;
    }
    if (!bridgeSessionReady()) {
      btn.dataset.skState = 'fail';
      alert(
        'De Triumph-bridge is open, maar heeft nog geen actieve productsessie.\n' +
        'Bezoek in de B2B-tab eerst een product zodat webstoreId en cartId worden vastgelegd.'
      );
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    try {
      await Core.runTables({
        btn,
        tables,
        concurrency: 3,
        perTable
      });
    } catch (e) {
      const msg = String(e?.message || e);
      console.error('[Stock Check|Triumph] run error:', e);

      // optioneel: 1 algemene hint (niet per table spam)
      if (msg.includes('HTTP 401')) alert('Triumph auth/token probleem (HTTP 401). Open Triumph tab en laat een product-grid call lopen.');
      else if (msg.includes('bridge timeout')) alert('Triumph bridge timeout. Probeer opnieuw of refresh Triumph tab.');
    }
  }

  function isTriumphOrSloggiSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return false;
    const val = norm(sel.value || '');
    const txt = norm(sel.options?.[sel.selectedIndex]?.text || '');
    const blob = `${val} ${txt}`;
    return /\btriumph\b/i.test(blob) || /\bsloggi\b/i.test(blob);
  }

  registerUserscript();

  const { btn } = Core.mountSupplierButton({
    id: 'stock-check-triumph-btn',
    text: 'Controleer Triumph of Sloggi',
    right: 250,
    top: 8,
    match: (blob) => /\btriumph\b/i.test(blob) || /\bsloggi\b/i.test(blob),
    onClick: (b) => runTriumph(b)
  });
  btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i>';
  btn.setAttribute('aria-label', 'Controleer voorraad bij Triumph of Sloggi');
  installHeartbeatBadge(btn);
  }

  let bootAttempts = 0;
  const bootTimer = setInterval(() => {
    bootAttempts += 1;
    Core = g.VCPCore;
    SR = g.StockRules;
    const ready = (
      Core &&
      typeof Core.mountSupplierButton === 'function' &&
      SR &&
      typeof SR.mapRemoteToTarget === 'function' &&
      typeof SR.reconcile === 'function'
    );
    if (ready) {
      clearInterval(bootTimer);
      initTool();
    } else if (bootAttempts >= 100) {
      clearInterval(bootTimer);
      console.error('[Stock Check|Triumph] VCPCore of StockRules is niet beschikbaar.');
    }
  }, 100);

})();

(()=>{
  if(location.hostname!=='b2b.triumph.com'||window.top!==window.self)return;
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],clean=v=>String(v??'').replace(/\s+/g,' ').trim(),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={map:null,checking:false,epoch:0},CACHE='edi:triumph:ddo:v1';
  function code(raw){const m=clean(raw).toUpperCase().match(/^(\d{6,10})\s*[- ]\s*([A-Z0-9]{2,6})(?:\s+-.*)?$/);return m?`${m[1]}-${m[2]}`:'';}
  const isCart=()=>/^\/order\/management\/active-order(?:\/|$)/i.test(location.pathname);
  const active=()=>{const route=location.pathname.match(/^\/products\/[^/]+\/(\d{6,10})\/([A-Z0-9]{2,6})(?:\/|$)/i);if(route)return `${route[1]}-${route[2].toUpperCase()}`;const i=TRI_PRODUCT.info();return code(`${i.styleNumber}-${i.colorCode}`);};
  const status=(text,error=false)=>{const el=$('#tri-status');if(el){el.textContent=text;el.style.color=error?'#c83939':'';}};
  const clipboard=text=>typeof GM_setClipboard==='function'?GM_setClipboard(text,'text'):navigator.clipboard.writeText(text);
  function exportMap(buffer){
    const workbook=XLSX.read(buffer,{type:'array'}),map=new Map();let valid=false;
    for(const sheet of workbook.SheetNames){
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,raw:false,defval:''}),header=(rows.shift()||[]).map(h=>clean(h).toLowerCase().replace(/[ _-]/g,''));
      const ci=header.indexOf('productid'),ii=header.indexOf('image');if(ci<0)continue;valid=true;
      for(const row of rows){const pid=code(row[ci]);if(!pid)continue;const id=String(row[ii]||'').match(/\/img\/product\/(\d{5,6})/)?.[1]||'';map.set(pid,{id});}
    }
    if(!valid)throw Error('DDO-export mist Product ID');return map;
  }
  async function check(force=false){
    if(state.checking||isCart())return;state.checking=true;const epoch=++state.epoch;
    for(const b of $$('.edi-toolbar button',$('#tri-edi')))b.disabled=true;
    try{
      let cached;try{cached=JSON.parse(localStorage.getItem(CACHE));}catch{}
      const fromCache=!force&&cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries);
      if(fromCache)state.map=new Map(cached.entries);
      else{
        let done=0;status('DDO-exports ophalen: 0/2');
        const maps=await Promise.all([221,222].map(id=>new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:`https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=${id}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},data:'format=excel&export=Export+products',responseType:'arraybuffer',timeout:60000,onload:r=>{try{if(r.status!==200)throw Error(`DDO HTTP ${r.status}`);const map=exportMap(r.response);if(epoch===state.epoch)status(`DDO-exports opgehaald: ${++done}/2`);resolve(map);}catch(e){reject(e);}},onerror:()=>reject(Error('Netwerkfout DDO-export')),ontimeout:()=>reject(Error('Timeout DDO-export'))}))));
        state.map=new Map(maps.flatMap(m=>[...m]));try{localStorage.setItem(CACHE,JSON.stringify({time:Date.now(),entries:[...state.map]}));}catch{}
      }
      status(fromCache?'DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.':`Modelcheck actief · ${state.map.size} DDO-producten geladen.`);
    }catch(e){++state.epoch;state.map=null;status(e.message,true);}finally{state.checking=false;for(const b of $$('.edi-toolbar button',$('#tri-edi')))b.disabled=false;$('#tri-refresh').disabled=!state.map;render();}
  }
  function options(){
    const map=new Map(),current=active(),info=TRI_PRODUCT.info();
    if(current)map.set(current,{pid:current,name:info.colorName});
    for(const swatch of $$('button.product-swatch')){
      if(swatch.closest('.product-card'))continue;
      const row=swatch.closest('.product-row'),label=clean($('.product-swatch__label',swatch)?.textContent),rowPid=code($('.product-row__id',row||swatch)?.textContent);
      const color=label.match(/^([A-Z0-9]{2,6})(?:\s|$)/i)?.[1],pid=rowPid||(current&&color?code(`${current.split('-')[0]}-${color}`):'');
      if(!pid)continue;const previous=map.get(pid)||{};map.set(pid,{...previous,pid,swatch,name:previous.name||clean($('.product-row__id',row||swatch)?.textContent).split(/\s+-\s+/).slice(2).join(' - ')||label.replace(new RegExp('^'+pid.split('-')[1]+'\\s*','i'),'')});
    }
    return [...map.values()].sort((a,b)=>a.pid.localeCompare(b.pid,'en',{numeric:false}));
  }
  function photoURLs(){
    const values=$$('.product-details-multi-image img.c-image-zoom__origin-image').map(img=>img.src);
    for(const el of $$('.product-details-multi-image .c-image-zoom__result')){const m=el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/i);if(m)values.push(m[1]);}
    return [...new Set(values.filter(Boolean).map(raw=>{const el=document.createElement('textarea');el.innerHTML=raw;return el.value;}))].filter(url=>/^https:\/\//.test(url));
  }
  async function photos(pid){
    if(active()!==pid)throw Error('Selecteer eerst deze kleur');const urls=photoURLs();if(!urls.length)throw Error('Geen productfoto’s gevonden');
    for(const [i,url] of urls.entries()){
      const response=await fetch(url);if(!response.ok)throw Error(`Foto ${i+1}: HTTP ${response.status}`);
      const blob=await response.blob(),ext={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'}[blob.type];if(!ext)throw Error('Onbekend fotobestandstype');
      const objectURL=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectURL;a.download=`${pid}_${i+1}.${ext}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),30000);
    }
    status(`${pid}: ${urls.length} fotodownloads gestart`);
  }
  function matchHTML(pid){const match=state.map?.get(pid);return `<span class="edi-match ${state.map?(match?'edi-match-ok':'edi-match-miss'):''}">${state.map?(match?(match.id?`<a href="https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${esc(match.id)}" target="_blank" rel="noopener">✓ ${esc(match.id)}</a>`:'✓ Aanwezig'):'× Ontbreekt'):'—'}</span>`;}
  function render(){
    const host=$('#tri-colors');if(!host)return;const cart=isCart();$('#tri-edi').hidden=cart;$('#tri-order').hidden=!cart;if(cart){$('#tri-order').open=true;return;}
    const list=options(),groups=new Map();host.replaceChildren();
    for(const item of list){const model=item.pid.split('-')[0];if(!groups.has(model))groups.set(model,[]);groups.get(model).push(item);}
    for(const [model,items] of groups){
      const group=document.createElement('div'),matched=items.filter(i=>state.map?.has(i.pid)).length;
      group.innerHTML=`<div class="edi-pdp-meta"><strong>${esc(model)}</strong></div><div class="edi-summary">${state.map?`${matched}/${items.length} leverancierskleuren in DDO · ${matched===items.length?'alle kleuren aanwezig':`${items.length-matched} ontbreken`}`:'Nog niet gecontroleerd in DDO. Klik op Controleer in DDO.'}</div><div class="edi-colors"></div>`;
      const rows=[...items];if(state.map)for(const pid of state.map.keys())if(pid.startsWith(model+'-')&&!items.some(i=>i.pid===pid))rows.push({pid,name:'Alleen in DDO gevonden',ddoOnly:true});
      for(const item of rows){
        const isActive=item.pid===active(),row=document.createElement('div');row.className=`edi-color-row ${isActive?'edi-active':''}`;row.dataset.pid=item.pid;
        row.innerHTML=`<div class="edi-color-main"><button type="button" class="edi-color-select" title="Selecteer ${esc(item.pid)}"><span class="edi-swatch"></span><span class="edi-color-label">${esc(item.pid.split('-')[1])} ${esc(item.name)}</span></button>${matchHTML(item.pid)}</div><div class="edi-actions">${[['product','Product'],['sizes','Maten'],['ean','EAN'],['photos',"Foto’s"]].map(([action,label])=>`<button type="button" class="edi-action" data-action="${action}" ${item.ddoOnly||((action==='photos'||(action==='product'&&!TRI_PRODUCT.hasRow(item.pid)))&&!isActive)?'disabled':''}>${label}</button>`).join('')}</div>`;
        $('.edi-color-select',row).onclick=()=>item.swatch?.click();
        for(const button of $$('[data-action]',row))button.onclick=async()=>{
          const action=button.dataset.action;button.disabled=true;try{
            if(action==='product'){await clipboard(TRI_PRODUCT.build(item.pid));status(`${item.pid}: productgegevens gekopieerd`);}
            else if(action==='photos')await photos(item.pid);
            else{status(`${item.pid}: maten laden…`);const map=await TRI_API.get(item.pid);if(!row.isConnected)throw Error('Product gewijzigd; start opnieuw');await clipboard(action==='sizes'?DDO_EDI.sizesClipboard('Triumph / Sloggi',item.pid,[...map.keys()]):DDO_EDI.eanTSV([...map.values()],item.pid));status(`${item.pid}: ${action==='sizes'?'maten':'EAN-codes'} gekopieerd`);}
          }catch(e){status(e.message,true);}finally{button.disabled=false;}
        };
        $('.edi-colors',group).append(row);
      }
      host.append(group);
    }
    if(!list.length)host.textContent='Open een product om Product, Maten, EAN en Foto’s te gebruiken.';
    const catalogVariants=new Set();let unresolvedCards=0;
    for(const title of $$('.product-card__second-title')){
      const card=title.closest('.product-card')||title.parentElement,pid=code(title.textContent),model=pid?.split('-')[0]||clean(title.textContent).match(/\b\d{6,10}\b/)?.[0];if(!model){unresolvedCards++;continue;}
      const variants=new Set(pid?[pid]:[]);
      for(const variant of variants)catalogVariants.add(variant);
      if(!variants.size)unresolvedCards++;
      let badge=$('.edi-tri-card',card);if(!state.map){badge?.remove();continue;}
      if(!badge){badge=document.createElement('div');badge.className='edi-tri-card';card.append(badge);}
      const complete=variants.size>0&&[...variants].every(variant=>state.map.has(variant));
      badge.textContent=complete?'✓ Compleet':'× Niet Compleet';
      badge.removeAttribute('title');
      Object.assign(badge.style,{color:complete?'#18864b':'#c83939',fontWeight:'600',pointerEvents:'none',cursor:'default'});

    }
    const summary=$('#tri-catalog-summary');summary.hidden=!$$('.product-card__second-title').length;
    if(!summary.hidden){
      const matched=[...catalogVariants].filter(pid=>state.map?.has(pid)).length,complete=state.map&&catalogVariants.size>0&&!unresolvedCards&&matched===catalogVariants.size;
      summary.textContent=state.map?(complete?'✓ Compleet — Alle getoonde artikelen in DDO':'× Niet Compleet — Niet alle getoonde artikelen in DDO'):'Catalogus nog niet gecontroleerd in DDO.';
      summary.style.color=state.map?(complete?'#18864b':'#c83939'):'';
      summary.removeAttribute('title');
    }
  }

  function init(){
    if($('#edi-triumph'))return;
    const style=document.createElement('style');style.textContent=`#edi-triumph,#edi-triumph :where(*){all:revert;box-sizing:border-box}#edi-triumph :where(*){font:inherit;color:inherit;text-transform:none;letter-spacing:normal}#edi-triumph{position:fixed;top:18px;right:18px;width:430px;max-width:calc(100vw - 24px);z-index:2147483000;overflow:hidden}#edi-triumph .edi-head{display:flex;align-items:center;cursor:move}#edi-triumph button{width:auto!important;min-width:0!important;max-width:100%;margin:0!important;cursor:pointer}#edi-triumph.edi-minimized .edi-body{display:none}#edi-triumph.edi-minimized{width:220px}#edi-triumph .edi-body{overflow-x:hidden}`+DDO_EDI.theme.replaceAll('#edi-lingadore','#edi-triumph')+DDO_EDI.layout.replaceAll('#edi-lingadore','#edi-triumph');document.head.append(style);
    const panel=document.createElement('section');panel.id='edi-triumph';panel.innerHTML=`<div class="edi-head"><div class="edi-title">Toolbox · Triumph / Sloggi<span class="edi-version">v1.1.6</span></div><button class="edi-icon-btn" id="tri-collapse" aria-label="Inklappen">−</button></div><div class="edi-body"><details class="edi-module" id="tri-edi" open><summary>EDI-module</summary><div class="edi-toolbar"><button class="edi-btn" id="tri-check">Controleer in DDO</button><button class="edi-btn" id="tri-refresh" disabled>Opnieuw checken</button><button class="edi-btn edi-danger" id="tri-reset">Reset</button></div><div class="edi-status" id="tri-status" role="status">Modelcheck wacht op startsignaal.</div><div id="tri-catalog-summary" class="edi-summary" hidden></div><div id="tri-colors"></div></details><details class="edi-module" id="tri-order"><summary>Ordermodule</summary><p class="edi-module-note">Ordermodule niet van toepassing op deze leverancier.</p></details></div>`;document.body.append(panel);
    const cart=isCart();$('#tri-edi').hidden=cart;$('#tri-order').hidden=!cart;$('#tri-order').open=cart;
    const save=()=>{try{localStorage.setItem('edi:triumph:ui',JSON.stringify({left:panel.offsetLeft,top:panel.offsetTop,min:panel.classList.contains('edi-minimized')}));}catch{}};
    const clamp=()=>{if(panel.style.left)panel.style.left=Math.max(0,Math.min(panel.offsetLeft,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(panel.offsetTop,innerHeight-panel.offsetHeight))+'px';};
    try{const ui=JSON.parse(localStorage.getItem('edi:triumph:ui'));if(ui){panel.classList.toggle('edi-minimized',!!ui.min);panel.style.left=(Number(ui.left)||0)+'px';panel.style.top=(Number(ui.top)||0)+'px';panel.style.right='auto';clamp();}}catch{}
    const collapse=$('#tri-collapse'),update=()=>collapse.textContent=panel.classList.contains('edi-minimized')?'+':'−';update();collapse.onclick=()=>{panel.classList.toggle('edi-minimized');update();save();};window.addEventListener('resize',clamp);
    const head=$('.edi-head',panel);head.onpointerdown=e=>{if(e.target.closest('button'))return;const x=e.clientX-panel.offsetLeft,y=e.clientY-panel.offsetTop;head.setPointerCapture(e.pointerId);head.onpointermove=e=>{panel.style.left=e.clientX-x+'px';panel.style.top=e.clientY-y+'px';panel.style.right='auto';clamp();};head.onpointerup=()=>{head.onpointermove=null;save();};};
    $('#tri-check').onclick=()=>check();$('#tri-refresh').onclick=()=>check(true);$('#tri-reset').onclick=()=>{localStorage.removeItem(CACHE);state.map=null;$('#tri-refresh').disabled=true;status('Cache geleegd. Modelcheck staat stil.');render();};
    try{const c=JSON.parse(localStorage.getItem(CACHE));if(c&&Date.now()-c.time<900000&&Array.isArray(c.entries)){state.map=new Map(c.entries);$('#tri-refresh').disabled=false;status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');}}catch{}
    let timer;const observer=new MutationObserver(records=>{if(records.some(r=>!panel.contains(r.target)&&!r.target.closest?.('.edi-tri-card'))){if(!timer)timer=setTimeout(()=>{timer=null;refresh();},180);}});
    function refresh(){observer.disconnect();render();observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','aria-selected','aria-pressed','src','href']});}
    refresh();window.addEventListener('popstate',refresh);
    let lastURL=location.href;setInterval(()=>{if(location.href!==lastURL){lastURL=location.href;refresh();}},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

})();
