// ==UserScript==
// @name         VCP2 | Chantelle
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-chantelle.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL      = location.hostname.includes('lingerieoutlet.nl');
  const ON_CHANTELLE = location.hostname.includes('chantelle-lingerie.my.site.com');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  // Bridge channel (GM keys)
  const BRIDGE_KEY     = 'chantelle_vcp2_bridge';
  const REQ_KEY        = `${BRIDGE_KEY}_req`;
  const RESP_KEY       = `${BRIDGE_KEY}_resp`;
  const HEARTBEAT_KEY  = `${BRIDGE_KEY}_hb`;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const $     = (s, r=document) => r.querySelector(s);

  const TIMEOUT_MS = 75000;

  // -----------------------
  // Tool-side prerequisites
  // -----------------------
  if (ON_TOOL) {
    if (!Core) {
      console.error('[VCP2|Chantelle] VCPCore ontbreekt. Check @require vcp-core.js');
      return;
    }
    // ✅ centrale mapping verplicht
    if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
      console.error('[VCP2|Chantelle] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
      return;
    }
  }

  // -----------------------
  // Size normalization (shared)
  // -----------------------
  function normSize(raw) {
    return String(raw || '').toUpperCase().replace(/\s+/g, '').trim();
  }

  function normalizeSizeKey(raw) {
    let v = String(raw ?? '').trim();
    if (!v) return '';

    v = v.split(/[|,]/)[0];
    v = v.split('/')[0];

    v = normSize(v);
    if (!v) return '';

    let m = v.match(/^0*(\d{2,3})([A-Z]{1,4})$/);
    if (m) return `${parseInt(m[1], 10)}${m[2]}`;

    if (/^0*\d{1,3}$/.test(v)) {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? String(n) : '';
    }

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
      else console.info(`[Chantelle][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[Chantelle][${anchorId}] maatvergelijking`);
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
  // Tool-side: Bridge helpers
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

  function bridgeOnline(maxAgeMs = 6000) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAgeMs;
    } catch {
      return false;
    }
  }

  // -----------------------
  // Tool-side: local table read + sku
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

  function getSkuFromTable(table) {
    const id = String(table.id || '').trim();
    if (id) return id;

    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
    const m = label.match(/\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/);
    return m ? m[0] : '';
  }

  // -----------------------
  // ✅ Tool-side: apply rules via CENTRAL StockRules mapping
  // -----------------------
  function applyCompareAndMark(localRows, stockMap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      if (!Object.prototype.hasOwnProperty.call(stockMap, maat)) continue;

      const remoteRaw = String(stockMap[maat] ?? '').trim();

      // ✅ centrale mapping (brand = 'chantelle')
      // (StockRules hoort "<3", "5+", "—", "-" etc. te begrijpen)
      let target;
      try {
        target = SR.mapRemoteToTarget('chantelle', remoteRaw, 5);
      } catch (e) {
        // liever een harde/zichtbare afwijking dan silent fout
        console.warn('[VCP2|Chantelle] mapRemoteToTarget failed for', maat, remoteRaw, e);
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

  function bepaalStatus(report, stockMap) {
    if (!stockMap || Object.keys(stockMap).length === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  async function perTable(table) {
    const sku = getSkuFromTable(table);
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || sku || 'onbekend';
    const anchorId = sku || label;

    if (!sku) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const localRows = readLocalTable(table);
    const sizes = localRows.map(r => r.maat).filter(isSizeLabel);

    const resp = await bridgeRequest({ mode: 'stock', sku, sizes }, TIMEOUT_MS);
    const stockMap = resp?.stockMap || {};

    const report = applyCompareAndMark(localRows, stockMap);
    Logger.status(anchorId, bepaalStatus(report, stockMap));
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    if (!bridgeOnline()) {
      alert(
        'Chantelle-bridge offline.\n' +
        'Open een Chantelle PDP-tab (chantelle-lingerie.my.site.com), refresh 1x,\n' +
        'en probeer opnieuw.'
      );
      return;
    }

    await Core.runTables({
      btn,
      tables,
      concurrency: 2,
      perTable
    });
  }

  // -----------------------
  // Supplier select
  // -----------------------
  function normBlob(s='') { return String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' '); }
  function isChantelleSelected() {
    const sel = $('#leverancier-keuze');
    if (!sel) return true;
    const byValue = normBlob(sel.value || '');
    const byText  = normBlob(sel.options?.[sel.selectedIndex]?.text || '');
    return byValue.includes('chantelle') || byText.includes('chantelle');
  }

  // -----------------------
  // ✅ UI badge zoals Triumph (rood/groen)
  // -----------------------
  function installHeartbeatBadge(btn) {
    if (!btn || btn.querySelector('.vcp2-hb-badge')) return;

    btn.style.position = btn.style.position || 'fixed';
    btn.style.paddingRight = '26px';

    const badge = document.createElement('span');
    badge.className = 'vcp2-hb-badge';
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-6px',
      right: '-7px',
      minWidth: '18px',
      height: '18px',
      borderRadius: '50%',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '700',
      lineHeight: '18px',
      textAlign: 'center',
      boxShadow: '0 0 0 2px #fff',
      pointerEvents: 'none',
      background: 'red'
    });
    badge.textContent = '';

    const setBadge = (ok) => { badge.style.background = ok ? '#24b300' : 'red'; };
    setBadge(bridgeOnline());

    btn.appendChild(badge);

    try {
      GM_addValueChangeListener(HEARTBEAT_KEY, () => setBadge(true));
    } catch {}
  }

  // =====================================================================
  // WORKER (CHANTELLE) — draait op Chantelle tab
  // =====================================================================
  function workerInit() {
    const extractFirst = (html, re) => (html.match(re)?.[1] || '');

    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    function getAnyPageVars() {
      return (
        window.CCRZ?.pagevars ||
        window.ccrz?.pagevars ||
        window.CCRZ?.PageVars ||
        window.ccrz?.PageVars ||
        {}
      );
    }

    function parsePagevarsFromHtml(html) {
      const eff =
        extractFirst(html, /CCRZ\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i) || '';

      const pg =
        extractFirst(html, /CCRZ\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i) || '';

      const pu =
        extractFirst(html, /CCRZ\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i) || '';

      const storeName =
        extractFirst(html, /CCRZ\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i) || 'DefaultStore';

      const sitePrefix =
        extractFirst(html, /CCRZ\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i) || '/DefaultStore';

      const currSiteURL =
        extractFirst(html, /CCRZ\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i) ||
        extractFirst(html, /ccrz\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i) ||
        (location.origin + sitePrefix + '/');

      return { eff, pg, pu, storeName, sitePrefix, currSiteURL };
    }

    function getCtxFromCurrentPage() {
      const html = document.documentElement.innerHTML;

      const csrf = extractFirst(html, /["']csrf["']\s*:\s*["']([^"']+)["']/i);
      const vid  = extractFirst(html, /["']vid["']\s*:\s*["']([^"']+)["']/i);
      const authorization = extractFirst(html, /["']authorization["']\s*:\s*["']([^"']+)["']/i);
      const verStr = extractFirst(html, /["']ver["']\s*:\s*(\d{1,3})/i);

      const pv = getAnyPageVars();

      let effAccountId = pv.effAccountId || '';
      let priceGroupId = pv.priceGroupId || '';
      let portalUserId = pv.portalUserId || '';
      let storeName = pv.storeName || 'DefaultStore';
      let sitePrefix = pv.sitePrefix || '/DefaultStore';
      let currSiteURL = pv.currSiteURL || (location.origin + sitePrefix + '/');

      if (!effAccountId) {
        const parsed = parsePagevarsFromHtml(html);
        effAccountId = parsed.eff || effAccountId;
        priceGroupId = priceGroupId || parsed.pg;
        portalUserId = portalUserId || parsed.pu;
        storeName = storeName || parsed.storeName;
        sitePrefix = sitePrefix || parsed.sitePrefix;
        currSiteURL = currSiteURL || parsed.currSiteURL;
      }

      const pickCartIdFromHref = (href) => {
        const s = String(href || '');
        const m = s.match(/[?&]cartId=([^&]+)/i) || s.match(/cartId=([a-f0-9-]{32,36})/i);
        return m ? decodeURIComponent(m[1]) : '';
      };

      const hrefCandidates = [];
      try { hrefCandidates.push(String(location.href || '')); } catch {}
      try { hrefCandidates.push(String(document.URL || '')); } catch {}
      try { hrefCandidates.push(String(window?.top?.location?.href || '')); } catch {}

      let cartId = '';
      for (const href of hrefCandidates) {
        cartId = pickCartIdFromHref(href);
        if (cartId) break;
      }

      if (!cartId) {
        cartId =
          pv.currentCartId ||
          pv.cartId ||
          window.CCRZ?.currentCartId ||
          window.ccrz?.currentCartId ||
          window.CCRZ?.pagevars?.currentCartId ||
          window.ccrz?.pagevars?.currentCartId ||
          '';
      }

      if (!cartId) {
        cartId =
          extractFirst(html, /[?&]cartId=([^&"'\s]+)/i) ||
          extractFirst(html, /cartId=([a-f0-9-]{32,36})/i) || '';
      }

      return { csrf, vid, authorization, ver: verStr ? Number(verStr) : 45, effAccountId, cartId, priceGroupId, portalUserId, storeName, sitePrefix, currSiteURL };
    }

    function makeInputContext(ctx, sku) {
      const currentPageURL =
        `${ctx.currSiteURL}ccrz__ProductDetails?cartId=${encodeURIComponent(ctx.cartId)}` +
        `&cclcl=nl_NL&effectiveAccount=${encodeURIComponent(ctx.effAccountId)}` +
        `&sku=${encodeURIComponent(sku)}&store=${encodeURIComponent(ctx.storeName)}`;

      return {
        storefront: ctx.storeName,
        portalUserId: ctx.portalUserId || '',
        effAccountId: ctx.effAccountId,
        priceGroupId: ctx.priceGroupId || '',
        currentCartId: ctx.cartId,
        userIsoCode: 'EUR',
        userLocale: 'nl_NL',
        currentPageName: 'ccrz__ProductDetails',
        currentPageURL,
        queryParams: { sku, cartId: ctx.cartId, store: ctx.storeName, effectiveAccount: ctx.effAccountId, cclcl: 'nl_NL' }
      };
    }

    async function waitForRemoteFn(controllerName, methodName, { timeoutMs = 12000, stepMs = 200 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const fn = w?.[controllerName]?.[methodName];
        if (typeof fn === 'function') return { w, fn, ctrl: w[controllerName] };
        await new Promise(r => setTimeout(r, stepMs));
      }
      return { w: (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window, fn: null, ctrl: null };
    }

    async function callVFRemote(controllerName, methodName, args, { timeoutMs = 60000 } = {}) {
      const { w, fn, ctrl } = await waitForRemoteFn(controllerName, methodName, { timeoutMs: 12000, stepMs: 200 });
      if (typeof fn !== 'function') throw new Error(`Worker: remote fn missing: ${controllerName}.${methodName}`);

      return new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(`Worker: remote timeout ${controllerName}.${methodName}`));
        }, timeoutMs);

        const cb = (result, event) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          if (event?.status) return resolve(result);
          reject(new Error(event?.message || 'Worker: remote call failed'));
        };

        try { fn.apply(ctrl, [...args, cb, { escape: false }]); }
        catch (e) { clearTimeout(t); reject(e); }
      });
    }

    function parseStockMap(stockPayload) {
      const sd = stockPayload?.stockData || {};
      const out = {};

      if (sd?.values && typeof sd.values === 'object') {
        for (const [sizeKey, info] of Object.entries(sd.values)) {
          const key = normalizeSizeKey(sizeKey);
          if (!isSizeLabel(key)) continue;
          const raw = String(info?.stockValue ?? '').trim();
          out[key] = (!raw || raw === '-' || raw === ' - ') ? '' : raw;
        }
        return out;
      }

      for (const [cupKey, cupObj] of Object.entries(sd)) {
        const cup = String(cupObj?.cupsize || cupKey || '').trim().toUpperCase();
        const values = cupObj?.values || {};

        for (const [bandKey, info] of Object.entries(values)) {
          const bandNorm = normalizeSizeKey(bandKey);
          if (!bandNorm) continue;

          const isDummyCup = !cup || cup === '-' || cup === '—';
          const key = isDummyCup ? bandNorm : normalizeSizeKey(`${bandNorm}${cup}`);
          if (!isSizeLabel(key)) continue;

          const raw = String(info?.stockValue ?? '').trim();
          out[key] = (!raw || raw === '-' || raw === ' - ') ? '' : raw;
        }
      }
      return out;
    }

    async function fetchStock(ctx, sku) {
      const price =
        window.CCRZ?.productDetailModel?.attributes?.product?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.price ??
        window.CCRZ?.productDetailModel?.attributes?.product?.prodBean?.price ??
        window.ccrz?.productDetailModel?.attributes?.product?.prodBean?.price ??
        '0';

      const inputContext = makeInputContext(ctx, sku);

      const res = await callVFRemote(
        'ccCLProductMatrixRCBTCtrl',
        'getStock',
        [inputContext, null, String(price), {}, false, false, false],
        { timeoutMs: 60000 }
      );

      const payload = res?.data || res;
      if (!payload?.stockData) throw new Error('getStock: no stockData');
      return payload;
    }

    async function handleReq(req) {
      const id = req?.id;
      if (!id) return;

      try {
        const sku = String(req.sku || '').trim();
        if (!sku) throw new Error('Worker: missing sku.');

        let ctx = getCtxFromCurrentPage();
        if (!ctx?.effAccountId) { await delay(800); ctx = getCtxFromCurrentPage(); }

        if (!ctx?.csrf || !ctx?.vid || !ctx?.authorization) throw new Error('Worker: tokens missing. Open a PDP + refresh once.');
        if (!ctx?.effAccountId) throw new Error('Worker: effAccountId missing.');
        if (!ctx?.cartId) throw new Error('Worker: cartId missing. Open PDP with cartId once.');

        const stockPayload = await fetchStock(ctx, sku);
        const stockMapFull = parseStockMap(stockPayload);

        const wanted = new Set((req.sizes || []).map(normalizeSizeKey).filter(isSizeLabel));
        const stockMap = Object.fromEntries(
          Object.entries(stockMapFull).filter(([k]) => wanted.has(normalizeSizeKey(k)))
        );

        GM_setValue(RESP_KEY, { id, ok: true, stockMap });

      } catch (e) {
        console.error('[chantelle-worker] error:', e);
        GM_setValue(RESP_KEY, { id, ok: false, error: String(e?.message || e) });
      }
    }

    GM_addValueChangeListener(REQ_KEY, (_k, _old, req) => {
      if (!req?.id) return;
      handleReq(req);
    });

    try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
  }

  // =====================================================================
  // TOOL UI (VCP2)
  // =====================================================================
  if (ON_TOOL) {
    Core.mountSupplierButton({
      id: 'vcp2-chantelle-btn',
      text: '🔍 Check Stock | Chantelle',
      right: 250,
      top: 8,
      match: () => isChantelleSelected(),
      onClick: (btn) => run(btn)
    });

    // badge after mount
    setTimeout(() => {
      const btn = document.getElementById('vcp2-chantelle-btn');
      if (btn) installHeartbeatBadge(btn);
    }, 50);
  }

  if (ON_CHANTELLE) workerInit();

})();
