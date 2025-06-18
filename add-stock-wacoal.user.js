// ==UserScript==
// @name         Add Stock | Wacoal & co
// @version      1.3
// @description  Vult voorraad in DDO automatisch op basis van HTML van de leverancier (dynamisch merk)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-wacoal.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brandElement = document.querySelector('#tabs-1 #select2-brand-container');
    const brand = brandElement?.title?.trim() || "";

    const allowedBrands = ["Wacoal", "Freya", "Freya Swim", "Elomi", "Elomi Swim", "Fantasie", "Fantasie Swim"];
    if (!allowedBrands.some(b => brand.toLowerCase().startsWith(b.toLowerCase()))) return;

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
        if (!clipboardText) {
          btn.textContent = `❌ Geen HTML op klembord`;
          btn.style.backgroundColor = "#E06666";
          return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(clipboardText, "text/html");

        // Controle op productnummer (PID)
        const pidField = document.querySelector('#tabs-1 input[name="supplier_pid"]');
        const currentPID = pidField?.value?.trim();
        const htmlText = doc.body.textContent || doc.body.innerHTML;

        if (!currentPID || !htmlText.includes(currentPID)) {
          btn.textContent = `❌ PID mismatch of ontbreekt (${currentPID})`;
          btn.style.backgroundColor = "#E06666";
          return;
        }

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
              if (klass.includes("in_stock")) supplierStatus.set(maat, 2);
              else if (klass.match(/within_stage1|within_stage2|out_of_stock/)) supplierStatus.set(maat, 1);
            });
          });
        } else {
          const cells = [...table.querySelectorAll("tbody td")];
          cells.forEach((td, i) => {
            const maat = headers[i] || `COL${i}`;
            const klass = td.querySelector("div")?.classList.value || "";
            if (klass.includes("in_stock")) supplierStatus.set(maat.toUpperCase(), 2);
            else if (klass.match(/within_stage1|within_stage2|out_of_stock/)) supplierStatus.set(maat.toUpperCase(), 1);
          });
        }

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
            updated++;
          }
        });

        btn.textContent = `✅ Stock voor ${updated} maten ingevuld`;
        btn.style.backgroundColor = "#2ecc71";

      } catch (e) {
        console.error("❌ Fout bij verwerken:", e);
        btn.textContent = `❌ Fout bij verwerking`;
        btn.style.backgroundColor = "#E06666";
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
