// ==UserScript==
// @name         🧙‍♂️ The Gallery Grabber – Lisca
// @version      1.1
// @description  Download alle 'full' productfoto's van Lisca netjes, met knop rechtsboven.
// @match        https://b2b-eu.lisca.com/*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  function log(...args) {
    console.log('[Lisca Grabber]', ...args);
  }

  function findImageData() {
    const scripts = document.querySelectorAll('script[type="text/x-magento-init"]');

    for (let script of scripts) {
      try {
        const txt = script.textContent.trim();
        if (!txt.includes('"mage/gallery/gallery"')) continue;

        const parsed = JSON.parse(txt);
        const gallery = parsed?.["[data-gallery-role=gallery-placeholder]"]?.["mage/gallery/gallery"];
        if (gallery?.data?.length) {
          log(`✅ ${gallery.data.length} afbeeldingen gevonden`);
          return gallery.data;
        }
      } catch (err) {
        log('⚠️ Fout bij JSON parse:', err);
      }
    }

    log('❌ Geen geldige afbeeldingendata gevonden.');
    return null;
  }

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

      const imageData = findImageData();
      if (!imageData || imageData.length === 0) {
        btn.innerText = "⚠️ Geen foto's";
        btn.style.backgroundColor = "gray";
        return;
      }

      const productCode = imageData[0].caption?.replace(/\s+/g, "_") || "lisca_product";
      const urls = imageData.map((img) => img.full).filter(Boolean);

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        log(`📥 Download ${url}`);
        const filename = `${productCode}_${i + 1}.jpg`;

        try {
          const blob = await fetch(url).then(res => res.blob());
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(objectUrl);
          await new Promise(res => setTimeout(res, 200));
        } catch (err) {
          log('⚠️ Fout bij downloaden van afbeelding:', err);
        }
      }

      btn.innerText = "🤘 Klaar!";
      btn.style.backgroundColor = "green";
    });

    document.body.appendChild(btn);
  }

  // Wacht tot scripts geladen zijn
  const observer = new MutationObserver(() => {
    if (document.querySelector('script[type="text/x-magento-init"]')) {
      initDownloadButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("load", () => {
    setTimeout(initDownloadButton, 1500); // extra wachttijd
  });
})();
