// ==UserScript==
// @name         Check Stock | Anita & Rosa Faia Clipboard
// @version      2.8
// @description  Vergelijkt voorraad op DDO met leverancier stock, herkent bijv. 36A/B als 36 A/B
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/check-stock-anita.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brandElement = document.querySelector('#tabs-1 #select2-brand-container');
    const brand = brandElement?.title?.trim() || "";

    const allowedBrands = ["Anita", "Anita Maternity", "Anita Care", "Anita Active", "Anita Badmode", "Rosa Faia", "Rosa Faia Badmode"];
    if (!allowedBrands.some(b => brand.toLowerCase().startsWith(b.toLowerCase()))) return;

    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
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

    const supplierPID = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim() || "";
    btn.textContent = supplierPID
      ? `📊 Check Stock ${supplierPID} | ${brand}`
      : `📊 Check Stock | ${brand}`;
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
        const supplierPID = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim() || "";
        if (!supplierPID) {
          alert("❌ Geen supplier PID gevonden.");
          return;
        }

        const parts = supplierPID.split("-");
        const kleurCode = parts.pop();
        const artikelnummer = parts.join("-");
        console.log(`🔍 Artikelnummer: "${artikelnummer}", Kleurcode: "${kleurCode}"`);

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const matchingTable = [...doc.querySelectorAll("table[data-x='do-not-delete']")].find(table => {
          const tableArticle = table.getAttribute("data-article-number")?.trim();
          const tableColor = table.getAttribute("data-color-number")?.trim();
          return tableArticle === artikelnummer && tableColor === kleurCode;
        });

        if (!matchingTable) {
          alert(`❌ Geen tabel gevonden voor artikelnummer "${artikelnummer}" en kleurcode "${kleurCode}". Controleer of je juiste HTML hebt geplakt.`);
          return;
        }

        const headers = [...matchingTable.querySelectorAll("thead th")].map(th => th.textContent.trim().toUpperCase());
        const rows = [...matchingTable.querySelectorAll("tbody tr")];
        const supplierStatus = new Map();

        rows.forEach(row => {
          const cupmaat = row.querySelector("th")?.textContent.trim();
          const cells = row.querySelectorAll("td");
          cells.forEach((td, i) => {
            const bandmaat = headers[i + 1];
            const stock = parseInt(td.querySelector(".shop-in-stock")?.textContent.trim() || "0");
            const maat = `${bandmaat}${cupmaat}`.replace(/\s+/g, "").toUpperCase();
            if (stock > 4) {
              supplierStatus.set(maat, "in_stock");
            } else if (stock > 0) {
              supplierStatus.set(maat, "low_stock");
            } else {
              supplierStatus.set(maat, "out_of_stock");
            }
          });
        });

        const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[type='text']"));
        const ddoData = rowsDDO.map(row => {
          const maat = row.querySelector("td input")?.value.trim().toUpperCase();
          const stock = parseInt(row.querySelector("input[name*='[stock]']")?.value || "0");
          const ean = row.querySelector("input[name*='[barcode]']")?.value || "";
          return { maat, stock, ean, row };
        });

        let afwijkingen = 0;

        ddoData.forEach(item => {
          const status = supplierStatus.get(item.maat);
          const stockInput = item.row.querySelector("input[name*='[stock]']");
          const eanInput = item.row.querySelector("input[name*='[barcode]']");

          if (item.stock > 0 && (!status || status === "out_of_stock" || status === "low_stock")) {
            stockInput.style.backgroundColor = "#E06666"; // rood
            eanInput.style.backgroundColor = "#E06666";
            afwijkingen++;
          } else if (item.stock === 0 && status === "in_stock") {
            stockInput.style.backgroundColor = "#93C47D"; // groen
            eanInput.style.backgroundColor = "#93C47D";
            afwijkingen++;
          }
        });

        console.group(`📊 Resultaat voorraadvergelijking (${brand})`);
        ddoData.forEach(item => {
          console.log(`- ${item.maat} | EAN: ${item.ean}`);
        });
        console.groupEnd();

        if (afwijkingen > 0) {
          btn.textContent = `⚠️ Stock van ${brand} wijkt af!`;
          btn.style.backgroundColor = "#f39c12"; // Oranje
        } else {
          btn.textContent = `📊 Stock van ${brand} gecheckt!`;
          btn.style.backgroundColor = "#2ecc71"; // Groen
        }

      } catch (e) {
        console.error("❌ Fout tijdens verwerken:", e);
        alert(`Er ging iets mis bij het verwerken van de geplakte HTML voor ${brand}.`);
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
