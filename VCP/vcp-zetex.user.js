// ==UserScript==
// @name         VCP | Zetex
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.3
// @description  Vergelijk local stock met Zetex B2B-stock op EAN — knop/progress via StockKit, badges, logboek.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @connect      b2b.zetex.nl
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-zetex.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:   'both',    // 'console' | 'logboek' | 'both' | 'off'
      perMaat:  'console', // console-tabel per rij (EAN)
      debug:    false,
    },
    uiDelayMs: 80,
    ZETEX_BASE_URL: 'https://b2b.zetex.nl',
    ZETEX_PRODUCT_PREFIX: '/webstore/v2/product/Zetex_01',
  };

  const $ = (s, r = document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  const LOG_PREFIX = '[Zetex Proxy]';

  // Cache: Map<supplierPid -> Map<EAN -> remoteLevel>>
  const PID_CACHE = new Map();

  // ---------- Logger ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    _on(mode, kind) {
      const m = (CONFIG.LOG[kind] || 'off').toLowerCase();
      return m === mode || m === 'both';
    },
    status(id, txt) {
      const sid = String(id);
      if (this._on('console', 'status')) console.info(`${LOG_PREFIX}[${sid}] status: ${txt}`);
      if (this._on('logboek', 'status')) {
        const lb = this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
          unsafeWindow.voegLogregelToe(sid, txt);
        }
      }
    },
    perMaat(id, report) {
      if (!this._on('console', 'perMaat')) return;
      console.groupCollapsed(`${LOG_PREFIX}[${id}] EAN-vergelijking`);
      try {
        const rows = report.map(r => ({
          ean: r.ean,
          local: r.local,
          remote: r.sup,
          status: r.actie,
        }));
        console.table(rows);
      } finally {
        console.groupEnd();
      }
    },
    debug(...a) {
      if (CONFIG.LOG.debug) console.info(`${LOG_PREFIX}[debug]`, ...a);
    }
  };

  // ---------- Helpers Zetex PID & HTTP ----------

  function gmGetPromise(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (resp) => {
          if (resp.status >= 200 && resp.status < 300) {
            resolve(resp.responseText);
          } else {
            reject(new Error(`HTTP ${resp.status} bij ophalen ${url}`));
          }
        },
        onerror: (err) => reject(err || new Error('Netwerkfout')),
      });
    });
  }

  /**
   * Splits "23222-600-6-710" → { base: "23222-600-6", color: "710" }
   */
  function splitSupplierPid(rawPid) {
    const pid = String(rawPid || '').trim();
    if (!pid) return null;

    const idx = pid.lastIndexOf('-');
    if (idx === -1) return null;

    return {
      base: pid.slice(0, idx),
      color: pid.slice(idx + 1),
    };
  }

  function buildProductUrlFromPidParts(parts) {
    if (!parts || !parts.base || !parts.color) return null;
    return (
      CONFIG.ZETEX_BASE_URL +
      CONFIG.ZETEX_PRODUCT_PREFIX +
      '/' +
      encodeURIComponent(parts.base) +
      '/' +
      encodeURIComponent(parts.color)
    );
  }

function extractDataUrlFromProductHtml(html) {
  // Decodeer typische escapes uit Wicket/JSON:
  let txt = String(html || '');
  txt = txt.replace(/\\u003f/gi, '?');   // \u003f → ?
  txt = txt.replace(/\\\//g, '/');      // \/ → /

  const patterns = [
    // klassieke variant: wicketAjaxGet('...')
    /wicketAjaxGet\('([^']*IBehaviorListener\.3-[^']*)'/,

    // Wicket.Ajax.ajax({"u":"..."})
    /"u":"([^"]*IBehaviorListener\.3-[^"]*)"/,

    // fallback: elk quoted pad naar de product-URL met IBehaviorListener.3-
    /["'](\/webstore\/v2\/product\/Zetex_01\/[^"']*IBehaviorListener\.3-[^"']*)["']/
  ];

  for (const re of patterns) {
    const m = re.exec(txt);
    if (!m) continue;

    let url = m[1];

    // Voor de zekerheid nog een keer slashes normaliseren
    url = url.replace(/\\\//g, '/');

    if (url.startsWith('/')) {
      url = CONFIG.ZETEX_BASE_URL + url;
    } else if (!/^https?:\/\//i.test(url)) {
      url = CONFIG.ZETEX_BASE_URL.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
    }

    return url;
  }

  // Niets gevonden
  return null;
}

  // ---------- Stock mapping (exact jouw regels) ----------

  // Zetex quantity → 0 / 2 / 3 / 5
  function mapFreeToLevel(free) {
    const n = Number(free ?? 0) || 0;

    if (n <= 2) return 0;  // 0, 1 of 2 → geen stock
    if (n === 3) return 2; // 2 stuks
    if (n === 4) return 3; // 3 stuks

    return 5;              // 5 of meer
  }

  // ---------- Zetex XML → Map<EAN -> level> ----------

  function parseEanMapFromWicketXml(xmlText) {
    // Extract `"sizes":{ ... },"assortments"`
    const m = xmlText.match(/"sizes":\s*\{([\s\S]*?)\},"assortments"/);
    if (!m) {
      console.warn(LOG_PREFIX, 'Geen "sizes" blok gevonden in response');
      return new Map();
    }

    let sizesStr = '{' + m[1] + '}';
    // caretjes uit Wicket-string weghalen
    sizesStr = sizesStr.replace(/\^/g, '');

    let sizesObj;
    try {
      sizesObj = JSON.parse(sizesStr);
    } catch (e) {
      console.error(LOG_PREFIX, 'JSON parse fout op sizesStr:', e, sizesStr);
      return new Map();
    }

    const sizeList = Array.isArray(sizesObj.sizeList)
      ? sizesObj.sizeList
      : [];

    const map = new Map();

    sizeList.forEach((item) => {
      const eanDigits = String(item.eanCode || '').replace(/\D/g, '');
      if (!eanDigits) return;

      let qtyRaw = 0;
      const stockLevels = item.stockLevels && item.stockLevels.stockLevelList;
      if (Array.isArray(stockLevels) && stockLevels.length) {
        const lvl = stockLevels[0];
        if (lvl && typeof lvl.quantity !== 'undefined') {
          qtyRaw = Number(lvl.quantity) || 0;
        }
      }

      const level = mapFreeToLevel(qtyRaw);
      map.set(eanDigits, level);
    });

    Logger.debug('Zetex EAN-map size:', map.size);
    return map;
  }

  async function fetchEanMapForPid(supplierPid) {
    if (PID_CACHE.has(supplierPid)) {
      Logger.debug('Gebruik PID-cache voor', supplierPid);
      return PID_CACHE.get(supplierPid);
    }

    const parts = splitSupplierPid(supplierPid);
    if (!parts) throw new Error(`Onverwacht PID-formaat: ${supplierPid}`);

    const productUrl = buildProductUrlFromPidParts(parts);
    if (!productUrl) throw new Error(`Geen product-URL voor PID ${supplierPid}`);

    Logger.debug('Product URL voor PID', supplierPid, '→', productUrl);

    const productHtml = await gmGetPromise(productUrl);
    const dataUrl = extractDataUrlFromProductHtml(productHtml);
    if (!dataUrl) throw new Error(`Geen IBehaviorListener.3- URL gevonden voor PID ${supplierPid}`);

    Logger.debug('Data URL voor PID', supplierPid, '→', dataUrl);

    const xmlText = await gmGetPromise(dataUrl);
    const map = parseEanMapFromWicketXml(xmlText);

    PID_CACHE.set(supplierPid, map);
    return map;
  }

  // ---------- Vergelijking / badges ----------

  function setBadge(table, status) {
    const b = window.StockKit?.Badges;
    if (b?.setForTable) { b.setForTable(table, status); return; }
    // fallback
    const th = table.querySelector('thead th[colspan], thead tr:first-child th:last-child, thead th');
    if (!th) return;
    let tag = th.querySelector('.sk-badge');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'sk-badge';
      tag.style.cssText = 'margin-left:8px;padding:2px 6px;border-radius:10px;font-size:12px;vertical-align:middle';
      th.appendChild(tag);
    }
    const palette = {
      'ok':            { bg: '#e7f7ee', fg: '#1b7f44', txt: 'OK' },
      'afwijking':     { bg: '#fff4d6', fg: '#8a6d00', txt: 'Afwijking' },
      'niet-gevonden': { bg: '#fde2e1', fg: '#a11a16', txt: 'Niet gevonden' },
    };
    const p = palette[status] || palette.ok;
    tag.textContent = p.txt; tag.style.background = p.bg; tag.style.color = p.fg;
  }

  // Bepaal kolomindices o.b.v. header (EAN & stock)
  function getColumnIndices(table) {
    const headerRow = table.querySelector('thead tr:last-child');
    if (!headerRow) return { eanCol: 2, stockCol: 1 }; // fallback: Size, Stock, EAN

    const ths = Array.from(headerRow.children);
    let eanCol = -1;
    let stockCol = -1;

    ths.forEach((th, idx) => {
      const txt = (th.textContent || '').trim().toLowerCase();
      if (eanCol === -1 && txt.includes('ean')) eanCol = idx;
      if (stockCol === -1 && (txt.includes('stock') || txt.includes('voorraad'))) stockCol = idx;
    });

    if (eanCol < 0) eanCol = 2;
    if (stockCol < 0) stockCol = 1;

    return { eanCol, stockCol };
  }

  // Vergelijk lokale tabel met Zetex-map op EAN
  function applyRulesAndMarkFromEAN(localTable, eanMap) {
    const { eanCol, stockCol } = getColumnIndices(localTable);
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let hits = 0;

    rows.forEach(row => {
      const eanCell   = row.children[eanCol];
      const stockCell = row.children[stockCol];

      const rawEanTxt = (eanCell?.textContent || '').trim();
      const eanDigits = rawEanTxt.replace(/\D/g, ''); // alleen cijfers
      const local     = parseInt((stockCell?.textContent || '').trim(), 10) || 0;

      const remoteRaw = eanDigits ? eanMap.get(eanDigits) : undefined;
      const remoteNum = Number(remoteRaw ?? 0);
      const isAvail   = remoteNum > 0;

      if (eanDigits && remoteRaw !== undefined) hits++;

      // reset styles
      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green', 'status-red');
      delete row.dataset.status;

      let actie = 'negeren';
      if (local > 0 && !isAvail) {
        row.style.background = '#f8d7da';
        row.title = `Uitboeken (Zetex: 0 — EAN ${eanDigits || 'onbekend'})`;
        row.dataset.status = 'remove';
        row.classList.add('status-red');
        actie = 'uitboeken';
      } else if (local === 0 && isAvail) {
        row.style.background = '#d4edda';
        row.title = `Bijboeken 2 (Zetex >0 — EAN ${eanDigits || 'onbekend'})`;
        row.dataset.status = 'add';
        row.classList.add('status-green');
        actie = 'bijboeken_2';
      }

      report.push({ ean: eanDigits || rawEanTxt, local, sup: remoteNum, actie });
    });

    return { report, hits };
  }

  function bepaalLogStatus(report, hits) {
    const counts = report.reduce((a, r) => {
      a[r.actie] = (a[r.actie] || 0) + 1;
      return a;
    }, {});
    const remoteLeeg = hits === 0;
    if (remoteLeeg) return 'niet-gevonden';
    if ((counts.uitboeken || 0) === 0 && (counts.bijboeken_2 || 0) === 0) return 'ok';
    return 'afwijking';
  }

  // ---------- UI helpers ----------

  function ensureStockKitCss() {
    if (document.getElementById('stockkit-css')) return;
    const link = document.createElement('link');
    link.id = 'stockkit-css';
    link.rel = 'stylesheet';
    link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
    document.head.appendChild(link);
  }

  function injectDisabledStyle() {
    if (document.getElementById('zetex-proxy-disabled-style')) return;
    const style = document.createElement('style');
    style.id = 'zetex-proxy-disabled-style';
    style.textContent = `
      #check-zetex-proxy-btn[disabled] {
        background: #ccc !important;
        border-color: #bbb !important;
        color: #666 !important;
        cursor: not-allowed !important;
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  function normStr(s){
    return String(s||'')
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu,'')
      .replace(/[_\s-]+/g,'')
      .trim();
  }

  function isZetexSelected(){
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return true; // geen select → altijd tonen
    const v = normStr(sel.value);
    const t = normStr(sel.options[sel.selectedIndex]?.textContent || '');
    return (
      v.includes('zetex') || t.includes('zetex') ||
      v.includes('pastunette') || t.includes('pastunette')
    );
  }

  // ---------- Main run ----------

  async function run(btn) {
    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) {
      alert('Geen tabellen gevonden in #output.');
      return;
    }

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    let totalMutations = 0;
    let ok = 0;
    let fail = 0;
    let idx = 0;

    for (const table of tables) {
      idx++;
      const supplierPid = (table.id || '').trim();
      const headerText = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
      const anchorId   = supplierPid || (table.id || '').trim() || headerText || `table-${idx}`;

      if (!supplierPid) {
        Logger.status(anchorId, 'geen_supplier_pid_in_table_id');
        setBadge(table, 'niet-gevonden');
        fail++;
        progress.setDone(idx);
        await delay(CONFIG.uiDelayMs);
        continue;
      }

      try {
        Logger.debug('Tabel', anchorId, 'Supplier PID (from id):', supplierPid);

        const eanMap = await fetchEanMapForPid(supplierPid);
        if (!eanMap || eanMap.size === 0) {
          Logger.status(anchorId, 'geen_remote_data');
          setBadge(table, 'niet-gevonden');
          fail++;
          progress.setDone(idx);
          await delay(CONFIG.uiDelayMs);
          continue;
        }

        const { report, hits } = applyRulesAndMarkFromEAN(table, eanMap);
        const diffs = report.filter(r => r.actie === 'uitboeken' || r.actie === 'bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, hits);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);
        setBadge(table, status);

        ok++;
      } catch (e) {
        console.error(`${LOG_PREFIX} fout in tabel ${anchorId}:`, e);
        Logger.status(anchorId, 'afwijking');
        setBadge(table, 'afwijking');
        fail++;
      }

      progress.setDone(idx);
      await delay(CONFIG.uiDelayMs);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) {
      console.info(
        `${LOG_PREFIX} verwerkt: ${ok + fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`
      );
    }
  }

  // ---------- Toolbar ----------

  function addToolbar() {
    if (document.getElementById('zetex-proxy-toolbar')) return;

    ensureStockKitCss();
    injectDisabledStyle();

    const bar = document.createElement('div');
    bar.id = 'zetex-proxy-toolbar';
    bar.style.cssText = `
      position:fixed;
      top:8px;
      right:298px;
      z-index:9999;
      display:none;
      gap:8px;
      align-items:center;
      font-size:13px;
    `;

    const btn = document.createElement('button');
    btn.id = 'check-zetex-proxy-btn';
    btn.className = 'sk-btn';
    btn.textContent = '🔍 Check Stock Zetex';
    btn.disabled = false;
    btn.title = 'Vergelijk lokale stock met Zetex B2B';

    btn.addEventListener('click', () => run(btn));

    bar.appendChild(btn);
    document.body.appendChild(bar);

    const outputHasTables = () => !!document.querySelector('#output table');

    function toggle() {
      const show = outputHasTables() && isZetexSelected();
      bar.style.display = show ? 'flex' : 'none';
    }

    const out = $('#output');
    if (out) new MutationObserver(toggle).observe(out, { childList: true, subtree: true });

    const supplierSel = document.querySelector('#leverancier-keuze');
    if (supplierSel) {
      supplierSel.addEventListener('change', toggle);
      new MutationObserver(toggle).observe(supplierSel, { childList: true, subtree: true, attributes: true });
    }

    toggle();
  }

  (document.readyState === 'loading')
    ? document.addEventListener('DOMContentLoaded', addToolbar)
    : addToolbar();
})();
