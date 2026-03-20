// ==UserScript==
// @name         VCP2 | Sapph
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://sapph.prod.webstore.colect.io/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-sapph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-sapph.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const ON_TOOL  = location.hostname.includes('lingerieoutlet.nl');
  const ON_SAPPH = location.hostname.includes('sapph.prod.webstore.colect.io');

  const HEARTBEAT_KEY   = 'sapph_bridge_heartbeat';
  const AUTH_HEADER_KEY = 'sapph_bridge_auth_header';

  const TIMEOUT_MS = 20000;

  const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  function extractMetaFromUrl(url) {
    if (!url) return {};
    const m = String(url).match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    if (!m) return {};
    return { webstoreId: m[1], cartId: m[2] };
  }

  // ========================================================================
  // 1) BRIDGE OP SAPPH (auth-capture + grid-call)
  // ========================================================================
  if (ON_SAPPH) {
    const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    let pageFetch = null;

    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    function storeAuth(val, via, meta) {
      if (!val) return;
      const auth = String(val).trim();
      if (!/^bearer\s+/i.test(auth)) return;

      let prevRaw = null;
      try { prevRaw = GM_getValue(AUTH_HEADER_KEY, null); } catch {}

      let prev = null;
      if (prevRaw && typeof prevRaw === 'object') prev = prevRaw;
      else if (typeof prevRaw === 'string') prev = { auth: prevRaw };

      const session = {
        auth,
        webstoreId: (meta && meta.webstoreId) || (prev && prev.webstoreId) || null,
        cartId:     (meta && meta.cartId)     || (prev && prev.cartId)     || null
      };

      try { GM_setValue(AUTH_HEADER_KEY, session); } catch {}

      try {
        console.info(
          '[Sapph-bridge][DEBUG]',
          via,
          'Authorization captured:',
          auth.slice(0, 22) + '…',
          '| webstoreId:',
          session.webstoreId || '∅',
          '| cartId:',
          session.cartId || '∅'
        );
      } catch {}
    }

    function extractAuthFromHeaders(headers) {
      if (!headers) return null;

      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get('Authorization') || headers.get('authorization') || null;
      }

      if (Array.isArray(headers)) {
        for (const [k, v] of headers) {
          if (/^authorization$/i.test(k)) return v;
        }
      }

      if (typeof headers === 'object') {
        for (const k of Object.keys(headers)) {
          if (/^authorization$/i.test(k)) return headers[k];
        }
      }

      return null;
    }

    (function hookFetchForAuth() {
      try {
        const orig = w.fetch;
        if (!orig) return;

        pageFetch = orig.bind(w);

        w.fetch = function patchedFetch(input, init = {}) {
          try {
            const auth = extractAuthFromHeaders(init.headers);
            if (auth) {
              let urlStr = '';
              if (typeof input === 'string') urlStr = input;
              else if (input && typeof input.url === 'string') urlStr = input.url;
              const meta = extractMetaFromUrl(urlStr);
              storeAuth(auth, 'via fetch', meta);
            }
          } catch {}
          return pageFetch(input, init);
        };

        console.info('[Sapph-bridge] fetch-hook actief in page-context');
      } catch (e) {
        console.warn('[Sapph-bridge] kon fetch niet hooken:', e);
      }
    })();

    (function hookXHRForAuth() {
      try {
        const OrigXHR = w.XMLHttpRequest;
        if (!OrigXHR) return;

        function XHRProxy() {
          const xhr = new OrigXHR();
          const origSetRequestHeader = xhr.setRequestHeader;
          const origOpen             = xhr.open;

          xhr._bridgeUrl = '';

          xhr.open = function (method, url) {
            try { xhr._bridgeUrl = url; } catch {}
            return origOpen.apply(this, arguments);
          };

          xhr.setRequestHeader = function (name, value) {
            try {
              if (/^authorization$/i.test(name)) {
                const meta = extractMetaFromUrl(xhr._bridgeUrl);
                storeAuth(value, 'via XHR', meta);
              }
            } catch {}
            return origSetRequestHeader.apply(this, arguments);
          };

          return xhr;
        }

        XHRProxy.prototype = OrigXHR.prototype;
        w.XMLHttpRequest = XHRProxy;

        console.info('[Sapph-bridge] XHR-hook actief in page-context');
      } catch (e) {
        console.warn('[Sapph-bridge] kon XHR niet hooken:', e);
      }
    })();

    async function fetchSapphGrid(styleId, cartId, timeout = TIMEOUT_MS) {
      const raw = GM_getValue(AUTH_HEADER_KEY, null);

      let auth = null;
      let sessionStore = null;
      let sessionCart  = null;

      if (raw && typeof raw === 'object') {
        auth         = raw.auth || null;
        sessionStore = raw.webstoreId || null;
        sessionCart  = raw.cartId || null;
      } else {
        auth = raw;
      }

      if (!sessionStore) {
        throw new Error('Geen webstoreId gevonden in Sapph-session. Laat eerst een grid-call lopen op sapph.prod.webstore.colect.io.');
      }

      const effectiveCartId = cartId || sessionCart;
      if (!effectiveCartId) {
        throw new Error('Geen cartId gevonden in Sapph-session. Laat eerst een grid-call lopen op sapph.prod.webstore.colect.io.');
      }

      const url =
        `https://sapph.prod.webstore.colect.io/api/shop/webstores/${encodeURIComponent(sessionStore)}` +
        `/carts/${encodeURIComponent(effectiveCartId)}` +
        `/grid/${encodeURIComponent(styleId)}/products`;

      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), timeout);

      const headers = { 'Accept': 'application/json, text/plain, */*' };
      if (auth) headers['Authorization'] = auth;

      const f = pageFetch || w.fetch.bind(w);
      const res = await f(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: ctrl.signal
      });

      clearTimeout(to);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }

    GM_addValueChangeListener('sapph_bridge_req', (_name, _old, req) => {
      if (!req || !req.id || !req.styleId) return;

      (async () => {
        try {
          const text = await fetchSapphGrid(req.styleId, req.cartId, req.timeout || TIMEOUT_MS);
          GM_setValue('sapph_bridge_resp', { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue('sapph_bridge_resp', { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    if (document.readyState !== 'loading') {
      console.info('[Sapph-bridge] actief op', location.href);
    } else {
      document.addEventListener('DOMContentLoaded', () => console.info('[Sapph-bridge] actief op', location.href));
    }

    return;
  }

  // ========================================================================
  // 2) CLIENT OP TOOL
  // ========================================================================
  if (!ON_TOOL) return;

  if (!Core) {
    console.error('[VCP2|Sapph] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|Sapph] StockRules ontbreekt of incompleet. Check @require stockrules.js');
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
      else console.info(`[Sapph][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      console.groupCollapsed(`[Sapph][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally {
        console.groupEnd();
      }
    }
  };

  function bridgeIsOnlineByHeartbeat(maxAge = 5000) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAge;
    } catch {
      return false;
    }
  }

  function bridgeGetGrid(styleId, cartId, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = uid();

      let finished = false;

      const cleanup = (handle) => {
        try { GM_removeValueChangeListener(handle); } catch {}
      };

      const handle = GM_addValueChangeListener('sapph_bridge_resp', (_name, _old, msg) => {
        if (!msg || msg.id !== id || finished) return;
        finished = true;
        cleanup(handle);
        msg.ok ? resolve(msg.text) : reject(new Error(msg.error || 'bridge error'));
      });

      GM_setValue('sapph_bridge_req', { id, styleId, cartId, timeout });

      setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup(handle);
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  const gridCache = new Map();

  async function getGrid(styleId, cartId) {
    const key = `${cartId || 'session'}:${styleId}`;
    if (gridCache.has(key)) return gridCache.get(key);

    const p = bridgeGetGrid(styleId, cartId).then(text => {
      try {
        return JSON.parse(text);
      } catch {
        return [];
      }
    }).catch(err => {
      gridCache.delete(key);
      throw err;
    });

    gridCache.set(key, p);
    return p;
  }

  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL'
  };

  function aliasCandidates(label) {
    const raw = String(label || '').trim().toUpperCase();
    const ns  = raw.replace(/\s+/g, '');
    const set = new Set([raw, ns]);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);

    if (raw.includes('/')) {
      raw.split('/').map(s => s.trim()).forEach(x => {
        if (!x) return;
        set.add(x);
        set.add(x.replace(/\s+/g, ''));
        if (SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
      });
    }

    return Array.from(set);
  }

  function resolveRemote(statusMap, label) {
    for (const c of aliasCandidates(label)) {
      if (statusMap && statusMap[c]) return statusMap[c];
    }
    return undefined;
  }

  // --- Sapph GRID JSON → statusMap for one color ---
  function buildStatusMapFromSapphGrid(productsJson, wantedColorCode) {
  const list = Array.isArray(productsJson)
    ? productsJson
    : (productsJson && Array.isArray(productsJson.products))
      ? productsJson.products
      : [];

  const wanted = String(wantedColorCode || '').trim().toUpperCase();
  const wantedVariants = Array.from(new Set([
    wanted,
    wanted.padStart(3, '0'),
    wanted.padStart(4, '0'),
    wanted.replace(/^0+/, '') || '0'
  ]));

  const map = {};

  const products = list.filter(p => {
    const candidates = [
      p.colorCode,
      p.userDefinedField1,
      p.simpleColor,
      p.color,
      p.colourCode,
      p.variantCode
    ]
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean);

    return candidates.some(c => wantedVariants.includes(c));
  });

  const effectiveProducts = products.length ? products : list;

  console.log('[Sapph][DEBUG] wantedColorCode:', wantedColorCode);
  console.log('[Sapph][DEBUG] wantedVariants:', wantedVariants);
  console.log('[Sapph][DEBUG] matched products:', products.length, '/', list.length);

  effectiveProducts.forEach(prod => {
  (prod.skus || []).forEach(sku => {
    const base = String(
      sku.sizeName ??
      sku.sizeDisplayName ??
      sku.size ??
      ''
    ).trim().toUpperCase();

    const cup = String(
      sku.subSizeName ??
      sku.subSizeDisplayName ??
      sku.subSize ??
      ''
    ).trim().toUpperCase();

    const simple = String(
      sku.simpleSizeName ??
      sku.sizeLabel ??
      sku.label ??
      ''
    ).trim().toUpperCase();

    let label = '';

    // BH-maten: altijd band + cup gebruiken als cup bestaat
    if (base && cup) {
      label = `${base}${cup}`.trim();
    } else if (simple) {
      label = simple;
    } else if (base) {
      label = base;
    }

    if (!label) return;

    let totalQty = 0;

    if (Array.isArray(sku.stockLevels)) {
      for (const sl of sku.stockLevels) {
        const q = Number(
          sl?.quantity ??
          sl?.available ??
          sl?.qty ??
          sl?.stock ??
          0
        );
        if (Number.isFinite(q) && q > 0) totalQty += q;
      }
    } else {
      const q = Number(
        sku?.quantity ??
        sku?.available ??
        sku?.qty ??
        sku?.stock ??
        0
      );
      if (Number.isFinite(q) && q > 0) totalQty += q;
    }

    const status = totalQty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';

    for (const key of aliasCandidates(label)) {
      const existing = map[key];
      if (!existing) {
        map[key] = { status, stock: totalQty };
      } else {
        existing.stock = Math.max(existing.stock || 0, totalQty);
        if (existing.status !== 'IN_STOCK' && status === 'IN_STOCK') {
          existing.status = 'IN_STOCK';
        }
      }
    }
  });
});

  console.log('[Sapph][DEBUG] statusMap keys:', Object.keys(map));
  console.log('[Sapph][DEBUG] statusMap full:', map);

  return map;
}

  function applyRulesAndMark(localTable, statusMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat = (row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = resolveRemote(statusMap, maat);
      const supplierQty = Number(remoteEntry?.stock) || 0;
      const st          = remoteEntry?.status;

      let target = null;
      if (st === 'IN_STOCK') target = SR.mapRemoteToTarget('sapph', supplierQty, 5);
      else if (st === 'OUT_OF_STOCK') target = 0;
      else target = null;

      let status = 'ok';
      let delta = 0;

      if (target === null) {
        if (local > 0) {
          delta = local;
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (maat onbekend bij Sapph)` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: 'Negeren (maat onbekend bij Sapph)' });
          status = 'negeren';
        }
      } else {
        const res = SR.reconcile(local, target, 5);
        delta = res.delta;

        if (res.action === 'bijboeken' && delta > 0) {
          Core.markRow(row, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'bijboeken';
          if (!firstMut) firstMut = row;
        } else if (res.action === 'uitboeken' && delta > 0) {
          Core.markRow(row, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, supplier qty ${supplierQty})` });
          status = 'uitboeken';
          if (!firstMut) firstMut = row;
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, supplier qty ${supplierQty})` });
          status = 'ok';
        }
      }

      report.push({
        maat,
        local,
        remote: supplierQty,
        target: Number.isFinite(target) ? target : NaN,
        delta,
        status
      });
    });

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, statusMap) {
    const leeg = !statusMap || Object.keys(statusMap).length === 0;
    if (leeg) return 'niet-gevonden';

    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

async function perTable(table) {
  const tableId = (table.id || '').trim();
  const anchorId = tableId || 'onbekend';

  const m = tableId.match(/^([A-Z0-9]+)-([A-Z0-9]{3,4})$/i);
  if (!m) {
    Logger.status(anchorId, 'niet-gevonden (id niet in vorm STIJL-KLEUR)');
    Logger.perMaat(anchorId, []);
    return 0;
  }

  const styleId   = m[1];
  const colorCode = m[2].toUpperCase();

  const cartId = undefined;

  const json = await getGrid(styleId, cartId);
  const statusMap = buildStatusMapFromSapphGrid(json, colorCode);

  if (!statusMap || Object.keys(statusMap).length === 0) {
    Logger.status(anchorId, 'niet-gevonden');
    Logger.perMaat(anchorId, []);
    return 0;
  }

  const report = applyRulesAndMark(table, statusMap);
  Logger.status(anchorId, bepaalLogStatus(report, statusMap));
  Logger.perMaat(anchorId, report);

  return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
}

  async function runSapph(btn) {
    if (!bridgeIsOnlineByHeartbeat()) {
      alert(
        'Sapph-bridge offline.\n' +
        'Open een sapph.prod.webstore.colect.io-tab, log in, bezoek een product (zodat hun grid-call loopt),\n' +
        'dan hier opnieuw proberen.'
      );
      return;
    }

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
      const msg = String(e?.message || e);
      console.error('[VCP2|Sapph] run error:', e);

      if (msg.includes('HTTP 401')) {
        alert('Sapph auth/token probleem (HTTP 401). Open Sapph tab en laat een product-grid call lopen.');
      } else if (msg.includes('bridge timeout')) {
        alert('Sapph bridge timeout. Probeer opnieuw of refresh Sapph tab.');
      }
    }
  }

  const { btn } = Core.mountSupplierButton({
    id: 'vcp2-sapph-btn',
    text: '🔍 Check Stock | Sapph',
    right: 250,
    top: 8,
    match: (blob) => /\bsapph\b/i.test(blob),
    onClick: (b) => runSapph(b)
  });

  (function attachHeartbeatDotOnce() {
    if (!btn) return;
    if (btn.querySelector('.vcp-hb-dot')) return;

    btn.style.position = 'fixed';
    btn.style.paddingRight = '26px';

    const dot = document.createElement('span');
    dot.className = 'vcp-hb-dot';
    Object.assign(dot.style, {
      position: 'absolute',
      top: '-6px',
      right: '-7px',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '700',
      lineHeight: '18px',
      textAlign: 'center',
      boxShadow: '0 0 0 2px #fff',
      pointerEvents: 'none',
      background: bridgeIsOnlineByHeartbeat() ? '#24b300' : 'red'
    });
    dot.textContent = '';

    btn.appendChild(dot);

    const setDot = () => {
      dot.style.background = bridgeIsOnlineByHeartbeat() ? '#24b300' : 'red';
    };

    try { GM_addValueChangeListener(HEARTBEAT_KEY, setDot); } catch {}
    setInterval(setDot, 3000);
  })();

})();
