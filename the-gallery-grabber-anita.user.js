// ==UserScript==
// @name         🧙‍♂️ The Gallery Grabber – Anita
// @version      2.4
// @description  wnload RGB Medium images from filtered gallery view, triggered by button or redirect if filters not active
// @match        https://b2b.anita.com/nl/zoeken*
// @grant        GM_download
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/the-gallery-grabber-anita.user.js
// ==/UserScript==

(function () {
  'use strict';

  const currentUrl = new URL(window.location.href);
  const searchParam = currentUrl.searchParams.get('tx_solr[q]');
  const hasFilters = currentUrl.search.includes('filter') && currentUrl.search.includes('colorSpace') && currentUrl.search.includes('imageSize');

  function createRedirectButton() {
    if (document.getElementById('galleryFilterRedirect')) return;

    const btn = document.createElement('button');
    btn.id = 'galleryFilterRedirect';
    btn.innerText = '🧙‍ Voeg filters toe';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '9999',
      padding: '10px 14px',
      background: '#f39c12',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    });
    btn.onclick = () => {
      const base = 'https://b2b.anita.com/nl/zoeken';
      const filteredUrl = `${base}?tx_solr[filter][0]=type%3Asys_file_metadata&tx_solr[filter][1]=colorSpace%3ARGB&tx_solr[filter][2]=imageSize%3AMedium&tx_solr[q]=${encodeURIComponent(searchParam || '')}`;
      window.location.href = filteredUrl;
    };
    document.body.appendChild(btn);
  }

  function createDownloadButton() {
    if (document.getElementById('galleryGrabberButton')) return;

    const btn = document.createElement('button');
    btn.id = 'galleryGrabberButton';
    btn.innerText = '🧙‍ Download afbeeldingen';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '9999',
      padding: '10px 14px',
      background: '#4CAF50',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    });
    btn.onclick = downloadImages;
    document.body.appendChild(btn);
  }

  function downloadImages() {
    console.log('[Gallery Grabber] 🔍 Start met zoeken naar afbeeldingen...');

    const entries = [...document.querySelectorAll('.results-entry')];
    const filtered = entries.filter(entry => {
      const text = entry.innerText;
      return text.includes('Bestandstype: image/jpeg') &&
             text.includes('Colorspace: RGB') &&
             text.includes('Size:');
    });

    if (filtered.length === 0) {
      console.log('[Gallery Grabber] ❌ Geen geschikte resultaten gevonden.');
      alert('Geen geschikte downloads gevonden op deze pagina.');
      return;
    }

    console.log(`[Gallery Grabber] ✅ ${filtered.length} geschikte downloads gevonden.`);

    const baseName = (() => {
      const match = document.body.innerText.match(/\b(\d{4})[_-](\d{3})\b/);
      return match ? `${match[1]}-${match[2]}` : 'image';
    })();

    filtered.forEach((entry, i) => {
      const a = entry.querySelector('a[download]');
      if (!a || !a.href) return;

      const fullURL = new URL(a.href, location.origin).href;
      const filename = `${baseName}_${i + 1}.jpg`;

      GM_download({
        url: fullURL,
        name: filename,
        saveAs: false,
        onerror: (e) => console.warn(`[Gallery Grabber] ❌ Download mislukt voor ${filename}`, e),
      });
    });

    console.log('[Gallery Grabber] 🚀 Downloads gestart.');
  }

  function observeResultsAndInjectButton() {
    const observer = new MutationObserver(() => {
      const entries = document.querySelectorAll('.results-entry');
      if (entries.length > 0) {
        observer.disconnect();
        createDownloadButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // fallback timer
    setTimeout(() => {
      const entries = document.querySelectorAll('.results-entry');
      if (entries.length > 0 && !document.getElementById('galleryGrabberButton')) {
        createDownloadButton();
      }
    }, 1000);
  }

  if (hasFilters) {
    observeResultsAndInjectButton();
  } else {
    window.addEventListener('load', createRedirectButton);
  }
})();
