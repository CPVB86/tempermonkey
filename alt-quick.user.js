// ==UserScript==
// @name         Alt Quick
// @version      1.0
// @description  Druk op ALT+Q om de '📊 Check Stock' knop te activeren op DDO productpagina's
// @match        https://b2b.wacoal-europe.com/b2b/*
// @match        https://b2b.anita.com/nl/shop/*
// @author       C. P. v. Beek
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  document.addEventListener("keydown", function (e) {
    const key = e.key.toLowerCase();

    if (e.altKey && key === "q") {
      e.preventDefault();
      const btn = document.getElementById("check-stock-button");
      if (btn) {
        console.log("🔑 ALT+Q → knop geactiveerd.");
        btn.click();
      } else {
        console.warn("⚠️ Knop met ID 'check-stock-button' niet gevonden.");
      }
    }

    if (e.altKey && key === "r") {
      e.preventDefault();
      GM_setClipboard("", "text");
      console.log("🧹 ALT+R → klembord geleegd.");
    }
  });
})();
