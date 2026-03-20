// ==UserScript==
// @name         Gallery Grabber | Sapph
// @version      1.1
// @description  Download alle afbeeldingen uit de Sapph productgallery
// @match        https://www.sapph.com/*
// @match        https://sapph.com/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/grabber/sapph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/grabber/sapph.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-sapph-download-btn';

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ Sapph grabber';
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
    btn.style.color = '#ff8cc6';
    btn.style.fontFamily = 'inherit';
    btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';

    btn.addEventListener('mouseover', () => (btn.style.background = 'rgba(0,0,0,0.9)'));
    btn.addEventListener('mouseout', () => (btn.style.background = 'rgba(0,0,0,0.75)'));

    btn.addEventListener('click', async () => {
      try {
        await downloadSapph();
      } catch (e) {
        console.error(e);
        alert('Sapph grabber error: ' + (e?.message || e));
      }
    });

    document.body.appendChild(btn);
  }

  function normalizeUrl(url) {
    if (!url) return '';
    let u = String(url).trim();

    if (u.startsWith('//')) u = 'https:' + u;
    u = u.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

    return u;
  }

  function toBestShopifyImage(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return '';

    try {
      const parsed = new URL(normalized);
      parsed.searchParams.delete('width');
      return parsed.toString();
    } catch {
      return normalized
        .replace(/([?&])width=\d+(&)?/i, (match, p1, p2) => {
          if (p1 === '?' && !p2) return '';
          if (p1 === '?' && p2) return '?';
          return '';
        })
        .replace(/[?&]$/, '');
    }
  }

  function uniqByUrl(items) {
    const seen = new Set();
    return items.filter((it) => {
      const key = it.url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function safeSlug(s) {
    return (s || '')
      .trim()
      .replace(/[^\w\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function getBaseSku() {
    const skuEl = document.querySelector('variant-sku');
    if (!skuEl) return 'product';

    const raw = (skuEl.textContent || '').trim();
    // verwacht iets als: "SKU: 239815-1067-532-E-90"
    const sku = raw.replace(/^SKU:\s*/i, '').trim();
    if (!sku) return 'product';

    const parts = sku.split('-');
    if (parts.length >= 3) {
      return safeSlug(parts.slice(0, 3).join('-'));
    }

    return safeSlug(sku);
  }

  async function downloadSapph() {
    const gallery =
      document.querySelector('.product-gallery__image-list') ||
      document.querySelector('scroll-carousel.product-gallery__carousel') ||
      document.querySelector('.product-gallery__carousel');

    if (!gallery) {
      alert('Geen Sapph productgallery gevonden op deze pagina.');
      return;
    }

    const collected = [];

    const imageNodes = gallery.querySelectorAll(
      '.product-gallery__media[data-media-type="image"] img'
    );

    imageNodes.forEach((img) => {
      const raw = img.getAttribute('src') || img.currentSrc || '';
      const url = toBestShopifyImage(raw);
      if (url) collected.push({ url });
    });

    if (!collected.length) {
      const fallbackNodes = gallery.querySelectorAll('.product-gallery__media img');
      fallbackNodes.forEach((img) => {
        const media = img.closest('.product-gallery__media');
        if (!media) return;
        if (media.getAttribute('data-media-type') !== 'image') return;

        const raw = img.getAttribute('src') || img.currentSrc || '';
        const url = toBestShopifyImage(raw);
        if (url) collected.push({ url });
      });
    }

    let items = uniqByUrl(collected);

    items = items.filter((it) => {
      const url = it.url.toLowerCase();
      return !url.includes('/preview_images/') && !url.includes('.thumbnail.');
    });

    if (!items.length) {
      alert('Geen Sapph afbeeldingen gevonden in de gallery.');
      return;
    }

    const baseSku = getBaseSku();

    items.forEach((it, idx) => {
      const extMatch = it.url.split('?')[0].match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? extMatch[1] : 'jpg';
      const filename = `${baseSku}_${idx + 1}.${ext}`;

      GM_download({
        url: it.url,
        name: filename,
        saveAs: false
      });
    });
  }

  window.addEventListener('load', ensureButton);

  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
