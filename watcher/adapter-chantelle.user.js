// ==UserScript==
// @name         DDO Brands Watcher | Chantelle
// @version      0.22.15
// @description  Laadt Chantelle uit DDO en toont ontbrekende leveranciersmaten in de Brands Watcher.
// @match        https://lingerieoutlet.nl/tools/watcher/brands.html*
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/adapter-chantelle.user.js?v=0.22.15
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/watcher/adapter-chantelle.user.js?v=0.22.15
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = true;
  const VERSION = "0.22.15";
  const log = (...args) => DEBUG && console.log("[BRANDS-WATCHER]", ...args);
  const JOB_KEY = "BRANDS_WATCHER_CHANTELLE_JOB_V1";
  const RESP_PREFIX = "BRANDS_WATCHER_CHANTELLE_RESP_V1_";
  const WORKER_READY_KEY = "BRANDS_WATCHER_CHANTELLE_READY_V1";
  const DEFAULT_EXPORT_TAG_ID = new URLSearchParams(location.search).get("tagId") || "237";
  const isWatcher = location.hostname === "lingerieoutlet.nl" || location.hostname === "127.0.0.1";
  const isChantelle = location.hostname.includes("chantelle-lingerie.my.site.com");
  function normalizeSizeKey(raw) {
    let value = String(raw ?? "").trim();
    if (!value) return "";

    value = value.split(/[|,]/)[0].trim().toUpperCase().replace(/\s+/g, "");
    value = value.replace(/[-\u2013\u2014]+$/g, "");
    if (!value) return "";
    if (value === "TU" || value === "NOSIZE" || value === "ONESIZE" || value === "OS") return "NOSIZE";

    const numericXl = (token) => {
      if (/^[2-6]XL$/.test(token)) return "X".repeat(Number(token[0])) + "L";
      return token;
    };
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

  function waitForResponse(jobId, timeoutMs = 65000) {
    return new Promise((resolve, reject) => {
      const responseKey = RESP_PREFIX + jobId;
      let stop;
      const cleanup = () => {
        clearTimeout(timer);
        try { stop?.(); } catch {}
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout: houd een ingelogde Chantelle-productpagina open en ververs die eenmalig."));
      }, timeoutMs);

      stop = GM_addValueChangeListener(responseKey, (_key, _old, value) => {
        cleanup();
        resolve(value);
      });
      const existing = GM_getValue(responseKey, null);
      if (existing) {
        cleanup();
        resolve(existing);
      }
    });
  }

  function normalizeHeader(header) {
    return String(header ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function firstValue(row, aliases) {
    for (const alias of aliases) {
      const value = row[normalizeHeader(alias)];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function normalizeRow(source) {
    const row = {};
    for (const [key, value] of Object.entries(source || {})) row[normalizeHeader(key)] = value;
    return row;
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

  function fetchDdoExport(tagId) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: exportUrl(tagId),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: new URLSearchParams({ format: "excel_attribute", export: "Export products" }).toString(),
        responseType: "arraybuffer",
        timeout: 60000,
        onload: (response) => {
          if (response.status !== 200) return reject(new Error(`DDO-export mislukt: HTTP ${response.status}`));
          if (!response.response?.byteLength) return reject(new Error("DDO-export is leeg."));
          resolve(response.response);
        },
        onerror: () => reject(new Error("DDO-export kon niet worden opgehaald. Controleer je DDO-login.")),
        ontimeout: () => reject(new Error("Timeout bij ophalen van de DDO-export."))
      });
    });
  }

  function readProducts(buffer, brand = "Chantelle") {
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
      const productId = String(firstValue(row, aliases.id)).trim();
      const warehouseId = String(row.productid1 || "").match(/\d{5}/)?.[0] || "";
      const key = productId || sku;

      if (!groups.has(key)) {
        groups.set(key, {
          brand,
          productId,
          supplierUrl: brand === "Chantelle"
            ? `https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__ProductDetails?sku=${encodeURIComponent(productId)}`
            : "",
          warehouseId,
          productName: String(firstValue(row, aliases.name)).trim(),
          sku,
          sizes: [],
          ownPrice: parseMoney(firstValue(row, aliases.ownPrice)),
          ownRrp: parseMoney(firstValue(row, aliases.ownRrp))
        });
      }

      const product = groups.get(key);
      const size = normalizeSizeKey(firstValue(row, aliases.size));
      if (isSizeLabel(size) && !product.sizes.includes(size)) product.sizes.push(size);
    }

    if (!groups.size) {
      const headers = Object.keys(sourceRows[0] || {}).join(", ");
      throw new Error(`Geen Chantelle-producten herkend in DDO-export. Gevonden kolommen: ${headers || "geen"}`);
    }
    return [...groups.values()];
  }

  async function watcherInit() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    while (!page.BrandsWatcher) await new Promise((resolve) => setTimeout(resolve, 50));
    const api = page.BrandsWatcher;
    let running = false;
    let paused = false;
    let products = [];
    api.registerAdapter(`Chantelle v${VERSION}`);
    console.log(`[BRANDS-WATCHER] Controller actief: v${VERSION}`);

  function loadProducts(buffer, messagePrefix = "DDO-tabel ingelezen", brand = "Chantelle") {
      products = readProducts(buffer, brand);
      log("DDO products", products);
      api.setInventory(products, `${messagePrefix}: ${products.length} ${brand}-producten.`);
    }

    page.addEventListener("brands-watcher:load-ddo", async (event) => {
      try {
        const brand = String(event.detail?.brand || "Chantelle");
        if (brand !== "Chantelle") return;
        const tagId = String(event.detail?.tagId || DEFAULT_EXPORT_TAG_ID);
        api.progress(`DDO-export voor ${brand} ophalen...`);
        loadProducts(await fetchDdoExport(tagId), "DDO-tabel ingelezen", brand);
      } catch (error) {
        console.error("[BRANDS-WATCHER]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:import-ddo", async (event) => {
      try {
        const brand = String(event.detail?.brand || "Chantelle");
        if (brand !== "Chantelle") return;
        const file = event.detail?.file || document.querySelector("#ddo-file")?.files?.[0];
        if (!file) throw new Error("Geen DDO-bestand geselecteerd.");
        api.progress(`DDO-bestand importeren: ${file.name}...`);
        loadProducts(await file.arrayBuffer(), `DDO-bestand ingelezen: ${file.name}`, brand);
      } catch (error) {
        console.error("[BRANDS-WATCHER]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:inventory-loaded", (event) => {
      const importedProducts = event.detail?.products;
      if (!Array.isArray(importedProducts) || !importedProducts.length) return;
      products = importedProducts.map((product) => ({
        ...product,
        sizes: (product.sizes || []).map(normalizeSizeKey).filter(isSizeLabel)
      }));
      log("DDO products received from page", products);
    });

    function assertWorkerReady() {
      const workerReadyAt = Number(GM_getValue(WORKER_READY_KEY, 0));
      if (!workerReadyAt || Date.now() - workerReadyAt > 15000) {
        throw new Error("Chantelle-worker niet actief. Open een ingelogde Chantelle-productpagina, ververs die eenmaal en probeer opnieuw.");
      }
    }

    async function waitWhilePaused() {
      while (paused) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    async function checkProduct(product) {
      try {
        const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        GM_setValue(JOB_KEY, { id, sku: product.sku, sizes: product.sizes, remoteDiscount: true, createdAt: Date.now() });
        const response = await waitForResponse(id);
        if (!response?.ok) throw new Error(response?.error || `Chantelle-worker fout bij ${product.sku}`);
        console.log(`[CHANTELLE-DISCOUNT] watcher diagnose v${VERSION}`, {
          sku: product.sku,
          ...response.discountDebug
        });
        const stockSizesTotal = Number(response.stockSizesTotal) || 0;
        if (!stockSizesTotal) throw new Error(`Geen bruikbare Chantelle-stockmaten ontvangen voor ${product.sku}`);

        const supplierDiscountPercentage =
          response.supplierDiscountPercentage ??
          response.discountDebug?.gevonden ??
          null;
        console.log(`[CHANTELLE-DISCOUNT] doorgestuurd naar tabel v${VERSION}`, {
          sku: product.sku,
          supplierRrp: response.supplierRrp ?? null,
          supplierDiscountPercentage
        });
        api.addResult({
          ...product,
          checkStatus: "checked",
          missingSizes: response.missingSizes || [],
          supplierRrp: response.supplierRrp ?? null,
          supplierDiscountPercentage,
          messages: []
        });
        return true;
      } catch (error) {
        console.warn(`[BRANDS-WATCHER] Chantelle overslaan: ${product.sku}`, error);
        api.addResult({
          ...product,
          checkStatus: "skipped",
          messages: [`Chantelle overgeslagen: ${String(error?.message || error)}`]
        });
        return false;
      }
    }

    page.addEventListener("brands-watcher:pause", (event) => {
      paused = Boolean(event.detail?.paused);
    });

    page.addEventListener("brands-watcher:retry", async (event) => {
      const productId = String(event.detail?.productId || "");
      const product = products.find((item) => String(item.productId) === productId);
      if (!product || product.brand !== "Chantelle") return;
      try {
        assertWorkerReady();
        api.progress(`Chantelle opnieuw controleren: ${product.sku}`);
        const ok = await checkProduct(product);
        api.complete(ok ? "Product opnieuw gecontroleerd." : "Product opnieuw overgeslagen.");
      } catch (error) {
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:start", async (event) => {
      if (event.detail?.brand && event.detail.brand !== "Chantelle") return;
      if (running) return;
      running = true;
      paused = false;
      try {
        const chantelleProducts = products.filter((product) =>
          product.brand === "Chantelle" && !["checked", "skipped"].includes(product.checkStatus)
        );
        if (!chantelleProducts.length) {
          api.complete("Geen openstaande Chantelle-producten om te controleren.");
          return;
        }
        assertWorkerReady();
        let failed = 0;
        for (let index = 0; index < chantelleProducts.length; index++) {
          await waitWhilePaused();
          const product = chantelleProducts[index];
          api.progress(
            `Chantelle controleren: ${index + 1}/${chantelleProducts.length} | ${product.sku}`
          );
          if (!await checkProduct(product)) failed++;
        }

        api.complete(`Controle afgerond: ${chantelleProducts.length - failed} verwerkt, ${failed} overgeslagen.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER]", error);
        api.fail(String(error?.message || error));
      } finally {
        running = false;
        paused = false;
      }
    });

    log("Watcher controller ready.");
  }

  function workerInit() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const extractFirst = (html, regex) => html.match(regex)?.[1] || "";

    function getPageVars() {
      return window.CCRZ?.pagevars || window.ccrz?.pagevars || window.CCRZ?.PageVars || window.ccrz?.PageVars || {};
    }

    function getContext() {
      const html = document.documentElement.innerHTML;
      const pageVars = getPageVars();
      const csrf = extractFirst(html, /["']csrf["']\s*:\s*["']([^"']+)["']/i);
      const vid = extractFirst(html, /["']vid["']\s*:\s*["']([^"']+)["']/i);
      const authorization = extractFirst(html, /["']authorization["']\s*:\s*["']([^"']+)["']/i);
      const looksLikeCartId = (raw) => {
        const value = String(raw || "").trim();
        if (!value) return false;
        if (/^[a-zA-Z0-9]{15,18}$/.test(value)) return true;
        return /^[a-f0-9-]{32,36}$/i.test(value);
      };
      const scanStorage = (storage) => {
        try {
          for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index);
            if (!key || !key.toLowerCase().includes("cart")) continue;
            const value = storage.getItem(key);
            if (looksLikeCartId(value)) return String(value).trim();
          }
        } catch {}
        return "";
      };
      const cartCandidates = [
        new URL(location.href).searchParams.get("cartId"),
        new URL(location.href).searchParams.get("cartid"),
        pageVars.currentCartId,
        pageVars.cartId,
        pageVars.currentCartID,
        pageVars.currentcartid,
        window.CCRZ?.currentCartId,
        window.ccrz?.currentCartId,
        window.CCRZ?.cartId,
        window.ccrz?.cartId,
        scanStorage(localStorage),
        scanStorage(sessionStorage)
      ];
      const cartId = cartCandidates.find(looksLikeCartId) || "";
      const effAccountId =
        pageVars.effAccountId ||
        extractFirst(html, /CCRZ\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i);

      return {
        csrf,
        vid,
        authorization,
        cartId,
        effAccountId,
        priceGroupId: pageVars.priceGroupId || "",
        portalUserId: pageVars.portalUserId || "",
        storeName: pageVars.storeName || "DefaultStore",
        currSiteURL: pageVars.currSiteURL || `${location.origin}/DefaultStore/`
      };
    }

    function makeInputContext(context, sku) {
      const productUrl = makeProductUrl(context, sku);
      return {
        storefront: context.storeName,
        portalUserId: context.portalUserId,
        effAccountId: context.effAccountId,
        priceGroupId: context.priceGroupId,
        currentCartId: context.cartId,
        userIsoCode: "EUR",
        userLocale: "nl_NL",
        currentPageName: "ccrz__ProductDetails",
        currentPageURL: productUrl,
        queryParams: {
          sku,
          cartId: context.cartId,
          store: context.storeName,
          effectiveAccount: context.effAccountId,
          cclcl: "nl_NL"
        }
      };
    }

    function makeProductUrl(context, sku) {
      return (
        `${context.currSiteURL}ccrz__ProductDetails?sku=${encodeURIComponent(sku)}` +
        `&cartId=${encodeURIComponent(context.cartId)}` +
        `&store=${encodeURIComponent(context.storeName)}` +
        `&effectiveAccount=${encodeURIComponent(context.effAccountId)}` +
        "&cclcl=nl_NL"
      );
    }

    function getCurrentProductDiscount(sku) {
      const product =
        window.CCRZ?.productDetailModel?.attributes?.product ??
        window.ccrz?.productDetailModel?.attributes?.product ??
        null;
      const productBean = product?.prodBean || product;
      const productSku = String(productBean?.SKU || productBean?.sku || productBean?.productId || "").trim();
      if (!productBean || productSku !== String(sku || "").trim()) return {};

      return {
        supplierDiscountPercentage: parseMoney(productBean.discountPercentage)
      };
    }

    function findDiscountPercentage(payload) {
      const seen = new Set();
      const queue = [payload];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);

        if (Object.prototype.hasOwnProperty.call(value, "discountPercentage")) {
          const percentage = parseMoney(value.discountPercentage);
          if (percentage !== null) return { supplierDiscountPercentage: percentage };
        }
        queue.push(...Object.values(value));
      }
      return {};
    }

    function readSupplierRrp(doc) {
      if (!doc) return { value: null, text: "", candidates: [], pageTextMatch: "", labelFound: false };
      const candidates = [
        ...doc.querySelectorAll(".price-pvp .value, .price-pvp .cc_value, .cc_price_block .price-pvp span")
      ].map((node) => String(node.textContent || "").trim()).filter(Boolean);
      const labelledNode = [...doc.querySelectorAll(".cc_label, label, span")].find((node) =>
        /aanbevolen\s+verkoops?prijs/i.test(String(node.textContent || ""))
      );
      const labelledRow = labelledNode?.closest("p, div, li") || null;
      const labelledValue = labelledRow
        ? [...labelledRow.querySelectorAll(".value, .cc_value, span")]
            .map((node) => String(node.textContent || "").trim())
            .find((text) => /[0-9]/.test(text) && !/aanbevolen/i.test(text))
        : "";
      const pageText = String(doc.body?.innerText || doc.documentElement?.textContent || "");
      const pageTextMatch = pageText.match(/aanbevolen\s+verkoops?prijs\s*:?\s*€?\s*([0-9][\d.,]*)/i)?.[1] || "";
      const text = labelledValue || candidates.find((item) => /[0-9]/.test(item)) || pageTextMatch;
      return {
        value: parseMoney(text),
        text,
        candidates: candidates.slice(0, 6),
        pageTextMatch,
        labelFound: Boolean(labelledNode)
      };
    }

    function collectPricingHints(payload, maxItems = 40) {
      const hints = [];
      const seen = new Set();
      const queue = [{ path: "payload", value: payload }];
      while (queue.length && hints.length < maxItems) {
        const { path, value } = queue.shift();
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
          const childPath = `${path}.${key}`;
          if (/discount|promo|price|pvp|retail|advice/i.test(key)) {
            hints.push({ path: childPath, value: typeof child === "object" ? "[object]" : child });
            if (hints.length >= maxItems) break;
          }
          if (child && typeof child === "object") queue.push({ path: childPath, value: child });
        }
      }
      return hints;
    }

    async function fetchDiscountPercentage(context, sku, control = {}) {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;" +
        "pointer-events:none;border:0;";
      iframe.src = makeProductUrl(context, sku);
      document.body.appendChild(iframe);

      try {
        const startedAt = Date.now();
        let lastSeenSku = "";
        let matchedPriceInfo = null;
        let matchedAt = 0;
        while (!control.cancelled && Date.now() - startedAt < 8000) {
          await sleep(150);
          try {
            const product =
              iframe.contentWindow?.CCRZ?.productDetailModel?.attributes?.product ??
              iframe.contentWindow?.ccrz?.productDetailModel?.attributes?.product ??
              null;
            const productBean = product?.prodBean || product;
            const productSku = String(productBean?.SKU || productBean?.sku || productBean?.productId || "").trim();
            if (productSku) lastSeenSku = productSku;
            if (productBean && productSku === String(sku || "").trim()) {
              const percentage = parseMoney(productBean.discountPercentage);
              const rrpInfo = { ...readSupplierRrp(iframe.contentDocument), source: "frame", status: "ok" };
              matchedAt ||= Date.now();
              const supplierRrp = rrpInfo.value;
              matchedPriceInfo = {
                _discountFrameDebug: {
                  status: "match",
                  productSku,
                  percentage,
                  supplierRrp,
                  supplierRrpText: rrpInfo.text,
                  supplierRrpCandidates: rrpInfo.candidates,
                  supplierRrpPageTextMatch: rrpInfo.pageTextMatch,
                  supplierRrpLabelFound: rrpInfo.labelFound,
                  supplierRrpSource: rrpInfo.source,
                  supplierRrpStatus: rrpInfo.status
                },
                ...(percentage === null ? {} : { supplierDiscountPercentage: percentage }),
                ...(supplierRrp === null ? {} : { supplierRrp })
              };
              if (supplierRrp !== null || Date.now() - matchedAt >= 500) {
                log(`[CHANTELLE-DISCOUNT] frame match v${VERSION}`, {
                  sku,
                  percentage,
                  supplierRrp,
                  supplierRrpText: rrpInfo.text,
                  supplierRrpCandidates: rrpInfo.candidates,
                  supplierRrpPageTextMatch: rrpInfo.pageTextMatch,
                  supplierRrpLabelFound: rrpInfo.labelFound,
                  supplierRrpSource: rrpInfo.source,
                  supplierRrpStatus: rrpInfo.status,
                  price: productBean.price ?? product?.price ?? null,
                  label: productBean.discountPercentageLabel ?? null
                });
                return matchedPriceInfo;
              }
            }
          } catch {}
        }
        if (matchedPriceInfo) return matchedPriceInfo;
        log("[CHANTELLE-DISCOUNT] frame geen match", { sku, lastSeenSku, cancelled: Boolean(control.cancelled) });
        return {
          _discountFrameDebug: {
            status: control.cancelled ? "geannuleerd" : "geen match",
            lastSeenSku
          }
        };
      } finally {
        iframe.remove();
      }
    }

    async function callRemote(controllerName, methodName, args, timeoutMs = 60000) {
      let controller;
      for (let index = 0; index < 60; index++) {
        const root = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        controller = root?.[controllerName];
        if (typeof controller?.[methodName] === "function") break;
        await sleep(200);
      }
      if (typeof controller?.[methodName] !== "function") {
        throw new Error(`Chantelle remote functie ontbreekt: ${controllerName}.${methodName}`);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Chantelle remote timeout.")), timeoutMs);
        const callback = (result, event) => {
          clearTimeout(timer);
          if (event?.status) resolve(result);
          else reject(new Error(event?.message || "Chantelle remote call mislukt."));
        };
        controller[methodName](...args, callback, { escape: false });
      });
    }

    function sizeFromInfo(outerKey, info) {
      const label = String(info?.translatedProductSKU || info?.productSKU || info?.label || "").trim();
      return normalizeSizeKey(label ? label.split(/\s+/).pop() : outerKey);
    }

    function parseStockMap(payload) {
      const stockData = payload?.stockData || {};
      const output = {};
      const orderableStockValue = (raw) => {
        const value = String(raw ?? "").trim();
        if (!value || value === "-" || value === "\u2014") return "";
        if (value.includes("<") || value.includes(">") || value.includes("+")) return value;
        const number = Number(value.replace(",", "."));
        return Number.isFinite(number) && number > 0 ? value : "";
      };

      if (stockData.values && typeof stockData.values === "object") {
        for (const [outerKey, info] of Object.entries(stockData.values)) {
          const key = sizeFromInfo(outerKey, info);
          const stock = orderableStockValue(info?.stockValue);
          if (isSizeLabel(key) && stock) output[key] = stock;
        }
        return output;
      }

      for (const [cupKey, cupObject] of Object.entries(stockData)) {
        const cupRaw = String(cupObject?.cupsize || cupKey || "").trim().toUpperCase().replace(/\s+/g, "");
        const cup = /^[A-Z]{2}$/.test(cupRaw) && cupRaw[0] !== cupRaw[1]
          ? `${cupRaw[0]}/${cupRaw[1]}`
          : cupRaw;
        const dummyCup = !cup || cup === "-" || cup === "\u2014";

        for (const [bandKey, info] of Object.entries(cupObject?.values || {})) {
          const band = dummyCup ? sizeFromInfo(bandKey, info) : normalizeSizeKey(bandKey);
          const key = dummyCup ? band : normalizeSizeKey(`${band}${cup}`);
          const stock = orderableStockValue(info?.stockValue);
          if (isSizeLabel(key) && stock) output[key] = stock;
        }
      }
      return output;
    }

    async function fetchStock(context, sku) {
      const price =
        window.CCRZ?.productDetailModel?.attributes?.product?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.price ??
        window.CCRZ?.productDetailModel?.attributes?.product?.prodBean?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.prodBean?.price ??
        "0";
      const response = await callRemote(
        "ccCLProductMatrixRCBTCtrl",
        "getStock",
        [makeInputContext(context, sku), null, String(price), {}, false, false, false]
      );
      const payload = response?.data || response;
      if (!payload?.stockData) throw new Error(`Geen Chantelle-stockdata ontvangen voor ${sku}.`);
      return payload;
    }

    async function fetchSupplierPricing(context, sku) {
      const root = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      log(`[CHANTELLE-PRICING] rpc poging v${VERSION}`, {
        sku,
        functionLength: root?.ccCLProductMatrixRCBTCtrl?.getProductImageInfoBySKU?.length ?? null
      });
      const response = await callRemote(
        "ccCLProductMatrixRCBTCtrl",
        "getProductImageInfoBySKU",
        [makeInputContext(context, sku), [sku]],
        2500
      );
      const payload = response?.data || response;
      const product = (payload?.resProductList || []).find((item) =>
        String(item?.SKU || item?.sku || item?.productId || "").trim() === sku
      ) || payload?.resProductList?.[0] || {};
      const productPrice = Object.values(payload?.resPricingData || {})
        .map((item) => item?.productPrice)
        .find(Boolean) || {};
      const supplierRrp = parseMoney(productPrice.NewPrice);
      const supplierDiscountPercentage = parseMoney(product.discountPercentage);
      log(`[CHANTELLE-PRICING] rpc match v${VERSION}`, {
        sku,
        supplierRrp,
        supplierDiscountPercentage,
        purchasePrice: productPrice.price ?? product.price ?? null
      });
      return {
        ...(supplierRrp === null ? {} : { supplierRrp }),
        ...(supplierDiscountPercentage === null ? {} : { supplierDiscountPercentage }),
        _pricingRpcDebug: {
          status: "match",
          supplierRrp,
          supplierDiscountPercentage,
          purchasePrice: productPrice.price ?? product.price ?? null
        }
      };
    }

    async function handleJob(job) {
      if (!job?.id) return;
      try {
        let context = getContext();
        if (!context.effAccountId) {
          await sleep(800);
          context = getContext();
        }
        if (!context.csrf || !context.vid || !context.authorization) {
          throw new Error("Open een ingelogde Chantelle-productpagina en ververs die eenmalig.");
        }
        if (!context.effAccountId) throw new Error("Chantelle-accountcontext ontbreekt. Open een Chantelle-productpagina.");
        if (!context.cartId) throw new Error("Chantelle-winkelwagencontext ontbreekt. Open een Chantelle-productpagina.");

        const sku = String(job.sku || "").trim();
        const pricingPromise = job.remoteDiscount
          ? fetchSupplierPricing(context, sku).catch((error) => {
              log(`[CHANTELLE-PRICING] rpc overgeslagen v${VERSION}`, { sku, error: String(error?.message || error) });
              return {};
            })
          : Promise.resolve({});
        let stockPayload;
        try {
          stockPayload = await fetchStock(context, sku);
        } catch (error) {
          throw error;
        }
        const priceInfo = job.remoteDiscount
          ? {
              ...findDiscountPercentage(stockPayload),
              ...getCurrentProductDiscount(sku),
              ...await pricingPromise
            }
          : {};
        const discountDebug = {
          gevonden: priceInfo.supplierDiscountPercentage ?? null,
          frame: priceInfo._discountFrameDebug ?? null,
          rpc: priceInfo._pricingRpcDebug ?? null,
          stockHints: collectPricingHints(stockPayload)
        };
        delete priceInfo._discountFrameDebug;
        delete priceInfo._pricingRpcDebug;
        if (job.remoteDiscount) {
          log("[CHANTELLE-DISCOUNT] samenvatting", {
            sku,
            ...discountDebug
          });
        }
        const stockMap = parseStockMap(stockPayload);
        const localSizes = new Set((job.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
        const missingSizes = Object.entries(stockMap)
          .filter(([size]) => !localSizes.has(size))
          .map(([size, stock]) => ({ size, stock }));
        GM_setValue(RESP_PREFIX + job.id, {
          ok: true,
          stockMap,
          stockSizesTotal: Object.keys(stockMap).length,
          missingSizes,
          discountDebug,
          ...priceInfo
        });
      } catch (error) {
        console.error("[BRANDS-WATCHER] Chantelle worker error", error);
        GM_setValue(RESP_PREFIX + job.id, { ok: false, error: String(error?.message || error) });
      }
    }

    GM_addValueChangeListener(JOB_KEY, (_key, _old, job) => handleJob(job));
    const existing = GM_getValue(JOB_KEY, null);
    if (existing?.id) handleJob(existing);
    const signalReady = () => GM_setValue(WORKER_READY_KEY, Date.now());
    signalReady();
    setInterval(signalReady, 5000);
    log("Chantelle worker ready.");
    console.log(`[BRANDS-WATCHER] Chantelle-worker actief: v${VERSION}`);
  }

  if (isWatcher) watcherInit();
  if (isChantelle) workerInit();
  console.log(`[BRANDS-WATCHER] Userscript geladen: v${VERSION} | ${location.hostname}`);
})();
