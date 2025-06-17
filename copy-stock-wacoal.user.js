// ==UserScript==
// @name         Kopieer Stock | Wacoal (met PID en datumcheck)
// @namespace    https://b2b.wacoal-europe.com/
// @version      1.5
// @description  Kopieert voorraad HTML + PID van Wacoal, maar alleen als leverbaar ("NOW")
// @match        https://b2b.wacoal-europe.com/b2b/*
// @grant        GM_setClipboard
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/copy-stock-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/copy-stock-wacoal.user.js
// ==/UserScript==

(function () {
  'use strict';

  function createButton() {
    const btn = document.createElement("button");
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
    btn.title = "Kopieert de voorraadtabel (HTML) + PID naar je klembord";
    document.body.appendChild(btn);

    btn.addEventListener("click", () => copyHTML(btn));
  }

  function copyHTML(button) {
    const infoBlocks = [...document.querySelectorAll(".pdp-details_product-code")];

    const pidBlock = infoBlocks.find(p => p.textContent.toLowerCase().includes("product code:"));
    const dateBlock = infoBlocks.find(p => p.textContent.toLowerCase().includes("available date:"));

    const pid = pidBlock?.querySelector("span")?.textContent?.trim();
    const available = dateBlock?.querySelector("span")?.textContent?.trim().toUpperCase();

    if (!pid) {
      alert("❌ Geen Product Code gevonden.");
      return;
    }

    if (available !== "NOW") {
      button.innerText = "❌ Nog niet leverbaar!";
      button.style.backgroundColor = "#E06666";
      return;
    }

    const table = document.querySelector("table.scroll-table__table");
    if (!table) {
      alert("❌ Geen voorraad­tabel gevonden.");
      return;
    }

    const html = table.outerHTML;
    const combined = `${pid}\n${html}`;

    if (typeof GM_setClipboard !== "undefined") {
      GM_setClipboard(combined, "text");
    }

    button.innerText = "📊 Stock + PID Gekopieerd!";
    button.style.backgroundColor = "#2ecc71";
  }

  window.addEventListener("load", () => setTimeout(createButton, 1500));
})();
