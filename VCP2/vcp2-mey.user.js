// ==UserScript==
// @name         VCP2 | Mey
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      meyb2b.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-mey.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const TIMEOUT = 15000;

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
      console.groupCollapsed(`[Mey][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
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

  // ✅ tolerant PID parse: supports "1230081-1718", "ME;NO;1230081;*;*/1718", etc.
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

  // ✅ key parsing: BH keys like "D;38;75" => "75D"
  function keyToMaat(k, v) {
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
    return size || '';
  }

  // ✅ haal kleurKey uit de xvalues key (werkt voor BH: "B;210;85" en apparel: "*;210;XS")
  function colorFromKey(k) {
    const s = String(k || '');
    const parts = s.split(';');
    if (parts.length >= 3) return String(parts[1] || '').trim();
    return '';
  }

  function orderableFromOrderDetail(v) {
    const stock = Number(v?.stock ?? 0);
    const blocked = !!v?.blocked;
    return !blocked && Number.isFinite(stock) && stock > 0;
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
  async function fetchRemoteMap(styleid, colorKey, allowedSetOrNull) {
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

    const text = await gmPost(url, payload);
    const json = JSON.parse(text);

    const res0 = json?.[0]?.result?.[0];
    const xvalues = res0?.xvalues || {};

    // map: maat -> { stock, orderable, rawStock }
    const map = {};

    for (const [k, v] of Object.entries(xvalues)) {
      // kleurfilter voor alle keys
      if (colorKey) {
        const ck = colorFromKey(k);
        if (ck && ck !== String(colorKey)) continue;
      }

      const rawStock = Number(v?.stock ?? 0);
      const ean = String(v?.ean || '').trim();

      // ghost variant skip
      if ((!ean || ean.length < 8) && (!Number.isFinite(rawStock) || rawStock <= 0)) continue;

      const maat = keyToMaat(k, v);
      if (!maat) continue;

      const orderable = (allowedSetOrNull instanceof Set)
        ? allowedSetOrNull.has(maat)
        : orderableFromOrderDetail(v);

      const effectiveStock = orderable ? rawStock : 0;

      map[maat] = { stock: effectiveStock, orderable, rawStock };
    }

    return map;
  }

  function applyRulesAndMark(localTable, remoteMapObj) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const sizeCell  = row.children[0];
      const localCell = row.children[1];

      const maat  = normSize(row.dataset.size || sizeCell?.textContent || '');
      const local = parseInt(String(localCell?.textContent || '').trim(), 10) || 0;

      // alleen toepassen op maten die remote heeft
      if (!Object.prototype.hasOwnProperty.call(remoteMapObj, maat)) return;

      const remoteInfo = remoteMapObj[maat] || {};
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
        if (!firstMut) firstMut = row;

      } else if (action === 'uitboeken' && delta > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta,
          title: `Uitboeken ${delta} (target ${target}, remote ${remoteRaw})`
        });
        status = 'uitboeken';
        if (!firstMut) firstMut = row;

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
        hint: remoteInfo.orderable === false ? 'NOT-ORDERABLE (remote forced 0)' : 'orderable'
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, remoteMapObj) {
    const remoteLeeg = !remoteMapObj || Object.keys(remoteMapObj).length === 0;
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

    if (!remoteMapObj || Object.keys(remoteMapObj).length === 0) {
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

    try {
      await Core.runTables({
        btn,
        tables,
        concurrency: 3,
        perTable
      });
    } catch (e) {
      console.error('[VCP2|Mey] run error:', e);
      // laat StockKit/progress z’n werk doen; dit is alleen voor debug
    }
  }

  // ---------- UI ----------
  Core.mountSupplierButton({
    id: 'vcp2-mey-btn',
    text: '🔍 Check Stock | Mey',
    right: 250,
    top: 8,
    match: /\bmey\b/i,
    onClick: (btn) => run(btn),
  });

})();
