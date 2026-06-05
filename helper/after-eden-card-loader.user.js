// ==UserScript==
// @name         After Eden Cart Loader
// @version      1.6
// @description  Reads After Eden item/size/qty rows from clipboard and adds exact matches to the basket.
// @match        https://bcg.fashionportal.shop/basket
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/after-eden-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/after-eden-card-loader.user.js
// @author       C. P. v. Beek + GPT
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  function injectStyles() {
    if (document.getElementById("after-eden-order-tool-styles")) return;

    const style = document.createElement("style");
    style.id = "after-eden-order-tool-styles";
    style.textContent = `
      #after-eden-order-tool,
      #after-eden-order-tool * {
        box-sizing: border-box !important;
        letter-spacing: 0 !important;
      }

      #after-eden-order-tool {
        position: fixed !important;
        right: 12px !important;
        top: 60px !important;
        z-index: 999999 !important;
        width: 460px !important;
        max-width: calc(100vw - 24px) !important;
        padding: 10px !important;
        border: 1px solid #cfd7df !important;
        border-radius: 8px !important;
        background: #fff !important;
        color: #1f2933 !important;
        box-shadow: 0 8px 30px rgba(0,0,0,.16) !important;
        font: 13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif !important;
      }

      #after-eden-order-tool .ae-title {
        margin: 0 0 8px !important;
        color: #111827 !important;
        font: 800 15px/1.35 system-ui,-apple-system,Segoe UI,sans-serif !important;
      }

      #after-eden-order-tool .ae-actions {
        display: flex !important;
        gap: 8px !important;
        margin: 0 0 8px !important;
      }

      #after-eden-order-tool .ae-button {
        appearance: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 50% !important;
        min-height: 36px !important;
        margin: 0 !important;
        padding: 9px 10px !important;
        border: 0 !important;
        border-radius: 6px !important;
        color: #fff !important;
        font: 700 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif !important;
        text-align: center !important;
        text-decoration: none !important;
        box-shadow: none !important;
        cursor: pointer !important;
        min-width: unset !important;
      }

      #after-eden-order-tool .ae-button-drop {
        background: #1f6feb !important;
      }

      #after-eden-order-tool .ae-button-order {
        background: #9ca3af !important;
        cursor: not-allowed !important;
      }

      #after-eden-order-tool .ae-button-order.is-ready {
        background: #16a34a !important;
        cursor: pointer !important;
      }

      #after-eden-order-tool .ae-button:disabled {
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      #after-eden-order-tool .ae-message {
        min-height: 16px !important;
        margin: 8px 0 0 !important;
        color: #4b5563 !important;
        font: 12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif !important;
      }

      #after-eden-order-tool .ae-table-wrap {
        max-height: 300px !important;
        margin-top: 8px !important;
        overflow: auto !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 6px !important;
      }

      #after-eden-order-tool table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 0 !important;
        font-size: 12px !important;
      }

      #after-eden-order-tool th {
        position: sticky !important;
        top: 0 !important;
        padding: 6px !important;
        border-bottom: 1px solid #e5e7eb !important;
        background: #f3f4f6 !important;
        color: #1f2933 !important;
        font-weight: 700 !important;
        text-align: left !important;
      }

      #after-eden-order-tool td {
        padding: 4px !important;
        border-bottom: 1px solid #eef0f2 !important;
        background: #fff !important;
        color: #1f2933 !important;
        vertical-align: middle !important;
      }

      #after-eden-order-tool input {
        width: 100% !important;
        min-height: 24px !important;
        margin: 0 !important;
        padding: 4px !important;
        border: 1px solid transparent !important;
        border-radius: 4px !important;
        background: transparent !important;
        color: #1f2933 !important;
        box-shadow: none !important;
        font: 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif !important;
      }

      #after-eden-order-tool input:focus {
        border-color: #bfdbfe !important;
        background: #fff !important;
        outline: 0 !important;
      }

      #after-eden-order-tool .ae-mono {
        font-family: ui-monospace,SFMono-Regular,Consolas,monospace !important;
      }

      #after-eden-order-tool .ae-number {
        text-align: right !important;
      }

      #after-eden-order-tool .ae-status {
        width: 34px !important;
        min-width: 34px !important;
        padding: 6px !important;
        text-align: center !important;
        font-size: 17px !important;
        font-weight: 900 !important;
        line-height: 1 !important;
      }

      #after-eden-order-tool .ae-status[data-state="ok"] {
        color: #16a34a !important;
      }

      #after-eden-order-tool .ae-status[data-state="error"] {
        color: #dc2626 !important;
      }

      #after-eden-order-tool .ae-status[data-state="busy"] {
        color: #6b7280 !important;
      }

      #after-eden-order-tool .ae-add-row {
        appearance: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 22px !important;
        height: 22px !important;
        min-width: 22px !important;
        min-height: 22px !important;
        margin: 8px 0 0 !important;
        padding: 0 !important;
        border: 1px solid #d1d5db !important;
        border-radius: 999px !important;
        background: #fff !important;
        color: #4b5563 !important;
        box-shadow: none !important;
        font: 600 15px/1 system-ui,-apple-system,Segoe UI,sans-serif !important;
        cursor: pointer !important;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeSize(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[/-]/g, "");
  }

  function parseProductRef(raw) {
    const text = String(raw || "").trim();

    if (/^https?:\/\//i.test(text) || text.startsWith("/")) {
      const url = new URL(text, location.origin);
      const parentItemNo = guessParentItemNoFromUrl(url.href);
      return { productUrl: url.href, parentItemNo, fromUrl: true };
    }

    const parentItemNo = text.toUpperCase();
    const digits = parentItemNo.replace(/\D/g, "");
    return {
      productUrl: digits ? `/item/${digits}` : "",
      parentItemNo,
    };
  }

  function guessParentItemNoFromUrl(url) {
    try {
      const u = new URL(url, location.origin);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = decodeURIComponent(parts[parts.length - 1] || "");
      return formatNumericItemNo(last) || last || "";
    } catch {
      return "";
    }
  }

  function formatNumericItemNo(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length !== 11) return "";
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 8)}-${digits.slice(8, 11)}`;
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
          errors.push(`Regel ${index + 1}: verwacht artikel/URL<TAB>maat<TAB>aantal`);
          return;
        }

        const [productRaw, size, qtyRaw] = cols;
        const product = parseProductRef(productRaw);
        const quantity = parseInt(String(qtyRaw).replace(",", "."), 10);

        if (!product.productUrl && !product.parentItemNo) errors.push(`Regel ${index + 1}: artikel of URL ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);

        if ((product.productUrl || product.parentItemNo) && size && Number.isFinite(quantity) && quantity > 0) {
          rows.push({
            productUrl: product.productUrl,
            parentItemNo: product.parentItemNo,
            fromUrl: !!product.fromUrl,
            size: String(size).trim(),
            quantity,
          });
        }
      });

    return { rows, errors };
  }

  function groupRows(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      const parentItemNo = row.parentItemNo || guessParentItemNoFromUrl(row.productUrl);
      const split = splitParentForCompare(parentItemNo);
      const key = split.item || parentItemNo || row.productUrl;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    return groups;
  }

  async function fetchProductForm(row) {
    const itemNumber = row.parentItemNo || guessParentItemNoFromUrl(row.productUrl);
    const url = `/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
    });

    const html = await res.text();
    if (!res.ok) throw new Error(`Matrix ophalen mislukt: HTTP ${res.status}`);

    const doc = new DOMParser().parseFromString(html, "text/html");
    const form = doc.querySelector('form[action*="/basket"]') || doc.querySelector('form[name="addToBasket"]');

    if (!form) throw new Error("Geen After Eden basketformulier gevonden in matrix");
    return form;
  }

  function textOf(el) {
    return String(el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getTableLabels(input) {
    const td = input.closest("td, th");
    const tr = input.closest("tr");
    const table = input.closest("table");
    if (!td || !tr || !table) return [];

    const labels = [];
    const cells = Array.from(tr.children);
    const cellIndex = cells.indexOf(td);
    const rowLabel = textOf(tr.querySelector("th"));
    const headerRows = Array.from(table.querySelectorAll("thead tr"));
    const headerLabels = headerRows
      .map((headerRow) => textOf(headerRow.children[cellIndex]))
      .filter(Boolean);

    headerLabels.forEach((colLabel) => {
      if (rowLabel) {
        labels.push(`${colLabel}${rowLabel}`, `${rowLabel}${colLabel}`);
      }
      labels.push(colLabel);
    });

    if (rowLabel) labels.push(rowLabel);
    return labels;
  }

  function getCandidateLabels(input) {
    const labels = [];
    const id = input.id || "";

    if (id) labels.push(textOf(input.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)));

    ["size", "maat", "data-size", "data-maat", "data-label", "aria-label", "title"].forEach((name) => {
      labels.push(input.getAttribute(name));
    });

    labels.push(...getTableLabels(input));
    return labels.filter(Boolean);
  }

  function normalizeParentItemNo(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function getProductBlocks(form, row) {
    const target = normalizeParentItemNo(row.parentItemNo);
    const blocks = Array.from(form.querySelectorAll(".selectqty-wrap"));
    if (!target || !blocks.length) return [form];

    const exactBlocks = blocks.filter((block) => {
      const visibleSku = normalizeParentItemNo(block.querySelector(".pro-sku .nuMber, .pro-sku .number, .pro-sku span")?.textContent || "");
      return visibleSku === target;
    });

    return exactBlocks.length ? exactBlocks : [];
  }

  function findExact3DInput(root, size) {
    const match = normalizeSize(size).match(/^(\d{2,3})([A-Z]+)$/);
    if (!match) return null;

    const targetBand = match[1];
    const targetCup = match[2];
    const containers = Array.from(root.querySelectorAll(".qty-by-size"));

    for (const container of containers) {
      const rows = Array.from(container.querySelectorAll(".qty-by-size-3D"));
      if (rows.length < 2) continue;

      const bands = Array.from(rows[0].querySelectorAll(".size-for:not(.cup-size)"))
        .map((el) => normalizeSize(el.textContent))
        .filter(Boolean);
      const bandIndex = bands.indexOf(targetBand);
      if (bandIndex === -1) continue;

      for (const row of rows.slice(1)) {
        const cup = normalizeSize(row.querySelector(".cup-size")?.textContent || "");
        if (cup !== targetCup) continue;

        const inputs = Array.from(row.querySelectorAll('input[name^="proquantity_"]'));
        return inputs[bandIndex] || null;
      }
    }

    return null;
  }

  function findExactInput(form, row) {
    const blocks = getProductBlocks(form, row);
    if (!blocks.length) return null;

    for (const block of blocks) {
      const exact3D = findExact3DInput(block, row.size);
      if (exact3D) return exact3D;
    }

    const target = normalizeSize(row.size);
    const inputs = blocks.flatMap((block) => Array.from(block.querySelectorAll('input[name^="proquantity_"]')));

    for (const input of inputs) {
      const labels = getCandidateLabels(input);
      if (labels.some((label) => normalizeSize(label) === target)) return input;
    }

    return null;
  }

  function buildPostBody(form, rows) {
    const body = new URLSearchParams();
    const selected = new Map(rows.map((row) => [row.resolvedInputName, String(row.quantity)]));
    const selectedBlocks = new Set(rows.map((row) => row.resolvedBlock).filter(Boolean));
    const selectedVariantIds = new Set(
      Array.from(selected.keys())
        .map((name) => String(name).match(/^proquantity_(.+)$/i)?.[1])
        .filter(Boolean)
    );

    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const name = el.name || "";
      if (!name) return;

      const productBlock = el.closest(".selectqty-wrap");
      if (selectedBlocks.size && productBlock && !selectedBlocks.has(productBlock)) return;

      if (/^proquantity_/i.test(name)) {
        if (selected.has(name)) body.set(name, selected.get(name));
        return;
      }

      const priceVariantId = name.match(/^proprice_(.+)$/i)?.[1];
      if (priceVariantId) {
        if (selectedVariantIds.has(priceVariantId)) body.set(name, el.value || "");
        return;
      }

      body.set(name, el.value || "");
    });

    return body;
  }

  async function postRows(form, rows) {
    const action = new URL(form.getAttribute("action") || "/basket", location.origin).href;
    const res = await fetch(action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: buildPostBody(form, rows).toString(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`After Eden POST mislukt: HTTP ${res.status} ${text.slice(0, 120)}`);
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") parsed.__rawText = text;
      return parsed;
    } catch {
      return text;
    }
  }

  function normalizeCompare(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function splitParentForCompare(parentItemNo) {
    const raw = String(parentItemNo || "");
    const idx = raw.lastIndexOf("-");
    if (idx === -1) return { item: raw, color: "" };
    return { item: raw.slice(0, idx), color: raw.slice(idx + 1) };
  }

  function responseConfirmsRow(response, row) {
    if (!response || !Array.isArray(response.products)) return true;

    const split = splitParentForCompare(row.parentItemNo);
    const wantedItem = normalizeCompare(split.item || row.parentItemNo);
    const wantedColor = normalizeCompare(split.color);

    return response.products.some((product) => {
      const haystack = normalizeCompare([
        product.ITEMNUMBER,
        product.COLOR,
        product.FIRSTLINE,
        product.SECONDLINE,
        product.THIRDLINE,
      ].join(" "));

      return haystack.includes(wantedItem) && (!wantedColor || haystack.includes(wantedColor));
    });
  }

  function responseHasStockIssue(response) {
    const text = typeof response === "string" ? response : JSON.stringify(response || {});
    return /onvoldoende voorraad|insufficient stock|niet voldoende voorraad|maximaal beschikbare hoeveelheid|quantity.*adjusted/i.test(text);
  }

  function parseIntegerAttr(input, names) {
    for (const name of names) {
      const raw = input.getAttribute(name);
      if (raw == null || raw === "") continue;
      const n = parseInt(String(raw).replace(",", "."), 10);
      if (Number.isFinite(n)) return n;
    }

    return null;
  }

  function getKnownAvailableQty(input) {
    return parseIntegerAttr(input, [
      "max",
      "data-max",
      "data-stock",
      "data-in-stock",
      "data-available",
      "data-availability",
      "data-qty",
      "data-quantity",
      "data-inventory",
      "data-maxqty",
      "data-max-qty",
      "data-maxquantity",
      "data-max-quantity",
    ]);
  }

  function getOrderability(input, requestedQty) {
    if (input.disabled || input.readOnly) return { ok: false, detail: "Niet bestelbaar of geen voorraad" };

    const classText = `${input.className || ""} ${input.closest(".disabled,.sold-out,.out-of-stock,.not-available,.unavailable")?.className || ""}`;
    if (/\b(disabled|sold-out|out-of-stock|not-available|unavailable)\b/i.test(classText)) {
      return { ok: false, detail: "Niet bestelbaar of geen voorraad" };
    }

    const availableQty = getKnownAvailableQty(input);
    if (availableQty != null && availableQty <= 0) return { ok: false, detail: "Niet bestelbaar of geen voorraad" };
    if (availableQty != null && requestedQty > availableQty) {
      return { ok: false, detail: `Onvoldoende voorraad: maximaal ${availableQty}` };
    }

    return { ok: true, detail: "" };
  }

  function setOrderButtonReady(button, ready) {
    button.disabled = !ready;
    button.classList.toggle("is-ready", ready);
  }

  function setRowsState(rows, state, detail = "") {
    rows.forEach((row) => {
      const cell = row.statusCell;
      if (!cell) return;
      cell.textContent = state === "ok" ? "\u2713" : state === "error" ? "\u00d7" : state === "busy" ? "..." : "";
      cell.title = detail;
      cell.dataset.state = state;
    });
  }

  function setRowError(row, detail) {
    setRowsState([row], "error", detail);
  }

  function setRowsError(rows, detail) {
    rows.forEach((row) => setRowError(row, detail));
  }

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.productUrl = row.productUrl || "";
      tr.dataset.parentItemNo = row.parentItemNo || "";
      tr.__afterEdenRow = row;

      [
        ["product", row.parentItemNo || row.productUrl],
        ["size", row.size],
        ["quantity", row.quantity],
      ].forEach(([field, value], index) => {
        const td = document.createElement("td");

        const input = document.createElement("input");
        input.dataset.field = field;
        input.value = String(value ?? "");
        input.className = [index === 0 ? "ae-mono" : "", index === 2 ? "ae-number" : ""].filter(Boolean).join(" ");
        input.addEventListener("input", () => {
          if (field === "product") {
            tr.dataset.productUrl = "";
            tr.dataset.parentItemNo = "";
          }
        });

        td.appendChild(input);
        tr.appendChild(td);
      });

      const statusCell = document.createElement("td");
      statusCell.className = "ae-status";
      row.statusCell = statusCell;
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function readRowsFromTable(tableBody) {
    const text = Array.from(tableBody.querySelectorAll("tr"))
      .map((tr) => {
        const product = tr.dataset.productUrl || tr.dataset.parentItemNo || tr.querySelector('input[data-field="product"]')?.value || "";
        const size = tr.querySelector('input[data-field="size"]')?.value || "";
        const qty = tr.querySelector('input[data-field="quantity"]')?.value || "";
        return [product, size, qty].join("\t");
      })
      .join("\n");

    return parseRows(text);
  }

  function createPanel() {
    injectStyles();

    const panel = document.createElement("div");
    panel.id = "after-eden-order-tool";

    const title = document.createElement("div");
    title.textContent = "After Eden Order Tool";
    title.className = "ae-title";

    const actions = document.createElement("div");
    actions.className = "ae-actions";

    const dropButton = document.createElement("button");
    dropButton.type = "button";
    dropButton.textContent = "Drop items";
    dropButton.className = "ae-button ae-button-drop";

    const orderButton = document.createElement("button");
    orderButton.type = "button";
    orderButton.textContent = "Bestel items";
    orderButton.className = "ae-button ae-button-order";
    orderButton.disabled = true;

    actions.appendChild(dropButton);
    actions.appendChild(orderButton);

    const message = document.createElement("div");
    message.className = "ae-message";

    const tableWrap = document.createElement("div");
    tableWrap.className = "ae-table-wrap";

    const table = document.createElement("table");

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr>";

    const tableBody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tableBody);
    tableWrap.appendChild(table);

    const addRowButton = document.createElement("button");
    addRowButton.type = "button";
    addRowButton.textContent = "+";
    addRowButton.title = "Voeg handmatige regel toe";
    addRowButton.className = "ae-add-row";

    panel.appendChild(title);
    panel.appendChild(actions);
    panel.appendChild(message);
    panel.appendChild(tableWrap);
    panel.appendChild(addRowButton);
    document.body.appendChild(panel);

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
    const parsed = readRowsFromTable(ui.tableBody);
    if (parsed.errors.length) {
      ui.message.textContent = `Fouten in tabel: ${parsed.errors.join(" | ")}`;
      return;
    }

    renderRows(parsed.rows, ui.tableBody);
    const failedRows = new Set();
    const groups = groupRows(parsed.rows);
    ui.message.textContent = "Bestellen bezig...";

    for (const rows of groups.values()) {
      setRowsState(rows, "busy", "Productformulier ophalen");

      let form;
      try {
        form = await fetchProductForm(rows[0]);
      } catch (err) {
        setRowsError(rows, err?.message || "Productformulier ophalen mislukt");
        rows.forEach((row) => failedRows.add(row));
        continue;
      }

      const orderableRows = [];
      rows.forEach((row) => {
        const input = findExactInput(form, row);
        if (!input) {
          setRowError(row, `Exacte maat niet gevonden: ${row.size}`);
          failedRows.add(row);
          return;
        }

        const orderability = getOrderability(input, row.quantity);
        if (!orderability.ok) {
          setRowError(row, orderability.detail);
          failedRows.add(row);
          return;
        }

        row.resolvedInputName = input.name;
        row.resolvedBlock = input.closest(".selectqty-wrap") || null;
        orderableRows.push(row);
      });

      if (!orderableRows.length) continue;

      setRowsState(orderableRows, "busy", "Toevoegen");
      try {
        const response = await postRows(form, orderableRows);
        if (responseHasStockIssue(response)) {
          setRowsError(orderableRows, "Onvoldoende voorraad volgens winkelmandje");
          orderableRows.forEach((row) => failedRows.add(row));
          continue;
        }

        const confirmedRows = [];
        const unconfirmedRows = [];

        orderableRows.forEach((row) => {
          if (responseConfirmsRow(response, row)) confirmedRows.push(row);
          else unconfirmedRows.push(row);
        });

        if (confirmedRows.length) setRowsState(confirmedRows, "ok", "Toegevoegd");
        if (unconfirmedRows.length) {
          setRowsError(unconfirmedRows, "Niet bevestigd in basket-response");
          unconfirmedRows.forEach((row) => failedRows.add(row));
        }
      } catch (err) {
        setRowsError(orderableRows, err?.message || "Toevoegen mislukt");
        orderableRows.forEach((row) => failedRows.add(row));
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    if (failedRows.size) {
      ui.message.textContent = `${failedRows.size} regel(s) niet gelukt. Niet automatisch ververst.`;
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
      await orderItems(ui);
    });

    ui.addRowButton.addEventListener("click", () => {
      const rows = readRowsFromTable(ui.tableBody).rows;
      rows.push({ productUrl: "", parentItemNo: "", size: "", quantity: "" });
      renderRows(rows, ui.tableBody);
      setOrderButtonReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });
  }

  window.addEventListener("load", () => setTimeout(initUi, 500));
})();
