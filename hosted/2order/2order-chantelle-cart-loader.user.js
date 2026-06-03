// ==UserScript==
// @name         Chantelle Cart Loader
// @version      0.1
// @description  Reads SKU/size/qty rows from clipboard and adds matching Chantelle matrix items to the cart.
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__Cart*
// @author       C. P. v. Beek + GPT
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[CHANTELLE-CART]", ...args);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractFirst(html, re) {
    return html.match(re)?.[1] || "";
  }

  function normalizeCupToken(cup) {
    const c = String(cup || "").toUpperCase().replace(/\s+/g, "");
    if (!c) return "";
    if (c.includes("/")) {
      const [a, b] = c.split("/").filter(Boolean);
      return a && b ? `${a}/${b}` : c;
    }
    if (/^[A-Z]{2}$/.test(c) && c[0] !== c[1]) return `${c[0]}/${c[1]}`;
    return c;
  }

  function normalizeSizeKey(raw) {
    let v = String(raw ?? "").trim();
    if (!v) return "";

    v = v.split(/[|,]/)[0].trim();
    v = v.toUpperCase().replace(/\s+/g, "").trim();
    v = v.replace(/[-–—]+$/g, "");

    if (v === "TU") return "NOSIZE";
    if (v === "NOSIZE" || v === "ONESIZE" || v === "OS") return "NOSIZE";

    const mapNumericXL = (token) => {
      if (token === "2XL") return "XXL";
      if (token === "3XL") return "XXXL";
      if (token === "4XL") return "XXXXL";
      if (token === "5XL") return "XXXXXL";
      if (token === "6XL") return "XXXXXXL";
      return token;
    };

    const rev = v.match(/^([A-Z]{1,4})0*(\d{2,3})$/);
    if (rev) {
      const cupNorm = normalizeCupToken(rev[1]);
      const band = String(parseInt(rev[2], 10));
      return `${band}${cupNorm}`;
    }

    const bh = v.match(/^0*(\d{2,3})([A-Z]{1,4}(?:\/[A-Z]{1,4})?)$/);
    if (bh) {
      const band = String(parseInt(bh[1], 10));
      const cupNorm = normalizeCupToken(bh[2] || "");
      return `${band}${cupNorm}`;
    }

    if (v.includes("/")) {
      return v.split("/").filter(Boolean).map(mapNumericXL).join("/");
    }

    v = mapNumericXL(v);

    if (/^0*\d{1,3}$/.test(v)) {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? String(n) : "";
    }

    return v;
  }

  function extractSizeFromTranslatedSku(info) {
    const s = String(info?.translatedProductSKU || info?.productSKU || info?.label || "").trim();
    if (!s) return "";

    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const t1 = parts[parts.length - 2];
      const t2 = parts[parts.length - 1];

      if (/^[A-Z]{1,4}(?:\/[A-Z]{1,4})?$/.test(t1) && /^0*\d{2,3}$/.test(t2)) {
        return `${t1}${t2}`;
      }

      return t2;
    }

    return s;
  }

  function sizeKeyFromInfoOrOuter(outerKey, info) {
    return normalizeSizeKey(extractSizeFromTranslatedSku(info) || outerKey);
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
      location.origin + sitePrefix + "/";

    return { eff, pg, pu, storeName, sitePrefix, currSiteURL };
  }

  function getAnyPageVars() {
    return window.CCRZ?.pagevars || window.ccrz?.pagevars || window.CCRZ?.PageVars || window.ccrz?.PageVars || {};
  }

  function looksLikeCartId(s) {
    const x = String(s || "").trim();
    if (!x) return false;
    if (/^[a-zA-Z0-9]{15,18}$/.test(x)) return true;
    if (/^[a-f0-9-]{32,36}$/i.test(x)) return true;
    return false;
  }

  function scanStorageForCart(storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || !key.toLowerCase().includes("cart")) continue;
        const raw = storage.getItem(key);
        if (looksLikeCartId(raw)) return String(raw).trim();
      }
    } catch {}
    return "";
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
    let currSiteURL = pv.currSiteURL || location.origin + sitePrefix + "/";

    if (!effAccountId) {
      const parsed = parsePagevarsFromHtml(html);
      effAccountId = parsed.eff || effAccountId;
      priceGroupId = priceGroupId || parsed.pg;
      portalUserId = portalUserId || parsed.pu;
      storeName = storeName || parsed.storeName;
      sitePrefix = sitePrefix || parsed.sitePrefix;
      currSiteURL = currSiteURL || parsed.currSiteURL;
    }

    const u = new URL(location.href);
    const urlCart = u.searchParams.get("cartId") || u.searchParams.get("cartid") || "";
    const pvCart = pv.currentCartId || pv.cartId || pv.currentCartID || pv.currentcartid || "";
    const globalCart = window.CCRZ?.currentCartId || window.ccrz?.currentCartId || window.CCRZ?.cartId || window.ccrz?.cartId || "";
    const storageCart = scanStorageForCart(localStorage) || scanStorageForCart(sessionStorage);
    const cartId =
      (looksLikeCartId(urlCart) ? urlCart : "") ||
      (looksLikeCartId(pvCart) ? pvCart : "") ||
      (looksLikeCartId(globalCart) ? globalCart : "") ||
      (looksLikeCartId(storageCart) ? storageCart : "") ||
      "";

    return {
      csrf,
      vid,
      authorization,
      ver: verStr ? Number(verStr) : 45,
      ns: ns ?? "",
      effAccountId,
      cartId,
      priceGroupId,
      portalUserId,
      storeName,
      sitePrefix,
      currSiteURL,
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
        cclcl: "nl_NL",
      },
    };
  }

  async function waitForRemoteFn(controllerName, methodName, { timeoutMs = 12000, stepMs = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const fn = w?.[controllerName]?.[methodName];
      if (typeof fn === "function") return { fn, ctrl: w[controllerName] };
      await sleep(stepMs);
    }
    return { fn: null, ctrl: null };
  }

  async function callVFRemote(controllerName, methodName, args, { timeoutMs = 60000 } = {}) {
    const { fn, ctrl } = await waitForRemoteFn(controllerName, methodName);
    if (typeof fn !== "function") throw new Error(`Remote functie ontbreekt: ${controllerName}.${methodName}`);

    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(`Remote timeout: ${controllerName}.${methodName}`));
      }, timeoutMs);

      const cb = (result, event) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (event?.status) return resolve(result);
        reject(new Error(event?.message || "Remote call failed"));
      };

      try {
        fn.apply(ctrl, [...args, cb, { escape: false }]);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  function getCurrentProductPrice() {
    return (
      window.CCRZ?.productDetailModel?.attributes?.product?.price ??
      window.ccrz?.productDetailModel?.attributes?.product?.price ??
      window.CCRZ?.productDetailModel?.attributes?.product?.prodBean?.price ??
      window.ccrz?.productDetailModel?.attributes?.product?.prodBean?.price ??
      "0"
    );
  }

  async function fetchStock(ctx, sku) {
    const inputContext = makeInputContext(ctx, sku);
    const price = getCurrentProductPrice();

    const res = await callVFRemote(
      "ccCLProductMatrixRCBTCtrl",
      "getStock",
      [inputContext, null, String(price), {}, false, false, false],
      { timeoutMs: 60000 }
    );

    const payload = res?.data || res;
    if (!payload?.stockData) throw new Error(`Geen stockData voor ${sku}`);
    return payload;
  }

  function getInfoPrice(info, fallbackPrice) {
    const raw =
      info?.price ??
      info?.unitPrice ??
      info?.salesPrice ??
      info?.productPrice ??
      info?.ccrz__Price__c ??
      fallbackPrice ??
      "0";

    return String(raw || "0");
  }

  function getItemSku(info, baseSku, sizeKey) {
    return String(info?.productSKU || info?.translatedProductSKU || info?.sku || info?.label || `${baseSku} ${sizeKey}`).trim();
  }

  function buildMatrixItems(stockPayload, baseSku, desiredQtyBySize, fallbackPrice) {
    const sd = stockPayload?.stockData || {};
    const items = [];
    const matched = new Set();

    function pushItem(outerKey, info) {
      const sizeKey = sizeKeyFromInfoOrOuter(outerKey, info);
      if (!sizeKey) return;

      const qty = desiredQtyBySize.get(sizeKey) || 0;
      if (qty > 0) matched.add(sizeKey);

      const sku = getItemSku(info, baseSku, sizeKey);
      const label = String(info?.label || info?.translatedProductSKU || info?.productSKU || sku).trim();

      items.push({
        sku,
        quantity: String(qty),
        extSku: String(info?.extSku || sku).trim(),
        label,
        price: getInfoPrice(info, fallbackPrice),
      });
    }

    if (sd?.values && typeof sd.values === "object") {
      Object.entries(sd.values).forEach(([sizeKey, info]) => pushItem(sizeKey, info));
    } else {
      Object.entries(sd).forEach(([cupKey, cupObj]) => {
        const values = cupObj?.values || {};
        Object.entries(values).forEach(([bandKey, info]) => {
          const outerKey = extractSizeFromTranslatedSku(info) ? bandKey : `${bandKey}${cupObj?.cupsize || cupKey || ""}`;
          pushItem(outerKey, info);
        });
      });
    }

    return {
      items,
      matched: Array.from(matched),
      missing: Array.from(desiredQtyBySize.keys()).filter((sizeKey) => !matched.has(sizeKey)),
    };
  }

  async function addMatrixItemsToCart(ctx, sku, matrixItems) {
    const inputContext = makeInputContext(ctx, sku);
    return callVFRemote(
      "ccCLProductMatrixRCBTCtrl",
      "addMatriceItemToCart",
      [inputContext, matrixItems, true, false, null],
      { timeoutMs: 60000 }
    );
  }

  function parseClipboardRows(text) {
    const rows = [];
    const errors = [];

    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const cols = line.split("\t").map((col) => col.trim());
        if (cols.length < 3) {
          errors.push(`Regel ${index + 1}: verwacht SKU<TAB>maat<TAB>aantal`);
          return;
        }

        const [sku, sizeRaw, qtyRaw] = cols;
        const size = normalizeSizeKey(sizeRaw);
        const qty = parseInt(String(qtyRaw).replace(",", "."), 10);

        if (!sku) errors.push(`Regel ${index + 1}: SKU ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(qty) || qty <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);

        if (sku && size && Number.isFinite(qty) && qty > 0) {
          rows.push({ sku, size, qty, rawSize: sizeRaw });
        }
      });

    return { rows, errors };
  }

  function groupRows(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      if (!groups.has(row.sku)) groups.set(row.sku, new Map());
      const sizes = groups.get(row.sku);
      if (!sizes.has(row.size)) {
        sizes.set(row.size, { qty: 0, rows: [] });
      }
      const entry = sizes.get(row.size);
      entry.qty += row.qty;
      entry.rows.push(row);
    });

    return groups;
  }

  function getDesiredQtyMap(sizeEntries) {
    return new Map(Array.from(sizeEntries.entries()).map(([size, entry]) => [size, entry.qty]));
  }

  function setRowsState(rows, state, detail = "") {
    rows.forEach((row) => {
      row.state = state;
      row.detail = detail;
      if (row.statusCell) {
        row.statusCell.textContent = getStateIcon(state);
        row.statusCell.title = detail || getStateLabel(state);
        row.statusCell.dataset.state = state;
      }
    });
  }

  function getStateIcon(state) {
    if (state === "ok") return "✓";
    if (state === "error") return "×";
    if (state === "busy") return "…";
    return "";
  }

  function getStateLabel(state) {
    if (state === "ok") return "Toegevoegd";
    if (state === "error") return "Niet gelukt";
    if (state === "busy") return "Bezig";
    return "Wacht";
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:fixed",
      "right:12px",
      "top:12px",
      "z-index:999999",
      "width:430px",
      "max-width:calc(100vw - 24px)",
      "font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif",
      "background:#fff",
      "color:#1f2933",
      "border:1px solid #cfd7df",
      "border-radius:8px",
      "box-shadow:0 8px 30px rgba(0,0,0,.16)",
      "padding:10px",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Chantelle Order Tool";
    title.style.cssText = "font-weight:800;font-size:15px;margin-bottom:8px;color:#111827;";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Bestel items op klembord";
    button.style.cssText = [
      "width:100%",
      "border:0",
      "border-radius:6px",
      "background:#1f6feb",
      "color:#fff",
      "font-weight:700",
      "padding:9px 10px",
      "cursor:pointer",
    ].join(";");

    const dryRunLabel = document.createElement("label");
    dryRunLabel.style.cssText = "display:flex;gap:7px;align-items:center;margin:8px 0;color:#46515f;";

    const dryRun = document.createElement("input");
    dryRun.type = "checkbox";
    dryRun.checked = DEBUG;
    dryRunLabel.appendChild(dryRun);
    dryRunLabel.appendChild(document.createTextNode("Alleen controleren, nog niet toevoegen"));
    if (!DEBUG) dryRunLabel.style.display = "none";

    const message = document.createElement("div");
    message.style.cssText = "margin-top:8px;color:#4b5563;font-size:12px;min-height:16px;";
    message.textContent = "Klembordformaat: SKU<TAB>maat<TAB>aantal";

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = [
      "margin-top:8px",
      "max-height:300px",
      "overflow:auto",
      "border-radius:6px",
      "border:1px solid #e5e7eb",
    ].join(";");

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>SKU</th><th>Maat</th><th>Aantal</th><th></th></tr>";
    thead.querySelectorAll("th").forEach((th) => {
      th.style.cssText = "position:sticky;top:0;background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:6px;text-align:left;font-weight:700;";
    });

    const tableBody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tableBody);
    tableWrap.appendChild(table);

    panel.appendChild(title);
    panel.appendChild(button);
    panel.appendChild(dryRunLabel);
    panel.appendChild(message);
    panel.appendChild(tableWrap);
    document.body.appendChild(panel);

    return { button, dryRun, message, tableBody };
  }

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const cells = [row.sku, row.rawSize || row.size, row.qty];

      cells.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = String(value);
        td.style.cssText = [
          "border-bottom:1px solid #eef0f2",
          "padding:6px",
          index === 2 ? "text-align:right" : "text-align:left",
          index === 0 ? "font-family:ui-monospace,SFMono-Regular,Consolas,monospace" : "",
        ].filter(Boolean).join(";");
        tr.appendChild(td);
      });

      const statusCell = document.createElement("td");
      statusCell.style.cssText = "border-bottom:1px solid #eef0f2;padding:6px;text-align:center;width:34px;font-weight:800;font-size:16px;";
      statusCell.dataset.state = "idle";
      row.statusCell = statusCell;
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function formatPlan(groups) {
    const lines = [];
    for (const [sku, sizes] of groups.entries()) {
      const sizeText = Array.from(sizes.entries()).map(([size, entry]) => `${size} x${entry.qty}`).join(", ");
      lines.push(`${sku}: ${sizeText}`);
    }
    return lines.join("\n");
  }

  async function runFromClipboard({ dryRun, message, tableBody }) {
    const text = await navigator.clipboard.readText();
    const parsed = parseClipboardRows(text);

    if (parsed.errors.length) {
      tableBody.innerHTML = "";
      message.textContent = `Fouten in klembord: ${parsed.errors.join(" | ")}`;
      return;
    }

    if (!parsed.rows.length) {
      tableBody.innerHTML = "";
      message.textContent = "Geen regels gevonden. Gebruik: SKU<TAB>maat<TAB>aantal";
      return;
    }

    parsed.rows.forEach((row) => {
      row.state = "idle";
      row.detail = "";
    });
    renderRows(parsed.rows, tableBody);

    const groups = groupRows(parsed.rows);
    const plan = formatPlan(groups);

    if (!dryRun && !window.confirm(`Deze regels worden aan het Chantelle winkelmandje toegevoegd:\n\n${plan}`)) {
      message.textContent = "Geannuleerd.";
      return;
    }

    let ctx = getCtxFromCurrentPage();
    if (!ctx.effAccountId || !ctx.cartId) {
      await sleep(800);
      ctx = getCtxFromCurrentPage();
    }

    if (!ctx.csrf || !ctx.vid || !ctx.authorization) throw new Error("Tokens ontbreken. Open/ververs een Chantelle productpagina.");
    if (!ctx.effAccountId) throw new Error("effectiveAccount ontbreekt.");
    if (!ctx.cartId) throw new Error("cartId ontbreekt. Open eerst een Chantelle productpagina of winkelmandje.");

    const failedRows = new Set();
    message.textContent = dryRun ? "Controle bezig..." : "Bestellen bezig...";

    for (const [sku, sizeEntries] of groups.entries()) {
      const groupRowsList = Array.from(sizeEntries.values()).flatMap((entry) => entry.rows);
      setRowsState(groupRowsList, "busy", "Matrix ophalen");

      let matrix;
      try {
        const stockPayload = await fetchStock(ctx, sku);
        const desiredQtyBySize = getDesiredQtyMap(sizeEntries);
        matrix = buildMatrixItems(stockPayload, sku, desiredQtyBySize, getCurrentProductPrice());
      } catch (err) {
        setRowsState(groupRowsList, "error", err?.message || "Matrix ophalen mislukt");
        groupRowsList.forEach((row) => failedRows.add(row));
        continue;
      }

      if (matrix.missing.length) {
        matrix.missing.forEach((size) => {
          const entry = sizeEntries.get(size);
          if (entry) {
            setRowsState(entry.rows, "error", "Maat niet gevonden in Chantelle matrix");
            entry.rows.forEach((row) => failedRows.add(row));
          }
        });
      }

      if (!matrix.items.length) {
        setRowsState(groupRowsList, "error", "Geen matrix-items gevonden");
        groupRowsList.forEach((row) => failedRows.add(row));
        continue;
      }

      if (dryRun) {
        matrix.matched.forEach((size) => {
          const entry = sizeEntries.get(size);
          if (entry) setRowsState(entry.rows, "ok", "Match gevonden");
        });
        continue;
      }

      if (!matrix.matched.length) {
        setRowsState(groupRowsList, "error", "Geen gevraagde maten gematcht");
        groupRowsList.forEach((row) => failedRows.add(row));
        continue;
      }

      log("addMatriceItemToCart", sku, matrix.items);
      try {
        await addMatrixItemsToCart(ctx, sku, matrix.items);
        matrix.matched.forEach((size) => {
          const entry = sizeEntries.get(size);
          if (entry) setRowsState(entry.rows, "ok", "Toegevoegd");
        });
      } catch (err) {
        const detail = err?.message || "Toevoegen mislukt";
        matrix.matched.forEach((size) => {
          const entry = sizeEntries.get(size);
          if (entry) setRowsState(entry.rows, "error", detail);
        });
        matrix.matched.forEach((size) => {
          const entry = sizeEntries.get(size);
          if (entry) entry.rows.forEach((row) => failedRows.add(row));
        });
      }
      await sleep(350);
    }

    if (dryRun) {
      message.textContent = "Controle klaar.";
      return;
    }

    if (failedRows.size > 0) {
      message.textContent = `${failedRows.size} regel(s) niet gelukt. Niet automatisch ververst.`;
      return;
    }

    message.textContent = "Alles toegevoegd. Winkelmandje wordt ververst...";
    await sleep(1200);
    location.reload();
  }

  function init() {
    const ui = createPanel();

    ui.button.addEventListener("click", async () => {
      ui.button.disabled = true;
      ui.button.style.opacity = ".65";

      try {
        await runFromClipboard({ dryRun: ui.dryRun.checked, message: ui.message, tableBody: ui.tableBody });
      } catch (err) {
        console.error(err);
        ui.message.textContent = `Fout: ${err?.message || err}`;
      } finally {
        ui.button.disabled = false;
        ui.button.style.opacity = "1";
      }
    });

    log("Ready.");
  }

  window.addEventListener("load", () => setTimeout(init, 500));
})();
