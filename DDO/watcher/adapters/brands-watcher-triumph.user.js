// ==UserScript==
// @name         DDO | Brands Watcher - Triumph & Sloggi
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.2.0
// @description  Vergelijkt Triumph- en Sloggi-producten exact op stijl, kleur, maten, RSP en expliciete korting via de ingelogde B2B-bridge.
// @match        https://lingerieoutlet.nl/tools/watcher/brands.html*
// @match        https://b2b.triumph.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-triumph.user.js?v=0.2.0
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-triumph.user.js?v=0.2.0
// @run-at       document-start
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.2.0";
  const SUPPORTED_BRANDS = new Set(["Triumph", "Sloggi"]);
  const DEFAULT_EXPORT_TAG_ID = "221";
  const TIMEOUT_MS = 30000;
  const HEARTBEAT_KEY = "brands_watcher_triumph_heartbeat_v1";
  const SESSION_KEY = "brands_watcher_triumph_session_v1";
  const REQUEST_KEY = "brands_watcher_triumph_request_v1";
  const RESPONSE_KEY = "brands_watcher_triumph_response_v1";
  const ON_WATCHER = location.hostname === "lingerieoutlet.nl" || location.hostname === "127.0.0.1";
  const ON_TRIUMPH = location.hostname === "b2b.triumph.com";
  const log = (...args) => console.log("[BRANDS-WATCHER][TRIUMPH]", ...args);

  function uniqueRequestId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function extractApiContext(url) {
    const match = String(url || "").match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    return match ? { webstoreId: match[1], cartId: match[2] } : {};
  }

  function extractAuthorization(headers) {
    if (!headers) return "";
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get("Authorization") || headers.get("authorization") || "";
    }
    if (Array.isArray(headers)) {
      const pair = headers.find(([name]) => /^authorization$/i.test(String(name)));
      return pair ? String(pair[1] || "") : "";
    }
    if (typeof headers === "object") {
      const key = Object.keys(headers).find((name) => /^authorization$/i.test(name));
      return key ? String(headers[key] || "") : "";
    }
    return "";
  }

  function initTriumphBridge() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    let pageFetch = typeof page.fetch === "function" ? page.fetch.bind(page) : null;

    function storeSession(auth, url, source) {
      const authorization = String(auth || "").trim();
      if (!/^bearer\s+\S+/i.test(authorization)) return;
      const previous = GM_getValue(SESSION_KEY, {}) || {};
      const context = extractApiContext(url);
      const session = {
        authorization,
        webstoreId: context.webstoreId || previous.webstoreId || "",
        cartId: context.cartId || previous.cartId || "",
        capturedAt: Date.now()
      };
      GM_setValue(SESSION_KEY, session);
      log(`Triumph-sessie vastgelegd via ${source}.`, {
        webstoreId: session.webstoreId,
        cartId: session.cartId
      });
    }

    if (pageFetch) {
      const originalFetch = page.fetch;
      page.fetch = function patchedFetch(input, init = {}) {
        try {
          const url = typeof input === "string" ? input : input?.url || "";
          const auth = extractAuthorization(init.headers || input?.headers);
          if (auth) storeSession(auth, url, "fetch");
        } catch (error) {
          console.warn("[BRANDS-WATCHER][TRIUMPH] Fetch-hook kon sessie niet lezen.", error);
        }
        return originalFetch.apply(this, arguments);
      };
      pageFetch = originalFetch.bind(page);
    }

    const xhrPrototype = page.XMLHttpRequest?.prototype;
    if (xhrPrototype) {
      const originalOpen = xhrPrototype.open;
      const originalSetRequestHeader = xhrPrototype.setRequestHeader;
      xhrPrototype.open = function patchedOpen(method, url) {
        this.__brandsWatcherTriumphUrl = String(url || "");
        return originalOpen.apply(this, arguments);
      };
      xhrPrototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
        try {
          if (/^authorization$/i.test(String(name))) {
            storeSession(value, this.__brandsWatcherTriumphUrl, "XHR");
          }
        } catch (error) {
          console.warn("[BRANDS-WATCHER][TRIUMPH] XHR-hook kon sessie niet lezen.", error);
        }
        return originalSetRequestHeader.apply(this, arguments);
      };
    }

    async function fetchExactGrid(styleId) {
      const session = GM_getValue(SESSION_KEY, null);
      if (!session?.authorization || !session.webstoreId || !session.cartId) {
        throw new Error("Triumph-sessie incompleet. Open een ingelogd Triumph-product en wissel eenmaal van kleur of maat.");
      }
      if (!/^\d+$/.test(styleId)) throw new Error(`Ongeldige Triumph-stijl: ${styleId}`);
      const url = `https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(session.webstoreId)}` +
        `/carts/${encodeURIComponent(session.cartId)}/grid/${encodeURIComponent(styleId)}/products`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await (pageFetch || page.fetch.bind(page))(url, {
          method: "GET",
          headers: { Authorization: session.authorization, Accept: "application/json" },
          credentials: "include",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Triumph API gaf HTTP ${response.status}.`);
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    }

    GM_addValueChangeListener(REQUEST_KEY, (_name, _oldValue, request) => {
      if (!request?.id || !request?.styleId) return;
      (async () => {
        try {
          const text = await fetchExactGrid(String(request.styleId));
          GM_setValue(RESPONSE_KEY, { id: request.id, ok: true, text });
        } catch (error) {
          GM_setValue(RESPONSE_KEY, { id: request.id, ok: false, error: String(error?.message || error) });
        }
      })();
    });

    const heartbeat = () => GM_setValue(HEARTBEAT_KEY, Date.now());
    heartbeat();
    setInterval(heartbeat, 2500);
    log(`Triumph-bridge actief: v${VERSION}`);
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
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    let value = String(raw ?? "").trim().replace(/[^\d,.-]/g, "");
    if (!value) return null;
    if (value.includes(",") && value.includes(".")) value = value.replace(/\./g, "").replace(",", ".");
    else value = value.replace(",", ".");
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeExactSize(raw) {
    return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
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

  function readProducts(buffer, brand) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const rows = sourceRows.map((source) => Object.fromEntries(
      Object.entries(source || {}).map(([key, value]) => [normalizeHeader(key), value])
    ));
    const aliases = {
      supplierId: ["product id", "product_id", "supplier_pid", "supplier pid", "supplier sku", "leveranciersartikelnummer", "leverancier artikelnummer", "sku"],
      id: ["product_id", "product id", "id"],
      name: ["model", "product_name", "product name", "name", "naam", "title"],
      size: ["size", "maat", "option", "option name", "attribute", "attribute value", "value"],
      ownPrice: ["price", "prijs", "selling price", "verkoopprijs"],
      ownRrp: ["advice price", "rrp", "adviesprijs", "recommended retail price", "old price", "price old"]
    };
    const groups = new Map();
    for (const row of rows) {
      const supplierId = String(firstValue(row, aliases.supplierId)).trim();
      if (!supplierId) continue;
      const match = supplierId.match(/^(\d+)-([0-9A-Z]{3,4})$/i);
      if (!match) continue;
      const exactSupplierId = `${match[1]}-${match[2].toUpperCase()}`;
      if (!groups.has(exactSupplierId)) {
        groups.set(exactSupplierId, {
          brand,
          productId: exactSupplierId,
          warehouseId: String(row.productid1 || firstValue(row, aliases.id) || "").match(/\d{5}/)?.[0] || "",
          productName: String(firstValue(row, aliases.name)).trim(),
          sku: exactSupplierId,
          sizes: [],
          ownPrice: parseMoney(firstValue(row, aliases.ownPrice)),
          ownRrp: parseMoney(firstValue(row, aliases.ownRrp))
        });
      }
      const size = normalizeExactSize(firstValue(row, aliases.size));
      if (size && !groups.get(exactSupplierId).sizes.includes(size)) groups.get(exactSupplierId).sizes.push(size);
    }
    if (!groups.size) {
      const headers = Object.keys(sourceRows[0] || {}).join(", ");
      throw new Error(`Geen exacte Triumph Supplier ID's in vorm STIJL-KLEUR gevonden. Kolommen: ${headers || "geen"}`);
    }
    return [...groups.values()];
  }

  function bridgeReady() {
    const heartbeat = Number(GM_getValue(HEARTBEAT_KEY, 0));
    const session = GM_getValue(SESSION_KEY, null);
    return heartbeat > 0 && Date.now() - heartbeat < 6000 &&
      Boolean(session?.authorization && session.webstoreId && session.cartId);
  }

  function requestGrid(styleId) {
    return new Promise((resolve, reject) => {
      const id = uniqueRequestId();
      let settled = false;
      const listener = GM_addValueChangeListener(RESPONSE_KEY, (_name, _oldValue, response) => {
        if (response?.id !== id || settled) return;
        settled = true;
        clearTimeout(timer);
        try { GM_removeValueChangeListener(listener); } catch {}
        if (!response.ok) return reject(new Error(response.error || "Triumph-bridge gaf een onbekende fout."));
        try { resolve(JSON.parse(response.text)); }
        catch { reject(new Error("Triumph API gaf geen geldige JSON.")); }
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { GM_removeValueChangeListener(listener); } catch {}
        reject(new Error("Triumph-bridge timeout."));
      }, TIMEOUT_MS + 2000);
      GM_setValue(REQUEST_KEY, { id, styleId, requestedAt: Date.now() });
    });
  }

  function exactProductIdentity(productId) {
    const match = String(productId || "").trim().match(/^(\d+)-([0-9A-Z]{3,4})$/i);
    if (!match) throw new Error(`Supplier ID is niet exact STIJL-KLEUR: ${productId}`);
    return { styleId: match[1], colorCode: match[2].toUpperCase().padStart(4, "0") };
  }

  function responseProducts(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.products)) return payload.products;
    throw new Error("Triumph API-antwoord bevat geen productlijst.");
  }

  function exactProductFromGrid(payload, identity) {
    const matches = responseProducts(payload).filter((product) =>
      String(product?.uniqueId ?? "").trim() === identity.styleId &&
      String(product?.colorCode ?? "").trim().toUpperCase().padStart(4, "0") === identity.colorCode
    );
    if (matches.length !== 1) {
      throw new Error(matches.length
        ? `Exacte Triumph-match is niet uniek voor ${identity.styleId}-${identity.colorCode}: ${matches.length} resultaten.`
        : `Geen exacte Triumph-match voor ${identity.styleId}-${identity.colorCode}.`);
    }
    return matches[0];
  }

  function skuSize(sku) {
    const size = String(sku?.sizeDisplayName ?? "").trim();
    const subSize = String(sku?.subSizeDisplayName ?? "").trim();
    return normalizeExactSize(`${size}${subSize}`);
  }

  function stockForSku(sku) {
    if (!Array.isArray(sku?.stockLevels)) throw new Error(`Stocklevels ontbreken voor SKU ${sku?.eanCode || "zonder EAN"}.`);
    return sku.stockLevels.reduce((total, level) => {
      const value = level?.remainingQuantity ?? level?.quantity;
      const quantity = Number(value);
      if (!Number.isFinite(quantity)) throw new Error(`Ongeldige voorraad voor SKU ${sku?.eanCode || "zonder EAN"}.`);
      return total + Math.max(0, quantity);
    }, 0);
  }

  function exactSingleValue(values, field, productId, allowEmpty = false) {
    const distinct = [...new Set(values.filter((value) =>
      value !== null && value !== undefined && (allowEmpty || value !== "")
    ))];
    if (distinct.length !== 1) {
      throw new Error(`${field} is niet exact en eenduidig voor ${productId}: ${distinct.length} waarden.`);
    }
    return distinct[0];
  }

  function parseExactDiscount(description, productId) {
    const text = String(description || "").trim();
    if (!text) return { description: "", percentage: 0 };
    const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)];
    if (matches.length !== 1) throw new Error(`Triumph-korting is niet exact numeriek voor ${productId}: ${text}`);
    return { description: text, percentage: Number(matches[0][1].replace(",", ".")) };
  }

  function productData(product, productId) {
    if (!Array.isArray(product?.skus) || !product.skus.length) throw new Error(`Triumph-product ${productId} bevat geen SKU's.`);
    const variants = product.skus.map((sku) => {
      const size = skuSize(sku);
      if (!size) throw new Error(`Expliciete Triumph-maat ontbreekt voor SKU ${sku?.eanCode || "zonder EAN"}.`);
      const pricing = sku?.price?.unitPricing;
      if (!pricing) throw new Error(`Expliciete SKU-prijs ontbreekt voor maat ${size}.`);
      const rsp = parseMoney(pricing.retailPrice);
      if (rsp === null) throw new Error(`Ongeldige RSP voor maat ${size}.`);
      const wholesale = parseMoney(pricing.customerWholesalePrice);
      const discountDescription = String(sku?.price?.appliedDiscountGroup?.description || "").trim();
      return {
        size,
        ean: String(sku?.eanCode || ""),
        stock: stockForSku(sku),
        rsp,
        wholesale,
        discountDescription
      };
    });
    const rsp = exactSingleValue(variants.map((variant) => variant.rsp), "RSP", productId);
    const discountDescription = exactSingleValue(
      variants.map((variant) => variant.discountDescription),
      "kortingsomschrijving",
      productId,
      true
    );
    const discount = parseExactDiscount(discountDescription, productId);
    const wholesaleValues = variants.map((variant) => variant.wholesale).filter((value) => value !== null);
    const wholesale = wholesaleValues.length
      ? exactSingleValue(wholesaleValues, "groothandelsprijs", productId)
      : null;
    return { variants, rsp, wholesale, discount };
  }

  async function initWatcher() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    while (!page.BrandsWatcher) await new Promise((resolve) => setTimeout(resolve, 50));
    const api = page.BrandsWatcher;
    let products = [];
    let running = false;
    let paused = false;

    api.registerAdapter({
      id: "brands-watcher-triumph",
      name: "DDO | Brands Watcher - Triumph & Sloggi",
      version: VERSION,
      downloadURL: "https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/watcher/adapters/brands-watcher-triumph.user.js"
    });
    log(`Controller actief: v${VERSION}`);

    page.addEventListener("brands-watcher:load-ddo", async (event) => {
      const brand = String(event.detail?.brand || "");
      if (!SUPPORTED_BRANDS.has(brand)) return;
      try {
        const tagId = String(event.detail?.tagId || DEFAULT_EXPORT_TAG_ID);
        api.progress(`DDO-export voor ${brand} ophalen...`);
        products = readProducts(await fetchDdoExport(tagId), brand);
        api.setInventory(products, `DDO-tabel ingelezen: ${products.length} ${brand}-producten.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][TRIUMPH]", error);
        api.fail(String(error?.message || error));
      }
    });

    page.addEventListener("brands-watcher:inventory-loaded", (event) => {
      if (!Array.isArray(event.detail?.products)) return;
      products = event.detail.products.filter((product) => SUPPORTED_BRANDS.has(product.brand));
    });

    page.addEventListener("brands-watcher:pause", (event) => {
      paused = Boolean(event.detail?.paused);
    });

    const waitWhilePaused = () => new Promise((resolve) => {
      const tick = () => paused ? setTimeout(tick, 250) : resolve();
      tick();
    });

    async function checkProduct(product) {
      const identity = exactProductIdentity(product.productId);
      const exactProduct = exactProductFromGrid(await requestGrid(identity.styleId), identity);
      const remote = productData(exactProduct, product.productId);
      const localSizes = new Set((product.sizes || []).map(normalizeExactSize).filter(Boolean));
      const remoteOrderable = remote.variants.filter((variant) => variant.stock > 0);
      const missingSizes = remoteOrderable
        .filter((variant) => !localSizes.has(variant.size))
        .map((variant) => ({ size: variant.size, stock: variant.stock }));
      const notOrderable = remoteOrderable.length === 0;
      log("Exacte match", {
        productId: product.productId,
        uniqueId: exactProduct.uniqueId,
        colorCode: exactProduct.colorCode,
        variants: remote.variants.length,
        orderable: remoteOrderable.length,
        rsp: remote.rsp,
        discount: remote.discount.description || "geen"
      });
      return {
        ...product,
        checkStatus: "checked",
        missingSizes,
        supplierRrp: remote.rsp,
        supplierPurchasePrice: remote.wholesale,
        supplierDiscountPercentage: remote.discount.percentage,
        notOrderable,
        messages: notOrderable ? [`Niet bestelbaar: geen ${product.brand}-variant met voorraad voor ${product.productId}.`] : []
      };
    }

    async function runOne(product) {
      try {
        api.addResult(await checkProduct(product));
        return true;
      } catch (error) {
        api.addResult({
          ...product,
          checkStatus: "skipped",
          messages: [`${product.brand} overgeslagen: ${String(error?.message || error)}`]
        });
        return false;
      }
    }

    page.addEventListener("brands-watcher:retry", async (event) => {
      const product = products.find((item) => String(item.productId) === String(event.detail?.productId || ""));
      if (!product || !SUPPORTED_BRANDS.has(product.brand)) return;
      api.progress(`${product.brand} opnieuw controleren: ${product.productId}`);
      const ok = await runOne(product);
      api.complete(ok ? "Product opnieuw gecontroleerd." : "Product opnieuw overgeslagen.");
    });

    page.addEventListener("brands-watcher:start", async (event) => {
      const selectedBrand = String(event.detail?.brand || "");
      if (!SUPPORTED_BRANDS.has(selectedBrand) || running) return;
      if (!bridgeReady()) {
        api.fail("Triumph-bridge niet gereed. Open een ingelogd Triumph-product en wissel eenmaal van kleur of maat.");
        return;
      }
      running = true;
      paused = false;
      try {
        const pending = products.filter((product) =>
          product.brand === selectedBrand && !["checked", "skipped"].includes(product.checkStatus)
        );
        if (!pending.length) return api.complete(`Geen openstaande ${selectedBrand}-producten om te controleren.`);
        let failed = 0;
        for (let index = 0; index < pending.length; index++) {
          await waitWhilePaused();
          api.progress(`${selectedBrand} controleren: ${index + 1}/${pending.length} | ${pending[index].productId}`);
          if (!await runOne(pending[index])) failed++;
        }
        api.complete(`Controle afgerond: ${pending.length - failed} exact verwerkt, ${failed} overgeslagen.`);
      } catch (error) {
        console.error("[BRANDS-WATCHER][TRIUMPH]", error);
        api.fail(String(error?.message || error));
      } finally {
        running = false;
        paused = false;
      }
    });
  }

  if (ON_TRIUMPH) initTriumphBridge();
  else if (ON_WATCHER) initWatcher();
})();
