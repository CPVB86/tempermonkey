// ==UserScript==
// @name         GG Toolbox | Adapter | WaGro Prio
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.1.0
// @description  WaGro-prioriteit op productpagina, productvoorraadlijst en inboundlijst; gedeelde controle en correctie per product.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-wagro-prio.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-wagro-prio.user.js
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggWaGroPrio) return;
  let busy = false;
  const allowed = () => window.__ggToolbox?.isEnabled('wagroPrio') === true;
  function rows() {
    return Array.from(document.querySelectorAll('#m_datatable_stock tbody tr')).map(row => ({
      name: row.querySelector('td:nth-child(1) a')?.textContent?.trim() || '',
      select: row.querySelector('select.prio_select'),
    })).filter(row => row.name && row.select);
  }
  function choices(select) {
    return Array.from(select.options).filter(option => !option.disabled && /^\d+$/.test(option.value));
  }
  function productState() {
    if (!allowed()) return { ready: false, reason: 'Geen toegang via de core' };
    if (busy) return { ready: false, reason: 'Prioriteiten aanpassen…' };
    if (!/^\/products\/view\//.test(window.location.pathname)) return { ready: false, reason: 'Open een productpagina' };
    const locations = rows(), wagro = locations.filter(row => row.name.startsWith('WaGro'));
    if (!wagro.length) return { ready: false, reason: 'Geen WaGro-locatie gevonden' };
    if (wagro.every(row => row.select.value === '1')) return { ready: false, reason: 'WaGro staat al op prioriteit 1' };
    if (locations.some(row => row.select.disabled)) return { ready: false, reason: 'Prioriteiten zijn niet bewerkbaar' };
    if (wagro.some(row => !choices(row.select).some(option => option.value === '1'))) return { ready: false, reason: 'Prioriteit 1 is niet beschikbaar voor WaGro' };
    if (locations.some(row => !row.name.startsWith('WaGro') && !choices(row.select).some(option => Number(option.value) > 1))) return { ready: false, reason: 'Geen prioriteit boven 1 beschikbaar voor een overige locatie' };
    return { ready: true, reason: 'Zet WaGro op 1 en randomiseer de overige locaties boven 1' };
  }
  function runProduct() {
    if (!productState().ready) return;
    const changes = rows().map(row => {
      const options = choices(row.select).filter(option => Number(option.value) > 1);
      return { select: row.select, value: row.name.startsWith('WaGro') ? '1' : options[Math.floor(Math.random() * options.length)].value };
    });
    busy = true;
    try {
      for (const { select, value } of changes) {
        if (!allowed()) break;
        if (select.value === value) continue;
        select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } finally { busy = false; }
  }
  // Shared service for product-stock lists and inbound lists.
  const cache = new Map(), inFlight = new Map(), fixing = new Set();
  const rowStates = new WeakMap();
  const targetRe = /\[(?:ext|bar)\]/i;
  const isWaGro = name => /^wagro(?:\s|\/|$)/i.test(name.trim());
  const parser = () => new DOMParser();
  const plain = html => parser().parseFromString(String(html || ''), 'text/html').body.textContent.trim();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  function requireAccess() { if (!allowed()) throw new Error('Geen toegang via de core'); }
  async function request(url, options = {}) {
    requireAccess();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: 'include', ...options, signal: controller.signal });
      if (!response.ok || response.redirected) throw new Error('Verzoek mislukt; controleer je sessie (HTTP ' + response.status + ')');
      return await response.text();
    } finally { clearTimeout(timeout); }
  }
  function stockBody(start) {
    const body = new URLSearchParams({ draw: '1', start: String(start), length: '50', 'order[0][column]': '6', 'order[0][dir]': 'asc', 'search[value]': '', 'search[regex]': 'false' });
    ['picklocation','free_stock','total_stock','min_stock','max_stock','warehouse_stockvalue','priority','exclude_from_stock','Actions'].forEach((name, index) => {
      for (const [key,value] of Object.entries({ data:name, name:'', searchable:'true', orderable:String(index === 6), 'search[value]':'', 'search[regex]':'false' })) body.set(`columns[${index}][${key}]`, value);
    });
    return body;
  }
  async function loadProduct(uuid) {
    if (!/^[a-f0-9-]+$/i.test(uuid)) throw new Error('Ongeldige productreferentie');
    const html = await request('/products/view/' + encodeURIComponent(uuid));
    const id = html.match(/\/api\/products\/stock\?[^"'<>]*\bid=(\d+)/i)?.[1];
    const token = window.config?.user?.api_token || html.match(/api_token:\s*'([^']+)'/i)?.[1] || html.match(/api_token=([A-Za-z0-9]+)/i)?.[1];
    if (!id || !token) throw new Error('Productgegevens of API-token ontbreken');
    const result = [];
    for (let start = 0; ; start += 50) {
      const json = JSON.parse(await request('/api/products/stock?' + new URLSearchParams({ api_token: token, id }), { method:'POST', headers, body:stockBody(start).toString() }));
      if (!Array.isArray(json.data)) throw new Error('Ongeldig voorraadantwoord');
      result.push(...json.data.map(row => {
        const selected = parser().parseFromString(String(row.prio_select || ''), 'text/html').querySelector('option[selected]');
        const value = /^\d+$/.test(String(row.priority)) ? Number(row.priority) : selected ? Number(selected.value) : null;
        return { stockId:row.product_stock_id, loc:plain(row.warehouse_picklocation || row.picklocation), prio:value };
      }));
      const total = Number(json.recordsFiltered ?? json.recordsTotal);
      if (Number.isFinite(total) && result.length < total && json.data.length < 50) throw new Error('Onvolledige voorraadlijst ontvangen');
      if ((Number.isFinite(total) && result.length >= total) || json.data.length < 50) break;
      if (start >= 9950) throw new Error('Voorraadlijst te groot; controle afgebroken');
    }
    const wagro = result.filter(row => isWaGro(row.loc));
    const winner = [...wagro].sort((a,b) => (a.prio ?? Infinity) - (b.prio ?? Infinity))[0];
    return { uuid, rows:result, winner, state:!winner ? 'gray' : winner.prio === 1 ? 'green' : 'orange' };
  }
  function inspect(uuid, fresh = false) {
    if (inFlight.has(uuid)) return inFlight.get(uuid);
    const saved = cache.get(uuid);
    if (!fresh && saved && Date.now() - saved.at < 60000) return Promise.resolve(saved.result);
    const promise = loadProduct(uuid).then(result => { cache.set(uuid, { result, at:Date.now() }); return result; }).finally(() => inFlight.delete(uuid));
    inFlight.set(uuid, promise);
    return promise;
  }
  async function fixProduct(uuid) {
    requireAccess();
    if (fixing.has(uuid)) return;
    fixing.add(uuid);
    try {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      if (!csrf) throw new Error('CSRF-token ontbreekt; herlaad de pagina');
      const result = await inspect(uuid, true);
      if (result.state !== 'orange') return result;
      const ids = result.rows.map(row => String(row.stockId || ''));
      if (ids.some(id => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('Ongeldige of dubbele voorraadregels');
      const others = result.rows.filter(row => row !== result.winner).sort((a,b) => (a.prio ?? 9999) - (b.prio ?? 9999) || a.loc.localeCompare(b.loc));
      const plan = [result.winner, ...others];
      for (let i = 0; i < plan.length; i++) {
        if (plan[i].prio === i + 1) continue;
        const text = await request('/picklocations/change_prio', { method:'POST', headers, body:new URLSearchParams({ stock_id:String(plan[i].stockId), _token:csrf, new_prio:String(i+1) }).toString() });
        if (/^\s*</.test(text)) throw new Error('Onverwacht antwoord bij opslaan');
        if (text.trim()) {
          let data; try { data = JSON.parse(text); } catch { throw new Error('Onbekend antwoord bij opslaan'); }
          if (data === false || data?.success === false || data?.error || data?.status === 'error') throw new Error('Opslaan geweigerd');
        }
      }
      cache.delete(uuid);
      const updated = await inspect(uuid, true);
      if (!plan.every((row,i) => updated.rows.find(item => String(item.stockId) === String(row.stockId))?.prio === i+1)) throw new Error('Prioriteiten niet volledig bevestigd; controleer opnieuw');
      return updated;
    } finally { fixing.delete(uuid); cache.delete(uuid); }
  }
  // Only row discovery/placement differs between the two list layouts.
  function listRows() {
    const found = [];
    const $ = window.jQuery;
    if (/^\/goods\/inbound(?:\/|$)/.test(window.location.pathname) && $?.fn?.dataTable?.isDataTable?.('#goodsBatchDatatable')) {
      const dt = $('#goodsBatchDatatable').DataTable();
      for (const tr of dt.rows({ page:'current' }).nodes().toArray()) {
        const data = dt.row(tr).data();
        const cell = tr.querySelector('td.goodsProductName') || tr.querySelector('td:nth-child(3)');
        if (cell) found.push({ tr, cell, uuid:data?.productUuid, name:data?.productName || cell.textContent, inbound:true });
      }
    }
    for (const cell of document.querySelectorAll('td.productNameVal')) {
      const tr = cell.closest('tr');
      if (!tr || found.some(row => row.tr === tr)) continue;
      const uuid = tr.querySelector('input.products[data-uuid]')?.dataset.uuid || tr.querySelector('a[href*="/products/view/"]')?.getAttribute('href')?.match(/\/products\/view\/([a-f0-9-]+)/i)?.[1];
      found.push({ tr, cell, uuid, name:cell.textContent });
    }
    return found;
  }
  function paintRow(row, state, text, action = null) {
    if (!row.tr.isConnected || rowStates.get(row.tr)?.uuid !== row.uuid) return;
    let button = row.cell.querySelector('.gg-prio-row-action');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'gg-prio-row-action';
      // Inbound: keep the badge beside EAN, never in the picklocation cell.
      const walker = row.inbound ? document.createTreeWalker(row.cell, NodeFilter.SHOW_TEXT) : null;
      let anchor;
      while (walker?.nextNode()) { if (walker.currentNode.nodeValue.includes('EAN:')) { anchor = walker.currentNode; break; } }
      if (anchor) anchor.parentNode.insertBefore(button, anchor.nextSibling);
      else (row.cell.querySelector('.d-inline-flex.align-items-center') || row.cell).append(button);
    }
    row.tr.classList.remove('gg-prio-gray','gg-prio-green','gg-prio-orange');
    row.tr.classList.add('gg-prio-' + state);
    button.textContent = text; button.disabled = !action;
    button.title = action ? 'WaGro op 1 zetten en overige locaties hernummeren' : text;
    button.onclick = action ? event => { event.preventDefault(); event.stopPropagation(); action(); } : null;
  }
  function showResult(row, result) {
    paintRow(row, result.state, !result.winner ? 'WaGro niet gevonden' : 'WaGro prio ' + (result.winner.prio ?? '?'), result.state === 'orange' ? async () => {
      if (!allowed() || fixing.has(row.uuid)) return;
      paintRow(row, 'gray', 'WaGro aanpassen…');
      try { await fixProduct(row.uuid); }
      catch (error) { paintRow(row, 'orange', 'WaGro: ' + error.message, () => { rowStates.delete(row.tr); scheduleScan(); }); return; }
      for (const current of listRows()) if (current.uuid === row.uuid) rowStates.delete(current.tr);
      scheduleScan();
    } : null);
  }
  let scanning = false, scanAgain = false, timer;
  async function scan() {
    if (scanning) { scanAgain = true; return; }
    scanning = true;
    try {
      for (const row of listRows()) {
        const eligible = allowed() && row.uuid && targetRe.test(row.name);
        if (!eligible) {
          row.cell.querySelector('.gg-prio-row-action')?.remove();
          row.tr.classList.remove('gg-prio-gray','gg-prio-green','gg-prio-orange'); rowStates.delete(row.tr); continue;
        }
        if (rowStates.get(row.tr)?.uuid === row.uuid && row.cell.querySelector('.gg-prio-row-action')) continue;
        rowStates.set(row.tr, { uuid:row.uuid });
        paintRow(row, 'gray', 'WaGro controleren…');
        try {
          const result = await inspect(row.uuid);
          if (allowed() && listRows().some(item => item.tr === row.tr && item.uuid === row.uuid)) showResult(row, result);
        } catch (error) {
          paintRow(row, 'gray', 'WaGro: controle mislukt', () => { rowStates.delete(row.tr); scheduleScan(); });
        }
      }
    } finally { scanning = false; if (scanAgain) { scanAgain = false; scheduleScan(); } }
  }
  function scheduleScan() { clearTimeout(timer); timer = setTimeout(scan, 150); }
  function bootLists() {
    const style = document.createElement('style');
    style.textContent = '.gg-prio-gray{background:#f1f3f5!important}.gg-prio-green{background:#d4edda!important}.gg-prio-orange{background:#ffe8b3!important}.gg-prio-row-action{margin-left:6px;padding:2px 6px;border:1px solid #cbd5df;border-radius:4px;font:11px/1.3 system-ui;color:#25313b;background:transparent;cursor:pointer}.gg-prio-row-action:disabled{opacity:1;cursor:default}';
    document.head.append(style);
    new MutationObserver(scheduleScan).observe(document.body, { childList:true, subtree:true, characterData:true });
    setInterval(scheduleScan, 2000); scheduleScan();
  }
  function getState() {
    if (!allowed()) return { ready:false, reason:'Geen toegang via de core' };
    if (/^\/products\/view\//.test(window.location.pathname)) return productState();
    if (listRows().some(row => targetRe.test(row.name))) return { ready:true, reason:'WaGro-controle actief per productregel; klik op een afwijkende prioriteit in de lijst' };
    return { ready:false, reason:'Open een productpagina, productvoorraadlijst of inboundlijst' };
  }
  function run() {
    if (!getState().ready) return;
    if (/^\/products\/view\//.test(window.location.pathname)) runProduct();
    else if (allowed()) {
      const first = document.querySelector('.gg-prio-row-action:not(:disabled)');
      first?.scrollIntoView({ block:'center', behavior:'smooth' }); first?.focus(); scheduleScan();
    }
  }
  window.__ggWaGroPrio = { version:'1.1.0', getState, run };
  if (document.body) bootLists();
  else document.addEventListener('DOMContentLoaded', bootLists, { once:true });
})();
