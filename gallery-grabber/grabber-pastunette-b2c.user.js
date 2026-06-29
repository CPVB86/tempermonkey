// ==UserScript==
// @name         Gallery Grabber | Pastunette B2C
// @version      1.2
// @description  Download alleen de PDP-afbeeldingen van Pastunette B2C
// @match        https://pastunette.com/*/products/*
// @match        https://www.pastunette.com/*/products/*
// @match        https://pastunette.com/products/*
// @match        https://www.pastunette.com/products/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-pastunette-b2c.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-pastunette-b2c.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-pastunette-download-btn';
  const LOG_PREFIX = '[Pastunette Grabber v1.2]';

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
      if (!url) return '';
      if (url.startsWith('//')) return 'https:' + url;
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

  function extractBalancedObject(text, startIndex) {
    const firstBrace = text.indexOf('{', startIndex);
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === stringQuote) {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }

      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) {
        return text.slice(firstBrace, i + 1);
      }
    }

    return null;
  }

  function getProductData() {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.tfProduct) {
      return unsafeWindow.tfProduct;
    }

    if (window.tfProduct) {
      return window.tfProduct;
    }

    const scripts = Array.from(document.querySelectorAll('script'));

    for (const script of scripts) {
      const text = script.textContent || '';
      const idx = text.indexOf('window.tfProduct =');

      if (idx === -1) continue;

      const jsonLike = extractBalancedObject(text, idx);
      if (!jsonLike) continue;

      try {
        return JSON.parse(jsonLike);
      } catch (err) {
        console.error(LOG_PREFIX, 'tfProduct parse fout:', err);
      }
    }

    return null;
  }

  function getGalleryImages() {
    const product = getProductData();

    if (!product) {
      log('Geen tfProduct gevonden');
      return [];
    }

    if (Array.isArray(product.media) && product.media.length) {
      return uniqByUrl(
        product.media
          .filter(media => media.media_type === 'image' && media.src)
          .map((media, index) => ({
            index,
            url: toAbsoluteUrl(media.src),
            alt: media.alt || product.title || ''
          }))
      );
    }

    if (Array.isArray(product.images) && product.images.length) {
      return uniqByUrl(
        product.images.map((url, index) => ({
          index,
          url: toAbsoluteUrl(url),
          alt: product.title || ''
        }))
      );
    }

    return [];
  }

  function guessProductCode(items) {
    const product = getProductData();

    const sku = product?.variants?.[0]?.sku;
    if (sku) {
      return safeSlug(String(sku).replace(/-\d+$/i, ''));
    }

    const firstUrl = items[0]?.url || '';
    const file = firstUrl.split('/').pop()?.split('?')[0] || '';
    const base = file.replace(/\.(webp|jpg|jpeg|png)$/i, '');

    return safeSlug(base) || 'pastunette-product';
  }

  function getExtensionFromUrl(url) {
    const clean = String(url || '').split('?')[0];
    const m = clean.match(/\.(webp|jpg|jpeg|png)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  }

  function guessFilename(item, index, productCode) {
    const ext = getExtensionFromUrl(item.url);
    const file = item.url.split('/').pop()?.split('?')[0] || '';
    const base = file.replace(/\.(webp|jpg|jpeg|png)$/i, '');

    if (base) {
      return `pastunette_${safeSlug(base)}.${ext}`;
    }

    return `pastunette_${productCode}_${String(index + 1).padStart(2, '0')}.${ext}`;
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

  async function downloadPastunetteGallery() {
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
      triggerDownload(item.url, guessFilename(item, index, productCode));
    });

    setButtonText(`✅ ${items.length} downloads`);
    setTimeout(() => setButtonText('⬇️ Pastunette grabber v1.2'), 2500);
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⬇️ Pastunette grabber v1.2';

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
        await downloadPastunetteGallery();
      } catch (err) {
        console.error(LOG_PREFIX, err);
        setButtonText('❌ Error');
        alert('Pastunette grabber error: ' + (err?.message || err));
      }
    }, true);

    document.body.appendChild(btn);
  }

  window.addEventListener('load', ensureButton);
  window.addEventListener('pageshow', ensureButton);

  setTimeout(ensureButton, 500);
  setTimeout(ensureButton, 1500);
  setTimeout(ensureButton, 3000);
})();
