// ==UserScript==
// @name         DDO | Brand Watcher - Anita
// @version      0.2.6
// @description  Laadt Anita/Rosa Faia uit DDO en controleert bestelbare maten, retailprijs en sale-percentage.
// @match        https://lingerieoutlet.nl/tools/watcher/brands.html*
// @match        https://b2b.anita.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @connect      b2b.anita.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/adapter-anita.user.js?v=0.2.6
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/adapter-anita.user.js?v=0.2.6
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.2.6";
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log("[BRANDS-WATCHER][ANITA]", ...args);
  const BRAND = "Anita";
  const BRAND_LABELS = new Set([
    "Anita",
    "Anita Maternity",
    "Anita Care",
    "Anita Active",
    "Anita Badmode",
    "Rosa Faia",
    "Rosa Faia Badmode"
  ]);
  const DEFAULT_EXPORT_TAG_ID = new URLSearchParams(location.search).get("tagId") || "196";
  const BASE = "https://b2b.anita.com";
  const PATH_441 = "/nl/shop/441/";
  const PATH_410 = "/nl/shop/410/";
  const VAKN_LIST = ["SVCO70", "SVCO50", "SVCO30", "SVBA50", "SVBA30"];
  const DETAIL_CACHE = new Map();
  const SALE_CACHE = new Map();
  const isWatcher = location.hostname === "lingerieoutlet.nl" || location.hostname === "127.0.0.1";
  let SESSION_HIDDEN_PROMISE = null;
  let running = false;
  let paused = false;
  let products = [];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function isAnitaBrand(brand) {
    return BRAND_LABELS.has(String(brand || "").trim());
  }

  function normalizeSizeKey(raw) {
    let value = String(raw ?? "").trim();
    if (!value) return "";
    value = value.split(/[|,]/)[0].trim().toUpperCase().replace(/\s+/g, "");
    value = value.replace(/[-\u2013\u2014]+$/g, "");
    if (!value) return "";
    if (value === "TU" || value === "NOSIZE" || value === "ONESIZE" || value === "OS") return "NOSIZE";
    const numericXl = (token) => /^[2-6]XL$/.test(token) ? "X".repeat(Number(token[0])) + "L" : token;
    const normalizeCup = (cup) => {
      const token = String(cup || "").toUpperCase().replace(/\s+/g, "");
      if (/^[A-Z]{2}$/.test(token) && token[0] !== token[1]) return `${token[0]}/${token[1]}`;
      return token;
    };
    const bra = value.match(/^0*(\d{2,3})([A-Z]{1,4}(?:\/[A-Z]{1,4})?)$/);
    if (bra) return `${parseInt(bra[1], 10)}${normalizeCup(bra[2])}`;
    if (value.includes("/")) return value.split("/").filter(Boolean).map(numericXl).join("/");
    value = numericXl(value);
    if (/^0*\d{1,3}$/.test(value)) {
      const number = parseInt(value, 10);
      return Number.isFinite(number) && number > 0 ? String(number) : "";
    }
    return value;
  }

  function isSizeLabel(raw) {
    const value = normalizeSizeKey(raw);
    if (!value) return false;
    if (/^\d{2,3}[A-Z]{1,4}(?:\/[A-Z]{1,4})?$/.test(value)) return true;
    if (/^\d{1,3}$/.test(value)) return true;
    if (value === "NOSIZE") return true;
    const alpha = /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL|XXXXXXL)$/;
    if (alpha.test(value)) return true;
    return value.includes("/") && value.split("/").filter(Boolean).every((part) => alpha.test(part));
  }

  function normalizeHeader(header) {
    return String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function firstValue(row, aliases) {
    for (const alias of aliases) {
      const value = row[normalizeHeader(alias)];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function parseMoney(raw) {
    if (typeof raw === "number") return raw;
    let value = String(raw ?? "").trim();
    if (!value) return null;
    value = value.replace(/[^\d,.-]/g, "");
    if (value.includes(",") && value.includes(".")) value = value.replace(/\./g, "").replace(",", ".");
    else value = value.replace(",", ".");
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function exportUrl(tagId = DEFAULT_EXPORT_TAG_ID) {
    return `https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=${encodeURIComponent(tagId)}`;
  }

  function fetchViaGM(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || "GET",
        url: opts.url,
        data: opts.data,
        responseType: opts.responseType,
        withCredentials: true,
        timeout: opts.timeout || 25000,
        headers: {
          Accept: opts.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Content-Type": opts.contentType || "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: opts.referer || `${BASE}/nl/shop`
        },
        onload: (response) => resolve(response),
        onerror: (error) => reject(error),
        ontimeout: () => reject(new Error(`Timeout @ ${opts.url}`))
      });
    });
  }

  async function fetchDdoExport(tagId) {
    const response = await fetchViaGM({
      method: "POST",
      url: exportUrl(tagId),
      data: new URLSearchParams({ format: "excel_attribute", export: "Export products" }).toString(),
      responseType: "arraybuffer",
      timeout: 60000,
      referer: "https://www.dutchdesignersoutlet.com/admin.php"
    });
    if (response.status !== 200) throw new Error(`DDO-export mislukt: HTTP ${response.status}`);
    if (!response.response?.byteLength) throw new Error("DDO-export is leeg.");
    return response.response;
  }

  function parsePid(raw = "") {
    const pid = String(raw).trim().replace(/\s+/g, "");
    if (!pid) return { koll: "", arnr: "", fbnr: "" };
    let m = pid.match(/^([A-Za-z0-9]{2})[- ]?(\d{4}[A-Za-z]?(?:-\d+)?)-(\d{3})$/);
    if (m) return { koll: m[1].toUpperCase(), arnr: m[2], fbnr: m[3] };
    m = pid.match(/^(\d{4}[A-Za-z]?(?:-\d+)?)-(\d{3})$/);
    if (m) return { koll: "", arnr: m[1], fbnr: m[2] };
    m = pid.match(/^(\d{4}[A-Za-z]?(?:-\d+)?)$/);
    if (m) return { koll: "", arnr: m[1], fbnr: "" };
    const parts = pid.split("-").filter(Boolean);
    if (parts.length >= 3) return { koll: /[A-Za-z]/.test(parts[0]) ? parts[0].toUpperCase() : "", arnr: parts.slice(/[A-Za-z]/.test(parts[0]) ? 1 : 0, -1).join("-"), fbnr: parts[parts.length - 1] || "" };
    if (parts.length === 2) return { koll: "", arnr: parts[0], fbnr: parts[1] };
    return { koll: "", arnr: pid, fbnr: "" };
  }

  function buildSaleUrl({ arnr, fbnr = "", vakn = "", koll = "" }) {
    return `${BASE}${PATH_441}?fssc=N&vsas=&koll=${encodeURIComponent(koll || "")}&form=&vacp=&arnr=${encodeURIComponent(arnr || "")}&vakn=${encodeURIComponent(vakn || "")}&sicht=V&fbnr=${encodeURIComponent(fbnr || "")}`;
  }

  function build441Url({ arnr, koll = "", fbnr = "", zicht = "A" }) {
    const qp = new URLSearchParams();
    if (koll) qp.set("koll", koll);
    if (arnr) qp.set("arnr", arnr);
    if (fbnr) qp.set("fbnr", fbnr);
    qp.set("sicht", zicht);
    return `${BASE}${PATH_441}?${qp.toString()}`;
  }

  function vaknDiscount(vakn) {
    const match = String(vakn || "").match(/(\d{2})$/);
    return match ? Number(match[1]) : 0;
  }

  function isNotFoundHttp(status) {
    return status === 401 || status === 403 || status === 404 || status === 410 || (status >= 500 && status <= 599);
  }

  function looksLikeLogin(status, text) {
    return status === 401 || status === 403 || /type=["']password["']/i.test(text || "");
  }

  async function getSessionHidden() {
    const response = await fetchViaGM({ url: BASE + PATH_410 });
    if (isNotFoundHttp(response.status)) throw new Error(`HTTP_${response.status}`);
    const doc = new DOMParser().parseFromString(response.responseText || "", "text/html");
    const form = $(".shop-article-search", doc) || $('form[name="Suche"]', doc);
    const val = (name) => form?.querySelector(`input[name="${name}"]`)?.value?.trim() || "";
    const out = { fir: val("fir"), kdnr: val("kdnr"), fssc: val("fssc"), aufn: val("aufn") };
    if (!out.fir || !out.kdnr) throw new Error("Anita-login/context ontbreekt.");
    return out;
  }

  async function getSessionHiddenCached() {
    if (!SESSION_HIDDEN_PROMISE) {
      SESSION_HIDDEN_PROMISE = getSessionHidden().catch((error) => {
        SESSION_HIDDEN_PROMISE = null;
        throw error;
      });
    }
    return SESSION_HIDDEN_PROMISE;
  }

  async function fetchDetailHtml(params) {
    const key = `${params.koll || ""}|${params.arnr || ""}|${params.fbnr || ""}`;
    if (DETAIL_CACHE.has(key)) return DETAIL_CACHE.get(key);
    const promise = (async () => {
      const response441 = await fetchViaGM({ url: build441Url(params) });
      if (response441.status >= 200 && response441.status < 300 && response441.responseText) return response441.responseText;
      if (isNotFoundHttp(response441.status)) throw new Error(`HTTP_${response441.status}`);
      try {
        const hidden = await getSessionHiddenCached();
        const bodyParams = { such: params.arnr || "", koll: params.koll || "", zicht: "S", ...hidden };
        if (params.fbnr) bodyParams.fbnr = params.fbnr;
        const responsePost = await fetchViaGM({ method: "POST", url: BASE + PATH_410, data: new URLSearchParams(bodyParams).toString() });
        if (responsePost.status >= 200 && responsePost.status < 300 && responsePost.responseText) return responsePost.responseText;
      } catch {}
      const qsParams = { such: params.arnr || "", koll: params.koll || "", zicht: "S" };
      if (params.fbnr) qsParams.fbnr = params.fbnr;
      const responseGet = await fetchViaGM({ url: `${BASE}${PATH_410}?${new URLSearchParams(qsParams).toString()}` });
      if (responseGet.status >= 200 && responseGet.status < 300 && responseGet.responseText) return responseGet.responseText;
      throw new Error(`HTTP_${responseGet.status}`);
    })();
    DETAIL_CACHE.set(key, promise);
    return promise;
  }

  function hasVariantForColor(doc, arnr, fbnr, fullText) {
    if (!fbnr) return false;
    for (const img of doc.querySelectorAll('img[src*="/color/"]')) {
      if (String(img.getAttribute("src") || "").includes(`/${fbnr}.`)) return true;
    }
    if (doc.getElementById(`article-variant-${arnr}-${fbnr}-accordion-heading`)) return true;
    const wordRegex = new RegExp(`\\b${fbnr}\\b`);
    for (const el of doc.querySelectorAll('h2.accordion-header, .accordion-button, [id*="article-variant-"]')) {
      const id = el.id || "";
      const text = (el.textContent || "").trim();
      if (id.includes(`-${fbnr}-`) || text.startsWith(`${fbnr} `) || text === fbnr || wordRegex.test(text)) return true;
    }
    return wordRegex.test(fullText || "");
  }

  async function findSale(params) {
    const pid = [params.koll, params.arnr, params.fbnr].filter(Boolean).join("-");
    if (SALE_CACHE.has(pid)) return SALE_CACHE.get(pid);
    const promise = (async () => {
      for (const vakn of VAKN_LIST) {
        const url = buildSaleUrl({ ...params, vakn });
        const response = await fetchViaGM({ url });
        const text = response.responseText || "";
        if (looksLikeLogin(response.status, text)) throw new Error("Anita-login vereist. Log in op b2b.anita.com en probeer opnieuw.");
        if (response.status < 200 || response.status >= 300 || !text) continue;
        const doc = new DOMParser().parseFromString(text, "text/html");
        if (hasVariantForColor(doc, params.arnr, params.fbnr, text)) return { vakn, url, html: text };
      }
      return null;
    })();
    SALE_CACHE.set(pid, promise);
    return promise;
  }

  function colorFromImg(table) {
    const match = String(table.querySelector('img[src*="/color/"]')?.getAttribute("src") || "").match(/\/color\/(\d+)\.jpg/i);
    return match ? match[1] : "";
  }

  function parseAnitaStock(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const tables = $$(".shop-article-tables table[data-article-number]", doc);
    const out = { article: tables[0]?.dataset.articleNumber || null, colors: {}, tableCount: tables.length };
    for (const table of tables) {
      const colorNo = (table.dataset.colorNumber || colorFromImg(table) || "").trim();
      const colorName = (table.dataset.colorName || "").trim();
      const bandHeaders = $$("thead th", table)
        .map((th) => th.textContent.trim())
        .filter((value) => value && !/^(Inkoopprijs|Verkoopprijs)$/i.test(value));
      const rows = $$("tbody tr", table);
      const hasCup = rows.some((row) => (row.querySelector('th[scope="row"]')?.textContent || "").trim());
      const sizes = {};
      for (const row of rows) {
        const cup = (row.querySelector('th[scope="row"]')?.textContent || "").trim();
        if (hasCup && !cup) continue;
        $$("td", row).forEach((td, index) => {
          const band = bandHeaders[index];
          const input = $('input[data-in-stock]', td);
          if (!band || !input) return;
          const key = normalizeSizeKey(hasCup ? `${band}${cup}` : band);
          const qty = parseInt(input.getAttribute("data-in-stock") || "0", 10) || 0;
          if (isSizeLabel(key) && qty > 0) sizes[key] = qty;
        });
      }
      if (colorNo) out.colors[colorNo] = { name: colorName, sizes };
    }
    return out;
  }

  const normColor = (raw) => {
    const stripped = String(raw || "").trim().replace(/^0+/, "");
    return stripped === "" ? "0" : stripped;
  };

  function chooseColor(remote, fbnrHint) {
    const colors = remote?.colors || {};
    const asked = String(fbnrHint || "").trim();
    if (asked) {
      if (colors[asked]) return colors[asked].sizes;
      const askedN = normColor(asked);
      const key = Object.keys(colors).find((color) => normColor(color) === askedN);
      return key ? colors[key].sizes : {};
    }
    const entries = Object.values(colors);
    if (entries.length === 1) return entries[0].sizes;
    const merged = {};
    for (const color of entries) {
      for (const [size, stock] of Object.entries(color.sizes || {})) merged[size] = Math.max(merged[size] || 0, Number(stock || 0));
    }
    return merged;
  }

  function parseAnitaRrpInfo(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const candidates = $$("div.vkp", doc)
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter((value) => /[0-9]/.test(value));

    for (const node of $$("[class*='vkp'], [data-vkp]", doc)) {
      for (const attribute of Array.from(node.attributes || [])) {
        if (!/vkp/i.test(attribute.name)) continue;
        const value = String(attribute.value || "").trim();
        if (/[0-9]/.test(value)) candidates.push(value);
      }
    }

    const value = candidates
      .map(parseMoney)
      .find((price) => price !== null && price >= 5) ?? null;
    return { value, candidates: [...new Set(candidates)].slice(0, 10) };
  }

  function parseAnitaRrp(html) {
    return parseAnitaRrpInfo(html).value;
  }

  function supplierUrlForProduct(productId) {
    const parsed = parsePid(productId);
    return buildSaleUrl({ ...parsed, vakn: "" });
  }

  function readProducts(buffer, brand = BRAND) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rows = sourceRows.map((source) => {
      const row = {};
      for (const [key, value] of Object.entries(source || {})) row[normalizeHeader(key)] = value;
      return row;
    });
    const groups = new Map();
    const aliases = {
      sku: ["product id", "product_id", "supplier_pid", "supplier pid", "supplier sku", "leveranciersartikelnummer", "leverancier artikelnummer", "sku", "model"],
      id: ["product_id", "product id", "id"],
      name: ["model", "product_name", "product name", "name", "naam", "title"],
      size: ["size", "maat", "option", "option name", "attribute", "attribute value", "value"],
      ownPrice: ["price", "prijs", "selling price", "verkoopprijs"],
      ownRrp: ["advice price", "rrp", "adviesprijs", "recommended retail price", "old price", "price old"]
    };
    for (const row of rows) {
      const sku = String(firstValue(row, aliases.sku)).trim();
      if (!sku) continue;
      const productId = String(firstValue(row, aliases.id) || sku).trim();
      const warehouseId = String(row.productid1 || "").match(/\d{5}/)?.[0] || "";
      const key = productId || sku;
      if (!groups.has(key)) {
        groups.set(key, {
          brand,
          productId,
          supplierUrl: supplierUrlForProduct(productId),
          warehouseId,
          productName: String(firstValue(row, aliases.name)).trim(),
          sku,
          sizes: [],
          ownPrice: parseMoney(firstValue(row, aliases.ownPrice)),
          ownRrp: parseMoney(firstValue(row, aliases.ownRrp))
        });
      }
      const size = normalizeSizeKey(firstValue(row, aliases.size));
      if (isSizeLabel(size) && !groups.get(key).sizes.includes(size)) groups.get(key).sizes.push(size);
    }
    if (!groups.size) {
      const headers = Object.keys(sourceRows[0] || {}).join(", ");
      throw new Error(`Geen Anita-producten herkend in DDO-export. Gevonden kolommen: ${headers || "geen"}`);
    }
    return [...groups.values()];
  }

  function loadProducts(buffer, api, messagePrefix = "DDO-tabel ingelezen", brand = BRAND) {
    products = readProducts(buffer, brand);
    log("DDO products", products);
    api.setInventory(products, `${messagePrefix}: ${products.length} ${brand}-producten.`);
  }

  function waitWhilePaused() {
    return new Promise((resolve) => {
      const tick = () => paused ? setTimeout(tick, 250) : resolve();
      tick();
    });
  }

  async function checkProduct(product) {
    const parsed = parsePid(product.productId || product.sku);
    if (!parsed.arnr) throw new Error(`Anita Supplier ID niet bruikbaar: ${product.productId || product.sku}`);
    const sale = await findSale(parsed);
    const html = sale?.html || await fetchDetailHtml(parsed);
    let rrpInfo = parseAnitaRrpInfo(html);
    if (rrpInfo.value === null && sale?.html) {
      try {
        rrpInfo = parseAnitaRrpInfo(await fetchDetailHtml(parsed));
      } catch {}
    }
    log("[ANITA-PRICE]", {
      productId: product.productId,
      source: sale?.html ? "sale/detail-fallback" : "detail",
      supplierRrp: rrpInfo.value,
      candidates: rrpInfo.candidates
    });
    const remote = parseAnitaStock(html);
    const remoteMap = chooseColor(remote, parsed.fbnr);
    const stockEntries = Object.entries(remoteMap || {}).filter(([, stock]) => Number(stock) > 0);
    const notOrderable = !remote.tableCount || !stockEntries.length;
    const localSizes = new Set((product.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
    const missingSizes = stockEntries
      .filter(([size]) => !localSizes.has(size))
      .map(([size, stock]) => ({ size, stock }));
    return {
      ...product,
      supplierUrl: sale?.url || supplierUrlForProduct(product.productId),
      checkStatus: "checked",
      missingSizes,
      supplierRrp: rrpInfo.value,
      supplierDiscountPercentage: sale?.vakn ? vaknDiscount(sale.vakn) : 0,
      notOrderable,
      messages: notOrderable
        ? [remote.tableCount
            ? `Niet bestelbaar: geen bestelbare Anita-maten gevonden voor ${product.productId}.`
            : `Niet bestelbaar: geen Anita-maattabel gevonden voor ${product.productId}.`]
        : []
    };
  }

  async function watcherInit() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    while (!page.BrandsWatcher) await new Promise((resolve) => setTimeout(resolve, 50));
    const api = page.BrandsWatcher;
    api.registerAdapter(`Anita v${VERSION}`);
    console.log(`[BRANDS-WATCHER][ANITA] Controller actief: v${VERSION}`);

    page.addEventListener("brands-watcher:load-ddo", async (event) => {
      try {
        const brand = String(event.detail?.brand || "");
        if (brand !== BRAND) return;
        const label = String(event.detail?.label || brand);
        const tagId = String(event.detail?.tagId || DEFAULT_EXPORT_TAG_ID);
        api.progress(`DDO-export voor ${label} ophalen...`);
        loadProducts(await fetchDdoExport(tagId), api, "DDO-tabel ingelezen", label);
      } catch (error) {
        console.error("[BRANDS-WATCHER][ANITA]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:inventory-loaded", (event) => {
      const importedProducts = event.detail?.products;
      if (!Array.isArray(importedProducts) || !importedProducts.length) return;
      products = importedProducts
        .filter((product) => isAnitaBrand(product.brand))
        .map((product) => ({
          ...product,
          supplierUrl: product.supplierUrl || supplierUrlForProduct(product.productId || product.sku),
          sizes: (product.sizes || []).map(normalizeSizeKey).filter(isSizeLabel)
        }));
      log("DDO products received from page", products);
    });

    page.addEventListener("brands-watcher:pause", (event) => {
      paused = Boolean(event.detail?.paused);
    });

    async function runOne(product, prefix = "Anita") {
      try {
        const result = await checkProduct(product);
        api.addResult(result);
        return true;
      } catch (error) {
        console.warn(`[BRANDS-WATCHER][ANITA] ${prefix} overslaan: ${product.productId || product.sku}`, error);
        api.addResult({
          ...product,
          checkStatus: "skipped",
          messages: [`Anita overgeslagen: ${String(error?.message || error)}`]
        });
        return false;
      }
    }

    page.addEventListener("brands-watcher:retry", async (event) => {
      const productId = String(event.detail?.productId || "");
      const product = products.find((item) => String(item.productId) === productId);
      if (!product) return;
      api.progress(`Anita opnieuw controleren: ${product.productId}`);
      const ok = await runOne(product, "Anita opnieuw");
      api.complete(ok ? "Product opnieuw gecontroleerd." : "Product opnieuw overgeslagen.");
    });

    page.addEventListener("brands-watcher:start", async (event) => {
      if (event.detail?.brand !== BRAND) return;
      if (running) return;
      running = true;
      paused = false;
      try {
        const openProducts = products.filter((product) =>
          isAnitaBrand(product.brand) && !["checked", "skipped"].includes(product.checkStatus)
        );
        if (!openProducts.length) {
          api.complete("Geen openstaande Anita-producten om te controleren.");
          return;
        }
        let failed = 0;
        for (let index = 0; index < openProducts.length; index++) {
          await waitWhilePaused();
          const product = openProducts[index];
          api.progress(`Anita controleren: ${index + 1}/${openProducts.length} | ${product.productId || product.sku}`);
          if (!await runOne(product)) failed++;
        }
        api.complete(`Controle afgerond: ${openProducts.length - failed} verwerkt, ${failed} overgeslagen.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][ANITA]", error);
        api.fail(String(error?.message || error));
      } finally {
        running = false;
        paused = false;
      }
    });
  }

  if (isWatcher) watcherInit();
})();
