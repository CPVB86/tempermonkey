// ==UserScript==
// @name         Gallery Grabber | Zetex
// @version      1.2
// @description  Download alle gallery-afbeeldingen uit .a4f-images
// @match        https://b2b.zetex.nl/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-zetex.user.js
// ==/UserScript==

(function () {
  'use strict';

  function addButtonIfPossible() {
    const container = document.querySelector('.a4f-images');
    if (!container) return;

    if (document.getElementById('ddo-download-images-btn')) return;

    // Zorg dat we iets hebben om relatief in te positioneren
    container.style.position = container.style.position || 'relative';

    const btn = document.createElement('button');
    btn.id = 'ddo-download-images-btn';
    btn.textContent = '⬇️ Download alle afbeeldingen';
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

    btn.addEventListener('mouseover', () => {
      btn.style.background = 'rgba(0,0,0,0.9)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'rgba(0,0,0,0.75)';
    });

    btn.addEventListener('click', () => {
      const links = container.querySelectorAll('a.a4f-product-image[href]');
      if (!links.length) return;

      links.forEach((a, i) => {
        const rawUrl = a.href;
        if (!rawUrl) return;

        const cleanUrl = rawUrl.split('?')[0];
        const filename = cleanUrl.split('/').pop() || `image_${i + 1}.jpg`;

        // Gebruik GM_download zodat de site JS niet de klik kaapt
        GM_download({
          url: rawUrl,
          name: filename,
          saveAs: false
        });
      });
    });

    container.appendChild(btn);
  }

  // Eerste poging na load
  window.addEventListener('load', addButtonIfPossible);

  // En voor SPA/Ajax veranderingen
  const observer = new MutationObserver(addButtonIfPossible);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
