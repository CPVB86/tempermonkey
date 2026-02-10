// ==UserScript==
// @name         VCP | Chantelle
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.2
// @description  VCP Chantelle via Bridge: Proxy tool vergelijkt local stock met remote Chantelle stock (CCRZ worker). Markering + logboek + StockKit progress.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-chantelle.user.js
// ==/UserScript==

(() => {
  "use strict";

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[VCP-CHANTELLE]", ...a);

  const JOB_KEY = "CHANTELLE_VCP_JOB_V1";
  const RESP_PREFIX = "CHANTELLE_VCP_RESP_V1_";

  const isPROXY = location.href.includes("Voorraadchecker%20Proxy.htm");
  const isCHANTELLE = location.hostname.includes("chantelle-lingerie.my.site.com");

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const normSize = (raw) => String(raw || "").toUpperCase().replace(/\s+/g, "").trim();

// Canonical key voor zowel Proxy als Worker
function normalizeSizeKey(raw) {
  let v = String(raw ?? "").trim();
  if (!v) return "";

  // Proxy kan combo’s hebben (M/L, S/M). Neem eerste als key.
  v = v.split(/[|,]/)[0];
  v = v.split("/")[0];

  v = normSize(v);
  if (!v) return "";

  // BH: 070D -> 70D
  let m = v.match(/^0*(\d{2,3})([A-Z]{1,4})$/);
  if (m) return `${parseInt(m[1], 10)}${m[2]}`;

  // Numeriek: 0100 -> 100 (maar geen 0)
  if (/^0*\d{1,3}$/.test(v)) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  }

  // Alpha
  if (/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL)$/.test(v)) return v;

  return v;
}

function isSizeLabel(s) {
  const v = normalizeSizeKey(s);
  if (!v) return false;
  if (/^\d{2,3}[A-Z]{1,4}$/.test(v)) return true; // 70D / 100G
  if (/^\d{1,3}$/.test(v)) return true;           // 34 / 100 / 105 / 1..10
  if (/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL)$/.test(v)) return true;
  return false;
}

  const extractFirst = (html, re) => (html.match(re)?.[1] || "");

  // -----------------------
  // Logger (zoals Mey)
  // -----------------------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== "undefined" && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    status(id, txt) {
      console.info(`[chantelle][${id}] status: ${txt}`);
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), String(txt));
      else if (typeof unsafeWindow !== "undefined" && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(id), String(txt));
    },
    perMaat(id, report) {
      console.groupCollapsed(`[chantelle][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: r.remoteRaw ?? "—",
          expected: r.expected,
          actie: r.actie
        })));
      } finally { console.groupEnd(); }
    }
  };

  // -----------------------
  // Chantelle mapping (remote RAW -> local level)
  // -----------------------
  function remoteQtyToLocalStockLevel(remoteVal) {
    const raw = String(remoteVal ?? "").trim();
    if (!raw || raw === "-" || raw === " - ") return 0;

    if (raw.includes("<")) return 1; // <3 -> 1
    if (raw.includes(">") || raw.includes("+")) return 5; // >5 -> 5

    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;

    if (n < 3) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n === 5) return 4;
    return 5;
  }

  // -----------------------
  // PROXY: local tabel uitlezen
  // -----------------------
function readLocalTable(table) {
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const out = [];
  for (const tr of rows) {
    const maatRaw = tr.dataset.size || tr.children?.[0]?.textContent || "";
    const maat = normalizeSizeKey(maatRaw);
    if (!maat) continue;

    const local = parseInt(String(tr.children?.[1]?.textContent || "").trim(), 10) || 0;
    out.push({ tr, maat, local });
  }
  return out;
}

  // SKU uit table.id of header (tolerant)
  function getSkuFromTable(table) {
    const id = String(table.id || "").trim();
    if (id) return id;

    const label = table.querySelector("thead th[colspan]")?.textContent?.trim() || "";
    const m = label.match(/\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/);
    return m ? m[0] : "";
  }

  // -----------------------
  // PROXY: wait response
  // -----------------------
  function waitForResponse(jobId, timeoutMs = 75000) {
    return new Promise((resolve, reject) => {
      const key = RESP_PREFIX + jobId;

      const t = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for Chantelle worker. Open Chantelle PDP tab and refresh once."));
      }, timeoutMs);

      const stop = GM_addValueChangeListener(key, (_k, _old, val) => {
        cleanup();
        resolve(val);
      });

      const cleanup = () => {
        clearTimeout(t);
        try { stop(); } catch {}
      };

      const existing = GM_getValue(key, null);
      if (existing) { cleanup(); resolve(existing); }
    });
  }

  // -----------------------
  // PROXY: compare + mark
  // -----------------------
  function applyCompareAndMark(localRows, stockMap) {
    const report = [];
    let diffs = 0;

    for (const { tr } of localRows) {
      tr.style.background = "";
      tr.title = "";
      tr.classList.remove("status-green", "status-red");
      delete tr.dataset.status;
    }

    for (const { tr, maat, local } of localRows) {
      if (!Object.prototype.hasOwnProperty.call(stockMap, maat)) continue;

      const remoteRaw = String(stockMap[maat] ?? "").trim();
      const expected = remoteQtyToLocalStockLevel(remoteRaw);

      let actie = "none";

      if (local !== expected) {
        diffs++;
        if (local < expected) {
          tr.style.background = "#d4edda";
          tr.title = `Bijboeken (expected ${expected}, remote ${remoteRaw})`;
          tr.dataset.status = "add";
          tr.classList.add("status-green");
          actie = "bijboeken";
        } else {
          tr.style.background = "#f8d7da";
          tr.title = `Uitboeken (expected ${expected}, remote ${remoteRaw})`;
          tr.dataset.status = "remove";
          tr.classList.add("status-red");
          actie = "uitboeken";
        }
      }

      report.push({ maat, local, remoteRaw, expected, actie });
    }

    return { report, diffs };
  }

  function bepaalStatus(report, stockMap) {
    if (!stockMap || Object.keys(stockMap).length === 0) return "niet-gevonden";
    const diffs = report.filter(r => r.actie !== "none").length;
    return diffs === 0 ? "ok" : "afwijking";
  }

  // -----------------------
  // PROXY main
  // -----------------------
  async function run(btn) {
    if (typeof StockKit === "undefined" || !StockKit.makeProgress) {
      alert("StockKit niet geladen. Check @require.");
      return;
    }

    const tables = Array.from(document.querySelectorAll("#output table"));
    if (!tables.length) { alert("Geen tabellen gevonden in #output."); return; }

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    let idx = 0;
    let totalDiffs = 0;

    for (const table of tables) {
      idx++;

      const sku = getSkuFromTable(table);
      const anchorId = sku || (table.id || `table-${idx}`);

      try {
        if (!sku) {
          Logger.status(anchorId, "niet-gevonden");
          Logger.perMaat(anchorId, []);
          progress.setDone(idx);
          continue;
        }

        const localRows = readLocalTable(table);
        const sizes = localRows.map(r => r.maat).filter(isSizeLabel);

        const jobId = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const job = { id: jobId, sku, mode: "stock", sizes, createdAt: Date.now() };

        GM_setValue(JOB_KEY, job);
        log("[PROXY] Job sent:", job);

        const resp = await waitForResponse(jobId);
        if (!resp?.ok) throw new Error(resp?.error || "Worker error");

        const stockMap = resp.stockMap || {};
        const { report, diffs } = applyCompareAndMark(localRows, stockMap);

        totalDiffs += diffs;

        const status = bepaalStatus(report, stockMap);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);

      } catch (e) {
        console.error("[chantelle] fout:", e);
        Logger.status(anchorId, "afwijking");
      }

      progress.setDone(idx);
      await delay(60);
    }

    progress.success(totalDiffs);
  }

function norm(s = "") {
  return String(s).toLowerCase().trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function getSelectedBrandLabel() {
  const sel = $("#leverancier-keuze");
  if (!sel) return "";
  const opt = sel.options?.[sel.selectedIndex];
  const label = (opt?.text || "").trim();
  return label || String(sel.value || "").trim();
}

function isChantelleSelected() {
  const sel = $("#leverancier-keuze");
  if (!sel) return true; // als dropdown ontbreekt: knop tonen
  const byValue = norm(sel.value || "");
  const byText  = norm(getSelectedBrandLabel());
  // vangt: "Chantelle", "chantelle", "Chantelle (CCRZ)", etc.
  return byValue.includes("chantelle") || byText.includes("chantelle");
}

function outputHasTables() {
  return !!document.querySelector("#output table");
}

function addButton() {
  if (document.getElementById("check-chantelle-btn")) return;

  if (!document.getElementById("stockkit-css")) {
    const link = document.createElement("link");
    link.id = "stockkit-css";
    link.rel = "stylesheet";
    link.href = "https://lingerieoutlet.nl/tools/stock/common/stockkit.css";
    document.head.appendChild(link);
  }

  const btn = document.createElement("button");
  btn.id = "check-chantelle-btn";
  btn.className = "sk-btn";
  btn.textContent = "🔍 Check stock chantelle";
  Object.assign(btn.style, { position: "fixed", top: "8px", right: "250px", zIndex: 9999, display: "none" });
  btn.addEventListener("click", () => run(btn));
  document.body.appendChild(btn);

  function toggle() {
    btn.style.display = (outputHasTables() && isChantelleSelected()) ? "block" : "none";
  }

  // update bij output changes
  const out = $("#output");
  if (out) new MutationObserver(toggle).observe(out, { childList: true, subtree: true });

  // update bij leverancier change
  const sel = $("#leverancier-keuze");
  if (sel) sel.addEventListener("change", toggle);

  toggle();
}


  // =====================================================================
  // WORKER (CHANTELLE) — volledige stock worker
  // =====================================================================
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

      // cartId: pak 'm ook uit top.href (iframe-proof)
      const hrefCandidates = [];
      try { hrefCandidates.push(String(location.href || "")); } catch {}
      try { hrefCandidates.push(String(document.URL || "")); } catch {}
      try { hrefCandidates.push(String((typeof unsafeWindow !== "undefined" ? unsafeWindow : window)?.top?.location?.href || "")); } catch {}
      try { hrefCandidates.push(String(window?.top?.location?.href || "")); } catch {}

      const pickCartIdFromHref = (href) => {
        const s = String(href || "");
        const m = s.match(/[?&]cartId=([^&]+)/i) || s.match(/cartId=([a-f0-9-]{32,36})/i);
        return m ? decodeURIComponent(m[1]) : "";
      };

      const deepFind = (obj, maxDepth = 5) => {
        const seen = new Set();
        const walk = (o, d) => {
          if (!o || typeof o !== "object" || d > maxDepth) return "";
          if (seen.has(o)) return "";
          seen.add(o);
          for (const [k, v] of Object.entries(o)) {
            const key = String(k || "").toLowerCase();
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

      const scanStorageForCartId = (storage) => {
        try {
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (!k || !k.toLowerCase().includes("cart")) continue;
            const raw = storage.getItem(k);
            if (!raw) continue;

            const fromHref = pickCartIdFromHref(raw);
            if (fromHref) return fromHref;

            try {
              const j = JSON.parse(raw);
              const found = deepFind(j, 5);
              if (found) return pickCartIdFromHref(found) || String(found).trim();
            } catch {}
          }
        } catch {}
        return "";
      };

      let cartId = "";
      for (const href of hrefCandidates) {
        cartId = pickCartIdFromHref(href);
        if (cartId) break;
      }

      if (!cartId) {
        cartId =
          pv.currentCartId ||
          pv.cartId ||
          window.CCRZ?.currentCartId ||
          window.ccrz?.currentCartId ||
          window.CCRZ?.pagevars?.currentCartId ||
          window.ccrz?.pagevars?.currentCartId ||
          deepFind(pv, 5) ||
          "";
      }

      if (!cartId) {
        cartId =
          scanStorageForCartId(window.localStorage) ||
          scanStorageForCartId(window.sessionStorage) ||
          "";
      }

      if (!cartId) {
        cartId =
          extractFirst(html, /[?&]cartId=([^&"'\s]+)/i) ||
          extractFirst(html, /cartId=([a-f0-9-]{32,36})/i) ||
          "";
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

          const msg = event?.message || event?.type || event?.where || "Worker: remote call failed (unknown VF event)";
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

    function parseStockMap(stockPayload) {
  const sd = stockPayload?.stockData || {};
  const out = {};

  // 1D: sd.values = { "34": {...}, "M": {...}, "0100": {...} }
  if (sd?.values && typeof sd.values === "object") {
    for (const [sizeKey, info] of Object.entries(sd.values)) {
      const key = normalizeSizeKey(sizeKey);
      if (!isSizeLabel(key)) continue;

      const raw = String(info?.stockValue ?? "").trim();
      out[key] = (!raw || raw === "-" || raw === " - ") ? "" : raw;
    }
    return out;
  }

  // 2D: sd = { cupKey: { cupsize, values:{ band: {...} } } }
  for (const [cupKey, cupObj] of Object.entries(sd)) {
    const cup = String(cupObj?.cupsize || cupKey || "").trim().toUpperCase();
    const values = cupObj?.values || {};

    for (const [bandKey, info] of Object.entries(values)) {
      const bandNorm = normalizeSizeKey(bandKey);
      if (!bandNorm) continue;

      // ✅ Dummy cup "-" => treat as 1D alpha matrix (S/M/L => S/M/L)
      const isDummyCup = !cup || cup === "-" || cup === "—";

      const key = isDummyCup
        ? bandNorm
        : normalizeSizeKey(`${bandNorm}${cup}`); // 70 + D => 70D

      if (!isSizeLabel(key)) continue;

      const raw = String(info?.stockValue ?? "").trim();
      out[key] = (!raw || raw === "-" || raw === " - ") ? "" : raw;
    }
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
      log("[WORKER] Response written:", jobId, payload?.ok ? "OK" : "ERR");
    }

    async function handleJob(job) {
      const id = job?.id;
      if (!id) return;

      try {
        const sku = String(job.sku || "").trim();
        if (!sku) throw new Error("Worker: missing sku.");

        let ctx = getCtxFromCurrentPage();
        if (!ctx?.effAccountId) { await sleep(800); ctx = getCtxFromCurrentPage(); }

        if (!ctx?.csrf || !ctx?.vid || !ctx?.authorization) throw new Error("Worker: tokens missing. Open a PDP + refresh once.");
        if (!ctx?.effAccountId) throw new Error("Worker: effAccountId missing.");
        if (!ctx?.cartId) throw new Error("Worker: cartId missing. Open PDP with cartId once.");

        const stockPayload = await fetchStock(ctx, sku);
        const stockMapFull = parseStockMap(stockPayload);

        // stuur alleen maten terug die Proxy vroeg (scheelt payload)
const wanted = new Set((job.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
const stockMap = Object.fromEntries(
  Object.entries(stockMapFull).filter(([k]) => wanted.has(normalizeSizeKey(k)))
);

        respond(id, { ok: true, stockMap });

      } catch (e) {
        respond(id, { ok: false, error: String(e?.message || e) });
        console.error("[chantelle-worker] error:", e);
      }
    }

    function init() {
      GM_addValueChangeListener(JOB_KEY, (_k, _old, job) => {
        if (!job?.id) return;
        handleJob(job);
      });

      const existing = GM_getValue(JOB_KEY, null);
      if (existing?.id) handleJob(existing);

      log("[WORKER] ready (VCP). Keep this tab open on a PDP.");
    }

    window.addEventListener("load", () => setTimeout(init, 400));
  }

  if (isPROXY) addButton();
  if (isCHANTELLE) workerInit();
})();
