// ==UserScript==
// @name         GG | Order Scanner Dashboard
// @namespace    local.goedgepickt.scanner
// @version      2.3.0
// @author       C. P. v. Beek
// @description  Scan O-codes, vind het numerieke GoedGepickt Order ID en rangschik de scanlijst.
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/order-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/order-scanner.user.js
// ==/UserScript==

(() => {
  'use strict';

  const STORE = 'gg-order-scanner-v1';
  const RESOLVER_VERSION = 2;
  const CODE_RE = /^O-\d+$/i;
  const state = JSON.parse(localStorage.getItem(STORE) || '{"orders":[]}');
  state.orders = Array.isArray(state.orders)
    ? state.orders.filter(order => !/^(wordt|zoeken|geladen|uitgelezen)$/i.test(String(order?.orderId || '')))
    : [];
  if (state.resolverVersion !== RESOLVER_VERSION) {
    state.learned = {};
    state.resolverVersion = RESOLVER_VERSION;
    localStorage.setItem(STORE, JSON.stringify(state));
  }
  const learned = new Map(Object.entries(state.learned || {}));
  let pendingNativeScan = null;
  let scanBuffer = '';
  let lastKeyAt = 0;
  let busy = false;

  function extractMappings(data) {
    const seen = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      let text = '';
      try { text = JSON.stringify(node); } catch (_) {}
      const codes = text.match(/O-\d+/gi) || [];
      let id = null;
      for (const key of ['orderId','order_id','id']) {
        if (/^\d+$/.test(String(node[key] || ''))) { id = String(node[key]); break; }
      }
      const route = String(node.url || node.href || node.path || '').match(/\/orders?\/(\d+)(?:\D|$)/i);
      if (!id && route) id = route[1];
      if (id) codes.forEach(code => learned.set(code.toUpperCase(), id));
      Object.values(node).forEach(walk);
    }
    walk(data);
    state.learned = Object.fromEntries(learned); persist();
  }

  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await nativeFetch.apply(this, args);
    response.clone().json().then(extractMappings).catch(() => {});
    return response;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      try { if (typeof this.responseText === 'string' && this.responseText.trim().startsWith('{')) extractMappings(JSON.parse(this.responseText)); } catch (_) {}
    });
    return nativeOpen.apply(this, args);
  };

  function idFromRoute(url) {
    const match = String(url || '').match(/\/orders?\/(\d+)(?:\D|$)/i) || String(url || '').match(/[?&](?:order_?id|id)=(\d+)/i);
    return match?.[1] || null;
  }

  for (const method of ['pushState','replaceState']) {
    const native = history[method];
    history[method] = function (data, title, url) {
      const id = idFromRoute(url) || (data && /^\d+$/.test(String(data.orderId || data.id || '')) ? String(data.orderId || data.id) : null);
      if (pendingNativeScan && id) {
        learned.set(pendingNativeScan, id); state.learned = Object.fromEntries(learned); persist();
        if (typeof window.ggsAcceptResolvedScan === 'function') window.ggsAcceptResolvedScan(pendingNativeScan, id);
        pendingNativeScan = null;
        return; // Bewust niet navigeren: het dashboard neemt de scan over.
      }
      return native.apply(this, arguments);
    };
  }

  const style = document.createElement('style');
  style.textContent = `
    #ggs-root{position:fixed;z-index:2147483646;right:18px;bottom:18px;width:min(560px,calc(100vw - 24px));color:#f7fbff;font:14px/1.45 Inter,system-ui,sans-serif;filter:drop-shadow(0 20px 40px #00152a66)}
    #ggs-root *{box-sizing:border-box}#ggs-panel{overflow:hidden;border:1px solid #284866;border-radius:16px;background:#0b1b2cee}
    #ggs-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;background:#10263d;cursor:move;touch-action:none;user-select:none}
    #ggs-head-actions{display:flex;align-items:center;gap:6px}#ggs-close{border-color:#75404b;color:#ff9ba6}#ggs-close:hover{background:#6f2936;color:#fff}
    #ggs-head strong{font-size:15px}#ggs-status{color:#8fa9c2;font-size:12px}#ggs-dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:#55e7a8}
    #ggs-body{padding:14px}#ggs-stats{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:10px}
    .ggs-stat{padding:12px;border:1px solid #29445f;border-radius:11px;background:#0a1725}.ggs-label{display:block;color:#8fa9c2;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em}
    .ggs-value{display:block;margin-top:5px;font-size:25px;font-weight:850;letter-spacing:-.04em}.ggs-accent{color:#55e7a8}
    #ggs-form{display:flex;gap:8px}#ggs-input{min-width:0;flex:1;padding:11px 12px;border:1px solid #29445f;border-radius:9px;background:#07131f;color:#fff;outline:0;font:inherit;font-size:16px;text-transform:uppercase}
    #ggs-input:focus{border-color:#55e7a8;box-shadow:0 0 0 3px #55e7a822}#ggs-submit{border:0;border-radius:9px;padding:0 15px;background:#55e7a8;color:#062118;font-weight:850;cursor:pointer}
    #ggs-message{min-height:20px;margin:7px 1px 0;color:#8fa9c2;font-size:12px}.ggs-error{color:#ff8492!important}.ggs-ok{color:#55e7a8!important}
    #ggs-list{max-height:230px;margin:4px -14px -14px;padding:0;overflow:auto;list-style:none;border-top:1px solid #29445f}
    #ggs-list li{display:grid;grid-template-columns:30px 1fr auto;gap:9px;align-items:center;padding:10px 14px;border-bottom:1px solid #203a52}.ggs-rank,.ggs-time{color:#829bb3;font-size:12px}.ggs-order{font-weight:800}.ggs-code{display:block;color:#8fa9c2;font-size:11px;font-weight:500}
    .ggs-new{animation:ggs-flash 1.2s ease-out}@keyframes ggs-flash{from{background:#55e7a844}to{background:transparent}}#ggs-panel.ggs-pulse{animation:ggs-border .7s ease-out}@keyframes ggs-border{35%{border-color:#55e7a8;box-shadow:0 0 0 4px #55e7a822}}
    #ggs-export{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#ggs-copytext{display:none}
    .ggs-action{min-height:40px;border:1px solid transparent;border-radius:9px;padding:0 10px;color:#fff;font-weight:normal;cursor:pointer;white-space:nowrap}.ggs-action:hover{filter:brightness(1.1)}
    #ggs-paste-select{background:#6658dd;border-color:#786bea}#ggs-copy{background:#168963;border-color:#20a679}#ggs-csv{background:#c56b19;border-color:#df7d22}
    #ggs-toggle{border:1px solid #38536c;border-radius:7px;background:transparent;color:#b5c6d7;cursor:pointer}#ggs-root.ggs-collapsed .ggs-expanded-only{display:none}#ggs-root.ggs-collapsed #ggs-head{cursor:default}
    @media(max-width:600px){#ggs-root{right:12px;bottom:12px}.ggs-time{display:none}#ggs-list li{grid-template-columns:25px 1fr}.ggs-action{min-height:38px;padding:0 6px;font-size:12px}}
  `;
  document.head.append(style);

  const root = document.createElement('aside');
  root.id = 'ggs-root';
  root.className = 'ggs-collapsed';
  root.innerHTML = `
    <section id="ggs-panel">
      <header id="ggs-head"><strong>Order Scanner</strong><span id="ggs-status" class="ggs-expanded-only"><i id="ggs-dot"></i>Scanner gereed</span><span id="ggs-head-actions"><button id="ggs-toggle" title="In-/uitklappen">+</button><button id="ggs-close" title="Sluiten en logging wissen" aria-label="Sluiten en logging wissen">×</button></span></header>
      <div id="ggs-body">
        <div id="ggs-stats"><div class="ggs-stat"><span class="ggs-label">Aantal orders</span><b class="ggs-value" id="ggs-count">0</b></div><div class="ggs-stat"><span class="ggs-label">Laatste Order ID</span><b class="ggs-value ggs-accent" id="ggs-last">—</b></div></div>
        <div id="ggs-export"><textarea id="ggs-copytext" readonly aria-hidden="true"></textarea><button class="ggs-action" id="ggs-paste-select" type="button">☑ Selecteer Orders</button><button class="ggs-action" id="ggs-copy" type="button">⧉ Kopiëren</button><button class="ggs-action" id="ggs-csv" type="button">⇩ CSV</button></div>
        <div class="ggs-expanded-only">
          <form id="ggs-form"><input id="ggs-input" placeholder="Scan O-11238300" autocomplete="off"><button id="ggs-submit">Scan</button></form>
          <div id="ggs-message" role="status" aria-live="polite"></div><ol id="ggs-list"></ol>
        </div>
      </div>
    </section>`;
  document.body.append(root);

  const $ = selector => root.querySelector(selector);
  const input = $('#ggs-input');

  try {
    const position = JSON.parse(localStorage.getItem('gg-order-scanner-position') || 'null');
    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
      root.style.left = `${Math.max(0, Math.min(position.left, window.innerWidth - 80))}px`;
      root.style.top = `${Math.max(0, Math.min(position.top, window.innerHeight - 50))}px`;
      root.style.right = 'auto'; root.style.bottom = 'auto';
    }
  } catch (_) {}

  function persist() { localStorage.setItem(STORE, JSON.stringify(state)); }
  function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function render(fresh = '') {
    $('#ggs-count').textContent = state.orders.length;
    $('#ggs-last').textContent = state.orders[0]?.orderId || '—';
    $('#ggs-copytext').value = state.orders.map(order => order.orderId).join('\n');
    $('#ggs-list').innerHTML = state.orders.map((o, i) => `<li class="${o.code === fresh ? 'ggs-new' : ''}"><span class="ggs-rank">${String(i + 1).padStart(2, '0')}</span><span class="ggs-order">${esc(o.orderId)}<small class="ggs-code">${esc(o.code)}</small></span><time class="ggs-time">${new Date(o.at).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></li>`).join('');
  }

  function parseOrderIds(text) {
    return new Set(String(text || '').split(/\s+/).map(value => value.trim()).filter(value => /^\d+$/.test(value)));
  }

  function getOrderIdFromRow(row) {
    const link = row.querySelector('td.external_id a, td:nth-child(3) a');
    return link ? link.textContent.trim() : '';
  }

  function setOrderCheckbox(checkbox, checked) {
    if (!checkbox || checkbox.checked === checked) return;
    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function getOrderTable() {
    const jq = window.jQuery;
    if (!jq?.fn?.dataTable) return null;
    try { return jq('#order_index_datatable').DataTable(); } catch (_) { return null; }
  }

  async function pasteAndSelect(button) {
    let clipboard = '';
    try { clipboard = await navigator.clipboard.readText(); }
    catch (_) {
      button.textContent = 'Klembord niet toegestaan';
      setTimeout(() => button.textContent = '☑ Selecteer Orders', 1600);
      return;
    }
    const wanted = parseOrderIds(clipboard);
    if (!wanted.size) {
      button.textContent = 'Geen Order ID’s gevonden';
      setTimeout(() => button.textContent = '☑ Selecteer Orders', 1600);
      return;
    }
    let selected = 0;
    const handleRow = row => {
      const checkbox = row.querySelector('input.orders[name="orders[]"]');
      if (!checkbox || !wanted.has(getOrderIdFromRow(row))) return;
      if (!checkbox.checked) selected++;
      setOrderCheckbox(checkbox, true);
    };
    const table = getOrderTable();
    if (table) table.rows({filter:'applied'}).every(function () { const row = this.node(); if (row) handleRow(row); });
    else document.querySelectorAll('#order_index_datatable tbody tr').forEach(handleRow);
    button.textContent = `${selected} orders geselecteerd`;
    setTimeout(() => button.textContent = '☑ Selecteer Orders', 1800);
  }

  function pling() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC(), now = ac.currentTime;
    [880,1320].forEach((hz,i) => { const osc=ac.createOscillator(), gain=ac.createGain(); osc.frequency.value=hz; gain.gain.setValueAtTime(.0001,now+i*.06); gain.gain.exponentialRampToValueAtTime(.15,now+i*.06+.01); gain.gain.exponentialRampToValueAtTime(.0001,now+i*.06+.2); osc.connect(gain).connect(ac.destination); osc.start(now+i*.06); osc.stop(now+i*.06+.22); });
    setTimeout(()=>ac.close(),450);
  }

  function findOrderId(data, code) {
    const seen = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return null;
      seen.add(node);
      const text = JSON.stringify(node);
      const containsCode = text.toUpperCase().includes(code);
      if (containsCode) {
        for (const key of ['orderId','order_id','id']) {
          const value = node[key];
          if (/^\d+$/.test(String(value || ''))) return String(value);
        }
        const url = node.url || node.href || node.path || '';
        const match = String(url).match(/\/orders?\/(\d+)(?:\D|$)/i);
        if (match) return match[1];
      }
      for (const value of Object.values(node)) { const hit = walk(value); if (hit) return hit; }
      return null;
    }
    return walk(data);
  }

  async function resolveViaRequests(code) {
    const queries = [
      `/api/v1/orders?search=${encodeURIComponent(code)}&perPage=10`,
      `/api/v1/orders?query=${encodeURIComponent(code)}&perPage=10`,
      `/api/orders?search=${encodeURIComponent(code)}&perPage=10`,
      `/orders?search=${encodeURIComponent(code)}&format=json`
    ];
    for (const url of queries) {
      try {
        const response = await fetch(url, { credentials:'same-origin', headers:{Accept:'application/json'} });
        if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) continue;
        const id = findOrderId(await response.json(), code);
        if (id) return id;
      } catch (_) {}
    }
    return null;
  }

  async function resolveViaOrderTable(code) {
    const jq = window.jQuery;
    if (!jq?.fn?.DataTable || !jq.fn.DataTable.isDataTable('#order_index_datatable')) return null;
    const table = jq('#order_index_datatable').DataTable();
    const url = table.ajax.url();
    const data = table.ajax.params() || {};
    data.start = 0;
    data.length = 10;
    const internalId = code.substring(2);
    data.orderNumberSearch = '';
    data.search = data.search || {};
    data.search.value = '';
    if (Array.isArray(data.columns) && data.columns[0]) {
      data.columns[0].search = data.columns[0].search || {};
      data.columns[0].search.value = internalId;
      data.columns[0].search.regex = false;
    }
    return new Promise(resolve => {
      jq.ajax({
        url,
        type: 'POST',
        data,
        dataType: 'json',
        timeout: 5000,
        success(response) {
          extractMappings(response);
          const rows = Array.isArray(response?.data) ? response.data : [];
          const exact = rows.find(row => String(row.id || '') === internalId)
            || (rows.length === 1 ? rows[0] : null);
          const displayId = exact?.external_display_id ?? exact?.external_id ?? exact?.order_number;
          resolve(displayId != null && String(displayId).trim() !== '' ? String(displayId).trim() : null);
        },
        error() { resolve(null); }
      });
    });
  }

  function resolveFromPage(code) {
    const candidates = [...document.querySelectorAll('a[href*="order"]')];
    for (const link of candidates) {
      const context = (link.closest('tr,li,[role=row],article,div')?.textContent || link.textContent || '').toUpperCase();
      if (!context.includes(code)) continue;
      const match = link.href.match(/\/orders?\/(\d+)(?:\D|$)/i) || link.href.match(/[?&](?:order_?id|id)=(\d+)/i);
      if (match) return match[1];
    }
    return null;
  }

  async function resolveOrderId(code) {
    if (learned.has(code)) return learned.get(code);
    const tableResult = await resolveViaOrderTable(code);
    if (tableResult) return tableResult;
    const visible = resolveFromPage(code);
    if (visible) return visible;
    return null;
  }

  function acceptResolvedScan(code, orderId) {
    learned.set(code, orderId); state.learned = Object.fromEntries(learned);
    state.orders = [{code,orderId,at:new Date().toISOString()}, ...state.orders.filter(o => o.orderId !== orderId)];
    persist(); render(code); pling();
    const panel=$('#ggs-panel'); panel.classList.remove('ggs-pulse'); void panel.offsetWidth; panel.classList.add('ggs-pulse');
    $('#ggs-message').className='ggs-ok'; $('#ggs-message').textContent=`${code} → Order ID ${orderId}`; input.value=''; input.focus();
  }
  window.ggsAcceptResolvedScan = acceptResolvedScan;

  async function handleScan(code, allowNativeFallback = false) {
    if (busy) return;
    if (!CODE_RE.test(code)) { $('#ggs-message').className='ggs-error'; $('#ggs-message').textContent='Ongeldige code; verwacht O- gevolgd door cijfers.'; input.select(); return; }
    busy = true; $('#ggs-status').lastChild.textContent=' Zoeken…'; $('#ggs-submit').disabled=true; $('#ggs-message').className=''; $('#ggs-message').textContent=`Order ID zoeken voor ${code}…`;
    const orderId = await resolveOrderId(code);
    busy = false; $('#ggs-status').lastChild.textContent=' Scanner gereed'; $('#ggs-submit').disabled=false;
    if (orderId) { acceptResolvedScan(code, orderId); return; }
    if (allowNativeFallback) {
      pendingNativeScan = code;
      $('#ggs-message').className=''; $('#ggs-message').textContent=`${code} wordt door GoedGepickt opgelost; openen wordt tegengehouden…`;
      setTimeout(() => { if (pendingNativeScan === code) { pendingNativeScan=null; $('#ggs-message').className='ggs-error'; $('#ggs-message').textContent=`Order ID voor ${code} kon niet uit de GG-respons worden gelezen.`; } }, 5000);
      return;
    }
    $('#ggs-message').className='ggs-error'; $('#ggs-message').textContent=`${code} niet gevonden.`; input.select();
  }

  $('#ggs-form').addEventListener('submit', event => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      $('#ggs-message').className='ggs-error';
      $('#ggs-message').textContent='Ongeldige code; verwacht O- gevolgd door cijfers.';
      input.select();
      return;
    }
    window.location.href = '/orders/view/' + code.substring(2);
  });

  function cleanCandidate(value, internalId) {
    const candidate = String(value || '').trim().replace(/^#/, '');
    if (!candidate || candidate === internalId || candidate.toUpperCase() === `O-${internalId}`) return null;
    if (/^(wordt|zoeken|geladen|uitgelezen|niet|automatisch|herkend)$/i.test(candidate)) return null;
    return /^[A-Z0-9][A-Z0-9._\/-]{1,49}$/i.test(candidate) ? candidate : null;
  }

  function findDisplayOrderId(internalId) {
    const pageTitle = document.querySelector('.page_title');
    if (pageTitle) {
      const match = pageTitle.textContent.replace(/\s+/g, ' ').trim().match(/^Bestelling\s+(.+)$/i);
      const candidate = cleanCandidate(match?.[1], internalId);
      if (candidate) return candidate;
    }

    const selectors = [
      '[data-external-display-id]', '[data-external-id]',
      'input[name="external_display_id"]', 'input[name="external_id"]',
      '#external_display_id', '#external_id', '.external-display-id', '.external_id',
      '[data-order-number]', 'input[name="order_number"]'
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const value = element.dataset.externalDisplayId || element.dataset.externalId || element.dataset.orderNumber || element.value || element.textContent;
        const candidate = cleanCandidate(value, internalId);
        if (candidate) return candidate;
      }
    }

    for (const label of document.querySelectorAll('label,dt,th,strong,b,span,div')) {
      const labelText = label.textContent.trim().replace(/\s+/g, ' ');
      if (!/^(bestelnummer|order\s*id|ordernummer)\s*:??$/i.test(labelText)) continue;
      const container = label.closest('.form-group,.row,tr,dl,.m-portlet__body') || label.parentElement;
      if (!container) continue;
      const values = [...container.querySelectorAll('input,a,dd,td,p,span,strong,b')];
      for (const element of values) {
        if (element === label || /^(bestelnummer|order\s*id|ordernummer)\s*:??$/i.test(element.textContent.trim())) continue;
        const candidate = cleanCandidate(element.value || element.textContent, internalId);
        if (candidate) return candidate;
      }
    }

    const pageCopy = document.body.cloneNode(true);
    pageCopy.querySelector('#ggs-root')?.remove();
    const text = pageCopy.innerText.replace(/\u00a0/g, ' ');
    const patterns = [
      /(?:Bestelnummer|Order\s*ID|Ordernummer)\s*:?\s*#?([A-Z0-9][A-Z0-9._\/-]{1,49})/i,
      /(?:Extern bestelnummer|Extern ordernummer)\s*:?\s*#?([A-Z0-9][A-Z0-9._\/-]{1,49})/i
    ];
    for (const pattern of patterns) {
      const candidate = cleanCandidate(text.match(pattern)?.[1], internalId);
      if (candidate) return candidate;
    }
    return null;
  }

  function captureOpenedOrder() {
    const match = window.location.pathname.match(/^\/orders\/view\/(\d+)/i);
    if (!match) return true;
    const internalId = match[1];
    const code = `O-${internalId}`;
    const orderId = findDisplayOrderId(internalId);
    if (!orderId) return false;
    const existing = state.orders.find(order => order.code === code && order.orderId === orderId);
    if (!existing) acceptResolvedScan(code, orderId);
    else {
      $('#ggs-message').className='ggs-ok';
      $('#ggs-message').textContent=`${code} → Order ID ${orderId} (al opgenomen)`;
    }
    return true;
  }

  if (!captureOpenedOrder() && /^\/orders\/view\//i.test(window.location.pathname)) {
    $('#ggs-message').textContent='Orderpagina geladen; Order ID wordt uitgelezen…';
    const observer = new MutationObserver(() => {
      if (captureOpenedOrder()) observer.disconnect();
    });
    observer.observe(document.body, {childList:true, subtree:true, characterData:true});
    setTimeout(() => {
      observer.disconnect();
      if (!captureOpenedOrder()) {
        $('#ggs-message').className='ggs-error';
        $('#ggs-message').textContent='Order ID niet automatisch herkend op deze detailpagina.';
      }
    }, 10000);
  }

  $('#ggs-toggle').addEventListener('click', () => { root.classList.toggle('ggs-collapsed'); $('#ggs-toggle').textContent=root.classList.contains('ggs-collapsed')?'+':'−'; });
  $('#ggs-close').addEventListener('click', () => {
    if (!confirm('Dashboard sluiten en alle scanlogging wissen?')) return;
    state.orders = [];
    state.learned = {};
    localStorage.removeItem(STORE);
    root.remove();
  });
  $('#ggs-paste-select').addEventListener('click', event => pasteAndSelect(event.currentTarget));
  $('#ggs-copy').addEventListener('click', async () => {
    const value = $('#ggs-copytext').value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const button = $('#ggs-copy'); const old = button.textContent;
      button.textContent = 'Gekopieerd'; setTimeout(() => button.textContent = old, 1200);
    } catch (_) {
      const fallback = document.createElement('textarea');
      fallback.value = value; fallback.style.position='fixed'; fallback.style.opacity='0';
      document.body.append(fallback); fallback.select(); document.execCommand('copy'); fallback.remove();
    }
  });
  $('#ggs-csv').addEventListener('click', () => {
    const value = $('#ggs-copytext').value;
    if (!value) return;
    const blob = new Blob(['\uFEFF' + value.replace(/\n/g, '\r\n')], {type:'text/csv;charset=utf-8'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `order-ids-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  const dragHandle = $('#ggs-head');
  let drag = null;
  dragHandle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = root.getBoundingClientRect();
    drag = {pointerId:event.pointerId, dx:event.clientX-rect.left, dy:event.clientY-rect.top};
    root.style.left = `${rect.left}px`; root.style.top = `${rect.top}px`;
    root.style.right = 'auto'; root.style.bottom = 'auto';
    dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  dragHandle.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = root.getBoundingClientRect();
    const left = Math.max(0, Math.min(event.clientX-drag.dx, window.innerWidth-rect.width));
    const top = Math.max(0, Math.min(event.clientY-drag.dy, window.innerHeight-rect.height));
    root.style.left = `${left}px`; root.style.top = `${top}px`;
  });
  function finishDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    localStorage.setItem('gg-order-scanner-position', JSON.stringify({left:parseFloat(root.style.left), top:parseFloat(root.style.top)}));
  }
  dragHandle.addEventListener('pointerup', finishDrag);
  dragHandle.addEventListener('pointercancel', finishDrag);
  document.addEventListener('keydown', event => { if (event.key==='F8') { event.preventDefault(); root.classList.remove('ggs-collapsed'); $('#ggs-toggle').textContent='−'; input.focus(); } });
  render();
})();
