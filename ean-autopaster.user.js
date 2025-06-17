// ==UserScript==
// @name         EAN Autopaster
// @version      1.3
// @description  Plak EAN codes automatisch in #tabs-3 op basis van maat en Supplier PID
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-autopaster.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-autopaster.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const tab = document.querySelector("#tabs-3");
    if (!tab) return; // Alleen zichtbaar als #tabs-3 aanwezig is

    const btn = document.createElement("button");
    btn.textContent = "📦 EAN Autopaster";
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 50px;
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
      const raw = prompt("Plak hier je lijst (Maat | EAN | Supplier PID):");
      if (!raw) return;

      const data = raw.split("\n").map(line => {
        const [maat, ean, pid] = line.trim().split("\t");
        return { maat, ean, pid };
      });

      const supplierPid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim();
      if (!supplierPid) {
        alert("Geen Supplier PID gevonden op #tabs-1");
        return;
      }

      const filtered = data.filter(row => row.pid.startsWith(supplierPid));
      if (filtered.length === 0) {
        alert("Geen bijpassende EAN's gevonden voor PID: " + supplierPid);
        return;
      }

      const rows = tab.querySelectorAll("table.options tr");
      rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) return;

        const maatInput = cells[0].querySelector('input');
        const maatCell = maatInput ? maatInput.value.trim().toUpperCase() : "";
        const eanInput = row.querySelector('input[name^="options"][name$="[barcode]"]');

        if (!maatCell || !eanInput) return;

        const match = filtered.find(entry => entry.maat.trim().toUpperCase() === maatCell);
        if (match) {
          console.log(`✅ Maat ${maatCell} → EAN ${match.ean}`);
          eanInput.value = match.ean;
          eanInput.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          console.warn(`⚠️ Geen match gevonden voor maat ${maatCell}`);
        }
      });

      // Button groen maken en melding geven
      btn.style.backgroundColor = "#2ecc71";
      btn.textContent = "📦 EAN's geplakt!";
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
