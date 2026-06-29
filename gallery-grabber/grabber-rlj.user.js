// ==UserScript==
// @name         Gallery Grabber | RLJ
// @version      1.0
// @description  Download alle PDP-afbeeldingen van Royal Lounge in original resolutie
// @match        https://royal-lounge.eu/*
// @match        https://www.royal-lounge.eu/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-rlj.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-rlj.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-rlj-download-btn';
  const LOG_PREFIX = '[RLJ Grabber v1.0]';

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function setButtonText(text) {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.textContent = text;
  }

  function safeSlug(value) {
    return String(value || '')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, location.origin).href;
    } catch {
      return '';
    }
  }

  function uniqByUrl(items) {
    const seen = new Set();

    return items.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  function upgradeRljUrl(url) {
    if (!url) return '';

    const abs = toAbsoluteUrl(url);

    // Thumbnail:
    // /pictures/String-Fit-Farbe-Scarlet-Red_181_01.webp
    //
    // Original:
    // /pictures/original/String-Fit-Farbe-Scarlet-Red_181_01.webp
    if (abs.includes('/pictures/original/')) return abs;

    return abs.replace('/pictures/', '/pictures/original/');
  }

  function getGalleryImages() {
    const root = document.querySelector('#detail_image') || document;

    const selectors = [
      '#detail_image .art_detail_bild img[src*="/pictures/original/"]',
      '#detail_image img[data-elem="bg"]',
      '#detail_image .thumbs img[src*="/pictures/"]',
      '#detail_image img[src*="/pictures/"]'
    ];

    const imgs = Array.from(root.querySelectorAll(selectors.join(', ')));
    log('gevonden <img> nodes:', imgs.length);

    const items = imgs
      .map((img, index) => ({
        index,
        url: upgradeRljUrl(img.getAttribute('src') || ''),
        alt: img.getAttribute('alt') || '',
        title: img.getAttribute('title') || ''
      }))
      .filter(item => item.url);

    return uniqByUrl(items);
  }

  function guessProductCode(items) {
    const firstUrl = items[0]?.url || '';
    const file = firstUrl.split('/').pop()?.split('?')[0] || '';
    const base = file.replace(/\.(webp|jpg|jpeg|png)$/i, '');

    // String-Fit-Farbe-Scarlet-Red_181_01 → String-Fit-Farbe-Scarlet-Red_181
    const withoutImageNumber = base.replace(/_\d+$/i, '');

    return safeSlug(withoutImageNumber) || 'rlj-product';
  }

  function getExtensionFromUrl(url) {
    const clean = String(url || '').split('?')[0];
    const m = clean.match(/\.(webp|jpg|jpeg|png)$/i);

    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'webp';
  }

  function guessFilename(item, index, productCode) {
    const ext = getExtensionFromUrl(item.url);
    return `rlj_${productCode}_${String(index + 1).padStart(2, '0')}.${ext}`;
  }

  function triggerDownload(url, filename) {
    log('download:', filename, url);

    if (typeof GM_download === 'function') {
      GM_download({
        url,
        name: filename,
        saveAs: false,
        onerror: (err) => {
          console.error(LOG_PREFIX, 'GM_download fout:', err);
          alert('Download mislukt voor: ' + filename);
        }
      });
      return;
    }

    alert('GM_download is niet beschikbaar.');
  }

  async function downloadRljGallery() {
    setButtonText('⏳ Scannen...');

    const items = getGalleryImages();
    log('gevonden afbeeldingen:', items);

    if (!items.length) {
      setButtonText('⚠️ Niets gevonden');
      alert('Geen gallery-afbeeldingen gevonden.');
      return;
    }

    const productCode = guessProductCode(items);

    items.forEach((item, index) => {
      const filename = guessFilename(item, index, productCode);
      triggerDownload(item.url, filename);
    });

    setButtonText(`✅ ${items.length} downloads`);
    setTimeout(() => setButtonText('⬇️ RLJ grabber v1.0'), 2500);
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⬇️ RLJ grabber v1.0';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '80px',
      right: '10px',
      zIndex: '2147483647',
      padding: '8px 12px',
      fontSize: '12px',
      lineHeight: '1.2',
      cursor: 'pointer',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(0,0,0,0.85)',
      color: '#ffeb3b',
      fontFamily: 'inherit',
      boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        await downloadRljGallery();
      } catch (err) {
        console.error(LOG_PREFIX, err);
        setButtonText('❌ Error');
        alert('RLJ grabber error: ' + (err?.message || err));
      }
    }, true);

    document.body.appendChild(btn);
    log('button geplaatst');
  }

  function init() {
    ensureButton();
  }

  window.addEventListener('load', init);
  window.addEventListener('pageshow', init);

  setTimeout(init, 500);
  setTimeout(init, 1500);
  setTimeout(init, 3000);

  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
