// ==UserScript==
// @name         GG Toolbox | Core
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.13.0
// @description  Versleepbare toolbox met Beheerder/Manager+/Manager/Picker-toegang en Barcode Fixer.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/gg-toolbox.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/gg-toolbox.user.js
// ==/UserScript==
(() => {
  'use strict';
  const window = unsafeWindow;
  if (window.__ggToolbox) return;
  const VERSION = '1.13.0';
  const UPDATE = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/gg-toolbox.user.js';
  // TOEGANG: managerPlus, manager en picker true/false per functie; Beheerder heeft altijd toegang.
  const USERS = {
    Beheerder: ['Chantor Pascal van Beek'],
    'Manager+': ['Folkert van Beek'],
    Manager: ['Monique van Beek'],
    Picker: ['Chantal Timmer', 'Anke Adams'],
  };
  const FEATURES = {
    barcodeFixer: { label: 'Barcode Fixer', managerPlus: true, manager: true, picker: true, icon: 'barcode', adapter: '__ggBarcodeFixer', file: 'gg-barcode-fixer.user.js' },
    wagroPrio: { label: 'WaGro Prio', managerPlus: true, manager: true, picker: true, icon: 'medal', adapter: '__ggWaGroPrio', file: 'gg-wagro-prio.user.js', action: true },
    ddoProductLinker: { label: 'DDO Productlinker', managerPlus: true, manager: true, picker: false, icon: 'link', adapter: '__ggDDOProductLinker', file: 'gg-ddo-productlinker.user.js' },
    twoOrder: { label: '2Order', managerPlus: true, manager: false, picker: false, icon: 'cart', adapter: '__gg2Order', file: 'gg-2order.user.js' },
    tabber: { label: 'Tabber', managerPlus: true, manager: true, picker: true, icon: 'tabs', adapter: '__ggTabber', file: 'gg-tabber.user.js' },
    openInDDO: { label: 'Open in DDO', managerPlus: true, manager: true, picker: false, icon: 'external', adapter: '__ggOpenInDDO', file: 'gg-open-in-ddo.user.js' },
    reserved: { label: 'Gereserveerd', managerPlus: true, manager: true, picker: true, icon: 'recycle', adapter: '__ggReserved', file: 'gg-gereserveerd.user.js' },
    productDetails: { label: 'Product Details', managerPlus: true, manager: false, picker: false, icon: 'sale', adapter: '__ggAnitaSale', file: 'gg-product-details.user.js' },
    stockCheck: { label: 'Stock Check', managerPlus: true, manager: false, picker: false, icon: 'stock', adapter: '__ggStockCheck', file: 'gg-stock-check.user.js' },
    warehousing: { label: 'Warehousing', managerPlus: false, manager: false, picker: false, icon: 'warehouse', adapter: '__ggWarehousing', file: 'gg-warehousing.user.js' },
  };
  // Eenvoudige lijnsymbolen: dezelfde maat, lijndikte en kleur voor alle iconen.
  const ICONS = {
    warehouse: '<path d="m2 9 10-6 10 6v12H2V9Zm4 12V11h12v10M6 15h12M6 18h12"/>',
    stock: '<path d="M4 4h16v16H4zM8 2v4m8-4v4M8 13l3 3 6-7"/>',
    sale: '<path d="M3 3h9l9 9-9 9-9-9V3Z"/><circle cx="7" cy="7" r="1"/><path d="m10 16 6-6"/><circle cx="11" cy="11" r="1"/><circle cx="15" cy="15" r="1"/>',
    recycle: '<path d="m8 7 3-5 4 7m-4-7 4 1m0 6 2-4m1 6 4 6H14m8 0-2 3m-6-3 3 3M11 21H4l4-7m-4 7-2-3m6-4-4 1"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    tabs: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 7V3h14v14h-4M3 11h14"/>',
    cart: '<path d="M2 3h3l3 12h11l3-9H6m2 9-1 3h12"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
    link: '<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    barcode: '<path d="M3 5v14m3-14v14m4-14v14m2-14v14m4-14v14m2-14v14m3-14v14"/>',
    medal: '<path d="m7 3 5 6 5-6M5 3h4m6 0h4"/><circle cx="12" cy="15" r="6"/><path d="m10 13 2-1v6m-2 0h4"/>',
  };
  const normalizeName = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('nl');
  function identity() {
    const name = document.querySelector('span.m-topbar__username')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const role = Object.keys(USERS).find(role => USERS[role].some(user => normalizeName(user) === normalizeName(name))) || '';
    return { name, role };
  }
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem('gg_toolbox_' + key)) ?? fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem('gg_toolbox_' + key, JSON.stringify(value)); } catch {}
  }
  function enabled(id) {
    const user = identity(), feature = FEATURES[id];
    return !!feature && (user.role === 'Beheerder' || (user.role === 'Manager+' && feature.managerPlus === true) || (user.role === 'Manager' && feature.manager === true) || (user.role === 'Picker' && feature.picker === true));
  }

  window.__ggToolbox = { isEnabled: enabled, version: VERSION };
  const ADAPTER_BASE = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/';
  const newer = (remote, local) => {
    const a = remote.split('.').map(Number), b = local.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  };
  function startUI() {
    if (document.getElementById('gg-toolbox')) return;
    const host = document.createElement('section');
    host.id = 'gg-toolbox';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      ':host{position:fixed;right:10px;top:10px;width:215px;max-width:calc(100vw - 8px);z-index:99999999;color:#25313b;font:12px/1.25 system-ui}' +
      '*{box-sizing:border-box}.box{background:#fff;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0002;overflow:hidden}' +
      'header{height:28px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;background:#263746;color:#fff;cursor:move;touch-action:none}' +
      '.header-controls{display:flex;align-items:center;gap:7px}.collapse{border:0;background:transparent;color:#fff;width:22px;height:22px;padding:0;line-height:1;display:grid;place-items:center}.collapse svg{width:14px;height:14px}.box.collapsed>.extras,.box.collapsed>.user,.box.collapsed>.grid,.box.collapsed>footer{display:none}' +
      '.version{font-size:9px}.user{padding:7px 8px;border-bottom:1px solid #edf1f4;font-size:10px;overflow-wrap:anywhere}.role{color:#6d7880;margin-top:3px}' +
      '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px}' +
      'button{font:inherit;cursor:pointer}.feature{aspect-ratio:1;border:0;border-radius:4px;background:#d6dce1;color:#56616a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:3px;font-size:9px;line-height:1.15;min-width:0;overflow-wrap:anywhere}' +
      '.feature.active{background:#18864b;color:white}.feature:disabled{color:#7b858d;cursor:not-allowed}.feature:focus-visible,a:focus-visible,button:focus-visible{outline:2px solid #0877b9;outline-offset:2px}' +
      '.icon{display:block;width:23px;height:23px;flex-shrink:0}.icon svg{display:block;width:100%;height:100%}footer{padding:5px 7px;background:#f4f7f9;border-top:1px solid #dfe5e9;font-size:9px}' +
      'a,.check{color:#0877b9}.check{background:none;border:0;padding:0;font-size:10px}.update-state{margin-top:3px;overflow-wrap:anywhere}' +
      '</style><div class="box" role="region" aria-label="GG Toolbox"><header><span>GG Toolbox</span><span class="header-controls"><span class="version">v' + VERSION +
      '</span><button type="button" class="collapse" aria-expanded="true" title="Minimaliseren" aria-label="Toolbox minimaliseren"></button></span></header><div class="user"><div class="name"></div><div class="role"></div></div><div class="grid"></div><footer><button type="button" class="check">Check op Updates</button><div class="update-state" role="status"></div></footer></div>';
    const $ = selector => root.querySelector(selector);
    window.__ggToolbox.getPanel = id => {
      if (!enabled(id)) return null;
      let panel = root.querySelector('[data-extra="' + id + '"]');
      if (!panel) {
        panel = document.createElement('section'); panel.className = 'extras'; panel.dataset.extra = id;
        $('.box').insertBefore(panel, $('footer'));
      }
      return panel;
    };
    for (const [id, feature] of Object.entries(FEATURES)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'feature';
      button.innerHTML = '<span class="icon" aria-hidden="true"></span><span class="label"></span>';
      button.querySelector('.icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + ICONS[feature.icon] + '</svg>';
      button.querySelector('.label').textContent = feature.label;
      if (feature.action) button.onclick = () => {
        const adapter = window[feature.adapter];
        if (enabled(id) && adapter?.getState().ready) adapter.run();
        paint();
      };
      button.dataset.feature = id;
      $('.grid').append(button);
    }
    function paint() {
      const user = identity();
      $('.name').textContent = user.name || 'Gebruiker wordt geladen…';
      $('.role').textContent = user.role || 'Geen toegang';
      root.querySelectorAll('[data-extra]').forEach(panel => { if (!enabled(panel.dataset.extra)) panel.remove(); });
      for (const button of root.querySelectorAll('[data-feature]')) {
        const feature = FEATURES[button.dataset.feature];
        const adapter = window[feature.adapter];
        const available = !!adapter;
        const state = feature.action && adapter ? adapter.getState() : { ready: true };
        const active = enabled(button.dataset.feature) && available && state.ready;
        button.disabled = feature.action && !active;
        button.setAttribute('aria-disabled', String(!feature.action || !active));
        button.style.cursor = feature.action && active ? 'pointer' : 'default';
        button.classList.toggle('active', active);
        button.setAttribute('aria-label', feature.label + (active ? ': actief' : ': inactief'));
        button.title = !enabled(button.dataset.feature) ? 'Niet ingeschakeld voor jouw toegangsniveau' : !available ? 'Adapter ontbreekt' : feature.action ? state.reason : 'Actief via de core-configuratie';
      }
    }
    setInterval(paint, 1000);
    let queued = false;
    new MutationObserver(() => {
      if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    const clamp = (left, top) => {
      host.style.right = 'auto';
      host.style.left = Math.max(0, Math.min(innerWidth - host.offsetWidth, left)) + 'px';
      host.style.top = Math.max(0, Math.min(innerHeight - host.offsetHeight, top)) + 'px';
    };
    function setCollapsed(collapsed, persist = true) {
      $('.box').classList.toggle('collapsed', collapsed);
      const button = $('.collapse');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.title = collapsed ? 'Maximaliseren' : 'Minimaliseren';
      button.setAttribute('aria-label', collapsed ? 'Toolbox maximaliseren' : 'Toolbox minimaliseren');
      button.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + (collapsed ? '<rect x="3" y="3" width="10" height="10" rx="1"/>' : '<path d="M3 11h10"/>') + '</svg>';
      if (persist) write('collapsed', collapsed);
      const rect = host.getBoundingClientRect();
      clamp(rect.left, rect.top);
    }
    $('.collapse').onclick = () => setCollapsed(!$('.box').classList.contains('collapsed'));
    setCollapsed(read('collapsed', false) === true, false);
    const saved = read('position', null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) clamp(saved.left, saved.top);
    const handle = $('header');
    let drag = null;
    handle.onpointerdown = event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = host.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    handle.onpointermove = event => { if (drag) clamp(event.clientX - drag.x, event.clientY - drag.y); };
    const stop = () => {
      if (!drag) return;
      drag = null;
      const rect = host.getBoundingClientRect();
      write('position', { left: rect.left, top: rect.top });
    };
    handle.onpointerup = stop; handle.onpointercancel = stop; handle.onlostpointercapture = stop;
    window.addEventListener('resize', () => { const r = host.getBoundingClientRect(); clamp(r.left, r.top); });
    function targets() {
      return [
        { label: 'Core', version: VERSION, url: UPDATE },
        ...Object.entries(FEATURES).filter(([id, feature]) => enabled(id) || window[feature.adapter]?.version).map(([, feature]) => ({ label: feature.label, version: window[feature.adapter]?.version || '', url: ADAPTER_BASE + feature.file })),
      ];
    }
    function renderUpdate(cache) {
      const state = $('.update-state');
      state.replaceChildren();
      const current = targets(), missing = current.filter(item => !item.version);
      if (missing.length) {
        state.append('Installeren: ');
        missing.forEach((item, index) => {
          if (index) state.append(' · ');
          const link = document.createElement('a');
          link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = item.label; link.title = 'Installeer ' + item.label + ' (adapter niet geladen)';
          state.append(link);
        });
        state.append(document.createElement('br'));
      }
      if (!cache?.results) { state.append('Nog niet gecontroleerd'); return; }
      const local = new Map(current.map(item => [item.url, item.version]));
      const results = cache.results.filter(item => local.has(item.url));
      const failures = results.filter(item => item.error);
      const updates = results.filter(item => !item.error && local.get(item.url) && newer(item.remote, local.get(item.url)));
      const time = new Date(cache.at).toLocaleString('nl-NL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      if (updates.length) {
        state.append(updates.length + (updates.length === 1 ? ' update: ' : ' updates: '));
        updates.forEach((item, index) => {
          if (index) state.append(' · ');
          const link = document.createElement('a');
          link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = item.label + ' v' + item.remote;
          link.title = 'Download update voor ' + item.label;
          link.style.textDecoration = 'underline';
          state.append(link);
        });
      } else if (failures.length || results.length !== current.length || missing.length) {
        state.append('Controle onvolledig · ' + time);
      } else state.append('Core + ' + (current.length - 1) + ' adapter(s) actueel · ' + time);
      if (failures.length) state.append(document.createElement('br'), 'Mislukt: ' + failures.map(item => item.label + ' (' + item.error + ')').join(' · '));
    }
    function remoteVersion(target) {
      return new Promise(resolve => {
        const fail = error => resolve({ ...target, error });
        try {
          GM_xmlhttpRequest({
            method: 'GET', url: target.url + '?_=' + Date.now(), timeout: 15000,
            onload: response => {
              if (response.status < 200 || response.status >= 300) return fail('HTTP ' + response.status);
              const remote = response.responseText.match(/^\/\/\s*@version\s+(\d+(?:\.\d+)*)\s*$/m)?.[1];
              if (!remote) return fail('Geen geldig versienummer');
              resolve({ ...target, remote });
            },
            onerror: () => fail('Netwerkfout'), ontimeout: () => fail('Timeout'),
          });
        } catch { fail('Updatecontrole niet beschikbaar'); }
      });
    }
    async function checkUpdates() {
      if ($('.check').disabled) return;
      $('.check').disabled = true;
      const current = targets();
      let finished = 0;
      $('.update-state').textContent = 'Controleren… 0/' + current.length;
      const results = await Promise.all(current.map(async target => {
        const result = await remoteVersion(target);
        $('.update-state').textContent = 'Controleren… ' + (++finished) + '/' + current.length;
        return result;
      }));
      const cache = { results, at: Date.now(), signature: JSON.stringify(current) };
      write('update', cache); renderUpdate(cache); $('.check').disabled = false;
    }
    $('.check').onclick = checkUpdates;
    const cache = read('update', null);
    renderUpdate(cache);
    setTimeout(() => {
      if (!cache || cache.signature !== JSON.stringify(targets()) || Date.now() - cache.at >= 86400000) checkUpdates();
    }, 1500);
    let lastTargets = JSON.stringify(targets());
    setInterval(() => {
      const signature = JSON.stringify(targets());
      if (!$('.check').disabled && signature !== lastTargets) {
        lastTargets = signature;
        renderUpdate(read('update', null));
        checkUpdates();
      }
    }, 2000);
    paint();
  }
  if (document.body) queueMicrotask(startUI);
  else document.addEventListener('DOMContentLoaded', startUI, { once: true });


})();
