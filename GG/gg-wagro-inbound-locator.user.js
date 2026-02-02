// ==UserScript==
// @name         GG | WaGro Inbound Locator
// @namespace    https://runiversity.nl/
// @version      2.1.0
// @description  [ext] highlight (zonder badge) + WaGro prio kleuren + bij [ext] automatisch picklocation aanpassen. Alleen WaGro pill blijft.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        GM_xmlhttpRequest
// @connect      fm-e-warehousing.goedgepickt.nl
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-inbound-locator.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/gg-wagro-inbound-locator.user.js
// ==/UserScript==

(() => {
  "use strict";

  /**********************************************************************
   * CONFIG
   **********************************************************************/
  const TABLE_SELECTOR = "#scannedIncomingProductsTable";
  const TBODY_SELECTOR = `${TABLE_SELECTOR} tbody.scanned_products_body`;
  const ROW_SELECTOR   = "tr[data-product-uuid]";

  const TITLE_ATTR = "data-product-name";
  const EXT_TAG    = "[ext]";

  const WAGRO_RE = /wagro/i;

  const MAX_CONCURRENT = 3;     // network (WaGro prio)
  const MAX_UI_CONCURRENT = 1;  // UI automation (locatie wijzigen)

  // Locatie mapping: eerste match wint
// Locatie mapping: eerste match wint
const LOCATION_RULES = [
  // ===================== Lisca (varianten eerst) =====================
  { name: "Lisca Nachtmode", match: /\blisca\b.*\bnachtmode\b/i,                 targetKey: "WaGro / Lisca Nachtmode" },
  { name: "Lisca Badmode",   match: /\blisca\b.*\b(badmode|swim|swimwear)\b/i,   targetKey: "WaGro / Lisca Badmode" },
  { name: "Lisca",           match: /\blisca\b/i,                               targetKey: "WaGro / Lisca" },

  // ===================== Anita (varianten) =====================
  { name: "Anita Maternity", match: /\banita\b.*\bmaternity\b/i,                targetKey: "WaGro / Anita Maternity" },
  { name: "Anita Badmode",   match: /\banita\b.*\b(badmode|swim|swimwear)\b/i,   targetKey: "WaGro / Anita Badmode" },
  { name: "Anita",           match: /\banita\b/i,                               targetKey: "WaGro / Anita" },

  // ===================== Rosa Faia (varianten) =====================
  { name: "Rosa Faia Badmode", match: /\brosa\s*faia\b.*\b(badmode|swim|swimwear)\b/i, targetKey: "WaGro / Rosa Faia Badmode" },
  { name: "Rosa Faia",         match: /\brosa\s*faia\b/i,                              targetKey: "WaGro / Rosa Faia" },

  // ===================== LingaDore (varianten) =====================
  { name: "LingaDore Beach", match: /\blingadore\b.*\b(beach|badmode|swim|swimwear)\b/i, targetKey: "WaGro / LingaDore Beach" },
  { name: "LingaDore",       match: /\blingadore\b/i,                                   targetKey: "WaGro / LingaDore" },

  // ===================== Elomi (varianten) =====================
  { name: "Elomi Swimwear",  match: /\belomi\b.*\b(swim|swimwear|badmode)\b/i,     targetKey: "WaGro / Elomi Swimwear" },
  { name: "Elomi",           match: /\belomi\b/i,                                   targetKey: "WaGro / Elomi" },

  // ===================== Fantasie (varianten) =====================
  { name: "Fantasie Swim",     match: /\bfantasie\b.*\b(swim|swimwear|badmode)\b/i, targetKey: "WaGro / Fantasie Swim" },
  { name: "Fantasie Lingerie", match: /\bfantasie\b.*\blingerie\b/i,                targetKey: "WaGro / Fantasie Lingerie" },

  // ===================== Freya (varianten) =====================
  { name: "Freya Swim",     match: /\bfreya\b.*\b(swim|swimwear|badmode)\b/i,       targetKey: "WaGro / Freya Swim" },
  { name: "Freya Lingerie", match: /\bfreya\b.*\blingerie\b/i,                      targetKey: "WaGro / Freya Lingerie" },

  // ===================== Muchachomalo / Chicamala =====================
  { name: "Muchachomalo",   match: /\bmuchachomalo\b/i,   targetKey: "WaGro / Muchachomalo" },
  { name: "Chicamala",      match: /\bchicamala\b/i,      targetKey: "WaGro / Muchachomalo" },

  // ===================== Triumph / Sloggi =====================
  { name: "Triumph",        match: /\btriumph\b/i,        targetKey: "WaGro / Triumph" },
  { name: "Sloggi",         match: /\bsloggi\b/i,         targetKey: "WaGro / Sloggi" },

  // ===================== Overige locaties (1-op-1) =====================
  { name: "After Eden",     match: /\bafter\s+eden\b/i,   targetKey: "WaGro / After Eden" },
  { name: "Charlie Choe",   match: /\bcharlie\s+choe\b/i, targetKey: "WaGro / Charlie Choe" },
  { name: "Elbrina",        match: /\belbrina\b/i,        targetKey: "WaGro / Elbrina" },
  { name: "HOM",            match: /\bhom\b/i,            targetKey: "WaGro / HOM" },
  { name: "Mundo Unico",    match: /\bmundo\s+unico\b/i,  targetKey: "Wagro / Mundo Unico" },
  { name: "Naturana Badmode",       match: /\bnaturana\s+badmode\b/i,       targetKey: "WaGro / Naturana Badmode" },
  { name: "Naturana",       match: /\bnaturana\b/i,       targetKey: "WaGro / Naturana" },
  { name: "Pastunette",     match: /\bpastunette\b/i,     targetKey: "WaGro / Pastunette" },
  { name: "Q-Linn",         match: /\bq[\s-]*linn\b/i,    targetKey: "WaGro / Q-Linn" },
  { name: "Rebelle",        match: /\brebelle\b/i,        targetKey: "WaGro / Rebelle" },
  { name: "RJ Bodywear",    match: /\brj\s+bodywear\b/i,  targetKey: "WaGro / RJ Bodywear" },
  { name: "Robson",         match: /\brobson\b/i,         targetKey: "WaGro / Robson" },
  { name: "Sugar Candy",    match: /\bsugar\s+candy\b/i,  targetKey: "WaGro / Sugar Candy" },
  { name: "Wacoal",         match: /\bwacoal\b/i,         targetKey: "WaGro / Wacoal" },
];


  /**********************************************************************
   * STYLES
   **********************************************************************/
  const STYLE_ID = "gg-combined-style";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
      /* ===================== [ext] highlight (geen badge) ===================== */
      tr.tm-ext-orange:not(.gg-wagro-prio1) > td {
        background-color: rgba(255,165,0,0.18) !important;
      }
      tr.tm-ext-orange:not(.gg-wagro-prio1):hover > td {
        background-color: rgba(255,165,0,0.26) !important;
      }
      tr.tm-ext-orange:not(.gg-wagro-prio1) > td:first-child {
        box-shadow: inset 4px 0 0 rgba(255,140,0,0.55) !important;
      }

      /* ===================== WaGro kleuren (TD-based) ===================== */
      tr.gg-wagro-none:not(.tm-ext-orange) > td {
        background-color: rgba(180,180,180,0.22) !important;
      }

      tr.gg-wagro-prio1 > td {
        background-color: rgba(55,165,80,0.18) !important;
      }
      tr.gg-wagro-prio1:hover > td {
        background-color: rgba(55,165,80,0.26) !important;
      }
      tr.gg-wagro-prio1 > td:first-child {
        box-shadow: inset 4px 0 0 rgba(31,143,58,0.55) !important;
      }

      tr.gg-wagro-prioN > td {
        background-color: rgba(255,165,0,0.18) !important;
      }
      tr.gg-wagro-prioN:hover > td {
        background-color: rgba(255,165,0,0.26) !important;
      }
      tr.gg-wagro-prioN > td:first-child {
        box-shadow: inset 4px 0 0 rgba(217,119,6,0.55) !important;
      }

      /* ===================== WaGro pill (enige pill die blijft) ===================== */
      .gg-wagro-pill{
        display:inline-block;
        margin-left:8px;
        padding:2px 8px;
        border-radius:999px;
        font-size:12px;
        color:#fff;
        vertical-align:middle;
      }
      .gg-wagro-pill--none{ background:#888; }
      .gg-wagro-pill--prio1{ background:#1f8f3a; }
      .gg-wagro-pill--prioN{ background:#d97706; }
      .gg-wagro-pill--err{ background:#b14; }
    `;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**********************************************************************
   * QUEUES
   **********************************************************************/
  // Network queue (WaGro API)
  let netInFlight = 0;
  const netQueue = [];
  function enqueueNet(taskFn) {
    netQueue.push(taskFn);
    pumpNet();
  }
  function pumpNet() {
    while (netInFlight < MAX_CONCURRENT && netQueue.length) {
      const fn = netQueue.shift();
      netInFlight++;
      Promise.resolve().then(fn).catch(() => {}).finally(() => {
        netInFlight--;
        pumpNet();
      });
    }
  }

  // UI queue (auto-locatie) — max 1 tegelijk
  let uiInFlight = 0;
  const uiQueue = [];
  function enqueueUI(taskFn) {
    uiQueue.push(taskFn);
    pumpUI();
  }
  function pumpUI() {
    while (uiInFlight < MAX_UI_CONCURRENT && uiQueue.length) {
      const fn = uiQueue.shift();
      uiInFlight++;
      Promise.resolve().then(fn).catch(() => {}).finally(() => {
        uiInFlight--;
        pumpUI();
      });
    }
  }

  /**********************************************************************
   * Utils
   **********************************************************************/
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitFor(fn, { timeout = 2500, interval = 80 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function stripHtml(s) {
    return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  /**********************************************************************
   * EXT detection (highlight only)
   **********************************************************************/
  function getRowTitle(tr) {
    const fromAttr = (tr.getAttribute(TITLE_ATTR) || "").trim();
    if (fromAttr) return fromAttr;

    const a = tr.querySelector("td:nth-child(2) a");
    return (a?.textContent || "").trim();
  }

  function applyExtState(tr) {
    const title = getRowTitle(tr);
    const isExt = !!(title && title.includes(EXT_TAG));
    tr.classList.toggle("tm-ext-orange", isExt);
    tr.dataset.ggIsExt = isExt ? "1" : "0";
    return isExt;
  }

  function getTargetLocationKeyFromTitle(title) {
    const clean = stripHtml(title);
    for (const rule of LOCATION_RULES) {
      if (rule.match.test(clean)) return rule.targetKey;
    }
    return null;
  }

  /**********************************************************************
   * Auto picklocation change (bij [ext])
   **********************************************************************/
  function getPicklocationWidget(row) {
    const select = row.querySelector("select.picklocationSelectPicker.bringStockToPicklocation");
    if (!select) return null;
    const bs = select.closest(".bootstrap-select");
    const toggleBtn = bs ? bs.querySelector("button.dropdown-toggle") : null;
    return { select, bs, toggleBtn };
  }

  function getCurrentSelectedLocationText(row) {
    const w = getPicklocationWidget(row);
    if (!w?.bs) return "";
    const t = w.bs.querySelector(".filter-option .filter-option-inner");
    return stripHtml(t?.textContent || "");
  }

  function dispatchChange(select) {
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("change.bs.select", { bubbles: true }));
  }

  async function ensureOtherLocationMode(w) {
    if (w.select.value === "otherLocation") return true;

    const opt = [...w.select.options].find(o => o.value === "otherLocation");
    if (!opt) return false;

    w.select.value = "otherLocation";
    dispatchChange(w.select);
    await sleep(60);
    return true;
  }

  async function openDropdown(w) {
    if (w.toggleBtn) {
      w.toggleBtn.click();
      await sleep(80);
    }
  }

  async function selectTargetLocation(row, targetKey) {
    const w = getPicklocationWidget(row);
    if (!w?.select) return { ok: false, reason: "no-select" };

    // als al goed: klaar
    const current = getCurrentSelectedLocationText(row);
    if (current && stripHtml(current).toLowerCase().startsWith(stripHtml(targetKey).toLowerCase())) {
      return { ok: true, reason: "already" };
    }

    // 1) otherLocation
    const okOther = await ensureOtherLocationMode(w);
    if (!okOther) return { ok: false, reason: "no-otherLocation" };

    // 2) open dropdown
    await openDropdown(w);

    // 3) fancy menu + input
    const fancy = await waitFor(
      () => row.querySelector(".fancy-input-dropdown.dropdown-menu"),
      { timeout: 3000, interval: 80 }
    );
    if (!fancy) return { ok: false, reason: "no-fancy" };

    const input = await waitFor(
      () => fancy.querySelector("input.filter-input"),
      { timeout: 2000, interval: 80 }
    );
    if (!input) return { ok: false, reason: "no-filter-input" };

    // 4) filter invullen
    input.focus();
    input.value = targetKey;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
    await sleep(140);

    // 5) klik option
    const option = await waitFor(
      () => fancy.querySelector(`.dropdown-item.option.custom[data-key="${CSS.escape(targetKey)}"]`),
      { timeout: 2500, interval: 80 }
    );
    if (!option) return { ok: false, reason: "no-option" };

    option.click();

    // robuuste confirm: wacht tot UI tekst update
    const confirmed = await waitFor(() => {
      const after = getCurrentSelectedLocationText(row);
      if (!after) return false;
      const a = stripHtml(after).toLowerCase();
      const t = stripHtml(targetKey).toLowerCase();
      return a.startsWith(t) || a.includes(t);
    }, { timeout: 3500, interval: 120 });

    // Als niet bevestigd maar visueel vaak wel goed: niet als error behandelen
    return { ok: !!confirmed, reason: confirmed ? "selected" : "unconfirmed" };
  }

  async function maybeAutoSetLocation(row) {
    // Alleen bij ext
    if (row.dataset.ggIsExt !== "1") return;

    // niet eindeloos
    if (row.dataset.ggLocDone === "1") return;
    row.dataset.ggLocDone = "1";

    const title = getRowTitle(row);
    const targetKey = getTargetLocationKeyFromTitle(title);
    if (!targetKey) return;

    const res = await selectTargetLocation(row, targetKey);

    // bij 'unconfirmed' doen we niks (geen pill, geen retry-storm)
    if (!res.ok && res.reason !== "unconfirmed") {
      // echte error → allow retry later
      row.dataset.ggLocDone = "0";
    }
  }

  /**********************************************************************
   * WaGro prio check (server-side)
   **********************************************************************/
  const cacheKey = (uuid) => `gg_wagro_state_${uuid}`;
  const ajaxUrlCacheKey = (uuid) => `gg_wagro_ajax_${uuid}`;

  function setWagroPill(row, kind, text) {
    const cell = row.querySelector("td:nth-child(2)");
    if (!cell) return;

    let pill = cell.querySelector(".gg-wagro-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "gg-wagro-pill";
      cell.appendChild(pill);
    }

    const desiredClass =
      kind === "prio1" ? "gg-wagro-pill gg-wagro-pill--prio1" :
      kind === "prioN" ? "gg-wagro-pill gg-wagro-pill--prioN" :
      kind === "err"   ? "gg-wagro-pill gg-wagro-pill--err"   :
                         "gg-wagro-pill gg-wagro-pill--none";

    if (pill.className !== desiredClass) pill.className = desiredClass;
    if (pill.textContent !== text) pill.textContent = text;
  }

  function setRowWagroState(row, state, prio) {
    row.classList.toggle("gg-wagro-none",  state === "none");
    row.classList.toggle("gg-wagro-prio1", state === "prio1");
    row.classList.toggle("gg-wagro-prioN", state === "prioN");

    if (state === "prio1") setWagroPill(row, "prio1", `WaGro PP ${prio} ✔️`);
    else if (state === "prioN") setWagroPill(row, "prioN", `WaGro PP ${prio} ⚠️`);
    else setWagroPill(row, "none", "WaGro PP ⛔");
  }

  function markWagroError(row) {
    setWagroPill(row, "err", "WaGro check error");
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        withCredentials: true,
        headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        onload: (r) => (r.status >= 200 && r.status < 300) ? resolve(r.responseText) : reject(new Error(`GET ${r.status}`)),
        onerror: reject,
        ontimeout: reject,
        timeout: 20000,
      });
    });
  }

  function gmPost(url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        data: body,
        withCredentials: true,
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        onload: (r) => resolve({ status: r.status, text: r.responseText }),
        onerror: reject,
        ontimeout: reject,
        timeout: 20000,
      });
    });
  }

  function extractStockAjaxUrl(productHtml) {
    const m = productHtml.match(/\/api\/products\/stock\?[^"'<>]*\bid=\d+/i);
    if (!m) return null;
    const path = m[0].replace(/&amp;/g, "&");
    return new URL(path, location.origin).toString();
  }

  function buildStockRequestBody(drawNumber) {
    const p = new URLSearchParams();
    p.set("draw", String(drawNumber));

    const cols = [
      { data: "picklocation",         orderable: false },
      { data: "free_stock",           orderable: false },
      { data: "total_stock",          orderable: false },
      { data: "min_stock",            orderable: false },
      { data: "max_stock",            orderable: false },
      { data: "warehouse_stockvalue", orderable: false },
      { data: "priority",             orderable: true  },
      { data: "exclude_from_stock",   orderable: false },
      { data: "Actions",              orderable: false }
    ];

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
    p.set("length", "25");
    p.set("search[value]", "");
    p.set("search[regex]", "false");

    return p.toString();
  }

  function getPicklocationText(r) {
    const raw =
      r?.picklocation ??
      r?.warehouse_picklocation ??
      r?.warehouse_picklocation?.picklocation ??
      r?.warehouse_picklocation?.name ??
      r?.location ??
      r?.pick_location ??
      "";
    return stripHtml(raw);
  }

  function parsePriority(r) {
    const raw = r?.priority ?? r?.prio ?? r?.Priority ?? "";
    const n = parseInt(stripHtml(raw), 10);
    return Number.isFinite(n) ? n : NaN;
  }

  async function getWaGroStateViaApi(stockAjaxUrl) {
    const draw = Math.floor(Date.now() / 1000);
    const body = buildStockRequestBody(draw);

    const { status, text } = await gmPost(stockAjaxUrl, body);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);

    const j = JSON.parse(text);
    const rows = j?.data;
    if (!Array.isArray(rows)) return { state: "none" };

    const wagroRows = rows.filter(r => WAGRO_RE.test(getPicklocationText(r)));
    if (!wagroRows.length) return { state: "none" };

    const prios = wagroRows
      .map(parsePriority)
      .filter(n => Number.isFinite(n) && n > 0);

    const bestPrio = prios.length ? Math.min(...prios) : null;

    if (bestPrio === 1) return { state: "prio1", prio: 1 };
    if (bestPrio && bestPrio > 1) return { state: "prioN", prio: bestPrio };

    return { state: "prioN", prio: "?" };
  }

  async function checkRowWagro(row) {
    const uuid = row.getAttribute("data-product-uuid");
    if (!uuid) return;

    if (row.dataset.ggWagroChecked === "1") return;
    row.dataset.ggWagroChecked = "1";

    const cached = sessionStorage.getItem(cacheKey(uuid));
    if (cached === "prio1") return setRowWagroState(row, "prio1", 1);
    if (cached && cached.startsWith("prioN:")) return setRowWagroState(row, "prioN", cached.split(":")[1]);
    if (cached === "none") return setRowWagroState(row, "none");

    try {
      let stockAjaxUrl = sessionStorage.getItem(ajaxUrlCacheKey(uuid));
      if (!stockAjaxUrl) {
        const productPageUrl = `https://fm-e-warehousing.goedgepickt.nl/products/view/${encodeURIComponent(uuid)}`;
        const html = await gmGet(productPageUrl);
        stockAjaxUrl = extractStockAjaxUrl(html);
        if (!stockAjaxUrl) {
          sessionStorage.setItem(cacheKey(uuid), "none");
          return setRowWagroState(row, "none");
        }
        sessionStorage.setItem(ajaxUrlCacheKey(uuid), stockAjaxUrl);
      }

      const result = await getWaGroStateViaApi(stockAjaxUrl);

      if (result.state === "prio1") {
        sessionStorage.setItem(cacheKey(uuid), "prio1");
        setRowWagroState(row, "prio1", 1);
      } else if (result.state === "prioN") {
        sessionStorage.setItem(cacheKey(uuid), `prioN:${result.prio}`);
        setRowWagroState(row, "prioN", result.prio);
      } else {
        sessionStorage.setItem(cacheKey(uuid), "none");
        setRowWagroState(row, "none");
      }

    } catch (e) {
      markWagroError(row);
    }
  }

  /**********************************************************************
   * PROCESS ROW
   **********************************************************************/
  function initRow(row) {
    // 1) ext highlight
    const isExt = applyExtState(row);

    // 2) bij ext: auto-locatie (UI queue)
    if (isExt) {
      enqueueUI(() => maybeAutoSetLocation(row));
    }

    // 3) wagro check (network queue)
    enqueueNet(() => checkRowWagro(row));
  }

  /**********************************************************************
   * SCAN only new rows (anti-freeze)
   **********************************************************************/
  function scanNewRows() {
    const tbody = document.querySelector(TBODY_SELECTOR);
    if (!tbody) return;

    tbody.querySelectorAll(ROW_SELECTOR).forEach(row => {
      if (row.dataset.ggInit === "1") return;
      row.dataset.ggInit = "1";
      initRow(row);
    });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanNewRows();
    }, 120);
  }

  function observeTbody() {
    const tbody = document.querySelector(TBODY_SELECTOR);
    if (!tbody) return false;

    const obs = new MutationObserver(() => {
      scheduleScan();
    });

    // subtree=false zodat onze eigen DOM updates geen loop veroorzaken
    obs.observe(tbody, { childList: true, subtree: false });
    return true;
  }

  /**********************************************************************
   * INIT
   **********************************************************************/
  ensureStyle();

  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const ok = observeTbody();
    scanNewRows();
    if (ok || tries > 40) clearInterval(t);
  }, 200);

})();
