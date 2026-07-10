// ==UserScript==
// @name         GG | WaGro Inbound Locator
// @namespace    https://runiversity.nl/
// @version      2.2.0
// @description  [ext] en [bar] highlight (zonder badge) + WaGro prio kleuren + automatisch picklocation aanpassen. Alleen WaGro pill blijft.
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
  const ROW_SELECTOR = "tr[data-product-uuid]";

  const TITLE_ATTR = "data-product-name";
  const LOCATION_TAGS = ["[ext]", "[bar]"];

  const WAGRO_RE = /wagro/i;

  const MAX_CONCURRENT = 3;
  const MAX_UI_CONCURRENT = 1;

  // Locatie mapping: eerste match wint
  const LOCATION_RULES = [
    // ===================== Lisca =====================
    {
      name: "Lisca Nachtmode",
      match: /\blisca\b.*\bnachtmode\b/i,
      targetKey: "WaGro / Lisca Nachtmode"
    },
    {
      name: "Lisca Badmode",
      match: /\blisca\b.*\b(badmode|swim|swimwear)\b/i,
      targetKey: "WaGro / Lisca Badmode"
    },
    {
      name: "Lisca",
      match: /\blisca\b/i,
      targetKey: "WaGro / Lisca"
    },

    // ===================== Anita =====================
    {
      name: "Anita Maternity",
      match: /\banita\b.*\bmaternity\b/i,
      targetKey: "WaGro / Anita Maternity"
    },
    {
      name: "Anita Badmode",
      match: /\banita\b.*\b(badmode|swim|swimwear)\b/i,
      targetKey: "WaGro / Anita Badmode"
    },
    {
      name: "Anita",
      match: /\banita\b/i,
      targetKey: "WaGro / Anita"
    },

    // ===================== Rosa Faia =====================
    {
      name: "Rosa Faia Badmode",
      match: /\brosa\s*faia\b.*\b(badmode|swim|swimwear)\b/i,
      targetKey: "WaGro / Rosa Faia Badmode"
    },
    {
      name: "Rosa Faia",
      match: /\brosa\s*faia\b/i,
      targetKey: "WaGro / Rosa Faia"
    },

    // ===================== LingaDore =====================
    {
      name: "LingaDore Beach",
      match: /\blingadore\b.*\b(beach|badmode|swim|swimwear)\b/i,
      targetKey: "WaGro / LingaDore Beach"
    },
    {
      name: "LingaDore",
      match: /\blingadore\b/i,
      targetKey: "WaGro / LingaDore"
    },

    // ===================== Elomi =====================
    {
      name: "Elomi Swimwear",
      match: /\belomi\b.*\b(swim|swimwear|badmode)\b/i,
      targetKey: "WaGro / Elomi Swimwear"
    },
    {
      name: "Elomi",
      match: /\belomi\b/i,
      targetKey: "WaGro / Elomi"
    },

    // ===================== Fantasie =====================
    {
      name: "Fantasie Swim",
      match: /\bfantasie\b.*\b(swim|swimwear|badmode)\b/i,
      targetKey: "WaGro / Fantasie Swim"
    },
    {
      name: "Fantasie Lingerie",
      match: /\bfantasie\b.*\blingerie\b/i,
      targetKey: "WaGro / Fantasie Lingerie"
    },

    // ===================== Freya =====================
    {
      name: "Freya Swim",
      match: /\bfreya\b.*\b(swim|swimwear|badmode)\b/i,
      targetKey: "WaGro / Freya Swim"
    },
    {
      name: "Freya Lingerie",
      match: /\bfreya\b.*\blingerie\b/i,
      targetKey: "WaGro / Freya Lingerie"
    },

    // ===================== Muchachomalo / Chicamala =====================
    {
      name: "Muchachomalo",
      match: /\bmuchachomalo\b/i,
      targetKey: "WaGro / Muchachomalo"
    },
    {
      name: "Chicamala",
      match: /\bchicamala\b/i,
      targetKey: "WaGro / Muchachomalo"
    },

    // ===================== Triumph / Sloggi =====================
    {
      name: "Triumph",
      match: /\btriumph\b/i,
      targetKey: "WaGro / Triumph"
    },
    {
      name: "Sloggi",
      match: /\bsloggi\b/i,
      targetKey: "WaGro / Sloggi"
    },

    // ===================== Overige locaties =====================
    {
      name: "After Eden",
      match: /\bafter\s+eden\b/i,
      targetKey: "WaGro / After Eden"
    },
    {
      name: "Charlie Choe",
      match: /\bcharlie\s+choe\b/i,
      targetKey: "WaGro / Charlie Choe"
    },
    {
      name: "Elbrina",
      match: /\belbrina\b/i,
      targetKey: "WaGro / Elbrina"
    },
    {
      name: "HOM",
      match: /\bhom\b/i,
      targetKey: "WaGro / HOM"
    },
    {
      name: "Mundo Unico",
      match: /\bmundo\s+unico\b/i,
      targetKey: "Wagro / Mundo Unico"
    },
    {
      name: "Naturana Badmode",
      match: /\bnaturana\s+badmode\b/i,
      targetKey: "WaGro / Naturana Badmode"
    },
    {
      name: "Naturana",
      match: /\bnaturana\b/i,
      targetKey: "WaGro / Naturana"
    },
    {
      name: "Pastunette",
      match: /\bpastunette\b/i,
      targetKey: "WaGro / Pastunette"
    },
    {
      name: "Q-Linn",
      match: /\bq[\s-]*linn\b/i,
      targetKey: "WaGro / Q-Linn"
    },
    {
      name: "Rebelle",
      match: /\brebelle\b/i,
      targetKey: "WaGro / Rebelle"
    },
    {
      name: "RJ Bodywear",
      match: /\brj\s+bodywear\b/i,
      targetKey: "WaGro / RJ Bodywear"
    },
    {
      name: "Robson",
      match: /\brobson\b/i,
      targetKey: "WaGro / Robson"
    },
    {
      name: "Sugar Candy",
      match: /\bsugar\s+candy\b/i,
      targetKey: "WaGro / Sugar Candy"
    },
    {
      name: "Wacoal",
      match: /\bwacoal\b/i,
      targetKey: "WaGro / Wacoal"
    }
  ];

  /**********************************************************************
   * STYLES
   **********************************************************************/
  const STYLE_ID = "gg-combined-style";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
      /* ===================== [ext] / [bar] highlight ===================== */
      tr.tm-ext-orange:not(.gg-wagro-prio1) > td {
        background-color: rgba(255,165,0,0.18) !important;
      }

      tr.tm-ext-orange:not(.gg-wagro-prio1):hover > td {
        background-color: rgba(255,165,0,0.26) !important;
      }

      tr.tm-ext-orange:not(.gg-wagro-prio1) > td:first-child {
        box-shadow: inset 4px 0 0 rgba(255,140,0,0.55) !important;
      }

      /* ===================== WaGro kleuren ===================== */
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

      /* ===================== WaGro pill ===================== */
      .gg-wagro-pill {
        display: inline-block;
        margin-left: 8px;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 12px;
        color: #fff;
        vertical-align: middle;
      }

      .gg-wagro-pill--none {
        background: #888;
      }

      .gg-wagro-pill--prio1 {
        background: #1f8f3a;
      }

      .gg-wagro-pill--prioN {
        background: #d97706;
      }

      .gg-wagro-pill--err {
        background: #b14;
      }
    `;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**********************************************************************
   * QUEUES
   **********************************************************************/
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

      Promise.resolve()
        .then(fn)
        .catch(() => {})
        .finally(() => {
          netInFlight--;
          pumpNet();
        });
    }
  }

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

      Promise.resolve()
        .then(fn)
        .catch(() => {})
        .finally(() => {
          uiInFlight--;
          pumpUI();
        });
    }
  }

  /**********************************************************************
   * UTILS
   **********************************************************************/
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function waitFor(
    fn,
    {
      timeout = 2500,
      interval = 80
    } = {}
  ) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const value = fn();

      if (value) {
        return value;
      }

      await sleep(interval);
    }

    return null;
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**********************************************************************
   * [ext] / [bar] DETECTION
   **********************************************************************/
  function getRowTitle(row) {
    const fromAttribute = (
      row.getAttribute(TITLE_ATTR) || ""
    ).trim();

    if (fromAttribute) {
      return fromAttribute;
    }

    const link = row.querySelector("td:nth-child(2) a");

    return (link?.textContent || "").trim();
  }

  function applyLocationTagState(row) {
    const title = getRowTitle(row).toLowerCase();

    const hasLocationTag = LOCATION_TAGS.some(tag =>
      title.includes(tag)
    );

    row.classList.toggle("tm-ext-orange", hasLocationTag);
    row.dataset.ggHasLocationTag = hasLocationTag ? "1" : "0";

    return hasLocationTag;
  }

  function getTargetLocationKeyFromTitle(title) {
    const cleanTitle = stripHtml(title);

    for (const rule of LOCATION_RULES) {
      if (rule.match.test(cleanTitle)) {
        return rule.targetKey;
      }
    }

    return null;
  }

  /**********************************************************************
   * AUTO PICKLOCATION CHANGE
   **********************************************************************/
  function getPicklocationWidget(row) {
    const select = row.querySelector(
      "select.picklocationSelectPicker.bringStockToPicklocation"
    );

    if (!select) {
      return null;
    }

    const bootstrapSelect = select.closest(".bootstrap-select");

    const toggleButton = bootstrapSelect
      ? bootstrapSelect.querySelector("button.dropdown-toggle")
      : null;

    return {
      select,
      bootstrapSelect,
      toggleButton
    };
  }

  function getCurrentSelectedLocationText(row) {
    const widget = getPicklocationWidget(row);

    if (!widget?.bootstrapSelect) {
      return "";
    }

    const textElement = widget.bootstrapSelect.querySelector(
      ".filter-option .filter-option-inner"
    );

    return stripHtml(textElement?.textContent || "");
  }

  function dispatchChange(select) {
    select.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );

    select.dispatchEvent(
      new Event("change.bs.select", {
        bubbles: true
      })
    );
  }

  async function ensureOtherLocationMode(widget) {
    if (widget.select.value === "otherLocation") {
      return true;
    }

    const option = [...widget.select.options].find(
      item => item.value === "otherLocation"
    );

    if (!option) {
      return false;
    }

    widget.select.value = "otherLocation";
    dispatchChange(widget.select);

    await sleep(60);

    return true;
  }

  async function openDropdown(widget) {
    if (!widget.toggleButton) {
      return;
    }

    widget.toggleButton.click();

    await sleep(80);
  }

  async function selectTargetLocation(row, targetKey) {
    const widget = getPicklocationWidget(row);

    if (!widget?.select) {
      return {
        ok: false,
        reason: "no-select"
      };
    }

    const currentLocation = getCurrentSelectedLocationText(row);

    if (
      currentLocation &&
      stripHtml(currentLocation)
        .toLowerCase()
        .startsWith(stripHtml(targetKey).toLowerCase())
    ) {
      return {
        ok: true,
        reason: "already"
      };
    }

    const otherLocationEnabled =
      await ensureOtherLocationMode(widget);

    if (!otherLocationEnabled) {
      return {
        ok: false,
        reason: "no-otherLocation"
      };
    }

    await openDropdown(widget);

    const fancyDropdown = await waitFor(
      () =>
        row.querySelector(
          ".fancy-input-dropdown.dropdown-menu"
        ),
      {
        timeout: 3000,
        interval: 80
      }
    );

    if (!fancyDropdown) {
      return {
        ok: false,
        reason: "no-fancy"
      };
    }

    const input = await waitFor(
      () => fancyDropdown.querySelector("input.filter-input"),
      {
        timeout: 2000,
        interval: 80
      }
    );

    if (!input) {
      return {
        ok: false,
        reason: "no-filter-input"
      };
    }

    input.focus();
    input.value = targetKey;

    input.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    input.dispatchEvent(
      new Event("keyup", {
        bubbles: true
      })
    );

    await sleep(140);

    const option = await waitFor(
      () =>
        fancyDropdown.querySelector(
          `.dropdown-item.option.custom[data-key="${CSS.escape(
            targetKey
          )}"]`
        ),
      {
        timeout: 2500,
        interval: 80
      }
    );

    if (!option) {
      return {
        ok: false,
        reason: "no-option"
      };
    }

    option.click();

    const confirmed = await waitFor(
      () => {
        const newLocation =
          getCurrentSelectedLocationText(row);

        if (!newLocation) {
          return false;
        }

        const locationText = stripHtml(newLocation).toLowerCase();
        const targetText = stripHtml(targetKey).toLowerCase();

        return (
          locationText.startsWith(targetText) ||
          locationText.includes(targetText)
        );
      },
      {
        timeout: 3500,
        interval: 120
      }
    );

    return {
      ok: Boolean(confirmed),
      reason: confirmed ? "selected" : "unconfirmed"
    };
  }

  async function maybeAutoSetLocation(row) {
    // Alleen uitvoeren bij [ext] of [bar]
    if (row.dataset.ggHasLocationTag !== "1") {
      return;
    }

    // Voorkom dat dezelfde regel eindeloos wordt verwerkt
    if (row.dataset.ggLocDone === "1") {
      return;
    }

    row.dataset.ggLocDone = "1";

    const title = getRowTitle(row);
    const targetKey = getTargetLocationKeyFromTitle(title);

    if (!targetKey) {
      return;
    }

    const result = await selectTargetLocation(
      row,
      targetKey
    );

    if (
      !result.ok &&
      result.reason !== "unconfirmed"
    ) {
      row.dataset.ggLocDone = "0";
    }
  }

  /**********************************************************************
   * WAGRO PRIORITEITSCONTROLE
   **********************************************************************/
  const cacheKey = uuid =>
    `gg_wagro_state_${uuid}`;

  const ajaxUrlCacheKey = uuid =>
    `gg_wagro_ajax_${uuid}`;

  function setWagroPill(row, kind, text) {
    const cell = row.querySelector("td:nth-child(2)");

    if (!cell) {
      return;
    }

    let pill = cell.querySelector(".gg-wagro-pill");

    if (!pill) {
      pill = document.createElement("span");
      pill.className = "gg-wagro-pill";
      cell.appendChild(pill);
    }

    const desiredClass =
      kind === "prio1"
        ? "gg-wagro-pill gg-wagro-pill--prio1"
        : kind === "prioN"
          ? "gg-wagro-pill gg-wagro-pill--prioN"
          : kind === "err"
            ? "gg-wagro-pill gg-wagro-pill--err"
            : "gg-wagro-pill gg-wagro-pill--none";

    if (pill.className !== desiredClass) {
      pill.className = desiredClass;
    }

    if (pill.textContent !== text) {
      pill.textContent = text;
    }
  }

  function setRowWagroState(row, state, priority) {
    row.classList.toggle(
      "gg-wagro-none",
      state === "none"
    );

    row.classList.toggle(
      "gg-wagro-prio1",
      state === "prio1"
    );

    row.classList.toggle(
      "gg-wagro-prioN",
      state === "prioN"
    );

    if (state === "prio1") {
      setWagroPill(
        row,
        "prio1",
        `WaGro PP ${priority} ✔️`
      );
    } else if (state === "prioN") {
      setWagroPill(
        row,
        "prioN",
        `WaGro PP ${priority} ⚠️`
      );
    } else {
      setWagroPill(
        row,
        "none",
        "WaGro PP ⛔"
      );
    }
  }

  function markWagroError(row) {
    setWagroPill(
      row,
      "err",
      "WaGro check error"
    );
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        withCredentials: true,
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        onload: response => {
          if (
            response.status >= 200 &&
            response.status < 300
          ) {
            resolve(response.responseText);
          } else {
            reject(
              new Error(`GET ${response.status}`)
            );
          }
        },
        onerror: reject,
        ontimeout: reject,
        timeout: 20000
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
          Accept:
            "application/json, text/javascript, */*; q=0.01",
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With":
            "XMLHttpRequest"
        },
        onload: response => {
          resolve({
            status: response.status,
            text: response.responseText
          });
        },
        onerror: reject,
        ontimeout: reject,
        timeout: 20000
      });
    });
  }

  function extractStockAjaxUrl(productHtml) {
    const match = productHtml.match(
      /\/api\/products\/stock\?[^"'<>]*\bid=\d+/i
    );

    if (!match) {
      return null;
    }

    const path = match[0].replace(
      /&amp;/g,
      "&"
    );

    return new URL(
      path,
      location.origin
    ).toString();
  }

  function buildStockRequestBody(drawNumber) {
    const parameters = new URLSearchParams();

    parameters.set(
      "draw",
      String(drawNumber)
    );

    const columns = [
      {
        data: "picklocation",
        orderable: false
      },
      {
        data: "free_stock",
        orderable: false
      },
      {
        data: "total_stock",
        orderable: false
      },
      {
        data: "min_stock",
        orderable: false
      },
      {
        data: "max_stock",
        orderable: false
      },
      {
        data: "warehouse_stockvalue",
        orderable: false
      },
      {
        data: "priority",
        orderable: true
      },
      {
        data: "exclude_from_stock",
        orderable: false
      },
      {
        data: "Actions",
        orderable: false
      }
    ];

    columns.forEach((column, index) => {
      parameters.set(
        `columns[${index}][data]`,
        column.data
      );

      parameters.set(
        `columns[${index}][name]`,
        ""
      );

      parameters.set(
        `columns[${index}][searchable]`,
        "true"
      );

      parameters.set(
        `columns[${index}][orderable]`,
        column.orderable ? "true" : "false"
      );

      parameters.set(
        `columns[${index}][search][value]`,
        ""
      );

      parameters.set(
        `columns[${index}][search][regex]`,
        "false"
      );
    });

    parameters.set(
      "order[0][column]",
      "6"
    );

    parameters.set(
      "order[0][dir]",
      "asc"
    );

    parameters.set(
      "start",
      "0"
    );

    parameters.set(
      "length",
      "25"
    );

    parameters.set(
      "search[value]",
      ""
    );

    parameters.set(
      "search[regex]",
      "false"
    );

    return parameters.toString();
  }

  function getPicklocationText(row) {
    const rawValue =
      row?.picklocation ??
      row?.warehouse_picklocation ??
      row?.warehouse_picklocation?.picklocation ??
      row?.warehouse_picklocation?.name ??
      row?.location ??
      row?.pick_location ??
      "";

    return stripHtml(rawValue);
  }

  function parsePriority(row) {
    const rawPriority =
      row?.priority ??
      row?.prio ??
      row?.Priority ??
      "";

    const priority = parseInt(
      stripHtml(rawPriority),
      10
    );

    return Number.isFinite(priority)
      ? priority
      : NaN;
  }

  async function getWaGroStateViaApi(
    stockAjaxUrl
  ) {
    const draw = Math.floor(
      Date.now() / 1000
    );

    const body =
      buildStockRequestBody(draw);

    const {
      status,
      text
    } = await gmPost(
      stockAjaxUrl,
      body
    );

    if (
      status < 200 ||
      status >= 300
    ) {
      throw new Error(`HTTP ${status}`);
    }

    const json = JSON.parse(text);
    const rows = json?.data;

    if (!Array.isArray(rows)) {
      return {
        state: "none"
      };
    }

    const wagroRows = rows.filter(row =>
      WAGRO_RE.test(
        getPicklocationText(row)
      )
    );

    if (!wagroRows.length) {
      return {
        state: "none"
      };
    }

    const priorities = wagroRows
      .map(parsePriority)
      .filter(
        priority =>
          Number.isFinite(priority) &&
          priority > 0
      );

    const bestPriority = priorities.length
      ? Math.min(...priorities)
      : null;

    if (bestPriority === 1) {
      return {
        state: "prio1",
        prio: 1
      };
    }

    if (
      bestPriority &&
      bestPriority > 1
    ) {
      return {
        state: "prioN",
        prio: bestPriority
      };
    }

    return {
      state: "prioN",
      prio: "?"
    };
  }

  async function checkRowWagro(row) {
    const uuid = row.getAttribute(
      "data-product-uuid"
    );

    if (!uuid) {
      return;
    }

    if (
      row.dataset.ggWagroChecked === "1"
    ) {
      return;
    }

    row.dataset.ggWagroChecked = "1";

    const cached = sessionStorage.getItem(
      cacheKey(uuid)
    );

    if (cached === "prio1") {
      setRowWagroState(
        row,
        "prio1",
        1
      );

      return;
    }

    if (
      cached &&
      cached.startsWith("prioN:")
    ) {
      setRowWagroState(
        row,
        "prioN",
        cached.split(":")[1]
      );

      return;
    }

    if (cached === "none") {
      setRowWagroState(
        row,
        "none"
      );

      return;
    }

    try {
      let stockAjaxUrl =
        sessionStorage.getItem(
          ajaxUrlCacheKey(uuid)
        );

      if (!stockAjaxUrl) {
        const productPageUrl =
          `https://fm-e-warehousing.goedgepickt.nl/products/view/${encodeURIComponent(
            uuid
          )}`;

        const html = await gmGet(
          productPageUrl
        );

        stockAjaxUrl =
          extractStockAjaxUrl(html);

        if (!stockAjaxUrl) {
          sessionStorage.setItem(
            cacheKey(uuid),
            "none"
          );

          setRowWagroState(
            row,
            "none"
          );

          return;
        }

        sessionStorage.setItem(
          ajaxUrlCacheKey(uuid),
          stockAjaxUrl
        );
      }

      const result =
        await getWaGroStateViaApi(
          stockAjaxUrl
        );

      if (result.state === "prio1") {
        sessionStorage.setItem(
          cacheKey(uuid),
          "prio1"
        );

        setRowWagroState(
          row,
          "prio1",
          1
        );
      } else if (
        result.state === "prioN"
      ) {
        sessionStorage.setItem(
          cacheKey(uuid),
          `prioN:${result.prio}`
        );

        setRowWagroState(
          row,
          "prioN",
          result.prio
        );
      } else {
        sessionStorage.setItem(
          cacheKey(uuid),
          "none"
        );

        setRowWagroState(
          row,
          "none"
        );
      }
    } catch (error) {
      console.error(
        "[GG WaGro Inbound Locator]",
        error
      );

      markWagroError(row);
    }
  }

  /**********************************************************************
   * PROCESS ROW
   **********************************************************************/
  function initRow(row) {
    // 1. Markeer [ext] en [bar]
    const hasLocationTag =
      applyLocationTagState(row);

    // 2. Pas bij [ext] en [bar] automatisch de locatie aan
    if (hasLocationTag) {
      enqueueUI(() =>
        maybeAutoSetLocation(row)
      );
    }

    // 3. Controleer WaGro-prioriteit
    enqueueNet(() =>
      checkRowWagro(row)
    );
  }

  /**********************************************************************
   * SCAN NEW ROWS
   **********************************************************************/
  function scanNewRows() {
    const tableBody = document.querySelector(
      TBODY_SELECTOR
    );

    if (!tableBody) {
      return;
    }

    tableBody
      .querySelectorAll(ROW_SELECTOR)
      .forEach(row => {
        if (
          row.dataset.ggInit === "1"
        ) {
          return;
        }

        row.dataset.ggInit = "1";

        initRow(row);
      });
  }

  let scanTimer = null;

  function scheduleScan() {
    if (scanTimer) {
      return;
    }

    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanNewRows();
    }, 120);
  }

  function observeTbody() {
    const tableBody = document.querySelector(
      TBODY_SELECTOR
    );

    if (!tableBody) {
      return false;
    }

    const observer = new MutationObserver(
      () => {
        scheduleScan();
      }
    );

    observer.observe(tableBody, {
      childList: true,
      subtree: false
    });

    return true;
  }

  /**********************************************************************
   * INIT
   **********************************************************************/
  ensureStyle();

  let tries = 0;

  const initTimer = setInterval(() => {
    tries++;

    const observing = observeTbody();

    scanNewRows();

    if (
      observing ||
      tries > 40
    ) {
      clearInterval(initTimer);
    }
  }, 200);
})();
