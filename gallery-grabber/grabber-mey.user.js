// ==UserScript==
// @name         Gallery Grabber | Mey
// @version      1.0
// @description  Download alle afbeeldingen uit de Mey B2B gallery (MediaView met background-image)
// @match        https://*.meyb2b.com/*
// @match        https://meyb2b.com/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-mey.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-mey-download-btn';

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = '⬇️ Mey grabber';
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
        await downloadMeyB2B();
      } catch (e) {
        console.error(e);
        alert('Mey grabber error: ' + (e?.message || e));
      }
    });

    document.body.appendChild(btn);
  }

  // ---------- Helpers ----------
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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

  function extractBgUrl(el) {
    if (!el) return '';
    // Prefer inline style, fallback to computed.
    const bg = el.style?.backgroundImage || getComputedStyle(el).backgroundImage || '';
    // bg looks like: url("https://...jpg?width=1000&height=1500&ts=...")
    const m = bg.match(/url\((['"]?)(.*?)\1\)/i);
    return normalizeUrl(m ? m[2] : '');
  }

  // Optional: bump width/height if present (keep ts)
  function bumpSize(url, w = 2000, h = 3000) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.searchParams.has('width')) u.searchParams.set('width', String(w));
      if (u.searchParams.has('height')) u.searchParams.set('height', String(h));
      return u.toString();
    } catch {
      // if URL() fails, just return original
      return url;
    }
  }

  function guessProductCodeFromUrl(url) {
    // Example: https://media.meyb2b.com/images/D/1230081-1718.jpg?... -> 1230081-1718
    const clean = (url || '').split('?')[0];
    const file = clean.split('/').pop() || '';
    const base = file.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    return safeSlug(base) || 'product';
  }

  // ---------- Mey B2B ----------
  async function downloadMeyB2B() {
    const mediaView = document.querySelector('.features-articledetail-MediaView');
    if (!mediaView) {
      alert('Geen Mey MediaView gevonden op deze pagina.');
      return;
    }

    // 1) Verzamel wat al zichtbaar is
    const collected = collectAllBgImages(mediaView);

    // 2) Klik door alle dots om eventueel lazy images te forceren, en capture telkens main image
    const dots = Array.from(mediaView.querySelectorAll('.paginationDots .dot'));
    if (dots.length) {
      for (let i = 0; i < dots.length; i++) {
        dots[i].click();
        await sleep(350);

        // Main image: meestal .detailImageContainer .image
        const main = mediaView.querySelector('.detailImageContainer .image');
        const mainUrl = extractBgUrl(main);
        if (mainUrl) collected.push({ url: mainUrl });
      }
    }

    // 3) Nog 1x sweep na klikken (soms worden thumbs/DOM nodes toegevoegd)
    collectAllBgImages(mediaView).forEach((it) => collected.push(it));

    // 4) Normaliseer, bump size, filenames
    let items = collected
      .map((it) => {
        const url0 = normalizeUrl(it.url);
        if (!url0) return null;

        const url = bumpSize(url0, 2000, 3000);
        const baseFile = (url.split('?')[0].split('/').pop() || 'image.jpg');

        return { url, baseFile };
      })
      .filter(Boolean);

    items = uniqByUrl(items);

    if (!items.length) {
      alert('Geen Mey afbeeldingen gevonden in de gallery.');
      return;
    }

    // Product slug
    const productCode = guessProductCodeFromUrl(items[0].url) || safeSlug(location.pathname) || 'product';

    // 5) Download
    items.forEach((it, idx) => {
      const filename = `mey_${productCode}_${idx + 1}_${it.baseFile}`;
      GM_download({ url: it.url, name: filename, saveAs: false });
    });
  }

  function collectAllBgImages(root) {
    const out = [];

    // Alle .image nodes (thumbs + main) met background-image
    const imgs = root.querySelectorAll('.image');
    imgs.forEach((el) => {
      const url = extractBgUrl(el);
      if (url) out.push({ url });
    });

    // Soms zitten urls ook op containers
    const containers = root.querySelectorAll('[style*="background-image"]');
    containers.forEach((el) => {
      const url = extractBgUrl(el);
      if (url) out.push({ url });
    });

    return out;
  }

  // init
  window.addEventListener('load', ensureButton);

  // Keep button alive on SPA-ish pages
  const observer = new MutationObserver(() => ensureButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
