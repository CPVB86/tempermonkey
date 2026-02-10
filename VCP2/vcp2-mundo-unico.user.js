// ==UserScript==
// @name         VCP2 | Mundo Unico
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://www.colomoda.eu/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-mundo-unico.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-mundo-unico.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL     = location.hostname.includes('lingerieoutlet.nl');
  const ON_COLOMODA = location.hostname.includes('colomoda.eu');

  const TIMEOUT_MS = 20000;
  const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // =========================
  // 1) BRIDGE OP COLOMODA (blijft hier, vanwege GM_*)
  // =========================
  if (ON_COLOMODA) {
    async function fetchText(url, timeout = TIMEOUT_MS) {
      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          signal: ctrl.signal,
          headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return text;
      } finally {
        clearTimeout(to);
      }
    }

    const tryParseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

    function collectProductCandidates(root) {
      const out = [];
      const seen = new Set();

      const looksLikeProduct = (o) =>
        o && typeof o === 'object' && (
          typeof o.url === 'string' ||
          typeof o.fullurl === 'string' ||
          typeof o.full_url === 'string' ||
          typeof o.code === 'string' ||
          typeof o.ean === 'string' ||
          typeof o.sku === 'string'
        );

      const walk = (node) => {
        if (!node) return;

        if (typeof node === 'object') {
          if (seen.has(node)) return;
          seen.add(node);

          if (looksLikeProduct(node)) out.push(node);

          if (Array.isArray(node)) node.forEach(walk);
          else Object.keys(node).forEach(k => walk(node[k]));
        }
      };

      walk(root);
      return out;
    }

    function scoreCandidate(c, needleUpper) {
      const code = String(c.code || '').toUpperCase();
      const ean  = String(c.ean  || '').toUpperCase();
      const sku  = String(c.sku  || '').toUpperCase();

      let s = 0;
      if (code === needleUpper) s += 100;
      if (ean  === needleUpper) s += 90;
      if (sku  === needleUpper) s += 80;

      if (sku.startsWith(needleUpper))  s += 70;
      if (code.startsWith(needleUpper)) s += 60;
      if (ean.startsWith(needleUpper))  s += 50;

      if (sku.includes(needleUpper)) s += 30;
      if (code.includes(needleUpper)) s += 25;
      if (ean.includes(needleUpper))  s += 20;

      if (c.fullurl || c.full_url) s += 5;
      if (c.url) s += 3;

      return s;
    }

    function findBestHit(searchJson, needleUpper) {
      const candidates = collectProductCandidates(searchJson);
      let best = null;
      let bestScore = 0;

      for (const c of candidates) {
        const sc = scoreCandidate(c, needleUpper);
        if (sc > bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      return (best && bestScore >= 20) ? best : null;
    }

    function buildAbsoluteProductJsonUrl(hit) {
      const full = hit?.fullurl || hit?.full_url || '';
      const url  = hit?.url || '';
      const candidate = String(full || url || '').trim();
      if (!candidate) return '';

      try {
        const u = new URL(candidate, 'https://www.colomoda.eu/');
        u.searchParams.set('format', 'json');
        return u.href;
      } catch {
        return '';
      }
    }

    async function getProductJsonByCode(code) {
      const needle = String(code || '').trim();
      if (!needle) throw new Error('NO_CODE');

      const needleUpper = needle.toUpperCase();
      const searchUrl  = `https://www.colomoda.eu/search/${encodeURIComponent(needle)}/?format=json`;
      const searchText = await fetchText(searchUrl);
      const searchJson = tryParseJson(searchText);
      if (!searchJson) throw new Error('SEARCH_JSON_PARSE');

      const hit = findBestHit(searchJson, needleUpper);
      if (!hit) throw new Error(`NO_RESULTS:${needle}`);

      const productJsonUrl = buildAbsoluteProductJsonUrl(hit);
      if (!productJsonUrl) throw new Error('NO_PRODUCT_URL');

      return await fetchText(productJsonUrl);
    }

    GM_addValueChangeListener('colomoda_bridge_req', (_name, _old, req) => {
      if (!req || !req.id || !req.code) return;

      (async () => {
        try {
          const text = await getProductJsonByCode(req.code);
          GM_setValue('colomoda_bridge_resp', { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue('colomoda_bridge_resp', { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    console.info('[Colomoda-bridge] actief op', location.href);
    return;
  }

  // =========================
  // 2) CLIENT OP TOOL
  // =========================
  if (!ON_TOOL) return;

  const Core = (typeof unsafeWindow !== 'undefined' ? unsafeWindow.VCPCore : window.VCPCore);
  const SR   = (typeof unsafeWindow !== 'undefined' ? unsafeWindow.StockRules : window.StockRules);

  if (!Core) { console.warn('[VCP2 Mundo] VCPCore ontbreekt. Laad vcp-core.js op toolpagina.'); return; }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.warn('[VCP2 Mundo] StockRules ontbreekt. Laad stockRules.js op toolpagina.');
    return;
  }

  const Logger = {
    lb() {
      try {
        return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
          ? unsafeWindow.logboek
          : window.logboek;
      } catch {
        return window.logboek;
      }
    },
    status(id, txt) {
      const lb = this.lb();
      if (lb && typeof lb.resultaat === 'function') lb.resultaat(String(id), txt);
      else console.info(`[MundoUnico][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      console.groupCollapsed(`[MundoUnico][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.actie
        })));
      } finally { console.groupEnd(); }
    }
  };

  // ✅ Bridge call moet in userscript context blijven (GM_*)
  function bridgeGetProductJson(code, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = uid();

      let handle = GM_addValueChangeListener('colomoda_bridge_resp', (_n, _o, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        msg.ok ? resolve(msg.text) : reject(new Error(msg.error || 'bridge error'));
      });

      GM_setValue('colomoda_bridge_req', { id, code, timeout });

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  function buildStatusMapFromColomodaProduct(json, wantedCode) {
    const map = {};
    const want = String(wantedCode || '').trim().toUpperCase();

    const cleanSize = (s) => {
      let t = String(s || '').trim().toUpperCase();
      t = t.replace(/^SIZE:\s*/i, '').trim();
      return t;
    };

    const add = (sizeRaw, qtyRaw, statusRaw) => {
      const size = cleanSize(sizeRaw);
      if (!size) return;

      const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;
      const status = statusRaw || (qty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');

      for (const key of Core.aliasCandidates(size)) {
        const ex = map[key];
        if (!ex) map[key] = { status, stock: qty };
        else {
          ex.stock = Math.max(ex.stock || 0, qty);
          if (ex.status !== 'IN_STOCK' && status === 'IN_STOCK') ex.status = 'IN_STOCK';
        }
      }
    };

    const codeTop = String(json?.product?.code || '').trim().toUpperCase();
    if (!want || !codeTop || codeTop === want) {
      const variantsObj = json?.product?.variants;
      if (variantsObj && typeof variantsObj === 'object') {
        Object.values(variantsObj).forEach(v => {
          if (!v || typeof v !== 'object') return;
          const size = v.title || v.variant || v.option || '';
          const lvl  = v.stock && v.stock.level;
          const ok   = !!(v.stock && (v.stock.available || v.stock.on_stock)) || Number(lvl) > 0;
          add(size, Number(lvl) || 0, ok ? 'IN_STOCK' : 'OUT_OF_STOCK');
        });
        if (Object.keys(map).length) return map;
      }
    }

    const recent = json?.page?.recent;
    if (recent && typeof recent === 'object') {
      Object.values(recent).forEach(item => {
        if (!item || typeof item !== 'object') return;
        const code = String(item.code || '').trim().toUpperCase();
        if (want && code && code !== want) return;

        const size = item.variant || item.title || '';
        const ok   = item.available === true;
        add(size, ok ? 5 : 0, ok ? 'IN_STOCK' : 'OUT_OF_STOCK');
      });
    }

    return map;
  }

  function bepaalLogStatus(report, statusMap) {
    const counts = report.reduce((a, r) => (a[r.actie] = (a[r.actie] || 0) + 1, a), {});
    const nUit = counts.uitboeken || 0;
    const nBij = counts.bijboeken || 0;
    const leeg = !statusMap || Object.keys(statusMap).length === 0;

    if (leeg) return 'niet-gevonden';
    if (report.length && nUit === 0 && nBij === 0) return 'ok';
    return 'afwijking';
  }

  function applyRulesAndMark(localTable, statusMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat  = (row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = Core.resolveRemote(statusMap, maat);
      const supplierQty = Number(remoteEntry?.stock) || 0;
      const st          = remoteEntry?.status;

      Core.clearRowMarks(row);

      let target = null;
      if (st === 'IN_STOCK') target = SR.mapRemoteToTarget('mundo', supplierQty, 5);
      else if (st === 'OUT_OF_STOCK') target = 0;
      else target = null;

      let actie = 'ok';
      let delta = 0;

      if (target === null) {
        if (local > 0) {
          actie = 'uitboeken';
          delta = local;
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (maat onbekend bij leverancier)` });
          if (!firstMut) firstMut = row;
        } else {
          actie = 'negeren';
          Core.markRow(row, { action: 'none', delta: 0, title: 'Negeren (maat onbekend bij leverancier)' });
        }

        report.push({ maat, local, remote: supplierQty, target: NaN, actie, delta });
        return;
      }

      const res = SR.reconcile(local, target, 5);

      if (res.action === 'ok') {
        actie = 'ok';
        delta = 0;
        Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, leverancier qty: ${supplierQty})` });
      } else if (res.action === 'bijboeken' && res.delta > 0) {
        actie = 'bijboeken';
        delta = res.delta;
        Core.markRow(row, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, leverancier qty: ${supplierQty})` });
        if (!firstMut) firstMut = row;
      } else if (res.action === 'uitboeken' && res.delta > 0) {
        actie = 'uitboeken';
        delta = res.delta;
        Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, leverancier qty: ${supplierQty})` });
        if (!firstMut) firstMut = row;
      }

      report.push({ maat, local, remote: supplierQty, target, actie, delta });
    });

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  async function runMundo(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable: async (table) => {
        const code = (table.id || '').trim();
        const anchorId = code || 'onbekend';

        if (!code) {
          Logger.status(anchorId, 'niet-gevonden (geen code)');
          Logger.perMaat(anchorId, []);
          return 0;
        }

        try {
          const text = await bridgeGetProductJson(code, TIMEOUT_MS);

          let json;
          try { json = JSON.parse(text); } catch { json = null; }

          if (!json) {
            Logger.status(anchorId, 'afwijking (json parse)');
            Logger.perMaat(anchorId, []);
            return 0;
          }

          const statusMap = buildStatusMapFromColomodaProduct(json, code);

          if (!statusMap || Object.keys(statusMap).length === 0) {
            Logger.status(anchorId, 'niet-gevonden');
            Logger.perMaat(anchorId, []);
            return 0;
          }

          const report = applyRulesAndMark(table, statusMap);
          const mutCount = report.filter(r => (r.actie === 'uitboeken' || r.actie === 'bijboeken') && r.delta > 0).length;

          Logger.status(anchorId, bepaalLogStatus(report, statusMap));
          Logger.perMaat(anchorId, report);

          return mutCount;

        } catch (e) {
          const msg = String(e?.message || e);
          if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) Logger.status(anchorId, 'afwijking (auth/cookies op colomoda tab)');
          else if (msg.includes('NO_RESULTS')) Logger.status(anchorId, 'niet-gevonden');
          else if (msg.includes('bridge timeout')) Logger.status(anchorId, 'afwijking (bridge timeout)');
          else Logger.status(anchorId, 'afwijking');

          Logger.perMaat(anchorId, []);
          return 0;
        }
      }
    });
  }

  Core.mountSupplierButton({
    id: 'adv-mundo-btn',
    text: '🔍 Check Stock | Mundo Unico',
    right: 250,
    top: 8,
    match: /\bmundo\b|\bunico\b|\bcolomoda\b/i,
    onClick: (btn) => runMundo(btn)
  });

})();
