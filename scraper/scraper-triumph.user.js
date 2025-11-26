// ==UserScript==
// @name         Voorraadchecker Proxy - Triumph
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.2
// @description  Vergelijk local stock met Triumph/Sloggi stock via grid-API (met bridge & auth-capture in page-context)
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://b2b.triumph.com/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-triumph.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL    = location.hostname.includes('lingerieoutlet.nl');
  const ON_TRIUMPH = location.hostname.includes('b2b.triumph.com');

  const HEARTBEAT_KEY   = 'triumph_bridge_heartbeat';
  const AUTH_HEADER_KEY = 'triumph_bridge_auth_header';

  const TIMEOUT_MS   = 20000;
  const KEEPALIVE_MS = 300000;

  // Uit jouw network-calls (Triumph + Sloggi op dezelfde webstore, andere cart)
  const TRIUMPH_WEBSTORE_ID = 2442;
  const CART_ID_TRIUMPH     = 2155706;
  const CART_ID_SLOGGI      = 2383370;

  const TRIUMPH_API_BASE =
    `https://b2b.triumph.com/api/shop/webstores/${TRIUMPH_WEBSTORE_ID}/carts/`;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm  = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  // ========================================================================
  // 1) BRIDGE OP TRIUMPH (in echte page-context via unsafeWindow)
  // ========================================================================
  if (ON_TRIUMPH) {
    const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    let pageFetch = null;

    // Heartbeat
    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, 2500);

    // --- helpers voor auth capture ---
    function storeAuth(val, via) {
      if (!val) return;
      const auth = String(val).trim();
      if (!auth.toLowerCase().startsWith('bearer ')) return;
      try {
        const prev = GM_getValue(AUTH_HEADER_KEY, null);
        if (prev === auth) return;
        GM_setValue(AUTH_HEADER_KEY, auth);
        console.info('[Triumph-bridge][DEBUG]', via, 'Authorization captured:',
          auth.slice(0, 22) + '…');
      } catch (e) {
        console.warn('[Triumph-bridge][DEBUG] kon AUTH niet opslaan:', e);
      }
    }

    function extractAuthFromHeaders(headers) {
      if (!headers) return null;

      // Headers-obj
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get('Authorization') || headers.get('authorization') || null;
      }

      // Array [[k,v]]
      if (Array.isArray(headers)) {
        for (const [k, v] of headers) {
          if (/^authorization$/i.test(k)) return v;
        }
      }

      // plain object
      if (typeof headers === 'object') {
        for (const k of Object.keys(headers)) {
          if (/^authorization$/i.test(k)) {
            return headers[k];
          }
        }
      }

      return null;
    }

    // --- fetch-hook in page-context ---
    (function hookFetchForAuth() {
      try {
        const orig = w.fetch;
        if (!orig) {
          console.warn('[Triumph-bridge][DEBUG] geen fetch gevonden om te hooken');
          return;
        }
        pageFetch = orig.bind(w);

        w.fetch = function patchedFetch(input, init = {}) {
          try {
            const auth = extractAuthFromHeaders(init.headers);
            if (auth) storeAuth(auth, 'via fetch');
          } catch (e) {
            console.debug('[Triumph-bridge][DEBUG] fetch-hook error:', e);
          }
          return pageFetch(input, init);
        };

        console.info('[Triumph-bridge] fetch-hook actief in page-context');
      } catch (e) {
        console.warn('[Triumph-bridge] kon fetch niet hooken:', e);
      }
    })();

    // --- XHR-hook in page-context ---
    (function hookXHRForAuth() {
      try {
        const OrigXHR = w.XMLHttpRequest;
        if (!OrigXHR) {
          console.warn('[Triumph-bridge][DEBUG] geen XMLHttpRequest gevonden om te hooken');
          return;
        }

        function XHRProxy() {
          const xhr = new OrigXHR();
          const origSetRequestHeader = xhr.setRequestHeader;
          xhr.setRequestHeader = function (name, value) {
            try {
              if (/^authorization$/i.test(name)) {
                storeAuth(value, 'via XHR');
              }
            } catch (e) {
              console.debug('[Triumph-bridge][DEBUG] XHR-hook error:', e);
            }
            return origSetRequestHeader.apply(this, arguments);
          };
          return xhr;
        }
        XHRProxy.prototype = OrigXHR.prototype;
        w.XMLHttpRequest = XHRProxy;

        console.info('[Triumph-bridge] XHR-hook actief in page-context');
      } catch (e) {
        console.warn('[Triumph-bridge] kon XHR niet hooken:', e);
      }
    })();

    // --- API-call met Authorization + dynamische cartId (Triumph/Sloggi) ---
    async function fetchTriumphGrid(styleId, cartId, timeout = TIMEOUT_MS) {
      const effectiveCartId = cartId || CART_ID_TRIUMPH;
      const url  =
        `${TRIUMPH_API_BASE}${encodeURIComponent(effectiveCartId)}` +
        `/grid/${encodeURIComponent(styleId)}/products`;
      const auth = GM_getValue(AUTH_HEADER_KEY, null);

      console.debug('[Triumph-bridge][DEBUG] grid-call',
        url, '| auth aanwezig?', !!auth);

      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), timeout);

      const headers = {
        'Accept': 'application/json, text/plain, */*'
      };
      if (auth) headers['Authorization'] = auth;

      const f = pageFetch || w.fetch.bind(w);

      const res = await f(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: ctrl.signal
      });

      clearTimeout(to);

      if (!res.ok) {
        console.warn('[Triumph-bridge][DEBUG] HTTP status', res.status, 'voor', url);
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    }

    // --- Bridge-listener: requests vanuit tool ---
    GM_addValueChangeListener('triumph_bridge_req', (_name, _old, req) => {
      if (!req || !req.id || !req.styleId) return;

      (async () => {
        try {
          const text = await fetchTriumphGrid(
            req.styleId,
            req.cartId,
            req.timeout || TIMEOUT_MS
          );
          GM_setValue('triumph_bridge_resp', {
            id: req.id,
            ok: true,
            text
          });
        } catch (e) {
          GM_setValue('triumph_bridge_resp', {
            id: req.id,
            ok: false,
            error: String(e)
          });
        }
      })();
    });

    if (document.readyState !== 'loading') {
      console.info('[Triumph-bridge] actief op', location.href);
    } else {
      document.addEventListener('DOMContentLoaded', () =>
        console.info('[Triumph-bridge] actief op', location.href)
      );
    }

    // Eventueel keep-alive (optioneel, nu uit)
    // setInterval(() => { /* evt ping-call naar Triumph */ }, KEEPALIVE_MS);

    return;
  }

  // ========================================================================
  // 2) CLIENT OP LINGERIEOUTLET (Proxy-tool)
  // ========================================================================
  if (!ON_TOOL) return;

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
      if (lb && typeof lb.resultaat === 'function') {
        lb.resultaat(String(id), txt);
      } else {
        console.info(`[Triumph][${id}] status: ${txt}`);
      }
    },
    perMaat(id, report) {
      console.groupCollapsed(`[Triumph][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat:   r.maat,
          local:  r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          stock:  Number.isFinite(r.stock)  ? r.stock  : '—',
          status: r.actie
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

  // --- Bridge-client (tool-kant) met cartId ---
  function bridgeGetGrid(styleId, cartId, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = uid();

      let handle;
      try {
        handle = GM_addValueChangeListener('triumph_bridge_resp', (_name, _old, msg) => {
          if (!msg || msg.id !== id) return;
          try { GM_removeValueChangeListener(handle); } catch {}
          if (msg.ok) {
            resolve(msg.text);
          } else {
            reject(new Error(msg.error || 'bridge error'));
          }
        });
      } catch (e) {
        console.error('[Triumph][bridge] kon listener niet registreren:', e);
        reject(e);
        return;
      }

      GM_setValue('triumph_bridge_req', { id, styleId, cartId, timeout });

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  // --- p-limit ---
  function pLimit(n) {
    const queue = [];
    let active = 0;

    const next = () => {
      if (active >= n || queue.length === 0) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => {
        active--;
        next();
      });
    };

    return fn => new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  }

  // --- Maat-aliases ---
  // 1–8 voor Triumph/Sloggi one-size / alpha
  const SIZE_ALIAS = {
    // Triumph numeriek → alpha / beschrijvend
    '1': 'ONE SIZE',
    '2': 'TWO SIZE',
    '3': 'XS',
    '4': 'S',
    '5': 'M',
    '6': 'L',
    '7': 'XL',
    '8': 'XXL',

    // Bestaande aliassen
    '2XL':    'XXL',
    'XXL':    '2XL',
    '3XL':    'XXXL',
    'XXXL':   '3XL',
    '4XL':    'XXXXL',
    'XXXXL':  '4XL',
    'XS/S':   'XS',
    'S/M':    'M',
    'M/L':    'L',
    'L/XL':   'XL',
    'XL/2XL': '2XL'
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

  // --- Triumph stock → interne stock (Naturana-regels) ---
  function mapTriumphStockLevel(stockNum) {
    const n = Number(stockNum) || 0;
    if (n < 3)  return 0;
    if (n === 3) return 2;
    if (n === 4) return 4;
    if (n > 4)   return 5;
    return 0;
  }

  // --- Triumph GRID JSON → statusMap voor één kleur ---
  function buildStatusMapFromTriumphGrid(productsJson, wantedColorCode) {
    const list = Array.isArray(productsJson)
      ? productsJson
      : (productsJson && Array.isArray(productsJson.products))
        ? productsJson.products
        : [];

    const wanted = String(wantedColorCode || '').padStart(4, '0');
    const map = {};

    const products = list.filter(p =>
      String(p.colorCode || '').padStart(4, '0') === wanted
    );

    if (!products.length) {
      console.debug('[Triumph][DEBUG] Geen product gevonden voor kleurcode', wanted);
      return map;
    }

    products.forEach(prod => {
      (prod.skus || []).forEach(sku => {
        let label = (sku.simpleSizeName || '').trim().toUpperCase();
        if (!label) {
          const base = String(sku.sizeName || '').trim().toUpperCase();
          const cup  = String(sku.subSizeName || '').trim().toUpperCase();
          label = (base + (cup || '')).trim();
        }
        if (!label) return;

        let totalQty = 0;
        if (Array.isArray(sku.stockLevels)) {
          for (const sl of sku.stockLevels) {
            const q = Number(sl && sl.quantity);
            if (Number.isFinite(q) && q > 0) totalQty += q;
          }
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

    return map;
  }

  // --- Markering in tabel ---
  const resolveRemote = (map, label) => {
    for (const c of aliasCandidates(label)) {
      if (map[c]) return map[c];
    }
    return undefined;
  };

  function jumpFlash(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const oldBox = el.style.boxShadow;
      el.style.boxShadow =
        '0 0 0 2px rgba(255,255,0,.9), 0 0 12px rgba(255,255,0,.9)';
      setTimeout(() => { el.style.boxShadow = oldBox || ''; }, 650);
    } catch {}
  }

  function applyRulesAndMark(localTable, statusMap) {
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let firstMut = null;

    rows.forEach(row => {
      const maat = (row.dataset.size ||
        (row.children[0] && row.children[0].textContent) ||
        '').trim().toUpperCase();

      const local = parseInt(
        (row.children[1] && row.children[1].textContent || '').trim(),
        10
      ) || 0;

      const remoteEntry   = resolveRemote(statusMap, maat);
      const supplierStock = Number(remoteEntry && remoteEntry.stock) || 0;
      const st            = remoteEntry && remoteEntry.status;

      let supVal;
      if (st === 'IN_STOCK') {
        supVal = mapTriumphStockLevel(supplierStock);
      } else if (st) {
        supVal = 0;
      } else {
        supVal = -1;
      }

      const effAvail = supVal > 0;

      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green', 'status-red');
      delete row.dataset.status;

      let actie = 'none';

      if (local > 0 && !effAvail) {
        row.style.background = '#f8d7da';
        row.title = st
          ? 'Uitboeken (Triumph niet op voorraad)'
          : 'Uitboeken of negeren (maat onbekend bij Triumph → 0)';
        row.dataset.status = 'remove';
        row.classList.add('status-red');
        actie = 'uitboeken';
        if (!firstMut) firstMut = row;

      } else if (local === 0 && effAvail) {
        row.style.background = '#d4edda';
        row.title = `Bijboeken ${supVal} (Triumph op voorraad: ${supplierStock})`;
        row.dataset.status = 'add';
        row.classList.add('status-green');
        actie = 'bijboeken_2';
        if (!firstMut) firstMut = row;

      } else if (local === 0 && !effAvail) {
        row.title = st
          ? 'Negeren (Triumph niet op voorraad)'
          : 'Negeren (maat onbekend bij Triumph → 0)';
        actie = 'negeren';
      }

      report.push({ maat, local, remote: supplierStock, stock: supVal, actie });
    });

    if (firstMut) jumpFlash(firstMut);
    return report;
  }

  function bepaalLogStatus(report, statusMap) {
    const counts = report.reduce((a, r) => {
      a[r.actie] = (a[r.actie] || 0) + 1;
      return a;
    }, {});
    const nUit = counts.uitboeken || 0;
    const nBij = counts.bijboeken_2 || 0;
    const leeg = !statusMap || Object.keys(statusMap).length === 0;

    if (leeg) return 'niet-gevonden';
    if (report.length > 0 && nUit === 0 && nBij === 0) return 'ok';
    return 'afwijking';
  }

  // --- Grid-cache (per cartId + styleId) ---
  const gridCache = new Map();
  async function getGrid(styleId, cartId) {
    const key = `${cartId || CART_ID_TRIUMPH}:${styleId}`;
    if (gridCache.has(key)) return gridCache.get(key);
    const p = bridgeGetGrid(styleId, cartId).then(text => {
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error('[Triumph][DEBUG] JSON parse error:', e);
        json = [];
      }
      return json;
    }).catch(err => {
      gridCache.delete(key);
      throw err;
    });
    gridCache.set(key, p);
    return p;
  }

  // --- Huidige leverancier → juiste cartId (Triumph/Sloggi) ---
  function getCartIdForCurrentSupplier() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return CART_ID_TRIUMPH;
    const val = norm(sel.value || '');
    const txt = norm(sel.options[sel.selectedIndex] &&
                     sel.options[sel.selectedIndex].text || '');
    const blob = `${val} ${txt}`;
    if (/\bsloggi\b/i.test(blob)) return CART_ID_SLOGGI;
    return CART_ID_TRIUMPH;
  }

  // --- Hoofd-run ---
  async function runTriumph(btn) {
    if (!bridgeIsOnlineByHeartbeat()) {
      alert(
        'Triumph-bridge offline.\n' +
        'Open een b2b.triumph.com-tab, log in, bezoek een product (zodat hun grid-call loopt),\n' +
        'dan hier opnieuw proberen.'
      );
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) {
      alert('Geen tabellen in #output.');
      return;
    }

    const cartId = getCartIdForCurrentSupplier();

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    const limit    = pLimit(3);
    let idx        = 0;
    let totalMut   = 0;

    await Promise.all(
      tables.map(table =>
        limit(async () => {
          const tableId = (table.id || '').trim();
          const m = tableId.match(/^(\d+)-(\d{4})$/); // bv 10162782-0003
          const anchorId = tableId || 'onbekend';

          if (!m) {
            Logger.status(anchorId, 'niet-gevonden (id niet in vorm STIJL-KLEUR)');
            Logger.perMaat(anchorId, []);
            progress.setDone(++idx);
            return;
          }

          const styleId   = m[1];
          const colorCode = m[2];

          try {
            const json      = await getGrid(styleId, cartId);
            const statusMap = buildStatusMapFromTriumphGrid(json, colorCode);

            if (!statusMap || Object.keys(statusMap).length === 0) {
              Logger.status(anchorId, 'niet-gevonden');
              Logger.perMaat(anchorId, []);
            } else {
              const report = applyRulesAndMark(table, statusMap);
              totalMut += report.filter(r =>
                r.actie === 'uitboeken' || r.actie === 'bijboeken_2'
              ).length;
              Logger.status(anchorId, bepaalLogStatus(report, statusMap));
              Logger.perMaat(anchorId, report);
            }
          } catch (e) {
            console.error('[Triumph] fout bij ophalen grid', e);
            const msg = String(e.message || '');
            if (msg.includes('HTTP 401')) {
              Logger.status(anchorId, 'afwijking (401 – auth/token probleem op Triumph-tab)');
            } else if (msg.includes('bridge timeout')) {
              Logger.status(anchorId, 'afwijking (bridge timeout)');
            } else {
              Logger.status(anchorId, 'afwijking');
            }
            Logger.perMaat(anchorId, []);
          } finally {
            progress.setDone(++idx);
          }
        })
      )
    );

    progress.success(totalMut);
  }

  // --- UI-knop ---
  function isTriumphSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return false;
    const val = norm(sel.value || '');
    const txt = norm(sel.options[sel.selectedIndex] &&
                     sel.options[sel.selectedIndex].text || '');
    const blob = `${val} ${txt}`;
    // Zowel Triumph als Sloggi gebruiken deze proxy
    return /\btriumph\b/i.test(blob) || /\bsloggi\b/i.test(blob);
  }

  function ensureButton() {
    let btn = document.getElementById('adv-triumph-btn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'adv-triumph-btn';
    btn.className = 'sk-btn';
    btn.type = 'button';
    btn.textContent = 'Check Triumph/Sloggi Stock';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      right: '250px',
      zIndex: '9999',
      display: 'none',
      paddingRight: '26px'
    });

    const badge = document.createElement('span');
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

    btn.appendChild(badge);

    const setBadge = (ok) => {
      badge.style.background = ok ? '#24b300' : 'red';
    };
    setBadge(bridgeIsOnlineByHeartbeat());

    GM_addValueChangeListener(HEARTBEAT_KEY, () => setBadge(true));

    btn.addEventListener('click', () => runTriumph(btn));
    document.body.appendChild(btn);
    return btn;
  }

  function maybeMountOrRemove() {
    const hasTables = !!document.querySelector('#output table');
    const need      = isTriumphSelected();
    const existing  = document.getElementById('adv-triumph-btn');

    if (need) {
      const btn = ensureButton();
      btn.style.display = hasTables ? 'block' : 'none';
    } else if (existing) {
      try { existing.remove(); } catch {}
    }
  }

  function bootUI() {
    const sel = document.querySelector('#leverancier-keuze');
    if (sel) sel.addEventListener('change', maybeMountOrRemove);

    const out = document.querySelector('#output');
    if (out) {
      new MutationObserver(maybeMountOrRemove)
        .observe(out, { childList: true, subtree: true });
    }

    maybeMountOrRemove();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootUI);
  } else {
    bootUI();
  }

})();
