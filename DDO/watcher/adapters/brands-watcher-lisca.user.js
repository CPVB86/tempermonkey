// ==UserScript==
// @name         DDO | Brands Watcher - Lisca
// @version      0.1.4
// @description  Controleert Lisca op bestelbare maten, leverancierprijs met marge en kortingspercentage.
// @match        https://lingerieoutlet.nl/tools/watcher/brands.html*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @connect      b2b-eu.lisca.com
// @connect      b2b-int.lisca.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-lisca.user.js?v=0.1.4
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-lisca.user.js?v=0.1.4
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.1.4";
  const BRAND = "Lisca";
  const BASE = "https://b2b-eu.lisca.com";
  const RETAIL_MARGIN = 2.5;
  const DEFAULT_EXPORT_TAG_ID = new URLSearchParams(location.search).get("tagId") || "";
  const PAGE_CACHE = new Map();
  const SEARCH_CACHE = new Map();
  let products = [];
  let running = false;
  let paused = false;

  const log = (...args) => console.log("[BRANDS-WATCHER][LISCA]", ...args);

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

  function normalizeSupplierId(value) {
    return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function liscaSku(value) {
    return normalizeSupplierId(value).replace(/[^0-9A-Z]/g, "");
  }

  function normalizeSizeKey(raw) {
    let value = String(raw ?? "").trim().toUpperCase();
    value = value.replace(/\(.*?\)/g, "").replace(/\s+/g, "");
    value = value.replace(/^EU[-:]/, "");
    if (!value || value === "-" || value === "%1") return "";
    if (value === "TU" || value === "NOSIZE" || value === "ONESIZE" || value === "OS") return "NOSIZE";
    const bra = value.match(/^0*(\d{2,3})([A-Z]{1,4}(?:\/[A-Z]{1,4})?)$/);
    if (bra) return `${parseInt(bra[1], 10)}${bra[2]}`;
    if (/^0*\d{1,3}$/.test(value)) return String(parseInt(value, 10));
    return value;
  }

  function isSizeLabel(raw) {
    const value = normalizeSizeKey(raw);
    if (!value) return false;
    return /^(NOSIZE|\d{1,3}|\d{2,3}[A-Z]{1,4}(?:\/[A-Z]{1,4})?|XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL)$/.test(value);
  }

  function exportUrl(tagId = DEFAULT_EXPORT_TAG_ID) {
    return `https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=${encodeURIComponent(tagId)}`;
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: options.url,
        data: options.data,
        headers: options.headers,
        responseType: options.responseType,
        timeout: options.timeout || 30000,
        withCredentials: true,
        onload: resolve,
        onerror: () => reject(new Error(`Request mislukt: ${options.url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${options.url}`))
      });
    });
  }

  async function fetchDdoExport(tagId) {
    if (!tagId) throw new Error("Lisca tag ID ontbreekt. Importeer nu een DDO-bestand of geef de Lisca tag ID door.");
    const response = await gmRequest({
      method: "POST",
      url: exportUrl(tagId),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: new URLSearchParams({ format: "excel_attribute", export: "Export products" }).toString(),
      responseType: "arraybuffer",
      timeout: 60000
    });
    if (response.status !== 200) throw new Error(`DDO-export mislukt: HTTP ${response.status}`);
    if (!response.response?.byteLength) throw new Error("DDO-export is leeg.");
    return response.response;
  }

  function supplierUrlForProduct(productId) {
    const sku = liscaSku(productId);
    return sku ? `${BASE}/catalogsearch/result/?q=${encodeURIComponent(sku)}` : "";
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
      ownRrp: ["advice price", "rrp", "adviesprijs", "recommended retail price", "old price", "price old"],
      supplierUrl: ["supplier url", "supplier_url", "url", "leverancier url", "product url"]
    };

    for (const row of rows) {
      const sku = String(firstValue(row, aliases.sku)).trim();
      if (!sku) continue;
      const productId = String(firstValue(row, aliases.id) || sku).trim();
      const warehouseId = String(row.productid1 || "").match(/\d{5}/)?.[0] || "";
      const key = productId || sku;
      if (!groups.has(key)) {
        const supplierUrl = String(firstValue(row, aliases.supplierUrl) || "").trim();
        groups.set(key, {
          brand,
          productId,
          supplierUrl: supplierUrl || supplierUrlForProduct(productId),
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
      throw new Error(`Geen Lisca-producten herkend in DDO-export. Gevonden kolommen: ${headers || "geen"}`);
    }
    return [...groups.values()];
  }

  function absoluteUrl(url) {
    try { return new URL(url, BASE).toString(); } catch { return ""; }
  }

  async function fetchText(url) {
    if (PAGE_CACHE.has(url)) return PAGE_CACHE.get(url);
    const response = await gmRequest({
      url,
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      timeout: 45000
    });
    const text = String(response.responseText || "");
    if (response.status !== 200 || !text.trim()) throw new Error(`Lisca pagina gaf HTTP ${response.status || "onbekend"}: ${url}`);
    PAGE_CACHE.set(url, text);
    return text;
  }

  function findProductUrlInHtml(html, sku) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const normalizedSku = liscaSku(sku);
    const links = [...doc.querySelectorAll("a[href]")].map((link) => absoluteUrl(link.getAttribute("href"))).filter(Boolean);
    return links.find((href) => liscaSku(href).includes(normalizedSku) && /\\.html(?:$|[?#])/i.test(href)) ||
      links.find((href) => href.includes(`${normalizedSku.toLowerCase()}.html`)) ||
      "";
  }

  async function resolveProductUrl(product) {
    const sku = liscaSku(product.productId || product.sku);
    if (!sku) throw new Error(`Lisca Supplier ID niet bruikbaar: ${product.productId || product.sku}`);
    if (/^https?:\/\//i.test(product.supplierUrl || "") && !/catalogsearch\/result/i.test(product.supplierUrl)) {
      return product.supplierUrl;
    }
    if (SEARCH_CACHE.has(sku)) return SEARCH_CACHE.get(sku);
    const searchUrl = `${BASE}/catalogsearch/result/?q=${encodeURIComponent(sku)}`;
    const searchHtml = await fetchText(searchUrl);
    const found = findProductUrlInHtml(searchHtml, sku);
    const resolved = found || searchUrl;
    SEARCH_CACHE.set(sku, resolved);
    return resolved;
  }

  function priceFromNode(node) {
    return parseMoney(node?.getAttribute?.("data-price-amount") || node?.textContent || "");
  }

  function marginPrice(value) {
    return value === null ? null : Math.round(value * RETAIL_MARGIN * 100) / 100;
  }

  function parsePriceInfo(doc) {
    const finalCandidates = [
      ...doc.querySelectorAll('[data-price-type="finalPrice"][data-price-amount]'),
      ...doc.querySelectorAll(".product-info-price .normal-price .price-wrapper, .prodmatrix-price")
    ].map(priceFromNode).filter((value) => value !== null && value > 0);
    const oldCandidates = [
      ...doc.querySelectorAll('[data-price-type="oldPrice"][data-price-amount]'),
      ...doc.querySelectorAll(".product-info-price .old-price .price-wrapper, .prodmatrix-old-price")
    ].map(priceFromNode).filter((value) => value !== null && value > 0);
    const purchasePrice = finalCandidates[0] ?? null;
    const purchaseBase = oldCandidates.find((value) => purchasePrice === null || value >= purchasePrice) ?? null;
    const purchaseRrp = purchaseBase ?? purchasePrice;
    const supplierPrice = marginPrice(purchasePrice);
    const supplierRrp = marginPrice(purchaseRrp);
    const discount = purchasePrice !== null && purchaseRrp !== null && purchaseRrp > purchasePrice
      ? Math.round((1 - purchasePrice / purchaseRrp) * 100)
      : 0;
    return {
      supplierPrice,
      supplierRrp,
      supplierDiscountPercentage: discount,
      supplierPurchasePrice: purchasePrice,
      supplierPurchaseBase: purchaseRrp,
      retailMargin: RETAIL_MARGIN
    };
  }

  function cleanEuLabel(text) {
    return String(text || "").replace(/\s+/g, " ").trim().replace(/^EU\s*[-:]\s*/i, "").trim();
  }

  function parseStockNumber(cell) {
    const inputMax = parseMoney(cell.querySelector("input.prodmatrix-qty")?.getAttribute("max"));
    if (inputMax !== null) return inputMax;
    const textMatch = String(cell.textContent || "").match(/Op voorraad\s*\((\d+)\)/i);
    return textMatch ? Number(textMatch[1]) : 0;
  }

  function combineMatrixSize(columnLabel, rowLabel) {
    const column = cleanEuLabel(columnLabel);
    const row = cleanEuLabel(rowLabel);
    if (!column && !row) return "";
    if (/^[A-Z]{1,4}(?:\/[A-Z]{1,4})?$/.test(row) && /^\d{2,3}$/.test(column)) return `${column}${row}`;
    if (column && (!row || row === "-")) return column;
    if (!column) return row;
    if (row && row !== column && /^[A-Z]{1,4}$/.test(row)) return `${column}${row}`;
    return column || row;
  }

  function parseMatrixSizes(doc) {
    const table = doc.querySelector(".um-prodmatrix table");
    if (!table) return { tableCount: 0, sizes: [] };
    const headerLabels = [...table.querySelectorAll("thead tr > th")]
      .slice(1)
      .map((th) => cleanEuLabel(th.querySelector(".size-row.size-eu")?.textContent || th.textContent || ""));
    const sizes = [];
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.children];
      const rowLabel = cleanEuLabel(cells[0]?.querySelector?.(".size-row.size-eu")?.textContent || cells[0]?.textContent || "");
      cells.slice(1).forEach((cell, index) => {
        if (!cell.matches?.(".prodmatrix-quantity")) return;
        const stock = parseStockNumber(cell);
        const isOrderable = cell.classList.contains("prodmatrix-instock") && stock > 0 && !cell.querySelector("input[disabled]");
        if (!isOrderable) return;
        const size = normalizeSizeKey(combineMatrixSize(headerLabels[index], rowLabel));
        if (isSizeLabel(size) && !sizes.some((entry) => entry.size === size)) sizes.push({ size, stock });
      });
    }
    return { tableCount: 1, sizes };
  }

  async function checkProduct(product) {
    const productUrl = await resolveProductUrl(product);
    const html = await fetchText(productUrl);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const price = parsePriceInfo(doc);
    const remote = parseMatrixSizes(doc);
    const localSizes = new Set((product.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
    const missingSizes = remote.sizes
      .filter((entry) => !localSizes.has(entry.size))
      .map((entry) => ({ size: entry.size, stock: entry.stock }));
    const notOrderable = !remote.tableCount || !remote.sizes.length;
    log("[LISCA-CHECK]", {
      productId: product.productId,
      productUrl,
      price,
      remoteSizes: remote.sizes.length,
      missingSizes: missingSizes.map((entry) => entry.size)
    });
    return {
      ...product,
      supplierUrl: productUrl,
      checkStatus: "checked",
      missingSizes,
      supplierPrice: price.supplierPrice,
      supplierRrp: price.supplierRrp,
      supplierPurchasePrice: price.supplierPurchasePrice,
      supplierPurchaseBase: price.supplierPurchaseBase,
      supplierDiscountPercentage: price.supplierDiscountPercentage,
      notOrderable,
      messages: notOrderable
        ? [remote.tableCount
            ? `Niet bestelbaar: geen bestelbare Lisca-maten gevonden voor ${product.productId}.`
            : `Niet bestelbaar: geen Lisca-maattabel gevonden voor ${product.productId}.`]
        : []
    };
  }

  function waitWhilePaused() {
    return new Promise((resolve) => {
      const tick = () => paused ? setTimeout(tick, 250) : resolve();
      tick();
    });
  }

  async function watcherInit() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    while (!page.BrandsWatcher) await new Promise((resolve) => setTimeout(resolve, 50));
    const api = page.BrandsWatcher;
    api.registerAdapter({
      id: "brands-watcher-lisca",
      name: "DDO | Brands Watcher - Lisca",
      version: VERSION,
      downloadURL: "https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-lisca.user.js"
    });
    log(`Controller actief: v${VERSION}`);

    page.addEventListener("brands-watcher:load-ddo", async (event) => {
      try {
        if (event.detail?.brand !== BRAND) return;
        const tagId = String(event.detail?.tagId || DEFAULT_EXPORT_TAG_ID);
        api.progress("DDO-export voor Lisca ophalen...");
        products = readProducts(await fetchDdoExport(tagId), BRAND);
        api.setInventory(products, `DDO-tabel ingelezen: ${products.length} Lisca-producten.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][LISCA]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:inventory-loaded", (event) => {
      const importedProducts = event.detail?.products;
      if (!Array.isArray(importedProducts) || !importedProducts.length) return;
      products = importedProducts
        .filter((product) => product.brand === BRAND)
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

    async function runOne(product, prefix = "Lisca") {
      try {
        api.addResult(await checkProduct(product));
        return true;
      } catch (error) {
        console.warn(`[BRANDS-WATCHER][LISCA] ${prefix} overslaan: ${product.productId || product.sku}`, error);
        api.addResult({
          ...product,
          checkStatus: "skipped",
          messages: [`Lisca overgeslagen: ${String(error?.message || error)}`]
        });
        return false;
      }
    }

    page.addEventListener("brands-watcher:retry", async (event) => {
      const productId = String(event.detail?.productId || "");
      const product = products.find((item) => String(item.productId) === productId);
      if (!product || product.brand !== BRAND) return;
      api.progress(`Lisca opnieuw controleren: ${product.productId}`);
      const ok = await runOne(product, "Lisca opnieuw");
      api.complete(ok ? "Product opnieuw gecontroleerd." : "Product opnieuw overgeslagen.");
    });

    page.addEventListener("brands-watcher:start", async (event) => {
      if (event.detail?.brand !== BRAND || running) return;
      running = true;
      paused = false;
      try {
        const openProducts = products.filter((product) =>
          product.brand === BRAND && !["checked", "skipped"].includes(product.checkStatus)
        );
        if (!openProducts.length) {
          api.complete("Geen openstaande Lisca-producten om te controleren.");
          return;
        }
        let failed = 0;
        for (let index = 0; index < openProducts.length; index++) {
          await waitWhilePaused();
          const product = openProducts[index];
          api.progress(`Lisca controleren: ${index + 1}/${openProducts.length} | ${product.productId || product.sku}`);
          if (!await runOne(product)) failed++;
        }
        api.complete(`Controle afgerond: ${openProducts.length - failed} verwerkt, ${failed} overgeslagen.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][LISCA]", error);
        api.fail(String(error?.message || error));
      } finally {
        running = false;
        paused = false;
      }
    });
  }

  watcherInit();
})();
