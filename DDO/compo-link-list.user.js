// ==UserScript==
// @name         DDO | Composition Link List
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      0.1
// @description  Haal composition-URL op via editpagina en toon 🔗-icoon achter productnaam in productlijst.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. van Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-list.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/compo-link-list.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MAX_CONCURRENT = 4;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const ICON_TEXT = '🔗';

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

  // cache entry: { url: string|null, t: number }
  function getCached(id) {
    const entry = cache[id];
    if (!entry) return undefined; // undefined = niet aanwezig
    if (Date.now() - entry.t > CACHE_TTL_MS) return undefined;
    return entry.url; // kan string of null zijn
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

  async function fetchCompositionUrl(editUrl) {
    const res = await fetch(editUrl, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const input = doc.querySelector('input[name="composition"]');
    if (!input) return null;

    const val = (input.getAttribute('value') || input.value || '').trim();

    // Alleen checken op "niet leeg" (geen URL-validatie nodig)
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
    const rows = document.querySelectorAll('tr.highlight');

    rows.forEach(tr => {
      const controlTd = tr.querySelector('td.control');
      if (!controlTd) return;

      // Voorkom dubbel icoon
      if (controlTd.querySelector('.ddo-compo-link')) return;

      const editA =
        controlTd.querySelector('a[href*="section=products"][href*="action=edit"][href*="id="]') ||
        controlTd.querySelector('a[href*="action=edit"][href*="id="]');
      if (!editA) return;

      const id = extractIdFromEditHref(editA.getAttribute('href'));
      if (!id) return;

      const cached = getCached(id);

      // Cache hit:
      // - string => icoon tonen
      // - null => niets tonen
      if (cached !== undefined) {
        if (cached) {
          editA.insertAdjacentElement('afterend', createIconLink(cached));
        }
        return;
      }

      // Nog niet in cache: haal editpagina op
      const editUrlAbs = absoluteAdminUrl(editA.getAttribute('href'));
      if (!editUrlAbs) return;

      enqueue(async () => {
        try {
          const compVal = await fetchCompositionUrl(editUrlAbs);
          // compVal: string of null
          setCached(id, compVal);

          // Alleen icoon plaatsen als niet leeg
          if (compVal && !controlTd.querySelector('.ddo-compo-link')) {
            editA.insertAdjacentElement('afterend', createIconLink(compVal));
          }
        } catch {
          // Bij error: cache null zodat we niet blijven spammen
          setCached(id, null);
        }
      });
    });
  }

  init();

  // lijst kan verversen/filters: observeer
  const obs = new MutationObserver(() => init());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => obs.disconnect(), 15000);
})();
