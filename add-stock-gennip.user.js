// ==UserScript==
// @name         Add Stock | van Gennip
// @version      1.4
// @description  Vult voorraad in DDO automatisch op basis van HTML van Van Gennip (>4 = 2, 1–4 of geen waarde = 1, 0 = negeren). Herkent ook vooraf geëxporteerde ✨ HTML. Checkt op artikelnummer.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-vangennip.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-vangennip.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brand = document.querySelector('#tabs-1 #select2-brand-container')?.title?.trim() || "";
    if (!/charlie choe|mila/i.test(brand)) return;

    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
    btn.textContent = `🚛 Add Stock | ${brand}`;
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 10px;
      z-index: 9999;
      padding: 10px;
      background: #007cba;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
    `;
    tab.prepend(btn);

    btn.addEventListener("click", async () => {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (!clipboardText) return showError("❌ Geen HTML op klembord");

        const parser = new DOMParser();
        const doc = parser.parseFromString(clipboardText, "text/html");

        // 1) Als er een ✨-export is, check artikelcode (indien aanwezig) en gebruik waarden direct
        const artikelCode = doc.querySelector(".pdp-details_product-code span")?.textContent.trim();
        if (artikelCode) {
          const supplierInput = document.querySelector("#tabs-1 input[name='supplier_pid']");
          const backendArtikelCode = supplierInput?.value?.trim();
          if (!backendArtikelCode || backendArtikelCode !== artikelCode) {
            return showError(`❌ Artikelcode komt niet overeen (${artikelCode})`);
          }
        }

        // stockMap vullen via 3 strategieën
        const stockMap =
          parseSparkleMatrix(doc) ||
          parseNewMatrix(doc) ||
          parseLegacyMatrix(doc);

        if (!stockMap || stockMap.size === 0) {
          return showError("❌ Geen bruikbare voorraaddata gevonden");
        }

        // Schrijf naar DDO
        const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")]
          .filter(r => r.querySelector("input[type='text']"));
        let updated = 0;

        rowsDDO.forEach(row => {
          const maat = row.querySelector("td input")?.value.trim().toUpperCase();
          const stockInput = row.querySelector("input[name*='[stock]']");
          if (!maat || !stockInput) return;

          const value = stockMap.get(maat);
          if (value !== undefined) {
            stockInput.value = String(value);
            stockInput.dispatchEvent(new Event("input", { bubbles: true }));
            updated++;
          }
        });

        btn.textContent = `✅ Stock voor ${updated} maten ingevuld`;
        btn.style.backgroundColor = "#2ecc71";

      } catch (err) {
        console.error("❌ Verwerkingsfout:", err);
        showError("❌ Fout bij verwerken");
      }

      function showError(msg) {
        btn.textContent = msg;
        btn.style.backgroundColor = "#E06666";
      }
    });
  }

  // === Parsers ===

  // 1) ✨-export: neem waarde uit kolom 3 ongewijzigd over (0–5)
  function parseSparkleMatrix(doc) {
    const matrixRows = [...doc.querySelectorAll(".pdp-details_matrix table tr")];
    if (!matrixRows.length) return null;

    const map = new Map();
    matrixRows.forEach(row => {
      const cols = row.querySelectorAll("td");
      if (cols.length >= 3) {
        const maatRaw = cols[0].textContent.trim();
        const maat = (maatRaw || "").toUpperCase();
        const vRaw = cols[2].textContent.trim().replace(/[^\d-]/g, "");
        const v = clampStock(parseInt(vRaw, 10));
        if (maat && Number.isFinite(v)) {
          // v kan 0..5 zijn; neem 0 ook mee (schrijft 0 in DDO)
          map.set(maat, v);
        }
      }
    });
    return map.size ? map : null;
  }

  // 2) Nieuwe matrix: inputs met data-limit (XS..XXL in headers)
  // Mapping: >4→5, <2→0, 2–4→exact
  function parseNewMatrix(doc) {
    const row =
      doc.querySelector(".product-matrix.js-product-matrix tbody tr.background-color-hover") ||
      doc.querySelector(".product-matrix.js-product-matrix tbody tr");
    if (!row) return null;

    const inputs = [...row.querySelectorAll("td.product-matrix__size input.js-size-input")];
    if (!inputs.length) return null;

    const map = new Map();
    inputs.forEach(input => {
      const maat = (input.getAttribute("data-size") || "").trim().toUpperCase();
      let lim = parseInt(input.getAttribute("data-limit") || "0", 10);
      if (!maat || isNaN(lim)) return;

      const v = mapLimitToStock(lim);
      map.set(maat, v); // v is 0..5
    });

    return map.size ? map : null;
  }

  // 3) Legacy tabel: table.tableShoppingBag met data-limiet
  function parseLegacyMatrix(doc) {
    const table = doc.querySelector(".containerOrderQuantities table.tableShoppingBag, #order-add-quantities table.tableShoppingBag");
    if (!table) return null;

    const sizeLabels = [...table.querySelectorAll("thead tr:nth-child(1) th")]
      .slice(3, -4)
      .map(th => th.textContent.trim().toUpperCase());

    const inputs = [...table.querySelectorAll("tbody tr td.quantity input")];
    if (!inputs.length || !sizeLabels.length) return null;

    const map = new Map();
    for (let i = 0; i < sizeLabels.length; i++) {
      const maat = sizeLabels[i];
      const input = inputs[i];
      if (!maat || !input) continue;

      let lim = parseInt(input.getAttribute("data-limiet") || "0", 10);
      if (isNaN(lim)) lim = 0;

      const v = mapLimitToStock(lim);
      map.set(maat, v);
    }
    return map.size ? map : null;
  }

  // === Helpers ===

  // Nieuw mappingbeleid
  function mapLimitToStock(limit) {
    if (limit > 4) return 5;
    if (limit < 2) return 0;
    return limit; // 2,3,4
  }

  function clampStock(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 5) return 5;
    return v;
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
