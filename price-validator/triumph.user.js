// ==UserScript==
// @name         DDO | Price Validator - Triumph
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0.0
// @description  Valideert geselecteerde of alle zichtbare DDO-producten tegen Triumph en toont remote-status + discount match in de lijst.
// @author       C. P. van Beek
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=108*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=117*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=119*
// @match        https://b2b.triumph.com/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/price-validator/triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/price-validator/triumph.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const ON_DDO     = location.hostname.includes('dutchdesignersoutlet.com');
  const ON_TRIUMPH = location.hostname.includes('b2b.triumph.com');

  const LOG = '[Triumph List Validator]';

  const HEARTBEAT_KEY = 'triumph_validator_bridge_heartbeat';
  const AUTH_KEY      = 'triumph_validator_bridge_auth';
  const REQ_KEY       = 'triumph_validator_bridge_req';
  const RESP_KEY      = 'triumph_validator_bridge_resp';

  const TIMEOUT_MS = 20000;
  const CONCURRENCY = 4;

  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function parsePrice(value) {
    if (value == null) return null;

    const cleaned = String(value)
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}\b)/g, '')
      .replace(',', '.')
      .trim();

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function fmtPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(0)}%`;
  }

  function fmtMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `€ ${n.toFixed(2)}`;
  }

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

  function splitSupplierPid(rawPid) {
    const pid = String(rawPid || '').trim();
    if (!pid) return null;

    const idx = pid.lastIndexOf('-');
    if (idx === -1) return null;

    return {
      full: pid,
      styleId: pid.slice(0, idx).trim(),
      colorCode: pid.slice(idx + 1).trim().toUpperCase()
    };
  }

  function normalizeProducts(gridJson) {
    if (Array.isArray(gridJson)) return gridJson;
    if (gridJson && Array.isArray(gridJson.products)) return gridJson.products;
    return [];
  }

  function findProductByColor(gridJson, colorCode) {
    const wanted = String(colorCode || '').trim().toUpperCase().padStart(4, '0');
    return normalizeProducts(gridJson).find(
      p => String(p?.colorCode || '').trim().toUpperCase().padStart(4, '0') === wanted
    ) || null;
  }

  function extractWholesaleInfo(product) {
    const dp = product?.displayPrice || null;

    if (!dp) {
      return {
        customerWholesalePrice: null,
        originalWholesalePrice: null,
        wholesalePrice: null,
        retailPrice: null,
        equalWholesale: null,
        hasDiscount: null,
        discountPct: null
      };
    }

    const customerWholesalePrice = parsePrice(dp.customerWholesalePrice);
    const originalWholesalePrice = parsePrice(dp.originalWholesalePrice);
    const wholesalePrice = parsePrice(dp.wholesalePrice);
    const retailPrice = parsePrice(dp.retailPrice);

    const baseOriginal = Number.isFinite(originalWholesalePrice)
      ? originalWholesalePrice
      : wholesalePrice;

    const current = Number.isFinite(customerWholesalePrice)
      ? customerWholesalePrice
      : wholesalePrice;

    let equalWholesale = null;
    let hasDiscount = null;
    let discountPct = null;

    if (Number.isFinite(baseOriginal) && Number.isFinite(current)) {
      equalWholesale = Math.abs(baseOriginal - current) < 0.0001;
      hasDiscount = current < baseOriginal;

      if (hasDiscount && baseOriginal > 0) {
        discountPct = ((baseOriginal - current) / baseOriginal) * 100;
      } else if (equalWholesale) {
        discountPct = 0;
      }
    }

    return {
      customerWholesalePrice,
      originalWholesalePrice,
      wholesalePrice,
      retailPrice,
      equalWholesale,
      hasDiscount,
      discountPct
    };
  }

  // ===========================================================================
  // TRIUMPH SIDE
  // ===========================================================================
  if (ON_TRIUMPH) {
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let pageFetch = null;

    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    function storeAuth(authValue, via, meta = {}) {
      if (!authValue) return;

      const auth = String(authValue).trim();
      if (!/^bearer\s+/i.test(auth)) return;

      const prev = GM_getValue(AUTH_KEY, null);
      const session = {
        auth,
        webstoreId: meta.webstoreId || prev?.webstoreId || null,
        cartId: meta.cartId || prev?.cartId || null,
        styleId: meta.styleId || prev?.styleId || null,
        ts: Date.now()
      };

      GM_setValue(AUTH_KEY, session);

      console.info(
        LOG,
        '[remote auth captured]',
        via,
        session.webstoreId || 'no-webstore',
        session.cartId || 'no-cart',
        session.styleId || 'no-style'
      );
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
              storeAuth(auth, 'fetch', meta);
            }
          } catch {}

          return pageFetch(input, init);
        };

        console.info(LOG, 'fetch hook actief');
      } catch (e) {
        console.warn(LOG, 'fetch hook fout', e);
      }
    })();

    (function hookXHRForAuth() {
      try {
        const OrigXHR = w.XMLHttpRequest;
        if (!OrigXHR) return;

        function XHRProxy() {
          const xhr = new OrigXHR();
          const origOpen = xhr.open;
          const origSetRequestHeader = xhr.setRequestHeader;

          xhr._validatorUrl = '';

          xhr.open = function(method, url) {
            try { xhr._validatorUrl = url; } catch {}
            return origOpen.apply(this, arguments);
          };

          xhr.setRequestHeader = function(name, value) {
            try {
              if (/^authorization$/i.test(name)) {
                const meta = extractMetaFromUrl(xhr._validatorUrl);
                storeAuth(value, 'xhr', meta);
              }
            } catch {}
            return origSetRequestHeader.apply(this, arguments);
          };

          return xhr;
        }

        XHRProxy.prototype = OrigXHR.prototype;
        w.XMLHttpRequest = XHRProxy;

        console.info(LOG, 'xhr hook actief');
      } catch (e) {
        console.warn(LOG, 'xhr hook fout', e);
      }
    })();

    async function fetchGrid(styleId, cartId, timeout = TIMEOUT_MS) {
      const session = GM_getValue(AUTH_KEY, null);
      const auth = session?.auth || null;
      const webstoreId = session?.webstoreId || null;
      const effectiveCartId = cartId || session?.cartId || null;

      if (!webstoreId) throw new Error('Geen webstoreId gevonden in Triumph sessie.');
      if (!effectiveCartId) throw new Error('Geen cartId gevonden in Triumph sessie.');

      const url =
        `https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(webstoreId)}` +
        `/carts/${encodeURIComponent(effectiveCartId)}` +
        `/grid/${encodeURIComponent(styleId)}/products`;

      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeout);

      const headers = { Accept: 'application/json, text/plain, */*' };
      if (auth) headers.Authorization = auth;

      const f = pageFetch || w.fetch.bind(w);
      const res = await f(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: ctrl.signal
      });

      clearTimeout(to);

      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} :: ${text}`);
      return text;
    }

    GM_addValueChangeListener(REQ_KEY, (_name, _old, req) => {
      if (!req || !req.id || !req.styleId) return;

      (async () => {
        try {
          const text = await fetchGrid(req.styleId, req.cartId, req.timeout || TIMEOUT_MS);
          GM_setValue(RESP_KEY, { id: req.id, ok: true, text });
        } catch (e) {
          GM_setValue(RESP_KEY, { id: req.id, ok: false, error: String(e?.message || e) });
        }
      })();
    });

    return;
  }

  // ===========================================================================
  // DDO SIDE
  // ===========================================================================
  if (!ON_DDO) return;

  const BTN_ID = 'triumph-list-validator-btn';

  const editCache = new Map();
  const gridCache = new Map();

  function bridgeOnline(maxAge = 6000) {
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

      const handle = GM_addValueChangeListener(RESP_KEY, (_name, _old, msg) => {
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

  async function getGrid(styleId) {
    if (gridCache.has(styleId)) return gridCache.get(styleId);

    const p = bridgeGetGrid(styleId)
      .then(text => {
        try { return JSON.parse(text); }
        catch { return []; }
      })
      .catch(err => {
        gridCache.delete(styleId);
        throw err;
      });

    gridCache.set(styleId, p);
    return p;
  }

  function getMainTable() {
    return $('table.control');
  }

  function getBodyRows() {
    const table = getMainTable();
    if (!table) return [];
    return $$('tbody tr', table);
  }

  function getTargetRows() {
    const rows = getBodyRows();
    const checked = rows.filter(row => {
      const cb = row.querySelector('input[name="products[]"]');
      return !!cb?.checked;
    });
    return checked.length ? checked : rows;
  }

  function getCells(row) {
    return row.querySelectorAll('td.control, td');
  }

  function getProductIdFromRow(row) {
    const checkbox = row.querySelector('input[name="products[]"]');
    if (checkbox?.value) return checkbox.value.trim();

    const editLink = row.querySelector('a[href*="section=products"][href*="action=edit"][href*="id="]');
    if (editLink) {
      const m = editLink.href.match(/[?&]id=(\d+)/);
      if (m) return m[1];
    }

    const mouseAttr = row.getAttribute('onmousedown') || '';
    const m = mouseAttr.match(/id=(\d+)/);
    return m ? m[1] : null;
  }

  function getPublicCell(row) {
    const cells = getCells(row);
    return cells[4] || null;
  }

  function getPriceCell(row) {
    const cells = getCells(row);
    return cells[6] || null;
  }

  function getAdvicePriceCell(row) {
    const cells = getCells(row);
    return cells[7] || null;
  }

  function ensureOriginalCellHtml(cell) {
    if (!cell) return '';
    if (!cell.dataset.triumphOriginalHtml) {
      cell.dataset.triumphOriginalHtml = cell.innerHTML;
    }
    return cell.dataset.triumphOriginalHtml;
  }

  function removeOldBadge(cell, cls) {
    if (!cell) return;
    cell.querySelectorAll(`.${cls}`).forEach(el => el.remove());
  }

  function appendBadge(cell, html, cls) {
    if (!cell) return;

    removeOldBadge(cell, cls);

    const wrap = document.createElement('div');
    wrap.className = cls;
    wrap.style.marginTop = '4px';
    wrap.style.fontSize = '12px';
    wrap.style.lineHeight = '1.35';
    wrap.innerHTML = html;

    cell.appendChild(wrap);
  }

  function getLocalDiscountPct(cell) {
    const pill = cell?.querySelector('.ddo-discount-pill');
    if (!pill) return 0;

    const txt = pill.textContent.trim();
    const m = txt.match(/([\d.,]+)/);
    if (!m) return 0;

    return parseFloat(m[1].replace(',', '.')) || 0;
  }

  function getLocalAdvicePrice(row) {
    const cell = getAdvicePriceCell(row);
    if (!cell) return null;
    return parsePrice(cell.textContent);
  }

  function setPublicResult(row, state) {
    const cell = getPublicCell(row);
    if (!cell) return;

    ensureOriginalCellHtml(cell);

    let html = '';
    if (state === 'ok') {
      html = `<span style="color:#1b5e20; font-weight:700;">✅ Remote</span>`;
    } else if (state === 'bad') {
      html = `<span style="color:#b71c1c; font-weight:700;">❌ Remote</span>`;
    } else {
      html = `<span style="color:#e65100; font-weight:700;">⚠️ Remote</span>`;
    }

    appendBadge(cell, html, 'triumph-public-badge');
  }

  function setPriceResult(row, state, remotePct = null) {
    const cell = getPriceCell(row);
    if (!cell) return;

    ensureOriginalCellHtml(cell);

    const localPct = getLocalDiscountPct(cell);
    let html = '';

    if (state === 'ok') {
      html = `<span style="color:#1b5e20; font-weight:700;">✅</span>`;
    } else if (state === 'discount') {
      const diff = Math.abs((remotePct || 0) - (localPct || 0));

      if (diff < 0.1) {
        html = `<span style="color:#1b5e20; font-weight:700;">✅</span>`;
      } else {
        html = `<span style="color:#b71c1c; font-weight:700;">❌ -${fmtPct(remotePct)}</span>`;
      }
    } else {
      html = `<span style="color:#e65100; font-weight:700;">⚠️</span>`;
    }

    appendBadge(cell, html, 'triumph-price-badge');
  }

  function setAdvicePriceResult(row, state, remoteRetailPrice = null) {
    const cell = getAdvicePriceCell(row);
    if (!cell) return;

    ensureOriginalCellHtml(cell);

    let html = '';

    if (state === 'ok') {
      html = `<span style="color:#1b5e20; font-weight:700;">✅</span>`;
    } else if (state === 'bad') {
      html = `<span style="color:#b71c1c; font-weight:700;">❌ ${fmtMoney(remoteRetailPrice)}</span>`;
    } else {
      html = `<span style="color:#e65100; font-weight:700;">⚠️</span>`;
    }

    appendBadge(cell, html, 'triumph-advice-badge');
  }

  function setPending(row) {
    const publicCell = getPublicCell(row);
    const priceCell = getPriceCell(row);
    const adviceCell = getAdvicePriceCell(row);

    if (publicCell) {
      ensureOriginalCellHtml(publicCell);
      appendBadge(
        publicCell,
        `<span style="color:#e65100; font-weight:700;">⏳</span>`,
        'triumph-public-badge'
      );
    }

    if (priceCell) {
      ensureOriginalCellHtml(priceCell);
      appendBadge(
        priceCell,
        `<span style="color:#e65100; font-weight:700;">⏳</span>`,
        'triumph-price-badge'
      );
    }

    if (adviceCell) {
      ensureOriginalCellHtml(adviceCell);
      appendBadge(
        adviceCell,
        `<span style="color:#e65100; font-weight:700;">⏳</span>`,
        'triumph-advice-badge'
      );
    }

    row.style.background = 'rgba(255, 193, 7, .08)';
    row.style.outline = '1px solid rgba(255, 193, 7, .35)';
  }

  function setRowState(row, state) {
    row.style.background = '';
    row.style.outline = '';

    if (state === 'ok') {
      row.style.background = 'rgba(46,125,50,.08)';
      row.style.outline = '1px solid rgba(46,125,50,.35)';
    } else if (state === 'bad') {
      row.style.background = 'rgba(198,40,40,.08)';
      row.style.outline = '1px solid rgba(198,40,40,.35)';
    } else if (state === 'warn') {
      row.style.background = 'rgba(239,108,0,.08)';
      row.style.outline = '1px solid rgba(239,108,0,.35)';
    }
  }

  async function fetchEditPageMeta(productId) {
    if (editCache.has(productId)) return editCache.get(productId);

    const p = (async () => {
      const url = `https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=${encodeURIComponent(productId)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Edit fetch HTTP ${res.status} for product ${productId}`);

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const supplierPid = doc.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim() || '';

      return { productId, supplierPid };
    })().catch(err => {
      editCache.delete(productId);
      throw err;
    });

    editCache.set(productId, p);
    return p;
  }

  async function validateRow(row) {
    const productId = getProductIdFromRow(row);

    if (!productId) {
      setPublicResult(row, 'warn');
      setPriceResult(row, 'warn');
      setAdvicePriceResult(row, 'warn');
      setRowState(row, 'warn');
      return;
    }

    setPending(row);

    try {
      const meta = await fetchEditPageMeta(productId);
      const pidParts = splitSupplierPid(meta.supplierPid);

      if (!pidParts) {
        setPublicResult(row, 'bad');
        setPriceResult(row, 'warn');
        setAdvicePriceResult(row, 'warn');
        setRowState(row, 'warn');
        return;
      }

      const gridJson = await getGrid(pidParts.styleId);
      const remoteProduct = findProductByColor(gridJson, pidParts.colorCode);

      if (!remoteProduct) {
        setPublicResult(row, 'bad');
        setPriceResult(row, 'warn');
        setAdvicePriceResult(row, 'warn');
        setRowState(row, 'bad');
        return;
      }

      const whs = extractWholesaleInfo(remoteProduct);
      const localAdvicePrice = getLocalAdvicePrice(row);

      setPublicResult(row, 'ok');

      if (whs.hasDiscount) {
        setPriceResult(row, 'discount', whs.discountPct);
      } else if (whs.equalWholesale === true) {
        setPriceResult(row, 'ok');
      } else {
        setPriceResult(row, 'warn');
      }

      if (Number.isFinite(whs.retailPrice) && Number.isFinite(localAdvicePrice)) {
        const diff = Math.abs(whs.retailPrice - localAdvicePrice);
        if (diff < 0.01) {
          setAdvicePriceResult(row, 'ok');
        } else {
          setAdvicePriceResult(row, 'bad', whs.retailPrice);
        }
      } else {
        setAdvicePriceResult(row, 'warn');
      }

      setRowState(row, 'ok');

      row.dataset.triumphProductId = productId;
      row.dataset.triumphSupplierPid = meta.supplierPid;
      row.dataset.triumphStyleId = pidParts.styleId;
      row.dataset.triumphColorCode = pidParts.colorCode;

      console.info(LOG, {
        productId,
        supplierPid: meta.supplierPid,
        remoteFound: true,
        customerWholesalePrice: whs.customerWholesalePrice,
        originalWholesalePrice: whs.originalWholesalePrice,
        retailPrice: whs.retailPrice,
        localAdvicePrice,
        hasDiscount: whs.hasDiscount,
        discountPct: whs.discountPct
      });
    } catch (err) {
      console.error(LOG, 'validateRow error', err);
      setPublicResult(row, 'warn');
      setPriceResult(row, 'warn');
      setAdvicePriceResult(row, 'warn');
      setRowState(row, 'warn');
    }
  }

  async function runPool(items, worker, concurrency = 4) {
    let index = 0;

    async function next() {
      while (index < items.length) {
        const current = index++;
        await worker(items[current], current);
      }
    }

    const runners = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => next()
    );

    await Promise.all(runners);
  }

  function setButtonBusy(isBusy) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    btn.textContent = isBusy ? '⏳' : '€';
    btn.disabled = !!isBusy;
    btn.style.opacity = isBusy ? '0.95' : (bridgeOnline() ? '1' : '.7');
  }

  async function runBatchValidation() {
    if (!bridgeOnline()) {
      alert(
        'Triumph bridge offline.\n\n' +
        'Open eerst een b2b.triumph.com-tab met dit script actief,\n' +
        'log in en bezoek een product zodat de sessie wordt opgepikt.'
      );
      return;
    }

    const rows = getTargetRows();
    if (!rows.length) return;

    setButtonBusy(true);

    try {
      await runPool(rows, async (row) => {
        await validateRow(row);
      }, CONCURRENCY);
    } finally {
      setButtonBusy(false);
    }
  }

  function ensureButton() {
    if (!document.body) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '€';
      btn.style.cssText = `
        position: fixed !important;
        right: 115px !important;
        bottom: 16px !important;
        z-index: 2147483646 !important;
        background: #0f172a !important;
        color: #e5e7eb !important;
        border: 1px solid #334155 !important;
        border-radius: 999px !important;
        padding: 0 !important;
        width: 42px !important;
        height: 39px !important;
        font-size: 18px !important;
        box-shadow: 0 8px 18px rgba(0, 0, 0, .25) !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        line-height: 1 !important;
        user-select: none !important;
        pointer-events: auto !important;
      `;
      btn.addEventListener('click', runBatchValidation);
      document.body.appendChild(btn);
    }

    btn.style.opacity = bridgeOnline() ? '1' : '.7';
  }

  function boot() {
    ensureButton();

    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    setInterval(ensureButton, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
