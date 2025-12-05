// ==UserScript==
// @name         EAN Scraper | Anita
// @version      3.5
// @description  Haalt Anita B2B-voorraad op (data-in-stock) en vult DDO; daarna EANs uit Google Sheet. Alt-klik: DEBUG aan/uit. Ctrl-klik: Sheet refresh (cache-bypass). Ondersteunt Koll (M3/M4/M5) in Sheet kolom A (met heuristiek).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        GM_xmlhttpRequest
// @connect      b2b.anita.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-anita.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ────────────────────────────────────────────────────────────────────────────
  // Config
  let DEBUG = false; // Alt-klik op de knop togglet dit
  const BTN_ID = "add-stock-anita-btn";

  // Anita B2B
  const BASE = "https://b2b.anita.com";
  const PATH_441 = "/nl/shop/441/";
  const ACCEPT_HDR = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  // Google Sheet (specifiek tabblad)
  const SHEET_ID = "1ufj-NCmFw0B5PQ2trYZO_9AWqKvZOxnm";
  const SHEET_GID = "1536470535";

  // Cache + authuser voorkeur
  const CACHE_KEY    = `anitaSheetCache:${SHEET_ID}:${SHEET_GID}`;
  const AUTHUSER_KEY = "anitaSheetAuthUser";
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 uur

  // Geen “orderable zonder getal = 1” fallback
  const FILL_ORDERABLE_WITHOUT_NUMBER_AS_ONE = false;

  // ────────────────────────────────────────────────────────────────────────────
  // Debug helpers
  const dbg  = (...args) => { if (DEBUG) console.log("[Anita]", ...args); };
  const dbgw = (...args) => { if (DEBUG) console.warn("[Anita]", ...args); };
  const previewMap = (map, n = 20) => {
    const out = []; let i = 0;
    for (const [k, v] of map) { out.push([k, v]); if (++i >= n) break; }
    return out;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // UI
  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.textContent = "⛏️ SS&E | Anita/Rosa";
    btn.title = "Klik: uitvoeren • Alt-klik: DEBUG aan/uit • Ctrl-klik: Sheet refresh";
    Object.assign(btn.style, {
      position: "fixed", right: "10px", top: "10px", zIndex: 999999,
      padding: "10px 12px", background: "#007cba", color: "#fff",
      border: "none", borderRadius: "6px", cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.15)", fontFamily: "inherit",
      font: "600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    });
    document.body.appendChild(btn);
    return btn;
  }
  function setBtnState(btn, text, bg, title) {
    btn.textContent = text;
    if (bg) btn.style.backgroundColor = bg;
    if (title) btn.title = title;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DDO helpers
  function getBrand() {
    const c = document.querySelector('#tabs-1 #select2-brand-container');
    const title = c?.getAttribute('title') || '';
    const text = c?.textContent || '';
    const selectText = document.querySelector('#tabs-1 select[name="brand"] option:checked')?.textContent || '';
    return (title || text || selectText || '').replace(/\u00A0/g, ' ').trim();
  }
  function isAllowedBrand(brand) {
    const b = brand.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
    const tokens = [
      'anita', 'anita maternity', 'anita care', 'anita active',
      'anita badmode', 'rosa faia', 'rosa faia badmode'
    ];
    return tokens.some(t => b.includes(t));
  }
  function getSupplierPid() {
    return document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim() || "";
  }

  // ────────────────────────────────────────────────────────────────────────────
  // supplier_pid parsing (M3/M4/M5 + pid met streepje + kleur verplicht)
  function parseSupplierPid(input) {
    const raw = String(input || "").trim().toUpperCase();
    const normd = raw
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    // vb: "5727X-181", "M4-5727X-181", "M4-8314-1-430"
    const m = normd.match(/^(?:(M[345])\-)?([A-Z0-9]+(?:\-[A-Z0-9]+)*)\-(\d{3})$/i);

    if (!m) {
      const noColor = normd.match(/^(?:(M[345])\-)?([A-Z0-9]+(?:\-[A-Z0-9]+)*)$/i);
      if (noColor) {
        const koll = noColor[1] || "";
        const productId = noColor[2];
        throw new Error(`Kleurcode ontbreekt voor ${koll ? koll + "-" : ""}${productId}. Voeg altijd een 3-cijferige kleur toe (bv. "-430").`);
      }
      throw new Error(`Onbekend supplier_pid-format: "${raw}". Verwacht bv. "M4-8314-1-430" of "5727X-181".`);
    }

    const koll = m[1] || "";      // M3/M4/M5 of leeg
    const productId = m[2];       // mag streepje bevatten, bv. "8314-1"
    const colorCode = m[3];       // 3 cijfers

    return { productId, colorCode, koll };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Anita fetch
  function buildUrl(productId, colorCode, koll) {
    const p = new URL(PATH_441, BASE);
    p.search = new URLSearchParams({
      fssc: "N",
      vsas: "",
      koll: koll || "",
      form: "",
      vacp: "",
      arnr: productId,   // bv. "8314-1"
      vakn: "",
      sicht: "S",
      fbnr: colorCode    // bv. "430"
    }).toString();
    return p.toString();
  }
  function fetchAnitaHtml(productId, colorCode, koll) {
    const url = buildUrl(productId, colorCode, koll);
    dbg("Fetch Anita URL:", url);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "Accept": ACCEPT_HDR },
        anonymous: false,
        onload: (res) => {
          dbg("Anita HTTP status:", res.status, "length:", res.responseText?.length);
          (res.status >= 200 && res.responseText)
            ? resolve(res.responseText)
            : reject(new Error(`HTTP ${res.status} bij Anita B2B`));
        },
        onerror: () => reject(new Error("Netwerkfout bij Anita B2B")),
        ontimeout: () => reject(new Error("Timeout bij Anita B2B")),
      });
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Size helpers
  const SIZE_SINGLE_SET = new Set(["XS","S","M","L","XL","XXL","XXXL","2XL","3XL","4XL"]);
  const SIZE_WORDS = ["XS","S","M","L","XL","XXL","XXXL","2XL","3XL","4XL"];
  const norm = s => (s||"").replace(/\s+/g,"").toUpperCase();
  const looksBand = s => /^\d{1,3}$/.test(s);
  const looksCup  = s => /^(AA|BB|CC|DD|EE|FF|GG|HH|[A-Z]{1,3})$/.test(s) && !/\d/.test(s);
  function looksSplitCup(s) {
    const t = norm(s).replace(/\s+/g, "");
    return /^[A-Z]{1,2}[\/-][A-Z]{1,2}$/.test(t); // A/B, AA/BB
  }
  function looksComboSize(s) {
    const t = (s || "").toUpperCase().trim().replace(/\s+/g, "");
    const m = t.match(/^([A-Z0-9]+)[\/-]([A-Z0-9]+)$/);
    if (!m) return false;
    return SIZE_WORDS.includes(m[1]) && SIZE_WORDS.includes(m[2]); // S/M, L/XL, 2XL/3XL
  }
  function parseSizeAny(s) {
    const t = norm(s||"");
    let m = t.match(/^(\d{1,3})([A-Z]{1,3})$/); if (m) return {band:m[1], cup:m[2]};
    m = t.match(/^([A-Z]{1,3})(\d{1,3})$/);     if (m) return {band:m[2], cup:m[1]};
    if (SIZE_SINGLE_SET.has(t)) return {single:t};
    return null;
  }
  // "36 A/B" -> "36AB", "S/M" -> "SM", "75B" -> "75B"
  function normalizeSize(s) {
    if (!s) return "";
    const t = String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
    let m = t.match(/(\d{1,3})([A-Z]{1,3})/); if (m) return `${parseInt(m[1], 10)}${m[2]}`;
    m = t.match(/([A-Z]{1,3})(\d{1,3})/);     if (m) return `${parseInt(m[2], 10)}${m[1]}`;
    return t; // S/M etc. -> SM
  }

  function composeSize(rowLbl, colLbl, td) {
    const r = norm(rowLbl), c = norm(colLbl);

    // 2D: band + (enkele) cup
    if (looksBand(r) && looksCup(c)) return `${r}${c}`;
    if (looksCup(r) && looksBand(c)) return `${c}${r}`;

    // 2D: band + split-cup (A/B e.d.)
    if (looksBand(r) && looksSplitCup(c)) return `${r}${c}`;
    if (looksSplitCup(r) && looksBand(c)) return `${c}${r}`;

    // 1D: COMBI-SIZE (S/M, L/XL, …)
    if (looksComboSize(r) && (!looksBand(c) && !looksCup(c) && !looksSplitCup(c))) return r;
    if (looksComboSize(c) && (!looksBand(r) && !looksCup(r) && !looksSplitCup(r))) return c;

    // 1D: alleen band of enkel S/M/L/XL
    if (looksBand(r) && (!c || (!looksBand(c) && !looksCup(c) && !looksSplitCup(c) && !looksComboSize(c)))) return r;
    if (looksBand(c) && (!r || (!looksBand(r) && !looksCup(r) && !looksSplitCup(r) && !looksComboSize(r)))) return c;
    if (SIZE_SINGLE_SET.has(r) && (!c || (!looksBand(c) && !looksCup(c) && !looksSplitCup(c) && !looksComboSize(c)))) return r;
    if (SIZE_SINGLE_SET.has(c) && (!r || (!looksBand(r) && !looksCup(r) && !looksSplitCup(r) && !looksComboSize(r)))) return c;

    // Labels die al "75B" etc. bevatten
    const rp = parseSizeAny(r); if (rp?.single) return rp.single; if (rp?.band&&rp?.cup) return `${rp.band}${rp.cup}`;
    const cp = parseSizeAny(c); if (cp?.single) return cp.single; if (cp?.band&&cp?.cup) return `${cp.band}${cp.cup}`;

    // TD-attrs
    const tdBand = td.getAttribute("data-band") || td.dataset?.band;
    const tdCup  = td.getAttribute("data-cup")  || td.dataset?.cup;
    if (tdBand && tdCup) return `${norm(tdBand)}${norm(tdCup)}`;
    if (tdBand && !tdCup) return norm(tdBand);

    let tdSize = td.getAttribute("data-size")
                || td.dataset?.size
                || td.title
                || td.getAttribute("aria-label")
                || "";
    const tdp = parseSizeAny(tdSize);
    if (tdp?.single) return tdp.single;
    if (tdp?.band && tdp?.cup) return `${tdp.band}${tdp.cup}`;
    if (looksComboSize(tdSize)) return norm(tdSize);
    if (looksSplitCup(tdSize)) return norm(tdSize);
    if (looksBand(tdSize)) return norm(tdSize);

    // Element in cel
    const el = td.querySelector("input, select, [data-size]");
    if (el) {
      const eBand = el.getAttribute("data-band") || el.dataset?.band;
      const eCup  = el.getAttribute("data-cup")  || el.dataset?.cup;
      if (eBand && eCup) return `${norm(eBand)}${norm(eCup)}`;
      if (eBand && !eCup) return norm(eBand);

      let v = el.getAttribute("data-size")
           || el.dataset?.size
           || el.getAttribute?.("aria-label")
           || (el instanceof HTMLInputElement ? el.value : "")
           || el.id || el.name || "";
      const ep = parseSizeAny(v);
      if (ep?.single) return ep.single;
      if (ep?.band && ep?.cup) return `${ep.band}${ep.cup}`;
      if (looksComboSize(v)) return norm(v);
      if (looksSplitCup(v)) return norm(v);
      if (looksBand(v)) return norm(v);
    }

    // Tekst in de cel
    const text = (td.textContent || "").trim();
    const xp = parseSizeAny(text);
    if (xp?.single) return xp.single;
    if (xp?.band && xp?.cup) return `${xp.band}${xp.cup}`;
    if (looksComboSize(text)) return norm(text);
    if (looksSplitCup(text)) return norm(text);
    if (looksBand(text)) return norm(text);

    return "";
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Voorraad mapping
  function mapStockNumber(n) {
    if (!Number.isFinite(n)) return undefined;
    if (n < 3) return 1;
    if (n === 3) return 3;
    if (n === 4) return 4;
    return 5;
  }

  function detectNumericFromTd(td) {
    const inputStock = td.querySelector('input[data-in-stock]');
    if (inputStock) {
      const v = parseInt(inputStock.getAttribute('data-in-stock'), 10);
      if (Number.isFinite(v)) return v;
    }
    const anyInStock = td.querySelector('[data-in-stock]');
    if (anyInStock) {
      const v = parseInt(anyInStock.getAttribute('data-in-stock'), 10);
      if (Number.isFinite(v)) return v;
    }
    const el = td.querySelector('.shop-in-stock, .stock, .availability, [data-stock], [data-qty], [data-quantity]');
    const pool = [];
    if (el) {
      pool.push(el.textContent || '');
      [...el.attributes].forEach(a => {
        if (/(in-?stock|stock|qty|quantity|available)/i.test(a.name)) pool.push(a.value);
      });
    }
    [...td.attributes].forEach(a => {
      if (/(in-?stock|stock|qty|quantity|available)/i.test(a.name)) pool.push(a.value);
    });
    pool.push(td.textContent || '');

    let best;
    for (const s of pool) {
      const m = (s || '').match(/\d+/g);
      if (!m) continue;
      for (const part of m) {
        const v = parseInt(part, 10);
        if (Number.isFinite(v)) best = Math.max(best ?? v, v);
      }
    }
    return best;
  }

  function pickBestHeaderLabels(table) {
    const rows = [...table.querySelectorAll("thead tr")];
    if (!rows.length) return [];
    let best = { score: -1, labels: [] };
    const scoreRow = (row) => {
      const labels = [...row.querySelectorAll("th")].map(th => th.textContent.trim());
      let score = 0;
      labels.forEach(lbl => {
        const n = norm(lbl);
        if (looksBand(n) || looksCup(n) || SIZE_SINGLE_SET.has(n) || looksSplitCup(n) || looksComboSize(n)) score += 2;
        if (/^(EU|UK|FR|INT|BAND|CUP|MAAT)$/i.test(n)) score -= 1;
        if (/\d/.test(n) && /[A-Z]/i.test(n) && parseSizeAny(n)) score += 3;
      });
      return { score, labels };
    };
    rows.forEach(r => { const res = scoreRow(r); if (res.score > best.score) best = res; });
    dbg("Header choice:", best);
    return best.labels.filter(x => {
      const n = norm(x);
      if (!n) return false;
      if (/^(EU|UK|FR|INT|BAND|CUP|MAAT)$/i.test(n)) return false;
      return true;
    });
  }

  function extractStockFromHtml(html, colorCode) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const esc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v;

    const tables = [...doc.querySelectorAll(`table[data-x='do-not-delete'][data-color-number='${esc(colorCode)}']`)];
    dbg("Tables for color", colorCode, "→", tables.length);

    const supplierStatus = new Map();

    tables.forEach((table, tIdx) => {
      let colLabels = pickBestHeaderLabels(table);
      const rows = [...table.querySelectorAll("tbody tr")];

      dbg(`T${tIdx} chosen header labels:`, colLabels);

      rows.forEach((row, ri) => {
        const rowLabel = row.querySelector("th")?.textContent?.trim() || "";
        const cells = [...row.querySelectorAll("td")];

        let cols = colLabels.slice();
        if (rowLabel && cols.length === cells.length + 1) cols = cols.slice(1);
        else if (!rowLabel && cols.length > cells.length) cols = cols.slice(cols.length - cells.length);
        if (!cols.length) cols = Array(cells.length).fill("");

        cells.forEach((td, i) => {
          const colLabel = cols[i] || "";
          const maat = composeSize(rowLabel, colLabel, td);
          if (!maat) return;

          let num;
          const inputStock = td.querySelector('input[data-in-stock]');
          if (inputStock) {
            const v = parseInt(inputStock.getAttribute('data-in-stock'), 10);
            if (Number.isFinite(v)) num = v;
          }
          if (num === undefined) num = detectNumericFromTd(td);

          let mapped = mapStockNumber(num);
          if (mapped === undefined && FILL_ORDERABLE_WITHOUT_NUMBER_AS_ONE && td.querySelector('input, select, button')) {
            mapped = 1;
          }

          if (mapped !== undefined) {
            const key = normalizeSize(maat);
            if (key) {
              supplierStatus.set(key, mapped);
              if (DEBUG && ri < 3) dbg(`T${tIdx} r${ri} c${i} :: row="${rowLabel}" col="${colLabel}" → maat=${maat} (key=${key}) → num=${num} → mapped=${mapped}`);
            }
          }
        });
      });
    });

    dbg("supplierStatus size:", supplierStatus.size, "sample:", previewMap(supplierStatus));
    return supplierStatus;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Google Sheet: caching + authuser sweep + TSV/CSV + 304
  function getAuthuserCandidates() {
    const saved = localStorage.getItem(AUTHUSER_KEY);
    const base = [0,1,2,3,4,5];
    if (saved !== null && !Number.isNaN(parseInt(saved,10))) {
      const r = parseInt(saved,10);
      return [r, ...base.filter(x => x !== r)];
    }
    return base;
  }
  function readCache() {
    try {
      const j = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!j) return null;
      if (Date.now() - j.ts > CACHE_TTL_MS) return null;
      return j; // {kind,text,authuser,etag,lastModified,ts}
    } catch { return null; }
  }
  function writeCache(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch {}
  }
  function makeTsvUrl(authuser){ return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=tsv&gid=${SHEET_GID}&authuser=${authuser}`; }
  function makeCsvUrl(authuser){ return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&authuser=${authuser}`; }
  function isLikelyHtml(s){ return /^\s*<!doctype html/i.test(s) || /\b<html\b/i.test(s); }
  function getHeader(hdrs, name){
    const m = (hdrs || "").match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
    return m ? m[1].trim() : "";
  }

  function parseTsv(tsv) {
    const rows = tsv.split(/\r?\n/).map(line => line.split("\t"));
    const filtered = rows.filter(r => r.some(cell => cell && cell.trim() !== ""));
    if (DEBUG) { dbg("Header row:", filtered[0]); dbg("Rows count:", filtered.length); }
    return filtered;
  }
  function parseCsv(csv) {
    const rows = []; let i=0, field="", row=[], inQ=false;
    const pf=()=>{row.push(field); field="";}, pr=()=>{rows.push(row); row=[];};
    while(i<csv.length){ const ch=csv[i];
      if(inQ){ if(ch==='"'){ if(csv[i+1]==='"'){field+='"'; i+=2;} else {inQ=false; i++;} }
               else {field+=ch; i++;} }
      else { if(ch==='"'){inQ=true; i++;} else if(ch===','){pf(); i++;} else if(ch==='\r'){i++;} else if(ch==='\n'){pf(); pr(); i++;} else {field+=ch; i++;} }
    } pf(); pr();
    const filtered = rows.filter(r => r.some(cell => (cell ?? "").toString().trim() !== ""));
    if (DEBUG) { dbg("CSV header row:", filtered[0]); dbg("CSV rows count:", filtered.length); }
    return filtered;
  }

  // ★ MISTE FUNCTIE: fetchSheetRaw
  async function fetchSheetRaw({ force = false } = {}) {
    const candidates = getAuthuserCandidates();
    const cache = readCache();

    if (!force && cache) {
      dbg("Cache HIT (fresh)", { authuser: cache.authuser, kind: cache.kind, age_ms: Date.now()-cache.ts });
      return { kind: cache.kind, text: cache.text, authuser: cache.authuser, fromCache: true };
    }

    const tryOne = (url, condHeaders={}) => new Promise((resolve,reject)=>{
      const headers = {
        "Accept": "*/*",
        "Referer": `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`,
        ...condHeaders
      };
      GM_xmlhttpRequest({
        method: "GET",
        url, headers, anonymous: false,
        onload: (res) => resolve({ status: res.status, text: res.responseText || "", headers: res.responseHeaders || "" }),
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });

    const cond = cache ? {
      "If-None-Match": cache.etag || "",
      "If-Modified-Since": cache.lastModified || ""
    } : {};

    // TSV eerst
    for (const au of candidates) {
      const url = makeTsvUrl(au);
      dbg("Try TSV", { au, url, cond: !!cache });
      const res = await tryOne(url, cond);
      if (res.status === 304 && cache) {
        localStorage.setItem(AUTHUSER_KEY, String(cache.authuser ?? au));
        return { kind: cache.kind || "tsv", text: cache.text, authuser: cache.authuser ?? au, fromCache: true };
      }
      if (res.status >= 200 && res.status < 300 && res.text && !isLikelyHtml(res.text)) {
        const etag = getHeader(res.headers, "ETag");
        const lm   = getHeader(res.headers, "Last-Modified");
        writeCache({ kind: "tsv", text: res.text, authuser: au, etag, lastModified: lm, ts: Date.now() });
        localStorage.setItem(AUTHUSER_KEY, String(au));
        dbg("✅ TSV OK", { au, etag, lastModified: lm });
        return { kind: "tsv", text: res.text, authuser: au, fromCache: false };
      }
      dbgw("TSV miss", { au, status: res.status, looksHtml: isLikelyHtml(res.text) });
    }

    // CSV fallback
    for (const au of candidates) {
      const url = makeCsvUrl(au);
      dbg("Try CSV", { au, url, cond: !!cache });
      const res = await tryOne(url, cond);
      if (res.status === 304 && cache) {
        localStorage.setItem(AUTHUSER_KEY, String(cache.authuser ?? au));
        return { kind: cache.kind || "csv", text: cache.text, authuser: cache.authuser ?? au, fromCache: true };
      }
      if (res.status >= 200 && res.status < 300 && res.text && !isLikelyHtml(res.text)) {
        const etag = getHeader(res.headers, "ETag");
        const lm   = getHeader(res.headers, "Last-Modified");
        writeCache({ kind: "csv", text: res.text, authuser: au, etag, lastModified: lm, ts: Date.now() });
        localStorage.setItem(AUTHUSER_KEY, String(au));
        dbg("✅ CSV OK", { au, etag, lastModified: lm });
        return { kind: "csv", text: res.text, authuser: au, fromCache: false };
      }
      dbgw("CSV miss", { au, status: res.status, looksHtml: isLikelyHtml(res.text) });
    }

    if (cache) {
      dbgw("Netwerk faalde → gebruik VERLOPEN cache");
      return { kind: cache.kind, text: cache.text, authuser: cache.authuser, fromCache: true };
    }

    throw new Error("Sheets: geen toegang (authuser 0–5 geprobeerd). Log in met het juiste account of publiceer het tabblad.");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Sheet header indices (met heuristiek voor Koll-kolom)
  function isKollToken(v) {
    return /^M[345]$/i.test(String(v ?? "").trim());
  }

  function detectHeaderIndices(headerRow, allRows = []) {
    const H = headerRow.map(h => (h ?? "").toString().toLowerCase().trim());
    const has = (...labels) => H.findIndex(h => labels.includes(h));

    const idx = {
      koll:          has("koll","prefix"),
      artikelnummer: has("artikelnummer","artikel nr","artikel","artikelcode","model","modelnummer","model nr"),
      kleurcode:     has("kleurcode","kleur code","color code","fbnr","kleur"),
      cup:           has("cup","cupmaat","cup size"),
      band:          has("maat","band","bandmaat","size"),
      ean:           has("ean","barcode"),
    };

    // Heuristiek: als 'koll' header niet gevonden is, kijk of kolom A eruit ziet als M3/M4/M5 (of leeg)
    let kollDetected = idx.koll !== -1;
    if (!kollDetected && headerRow.length >= 8) {
      const sample = allRows.slice(1, 30).map(r => r?.[0]).filter(x => x !== undefined);
      const hits   = sample.filter(v => v && isKollToken(v)).length;
      const blanks = sample.filter(v => !v || String(v).trim() === "").length;
      if (hits + blanks >= Math.max(3, Math.ceil(sample.length * 0.7))) {
        idx.koll = 0;
        kollDetected = true;
      }
    }

    // Fallback posities afhankelijk van of Koll is gedetecteerd
    if (idx.artikelnummer === -1) idx.artikelnummer = kollDetected ? 1 : 0;
    if (idx.kleurcode     === -1) idx.kleurcode     = kollDetected ? 3 : 2;
    if (idx.cup           === -1) idx.cup           = kollDetected ? 5 : 4;
    if (idx.band          === -1) idx.band          = kollDetected ? 6 : 5;
    if (idx.ean           === -1) idx.ean           = kollDetected ? 7 : 6;

    dbg("Header indices:", idx);
    return idx;
  }

  // Artikelnummer uit kolom A/B ontleden (koll/pid/kleur in string A zelf)
  function splitArtikelnummer(aCell) {
    const A = (aCell || "").toString().trim().toUpperCase();
    const m = A.match(/^(?:(M[345])\-)?([A-Z0-9]+(?:\-[A-Z0-9]+)*?)(?:\-(\d{3}))?$/);
    return {
      koll:  m?.[1] || "",
      pid:   m?.[2] || A,
      color: m?.[3] || "",
    };
  }

  // ★ Strikt: altijd kleur vereist; support Koll in aparte kolom óf in Artikelnummer
  function rowMatchesProductStrictWithSheetKoll(kollCell, artikelCell, kleurCell, pidWanted, colorWanted, kollWanted = "") {
    const sheetKoll = (kollCell || "").toString().trim().toUpperCase(); // kan leeg zijn
    const { koll: kollInA, pid: pidInA, color: colorInA } = splitArtikelnummer(artikelCell);
    const colorInC = (kleurCell || "").toString().trim().toUpperCase();

    const rowPid   = pidInA;                                 // PID uit A (zonder evt. Koll/Color)
    const rowColor = /^\d{3}$/.test(colorInC) ? colorInC : colorInA; // kleur prefer C, anders uit A
    const rowKoll  = sheetKoll || kollInA;                   // Koll prefer kolom A, anders uit A

    const P = (pidWanted   || "").toUpperCase();
    const K = (colorWanted || "").toUpperCase();
    const KollWanted = (kollWanted || "").toUpperCase();

    if (!P || !K) return false;
    if (rowPid !== P) return false;
    if (rowColor !== K) return false;

    if (KollWanted) {
      return rowKoll === KollWanted;
    }
    return true; // als Koll niet verlangd is, accepteer beide
  }

  // EAN map bouwen uit rows (2D en 1D maten) – met Koll in Sheet
  function buildEanMapFromRows(rows, productId, colorCode, kollWanted = "") {
    if (!rows.length) return new Map();
    const header = rows[0];

    // geef alle rijen mee voor heuristiek (kolom A als Koll)
    const idx = detectHeaderIndices(header, rows);

    const pid   = (productId || "").toString().trim().toUpperCase();
    const color = (colorCode || "").toString().trim().toUpperCase();

    let total=0, matched=0, usable=0;
    const eanMap = new Map();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      total++;

      const kollCell = idx.koll !== -1 ? r[idx.koll] : "";
      const aCell    = r[idx.artikelnummer];
      const cCell    = r[idx.kleurcode];
      const cupRaw   = (r[idx.cup]  || "").toString().trim().toUpperCase(); // mag leeg
      const bandRaw  = (r[idx.band] || "").toString().trim().toUpperCase(); // kan 36 of S/M zijn
      const ean      = (r[idx.ean]  || "").toString().trim();

      if (!rowMatchesProductStrictWithSheetKoll(kollCell, aCell, cCell, pid, color, kollWanted)) continue;
      if (!ean) continue;
      matched++;

      let sizeKey = "";
      if (bandRaw && cupRaw) sizeKey = normalizeSize(`${bandRaw}${cupRaw}`); // bv. "36"+"A/B" → "36AB"
      else if (bandRaw)      sizeKey = normalizeSize(bandRaw);               // 1D: "36" of "S/M"
      else if (cupRaw)       sizeKey = normalizeSize(cupRaw);                // zeldzaam
      else continue;

      if (!sizeKey) continue;
      eanMap.set(sizeKey, ean);
      usable++;
    }

    dbg("EAN strict (koll): rows total", total, "| matches:", matched, "| usable:", usable);
    dbg("EAN map size:", eanMap.size, "sample:", [...eanMap.entries()].slice(0, 30));
    return eanMap;
  }

  // EANs toepassen in DDO
  function applyEansToDdo(eanMap) {
    const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")]
      .filter(row => row.querySelector("input[type='text']"));

    let updated = 0, missing = 0;

    rowsDDO.forEach(row => {
      const sizeRaw = row.querySelector("td input")?.value;
      const key = normalizeSize(sizeRaw);
      if (!key) return;

      const ean = eanMap.get(key);
      if (!ean) { missing++; if (DEBUG && missing <= 20) dbgw("[EAN] ✖ Geen EAN in map voor", sizeRaw, "(key=", key, ")"); return; }

      const eanInput =
        row.querySelector(
          "input[name$='[barcode]'], input[name*='[barcode]'], input[name*='barcode']," + // eerst barcode
          "input[name$='[ean]'], input[name*='[ean]'], input[name*='ean']," +             // dan ean
          "input#ean"                                                                     // noodgreep
        );

      if (eanInput) {
        eanInput.value = ean;
        eanInput.dispatchEvent(new Event("input", { bubbles: true }));
        updated++;
        if (DEBUG && updated <= 20) dbg("[EAN] ✔", sizeRaw, "(key=", key, ") ←", ean);
      } else {
        missing++;
        if (DEBUG && missing <= 20) dbgw("[EAN] ✖ EAN input niet gevonden voor", sizeRaw);
      }
    });

    dbg("EAN resultaat:", { updated, missing });
    return { updated, missing };
  }

  // Stock → DDO
  function applyStockToDdo(supplierStatus) {
    const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")]
      .filter(row => row.querySelector("input[type='text']"));

    let updated = 0, missing = 0;

    rowsDDO.forEach((row) => {
      const sizeRaw = row.querySelector("td input")?.value;
      const key = normalizeSize(sizeRaw);
      const stockInput = row.querySelector("input[name*='[stock]']");
      if (!key || !stockInput) return;

      const voorraad = supplierStatus.get(key);
      if (voorraad !== undefined) {
        stockInput.value = voorraad;
        stockInput.dispatchEvent(new Event("input", { bubbles: true }));
        updated++;
        if (DEBUG && updated <= 10) dbg(`[STOCK] ✔ DDO ${sizeRaw} (key=${key}) ← ${voorraad}`);
      } else {
        missing++;
        if (DEBUG && missing <= 10) dbgw(`[STOCK] ✖ No match for DDO ${sizeRaw} (key=${key})`);
      }
    });

    dbg("Stock resultaat:", { updated, missing });
    return { updated, missing };
  }

  // DDO size preview (debug)
  function debugPreviewDdoSizes() {
    if (!DEBUG) return;
    const sizes = [...document.querySelectorAll("#tabs-3 table.options tr")]
      .map(r => r.querySelector("td input")?.value)
      .filter(Boolean)
      .map(v => [v, normalizeSize(v)]);
    dbg("DDO sizes (raw → key) sample:", sizes.slice(0, 30));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Main flow (klik)
  async function handleClick(btn, evt) {
    // Alt = DEBUG toggle
    if (evt && evt.altKey) {
      DEBUG = !DEBUG;
      setBtnState(btn, `🐞 Debug ${DEBUG ? "ON" : "OFF"}`, DEBUG ? "#8e44ad" : "#007cba",
        "Klik: uitvoeren • Alt-klik: DEBUG aan/uit • Ctrl-klik: Sheet refresh");
      dbg("DEBUG toggled →", DEBUG);
      return;
    }
    // Ctrl = cache bypass
    const forceSheetRefresh = !!(evt && evt.ctrlKey);
    if (forceSheetRefresh) {
      setBtnState(btn, "🔄 Sheet refresh…", "#6c757d", "Cache omzeilen & opnieuw downloaden");
    }

    const brand = getBrand();
    if (!isAllowedBrand(brand)) {
      setBtnState(btn, "❌ Merk niet ondersteund", "#E06666", "Selecteer Anita/Rosa Faia (of submerken).");
      return;
    }

    let productId, colorCode, koll;
    try {
      ({ productId, colorCode, koll } = parseSupplierPid(getSupplierPid()));
      dbg("supplier_pid parse:", { productId, colorCode, koll });
    } catch (e) {
      setBtnState(btn, "❌ Ongeldige supplier_pid", "#E06666", e?.message || "Parse fout");
      return;
    }

    if (!document.querySelector("#tabs-3")) {
      setBtnState(btn, "❌ Tab #tabs-3 ontbreekt", "#E06666", "Open het maten/opties tabblad.");
      return;
    }

    try {
      // FIX: geen backticks-in-backticks; gebruik geneste template literal correct
      setBtnState(btn, "⏳ Stock ophalen…", "#6c757d", `Product ${productId}, kleur ${colorCode}${koll ? `, ${koll}` : ""}`);
      const html = await fetchAnitaHtml(productId, colorCode, koll);
      const supplierStatus = extractStockFromHtml(html, colorCode);
      const { updated: sUpd, missing: sMiss } = applyStockToDdo(supplierStatus);

      if (sUpd === 0) {
        setBtnState(btn, "❌ Geen overeenkomstige maten", "#E06666", "Stock: 0 updates (zie console bij DEBUG)");
        return;
      }
      setBtnState(btn, `✅ Stock ${sUpd}× (miss: ${sMiss}) → EANs…`, "#2ecc71", "Vul EANs in");

      // Sheet → EANs
      try {
        const raw = await fetchSheetRaw({ force: forceSheetRefresh });
        dbg("Using", raw.kind.toUpperCase(), "authuser", raw.authuser, raw.fromCache ? "(cache)" : "(fresh)");
        const rows = raw.kind === "csv" ? parseCsv(raw.text) : parseTsv(raw.text);

        debugPreviewDdoSizes();

        const eanMap = buildEanMapFromRows(rows, productId, colorCode, koll);
        const { updated: eUpd, missing: eMiss } = applyEansToDdo(eanMap);

        if (eUpd > 0) {
          setBtnState(btn, `✅ Stock ${sUpd} | ✅ EANs ${eUpd} (miss: ${eMiss})`, "#2ecc71",
            "Voorraad + EANs ingevuld");
        } else {
          setBtnState(btn, `✅ Stock ${sUpd} | 🟧 EANs 0 (miss: ${eMiss})`, "#f39c12",
            "Geen EAN-match; check Koll/Artikelnummer/Kleurcode/Cup/Maat/EAN in Sheet");
        }
      } catch (e) {
        console.error("[EAN Sheet] Fout:", e);
        setBtnState(btn, `✅ Stock ${sUpd} | ❌ EAN-fetch`, "#E06666", e?.message || "Fout bij Sheet");
      }

    } catch (err) {
      console.error("[Anita Scraper] Fout:", err);
      setBtnState(btn, "❌ Fout bij ophalen/verwerken", "#E06666", err?.message || "Onbekende fout");
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Bootstrapping (knop altijd zichtbaar)
  function init() {
    const btn = ensureButton();
    if (!btn.dataset.bound) {
      btn.addEventListener("click", (e) => handleClick(btn, e));
      btn.dataset.bound = "1";
    }
  }
  window.addEventListener("load", init);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") init(); });
  setInterval(() => { if (!document.getElementById(BTN_ID)) init(); }, 4000);
})();
