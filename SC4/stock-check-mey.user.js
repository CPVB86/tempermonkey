// ==UserScript==
// @name         Stock Check | Mey
// @namespace    https://dutchdesignersoutlet.nl/
// @version      4.4
// @description  Vergelijk de lokale voorraad van Mey met de leverancier.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      meyb2b.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-mey.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-mey',
      name: 'Stock Check | Mey',
      version: typeof GM_info !== 'undefined' ? GM_info.script.version : '4.4'
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  const TIMEOUT = 15000;
  const ORDER_DETAIL_CACHE = new Map();

  // ---- Mey context (zoals je script) ----
  const MEY_CTX = {
    dataareaid: 'ME:NO',
    custid: '385468',
    assortid: 'ddd8763b-b678-4004-ba8b-c64d45b5333c',
    ordertypeid: 'NO',
    webSocketUniqueId: (crypto?.randomUUID ? crypto.randomUUID() : `ws-${Date.now()}-${Math.floor(Math.random()*1e6)}`)
  };

  // ---- Guards ----
  if (!Core) {
    console.error('[VCP2|Mey] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|Mey] StockRules ontbreekt of incompleet. Check @require stockrules.js');
    return;
  }

  // ---------- Logger (logboek status + Mundo-style perMaat) ----------
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
      else console.info(`[Mey][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      if (g.StockCheckConfig?.detailLogging !== true) return;
      console.groupCollapsed(`[Mey][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '-',
          target: Number.isFinite(r.target) ? r.target : '-',
          delta: Number.isFinite(r.delta) ? r.delta : '-',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // ---------- GM POST ----------
  function gmPost(url, jsonBody) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        withCredentials: true,
        timeout: TIMEOUT,
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*',
        },
        data: JSON.stringify(jsonBody),
        onload: (r) => (r.status >= 200 && r.status < 400)
          ? resolve(r.responseText || '')
          : reject(new Error(`HTTP ${r.status} @ ${url}`)),
        onerror: reject,
        ontimeout: () => reject(new Error(`timeout @ ${url}`)),
      });
    });
  }

  function buildMeyUrl(endpointPath) {
    const uniq = `${Date.now()}r${Math.floor(Math.random() * 1000)}`;
    return `https://meyb2b.com/b2bapi?-/${uniq}/${endpointPath}`;
  }

  // Tolerante PID-parser voor onder meer "1230081-1718" en "ME;NO;1230081;*;*/1718".
  function parsePid(pid) {
    const s = String(pid || '').trim();

    let m = s.match(/^\s*(\d+)\s*[-_]\s*(\d+)\s*$/);
    if (m) return { styleid: m[1], colorKey: m[2] };

    m = s.match(/\/\s*(\d{3,6})\s*$/);
    const trailingColor = m?.[1] || '';

    const nums = s.match(/\d+/g) || [];
    if (!nums.length) return { styleid: '', colorKey: '' };

    const styleid = [...nums].sort((a,b) => b.length - a.length)[0] || '';
    const colorCandidates = nums.filter(n => n !== styleid && n.length >= 3 && n.length <= 6);
    const colorKey = (trailingColor || colorCandidates[colorCandidates.length - 1] || '').trim();

    return { styleid, colorKey };
  }

  function normSize(raw) {
    return String(raw || '').toUpperCase().trim().replace(/\s+/g, '');
  }

  function looksLikeSize(value) {
    const s = normSize(value);
    return /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|TU|OS)$/.test(s)
      || /^\d{1,3}$/.test(s)
      || /^\d{2,3}[A-Z]{1,4}$/.test(s);
  }

  // BH-sleutels zoals "D;1752;75" worden omgezet naar "75D".
  function keyToMaat(k, v, colorKey = '') {
    const ks = String(k || '');

    // bra key: CUP;something;BAND
    const mBra = ks.match(/^([A-Z]{1,4})\;[^;]*\;(\d{2,3})$/i);
    if (mBra) {
      const cup = String(mBra[1]).toUpperCase();
      const band = String(mBra[2]).toUpperCase();
      return `${band}${cup}`; // 75D
    }

    // apparel: use v.size
    const size = normSize(v?.size);
    if (size) return size;

    const parts = ks.split(/[;|/:_\-\s]+/).map(part => part.trim()).filter(Boolean);
    const keyColor = String(colorKey || '').trim();
    const sizePart = parts.find(part => part !== keyColor && looksLikeSize(part));
    return normSize(sizePart || '');
  }

  // Haal de kleurcode uit BH- en kledingvarianten.
  function colorFromKey(k) {
    const s = String(k || '');
    const parts = s.split(';');
    if (parts.length >= 3) return String(parts[1] || '').trim();
    return '';
  }

  function entryMatchesColor(k, v, colorKey) {
    const wanted = String(colorKey || '').trim();
    if (!wanted) return true;

    const keyParts = String(k || '').split(/[;|/:_\-\s]+/).map(part => part.trim()).filter(Boolean);
    if (keyParts.includes(wanted)) return true;

    const candidates = [
      v?.yattrib,
      v?.yattribid,
      v?.color,
      v?.colorid,
      v?.colour,
      v?.colourid,
      v?.variantid,
      v?.variant,
      v?.itemid,
      v?.key
    ];

    return candidates.some(value =>
      String(value || '').split(/[;|/:_\-\s]+/).map(part => part.trim()).includes(wanted)
    );
  }

  function orderableFromOrderDetail(v) {
    const stock = Number(v?.stock ?? 0);
    const blocked = !!v?.blocked;
    return !blocked && Number.isFinite(stock) && stock > 0;
  }

  function setRemoteSize(map, maat, next) {
    const current = map[maat];
    if (!current) {
      map[maat] = next;
      return;
    }

    // Nooit optellen of naar een ruimere waarde gokken. Bij dubbele remote entries
    // voor dezelfde exacte maat/kleur kiezen we conservatief de laagste voorraad.
    const currentStock = Number(current.stock ?? 0);
    const nextStock = Number(next.stock ?? 0);
    if (nextStock < currentStock) {
      map[maat] = { ...next, conflict: true };
    } else if (nextStock === currentStock) {
      map[maat] = { ...current, conflict: true };
    } else {
      map[maat] = { ...current, conflict: true };
    }
  }

  // ---------- AssortmentDetail (allowed sizes) ----------
  async function fetchAllowedSet(styleid, colorKey) {
    if (!colorKey) return null;

    const url = buildMeyUrl('AssortmentDetail/collection');
    const payload = [{
      _getparams: { '': 'undefined' },
      _webSocketUniqueId: MEY_CTX.webSocketUniqueId,
      _url: 'AssortmentDetail/collection',
      _dataareaid: MEY_CTX.dataareaid,
      _agentid: null,
      _custid: String(MEY_CTX.custid),
      _method: 'read',
      styles: [{
        custareaid: 'ME',
        styleareaid: 'NO',
        styleid: String(styleid),
        variantid: '*',
        yattrib: String(colorKey),
      }],
      assortid: MEY_CTX.assortid,
      ordertypeid: MEY_CTX.ordertypeid
    }];

    const text = await gmPost(url, payload);
    const json = JSON.parse(text);

    const resArr = json?.[0]?.result || [];
    const allowed = new Set();

    for (const item of resArr) {
      const xvals = item?.detailData?.xvalues || {};
      for (const k of Object.keys(xvals)) {
        const m = String(k).match(/^([A-Z]{1,4})\;([^;]+)\;(\d{2,3})$/i);
        if (!m) continue;

        const cup = m[1].toUpperCase();
        const col = String(m[2]).trim();
        const band = m[3];

        if (colorKey && col !== String(colorKey)) continue;
        allowed.add(`${band}${cup}`);
      }
    }

    // safeguard: leeg = onbetrouwbaar
    if (allowed.size === 0) return null;
    return allowed;
  }

  // ---------- OrderDetail remoteMap ----------
  async function fetchOrderDetail(styleid) {
    const cacheKey = String(styleid);
    if (ORDER_DETAIL_CACHE.has(cacheKey)) return ORDER_DETAIL_CACHE.get(cacheKey);

    const url = buildMeyUrl('OrderDetail/collection');

    const payload = [{
      _getparams: { '': 'undefined' },
      _webSocketUniqueId: MEY_CTX.webSocketUniqueId,
      _url: 'OrderDetail/collection',
      _dataareaid: MEY_CTX.dataareaid,
      _agentid: null,
      _custid: String(MEY_CTX.custid),
      _method: 'read',
      styles: [{
        custareaid: 'ME',
        styleareaid: 'NO',
        styleid: String(styleid),
        variantid: '*',
        zkey: '*'
      }],
      assortid: MEY_CTX.assortid,
      ordertypeid: MEY_CTX.ordertypeid
    }];

    const request = gmPost(url, payload)
      .then(text => JSON.parse(text)?.[0]?.result?.[0]?.xvalues || {})
      .catch(error => {
        ORDER_DETAIL_CACHE.delete(cacheKey);
        throw error;
      });

    ORDER_DETAIL_CACHE.set(cacheKey, request);
    return request;
  }

  // ---------- OrderDetail remoteMap ----------
  async function fetchRemoteMap(styleid, colorKey, allowedSetOrNull) {
    const xvalues = await fetchOrderDetail(styleid);

    // map: maat -> { stock, orderable, rawStock }
    const map = {};
    let colorMatchedEntries = 0;

    for (const [k, v] of Object.entries(xvalues)) {
      // Strikt kleurfilter: geen bekende exacte kleur = niet gebruiken.
      if (!entryMatchesColor(k, v, colorKey)) continue;
      colorMatchedEntries++;

      const rawStock = Number(v?.stock ?? 0);
      const ean = String(v?.ean || '').trim();

      // ghost variant skip
      if ((!ean || ean.length < 8) && (!Number.isFinite(rawStock) || rawStock <= 0)) continue;

      const maat = keyToMaat(k, v, colorKey);
      if (!maat) continue;

      const orderable = (allowedSetOrNull instanceof Set)
        ? allowedSetOrNull.has(maat)
        : orderableFromOrderDetail(v);

      const effectiveStock = orderable ? rawStock : 0;

      setRemoteSize(map, maat, { stock: effectiveStock, orderable, rawStock, sourceKey: String(k) });
    }

    Object.defineProperty(map, '__meyMeta', {
      value: { colorMatchedEntries },
      enumerable: false
    });

    return map;
  }

  function applyRulesAndMark(localTable, remoteMapObj) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];

    rows.forEach(row => {
      const sizeCell  = row.children[0];
      const localCell = row.children[1];

      const maat  = normSize(row.dataset.size || sizeCell?.textContent || '');
      const local = parseInt(String(localCell?.textContent || '').trim(), 10) || 0;

      // Als de exacte kleur remote bestaat, betekent een ontbrekende maat: remote 0.
      // Niet gokken op andere kleuren of fallback-maten.
      const remoteInfo = remoteMapObj[maat] || { stock: 0, orderable: false, rawStock: 0, missingSize: true };
      const remoteRaw  = Number(remoteInfo.stock ?? 0);

      // target via StockRules (default strategy)
      const target = SR.mapRemoteToTarget('mey', remoteRaw, 5);

      const res = SR.reconcile(local, target, 5); // => { action:'bijboeken'|'uitboeken'|'ok', delta:int }
      const action = res.action;
      const delta  = res.delta;

      let status = 'ok';
      if (action === 'bijboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'add',
          delta,
          title: `Bijboeken ${delta} (target ${target}, remote ${remoteRaw})`
        });
        status = 'bijboeken';

      } else if (action === 'uitboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta,
          title: `Uitboeken ${delta} (target ${target}, remote ${remoteRaw})`
        });
        status = 'uitboeken';

      } else {
        // ok/none
        Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remoteRaw})` });
        status = 'ok';
      }

      report.push({
        maat,
        local,
        remote: remoteRaw,
        target,
        delta,
        status,
        hint: remoteInfo.missingSize ? 'SIZE-MISSING-FOR-EXACT-COLOR (remote forced 0)' : (remoteInfo.orderable === false ? 'NOT-ORDERABLE (remote forced 0)' : 'orderable')
      });
    });

    return report;
  }

  function bepaalLogStatus(report, remoteMapObj) {
    const colorSeen = Number(remoteMapObj?.__meyMeta?.colorMatchedEntries || 0) > 0;
    const remoteLeeg = !remoteMapObj || (!colorSeen && Object.keys(remoteMapObj).length === 0);
    if (remoteLeeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    if (diffs === 0) return 'ok';
    return 'afwijking';
  }

  function isNotFoundError(err) {
    const msg = String(err && err.message || '').toUpperCase();
    if (/HTTP\s(401|403|404|410)/.test(msg)) return true;
    if (/HTTP\s5\d{2}/.test(msg)) return true;
    if (/SYNTAXERROR/.test(msg)) return true;
    return false;
  }

  // ---------- Main per table ----------
  async function perTable(table) {
    const pid = (table.id || '').trim();
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pid || 'onbekend';
    const anchorId = pid || label;

    if (!pid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const { styleid, colorKey } = parsePid(pid);
    if (!styleid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    // 1) allowedSet (best-effort)
    let allowedSet = null;
    try {
      allowedSet = await fetchAllowedSet(styleid, colorKey);
    } catch {
      allowedSet = null;
    }

    // 2) remote map
    let remoteMapObj = null;
    try {
      remoteMapObj = await fetchRemoteMap(styleid, colorKey, allowedSet);
    } catch (e) {
      if (isNotFoundError(e)) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }
      throw e;
    }

    const colorSeen = Number(remoteMapObj?.__meyMeta?.colorMatchedEntries || 0) > 0;
    if (!remoteMapObj || (!colorSeen && Object.keys(remoteMapObj).length === 0)) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const report = applyRulesAndMark(table, remoteMapObj);
    const status = bepaalLogStatus(report, remoteMapObj);
    Logger.status(anchorId, status);
    Logger.perMaat(anchorId, report);

    // mut count
    const mutCount = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return mutCount;
  }

  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    ORDER_DETAIL_CACHE.clear();

    try {
      await Core.runTables({
        btn,
        tables,
        concurrency: 6,
        perTable
      });
    } catch (e) {
      console.error('[VCP2|Mey] run error:', e);
      // Laat de centrale voortgangsafhandeling zijn werk doen; dit is alleen voor debug.
    }
  }

  // ---------- UI ----------
  registerUserscript();
  const mounted = Core.mountSupplierButton({
    id: 'stock-check-mey-btn',
    text: 'Controleer Mey',
    right: 250,
    top: 8,
    match: /\bmey\b/i,
    onClick: (btn) => run(btn)
  });
  mounted.btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i>';
  mounted.btn.setAttribute('aria-label', 'Controleer voorraad bij Mey');
  mounted.btn.title = 'Controleer voorraad bij Mey';

})();
