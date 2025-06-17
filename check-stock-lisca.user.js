// ==UserScript==
// @name         Check Stock | Lisca
// @version      3.3
// @description  Vergelijkt voorraad op DDO met Wacoal of Lisca (op basis van EAN en actuele voorraad uit sheet)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-lisca.user.js
// ==/UserScript==

(function () {
  "use strict";

  async function init() {
    const brandElement = document.querySelector('#tabs-1 #select2-brand-container');
    const brand = brandElement?.title?.trim() || "";

    const allowedBrands = ["Lisca"];
    if (!allowedBrands.some(b => brand.toLowerCase().startsWith(b.toLowerCase()))) return;

    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
    btn.textContent = `📊 Check Stock | ${brand}`;
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 90px;
      z-index: 9999;
      padding: 10px;
      background: #007cba;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      display: block;
      margin-bottom: 10px;
    `;
    tab.prepend(btn);

    btn.addEventListener("click", async () => {
      if (brand.toLowerCase().startsWith("lisca")) {
        try {
          const clipboardText = await navigator.clipboard.readText();
          if (!clipboardText) return alert("📋 Klembord is leeg of bevat geen geldige CSV.");

          const lines = clipboardText.trim().split("\n").filter(Boolean);
          const eanMap = new Map();

          lines.forEach(line => {
            const [ean, koli] = line.trim().split("\t");
            if (ean && koli) eanMap.set(ean.trim(), parseInt(koli.trim(), 10));
          });

          const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[type='text']"));

          rowsDDO.forEach(row => {
            const eanInput = row.querySelector("input[name*='[barcode]']");
            const stockInput = row.querySelector("input[name*='[stock]']");
            const ean = eanInput?.value.trim();
            const stock = parseInt(stockInput?.value || "0");

            if (ean) {
              const inCSV = eanMap.has(ean);

              row.classList.remove("ean-onbekend", "ean-groen", "ean-rood");

              if (!inCSV) {
                eanInput.style.backgroundColor = "#FFD966";
                stockInput.style.backgroundColor = "#FFD966";
                row.classList.add("ean-onbekend");
                return;
              }

              const supplierStock = eanMap.get(ean);

              if (supplierStock > 4 && stock === 0) {
                eanInput.style.backgroundColor = "#93C47D";
                stockInput.style.backgroundColor = "#93C47D";
                row.classList.add("ean-groen");
              } else if (supplierStock < 5 && stock > 0) {
                eanInput.style.backgroundColor = "#E06666";
                stockInput.style.backgroundColor = "#E06666";
                row.classList.add("ean-rood");
              }
            }
          });

          btn.textContent = `📊 Stock van ${brand} gecheckt!`;
          btn.style.backgroundColor = "#2ecc71";
        } catch (e) {
          alert("📋 Klembord uitlezen is mislukt of niet toegestaan door browser.");
        }
      } else {
        const html = prompt(`📋 Plak hier de HTML van de voorraadtabel van ${brand}:`);
        if (!html) return alert("Geen HTML geplakt.");

        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");

          const table = doc.querySelector("table.scroll-table__table");
          if (!table) throw new Error(`Geen geldige ${brand} HTML-tabel gevonden.`);

          const headers = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim().toUpperCase());
          const rows = [...table.querySelectorAll("tbody tr")];

          const supplierStatus = new Map();
          const is2D = rows.length > 1 && headers.length > 1;

          if (is2D) {
            rows.forEach(row => {
              const bandmaat = row.querySelector("th")?.textContent.trim();
              const cells = row.querySelectorAll("td");
              cells.forEach((td, i) => {
                const cupmaat = headers[i + 1];
                const maat = `${bandmaat}${cupmaat}`.replace(/\s+/g, "").toUpperCase();
                const klass = td.querySelector("div")?.classList.value || "";
                if (klass.includes("in_stock")) supplierStatus.set(maat, "in_stock");
                else if (klass.includes("within_stage1")) supplierStatus.set(maat, "within_stage1");
                else if (klass.includes("within_stage2")) supplierStatus.set(maat, "within_stage2");
                else if (klass.includes("out_of_stock")) supplierStatus.set(maat, "out_of_stock");
              });
            });
          } else {
            const cells = [...table.querySelectorAll("tbody td")];
            cells.forEach((td, i) => {
              const maat = headers[i] || `COL${i}`;
              const klass = td.querySelector("div")?.classList.value || "";
              if (klass.includes("in_stock")) supplierStatus.set(maat.toUpperCase(), "in_stock");
              else if (klass.includes("within_stage1")) supplierStatus.set(maat.toUpperCase(), "within_stage1");
              else if (klass.includes("within_stage2")) supplierStatus.set(maat.toUpperCase(), "within_stage2");
              else if (klass.includes("out_of_stock")) supplierStatus.set(maat.toUpperCase(), "out_of_stock");
            });
          }

          const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[type='text']"));
          rowsDDO.forEach(row => {
            const maatInput = row.querySelector("td input");
            const eanInput = row.querySelector("input[name*='[barcode]']");
            const stockInput = row.querySelector("input[name*='[stock]']");
            const maat = maatInput?.value.trim().toUpperCase();
            const ean = eanInput?.value.trim();
            const stock = parseInt(stockInput?.value || "0");
            const status = supplierStatus.get(maat);

            if (maat && eanInput) {
              if (stock > 0 && status !== "in_stock") {
                maatInput.style.backgroundColor = "#E06666";
                eanInput.style.backgroundColor = "#E06666";
              } else if (stock === 0 && status === "in_stock") {
                maatInput.style.backgroundColor = "#93C47D";
                eanInput.style.backgroundColor = "#93C47D";
              }
            }
          });

          btn.textContent = `📊 Stock van ${brand} gecheckt!`;
          btn.style.backgroundColor = "#2ecc71";

        } catch (e) {
          console.error(`❌ Fout tijdens verwerken (${brand}):`, e);
          alert(`Er ging iets mis bij het verwerken van de geplakte HTML voor ${brand}.`);
        }
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
