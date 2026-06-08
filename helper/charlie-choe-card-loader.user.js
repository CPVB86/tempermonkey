// ==UserScript==
// @name         Charlie Choe & Mila Order Tool
// @version      1.2
// @description  Reads Charlie Choe and Mila product/size/qty rows from clipboard and adds exact matches to the basket.
// @match        https://vangennip.itsperfect.it/webshop/shoppingbag*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/charlie-choe-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/charlie-choe-card-loader.user.js
// @author       C. P. v. Beek + GPT
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CART_URL = "/webshop/shoppingbag";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchCartHtml() {
    const response = await fetch(CART_URL, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Winkelmandcontrole mislukt: HTTP ${response.status}`);
    return response.text();
  }

  async function resetCartView() {
    for (const path of [
      "/webshop/shoppingbag/setFilters/false",
      "/webshop/shoppingbag/setAdvanced/false",
    ]) {
      const response = await fetch(path, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Winkelmandweergave herstellen mislukt: HTTP ${response.status}`);
      }
    }
  }

  function getCartProductSignatures(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (/er zijn geen artikelen in de winkelmand aanwezig/i.test(doc.body.textContent || "")) {
      return new Map();
    }

    const signatures = new Map();
    Array.from(doc.querySelectorAll('a[href*="/webshop/shop/p_id="]')).forEach((link) => {
      const productId = link.getAttribute("href")?.match(/p_id=(\d+)/i)?.[1];
      if (productId) signatures.set(productId, normalize(link.textContent));
    });
    return signatures;
  }

  function cartContainsChangedRows(html, previousHtml, rows) {
    const current = getCartProductSignatures(html);
    const previous = getCartProductSignatures(previousHtml);
    return rows.every((row) => {
      const productId = String(row.productId);
      const currentSignature = current.get(productId);
      return currentSignature && currentSignature !== previous.get(productId);
    });
  }

  async function waitForRowsInCart(rows, previousHtml, timeoutMs = 12000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(750);
      const html = await fetchCartHtml();
      if (cartContainsChangedRows(html, previousHtml, rows)) return;
    }

    throw new Error("Niet bevestigd in de echte winkelmand");
  }

  function loadProductFrame(url) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        "position:fixed!important;left:-10000px!important;top:0!important;width:1280px!important;height:900px!important;opacity:0!important;pointer-events:none!important;border:0!important;";
      frame.addEventListener("load", () => {
        const doc = frame.contentDocument;
        if (!doc?.querySelector('input[name*="[quantities]"]')) {
          frame.remove();
          reject(new Error("Productmatrix niet gevonden"));
          return;
        }
        resolve({ frame, doc });
      }, { once: true });
      frame.addEventListener("error", () => {
        frame.remove();
        reject(new Error("Productpagina laden mislukt"));
      }, { once: true });
      frame.src = url;
      document.body.appendChild(frame);
    });
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
          errors.push(`Regel ${index + 1}: verwacht artikel/URL<TAB>maat<TAB>aantal`);
          return;
        }

        const [productRef, size, quantityRaw] = cols;
        const quantity = parseInt(String(quantityRaw).replace(",", "."), 10);

        if (!productRef) errors.push(`Regel ${index + 1}: artikel of URL ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);
        }

        const product = parseProductRef(productRef);
        if (!product.productId) errors.push(`Regel ${index + 1}: p_id ontbreekt in supplier-ID of URL`);

        if (productRef && product.productId && size && Number.isFinite(quantity) && quantity > 0) {
          rows.push({
            productRef,
            productId: product.productId,
            colorNumber: product.colorNumber,
            itemNumber: product.itemNumber,
            productUrl: product.productUrl,
            size,
            quantity,
          });
        }
      });

    return { rows, errors };
  }

  function parseProductRef(productRef) {
    const text = String(productRef || "").trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("/")) {
      const url = new URL(text, location.origin);
      const productId =
        url.pathname.match(/p_id=(\d+)/i)?.[1] ||
        url.searchParams.get("p_id") ||
        "";
      const colorNumber = url.searchParams.get("cc_color") || "";
      const itemNumber = url.searchParams.get("cc_item") || "";
      url.pathname = `/webshop/shop/p_id=${productId}`;
      url.search = "";
      url.searchParams.set("set-season", "direct-order");
      return { productId, colorNumber, itemNumber, productUrl: url.href };
    }

    const parts = text.split("-").map((part) => part.trim()).filter(Boolean);
    const productId = /^\d+$/.test(parts.at(-1) || "") ? parts.at(-1) : "";
    const colorNumber = productId && /^\d+$/.test(parts.at(-2) || "") ? parts.at(-2) : "";
    const itemNumber = productId ? parts.slice(0, -2).join("-") : "";
    const productUrl = productId
      ? `${location.origin}/webshop/shop/p_id=${encodeURIComponent(productId)}?set-season=direct-order`
      : "";

    return { productId, colorNumber, itemNumber, productUrl };
  }

  function groupRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.productUrl)) groups.set(row.productUrl, []);
      groups.get(row.productUrl).push(row);
    });
    return groups;
  }

  function parseQuantityInput(input) {
    const match = String(input.name || "").match(
      /^item\[(\d+)\]\[([^\]]+)\]\[quantities\]\[([^\]]+)\]$/i
    );
    if (!match) return null;
    return {
      itemIndex: match[1],
      variantId: match[2],
      size: match[3],
    };
  }

  function getProductRoot(input) {
    return (
      input.closest("form") ||
      input.closest("[data-product-id]") ||
      input.closest(".product-item,.product,.item,.article") ||
      input.ownerDocument
    );
  }

  function findProductId(root, input) {
    const candidates = [
      root.querySelector?.('input[name="product_id"]')?.value,
      root.getAttribute?.("data-product-id"),
      input.closest("[data-product-id]")?.getAttribute("data-product-id"),
      root.querySelector?.("[data-product-id]")?.getAttribute("data-product-id"),
    ];

    const direct = candidates.find((value) => /^\d+$/.test(String(value || "").trim()));
    if (direct) return String(direct).trim();

    const html = root.outerHTML || "";
    return (
      html.match(/product_id["']?\s*[:=]\s*["']?(\d+)/i)?.[1] ||
      html.match(/updateShoppingBasket\(\s*["']?(\d+)/i)?.[1] ||
      input.ownerDocument.location?.pathname?.match(/p_id=(\d+)/i)?.[1] ||
      ""
    );
  }

  function getColorNumber(input) {
    const row = input.closest("tr");
    return String(
      row?.querySelector(".item__color_number")?.textContent ||
      row?.getAttribute("data-color-number") ||
      ""
    ).trim();
  }

  function findExactInput(doc, row) {
    const wantedSize = normalize(row.size);
    const candidates = Array.from(doc.querySelectorAll('input[name*="[quantities]"]'))
      .map((input) => ({ input, parsed: parseQuantityInput(input) }))
      .filter(({ input, parsed }) => {
        const visibleSize = input.getAttribute("data-size") || parsed?.size || "";
        return parsed && normalize(visibleSize) === wantedSize;
      });

    if (!candidates.length) return { error: `Exacte maat niet gevonden: ${row.size}` };

    const wantedColor = normalize(row.colorNumber);
    const best = wantedColor
      ? candidates.filter((candidate) => normalize(getColorNumber(candidate.input)) === wantedColor)
      : candidates;

    if (best.length !== 1) {
      return {
        error: wantedColor
          ? `Exacte kleur/maat niet gevonden: ${row.colorNumber} ${row.size}`
          : `Maat ${row.size} komt in meerdere kleuren voor; kleur ontbreekt`,
      };
    }

    const selected = best[0];
    const root = getProductRoot(selected.input);
    const productId = row.productId || findProductId(root, selected.input);
    if (!productId) return { error: "product_id niet gevonden" };

    if (selected.input.disabled || selected.input.readOnly) {
      return { error: `Niet bestelbaar: ${row.size}` };
    }

    const max = parseInt(
      selected.input.getAttribute("data-limit") ||
      selected.input.getAttribute("max") ||
      "",
      10
    );
    if (Number.isFinite(max) && max < row.quantity) {
      return { error: `Onvoldoende voorraad: maximaal ${max}` };
    }

    return {
      input: selected.input,
      root,
      productId,
      itemNumber: row.itemNumber || String(doc.querySelector("#item_number .spec__value")?.textContent || "").trim(),
      variantId: selected.parsed.variantId,
    };
  }

  function setFrameQuantities(rows) {
    const totals = new Map();

    rows.forEach((row) => {
      const current = totals.get(row.resolvedInput.name) || {
        input: row.resolvedInput,
        quantity: 0,
      };
      current.quantity += row.quantity;
      totals.set(row.resolvedInput.name, current);
    });

    totals.forEach(({ input, quantity }) => {
      const currentQuantity = parseInt(input.value, 10) || 0;
      const newQuantity = currentQuantity + quantity;
      const limit = parseInt(input.getAttribute("data-limit") || "", 10);
      if (Number.isFinite(limit) && newQuantity > limit) {
        throw new Error(`Onvoldoende voorraad: maximaal ${limit}`);
      }

      input.value = String(newQuantity);
      const FrameEvent = input.ownerDocument.defaultView.Event;
      ["input", "keyup", "change"].forEach((type) => {
        input.dispatchEvent(new FrameEvent(type, { bubbles: true }));
      });
    });
  }

  async function submitFrameRows(doc, rows) {
    const previousHtml = await fetchCartHtml();
    setFrameQuantities(rows);
    await sleep(150);

    const button = doc.querySelector(".js-shoppingbag-add-update-item-in-basket");
    if (!button) throw new Error("Van Gennip Toevoegen-knop niet gevonden");
    button.click();

    await waitForRowsInCart(rows, previousHtml);
  }

  function injectStyles() {
    if (document.getElementById("charlie-choe-order-styles")) return;
    const style = document.createElement("style");
    style.id = "charlie-choe-order-styles";
    style.textContent = `
      #charlie-choe-order-tool, #charlie-choe-order-tool * { box-sizing:border-box!important; letter-spacing:0!important; }
      #charlie-choe-order-tool { position:fixed!important;right:12px!important;top:60px!important;z-index:999999!important;width:460px!important;max-width:calc(100vw - 24px)!important;padding:10px!important;border:1px solid #cfd7df!important;border-radius:8px!important;background:#fff!important;color:#1f2933!important;box-shadow:0 8px 30px rgba(0,0,0,.16)!important;font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #charlie-choe-order-tool .cc-title { margin:0 0 8px!important;color:#111827!important;font:800 15px/1.35 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #charlie-choe-order-tool .cc-actions { display:flex!important;gap:8px!important;margin-bottom:8px!important; }
      #charlie-choe-order-tool button { appearance:none!important;box-shadow:none!important;text-transform:none!important;letter-spacing:0!important; }
      #charlie-choe-order-tool .cc-main { display:inline-flex!important;align-items:center!important;justify-content:center!important;width:50%!important;min-height:36px!important;margin:0!important;padding:9px 10px!important;border:0!important;border-radius:6px!important;color:#fff!important;font:700 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #charlie-choe-order-tool .cc-drop { background:#1f6feb!important;cursor:pointer!important; }
      #charlie-choe-order-tool .cc-order { background:#9ca3af!important;cursor:not-allowed!important; }
      #charlie-choe-order-tool .cc-order.is-ready { background:#16a34a!important;cursor:pointer!important; }
      #charlie-choe-order-tool .cc-message { min-height:16px!important;margin:8px 0 0!important;color:#4b5563!important;font-size:12px!important; }
      #charlie-choe-order-tool .cc-table { max-height:300px!important;margin-top:8px!important;overflow:auto!important;border:1px solid #e5e7eb!important;border-radius:6px!important; }
      #charlie-choe-order-tool table { width:100%!important;margin:0!important;border-collapse:collapse!important;font-size:12px!important; }
      #charlie-choe-order-tool th { position:sticky!important;top:0!important;padding:6px!important;border-bottom:1px solid #e5e7eb!important;background:#f3f4f6!important;text-align:left!important; }
      #charlie-choe-order-tool td { padding:4px!important;border-bottom:1px solid #eef0f2!important;background:#fff!important; }
      #charlie-choe-order-tool input { width:100%!important;min-height:24px!important;margin:0!important;padding:4px!important;border:1px solid transparent!important;border-radius:4px!important;background:transparent!important;color:#1f2933!important;box-shadow:none!important;font:12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif!important; }
      #charlie-choe-order-tool input:focus { border-color:#bfdbfe!important;background:#fff!important;outline:0!important; }
      #charlie-choe-order-tool .cc-product { font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important; }
      #charlie-choe-order-tool .cc-qty { text-align:right!important; }
      #charlie-choe-order-tool .cc-status { width:34px!important;min-width:34px!important;text-align:center!important;font-size:17px!important;font-weight:900!important; }
      #charlie-choe-order-tool .cc-status[data-state="ok"] { color:#16a34a!important; }
      #charlie-choe-order-tool .cc-status[data-state="error"] { color:#dc2626!important; }
      #charlie-choe-order-tool .cc-add { display:inline-flex!important;align-items:center!important;justify-content:center!important;width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;margin:8px 0 0!important;padding:0!important;border:1px solid #d1d5db!important;border-radius:999px!important;background:#fff!important;color:#4b5563!important;font:600 15px/1 system-ui,-apple-system,Segoe UI,sans-serif!important;cursor:pointer!important; }
    `;
    document.head.appendChild(style);
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
        input.className = index === 0 ? "cc-product" : index === 2 ? "cc-qty" : "";
        td.appendChild(input);
        tr.appendChild(td);
      });
      const statusCell = document.createElement("td");
      statusCell.className = "cc-status";
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
    const panel = document.createElement("div");
    panel.id = "charlie-choe-order-tool";

    const title = document.createElement("div");
    title.className = "cc-title";
    title.textContent = "Charlie Choe & Mila Order Tool";

    const actions = document.createElement("div");
    actions.className = "cc-actions";
    const dropButton = document.createElement("button");
    dropButton.type = "button";
    dropButton.className = "cc-main cc-drop";
    dropButton.textContent = "Drop items";
    const orderButton = document.createElement("button");
    orderButton.type = "button";
    orderButton.className = "cc-main cc-order";
    orderButton.textContent = "Bestel items";
    orderButton.disabled = true;
    actions.append(dropButton, orderButton);

    const message = document.createElement("div");
    message.className = "cc-message";
    const tableWrap = document.createElement("div");
    tableWrap.className = "cc-table";
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Artikel</th><th>Maat</th><th>Aantal</th><th></th></tr></thead>";
    const tableBody = document.createElement("tbody");
    table.appendChild(tableBody);
    tableWrap.appendChild(table);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "cc-add";
    addButton.textContent = "+";
    addButton.title = "Voeg handmatige regel toe";

    panel.append(title, actions, message, tableWrap, addButton);
    document.body.appendChild(panel);
    return { dropButton, orderButton, addButton, message, tableBody };
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

    try {
      await resetCartView();
    } catch (error) {
      setRowsState(parsed.rows, "error", error?.message || "Winkelmandweergave herstellen mislukt");
      ui.message.textContent = "Winkelmandweergave kon niet worden hersteld. Niet besteld.";
      return;
    }

    productLoop:
    for (const rows of groupRows(parsed.rows).values()) {
      setRowsState(rows, "busy", "Productpagina ophalen");
      let frame;
      let doc;
      try {
        ({ frame, doc } = await loadProductFrame(rows[0].productUrl));
        await sleep(300);
      } catch (error) {
        setRowsState(rows, "error", error?.message || "Productpagina ophalen mislukt");
        rows.forEach((row) => failedRows.add(row));
        continue;
      }

      const resolvedRows = [];
      rows.forEach((row) => {
        const resolved = findExactInput(doc, row);
        if (resolved.error) {
          setRowsState([row], "error", resolved.error);
          failedRows.add(row);
          return;
        }
        row.resolvedInput = resolved.input;
        row.resolvedRoot = resolved.root;
        row.productId = resolved.productId;
        row.itemNumber = resolved.itemNumber;
        resolvedRows.push(row);
      });

      const postGroups = new Map();
      resolvedRows.forEach((row) => {
        const key = row.productId;
        if (!postGroups.has(key)) postGroups.set(key, []);
        postGroups.get(key).push(row);
      });

      for (const postRows of postGroups.values()) {
        const rowsByInput = new Map();
        postRows.forEach((row) => {
          if (!rowsByInput.has(row.resolvedInput.name)) rowsByInput.set(row.resolvedInput.name, []);
          rowsByInput.get(row.resolvedInput.name).push(row);
        });

        const rejectedRows = new Set();
        rowsByInput.forEach((variantRows) => {
          const totalQty = variantRows.reduce((sum, row) => sum + row.quantity, 0);
          const limit = parseInt(variantRows[0].resolvedInput.getAttribute("data-limit") || "", 10);
          if (!Number.isFinite(limit) || totalQty <= limit) return;

          variantRows.forEach((row) => {
            setRowsState([row], "error", `Onvoldoende voorraad: maximaal ${limit}`);
            failedRows.add(row);
            rejectedRows.add(row);
          });
        });

        const safeRows = postRows.filter((row) => !rejectedRows.has(row));
        if (!safeRows.length) continue;

        setRowsState(safeRows, "busy", "Toevoegen");
        try {
          await submitFrameRows(doc, safeRows);
          setRowsState(safeRows, "ok", "Toegevoegd");
        } catch (error) {
          setRowsState(safeRows, "error", error?.message || "Toevoegen mislukt");
          safeRows.forEach((row) => failedRows.add(row));
          frame?.remove();
          break productLoop;
        }
      }

      frame?.remove();
      await sleep(500);
    }

    if (failedRows.size) {
      ui.message.textContent = `${failedRows.size} regel(s) niet gelukt. Niet automatisch ververst.`;
      return;
    }

    ui.message.textContent = "Alles toegevoegd. Pagina wordt ververst...";
    setTimeout(async () => {
      try {
        await resetCartView();
      } finally {
        location.href = CART_URL;
      }
    }, 1500);
  }

  function init() {
    const ui = createPanel();
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
      rows.push({ productRef: "", productId: "", colorNumber: "", itemNumber: "", productUrl: "", size: "", quantity: "" });
      renderRows(rows, ui.tableBody);
      setOrderReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });
  }

  window.addEventListener("load", () => setTimeout(init, 500));
})();
