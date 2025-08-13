// ==UserScript==
// @name         Voorraadchecker Proxy - Wacoal Group
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      b2b.wacoal-europe.com
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-wacoal.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-wacoal.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- Config ----------------
  const TIMEOUT = 15000;
  const SUPPORTED_BRANDS = [
    'wacoal', 'freya', 'freya swim',
    'fantasie', 'fantasie swim',
    'elomi', 'elomi swim'
  ];

  // Helpers for brand matching / labeling
  const norm = s => String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');

  function getSelectEl() { return document.querySelector('#leverancier-keuze'); }

  function getSelectedBrandValue() {
    const sel = getSelectEl();
    return sel ? norm(sel.value) : '';
  }

  function getSelectedBrandLabel() {
    const sel = getSelectEl();
    if (!sel) return '';
    const opt = sel.options[sel.selectedIndex];
    const label = (opt?.text || sel.value || '').trim();
    return label || 'Wacoal';
  }

  function isSupportedSelected() {
    const v = getSelectedBrandValue();
    return SUPPORTED_BRANDS.includes(v);
  }

  function buttonLabel() {
    return `🔍 Controleer stock ${getSelectedBrandLabel()}`;
  }

  function logPrefix() {
    return `[${getSelectedBrandLabel()}]`;
  }

  // ---------------- GM fetch JSON ----------------
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        withCredentials: true,
        timeout: TIMEOUT,
        headers: {
          'Accept': 'application/json,text/html;q=0.8,*/*;q=0.5',
          'User-Agent': navigator.userAgent
        },
        onload: (r) => {
          if (r.status >= 200 && r.status < 400) return resolve(r.responseText || '');
          reject(new Error(`HTTP ${r.status}`));
        },
        onerror: reject,
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ---------------- Logboek helpers ----------------
  function getLogboek() {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) return unsafeWindow.logboek;
    return window.logboek;
  }
  function logResultaat(tableOrId, status) {
    const lb = getLogboek();
    if (lb?.resultaat) {
      lb.resultaat(tableOrId, status);
    } else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
      unsafeWindow.voegLogregelToe(String(tableOrId), status);
    } else {
      console.info(`${logPrefix()} (fallback log)`, tableOrId, status);
    }
  }

  // ---------------- Vinkje in header ----------------
  function zetGroenVinkjeOpTabel(tableId) {
    try {
      if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.zetGroenVinkjeOpTabel === 'function') {
        unsafeWindow.zetGroenVinkjeOpTabel(tableId);
        return;
      }
      const table = document.getElementById(tableId);
      if (!table) return;
      const th = table.querySelector('thead tr:first-child th');
      if (!th) return;
      if (!th.querySelector('.header-vinkje')) {
        const span = document.createElement('span');
        span.className = 'header-vinkje';
        span.innerHTML = `<i class="fas fa-check" style="color:#2ecc71; font-size: 18px; float: right; margin-left: 12px; margin-right: 0;"></i>`;
        th.appendChild(span);
      }
    } catch {}
  }

  // ---------------- JSON → Map(maat→{status, stock}) ----------------
  function statusFromWacoal(wacoalStatus, stockLevel) {
    const s = String(wacoalStatus || '').toUpperCase();
    if (s === 'IN_STOCK') return 'IN_STOCK';
    if (s === 'WITHIN_STAGE1' || s === 'WITHIN_STAGE2') return 'LOW';
    if (s === 'OUT_OF_STOCK') return 'OUT_OF_STOCK';
    return (stockLevel > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
  }

  function buildMapFromPdpJson(json) {
    const map = new Map();

    if (!json?.is2DSizing) {
      // 1D: gebruik EU size
      for (const cell of (json?.sizeData || [])) {
        const sizeEU = (cell?.countrySizeMap?.EU || cell?.globalSize || '').toString().trim().toUpperCase();
        if (!sizeEU) continue;
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = cell?.stock?.wacoalstockStatus || (stockLevel > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
        const status = statusFromWacoal(wacoal, stockLevel);
        map.set(sizeEU, { status, stock: stockLevel });
      }
      return map;
    }

    // 2D: band × cup, EU maps
    for (const row of (json?.sizeData || [])) {
      for (const cell of (row?.sizeFitData || [])) {
        const bandEU = (cell?.countrySizeMap?.EU || '').toString().trim();
        const cupEU  = (cell?.countryFitMap?.EU  || '').toString().trim();
        if (!bandEU || !cupEU) continue;
        const key = `${bandEU}${cupEU}`.toUpperCase();
        const stockLevel = Number(cell?.stock?.stockLevel ?? 0) || 0;
        const wacoal = cell?.stock?.wacoalstockStatus || (stockLevel > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
        const status = statusFromWacoal(wacoal, stockLevel);
        map.set(key, { status, stock: stockLevel });
      }
    }
    return map;
  }

  // ---------------- Vergelijk & markeer ----------------
  function compareAndMark(table, map) {
    if (!table || !map) return { diffs: 0 };

    let diffs = 0;
    const rows = table.querySelectorAll('tbody tr');
    const entries = [];

    rows.forEach(row => {
      const sizeTd  = row.querySelector('td:nth-child(1)');
      const stockTd = row.querySelector('td:nth-child(2)');
      const eanTd   = row.querySelector('td:nth-child(3)');

      const localSizeRaw = (sizeTd?.textContent || '').trim().toUpperCase();
      const localStock   = parseInt((stockTd?.textContent || '0').trim(), 10) || 0;

      const keyEU = localSizeRaw;
      const remote = map.get(keyEU);
      const remoteStatus = remote?.status || '-';
      const remoteStock  = remote?.stock ?? 0;

      // Reset
      [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = ''));
      delete row.dataset.status;

      // Regels
      if (localStock === 0 && remoteStatus === 'IN_STOCK') {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#93C47D')); // groen
        row.dataset.status = 'add';
        diffs++;
      } else if (localStock > 0 && (remoteStatus === 'OUT_OF_STOCK' || remoteStatus === 'LOW')) {
        [sizeTd, stockTd, eanTd].forEach(td => td && (td.style.background = '#E06666')); // rood
        row.dataset.status = 'remove';
        diffs++;
      }

      entries.push({ maat: localSizeRaw, local: localStock, remote: remoteStatus, remoteStock });
    });

    if (entries.length) {
      console.groupCollapsed(`${logPrefix()} Overzicht voor #${table.id}`);
      console.table(entries);
      console.groupEnd();
    }

    return { diffs };
  }

  // ---------------- Main loop ----------------
  async function runAll(btn) {
    // Progress via StockKit (fallback als kit niet laad)
    const progress = window.StockKit ? StockKit.makeProgress(btn) : {
      start(){ btn.disabled=true; btn.textContent='⏳ Bezig'; btn.classList.add('is-busy'); },
      setTotal(){}, setDone(){}, tick(){},
      success(msg){ btn.disabled=false; btn.classList.remove('is-busy'); btn.textContent=msg; setTimeout(()=>btn.textContent=buttonLabel(),1200); },
      fail(msg){ btn.disabled=false; btn.classList.remove('is-busy'); btn.textContent=msg; setTimeout(()=>btn.textContent=buttonLabel(),1200); }
    };

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) { alert('Geen tabellen in #output gevonden.'); return; }

    progress.start(tables.length);

    let ok = 0, afwijking = 0, fouten = 0, idx = 0;

    for (const table of tables) {
      idx++;

      const pid = (table.id || '').trim();
      if (!pid) {
        logResultaat('onbekend', 'niet-gevonden');
        progress.setDone(idx);
        continue;
      }

      try {
        const url = `https://b2b.wacoal-europe.com/b2b/en/EUR/json/pdpOrderForm?productCode=${encodeURIComponent(pid)}`;
        console.log(`${logPrefix()} JSON URL:`, url);

        const jsonText = await gmFetch(url);
        const json = JSON.parse(jsonText);

        const map = buildMapFromPdpJson(json);
        const { diffs } = compareAndMark(table, map);

        if (diffs > 0) {
          afwijking++; logResultaat(pid, '⚠️ Stock wijkt af!');
        } else {
          ok++;        logResultaat(pid, '✅ Stock Ok!');
        }
        zetGroenVinkjeOpTabel(pid);
      } catch (e) {
        console.error(`${logPrefix()} Fout bij`, pid, e);
        fouten++; logResultaat(pid, 'afwijking');
      }

      progress.setDone(idx);
    }

    console.info(`${logPrefix()} Klaar. Verwerkt=${tables.length} | Ok=${ok} | Afwijking=${afwijking} | Fouten=${fouten}`);
    progress.success(`✅ Klaar (${tables.length} tabellen)`);
  }

  // ---------------- UI knop (met StockKit-styling) ----------------
  function addButton() {
    if (document.getElementById('stockcheck-btn')) return;

    // (Optioneel) centrale CSS — alleen nodig als je nog geen globale .sk-btn styles hebt ingeladen
    if (!document.getElementById('stockkit-css')) {
      const link = document.createElement('link');
      link.id = 'stockkit-css';
      link.rel = 'stylesheet';
      link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn = document.createElement('button');
    btn.id = 'stockcheck-btn';
    btn.className = 'sk-btn';
    btn.textContent = buttonLabel();

    Object.assign(btn.style, {
      position: 'fixed',
      zIndex: '9999',
      display: 'none'
    });

    btn.addEventListener('click', () => runAll(btn));
    document.body.appendChild(btn);

    const $ = (sel) => document.querySelector(sel);
    function outputHasTables() { return !!$('#output') && $('#output').querySelector('table') !== null; }
    function toggleButtonVisibility() {
      btn.textContent = buttonLabel(); // update label op elk moment
      btn.style.display = (isSupportedSelected() && outputHasTables()) ? 'block' : 'none';
    }

    const out = $('#output');
    if (out) new MutationObserver(toggleButtonVisibility).observe(out, { childList: true, subtree: true });
    const select = $('#leverancier-keuze');
    if (select) select.addEventListener('change', toggleButtonVisibility);
    const upload = $('#upload-container');
    if (upload) new MutationObserver(toggleButtonVisibility).observe(upload, { attributes: true, attributeFilter: ['style', 'class'] });

    toggleButtonVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
