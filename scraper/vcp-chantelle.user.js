// ==UserScript==
// @name         EAN Scraper | Chantelle
// @version      0.5
// @description  One-script bridge: Controller on DDO admin sends jobs; Worker on Chantelle executes apexremote same-origin and returns stock+EAN. Shared GM storage. Hotkeys + autosave. Logs combined mapping table (remote stock + local + EAN).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @author       C. P. v. Beek + GPT
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-chantelle.user.js
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = true;
  const log = (...a) => DEBUG && console.log("[CHANTELLE-BRIDGE]", ...a);

  const JOB_KEY = "CHANTELLE_BRIDGE_JOB_V1";
  const RESP_PREFIX = "CHANTELLE_BRIDGE_RESP_V1_";

  const isDDO = location.hostname.includes("dutchdesignersoutlet.com");
  const isCHANTELLE = location.hostname.includes("chantelle-lingerie.my.site.com");

  const normSize = (raw) => String(raw || "").toUpperCase().replace(/\s+/g, "").trim();
  const isBraSizeLabel = (s) => /^\d{2,3}[A-Z]{1,4}$/.test(normSize(s));
  const extractFirst = (html, re) => (html.match(re)?.[1] || "");

  /******************************************************************
   * CONTROLLER (DDO)
   ******************************************************************/
  function controllerInit() {
    const SEL = {
      tab3: "#tabs-3",
      supplierPid: '#tabs-1 input[name="supplier_pid"]',
      sizeCell: "td:first-child",
      eanInput: 'input[name^="options"][name$="[barcode]"]',
      stockInput: 'input[name^="options"][name$="[stock]"]'
    };

    // ✅ mapping zoals jij wil:
    // remote <3  -> local 1
    // remote 3   -> local 2
    // remote 4   -> local 3
    // remote 5   -> local 4
    // remote >5  -> local 5
    function remoteQtyToLocalStockLevel(remoteVal) {
      const raw = String(remoteVal ?? "").trim();
      if (!raw || raw === "-" || raw === " - ") return 0;

      if (raw.includes("<")) return 1;
      if (raw.includes(">") || raw.includes("+")) return 5;

      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return 0;

      if (n < 3) return 1;
      if (n === 3) return 2;
      if (n === 4) return 3;
      if (n === 5) return 4;
      return 5;
    }

    function isTypingTarget(ev) {
      const t = ev.target;
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function getBaseSkuFromAdmin() {
      return document.querySelector(SEL.supplierPid)?.value?.trim() || "";
    }

    function readSizesFromTab3(tab3) {
      const out = [];
      for (const row of tab3.querySelectorAll("table.options tr")) {
        const cell = row.querySelector(SEL.sizeCell);
        if (!cell) continue;
        const sizeEl = cell.querySelector("input,select") || cell;
        const raw = (sizeEl?.value ?? sizeEl?.textContent ?? "").trim();
        const key = normSize(raw);
        if (key) out.push(key);
      }
      return [...new Set(out)];
    }

    // ✅ Eén gecombineerde tabel: remote + local + EAN (mapLog bestaat ALTIJD hier)
    function pasteIntoTab3(tab3, stockMap, eanMap, { doEan = true, doStock = true } = {}) {
      let matchedEan = 0;
      let matchedStock = 0;

      const mapLog = [];

      for (const row of tab3.querySelectorAll("table.options tr")) {
        const cell = row.querySelector(SEL.sizeCell);
        if (!cell) continue;

        const sizeEl = cell.querySelector("input,select") || cell;
        const raw = (sizeEl?.value ?? sizeEl?.textContent ?? "").trim();
        const key = normSize(raw);
        if (!key) continue;

        const remote = doStock ? (stockMap?.[key] ?? "") : "";
const ean = doEan ? (eanMap?.[key] ?? "") : "";

// ✅ als remote leeg is maar ean bestaat: behandel als minimale voorraad (1)
let local = doStock ? remoteQtyToLocalStockLevel(remote) : "";
if (doStock && (!String(remote).trim()) && String(ean).trim()) {
  local = 1;
}


        mapLog.push({
          size: key,
          remote: String(remote ?? ""),
          local: local === "" ? "" : Number(local),
          ean: String(ean ?? "")
        });

        if (doEan) {
          const eanInput = row.querySelector(SEL.eanInput);
          if (eanInput && ean) {
            eanInput.value = String(ean);
            eanInput.dispatchEvent(new Event("input", { bubbles: true }));
            matchedEan++;
          }
        }

        if (doStock) {
          const stockInput = row.querySelector(SEL.stockInput);
          if (stockInput && Number(local) > 0) {
            stockInput.value = String(local);
            stockInput.dispatchEvent(new Event("input", { bubbles: true }));
            matchedStock++;
          }
        }
      }

const hasData = (r) => {
  const remote = String(r.remote ?? "").trim();
  const ean = String(r.ean ?? "").trim();
  const local = Number(r.local || 0);

  // “data” = remote gevuld (ook "<3", ">5", "3" etc) OF ean gevuld OF local > 0
  return !!remote || !!ean || local > 0;
};

const filtered = mapLog.filter(hasData);

if (filtered.length) {
  console.log(`[CHANTELLE-DDO] Mapping (alleen maten met data): ${filtered.length}/${mapLog.length}`);
  console.table(filtered);
} else if (mapLog.length) {
  console.log("[CHANTELLE-DDO] Geen maten met data om te loggen.");
}


      return { matchedEan, matchedStock };
    }

    function findUpdateProductButton() {
      return document.querySelector('input[type="submit"][name="edit"][value="Update product"]');
    }
    function autoSaveProduct() {
      const btn = findUpdateProductButton();
      if (!btn) return false;
      btn.click();
      return true;
    }

    function buildBtn() {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Scrape Chantelle";
      b.style.cssText =
        "position:fixed;right:10px;top:10px;z-index:9999;padding:10px 12px;" +
        "background:#333;color:#fff;border:none;border-radius:8px;font-weight:600;" +
        "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.15);";
      return b;
    }
    function setBtn(b, ok, msg, ms = 2400) {
      b.textContent = msg;
      b.style.background = ok ? "#2ecc71" : "#e06666";
      if (ms) setTimeout(() => {
        b.style.background = "#333";
        b.textContent = "Scrape Chantelle";
      }, ms);
    }

    function waitForResponse(jobId, timeoutMs = 45000) {
      return new Promise((resolve, reject) => {
        const respKey = RESP_PREFIX + jobId;

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout waiting for Chantelle Worker response. Open a Chantelle PDP tab (same browser) and refresh once."));
        }, timeoutMs);

        const stop = GM_addValueChangeListener(respKey, (_k, _old, val) => {
          cleanup();
          resolve(val);
        });

        const cleanup = () => {
          clearTimeout(timer);
          try { stop(); } catch {}
        };

        const existing = GM_getValue(respKey, null);
        if (existing) {
          cleanup();
          resolve(existing);
        }
      });
    }

    async function run({ mode = "all", autosave = false } = {}) {
      const tab3 = document.querySelector(SEL.tab3);
      if (!tab3) throw new Error("tab #tabs-3 niet gevonden");

      const baseSku = getBaseSkuFromAdmin();
      if (!baseSku) throw new Error("Geen supplier_pid / SKU");

      const sizes = readSizesFromTab3(tab3);
      const jobId = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const job = { id: jobId, sku: baseSku, mode, sizes, createdAt: Date.now() };

      GM_setValue(JOB_KEY, job);
      log("[DDO] Job sent:", job);

      const resp = await waitForResponse(jobId);
      if (!resp?.ok) throw new Error(resp?.error || "Worker error (unknown)");

      if (resp?.meta) console.log("[CHANTELLE-DDO] meta:", resp.meta);

      const doEan = (mode === "all" || mode === "ean");
      const doStock = (mode === "all" || mode === "stock");

      const res = pasteIntoTab3(tab3, resp.stockMap || {}, resp.eanMap || {}, { doEan, doStock });
      const ok = (res.matchedEan + res.matchedStock) > 0;

      if (autosave && ok) autoSaveProduct();
      return { ok, ...res };
    }

    function init() {
      const tab3 = document.querySelector(SEL.tab3);
      if (!tab3) return;

      const btn = buildBtn();
      tab3.prepend(btn);

      btn.addEventListener("click", async () => {
        try {
          setBtn(btn, true, "⏳ Scrapen…", 0);
          const r = await run({ mode: "all", autosave: false });
          setBtn(btn, r.ok, `✅ EAN: ${r.matchedEan} | Stock: ${r.matchedStock}`);
        } catch (e) {
          console.error(e);
          setBtn(btn, false, "❌ Timeout/Worker?");
        }
      });

      window.addEventListener("keydown", async (ev) => {
        if (!document.querySelector(SEL.tab3)) return;
        if (isTypingTarget(ev)) return;

        const k = ev.key.toLowerCase();

        try {
          if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "a") {
            ev.preventDefault();
            setBtn(btn, true, "⏳ All+Save…", 0);
            const r = await run({ mode: "all", autosave: true });
            setBtn(btn, r.ok, `✅ EAN: ${r.matchedEan} | Stock: ${r.matchedStock}`);
            return;
          }
          if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "s") {
            ev.preventDefault();
            setBtn(btn, true, "⏳ Stock…", 0);
            const r = await run({ mode: "stock", autosave: false });
            setBtn(btn, r.ok, `✅ Stock: ${r.matchedStock}`);
            return;
          }
          if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "e") {
            ev.preventDefault();
            setBtn(btn, true, "⏳ EAN…", 0);
            const r = await run({ mode: "ean", autosave: false });
            setBtn(btn, r.ok, `✅ EAN: ${r.matchedEan}`);
            return;
          }
        } catch (e) {
          console.error(e);
          setBtn(btn, false, "❌ Timeout/Worker?");
        }
      }, true);

      log("[DDO] Controller ready.");
    }

    window.addEventListener("load", () => setTimeout(init, 600));
  }

  /******************************************************************
   * WORKER (CHANTELLE)
   ******************************************************************/
  function workerInit() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function getAnyPageVars() {
      return (
        window.CCRZ?.pagevars ||
        window.ccrz?.pagevars ||
        window.CCRZ?.PageVars ||
        window.ccrz?.PageVars ||
        {}
      );
    }

    function parsePagevarsFromHtml(html) {
      const eff =
        extractFirst(html, /CCRZ\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) ||
        "";

      const pg =
        extractFirst(html, /CCRZ\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) ||
        "";

      const pu =
        extractFirst(html, /CCRZ\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) ||
        "";

      const storeName =
        extractFirst(html, /CCRZ\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) ||
        "DefaultStore";

      const sitePrefix =
        extractFirst(html, /CCRZ\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) ||
        "/DefaultStore";

      const currSiteURL =
        extractFirst(html, /CCRZ\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i) ||
        (location.origin + sitePrefix + "/");

      return { eff, pg, pu, storeName, sitePrefix, currSiteURL };
    }

function getCtxFromCurrentPage() {
  const html = document.documentElement.innerHTML;

  const csrf = extractFirst(html, /["']csrf["']\s*:\s*["']([^"']+)["']/i);
  const vid = extractFirst(html, /["']vid["']\s*:\s*["']([^"']+)["']/i);
  const authorization = extractFirst(html, /["']authorization["']\s*:\s*["']([^"']+)["']/i);
  const verStr = extractFirst(html, /["']ver["']\s*:\s*(\d{1,3})/i);
  const ns = extractFirst(html, /["']ns["']\s*:\s*["']([^"']*)["']/i);

  const pv = getAnyPageVars();

  let effAccountId = pv.effAccountId || "";
  let priceGroupId = pv.priceGroupId || "";
  let portalUserId = pv.portalUserId || "";
  let storeName = pv.storeName || "DefaultStore";
  let sitePrefix = pv.sitePrefix || "/DefaultStore";
  let currSiteURL = pv.currSiteURL || (location.origin + sitePrefix + "/");

  if (!effAccountId) {
    const parsed = parsePagevarsFromHtml(html);
    effAccountId = parsed.eff || effAccountId;
    priceGroupId = priceGroupId || parsed.pg;
    portalUserId = portalUserId || parsed.pu;
    storeName = storeName || parsed.storeName;
    sitePrefix = sitePrefix || parsed.sitePrefix;
    currSiteURL = currSiteURL || parsed.currSiteURL;
  }

  // -----------------------------
  // ✅ cartId: URL + pagevars + globals + deep-search + storage
  // -----------------------------
  const u = new URL(location.href);

  const deepFind = (obj, maxDepth = 4) => {
    const seen = new Set();
    const walk = (o, d) => {
      if (!o || typeof o !== "object" || d > maxDepth) return "";
      if (seen.has(o)) return "";
      seen.add(o);

      for (const [k, v] of Object.entries(o)) {
        if (!k) continue;
        const key = String(k).toLowerCase();
        if (key.includes("cartid")) {
          const s = String(v || "").trim();
          if (s) return s;
        }
        if (v && typeof v === "object") {
          const found = walk(v, d + 1);
          if (found) return found;
        }
      }
      return "";
    };
    return walk(obj, 0);
  };

  const looksLikeCartId = (s) => {
    const v = String(s || "").trim();
    if (!v) return false;
    // Salesforce IDs zijn vaak 18 chars base62; sommige carts kunnen UUID-ish zijn
    if (/^[a-zA-Z0-9]{15,18}$/.test(v)) return true;
    if (/^[a-f0-9-]{32,36}$/i.test(v)) return true;
    // soms zit cartId in een compound string; dat wil je alsnog kunnen pakken
    if (v.includes("cartId=")) return true;
    return false;
  };

  const scanStorage = (storage) => {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        if (!key.toLowerCase().includes("cart")) continue;

        const raw = storage.getItem(key);
        if (!raw) continue;

        // direct match
        if (looksLikeCartId(raw)) {
          // als het "cartId=XXX" is, strip hem
          const m = String(raw).match(/cartId=([^&"\s]+)/i);
          return m ? m[1] : String(raw).trim();
        }

        // json-object?
        try {
          const j = JSON.parse(raw);
          const found = deepFind(j, 4);
          if (looksLikeCartId(found)) return found;
        } catch {}
      }
    } catch {}
    return "";
  };

  const urlCart =
    u.searchParams.get("cartId") ||
    u.searchParams.get("cartid") ||
    "";

  const pvCart =
    pv.currentCartId ||
    pv.cartId ||
    pv.currentCartID ||
    pv.currentcartid ||
    "";

  const globalCart =
    window.CCRZ?.currentCartId ||
    window.ccrz?.currentCartId ||
    window.CCRZ?.cartId ||
    window.ccrz?.cartId ||
    window.CCRZ?.pagevars?.currentCartId ||
    window.ccrz?.pagevars?.currentCartId ||
    "";

  const deepPvCart = deepFind(pv, 5);

  const storageCart =
    scanStorage(window.localStorage) ||
    scanStorage(window.sessionStorage) ||
    "";

  // kies de eerste “goede”
  const cartId =
    (looksLikeCartId(urlCart) ? urlCart : "") ||
    (looksLikeCartId(pvCart) ? pvCart : "") ||
    (looksLikeCartId(globalCart) ? globalCart : "") ||
    (looksLikeCartId(deepPvCart) ? deepPvCart : "") ||
    (looksLikeCartId(storageCart) ? storageCart : "") ||
    "";

  if (!cartId) {
    console.warn("[CHANTELLE] cartId not found via url/pagevars/globals/storage.", {
      urlCart, pvCart, globalCart, deepPvCart, storageCart,
      href: location.href
    });
  }

  return {
    csrf, vid, authorization,
    ver: verStr ? Number(verStr) : 45,
    ns: ns ?? "",
    effAccountId, cartId,
    priceGroupId, portalUserId,
    storeName, sitePrefix, currSiteURL
  };
}


    function makeInputContext(ctx, sku) {
      const currentPageURL =
        `${ctx.currSiteURL}ccrz__ProductDetails?cartId=${encodeURIComponent(ctx.cartId)}` +
        `&cclcl=nl_NL&effectiveAccount=${encodeURIComponent(ctx.effAccountId)}` +
        `&sku=${encodeURIComponent(sku)}&store=${encodeURIComponent(ctx.storeName)}`;

      return {
        storefront: ctx.storeName,
        portalUserId: ctx.portalUserId || "",
        effAccountId: ctx.effAccountId,
        priceGroupId: ctx.priceGroupId || "",
        currentCartId: ctx.cartId,
        userIsoCode: "EUR",
        userLocale: "nl_NL",
        currentPageName: "ccrz__ProductDetails",
        currentPageURL,
        queryParams: {
          sku,
          cartId: ctx.cartId,
          store: ctx.storeName,
          effectiveAccount: ctx.effAccountId,
          cclcl: "nl_NL"
        }
      };
    }

    async function waitForRemoteFn(controllerName, methodName, { timeoutMs = 10000, stepMs = 200 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const w = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
        const fn = w?.[controllerName]?.[methodName];
        if (typeof fn === "function") return { w, fn, ctrl: w[controllerName] };
        await new Promise(r => setTimeout(r, stepMs));
      }
      return { w: (typeof unsafeWindow !== "undefined") ? unsafeWindow : window, fn: null, ctrl: null };
    }

    async function callVFRemote(controllerName, methodName, args, { timeoutMs = 60000 } = {}) {
      const { w, fn, ctrl } = await waitForRemoteFn(controllerName, methodName, { timeoutMs: 12000, stepMs: 200 });

      if (typeof fn !== "function") {
        const keys = Object.keys(w || {}).filter(k => k.toLowerCase().includes("cc"));
        throw new Error(`Worker: remote fn missing: ${controllerName}.${methodName} (keysLikeCC=${keys.slice(0, 25).join(",")})`);
      }

      return new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(`Worker: remote timeout ${controllerName}.${methodName}`));
        }, timeoutMs);

        const cb = (result, event) => {
          if (done) return;
          done = true;
          clearTimeout(t);

          if (event?.status) return resolve(result);

          const msg =
            event?.message ||
            event?.type ||
            event?.where ||
            "Worker: remote call failed (unknown VF event)";

          reject(new Error(msg));
        };

        const options = { escape: false };

        try {
          fn.apply(ctrl, [...args, cb, options]);
        } catch (e) {
          clearTimeout(t);
          reject(e);
        }
      });
    }

    // ✅ stockMap bewaart RAW strings: "<3", ">5", "3", "4", "5" etc.
    function parseStockMap(stockPayload) {
      const sd = stockPayload?.stockData || {};
      const out = {};

      for (const [cupKey, cupObj] of Object.entries(sd)) {
        const cup = String(cupObj?.cupsize || cupKey || "").trim().toUpperCase();
        const values = cupObj?.values || {};
        for (const [bandKey, info] of Object.entries(values)) {
          const band = String(bandKey).trim();
          const raw = String(info?.stockValue ?? "").trim();
          out[`${band}${cup}`] = (!raw || raw === "-" || raw === " - ") ? "" : raw;
        }
      }
      return out;
    }

    function makeMatrixSku(baseSku, sizeKey) {
      const m = String(sizeKey).match(/^(\d{2,3})([A-Z]{1,4})$/);
      if (!m) return "";
      const band = m[1];
      const cup = m[2];
      // Chantelle expects: "BASESKU {CUP} {BAND}"
      return `${baseSku} ${cup} ${band}`;
    }

    async function fetchStock(ctx, sku) {
      const price =
        window.CCRZ?.productDetailModel?.attributes?.product?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.price ??
        window.CCRZ?.productDetailModel?.attributes?.product?.prodBean?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.prodBean?.price ??
        "0";

      const inputContext = makeInputContext(ctx, sku);

      const res = await callVFRemote(
        "ccCLProductMatrixRCBTCtrl",
        "getStock",
        [inputContext, null, String(price), {}, false, false, false],
        { timeoutMs: 60000 }
      );

      const payload = res?.data || res;

      if (!payload?.stockData) {
        console.warn("[CHANTELLE] getStock raw:", res);
        throw new Error("getStock: no stockData");
      }
      return payload;
    }

    // ✅ EAN komt uit CartData.ECartItemsS[].product.EAN
    // Belangrijk: we voegen items toe voor ALLE gevraagde maten (niet alleen waar stockKey bestaat),
    // zodat je EAN ook ziet als stockMap key-mismatch ooit speelt.
    async function fetchEans(ctx, sku, sizes, priceStr) {
      const inputContext = makeInputContext(ctx, sku);

      const items = [];
      for (const s of sizes) {
        const key = normSize(s);
        if (!isBraSizeLabel(key)) continue;

        const ms = makeMatrixSku(sku, key);
        if (!ms) continue;

        items.push({ sku: ms, quantity: "1", extSKU: ms, label: ms, price: String(priceStr || "0") });
      }
      if (!items.length) return {};

      const res = await callVFRemote(
        "ccCLProductMatrixRCBTCtrl",
        "addMatriceItemToCart",
        [inputContext, items, true, false, null],
        { timeoutMs: 90000 }
      );

      const payload = res?.data || res;
      const cart = payload?.CartData || payload?.cartData || {};
      const lines = cart?.ECartItemsS || cart?.eCartItemsS || [];

      const out = {};

      // Parse size from skuLine in multiple patterns
      const parseSizeFromSkuLine = (skuLine) => {
  const s = String(skuLine || "").trim().toUpperCase();

  // 1) jouw sample: "... B 70"
  // bv "C010M9-011 B 70"  => 70B
  let m = s.match(/\s([A-Z]{1,4})\s(\d{2,3})\s*$/);
  if (m) return `${m[2]}${m[1]}`;

  // 2) variant: "... 70 B"
  m = s.match(/\s(\d{2,3})\s([A-Z]{1,4})\s*$/);
  if (m) return `${m[1]}${m[2]}`;

  // 3) variant: "... 70B" (zonder spatie)
  m = s.match(/(\d{2,3}[A-Z]{1,4})\s*$/);
  if (m) return normSize(m[1]);

  // 4) extra: ergens in de string " B 70" (niet per se op het eind)
  m = s.match(/\b([A-Z]{1,4})\s(\d{2,3})\b/);
  if (m) return `${m[2]}${m[1]}`;

  // 5) extra: ergens "70B"
  m = s.match(/\b(\d{2,3}[A-Z]{1,4})\b/);
  if (m) return normSize(m[1]);

  return "";
};


      for (const line of lines) {
        const ean = String(line?.product?.EAN || "").trim();
if (!ean) continue;

// ✅ Chantelle gebruikt vaak hoofdletters: product.SKU en extSKU
const skuLine =
  line?.product?.SKU ||
  line?.product?.sku ||
  line?.SKU ||
  line?.sku ||
  line?.extSKU ||
  line?.extSku ||
  line?.CLTranslatedSKU ||   // jouw sample heeft deze ook
  "";

const sizeKey = parseSizeFromSkuLine(skuLine);
if (!sizeKey) continue;

out[sizeKey] = ean;

      }

      if (!Object.keys(out).length) {
        console.warn("[CHANTELLE] No EANs mapped. Debug:", {
          linesCount: lines.length,
          sampleLine: lines[0] || null
        });
      }

      return out;
    }

    function respond(jobId, payload) {
      GM_setValue(RESP_PREFIX + jobId, payload);
      log("[CHANTELLE] Response written:", jobId, payload?.ok ? "OK" : "ERR");
    }

    async function handleJob(job) {
      const id = job?.id;
      if (!id) return;

      try {
        log("[CHANTELLE] Job received:", job, "page:", location.href);

        let ctx = getCtxFromCurrentPage();
        if (!ctx.effAccountId) {
          await sleep(1000);
          ctx = getCtxFromCurrentPage();
        }

        log("[CHANTELLE] ctx quick:", {
          effAccountId: ctx.effAccountId,
          cartId: ctx.cartId,
          hasTokens: !!(ctx.csrf && ctx.vid && ctx.authorization)
        });

        if (!ctx.csrf || !ctx.vid || !ctx.authorization) {
          throw new Error("Worker: tokens missing. Open a Chantelle PDP and refresh once.");
        }
        if (!ctx.effAccountId) {
          throw new Error("Worker: effAccountId missing (CCRZ.pagevars + HTML fallback).");
        }
        if (!ctx.cartId) {
  throw new Error("Worker: cartId missing. Tip: open 1x een PDP (productdetails) pagina, of een URL waar cartId in zit, zodat CCRZ een cart init en storage kan vullen. Kijk in console voor [CHANTELLE] cartId not found debug.");
}


        const sku = String(job.sku || "").trim();
        if (!sku) throw new Error("Worker: missing sku in job.");

        const stockPayload = await fetchStock(ctx, sku);
        const stockMap = parseStockMap(stockPayload);

        // ✅ EAN: voeg toe voor ALLE maten uit DDO tab3 (die bra-size labels zijn)
 // Chantelle-maten uit stock matrix (leidend)
const chantelleSizes = Object.keys(stockMap).map(normSize).filter(isBraSizeLabel);

// DDO-maten uit tab3 (wat jij überhaupt kunt vullen)
const ddoSizes = new Set((job.sizes || []).map(normSize).filter(isBraSizeLabel));

// Alleen EAN vragen voor maten die én Chantelle heeft én jij in tab3 hebt
const requestedSizes = chantelleSizes.filter(s => ddoSizes.has(s));

let eanMap = {};
if (job.mode === "all" || job.mode === "ean") {
  const priceStr = String(stockPayload?.price || "0");
  eanMap = await fetchEans(ctx, sku, requestedSizes, priceStr);
}

        respond(id, {
          ok: true,
          stockMap,
          eanMap,
          meta: {
  receivedSizes: (job.sizes || []).length,
  stockSizes: Object.keys(stockMap).length,
  chantelleSizes: chantelleSizes.length,
  eanRequested: requestedSizes.length,
  eanMapped: Object.keys(eanMap).length
}
        });

      } catch (e) {
        respond(id, { ok: false, error: String(e?.message || e) });
        console.error("[CHANTELLE] Worker error:", e);
      }
    }

    function init() {
      GM_addValueChangeListener(JOB_KEY, (_k, _old, job) => {
        if (!job?.id) return;
        handleJob(job);
      });

      const existing = GM_getValue(JOB_KEY, null);
      if (existing?.id) handleJob(existing);

      log("[CHANTELLE] Worker ready. Keep this tab open on a PDP.");
    }

    window.addEventListener("load", () => setTimeout(init, 400));
  }

  /******************************************************************
   * BOOT
   ******************************************************************/
  if (isDDO) controllerInit();
  if (isCHANTELLE) workerInit();
})();
