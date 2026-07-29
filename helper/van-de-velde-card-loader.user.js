// ==UserScript==
// @name         Van de Velde Order Tool
// @version      0.12
// @description  Reads Van de Velde product/size/qty rows from clipboard, resolves exact SKUs and adds them to the cart.
// @match        https://www.vandeveldeservice.com/nl/checkout*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/van-de-velde-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/van-de-velde-card-loader.user.js
// @author       C. P. v. Beek
// @grant        GM_xmlhttpRequest
// @connect      b2b-api.vandeveldeservice.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const API = "https://b2b-api.vandeveldeservice.com/gateway";
  const PANEL_ID = "van-de-velde-order-tool";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizeProductId = (value) => String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^.*\/products?\//i, "")
    .split(/[/?#]/)[0]
    .replace(/[^A-Z0-9]/g, "");

  function normalizeSize(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/[\s/._-]+/g, "");
    let match = raw.match(/^([A-Z]+)0*(\d+)$/);
    if (match) return `${Number(match[2])}${match[1]}`;
    match = raw.match(/^0*(\d+)([A-Z]+)$/);
    if (match) return `${Number(match[1])}${match[2]}`;
    return raw;
  }

  function parseRows(text) {
    const rows = [];
    const errors = [];
    String(text || "").split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const columns = line.includes("\t")
        ? line.split("\t")
        : line.trim().split(/[;,]\s*|\s{2,}/);
      if (columns.length < 3) {
        errors.push(`Regel ${index + 1}: verwacht product-ID, maat en aantal`);
        return;
      }
      const productId = normalizeProductId(columns[0]);
      const size = String(columns[1] || "").trim();
      const quantity = Number(String(columns[2] || "").replace(",", "."));
      if (!productId) errors.push(`Regel ${index + 1}: product-ID ontbreekt`);
      if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errors.push(`Regel ${index + 1}: aantal moet een positief geheel getal zijn`);
      }
      if (productId && size && Number.isInteger(quantity) && quantity > 0) {
        rows.push({ productId, size, quantity, sku: "", state: "idle", detail: "" });
      }
    });
    return { rows, errors };
  }

  function findAccessToken() {
    const currentToken = window.localStorage.getItem("token");
    if (currentToken) return currentToken;
    const candidates = [];
    const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

    function inspect(value, keyHint = "") {
      if (!value) return;
      if (typeof value === "string") {
        if (jwtPattern.test(value)) {
          const hint = keyHint.toLowerCase();
          const score = hint.includes("access") ? 4 : hint.includes("idtoken") || hint.includes("id_token") ? -2 : 0;
          candidates.push({ token: value, score });
          return;
        }
        if ((value.startsWith("{") || value.startsWith("[")) && value.length < 200000) {
          try { inspect(JSON.parse(value), keyHint); } catch { /* geen JSON */ }
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => inspect(entry, keyHint));
        return;
      }
      if (typeof value !== "object") return;

      const credentialType = String(value.credentialType || value.tokenType || "").toLowerCase();
      ["secret", "accessToken", "access_token", "token"].forEach((key) => {
        const token = value[key];
        if (typeof token !== "string" || !jwtPattern.test(token)) return;
        let score = key.toLowerCase().includes("access") ? 5 : 1;
        if (credentialType.includes("access")) score += 5;
        if (credentialType.includes("id")) score -= 6;
        candidates.push({ token, score });
      });
      Object.entries(value).forEach(([key, entry]) => {
        if (!["secret", "accessToken", "access_token", "token"].includes(key)) inspect(entry, `${keyHint} ${key}`);
      });
    }

    [window.sessionStorage, window.localStorage].forEach((storage) => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || "";
        inspect(storage.getItem(key), key);
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.token || "";
  }

  function decodeJwtPayload(token) {
    try {
      const encoded = token.split(".")[1];
      if (!encoded) return null;
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(atob(base64).split("").map((char) =>
        `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function findCustomerId(accessToken) {
    const selectedCustomerId = window.localStorage.getItem("customerId");
    if (selectedCustomerId) return selectedCustomerId;
    const candidates = [];
    const exactKeys = /^(customer_?id|customer_?number|customernumber|sold_?to|soldtoparty)$/i;
    const customerContainer = /(customer|account|sold.?to)/i;

    function add(value, score) {
      const id = String(value ?? "").trim();
      if (id && id.length <= 80 && /^[A-Z0-9._-]+$/i.test(id)) candidates.push({ id, score });
    }

    function inspect(value, keyHint = "", depth = 0) {
      if (value == null || depth > 8) return;
      if (typeof value === "string") {
        if (exactKeys.test(keyHint)) add(value, 10);
        if ((value.startsWith("{") || value.startsWith("[")) && value.length < 200000) {
          try { inspect(JSON.parse(value), keyHint, depth + 1); } catch { /* geen JSON */ }
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => inspect(entry, keyHint, depth + 1));
        return;
      }
      if (typeof value !== "object") {
        if (exactKeys.test(keyHint)) add(value, 10);
        return;
      }
      Object.entries(value).forEach(([key, entry]) => {
        if (exactKeys.test(key)) add(entry, 12);
        if (key === "id" && customerContainer.test(keyHint)) add(entry, 8);
        inspect(entry, `${keyHint} ${key}`, depth + 1);
      });
    }

    [window.sessionStorage, window.localStorage].forEach((storage) => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || "";
        const value = storage.getItem(key);
        if (exactKeys.test(key)) add(value, 15);
        inspect(value, key);
      }
    });
    inspect(decodeJwtPayload(accessToken), "access token");
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.id || "";
  }

  function decodeHtmlEntities(value) {
    if (!String(value || "").includes("&")) return value;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function apiFetch(path, options = {}) {
    return new Promise((resolve, reject) => {
      const accessToken = findAccessToken();
      const customerId = findCustomerId(accessToken);
      const needsCustomerId = path === "/carts";
      if (needsCustomerId && !customerId) {
        reject(new Error("customerId niet gevonden in de ingelogde sessie; kopieer de customerId-header uit een succesvolle cart-request"));
        return;
      }
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: `${API}${path}`,
        data: options.body,
        headers: {
          Accept: "*/*",
          channel: "b2b",
          clientid: "eur",
          "Content-Language": "nl-BE",
          dyconsent: "false",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(needsCustomerId && customerId ? { customerId } : {}),
          ...(options.headers || {}),
        },
        anonymous: false,
        timeout: 30000,
        onload(response) {
          const text = decodeHtmlEntities(response.responseText || "");
          let body = null;
          try { body = text ? JSON.parse(text) : null; } catch { body = text; }
          if (response.status < 200 || response.status >= 300) {
            if (response.status === 401) {
              reject(new Error(accessToken
                ? "401: het access token is verlopen of niet geldig voor de Van de Velde API; vernieuw de webshop en probeer opnieuw"
                : "401: geen access token gevonden; vernieuw de webshop, log zo nodig opnieuw in en probeer opnieuw"));
              return;
            }
            const message = body?.detail || body?.message || body?.error || body?.title || text || `HTTP ${response.status}`;
            console.error("[Van de Velde Order Tool] API-weigering", {
              method: options.method || "GET",
              path,
              status: response.status,
              response: body,
            });
            reject(new Error(`${response.status}: ${message}`));
            return;
          }
          resolve(body);
        },
        onerror(response) {
          reject(new Error(`Netwerkfout bij ${options.method || "GET"} ${path}${response?.status ? ` (HTTP ${response.status})` : ""}`));
        },
        ontimeout() {
          reject(new Error(`Timeout bij ${options.method || "GET"} ${path}`));
        },
      });
    });
  }

  function skuSizeCandidates(sku, productId) {
    const eu = sku?.sizes?.EU || {};
    const values = [
      eu.size,
      eu.measurement,
      eu.cup && eu.measurement ? `${eu.measurement}${eu.cup}` : "",
      eu.cup && eu.measurement ? `${eu.cup}${eu.measurement}` : "",
      String(sku?.id || "").startsWith(productId) ? String(sku.id).slice(productId.length) : "",
    ];
    return new Set(values.filter(Boolean).map(normalizeSize));
  }

  function findExactSku(product, row) {
    const wanted = normalizeSize(row.size);
    return (product?.skus || []).find((sku) => skuSizeCandidates(sku, row.productId).has(wanted));
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.productId)) groups.set(row.productId, []);
      groups.get(row.productId).push(row);
    });
    return groups;
  }

  async function resolveGroup(productId, rows) {
    const product = await apiFetch(`/products/${encodeURIComponent(productId)}`);
    rows.forEach((row) => {
      const sku = findExactSku(product, row);
      if (!sku) {
        setRowState(row, "error", `Exacte EU-maat niet gevonden: ${row.size}`);
        return;
      }
      if (Number(sku.stock) <= 0) {
        setRowState(row, "error", `Geen voorraad voor ${row.size}`);
        return;
      }
      row.sku = sku.id;
      row.available = Number(sku.stock);
      if (row.quantity > row.available) {
        setRowState(row, "error", `Gevraagd ${row.quantity}, voorraad ${row.available}`);
        return;
      }
      setRowState(row, "ready", `${sku.id} · voorraad ${row.available}`);
    });
  }

  async function patchCart(productId, rows) {
    const validRows = rows.filter((row) => row.state === "ready");
    if (!validRows.length) return;
    const skuQuantities = {};
    validRows.forEach((row) => {
      skuQuantities[row.sku] = (skuQuantities[row.sku] || 0) + row.quantity;
      setRowState(row, "busy", "Toevoegen...");
    });
    const payload = { request: { [productId]: { skuQuantities } } };
    console.info("[Van de Velde Order Tool] PATCH /gateway/carts", payload);
    try {
      await apiFetch("/carts", { method: "PATCH", body: JSON.stringify(payload) });
      validRows.forEach((row) => setRowState(row, "ok", `${row.quantity}× ${row.sku} toegevoegd`));
    } catch (error) {
      validRows.forEach((row) => setRowState(row, "error", error.message));
    }
  }

  function setRowState(row, state, detail) {
    row.state = state;
    row.detail = detail;
    if (!row.statusCell) return;
    row.statusCell.dataset.state = state;
    row.statusCell.textContent = state === "ok" ? "✓" : state === "error" ? "×" : state === "busy" ? "…" : state === "ready" ? "•" : "";
    row.statusCell.title = detail || "";
  }

  function createInput(field, value) {
    const input = document.createElement("input");
    input.dataset.field = field;
    input.value = value ?? "";
    return input;
  }

  function renderRows(ui, rows) {
    ui.body.replaceChildren();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      [["productId", row.productId], ["size", row.size], ["quantity", row.quantity]].forEach(([field, value]) => {
        const td = document.createElement("td");
        td.append(createInput(field, value));
        tr.append(td);
      });
      const status = document.createElement("td");
      status.className = "vdv-status";
      tr.append(status);
      row.statusCell = status;
      setRowState(row, row.state, row.detail);
      ui.body.append(tr);
    });
    ui.rows = rows;
    ui.order.disabled = !rows.length;
  }

  function readRowsFromTable(ui) {
    return Array.from(ui.body.querySelectorAll("tr")).map((tr) => ({
      productId: normalizeProductId(tr.querySelector('[data-field="productId"]')?.value),
      size: tr.querySelector('[data-field="size"]')?.value.trim() || "",
      quantity: Number(tr.querySelector('[data-field="quantity"]')?.value),
      sku: "",
      state: "idle",
      detail: "",
    })).filter((row) => row.productId || row.size || row.quantity);
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID}{position:fixed!important;right:12px!important;top:60px!important;z-index:999999!important;width:460px!important;max-width:calc(100vw - 24px)!important;padding:10px!important;border:1px solid #cfd7df!important;border-radius:8px!important;background:#fff!important;color:#1f2933!important;box-shadow:0 8px 30px rgba(0,0,0,.16)!important;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important}
      #${PANEL_ID} *{box-sizing:border-box!important}
      #${PANEL_ID} .vdv-title{margin:0 0 8px!important;font-weight:800!important;font-size:15px!important;color:#111827!important}
      #${PANEL_ID} .vdv-actions{display:flex!important;gap:8px!important;margin-bottom:8px!important}
      #${PANEL_ID} button{border:0!important;border-radius:6px!important;color:#fff!important;font-weight:700!important;padding:9px 10px!important;cursor:pointer!important}
      #${PANEL_ID} .vdv-load{width:50%!important;background:#1f6feb!important}
      #${PANEL_ID} .vdv-order{width:50%!important;background:#16a34a!important}
      #${PANEL_ID} button:disabled{background:#9ca3af!important;cursor:not-allowed!important}
      #${PANEL_ID} .vdv-message{min-height:16px!important;margin-top:8px!important;color:#4b5563!important;font-size:12px!important}
      #${PANEL_ID} .vdv-table-wrap{margin-top:8px!important;max-height:300px!important;overflow:auto!important;border:1px solid #e5e7eb!important;border-radius:6px!important}
      #${PANEL_ID} table{width:100%!important;border-collapse:collapse!important;font-size:12px!important}
      #${PANEL_ID} th{position:sticky!important;top:0!important;padding:6px!important;border-bottom:1px solid #e5e7eb!important;background:#f3f4f6!important;text-align:left!important;font-weight:700!important}
      #${PANEL_ID} td{padding:4px!important;border-bottom:1px solid #eef0f2!important;text-align:left!important}
      #${PANEL_ID} input{width:100%!important;padding:4px!important;border:1px solid transparent!important;border-radius:4px!important;background:transparent!important;color:#1f2933!important;font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important}
      #${PANEL_ID} td:first-child input{font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important}
      #${PANEL_ID} td:nth-child(3) input{text-align:right!important}
      #${PANEL_ID} input:focus{border-color:#bfdbfe!important;background:#fff!important;outline:0!important}
      #${PANEL_ID} th:nth-child(1){width:52%!important} #${PANEL_ID} th:nth-child(2){width:23%!important} #${PANEL_ID} th:nth-child(3){width:17%!important}
      #${PANEL_ID} .vdv-status{width:34px!important;text-align:center!important;font-size:17px!important;font-weight:900!important}
      #${PANEL_ID} .vdv-status[data-state="ok"]{color:#16a34a!important} #${PANEL_ID} .vdv-status[data-state="error"]{color:#dc2626!important}
      #${PANEL_ID} .vdv-status[data-state="ready"]{color:#2563eb!important}
      #${PANEL_ID} .vdv-add{width:22px!important;height:22px!important;margin-top:8px!important;padding:0!important;border:1px solid #d1d5db!important;border-radius:999px!important;background:#fff!important;color:#4b5563!important;font-size:15px!important;line-height:1!important;font-weight:600!important}
    `;
    document.head.append(style);
  }

  function createUi() {
    addStyles();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="vdv-title">Van de Velde Order Tool</div>
      <div class="vdv-actions"><button class="vdv-load">Drop items</button><button class="vdv-order" disabled>Bestel items</button></div>
      <div class="vdv-message"></div>
      <div class="vdv-table-wrap"><table><thead><tr><th>Artikel/kleur</th><th>Maat</th><th>Aantal</th><th></th></tr></thead><tbody></tbody></table></div>
      <button class="vdv-add" title="Voeg handmatige regel toe">+</button>
    `;
    document.body.append(panel);
    const ui = {
      panel,
      load: panel.querySelector(".vdv-load"),
      order: panel.querySelector(".vdv-order"),
      add: panel.querySelector(".vdv-add"),
      message: panel.querySelector(".vdv-message"),
      body: panel.querySelector("tbody"),
      rows: [],
    };

    ui.load.addEventListener("click", async () => {
      try {
        const parsed = parseRows(await navigator.clipboard.readText());
        renderRows(ui, parsed.rows);
        ui.message.textContent = parsed.errors.length ? parsed.errors.join(" · ") : `${parsed.rows.length} regel(s) geladen.`;
      } catch (error) {
        ui.message.textContent = `Klembord kon niet worden gelezen: ${error.message}`;
      }
    });

    ui.add.addEventListener("click", () => {
      const rows = readRowsFromTable(ui);
      rows.push({ productId: "", size: "", quantity: 1, sku: "", state: "idle", detail: "" });
      renderRows(ui, rows);
      ui.body.querySelector("tr:last-child input")?.focus();
    });

    ui.order.addEventListener("click", async () => {
      const rows = readRowsFromTable(ui);
      renderRows(ui, rows);
      if (!rows.length) return;
      ui.order.disabled = true;
      ui.message.textContent = "Producten en maten controleren...";
      const groups = groupRows(rows);
      for (const [productId, productRows] of groups) {
        productRows.forEach((row) => setRowState(row, "busy", "Product ophalen..."));
        try {
          await resolveGroup(productId, productRows);
          await patchCart(productId, productRows);
        } catch (error) {
          productRows.forEach((row) => setRowState(row, "error", error.message));
        }
        await sleep(100);
      }
      const failed = rows.filter((row) => row.state === "error").length;
      const succeeded = rows.filter((row) => row.state === "ok").length;
      ui.message.textContent = failed
        ? `${succeeded} gelukt, ${failed} niet gelukt. Houd een kruisje vast voor details.`
        : "Alles toegevoegd. Naar het mandje...";
      if (!failed) {
        setTimeout(() => window.location.assign("/nl/checkout"), 1200);
        return;
      }
      ui.order.disabled = false;
    });

    return ui;
  }

  function init() {
    if (document.getElementById(PANEL_ID)) return;
    createUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
