// ==UserScript==
// @name         VCP | Triumph
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.4
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
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-triumph.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-triumph.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL    = location.hostname.includes('lingerieoutlet.nl');
  const ON_TRIUMPH = location.hostname.includes('b2b.triumph.com');

  const HEARTBEAT_KEY   = 'triumph_bridge_heartbeat';
  const AUTH_HEADER_KEY = 'triumph_bridge_auth_header';

  const TIMEOUT_MS   = 20000;
  const KEEPALIVE_MS = 300000;

  // Geen hardcoded webstore/cart IDs meer.

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm  = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  // Hulpfunctie: webstoreId en cartId uit Triumph API-URL halen
  function extractMetaFromUrl(url) {
    if (!url) return {};
    const m = String(url).match(/\/api\/shop\/webstores\/(\d+)\/carts\/(\d+)\//);
    if (!m) return {};
    return {
      webstoreId: m[1],
      cartId:    m[2]
    };
  }

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

    // --- helpers voor auth capture + session-meta (webstore/cart) ---

    function storeAuth(val, via, meta) {
      if (!val) return;
      const auth = String(val).trim();
      if (!/^bearer\s+/i.test(auth)) return;

      let prevRaw = null;
      try { prevRaw = GM_getValue(AUTH_HEADER_KEY, null); } catch {}

      let prev = null;
      if (prevRaw && typeof prevRaw === 'object') {
        prev = prevRaw;
      } else if (typeof prevRaw === 'string') {
        prev = { auth: prevRaw };
      }

      const session = {
        auth,
        webstoreId: meta && meta.webstoreId || (prev && prev.webstoreId) || null,
        cartId:     meta && meta.cartId     || (prev && prev.cartId)     || null
      };

      try {
        GM_setValue(AUTH_HEADER_KEY, session);
        console.info(
          '[Triumph-bridge][DEBUG]',
          via,
          'Authorization captured:',
          auth.slice(0, 22) + '…',
          '| webstoreId:',
          session.webstoreId || '∅',
          '| cartId:',
          session.cartId || '∅'
        );
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
            if (auth) {
              let urlStr = '';
              if (typeof input === 'string') {
                urlStr = input;
              } else if (input && typeof input.url === 'string') {
                urlStr = input.url;
              }
              const meta = extractMetaFromUrl(urlStr);
              storeAuth(auth, 'via fetch', meta);
            }
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
          const origOpen             = xhr.open;

          xhr._bridgeUrl = '';

          xhr.open = function (method, url, async, user, password) {
            try { xhr._bridgeUrl = url; } catch {}
            return origOpen.apply(this, arguments);
          };

          xhr.setRequestHeader = function (name, value) {
            try {
              if (/^authorization$/i.test(name)) {
                const meta = extractMetaFromUrl(xhr._bridgeUrl);
                storeAuth(value, 'via XHR', meta);
              }
            } catch (e) {
              console.debug('[Triumph-bridge][DEBUG] XHR-hook error:', e);
            }
            return origSetRequestHeader.apply(this, arguments);
          };
          return xhr;
        }
        XHRProxy.prototype = OrigXHR.prototype;
        w.XMLHttpRequest   = XHRProxy;

        console.info('[Triumph-bridge] XHR-hook actief in page-context');
      } catch (e) {
        console.warn('[Triumph-bridge] kon XHR niet hooken:', e);
      }
    })();

    // --- API-call met Authorization + dynamische webstore/cart uit session ---
    async function fetchTriumphGrid(styleId, cartId, timeout = TIMEOUT_MS) {
      const raw = GM_getValue(AUTH_HEADER_KEY, null);

      let auth         = null;
      let sessionStore = null;
      let sessionCart  = null;

      if (raw && typeof raw === 'object') {
        auth         = raw.auth || null;
        sessionStore = raw.webstoreId || null;
        sessionCart  = raw.cartId || null;
      } else {
        auth = raw; // backward compat, maar zonder IDs => error
      }

      if (!sessionStore) {
        throw new Error(
          'Geen webstoreId gevonden in Triumph-session. ' +
          'Laat eerst een grid-call lopen op b2b.triumph.com.'
        );
      }

      const effectiveCartId = cartId || sessionCart;
      if (!effectiveCartId) {
        throw new Error(
          'Geen cartId gevonden in Triumph-session. ' +
          'Laat eerst een grid-call lopen op b2b.triumph.com.'
        );
      }

      const url =
        `https://b2b.triumph.com/api/shop/webstores/${encodeURIComponent(sessionStore)}` +
        `/carts/${encodeURIComponent(effectiveCartId)}` +
        `/grid/${encodeURIComponent(styleId)}/products`;

      console.debug('[Triumph-bridge][DEBUG] grid-call', url, '| auth aanwezig?', !!auth);

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

  // --- Bridge-client (tool-kant) met optionele cartId override ---
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
const SIZE_ALIAS = {
  // Alleen nog letter-/combi-aliases, géén 1→ONE SIZE / 3→XS meer
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

  // --- Triumph stock → interne stock ---
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

  // --- Grid-cache (per cartId + styleId, of 'session' wanneer cartId niet gespecificeerd) ---
  const gridCache = new Map();
  async function getGrid(styleId, cartId) {
    const key = `${cartId || 'session'}:${styleId}`;
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

    // Geen hardcoded cartId meer; we gebruiken altijd wat de session heeft.
    const cartId = undefined;

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    const limit    = pLimit(3);
    let idx        = 0;
    let totalMut   = 0;

    await Promise.all(
      tables.map(table =>
        limit(async () => {
          const tableId = (table.id || '').trim();

          const m = tableId.match(/^(\d+)-([0-9A-Z]{3,4})$/i);
          const anchorId = tableId || 'onbekend';

          if (!m) {
            Logger.status(anchorId, 'niet-gevonden (id niet in vorm STIJL-KLEUR)');
            Logger.perMaat(anchorId, []);
            progress.setDone(++idx);
            return;
          }

          const styleId   = m[1];
          const colorCode = m[2].toUpperCase();

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
            } else if (msg.includes('Geen webstoreId gevonden')) {
              Logger.status(anchorId, 'afwijking (geen webstoreId in session – eerst product openen)');
            } else if (msg.includes('Geen cartId gevonden')) {
              Logger.status(anchorId, 'afwijking (geen cartId in session – eerst product openen)');
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
