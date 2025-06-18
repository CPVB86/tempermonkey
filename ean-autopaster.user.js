// ==UserScript==
// @name         EAN Autopaster
// @version      1.4
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
    if (!tab) return;

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
    `;
    tab.prepend(btn);

    btn.addEventListener("click", async () => {
      try {
        const raw = await navigator.clipboard.readText();
        if (!raw) {
          btn.textContent = "❌ Geen klembordgegevens";
          btn.style.backgroundColor = "#E06666";
          return;
        }

        const data = raw.split("\n").map(line => {
          const [maat, ean, pid] = line.trim().split("\t");
          return { maat, ean, pid };
        });

        const supplierPid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value.trim();
        if (!supplierPid) {
          btn.textContent = "❌ Geen Supplier PID";
          btn.style.backgroundColor = "#E06666";
          return;
        }

        const filtered = data.filter(row => row.pid?.startsWith(supplierPid));
        if (filtered.length === 0) {
          btn.textContent = `❌ Geen matches voor PID: ${supplierPid}`;
          btn.style.backgroundColor = "#E06666";
          return;
        }

        const rows = tab.querySelectorAll("table.options tr");
        let matched = 0;

        rows.forEach(row => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) return;

          const maatInput = cells[0].querySelector('input');
          const maatCell = maatInput ? maatInput.value.trim().toUpperCase() : "";
          const eanInput = row.querySelector('input[name^="options"][name$="[barcode]"]');

          if (!maatCell || !eanInput) return;

          const match = filtered.find(entry => entry.maat?.trim().toUpperCase() === maatCell);
          if (match) {
            eanInput.value = match.ean;
            eanInput.dispatchEvent(new Event("input", { bubbles: true }));
            matched++;
          }
        });

        btn.style.backgroundColor = "#2ecc71";
        btn.textContent = `📦 ${matched} EAN's geplakt!`;

      } catch (e) {
        console.error("❌ Fout bij plakken:", e);
        btn.textContent = "❌ Fout bij plakken";
        btn.style.backgroundColor = "#E06666";
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
