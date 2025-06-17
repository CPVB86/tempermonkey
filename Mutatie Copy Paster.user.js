// ==UserScript==
// @name         Mutatie Copy Paster
// @namespace    https://dutchdesignersoutlet.com/
// @version      1.4
// @description  Genereert EAN en mutaties en kopieert ze automatisch naar het klembord
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  function init() {
    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    const btn = document.createElement("button");
    btn.textContent = `📋 Mutatie Copy Paster`;
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 130px;
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
      const rows = [...document.querySelectorAll("#tabs-3 table.options tr")].filter(row => row.querySelector("input[name*='[barcode]']"));
      const lines = [];

rows.forEach(row => {
  const eanInput = row.querySelector("input[name*='[barcode]']");
  const stockInput = row.querySelector("input[name*='[stock]']");
  const ean = eanInput?.value.trim();
  const stock = parseInt(stockInput?.value || "0");

  const bgColor = eanInput?.style.backgroundColor || "";

  if (bgColor === "rgb(147, 196, 125)") { // groen → bijboeken
    lines.push(`${ean}\t2`);
  } else if (bgColor === "rgb(224, 102, 102)" || bgColor === "rgb(255, 217, 102)") { // rood of geel → uitboeken
    if (stock > 0) {
      lines.push(`${ean}\t-${stock}`);
    } else {
      lines.push(`${ean}\t-2`);
    }
  }
});

      if (lines.length === 0) {
        btn.textContent = "⚠️ Geen mutaties gevonden";
        btn.style.backgroundColor = "#e06666";
        return;
      }

      const text = lines.join("\n");

      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "✅ Mutaties gekopieerd!";
        btn.style.backgroundColor = "#2ecc71";
      } catch (err) {
        console.error("Fout bij kopiëren naar klembord", err);
        btn.textContent = "❌ Kopieerfout";
        btn.style.backgroundColor = "#e06666";
      }
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
