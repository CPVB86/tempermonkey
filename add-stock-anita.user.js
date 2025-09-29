// ==UserScript==
// @name         Add Stock | Anita & Co (Scraper, data-in-stock first)
// @version      2.5
// @description  Haalt Anita B2B-voorraad op en vult DDO; pakt eerst input[data-in-stock]; mapping <3→1, 3→3, 4→4, ≥5→5; geen fallbacks; knop blijft staan
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        GM_xmlhttpRequest
// @connect      b2b.anita.com
// @run-at       document-idle
// @author       C. P. v. Beek
// ==/UserScript==

(function () {
  "use strict";

  const BASE = "https://b2b.anita.com";
  const PATH_441 = "/nl/shop/441/";
  const ACCEPT_HDR = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const BTN_ID = "add-stock-anita-btn";

  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.textContent = "🚛 Fetch Stock | Anita";
    btn.title = "Haalt voorraad op van b2b.anita.com en vult DDO";
    Object.assign(btn.style, {
      position: "fixed", right: "10px", top: "10px", zIndex: 999999,
      padding: "10px 12px", background: "#007cba", color: "#fff",
      border: "none", borderRadius: "6px", cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.15)", fontFamily: "inherit"
    });
    document.body.appendChild(btn);
    return btn;
  }
  function setBtnState(btn, text, bg, title) {
    btn.textContent = text;
    if (bg) btn.style.backgroundColor = bg;
    if (title) btn.title = title;
  }

  function getBrand() {
    return document.querySelector('#tabs-1 #select2-brand-container')?.title?.trim() || "";
  }
  function isAllowedBrand(brand) {
    const allowed = ["Anita","Anita Maternity","Anita Care","Anita Active","Anita Badmode","Rosa Faia","Rosa Faia Badmode"];
    return allowed.some(b => brand.toLowerCase().startsWith(b.toLowerCase()));
  }
  function getSupplierPid() {
    return document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim() || "";
  }
  function parseSupplierPid(s) {
    const m = s.match(/([A-Z0-9]+)[-\s_]?(\d{3})/i);
    return { productId: m?.[1]?.toUpperCase() || "", colorCode: m?.[2] || "" };
  }

  function buildUrl(productId, colorCode) {
    const p = new URL(PATH_441, BASE);
    p.search = new URLSearchParams({
      fssc:"N", vsas:"", koll:"", form:"", vacp:"",
      arnr:productId, vakn:"", sicht:"S", fbnr:colorCode
    }).toString();
    return p.toString();
  }
  function fetchAnitaHtml(productId, colorCode) {
    const url = buildUrl(productId, colorCode);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "Accept": ACCEPT_HDR },
        anonymous: false,
        onload: (res) => (res.status >= 200 && res.responseText)
          ? resolve(res.responseText)
          : reject(new Error(`HTTP ${res.status} bij Anita B2B`)),
        onerror: () => reject(new Error("Netwerkfout bij Anita B2B")),
        ontimeout: () => reject(new Error("Timeout bij Anita B2B")),
      });
    });
  }

  const SIZE_SINGLE_SET = new Set(["XS","S","M","L","XL","XXL","XXXL","2XL","3XL","4XL"]);
  const norm = s => (s||"").replace(/\s+/g,"").toUpperCase();
  const looksBand = s => /^\d{1,3}$/.test(s);
  const looksCup  = s => /^(AA|BB|CC|DD|EE|FF|GG|HH|[A-Z]{1,3})$/.test(s) && !/\d/.test(s);
  function parseSizeAny(s) {
    const t = norm(s);
    let m = t.match(/^(\d{1,3})([A-Z]{1,3})$/); if (m) return {band:m[1], cup:m[2]};
    m = t.match(/^([A-Z]{1,3})(\d{1,3})$/);     if (m) return {band:m[2], cup:m[1]};
    if (SIZE_SINGLE_SET.has(t)) return {single:t};
    return null;
  }
  function composeSize(rowLbl, colLbl, td) {
    const r = norm(rowLbl), c = norm(colLbl);
    if (looksBand(r) && looksCup(c)) return `${r}${c}`;
    if (looksCup(r) && looksBand(c)) return `${c}${r}`;
    const rp = parseSizeAny(r); if (rp?.single) return rp.single; if (rp?.band&&rp?.cup) return `${rp.band}${rp.cup}`;
    const cp = parseSizeAny(c); if (cp?.single) return cp.single; if (cp?.band&&cp?.cup) return `${cp.band}${cp.cup}`;
    const tdSize = td?.getAttribute?.("data-size")
      || td?.querySelector?.("[data-size]")?.getAttribute("data-size")
      || td?.title || td?.textContent || "";
    const tp = parseSizeAny(tdSize);
    if (tp?.single) return tp.single;
    if (tp?.band && tp?.cup) return `${tp.band}${tp.cup}`;
    if (looksBand(r) && looksCup(c)) return `${r}${c}`;
    if (looksCup(r) && looksBand(c)) return `${c}${r}`;
    return "";
  }

  // <3 → 1, 3 → 3, 4 → 4, ≥5 → 5
  function mapStockNumber(n) {
    if (!Number.isFinite(n)) return undefined;
    if (n < 3) return 1;
    if (n === 3) return 3;
    if (n === 4) return 4;
    return 5;
  }

  // ⬇️ HIER zit de nieuwe prioriteit op data-in-stock
  function detectNumericFromTd(td) {
    // 0) Expliciet en PRIORITAIR: input[data-in-stock]
    const inputStock = td.querySelector('input[data-in-stock]');
    if (inputStock) {
      const v = parseInt(inputStock.getAttribute('data-in-stock'), 10);
      if (Number.isFinite(v)) return v;
    }

    // 0b) Overige elementen met data-in-stock
    const anyInStock = td.querySelector('[data-in-stock]');
    if (anyInStock) {
      const v = parseInt(anyInStock.getAttribute('data-in-stock'), 10);
      if (Number.isFinite(v)) return v;
    }

    // 1) Andere duidelijke bronnen
    const el = td.querySelector('.shop-in-stock, .stock, .availability, [data-stock], [data-qty], [data-quantity]');
    const pool = [];

    if (el) {
      pool.push(el.textContent || '');
      [...el.attributes].forEach(a => {
        if (/(in-?stock|stock|qty|quantity|available)/i.test(a.name)) pool.push(a.value);
      });
    }

    // 2) Attributen op TD zelf
    [...td.attributes].forEach(a => {
      if (/(in-?stock|stock|qty|quantity|available)/i.test(a.name)) pool.push(a.value);
    });

    // 3) Hele celtekst (bv "50+")
    pool.push(td.textContent || '');

    let best;
    for (const s of pool) {
      const m = (s||'').match(/\d+/g);
      if (!m) continue;
      for (const part of m) {
        const v = parseInt(part, 10);
        if (Number.isFinite(v)) best = Math.max(best ?? v, v);
      }
    }
    return best;
  }

  function extractStockFromHtml(html, colorCode) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const esc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v;

    const tables = [...doc.querySelectorAll(`table[data-x='do-not-delete'][data-color-number='${esc(colorCode)}']`)];
    const supplierStatus = new Map();

    tables.forEach(table => {
      const theadRows = [...table.querySelectorAll("thead tr")];
      const headRow = theadRows.length ? theadRows[theadRows.length - 1] : null;
      let colLabels = headRow ? [...headRow.querySelectorAll("th")].map(th => th.textContent.trim()) : [];
      const rows = [...table.querySelectorAll("tbody tr")];

      rows.forEach(row => {
        const rowLabel = row.querySelector("th")?.textContent?.trim() || "";
        const cells = [...row.querySelectorAll("td")];

        // align headers met cellen
        let cols = colLabels.slice();
        if (rowLabel && cols.length === cells.length + 1) cols = cols.slice(1);
        else if (!rowLabel && cols.length > cells.length) cols = cols.slice(cols.length - cells.length);

        cells.forEach((td, i) => {
          const colLabel = cols[i] || "";
          const maat = composeSize(rowLabel, colLabel, td);
          if (!maat) return;

          // voorraad
          const num = detectNumericFromTd(td);
          let mapped = mapStockNumber(num);
          if (mapped === undefined) mapped = detectClassStatus(td);

          // Als er bestelbare cel is maar geen expliciete stock → 1 (zoals jij eerder gewend was)
          if (mapped === undefined && td.querySelector('input, select, button')) mapped = 1;

          if (mapped !== undefined) supplierStatus.set(maat.toUpperCase(), mapped);
        });
      });
    });

    return supplierStatus;
  }

  function applyToDdo(supplierStatus) {
    const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")]
      .filter(row => row.querySelector("input[type='text']"));

    let updated = 0, missing = 0;
    rowsDDO.forEach(row => {
      const maatInput = row.querySelector("td input")?.value.trim().toUpperCase();
      const stockInput = row.querySelector("input[name*='[stock]']");
      if (!maatInput || !stockInput) return;
      const voorraad = supplierStatus.get(maatInput);
      if (voorraad !== undefined) {
        stockInput.value = voorraad;
        stockInput.dispatchEvent(new Event("input", { bubbles: true }));
        updated++;
      } else {
        missing++;
      }
    });
    return { updated, missing };
  }

  function onClick(btn) {
    const brand = getBrand();
    if (!isAllowedBrand(brand)) {
      setBtnState(btn, "❌ Merk niet ondersteund", "#E06666", "Selecteer Anita/Rosa Faia (of submerken).");
      return;
    }
    const { productId, colorCode } = parseSupplierPid(getSupplierPid());
    if (!productId || !colorCode) {
      setBtnState(btn, "❌ Geen product/kleur", "#E06666", "supplier_pid bv. 5727X-181");
      return;
    }
    if (!document.querySelector("#tabs-3")) {
      setBtnState(btn, "❌ Tab #tabs-3 ontbreekt", "#E06666", "Open het maten/opties tabblad.");
      return;
    }

    setBtnState(btn, "⏳ Ophalen…", "#6c757d", `Product ${productId}, kleur ${colorCode}`);
    fetchAnitaHtml(productId, colorCode)
      .then(html => {
        const supplierStatus = extractStockFromHtml(html, colorCode);
        const { updated, missing } = applyToDdo(supplierStatus);
        if (updated > 0 && missing === 0) {
          setBtnState(btn, `✅ ${updated} maten ingevuld`, "#2ecc71", "Alle maten gematched.");
        } else if (updated > 0) {
          setBtnState(btn, `🟧 ${updated} ingevuld, ${missing} niet gevonden`, "#f39c12", "Deels gematched.");
        } else {
          setBtnState(btn, "❌ Geen overeenkomstige maten", "#E06666", "Check maatlabels en kleurcode.");
        }
      })
      .catch(err => {
        console.error("[Anita Scraper] Fout:", err);
        setBtnState(btn, "❌ Fout bij ophalen/verwerken", "#E06666", err?.message || "Onbekende fout");
      });
  }

  function init() {
    const btn = ensureButton();
    if (!btn.dataset.bound) {
      btn.addEventListener("click", () => onClick(btn));
      btn.dataset.bound = "1";
    }
  }

  window.addEventListener("load", init);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") init(); });
  setInterval(() => { if (!document.getElementById(BTN_ID)) init(); }, 4000);
})();
