// ==UserScript==
// @name         Fix Stock 1 → 0
// @version      1.0
// @description  Zet alle stockwaarden van '1' in #tabs-3 in één klik om naar '0'
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/stock-fixer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/stock-fixer.user.js
// ==/UserScript==

(function () {
  'use strict';

  function init() {
    const tab = document.querySelector("#tabs-3");
    if (!tab) return;

    // Verzamel alle stockvelden
    const stockInputs = [...tab.querySelectorAll('input[name*="[stock]"]')]
      .filter(input => !input.disabled && !input.readOnly);

    if (stockInputs.length === 0) return; // niets aan te passen = exit

    const hasStockOne = stockInputs.some(input => input.value.trim() === "1");

    // Knop toevoegen
    const btn = document.createElement("button");
    btn.textContent = hasStockOne ? "🧯 Fix Stock" : "✅ Stock is OK!";
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 170px;
      z-index: 9999;
      padding: 10px;
      background: ${hasStockOne ? "#007cba" : "#2ecc71"};
      color: white;
      border: none;
      border-radius: 5px;
      cursor: ${hasStockOne ? "pointer" : "default"};
    `;
    btn.disabled = !hasStockOne;

    tab.prepend(btn);

    btn.addEventListener("click", () => {
      if (!hasStockOne) return;

      let changed = 0;

      stockInputs.forEach(input => {
        if (input.value.trim() === "1") {
          input.value = "0";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          changed++;
        }
      });

      btn.textContent = `🔧 ${changed} maten aangepast naar 0`;
      btn.style.backgroundColor = "#2ecc71";
      btn.disabled = true;
    });
  }

  window.addEventListener("load", () => setTimeout(init, 1000));
})();
