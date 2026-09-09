// ==UserScript==
// @name         GG Toolbox | Adapter | Tabber
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.1
// @description  Drie headerknoppen voor geselecteerde producten: bekijken, instellingen en voorraad bewerken.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-tabber.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-tabber.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggTabber) return;
  const NAV = '.m-stack__item.m-topbar__nav-wrapper ul.m-topbar__nav';
  const SELECTED = 'input.productToDetach[type="checkbox"]:checked,input.products[type="checkbox"]:checked';
  const modes = {
    view: { label: 'Open geselecteerde producten: bekijken', path: 'view', icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' },
    settings: { label: 'Open geselecteerde producten: instellingen bewerken', path: 'edit', icon: '<path d="m15 4 5 5M4 20l1-5L16 4a2 2 0 0 1 4 4L9 19l-5 1Z"/>' },
    stock: { label: 'Open geselecteerde producten: voorraad bewerken', path: 'edit-stock', icon: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7 5l10 4"/>' },
  };
  const allowed = () => /^\/(?:products(?:\/|$)|picklocations\/view(?:\/|$))/.test(location.pathname) && window.__ggToolbox?.isEnabled('tabber') === true;
  function stockUrl(checkbox, uuid) {
    const row = checkbox.closest('tr');
    const nativeUrls = [...(row?.querySelectorAll('a[href*="/products/edit-stock/"]') || [])].flatMap(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.origin);
        const match = url.pathname.match(/^\/products\/edit-stock\/([^/]+)\/(\d+)\/?$/);
        return url.origin === location.origin && match?.[1] === uuid ? [url.href] : [];
      } catch { return []; }
    });
    const unique = [...new Set(nativeUrls)];
    if (unique.length === 1) return unique[0];
    // Multiple stock records cannot be resolved from a product UUID alone.
    const stockId = checkbox.dataset.stockId || checkbox.dataset.productStockId || checkbox.value;
    if (!/^\d+$/.test(stockId || '')) return null;
    if (unique.length > 1) return unique.find(href => new URL(href).pathname.replace(/\/$/, '').endsWith('/' + stockId)) || null;
    const url = new URL('/products/edit-stock/' + encodeURIComponent(uuid) + '/' + stockId, location.origin);
    const page = new URLSearchParams(location.search || '').get('page');
    url.searchParams.set('page', /^\d+$/.test(page || '') ? page : '1');
    return url.href;
  }
  function buildUrls(mode) {
    if (!modes[mode]) return [];
    const urls = [];
    for (const checkbox of document.querySelectorAll(SELECTED)) {
      if (checkbox.disabled || checkbox.classList.contains('bulkDeleteProductCheckAll')) continue;
      const link = checkbox.closest('tr')?.querySelector('a[href*="/products/view/"]');
      const uuid = checkbox.dataset.uuid || link?.getAttribute('href')?.match(/\/products\/view\/([a-f0-9-]+)/i)?.[1];
      if (!uuid || !/^[a-f0-9-]+$/i.test(uuid)) continue;
      let path = '/products/' + modes[mode].path + '/' + encodeURIComponent(uuid);
      if (mode === 'stock') {
        const url = stockUrl(checkbox, uuid);
        if (url) urls.push(url);
        continue;
      }
      urls.push(new URL(path, location.origin).href);
    }
    return [...new Set(urls)];
  }
  function openSelected(mode) {
    if (!allowed()) return;
    const urls = buildUrls(mode);
    if (!urls.length) return;
    if (urls.length > 10 && !window.confirm('Je staat op het punt ' + urls.length + ' tabbladen te openen. Doorgaan?')) return;
    // Keep opens in the actual click handler instead of delayed timer callbacks.
    for (const url of urls) { if (!allowed()) break; window.open(url, '_blank', 'noopener'); }
  }
  function sync() {
    const nav = document.querySelector(NAV);
    if (!allowed()) {
      document.querySelectorAll('[data-gg-tabber]').forEach(item => item.remove());
      return;
    }
    if (!nav) return;
    for (const [mode, config] of Object.entries(modes)) {
      let item = nav.querySelector('[data-gg-tabber="' + mode + '"]');
      if (!item) {
        item = document.createElement('li'); item.dataset.ggTabber = mode;
        item.className = 'm-nav__item m-topbar__notifications';
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'm-nav__link';
        button.style.cssText = 'border:0;background:transparent;padding:0 10px;height:100%;font:inherit;color:inherit';
        button.innerHTML = '<span class="m-nav__link-icon"><svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + config.icon + '</svg></span>';
        button.setAttribute('aria-label', config.label);
        button.onclick = () => openSelected(mode);
        item.append(button);
        nav.insertBefore(item, nav.firstChild);
      }
      const count = buildUrls(mode).length, button = item.querySelector('button');
      button.disabled = count === 0;
      button.title = config.label + (count ? ' (' + count + ')' : ' — selecteer eerst producten');
      button.style.opacity = count ? '1' : '.45';
      button.style.cursor = count ? 'pointer' : 'default';
    }
  }
  function boot() {
    sync();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true; queueMicrotask(() => { scheduled = false; sync(); });
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', schedule);
    setInterval(sync, 1000);
  }
  window.__ggTabber = { version: '1.0.1' };
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
