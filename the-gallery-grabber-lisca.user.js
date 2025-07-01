// ==UserScript==
// @name         🧙‍♂️ The Gallery Grabber – Lisca
// @version      1.0
// @description  Download alle 'full' productfoto's van Lisca netjes, met knop rechtsboven.
// @match        https://b2b-eu.lisca.com/*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  function initDownloadButton() {
    if (document.getElementById("lisca-download-btn")) return;

    const placeholder = document.querySelector("[data-gallery-role=gallery-placeholder]");
    if (!placeholder) return;

    const btn = document.createElement("button");
    btn.id = "lisca-download-btn";
    btn.innerText = "🧙‍♂️ Download foto's";

    Object.assign(btn.style, {
      position: "fixed",
      top: "60px",
      right: "10px",
      zIndex: "9999",
      padding: "10px",
      borderRadius: "5px",
      backgroundColor: "#e74c3c",
      color: "#fff",
      border: "none",
      cursor: "pointer",
    });

    btn.addEventListener("click", async () => {
      if (btn.dataset.locked) return;

      btn.innerText = "⌛ Downloaden...";
      btn.style.backgroundColor = "#ff8c00";
      btn.dataset.locked = "true";

      // Zoek het juiste script element
      const scripts = document.querySelectorAll('script[type="text/x-magento-init"]');
      let json = null;

      for (let s of scripts) {
        try {
          const parsed = JSON.parse(s.textContent);
          if (parsed["[data-gallery-role=gallery-placeholder]"]?.["mage/gallery/gallery"]?.data) {
            json = parsed["[data-gallery-role=gallery-placeholder]"]["mage/gallery/gallery"].data;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!json || json.length === 0) {
        btn.innerText = "⚠️ Geen afbeeldingen gevonden";
        btn.style.backgroundColor = "gray";
        return;
      }

      // Probeer een productcode uit de caption of fallback
      const productCode = json[0].caption?.replace(/\s+/g, "_") || "lisca_product";

      const urls = json.map((img) => img.full).filter(Boolean);

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
        await new Promise((resolve) => setTimeout(resolve, 200));
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
