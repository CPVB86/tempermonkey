// ==UserScript==
// @name         VCP2 | Muchachomalo
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://agent.muchachomalo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      agent.muchachomalo.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-muchachomalo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-muchachomalo.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL  = location.hostname.includes('lingerieoutlet.nl');
  const ON_AGENT = location.hostname.includes('agent.muchachomalo.com');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  // -----------------------
  // Bridge keys
  // -----------------------
  const BRIDGE_KEY    = 'muchachomalo_vcp2_bridge';
  const REQ_KEY       = `${BRIDGE_KEY}_req`;
  const RESP_KEY      = `${BRIDGE_KEY}_resp`;
  const HEARTBEAT_KEY = `${BRIDGE_KEY}_hb`;

  const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const $     = (s, r=document) => r.querySelector(s);

  const TIMEOUT_MS = 90000;

  // Worker scan settings
  const MC = {
    BASE_URL: 'https://agent.muchachomalo.com/en/shop.htm',
    MAX_PAGES: 200,
    TIMEOUT_MS: 25000,
    SELECTORS: {
      productCard: '.catalogArticle',
      sizeInputs: 'input.size-quantity[data-size][max][data-articleid]'
    }
  };

  // -----------------------
  // Tool-side prerequisites
  // -----------------------
  if (ON_TOOL) {
    if (!Core) {
      console.error('[VCP2|Muchachomalo] VCPCore ontbreekt. Check @require vcp-core.js');
      return;
    }
    if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
      console.error('[VCP2|Muchachomalo] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
      return;
    }
  }

  // -----------------------
  // Normalization (shared)
  // -----------------------
  function normBlob(s='') {
    return String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
  }

  function normalizeSizeKey(raw) {
    let v = String(raw ?? '').trim();
    if (!v) return '';
    v = v.split(/[|,]/)[0];
    v = v.split('/')[0];
    v = v.toUpperCase().replace(/\s+/g,'').trim();
    if (!v) return '';

    // BH-like: 070D -> 70D
    let m = v.match(/^0*(\d{2,3})([A-Z]{1,4})$/);
    if (m) return `${parseInt(m[1], 10)}${m[2]}`;

    // numeric
    if (/^0*\d{1,3}$/.test(v)) {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? String(n) : '';
    }

    // alpha sizes (keep as-is)
    if (/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL)$/.test(v)) return v;

    return v;
  }

  function isSizeLabel(s) {
    const v = normalizeSizeKey(s);
    if (!v) return false;
    if (/^\d{2,3}[A-Z]{1,4}$/.test(v)) return true;
    if (/^\d{1,3}$/.test(v)) return true;
    if (/^(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL)$/.test(v)) return true;
    return false;
  }

  // -----------------------
  // Logger (status -> logboek, mapping -> console)
  // -----------------------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    status(anchorId, txt) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(anchorId), String(txt));
      else console.info(`[Muchachomalo][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[Muchachomalo][${anchorId}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: (r.remoteRaw ?? '—'),
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // -----------------------
  // Bridge helpers (tool-side)
  // -----------------------
  function bridgeRequest(payload, timeoutMs = TIMEOUT_MS) {
    const id = uid();

    return new Promise((resolve, reject) => {
      let handle = GM_addValueChangeListener(RESP_KEY, (_n, _o, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        msg.ok ? resolve(msg) : reject(new Error(msg.error || 'bridge error'));
      });

      GM_setValue(REQ_KEY, Object.assign({}, payload, { id, timeout: timeoutMs }));

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeoutMs + 1500);
    });
  }

  function bridgeOnline(maxAgeMs = 6500) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAgeMs;
    } catch {
      return false;
    }
  }

  // -----------------------
  // Tool-side: read local table
  // -----------------------
  function readLocalTable(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const out = [];

    for (const tr of rows) {
      const maatRaw = tr.dataset.size || tr.children?.[0]?.textContent || '';
      const maat = normalizeSizeKey(maatRaw);
      if (!maat) continue;

      const local = parseInt(String(tr.children?.[1]?.textContent || '').trim(), 10) || 0;
      out.push({ tr, maat, local });
    }
    return out;
  }

  function getPidFromTable(table) {
    const id = String(table.id || '').trim();
    if (id) return id;

    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
    // fallback: best-effort pid in header
    const m = label.match(/\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/);
    return m ? m[0] : '';
  }

  // -----------------------
  // ✅ Apply rules via CENTRAL StockRules
  // -----------------------
  function applyCompareAndMark(localRows, stockMapBySize) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      if (!Object.prototype.hasOwnProperty.call(stockMapBySize, maat)) continue;

      const remoteRaw = stockMapBySize[maat];
      // parsing only => remoteRaw expected numeric string (e.g. "0", "7")
      // StockRules beslist target
      let target = 0;
      try {
        target = SR.mapRemoteToTarget('muchachomalo', remoteRaw, 5);
      } catch (e) {
        console.warn('[VCP2|Muchachomalo] mapRemoteToTarget failed for', maat, remoteRaw, e);
        target = 0;
      }

      const res = SR.reconcile(local, target, 5);
      const delta = res.delta || 0;

      let status = 'ok';
      if (res.action === 'bijboeken' && delta > 0) {
        Core.markRow(tr, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, remote ${remoteRaw})` });
        status = 'bijboeken';
        if (!firstMut) firstMut = tr;

      } else if (res.action === 'uitboeken' && delta > 0) {
        Core.markRow(tr, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, remote ${remoteRaw})` });
        status = 'uitboeken';
        if (!firstMut) firstMut = tr;

      } else {
        Core.markRow(tr, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remoteRaw})` });
        status = 'ok';
      }

      report.push({ maat, local, remoteRaw, target, delta, status });
    }

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalStatus(report, stockMapBySize) {
    if (!stockMapBySize || Object.keys(stockMapBySize).length === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  async function perTable(table, remoteByPid) {
    const pid = getPidFromTable(table);
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
    const anchorId = pid || label;

    if (!pid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const localRows = readLocalTable(table);
    const remoteSizes = remoteByPid?.[pid] || {};

    const report = applyCompareAndMark(localRows, remoteSizes);
    Logger.status(anchorId, bepaalStatus(report, remoteSizes));
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    if (!bridgeOnline()) {
      alert(
        'Muchachomalo-bridge offline.\n' +
        'Open een Muchachomalo agent-tab (agent.muchachomalo.com), refresh 1x,\n' +
        'en probeer opnieuw.'
      );
      return;
    }

    // Collect wanted PIDs + wanted sizes per PID (om worker vroeg te laten stoppen)
    const pids = [];
    const sizesByPid = {};
    for (const t of tables) {
      const pid = getPidFromTable(t);
      if (!pid) continue;
      pids.push(pid);

      const localRows = readLocalTable(t);
      const wanted = localRows.map(r => r.maat).filter(isSizeLabel);
      sizesByPid[pid] = wanted;
    }

    // bulk remote fetch
    const resp = await bridgeRequest({ mode: 'bulk', pids, sizesByPid }, TIMEOUT_MS);
    const remoteByPid = resp?.remoteByPid || {};

    // compare tables (Core.runTables zorgt voor duidelijk “busy” gedrag)
    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable: async (table) => perTable(table, remoteByPid)
    });
  }

  // -----------------------
  // Supplier select (tool-side)
  // -----------------------
  function isMuchachomaloSelected() {
    const sel = $('#leverancier-keuze');
    if (!sel) return false;
    const byValue = normBlob(sel.value || '');
    const byText  = normBlob(sel.options?.[sel.selectedIndex]?.textContent || '');
    const blob = `${byValue} ${byText}`;
    return blob.includes('muchachomalo');
  }

  // -----------------------
  // WORKER (agent.muchachomalo.com)
  // -----------------------
  function parseProductsFromHTML(html, wantedPidsSet) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const cards = Array.from(doc.querySelectorAll(MC.SELECTORS.productCard));

    const found = {}; // pid -> { sizeKey -> remoteQtyString }
    for (const card of cards) {
      const text = (card.textContent || '');
      const raw  = (card.outerHTML || '');

      // find matching pid (exact contains)
      let pidHit = null;
      for (const pid of wantedPidsSet) {
        if (!pid) continue;
        if (text.includes(pid) || raw.includes(pid)) { pidHit = pid; break; }
      }
      if (!pidHit) continue;

      const inputs = Array.from(card.querySelectorAll(MC.SELECTORS.sizeInputs));
      if (!inputs.length) continue;

      const bucket = found[pidHit] || (found[pidHit] = {});
      for (const inp of inputs) {
        const sizeRaw = String(inp.getAttribute('data-size') || '').trim();
        const sizeKey = normalizeSizeKey(sizeRaw);
        if (!sizeKey) continue;

        // parsing only: we read max (remote qty)
        const maxRaw = inp.getAttribute('max');
        const n = Math.max(0, parseInt(String(maxRaw ?? '0'), 10) || 0);

        bucket[sizeKey] = String(n);
      }
    }

    return {
      cardsCount: cards.length,
      foundByPid: found
    };
  }

  async function fetchPage(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(t);
    }
  }

  async function workerHandleBulk(req) {
    const id = req?.id;
    if (!id) return;

    try {
      const pids = Array.isArray(req.pids) ? req.pids.map(s => String(s || '').trim()).filter(Boolean) : [];
      if (!pids.length) throw new Error('Worker: missing pids.');

      // Wanted sizes per PID (we gebruiken dit vooral om output te filteren)
      const wantedSizesByPid = (req.sizesByPid && typeof req.sizesByPid === 'object') ? req.sizesByPid : {};

      const wantedPidsSet = new Set(pids);

      const remoteByPid = {}; // pid -> { sizeKey -> remoteRaw }
      const missing = new Set(pids);

      // Page 1 = BASE_URL, daarna ?page=N
      for (let page = 1; page <= MC.MAX_PAGES; page++) {
        const u = new URL(MC.BASE_URL);
        if (page > 1) u.searchParams.set('page', String(page));
        const pageUrl = u.toString();

        const res = await fetchPage(pageUrl, MC.TIMEOUT_MS);

        // 401/403/404/410/5xx => niet-gevonden (per architectuur)
        if (![200, 201, 202, 203, 204, 206, 301, 302, 303, 307, 308].includes(res.status)) {
          if ([401,403,404,410].includes(res.status) || (res.status >= 500 && res.status <= 599)) {
            GM_setValue(RESP_KEY, { id, ok: true, remoteByPid: {} }); // tool-side => niet-gevonden
            return;
          }
        }

        const parsed = parseProductsFromHTML(res.text, wantedPidsSet);

        // stopconditie: geen cards meer
        if (parsed.cardsCount === 0) break;

        // merge found
        for (const [pid, sizes] of Object.entries(parsed.foundByPid || {})) {
          if (!remoteByPid[pid]) remoteByPid[pid] = {};
          Object.assign(remoteByPid[pid], sizes);
          missing.delete(pid);
        }

        // ✅ vroeg stoppen als alles gevonden is
        if (missing.size === 0) break;

        // kleine ademruimte
        await delay(60);
      }

      // filter sizes per pid naar "wanted"
      const filtered = {};
      for (const pid of pids) {
        const all = remoteByPid[pid] || {};
        const wanted = new Set((wantedSizesByPid[pid] || []).map(normalizeSizeKey).filter(isSizeLabel));

        // als we geen wanted sizes kregen: stuur alles terug
        if (!wanted.size) {
          filtered[pid] = all;
          continue;
        }

        filtered[pid] = Object.fromEntries(
          Object.entries(all).filter(([k]) => wanted.has(normalizeSizeKey(k)))
        );
      }

      GM_setValue(RESP_KEY, { id, ok: true, remoteByPid: filtered });

    } catch (e) {
      console.error('[muchachomalo-worker] error:', e);
      GM_setValue(RESP_KEY, { id: req?.id, ok: false, error: String(e?.message || e) });
    }
  }

  function workerInit() {
    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    GM_addValueChangeListener(REQ_KEY, (_k, _old, req) => {
      if (!req?.id) return;
      if (req.mode === 'bulk') workerHandleBulk(req);
      else GM_setValue(RESP_KEY, { id: req.id, ok: false, error: 'Worker: unknown mode' });
    });

    try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
  }

  // -----------------------
  // TOOL UI (VCP2)
  // -----------------------
  if (ON_TOOL) {
    // legacy cleanup (oude VCP knop)
    try { document.getElementById('muchachomalo-btn')?.remove(); } catch {}

    Core.mountSupplierButton({
      id: 'vcp2-muchachomalo-btn',
      text: '🔍 Check Stock | Muchachomalo',
      right: 250,
      top: 8,
      match: () => isMuchachomaloSelected(),
      onClick: (btn) => run(btn)
    });
  }

  if (ON_AGENT) workerInit();

})();
