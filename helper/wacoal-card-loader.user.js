// ==UserScript==
// @name         Wacoal Order Tool
// @version      0.3
// @description  Reads style/size/qty rows from clipboard and adds Wacoal Group items to the cart.
// @match        https://b2b.wacoal-europe.com/b2b/en/EUR/cart*
// @author       C. P. v. Beek + GPT
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = false;
  const ENDPOINT_KEY = "WACOAL_ORDER_TOOL_ENDPOINT_V1";
  const DEFAULT_ENDPOINT = "https://b2b.wacoal-europe.com/b2b/en/EUR/cart/addGrid";
  const log = (...args) => DEBUG && console.log("[WACOAL-ORDER]", ...args);

  function isCartPayload(body) {
    const raw = typeof body === "string" ? body : body instanceof FormData ? "" : String(body || "");
    return raw.includes("cartEntries") && raw.includes("styleProductCode") && raw.includes("selectedCountry");
  }

  function rememberEndpoint(method, url) {
    if (!url) return;
    const absolute = new URL(url, location.href).href;
    const payload = { method: method || "POST", url: absolute, savedAt: Date.now() };
    localStorage.setItem(ENDPOINT_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("wacoal-order-tool-endpoint", { detail: payload }));
    log("Endpoint captured", payload);
  }

  function getEndpoint() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ENDPOINT_KEY) || "null");
      if (parsed?.url) return parsed;
    } catch {}
    return { method: "POST", url: DEFAULT_ENDPOINT, savedAt: 0 };
  }

  function installRequestSniffer() {
    const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    if (w.fetch && !w.fetch.__wacoalOrderToolPatched) {
      const originalFetch = w.fetch;
      const patchedFetch = function (input, init = {}) {
        const method = init?.method || input?.method || "GET";
        const url = typeof input === "string" ? input : input?.url;
        const body = init?.body || input?.body || "";
        if (isCartPayload(body)) rememberEndpoint(method, url);
        return originalFetch.apply(this, arguments);
      };
      patchedFetch.__wacoalOrderToolPatched = true;
      w.fetch = patchedFetch;
    }

    const proto = w.XMLHttpRequest?.prototype;
    if (proto && !proto.__wacoalOrderToolPatched) {
      const open = proto.open;
      const send = proto.send;

      proto.open = function (method, url) {
        this.__wacoalOrderToolMethod = method;
        this.__wacoalOrderToolUrl = url;
        return open.apply(this, arguments);
      };

      proto.send = function (body) {
        if (isCartPayload(body)) rememberEndpoint(this.__wacoalOrderToolMethod, this.__wacoalOrderToolUrl);
        return send.apply(this, arguments);
      };

      proto.__wacoalOrderToolPatched = true;
    }
  }

  function normalizeVariantSize(size) {
    return String(size || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[/-]/g, "");
  }

  function normalizeStyleProductCode(styleProductCode) {
    return String(styleProductCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function convertEuSizeToGlobal(size) {
    const normalized = normalizeVariantSize(size);
    const match = normalized.match(/^(\d{2,3})([A-Z]+)$/);
    if (!match) {
      const apparelSizeMap = {
        32: "6",
        34: "8",
        36: "10",
        38: "12",
        40: "14",
        42: "16",
        44: "18",
        46: "20",
        48: "22",
        50: "24",
        52: "26",
        54: "28",
      };
      return apparelSizeMap[normalized] || normalized;
    }

    const euBand = parseInt(match[1], 10);
    const euCup = match[2];
    const globalBand = String(Math.round(((euBand - 60) / 5) * 2 + 28));
    const cupMap = {
      AA: "AA",
      A: "A",
      B: "B",
      C: "C",
      D: "D",
      E: "DD",
      F: "E",
      G: "F",
      H: "FF",
      I: "G",
      J: "GG",
      K: "H",
      L: "HH",
      M: "J",
      N: "JJ",
      O: "K",
      P: "KK",
      Q: "L",
      R: "LL",
    };

    if (!Number.isFinite(euBand) || !cupMap[euCup]) return normalized;
    return globalBand + cupMap[euCup];
  }

  function buildVariantSku(styleProductCode, size) {
    const style = normalizeStyleProductCode(styleProductCode);
    const variantSize = convertEuSizeToGlobal(size);
    if (!style || !variantSize) return "";
    if (style.endsWith(variantSize)) return style;
    return style + variantSize;
  }

  function parseRows(text) {
    const rows = [];
    const errors = [];

    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const cols = line.split("\t").map((col) => col.trim());
        if (cols.length < 3) {
          errors.push(`Regel ${index + 1}: verwacht style<TAB>maat<TAB>aantal`);
          return;
        }

        const [styleProductCode, size, qtyRaw] = cols;
        const normalizedStyle = normalizeStyleProductCode(styleProductCode);
        const quantity = parseInt(String(qtyRaw).replace(",", "."), 10);
        const sku = buildVariantSku(normalizedStyle, size);

        if (!styleProductCode) errors.push(`Regel ${index + 1}: style ontbreekt`);
        if (styleProductCode && !normalizedStyle) errors.push(`Regel ${index + 1}: style bevat geen bruikbare letters/cijfers`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);

        if (normalizedStyle && size && Number.isFinite(quantity) && quantity > 0) {
          rows.push({ styleProductCode: normalizedStyle, size, quantity, sku });
        }
      });

    return { rows, errors };
  }

  function groupRows(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      if (!groups.has(row.styleProductCode)) groups.set(row.styleProductCode, []);
      groups.get(row.styleProductCode).push(row);
    });

    return groups;
  }

  function getCsrfToken() {
    const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    return (
      w.ACC?.config?.CSRFToken ||
      document.querySelector('meta[name="_csrf"]')?.content ||
      document.querySelector('meta[name="csrf-token"]')?.content ||
      document.querySelector('input[name="CSRFToken"]')?.value ||
      document.querySelector('input[name="_csrf"]')?.value ||
      ""
    );
  }

  async function postCartEntries(endpoint, styleProductCode, rows) {
    const body = {
      cartEntries: rows.map((row, index) => ({
        sku: row.sku,
        entryNumber: index,
        quantity: String(row.quantity),
      })),
      styleProductCode,
      selectedCountry: "EU",
    };

    const csrf = getCsrfToken();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (csrf) {
      headers.CSRFToken = csrf;
      headers["X-CSRF-TOKEN"] = csrf;
    }

    const res = await fetch(endpoint.url, {
      method: endpoint.method || "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 220)} | ${text.slice(0, 160)}`);
    }

    return data || text;
  }

  function setRowsState(rows, state, detail = "") {
    rows.forEach((row) => {
      const cell = row.statusCell;
      if (!cell) return;
      cell.textContent = state === "ok" ? "✓" : state === "error" ? "×" : state === "busy" ? "…" : "";
      cell.title = detail;
      cell.style.color = state === "ok" ? "#16a34a" : state === "error" ? "#dc2626" : "#6b7280";
    });
  }

  function setOrderButtonReady(button, ready) {
    button.disabled = !ready;
    button.style.background = ready ? "#16a34a" : "#9ca3af";
    button.style.cursor = ready ? "pointer" : "not-allowed";
  }

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      [
        ["styleProductCode", row.styleProductCode],
        ["size", row.size],
        ["quantity", row.quantity],
      ].forEach(([field, value], index) => {
        const td = document.createElement("td");
        td.style.cssText = "border-bottom:1px solid #eef0f2;padding:4px;";

        const input = document.createElement("input");
        input.dataset.field = field;
        input.value = String(value ?? "");
        input.style.cssText = [
          "width:100%",
          "border:1px solid transparent",
          "border-radius:4px",
          "background:transparent",
          "padding:4px",
          "font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif",
          index === 0 ? "font-family:ui-monospace,SFMono-Regular,Consolas,monospace" : "",
          index === 2 ? "text-align:right" : "",
        ].filter(Boolean).join(";");

        input.addEventListener("focus", () => {
          input.style.borderColor = "#bfdbfe";
          input.style.background = "#fff";
        });
        input.addEventListener("blur", () => {
          input.style.borderColor = "transparent";
          input.style.background = "transparent";
        });

        td.appendChild(input);
        tr.appendChild(td);
      });

      const statusCell = document.createElement("td");
      statusCell.style.cssText = "border-bottom:1px solid #eef0f2;padding:6px;text-align:center;width:34px;font-weight:800;font-size:16px;";
      statusCell.title = row.sku || "";
      row.statusCell = statusCell;
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function readRowsFromTable(tableBody) {
    const text = Array.from(tableBody.querySelectorAll("tr"))
      .map((tr) => {
        const style = tr.querySelector('input[data-field="styleProductCode"]')?.value || "";
        const size = tr.querySelector('input[data-field="size"]')?.value || "";
        const qty = tr.querySelector('input[data-field="quantity"]')?.value || "";
        return [style, size, qty].join("\t");
      })
      .join("\n");

    return parseRows(text);
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:fixed",
      "right:12px",
      "top:60px",
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
    title.textContent = "Wacoal Order Tool";
    title.style.cssText = "font-weight:800;font-size:15px;margin-bottom:8px;color:#111827;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-bottom:8px;";

    const dropButton = document.createElement("button");
    dropButton.type = "button";
    dropButton.textContent = "Drop items";
    dropButton.style.cssText = "width:50%;border:0;border-radius:6px;background:#1f6feb;color:#fff;font-weight:700;padding:9px 10px;cursor:pointer;";

    const orderButton = document.createElement("button");
    orderButton.type = "button";
    orderButton.textContent = "Bestel items";
    orderButton.style.cssText = "width:50%;border:0;border-radius:6px;background:#9ca3af;color:#fff;font-weight:700;padding:9px 10px;cursor:not-allowed;";
    orderButton.disabled = true;

    actions.appendChild(dropButton);
    actions.appendChild(orderButton);

    const message = document.createElement("div");
    message.style.cssText = "margin-top:8px;color:#4b5563;font-size:12px;min-height:16px;";
    message.textContent = "";

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "margin-top:8px;max-height:300px;overflow:auto;border-radius:6px;border:1px solid #e5e7eb;";

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Style</th><th>Maat</th><th>Aantal</th><th></th></tr>";
    thead.querySelectorAll("th").forEach((th) => {
      th.style.cssText = "position:sticky;top:0;background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:6px;text-align:left;font-weight:700;";
    });

    const tableBody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tableBody);
    tableWrap.appendChild(table);

    const addRowButton = document.createElement("button");
    addRowButton.type = "button";
    addRowButton.textContent = "+";
    addRowButton.title = "Voeg handmatige regel toe";
    addRowButton.style.cssText = "margin-top:8px;width:22px;height:22px;border:1px solid #d1d5db;border-radius:999px;background:#fff;color:#4b5563;font-size:15px;line-height:1;font-weight:600;cursor:pointer;padding:0;";

    panel.appendChild(title);
    panel.appendChild(actions);
    panel.appendChild(message);
    panel.appendChild(tableWrap);
    panel.appendChild(addRowButton);
    document.body.appendChild(panel);

    window.addEventListener("wacoal-order-tool-endpoint", () => {
      if (message.textContent.includes("Endpoint onbekend")) message.textContent = "";
    });

    return { dropButton, orderButton, addRowButton, message, tableBody };
  }

  async function dropItems(ui) {
    const parsed = parseRows(await navigator.clipboard.readText());
    if (parsed.errors.length) {
      ui.tableBody.innerHTML = "";
      ui.message.textContent = `Fouten in klembord: ${parsed.errors.join(" | ")}`;
      setOrderButtonReady(ui.orderButton, false);
      return;
    }

    renderRows(parsed.rows, ui.tableBody);
    ui.message.textContent = `${parsed.rows.length} regel(s) geladen.`;
    setOrderButtonReady(ui.orderButton, parsed.rows.length > 0);
  }

  async function orderItems(ui) {
    const endpoint = getEndpoint();
    if (!endpoint) {
      ui.message.textContent = "Endpoint onbekend.";
      return;
    }

    const parsed = readRowsFromTable(ui.tableBody);
    if (parsed.errors.length) {
      ui.message.textContent = `Fouten in tabel: ${parsed.errors.join(" | ")}`;
      return;
    }

    renderRows(parsed.rows, ui.tableBody);
    const groups = groupRows(parsed.rows);
    const failedRows = new Set();
    ui.message.textContent = "Bestellen bezig...";

    for (const [styleProductCode, rows] of groups.entries()) {
      setRowsState(rows, "busy", "Toevoegen");
      try {
        await postCartEntries(endpoint, styleProductCode, rows);
        setRowsState(rows, "ok", "Toegevoegd");
      } catch (err) {
        setRowsState(rows, "error", err?.message || "Toevoegen mislukt");
        rows.forEach((row) => failedRows.add(row));
      }
    }

    if (failedRows.size) {
      ui.message.textContent = `${failedRows.size} regel(s) niet gelukt.`;
      return;
    }

    ui.message.textContent = "Alles toegevoegd. Pagina wordt ververst...";
    setTimeout(() => location.reload(), 1200);
  }

  function initUi() {
    const ui = createPanel();

    ui.dropButton.addEventListener("click", async () => {
      ui.dropButton.disabled = true;
      try {
        await dropItems(ui);
      } catch (err) {
        ui.message.textContent = `Fout: ${err?.message || err}`;
      } finally {
        ui.dropButton.disabled = false;
      }
    });

    ui.orderButton.addEventListener("click", async () => {
      if (ui.orderButton.disabled) return;
      ui.dropButton.disabled = true;
      ui.orderButton.disabled = true;
      try {
        await orderItems(ui);
      } catch (err) {
        ui.message.textContent = `Fout: ${err?.message || err}`;
      } finally {
        ui.dropButton.disabled = false;
        setOrderButtonReady(ui.orderButton, ui.tableBody.querySelectorAll("tr").length > 0);
      }
    });

    ui.addRowButton.addEventListener("click", () => {
      const rows = readRowsFromTable(ui.tableBody).rows;
      rows.push({ styleProductCode: "", size: "", quantity: "", sku: "" });
      renderRows(rows, ui.tableBody);
      setOrderButtonReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });
  }

  installRequestSniffer();
  window.addEventListener("DOMContentLoaded", () => setTimeout(initUi, 500));
})();
