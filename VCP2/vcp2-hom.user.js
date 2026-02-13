// ==UserScript==
// @name         VCP2 | HOM
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.0.0
// @description  VCP2 HOM: bridge op b2b.huberholding.com + tool runner met VCPCore + StockRules (mapping/reconcile centraal)
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://b2b.huberholding.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-hom.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-hom.user.js
// ==/UserScript==

(() => {
  'use strict';

  // =========================
  // Shared
  // =========================
  const MODELVIEW_URL   = 'https://b2b.huberholding.com/huberholdingb2b/ModellView';
  const ARTICLEVIEW_URL = 'https://b2b.huberholding.com/huberholdingb2b/ArticleView';

  const TIMEOUT_MS   = 20000;
  const KEEPALIVE_MS = 300000;

  const BRIDGE_KEY = 'hom_vcp2_bridge';
  const REQ_KEY    = `${BRIDGE_KEY}_req`;
  const RESP_KEY   = `${BRIDGE_KEY}_resp`;
  const HEARTBEAT_KEY = `${BRIDGE_KEY}_hb`;

  const HB_INTERVAL = 2500;
  const BRIDGE_CONCURRENCY = 4;

  const CONFIG = {
    NAV: {
      throttleMin: 300,
      throttleMax: 800,
      backoffStart: 350,
      backoffMax: 2200,
      keepAlive: true,
      clientConcurrency: 3,
      perTableTimeoutMs: 45000,
    }
  };

  const ON_HOM  = location.hostname.includes('b2b.huberholding.com');
  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');

  const delay  = (ms) => new Promise(r => setTimeout(r, ms));
  const uid    = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm   = (s='') => String(s).toLowerCase().trim().replace(/\s+/g,' ');
  const jitter = () => delay(CONFIG.NAV.throttleMin + Math.random() * (CONFIG.NAV.throttleMax - CONFIG.NAV.throttleMin));

  const parseHTML = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html');

  const isLoginPage = (html) => {
    const t = String(html || '').toLowerCase();
    return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t);
  };

  const isBadHttp = (status) =>
    status === 401 || status === 403 || status === 404 || status === 410 || (status >= 500 && status <= 599);

  // =========================
  // Bridge (HOM tab)
  // =========================
  if (ON_HOM) {
    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, HB_INTERVAL);

    const q = [];
    let active = 0;

    async function handleOne(req) {
      const id = req?.id;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), Math.max(10000, req.timeout || TIMEOUT_MS));

        const res = await fetch(req.url, {
          method: req.method || 'GET',
          headers: req.headers || {},
          credentials: 'include',
          body: req.body || null,
          signal: ctrl.signal
        });

        const text = await res.text();
        clearTimeout(to);

        // 401/403/404/410/5xx => niet-gevonden (tool bepaalt status)
        GM_setValue(RESP_KEY, { id, ok: true, status: res.status, text });

      } catch (e) {
        GM_setValue(RESP_KEY, { id, ok: false, error: String(e?.message || e) });
      }
    }

    function pump() {
      while (active < BRIDGE_CONCURRENCY && q.length) {
        const req = q.shift();
        active++;
        handleOne(req).finally(() => { active--; pump(); });
      }
    }

    GM_addValueChangeListener(REQ_KEY, (_k, _o, req) => {
      if (!req?.id || !req?.url) return;
      q.push(req);
      pump();
    });

    if (document.readyState !== 'loading') console.info('[VCP2|HOM Bridge] actief op', location.href);
    else document.addEventListener('DOMContentLoaded', () => console.info('[VCP2|HOM Bridge] actief op', location.href));

    return;
  }

  // =========================
  // Tool-side
  // =========================
  if (!ON_TOOL) return;

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) {
    console.error('[VCP2|HOM] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|HOM] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
    return;
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
      else console.info(`[HOM][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[HOM][${anchorId}] maatvergelijking`);
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

  function bridgeOnline(maxAgeMs = 6000) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAgeMs;
    } catch {
      return false;
    }
  }

  function bridgeRequest(payload, timeoutMs = TIMEOUT_MS) {
    const id = uid();

    return new Promise((resolve, reject) => {
      let handle = GM_addValueChangeListener(RESP_KEY, (_n, _o, msg) => {
        if (!msg || msg.id !== id) return;
        try { GM_removeValueChangeListener(handle); } catch {}
        resolve(msg);
      });

      GM_setValue(REQ_KEY, Object.assign({}, payload, { id, timeout: timeoutMs }));

      setTimeout(() => {
        try { GM_removeValueChangeListener(handle); } catch {}
        reject(new Error('bridge timeout'));
      }, timeoutMs + 1500);
    });
  }

  // =========================
  // ASP.NET helpers
  // =========================
  function pickViewState(doc) {
    const form = doc.querySelector('form');
    if (!form) return null;
    const get = (n) => form.querySelector(`input[name="${n}"]`)?.value ?? '';
    return {
      __VIEWSTATE: get('__VIEWSTATE'),
      __VIEWSTATEGENERATOR: get('__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: get('__EVENTVALIDATION')
    };
  }

  function serializeForm(form) {
    const payload = {};
    if (!form || !form.elements) return payload;

    for (const el of Array.from(form.elements)) {
      if (!el?.name) continue;
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;

      if (tag === 'select' && el.multiple) {
        const sel = Array.from(el.options).filter(o => o.selected).map(o => o.value);
        if (sel.length) payload[el.name] = sel[0];
        continue;
      }
      payload[el.name] = el.value ?? '';
    }
    return payload;
  }

  // =========================
  // Size aliases
  // =========================
  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL'
  };

  function normalizeSize(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function aliasCandidates(label) {
    const raw = String(label || '').trim().toUpperCase();
    const ns  = raw.replace(/\s+/g, '');
    const set = new Set([raw, ns]);

    const n1 = normalizeSize(raw);
    if (n1) set.add(n1);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);
    if (SIZE_ALIAS[n1])  set.add(SIZE_ALIAS[n1]);

    if (raw.includes('/')) {
      raw.split('/').map(x => x.trim()).filter(Boolean).forEach(x => {
        set.add(x);
        set.add(x.replace(/\s+/g, ''));
        const nx = normalizeSize(x);
        if (nx) set.add(nx);
        if (SIZE_ALIAS[x])  set.add(SIZE_ALIAS[x]);
        if (SIZE_ALIAS[nx]) set.add(SIZE_ALIAS[nx]);
      });
    }
    return Array.from(set);
  }

  // =========================
  // ModelView -> open ArticleView
  // =========================
  function findModelItem(doc, pidColor) {
    const raw = String(pidColor || '').trim();
    const m = raw.match(/^(.+?)-(.*)$/);
    const pid = (m ? m[1] : raw).trim().toUpperCase();
    const color = (m ? m[2] : '').trim().toUpperCase();

    const links = Array.from(doc.querySelectorAll('a[href*="__doPostBack"]'));
    let best = null, bestScore = -1;

    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const mm = href.match(/__doPostBack\('([^']+)'/);
      if (!mm) continue;

      const eventTarget = mm[1];
      const cont = a.closest('tr,div,li') || a.parentElement;
      const txt = ((a.textContent || '') + ' ' + (cont?.textContent || '')).toUpperCase().replace(/\s+/g, ' ');

      let s = 0;
      if (pid && txt.includes(pid)) s += 4;
      if (color && color.length >= 2 && txt.includes(color)) s += 2;

      if (s > bestScore) { best = { eventTarget }; bestScore = s; }
    }
    return (best && bestScore >= 3) ? best : null;
  }

  async function openArticleViewViaPostback_cached(pidColor, state) {
    const ensureFreshMV = async () => {
      const mvMsg = await bridgeRequest({ url: MODELVIEW_URL, method: 'GET' }, TIMEOUT_MS);
      if (!mvMsg?.ok) throw new Error('BRIDGE_FAIL');
      if (isBadHttp(mvMsg.status)) throw new Error('TARGET_NOT_FOUND');

      const mv = mvMsg.text || '';
      if (isLoginPage(mv)) throw new Error('LOGIN_REQUIRED');

      const doc = parseHTML(mv);
      const vs = pickViewState(doc);
      if (!vs || !vs.__VIEWSTATE) throw new Error('TARGET_NOT_FOUND');

      state.doc = doc;
      state.vs = vs;
    };

    if (!state.doc || !state.vs) await ensureFreshMV();

    let item = findModelItem(state.doc, pidColor);
    if (!item) {
      await ensureFreshMV();
      item = findModelItem(state.doc, pidColor);
      if (!item) throw new Error('TARGET_NOT_FOUND');
    }

    const payload = {
      __EVENTTARGET: item.eventTarget || '',
      __EVENTARGUMENT: '',
      __VIEWSTATE: state.vs.__VIEWSTATE,
      __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR || '',
      __EVENTVALIDATION: state.vs.__EVENTVALIDATION || ''
    };

    const postBody = new URLSearchParams(payload).toString();

    const respMsg = await bridgeRequest({
      url: MODELVIEW_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: postBody
    }, TIMEOUT_MS);

    if (!respMsg?.ok) throw new Error('BRIDGE_FAIL');
    if (isBadHttp(respMsg.status)) throw new Error('TARGET_NOT_FOUND');

    const html = respMsg.text || '';
    if (isLoginPage(html)) throw new Error('LOGIN_REQUIRED');

    if (!/gridSize|gridAvailTxt|color-size-grid/i.test(html)) {
      // stale tokens? refresh once and retry
      await ensureFreshMV();
      const item2 = findModelItem(state.doc, pidColor);
      if (!item2) throw new Error('TARGET_NOT_FOUND');

      const payload2 = {
        __EVENTTARGET: item2.eventTarget || '',
        __EVENTARGUMENT: '',
        __VIEWSTATE: state.vs.__VIEWSTATE,
        __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR || '',
        __EVENTVALIDATION: state.vs.__EVENTVALIDATION || ''
      };

      const resp2 = await bridgeRequest({
        url: MODELVIEW_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(payload2).toString()
      }, TIMEOUT_MS);

      if (!resp2?.ok) throw new Error('BRIDGE_FAIL');
      if (isBadHttp(resp2.status)) throw new Error('TARGET_NOT_FOUND');

      const html2 = resp2.text || '';
      if (isLoginPage(html2)) throw new Error('LOGIN_REQUIRED');
      return html2;
    }

    return html;
  }

  // =========================
  // ArticleView -> remoteQtyMap (pure parsing)
  // =========================
  function buildRemoteQtyMapFromArticleView(html) {
    const map = {};
    const doc = parseHTML(html);

    const tiles = Array.from(doc.querySelectorAll('.color-size-grid .p-2.text-center, .color-size-grid [id*="_divOID_"]'));
    for (const tile of tiles) {
      const sizeEl  = tile.querySelector('.gridSize');
      const availEl = tile.querySelector('.gridAvailTxt');

      if (!sizeEl) continue;

      const rawSize = (sizeEl.textContent || '').trim().toUpperCase();
      if (!rawSize) continue;

      // stock number: last digits in gridAvailTxt (if absent -> 0)
      const availTxt = (availEl?.textContent || '').trim();
      const mm = availTxt.match(/(\d+)\s*$/);
      const qty = mm ? (parseInt(mm[1], 10) || 0) : 0;

      for (const k of aliasCandidates(rawSize)) {
        const kk = normalizeSize(k);
        if (!kk) continue;
        map[kk] = Math.max(Number(map[kk] || 0), qty);
      }
    }

    // ultra-fallback regex if DOM changed
    if (Object.keys(map).length === 0) {
      const sz = [];
      const av = [];
      let m;

      const sizeRe = /<span[^>]*class="gridSize"[^>]*>([^<]+)/gi;
      const availRe = /<span[^>]*class="gridAvailTxt[^"]*"[^>]*>([^<]+)/gi;

      while ((m = sizeRe.exec(html)) !== null) sz.push(String(m[1] || '').trim().toUpperCase());
      while ((m = availRe.exec(html)) !== null) av.push(String(m[1] || '').trim());

      const n = Math.min(sz.length, av.length);
      for (let i = 0; i < n; i++) {
        const s = sz[i];
        const mm2 = av[i].match(/(\d+)\s*$/);
        const qty = mm2 ? (parseInt(mm2[1], 10) || 0) : 0;
        for (const k of aliasCandidates(s)) {
          const kk = normalizeSize(k);
          if (!kk) continue;
          map[kk] = Math.max(Number(map[kk] || 0), qty);
        }
      }
    }

    return map;
  }

  function resolveRemoteQty(qtyMap, label) {
    for (const c of aliasCandidates(label)) {
      const k = normalizeSize(c);
      if (k && Object.prototype.hasOwnProperty.call(qtyMap, k)) return qtyMap[k];
    }
    return undefined;
  }

  // =========================
  // Tool: local table parsing
  // =========================
  function readLocalTable(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const out = [];

    for (const tr of rows) {
      const maatRaw = tr.dataset.size || tr.children?.[0]?.textContent || '';
      const maat = String(maatRaw || '').trim().toUpperCase();
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
    return label || '';
  }

  function getMaxCap(table) {
    try {
      if (typeof Core.getMaxCap === 'function') return Core.getMaxCap(table);
    } catch {}
    return 5;
  }

  // =========================
  // ✅ Apply compare via StockRules + Core marking
  // =========================
  function applyCompareAndMark(localRows, remoteQtyMap, maxCap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      const remoteQty = resolveRemoteQty(remoteQtyMap, maat);
      if (typeof remoteQty !== 'number') continue;

      const target = SR.mapRemoteToTarget('hom', remoteQty, maxCap);
      const res = SR.reconcile(local, target, maxCap);
      const delta = Number(res?.delta || 0);

      let status = 'ok';
      if (res?.action === 'bijboeken' && delta > 0) {
        Core.markRow(tr, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, remote ${remoteQty})` });
        status = 'bijboeken';
        if (!firstMut) firstMut = tr;
      } else if (res?.action === 'uitboeken' && delta > 0) {
        Core.markRow(tr, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, remote ${remoteQty})` });
        status = 'uitboeken';
        if (!firstMut) firstMut = tr;
      } else {
        Core.markRow(tr, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remoteQty})` });
        status = 'ok';
      }

      report.push({ maat, local, remoteRaw: remoteQty, target, delta, status });
    }

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalStatus(report, remoteQtyMap) {
    if (!remoteQtyMap || Object.keys(remoteQtyMap).length === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  // =========================
  // perTable
  // =========================
  async function perTable(table, state) {
    const pidColor = String(table.id || '').trim();
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || pidColor || 'onbekend';
    const anchorId = pidColor || label || getSkuFromTable(table);

    if (!pidColor) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    try {
      await jitter();

      const html = await withTimeout(
        openArticleViewViaPostback_cached(pidColor, state),
        CONFIG.NAV.perTableTimeoutMs,
        'TABLE_TIMEOUT'
      );

      const remoteQtyMap = buildRemoteQtyMapFromArticleView(html);
      if (!remoteQtyMap || Object.keys(remoteQtyMap).length === 0) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      const localRows = readLocalTable(table);
      const maxCap = getMaxCap(table);

      const report = applyCompareAndMark(localRows, remoteQtyMap, maxCap);
      Logger.status(anchorId, bepaalStatus(report, remoteQtyMap));
      Logger.perMaat(anchorId, report);

      return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;

    } catch (e) {
      const msg = String(e?.message || e);

      if (msg === 'LOGIN_REQUIRED') {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      if (msg === 'TARGET_NOT_FOUND' || msg === 'TABLE_TIMEOUT') {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      Logger.status(anchorId, 'afwijking');
      Logger.perMaat(anchorId, []);
      return 0;
    }
  }

  const withTimeout = (p, ms, label='timeout') =>
    Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error(label)), ms))]);

  // =========================
  // Run
  // =========================
  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    if (!bridgeOnline()) {
      alert(
        'HOM-bridge offline.\n' +
        'Open een HOM tab (b2b.huberholding.com), refresh 1x,\n' +
        'en probeer opnieuw.'
      );
      return;
    }

    // init ModelView state (cached)
    let state = { doc: null, vs: null };
    try {
      const mv = await bridgeRequest({ url: MODELVIEW_URL, method: 'GET' }, TIMEOUT_MS);
      if (!mv?.ok || isBadHttp(mv.status) || isLoginPage(mv.text || '')) throw new Error('LOGIN_REQUIRED');
      const doc = parseHTML(mv.text || '');
      const vs = pickViewState(doc);
      if (!vs || !vs.__VIEWSTATE) throw new Error('TARGET_NOT_FOUND');
      state = { doc, vs };
    } catch {
      alert('Niet ingelogd op HOM of ModelView niet bereikbaar. Open HOM tab en refresh 1x.');
      return;
    }

    // UX: direct feedback
    const originalText = computeHomButtonText();
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = `⏳ ${originalText.replace('🔍 ', '')}…`;

    try {
      await Core.runTables({
        btn,
        tables,
        concurrency: CONFIG.NAV.clientConcurrency,
        perTable: (t) => perTable(t, state)
      });
    } finally {
      btn.disabled = false;
      btn.dataset.busy = '0';
      btn.textContent = originalText;
    }
  }

  // =========================
  // UI: supplier select + button
  // =========================
    function getHomSelectionLabel() {
  const sel = document.querySelector('#leverancier-keuze');
  if (!sel) return 'Hom';

  const txt = String(sel.options?.[sel.selectedIndex]?.text || '').trim();
  const val = String(sel.value || '').trim();

  // we prefer visible text
  const raw = txt || val || 'Hom';

  // netjes spaties
  return raw.replace(/\s+/g, ' ').trim() || 'Hom';
}

function computeHomButtonText() {
  return `🔍 Check Stock | ${getHomSelectionLabel()}`;
}

function syncHomButtonText() {
  const btn = document.getElementById('vcp2-hom-btn');
  if (!btn) return;

  // niet overschrijven tijdens run()
  if (btn.dataset.busy === '1') return;

  btn.textContent = computeHomButtonText();
}


function normBlob(s='') {
  return String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
}

function getSupplierKey() {
  const sel = document.querySelector('#leverancier-keuze');
  if (!sel) return '';
  const byValue = normBlob(sel.value || '');
  const byText  = normBlob(sel.options?.[sel.selectedIndex]?.textContent || '');
  return `${byValue} ${byText}`;
}

function isHomSelectedStrict() {
  const blob = getSupplierKey();

  // ✅ whitelist exact leveranciers (value of text)
  const allowed = [
    'hom',
    'hom nachtmode',
    'hom swimwear'
  ];

  return allowed.some(k => blob === k || blob.startsWith(k + ' ') || blob.includes(' ' + k + ' '));
}

Core.mountSupplierButton({
  id: 'vcp2-hom-btn',
  text: computeHomButtonText(),
  right: 250,
  top: 8,
  match: () => isHomSelectedStrict(),
  onClick: (btn) => run(btn)
});

setTimeout(() => {
  syncHomButtonText();

  const sel = document.querySelector('#leverancier-keuze');
  if (sel) sel.addEventListener('change', syncHomButtonText);
}, 80);


  // badge: rood/groen op heartbeat zoals Chantelle
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

    try { GM_addValueChangeListener(HEARTBEAT_KEY, () => setBadge(true)); } catch {}
  }

  setTimeout(() => {
    const btn = document.getElementById('vcp2-hom-btn');
    if (btn) installHeartbeatBadge(btn);
  }, 60);

  // keep-alive ping (via bridge)
  if (CONFIG.NAV.keepAlive) {
    setInterval(() => {
      if (!bridgeOnline()) return;
      bridgeRequest({ url: MODELVIEW_URL, method: 'GET' }, TIMEOUT_MS).catch(() => {});
    }, KEEPALIVE_MS);
  }

})();
