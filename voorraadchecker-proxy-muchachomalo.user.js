// ==UserScript==
// @name         Voorraadchecker Proxy - Muchachomalo
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      agent.muchachomalo.com
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js?v=2025-08-13-1
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-muchachomalo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-muchachomalo.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    BASE_URL: 'https://agent.muchachomalo.com/en/shop.htm',
    SUPPLIER_VALUE: 'muchachomalo',
    REMOTE_QTY_THRESHOLD: 5,
    AGGREGATE: 'max',
    MAX_PAGES: 200,
    TIMEOUT_MS: 20000,
    LOCAL_TABLES_SELECTOR: '#output table',
    VENDOR_SELECTORS: {
      productCard: '.catalogArticle',
      sizeInputs: 'input.size-quantity[data-size][max][data-articleid]'
    }
  };

  function getLogboek() {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) return unsafeWindow.logboek;
    return window.logboek;
  }
  function logResultaat(tableOrId, status) {
    const lb = getLogboek();
    if (lb?.resultaat) lb.resultaat(tableOrId, status);
    else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(tableOrId), status);
    else console.info('[Muchachomalo] (fallback log)', tableOrId, status);
  }
  function zetGroenVinkjeOpTabel(tableId) {
    try {
      if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.zetGroenVinkjeOpTabel === 'function') { unsafeWindow.zetGroenVinkjeOpTabel(tableId); return; }
      const table = document.getElementById(tableId); if (!table) return;
      const th = table.querySelector('thead tr:first-child th'); if (!th) return;
      if (!th.querySelector('.header-vinkje')) {
        const span = document.createElement('span');
        span.className = 'header-vinkje';
        span.innerHTML = `<i class="fas fa-check" style="color:#2ecc71; font-size: 18px; float: right; margin-left: 12px;"></i>`;
        th.appendChild(span);
      }
    } catch {}
  }

  function gmFetchHtml(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        withCredentials: true,
        timeout: CONFIG.TIMEOUT_MS,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': navigator.userAgent
        },
        onload: (r) => {
          if (r.status >= 200 && r.status < 400) return resolve(r.responseText || '');
          reject(new Error(`HTTP ${r.status} @ ${url}`));
        },
        onerror: reject,
        ontimeout: () => reject(new Error('Timeout'))
      });
    });
  }

  function findPidInCard(card, wantedPids) {
    const text = (card.textContent || '');
    const raw  = (card.outerHTML || '');
    for (const pid of wantedPids) {
      const p = String(pid || '').trim();
      if (!p) continue;
      if (text.includes(p) || raw.includes(p)) return p;
    }
    return null;
  }

  function extractProductsFromHTML(html, wantedPids) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll(CONFIG.VENDOR_SELECTORS.productCard);
    const list = [];
    cards.forEach(card => {
      const pid = findPidInCard(card, wantedPids);
      if (!pid) return;
      const inputs = card.querySelectorAll(CONFIG.VENDOR_SELECTORS.sizeInputs);
      const sizes = {};
      inputs.forEach(inp => {
        const size = String(inp.getAttribute('data-size') || '').trim();
        const max = Number(inp.getAttribute('max') || '0') || 0;
        if (size) sizes[size] = max;
      });
      list.push({ article: pid, sizes });
    });
    return list;
  }

  function mergeByArticle(items) {
    const out = new Map(); // article -> {size->qty}
    for (const it of items) {
      const key = String(it.article || '').trim();
      if (!key) continue;
      if (!out.has(key)) out.set(key, {});
      const bucket = out.get(key);
      for (const [sz, qty] of Object.entries(it.sizes || {})) {
        const n = Number(qty) || 0;
        if (!(sz in bucket)) bucket[sz] = n;
        else bucket[sz] = (CONFIG.AGGREGATE === 'sum') ? (bucket[sz] + n) : Math.max(bucket[sz], n);
      }
    }
    return out;
  }

  function compareAndMark(table, vendorMap) {
    if (!table) return { diffs: 0 };

    let diffs = 0;
    const rows = table.querySelectorAll('tbody tr');
    const pid = (table.id || '').trim();
    const remote = vendorMap.get(pid) || {}; // {size->qty}
    const T = Number(CONFIG.REMOTE_QTY_THRESHOLD || 5);

    const entries = [];
    const missing = [];
    const pidExists = vendorMap.has(pid);
    if (!pidExists) console.warn(`[MC] PID niet gevonden in vendorMap: ${pid}`);

    rows.forEach(row => {
      const sizeTd  = row.querySelector('td:nth-child(1)');
      const stockTd = row.querySelector('td:nth-child(2)');
      const eanTd   = row.querySelector('td:nth-child(3)');

      const localSize = (sizeTd?.textContent || '').trim();
      const localVal  = parseInt((stockTd?.textContent || '0').trim(), 10) || 0;

      const keyExact = localSize;
      let rq;
      if (keyExact in remote) {
        rq = remote[keyExact];
      } else if (localSize === '3XL' && ('XXXL' in remote)) {
        rq = remote['XXXL']; // enige uitzondering
      }

      const remoteQty = Number(rq ?? 0) || 0;
      if (rq === undefined) missing.push(localSize);

      [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = ''));
      delete row.dataset.status;

      let mark = null; // 'add' | 'remove'
      if (localVal === 0 && remoteQty > T) mark = 'add';
      else if (localVal > 0 && remoteQty < T) mark = 'remove';

      if (mark === 'add') {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#93C47D'));
        row.dataset.status = 'add';
        diffs++;
      } else if (mark === 'remove') {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#E06666'));
        row.dataset.status = 'remove';
        diffs++;
      }

      entries.push({ maat: localSize, local: localVal, remoteQty, threshold: T, mark: mark || '-' });
    });

    if (!pidExists || missing.length) {
      console.warn(`[MC] Analyse #${pid} → pidExists=${pidExists} | missingSizes=`, missing);
    }

    if (entries.length) {
      console.groupCollapsed(`[Muchachomalo] Overzicht voor #${pid} `);
      console.table(entries);
      console.groupEnd();
    }
    return { diffs };
  }

  async function runAll(btn) {
    // Alleen StockKit — absoluut geen fallback/timeout/reset
    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      console.error('[Muchachomalo] StockKit niet geladen — afgebroken.');
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }
    const progress = StockKit.makeProgress(btn);

    const tables = Array.from(document.querySelectorAll(CONFIG.LOCAL_TABLES_SELECTOR));
    if (!tables.length) { alert('Geen tabellen in #output gevonden.'); return; }

    const wantedPids = Array.from(new Set(tables.map(t => (t.id || '').trim()).filter(Boolean)));
    if (!wantedPids.length) { alert('Geen table.id’s gevonden als PID.'); return; }

    progress.start(tables.length);

    try {
      const allItems = [];

      function countCards(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.querySelectorAll(CONFIG.VENDOR_SELECTORS.productCard).length;
      }
      function pushParsed(html) {
        const items = extractProductsFromHTML(html, wantedPids);
        allItems.push(...items);
        return { matched: items.length, cards: countCards(html) };
      }

      // page 1
      let page = 1;
      let html = await gmFetchHtml(CONFIG.BASE_URL);
      let stats = pushParsed(html);
      console.info(`[Muchachomalo] page ${page}: matched=${stats.matched} | cards=${stats.cards}`);

      // volgende pagina's
      while (page < CONFIG.MAX_PAGES) {
        page++;
        const u = new URL(CONFIG.BASE_URL);
        u.searchParams.set('page', String(page));
        const pageUrl = u.toString();

        try {
          html = await gmFetchHtml(pageUrl);
          stats = pushParsed(html);
          console.info(`[Muchachomalo] page ${page}: matched=${stats.matched} | cards=${stats.cards}`);
          if (stats.cards === 0) break;
        } catch (e) {
          console.warn('[Muchachomalo] stop op page', page, e);
          break;
        }
      }

      const vendorMap = mergeByArticle(allItems);
      console.info('[Muchachomalo] VendorMap keys matched:', vendorMap.size, Array.from(vendorMap.keys()).slice(0, 20));

      let ok = 0, afwijking = 0, fouten = 0;
      let totalChanges = 0;
      let idx = 0;

      for (const table of tables) {
        idx++;
        const pid = (table.id || '').trim();
        if (!pid) { logResultaat('onbekend', 'niet-gevonden'); progress.setDone(idx); continue; }

        try {
          const { diffs } = compareAndMark(table, vendorMap);
          totalChanges += diffs;

          if (diffs > 0) { afwijking++; logResultaat(pid, '⚠️ Stock wijkt af!'); }
          else { ok++; logResultaat(pid, '✅ Stock Ok!'); }
          zetGroenVinkjeOpTabel(pid);
        } catch (e) {
          console.error('[Muchachomalo] Fout bij', pid, e);
          fouten++; logResultaat(pid, 'afwijking');
        }

        progress.setDone(idx);
      }

      console.info(`[Muchachomalo] Klaar. Tabellen=${tables.length} | Ok=${ok} | Afwijking=${afwijking} | Fouten=${fouten} | Mutaties=${totalChanges}`);

      // ENKEL StockKit bepaalt knoptekst; geeft het getal door:
      progress.success(totalChanges);
    } catch (e) {
      console.error('[Muchachomalo] Algemene fout', e);
      progress.fail(); // StockKit bepaalt fouttekst/staat; geen reset/timeout
      alert('Muchachomalo check: er ging iets mis. Zie console.');
    }
  }

  function addButton() {
    if (document.getElementById('muchachomalo-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link = document.createElement('link');
      link.id = 'stockkit-css';
      link.rel = 'stylesheet';
      link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.id = 'muchachomalo-btn';
    btn.className = 'sk-btn';
    btn.textContent = '🔍 Check Stock Muchachomalo';

    Object.assign(btn.style, {
      position: 'fixed',
      zIndex: '9999',
      display: 'none'
    });

    btn.addEventListener('click', () => runAll(btn));
    document.body.appendChild(btn);

    const $ = (sel) => document.querySelector(sel);
    function outputHasTables() { return !!$('#output') && $('#output').querySelector('table') !== null; }
    function isSupplierSelected() {
      const dd = $('#leverancier-keuze');
      return !!dd && dd.value === CONFIG.SUPPLIER_VALUE;
    }
    function toggleButtonVisibility() {
      btn.style.display = (isSupplierSelected() && outputHasTables()) ? 'block' : 'none';
    }

    const out = $('#output');
    if (out) new MutationObserver(toggleButtonVisibility).observe(out, { childList: true, subtree: true });
    const select = $('#leverancier-keuze');
    if (select) select.addEventListener('change', toggleButtonVisibility);
    const upload = $('#upload-container');
    if (upload) new MutationObserver(toggleButtonVisibility).observe(upload, { attributes: true, attributeFilter: ['style', 'class'] });

    toggleButtonVisibility();

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Muchachomalo: Debug vendor keys (sample)', () => {
        console.warn('Tip: na run zie je page logs + vendorMap size in console. Eventueel extra logs in compareAndMark() gebruiken.');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
