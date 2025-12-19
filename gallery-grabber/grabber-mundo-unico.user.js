// ==UserScript==
// @name         Gallery Grabber | Colomoda
// @version      1.0
// @description  Download alle slider-afbeeldingen (thumbs -> 650x650x2)
// @match        https://www.colomoda.eu/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-mundo-unico.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-mundo-unico.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-download-images-btn';

  function getHiResUrlFromThumb(url) {
    if (!url) return null;

    // Strip querystring (soms irrelevant, maar veilig)
    const clean = url.split('?')[0];

    // Vervang exact de thumb-dir naar full-dir
    // Voorbeeld: .../65x65x2/...jpg  -> .../650x650x2/...jpg
    return clean.replace('/65x65x2/', '/650x650x2/');
  }

  function addButtonIfPossible() {
    // Container uit jouw snippet
    const container =
      document.querySelector('.product-thumbs') ||
      document.querySelector('#swiper-product-thumbs');

    if (!container) return;
    if (document.getElementById(BTN_ID)) return;

    // Zorg dat we relatief kunnen positioneren
    container.style.position = container.style.position || 'relative';

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ Download alle afbeeldingen (650x650)';
    btn.style.position = 'absolute';
    btn.style.top = '6px';
    btn.style.right = '6px';
    btn.style.zIndex = '9999';
    btn.style.padding = '4px 8px';
    btn.style.fontSize = '11px';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '12px';
    btn.style.border = 'none';
    btn.style.background = 'rgba(0,0,0,0.75)';
    btn.style.color = 'yellow';
    btn.style.fontFamily = 'inherit';

    btn.addEventListener('mouseover', () => (btn.style.background = 'rgba(0,0,0,0.9)'));
    btn.addEventListener('mouseout', () => (btn.style.background = 'rgba(0,0,0,0.75)'));

    btn.addEventListener('click', () => {
      // thumbs zitten als <img class="product-thumb-img" src=".../65x65x2/...">
      const imgs = document.querySelectorAll('#swiper-product-thumbs img.product-thumb-img, .product-thumbs img.product-thumb-img');
      if (!imgs.length) return;

      const urls = [];
      const seen = new Set();

      imgs.forEach((img) => {
        const thumbUrl = img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc;
        const hiRes = getHiResUrlFromThumb(thumbUrl);
        if (!hiRes) return;

        if (!seen.has(hiRes)) {
          seen.add(hiRes);
          urls.push(hiRes);
        }
      });

      if (!urls.length) return;

      urls.forEach((url, i) => {
        const filenameFromUrl = url.split('/').pop() || `image_${i + 1}.jpg`;

        // Prefix index voor nette volgorde
        const filename = String(i + 1).padStart(2, '0') + '_' + filenameFromUrl;

        GM_download({
          url,
          name: filename,
          saveAs: false
        });
      });
    });

    container.appendChild(btn);
  }

  // Eerste poging na load
  window.addEventListener('load', addButtonIfPossible);

  // Voor SPA/Ajax veranderingen
  const observer = new MutationObserver(addButtonIfPossible);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
