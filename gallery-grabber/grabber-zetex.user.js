// ==UserScript==
// @name         Gallery Grabber | Zetex
// @version      1.2
// @description  Download Zetex productfoto's met correcte merkprefix
// @match        https://b2b.zetex.nl/products/*
// @grant        GM_download
// @connect      images.colect.services
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-zetex.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ORIGINAL_TEXT = "🧙‍♂️ Download foto's";
  const ORIGINAL_BG = "#8e44ad";

  function initDownloadButton() {
    if (document.getElementById("zetex-download-btn")) return;

    const btn = document.createElement("button");
    btn.id = "zetex-download-btn";
    btn.innerText = ORIGINAL_TEXT;

    Object.assign(btn.style, {
      position: "fixed",
      top: "60px",
      right: "10px",
      zIndex: "9999",
      padding: "10px 14px",
      borderRadius: "6px",
      backgroundColor: ORIGINAL_BG,
      color: "#fff",
      border: "none",
      cursor: "pointer",
      fontSize: "13px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    });

    btn.addEventListener("click", async () => {
      if (btn.dataset.locked) return;
      btn.dataset.locked = "true";
      btn.innerText = "🧙‍♂️ Hocus pocus...";
      btn.style.backgroundColor = "#f39c12";

      try {
        const urlSet = new Set();

        // IMG tags
        document
          .querySelectorAll(".product-details-multi-image img.c-image-zoom__origin-image")
          .forEach((img) => {
            if (img.src) urlSet.add(cleanUrl(img.src));
          });

        // Zoom backgrounds (vaak dezelfde maar we nemen ze mee)
        document
          .querySelectorAll(".product-details-multi-image .c-image-zoom__result")
          .forEach((div) => {
            const bg = div.style.backgroundImage || "";
            const m = bg.match(/url\(["']?(.*?)["']?\)/i);
            if (m && m[1]) {
              urlSet.add(cleanUrl(m[1]));
            }
          });

        const urls = Array.from(urlSet);

        if (urls.length === 0) {
          btn.innerText = "⚠️ Geen foto's gevonden";
          btn.style.backgroundColor = "gray";
          resetButton(btn);
          return;
        }

        const baseName =
          getBaseNameFromDescription() ||
          guessProductCode(urls) ||
          "zetex_product";

        const brandPrefix = getBrandPrefix(baseName);

        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const ext = getExtensionFromUrl(url);
          const filename = `${brandPrefix}${baseName}_${i + 1}.${ext}`;

          await downloadFile(url, filename);
          await wait(250);
        }

        btn.innerText = "✅ Klaar!";
        btn.style.backgroundColor = "green";
        resetButton(btn);
      } catch (err) {
        console.error("Download error:", err);
        btn.innerText = "❌ Fout";
        btn.style.backgroundColor = "red";
        resetButton(btn);
      }
    });

    document.body.appendChild(btn);
  }

  function resetButton(btn) {
    setTimeout(() => {
      btn.innerText = ORIGINAL_TEXT;
      btn.style.backgroundColor = ORIGINAL_BG;
      delete btn.dataset.locked;
    }, 3000);
  }

  function cleanUrl(url) {
    const txt = document.createElement("textarea");
    txt.innerHTML = url;
    return txt.value;
  }

  function getBaseNameFromDescription() {
    const el = document.querySelector(".product-details-information__description");
    if (!el) return null;

    const text = (el.textContent || "").trim();
    if (!text) return null;

    return text
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, "-");
  }

  function getBrandPrefix(baseName) {
    const collectionCode = extractCollectionCode(baseName);

    if (collectionCode === null) return "zetex_";

    if (collectionCode >= 100 && collectionCode <= 199) return "pastunette_";
    if (collectionCode >= 200 && collectionCode <= 299) return "pastunette_premium_";
    if (collectionCode >= 300 && collectionCode <= 399) return "pastunette_beach_";
    if (collectionCode >= 500 && collectionCode <= 599) return "pastunette_men_";
    if (collectionCode >= 600 && collectionCode <= 699) return "rebelle_";
    if (collectionCode >= 800 && collectionCode <= 899) return "robson_";

    return "zetex_";
  }

  function extractCollectionCode(baseName) {
    if (!baseName) return null;

    const parts = baseName.split("-");
    if (parts.length < 2) return null;

    const code = parseInt(parts[1], 10);
    return Number.isNaN(code) ? null : code;
  }

  function guessProductCode(urls) {
    for (const u of urls) {
      const cleaned = cleanUrl(u);

      // pakt bv 13222-606-4 uit filename
      const m1 = cleaned.match(/\/([^\/]+?)_720_[A-Z]+(?:\.[a-z]+|\?|$)/i);
      if (m1 && m1[1]) return m1[1];

      const m2 = cleaned.match(/\/(\d+(?:-\d+)+)_/);
      if (m2 && m2[1]) return m2[1];

      const m3 = cleaned.match(/(\d+(?:-\d+)+)/);
      if (m3 && m3[1]) return m3[1];
    }

    return null;
  }

  function getExtensionFromUrl(url) {
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".png")) return "png";
    if (clean.endsWith(".webp")) return "webp";
    if (clean.endsWith(".jpeg")) return "jpg";
    if (clean.endsWith(".jpg")) return "jpg";
    return "jpg";
  }

  function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
      GM_download({
        url,
        name: filename,
        saveAs: false,
        onload: resolve,
        onerror: reject,
        ontimeout: reject
      });
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.addEventListener("load", () => {
    setTimeout(initDownloadButton, 1500);
  });

})();
