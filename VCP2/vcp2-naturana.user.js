// ==UserScript==
// @name         VCP2 | Naturana
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @match        https://naturana-online.de/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-naturana.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-naturana.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL     = location.hostname.includes('lingerieoutlet.nl');
  const ON_NATURANA = location.hostname.includes('naturana-online.de');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const BRAND_KEY = 'naturana';

  const MODELVIEW_URL   = 'https://naturana-online.de/naturana/ModellView';
  const ARTICLEVIEW_URL = 'https://naturana-online.de/naturana/ArticleView';

  const TIMEOUT_MS = 20000;

  // Bridge heartbeat
  const BRIDGE_KEY     = 'naturana_vcp2_bridge';
  const HEARTBEAT_KEY  = `${BRIDGE_KEY}_hb`;
  const HB_INTERVAL_MS = 2500;

  // Multi-channel bridge (best effort)
  const CHANNELS = [
    { req:`${BRIDGE_KEY}_req_adv`, resp:`${BRIDGE_KEY}_resp_adv`, ping:`${BRIDGE_KEY}_ping_adv`, pong:`${BRIDGE_KEY}_pong_adv` },
    { req:`${BRIDGE_KEY}_req_v2`,  resp:`${BRIDGE_KEY}_resp_v2`,  ping:`${BRIDGE_KEY}_ping_v2`,  pong:`${BRIDGE_KEY}_pong_v2`  },
    { req:`${BRIDGE_KEY}_req_v1`,  resp:`${BRIDGE_KEY}_resp_v1`,  ping:`${BRIDGE_KEY}_ping_v1`,  pong:`${BRIDGE_KEY}_pong_v1`  },
  ];

  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s, r=document) => r.querySelector(s);

  const parseHTML = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html');

  const looksLikeLogin = (html) => {
    const t = String(html || '').toLowerCase();
    return /login|passwort|password|anmelden/i.test(t) && /<form|input|button/i.test(t);
  };

  // =========================================================
  // Tool-side prerequisites (zoals Chantelle)
  // =========================================================
  if (ON_TOOL) {
    if (!Core) {
      console.error('[VCP2|Naturana] VCPCore ontbreekt. Check @require vcp-core.js');
      return;
    }
    if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
      console.error('[VCP2|Naturana] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
      return;
    }
  }

  // =========================================================
  // Logger (status -> logboek, mapping -> console.table)
  // =========================================================
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    status(anchorId, txt) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(anchorId), String(txt));
      else console.info(`[Naturana][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[Naturana][${anchorId}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: (r.remote ?? '—'),
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally { console.groupEnd(); }
    }
  };

  // =========================================================
  // Bridge (Naturana tab): fetch with cookies
  // =========================================================
  function workerInitBridge() {
    // heartbeat
    setInterval(() => {
      try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
    }, HB_INTERVAL_MS);

    // ping/pong (optional)
    CHANNELS.forEach(ch => {
      try {
        GM_addValueChangeListener(ch.ping, (_n, _o, msg) => {
          if (msg === 'ping') GM_setValue(ch.pong, 'pong:' + Date.now());
        });
      } catch {}
    });

    // concurrency queue
    const q = [];
    let active = 0;
    const BRIDGE_CONCURRENCY = 4;

    async function handleOne(req) {
      const respKey = req._resp;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), Math.max(5000, req.timeout || TIMEOUT_MS));

        const res = await fetch(req.url, {
          method: req.method || 'GET',
          headers: req.headers || {},
          credentials: 'include',
          body: req.body || null,
          signal: ctrl.signal,
        });

        const text = await res.text();
        clearTimeout(to);

        GM_setValue(respKey, { id: req.id, ok: true, status: res.status, text });
      } catch (e) {
        GM_setValue(respKey, { id: req.id, ok: false, error: String(e) });
      }
    }

    function pump() {
      while (active < BRIDGE_CONCURRENCY && q.length) {
        const req = q.shift();
        active++;
        handleOne(req).finally(() => { active--; pump(); });
      }
    }

    CHANNELS.forEach(ch => {
      try {
        GM_addValueChangeListener(ch.req, (_n, _o, req) => {
          if (!req || !req.id || !req.url) return;
          q.push({ ...req, _resp: ch.resp });
          pump();
        });
      } catch {}
    });

    try { GM_setValue(HEARTBEAT_KEY, Date.now()); } catch {}
  }

  // =========================================================
  // Tool-side: bridge helpers
  // =========================================================
  function bridgeOnline(maxAgeMs = 6000) {
    try {
      const t = GM_getValue(HEARTBEAT_KEY, 0);
      return t && (Date.now() - t) < maxAgeMs;
    } catch {
      return false;
    }
  }

  function bridgeSend({ url, method='GET', headers={}, body=null, timeout=TIMEOUT_MS }) {
    const id = uid();

    return new Promise((resolve, reject) => {
      const handles = [];
      let settled = false;

      const off = () => {
        handles.forEach(h => { try { GM_removeValueChangeListener(h); } catch {} });
      };

      CHANNELS.forEach(ch => {
        const h = GM_addValueChangeListener(ch.resp, (_n, _o, msg) => {
          if (settled || !msg || msg.id !== id) return;
          settled = true;
          off();
          msg.ok ? resolve(msg) : reject(new Error(msg.error || 'bridge error'));
        });
        handles.push(h);
      });

      CHANNELS.forEach(ch => {
        GM_setValue(ch.req, { id, url, method, headers, body, timeout });
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error('bridge timeout'));
      }, timeout + 1500);
    });
  }

  const httpGET = (url) => bridgeSend({ url, method: 'GET' });

  const httpPOST = (url, dataObj) => {
    const body = new URLSearchParams(dataObj || {}).toString();
    return bridgeSend({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });
  };

  // =========================================================
  // Naturana: ASP.NET helpers (pure navigation)
  // =========================================================
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

  function getFormAction(doc, fallbackUrl) {
    const form = doc.querySelector('form');
    const act = (form?.getAttribute('action') || '').trim();
    try { return new URL(act || '', fallbackUrl).toString(); }
    catch { return fallbackUrl; }
  }

  function serializeForm(form) {
    const payload = {};
    if (!form?.elements) return payload;

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

  function addImageSubmit(payload, imageName) {
    payload[`${imageName}.x`] = '1';
    payload[`${imageName}.y`] = '1';
  }

  // =========================================================
  // Size normalization (pure parsing convenience)
  // =========================================================
  const SIZE_ALIAS = {
    '2XL':'XXL','XXL':'2XL',
    '3XL':'XXXL','XXXL':'3XL',
    '4XL':'XXXXL','XXXXL':'4XL',
    '3L':'3XL',
    'XS/S':'XS','S/M':'M','M/L':'L','L/XL':'XL','XL/2XL':'2XL'
  };

  function normalizeSizeKey(raw) {
    let v = String(raw ?? '').trim();
    if (!v) return '';
    v = v.split(/[|,]/)[0];
    v = v.trim().toUpperCase().replace(/\s+/g, '');
    if (!v) return '';
    if (SIZE_ALIAS[v]) v = SIZE_ALIAS[v];
    return v;
  }

  function aliasCandidates(label) {
    const raw = String(label || '').trim().toUpperCase();
    const ns = raw.replace(/\s+/g, '');
    const set = new Set([raw, ns]);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns]) set.add(SIZE_ALIAS[ns]);

    if (raw.includes('/')) {
      raw.split('/').map(x => x.trim()).filter(Boolean).forEach(x => {
        set.add(x);
        set.add(x.replace(/\s+/g, ''));
        if (SIZE_ALIAS[x]) set.add(SIZE_ALIAS[x]);
      });
    }
    return Array.from(set);
  }

  // =========================================================
  // ModellView exact match: "PID-COLOR" -> postback target
  // =========================================================
  function findModelItemExact(doc, pidColor) {
    const raw = String(pidColor || '').trim().toUpperCase();
    const m = raw.match(/^(.+?)-(.*)$/);
    const pid = (m ? m[1] : raw).trim();
    const color = (m ? m[2] : '').trim();
    const colorDigits = color.replace(/\D/g, '');

    if (!pid || !colorDigits) return null;

    const spans = Array.from(doc.querySelectorAll('span[id*="lblArticleNo"]'));
    const exactSpans = spans.filter(sp => (sp.textContent || '').trim() === pid);
    if (!exactSpans.length) return null;

    for (const sp of exactSpans) {
      const col = sp.closest('.mod-container-col');
      if (!col) continue;

      const a = col.querySelector('a[id*="linkArticleNo"][href*="__doPostBack"]');
      const href = a?.getAttribute('href') || '';
      const mm = href.match(/__doPostBack\('([^']+)'\s*,\s*'([^']*)'\)/i);
      if (!mm) continue;

      return { pid, colorDigits, eventTarget: mm[1], eventArg: (mm[2] || '') };
    }
    return null;
  }

  // =========================================================
  // ArticleView: ensure exact color (pure navigation)
  // =========================================================
  async function ensureArticleViewColor(html, colorDigits, fallbackUrl) {
    const doc = parseHTML(html);

    const current =
      (doc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (doc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    if (String(current).replace(/\D/g, '') === String(colorDigits)) return html;

    const blocks = Array.from(doc.querySelectorAll('.art-color'));
    const wanted = blocks.find(b => {
      const n = (b.querySelector('.art-color-no')?.textContent || '').trim();
      return String(n).replace(/\D/g, '') === String(colorDigits);
    });
    if (!wanted) throw new Error('TARGET_NOT_FOUND');

    const img = wanted.querySelector('input[type="image"][name*="btnSelectColor"]');
    const imgName = img?.getAttribute('name') || '';
    if (!imgName) throw new Error('TARGET_NOT_FOUND');

    const form = doc.querySelector('form');
    if (!form) throw new Error('TARGET_NOT_FOUND');

    const actionUrl = getFormAction(doc, fallbackUrl);
    const payload = serializeForm(form);

    if (!('__EVENTTARGET' in payload)) payload.__EVENTTARGET = '';
    if (!('__EVENTARGUMENT' in payload)) payload.__EVENTARGUMENT = '';

    addImageSubmit(payload, imgName);

    const msg = await httpPOST(actionUrl, payload);
    if (looksLikeLogin(msg.text)) throw new Error('LOGIN_REQUIRED');

    const checkDoc = parseHTML(msg.text);
    const after =
      (checkDoc.querySelector('.div-art-color .art-color-text')?.textContent || '').trim() ||
      (checkDoc.querySelector('[id*="lblColorNr"]')?.textContent || '').trim() ||
      '';

    if (String(after).replace(/\D/g, '') !== String(colorDigits)) {
      throw new Error('TARGET_NOT_FOUND');
    }

    return msg.text;
  }

  // =========================================================
  // ArticleView -> remote qty per size (pure parsing)
  // =========================================================
  function buildStockMapFromArticleView(html) {
    const map = new Map();
    const doc = parseHTML(html);

    const tiles = Array.from(doc.querySelectorAll('.color-size-grid .p-2.text-center, .color-size-grid [id*="_divOID_"]'));
    for (const tile of tiles) {
      const sizeEl = tile.querySelector('.gridSize');
      const inp = tile.querySelector('input.gridAmount');
      if (!sizeEl || !inp) continue;

      const rawSize = (sizeEl.textContent || '').trim().toUpperCase();
      if (!rawSize) continue;

      const sizeKey = normalizeSizeKey(rawSize);

      const rawMax =
        inp.getAttribute('max') ??
        inp.getAttribute('data-max') ??
        inp.dataset?.max ??
        inp.getAttribute('value') ??
        inp.value ??
        '0';

      let qty = parseInt(String(rawMax).trim(), 10);
      if (!Number.isFinite(qty) || qty < 0) qty = 0;

      for (const key of aliasCandidates(sizeKey)) {
        map.set(normalizeSizeKey(key), qty);
      }
    }
    return map;
  }

  function resolveRemoteQty(stockMap, label) {
    for (const c of aliasCandidates(label)) {
      const k = normalizeSizeKey(c);
      if (stockMap.has(k)) return stockMap.get(k);
    }
    return undefined;
  }

  // =========================================================
  // ModellView -> ArticleView (pure navigation)
  // =========================================================
  async function openArticleViewExact(pidColor, state) {
    const ensureFreshModelView = async () => {
      const msg = await httpGET(MODELVIEW_URL);
      if (msg.status >= 400) throw new Error(`HTTP_${msg.status}`);
      if (looksLikeLogin(msg.text)) throw new Error('LOGIN_REQUIRED');

      const doc = parseHTML(msg.text);
      const vs = pickViewState(doc);
      if (!vs?.__VIEWSTATE) throw new Error('TARGET_NOT_FOUND');

      state.doc = doc;
      state.vs = vs;
    };

    if (!state.doc || !state.vs) await ensureFreshModelView();

    let item = findModelItemExact(state.doc, pidColor);
    if (!item) {
      await ensureFreshModelView();
      item = findModelItemExact(state.doc, pidColor);
      if (!item) throw new Error('TARGET_NOT_FOUND');
    }

    const payload = {
      __EVENTTARGET: item.eventTarget || '',
      __EVENTARGUMENT: item.eventArg || '',
      __VIEWSTATE: state.vs.__VIEWSTATE,
      __VIEWSTATEGENERATOR: state.vs.__VIEWSTATEGENERATOR || '',
      __EVENTVALIDATION: state.vs.__EVENTVALIDATION || ''
    };

    const msg1 = await httpPOST(MODELVIEW_URL, payload);
    if (msg1.status >= 400) throw new Error(`HTTP_${msg1.status}`);
    if (looksLikeLogin(msg1.text)) throw new Error('LOGIN_REQUIRED');

    return ensureArticleViewColor(msg1.text, item.colorDigits, ARTICLEVIEW_URL);
  }

  // =========================================================
  // Tool-side: local table read + sku
  // =========================================================
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

  function getMaxCap(_table) {
    // Core bepaalt meestal caps/kleuren; als Core iets biedt, pak dat, anders 5
    try {
      if (typeof Core.getMaxCap === 'function') return Core.getMaxCap(_table);
    } catch {}
    return 5;
  }

  // =========================================================
  // ✅ Apply rules via CENTRAL StockRules mapping/reconcile
  // =========================================================
  function applyCompareAndMark(localRows, stockMap, maxCap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      const remote = resolveRemoteQty(stockMap, maat);

      // remote ontbreekt voor deze maat => skip (geen fallback mapping)
      if (typeof remote !== 'number') continue;

      const target = SR.mapRemoteToTarget(BRAND_KEY, remote, maxCap);
      const res = SR.reconcile(local, target, maxCap);

      const delta = Number(res?.delta || 0);
      let status = 'ok';

      if (res?.action === 'bijboeken' && delta > 0) {
        Core.markRow(tr, { action: 'add', delta, title: `Bijboeken ${delta} (target ${target}, remote ${remote})` });
        status = 'bijboeken';
        if (!firstMut) firstMut = tr;

      } else if (res?.action === 'uitboeken' && delta > 0) {
        Core.markRow(tr, { action: 'remove', delta, title: `Uitboeken ${delta} (target ${target}, remote ${remote})` });
        status = 'uitboeken';
        if (!firstMut) firstMut = tr;

      } else {
        Core.markRow(tr, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remote})` });
        status = 'ok';
      }

      report.push({ maat, local, remote, target, delta, status });
    }

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalStatus(report, stockMap) {
    if (!stockMap || stockMap.size === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  function isNotFoundHttpError(msg) {
    return /^HTTP_(401|403|404|410)$/i.test(msg) || /^HTTP_5\d\d$/i.test(msg);
  }

  // =========================================================
  // Per table
  // =========================================================
  async function perTableFactory(state) {
    return async function perTable(table) {
      const sku = getSkuFromTable(table);
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || sku || 'onbekend';
      const anchorId = sku || label;

      if (!sku) {
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      // remote ophalen + parse
      let html;
      let stockMap;

      try {
        html = await openArticleViewExact(sku, state);

        if (!html || looksLikeLogin(html)) throw new Error('LOGIN_REQUIRED');

        stockMap = buildStockMapFromArticleView(html);
        if (!stockMap || stockMap.size === 0) throw new Error('TARGET_NOT_FOUND');

      } catch (e) {
        const msg = String(e?.message || e);

        // VCP2 foutafhandeling: 401/403/404/410/5xx, parse/login/targetfail -> niet-gevonden
        if (msg === 'LOGIN_REQUIRED' || msg === 'TARGET_NOT_FOUND' || msg === 'bridge timeout' || isNotFoundHttpError(msg)) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          return 0;
        }

        // overige fouten ook niet-gevonden (geen alerts, geen debug dumps)
        Logger.status(anchorId, 'niet-gevonden');
        Logger.perMaat(anchorId, []);
        return 0;
      }

      const maxCap = getMaxCap(table);
      const localRows = readLocalTable(table);

      const report = applyCompareAndMark(localRows, stockMap, maxCap);
      Logger.status(anchorId, bepaalStatus(report, stockMap));
      Logger.perMaat(anchorId, report);

      return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    };
  }

  // =========================================================
  // Run (Core.runTables)
  // =========================================================
  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    // Geen alerts in VCP2 (tenzij gevraagd). Als bridge offline: gewoon niet-gevonden per tabel.
    const state = { doc: null, vs: null };
    const perTable = await perTableFactory(state);

    await Core.runTables({
      btn,
      tables,
      concurrency: 4,
      perTable
    });
  }

  // =========================================================
  // Supplier select (zelfde aanpak als Chantelle)
  // =========================================================
  function normBlob(s='') { return String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' '); }
  function isNaturanaSelected() {
    const sel = $('#leverancier-keuze');
    if (!sel) return true;
    const byValue = normBlob(sel.value || '');
    const byText  = normBlob(sel.options?.[sel.selectedIndex]?.text || '');
    return byValue.includes('naturana') || byText.includes('naturana');
  }

  // =========================================================
  // TOOL UI (VCP2) — exact Chantelle pattern
  // =========================================================
  if (ON_TOOL) {
    Core.mountSupplierButton({
      id: 'vcp2-naturana-btn',
      text: '🔍 Check Stock | Naturana',
      right: 250,
      top: 8,
      match: () => isNaturanaSelected(),
      onClick: (btn) => run(btn)
    });
  }

  // =========================================================
  // Naturana bridge worker
  // =========================================================
  if (ON_NATURANA) workerInitBridge();

})();
