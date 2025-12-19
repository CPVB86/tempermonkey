// ==UserScript==
// @name         Colomoda - Max qty achter EAN (bulk variants)
// @namespace    https://runiversity.nl/
// @version      0.2
// @description  Zet max order qty achter EAN in bulk variants op basis van product.variants[*].stock.maximum
// @match        https://www.colomoda.eu/*
// @grant        GM_xmlhttpRequest
// @connect      www.colomoda.eu
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/colomoda-max-quoty.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/colomoda-max-quoty.user.js
// ==/UserScript==

(() => {
  'use strict';

  const map = new Map(); // ean -> maximum (number)

  const getJsonUrl = () => {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/?$/, '') + '?format=json';
  };

  const gmFetchJson = (url) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { 'Accept': 'application/json' },
      onload: r => {
        try { resolve(JSON.parse(r.responseText)); }
        catch (e) { reject(e); }
      },
      onerror: reject
    });
  });

  const findContainer = () =>
    document.querySelector('#pp-bulk-variants') ||
    document.querySelector('#\\#pp-bulk-variants'); // als die id écht een # bevat

  const extractEan = (el) => {
    const m = (el.textContent || '').match(/\b([0-9]{8,14})\b/);
    return m ? m[1] : null;
  };

  const addBadge = (eanEl, max) => {
    if (!eanEl || eanEl.querySelector('.tm-maxqty')) return;

    const s = document.createElement('span');
    s.className = 'tm-maxqty';
    s.style.marginLeft = '6px';
    s.style.opacity = '0.9';
    s.style.fontWeight = '600';
    s.textContent = `• max ${max}`;
    eanEl.appendChild(s);
  };

  const apply = () => {
    const c = findContainer();
    if (!c) return;

    c.querySelectorAll('.opacity-90.fz-080').forEach(el => {
      const ean = extractEan(el);
      if (!ean) return;

      const max = map.get(ean);
      if (typeof max === 'number') addBadge(el, max);
    });
  };

  const buildMap = (json) => {
    const variants = json?.product?.variants;
    if (!variants || typeof variants !== 'object') return;

    for (const v of Object.values(variants)) {
      const ean = v?.ean;
      const max = v?.stock?.maximum;
      if (ean && typeof max === 'number') map.set(String(ean), max);
    }
  };

  async function init() {
    try {
      const json = await gmFetchJson(getJsonUrl());
      buildMap(json);
      apply();
    } catch (e) {
      // stil falen; observer blijft nuttig bij late render, maar zonder map gebeurt er niks
    }

    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(apply, 500);
    setTimeout(apply, 1500);
  }

  init();
})();
