// ==UserScript==
// @name         Gallery Grabber | Chantelle B2C
// @version      2.3
// @description  Download alle PDP-afbeeldingen van chantelle.com in de hoogste srcset-resolutie (3840)
// @match        https://www.chantelle.com/*
// @match        https://chantelle.com/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. BeekBeek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-chantelle-b2c.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-chantelle-b2c.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-chantelle-v2-download-btn';
  const LOG_PREFIX = '[Chantelle Grabber v2.3]';

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
      .replace(/\s+/g, '-');
  }

  function uniqByUrl(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, location.origin).href;
    } catch {
      return '';
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];

    return srcset
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const bits = part.split(/\s+/);
        const url = bits[0];
        const descriptor = bits[1] || '';
        const widthMatch = descriptor.match(/^(\d+)w$/i);
        return {
          url: toAbsoluteUrl(url),
          width: widthMatch ? parseInt(widthMatch[1], 10) : 0
        };
      })
      .filter(item => item.url);
  }

  function getHighestSrcsetUrl(img) {
    if (!img) return '';

    const srcset = img.getAttribute('srcset') || '';
    const parsed = parseSrcset(srcset);

    if (parsed.length) {
      parsed.sort((a, b) => b.width - a.width);
      return parsed[0].url;
    }

    const src = img.getAttribute('src');
    if (src) return toAbsoluteUrl(src);

    return '';
  }

  function getGalleryRoot() {
    return (
      document.querySelector('.pdp__product-cover-wrapper') ||
      document.querySelector('[data-testid="ProductCover"]') ||
      document.querySelector('.product-cover__grid') ||
      document
    );
  }

  function getGalleryImages() {
    const root = getGalleryRoot();

    const selectors = [
      '.product-cover__asset img',
      '[data-testid^="ProductCover__image-"] img',
      'img[data-testid="Asset__image"]',
      '.pdp__product-cover-wrapper img'
    ];

    const imgs = Array.from(root.querySelectorAll(selectors.join(', ')));
    log('gevonden <img> nodes:', imgs.length);

    const items = imgs.map((img, index) => ({
      index,
      url: getHighestSrcsetUrl(img),
      alt: img.getAttribute('alt') || '',
      srcset: img.getAttribute('srcset') || ''
    })).filter(item => item.url);

    return uniqByUrl(items);
  }

  function guessProductCode(items) {
    for (const item of items) {
      const m = String(item.alt || '').match(/^([A-Z0-9]+-[A-Z0-9]+)/i);
      if (m) return safeSlug(m[1]);
    }

    const skuEl = document.querySelector('[sku]');
    if (skuEl) {
      const sku = skuEl.getAttribute('sku');
      if (sku) return safeSlug(sku);
    }

    const tail = location.pathname.split('/').filter(Boolean).pop() || 'product';
    return safeSlug(tail);
  }

  function guessFilename(item, index, productCode) {
    const alt = String(item.alt || '').trim();

    if (alt) {
      return `${safeSlug(alt)}.jpg`;
    }

    return `${productCode}_${String(index + 1).padStart(2, '0')}.jpg`;
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

  async function downloadChantelleGallery() {
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
    setTimeout(() => setButtonText('⬇️ Chantelle grabber v2.3'), 2500);
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⬇️ Chantelle grabber v2.3';

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
        await downloadChantelleGallery();
      } catch (err) {
        console.error(LOG_PREFIX, err);
        setButtonText('❌ Error');
        alert('Chantelle grabber error: ' + (err?.message || err));
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
