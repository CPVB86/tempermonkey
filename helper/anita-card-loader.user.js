// ==UserScript==
// @name         Anita Order Tool
// @version      0.4
// @description  Reads Anita item/color/size/qty rows from clipboard and adds exact matches to the order.
// @match        https://b2b.anita.com/nl/shop/bestelling*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/anita-card-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/helper/anita-card-loader.user.js
// @author       C. P. v. Beek + GPT
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  function parseItemColor(raw) {
    const rawText = String(raw || "").trim();

    if (/^https?:\/\//i.test(rawText) || rawText.startsWith("/")) {
      try {
        const url = new URL(rawText, location.origin);
        const params = url.searchParams;
        const arnr = params.get("arnr") || "";
        const koll = params.get("koll") || "";
        const color = params.get("fbnr") || "";
        const itemNumber = koll ? `${koll}-${arnr}` : arnr;

        return {
          itemNumber,
          color,
          productUrl: url.href,
        };
      } catch {}
    }

    const text = rawText.toUpperCase().replace(/\s+/g, " ");
    const spaced = text.match(/^(.+)\s+([A-Z0-9]{3})$/);
    if (spaced) return withBuiltUrl(spaced[1].trim(), spaced[2]);

    const dashed = text.match(/^(.+)-([A-Z0-9]{3})$/);
    if (dashed) return withBuiltUrl(dashed[1].trim(), dashed[2]);

    const compact = text.replace(/[^A-Z0-9]/g, "");
    const compactMatch = compact.match(/^(.+?)([A-Z0-9]{3})$/);
    if (compactMatch) return withBuiltUrl(compactMatch[1], compactMatch[2]);

    return { itemNumber: text, color: "", productUrl: "" };
  }

  function withBuiltUrl(itemNumber, color) {
    return {
      itemNumber,
      color,
      productUrl: buildProductUrlFromParts(itemNumber, color),
    };
  }

  function splitAnitaItemNumber(itemNumber) {
    const raw = String(itemNumber || "").trim().toUpperCase();
    const match = raw.match(/^([A-Z]\d*)-(.+)$/);
    if (!match) return { koll: "", arnr: raw };
    return { koll: match[1], arnr: match[2] };
  }

  function buildProductUrlFromParts(itemNumber, color) {
    const split = splitAnitaItemNumber(itemNumber);
    const params = new URLSearchParams({
      fssc: "N",
      vsas: "",
      koll: split.koll,
      form: "",
      vacp: "",
      arnr: split.arnr,
      vakn: "",
      sicht: "V",
      fbnr: color || "",
    });

    return `/nl/shop/441/?${params.toString()}`;
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
          errors.push(`Regel ${index + 1}: verwacht artikel/kleur<TAB>maat<TAB>aantal`);
          return;
        }

        const [itemColorRaw, size, qtyRaw] = cols;
        const item = parseItemColor(itemColorRaw);
        const quantity = parseInt(String(qtyRaw).replace(",", "."), 10);

        if (!item.itemNumber) errors.push(`Regel ${index + 1}: artikelnummer ontbreekt`);
        if (!item.color) errors.push(`Regel ${index + 1}: kleur ontbreekt`);
        if (!size) errors.push(`Regel ${index + 1}: maat ontbreekt`);
        if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Regel ${index + 1}: aantal moet groter dan 0 zijn`);

        if (item.itemNumber && item.color && size && Number.isFinite(quantity) && quantity > 0) {
          rows.push({
            itemNumber: item.itemNumber,
            color: item.color,
            productUrl: item.productUrl || "",
            size: String(size).trim(),
            quantity,
          });
        }
      });

    return { rows, errors };
  }

  function normalizeSizeToken(size) {
    return String(size || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[/-]/g, "");
  }

  function getExactInputName(row) {
    const size = normalizeSizeToken(row.size);
    const bra = size.match(/^(\d{2,3})([A-Z]+)$/);
    if (bra) return `gm_${row.color}_${bra[2]}_${bra[1]}`;
    return `gm_${row.color}__${size}`;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function groupRows(rows) {
    const groups = new Map();

    rows.forEach((row) => {
      let campaign = "";
      if (row.productUrl) {
        try {
          campaign = new URL(row.productUrl, location.origin).searchParams.get("vakn") || "";
        } catch {}
      }

      // One Anita POST replaces the complete matrix for an article. Keep all
      // requested colors/sizes for that article in the same request.
      const key = `${row.itemNumber}|${campaign}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    return groups;
  }

  async function fetchProductForm(row) {
    const productUrl = row.productUrl || buildProductUrlFromParts(row.itemNumber, row.color);
    const res = await fetch(productUrl, {
      method: "GET",
      credentials: "same-origin",
    });

    const html = await res.text();
    if (!res.ok) throw new Error(`Productpagina ophalen mislukt: HTTP ${res.status}`);

    const doc = new DOMParser().parseFromString(html, "text/html");
    const form = doc.querySelector("form.change-cart-form") || doc.querySelector('form[name="Lager"]');
    if (!form) throw new Error("Geen Anita orderformulier gevonden");

    return form;
  }

  function findExactInput(form, row) {
    const name = getExactInputName(row);
    const input = form.querySelector(`input[name="${cssEscape(name)}"]`);
    return { input, name };
  }

  function buildPostBody(form, rows) {
    const body = new URLSearchParams();

    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const name = el.name || "";
      if (!name) return;

      if (/^gm_/i.test(name)) {
        body.set(name, "");
        return;
      }

      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
      body.set(name, el.value || "");
    });

    const totals = new Map();
    rows.forEach((row) => {
      totals.set(
        row.resolvedInputName,
        (totals.get(row.resolvedInputName) || 0) + row.quantity
      );
    });

    totals.forEach((quantity, inputName) => {
      body.set(inputName, String(quantity));
    });

    body.set("abkz", "W");
    return body;
  }

  async function postRows(form, rows) {
    const action = new URL(form.getAttribute("action") || "/nl/shop/442/", location.origin).href;

    const res = await fetch(action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: buildPostBody(form, rows).toString(),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Anita POST mislukt: HTTP ${res.status} ${text.slice(0, 120)}`);
  }

  function setOrderButtonReady(button, ready) {
    button.disabled = !ready;
    button.style.background = ready ? "#16a34a" : "#9ca3af";
    button.style.cursor = ready ? "pointer" : "not-allowed";
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

  function renderRows(rows, tableBody) {
    tableBody.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.productUrl = row.productUrl || "";

      [
        ["itemColor", `${row.itemNumber || ""} ${row.color || ""}`.trim()],
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
        input.addEventListener("input", () => {
          if (field === "itemColor") tr.dataset.productUrl = "";
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
      row.statusCell = statusCell;
      tr.appendChild(statusCell);
      tableBody.appendChild(tr);
    });
  }

  function readRowsFromTable(tableBody) {
    const text = Array.from(tableBody.querySelectorAll("tr"))
      .map((tr) => {
        const itemColor = tr.dataset.productUrl || tr.querySelector('input[data-field="itemColor"]')?.value || "";
        const size = tr.querySelector('input[data-field="size"]')?.value || "";
        const qty = tr.querySelector('input[data-field="quantity"]')?.value || "";
        return [itemColor, size, qty].join("\t");
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
      "width:460px",
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
    title.textContent = "Anita Order Tool";
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
    thead.innerHTML = "<tr><th>Artikel/kleur</th><th>Maat</th><th>Aantal</th><th></th></tr>";
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
        setRowsState(rows, "error", err?.message || "Productformulier ophalen mislukt");
        rows.forEach((row) => failedRows.add(row));
        continue;
      }

      const orderableRows = [];
      rows.forEach((row) => {
        const { input, name } = findExactInput(form, row);

        if (!input) {
          setRowsState([row], "error", `Exacte maat/kleur niet gevonden: ${row.color} ${row.size}`);
          failedRows.add(row);
          return;
        }

        const max = parseInt(input.getAttribute("max") || "", 10);
        const stock = parseInt(input.getAttribute("data-in-stock") || "", 10);
        if ((Number.isFinite(max) && max <= 0) || (Number.isFinite(stock) && stock <= 0)) {
          setRowsState([row], "error", `Niet bestelbaar of geen voorraad: ${row.color} ${row.size}`);
          failedRows.add(row);
          return;
        }

        row.resolvedInputName = name;
        orderableRows.push(row);
      });

      if (!orderableRows.length) continue;

      setRowsState(orderableRows, "busy", "Toevoegen");
      try {
        await postRows(form, orderableRows);
        setRowsState(orderableRows, "ok", "Toegevoegd");
      } catch (err) {
        setRowsState(orderableRows, "error", err?.message || "Toevoegen mislukt");
        orderableRows.forEach((row) => failedRows.add(row));
      }
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
      rows.push({ itemNumber: "", color: "", productUrl: "", size: "", quantity: "" });
      renderRows(rows, ui.tableBody);
      setOrderButtonReady(ui.orderButton, true);
      ui.tableBody.querySelector("tr:last-child input")?.focus();
    });
  }

  window.addEventListener("load", () => setTimeout(initUi, 500));
})();
