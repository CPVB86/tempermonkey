// ==UserScript==
// @name         Gallery Grabber | HOM
// @version      1.0
// @description  Download alle gallery-afbeeldingen van hom.com productpagina's
// @match        https://www.hom.com/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-hom.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-hom.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-hom-download-btn';

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ HOM grabber';
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

    btn.addEventListener('click', () => downloadHom());

    document.body.appendChild(btn);
  }

  // ---------- Helpers ----------
  function normalizeUrl(url) {
    if (!url) return '';
    let u = String(url).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    return u;
  }

  function safeSlug(s) {
    return (s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]/g, '');
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

  function stripMagentoCache(url) {
    // Voorbeeld:
    // /media/catalog/product/cache/<hash>/t/i/file.jpg  -> /media/catalog/product/t/i/file.jpg
    // We proberen cache eruit te halen voor “origin” file.
    try {
      const u = new URL(url, location.origin);
      u.search = ''; // weg met tracking
      u.hash = '';

      u.pathname = u.pathname.replace(/\/media\/catalog\/product\/cache\/[^/]+\//, '/media/catalog/product/');
      return u.toString();
    } catch (e) {
      return url.split('?')[0];
    }
  }

  function findProductSlug() {
    // meestal: /product/slug of /something/slug
    const parts = location.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || 'product';
    return safeSlug(last);
  }

  function guessSku() {
    // Soms staat SKU in DOM; we proberen een paar veelvoorkomende plekken (veilig: als niet gevonden, leeg).
    const candidates = [
      '[data-product-sku]',
      '[itemprop="sku"]',
      '.product.attribute.sku .value',
      '.product-sku',
      '.sku'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const val = (el.getAttribute('data-product-sku') || el.textContent || '').trim();
      if (val && val.length >= 3) return safeSlug(val);
    }
    return '';
  }

  // ---------- HOM ----------
  function downloadHom() {
    // Alleen op productpagina's met thumbnails (zoals jouw snippet)
    const thumbsRoot = document.querySelector('.product-view-thumbnails');
    if (!thumbsRoot) {
      alert('Geen HOM thumbnails gevonden op deze pagina.');
      return;
    }

    const slug = findProductSlug();
    const sku = guessSku();
    const prefix = `hom_${sku ? sku + '_' : ''}${slug || 'product'}`;

    const items = [];

    // Pak alle <img> in de thumbnail rail
    const imgs = thumbsRoot.querySelectorAll('img[data-src], img[src], source[srcset]');
    imgs.forEach((el) => {
      let url = '';

      if (el.tagName.toLowerCase() === 'source') {
        // <source srcset="...">
        url = normalizeUrl(el.getAttribute('srcset') || '');
      } else {
        url = normalizeUrl(el.getAttribute('data-src') || el.getAttribute('src') || '');
      }

      if (!url) return;

      // Sommige src's zijn placeholders (data:image/svg+xml...)
      if (url.startsWith('data:image')) return;

      // Probeer “uncached” versie te pakken
      const clean = stripMagentoCache(url);

      const baseFile = (clean.split('?')[0].split('/').pop() || 'image.jpg');
      const alt = safeSlug(el.getAttribute('alt') || '');

      items.push({
        url: clean,
        filename: `${prefix}${alt ? '_' + alt : ''}_${items.length + 1}_${baseFile}`
      });
    });

    // Dedupe
    const unique = uniqByUrl(items);

    if (!unique.length) {
      alert('Geen HOM media gevonden in de thumbnails.');
      return;
    }

    unique.forEach(it => GM_download({ url: it.url, name: it.filename, saveAs: false }));
  }

  // init
  window.addEventListener('load', ensureButton);

  // observer zodat knop blijft bij SPA/late loads
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
