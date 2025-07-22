// ==UserScript==
// @name         Add Stock | Muchachomalo
// @version      1.0
// @description  Vult voorraad in DDO automatisch op basis van HTML van Muchachomalo (>4 = 2, 1–4 = 1, 0 = negeren)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-muchachomalo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-muchachomalo.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brand = document.querySelector('#tabs-1 #select2-brand-container')?.title?.trim() || "";
    if (!brand.toLowerCase().includes("muchachomalo")) return;

    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
    btn.textContent = "🚛 Add Stock | Muchachomalo";
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

        const table = doc.querySelector(".kopieer-stock table.sizes-overview");
        if (!table) return showError("❌ Geen Muchachomalo voorraadtabel gevonden");

        const inputs = table.querySelectorAll("input[data-size][data-stock]");
        const stockMap = new Map();

        inputs.forEach(input => {
          let size = input.getAttribute("data-size")?.trim().toUpperCase();
          const stock = parseInt(input.getAttribute("data-stock")) || 0;

          if (!size || stock === 0) return;

          // Normalize maatnamen: XXXL → 3XL etc.
          size = size.replace("XXXL", "3XL").replace("XXXXL", "4XL").replace("XXXXX", "5XL");

          const value = stock > 4 ? 2 : 1;
          stockMap.set(size, value);
        });

        const rowsDDO = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(r => r.querySelector("input[type='text']"));
        let updated = 0;

        rowsDDO.forEach(row => {
          const maat = row.querySelector("td input")?.value.trim().toUpperCase();
          const stockInput = row.querySelector("input[name*='[stock]']");
          if (!maat || !stockInput) return;

          const value = stockMap.get(maat);
          if (value !== undefined) {
            stockInput.value = value;
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

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
