
// ==UserScript==
// @name         Add Stock | Lisca
// @version      1.1
// @description  Vult voorraad in DDO automatisch op basis van HTML van Lisca (>5 = 2, 1–5 = 1, 0 = negeren)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/add-stock-lisca.user.js
// ==/UserScript==

(function () {
  "use strict";

  function init() {
    const brand = document.querySelector('#tabs-1 #select2-brand-container')?.title?.trim() || "";
    if (!brand.toLowerCase().startsWith("lisca")) return;

    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
    btn.textContent = "🚛 Add Stock | Lisca";
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

        const pid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim();
        const htmlText = doc.body.textContent || doc.body.innerHTML;
        if (!pid || !htmlText.includes(pid)) return showError(`❌ PID mismatch of ontbreekt (${pid})`);

        const table = doc.querySelector(".um-prodmatrix table");
        if (!table) return showError("❌ Geen Lisca matrix gevonden");

        const headers = [...table.querySelectorAll("thead th")]
          .slice(1)
          .map(th => th.textContent.trim());

        const rows = table.querySelectorAll("tbody tr");
        const stockMap = new Map();

        rows.forEach(row => {
          const cupmaat = row.querySelector("td > div")?.textContent.trim();
          const cells = [...row.querySelectorAll("td")].slice(1);

          cells.forEach((td, i) => {
            const voorraadText = td.querySelector(".prodmatrix-stock-status")?.textContent || "";
            const match = voorraadText.match(/\((\d+)\)/);
            const aantal = parseInt(match?.[1] || "0");

            if (aantal > 0) {
              const stock = aantal > 5 ? 2 : 1;
              const maat = `${headers[i]}${cupmaat}`.replace(/\s+/g, "").toUpperCase();
              stockMap.set(maat, stock);
            }
          });
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
