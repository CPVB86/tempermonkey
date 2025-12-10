// ==UserScript==
// @name         Gallery Grabber | Naturana
// @version      1.1
// @description  Download alle kleur-afbeeldingen uit de Naturana artikelkleurenrij
// @match        https://naturana-online.de/naturana/ArticleView*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-naturana.user.js
// ==/UserScript==

(function () {
  'use strict';

  function ensureButton() {
    if (document.getElementById('ddo-naturana-download-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ddo-naturana-download-btn';
    btn.textContent = '⬇️ Naturana alle afbeeldingen/kleuren';
    btn.style.position = 'fixed';
    btn.style.top = '80px';
    btn.style.right = '10px';
    btn.style.zIndex = '99999';
    btn.style.padding = '6px 10px';
    btn.style.fontSize = '11px';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '12px';
    btn.style.border = 'none';
    btn.style.background = 'rgba(0,0,0,0.75)';
    btn.style.color = 'yellow';
    btn.style.fontFamily = 'inherit';
    btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';

    btn.addEventListener('mouseover', () => {
      btn.style.background = 'rgba(0,0,0,0.9)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'rgba(0,0,0,0.75)';
    });

    btn.addEventListener('click', downloadAllNaturanaImages);

    document.body.appendChild(btn);
  }

  function downloadAllNaturanaImages() {
    // Alle containers met kleurselectie-rijen
    const containers = document.querySelectorAll(
      'div[id*="divArtSelectArticleImg_"].row'
    );

    const images = [];

    containers.forEach(container => {
      const blocks = container.querySelectorAll('.art-color');
      blocks.forEach(block => {
        const img = block.querySelector('input[type="image"].img-fluid[src]');
        if (!img || !img.src) return;

        const url = img.src;
        const cleanUrl = url.split('?')[0];
        const urlFile = cleanUrl.split('/').pop() || 'image.jpg';

        const alt = (img.alt || '').trim();
        const colorNo = (block.querySelector('.art-color-no')?.textContent || '').trim();

        // Artikelnummer uit URL halen (bijv. NATURANA_0163_211_product01_AW25.jpg of 0163_300.jpg)
        const articleMatch =
          cleanUrl.match(/(\d{3,6})[_\.]/) || // 0163_211...
          cleanUrl.match(/NATURANA_(\d{3,6})/i); // NATURANA_0163...

        const articlePart = articleMatch ? articleMatch[1] : 'article';
        const altPart = alt
          ? alt.replace(/\s+/g, '-').replace(/[^\w\-]/g, '')
          : '';
        const colorPart = colorNo || 'color';

        const index = images.length + 1;
        const filename =
          `naturana_${articlePart}_${colorPart}` +
          (altPart ? `_${altPart}` : '') +
          `_${index}_${urlFile}`;

        images.push({ url, filename });
      });
    });

    if (!images.length) {
      alert('Geen Naturana kleur-afbeeldingen gevonden op deze pagina.');
      return;
    }

    images.forEach(img => {
      GM_download({
        url: img.url,
        name: img.filename,
        saveAs: false
      });
    });
  }

  // Eerste poging
  window.addEventListener('load', ensureButton);

  // Voor AJAX / postbacks: zorg dat de knop er blijft, maar maak geen nieuwe
  const observer = new MutationObserver(() => {
    ensureButton();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
