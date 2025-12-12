// ==UserScript==
// @name         VCP | Mundo Unico
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1
// @description  Vergelijk local stock met Colomoda (Mundo Unico) stock via JSON (search → product). Zonder heartbeat/badge.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://www.colomoda.eu/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-mundo-unico.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-mundo-unico.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL     = location.hostname.includes('lingerieoutlet.nl');
  const ON_COLOMODA = location.hostname.includes('colomoda.eu');

  const TIMEOUT_MS = 20000;

  const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  // =========================
  // 1) BRIDGE OP COLOMODA
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

      if (Array.isArray(node)) {
        node.forEach(walk);
      } else {
        Object.keys(node).forEach(k => walk(node[k]));
      }
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

  // hard hits
  if (code === needleUpper) s += 100;
  if (ean  === needleUpper) s += 90;
  if (sku  === needleUpper) s += 80;

  // common reality: sku heeft maat suffix (…L / …XL / …M)
  if (sku.startsWith(needleUpper)) s += 70;
  if (code.startsWith(needleUpper)) s += 60;
  if (ean.startsWith(needleUpper))  s += 50;

  // loose hits
  if (sku.includes(needleUpper)) s += 30;
  if (code.includes(needleUpper)) s += 25;
  if (ean.includes(needleUpper))  s += 20;

  // url aanwezig = handig
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

  // minimale score zodat we geen random dingen pakken
  return (best && bestScore >= 20) ? best : null;
}

function buildAbsoluteProductJsonUrl(hit) {
  const full = hit?.fullurl || hit?.full_url || '';
  const url  = hit?.url || '';
  const candidate = String(full || url || '').trim();
  if (!candidate) return '';

  // Colomoda geeft vaak slug zoals "jor-miro-joggingbroek.html"
  // of "brands/..." (die willen we niet). We willen een product .html
  let href = candidate;

  try {
    const u = new URL(href, 'https://www.colomoda.eu/');
    // force json
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

    console.info('[Colomoda-bridge] actief (no heartbeat) op', location.href);
    return;
  }

  // =========================
  // 2) CLIENT OP TOOL
  // =========================
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
      if (lb && typeof lb.resultaat === 'function') lb.resultaat(String(id), txt);
      else console.info(`[MundoUnico][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      console.groupCollapsed(`[MundoUnico][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat, local: r.local,
          remote: Number.isFinite(r.remote) ? r.remote : '—',
          stock:  Number.isFinite(r.stock)  ? r.stock  : '—',
          status: r.actie
        })));
      } finally { console.groupEnd(); }
    }
  };

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

  function pLimit(n) {
    const q = []; let a = 0;
    const next = () => {
      if (a >= n || !q.length) return;
      a++;
      const { fn, resolve, reject } = q.shift();
      fn().then(resolve, reject).finally(() => { a--; next(); });
    };
    return fn => new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); next(); });
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
        set.add(x); set.add(x.replace(/\s+/g,''));
        if (SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
      });
    }
    return Array.from(set);
  }

  // Naturana stocklevels
  function mapNaturanaLikeStockLevel(remoteQty) {
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n > 4)  return 5;
    return 0;
  }

  function resolveRemote(map, label) {
    for (const c of aliasCandidates(label)) if (map[c]) return map[c];
    return undefined;
  }

function buildStatusMapFromColomodaProduct(json, wantedCode) {
  const map = {};
  const want = String(wantedCode || '').trim().toUpperCase();

  const cleanSize = (s) => {
    let t = String(s || '').trim().toUpperCase();
    // komt soms voor als "Size: M"
    t = t.replace(/^SIZE:\s*/i, '').trim();
    return t;
  };

  const add = (sizeRaw, qtyRaw, statusRaw) => {
    const size = cleanSize(sizeRaw);
    if (!size) return;

    const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;
    const status = statusRaw || (qty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');

    for (const key of aliasCandidates(size)) {
      const ex = map[key];
      if (!ex) map[key] = { status, stock: qty };
      else {
        ex.stock = Math.max(ex.stock || 0, qty);
        if (ex.status !== 'IN_STOCK' && status === 'IN_STOCK') ex.status = 'IN_STOCK';
      }
    }
  };

  // ✅ 1) Product-variants (beste bron)
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

  // 2) fallback: page.recent (soms alleen 1 maat)
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


  function jumpFlash(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const old = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 2px rgba(255,255,0,.9), 0 0 12px rgba(255,255,0,.9)';
      setTimeout(() => { el.style.boxShadow = old || ''; }, 650);
    } catch {}
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

      const supVal = (st === 'IN_STOCK')
        ? mapNaturanaLikeStockLevel(supplierQty)
        : (st === 'OUT_OF_STOCK' ? 0 : -1);

      const effAvail = supVal > 0;

      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green', 'status-red');
      delete row.dataset.status;

      let actie = 'none';

      if (local > 0 && !effAvail) {
        row.style.background = '#f8d7da';
        row.title = st ? 'Uitboeken (leverancier niet op voorraad)' : 'Uitboeken/Negeren (maat onbekend)';
        row.dataset.status = 'remove';
        row.classList.add('status-red');
        actie = 'uitboeken';
        if (!firstMut) firstMut = row;

      } else if (local === 0 && effAvail) {
        row.style.background = '#d4edda';
        row.title = `Bijboeken ${supVal} (leverancier qty: ${supplierQty})`;
        row.dataset.status = 'add';
        row.classList.add('status-green');
        actie = 'bijboeken';
        if (!firstMut) firstMut = row;

      } else if (local === 0 && !effAvail) {
        row.title = st ? 'Negeren (leverancier niet op voorraad)' : 'Negeren (maat onbekend)';
        actie = 'negeren';
      }

      report.push({ maat, local, remote: supplierQty, stock: (supVal >= 0 ? supVal : NaN), actie });
    });

    if (firstMut) jumpFlash(firstMut);
    return report;
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

  async function runMundo(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    const limit  = pLimit(3);
    let idx      = 0;
    let totalMut = 0;

    await Promise.all(tables.map(table => limit(async () => {
      const tableId  = (table.id || '').trim();
      const anchorId = tableId || 'onbekend';
      const code     = tableId;

      if (!code) {
        Logger.status(anchorId, 'niet-gevonden (geen code)');
        Logger.perMaat(anchorId, []);
        progress.setDone(++idx);
        return;
      }

      try {
        const text = await bridgeGetProductJson(code);
        let json;
        try { json = JSON.parse(text); } catch { json = null; }

        if (!json) {
          Logger.status(anchorId, 'afwijking (json parse)');
          Logger.perMaat(anchorId, []);
          progress.setDone(++idx);
          return;
        }

        const statusMap = buildStatusMapFromColomodaProduct(json, code);


        if (!statusMap || Object.keys(statusMap).length === 0) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
        } else {
          const report = applyRulesAndMark(table, statusMap);
          totalMut += report.filter(r => r.actie === 'uitboeken' || r.actie === 'bijboeken').length;
          Logger.status(anchorId, bepaalLogStatus(report, statusMap));
          Logger.perMaat(anchorId, report);
        }

      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) Logger.status(anchorId, 'afwijking (auth/cookies op colomoda tab)');
        else if (msg.includes('NO_RESULTS')) Logger.status(anchorId, 'niet-gevonden');
        else if (msg.includes('bridge timeout')) Logger.status(anchorId, 'afwijking (bridge timeout)');
        else Logger.status(anchorId, 'afwijking');

        Logger.perMaat(anchorId, []);
      } finally {
        progress.setDone(++idx);
      }
    })));

    progress.success(totalMut);
  }

  function isMundoSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return false;
    const val = norm(sel.value || '');
    const txt = norm(sel.options[sel.selectedIndex]?.text || '');
    const blob = `${val} ${txt}`;
    return /\bmundo\b/i.test(blob) || /\bunico\b/i.test(blob) || /\bcolomoda\b/i.test(blob);
  }

  function ensureButton() {
    let btn = document.getElementById('adv-mundo-btn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'adv-mundo-btn';
    btn.className = 'sk-btn';
    btn.type = 'button';
    btn.textContent = 'Check Mundo Unico Stock';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      right: '250px',
      zIndex: '9999',
      display: 'none'
    });

    btn.addEventListener('click', () => runMundo(btn));
    document.body.appendChild(btn);
    return btn;
  }

  function maybeMountOrRemove() {
    const hasTables = !!document.querySelector('#output table');
    const need      = isMundoSelected();
    const existing  = document.getElementById('adv-mundo-btn');

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
    if (out) new MutationObserver(maybeMountOrRemove).observe(out, { childList: true, subtree: true });

    maybeMountOrRemove();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootUI);
  else bootUI();

})();
