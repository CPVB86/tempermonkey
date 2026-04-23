// ==UserScript==
// @name         DDO | Product Finetuner
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      0.2
// @description  Haal composition-URL op via editpagina en toon 🔗-icoon achter productnaam in productlijst + copy PID op editpagina. Ook aanvulling op H2 bij colour select.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/product-finetuner.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/product-finetuner.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MAX_CONCURRENT = 4;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const ICON_TEXT = '🔗';
  const COPY_ICON = '📋';

  const LS_KEY = 'ddo_composition_cache_v2';

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveCache(cache) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); }
    catch { /* ignore */ }
  }

  const cache = loadCache();

  function getCached(id) {
    const entry = cache[id];
    if (!entry) return undefined;
    if (Date.now() - entry.t > CACHE_TTL_MS) return undefined;
    return entry.url;
  }

  function setCached(id, urlOrNull) {
    cache[id] = { url: urlOrNull, t: Date.now() };
    saveCache(cache);
  }

  function absoluteAdminUrl(href) {
    try {
      return new URL(href, window.location.origin).toString();
    } catch {
      return null;
    }
  }

  function extractIdFromEditHref(href) {
    try {
      const u = new URL(absoluteAdminUrl(href));
      return u.searchParams.get('id');
    } catch {
      return null;
    }
  }
    function createOpenLinkIcon(input) {
  const a = document.createElement('a');
  a.className = 'ddo-open-composition';
  a.textContent = '🔗';
  a.title = 'Open composition link';
  a.style.marginLeft = '0.5em';
  a.style.cursor = 'pointer';
  a.style.textDecoration = 'none';

  const val = (input.value || '').trim();
  if (val) {
    a.href = val;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  } else {
    a.style.opacity = '0.3';
    a.style.pointerEvents = 'none';
  }

  return a;
}

  async function fetchCompositionUrl(editUrl) {
    const res = await fetch(editUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const input = doc.querySelector('input[name="composition"]');
    if (!input) return null;

    const val = (input.getAttribute('value') || input.value || '').trim();
    if (!val) return null;

    return val;
  }

  function createIconLink(url) {
    const a = document.createElement('a');
    a.className = 'ddo-compo-link';
    a.textContent = ICON_TEXT;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open composition';
    a.style.marginLeft = '0.5em';
    a.style.textDecoration = 'none';
    a.style.cursor = 'pointer';
    return a;
  }

  function createCopyPidIcon(input) {
    const btn = document.createElement('span');
    btn.className = 'ddo-copy-pid';
    btn.textContent = COPY_ICON;
    btn.title = 'Copy Supplier PID';
    btn.style.marginLeft = '0.5em';
    btn.style.cursor = 'pointer';
    btn.style.userSelect = 'none';

    btn.addEventListener('click', async () => {
      const value = (input.value || '').trim();
      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
      } catch {
        input.select();
        document.execCommand('copy');
        window.getSelection()?.removeAllRanges();
      }
    });

    return btn;
  }

function initEditPageEnhancements() {
  // Supplier PID copy
  const pidInput = document.querySelector('input[name="supplier_pid"]');
  if (pidInput && !pidInput.parentElement?.querySelector('.ddo-copy-pid')) {
    pidInput.insertAdjacentElement('afterend', createCopyPidIcon(pidInput));
  }

  // Composition link
  const compInput = document.querySelector('input[name="composition"]');
  if (compInput && !compInput.parentElement?.querySelector('.ddo-open-composition')) {
    compInput.insertAdjacentElement('afterend', createOpenLinkIcon(compInput));
  }
}
    function enhanceAddColorsTitle() {
  const h2 = Array.from(document.querySelectorAll('h2'))
    .find(el => el.textContent.includes('Add colors & sizes'));

  if (!h2) return;
  if (h2.dataset.enhanced) return;

  const activeBreadcrumb = document.querySelector('.header_item_element a.active');
  if (!activeBreadcrumb) return;

  const productName = activeBreadcrumb.textContent.trim();
  if (!productName) return;

  h2.innerHTML = `
    <img src="img/icon/color_wheel_add.png" alt="color_wheel_add">
    Add colors & sizes for ${productName}
  `;

  h2.dataset.enhanced = 'true';
}

  // ---- queue / throttling
  const queue = [];
  let active = 0;

  function runNext() {
    if (active >= MAX_CONCURRENT) return;
    const job = queue.shift();
    if (!job) return;

    active++;
    job().finally(() => {
      active--;
      runNext();
    });
  }

  function enqueue(fn) {
    queue.push(fn);
    runNext();
  }

  function init() {
    initEditPageEnhancements();
      enhanceAddColorsTitle();

    const rows = document.querySelectorAll('tr.highlight');

    rows.forEach(tr => {
      const controlTd = tr.querySelector('td.control');
      if (!controlTd) return;

      if (controlTd.querySelector('.ddo-compo-link')) return;

      const editA =
        controlTd.querySelector('a[href*="section=products"][href*="action=edit"][href*="id="]') ||
        controlTd.querySelector('a[href*="action=edit"][href*="id="]');
      if (!editA) return;

      const id = extractIdFromEditHref(editA.getAttribute('href'));
      if (!id) return;

      const cached = getCached(id);

      if (cached !== undefined) {
        if (cached) {
          editA.insertAdjacentElement('afterend', createIconLink(cached));
        }
        return;
      }

      const editUrlAbs = absoluteAdminUrl(editA.getAttribute('href'));
      if (!editUrlAbs) return;

      enqueue(async () => {
        try {
          const compVal = await fetchCompositionUrl(editUrlAbs);
          setCached(id, compVal);

          if (compVal && !controlTd.querySelector('.ddo-compo-link')) {
            editA.insertAdjacentElement('afterend', createIconLink(compVal));
          }
        } catch {
          setCached(id, null);
        }
      });
    });
  }

  init();

  const obs = new MutationObserver(() => init());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => obs.disconnect(), 15000);
})();
