// ==UserScript==
// @name         VCP - After Eden (+ Elbrina)
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1.3
// @description  Vergelijk local stock met remote stock (After Eden/Elbrina) op basis van MAAT. Remote via itemquantitycal. Mapping: remoteQty-4 => 1..5 (remote ontbreekt: negeren; remote 0 maar aanwezig: 1). Mapping maat: remote "ONE SIZE(S)" => local "1". Preorder items (item_type=preorder) worden als 0-stock behandeld.
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
  const CACHE_PREFIX = 'aftereden_html_cache_v4:'; // ✅ bump: voorkom oude cache (v3 -> v4)
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
        anonymous: false,                 // ✅ belangrijk: cookies mee
        timeout: TIMEOUT,
        headers: { 'Accept':'text/html,*/*;q=0.8' },
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
    const txt = (r?.responseText || '');

    if (r?.status !== 200 || !txt.trim()) {
      throw new Error(`AfterEden HTML HTTP ${r?.status || '??'}`);
    }

    // login detect
    const looksLikeLogin = /login|sign in|unauthorized/i.test(txt);
    if (looksLikeLogin) throw new Error('LOGIN_REQUIRED');

    // ✅ voorkom cachen van "lege template" responses
    const hasInventorySignals =
      txt.includes('data-inventory') ||
      txt.includes('qty-by-size') ||
      txt.includes('add-qty-box') ||
      txt.includes('item_type');

    if (!hasInventorySignals) throw new Error('NO_INVENTORY_IN_HTML');

    saveCache(itemNumber, txt);
    return txt;
  }

  // ---------- Normalizers ----------
  function normalizeSize(s) {
    const cleaned = String(s||'')
      .trim()
      .toUpperCase()
      .replace(/\s+/g,'')     // "ONE SIZE" -> "ONESIZE"
      .replace(/–|—/g,'-')
      .replace(/_/g,'');

    // ✅ Supplier "one sizes"/"one size" -> local maat "1"
    if (/^ONESIZES?$/.test(cleaned)) return '1';

    return cleaned;
  }

  // ---------- Mapping (zelfde als scraper) ----------
  function mapAfterEdenQty(remoteQty){
    const r = Number(remoteQty) || 0;
    if (r <= 0) return 1; // alleen gebruikt wanneer de maat "bestaat" in remote
    const adjusted = Math.max(0, r - 4);
    if (adjusted < 2) return 1;
    if (adjusted === 2) return 2;
    if (adjusted === 3) return 3;
    if (adjusted === 4) return 4;
    return 5;
  }

  // ---------- Robust inventory read ----------
  function readRemoteInventoryFromBox(box) {
    const qtyLimit = box.querySelector('.qty-limit');
    const input = box.querySelector('input.quntity-input');

    const invA = qtyLimit?.getAttribute('data-inventory'); // voorkeur
    const invB = qtyLimit?.dataset?.inventory;             // tolerant
    const invC = input?.getAttribute('data-title');        // fallback
    const invD = input?.dataset?.title;                    // fallback

    const raw = (invA ?? invB ?? invC ?? invD ?? '0');
    const cleaned = String(raw).trim().replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  // ---------- Pick best 3D block ----------
  function pickBest3DContainer(doc) {
    const containers = [
      ...doc.querySelectorAll('.row.qty-by-size.scroll-design, .qty-by-size.scroll-design')
    ];

    if (!containers.length) return doc;

    let best = null;
    let bestScore = -1;

    for (const c of containers) {
      const cells = [...c.querySelectorAll('.add-qty-box')];
      if (!cells.length) continue;

      let score = 0;
      for (const cell of cells) {
        const inv = readRemoteInventoryFromBox(cell);
        if (inv > 0) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best || containers[0];
  }

  // ---------- HTML -> { map, isPreorder } ----------
  // Ondersteunt:
  // A) 3D BH matrix (.qty-by-size-3D)
  // B) 1D lijst (S/M/L/XL/XXL/One Size) (.qty-by-size-list)
  // Preorder detect: <input name="item_type" value="preorder">
  function parseAfterEdenHTMLtoMap(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    const itemType = (doc.querySelector('input[name="item_type"]')?.value || '').trim().toLowerCase();
    const isPreorder = itemType === 'preorder';

    const m = new Map();
    const dbg = [];

    // ---- A) 3D ----
    const best3D = pickBest3DContainer(doc);

    const headerRow = best3D.querySelector('.qty-by-size-3D');
    const bandSizes = headerRow
      ? [...headerRow.querySelectorAll('.size-for.text-center')]
          .map(el => el.textContent.trim())
          .filter(Boolean)
      : [];

    const rows3d = [...best3D.querySelectorAll('.qty-by-size-3D')].slice(1);

    if (bandSizes.length && rows3d.length) {
      for (const row of rows3d) {
        const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
        if (!cup) continue;

        const cells = [...row.querySelectorAll('.add-qty-box')];
        cells.forEach((cell, idx) => {
          const band = bandSizes[idx];
          if (!band) return;

          const remoteQtyRaw = readRemoteInventoryFromBox(cell);
          const remoteQty = isPreorder ? 0 : remoteQtyRaw; // ✅ preorder => 0-stock

          const sizeKey = normalizeSize(`${band}${cup}`);
          const mapped = mapAfterEdenQty(remoteQty);

          const prev = m.get(sizeKey);
          if (!prev || (Number(remoteQty) > Number(prev.qty))) {
            m.set(sizeKey, { qty: remoteQty, mapped });
          }

          dbg.push({ type: '3D', size: sizeKey, band, cup, remoteQty, mapped, isPreorder });
        });
      }
    }

    // ---- B) 1D (brief/broekjes S/M/L/XL/XXL/One Size) ----
    const listWraps = [...doc.querySelectorAll('.qty-by-size.qty-by-size-list, .qty-by-size-list')];
    for (const wrap of listWraps) {
      const boxes = [...wrap.querySelectorAll('.add-qty-box')];
      for (const box of boxes) {
        const sizeRaw = box.querySelector('.size-for')?.textContent?.trim();
        if (!sizeRaw) continue;

        const sizeKey = normalizeSize(sizeRaw); // S/M/L/XL/XXL/One Size -> 1
        const remoteQtyRaw = readRemoteInventoryFromBox(box);
        const remoteQty = isPreorder ? 0 : remoteQtyRaw; // ✅ preorder => 0-stock
        const mapped = mapAfterEdenQty(remoteQty);

        const prev = m.get(sizeKey);
        if (!prev || (Number(remoteQty) > Number(prev.qty))) {
          m.set(sizeKey, { qty: remoteQty, mapped });
        }

        dbg.push({ type: '1D', size: sizeKey, remoteQty, mapped, isPreorder });
      }
    }

    console.groupCollapsed('[AfterEden] Remote parsed (best 3D + 1D)');
    console.table(dbg);
    console.log('[AfterEden] item_type:', itemType || '(unknown)', 'isPreorder:', isPreorder);
    console.groupEnd();

    return { map: m, isPreorder };
  }

  // ---------- Rules & markering ----------
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

      const remoteObj = remoteMap.get(maat);
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

        const { map: remoteMap, isPreorder } = parseAfterEdenHTMLtoMap(html);

        const { changes, counts, report } = applyAfterEdenRulesOnTable(table, remoteMap);
        totalChanges += changes;

        const status = changes > 0 ? 'afwijking' : 'ok';
        Logger.status(anchorId, status + (isPreorder ? ' (preorder=0-stock)' : ''), counts);
        Logger.perMaat(anchorId, report);

        if (!firstDiffTable && changes > 0) firstDiffTable = table;
      } catch (e) {
        console.error('[AfterEden] error for pid', pid, e);
        const msg = String(e?.message || e);
        if (/LOGIN_REQUIRED/i.test(msg)) alert('Login required. Log in op bcg.fashionportal.shop en probeer opnieuw.');
        if (/NO_INVENTORY_IN_HTML/i.test(msg)) alert('After Eden: geen inventory in HTML (mogelijk sessie/cookie issue). Log in en probeer opnieuw.');
        Logger.status(anchorId, '❌ fout', { error: msg });
      }

      progress.setDone(idx);
    }

    progress.success(totalChanges);

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

    function isAfterEdenOrElbrinaSelected(){
      const el = document.querySelector('#leverancier-keuze');
      if (!el) return true;
      const v = (el.value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/_/g, '-');
      return v.includes('after') || v.includes('eden') || v.includes('elbrina');
    }

    function isBusy(){ return btn.classList.contains('is-busy'); }
    function isTerminal(){
      const t=(btn.textContent||'').trim();
      return /^(?:.*)?Klaar:/u.test(t) || t.includes('❌ Fout');
    }

    function setLabel(){
      if (isBusy() || isTerminal()) return;
      const el = document.querySelector('#leverancier-keuze');
      const v = (el?.value || '').toLowerCase();
      btn.textContent = v.includes('elbrina') ? '🔍 Check Stock Elbrina' : '🔍 Check Stock After Eden';
    }

    function toggle(){
      btn.style.display = (outputHasTables() && isAfterEdenOrElbrinaSelected()) ? 'block' : 'none';
      if (btn.style.display==='block') setLabel();
    }

    const out=document.querySelector('#output'); if(out) new MutationObserver(toggle).observe(out,{ childList:true, subtree:true });
    const select=document.querySelector('#leverancier-keuze'); if(select) select.addEventListener('change', toggle);
    const upload=document.querySelector('#upload-container'); if(upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', addButton) : addButton();
})();
