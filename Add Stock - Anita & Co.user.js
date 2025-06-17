// ==UserScript==
// @name         Add Stock | Anita & Co
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.3
// @description  Vult voorraad in DDO automatisch op basis van HTML van de leverancier (dynamisch merk en kleurcode, incl. lege velden)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brandElement = document.querySelector('#tabs-1 #select2-brand-container');
    const brand = brandElement?.title?.trim() || "";
    const allowedBrands = ["Anita", "Anita Maternity", "Anita Care", "Anita Active", "Anita Badmode"];
    if (!allowedBrands.some(b => brand.toLowerCase().startsWith(b.toLowerCase()))) return;

    const supplierPid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim();
    const colorCode = supplierPid?.split('-')[1]; // Haal kleurcode uit supplier_pid

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
      display: block;
      margin-bottom: 10px;
    `;
    tab.prepend(btn);

    btn.addEventListener("click", () => {
      const html = prompt(`📋 Plak hier de HTML van de ${brand} tabel:`);
      if (!html) {
        btn.textContent = `❌ Geen HTML geplakt`;
        btn.style.backgroundColor = "#E06666"; // rood
        return;
      }

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const tables = [...doc.querySelectorAll(`table[data-x='do-not-delete'][data-color-number='${colorCode}']`)];
        if (tables.length === 0) throw new Error(`Geen geldige ${brand} tabel gevonden voor kleurcode ${colorCode}.`);

        const supplierStatus = new Map();

        tables.forEach(table => {
          const headers = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim().toUpperCase());
          const rows = [...table.querySelectorAll("tbody tr")];

          const is2D = rows.length > 1 && headers.length > 1;

          rows.forEach(row => {
            const cupmaat = row.querySelector("th")?.textContent.trim() || "";
            const cells = row.querySelectorAll("td");

            cells.forEach((td, i) => {
              const bandmaat = is2D ? headers[i + 1] : headers[i];
              const maat = `${bandmaat}${cupmaat}`.replace(/\s+/g, "").toUpperCase();

              const stockText = td.querySelector(".shop-in-stock")?.textContent.trim();
              const stock = stockText ? parseInt(stockText) : NaN;

              if (!isNaN(stock)) {
                if (stock > 4) {
                  supplierStatus.set(maat, 2); // Normale voorraad
                } else if (stock > 0) {
                  supplierStatus.set(maat, 1); // Low stock
                } else {
                  supplierStatus.set(maat, 1); // Ook bij 0 voorraad
                }
              } else if (td.querySelector("input")) {
                // Cel heeft inputveld maar geen stock info
                supplierStatus.set(maat, 1); // Low stock als 'onbekend'
              }
            });
          });
        });

        const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[type='text']"));
        let updated = 0;

        rowsDDO.forEach(row => {
          const maatInput = row.querySelector("td input")?.value.trim().toUpperCase();
          const stockInput = row.querySelector("input[name*='[stock]']");

          if (!maatInput || !stockInput) return;

          const voorraad = supplierStatus.get(maatInput);
          if (voorraad !== undefined) {
            stockInput.value = voorraad;
            stockInput.dispatchEvent(new Event("input", { bubbles: true }));
            console.log(`✅ Maat ${maatInput}: voorraad gezet op ${voorraad}`);
            updated++;
          } else {
            console.warn(`⚠️ Maat ${maatInput} niet gevonden in ${brand} tabel (kleur ${colorCode})`);
          }
        });

        // Feedback via button
        btn.textContent = `🚛 Stock voor ${updated} maten ingevuld!`;
        btn.style.backgroundColor = "#2ecc71"; // groen

      } catch (e) {
        console.error(`❌ Fout bij verwerken van ${brand} (kleurcode ${colorCode}):`, e);
        btn.textContent = `❌ Fout bij verwerken van ${brand} (kleurcode ${colorCode})`;
        btn.style.backgroundColor = "#E06666"; // rood
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
