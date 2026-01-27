// ==UserScript==
// @name         Mey | Stock Reveal
// @version      1.2
// @description  Haalt actuele stock via OrderDetail/collection en toont alleen een (n) badge in .stockContainer zonder bestaande UI/classes te wijzigen.
// @match        https://meyb2b.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[MEY-STOCK-BADGE]", ...a);

  // ---- Context uit jouw payload ----
  const MEY_CTX = {
    dataareaid: "ME:NO",
    custid: "385468",
    assortid: "ddd8763b-b678-4004-ba8b-c64d45b5333c",
    ordertypeid: "NO",
    webSocketUniqueId:
      (crypto?.randomUUID ? crypto.randomUUID() : `ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  };

  const txt = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const normSize = (raw) =>
    String(raw || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\(.*?\)/g, "")
      .trim();

  function buildMeyUrl() {
    const uniq = `${Date.now()}r${Math.floor(Math.random() * 1000)}`;
    return `https://meyb2b.com/b2bapi?-/${uniq}/OrderDetail/collection`;
  }

  function extractStyleId() {
    const raw = txt(document.querySelector(".styleid")); // "Art.-Nr.: 1230081"
    const m = raw.match(/(\d{4,})/);
    return m ? m[1] : "";
  }

  function extractColorKey() {
    // alleen uitlezen (geen DOM touch)
    const relFrom = (node) => {
      const c = node?.closest?.(".color[rel]") || null;
      const rel = c?.getAttribute?.("rel") || "";
      const m = rel.match(/(\d{2,})/);
      return m ? m[1] : "";
    };

    const candidates = [
      ".color.active[rel]",
      ".color.selected[rel]",
      ".color.is-active[rel]",
      ".color[aria-selected='true'][rel]",
      ".colorBullet.active",
      ".colorBullet.selected",
      ".colorBullet.is-active"
    ];

    for (const sel of candidates) {
      const hit = document.querySelector(sel);
      const ck = relFrom(hit);
      if (ck) return ck;
    }

    // fallback: kleurcode uit "1718 soft pink"
    const cn = document.querySelector(".colorName");
    if (cn) {
      const links = [...cn.querySelectorAll("a")].map(a => txt(a)).filter(Boolean);
      const candidate = links.find(t => /^\d+\b/.test(t)) || "";
      const m = candidate.match(/^(\d+)/);
      if (m) return m[1];
    }

    // last fallback: eerste color
    const el = document.querySelector(".color[rel]");
    const rel = el?.getAttribute("rel") || "";
    const m = rel.match(/(\d{2,})/);
    return m ? m[1] : "";
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "accept": "application/json, text/plain, */*"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
    return res.json();
  }

  async function fetchOrderDetailCollection(styleid) {
    const url = buildMeyUrl();
    const payload = [{
      _getparams: { "": "undefined" },
      _webSocketUniqueId: MEY_CTX.webSocketUniqueId,
      _url: "OrderDetail/collection",
      _dataareaid: MEY_CTX.dataareaid,
      _agentid: null,
      _custid: String(MEY_CTX.custid),
      _method: "read",
      styles: [{
        custareaid: "ME",
        styleareaid: "NO",
        styleid: String(styleid),
        variantid: "*",
        zkey: "*"
      }],
      assortid: MEY_CTX.assortid,
      ordertypeid: MEY_CTX.ordertypeid
    }];

    log("POST", url, payload);
    return postJson(url, payload);
  }

  function parseMeyStock(json, preferredColorKey = "") {
    const resultArr = json?.[0]?.result || [];
    if (!resultArr.length) return { map: new Map(), usedColorKey: "" };

    const r0 = resultArr[0];
    const xvalues = r0.xvalues || {};
    const ykeys = r0.ykeys || [];
    const fallbackColorKey = (ykeys.length === 1 ? String(ykeys[0]) : "");
    const colorKey = (preferredColorKey || fallbackColorKey || "").trim();

    const map = new Map(); // size -> stock
    for (const [k, v] of Object.entries(xvalues)) {
      const size = normSize(v?.size || "");
      const stock = Number(v?.stock ?? 0);
      if (!size) continue;
      if (colorKey && !k.includes(`;${colorKey};`)) continue;
      if (!map.has(size)) map.set(size, stock);
    }
    return { map, usedColorKey: colorKey };
  }

  // ---- DOM: index size -> stockContainers (jouw markup: .size staat in dezelfde td) ----
  function indexStockContainers() {
    const idx = new Map(); // size -> [sc,...]
    const scs = [...document.querySelectorAll(".stockContainer")];

    for (const sc of scs) {
      const cell = sc.closest("td");
      const sizeEl = cell?.querySelector?.(".size");
      const size = normSize(txt(sizeEl));
      if (!size) continue;

      if (!idx.has(size)) idx.set(size, []);
      idx.get(size).push(sc);
    }
    return idx;
  }

  // ---- Badge rendering (wijzigt GEEN bestaande classes/tekst) ----
  const BADGE_CLASS = "mey-stock-badge";

  function ensureBadge(sc) {
    const anchor = sc.querySelector("a");
    if (!anchor) return null;

    let badge = anchor.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.style.marginLeft = "6px";
      badge.style.fontWeight = "600";
      badge.style.opacity = "0.9";
      // geen kleur hardcoden; we laten het inherited zijn
      anchor.appendChild(badge);
    }
    return badge;
  }

  function setBadge(sc, n) {
    const badge = ensureBadge(sc);
    if (!badge) return;

    // alleen jouw projectie
    badge.textContent = `(${Number(n) || 0})`;

    // optioneel: marker zodat je ziet dat het script al geweest is (geen invloed op styling)
    sc.dataset.meyStock = String(Number(n) || 0);
  }

  // ---- Debounce + cache ----
  let inflight = null;
  let lastKey = "";
  let lastTs = 0;
  let lastMap = null;
  const CACHE_MS = 15000; // 15s cache tegen “stormen”

  async function refresh() {
    const styleid = extractStyleId();
    const colorKey = extractColorKey();
    if (!styleid || !colorKey) return;

    const key = `${styleid}|${colorKey}`;
    const now = Date.now();

    // cache hit
    if (key === lastKey && lastMap && (now - lastTs) < CACHE_MS) {
      project(lastMap);
      return;
    }

    // als er al een call loopt voor dezelfde key: wacht daarop
    if (inflight && key === lastKey) {
      await inflight.catch(() => {});
      if (lastMap) project(lastMap);
      return;
    }

    lastKey = key;
    inflight = (async () => {
      const idx = indexStockContainers();
      if (!idx.size) return;

      const json = await fetchOrderDetailCollection(styleid);
      const { map } = parseMeyStock(json, colorKey);
      lastMap = map;
      lastTs = Date.now();

      project(map);
    })();

    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  function project(map) {
    if (!map || !map.size) return;

    const idx = indexStockContainers();
    if (!idx.size) return;

    // alleen sizes die remote heeft projecteren
    for (const [size, n] of map.entries()) {
      const targets = idx.get(size);
      if (!targets?.length) continue;
      targets.forEach(sc => setBadge(sc, n));
    }

    log("Projected badge for sizes:", [...map.keys()]);
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const refreshDebounced = debounce(refresh, 200);

  // ---- Hooks: geen MutationObserver (scheelt knipper-loop) ----
  function hook() {
    // 1) eerste run
    setTimeout(refreshDebounced, 800);

    // 2) kleur / grid clicks
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t) return;

      // klik op kleur of grid/plus/minus → refresh
      const isColor = t.closest?.(".color") || t.closest?.(".colorBullet") || t.closest?.(".colorName");
      const isPlusMinus = t.closest?.(".plusQuantity") || t.closest?.(".minusQuantity");
      const isGrid = t.closest?.(".features-ordergrid-OrderGridView") || t.closest?.(".OrderGridCellView");

      if (isColor || isPlusMinus || isGrid) refreshDebounced();
    }, true);

    // 3) SPA hash routing
    window.addEventListener("hashchange", refreshDebounced, { passive: true });
  }

  hook();
})();
