// ==UserScript==
// @name         Stock Check | Van de Velde
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1
// @description  Vergelijk DDO-voorraad van Primadonna en Mariejo exact op EAN met Van de Velde.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @run-at       document-idle
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      b2b-api.vandeveldeservice.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-van-de-velde.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-van-de-velde.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR = g.StockRules;
  const API_BASE = 'https://b2b-api.vandeveldeservice.com/gateway/products/';
  const SUPPLIER_KEYS = new Set(['primadonna', 'mariejo']);
  const MAX_LOCAL_STOCK = 5;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-van-de-velde',
      name: 'Stock Check | Van de Velde',
      version: typeof GM_info !== 'undefined' ? GM_info.script.version : '1.1'
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  registerUserscript();

  if (!Core || !SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[Stock Check | Van de Velde] VCPCore of StockRules ontbreekt.');
    return;
  }

  // Van de Velde kapt de zichtbare voorraad af op 5: een remote waarde van 5
  // betekent dus "5 of meer". Behoud voor 0-4 de centrale veiligheidsmapping,
  // maar laat de afgekapt weergegeven 5 ook lokaal als doelvoorraad 5 gelden.
  if (typeof SR.setSupplierMapper === 'function' && typeof SR.mapStock === 'function') {
    const vanDeVeldeStockMapper = remote => {
      const quantity = Math.max(0, Math.trunc(Number(remote) || 0));
      return quantity >= 5 ? 5 : SR.mapStock(quantity);
    };
    SR.setSupplierMapper('primadonna', vanDeVeldeStockMapper);
    SR.setSupplierMapper('mariejo', vanDeVeldeStockMapper);
  }

  const exactEan = value => String(value ?? '').trim();
  const localStock = row => Math.max(0, parseInt(String(row.children?.[1]?.textContent || '0').trim(), 10) || 0);
  const localEan = row => exactEan(row.children?.[row.children.length - 1]?.textContent || '');

  function selectedSupplierKey() {
    return String(document.querySelector('#leverancier-keuze')?.value || '').trim().toLowerCase();
  }

  function logStatus(id, status) {
    const logbook = g.logboek;
    if (logbook && typeof logbook.resultaat === 'function') logbook.resultaat(String(id), status);
    else console.info(`[Van de Velde][${id}] status: ${status}`);
  }

  function fetchProduct(productId) {
    const url = API_BASE + encodeURIComponent(productId);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20000,
        headers: { Accept: 'application/json' },
        onload(response) {
          if (response.status === 404) {
            resolve(null);
            return;
          }
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Van de Velde API gaf HTTP ${response.status} voor ${productId}.`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText || 'null'));
          } catch {
            reject(new Error(`Van de Velde API gaf ongeldige JSON voor ${productId}.`));
          }
        },
        onerror: () => reject(new Error(`Van de Velde API is niet bereikbaar voor ${productId}.`)),
        ontimeout: () => reject(new Error(`Van de Velde API-time-out voor ${productId}.`))
      });
    });
  }

  function stockByExactEan(product) {
    const result = new Map();
    for (const sku of Array.isArray(product?.skus) ? product.skus : []) {
      const ean = exactEan(sku?.ean);
      if (!ean) continue;
      const stock = Math.max(0, Math.trunc(Number(sku?.stock) || 0));
      if (result.has(ean) && result.get(ean) !== stock) {
        throw new Error(`Van de Velde gaf meerdere voorraadwaarden voor EAN ${ean}; vergelijking afgebroken.`);
      }
      result.set(ean, stock);
    }
    return result;
  }

  function markComparison(row, supplierKey, remote, found) {
    const local = localStock(row);
    const target = SR.mapRemoteToTarget(supplierKey, remote, MAX_LOCAL_STOCK);
    const result = SR.reconcile(local, target, MAX_LOCAL_STOCK);
    const suffix = found ? 'exacte EAN-match' : 'EAN niet gevonden; remote 0';
    const action = result.action === 'bijboeken' ? 'add' : result.action === 'uitboeken' ? 'remove' : 'none';

    Core.markRow(row, {
      action,
      delta: result.delta,
      remote,
      target,
      title: `${result.action === 'ok' ? 'OK' : result.action} (target ${target}, remote ${remote}, ${suffix})`
    });

    return {
      ean: localEan(row),
      local,
      remote,
      target,
      delta: result.delta,
      status: result.action,
      match: found ? 'exact-ean' : 'niet-gevonden'
    };
  }

  async function perTable(table, supplierKey) {
    const productId = String(table.id || '').trim();
    if (!productId) throw new Error('Supplier-ID ontbreekt; API-product kan niet exact worden bepaald.');

    const product = await fetchProduct(productId);
    const stockMap = stockByExactEan(product);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const report = rows.map(row => {
      const ean = localEan(row);
      const found = ean !== '' && stockMap.has(ean);
      return markComparison(row, supplierKey, found ? stockMap.get(ean) : 0, found);
    });

    const foundCount = report.filter(item => item.match === 'exact-ean').length;
    const mutationCount = report.filter(item => item.status !== 'ok').length;
    logStatus(productId, foundCount === 0 ? 'niet-gevonden' : mutationCount ? 'afwijking' : 'ok');
    Core.logReport?.('Van de Velde', productId, report.map(item => ({
      maat: item.ean,
      local: item.local,
      remote: item.remote,
      target: item.target,
      delta: item.delta,
      status: `${item.status} (${item.match})`
    })));
    return mutationCount;
  }

  async function run(button) {
    const supplierKey = selectedSupplierKey();
    if (!SUPPLIER_KEYS.has(supplierKey)) return;
    const tables = Array.from(document.querySelectorAll('#output table'));
    await Core.runTables({
      btn: button,
      tables,
      concurrency: 3,
      perTable: table => perTable(table, supplierKey)
    });
  }

  const { btn } = Core.mountSupplierButton({
    id: 'stock-check-van-de-velde-btn',
    text: 'Controleer Van de Velde',
    match: () => SUPPLIER_KEYS.has(selectedSupplierKey()),
    onClick: run
  });
  btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i>';
  btn.setAttribute('aria-label', 'Controleer voorraad bij Van de Velde');
  btn.title = 'Controleer Primadonna of Mariejo exact op EAN';
})();
