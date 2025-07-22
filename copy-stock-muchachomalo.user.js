// ==UserScript==
// @name         Kopieer Stock | Muchachomalo
// @version      1.0
// @description  Kopieer Muchachomalo voorraad-tabellen (HTML) voor DDO vergelijking
// @match        https://agent.muchachomalo.com/*
// @grant        GM_setClipboard
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/copy-stock-muchachomalo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/copy-stock-muchachomalo.user.js
// ==/UserScript==

(function () {
  'use strict';

  function createButton() {
    const btn = document.createElement("button");
    btn.id = "check-stock-button";
    btn.innerText = "📊 Kopieer Stock";
    btn.style.position = "fixed";
    btn.style.top = "10px";
    btn.style.right = "10px";
    btn.style.zIndex = "9999";
    btn.style.padding = "10px";
    btn.style.backgroundColor = "#3498db";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "5px";
    btn.style.cursor = "pointer";
    btn.title = "Kopieert alle Muchachomalo voorraad-tabellen (HTML) naar je klembord";
    document.body.appendChild(btn);

    btn.addEventListener("click", () => copyHTML(btn));
  }

  function copyHTML(button) {
    // Selecteer ALLE voorraad-tabellen binnen de Muchachomalo structuur
    const tables = document.querySelectorAll("table.sizes-overview");
    if (tables.length === 0) {
      alert("⚠️ Geen Muchachomalo voorraad-tabellen gevonden.");
      return;
    }

    // Combineer alle tabellen in een <div>
    let combinedHTML = '<div class="kopieer-stock">';
    tables.forEach(table => {
      let html = table.outerHTML;
      // Corrigeer maatnotatie: vervang XXXL door 3XL
      html = html.replace(/>XXXL</g, '>3XL<');
      combinedHTML += html;
    });
    combinedHTML += '</div>';

    // Kopieer naar klembord
    if (typeof GM_setClipboard !== "undefined") {
      GM_setClipboard(combinedHTML, "text");
    } else {
      const win = window.open("", "_blank", "width=800,height=600");
      win.document.write("<pre>" + combinedHTML.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</pre>");
      alert("📄 Tabellen geopend in nieuw venster. Kopieer met Ctrl+A, Ctrl+C.");
    }

    // Update button status
    button.innerText = "📊 Stock Gekopieerd!";
    button.style.backgroundColor = "#27ae60";
  }

  window.addEventListener("load", () => setTimeout(createButton, 1500));
})();
