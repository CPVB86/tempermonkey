// ==UserScript==
// @name         EAN Scraper | Chantelle
// @version      1.0
// @description  DDO controller -> Chantelle worker (same-origin VF remoting) -> stock only. No EAN. Robust size normalisation incl. dummy-cup '-' (S- => S).
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
  const log = (...a) => DEBUG && console.log("[CHANTELLE-STOCK]", ...a);

  const JOB_KEY = "CHANTELLE_STOCK_JOB_V1";
  const RESP_PREFIX = "CHANTELLE_STOCK_RESP_V1_";

  const isDDO = location.hostname.includes("dutchdesignersoutlet.com");
  const isCHANTELLE = location.hostname.includes("chantelle-lingerie.my.site.com");

  const norm = (raw) => String(raw || "").toUpperCase().replace(/\s+/g, "").trim();
  const extractFirst = (html, re) => (html.match(re)?.[1] || "");

  /******************************************************************
   * SIZE NORMALISATION
   ******************************************************************/
function normalizeSizeKey(raw) {
  let v = String(raw ?? "").trim();
  if (!v) return "";

  // Strip alleen echte "multi separators" (| ,). Slash-combo's bewaren!
  v = v.split(/[|,]/)[0].trim();

  // Normaliseer spaties/case
  v = String(v).toUpperCase().replace(/\s+/g, "").trim();
  if (!v) return "";

  // Trailing dash/emdash etc: "S-" => "S"
  v = v.replace(/[-–—]+$/g, "");

  // Remote -> local aliases
  if (v === "TU") return "NOSIZE";
  if (v === "NOSIZE" || v === "ONESIZE" || v === "OS") return "NOSIZE"; // DDO "No Size" => "NOSIZE" na spatiestrip

  // 2XL/3XL/... => XXL/XXXL/... (ook binnen combos)
  const mapNumericXL = (token) => {
    if (token === "2XL") return "XXL";
    if (token === "3XL") return "XXXL";
    if (token === "4XL") return "XXXXL";
    if (token === "5XL") return "XXXXXL";
    if (token === "6XL") return "XXXXXXL";
    return token;
  };

  // Cup normalisatie: BC => B/C (maar DD blijft DD)
  const normalizeCupToken = (cup) => {
    const c = String(cup || "").toUpperCase().replace(/\s+/g, "");
    if (!c) return "";
    if (c.includes("/")) {
      const [a, b] = c.split("/").filter(Boolean);
      return a && b ? `${a}/${b}` : c;
    }
    // Alleen 2 letters en verschillend => combo (BC/DE/FG)
    if (/^[A-Z]{2}$/.test(c) && c[0] !== c[1]) return `${c[0]}/${c[1]}`;
    return c; // AA, DD, FF etc. blijven zoals ze zijn
  };

  // BH met cup-combo in 1 string: "75BC" => "75B/C" / "070BC" => "70B/C"
  // Ook "75B/C" blijft "75B/C"
  const bh = v.match(/^0*(\d{2,3})([A-Z]{1,4}(?:\/[A-Z]{1,4})?)$/);
  if (bh) {
    const band = String(parseInt(bh[1], 10));
    const cupRaw = bh[2] || "";
    const cupNorm = normalizeCupToken(cupRaw);
    return `${band}${cupNorm}`;
  }

  // Combi alpha maten zoals XS/S, M/L, XL/2XL => XS/S, M/L, XL/XXL
  if (v.includes("/")) {
    const parts = v.split("/").filter(Boolean).map(p => mapNumericXL(p));
    return parts.join("/");
  }

  // Single token: mapNumericXL toepassen
  v = mapNumericXL(v);

  // Numeric (1..999), strip leading zeros, reject 0
  if (/^0*\d{1,3}$/.test(v)) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  }

  return v;
}

function isSizeLabel(s) {
  const v = normalizeSizeKey(s);
  if (!v) return false;

  // BH: 70D / 75B/C / 100G
  if (/^\d{2,3}[A-Z]{1,4}(?:\/[A-Z]{1,4})?$/.test(v)) return true;

  // Numeric: 34 / 100 / 105 / etc.
  if (/^\d{1,3}$/.test(v)) return true;

  // NOSIZE
  if (v === "NOSIZE") return true;

  // Alpha single
  if (/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL|XXXXXXL)$/.test(v)) return true;

  // Alpha combo: XS/S, M/L, XL/XXL, etc.
  if (v.includes("/")) {
    const parts = v.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    return parts.every(p => /^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|XXXXXL|XXXXXXL)$/.test(p));
  }

  return false;
}

  /******************************************************************
   * STOCK MAPPING (remote -> local level)
   ******************************************************************/
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

  /******************************************************************
   * CONTROLLER (DDO)
   ******************************************************************/
  function controllerInit() {
    const SEL = {
      tab3: "#tabs-3",
      supplierPid: '#tabs-1 input[name="supplier_pid"]',
      sizeCell: "td:first-child",
      stockInput: 'input[name^="options"][name$="[stock]"]'
    };

    function getBaseSkuFromAdmin() {
      return document.querySelector(SEL.supplierPid)?.value?.trim() || "";
    }

    function readSizesFromTab3(tab3) {
      const out = [];
      for (const row of tab3.querySelectorAll("table.options tr")) {
        const cell = row.querySelector(SEL.sizeCell);
        if (!cell) continue;

        const sizeEl = cell.querySelector("input,select") || cell;

        let raw = "";
        if (sizeEl?.tagName?.toLowerCase() === "select") {
          raw = (sizeEl.options?.[sizeEl.selectedIndex]?.textContent || sizeEl.value || "").trim();
        } else {
          raw = (sizeEl?.value ?? sizeEl?.textContent ?? "").trim();
        }

        const key = normalizeSizeKey(raw);
        if (key) out.push(key);
      }
      return [...new Set(out)].filter(isSizeLabel);
    }

    function pasteIntoTab3(tab3, stockMap) {
      let matchedStock = 0;
      const mapLog = [];

      for (const row of tab3.querySelectorAll("table.options tr")) {
        const cell = row.querySelector(SEL.sizeCell);
        if (!cell) continue;

        const sizeEl = cell.querySelector("input,select") || cell;

        let raw = "";
        if (sizeEl?.tagName?.toLowerCase() === "select") {
          raw = (sizeEl.options?.[sizeEl.selectedIndex]?.textContent || sizeEl.value || "").trim();
        } else {
          raw = (sizeEl?.value ?? sizeEl?.textContent ?? "").trim();
        }

        const key = normalizeSizeKey(raw);
        // Optioneel: visueel label fixen (alleen als het geen input/select is)
if (cell && !cell.querySelector("input,select")) {
  const vis = String(raw || "").toUpperCase().replace(/\s+/g, "");
  const m = vis.match(/^0*(\d{2,3})([A-Z]{2})$/);
  if (m && m[2][0] !== m[2][1]) {
    cell.textContent = `${parseInt(m[1], 10)}${m[2][0]}/${m[2][1]}`;
  }
}


        const remote = stockMap?.[key] ?? "";
        const local = remoteQtyToLocalStockLevel(remote);

        mapLog.push({ size: key, remote: String(remote ?? ""), local });

        const stockInput = row.querySelector(SEL.stockInput);
        if (stockInput && local > 0) {
          stockInput.value = String(local);
          stockInput.dispatchEvent(new Event("input", { bubbles: true }));
          matchedStock++;
        }
      }

      const filtered = mapLog.filter(r => String(r.remote).trim() || Number(r.local) > 0);
      if (filtered.length) {
        console.log(`[CHANTELLE-DDO] Mapping (maten met data): ${filtered.length}/${mapLog.length}`);
        console.table(filtered);
      } else {
        console.log("[CHANTELLE-DDO] Geen maten met data om te loggen.");
      }

      return { matchedStock };
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
      b.textContent = "Scrape Chantelle Stock";
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
        b.textContent = "Scrape Chantelle Stock";
      }, ms);
    }

    function waitForResponse(jobId, timeoutMs = 45000) {
      return new Promise((resolve, reject) => {
        const respKey = RESP_PREFIX + jobId;

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout waiting for Chantelle response. Open a Chantelle PDP tab (same browser) and refresh once."));
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

    async function run({ autosave = false } = {}) {
      const tab3 = document.querySelector(SEL.tab3);
      if (!tab3) throw new Error("tab #tabs-3 niet gevonden");

      const sku = getBaseSkuFromAdmin();
      if (!sku) throw new Error("Geen supplier_pid / SKU");

      const sizes = readSizesFromTab3(tab3);
      const jobId = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const job = { id: jobId, sku, sizes, createdAt: Date.now() };

      GM_setValue(JOB_KEY, job);
      log("[DDO] Job sent:", job);

      const resp = await waitForResponse(jobId);
      if (!resp?.ok) throw new Error(resp?.error || "Worker error (unknown)");

      if (DEBUG) {
        console.log("[DDO] sizes (normalized):", sizes);
        console.log("[DDO] stock keys:", Object.keys(resp.stockMap || {}));
        if (resp?.meta) console.log("[DDO] meta:", resp.meta);
      }

      const res = pasteIntoTab3(tab3, resp.stockMap || {});
      const ok = res.matchedStock > 0;

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
          setBtn(btn, true, "⏳ Stock scrapen…", 0);
          const r = await run({ autosave: false });
          setBtn(btn, r.ok, `✅ Stock: ${r.matchedStock}`);
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
          // Ctrl+Shift+A = stock + autosave
          if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "a") {
            ev.preventDefault();
            setBtn(btn, true, "⏳ Stock+Save…", 0);
            const r = await run({ autosave: true });
            setBtn(btn, r.ok, `✅ Stock: ${r.matchedStock}`);
            return;
          }
          // Ctrl+Shift+S = stock only
          if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && k === "s") {
            ev.preventDefault();
            setBtn(btn, true, "⏳ Stock…", 0);
            const r = await run({ autosave: false });
            setBtn(btn, r.ok, `✅ Stock: ${r.matchedStock}`);
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
        extractFirst(html, /ccrz\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) || "";

      const pg =
        extractFirst(html, /CCRZ\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) || "";

      const pu =
        extractFirst(html, /CCRZ\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) || "";

      const storeName =
        extractFirst(html, /CCRZ\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) || "DefaultStore";

      const sitePrefix =
        extractFirst(html, /CCRZ\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) || "/DefaultStore";

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

      // cartId: URL + pagevars + globals + storage scan (simple)
      const u = new URL(location.href);
      const urlCart = u.searchParams.get("cartId") || u.searchParams.get("cartid") || "";
      const pvCart = pv.currentCartId || pv.cartId || pv.currentCartID || pv.currentcartid || "";
      const globalCart = window.CCRZ?.currentCartId || window.ccrz?.currentCartId || window.CCRZ?.cartId || window.ccrz?.cartId || "";

      const looksLikeCartId = (s) => {
        const v = String(s || "").trim();
        if (!v) return false;
        if (/^[a-zA-Z0-9]{15,18}$/.test(v)) return true;
        if (/^[a-f0-9-]{32,36}$/i.test(v)) return true;
        return false;
      };

      const scanStorage = (storage) => {
        try {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.toLowerCase().includes("cart")) continue;
            const raw = storage.getItem(key);
            if (looksLikeCartId(raw)) return String(raw).trim();
          }
        } catch {}
        return "";
      };

      const storageCart = scanStorage(localStorage) || scanStorage(sessionStorage) || "";

      const cartId =
        (looksLikeCartId(urlCart) ? urlCart : "") ||
        (looksLikeCartId(pvCart) ? pvCart : "") ||
        (looksLikeCartId(globalCart) ? globalCart : "") ||
        (looksLikeCartId(storageCart) ? storageCart : "") ||
        "";

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

    async function waitForRemoteFn(controllerName, methodName, { timeoutMs = 12000, stepMs = 200 } = {}) {
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
          reject(new Error(event?.message || "Worker: remote call failed"));
        };

        try {
          fn.apply(ctrl, [...args, cb, { escape: false }]);
        } catch (e) {
          clearTimeout(t);
          reject(e);
        }
      });
    }
      function sizeKeyFromInfoOrOuter(outerKey, info) {
  const skuLabel = String(
    info?.translatedProductSKU ||
    info?.productSKU ||
    info?.label ||
    ""
  ).trim();

  // Pak laatste token als maat (bv: "C17L80-011 XL" => "XL")
  const tail = skuLabel ? skuLabel.split(/\s+/).pop() : "";

  const preferred = tail || outerKey;
  return normalizeSizeKey(preferred);
}

    function parseStockMap(stockPayload) {
      const sd = stockPayload?.stockData || {};
      const out = {};

      // 1D: sd.values = { "34": {...}, "M": {...}, "0100": {...} }
      if (sd?.values && typeof sd.values === "object") {
        for (const [sizeKey, info] of Object.entries(sd.values)) {
  const key = sizeKeyFromInfoOrOuter(sizeKey, info);
          if (!isSizeLabel(key)) continue;

          const raw = String(info?.stockValue ?? "").trim();
          out[key] = (!raw || raw === "-" || raw === " - ") ? "" : raw;
        }
        return out;
      }

      // 2D: sd = { cupKey: { cupsize, values:{ band: {...} } } }
      for (const [cupKey, cupObj] of Object.entries(sd)) {
        const cupRaw = String(cupObj?.cupsize || cupKey || "").trim().toUpperCase().replace(/\s+/g, "");
const cup =
  (!cupRaw || cupRaw === "-" || cupRaw === "—")
    ? cupRaw
    : (/^[A-Z]{2}$/.test(cupRaw) && cupRaw[0] !== cupRaw[1])
        ? `${cupRaw[0]}/${cupRaw[1]}`
        : cupRaw;


        const values = cupObj?.values || {};

        for (const [bandKey, info] of Object.entries(values)) {
  const isDummyCup = !cup || cup === "-" || cup === "—";

  // ✅ use productSKU-derived size for alpha matrices
  const bandNorm = isDummyCup
    ? sizeKeyFromInfoOrOuter(bandKey, info)       // <-- hier zit je XL-fix
    : normalizeSizeKey(bandKey);                  // BH bandmaten blijven bandKey

  if (!bandNorm) continue;

  const key = isDummyCup
    ? bandNorm
    : normalizeSizeKey(`${bandNorm}${cup}`);

          if (!isSizeLabel(key)) continue;

          const raw = String(info?.stockValue ?? "").trim();
          out[key] = (!raw || raw === "-" || raw === " - ") ? "" : raw;
        }
          if (DEBUG) console.log("[PARSE]", { bandKey, productSKU: info?.productSKU, label: info?.label, chosen: bandNorm, key });
      }

      return out;
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
      if (!payload?.stockData) throw new Error("getStock: no stockData");
      return payload;
    }

    function respond(jobId, payload) {
      GM_setValue(RESP_PREFIX + jobId, payload);
      log("[CHANTELLE] Response written:", jobId, payload?.ok ? "OK" : "ERR");
    }

    async function handleJob(job) {
      const id = job?.id;
      if (!id) return;

      try {
        log("[CHANTELLE] Job received:", job);

        let ctx = getCtxFromCurrentPage();
        if (!ctx.effAccountId) {
          await sleep(800);
          ctx = getCtxFromCurrentPage();
        }

        if (!ctx.csrf || !ctx.vid || !ctx.authorization) {
          throw new Error("Worker: tokens missing. Open a Chantelle PDP and refresh once.");
        }
        if (!ctx.effAccountId) throw new Error("Worker: effAccountId missing.");
        if (!ctx.cartId) throw new Error("Worker: cartId missing (open a PDP once).");

        const sku = String(job.sku || "").trim();
        if (!sku) throw new Error("Worker: missing sku in job.");

        const stockPayload = await fetchStock(ctx, sku);
        const stockMapFull = parseStockMap(stockPayload);

        // Only send overlap to reduce noise
        const ddoSizes = new Set((job.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
        const filtered = {};
        for (const [k, v] of Object.entries(stockMapFull)) {
          if (ddoSizes.has(k)) filtered[k] = v;
        }

        respond(id, {
          ok: true,
          stockMap: filtered,
          meta: {
            receivedSizes: (job.sizes || []).length,
            stockSizesTotal: Object.keys(stockMapFull).length,
            overlapSent: Object.keys(filtered).length
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
