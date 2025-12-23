// ==UserScript==
// @name         Gallery Grabber | Naturana
// @version      1.2
// @description  Download alle afbeeldingen (B2B ArticleView + naturana.com product gallery)
// @match        https://naturana-online.de/naturana/ArticleView*
// @match        https://naturana.com/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-naturana.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-naturana-download-btn';

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ Naturana grabber';
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

    btn.addEventListener('mouseover', () => (btn.style.background = 'rgba(0,0,0,0.9)'));
    btn.addEventListener('mouseout', () => (btn.style.background = 'rgba(0,0,0,0.75)'));

    btn.addEventListener('click', () => {
      const host = location.hostname.replace(/^www\./, '').toLowerCase();

      if (host === 'naturana-online.de') {
        downloadNaturanaB2B();
        return;
      }
      if (host === 'naturana.com') {
        downloadNaturanaShopify();
        return;
      }

      alert('Onbekende Naturana host voor deze grabber.');
    });

    document.body.appendChild(btn);
  }

  // ---------- Helpers ----------
  function normalizeUrl(url) {
    if (!url) return '';
    let u = url.trim();

    // protocol-relative -> https
    if (u.startsWith('//')) u = 'https:' + u;

    return u;
  }

  function uniqByUrl(items) {
    const seen = new Set();
    return items.filter(it => {
      const key = it.url;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function safeSlug(s) {
    return (s || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]/g, '');
  }

  // ---------- naturana-online.de (B2B ArticleView) ----------
  function downloadNaturanaB2B() {
    const containers = document.querySelectorAll('div[id*="divArtSelectArticleImg_"].row');
    const images = [];

    containers.forEach(container => {
      const blocks = container.querySelectorAll('.art-color');
      blocks.forEach(block => {
        const img = block.querySelector('input[type="image"].img-fluid[src]');
        if (!img || !img.src) return;

        const url = normalizeUrl(img.src);
        const cleanUrl = url.split('?')[0];
        const urlFile = cleanUrl.split('/').pop() || 'image.jpg';

        const alt = (img.alt || '').trim();
        const colorNo = (block.querySelector('.art-color-no')?.textContent || '').trim();

        const articleMatch =
          cleanUrl.match(/(\d{3,6})[_\.]/) ||
          cleanUrl.match(/NATURANA_(\d{3,6})/i);

        const articlePart = articleMatch ? articleMatch[1] : 'article';
        const altPart = safeSlug(alt);
        const colorPart = colorNo || 'color';

        const index = images.length + 1;
        const filename =
          `naturana_${articlePart}_${colorPart}` +
          (altPart ? `_${altPart}` : '') +
          `_${index}_${urlFile}`;

        images.push({ url, filename });
      });
    });

    const unique = uniqByUrl(images);

    if (!unique.length) {
      alert('Geen Naturana B2B kleur-afbeeldingen gevonden op deze pagina.');
      return;
    }

    unique.forEach(it => GM_download({ url: it.url, name: it.filename, saveAs: false }));
  }

  // ---------- naturana.com (Shopify product pages) ----------
  function downloadNaturanaShopify() {
    // Alleen downloaden als er een product-gallery is, anders niet “overal” op de site.
    const gallery = document.querySelector('product-gallery, .product-gallery');
    if (!gallery) {
      alert('Geen product gallery gevonden op deze pagina.');
      return;
    }

    const productSlug = safeSlug(location.pathname.split('/').filter(Boolean).pop() || 'product');

    const items = [];

    // IMAGES: pak voorkeur uit src (meestal al width=1800)
    const imgs = gallery.querySelectorAll('.product-gallery__media img[src], img[srcset]');
    imgs.forEach((img) => {
      let url = normalizeUrl(img.getAttribute('src') || '');
      if (!url && img.srcset) {
        // neem grootste uit srcset
        const parts = img.srcset.split(',').map(s => s.trim()).filter(Boolean);
        const last = parts[parts.length - 1] || '';
        url = normalizeUrl(last.split(' ')[0] || '');
      }
      if (!url) return;

      // Shopify: haal &width=... weg, maar laat ?v=... staan
      url = url.replace(/&width=\d+/g, '');

      const baseFile = (url.split('?')[0].split('/').pop() || 'image.jpg');
      const altPart = safeSlug(img.alt || '');

      items.push({
        url,
        filename: `naturana_${productSlug}${altPart ? '_' + altPart : ''}_${items.length + 1}_${baseFile}`
      });
    });

    // VIDEOS: pak <source src="...mp4">
    const sources = gallery.querySelectorAll('.product-gallery__media video source[src]');
    sources.forEach((srcEl) => {
      let url = normalizeUrl(srcEl.getAttribute('src') || '');
      if (!url) return;

      const baseFile = (url.split('?')[0].split('/').pop() || `video_${items.length + 1}.mp4`);

      items.push({
        url,
        filename: `naturana_${productSlug}_${items.length + 1}_${baseFile}`
      });
    });

    const unique = uniqByUrl(items);

    if (!unique.length) {
      alert('Geen naturana.com media gevonden in de gallery.');
      return;
    }

    unique.forEach(it => GM_download({ url: it.url, name: it.filename, saveAs: false }));
  }

  // init
  window.addEventListener('load', ensureButton);

  // Licht observeren: alleen knop, geen page-breaks
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
