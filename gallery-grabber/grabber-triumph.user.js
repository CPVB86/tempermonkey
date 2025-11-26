// ==UserScript==
// @name         Gallery Grabber | Triumph
// @version      1.0
// @description  Download de beste beschikbare Triumph-productfoto's met één klik
// @match        https://b2b.triumph.com/products/NL_TriumphPROD*
// @match        https://b2b.triumph.com/products/NL_sloggiPROD*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-triumph.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ORIGINAL_TEXT = "🧙‍♂️ Download foto's";
  const ORIGINAL_BG = "#e6007e";

  function initDownloadButton() {
    if (document.getElementById("triumph-download-btn")) return;

    const btn = document.createElement("button");
    btn.id = "triumph-download-btn";
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
        // 1. Verzamel alle relevante image-URL's uit de gallery
        const urlSet = new Set();

        // a) De zichtbare <img> elementen
        document
          .querySelectorAll(
            ".product-details-multi-image img.c-image-zoom__origin-image"
          )
          .forEach((img) => {
            if (img.src) urlSet.add(cleanUrl(img.src));
          });

        // b) De zoom-resultaten met background-image (meestal de grotere variant)
        document
          .querySelectorAll(
            ".product-details-multi-image .c-image-zoom__result"
          )
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

        // 2. Basis bestandsnaam bepalen
        // Eerst uit de description (10004928 - 0026 - SKIN -> 10004928-0026-SKIN)
        const baseName =
          getBaseNameFromDescription() ||
          guessProductCode(urls) ||
          "triumph_product";

        // 3. Download alle images één voor één
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];

          const response = await fetch(url);
          if (!response.ok) {
            console.warn("Kon niet downloaden:", url);
            continue;
          }

          const blob = await response.blob();
          const contentType = response.headers.get("Content-Type") || "";
          let ext = "jpg";
          if (contentType.includes("png")) ext = "png";
          else if (contentType.includes("webp")) ext = "webp";
          else if (contentType.includes("jpeg")) ext = "jpg";

          const filename = `${baseName}_${i + 1}.${ext}`;

          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(objectUrl);

          // kleine pauze om de browser niet te laten stikken
          await new Promise((res) => setTimeout(res, 200));
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
    }, 3000); // 3 seconden reset
  }

  function cleanUrl(url) {
    // Zorg dat &amp; → & etc.
    const txt = document.createElement("textarea");
    txt.innerHTML = url;
    return txt.value;
  }

  function getBaseNameFromDescription() {
    // <p class="product-details-information__description">10004928 - 0026 - SKIN</p>
    const el = document.querySelector(
      ".product-details-information__description"
    );
    if (!el) return null;

    const text = (el.textContent || "").trim();
    if (!text) return null;

    // "10004928 - 0026 - SKIN" -> "10004928-0026-SKIN"
    const normalized = text
      .replace(/\s*-\s*/g, "-") // spaties rond streepjes weg
      .replace(/\s+/g, "-"); // overige spaties door 1 streepje (failsafe)

    return normalized;
  }

  function guessProductCode(urls) {
    // Fallback als description er niet is
    const first = urls.find((u) =>
      u.includes("contentstore.triumph.com/transform/")
    );
    if (first) {
      // Voorbeeld: .../101847650003_TO_F_1?date-modified=...
      const m = first.match(/\/(\d{6,})_[^\/?]+/);
      if (m && m[1]) {
        return m[1];
      }
    }

    // Extra fallback: pak gewoon de eerste lange cijferreeks
    for (const u of urls) {
      const m = u.match(/(\d{6,})/);
      if (m && m[1]) return m[1];
    }

    return null;
  }

  window.addEventListener("load", () => {
    setTimeout(initDownloadButton, 1500);
  });
})();
