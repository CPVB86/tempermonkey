// ==UserScript==
// @name DDO Toolbox | EDI | Mey
// @namespace https://dutchdesignersoutlet.nl/
// @version 3.0.0
// @description Mey EDI: modelcheck, Product, Maten, EAN, foto's, bestellen en DDO EAN/voorraad.
// @match https://meyb2b.com/*
// @match https://www.meyb2b.com/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_download
// @connect meyb2b.com
// @connect www.meyb2b.com
// @connect media.meyb2b.com
// @connect www.dutchdesignersoutlet.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-idle
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-mey.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-mey.user.js
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
const MEY_API=(()=>{
const norm=DDO_EDI.normalizeSize;
  const CONTEXT={dataareaid:'ME:NO',custid:'385468',assortid:'ddd8763b-b678-4004-ba8b-c64d45b5333c',ordertypeid:'NO',webSocketUniqueId:crypto?.randomUUID?.()||`ws-${Date.now()}-${Math.floor(Math.random()*1e6)}`};
  function post(endpoint,style,color){const unique=`${Date.now()}r${Math.floor(Math.random()*1000)}`,url=`https://meyb2b.com/b2bapi?-/${unique}/${endpoint}`,styleQuery={custareaid:'ME',styleareaid:'NO',styleid:String(style),variantid:'*'};if(endpoint==='AssortmentDetail/collection')styleQuery.yattrib=String(color);else styleQuery.zkey='*';const payload=[{_getparams:{'':'undefined'},_webSocketUniqueId:CONTEXT.webSocketUniqueId,_url:endpoint,_dataareaid:CONTEXT.dataareaid,_agentid:null,_custid:CONTEXT.custid,_method:'read',styles:[styleQuery],assortid:CONTEXT.assortid,ordertypeid:CONTEXT.ordertypeid}];return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url,data:JSON.stringify(payload),headers:{'content-type':'application/json;charset=UTF-8',accept:'application/json, text/plain, */*'},withCredentials:true,timeout:15000,onload:response=>{if(response.status<200||response.status>=400)return reject(Error(`Mey HTTP ${response.status}`));try{resolve(JSON.parse(response.responseText||''))}catch{reject(Error('Ongeldige Mey-data'))}},onerror:()=>reject(Error('Netwerkfout bij Mey')),ontimeout:()=>reject(Error('Timeout bij Mey'))}))}
  function qty(value){const number=Number(value)||0;return number<=0?0:number<=2?1:number===3?2:number===4?3:5}
  function exactMap(json,color,source){const raw=json?.[0]?.result||[],records=Array.isArray(raw)?raw:[raw],map=new Map(),wanted=String(color).trim();for(const record of records){const values=source==='assortment'?record?.detailData?.xvalues:record?.xvalues;for(const [key,value] of Object.entries(values||{})){const bra=String(key).match(/^([A-Z]{1,4});([^;]+);(\d{2,3})$/i),apparel=String(key).match(/^\*;([^;]+);([^;]+)$/);let size='',keyColor='';if(bra){keyColor=String(bra[2]).trim();size=norm(`${bra[3]}${bra[1]}`)}else if(apparel){keyColor=String(apparel[1]).trim();const keySize=norm(apparel[2]),valueSize=norm(value?.size||apparel[2]);if(keySize!==valueSize)continue;size=keySize}else continue;if(keyColor!==wanted||!size)continue;const ean=String(value?.ean||value?.eanCode||value?.gtin||value?.barcode||'').replace(/\D/g,''),blocked=source==='order'&&value?.blocked===true,stockValue=source==='order'?(value?.stock??value?.quantity):null,hasStock=stockValue!==null&&stockValue!==undefined&&stockValue!=='',parsedStock=hasStock?Number(stockValue):NaN,remote=blocked?0:Number.isFinite(parsedStock)?Math.max(0,parsedStock):null,entry={ean,remote,blocked,key:String(key),source},known=map.get(size);if(!known){map.set(size,entry);continue}if(known.ean&&entry.ean&&known.ean!==entry.ean)throw Error(`Conflicterende exacte ${source}-EAN voor ${size}`);if(Number.isFinite(known.remote)&&Number.isFinite(entry.remote)&&known.remote!==entry.remote)throw Error(`Conflicterende exacte ${source}-stock voor ${size}`);if(known.blocked!==entry.blocked)throw Error(`Conflicterende blocked-status voor ${size}`);map.set(size,{...known,ean:known.ean||entry.ean,remote:Number.isFinite(known.remote)?known.remote:entry.remote})}}return map}
  function pairs(order,assortment){const map=new Map();for(const [size,live] of order){const catalog=assortment.get(size);if(live.ean&&catalog?.ean&&live.ean!==catalog.ean)throw Error(`OrderDetail en AssortmentDetail EAN verschillen voor ${size}`);const ean=live.ean||catalog?.ean||'';map.set(size,{ean,stock:Number.isFinite(live.remote)?qty(live.remote):null,available:live.remote,blocked:live.blocked,key:live.key,eanSource:live.ean?'OrderDetail':ean?'AssortmentDetail':''})}console.table([...map].map(([size,value])=>({size,ean:value.ean,eanSource:value.eanSource||'geen',remoteStock:value.available??'ontbreekt',blocked:value.blocked,ddoStock:value.stock??'niet wijzigen',key:value.key})));return map}

async function get(pid){
 const match=String(pid).match(/^(\d+)-(\d+)$/);if(!match)throw Error('Mey Supplier ID vereist STYLE-KLEUR');
 const [,style,color]=match;
 const order=exactMap(await post('OrderDetail/collection',style,color),color,'order');
 if(!order.size)throw Error('Geen exacte Mey-varianten voor '+pid);
 const assortment=[...order.values()].some(v=>!v.ean)?exactMap(await post('AssortmentDetail/collection',style,color),color,'assortment'):new Map();
 return pairs(order,assortment);
}
return {get,exactMap,pairs};
})();

const MEY_PRODUCT=(()=>{
  const BUTTON_CLASS = "copy-sparkle";
  const BUTTON_TEXT = "✨";



  /******************************************************************
   * Helpers
   ******************************************************************/

  const txt = (el) =>
    (el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

  function normalizeWhitespace(value = "") {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePrice(text) {
    let cleaned = String(text || "")
      .replace(/[^\d,.]/g, "")
      .trim();

    if (!cleaned) return "";

    /*
     * Mey:
     * 69,99 -> 69.99
     */
    if (cleaned.includes(",") && !cleaned.includes(".")) {
      cleaned = cleaned.replace(",", ".");
    }

    return cleaned;
  }

  function toTitleCaseWords(value = "") {
    return String(value || "")
      .toLowerCase()
      .replace(/\b([a-zà-ÿ])/g, char => char.toUpperCase())
      .trim();
  }

  function escapeHtml(value = "") {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value = "") {
    return String(value)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function slugify(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /******************************************************************
   * Artikelnummer
   *
   * Nieuwe DOM:
   *
   * data-field="displayStyleId"
   * <span class="value">1350002</span>
   ******************************************************************/

  function extractStyleId() {
    const el = document.querySelector(
      '.components-ProductDetails [data-field="displayStyleId"] .value'
    );

    return txt(el);
  }

  /******************************************************************
   * Adviesprijs
   *
   * data-field="salesPrice"
   * Adviesprijs: 69,99
   ******************************************************************/

  function extractRrp() {
    const el = document.querySelector(
      '.components-ProductDetails [data-field="salesPrice"] .value'
    );

    return normalizePrice(txt(el));
  }

  /******************************************************************
   * Producttitel
   *
   * bijvoorbeeld:
   * wired bra
   ******************************************************************/

  function extractProductTitle() {
    const desktop = document.querySelector(
      ".components-ProductDetails .head.desktop h1"
    );

    const mobile = document.querySelector(
      ".components-ProductDetails .head.mobile h1"
    );

    return txt(desktop || mobile);
  }

  /******************************************************************
   * PIM / productinformatie
   ******************************************************************/

  function getPimBlocks() {
    return [
      ...document.querySelectorAll(
        ".components-ProductDetails-PimDataBlock"
      )
    ];
  }

  /*
   * Mey rendert bepaalde informatie dubbel.
   *
   * Daarom maken we een unieke lijst op basis van:
   *
   * titel + daadwerkelijke tekstinhoud
   */
  function getUniquePimBlocks() {
    const unique = [];
    const seen = new Set();

    for (const block of getPimBlocks()) {
      const title = txt(
        block.querySelector(".header h3")
      );

      const content = block.querySelector(".content");

      if (!title || !content) {
        continue;
      }

      const normalizedContent = normalizeWhitespace(
        content.textContent
      );

      const key =
        `${title.toLowerCase()}::${normalizedContent.toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      unique.push({
        block,
        title,
        content,
        normalizedContent
      });
    }

    return unique;
  }

  function extractPimBlockText(titleWanted) {
    const wanted = String(titleWanted || "")
      .trim()
      .toLowerCase();

    const found = getUniquePimBlocks()
      .find(item =>
        item.title.toLowerCase() === wanted
      );

    return found
      ? found.normalizedContent
      : "";
  }

  /******************************************************************
   * Serie
   *
   * Bijvoorbeeld uit:
   *
   * "De mey beugelbeha uit de serie Fabulous in de kleur..."
   *
   * -> Fabulous
   ******************************************************************/

  function extractSeriesNameRaw() {
    const description =
      extractPimBlockText("Beschrijving");

    if (!description) {
      return "";
    }

    const patterns = [
      /\buit\s+de\s+serie\s+(.+?)(?=\s+in\s+de\s+kleur\b)/i,
      /\bvan\s+de\s+serie\s+(.+?)(?=\s+in\s+de\s+kleur\b)/i,
      /\bserie\s+["“]?([^"”.,]+?)["”]?(?=\s+in\s+de\s+kleur\b)/i
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);

      if (match?.[1]) {
        return normalizeWhitespace(match[1]);
      }
    }

    return "";
  }

  /******************************************************************
   * Kleur uit één specifiek ordergrid
   *
   * Nieuwe Mey DOM:
   *
   * <div
   *   class="components-OrderGrid"
   *   data-color-key="1748"
   * >
   *   <div class="order-grid-color-title">
   *     1748 teal dream
   *   </div>
   * </div>
   ******************************************************************/

  function getColorInfoFromGrid(grid) {
    if (!grid) {
      return {
        colorKey: "",
        colorName: "",
        raw: ""
      };
    }

    const colorKey = String(
      grid.dataset.colorKey || ""
    ).trim();

    const titleEl = grid.querySelector(
      ".order-grid-color-title"
    );

    if (!titleEl) {
      return {
        colorKey,
        colorName: "",
        raw: ""
      };
    }

    /*
     * Clone gebruiken zodat onze eigen ✨-button
     * niet wordt meegenomen in de tekst.
     */
    const clone = titleEl.cloneNode(true);

    clone
      .querySelectorAll(`.${BUTTON_CLASS}`)
      .forEach(el => el.remove());

    const raw = txt(clone);

    let colorName = raw;

    if (colorKey) {
      colorName = colorName.replace(
        new RegExp(
          `^${escapeRegExp(colorKey)}\\s*`,
          "i"
        ),
        ""
      );
    }

    colorName = normalizeWhitespace(colorName);

    return {
      colorKey,
      colorName,
      raw
    };
  }

  /******************************************************************
   * Actief geselecteerde kleur
   *
   * Alleen gebruikt voor compositionUrl-detectie.
   * NIET voor productCode/supplierId.
   ******************************************************************/

  function getActiveColorInfo() {
    const active = document.querySelector(
      ".components-ProductDetails-Color .active-color"
    );

    if (!active) {
      return {
        colorKey: "",
        colorName: ""
      };
    }

    const spans = [
      ...active.querySelectorAll("span")
    ]
      .map(el => txt(el))
      .filter(Boolean);

    const raw =
      spans.find(
        value => !/^kleur\s*:?$/i.test(value)
      ) ||
      txt(active).replace(
        /^kleur\s*:\s*/i,
        ""
      );

    const match = raw.match(
      /^(\d+)\s*(.*)$/
    );

    if (!match) {
      return {
        colorKey: "",
        colorName: normalizeWhitespace(raw)
      };
    }

    return {
      colorKey: match[1],
      colorName: normalizeWhitespace(
        match[2]
      )
    };
  }

  /******************************************************************
   * Description HTML
   *
   * BELANGRIJK:
   * dubbele Mey desktop/mobile PIM-blokken worden hier
   * verwijderd.
   ******************************************************************/

  const ALLOW_TITLES = new Set([
    "details",
    "beschrijving",
    "care instructions",
    "samenstelling materiaal"
  ]);

  function buildDescriptionHtmlFromPim() {
    const parts = [];

    /*
     * Extra veiligheid:
     *
     * Ook nadat de DOM al gededupliceerd is,
     * bewaken we de uiteindelijke HTML-blokken nog
     * een tweede keer.
     */
    const seenOutput = new Set();

    const blocks = getUniquePimBlocks();

    for (const item of blocks) {
      const {
        title,
        content
      } = item;

      const normalizedTitle =
        title.toLowerCase();

      if (!ALLOW_TITLES.has(normalizedTitle)) {
        continue;
      }

      let contentHtml = "";

      /**************************************************************
       * Details
       **************************************************************/

      const ul = content.querySelector("ul");

      if (ul) {
        const listItems = [
          ...ul.querySelectorAll("li")
        ]
          .map(li => txt(li))
          .filter(Boolean);

        if (!listItems.length) {
          continue;
        }

        contentHtml =
          `<ul>${
            listItems
              .map(
                item =>
                  `<li>${escapeHtml(item)}</li>`
              )
              .join("")
          }</ul>`;
      }

      /**************************************************************
       * Care Instructions
       **************************************************************/

      else if (
        normalizedTitle ===
        "care instructions"
      ) {
        const labels = [
          ...content.querySelectorAll(
            ".carelabels .label"
          )
        ]
          .map(el => txt(el))
          .filter(Boolean);

        if (labels.length) {
          contentHtml =
            `<ul>${
              labels
                .map(
                  label =>
                    `<li>${escapeHtml(label)}</li>`
                )
                .join("")
            }</ul>`;
        } else {
          const value = txt(content);

          if (!value) {
            continue;
          }

          contentHtml =
            `<p>${escapeHtml(value)}</p>`;
        }
      }

      /**************************************************************
       * Beschrijving / Samenstelling materiaal
       **************************************************************/

      else {
        const value = txt(content);

        if (!value) {
          continue;
        }

        contentHtml =
          `<p>${escapeHtml(value)}</p>`;
      }

      const html =
        `<b>${escapeHtml(title)}</b><br><br>${contentHtml}`;

      /*
       * Exact dezelfde uitvoer nooit tweemaal toevoegen.
       */
      const outputKey =
        normalizeWhitespace(html)
          .toLowerCase();

      if (seenOutput.has(outputKey)) {
        continue;
      }

      seenOutput.add(outputKey);
      parts.push(html);
    }

    return parts
      .join("<br><br>")
      .trim();
  }

  /******************************************************************
   * Composition URL per kleur
   *
   * Actieve URL bijvoorbeeld:
   *
   * /wired-bra-1748-teal-dream-8qeFtW3Mgkc2
   *
   * Voor een andere kleur proberen we alleen het gedeelte
   * "1748-teal-dream" te vervangen.
   *
   * Als dat niet betrouwbaar lukt, blijft location.href staan.
   ******************************************************************/

  function buildCompositionUrl(
    colorKey,
    colorName
  ) {
    const current = new URL(
      location.href
    );

    const active =
      getActiveColorInfo();

    if (
      !active.colorKey ||
      !colorKey
    ) {
      return current.href;
    }

    /*
     * Dit is de al actieve kleur.
     */
    if (
      String(active.colorKey) ===
      String(colorKey)
    ) {
      return current.href;
    }

    const activeColorPart = [
      active.colorKey,
      slugify(active.colorName)
    ]
      .filter(Boolean)
      .join("-");

    const wantedColorPart = [
      colorKey,
      slugify(colorName)
    ]
      .filter(Boolean)
      .join("-");

    if (
      activeColorPart &&
      wantedColorPart &&
      current.pathname.includes(
        activeColorPart
      )
    ) {
      current.pathname =
        current.pathname.replace(
          activeColorPart,
          wantedColorPart
        );

      return current.href;
    }

    /*
     * Geen veilige vervanging mogelijk.
     */
    return location.href;
  }

  /******************************************************************
   * SPARKLE output
   ******************************************************************/

  function toSparkleComment(payload) {
    return `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  }

  /******************************************************************
   * Payload per kleur
   ******************************************************************/

  function buildSparklePayload(grid, colorOverride) {
    const styleId =
      extractStyleId();

    const rrp =
      extractRrp();

    const productTitle =
      extractProductTitle();

    const seriesRaw =
      extractSeriesNameRaw();

    const seriesTitle =
      toTitleCaseWords(seriesRaw);

    const {
      colorKey,
      colorName
    } = colorOverride || getColorInfoFromGrid(grid);

    const productTitleFormatted =
      toTitleCaseWords(
        productTitle
      );

    const colorNameFormatted =
      toTitleCaseWords(
        colorName
      );

    /*
     * Bijvoorbeeld:
     *
     * Fabulous Wired Bra Teal Dream
     */
    const name = [
      seriesTitle,
      productTitleFormatted,
      colorNameFormatted
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    /*
     * Bijvoorbeeld:
     *
     * 1350002-1748
     */
    const supplierId =
      styleId && colorKey
        ? `${styleId}-${colorKey}`
        : "";

    const productCode =
      supplierId;

    const descriptionHtml =
      buildDescriptionHtmlFromPim();

    const compositionUrl =
      buildCompositionUrl(
        colorKey,
        colorName
      );

    const reference =
      " - [ext]";

    return {
      name,
      rrp,
      productCode,
      modelName: seriesRaw,
      descriptionHtml,
      compositionUrl,
      reference,
      supplierId
    };
  }

  /******************************************************************
   * Clipboard
   ******************************************************************/


return {build:buildSparklePayload,style:extractStyleId,title:extractProductTitle,color:getColorInfoFromGrid,active:getActiveColorInfo};
})();

const MEY_ORDER={create(document){
const location=document.location||window.location;
const SEARCH_BASE=location.origin+"/d-reorder-mey/search/products/";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = value => DDO_EDI.normalizeSize(value);
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function parseProductRef(productRef) {
    const text = String(productRef || "").trim();
    const oldKey = decodeURIComponent(text).match(/ME;NO;([^;]+);\*\/([^/?#]+)/i);
    if (oldKey) return { article: oldKey[1], color: oldKey[2] };

    const match = text.match(/^(.+)-([^-]+)$/);
    return match
      ? { article: match[1].trim(), color: match[2].trim() }
      : { article: text, color: "" };
  }

  function parseRows(text) {
    const rows = [];
    const errors = [];

    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const cols = line.split("\t").map((col) => col.trim());
        const [productRef = "", size = "", quantityRaw = ""] = cols;
        const product = parseProductRef(productRef);
        const quantity = Number(quantityRaw);

        if (cols.length < 3) errors.push(`Regel ${index + 1}: verwacht artikel-kleur<TAB>maat<TAB>aantal`);
        else if (!product.article || !product.color) errors.push(`Regel ${index + 1}: verwacht artikel-kleur, bijvoorbeeld 74239-3`);
        else if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        else if (!Number.isSafeInteger(quantity) || quantity <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);
        else rows.push({ productRef, article: product.article, color: product.color, size, quantity });
      });

    return { rows, errors };
  }

  function productKey(row) {
    return `${normalize(row.article)}-${normalize(row.color)}`;
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = productKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function isSearchPageFor(article) {
    const path = decodeURIComponent(location.pathname || "").replace(/\/+$/, "");
    const routeMatch = path.match(/\/search\/products\/([^/]+)/i);
    const articleInPath = routeMatch?.[1] || "";

    return normalize(articleInPath) === normalize(article);
  }

  function getColorCode(value) {
    return normalize(String(value || "").trim().split(/\s+/)[0]);
  }

  function findProductCard(row) {
    return Array.from(document.querySelectorAll("article.components-StyleCollectionView-ItemView")).find((card) => {
      const article = card.querySelector(".styleid")?.textContent || "";
      const color = card.querySelector(".color-name")?.textContent || "";
      return normalize(article) === normalize(row.article) &&
        getColorCode(color) === normalize(row.color);
    }) || null;
  }

  function getQuickEntryDialog(row) {
    return Array.from(document.querySelectorAll(".components-StyleCollectionView-QuickEntryDialog")).find((dialog) => {
      const article = dialog.querySelector('[data-field="displayStyleId"] .value')?.textContent || "";
      return normalize(article) === normalize(row.article) &&
        hasExactColorGrid(dialog, row.color);
    }) || null;
  }

  function hasExactColorGrid(root, color) {
    const wanted = normalize(color);

    const cupGrid = Array.from(root.querySelectorAll(".components-OrderGrid[data-color-key]")).some(
      (grid) => normalize(grid.dataset.colorKey) === wanted
    );
    if (cupGrid) return true;

    return Array.from(root.querySelectorAll('.components-OrderGrid [data-colid="color"][data-rowid]')).some(
      (cell) => normalize(cell.getAttribute("data-rowid")) === wanted &&
        getColorCode(cell.querySelector(".content")?.textContent || cell.textContent) === wanted
    );
  }

  async function waitFor(test, message, timeoutMs = 25000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = test();
      if (result) return result;
      await sleep(250);
    }
    throw new Error(message);
  }

  async function ensureQuickEntry(row) {
    if (getQuickEntryDialog(row)) return true;

    const openDialog = document.querySelector(".components-StyleCollectionView-QuickEntryDialog");
    if (openDialog) {
      openDialog.querySelector("i.close")?.click();
      await waitFor(
        () => !document.querySelector(".components-StyleCollectionView-QuickEntryDialog"),
        "Vorige snelbestelvenster kon niet worden gesloten",
        5000
      );
    }

    const wantedSearch = SEARCH_BASE + encodeURIComponent(row.article);
    if (!isSearchPageFor(row.article)) {
      throw Error("Zoekpagina hoort niet bij het aangevraagde artikel");
    }

    const card = await waitFor(
      () => findProductCard(row),
      `Geen zoekkaart gevonden voor artikel ${row.article}, kleur ${row.color}`
    );

    const quickButton = card.querySelector("button.quick-view");
    if (!quickButton) throw new Error(`Knop 'Maat selecteren' ontbreekt voor ${row.productRef}`);
    quickButton.click();

    await waitFor(
      () => getQuickEntryDialog(row),
      `Snel bestellen werd niet geopend voor ${row.productRef}`,
      10000
    );
    return true;
  }

  function getColorGrid(color, root = document) {
    const wanted = normalize(color);
    return Array.from(root.querySelectorAll(".components-OrderGrid[data-color-key]")).find(
      (grid) => normalize(grid.dataset.colorKey) === wanted
    ) || null;
  }

  function getGridAxis(grid, selector, attribute) {
    const result = new Map();
    grid.querySelectorAll(selector).forEach((cell) => {
      const key = cell.getAttribute(attribute);
      const label = normalize(cell.querySelector(".content")?.textContent || cell.textContent);
      if (key != null && label) result.set(String(key), label);
    });
    return result;
  }

  function findSizeCell(row) {
    const root = getQuickEntryDialog(row);
    if (!root) return null;

    const cupGrid = getColorGrid(row.color, root);
    if (cupGrid) return findCupSizeCell(cupGrid, row.size, row.color);

    return findSimpleSizeCell(root, row.size, row.color);
  }

  function findCupSizeCell(grid, size, color) {
    const desktop = grid.querySelector(".components-OrderGrid-DesktopRenderer");
    if (!desktop) return null;

    const sizeMatch = normalize(size).match(/^(\d+)([A-Z]+)$/);
    if (!sizeMatch) return null;

    const [, band, cup] = sizeMatch;
    const columnLabels = getGridAxis(desktop, '[data-rowid="header"][data-colid]', "data-colid");
    const rowLabels = getGridAxis(desktop, '[data-colid="cup"][data-rowid]:not([data-rowid="header"])', "data-rowid");

    const columnId = Array.from(columnLabels).find(([, label]) => label === band)?.[0];
    const rowId = Array.from(rowLabels).find(([, label]) => label === cup)?.[0];
    if (columnId == null || rowId == null) return null;

    return Array.from(desktop.querySelectorAll('[data-rowid][data-colid]')).find((cell) =>
      cell.getAttribute("data-rowid") === rowId &&
      cell.getAttribute("data-colid") === columnId &&
      normalize(cell.getAttribute("data-row-groupid")) === normalize(color) &&
      Boolean(cell.querySelector('.quantity-content, button[aria-label="Aantal verhogen"]'))
    ) || null;
  }

  function findSimpleSizeCell(root, size, color) {
    const wantedSize = normalize(size);
    const wantedColor = normalize(color);

    for (const grid of root.querySelectorAll(".components-OrderGrid:not([data-color-key])")) {
      const desktop = grid.querySelector(".components-OrderGrid-DesktopRenderer");
      if (!desktop) continue;

      const colorHeader = Array.from(desktop.querySelectorAll('[data-colid="color"][data-rowid]:not([data-rowid="header"])')).find(
        (cell) => normalize(cell.getAttribute("data-rowid")) === wantedColor &&
          getColorCode(cell.querySelector(".content")?.textContent || cell.textContent) === wantedColor
      );
      if (!colorHeader) continue;

      const columnLabels = getGridAxis(desktop, '[data-rowid="header"][data-colid]', "data-colid");
      const columnId = Array.from(columnLabels).find(([, label]) => label === wantedSize)?.[0];
      if (columnId == null) return null;

      return Array.from(desktop.querySelectorAll('[data-rowid][data-colid]')).find((cell) =>
        normalize(cell.getAttribute("data-rowid")) === wantedColor &&
        cell.getAttribute("data-colid") === columnId &&
        Boolean(cell.querySelector('.quantity-content, button[aria-label="Aantal verhogen"]'))
      ) || null;
    }

    return null;
  }

  function readCellQuantity(cell) {
    const value = Number.parseInt(cell?.querySelector(".quantity-content")?.textContent || "", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function getPlusButton(cell) {
    return cell?.querySelector('button[aria-label="Aantal verhogen"]') || null;
  }

  function isCellOrderable(cell) {
    const plus = getPlusButton(cell);
    return Boolean(plus && !plus.disabled && !cell.classList.contains("disabled"));
  }

  function dispatchPointerTap(element) {
    const view = element.ownerDocument.defaultView;
    if (typeof view.PointerEvent !== "function") return;

    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    element.dispatchEvent(new view.PointerEvent("pointerdown", options));
    element.dispatchEvent(new view.PointerEvent("pointerup", { ...options, buttons: 0 }));
  }

  function dispatchMouseClick(element) {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    ["mousedown", "mouseup", "click"].forEach((type) => {
      element.dispatchEvent(new view.MouseEvent(type, options));
    });
  }

  async function waitForQuantityIncrease(row, before, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(150);
      const freshCell = findSizeCell(row);
      if (freshCell && readCellQuantity(freshCell) >= before + 1) return true;
    }
    return false;
  }

  async function clickPlus(row) {
    const cell = findSizeCell(row);
    if (!cell) throw new Error(`Maat ${row.size} niet gevonden in kleur ${row.color}`);
    if (!isCellOrderable(cell)) throw new Error(`${row.productRef}, maat ${row.size} is niet bestelbaar`);

    const before = readCellQuantity(cell);
    const plus=getPlusButton(cell);
    dispatchPointerTap(plus);
    if(await waitForQuantityIncrease(row,before,6000)) {
      if(readCellQuantity(findSizeCell(row))!==before+1)throw Error('Aantal wijkt af; controleer het winkelmandje');
      return;
    }
    throw Error(`Mey bevestigde de verhoging niet voor ${row.productRef}, maat ${row.size}; niet opnieuw toevoegen`);
  }

  async function addRow(row) {
    for (let i = 0; i < row.quantity; i += 1) {
      await clickPlus(row);
      await sleep(300);
    }
  }


return {parseRows,groupRows,ensureQuickEntry,findSizeCell,isCellOrderable,readCellQuantity,addRow};
}};

(() => {
 if(location.hostname!=='www.dutchdesignersoutlet.com'||window.top!==window.self)return;
 const $=(s,r=document)=>r.querySelector(s),ID='mey',VERSION='3.0.0';let busy=false;
 const send=(name,data)=>document.dispatchEvent(new CustomEvent('ddo-toolbox:'+name,{detail:JSON.stringify(data)}));
 const brand=()=>/\bmey\b/i.test($('#tabs-1 #select2-brand-container')?.textContent||$('#tabs-1 select[name="brand"] option:checked')?.textContent||'');
 const pid=()=>$('#tabs-1 input[name="supplier_pid"]')?.value.trim()||'';
 const announce=()=>send('adapter-state',{id:ID,label:'Mey',version:VERSION,updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-mey.user.js',priority:80,available:brand(),capabilities:['edi','ean','stock']});
 const rows=table=>[...table.querySelectorAll('tbody tr')].map(row=>({size:DDO_EDI.normalizeSize($('td:first-child input,td:first-child select',row)?.value||$('td:first-child',row)?.textContent),ean:$('input[name$="[barcode]"]',row),stock:$('input[name$="[stock]"]',row)}));
 document.addEventListener('ddo-toolbox:discover',announce);
 document.addEventListener('ddo-toolbox:run-adapter',async event=>{
  let request;try{request=JSON.parse(event.detail);}catch{return;}if(request.id!==ID)return;
  const status=(text,kind='busy',done=false,changed=0)=>send('adapter-status',{requestId:request.requestId,text,kind,done,changed,autoSave:done&&kind==='success'&&!!request.autoSave});
  if(busy)return status('Mey is al bezig','error',true);busy=true;
  try{
   const table=$('#tabs-3 table.options'),original=pid();if(!brand()||!table)throw Error('Open een Mey-product met maten');
   const before=rows(table);status('Mey OrderDetail laden…');const map=await MEY_API.get(original);
   const current=rows(table);
   if(!table.isConnected||table!==$('#tabs-3 table.options')||pid()!==original||!brand()||current.length!==before.length||before.some((r,i)=>r.size!==current[i].size||r.ean!==current[i].ean||r.stock!==current[i].stock))throw Error('Product of maten gewijzigd; start opnieuw');
   const updates=[];
   for(const row of before){const value=map.get(row.size);if(!value)continue;if(value.ean&&!/^\d{8,14}$/.test(value.ean))throw Error('Ongeldige EAN voor '+row.size);if(row.ean&&value.ean)updates.push([row.ean,value.ean]);if(row.stock&&Number.isFinite(value.stock))updates.push([row.stock,String(value.stock)]);}
   let changed=0;for(const [input,value] of updates){if(input.disabled||input.readOnly||input.value===value)continue;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));changed++;}
   status(`${changed} velden exact gevuld`,'success',true,changed);
  }catch(e){status(e.message,'error',true);}finally{busy=false;}
 });
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',announce,{once:true});else announce();
})();

(() => {
  'use strict';
  const VERSION='3.0.0', ID='mey', BASE=location.origin;
  if(window.top!==window.self)return;
  if(!['meyb2b.com','www.meyb2b.com'].includes(location.hostname))return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cart=()=>DDO_EDI.isCartPage();
  const orderApi=MEY_ORDER.create(document);
  const CACHE='edi:mey:ddo:v2', BRANDS=[];
  const state={map:null,checking:false,ordering:false,downloading:false,rows:[]};
  const code=value=>clean(value).match(/^\d+-\d+$/)?.[0]||'';
  async function brandIds(){
    if(BRANDS.length)return BRANDS;
    const html=await new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url:'https://www.dutchdesignersoutlet.com/admin.php?section=products',timeout:30000,onload:r=>r.status===200?resolve(r.responseText):reject(Error('DDO-merken niet bereikbaar')),onerror:()=>reject(Error('DDO-merken niet bereikbaar')),ontimeout:()=>reject(Error('DDO-merken timeout'))}));
    const doc=new DOMParser().parseFromString(html,'text/html'),ids=new Set();
    for(const option of doc.querySelectorAll('select option'))if(/^mey$/i.test(clean(option.textContent))&&/^\d+$/.test(option.value))ids.add(option.value);
    if(ids.size!==1)throw Error('Mey-merk niet eenduidig gevonden in DDO; controleer de DDO-login');
    BRANDS.push(...ids);return BRANDS;
  }
  function exportMap(buffer) {
    const wb=XLSX.read(buffer,{type:'array'}), map=new Map();let valid=false;
    for(const name of wb.SheetNames||[]) {
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:false,defval:'',blankrows:false});
      const heads=(rows[0]||[]).map(v=>clean(v).toLowerCase().replace(/[ _-]/g,''));
      const ci=['supplierpid','supplierproductid','productid'].map(v=>heads.indexOf(v)).find(i=>i>=0);
      const ii=['image','images','imageurl','afbeelding'].map(v=>heads.indexOf(v)).find(i=>i>=0);
      if(ci===undefined)continue;valid=true;
      for(const row of rows.slice(1)) {
        const key=code(row[ci]);if(!key)continue;
        const id=String(row[ii]||'').match(/https:\/\/www\.dutchdesignersoutlet\.com\/img\/product\/(\d+)(?=\D|$)/)?.[1]||'';
        if(!map.has(key)||id)map.set(key,{id});
      }
    }
    if(!valid)throw Error('DDO-export mist Product ID / Supplier PID; controleer de DDO-login');
    return map;
  }
  function exportBrand(id) {
    return new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'POST',url:`https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=${id}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},data:'format=excel&export=Export+products',responseType:'arraybuffer',timeout:60000,
      onload:r=>{try{if(r.status!==200)throw Error(`Merk ${id}: HTTP ${r.status}`);resolve(exportMap(r.response));}catch(e){reject(e);}},onerror:()=>reject(Error(`Netwerkfout merk ${id}`)),ontimeout:()=>reject(Error(`Timeout merk ${id}`))}));
  }
  const status=(text,error=false)=>{const el=$('#mey-status');el.textContent=text;el.style.color=error?'#c83939':'';};
  async function check(force=false) {
    if(cart()||state.checking)return;state.checking=true;
    $$('#mey-check,#mey-refresh,#mey-reset').forEach(b=>b.disabled=true);
    try {
      let cached;try{cached=JSON.parse(localStorage.getItem(CACHE));}catch{}
      if(!force&&cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries)) {
        state.map=new Map(cached.entries);status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');
      } else {
        await brandIds();const maps=[];
        for(const id of BRANDS){status(`DDO-export ophalen · merk ${id} · ${maps.length+1}/${BRANDS.length}`);maps.push(await exportBrand(id));}
        state.map=new Map(maps.flatMap(m=>[...m]));
        try{localStorage.setItem(CACHE,JSON.stringify({time:Date.now(),entries:[...state.map]}));}catch{}
        status(`Modelcheck actief · ${state.map.size} producten · Mey-export opgehaald`);
      }
    }catch(e){state.map=null;status(e.message,true);}
    finally{state.checking=false;$$('#mey-check,#mey-refresh,#mey-reset').forEach(b=>b.disabled=false);render();}
  }
  function match(key) {
    if(!state.map)return '';
    const found=state.map.get(key);
    return found?`<span class="edi-match edi-match-ok">${found.id?`✓ <a target="_blank" rel="noopener" href="https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(found.id)}">${esc(found.id)}</a>`:'✓ Aanwezig'}</span>`:'<span class="edi-match edi-match-miss">× Ontbreekt</span>';
  }
  function colors() {
    const model=MEY_PRODUCT.style();if(!model)return [];
    const found=new Map();
    for(const grid of $$('.components-OrderGrid')){
      const add=color=>{const key=code(`${model}-${color.colorKey}`);if(key&&!found.has(key))found.set(key,{grid,model,color:color.colorKey,colorInfo:color,key,supplierId:key,label:[color.colorKey,color.colorName].filter(Boolean).join(' ')});};
      if(grid.dataset.colorKey)add(MEY_PRODUCT.color(grid));
      else for(const cell of $$('[data-colid="color"][data-rowid]:not([data-rowid="header"])',grid)){
        const colorKey=cell.getAttribute('data-rowid'),raw=clean($('.content',cell)?.textContent||cell.textContent);add({colorKey,colorName:raw.replace(new RegExp('^'+colorKey+'\\s*'),'')});
      }
    }
    return [...found.values()];
  }
  async function gallery(key) {
    const root=$('.features-articledetail-MediaView');if(!root)throw Error('Geen Mey-galerij op deze pagina');
    const active=MEY_PRODUCT.active().colorKey;
    if(active&&key!==`${MEY_PRODUCT.style()}-${active}`)throw Error('Selecteer eerst deze kleur in de Mey-galerij');
    const page=location.href,items=new Map();
    const collect=()=>{
      for(const el of $$('.image,[style*="background-image"]',root)){
        const raw=(el.style.backgroundImage||getComputedStyle(el).backgroundImage).match(/url\((['"]?)(.*?)\1\)/i)?.[2];if(!raw)continue;
        let url;try{url=new URL(raw.replaceAll('&amp;','&'),location.href);}catch{continue;}
        if(url.protocol!=='https:'||!/(^|\.)meyb2b\.com$/i.test(url.hostname))continue;
        const ext=url.pathname.match(/\.(jpg|jpeg|png|webp)$/i)?.[1];if(!ext)continue;
        if(url.searchParams.has('width'))url.searchParams.set('width',String(Math.max(2000,Number(url.searchParams.get('width'))||0)));
        if(url.searchParams.has('height'))url.searchParams.set('height',String(Math.max(3000,Number(url.searchParams.get('height'))||0)));
        url.hash='';const identity=new URL(url);for(const param of ['width','height','ts'])identity.searchParams.delete(param);
        if(!items.has(identity.href))items.set(identity.href,{url:url.href,name:`${key}_${items.size+1}.${ext.toLowerCase()}`});
      }
    };
    collect();const dots=$$('.paginationDots .dot',root),selected=dots.find(d=>d.classList.contains('active')||d.getAttribute('aria-selected')==='true');
    try{for(const dot of dots){dot.click();await new Promise(r=>setTimeout(r,350));if(location.href!==page||!root.isConnected||MEY_PRODUCT.active().colorKey!==active)throw Error('Product of kleur gewijzigd tijdens foto’s ophalen');collect();}}
    finally{if(root.isConnected&&location.href===page)selected?.click();}
    if(!items.size)throw Error('Geen afbeeldingen in de Mey-galerij');return [...items.values()];
  }
  const clipboard=value=>typeof GM_setClipboard==='function'?GM_setClipboard(value,'text'):navigator.clipboard.writeText(value);
  async function download(images) {
    if(typeof GM_download!=='function')throw Error('Downloadrechten ontbreken; installeer de nieuwste Mey-adapter');
    for(const [index,item] of images.entries()) {
      status(`Foto ${index+1}/${images.length} downloaden · ${item.name}`);
      await new Promise((resolve,reject)=>GM_download({url:item.url,name:item.name,saveAs:false,timeout:30000,onload:resolve,onerror:error=>reject(Error(`Foto ${index+1}/${images.length} mislukt (${item.name}): ${error?.error||'controleer de downloadrechten in Tampermonkey'}`)),ontimeout:()=>reject(Error(`Foto ${index+1}/${images.length}: download duurt te lang (${item.name})`))}));
    }
  }
  function render() {
    $('#mey-edi').hidden=cart();$('#mey-order').hidden=!cart();$('#mey-order').open=cart();
    if(cart())return;
    const list=colors(),out=$('#mey-colors');if(!out)return;
    out.innerHTML=list.length?`<div class="edi-pdp-meta"><strong>${esc(list[0].model)}</strong><span>${esc(MEY_PRODUCT.title())}</span></div>${state.map?`<div class="edi-summary">${list.filter(v=>state.map.has(v.key)).length}/${list.length} leverancierskleuren in DDO</div>`:''}<div class="edi-colors">${list.map((v,i)=>`<div class="edi-color-row"><div class="edi-color-main"><span class="edi-swatch"></span><span class="edi-color-label" title="${esc(v.label)}">${esc(v.label)}</span>${match(v.key)}</div><div class="edi-actions"><button type="button" class="edi-action" data-action="product" data-index="${i}">Product</button><button type="button" class="edi-action" data-action="sizes" data-index="${i}" >Maten</button><button type="button" class="edi-action" data-action="ean" data-index="${i}">EAN</button><button type="button" class="edi-action" data-action="photos" data-index="${i}" ${state.downloading?'disabled':''} title="Download originele foto’s">Foto’s</button></div></div>`).join('')}</div>`:'<p class="edi-module-note">Open een product om Product, Maten en Foto’s te gebruiken.</p>';
    for(const button of $$('button[data-action]',out))button.onclick=async()=>{
      const v=list[Number(button.dataset.index)];button.disabled=true;
      try {
        if(button.dataset.action==='product') {
          const payload=MEY_PRODUCT.build(v.grid,v.colorInfo);if(!payload.name||!payload.rrp||!payload.productCode)throw Error('Product mist naam, adviesprijs of artikelcode');
          await clipboard(DDO_EDI.productClipboard(payload));status(`${v.key}: product gekopieerd`);
        }else if(['sizes','ean'].includes(button.dataset.action)){
          status(`${v.key}: exacte Mey-varianten laden…`);const map=await MEY_API.get(v.key);
          if(!v.grid.isConnected||MEY_PRODUCT.style()!==v.model)throw Error('Product gewijzigd; start opnieuw');
          await clipboard(button.dataset.action==='sizes'?DDO_EDI.sizesClipboard('Mey',v.key,[...map.keys()]):DDO_EDI.eanTSV([...map].map(([size,value])=>({size,ean:value.ean})),v.key));
          status(`${v.key}: ${button.dataset.action==='sizes'?'maten':'EAN-codes'} gekopieerd`);
        }else {if(state.downloading)return;state.downloading=true;$$('[data-action=photos]',out).forEach(b=>b.disabled=true);try{const images=await gallery(v.key);await download(images);status(`${v.key}: ${images.length} foto’s gedownload`);}finally{state.downloading=false;render();}}

      }catch(e){status(e.message,true);}finally{button.disabled=false;}
    };
    for(const card of $$('article.components-StyleCollectionView-ItemView')) {
      const key=code(`${clean($('.styleid',card)?.textContent)}-${clean($('.color-name',card)?.textContent).split(/\s+/)[0]}`);
      let badge=$('.mey-catalog-status',card);const html=key?match(key):'';
      if(!html){badge?.remove();continue;}if(!badge){badge=document.createElement('div');badge.className='mey-catalog-status';card.append(badge);}if(badge.innerHTML!==html)badge.innerHTML=html;
    }
  }

  function orderLog(text,error=false){const log=$('#mey-order-log'),entry=document.createElement('div');entry.textContent=text;entry.style.color=error?'#c83939':'';log.append(entry);log.scrollTop=log.scrollHeight;}
  function renderOrder() {
    $('#mey-order-rows').innerHTML=state.rows.map((row,i)=>`<tr><td><input aria-label="Artikel ${i+1}" data-field="productRef" data-index="${i}" value="${esc(row.productRef)}" ${state.ordering||row.locked?'disabled':''}></td><td><input aria-label="Maat ${i+1}" data-field="size" data-index="${i}" value="${esc(row.size)}" ${state.ordering||row.locked?'disabled':''}></td><td><input aria-label="Aantal ${i+1}" data-field="quantity" data-index="${i}" value="${esc(row.quantity)}" ${state.ordering||row.locked?'disabled':''}></td><td><button type="button" class="edi-action" data-remove="${i}" ${state.ordering||row.locked?'disabled':''}>×</button></td></tr><tr><td colspan="4">${esc(row.detail||'')}</td></tr>`).join('');
    for(const input of $$('#mey-order-rows input'))input.oninput=()=>state.rows[Number(input.dataset.index)][input.dataset.field]=input.value;
    for(const button of $$('#mey-order-rows button'))button.onclick=()=>{state.rows.splice(Number(button.dataset.remove),1);renderOrder();};
    $('#mey-basket').disabled=state.ordering||!state.rows.some(r=>!r.locked);
    $('#mey-paste').disabled=state.ordering||state.rows.some(r=>r.locked);
    $('#mey-add-row').disabled=state.ordering;
  }
  function loadFrame(article) {
    return new Promise((resolve,reject)=>{
      const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:1280px;height:900px;border:0';frame.setAttribute('aria-hidden','true');
      const timer=setTimeout(()=>{frame.remove();reject(Error('Mey-zoekpagina laden duurt te lang'));},25000);
      frame.onload=()=>{clearTimeout(timer);try{if(!frame.contentDocument)throw Error('Mey-zoekpagina niet bereikbaar');resolve(frame);}catch(e){frame.remove();reject(e);}};
      frame.onerror=()=>{clearTimeout(timer);frame.remove();reject(Error('Mey-zoekpagina niet bereikbaar'));};
      frame.src=BASE+'/d-reorder-mey/search/products/'+encodeURIComponent(article);document.body.append(frame);
    });
  }
  async function order() {
    if(!cart()||state.ordering)return;state.ordering=true;renderOrder();
    try {
      const parsed=[];
      for(const row of state.rows.filter(r=>!r.locked)){const result=orderApi.parseRows(`${row.productRef}\t${row.size}\t${row.quantity}`);if(result.errors.length||result.rows.length!==1)throw Error(result.errors.join('; ')||'Ongeldige regel');Object.assign(row,result.rows[0]);parsed.push(row);}
      for(const [key,rows] of orderApi.groupRows(parsed)) {
        let frame,attempted=false;
        try {
          orderLog(`${key}: exacte kleur, maten en voorraad controleren…`);
          const variants=await MEY_API.get(key);frame=await loadFrame(rows[0].article);const worker=MEY_ORDER.create(frame.contentDocument);
          await worker.ensureQuickEntry(rows[0]);
          const totals=new Map();for(const row of rows){const size=DDO_EDI.normalizeSize(row.size);totals.set(size,(totals.get(size)||0)+row.quantity);}
          for(const [size,quantity] of totals){const entry=variants.get(size),cell=worker.findSizeCell({...rows[0],size});if(!entry||entry.blocked||!Number.isFinite(entry.available)||!cell||!worker.isCellOrderable(cell))throw Error(`Maat ${size} niet eenduidig bestelbaar`);if(quantity+worker.readCellQuantity(cell)>entry.available)throw Error(`Onvoldoende voorraad ${size}: ${entry.available}`);}
          rows.forEach(r=>r.locked=true);attempted=true;renderOrder();
          for(const row of rows){await worker.addRow(row);row.sent=true;row.detail='Aantal bevestigd in Mey-bestelmatrix';orderLog(`${row.productRef} · ${row.size}: ${row.quantity} toegevoegd`);}
        }catch(e){rows.filter(r=>!r.sent).forEach(r=>r.detail=e.message);orderLog(e.message+(attempted?'. Controleer het winkelmandje; niet opnieuw toevoegen.':''),true);break;}
        finally{frame?.remove();renderOrder();}
      }
      if(parsed.length&&state.rows.every(r=>r.sent)){orderLog('Verwerking klaar. Winkelmandje verversen…');location.assign(`${BASE}/d-reorder-mey/cart`);}
    }catch(e){orderLog(e.message,true);}finally{state.ordering=false;renderOrder();}
  }
  function init() {
    if($('#edi-mey'))return;
    const style=document.createElement('style');style.textContent=`
      #edi-mey,#edi-mey :where(*){all:revert;box-sizing:border-box}
      #edi-mey :where(*){font:inherit;color:inherit;letter-spacing:normal;text-transform:none}
      #edi-mey :where(*::before,*::after){content:none}
      #edi-mey{position:fixed;top:18px;right:18px;width:430px;max-width:calc(100vw - 24px);z-index:2147483000;overflow:hidden;text-align:left}
      #edi-mey .edi-head{display:flex;align-items:center;cursor:move}
      #edi-mey button{width:auto!important;min-width:0!important;height:auto!important;margin:0!important;position:static!important;float:none!important;cursor:pointer}
      #edi-mey table{width:100%;table-layout:fixed;border-collapse:collapse}
      #edi-mey th{font-size:10px;text-align:left}#edi-mey th:first-child{width:52%}#edi-mey th:last-child{width:25px}
      #edi-mey td{padding:3px;font-size:10px;overflow-wrap:anywhere}
      #edi-mey input{width:100%;min-width:0;height:26px;padding:3px;border:1px solid #cbd5df;background:white;border-radius:3px}
      #edi-mey .edi-order-log{max-height:130px;overflow:auto;line-height:1.4}
      #edi-mey .edi-order-log>div+div{border-top:1px solid #e3e6e8;margin-top:4px;padding-top:4px}
      #edi-mey.edi-minimized{width:235px}#edi-mey.edi-minimized .edi-body{display:none}
      .mey-catalog-status{font:600 12px/1.5 system-ui}.mey-catalog-status .edi-match-ok{color:#18864b}.mey-catalog-status .edi-match-miss{color:#c83939}.mey-catalog-status a{color:inherit}
    `+(DDO_EDI.theme+DDO_EDI.layout).replaceAll('#edi-lingadore','#edi-mey');document.head.append(style);
    const panel=document.createElement('section');panel.id='edi-mey';panel.innerHTML=`<div class="edi-head"><div class="edi-title">Toolbox · Mey<span class="edi-version">v${VERSION}</span></div><button class="edi-icon-btn" type="button" id="mey-collapse" aria-label="Inklappen">−</button></div><div class="edi-body"><details class="edi-module" id="mey-edi" open><summary>EDI-module</summary><div class="edi-toolbar"><button class="edi-btn" type="button" id="mey-check">Controleer in DDO</button><button class="edi-btn" type="button" id="mey-refresh">Opnieuw checken</button><button class="edi-btn edi-danger" type="button" id="mey-reset">Reset</button></div><div class="edi-status" id="mey-status" role="status">Modelcheck wacht op startsignaal.</div><div id="mey-colors"></div></details><details class="edi-module" id="mey-order"><summary>Ordermodule</summary><div class="edi-toolbar"><button class="edi-btn" type="button" id="mey-paste">Plak orderregels</button><button class="edi-btn" type="button" id="mey-basket">In winkelmandje</button></div><div class="edi-status edi-order-log" id="mey-order-log" role="log" aria-live="polite"></div><p class="edi-module-note">Artikel/URL · maat · aantal, gescheiden door tabs.</p><table><thead><tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr></thead><tbody id="mey-order-rows"></tbody></table><button class="edi-btn" type="button" id="mey-add-row">+ Regel</button></details></div>`;document.body.append(panel);
    $('#mey-edi').hidden=cart();$('#mey-order').hidden=!cart();$('#mey-order').open=cart();
    $('#mey-collapse').onclick=()=>{panel.classList.toggle('edi-minimized');$('#mey-collapse').textContent=panel.classList.contains('edi-minimized')?'+':'−';};
    const head=$('.edi-head',panel);head.onpointerdown=e=>{if(e.target.closest('button'))return;const x=e.clientX-panel.offsetLeft,y=e.clientY-panel.offsetTop;head.setPointerCapture(e.pointerId);head.onpointermove=ev=>{panel.style.left=Math.max(0,Math.min(ev.clientX-x,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(ev.clientY-y,innerHeight-panel.offsetHeight))+'px';panel.style.right='auto';};head.onpointerup=()=>head.onpointermove=null;};
    $('#mey-check').onclick=()=>check();$('#mey-refresh').onclick=()=>check(true);$('#mey-reset').onclick=()=>{localStorage.removeItem(CACHE);state.map=null;status('Cache geleegd. Modelcheck staat stil.');render();};
    $('#mey-paste').onclick=async()=>{try{const parsed=orderApi.parseRows(await navigator.clipboard.readText());if(parsed.errors.length)throw Error(parsed.errors.join('; '));state.rows=parsed.rows;orderLog(`${state.rows.length} orderregels geladen`);renderOrder();}catch(e){orderLog(e.message,true);}};
    $('#mey-add-row').onclick=()=>{state.rows.push({productRef:'',size:'',quantity:1});renderOrder();};$('#mey-basket').onclick=order;
    orderLog('Plak orderregels of voeg een regel toe.');renderOrder();render();
    try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries)){state.map=new Map(cached.entries);status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');render();}}catch{}
    let previousUrl=location.href;setInterval(()=>{if(location.href!==previousUrl){previousUrl=location.href;render();}},500);
    let timer;new MutationObserver(records=>{if(records.some(r=>!panel.contains(r.target)&&!r.target.closest?.('.mey-catalog-status')&&(r.type!=='childList'||![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.classList?.contains('mey-catalog-status'))))){clearTimeout(timer);timer=setTimeout(render,150);}}).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','data-color-key']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

})();
