// ==UserScript==
// @name         🧙‍♂️ The Gallery Grabber
// @namespace    https://runiversity.nl
// @version      2.1
// @description  Download alle 1200px productfoto's van Wacoal los en netjes, met statusknop rechtsboven.
// @updateURL   https://raw.githubusercontent.com/CPVB86/tempermonkey/main/The%20Gallery%20Grabber.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/The%20Gallery%20Grabber.user.js
// @author       C. P. v. Beek
// @match        https://b2b.wacoal-europe.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function initDownloadButton() {
    if (document.getElementById("wacoal-download-btn")) return;

    const target = document.querySelector(".pdp-carousel-container");
    if (!target) return;

    const btn = document.createElement("button");
    btn.id = "wacoal-download-btn";
    btn.innerText = "🧙‍♂️ Download foto's";

    Object.assign(btn.style, {
      position: "fixed",
      top: "60px",
      right: "10px",
      zIndex: "9999",
      padding: "10px",
      borderRadius: "5px",
      backgroundColor: "#3498db",
      color: "#fff",
      border: "none",
      cursor: "pointer",
    });

    btn.addEventListener("click", async () => {
      if (btn.dataset.locked) return;

      btn.innerText = "⌛ Downloaden...";
      btn.style.backgroundColor = "#ff8c00"; // oranje
      btn.dataset.locked = "true";

      // Haal de productcode op (tweede .pdp-details_product-code span)
      const codeElems = document.querySelectorAll(".pdp-details_product-code span");
      const productCode = codeElems.length >= 2 ? codeElems[1].textContent.trim().replace(/\s+/g, "") : "product";

      // Verzamel alle 1200px image URL's
      const images = document.querySelectorAll(".pdp-carousel_item");
      const urls = [];

      images.forEach((li) => {
        const clickAttr = li.getAttribute("ng-click");
        if (!clickAttr) return;
        const match = clickAttr.match(/'(https:\/\/[^']+1200x1680[^']+)'/);
        if (match) {
          urls.push(match[1]);
        }
      });

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const filename = `${productCode}_${i + 1}.jpg`;
        const blob = await fetch(url).then((res) => res.blob());
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
        await new Promise((resolve) => setTimeout(resolve, 200)); // even ademhalen
      }

      btn.innerText = "🤘 Klaar!";
      btn.style.backgroundColor = "green";
    });

    document.body.appendChild(btn);
  }

  const observer = new MutationObserver(() => initDownloadButton());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("load", initDownloadButton);
})();
