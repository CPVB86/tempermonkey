// ==UserScript==
// @name         Gallery Grabber | Van de Velde
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.0
// @description  Download alle productafbeeldingen van Van de Velde in originele Contentful-resolutie
// @match        https://*.vandeveldeservice.com/*
// @match        https://*.vandevelde.eu/*
// @run-at       document-idle
// @grant        GM_download
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-vandevelde.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/gallery-grabber/grabber-vandevelde.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ddo-vandevelde-download-btn';
  const LOG_PREFIX = '[Van de Velde Grabber]';

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeSlug(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '');
  }

  /**
   * Haalt bijvoorbeeld 0163380CRP uit:
   * /nl/p/0163380CRP
   */
 function getProductCode() {
    const match = window.location.pathname.match(/\/p\/([^\/?#]+)/i);
    if (match) {
        return match[1].trim().toUpperCase();
    }

    return '';
}

  function normalizeUrl(url) {
    if (!url) return '';

    let normalized = String(url)
      .trim()
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

    if (normalized.startsWith('//')) {
      normalized = `https:${normalized}`;
    }

    try {
      return new URL(normalized, window.location.href).href;
    } catch {
      return '';
    }
  }

  /**
   * Contentful levert bijvoorbeeld:
   * foto.jpg?h=500&w=500&fit=fill
   *
   * Zonder querystring krijgen we het originele bestand.
   */
  function getOriginalContentfulUrl(url) {
    const normalized = normalizeUrl(url);

    if (!normalized) return '';

    try {
      const parsed = new URL(normalized);

      if (parsed.hostname === 'images.ctfassets.net') {
        parsed.search = '';
        parsed.hash = '';
      }

      return parsed.href;
    } catch {
      return normalized;
    }
  }

  function getLargestSrcsetUrl(srcset) {
    if (!srcset) return '';

    const candidates = String(srcset)
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) => {
        const parts = candidate.split(/\s+/);
        const url = parts[0];
        const descriptor = parts[1] || '';

        let width = 0;

        if (descriptor.endsWith('w')) {
          width = Number.parseInt(descriptor, 10) || 0;
        }

        return {
          url,
          width
        };
      })
      .filter((candidate) => candidate.url);

    candidates.sort((a, b) => b.width - a.width);

    return candidates[0]?.url || '';
  }

  function getImageUrl(img) {
    const srcsetUrl = getLargestSrcsetUrl(
      img.getAttribute('srcset') ||
      img.getAttribute('data-srcset')
    );

    const sourceUrl =
      srcsetUrl ||
      img.getAttribute('data-src') ||
      img.currentSrc ||
      img.getAttribute('src');

    return getOriginalContentfulUrl(sourceUrl);
  }

  function uniqByUrl(items) {
    const seen = new Set();

    return items.filter((item) => {
      if (!item.url || seen.has(item.url)) {
        return false;
      }

      seen.add(item.url);
      return true;
    });
  }

  function getBrandPrefix(items) {
    const combinedText = [
      document.title,
      document.body?.innerText || '',
      ...items.map((item) => item.url)
    ]
      .join(' ')
      .toLowerCase();

    if (
      combinedText.includes('primadonna') ||
      combinedText.includes('prima-donna')
    ) {
      return 'primadonna';
    }

    if (
      combinedText.includes('mariejo') ||
      combinedText.includes('marie-jo') ||
      combinedText.includes('marie jo')
    ) {
      return 'mariejo';
    }

    if (
      combinedText.includes('sarda') ||
      combinedText.includes('andres-sarda') ||
      combinedText.includes('andres sarda')
    ) {
      return 'sarda';
    }

    return 'vandevelde';
  }

  function getExtension(url) {
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
      const extension = match?.[1]?.toLowerCase();

      if (['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(extension)) {
        return extension === 'jpeg' ? 'jpg' : extension;
      }
    } catch {
      // Gebruik jpg als fallback.
    }

    return 'jpg';
  }

  function findGallery() {
    return (
      document.querySelector('ul[aria-label="afbeeldingen bekijken"]') ||
      document.querySelector('ul[aria-label="view images"]') ||
      document.querySelector('ul[aria-label*="afbeelding" i]') ||
      document.querySelector('ul[aria-label*="image" i]')
    );
  }

  /**
   * De gallery gebruikt lazy loading.
   * Daarom bewegen we hem eerst horizontaal en verticaal naar het einde.
   */
  async function triggerLazyLoading(gallery) {
    const originalScrollLeft = gallery.scrollLeft;
    const originalScrollTop = gallery.scrollTop;

    const positions = [0, 0.25, 0.5, 0.75, 1];

    for (const position of positions) {
      gallery.scrollLeft =
        (gallery.scrollWidth - gallery.clientWidth) * position;

      gallery.scrollTop =
        (gallery.scrollHeight - gallery.clientHeight) * position;

      gallery.querySelectorAll('li').forEach((item) => {
        item.scrollIntoView({
          behavior: 'auto',
          block: 'nearest',
          inline: 'nearest'
        });
      });

      await sleep(250);
    }

    gallery.scrollLeft = originalScrollLeft;
    gallery.scrollTop = originalScrollTop;

    await sleep(500);
  }

  function collectImages(gallery) {
    const images = Array.from(
      gallery.querySelectorAll('img')
    );

    const collected = images
      .map((img) => ({
        url: getImageUrl(img),
        alt: img.getAttribute('alt') || ''
      }))
      .filter((item) =>
        item.url.includes('images.ctfassets.net/')
      );

    return uniqByUrl(collected);
  }

  function setButtonState(btn, text, disabled = false) {
    btn.textContent = text;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.65' : '1';
    btn.style.cursor = disabled ? 'wait' : 'pointer';
  }

  async function downloadVanDeVelde(btn) {
    const gallery = findGallery();

    if (!gallery) {
      alert('Geen Van de Velde-afbeeldingengallery gevonden.');
      return;
    }

    const productCode = getProductCode();

    if (!productCode) {
      alert('Geen productcode gevonden in de pagina.');
      return;
    }

    setButtonState(btn, '⏳ Gallery laden…', true);

    await triggerLazyLoading(gallery);

    const items = collectImages(gallery);

    if (!items.length) {
      setButtonState(btn, '⬇️ Van de Velde grabber');

      alert(
        'Geen Van de Velde-afbeeldingen gevonden in de productgallery.'
      );

      return;
    }

    const brandPrefix = getBrandPrefix(items);

    log('Productcode:', productCode);
    log('Merk:', brandPrefix);
    log('Afbeeldingen:', items);

    setButtonState(
      btn,
      `⬇️ Downloaden 0/${items.length}`,
      true
    );

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const number = index + 1;
      const extension = getExtension(item.url);

      const filename =
        `${brandPrefix}_${productCode}_${number}.${extension}`;

      setButtonState(
        btn,
        `⬇️ Downloaden ${number}/${items.length}`,
        true
      );

      log('Download:', filename, item.url);

      GM_download({
        url: item.url,
        name: filename,
        saveAs: false,
        onerror(error) {
          console.error(
            LOG_PREFIX,
            'Download mislukt:',
            filename,
            error
          );
        }
      });

      // Kleine pauze om te voorkomen dat de browser downloads overslaat.
      await sleep(200);
    }

    setButtonState(
      btn,
      `✅ ${items.length} gedownload`,
      false
    );

    window.setTimeout(() => {
      setButtonState(
        btn,
        '⬇️ Van de Velde grabber',
        false
      );
    }, 3000);
  }

  function ensureButton() {
    if (
      document.getElementById(BTN_ID) ||
      !document.body
    ) {
      return;
    }

    const btn = document.createElement('button');

    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⬇️ Van de Velde grabber';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '80px',
      right: '10px',
      zIndex: '99999',
      padding: '6px 10px',
      fontSize: '11px',
      cursor: 'pointer',
      borderRadius: '12px',
      border: 'none',
      background: 'rgba(0,0,0,0.75)',
      color: 'yellow',
      fontFamily: 'inherit',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
    });

    btn.addEventListener('mouseover', () => {
      if (!btn.disabled) {
        btn.style.background = 'rgba(0,0,0,0.9)';
      }
    });

    btn.addEventListener('mouseout', () => {
      btn.style.background = 'rgba(0,0,0,0.75)';
    });

    btn.addEventListener('click', async () => {
      try {
        await downloadVanDeVelde(btn);
      } catch (error) {
        console.error(LOG_PREFIX, error);

        setButtonState(
          btn,
          '⬇️ Van de Velde grabber',
          false
        );

        alert(
          `Van de Velde grabber error: ${
            error?.message || error
          }`
        );
      }
    });

    document.body.appendChild(btn);
  }

  window.addEventListener('load', ensureButton);

  ensureButton();

  const observer = new MutationObserver(() => {
    ensureButton();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
