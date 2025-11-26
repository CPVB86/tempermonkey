// ==UserScript==
// @name         Gallery Grabber | Lisca
// @version      2.1
// @description  Vist 'full'-foto's uit originele HTML via fetch en gebruikt SKU als bestandsnaam
// @match        https://b2b-eu.lisca.com/*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  function initDownloadButton() {
    if (document.getElementById("lisca-download-btn")) return;

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
      backgroundColor: "#9b59b6",
      color: "#fff",
      border: "none",
      cursor: "pointer",
    });

    btn.addEventListener("click", async () => {
      if (btn.dataset.locked) return;
      btn.innerText = "🧙‍♂️ Hocus Pocus...";
      btn.style.backgroundColor = "#e67e22";
      btn.dataset.locked = "true";

      try {
        const res = await fetch(window.location.href);
        const html = await res.text();

        // Vind de SKU
        const skuMatch = html.match(/data-product-sku="([^"]+)"/);
        let productSKU = "lisca_product";
if (skuMatch) {
  const raw = skuMatch[1].trim();
  if (raw.length >= 8) {
    productSKU = `${raw.slice(0, 6)}-${raw.slice(6)}`;
  } else {
    productSKU = raw;
  }
}

        // Vind de 'full' URLs
        const matches = [...html.matchAll(/['"]full['"]\s*:\s*['"]([^'"]+)['"]/g)];
        let fullUrls = matches.map(m => m[1].replace(/\\\//g, '/'));
        fullUrls = [...new Set(fullUrls)];

        if (fullUrls.length === 0) {
          btn.innerText = "⚠️ Geen foto's";
          btn.style.backgroundColor = "gray";
          return;
        }

        for (let i = 0; i < fullUrls.length; i++) {
          const url = fullUrls[i];
          const filename = `${productSKU}_${i + 1}.jpg`;

          const blob = await fetch(url).then(res => res.blob());
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(objectUrl);
          await new Promise((res) => setTimeout(res, 200));
        }

        btn.innerText = "✅ Klaar!";
        btn.style.backgroundColor = "green";

      } catch (err) {
        console.error("Download error:", err);
        btn.innerText = "❌ Fout";
        btn.style.backgroundColor = "red";
      }
    });

    document.body.appendChild(btn);
  }

  window.addEventListener("load", () => {
    setTimeout(initDownloadButton, 1500);
  });
})();
