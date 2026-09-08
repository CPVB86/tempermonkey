// ==UserScript==
// @name         Mey Order Tool
// @version      1.5
// @description  Leest Mey artikel-kleur/maat/aantal uit het klembord en vult de vernieuwde Mey-bestelmatrix.
// @match        https://meyb2b.com/*
// @match        https://www.meyb2b.com/*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/mey-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/mey-card-loader.user.js
// @author       C. P. v. Beek
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "mey-order-tool";
  const STYLE_ID = "mey-order-tool-styles";
  const JOB_KEY = "mey-order-tool-job-v14";
  const POSITION_KEY = "mey-order-tool-position";
  const SEARCH_BASE = "https://meyb2b.com/d-reorder-mey/search/products/";
  const CART_URL = "https://meyb2b.com/d-reorder-mey/cart";
  let processingJob = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function parseProductRef(productRef) {
    const text = String(productRef || "").trim();
    const oldKey = decodeURIComponent(text).match(/ME;NO;([^;]+);\*\/([^/?#]+)/i);
    if (oldKey) return { article: oldKey[1], color: oldKey[2] };

    const match = text.match(/^(.+)-([^-]+)$/);
    return match
      ? { article: match[1].trim(), color: match[2].trim() }
      : { article: text, color: "" };
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
        const [productRef = "", size = "", quantityRaw = ""] = cols;
        const product = parseProductRef(productRef);
        const quantity = Number.parseInt(quantityRaw, 10);

        if (cols.length < 3) errors.push(`Regel ${index + 1}: verwacht artikel-kleur<TAB>maat<TAB>aantal`);
        else if (!product.article || !product.color) errors.push(`Regel ${index + 1}: verwacht artikel-kleur, bijvoorbeeld 74239-3`);
        else if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        else if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);
        else rows.push({ productRef, article: product.article, color: product.color, size, quantity });
      });

    return { rows, errors };
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

  function isSearchPageFor(article) {
    const path = decodeURIComponent(location.pathname || "").replace(/\/+$/, "");
    const routeMatch = path.match(/\/search\/products\/([^/]+)/i);
    const articleInPath = routeMatch?.[1] || "";

    return normalize(articleInPath) === normalize(article);
  }

  function getColorCode(value) {
    return normalize(String(value || "").trim().split(/\s+/)[0]);
  }

  function findProductCard(row) {
    return Array.from(document.querySelectorAll("article.components-StyleCollectionView-ItemView")).find((card) => {
      const article = card.querySelector(".styleid")?.textContent || "";
      const color = card.querySelector(".color-name")?.textContent || "";
      return normalize(article) === normalize(row.article) &&
        getColorCode(color) === normalize(row.color);
    }) || null;
  }

  function getQuickEntryDialog(row) {
    return Array.from(document.querySelectorAll(".components-StyleCollectionView-QuickEntryDialog")).find((dialog) => {
      const article = dialog.querySelector('[data-field="displayStyleId"] .value')?.textContent || "";
      return normalize(article) === normalize(row.article) &&
        hasExactColorGrid(dialog, row.color);
    }) || null;
  }

  function hasExactColorGrid(root, color) {
    const wanted = normalize(color);

    const cupGrid = Array.from(root.querySelectorAll(".components-OrderGrid[data-color-key]")).some(
      (grid) => normalize(grid.dataset.colorKey) === wanted
    );
    if (cupGrid) return true;

    return Array.from(root.querySelectorAll('.components-OrderGrid [data-colid="color"][data-rowid]')).some(
      (cell) => normalize(cell.getAttribute("data-rowid")) === wanted &&
        getColorCode(cell.querySelector(".content")?.textContent || cell.textContent) === wanted
    );
  }

  async function waitFor(test, message, timeoutMs = 25000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = test();
      if (result) return result;
      await sleep(250);
    }
    throw new Error(message);
  }

  function loadJob() {
    try {
      return JSON.parse(sessionStorage.getItem(JOB_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveJob(job) {
    sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
  }

  async function ensureQuickEntry(row) {
    if (getQuickEntryDialog(row)) return true;

    const openDialog = document.querySelector(".components-StyleCollectionView-QuickEntryDialog");
    if (openDialog) {
      openDialog.querySelector("i.close")?.click();
      await waitFor(
        () => !document.querySelector(".components-StyleCollectionView-QuickEntryDialog"),
        "Vorige snelbestelvenster kon niet worden gesloten",
        5000
      );
    }

    const wantedSearch = SEARCH_BASE + encodeURIComponent(row.article);
    if (!isSearchPageFor(row.article)) {
      location.assign(wantedSearch);
      return false;
    }

    const card = await waitFor(
      () => findProductCard(row),
      `Geen zoekkaart gevonden voor artikel ${row.article}, kleur ${row.color}`
    );

    const quickButton = card.querySelector("button.quick-view");
    if (!quickButton) throw new Error(`Knop 'Maat selecteren' ontbreekt voor ${row.productRef}`);
    quickButton.click();

    await waitFor(
      () => getQuickEntryDialog(row),
      `Snel bestellen werd niet geopend voor ${row.productRef}`,
      10000
    );
    return true;
  }

  function getColorGrid(color, root = document) {
    const wanted = normalize(color);
    return Array.from(root.querySelectorAll(".components-OrderGrid[data-color-key]")).find(
      (grid) => normalize(grid.dataset.colorKey) === wanted
    ) || null;
  }

  function getGridAxis(grid, selector, attribute) {
    const result = new Map();
    grid.querySelectorAll(selector).forEach((cell) => {
      const key = cell.getAttribute(attribute);
      const label = normalize(cell.querySelector(".content")?.textContent || cell.textContent);
      if (key != null && label) result.set(String(key), label);
    });
    return result;
  }

  function findSizeCell(row) {
    const root = getQuickEntryDialog(row);
    if (!root) return null;

    const cupGrid = getColorGrid(row.color, root);
    if (cupGrid) return findCupSizeCell(cupGrid, row.size, row.color);

    return findSimpleSizeCell(root, row.size, row.color);
  }

  function findCupSizeCell(grid, size, color) {
    const desktop = grid.querySelector(".components-OrderGrid-DesktopRenderer");
    if (!desktop) return null;

    const sizeMatch = normalize(size).match(/^(\d+)([A-Z]+)$/);
    if (!sizeMatch) return null;

    const [, band, cup] = sizeMatch;
    const columnLabels = getGridAxis(desktop, '[data-rowid="header"][data-colid]', "data-colid");
    const rowLabels = getGridAxis(desktop, '[data-colid="cup"][data-rowid]:not([data-rowid="header"])', "data-rowid");

    const columnId = Array.from(columnLabels).find(([, label]) => label === band)?.[0];
    const rowId = Array.from(rowLabels).find(([, label]) => label === cup)?.[0];
    if (columnId == null || rowId == null) return null;

    return Array.from(desktop.querySelectorAll('[data-rowid][data-colid]')).find((cell) =>
      cell.getAttribute("data-rowid") === rowId &&
      cell.getAttribute("data-colid") === columnId &&
      normalize(cell.getAttribute("data-row-groupid")) === normalize(color) &&
      Boolean(cell.querySelector('.quantity-content, button[aria-label="Aantal verhogen"]'))
    ) || null;
  }

  function findSimpleSizeCell(root, size, color) {
    const wantedSize = normalize(size);
    const wantedColor = normalize(color);

    for (const grid of root.querySelectorAll(".components-OrderGrid:not([data-color-key])")) {
      const desktop = grid.querySelector(".components-OrderGrid-DesktopRenderer");
      if (!desktop) continue;

      const colorHeader = Array.from(desktop.querySelectorAll('[data-colid="color"][data-rowid]:not([data-rowid="header"])')).find(
        (cell) => normalize(cell.getAttribute("data-rowid")) === wantedColor &&
          getColorCode(cell.querySelector(".content")?.textContent || cell.textContent) === wantedColor
      );
      if (!colorHeader) continue;

      const columnLabels = getGridAxis(desktop, '[data-rowid="header"][data-colid]', "data-colid");
      const columnId = Array.from(columnLabels).find(([, label]) => label === wantedSize)?.[0];
      if (columnId == null) return null;

      return Array.from(desktop.querySelectorAll('[data-rowid][data-colid]')).find((cell) =>
        normalize(cell.getAttribute("data-rowid")) === wantedColor &&
        cell.getAttribute("data-colid") === columnId &&
        Boolean(cell.querySelector('.quantity-content, button[aria-label="Aantal verhogen"]'))
      ) || null;
    }

    return null;
  }

  function readCellQuantity(cell) {
    const value = Number.parseInt(cell?.querySelector(".quantity-content")?.textContent || "", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function getPlusButton(cell) {
    return cell?.querySelector('button[aria-label="Aantal verhogen"]') || null;
  }

  function isCellOrderable(cell) {
    const plus = getPlusButton(cell);
    return Boolean(plus && !plus.disabled && !cell.classList.contains("disabled"));
  }

  function dispatchPointerTap(element) {
    const view = element.ownerDocument.defaultView;
    if (typeof view.PointerEvent !== "function") return;

    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    element.dispatchEvent(new view.PointerEvent("pointerdown", options));
    element.dispatchEvent(new view.PointerEvent("pointerup", { ...options, buttons: 0 }));
  }

  function dispatchMouseClick(element) {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    ["mousedown", "mouseup", "click"].forEach((type) => {
      element.dispatchEvent(new view.MouseEvent(type, options));
    });
  }

  async function waitForQuantityIncrease(row, before, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(150);
      const freshCell = findSizeCell(row);
      if (freshCell && readCellQuantity(freshCell) >= before + 1) return true;
    }
    return false;
  }

  async function clickPlus(row) {
    const cell = findSizeCell(row);
    if (!cell) throw new Error(`Maat ${row.size} niet gevonden in kleur ${row.color}`);
    if (!isCellOrderable(cell)) throw new Error(`${row.productRef}, maat ${row.size} is niet bestelbaar`);

    const before = readCellQuantity(cell);
    let plus = getPlusButton(cell);

    dispatchPointerTap(plus);
    if (await waitForQuantityIncrease(row, before, 1800)) return;

    plus = getPlusButton(findSizeCell(row));
    if (!plus) throw new Error(`Plusknop verdwenen voor ${row.productRef}, maat ${row.size}`);
    dispatchMouseClick(plus);

    if (await waitForQuantityIncrease(row, before, 4500)) return;

    throw new Error(`Mey bevestigde de verhoging niet voor ${row.productRef}, maat ${row.size}`);
  }

  async function addRow(row) {
    for (let i = 0; i < row.quantity; i += 1) {
      await clickPlus(row);
      await sleep(300);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID},#${PANEL_ID} *{box-sizing:border-box!important;letter-spacing:0!important}
      #${PANEL_ID}{position:fixed!important;right:12px!important;top:70px!important;z-index:2147483647!important;width:460px!important;max-width:calc(100vw - 24px)!important;padding:10px!important;border:1px solid #cfd7df!important;border-radius:8px!important;background:#fff!important;color:#1f2933!important;box-shadow:0 8px 30px rgba(0,0,0,.16)!important;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important}
      #${PANEL_ID} .mey-title{margin:0 0 8px!important;color:#111827!important;font-weight:800!important;font-size:15px!important;cursor:move!important;user-select:none!important;touch-action:none!important}
      #${PANEL_ID} .mey-actions{display:flex!important;gap:8px!important;margin-bottom:8px!important}
      #${PANEL_ID} button{appearance:none!important;box-shadow:none!important;text-transform:none!important;letter-spacing:0!important}
      #${PANEL_ID} .mey-main{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:50%!important;min-height:36px!important;padding:9px 10px!important;border:0!important;border-radius:6px!important;color:#fff!important;font-weight:700!important}
      #${PANEL_ID} .mey-drop{background:#1f6feb!important;cursor:pointer!important}
      #${PANEL_ID} .mey-order{background:#9ca3af!important;cursor:not-allowed!important}
      #${PANEL_ID} .mey-order.is-ready{background:#16a34a!important;cursor:pointer!important}
      #${PANEL_ID} .mey-message{min-height:16px!important;margin:8px 0 0!important;color:#4b5563!important;font-size:12px!important}
      #${PANEL_ID} .mey-table{max-height:300px!important;margin-top:8px!important;overflow:auto!important;border:1px solid #e5e7eb!important;border-radius:6px!important}
      #${PANEL_ID} table{width:100%!important;margin:0!important;border-collapse:collapse!important;font-size:12px!important}
      #${PANEL_ID} th{position:sticky!important;top:0!important;padding:6px!important;background:#f3f4f6!important;text-align:left!important}
      #${PANEL_ID} td{padding:4px!important;border-top:1px solid #eef0f2!important;background:#fff!important}
      #${PANEL_ID} input{width:100%!important;min-height:24px!important;padding:4px!important;border:1px solid transparent!important;border-radius:4px!important;background:transparent!important;color:#1f2933!important;font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important}
      #${PANEL_ID} input:focus{border-color:#bfdbfe!important;background:#fff!important;outline:0!important}
      #${PANEL_ID} .mey-product{font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important}
      #${PANEL_ID} .mey-qty{text-align:right!important}
      #${PANEL_ID} .mey-status{width:34px!important;text-align:center!important;font-size:17px!important;font-weight:900!important}
      #${PANEL_ID} .mey-status[data-state="ok"]{color:#16a34a!important}
      #${PANEL_ID} .mey-status[data-state="error"]{color:#dc2626!important}
      #${PANEL_ID} .mey-add{width:24px!important;height:24px!important;margin-top:8px!important;padding:0!important;border:1px solid #d1d5db!important;border-radius:50%!important;background:#fff!important;cursor:pointer!important}
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
      row.statusCell.textContent = state === "ok" ? "✓" : state === "error" ? "×" : state === "busy" ? "…" : "";
      row.statusCell.dataset.state = state;
      row.statusCell.title = detail;
    });
  }

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      [["productRef", row.productRef], ["size", row.size], ["quantity", row.quantity]].forEach(([field, value], index) => {
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
      if (row.state) {
        statusCell.textContent = row.state === "ok" ? "✓" : row.state === "error" ? "×" : row.state === "busy" ? "…" : "";
        statusCell.dataset.state = row.state;
        statusCell.title = row.detail || "";
      }
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function readTable(tableBody) {
    return parseRows(Array.from(tableBody.querySelectorAll("tr")).map((tr) => [
      tr.querySelector('[data-field="productRef"]')?.value || "",
      tr.querySelector('[data-field="size"]')?.value || "",
      tr.querySelector('[data-field="quantity"]')?.value || ""
    ].join("\t")).join("\n"));
  }

  function getPanelUi() {
    const panel = document.getElementById(PANEL_ID);
    return {
      panel,
      dropButton: panel?.querySelector(".mey-drop"),
      orderButton: panel?.querySelector(".mey-order"),
      addButton: panel?.querySelector(".mey-add"),
      message: panel?.querySelector(".mey-message"),
      tableBody: panel?.querySelector("tbody")
    };
  }

  function clampPanelPosition(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop)
    };
  }

  function setPanelPosition(panel, left, top) {
    const position = clampPanelPosition(panel, left, top);
    panel.style.setProperty("left", `${position.left}px`, "important");
    panel.style.setProperty("top", `${position.top}px`, "important");
    panel.style.setProperty("right", "auto", "important");
    return position;
  }

  function makePanelDraggable(panel) {
    const handle = panel.querySelector(".mey-title");
    if (!handle || handle.dataset.dragReady === "1") return;
    handle.dataset.dragReady = "1";

    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        requestAnimationFrame(() => setPanelPosition(panel, saved.left, saved.top));
      }
    } catch {
      // Ongeldige oude positie negeren.
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const startRect = panel.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture?.(event.pointerId);

      const move = (moveEvent) => {
        setPanelPosition(
          panel,
          startRect.left + moveEvent.clientX - startX,
          startRect.top + moveEvent.clientY - startY
        );
      };

      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);

        const rect = panel.getBoundingClientRect();
        localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
      window.addEventListener("pointercancel", stop, { once: true });
    });
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

    const job = {
      rows: parsed.rows.map((row) => ({ ...row, state: "pending", detail: "" })),
      startedAt: Date.now()
    };
    saveJob(job);
    await resumeOrderJob(ui);
  }

  async function resumeOrderJob(ui) {
    if (processingJob) return;
    const job = loadJob();
    if (!job?.rows?.length) return;

    processingJob = true;
    setOrderReady(ui.orderButton, false);
    renderRows(job.rows, ui.tableBody);
    ui.message.textContent = "Bestellen bezig…";

    try {
      while (true) {
        const row = job.rows.find((item) => item.state === "pending" || item.state === "busy");
        if (!row) break;

        row.state = "busy";
        row.detail = "Artikel en kleur zoeken";
        row.navigationAttempts = Number(row.navigationAttempts || 0);
        saveJob(job);
        renderRows(job.rows, ui.tableBody);

        try {
          if (!getQuickEntryDialog(row)) {
            row.navigationAttempts += 1;
            if (row.navigationAttempts > 4) {
              throw new Error(`Navigatie gestopt na 4 pogingen voor artikel ${row.article}`);
            }
            saveJob(job);
          }

          const ready = await ensureQuickEntry(row);
          if (!ready) {
            setTimeout(() => {
              const freshUi = getPanelUi();
              if (freshUi?.panel) resumeOrderJob(freshUi).catch(console.error);
            }, 1500);
            return;
          }

          row.detail = "Toevoegen";
          saveJob(job);
          await addRow(row);
          row.state = "ok";
          row.detail = "Toegevoegd";
          row.navigationAttempts = 0;
        } catch (error) {
          row.state = "error";
          row.detail = error?.message || "Toevoegen mislukt";
        }

        saveJob(job);
        renderRows(job.rows, ui.tableBody);
      }

      const failed = job.rows.filter((row) => row.state === "error").length;
      sessionStorage.removeItem(JOB_KEY);
      if (failed) {
        ui.message.textContent = `${failed} regel(s) niet gelukt: ${job.rows.find((row) => row.state === "error")?.detail || "onbekende fout"}`;
        setOrderReady(ui.orderButton, true);
        return;
      }

      ui.message.textContent = "Alles is toegevoegd. Winkelmand wordt geopend…";
      await sleep(500);
      location.assign(CART_URL);
    } finally {
      processingJob = false;
    }
  }

  function createPanel() {
    injectStyles();
    if (document.getElementById(PANEL_ID)) return getPanelUi();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="mey-title" title="Sleep om de tool te verplaatsen">Mey Order Tool <span style="font-weight:500;color:#6b7280">v1.5</span></div>
      <div class="mey-actions">
        <button type="button" class="mey-main mey-drop">Drop items</button>
        <button type="button" class="mey-main mey-order" disabled>Bestel items</button>
      </div>
      <div class="mey-message"></div>
      <div class="mey-table"><table><thead><tr><th>Artikel-kleur</th><th>Maat</th><th>Aantal</th><th></th></tr></thead><tbody></tbody></table></div>
      <button type="button" class="mey-add" title="Voeg handmatige regel toe">+</button>
    `;
    document.documentElement.appendChild(panel);
    makePanelDraggable(panel);

    const ui = getPanelUi();
    ui.dropButton.addEventListener("click", () => dropItems(ui).catch((error) => {
      ui.message.textContent = `Fout: ${error?.message || error}`;
    }));
    ui.orderButton.addEventListener("click", () => orderItems(ui).catch((error) => {
      ui.message.textContent = `Fout: ${error?.message || error}`;
      setOrderReady(ui.orderButton, true);
    }));
    ui.addButton.addEventListener("click", () => {
      const rows = readTable(ui.tableBody).rows;
      rows.push({ productRef: "", size: "", quantity: "" });
      renderRows(rows, ui.tableBody);
      setOrderReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });

    const pendingJob = loadJob();
    if (pendingJob?.rows?.length) {
      renderRows(pendingJob.rows, ui.tableBody);
      ui.message.textContent = "Opgeslagen bestelling wordt hervat…";
      setTimeout(() => resumeOrderJob(ui).catch((error) => {
        ui.message.textContent = `Fout: ${error?.message || error}`;
        processingJob = false;
      }), 400);
    }
    return ui;
  }

  function keepPanelMounted() {
    createPanel();
    new MutationObserver(() => {
      if (!document.getElementById(PANEL_ID)) createPanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(createPanel, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", keepPanelMounted, { once: true });
  } else {
    keepPanelMounted();
  }
})();
