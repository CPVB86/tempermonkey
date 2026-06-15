// ==UserScript==
// @name         Mey Order Tool
// @version      0.6
// @description  Reads Mey article-color/size/qty rows from clipboard and adds exact matches through Mey's own matrix.
// @match        https://meyb2b.com/*
// @match        https://www.meyb2b.com/*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/mey-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/mey-card-loader.user.js
// @author       C. P. v. Beek + GPT
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const FALLBACK_CONTEXT =
    "ME:NO/discover/NO:cf748940-f13d-4cdc-96cf-0b66f4febadb_1::ME|385468|300425|1";
  const CART_HASH = `#${FALLBACK_CONTEXT}/cart`;
  const PANEL_ID = "mey-order-tool";
  const STYLE_ID = "mey-order-tool-styles";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
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
          errors.push(`Regel ${index + 1}: verwacht artikel-kleur<TAB>maat<TAB>aantal`);
          return;
        }

        const [productRef, size, quantityRaw] = cols;
        const quantity = parseInt(String(quantityRaw).replace(",", "."), 10);
        const product = parseProductRef(productRef);

        if (!productRef) errors.push(`Regel ${index + 1}: artikel-kleur ontbreekt`);
        if (!product.article) errors.push(`Regel ${index + 1}: artikel ontbreekt`);
        if (!product.color) errors.push(`Regel ${index + 1}: kleur ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);
        }

        if (product.article && product.color && size && Number.isFinite(quantity) && quantity > 0) {
          rows.push({
            productRef,
            article: product.article,
            color: product.color,
            size,
            quantity,
          });
        }
      });

    return { rows, errors };
  }

  function parseProductRef(productRef) {
    const text = String(productRef || "").trim();
    const meyKey = decodeURIComponent(text).match(/ME;NO;([^;]+);\*\/([^/?#]+)/i);
    if (meyKey) return { article: meyKey[1], color: meyKey[2] };

    const match = text.match(/^(.+)-([^-]+)$/);
    return match
      ? { article: match[1].trim(), color: match[2].trim() }
      : { article: text, color: "" };
  }

  function currentContext() {
    const hash = decodeURIComponent(location.hash || "");
    const match = hash.match(/^#?(.+?)\/ME;NO;[^/]+;\*\/[^/]+(?:\/|$)/i);
    if (match?.[1]) return encodeContext(match[1]);
    return FALLBACK_CONTEXT;
  }

  function encodeContext(context) {
    return String(context || "")
      .replace(/ME\|/g, "ME|")
      .replace(/\s/g, "");
  }

  function productHash(row) {
    const articleKey = encodeURIComponent(`ME;NO;${row.article};*`);
    return `#${currentContext()}/${articleKey}/${encodeURIComponent(row.color)}`;
  }

  function productKey(row) {
    return `${normalize(row.article)}-${normalize(row.color)}`;
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = productKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  async function navigateToProduct(row) {
    const wantedHash = productHash(row);
    if (location.hash !== wantedHash) {
      location.hash = wantedHash;
    }

    await waitForProduct(row);
  }

  async function waitForProduct(row, timeoutMs = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const articleText = document.body.textContent || "";
      const decodedHash = decodeURIComponent(location.hash || "");
      const routeOk = decodedHash.includes(`ME;NO;${row.article};*/${row.color}`);
      const articleOk = new RegExp(`Art\\.-Nr\\.\\s*:\\s*${escapeRegExp(row.article)}`, "i").test(articleText) ||
        articleText.includes(row.article);
      const colorOk = new RegExp(`Kleur\\s*:\\s*${escapeRegExp(row.color)}(?:\\s|$)`, "i").test(articleText);
      if (routeOk && articleOk && colorOk && findSizeCell(row)) return;
      await sleep(300);
    }
    throw new Error(`Product niet geladen: ${row.productRef}`);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findSizeCell(row) {
    const wantedSize = normalize(row.size);
    const cells = Array.from(document.querySelectorAll("td.OrderGridCellView"));
    return cells.find((cell) => {
      const size = cell.querySelector(".size")?.getAttribute("rel") ||
        cell.querySelector(".size")?.textContent ||
        "";
      return normalize(size) === wantedSize;
    }) || null;
  }

  function readCellQuantity(cell) {
    const value = parseInt(cell.querySelector(".cellContent")?.textContent || "", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function dispatchMouseClick(element) {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    };

    ["mousedown", "mouseup", "click"].forEach((type) => {
      element.dispatchEvent(new view.MouseEvent(type, eventOptions));
    });
  }

  function dispatchPointerTap(element) {
    const view = element.ownerDocument.defaultView;
    if (typeof view.PointerEvent !== "function") return false;

    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };

    element.dispatchEvent(new view.PointerEvent("pointerdown", options));
    element.dispatchEvent(new view.PointerEvent("pointerup", {
      ...options,
      buttons: 0,
    }));
    return true;
  }

  async function triggerMeyClick(element, row, before) {
    dispatchPointerTap(element);

    const tapStartedAt = Date.now();
    while (Date.now() - tapStartedAt < 1500) {
      await sleep(100);
      const freshCell = findSizeCell(row);
      if (freshCell && readCellQuantity(freshCell) >= before + 1) return;
    }

    dispatchMouseClick(element);
  }

  function isCellOrderable(cell) {
    return Boolean(cell.querySelector(".plusQuantity")) &&
      !/\bstockLevel0\b/i.test(cell.className) &&
      !/niet beschikbaar|not available|uitverkocht/i.test(cell.textContent || "");
  }

  async function clickPlus(row) {
    const cell = findSizeCell(row);
    if (!cell) throw new Error(`Exacte maat niet gevonden: ${row.size}`);
    if (!isCellOrderable(cell)) throw new Error(`Niet bestelbaar: ${row.size}`);

    const before = readCellQuantity(cell);
    const plus = cell.querySelector(".plusQuantity");
    await triggerMeyClick(plus || cell, row, before);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 6000) {
      await sleep(250);
      const freshCell = findSizeCell(row);
      if (freshCell && readCellQuantity(freshCell) >= before + 1) {
        return;
      }
    }

    throw new Error(`Niet zichtbaar bevestigd: ${row.size}`);
  }

  async function addRow(row) {
    for (let i = 0; i < row.quantity; i += 1) {
      await clickPlus(row);
      await sleep(350);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}, #${PANEL_ID} * { box-sizing:border-box!important; letter-spacing:0!important; }
      #${PANEL_ID} { position:fixed!important;right:12px!important;top:70px!important;z-index:2147483647!important;width:460px!important;max-width:calc(100vw - 24px)!important;padding:10px!important;border:1px solid #cfd7df!important;border-radius:8px!important;background:#fff!important;color:#1f2933!important;box-shadow:0 8px 30px rgba(0,0,0,.16)!important;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #${PANEL_ID} .mey-title { margin:0 0 8px!important;color:#111827!important;font:800 15px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #${PANEL_ID} .mey-actions { display:flex!important;gap:8px!important;margin-bottom:8px!important; }
      #${PANEL_ID} button { appearance:none!important;box-shadow:none!important;text-transform:none!important;letter-spacing:0!important; }
      #${PANEL_ID} .mey-main { display:inline-flex!important;align-items:center!important;justify-content:center!important;width:50%!important;min-height:36px!important;margin:0!important;padding:9px 10px!important;border:0!important;border-radius:6px!important;color:#fff!important;font:700 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #${PANEL_ID} .mey-drop { background:#1f6feb!important;cursor:pointer!important; }
      #${PANEL_ID} .mey-order { background:#9ca3af!important;cursor:not-allowed!important; }
      #${PANEL_ID} .mey-order.is-ready { background:#16a34a!important;cursor:pointer!important; }
      #${PANEL_ID} .mey-message { min-height:16px!important;margin:8px 0 0!important;color:#4b5563!important;font-size:12px!important; }
      #${PANEL_ID} .mey-table { max-height:300px!important;margin-top:8px!important;overflow:auto!important;border:1px solid #e5e7eb!important;border-radius:6px!important; }
      #${PANEL_ID} table { width:100%!important;margin:0!important;border-collapse:collapse!important;font-size:12px!important; }
      #${PANEL_ID} th { position:sticky!important;top:0!important;padding:6px!important;border-bottom:1px solid #e5e7eb!important;background:#f3f4f6!important;text-align:left!important; }
      #${PANEL_ID} td { padding:4px!important;border-bottom:1px solid #eef0f2!important;background:#fff!important; }
      #${PANEL_ID} input { width:100%!important;min-height:24px!important;margin:0!important;padding:4px!important;border:1px solid transparent!important;border-radius:4px!important;background:transparent!important;color:#1f2933!important;box-shadow:none!important;font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #${PANEL_ID} input:focus { border-color:#bfdbfe!important;background:#fff!important;outline:0!important; }
      #${PANEL_ID} .mey-product { font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important; }
      #${PANEL_ID} .mey-qty { text-align:right!important; }
      #${PANEL_ID} .mey-status { width:34px!important;min-width:34px!important;text-align:center!important;font-size:17px!important;font-weight:900!important; }
      #${PANEL_ID} .mey-status[data-state="ok"] { color:#16a34a!important; }
      #${PANEL_ID} .mey-status[data-state="error"] { color:#dc2626!important; }
      #${PANEL_ID} .mey-add { display:inline-flex!important;align-items:center!important;justify-content:center!important;width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;margin:8px 0 0!important;padding:0!important;border:1px solid #d1d5db!important;border-radius:999px!important;background:#fff!important;color:#4b5563!important;font:600 15px/1 system-ui,-apple-system,Segoe UI,sans-serif!important;cursor:pointer!important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function setOrderReady(button, ready) {
    button.disabled = !ready;
    button.classList.toggle("is-ready", ready);
  }

  function setRowsState(rows, state, detail = "") {
    rows.forEach((row) => {
      if (!row.statusCell) return;
      row.statusCell.textContent = state === "ok" ? "\u2713" : state === "error" ? "\u00d7" : state === "busy" ? "..." : "";
      row.statusCell.dataset.state = state;
      row.statusCell.title = detail;
    });
  }

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      [
        ["productRef", row.productRef],
        ["size", row.size],
        ["quantity", row.quantity],
      ].forEach(([field, value], index) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.dataset.field = field;
        input.value = String(value ?? "");
        input.className = index === 0 ? "mey-product" : index === 2 ? "mey-qty" : "";
        td.appendChild(input);
        tr.appendChild(td);
      });
      const statusCell = document.createElement("td");
      statusCell.className = "mey-status";
      row.statusCell = statusCell;
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function readTable(tableBody) {
    const text = Array.from(tableBody.querySelectorAll("tr"))
      .map((tr) => [
        tr.querySelector('[data-field="productRef"]')?.value || "",
        tr.querySelector('[data-field="size"]')?.value || "",
        tr.querySelector('[data-field="quantity"]')?.value || "",
      ].join("\t"))
      .join("\n");
    return parseRows(text);
  }

  function createPanel() {
    injectStyles();
    if (document.getElementById(PANEL_ID)) return getPanelUi();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="mey-title">Mey Order Tool <span style="font-weight:500;color:#6b7280">v0.6</span></div>
      <div class="mey-actions">
        <button type="button" class="mey-main mey-drop">Drop items</button>
        <button type="button" class="mey-main mey-order" disabled>Bestel items</button>
      </div>
      <div class="mey-message"></div>
      <div class="mey-table">
        <table>
          <thead><tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <button type="button" class="mey-add" title="Voeg handmatige regel toe">+</button>
    `;
    document.documentElement.appendChild(panel);

    const ui = getPanelUi();
    ui.dropButton.addEventListener("click", async () => {
      try {
        await dropItems(ui);
      } catch (error) {
        ui.message.textContent = `Fout: ${error?.message || error}`;
      }
    });
    ui.orderButton.addEventListener("click", () => orderItems(ui));
    ui.addButton.addEventListener("click", () => {
      const rows = readTable(ui.tableBody).rows;
      rows.push({ productRef: "", article: "", color: "", size: "", quantity: "" });
      renderRows(rows, ui.tableBody);
      setOrderReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });
    return ui;
  }

  function getPanelUi() {
    const panel = document.getElementById(PANEL_ID);
    return {
      panel,
      dropButton: panel?.querySelector(".mey-drop"),
      orderButton: panel?.querySelector(".mey-order"),
      addButton: panel?.querySelector(".mey-add"),
      message: panel?.querySelector(".mey-message"),
      tableBody: panel?.querySelector("tbody"),
    };
  }

  async function dropItems(ui) {
    const parsed = parseRows(await navigator.clipboard.readText());
    if (parsed.errors.length) {
      ui.tableBody.innerHTML = "";
      ui.message.textContent = `Fouten in klembord: ${parsed.errors.join(" | ")}`;
      setOrderReady(ui.orderButton, false);
      return;
    }
    renderRows(parsed.rows, ui.tableBody);
    ui.message.textContent = `${parsed.rows.length} regel(s) geladen.`;
    setOrderReady(ui.orderButton, parsed.rows.length > 0);
  }

  async function orderItems(ui) {
    const parsed = readTable(ui.tableBody);
    if (parsed.errors.length) {
      ui.message.textContent = `Fouten in tabel: ${parsed.errors.join(" | ")}`;
      return;
    }

    renderRows(parsed.rows, ui.tableBody);
    const failedRows = new Set();
    ui.message.textContent = "Bestellen bezig...";

    productLoop:
    for (const rows of groupRows(parsed.rows).values()) {
      setRowsState(rows, "busy", "Product openen");
      try {
        await navigateToProduct(rows[0]);
      } catch (error) {
        setRowsState(rows, "error", error?.message || "Product openen mislukt");
        rows.forEach((row) => failedRows.add(row));
        continue;
      }

      for (const row of rows) {
        setRowsState([row], "busy", "Toevoegen");
        try {
          await addRow(row);
          setRowsState([row], "ok", "Toegevoegd");
        } catch (error) {
          setRowsState([row], "error", error?.message || "Toevoegen mislukt");
          failedRows.add(row);
          break productLoop;
        }
      }
    }

    if (failedRows.size) {
      ui.message.textContent = `${failedRows.size} regel(s) niet gelukt. Niet automatisch ververst.`;
      return;
    }

    ui.message.textContent = "Alles toegevoegd. Winkelmand wordt geopend...";
    await sleep(500);
    location.hash = CART_HASH;
  }

  function keepPanelMounted() {
    createPanel();
    const observer = new MutationObserver(() => {
      if (!document.getElementById(PANEL_ID)) createPanel();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(createPanel, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", keepPanelMounted, { once: true });
  } else {
    keepPanelMounted();
  }
})();
