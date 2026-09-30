// ==UserScript==
// @name DDO Toolbox | EDI | Charlie Choe / Mila
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.5
// @description Charlie Choe/Mila: modelcheck, Product, Maten, foto's, ordermodule.
// @match https://vangennip.itsperfect.it/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_download
// @connect vangennip.itsperfect.it
// @connect dutchdesignersoutlet.com
// @connect www.dutchdesignersoutlet.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-idle
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-charlie-choe.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-charlie-choe.user.js
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
const VG_PRODUCT = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  function normalizePrice(text) {
    const cleaned = String(text || "").replace(/[^\d,\.]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.replace(",", ".");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function capitalizeWords(str) {
    return String(str || "").replace(/\w\S*/g, (w) => {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  function cleanThema(t) {
    return String(t || "").replace(/^\s*o\s*[-–—]\s*/i, "").trim();
  }

  function toSparkleComment(payloadObj) {
    return `<!--SPARKLE:${JSON.stringify(payloadObj)}-->`;
  }

  function getSpecValueById(id) {
    return txt($(`#${id} .spec__value, #${id} .value`));
  }

  function getPidFromUrl() {
    const m = location.href.match(/p_id=(\d+)/i);
    return m ? m[1] : "";
  }

  /******************************************************************
   * Matrix helpers
   ******************************************************************/
  let selectedRow = null;
  function getActiveMatrixRow() {
    if(selectedRow)return selectedRow;
    const matrix = $(".product-matrix.js-product-matrix");
    if (!matrix) return null;
    return $("tbody tr.background-color-hover", matrix) || $("tbody tr", matrix);
  }

  function getColorName() {
    const row = getActiveMatrixRow();
    if (row) {
      return txt($(".item__color_name", row));
    }
    return (
      txt($(".colorName, .color-name")) ||
      getSpecValueById("color_name") ||
      ""
    );
  }

  function getColorCode() {
    const row = getActiveMatrixRow();
    if (row) {
      return txt($(".item__color_number", row));
    }
    return (
      txt($(".colorNumber, .color-number")) ||
      getSpecValueById("color_number") ||
      ""
    );
  }

  function getPrice() {
    let raw =
      txt($(".price__retail span")) ||
      txt($(".product-matrix__price")) ||
      txt($(".salesListPrice span")) ||
      txt($(".product__price .price")) ||
      txt($(".price__now")) ||
      txt($('[itemprop="price"]')) ||
      txt($(".price"));

    return normalizePrice(raw);
  }

  /******************************************************************
   * Page data
   ******************************************************************/
  function getTitleBase() {
    return txt($(".spec__title h1")) || getSpecValueById("item_group") || "";
  }

  function getThema() {
    return cleanThema(getSpecValueById("thema"));
  }

  function getArtikelnummer() {
    return getSpecValueById("item_number") || getSpecValueById("itemNumber") || "";
  }

  function getBrand() {
    return getSpecValueById("brand") || "";
  }

  function buildName() {
    const thema = getThema();
    const baseTitle = getTitleBase();
    const kleur = getColorName();

    const rawTitle = [thema, baseTitle, kleur].filter(Boolean).join(" ").trim();
    return capitalizeWords(rawTitle);
  }

  function buildProductCode() {
    const artikelnummer = getArtikelnummer();
    const colorCode = getColorCode();
    const pid = getPidFromUrl();

    return [artikelnummer, colorCode, pid].filter(Boolean).join("-");
  }

  function findArtikelinformatieHeader() {
    for (const el of $$(".component__header.js-comp-header")) {
      const text = txt(el).toLowerCase();
      if (text === "artikelinformatie") return el;
    }
    return null;
  }

  function buildDescriptionHtml() {
    const header = findArtikelinformatieHeader();
    if (!header) return "";

    const component =
      header.closest(".component") ||
      header.parentElement ||
      document;

    const content =
      $(".component__content", component) ||
      $(".component__body", component) ||
      $(".component__inner", component) ||
      header.nextElementSibling;

    if (!content) return "";

    const nodes = $$("p, li", content);
    if (!nodes.length) {
      const raw = txt(content);
      return raw ? `<p>${escapeHtml(raw)}</p>` : "";
    }

    const parts = nodes
      .map((node) => txt(node))
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`);

    return parts.join("");
  }

  /******************************************************************
   * Payload builder
   ******************************************************************/
  function buildSparklePayload() {
    const name = buildName();
    const rrp = getPrice();
    const productCode = buildProductCode();

    const thema = getThema();
    const artikelnummer = getArtikelnummer();
    const brand = getBrand();
    const pid = getPidFromUrl();

    const supplierId = artikelnummer || pid || productCode;
    const modelName = thema || "";
    const descriptionHtml = buildDescriptionHtml();

    const compositionUrl = location.href;
    const pageUrl = location.href;
    const reference = " - [ext]";

    return {
      name,
      rrp,
      productCode,
      modelName,
      descriptionHtml,
      compositionUrl,
      pageUrl,
      reference,
      supplierId,
      brand
    };
  }

  /******************************************************************
   * Clipboard
   ******************************************************************/

return {build(row){selectedRow=row;try{return buildSparklePayload();}finally{selectedRow=null;}}, getArtikelnummer, getPidFromUrl, getTitleBase};
})();

const VG_ORDER = (() => {
  const CART_URL = "/webshop/shoppingbag";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchCartHtml() {
    const response = await fetch(CART_URL, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Winkelmandcontrole mislukt: HTTP ${response.status}`);
    return response.text();
  }

  async function resetCartView() {
    for (const path of [
      "/webshop/shoppingbag/setFilters/false",
      "/webshop/shoppingbag/setAdvanced/false",
    ]) {
      const response = await fetch(path, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Winkelmandweergave herstellen mislukt: HTTP ${response.status}`);
      }
    }
  }

  function getCartProductSignatures(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (/er zijn geen artikelen in de winkelmand aanwezig/i.test(doc.body.textContent || "")) {
      return new Map();
    }

    const signatures = new Map();
    Array.from(doc.querySelectorAll('a[href*="/webshop/shop/p_id="]')).forEach((link) => {
      const productId = link.getAttribute("href")?.match(/p_id=(\d+)/i)?.[1];
      if (productId) signatures.set(productId, normalize(link.textContent));
    });
    return signatures;
  }

  function cartContainsChangedRows(html, previousHtml, rows) {
    const current = getCartProductSignatures(html);
    const previous = getCartProductSignatures(previousHtml);
    return rows.every((row) => {
      const productId = String(row.productId);
      const currentSignature = current.get(productId);
      return currentSignature && currentSignature !== previous.get(productId);
    });
  }

  async function waitForRowsInCart(rows, previousHtml, timeoutMs = 12000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(750);
      const html = await fetchCartHtml();
      if (cartContainsChangedRows(html, previousHtml, rows)) return;
    }

    throw new Error("Niet bevestigd in de echte winkelmand");
  }

  function loadProductFrame(url) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        "position:fixed!important;left:-10000px!important;top:0!important;width:1280px!important;height:900px!important;opacity:0!important;pointer-events:none!important;border:0!important;";
      const timer=setTimeout(()=>{frame.remove();reject(Error("Productpagina laden duurt te lang"));},20000);
      frame.addEventListener("load", () => {
        clearTimeout(timer);
        try {
          const doc=frame.contentDocument;
          if(!doc?.querySelector('input[name*="[quantities]"]'))throw Error("Productmatrix niet gevonden");
          resolve({frame,doc});
        }catch(e){frame.remove();reject(e);}
      },{once:true});
      frame.addEventListener("error",()=>{clearTimeout(timer);frame.remove();reject(Error("Productpagina laden mislukt"));},{once:true});
      frame.src = url;
      document.body.appendChild(frame);
    });
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
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
        if (cols.length < 3) {
          errors.push(`Regel ${index + 1}: verwacht artikel/URL<TAB>maat<TAB>aantal`);
          return;
        }

        const [productRef, size, quantityRaw] = cols;
        const quantity = Number(String(quantityRaw).replace(",", "."));

        if (!productRef) errors.push(`Regel ${index + 1}: artikel of URL ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
          errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);
        }

        const product = parseProductRef(productRef);
        if (!product.productId) errors.push(`Regel ${index + 1}: p_id ontbreekt in supplier-ID of URL`);

        if (productRef && product.productId && size && Number.isSafeInteger(quantity) && quantity > 0) {
          rows.push({
            productRef,
            productId: product.productId,
            colorNumber: product.colorNumber,
            itemNumber: product.itemNumber,
            productUrl: product.productUrl,
            size,
            quantity,
          });
        }
      });

    return { rows, errors };
  }

  function parseProductRef(productRef) {
    const text = String(productRef || "").trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("/")) {
      const url = new URL(text, location.origin);
      if(url.origin!==location.origin)throw Error("Gebruik een Van Gennip-productlink");
      const productId =
        url.pathname.match(/p_id=(\d+)/i)?.[1] ||
        url.searchParams.get("p_id") ||
        "";
      if(!/^\d+$/.test(productId))throw Error("Ongeldig p_id in productlink");
      const colorNumber = url.searchParams.get("cc_color") || "";
      const itemNumber = url.searchParams.get("cc_item") || "";
      url.pathname = `/webshop/shop/p_id=${productId}`;
      url.search = "";
      url.hash = "";
      url.searchParams.set("set-season", "direct-order");
      return { productId, colorNumber, itemNumber, productUrl: url.href };
    }

    const parts = text.split("-").map((part) => part.trim()).filter(Boolean);
    if(parts.length===2)throw Error("Supplier ID mist p_id; gebruik artikel-kleur-p_id of een productlink");
    const productId = /^\d+$/.test(parts.at(-1) || "") ? parts.at(-1) : "";
    const colorNumber = productId && /^[A-Z0-9]+$/i.test(parts.at(-2) || "") ? parts.at(-2) : "";
    const itemNumber = productId ? parts.slice(0, -2).join("-") : "";
    const productUrl = productId
      ? `${location.origin}/webshop/shop/p_id=${encodeURIComponent(productId)}?set-season=direct-order`
      : "";

    return { productId, colorNumber, itemNumber, productUrl };
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.productUrl)) groups.set(row.productUrl, []);
      groups.get(row.productUrl).push(row);
    });
    return groups;
  }

  function parseQuantityInput(input) {
    const match = String(input.name || "").match(
      /^item\[(\d+)\]\[([^\]]+)\]\[quantities\]\[([^\]]+)\]$/i
    );
    if (!match) return null;
    return {
      itemIndex: match[1],
      variantId: match[2],
      size: match[3],
    };
  }

  function getProductRoot(input) {
    return (
      input.closest("form") ||
      input.closest("[data-product-id]") ||
      input.closest(".product-item,.product,.item,.article") ||
      input.ownerDocument
    );
  }

  function findProductId(root, input) {
    const candidates = [
      root.querySelector?.('input[name="product_id"]')?.value,
      root.getAttribute?.("data-product-id"),
      input.closest("[data-product-id]")?.getAttribute("data-product-id"),
      root.querySelector?.("[data-product-id]")?.getAttribute("data-product-id"),
    ];

    const direct = candidates.find((value) => /^\d+$/.test(String(value || "").trim()));
    if (direct) return String(direct).trim();

    const html = root.outerHTML || "";
    return (
      html.match(/product_id["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ||
      html.match(/updateShoppingBasket\(\s*["']?(\d+)/i)?.[1] ||
      input.ownerDocument.location?.pathname?.match(/p_id=(\d+)/i)?.[1] ||
      ""
    );
  }

  function getColorNumber(input) {
    const row = input.closest("tr");
    return String(
      row?.querySelector(".item__color_number")?.textContent ||
      row?.getAttribute("data-color-number") ||
      ""
    ).trim();
  }

  function findExactInput(doc, row) {
    const wantedSize = DDO_EDI.normalizeSize(row.size);
    const candidates = Array.from(doc.querySelectorAll('input[name*="[quantities]"]'))
      .map((input) => ({ input, parsed: parseQuantityInput(input) }))
      .filter(({ input, parsed }) => {
        const visibleSize = input.getAttribute("data-size") || parsed?.size || "";
        return parsed && DDO_EDI.normalizeSize(visibleSize) === wantedSize;
      });

    if (!candidates.length) return { error: `Exacte maat niet gevonden: ${row.size}` };

    const wantedColor = normalize(row.colorNumber);
    const best = wantedColor
      ? candidates.filter((candidate) => normalize(getColorNumber(candidate.input)) === wantedColor)
      : candidates;

    if (best.length !== 1) {
      return {
        error: wantedColor
          ? `Exacte kleur/maat niet gevonden: ${row.colorNumber} ${row.size}`
          : `Maat ${row.size} komt in meerdere kleuren voor; kleur ontbreekt`,
      };
    }

    const selected = best[0];
    const root = getProductRoot(selected.input);
    const productId = findProductId(root, selected.input);
    if(productId!==row.productId)return {error:"Product-ID wijkt af van orderregel"};
    const article=String(doc.querySelector("#item_number .spec__value, #itemNumber .spec__value")?.textContent||"").trim();
    if(row.itemNumber && normalize(article)!==normalize(row.itemNumber))return {error:"Artikelnummer wijkt af van orderregel"};
    if (!productId) return { error: "product_id niet gevonden" };

    if (selected.input.disabled || selected.input.readOnly) {
      return { error: `Niet bestelbaar: ${row.size}` };
    }

    const max = parseInt(
      selected.input.getAttribute("data-limit") ||
      selected.input.getAttribute("max") ||
      "",
      10
    );
    if (Number.isFinite(max) && max < row.quantity) {
      return { error: `Onvoldoende voorraad: maximaal ${max}` };
    }

    return {
      input: selected.input,
      root,
      productId,
      itemNumber: row.itemNumber || String(doc.querySelector("#item_number .spec__value")?.textContent || "").trim(),
      variantId: selected.parsed.variantId,
    };
  }

  function setFrameQuantities(rows, validateOnly=false) {
    const totals = new Map();

    rows.forEach((row) => {
      const current = totals.get(row.resolvedInput.name) || {
        input: row.resolvedInput,
        quantity: 0,
      };
      current.quantity += row.quantity;
      totals.set(row.resolvedInput.name, current);
    });

    const updates=[...totals.values()].map(({input,quantity})=>{
      const current=Number(input.value||0), total=current+quantity;
      if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(total))throw Error("Ongeldig bestaand aantal");
      for(const attr of ['data-limit','max']){
        const raw=input.getAttribute(attr);
        if(raw!==null&&raw!==''&&Number.isFinite(Number(raw))&&total>Number(raw))throw Error(`Onvoldoende voorraad: maximaal ${raw}`);
      }
      return {input,total};
    });
    if(validateOnly)return updates;
    // Validate every total before changing any field.
    updates.forEach(({input,total})=>{
      input.value=String(total);
      const FrameEvent=input.ownerDocument.defaultView.Event;
      ['input','keyup','change'].forEach(type=>input.dispatchEvent(new FrameEvent(type,{bubbles:true})));
    });
  }

  async function submitFrameRows(doc, rows) {
    const button = doc.querySelector(".js-shoppingbag-add-update-item-in-basket");
    if (!button || button.disabled) throw new Error("Van Gennip Toevoegen-knop niet beschikbaar");
    const previousHtml = await fetchCartHtml();
    setFrameQuantities(rows);
    await sleep(150);

    button.click();

    await waitForRowsInCart(rows, previousHtml);
  }

return {parseRows,parseProductRef,groupRows,findExactInput,parseQuantityInput,loadProductFrame,submitFrameRows,setFrameQuantities,resetCartView,cartContainsChangedRows};
})();

(() => {
  'use strict';
  const VERSION='1.0.5', ID='charlie-choe', BASE='https://vangennip.itsperfect.it';
  if(window.top!==window.self)return;
  if(location.hostname==='www.dutchdesignersoutlet.com') {
    const announce=()=>document.dispatchEvent(new CustomEvent('ddo-toolbox:adapter-state',{detail:JSON.stringify({id:ID,label:'Charlie Choe / Mila',version:VERSION,available:false,capabilities:['edi'],updateUrl:'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-charlie-choe.user.js'})}));
    document.addEventListener('ddo-toolbox:discover',announce);announce();return;
  }
  if(location.origin!==BASE)return;
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cart=()=>/^\/webshop\/shoppingbag(?:\/|$)/i.test(location.pathname)||DDO_EDI.isCartPage();
  const CACHE='edi:charlie-choe:ddo:v2', BRANDS=[34,145];
  const state={map:null,checking:false,ordering:false,downloading:false,rows:[]};
  // Article-colour is the comparison key; the trailing supplier p_id is retained in clipboard data.
  function code(value) {
    const s=clean(value).normalize('NFKC').replace(/[‐‑‒–—]/g,'-').toUpperCase();
    return s.match(/^[A-Z0-9._]+-[A-Z0-9]+(?=-[A-Z0-9]+(?:-\d+)?$|$)/)?.[0]||'';
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
  const status=(text,error=false)=>{const el=$('#vg-status');el.textContent=text;el.style.color=error?'#c83939':'';};
  async function check(force=false) {
    if(cart()||state.checking)return;state.checking=true;
    $$('#vg-check,#vg-refresh,#vg-reset').forEach(b=>b.disabled=true);
    try {
      let cached;try{cached=JSON.parse(localStorage.getItem(CACHE));}catch{}
      if(!force&&cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries)) {
        state.map=new Map(cached.entries);status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');
      } else {
        const maps=[];
        for(const id of BRANDS){status(`DDO-export ophalen · merk ${id} · ${maps.length+1}/${BRANDS.length}`);maps.push(await exportBrand(id));}
        state.map=new Map(maps.flatMap(m=>[...m]));
        try{localStorage.setItem(CACHE,JSON.stringify({time:Date.now(),entries:[...state.map]}));}catch{}
        status(`Modelcheck actief · ${state.map.size} producten · beide merken opgehaald`);
      }
    }catch(e){state.map=null;status(e.message,true);}
    finally{state.checking=false;$$('#vg-check,#vg-refresh,#vg-reset').forEach(b=>b.disabled=false);render();}
  }
  function match(key) {
    if(!state.map)return '';
    const found=state.map.get(key);
    return found?`<span class="edi-match edi-match-ok">${found.id?`✓ <a target="_blank" rel="noopener" href="https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(found.id)}">${esc(found.id)}</a>`:'✓ Aanwezig'}</span>`:'<span class="edi-match edi-match-miss">× Ontbreekt</span>';
  }
  function colors() {
    const model=VG_PRODUCT.getArtikelnummer(),pid=VG_PRODUCT.getPidFromUrl();
    if(!model||!pid)return [];
    const rows=$$('.product-matrix tbody tr').filter(row=>$('.item__color_number',row));
    return rows.map(row=>{
      const color=clean($('.item__color_number',row).textContent),key=code(model)||code(`${model}-${color}`);
      const sizes=[...new Set($$('input[name*="[quantities]"]',row).map(input=>input.getAttribute('data-size')||VG_ORDER.parseQuantityInput(input)?.size||'').filter(Boolean).map(DDO_EDI.normalizeSize))];
      // Some matrices provide quantities only as cells; use the matching table's explicit size headers.
      if(!sizes.length) {
        const headers=$$('thead th.product-matrix__size,thead .product-matrix__header.product-matrix__size',row.closest('table')||row.closest('.product-matrix'));
        for(const header of headers){const value=DDO_EDI.normalizeSize(clean(header.textContent).replace(/^.*?:\s*/,''));if(value&&!sizes.includes(value))sizes.push(value);}
      }
      return {row,model,color,key,pid,supplierId:`${model}-${color}-${pid}`,label:[color,clean($('.item__color_name',row)?.textContent)].filter(Boolean).join(' '),sizes};
    }).filter(v=>v.key);
  }
  function gallery(key,root=document) {
    const seen=new Set(),result=[];
    for(const img of $$('.pdp-screen__images img',root)) {
      const raw=img.getAttribute('data-zoom_image')||img.getAttribute('data-zoom-image')||(/\/max\//i.test(img.getAttribute('src')||'')?img.getAttribute('src'):'');if(!raw)continue;
      let url,file;try{url=new URL(raw,BASE);file=decodeURIComponent(url.pathname.split('/').pop());}catch{continue;}
      if(url.origin!==BASE||! /\.(?:jpe?g|png|webp)$/i.test(file))continue;
      url.hash='';if(seen.has(url.href))continue;seen.add(url.href);
      result.push({url:url.href,name:`${key}_${result.length+1}.${file.split('.').pop().toLowerCase()}`});
    }
    return result;
  }
  async function loadGallery(item) {
    let images=gallery(item.key);if(images.length)return images;
    status(`${item.key}: originele foto’s ophalen…`);
    const url=location.href;
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`Foto’s ophalen: HTTP ${response.status}`);
    const doc=new DOMParser().parseFromString(await response.text(),'text/html');
    if(doc.querySelector('input[type="password"]'))throw Error('Log opnieuw in bij Van Gennip om foto’s op te halen');
    const article=clean(doc.querySelector('#item_number .spec__value, #itemNumber .spec__value')?.textContent);
    if(article!==item.model||location.href!==url)throw Error('Productpagina gewijzigd; open het product opnieuw');
    images=gallery(item.key,doc);
    if(!images.length)throw Error(`Geen originele foto’s gevonden in de galerij van deze productpagina.`);
    return images;
  }
  const clipboard=value=>typeof GM_setClipboard==='function'?GM_setClipboard(value,'text'):navigator.clipboard.writeText(value);
  async function download(images) {
    if(typeof GM_download!=='function')throw Error('Downloadrechten ontbreken; installeer de nieuwste Charlie Choe/Mila-adapter');
    for(const [index,item] of images.entries()) {
      status(`Foto ${index+1}/${images.length} downloaden · ${item.name}`);
      await new Promise((resolve,reject)=>GM_download({url:item.url,name:item.name,saveAs:false,timeout:30000,onload:resolve,onerror:error=>reject(Error(`Foto ${index+1}/${images.length} mislukt (${item.name}): ${error?.error||'controleer de downloadrechten in Tampermonkey'}`)),ontimeout:()=>reject(Error(`Foto ${index+1}/${images.length}: download duurt te lang (${item.name})`))}));
    }
  }
  function render() {
    if(cart())return;
    const list=colors(),out=$('#vg-colors');if(!out)return;
    out.innerHTML=list.length?`<div class="edi-pdp-meta"><strong>${esc(list[0].model)}</strong><span>${esc(VG_PRODUCT.getTitleBase())}</span></div>${state.map?`<div class="edi-summary">${list.filter(v=>state.map.has(v.key)).length}/${list.length} leverancierskleuren in DDO</div>`:''}<div class="edi-colors">${list.map((v,i)=>`<div class="edi-color-row"><div class="edi-color-main"><span class="edi-swatch"></span><span class="edi-color-label" title="${esc(v.label)}">${esc(v.label)}</span>${match(v.key)}</div><div class="edi-actions"><button type="button" class="edi-action" data-action="product" data-index="${i}">Product</button><button type="button" class="edi-action" data-action="sizes" data-index="${i}" ${v.sizes.length?'':'disabled'}>Maten</button><button type="button" class="edi-action" disabled title="Geen EAN-bron aangeleverd">EAN</button><button type="button" class="edi-action" data-action="photos" data-index="${i}" ${state.downloading?'disabled':''} title="Download originele foto’s">Foto’s</button></div></div>`).join('')}</div>`:'<p class="edi-module-note">Open een product om Product, Maten en Foto’s te gebruiken.</p>';
    for(const button of $$('button[data-action]',out))button.onclick=async()=>{
      const v=list[Number(button.dataset.index)];button.disabled=true;
      try {
        if(button.dataset.action==='product') {
          const payload=VG_PRODUCT.build(v.row);if(!payload.name||!payload.rrp||!payload.productCode)throw Error('Product mist naam, adviesprijs of artikelcode');
          await clipboard(DDO_EDI.productClipboard(payload));status(`${v.key}: product gekopieerd`);
        }else if(button.dataset.action==='sizes'){await clipboard(DDO_EDI.sizesClipboard('Charlie Choe / Mila',v.supplierId,v.sizes));status(`${v.key}: maten gekopieerd`);}
        else {if(state.downloading)return;state.downloading=true;$$('[data-action=photos]',out).forEach(b=>b.disabled=true);try{const images=await loadGallery(v);await download(images);status(`${v.key}: ${images.length} foto’s gedownload`);}finally{state.downloading=false;render();}}
      }catch(e){status(e.message,true);}finally{button.disabled=false;}
    };
    for(const line of $$('.plp-product__line2')) {
      const card=line.closest('.plp-product, [class*="plp-product__item"], li, article')||line.parentElement;
      const key=code(clean(line.textContent).match(/^([A-Z0-9._]+-[A-Z0-9]+)(?:\s*-|$)/i)?.[1]||'');let badge=$('.vg-catalog-status',card);
      const html=key?match(key):'';
      if(!html){badge?.remove();continue;}
      if(!badge){badge=document.createElement('div');badge.className='vg-catalog-status';card.append(badge);}
      if(badge.innerHTML!==html)badge.innerHTML=html;
    }
  }
  function orderLog(text,error=false){const log=$('#vg-order-log'),entry=document.createElement('div');entry.textContent=text;entry.style.color=error?'#c83939':'';log.append(entry);log.scrollTop=log.scrollHeight;}
  function renderOrder() {
    $('#vg-order-rows').innerHTML=state.rows.map((row,i)=>`<tr><td><input aria-label="Artikel ${i+1}" data-field="productRef" data-index="${i}" value="${esc(row.productRef)}" ${state.ordering||row.locked?'disabled':''}></td><td><input aria-label="Maat ${i+1}" data-field="size" data-index="${i}" value="${esc(row.size)}" ${state.ordering||row.locked?'disabled':''}></td><td><input aria-label="Aantal ${i+1}" data-field="quantity" data-index="${i}" value="${esc(row.quantity)}" ${state.ordering||row.locked?'disabled':''}></td><td><button type="button" class="edi-action" data-remove="${i}" ${state.ordering||row.locked?'disabled':''}>×</button></td></tr><tr><td colspan="4">${esc(row.detail||'')}</td></tr>`).join('');
    for(const input of $$('#vg-order-rows input'))input.oninput=()=>state.rows[Number(input.dataset.index)][input.dataset.field]=input.value;
    for(const button of $$('#vg-order-rows button'))button.onclick=()=>{state.rows.splice(Number(button.dataset.remove),1);renderOrder();};
    $('#vg-basket').disabled=state.ordering||!state.rows.some(r=>!r.locked);
    $('#vg-paste').disabled=state.ordering||state.rows.some(r=>r.locked);
    $('#vg-add-row').disabled=state.ordering;
  }
  async function order() {
    if(!cart()||state.ordering)return;state.ordering=true;renderOrder();
    try {
      const pending=state.rows.filter(r=>!r.locked),parsed=[];
      for(const row of pending){const result=VG_ORDER.parseRows(`${row.productRef}\t${row.size}\t${row.quantity}`);if(result.errors.length||result.rows.length!==1)throw Error(result.errors.join('; ')||'Ongeldige regel');Object.assign(row,result.rows[0]);parsed.push(row);}
      await VG_ORDER.resetCartView();
      for(const [url,rows] of VG_ORDER.groupRows(parsed)) {
        let frame,attempted=false;
        try {
          orderLog(`${rows[0].productRef}: exacte kleur, maat en voorraad controleren…`);
          const loaded=await VG_ORDER.loadProductFrame(url);frame=loaded.frame;
          for(const row of rows){const found=VG_ORDER.findExactInput(loaded.doc,row);if(found.error)throw Error(found.error);row.resolvedInput=found.input;}
          VG_ORDER.setFrameQuantities(rows,true);
          const add=loaded.doc.querySelector('.js-shoppingbag-add-update-item-in-basket');
          if(!add||add.disabled)throw Error('Van Gennip Toevoegen-knop niet beschikbaar');
          // Lock before any supplier input event or button click; never retry an uncertain request.
          rows.forEach(r=>r.locked=true);attempted=true;renderOrder();
          await VG_ORDER.submitFrameRows(loaded.doc,rows);
          rows.forEach(r=>{r.sent=true;r.detail='Wijziging in winkelmandje bevestigd';});orderLog(`${rows[0].productRef}: wijziging in winkelmandje bevestigd`);
        }catch(e){rows.forEach(r=>r.detail=e.message);orderLog(`${e.message}${attempted?'. Controleer het winkelmandje; niet opnieuw toevoegen.':''}`,true);break;}
        finally{frame?.remove();renderOrder();}
      }
      if(parsed.length&&state.rows.every(r=>r.sent)){orderLog('Verwerking klaar. Winkelmandje verversen…');location.assign(`${BASE}/webshop/shoppingbag`);}
    }catch(e){orderLog(e.message,true);}finally{state.ordering=false;renderOrder();}
  }
  function init() {
    if($('#edi-charlie-choe'))return;
    const style=document.createElement('style');style.textContent=`
      #edi-charlie-choe,#edi-charlie-choe :where(*){all:revert;box-sizing:border-box}
      #edi-charlie-choe :where(*){font:inherit;color:inherit;letter-spacing:normal;text-transform:none}
      #edi-charlie-choe :where(*::before,*::after){content:none}
      #edi-charlie-choe{position:fixed;top:18px;right:18px;width:430px;max-width:calc(100vw - 24px);z-index:2147483000;overflow:hidden;text-align:left}
      #edi-charlie-choe .edi-head{display:flex;align-items:center;cursor:move}
      #edi-charlie-choe button{width:auto!important;min-width:0!important;height:auto!important;margin:0!important;position:static!important;float:none!important;cursor:pointer}
      #edi-charlie-choe table{width:100%;table-layout:fixed;border-collapse:collapse}
      #edi-charlie-choe th{font-size:10px;text-align:left}#edi-charlie-choe th:first-child{width:52%}#edi-charlie-choe th:last-child{width:25px}
      #edi-charlie-choe td{padding:3px;font-size:10px;overflow-wrap:anywhere}
      #edi-charlie-choe input{width:100%;min-width:0;height:26px;padding:3px;border:1px solid #cbd5df;background:white;border-radius:3px}
      #edi-charlie-choe .edi-order-log{max-height:130px;overflow:auto;line-height:1.4}
      #edi-charlie-choe .edi-order-log>div+div{border-top:1px solid #e3e6e8;margin-top:4px;padding-top:4px}
      #edi-charlie-choe.edi-minimized{width:235px}#edi-charlie-choe.edi-minimized .edi-body{display:none}
      .vg-catalog-status{font:600 12px/1.5 system-ui}.vg-catalog-status .edi-match-ok{color:#18864b}.vg-catalog-status .edi-match-miss{color:#c83939}.vg-catalog-status a{color:inherit}
    `+(DDO_EDI.theme+DDO_EDI.layout).replaceAll('#edi-lingadore','#edi-charlie-choe');document.head.append(style);
    const panel=document.createElement('section');panel.id='edi-charlie-choe';panel.innerHTML=`<div class="edi-head"><div class="edi-title">Toolbox · Charlie Choe / Mila<span class="edi-version">v${VERSION}</span></div><button class="edi-icon-btn" type="button" id="vg-collapse" aria-label="Inklappen">−</button></div><div class="edi-body"><details class="edi-module" id="vg-edi" open><summary>EDI-module</summary><div class="edi-toolbar"><button class="edi-btn" type="button" id="vg-check">Controleer in DDO</button><button class="edi-btn" type="button" id="vg-refresh">Opnieuw checken</button><button class="edi-btn edi-danger" type="button" id="vg-reset">Reset</button></div><div class="edi-status" id="vg-status" role="status">Modelcheck wacht op startsignaal.</div><div id="vg-colors"></div></details><details class="edi-module" id="vg-order"><summary>Ordermodule</summary><div class="edi-toolbar"><button class="edi-btn" type="button" id="vg-paste">Plak orderregels</button><button class="edi-btn" type="button" id="vg-basket">In winkelmandje</button></div><div class="edi-status edi-order-log" id="vg-order-log" role="log" aria-live="polite"></div><p class="edi-module-note">Artikel/URL · maat · aantal, gescheiden door tabs.</p><table><thead><tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr></thead><tbody id="vg-order-rows"></tbody></table><button class="edi-btn" type="button" id="vg-add-row">+ Regel</button></details></div>`;document.body.append(panel);
    $('#vg-edi').hidden=cart();$('#vg-order').hidden=!cart();$('#vg-order').open=cart();
    $('#vg-collapse').onclick=()=>{panel.classList.toggle('edi-minimized');$('#vg-collapse').textContent=panel.classList.contains('edi-minimized')?'+':'−';};
    const head=$('.edi-head',panel);head.onpointerdown=e=>{if(e.target.closest('button'))return;const x=e.clientX-panel.offsetLeft,y=e.clientY-panel.offsetTop;head.setPointerCapture(e.pointerId);head.onpointermove=ev=>{panel.style.left=Math.max(0,Math.min(ev.clientX-x,innerWidth-panel.offsetWidth))+'px';panel.style.top=Math.max(0,Math.min(ev.clientY-y,innerHeight-panel.offsetHeight))+'px';panel.style.right='auto';};head.onpointerup=()=>head.onpointermove=null;};
    $('#vg-check').onclick=()=>check();$('#vg-refresh').onclick=()=>check(true);$('#vg-reset').onclick=()=>{localStorage.removeItem(CACHE);state.map=null;status('Cache geleegd. Modelcheck staat stil.');render();};
    $('#vg-paste').onclick=async()=>{try{const parsed=VG_ORDER.parseRows(await navigator.clipboard.readText());if(parsed.errors.length)throw Error(parsed.errors.join('; '));state.rows=parsed.rows;orderLog(`${state.rows.length} orderregels geladen`);renderOrder();}catch(e){orderLog(e.message,true);}};
    $('#vg-add-row').onclick=()=>{state.rows.push({productRef:'',size:'',quantity:1});renderOrder();};$('#vg-basket').onclick=order;
    orderLog('Plak orderregels of voeg een regel toe.');renderOrder();render();
    if(cart())return;
    try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached&&Date.now()-cached.time<900000&&Array.isArray(cached.entries)){state.map=new Map(cached.entries);status('DDO-controle uit recente cache · Opnieuw checken vernieuwt de gegevens.');render();}}catch{}
    let timer;new MutationObserver(records=>{if(records.some(r=>!panel.contains(r.target)&&!r.target.closest?.('.vg-catalog-status')&&(r.type!=='childList'||![...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.classList?.contains('vg-catalog-status'))))){clearTimeout(timer);timer=setTimeout(render,150);}}).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src','data-zoom_image','data-zoom-image']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

})();
