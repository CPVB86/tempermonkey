// ==UserScript==
// @name         VCP - After Eden
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0.0
// @description  Vergelijk local stock met remote stock (After Eden) op basis van MAAT. Remote via itemquantitycal. Mapping: remoteQty-4 => 1..5 (remote 0/ontbreekt: negeren; remote 0 maar aanwezig: 1).
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      bcg.fashionportal.shop
// @connect      *
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-aftereden.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-aftereden.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const TIMEOUT = 15000;
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
  const CACHE_PREFIX = 'aftereden_html_cache_v1:'; // + itemNumber
  const BASE = 'https://bcg.fashionportal.shop';
  const STOCK_URL = (itemNumber) =>
    `${BASE}/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;

  const $ = (s, r=document) => r.querySelector(s);

  // ---------- Logger (zoals Wacoal/Lisca) ----------
  const Logger = {
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    status(id, txt, extra){
      console.info(`[AfterEden][${id}] status: ${txt}`, extra||'');
      const lb=this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), txt, extra);
      else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(id), txt);
    },
    perMaat(id, report){
      console.groupCollapsed(`[AfterEden][${id}] maatvergelijking`);
      try{
        const rows = report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: (r.remotePresent ? r.remoteMapped : '—'),
          remoteQty: (r.remotePresent ? r.remoteQty : '—'),
          status: r.actie
        }));
        console.table(rows);
      } finally { console.groupEnd(); }
    }
  };

  // ---------- Net ----------
  function gmFetch(url, responseType='text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        withCredentials: true,
        timeout: TIMEOUT,
        headers: { 'Accept':'text/html,*/*;q=0.8', 'User-Agent': navigator.userAgent },
        onload: r => resolve(r),
        onerror: e => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ---------- Cache ----------
  function cacheKey(itemNumber){ return `${CACHE_PREFIX}${String(itemNumber||'').trim()}`; }
  function loadCache(itemNumber) {
    const raw = GM_getValue(cacheKey(itemNumber), null);
    if (!raw) return null;
    try {
      const { t, data } = JSON.parse(raw);
      return (Date.now() - t <= CACHE_TTL_MS) ? data : null;
    } catch { return null; }
  }
  function saveCache(itemNumber, html) {
    GM_setValue(cacheKey(itemNumber), JSON.stringify({ t: Date.now(), data: html }));
  }

  async function fetchAfterEdenHTML(itemNumber) {
    const cached = loadCache(itemNumber);
    if (cached) return cached;

    const url = STOCK_URL(itemNumber);
    const r = await gmFetch(url, 'text');
    if (r?.status !== 200 || typeof r.responseText !== 'string' || !r.responseText.trim()) {
      throw new Error(`AfterEden HTML HTTP ${r?.status || '??'}`);
    }
    if (r.responseText.trim().startsWith('<') && /login|sign in|unauthorized/i.test(r.responseText)) {
      throw new Error('LOGIN_REQUIRED');
    }
    saveCache(itemNumber, r.responseText);
    return r.responseText;
  }

  // ---------- Normalizers ----------
  function normalizeSize(s) {
    return String(s||'')
      .trim()
      .toUpperCase()
      .replace(/\s+/g,'')
      .replace(/–|—/g,'-');
  }

  // ---------- Mapping (zelfde als scraper) ----------
  // remoteQty:
  // - als <=0 => 1 (maar alleen als maat WEL bestaat in remote matrix)
  // - anders: adjusted=max(0, remoteQty-4)
  //   <2=>1, 2=>2, 3=>3, 4=>4, >=5=>5
  function mapAfterEdenQty(remoteQty){
    const r = Number(remoteQty) || 0;
    if (r <= 0) return 1;
    const adjusted = Math.max(0, r - 4);
    if (adjusted < 2) return 1;
    if (adjusted === 2) return 2;
    if (adjusted === 3) return 3;
    if (adjusted === 4) return 4;
    return 5;
  }

  // ---------- HTML -> Map(size -> {qty,mapped}) ----------
  function parseAfterEdenHTMLtoMap(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    // header: bandmaten
    const headerRow = doc.querySelector('.qty-by-size-3D');
    const bandSizes = headerRow
      ? [...headerRow.querySelectorAll('.size-for.text-center')].map(el => el.textContent.trim()).filter(Boolean)
      : [];

    // rows: cups + cells
    const rows = [...doc.querySelectorAll('.qty-by-size-3D')].slice(1);

    const m = new Map();
    const dbg = [];

    for (const row of rows) {
      const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
      if (!cup) continue;

      const cells = [...row.querySelectorAll('.add-qty-box')];
      cells.forEach((cell, idx) => {
        const band = bandSizes[idx];
        if (!band) return;

        const qtyLimit = cell.querySelector('.qty-limit');
        const remoteQty = qtyLimit ? Number(qtyLimit.getAttribute('data-inventory') || '0') : 0;

        const sizeKey = normalizeSize(`${band}${cup}`);
        const mapped = mapAfterEdenQty(remoteQty);

        m.set(sizeKey, { qty: remoteQty, mapped });

        dbg.push({ size: sizeKey, band, cup, remoteQty, mapped });
      });
    }

    console.groupCollapsed('[AfterEden] Remote matrix parsed');
    console.table(dbg);
    console.groupEnd();

    return m;
  }

  // ---------- Rules & markering ----------
  // Vergelijk op basis van MAAT (eerste kolom).
  // We doen niets met EAN.
  //
  // Belangrijk: remote maat moet bestaan.
  // - missing remote => IGNORE (laat rij ongemoeid)
  //
  // Interpretatie voor verschillen (praktisch, consistent met je “1 = minimaal/low/out”):
  // - remoteMapped === 1 behandelen we als “geen/te laag” (dus remove als local>0)
  // - remoteMapped > 1 behandelen we als “wel voorraad” (dus add als local==0)
  //
  // Kleuren zoals Lisca:
  // - remove: rood
  // - add: groen
  // - ignore missing remote: geen kleur (maar wel in report)
  function applyAfterEdenRulesOnTable(table, remoteMap) {
    let changes = 0;
    const counts = { add:0, remove:0, ignored_missing_remote:0 };
    const rows = table.querySelectorAll('tbody tr');
    const report = [];

    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 2) return;

      const sizeTd  = tds[0];
      const stockTd = tds[1];

      [sizeTd, stockTd].forEach(td => td && (td.style.background = ''));
      row.removeAttribute('data-status');

      const maatRaw = (sizeTd.textContent || '').trim();
      const maat = normalizeSize(maatRaw);

      const local = parseInt((stockTd.textContent || '0').trim(), 10) || 0;

      const remoteObj = remoteMap.get(maat); // undefined als maat niet bestaat bij remote

      if (!remoteObj) {
        counts.ignored_missing_remote++;
        report.push({
          maat: maatRaw,
          maatNorm: maat,
          local,
          remotePresent: false,
          remoteQty: undefined,
          remoteMapped: undefined,
          actie: 'ignored (missing remote)'
        });
        return;
      }

      const remoteMapped = remoteObj.mapped; // 1..5
      const remoteQty = remoteObj.qty;

      let actie = 'none';

      const remoteHasStock = remoteMapped > 1; // 2..5
      const remoteNoStock  = remoteMapped === 1;

      if (local > 0 && remoteNoStock) {
        [sizeTd, stockTd].forEach(td => td && (td.style.background = '#F8D7DA')); // rood
        row.dataset.status = 'remove';
        actie = 'remove';
        counts.remove++; changes++;
      } else if (local === 0 && remoteHasStock) {
        [sizeTd, stockTd].forEach(td => td && (td.style.background = '#D4EDDA')); // groen
        row.dataset.status = 'add';
        actie = 'add';
        counts.add++; changes++;
      }

      report.push({
        maat: maatRaw,
        maatNorm: maat,
        local,
        remotePresent: true,
        remoteQty,
        remoteMapped,
        actie
      });
    });

    return { changes, counts, report };
  }

  // ---------- Main ----------
  async function runAfterEden(btn) {
    const progress = window.StockKit.makeProgress(btn);
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);

    let totalChanges = 0, idx = 0;
    let firstDiffTable = null;

    for (const table of tables) {
      idx++;

      // product-ID = table.id (zoals Wacoal/Lisca)
      const pid = (table.id || '').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
      const anchorId = pid || label;

      if (!pid) {
        Logger.status(anchorId, 'skip (geen product-id op table.id)');
        progress.setDone(idx);
        continue;
      }

      try {
        const html = await fetchAfterEdenHTML(pid);
        const remoteMap = parseAfterEdenHTMLtoMap(html);

        const { changes, counts, report } = applyAfterEdenRulesOnTable(table, remoteMap);
        totalChanges += changes;

        const status = changes > 0 ? 'afwijking' : 'ok';
        Logger.status(anchorId, status, counts);
        Logger.perMaat(anchorId, report);

        if (!firstDiffTable && changes > 0) firstDiffTable = table;
      } catch (e) {
        console.error('[AfterEden] error for pid', pid, e);
        Logger.status(anchorId, '❌ fout', { error: String(e?.message || e) });
      }

      progress.setDone(idx);
    }

    progress.success(totalChanges);

    // Auto-scroll naar eerste afwijking
    if (firstDiffTable) {
      firstDiffTable.scrollIntoView({ behavior:'smooth', block:'center' });
      if (typeof window.jumpFlash === 'function') window.jumpFlash(firstDiffTable);
    }
  }

  // ---------- UI ----------
  function addButton(){
    if (document.getElementById('aftereden-btn')) return;

    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css';
      link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.id='aftereden-btn';
    btn.className='sk-btn';
    btn.textContent='🔍 Check Stock After Eden';
    Object.assign(btn.style,{ position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click', ()=>runAfterEden(btn));
    document.body.appendChild(btn);

    const outputHasTables = ()=> !!document.querySelector('#output')?.querySelector('table');

    function isAfterEdenSelected(){
      const el = document.querySelector('#leverancier-keuze');
      if (!el) return true;
      const v = (el.value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/_/g, '-');
      // accepteer wat varianten
      return v === 'after-eden' || v === 'aftereden' || v.includes('after');
    }

    function isBusy(){ return btn.classList.contains('is-busy'); }
    function isTerminal(){
      const t=(btn.textContent||'').trim();
      return /^(?:.*)?Klaar:/u.test(t) || t.includes('❌ Fout');
    }
    function maybeUpdateLabel(){
      if (!isBusy() && !isTerminal()) btn.textContent='🔍 Check Stock After Eden';
    }

    function toggle(){
      btn.style.display = (outputHasTables() && isAfterEdenSelected()) ? 'block' : 'none';
      if (btn.style.display==='block') maybeUpdateLabel();
    }

    const out=document.querySelector('#output'); if(out) new MutationObserver(toggle).observe(out,{ childList:true, subtree:true });
    const select=document.querySelector('#leverancier-keuze'); if(select) select.addEventListener('change', toggle);
    const upload=document.querySelector('#upload-container'); if(upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
