// ==UserScript==
// @name         VCP2 | After Eden (+ Elbrina)
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      bcg.fashionportal.shop
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-aftereden.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-aftereden.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) {
    console.error('[VCP2|AfterEden] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|AfterEden] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
    return;
  }

  // ---------- Config ----------
  const TIMEOUT = 15000;
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
  const CACHE_PREFIX = 'vcp2_aftereden_html_cache_v1:'; // bump
  const BASE = 'https://bcg.fashionportal.shop';
  const STOCK_URL = (itemNumber) =>
    `${BASE}/itemquantitycal?item_number=${encodeURIComponent(itemNumber)}&price_type=stockitem`;

  const $ = (s, r=document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s='') => String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');

  // ---------- Helpers ----------
  function extractColorCode(pid){
    const m = String(pid || '').trim().match(/-([A-Za-z0-9]{2,})$/);
    return m ? m[1] : '';
  }

  function normalizeSize(s) {
    const cleaned = String(s||'')
      .trim()
      .toUpperCase()
      .replace(/\s+/g,'')
      .replace(/–|—/g,'-')
      .replace(/_/g,'');

    // keep legacy behavior: ONESIZE -> "1"
    if (/^ONESIZES?$/.test(cleaned)) return '1';
    return cleaned;
  }

  // ---------- Logger (status -> logboek, mapping -> console table) ----------
  const Logger = {
    lb(){
      return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    status(id, txt, extra){
      const lb=this.lb();
      if (lb?.resultaat) lb.resultaat(String(id), String(txt), extra);
      else console.info(`[AfterEden][${id}] status: ${txt}`, extra||'');
    },
    perMaat(id, report){
      console.groupCollapsed(`[AfterEden][${id}] maatvergelijking`);
      try{
        console.table(report.map(r => ({
          pid: r.pid,
          kleurcode: r.kleurcode,
          maat: r.maat,
          local: r.local,
          remoteQty: (r.remotePresent ? r.remoteQty : '—'),
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
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
        anonymous: false,
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

    const looksLikeLogin = /login|sign in|unauthorized/i.test(txt);
    if (looksLikeLogin) throw new Error('LOGIN_REQUIRED');

    const hasInventorySignals =
      txt.includes('data-inventory') ||
      txt.includes('qty-by-size') ||
      txt.includes('add-qty-box') ||
      txt.includes('selectqty-wrap') ||
      txt.includes('nuMber');

    if (!hasInventorySignals) throw new Error('NO_INVENTORY_IN_HTML');

    saveCache(itemNumber, txt);
    return txt;
  }

  // ---------- STRICT inventory read ----------
  // ✅ Alleen data-inventory telt. Geen data-title, geen price text.
  function readRemoteInventoryFromBox_STRICT(box) {
    const invEl =
      box.querySelector('.qty-limit[data-inventory]') ||
      box.querySelector('[data-inventory]') ||
      null;

    const raw = invEl?.getAttribute('data-inventory') ?? invEl?.dataset?.inventory;
    if (raw == null) return { present:false, qty:null };

    const cleaned = String(raw).trim().replace(',', '.');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { present:false, qty:null };

    return { present:true, qty:n };
  }

  // ---------- Exact wrapper pick: PID match ----------
  function findSelectWrapByExactPid(doc, pid){
    const wraps = [...doc.querySelectorAll('.selectqty-wrap')];
    const target = String(pid || '').trim();

    const hits = [];
    for (const w of wraps) {
      const n = w.querySelector('.pro-sku .nuMber')?.textContent || '';
      const number = n.trim();
      if (number === target) hits.push(w);
    }

    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`AMBIGUOUS_PID_WRAP:${target}:${hits.length}`);
    throw new Error(`PID_WRAP_NOT_FOUND:${target}`);
  }

  function readKleurLabelFromWrap(wrap){
    return wrap.querySelector('.pro-sku p')?.textContent?.trim() || '';
  }

  // ---------- Parse within wrapper ----------
  // returns Map<sizeKey -> { qty:number }>
  function parseWrapToQtyMap(wrap, pid, kleurcode) {
    const m = new Map();
    const dbg = [];

    // ---- 1D ----
    const list = wrap.querySelector('.qty-by-size.qty-by-size-list, .qty-by-size-list');
    if (list) {
      const boxes = [...list.querySelectorAll('.add-qty-box')];
      for (const box of boxes) {
        const sizeRaw = box.querySelector('.size-for')?.textContent?.trim();
        if (!sizeRaw) continue;

        const sizeKey = normalizeSize(sizeRaw);
        const r = readRemoteInventoryFromBox_STRICT(box);

        if (!r.present) {
          dbg.push({ pid, kleurcode, type:'1D', size:sizeKey, present:false, qty:null });
          continue;
        }

        const remoteQty = r.qty;
        m.set(sizeKey, { qty: remoteQty });
        dbg.push({ pid, kleurcode, type:'1D', size:sizeKey, present:true, qty:remoteQty });
      }
    }

    // ---- 3D ----
    const matrixContainer = wrap.querySelector('.row.qty-by-size.scroll-design, .qty-by-size.scroll-design, .qty-by-size');
    if (matrixContainer && matrixContainer.querySelector('.qty-by-size-3D')) {
      const headerRow = matrixContainer.querySelector('.qty-by-size-3D');
      const bandSizes = headerRow
        ? [...headerRow.querySelectorAll('.size-for.text-center')].map(el => el.textContent.trim()).filter(Boolean)
        : [];

      const rows3d = [...matrixContainer.querySelectorAll('.qty-by-size-3D')].slice(1);

      if (bandSizes.length && rows3d.length) {
        for (const row of rows3d) {
          const cup = row.querySelector('.size-for.cup-size')?.textContent?.trim();
          if (!cup) continue;

          const cells = [...row.querySelectorAll('.add-qty-box')];
          cells.forEach((cell, idx) => {
            const band = bandSizes[idx];
            if (!band) return;

            const sizeKey = normalizeSize(`${band}${cup}`);
            const r = readRemoteInventoryFromBox_STRICT(cell);

            if (!r.present) {
              dbg.push({ pid, kleurcode, type:'3D', size:sizeKey, present:false, qty:null });
              return;
            }

            const remoteQty = r.qty;

            const prev = m.get(sizeKey);
            if (!prev || remoteQty > prev.qty) {
              m.set(sizeKey, { qty: remoteQty });
            }

            dbg.push({ pid, kleurcode, type:'3D', size:sizeKey, present:true, qty:remoteQty });
          });
        }
      }
    }

    return m;
  }

  function parseAfterEdenHTMLtoMap(htmlText, pid) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const kleurcode = extractColorCode(pid);

    const wrap = findSelectWrapByExactPid(doc, pid);
    const kleurLabel = readKleurLabelFromWrap(wrap);

    // sanity: labelCode vs kleurcode
    if (kleurcode && kleurLabel) {
      const labelCode = (kleurLabel.match(/^([A-Za-z0-9]+)/)?.[1] || '').trim();
      if (labelCode && labelCode !== kleurcode) {
        throw new Error(`KLEURCODE_MISMATCH:pid=${pid}:kleurcode=${kleurcode}:label=${labelCode}`);
      }
    }

    const qtyMap = parseWrapToQtyMap(wrap, pid, kleurcode);
    return { qtyMap, kleurcode, kleurLabel };
  }

  // ---------- Apply rules (VCP2: SR.mapRemoteToTarget + SR.reconcile + Core.markRow) ----------
  function applyRulesOnTable(table, qtyMap, pid, kleurcode, brandKey) {
    const rows = table.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => Core.clearRowMarks(row));

    rows.forEach(row => {
      const sizeTd  = row.children?.[0];
      const stockTd = row.children?.[1];
      if (!sizeTd || !stockTd) return;

      const maatRaw = (row.dataset.size || sizeTd.textContent || '').trim();
      const maat = normalizeSize(maatRaw);
      const local = parseInt((stockTd.textContent || '0').trim(), 10) || 0;

      const remoteObj = qtyMap.get(maat);

      // STRICT: als maat niet in remote => niets doen
      if (!remoteObj) {
        report.push({
          pid, kleurcode,
          maat,
          local,
          remotePresent: false,
          remoteQty: undefined,
          target: NaN,
          delta: 0,
          status: 'ignored_missing_remote'
        });
        return;
      }

      const remoteQty = Number(remoteObj.qty ?? 0);
      const target = SR.mapRemoteToTarget(brandKey, remoteQty, 5);
      const res = SR.reconcile(local, target, 5);

      const delta = res.delta || 0;
      let status = 'ok';

      if (res.action === 'bijboeken' && delta > 0) {
        Core.markRow(row, { action:'add', delta, title:`Bijboeken ${delta} (target ${target}, remoteQty ${remoteQty})` });
        status = 'bijboeken';
        if (!firstMut) firstMut = row;

      } else if (res.action === 'uitboeken' && delta > 0) {
        Core.markRow(row, { action:'remove', delta, title:`Uitboeken ${delta} (target ${target}, remoteQty ${remoteQty})` });
        status = 'uitboeken';
        if (!firstMut) firstMut = row;

      } else {
        Core.markRow(row, { action:'none', delta:0, title:`OK (target ${target}, remoteQty ${remoteQty})` });
        status = 'ok';
      }

      report.push({
        pid, kleurcode,
        maat,
        local,
        remotePresent: true,
        remoteQty,
        target,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return { diffs, report };
  }

  function logStatusFromReport(report, qtyMap) {
    const remoteLeeg = !qtyMap || qtyMap.size === 0;
    if (remoteLeeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  function isNotFoundError(err){
    const msg = String(err?.message || err || '').toUpperCase();
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
    if (/UNEXPECTED\s+TOKEN/.test(msg)) return true; // HTML ipv HTML? (rare)
    if (msg.includes('NO_INVENTORY_IN_HTML')) return true;
    if (msg.includes('PID_WRAP_NOT_FOUND')) return true;
    return false;
  }

  // ---------- Per-table ----------
  async function perTableFactory(brandKey) {
    return async function perTable(table) {
      const pid = (table.id || '').trim();
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
      const anchorId = pid || label;

      if (!pid) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      const kleurcode = extractColorCode(pid);

      try {
        const html = await fetchAfterEdenHTML(pid);
        const { qtyMap, kleurLabel } = parseAfterEdenHTMLtoMap(html, pid);

        if (!qtyMap || qtyMap.size === 0) {
          Logger.status(anchorId, 'niet-gevonden', { kleurcode, kleurLabel });
          Logger.perMaat(anchorId, []);
          return 0;
        }

        const { diffs, report } = applyRulesOnTable(table, qtyMap, pid, kleurcode, brandKey);

        Logger.status(anchorId, logStatusFromReport(report, qtyMap), {
          kleurcode, kleurLabel,
          diffs,
          missingRemote: report.filter(r => r.status === 'ignored_missing_remote').length
        });
        Logger.perMaat(anchorId, report);

        return diffs;

      } catch (e) {
        console.error('[AfterEden] error for pid', pid, e);

        const msg = String(e?.message || e);
        if (/LOGIN_REQUIRED/i.test(msg)) {
          alert('Login required. Log in op bcg.fashionportal.shop en probeer opnieuw.');
        }
        if (/NO_INVENTORY_IN_HTML/i.test(msg)) {
          alert('After Eden: geen inventory in HTML (mogelijk sessie/cookie issue). Log in en probeer opnieuw.');
        }
        if (/PID_WRAP_NOT_FOUND|AMBIGUOUS_PID_WRAP|KLEURCODE_MISMATCH/i.test(msg)) {
          alert(`After Eden: kleur/PID match faalt.\nPID: ${pid}\nKleurcode: ${kleurcode || '(none)'}\n${msg}`);
        }

        Logger.status(anchorId, isNotFoundError(e) ? 'niet-gevonden' : 'afwijking', { error: msg, kleurcode });
        Logger.perMaat(anchorId, []);
        return 0;
      }
    };
  }

  // ---------- UI / Supplier selection ----------
  function getSelectedSupplierText(){
    const sel = $('#leverancier-keuze');
    if (!sel) return '';
    return String(sel.options?.[sel.selectedIndex]?.text || sel.value || '').trim();
  }

  function isAfterEdenSelected(){
    const sel = $('#leverancier-keuze');
    if (!sel) return false;
    const blob = `${norm(sel.value||'')} ${norm(getSelectedSupplierText())}`;
    return blob.includes('after') && blob.includes('eden');
  }

  function isElbrinaSelected(){
    const sel = $('#leverancier-keuze');
    if (!sel) return false;
    const blob = `${norm(sel.value||'')} ${norm(getSelectedSupplierText())}`;
    return blob.includes('elbrina');
  }

  function resolveBrandKey(){
    // StockRules brand key die jij hanteert.
    // Als jij liever "aftereden" en "elbrina" apart mapped: kan.
    // Nu: beide naar aftereden (zelfde remote bron/regels).
    return (isElbrinaSelected() ? 'elbrina' : 'aftereden');
  }

  function resolveButtonLabel(){
    return isElbrinaSelected() ? 'Elbrina' : 'After Eden';
  }

  async function run(btn){
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    const brandKey = resolveBrandKey();
    const perTable = await perTableFactory(brandKey);

    // concurrency via Core (geen eigen progress meer)
    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable
    });
  }

  // ✅ nieuwe knop-naam-regel
  Core.mountSupplierButton({
    id: 'vcp2-aftereden-btn',
    text: '🔍 Check Stock | After Eden',
    right: 250,
    top: 8,
    match: () => {
      const hasTables = !!document.querySelector('#output table');
      return hasTables && (isAfterEdenSelected() || isElbrinaSelected());
    },
    onClick: (btn) => run(btn),
    onTick: (btn) => {
      // update label dynamisch als gebruiker wisselt tussen After Eden en Elbrina
      const name = resolveButtonLabel();
      btn.textContent = `🔍 Check Stock | ${name}`;
    }
  });

})();
