// ==UserScript==
// @name         DDO | Brand Watcher - Wacoal Bargain
// @version      0.2.0
// @description  Vergelijkt Wacoal Bargain met Google Sheets of een leveranciers-Excel voor korting en maten.
// @match        https://lingerieoutlet.nl/tools/watcher/brands.html*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/wacoal-bargain.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/wacoal-bargain.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const VERSION = "0.2.0";
  const BRAND = "Wacoal Bargain";
  const DEFAULT_EXPORT_TAG_ID = "250";
  const SHEET_ID = "1OhVqA8DA4LfRfSzerOMXUuBQWv4L3vmqLIKSQjzdSIU";
  const SHEET_GID = "1834471918";
  const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;
  const SHEET_CSV_URLS = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`
  ];
  const log = (...args) => console.log("[BRANDS-WATCHER][WACOAL-BARGAIN]", ...args);
  let products = [];
  let discountMapPromise = null;
  let uploadedSupplierMap = null;
  let running = false;
  let paused = false;

  function normalizeHeader(header) {
    return String(header ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function normalizeSupplierId(value) {
    return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function normalizeSizeKey(raw) {
    let value = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!value) return "";
    if (value === "TU" || value === "NOSIZE" || value === "ONESIZE" || value === "OS") return "NOSIZE";
    const bra = value.match(/^0*(\d{2,3})([A-Z]{1,4}(?:\/[A-Z]{1,4})?)$/);
    if (bra) return `${parseInt(bra[1], 10)}${bra[2]}`;
    if (/^0*\d{1,3}$/.test(value)) return String(parseInt(value, 10));
    return value;
  }

  function normalizeRow(source) {
    const row = {};
    for (const [key, value] of Object.entries(source || {})) row[normalizeHeader(key)] = value;
    return row;
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

  function parseDiscount(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return null;
    let number = parseMoney(text);
    if (number === null) return null;
    number = Math.abs(number);
    if (!text.includes("%") && number > 0 && number <= 1) number *= 100;
    return Math.round(number * 100) / 100;
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
        onload: resolve,
        onerror: () => reject(new Error(`Request mislukt: ${options.url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${options.url}`))
      });
    });
  }

  async function fetchDdoExport(tagId) {
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

  function readProducts(buffer, brand = BRAND) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rows = sourceRows.map(normalizeRow);
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
          supplierUrl: SHEET_URL,
          warehouseId,
          productName: String(firstValue(row, aliases.name)).trim(),
          sku,
          sizes: [],
          ownPrice: parseMoney(firstValue(row, aliases.ownPrice)),
          ownRrp: parseMoney(firstValue(row, aliases.ownRrp)),
          warningMode: "missed-discount-only"
        });
      }
      const size = normalizeSizeKey(firstValue(row, aliases.size));
      if (size && !groups.get(key).sizes.includes(size)) groups.get(key).sizes.push(size);
    }

    if (!groups.size) {
      const headers = Object.keys(sourceRows[0] || {}).join(", ");
      throw new Error(`Geen Wacoal Bargain-producten herkend. Gevonden kolommen: ${headers || "geen"}`);
    }
    return [...groups.values()];
  }

  function looksLikeHtml(text) {
    return /^\s*<!doctype html|^\s*<html/i.test(String(text || ""));
  }

  async function fetchSheetCsv() {
    let lastError = null;
    for (const url of SHEET_CSV_URLS) {
      try {
        const response = await gmRequest({ url, timeout: 30000 });
        const text = String(response.responseText || "");
        if (response.status === 200 && text.trim() && !looksLikeHtml(text)) return text;
        lastError = new Error(`Google Sheet CSV gaf HTTP ${response.status || "onbekend"}.`);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${lastError?.message || "Google Sheet kon niet worden geladen"} Controleer of de sheet voor iedereen met de link leesbaar is.`);
  }

  function parseDiscountMap(csvText) {
    const workbook = XLSX.read(csvText, { type: "string", raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const map = new Map();
    for (const row of rows) {
      const supplierId = normalizeSupplierId(row[0]);
      const discount = parseDiscount(row[2]);
      if (!supplierId || discount === null) continue;
      map.set(supplierId, { discount, sizes: [] });
    }
    if (!map.size) throw new Error("Geen Supplier ID/kortingspercentage gevonden in kolommen A en C van de Google Sheet.");
    return map;
  }

  function getDiscountMap() {
    if (!discountMapPromise) {
      discountMapPromise = fetchSheetCsv()
        .then(parseDiscountMap)
        .catch((error) => {
          discountMapPromise = null;
          throw error;
        });
    }
    return discountMapPromise;
  }

  function cellText(sheet, row, column) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (!cell) return "";
    return String(cell.w ?? cell.v ?? "").trim();
  }

  async function parseSupplierWorkbook(buffer, onProgress) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    const map = new Map();
    const firstDataRow = Math.max(range.s.r + 1, 1);

    for (let row = firstDataRow; row <= range.e.r; row++) {
      const supplierId = normalizeSupplierId(cellText(sheet, row, 5));
      if (supplierId) {
        const size = normalizeSizeKey(cellText(sheet, row, 6));
        const discount = parseDiscount(cellText(sheet, row, 10));
        const toSell = parseMoney(cellText(sheet, row, 12));
        const entry = map.get(supplierId) || { discount: null, sizes: [] };
        if (discount !== null) entry.discount = discount;
        if (size && (toSell === null || toSell > 0) && !entry.sizes.includes(size)) entry.sizes.push(size);
        map.set(supplierId, entry);
      }

      if ((row - firstDataRow) % 5000 === 0) {
        onProgress?.(row - firstDataRow + 1, range.e.r - firstDataRow + 1);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    for (const [supplierId, entry] of map) {
      if (entry.discount === null) map.delete(supplierId);
    }
    if (!map.size) throw new Error("Geen Supplier ID, EU-maat en korting gevonden in kolommen F, G en K.");
    return map;
  }

  function getSupplierMap() {
    return uploadedSupplierMap ? Promise.resolve(uploadedSupplierMap) : getDiscountMap();
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
    api.registerAdapter(`Wacoal Bargain v${VERSION}`);
    log(`Controller actief: v${VERSION}`);

    page.addEventListener("brands-watcher:load-ddo", async (event) => {
      try {
        if (event.detail?.brand !== BRAND) return;
        const tagId = String(event.detail?.tagId || DEFAULT_EXPORT_TAG_ID);
        api.progress("DDO-export voor Wacoal Bargain ophalen...");
        products = readProducts(await fetchDdoExport(tagId), BRAND);
        api.setInventory(products, `DDO-tabel ingelezen: ${products.length} Wacoal Bargain-producten.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][WACOAL-BARGAIN]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:import-supplier", async (event) => {
      if (event.detail?.brand !== BRAND) return;
      const file = event.detail?.file;
      if (!file) return api.fail("Geen Wacoal leveranciersbestand geselecteerd.");
      try {
        api.progress(`Wacoal leveranciersbestand openen: ${file.name}...`);
        uploadedSupplierMap = await parseSupplierWorkbook(
          await file.arrayBuffer(),
          (done, total) => api.progress(`Wacoal leveranciersbestand verwerken: ${done}/${total} regels...`)
        );
        log(`Excel geladen: ${uploadedSupplierMap.size} Supplier ID's.`);
        api.complete(`Leveranciersbestand ingelezen: ${uploadedSupplierMap.size} Supplier ID's met korting en maten.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][WACOAL-BARGAIN]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:inventory-loaded", (event) => {
      const importedProducts = event.detail?.products;
      if (!Array.isArray(importedProducts) || !importedProducts.length) return;
      products = importedProducts
        .filter((product) => product.brand === BRAND)
        .map((product) => ({ ...product, warningMode: "missed-discount-only" }));
    });

    page.addEventListener("brands-watcher:pause", (event) => {
      paused = Boolean(event.detail?.paused);
    });

    async function checkOne(product, supplierMap) {
      const key = normalizeSupplierId(product.productId || product.sku);
      if (!supplierMap.has(key)) {
        throw new Error(`Supplier ID ${product.productId || product.sku} niet gevonden in de kortingsbron.`);
      }
      const supplier = supplierMap.get(key);
      const localSizes = new Set((product.sizes || []).map(normalizeSizeKey).filter(Boolean));
      const missingSizes = (supplier.sizes || [])
        .filter((size) => !localSizes.has(size))
        .map((size) => ({ size }));
      return {
        ...product,
        supplierUrl: SHEET_URL,
        checkStatus: "checked",
        missingSizes,
        supplierDiscountPercentage: supplier.discount,
        warningMode: "missed-discount-only",
        messages: []
      };
    }

    async function runOne(product, supplierMap) {
      try {
        api.addResult(await checkOne(product, supplierMap));
        return true;
      } catch (error) {
        api.addResult({
          ...product,
          checkStatus: "skipped",
          warningMode: "missed-discount-only",
          messages: [`Wacoal Bargain overgeslagen: ${String(error?.message || error)}`]
        });
        return false;
      }
    }

    page.addEventListener("brands-watcher:retry", async (event) => {
      const productId = String(event.detail?.productId || "");
      const product = products.find((item) => String(item.productId) === productId);
      if (!product) return;
      try {
        api.progress(`Wacoal Bargain opnieuw controleren: ${productId}`);
        const ok = await runOne(product, await getSupplierMap());
        api.complete(ok ? "Product opnieuw gecontroleerd." : "Product opnieuw overgeslagen.");
      } catch (error) {
        api.fail(String(error?.message || error));
      }
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
          api.complete("Geen openstaande Wacoal Bargain-producten om te controleren.");
          return;
        }
        api.progress(uploadedSupplierMap
          ? "Geupload Wacoal leveranciersbestand gebruiken..."
          : "Google Sheet met Wacoal-kortingen ophalen...");
        const supplierMap = await getSupplierMap();
        log(`Kortingsbron geladen: ${supplierMap.size} Supplier ID's.`);
        let failed = 0;
        for (let index = 0; index < openProducts.length; index++) {
          await waitWhilePaused();
          const product = openProducts[index];
          api.progress(`Wacoal Bargain controleren: ${index + 1}/${openProducts.length} | ${product.productId || product.sku}`);
          if (!await runOne(product, supplierMap)) failed++;
        }
        api.complete(`Controle afgerond: ${openProducts.length - failed} verwerkt, ${failed} overgeslagen.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][WACOAL-BARGAIN]", error);
        api.fail(String(error?.message || error));
      } finally {
        running = false;
        paused = false;
      }
    });
  }

  watcherInit();
})();
