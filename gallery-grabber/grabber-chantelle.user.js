// ==UserScript==
// @name         Gallery Grabber | Chantelle
// @version      1.0
// @description  Download alle afbeeldingen uit de Chantelle B2B/PDP fotogallery (#photoContainer)
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/ccrz__ProductDetails*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-chantelle.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-chantelle-download-btn';

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ Chantelle grabber';
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

    btn.addEventListener('click', async () => {
      try {
        await downloadChantelle();
      } catch (e) {
        console.error(e);
        alert('Chantelle grabber error: ' + (e?.message || e));
      }
    });

    document.body.appendChild(btn);
  }

  // ---------- Helpers ----------
  function normalizeUrl(url) {
    if (!url) return '';
    let u = String(url).trim();

    // protocol-relative -> https
    if (u.startsWith('//')) u = 'https:' + u;

    // unescape basic html entities if they ever come through as text
    u = u.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

    return u;
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
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]/g, '');
  }

  function fileBase(url) {
    const clean = (url || '').split('?')[0];
    return clean.split('/').pop() || 'image.jpg';
  }

  function guessProductCodeFromUrl(url) {
    // Chantelle voorbeelden:
    // .../C010PF-011_S_SLASH_PACK_WEB_OB_PS1.jpg  -> C010PF-011
    // .../C010PF-011_B75_SLASH_ECOM_CROP_WEB_WH_FT.jpg -> C010PF-011
    const clean = (url || '').split('?')[0];
    const file = clean.split('/').pop() || '';
    const m = file.match(/^([A-Z0-9]+-[A-Z0-9]+)_/i);
    return m ? safeSlug(m[1]) : '';
  }

  function guessProductCode(items) {
    for (const it of items) {
      const code = guessProductCodeFromUrl(it.url);
      if (code) return code;
    }
    // fallback: laatste stuk pathname
    const pathSlug = safeSlug(location.pathname.split('/').filter(Boolean).pop() || '');
    return pathSlug || 'product';
  }

  // ---------- Chantelle ----------
  async function downloadChantelle() {
    const container =
      document.querySelector('#photoContainer') ||
      document.querySelector('.cc_product_detail_photo_container');

    if (!container) {
      alert('Geen Chantelle photoContainer gevonden op deze pagina.');
      return;
    }

    const collected = [];

    // Main image
    const mainImg =
      container.querySelector('.cc_main_prod_image img.mainProdImage') ||
      container.querySelector('.cc_main_prod_image img') ||
      container.querySelector('img.mainProdImage');

    if (mainImg) {
      const url = normalizeUrl(mainImg.getAttribute('src') || mainImg.getAttribute('data-id'));
      if (url) collected.push({ url });
    }

    // Alternates (jouw snippet heeft data-id met full url)
    const alternates = Array.from(
      container.querySelectorAll('img.cc_alternate, img.alternate, img.thumbnail')
    );

    alternates.forEach((img) => {
      const url = normalizeUrl(img.getAttribute('data-id') || img.getAttribute('src'));
      if (url) collected.push({ url });
    });

    let items = uniqByUrl(collected);

    if (!items.length) {
      alert('Geen Chantelle afbeeldingen gevonden in de gallery.');
      return;
    }

    const productCode = guessProductCode(items);

    items.forEach((it, idx) => {
      const base = fileBase(it.url);
      const filename = `chantelle_${productCode}_${idx + 1}_${base}`;
      GM_download({ url: it.url, name: filename, saveAs: false });
    });
  }

  // init
  window.addEventListener('load', ensureButton);

  // Keep button alive on SPA-ish pages
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
