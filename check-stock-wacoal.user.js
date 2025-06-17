// ==UserScript==
// @name         Check Stock | Wacoal & co Clipboard
// @version      2.7
// @description  Vergelijkt voorraad op DDO met Wacoal
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-wacoal.user.js
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
      let html;
      try {
        html = await navigator.clipboard.readText();
        if (!html) throw new Error("Klembord is leeg!");
      } catch (err) {
        alert("🚫 Geen toegang tot klembord of niets gevonden. Geef toestemming in je browser.");
        console.error(err);
        return;
      }

      try {
        const lines = html.trim().split("\n");
        const pastedPID = lines[0]?.trim().toUpperCase();
        const restHTML = lines.slice(1).join("\n");

        const localPID = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim().toUpperCase();
        if (pastedPID !== localPID) {
          alert(`❌ Geen overeenkomst gevonden!\nDDO: ${localPID} vs Geplakt: ${pastedPID}`);
          return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(restHTML, "text/html");
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
              let maat = `${bandmaat}${cupmaat}`.replace(/\s+/g, "").toUpperCase();
              if (maat === "1") maat = "ONE SIZE"; // ✅ FIX
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
            let maat = headers[i] || `COL${i}`;
            maat = maat.trim().toUpperCase();
            if (maat === "1") maat = "ONE SIZE"; // ✅ FIX
            const klass = td.querySelector("div")?.classList.value || "";
            if (klass.includes("in_stock")) supplierStatus.set(maat, "in_stock");
            else if (klass.includes("within_stage1")) supplierStatus.set(maat, "within_stage1");
            else if (klass.includes("within_stage2")) supplierStatus.set(maat, "within_stage2");
            else if (klass.includes("out_of_stock")) supplierStatus.set(maat, "out_of_stock");
          });
        }

        const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[type='text']"));

        let verschilGevonden = false;

        console.group(`📏 Gevonden maten + EAN's (${brand})`);
        rowsDDO.forEach(row => {
          const maatInput = row.querySelector("td input");
          const eanInput = row.querySelector("input[name*='[barcode]']");
          const stockInput = row.querySelector("input[name*='[stock]']");
          const maat = maatInput?.value.trim().toUpperCase();
          const ean = eanInput?.value.trim();
          const stock = parseInt(stockInput?.value || "0");
          const status = supplierStatus.get(maat);

          if (maat) {
            console.info(`- ${maat} | EAN: ${ean}`);
          }

          if (maat && eanInput) {
            if (stock > 0 && status !== "in_stock") {
              maatInput.style.backgroundColor = "#E06666";
              eanInput.style.backgroundColor = "#E06666";
              verschilGevonden = true;
            } else if (stock === 0 && status === "in_stock") {
              maatInput.style.backgroundColor = "#93C47D";
              eanInput.style.backgroundColor = "#93C47D";
              verschilGevonden = true;
            }
          }
        });
        console.groupEnd();

        console.group(`📊 RESULTAAT VOORRAADVERGELIJKING (${brand})`);
        console.log("✅ Voorraadvergelijking uitgevoerd. Bekijk de gemarkeerde velden in de tabel.");
        console.groupEnd();

        if (verschilGevonden) {
          btn.textContent = `📊 Stock van ${brand} wijkt af!`;
          btn.style.backgroundColor = "#f39c12"; // oranje
        } else {
          btn.textContent = `📊 Stock van ${brand} gecheckt!`;
          btn.style.backgroundColor = "#2ecc71"; // groen
        }

      } catch (e) {
        console.error(`❌ Fout tijdens verwerken (${brand}):`, e);
        alert(`Er ging iets mis bij het verwerken van de geplakte HTML voor ${brand}.`);
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
