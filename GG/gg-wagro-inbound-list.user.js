// ==UserScript==
// @name         GG | Wagro Inbound List
// @namespace    gg-wagro-inbound
// @version      1.3.1
// @description  Check de Pick Prio locations per Extern Product.
// @match        https://fm-e-warehousing.goedgepickt.nl/goods/inbound/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-inbound-list.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-inbound-list.user.js
// ==/UserScript==

(function () {
  "use strict";

  const wagroRe = /wagro\s*\/\s*/i;
  const extRe = /\[ext\]/i;

  const COLORS = {
    gray: "#f1f3f5",
    green: "#d4edda",
    orange: "#ffe8b3",
  };

  const BADGE_BASE =
    "display:inline-flex;align-items:center;gap:.35rem;padding:.12rem .45rem;border-radius:999px;" +
    "font-size:12px;line-height:1;border:1px solid rgba(0,0,0,.12);margin-left:.5rem;white-space:nowrap;" +
    "color:#000;"; // ✅ always black text

  const cache = new Map();    // productUuid -> result
  const inFlight = new Map(); // productUuid -> Promise
  const fixing = new Set();   // productUuid

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getApiToken() {
    return window?.config?.user?.api_token || null;
  }
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || null;
  }

  function injectCssOnce() {
    if (document.getElementById("gg-wagro-inbound-css")) return;
    const style = document.createElement("style");
    style.id = "gg-wagro-inbound-css";
    style.textContent = `
      tr.gg-wagro-gray   { background: ${COLORS.gray} !important; }
      tr.gg-wagro-green  { background: ${COLORS.green} !important; }
      tr.gg-wagro-orange { background: ${COLORS.orange} !important; }

      .gg-wagro-pill { ${BADGE_BASE} }
      .gg-wagro-pill--gray   { background: ${COLORS.gray}; }
      .gg-wagro-pill--green  { background: ${COLORS.green}; }
      .gg-wagro-pill--orange { background: ${COLORS.orange}; }

      .gg-wagro-pill[role="button"] { cursor: pointer; }
      .gg-wagro-pill[aria-disabled="true"] { opacity:.65; cursor: default; }

      /* safety: never show pills in picklocation */
      td.goodsPicklocation .gg-wagro-pill { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function clearOurDecorations(tr) {
    tr.classList.remove("gg-wagro-gray", "gg-wagro-green", "gg-wagro-orange");
    tr.querySelectorAll(".gg-wagro-pill").forEach((n) => n.remove());
  }

  function purgePillsFromPicklocation(tr) {
    const pickTd = tr.querySelector("td.goodsPicklocation") || tr.querySelector("td:nth-child(6)");
    if (!pickTd) return;
    pickTd.querySelectorAll(".gg-wagro-pill").forEach((n) => n.remove());
  }

  function findProductNameCell(tr) {
    return tr.querySelector("td.goodsProductName") || tr.querySelector("td:nth-child(3)");
  }

  function insertPillAfterEAN(td, pillEl) {
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, null);
    let target = null;

    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n?.nodeValue && n.nodeValue.includes("EAN:")) {
        target = n;
        break;
      }
    }

    if (target && target.parentNode) {
      target.parentNode.insertBefore(pillEl, target.nextSibling);
      return true;
    }

    td.appendChild(pillEl);
    return false;
  }

  function makePill(result, tr, { loading = false } = {}) {
    const state = result?.state || "gray";

    const pill = document.createElement("span");
    pill.className =
      "gg-wagro-pill " +
      (state === "green" ? "gg-wagro-pill--green" :
       state === "orange" ? "gg-wagro-pill--orange" :
       "gg-wagro-pill--gray");

    // ✅ Loading pill (hourglass)
    if (loading) {
      pill.textContent = "WaGro check ⏳";
      pill.title = "Bezig met checken…";
      pill.setAttribute("aria-disabled", "true");
      return pill;
    }

    if (state === "gray") {
      pill.textContent = "WaGro niet gevonden";
      return pill;
    }

    const pr = result.wagroPrio ?? "?";

    if (state === "green") {
      pill.textContent = `WaGro prio ${pr}`;
      return pill;
    }

    // orange: clickable + tool emoji inside pill
    pill.textContent = `WaGro prio ${pr} 🛠️`;
    pill.setAttribute("role", "button");
    pill.tabIndex = 0;
    pill.title = "Klik om WaGro op prio 1 te zetten (rest hernummeren)";

    const handler = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await onFixClick(result.productUuid, tr, pill);
    };

    pill.addEventListener("click", handler);
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") handler(e);
    });

    return pill;
  }

  function setRowState(tr, result, { loading = false } = {}) {
    clearOurDecorations(tr);
    purgePillsFromPicklocation(tr);

    const state = result?.state || "gray";
    if (state === "gray") tr.classList.add("gg-wagro-gray");
    if (state === "green") tr.classList.add("gg-wagro-green");
    if (state === "orange") tr.classList.add("gg-wagro-orange");

    const nameTd = findProductNameCell(tr);
    if (!nameTd) return;

    const pill = makePill(result, tr, { loading });

    // ✅ ONLY in product name cell after EAN
    insertPillAfterEAN(nameTd, pill);

    // extra safety
    purgePillsFromPicklocation(tr);
  }

  async function fetchProductPageHtml(productUuid) {
    const res = await fetch(`/products/view/${productUuid}`, { credentials: "include" });
    if (!res.ok) throw new Error(`product page fetch failed: ${res.status}`);
    return await res.text();
  }

  function extractProductIdFromHtml(html) {
    const m = html.match(/\/api\/products\/stock\?[^"'<>]*\bid=(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function extractApiTokenFromHtml(html) {
    const m = html.match(/api_token:\s*'([^']+)'/i) || html.match(/api_token=([A-Za-z0-9]+)/i);
    return m ? m[1] : null;
  }

  function parsePriorityFromRow(row) {
    if (!row) return null;
    const p = row.priority;
    if (typeof p === "number") return p;
    if (p != null && /^\d+$/.test(String(p))) return parseInt(p, 10);

    const html = String(row.prio_select || "");
    const m = html.match(/option\s+value="(\d+)"\s+selected/i) || html.match(/option\s+value="(\d+)"\s+selected=""/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function buildStockRequestBody() {
    const cols = [
      { data: "picklocation", orderable: false },
      { data: "free_stock", orderable: false },
      { data: "total_stock", orderable: false },
      { data: "min_stock", orderable: false },
      { data: "max_stock", orderable: false },
      { data: "warehouse_stockvalue", orderable: false },
      { data: "priority", orderable: true },
      { data: "exclude_from_stock", orderable: false },
      { data: "Actions", orderable: false },
    ];

    const p = new URLSearchParams();
    p.set("draw", String(Math.floor(Date.now() / 1000)));
    cols.forEach((c, i) => {
      p.set(`columns[${i}][data]`, c.data);
      p.set(`columns[${i}][name]`, "");
      p.set(`columns[${i}][searchable]`, "true");
      p.set(`columns[${i}][orderable]`, c.orderable ? "true" : "false");
      p.set(`columns[${i}][search][value]`, "");
      p.set(`columns[${i}][search][regex]`, "false");
    });
    p.set("order[0][column]", "6");
    p.set("order[0][dir]", "asc");
    p.set("start", "0");
    p.set("length", "50");
    p.set("search[value]", "");
    p.set("search[regex]", "false");
    return p.toString();
  }

  async function fetchStockJson(productId, apiToken) {
    const url = `/api/products/stock?api_token=${encodeURIComponent(apiToken)}&id=${encodeURIComponent(productId)}`;
    const body = buildStockRequestBody();

    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body,
    });

    const txt = await res.text();
    if (!res.ok) throw new Error(`stock api ${res.status}: ${txt.slice(0, 200)}`);
    return JSON.parse(txt);
  }

  function computeStateFromStockData(productUuid, productId, apiToken, json) {
    const data = Array.isArray(json?.data) ? json.data : [];

    const mapped = data.map((r) => ({
      stockId: r.product_stock_id,
      loc: r.warehouse_picklocation || r.picklocation || "",
      prio: parsePriorityFromRow(r),
    }));

    const wagroRows = mapped.filter((x) => wagroRe.test(String(x.loc || "")));
    if (!wagroRows.length) {
      return { state: "gray", wagroPrio: null, productUuid, productId, apiToken, rows: mapped };
    }

    const prios = wagroRows.map((x) => x.prio).filter((n) => typeof n === "number" && !Number.isNaN(n));
    const wagroPrio = prios.length ? Math.min(...prios) : null;

    const state = wagroPrio === 1 ? "green" : "orange";
    return { state, wagroPrio, productUuid, productId, apiToken, rows: mapped };
  }

  async function computeStateForProduct(productUuid) {
    if (cache.has(productUuid)) return cache.get(productUuid);
    if (inFlight.has(productUuid)) return inFlight.get(productUuid);

    const p = (async () => {
      const html = await fetchProductPageHtml(productUuid);
      const productId = extractProductIdFromHtml(html);
      const apiToken = getApiToken() || extractApiTokenFromHtml(html);

      if (!apiToken || !productId) {
        const r = { state: "gray", wagroPrio: null, productUuid, productId: productId || null, apiToken: apiToken || null, rows: [] };
        cache.set(productUuid, r);
        return r;
      }

      const json = await fetchStockJson(productId, apiToken);
      const r = computeStateFromStockData(productUuid, productId, apiToken, json);
      cache.set(productUuid, r);
      return r;
    })();

    inFlight.set(productUuid, p);
    try { return await p; }
    finally { inFlight.delete(productUuid); }
  }

  async function postChangePrio(stockId, newPrio, csrfToken) {
    const body = new URLSearchParams({
      stock_id: String(stockId),
      _token: String(csrfToken),
      new_prio: String(newPrio),
    }).toString();

    const res = await fetch("/picklocations/change_prio", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body,
    });

    const txt = await res.text();
    if (!res.ok) throw new Error(`change_prio ${res.status}: ${txt.slice(0, 200)}`);
    return true;
  }

  function pickWagroWinner(rows) {
    const wagro = rows.filter((r) => wagroRe.test(String(r.loc || "")));
    if (!wagro.length) return null;

    wagro.sort((a, b) => {
      const pa = typeof a.prio === "number" ? a.prio : 9999;
      const pb = typeof b.prio === "number" ? b.prio : 9999;
      return pa - pb;
    });
    return wagro[0];
  }

  function orderOthers(rows, winnerStockId) {
    return rows
      .filter((r) => String(r.stockId) !== String(winnerStockId))
      .sort((a, b) => {
        const pa = typeof a.prio === "number" ? a.prio : 9999;
        const pb = typeof b.prio === "number" ? b.prio : 9999;
        if (pa !== pb) return pa - pb;
        return String(a.loc || "").localeCompare(String(b.loc || ""));
      });
  }

  async function onFixClick(productUuid, tr, pillEl) {
    if (!productUuid) return;
    if (fixing.has(productUuid)) return;
    fixing.add(productUuid);

    try {
      const csrf = getCsrfToken();
      if (!csrf) throw new Error("Geen CSRF token gevonden.");

      const result = await computeStateForProduct(productUuid);
      if (result.state !== "orange") return;
      if (!Array.isArray(result.rows) || !result.rows.length) throw new Error("Geen stock rows beschikbaar.");

      const winner = pickWagroWinner(result.rows);
      if (!winner) throw new Error("Geen WaGro locatie gevonden.");

      if (pillEl) {
        pillEl.textContent = `WaGro prio ${result.wagroPrio ?? "?"} ⏳`;
        pillEl.setAttribute("aria-disabled", "true");
        pillEl.title = "Bezig met aanpassen…";
      }

      const plan = [{ stockId: winner.stockId, prio: 1 }];
      let next = 2;
      for (const r of orderOthers(result.rows, winner.stockId)) {
        plan.push({ stockId: r.stockId, prio: next++ });
      }

      for (const step of plan) {
        await postChangePrio(step.stockId, step.prio, csrf);
        await sleep(80);
      }

      const json = await fetchStockJson(result.productId, result.apiToken);
      const updated = computeStateFromStockData(productUuid, result.productId, result.apiToken, json);
      cache.set(productUuid, updated);
      setRowState(tr, updated, { loading: false });
    } catch (e) {
      console.warn("[GG WaGro Inbound] Fix failed", productUuid, e);
      const cached = cache.get(productUuid);
      if (cached) setRowState(tr, cached, { loading: false });
    } finally {
      fixing.delete(productUuid);
    }
  }

  async function waitForDataTable() {
    const $ = window.jQuery;
    if (!$) return null;

    for (let i = 0; i < 200; i++) {
      if ($.fn?.dataTable?.isDataTable?.("#goodsBatchDatatable")) {
        return $("#goodsBatchDatatable").DataTable();
      }
      await sleep(100);
    }
    return null;
  }

  function getRowProductUuidFromData(dt, rowNode) {
    try { return dt.row(rowNode).data()?.productUuid || null; }
    catch { return null; }
  }

  function rowIsExt(dt, rowNode) {
    try {
      const data = dt.row(rowNode).data();
      const name = data?.productName || "";
      if (extRe.test(name)) return true;
    } catch {}
    return extRe.test(rowNode.innerText || "");
  }

  async function processVisibleRows(dt) {
    injectCssOnce();

    const rows = dt.rows({ page: "current" }).nodes().toArray();

    for (const tr of rows) {
      if (!rowIsExt(dt, tr)) {
        clearOurDecorations(tr);
        continue;
      }

      const productUuid = getRowProductUuidFromData(dt, tr);
      if (!productUuid) {
        setRowState(tr, { state: "gray", wagroPrio: null, productUuid: null }, { loading: false });
        continue;
      }

      // show loading pill immediately
      setRowState(tr, { state: "gray", wagroPrio: null, productUuid }, { loading: true });

      computeStateForProduct(productUuid)
        .then((result) => setRowState(tr, result, { loading: false }))
        .catch((err) => {
          console.warn("[GG WaGro Inbound] compute fail", productUuid, err);
          setRowState(tr, { state: "gray", wagroPrio: null, productUuid }, { loading: false });
        });

      await sleep(60);
    }
  }

  (async () => {
    const dt = await waitForDataTable();
    if (!dt) {
      console.warn("[GG WaGro Inbound] #goodsBatchDatatable niet gevonden.");
      return;
    }
    processVisibleRows(dt);
    window.jQuery("#goodsBatchDatatable").on("draw.dt", () => processVisibleRows(dt));
  })();

})();
