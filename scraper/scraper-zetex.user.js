// ==UserScript==
// @name         EAN Scraper | Zetex (self-contained)
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0
// @description  Zelfstandige Zetex scraper: haalt EAN + stock op via grid + validate en vult #tabs-3 in. Werkt zonder VCP-afhankelijkheid.
// @author       C. P. van Beek
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @match        https://b2b.zetex.nl/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-zetex.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-zetex.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  const ON_DDO   = location.hostname.includes('dutchdesignersoutlet.com');
  const ON_ZETEX = location.hostname.includes('b2b.zetex.nl');

  const LOG_PREFIX = '[EAN Scraper | Zetex]';

  // ===========================================================================
  // Shared bridge keys
  // ===========================================================================
  const HEARTBEAT_KEY   = 'zetex_scraper_bridge_heartbeat';
  const AUTH_HEADER_KEY = 'zetex_scraper_bridge_auth_header';

  const REQ_KEY  = 'zetex_scraper_bridge_req';
  const RESP_KEY = 'zetex_scraper_bridge_resp';

  const VALIDATE_REQ_KEY  = 'zetex_scraper_bridge_validate_req';
  const VALIDATE_RESP_KEY = 'zetex_scraper_bridge_validate_resp';

  const TIMEOUT_MS = 20000;
  const PROBE_QTY  = 20;
  const BRAND_KEY  = 'zetex';

  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
  const $ = (s, r = document) => r.querySelector(s);

  // ===========================================================================
  // Common helpers
  // ===========================================================================
  function extractMetaFromUrl(url) {
    if (!url) return {};
    const m = String(url).match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\/grid\/([^/?#]+)\/products/i);
    if (!m) return {};
    return {
      webstoreId: m[1],
      cartId: m[2],
      styleId: m[3]
    };
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

  function extractOverageFromMessage(msg = '') {
    const m = String(msg).match(/\((\d+)\s+te\s+veel\)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function normalizeLocalSize(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  // ===========================================================================
  // 1) ZETEX bridge
  // ===========================================================================
  if (ON_ZETEX) {
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
        cartId:     (meta && meta.cartId)     || (prev && prev.cartId)     || null,
        styleId:    (meta && meta.styleId)    || (prev && prev.styleId)    || null
      };

      try { GM_setValue(AUTH_HEADER_KEY, session); } catch {}

      try {
        console.info(
          '[Zetex-scraper-bridge][DEBUG]',
          via,
          'Authorization captured:',
          auth.slice(0, 22) + '…',
          '| webstoreId:',
          session.webstoreId || '∅',
          '| cartId:',
          session.cartId || '∅',
          '| styleId:',
          session.styleId || '∅'
        );
      } catch {}
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

        console.info('[Zetex-scraper-bridge] fetch-hook actief in page-context');
      } catch (e) {
        console.warn('[Zetex-scraper-bridge] kon fetch niet hooken:', e);
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

          xhr.open = function(method, url) {
            try { xhr._bridgeUrl = url; } catch {}
            return origOpen.apply(this, arguments);
          };

          xhr.setRequestHeader = function(name, value) {
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

        console.info('[Zetex-scraper-bridge] XHR-hook actief in page-context');
      } catch (e) {
        console.warn('[Zetex-scraper-bridge] kon XHR niet hooken:', e);
      }
    })();

    async function fetchZetexGrid(styleId, cartId, timeout = TIMEOUT_MS) {
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
        throw new Error('Geen webstoreId gevonden in Zetex-session. Laat eerst een grid-call lopen op b2b.zetex.nl.');
      }

      const effectiveCartId = cartId || sessionCart;
      if (!effectiveCartId) {
        throw new Error('Geen cartId gevonden in Zetex-session. Laat eerst een grid-call lopen op b2b.zetex.nl.');
      }

      const url =
        `https://b2b.zetex.nl/api/shop/webstores/${encodeURIComponent(sessionStore)}` +
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

    async function fetchZetexValidate(styleId, cartId, payload, timeout = TIMEOUT_MS) {
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
        throw new Error('Geen webstoreId gevonden in Zetex-session.');
      }

      const effectiveCartId = cartId || sessionCart;
      if (!effectiveCartId) {
        throw new Error('Geen cartId gevonden in Zetex-session.');
      }

      const url =
        `https://b2b.zetex.nl/api/shop/webstores/${encodeURIComponent(sessionStore)}` +
        `/carts/${encodeURIComponent(effectiveCartId)}` +
        `/product-styles/${encodeURIComponent(styleId)}/lines/validate`;

      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), timeout);

      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8'
      };
      if (auth) headers['Authorization'] = auth;

      const f = pageFetch || w.fetch.bind(w);
      const res = await f(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });

      clearTimeout(to);

      const text = await res.text();

      if (!res.ok) {
        console.error('[Zetex][VALIDATE][HTTP ERROR]', {
          status: res.status,
          url,
          payload,
          responseText: text
        });
        throw new Error(`HTTP ${res.status} :: ${text}`);
      }

      return text;
    }

    GM_addValueChangeListener(REQ_KEY, (_name, _old, req) => {
      if (!req || !req.id || !req.styleId) return;

      (async () => {
        try {
          const text = await fetchZetexGrid(req.styleId, req.cartId, req.timeout || TIMEOUT_MS);
          GM_setValue(RESP_KEY, { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue(RESP_KEY, { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    GM_addValueChangeListener(VALIDATE_REQ_KEY, (_name, _old, req) => {
      if (!req || !req.id || !req.styleId || !req.payload) return;

      (async () => {
        try {
          const text = await fetchZetexValidate(req.styleId, req.cartId, req.payload, req.timeout || TIMEOUT_MS);
          GM_setValue(VALIDATE_RESP_KEY, { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue(VALIDATE_RESP_KEY, { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    if (document.readyState !== 'loading') {
      console.info('[Zetex-scraper-bridge] actief op', location.href);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        console.info('[Zetex-scraper-bridge] actief op', location.href);
      });
    }

    return;
  }

  // ===========================================================================
  // 2) DDO scraper
  // ===========================================================================
  if (!ON_DDO) return;

  const BTN_ID = 'zetex-stock-ean-scraper-btn';
  const TABLE_SELECTOR = '#tabs-3 table.options';
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  const HOTKEY = {
    ctrl: true,
    shift: true,
    alt: false,
    key: 's'
  };

  // ---------------------------------------------------------------------------
  // Optional StockRules support
  // ---------------------------------------------------------------------------
  function fallbackMapQtyToStockLevel(qty, maxCap = 5) {
    const n = Number(qty ?? 0) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    return Math.min(5, maxCap);
  }

  function getMaxCapFromTable(table) {
    const stockInputs = Array.from(
      table.querySelectorAll('input[name^="options"][name$="[stock]"]')
    );

    const nums = stockInputs
      .map(inp => Number(inp.max))
      .filter(n => Number.isFinite(n) && n > 0);

    if (nums.length) return Math.max(...nums);
    return 5;
  }

  function mapSupplierQtyToLocalStock(qty, table) {
    const maxCap = getMaxCapFromTable(table);

    try {
      const SR = g.StockRules;
      if (SR && typeof SR.mapRemoteToTarget === 'function') {
        return SR.mapRemoteToTarget(BRAND_KEY, Number(qty) || 0, maxCap);
      }
    } catch {}

    return fallbackMapQtyToStockLevel(qty, maxCap);
  }

  // ---------------------------------------------------------------------------
  // Page helpers
  // ---------------------------------------------------------------------------
  const getBrandTitle = () =>
    document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || '';

  function isZetexBrand() {
    const title = getBrandTitle().toLowerCase();
    if (!title) return true;
    return (
      title.includes('zetex') ||
      title.includes('pastunette') ||
      title.includes('rebelle') ||
      title.includes('robson')
    );
  }

  function hasTable() {
    return !!document.querySelector(TABLE_SELECTOR);
  }

  function isTab3Active() {
    const activeByHeader = document.querySelector(
      '#tabs .ui-tabs-active a[href="#tabs-3"], ' +
      '#tabs .active a[href="#tabs-3"], ' +
      '#tabs li.current a[href="#tabs-3"]'
    );
    if (activeByHeader) return true;

    const panel = document.querySelector('#tabs-3');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.height !== '0px'
    );
  }

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

  // ---------------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------------
  function clickUpdateProductButton() {
    const saveBtn = document.querySelector('input[type="submit"][name="edit"]');
    if (!saveBtn) {
      console.log(LOG_PREFIX, "Update product button niet gevonden");
      return;
    }
    console.log(LOG_PREFIX, "Autosave: klik op 'Update product'.");
    saveBtn.click();
  }

  // ---------------------------------------------------------------------------
  // Bridge client
  // ---------------------------------------------------------------------------
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

      let handle = GM_addValueChangeListener(RESP_KEY, (_name, _old, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        msg.ok ? resolve(msg.text) : reject(new Error(msg.error || 'bridge error'));
      });

      GM_setValue(REQ_KEY, { id, styleId, cartId, timeout });

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  function bridgeValidate(styleId, cartId, payload, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = uid();

      let handle = GM_addValueChangeListener(VALIDATE_RESP_KEY, (_name, _old, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        msg.ok ? resolve(msg.text) : reject(new Error(msg.error || 'validate bridge error'));
      });

      GM_setValue(VALIDATE_REQ_KEY, { id, styleId, cartId, payload, timeout });

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('validate bridge timeout'));
      }, timeout + 1500);
    });
  }

  const gridCache = new Map();

  async function getGrid(styleId, cartId) {
    const key = `${cartId || 'session'}:${styleId}`;
    if (gridCache.has(key)) return gridCache.get(key);

    const p = bridgeGetGrid(styleId, cartId)
      .then(text => {
        try { return JSON.parse(text); }
        catch { return []; }
      })
      .catch(err => {
        gridCache.delete(key);
        throw err;
      });

    gridCache.set(key, p);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Validate logic
  // ---------------------------------------------------------------------------
  function buildProbeQtyMapForTable(localTable, gridJson, wantedColorCode, probeQty = PROBE_QTY) {
    const qtyMap = {};
    const rows = Array.from(localTable.querySelectorAll('tr'));
    const wanted = String(wantedColorCode || '').trim().toUpperCase();

    const list = Array.isArray(gridJson)
      ? gridJson
      : (gridJson && Array.isArray(gridJson.products))
        ? gridJson.products
        : [];

    const products = list.filter(p =>
      String(p.colorCode || '').trim().toUpperCase() === wanted
    );

    const eanBySize = {};

    for (const prod of products) {
      for (const sku of (prod.skus || [])) {
        let label =
          String(sku.sizeDisplayName || '').trim().toUpperCase() ||
          String(sku.sizeName || '').trim().toUpperCase();

        if (!label) {
          const base = String(sku.sizeName || '').trim().toUpperCase();
          const sub  = String(sku.subSizeName || '').trim().toUpperCase();
          label = (base + (sub || '')).trim();
        }

        const ean = String(sku.eanCode || '').trim();
        if (!label || !ean) continue;

        for (const k of aliasCandidates(label)) {
          eanBySize[k] = ean;
        }
      }
    }

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 1) continue;

      const maatInput = cells[0].querySelector('input.product_option_small');
      const maatRaw = maatInput ? maatInput.value : '';
      const maat = normalizeLocalSize(maatRaw);
      if (!maat) continue;

      const ean = eanBySize[maat];
      if (ean) qtyMap[ean] = probeQty;
    }

    return qtyMap;
  }

  function buildValidatePayloadFromGrid(productsJson, wantedColorCode, probeQtyByEan = {}, styleIdFallback = '') {
    const list = Array.isArray(productsJson)
      ? productsJson
      : (productsJson && Array.isArray(productsJson.products))
        ? productsJson.products
        : [];

    const wanted = String(wantedColorCode || '').trim().toUpperCase();

    return list.map(prod => {
      const prodColor = String(prod.colorCode || '').trim().toUpperCase();
      const deliveryDate =
        prod.deliveryDate ||
        prod.requestedDeliveryStartDate ||
        prod.selectableRequestedDeliveryRangeStartDate ||
        null;

      const entries = Array.isArray(prod.skus) ? prod.skus.map(sku => {
        const ean = String(sku.eanCode || '').trim();

        return {
          sizeName: String(sku.sizeName || sku.sizeDisplayName || '').trim() || null,
          subsizeName: String(sku.subSizeName || '').trim() || null,
          eanCode: ean,
          quantity: prodColor === wanted
            ? Number(probeQtyByEan[ean] || 0)
            : 0
        };
      }) : [];

      return {
        productUniqueId: String(
          prod.productUniqueId ||
          prod.styleId ||
          prod.productId ||
          styleIdFallback ||
          ''
        ).trim(),
        productColorCode: String(prod.colorCode || '').trim(),
        manualDiscountPercentage: 0,
        deliveryDate,
        deliveryWindowCode: null,
        lockDelivery: true,
        entries,
        productCollectionId: String(
          prod.collectionId ||
          prod.productCollectionId ||
          'Zetex_01'
        ).trim(),
        discountGroupCode: null,
        orderLineTypeCode: '',
        remark: null
      };
    });
  }

  function buildStatusMapFromValidate(validateJson) {
    const map = {};
    const lines = Array.isArray(validateJson?.lines) ? validateJson.lines : [];

    for (const line of lines) {
      const entries = Array.isArray(line?.cartLineEntries) ? line.cartLineEntries : [];

      for (const entry of entries) {
        const maat = String(
          entry?.skuSizeDisplayName ||
          entry?.skuSizeName ||
          ''
        ).trim().toUpperCase();

        const ean = String(entry?.skuEanCode || '').trim();
        const requestedQty = Number(entry?.quantity) || 0;
        const errs = Array.isArray(entry?.errors) ? entry.errors : [];

        let stock = requestedQty;
        let exact = false;

        for (const err of errs) {
          if (err?.messageType !== 'INSUFFICIENT_STOCK') continue;

          const over = extractOverageFromMessage(err?.message || '');
          if (Number.isFinite(over)) {
            stock = Math.max(0, requestedQty - over);
            exact = true;
            break;
          }
        }

        if (!maat) continue;

        for (const key of aliasCandidates(maat)) {
          map[key] = {
            status: stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
            stock,
            ean,
            exact,
            requestedQty
          };
        }
      }
    }

    return map;
  }

  async function getValidateForTable(styleId, colorCode, localTable, cartId) {
    const gridJson = await getGrid(styleId, cartId);
    const probeQtyMap = buildProbeQtyMapForTable(localTable, gridJson, colorCode, PROBE_QTY);
    const payload = buildValidatePayloadFromGrid(gridJson, colorCode, probeQtyMap, styleId);

    console.log(LOG_PREFIX, 'validate payload for', styleId, colorCode, payload);

    const text = await bridgeValidate(styleId, cartId, payload);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function buildSizeEanMapFromGrid(gridJson, wantedColorCode) {
    const wanted = String(wantedColorCode || '').trim().toUpperCase();
    const list = Array.isArray(gridJson)
      ? gridJson
      : (gridJson && Array.isArray(gridJson.products))
        ? gridJson.products
        : [];

    const map = new Map();

    for (const prod of list) {
      const prodColor = String(prod.colorCode || '').trim().toUpperCase();
      if (prodColor !== wanted) continue;

      for (const sku of (prod.skus || [])) {
        let label =
          String(sku.sizeDisplayName || '').trim().toUpperCase() ||
          String(sku.sizeName || '').trim().toUpperCase();

        if (!label) {
          const base = String(sku.sizeName || '').trim().toUpperCase();
          const sub = String(sku.subSizeName || '').trim().toUpperCase();
          label = (base + (sub || '')).trim();
        }

        const ean = String(sku.eanCode || '').replace(/\D/g, '');
        if (!label || !ean) continue;

        for (const key of aliasCandidates(label)) {
          if (!map.has(key)) map.set(key, ean);
        }
      }
    }

    return map;
  }

  // ---------------------------------------------------------------------------
  // Button UI
  // ---------------------------------------------------------------------------
  function ensureButton() {
    if (!document.body) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '⛏️ SS&E | Zetex';
      btn.style.cssText = `
        position: fixed;
        right: 10px;
        top: 10px;
        z-index: 999999;
        padding: 10px 12px;
        background: #2980b9;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);
      btn.addEventListener('click', () => onScrapeClick(false));
    }

    const isZetex = isZetexBrand();
    const tableReady = hasTable();
    const active = isTab3Active();

    btn.style.display = (isZetex && active) ? '' : 'none';
    btn.disabled = !tableReady;
    btn.style.opacity = tableReady ? '1' : '.55';

    if (!isZetex) {
      btn.title = 'Selecteer een Zetex/Pastunette/Rebelle/Robson product op tab 1.';
    } else if (!active) {
      btn.title = 'Ga naar tab Maten/Opties (#tabs-3).';
    } else if (!tableReady) {
      btn.title = 'Wachten tot #tabs-3 geladen is...';
    } else if (!bridgeIsOnlineByHeartbeat()) {
      btn.title = 'Open een b2b.zetex.nl-tab met dit script actief en bezoek een product.';
    } else {
      btn.title = 'Haal stock + EAN uit Zetex B2B via grid + validate en plak in #tabs-3';
    }
  }

  function setBtnState(opts = {}) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    if (opts.text != null) btn.textContent = opts.text;
    if (opts.bg != null) btn.style.backgroundColor = opts.bg;
    if (opts.disabled != null) btn.disabled = !!opts.disabled;
    if (opts.opacity != null) btn.style.opacity = String(opts.opacity);
  }

  function resetBtn() {
    const isZetex = isZetexBrand();
    const tableReady = hasTable();
    const active = isTab3Active();

    setBtnState({
      text: '⛏️ SS&E | Zetex',
      bg: '#2980b9',
      disabled: !tableReady,
      opacity: tableReady ? '1' : '.55',
    });

    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    btn.style.display = (isZetex && active) ? '' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Main action
  // ---------------------------------------------------------------------------
  async function onScrapeClick(autoSaveThisRun = false) {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    if (!isZetexBrand()) {
      setBtnState({
        text: '❌ Merk niet ondersteund',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!isTab3Active()) {
      setBtnState({
        text: '❌ Open tab Maten/Opties',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!hasTable()) {
      setBtnState({
        text: '❌ #tabs-3 niet klaar',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    if (!bridgeIsOnlineByHeartbeat()) {
      setBtnState({
        text: '❌ Zetex bridge offline',
        bg: '#e06666',
      });
      alert(
        'Zetex-bridge offline.\n' +
        'Open een b2b.zetex.nl-tab waar dit script actief is, log in,\n' +
        'bezoek een product zodat de grid-call loopt, en probeer opnieuw.'
      );
      setTimeout(resetBtn, 2500);
      return;
    }

    const supplierPid = document.querySelector(PID_SELECTOR)?.value?.trim();
    if (!supplierPid) {
      setBtnState({
        text: '❌ Geen Supplier PID',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const pidParts = splitSupplierPid(supplierPid);
    if (!pidParts) {
      console.warn(LOG_PREFIX, 'Onverwacht PID-formaat:', supplierPid);
      setBtnState({
        text: '❌ PID-formaat onbekend',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    const styleId = String(pidParts.base || '').trim();
    const colorCode = String(pidParts.color || '').trim().toUpperCase();
    const table = document.querySelector(TABLE_SELECTOR);

    if (!styleId || !colorCode || !table) {
      setBtnState({
        text: '❌ Onvoldoende productdata',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return;
    }

    try {
      setBtnState({
        text: '⏳ Zetex grid laden...',
        bg: '#f1c40f',
        disabled: true,
        opacity: '.8',
      });

      const gridJson = await getGrid(styleId, undefined);

      setBtnState({
        text: '⏳ Zetex validate laden...',
        bg: '#f39c12',
      });

      const validateJson = await getValidateForTable(styleId, colorCode, table, undefined);
      const matched = handleZetexData(gridJson, validateJson, colorCode);

      if (autoSaveThisRun && matched > 0) {
        clickUpdateProductButton();
      }
    } catch (e) {
      console.error(LOG_PREFIX, 'Fout tijdens Zetex scrape:', e);

      const msg = String(e?.message || e);
      let label = '❌ Fout bij laden';

      if (msg.includes('HTTP 401')) label = '❌ Zetex auth fout';
      else if (msg.includes('Geen webstoreId')) label = '❌ Geen webstoreId';
      else if (msg.includes('Geen cartId')) label = '❌ Geen cartId';
      else if (msg.includes('bridge timeout')) label = '❌ Grid timeout';
      else if (msg.includes('validate bridge timeout')) label = '❌ Validate timeout';

      setBtnState({
        text: label,
        bg: '#e06666',
        disabled: false,
        opacity: '1'
      });
      setTimeout(resetBtn, 3500);
    }
  }

  function handleZetexData(gridJson, validateJson, colorCode) {
    const eanMap = buildSizeEanMapFromGrid(gridJson, colorCode);
    const statusMap = buildStatusMapFromValidate(validateJson);

    if ((!eanMap || eanMap.size === 0) && (!statusMap || Object.keys(statusMap).length === 0)) {
      setBtnState({
        text: '❌ Geen maten in data',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return 0;
    }

    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) {
      setBtnState({
        text: '❌ #tabs-3 niet klaar',
        bg: '#e06666',
      });
      setTimeout(resetBtn, 2500);
      return 0;
    }

    const rows = table.querySelectorAll('tr');
    let matched = 0;

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      const maatInput = cells[0].querySelector('input.product_option_small');
      const maatRaw = maatInput ? maatInput.value : '';
      const maatNorm = normalizeLocalSize(maatRaw);
      if (!maatNorm) return;

      let ean = eanMap.get(maatNorm) || '';
      let remoteEntry = null;

      for (const key of aliasCandidates(maatNorm)) {
        if (statusMap && statusMap[key]) {
          remoteEntry = statusMap[key];
          if (!ean && remoteEntry.ean) ean = String(remoteEntry.ean).replace(/\D/g, '');
          break;
        }
      }

      if (!ean && !remoteEntry) return;

      const supplierQty = Number(remoteEntry?.stock) || 0;
      const stockMapped = mapSupplierQtyToLocalStock(supplierQty, table);

      const stockInput = row.querySelector(
        'input[name^="options"][name$="[stock]"]'
      );
      const eanInput = row.querySelector(
        'input[name^="options"][name$="[barcode]"]'
      );

      if (stockInput) {
        stockInput.value = String(stockMapped);
        stockInput.dispatchEvent(new Event('input', { bubbles: true }));
        stockInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (eanInput && ean) {
        eanInput.value = String(ean);
        eanInput.dispatchEvent(new Event('input', { bubbles: true }));
        eanInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      matched++;
    });

    console.info(LOG_PREFIX, `${matched} rijen ingevuld uit Zetex B2B via validate`);
    setBtnState({
      text: `📦 ${matched} rijen gevuld`,
      bg: '#2ecc71',
      disabled: false,
      opacity: '1',
    });
    setTimeout(resetBtn, 2500);

    return matched;
  }

  // ---------------------------------------------------------------------------
  // Hotkey
  // ---------------------------------------------------------------------------
  function onKeyDown(e) {
    const target = e.target;
    const tag = target && target.tagName;

    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      (target && target.isContentEditable)
    ) {
      return;
    }

    const key = (e.key || '').toLowerCase();
    const match =
      key === HOTKEY.key &&
      !!e.ctrlKey === HOTKEY.ctrl &&
      !!e.shiftKey === HOTKEY.shift &&
      !!e.altKey === HOTKEY.alt;

    if (!match) return;

    if (!isZetexBrand() || !hasTable() || !isTab3Active()) return;

    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.style.display === 'none' || btn.disabled) return;

    e.preventDefault();
    onScrapeClick(true);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  const observer = new MutationObserver(() => ensureButton());

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'MutationObserver fout:', e);
    }
  }

  window.addEventListener('pageshow', ensureButton);
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureButton();
  });
  window.addEventListener('hashchange', ensureButton);
  window.addEventListener('popstate', ensureButton);

  ensureButton();
  startObserver();
  setInterval(ensureButton, 2000);

  if (!window.__zetexScraperHotkeyBound) {
    document.addEventListener('keydown', onKeyDown);
    window.__zetexScraperHotkeyBound = true;
  }
})();
