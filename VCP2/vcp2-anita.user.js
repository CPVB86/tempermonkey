// ==UserScript==
// @name         VCP2 | Anita
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      b2b.anita.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-anita.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const BRAND_KEY = 'anita';

  // -----------------------
  // Tool-side prerequisites
  // -----------------------
  if (ON_TOOL) {
    if (!Core) {
      console.error('[VCP2|Anita] VCPCore ontbreekt. Check @require vcp-core.js');
      return;
    }
    if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
      console.error('[VCP2|Anita] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
      return;
    }
  }

  // -----------------------
  // Config / URLs
  // -----------------------
  const BASE = 'https://b2b.anita.com';
  const PATH_441 = '/nl/shop/441/';
  const PATH_410 = '/nl/shop/410/';

  const ACCEPT_HDR  = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  const CONTENT_HDR = 'application/x-www-form-urlencoded; charset=UTF-8';

  const ALLOWED_SUPPLIERS = new Set([
    'anita','anita-active','anita-badmode','anita-care','anita-maternity',
    'rosa-faia','rosa-faia-badmode'
  ]);

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // -----------------------
  // Logger (status -> logboek, mapping -> console.table)
  // -----------------------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
    },
    status(anchorId, txt) {
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(String(anchorId), String(txt));
      else console.info(`[Anita][${anchorId}] status: ${txt}`);
    },
    perMaat(anchorId, report) {
      console.groupCollapsed(`[Anita][${anchorId}] maatvergelijking`);
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

  // -----------------------
  // GM fetch (returns {status, text})
  // -----------------------
  function fetchViaGM(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url: opts.url,
        data: opts.data,
        withCredentials: true,
        timeout: opts.timeout || 20000,
        headers: {
          'Accept': ACCEPT_HDR,
          'Content-Type': opts.contentType || CONTENT_HDR,
          'Referer': BASE + '/nl/shop'
        },
        onload: (r) => resolve({ status: r.status, text: r.responseText || '' }),
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error(`timeout @ ${opts.url}`)),
      });
    });
  }

  const isNotFoundHttp = (status) =>
    status === 401 || status === 403 || status === 404 || status === 410 || (status >= 500 && status <= 599);

  // -----------------------
  // Session (voor 410 fallback)
  // -----------------------
  async function getSessionHidden() {
    const res = await fetchViaGM({ url: BASE + PATH_410 });
    if (isNotFoundHttp(res.status)) throw new Error(`HTTP_${res.status}`);

    const doc = new DOMParser().parseFromString(res.text, 'text/html');
    const form = $('.shop-article-search', doc) || $('form[name="Suche"]', doc);
    const val = (n) => form?.querySelector(`input[name="${n}"]`)?.value?.trim() || '';

    const out = { fir: val('fir'), kdnr: val('kdnr'), fssc: val('fssc'), aufn: val('aufn') };
    if (!out.fir || !out.kdnr) throw new Error('TARGET_NOT_FOUND');
    return out;
  }

  // -----------------------
  // PID parsing (pure)
  // -----------------------
  function parsePid(raw='') {
    const pid = String(raw).trim().replace(/\s+/g, '');
    if (!pid) return { koll:'', arnr:'', fbnr:'' };

    const parts = pid.split('-').filter(Boolean);

    if (parts.length >= 3) {
      const kollCandidate = parts[0];
      const fbnr = parts[parts.length - 1];

      if (/[A-Za-z]/.test(kollCandidate)) {
        return { koll: kollCandidate, arnr: parts.slice(1, -1).join('-'), fbnr };
      }
      return { koll: '', arnr: parts.slice(0, -1).join('-'), fbnr };
    }

    if (parts.length === 2) return { koll:'', arnr: parts[0], fbnr: parts[1] };
    return { koll:'', arnr: parts[0] || '', fbnr:'' };
  }

  function getPidHintsFromTable(table) {
    const ds = table?.dataset || {};
    const dsKoll = ds.anitaKoll || ds.anitaCollection || ds.koll || '';
    const dsArt  = ds.anitaArticle || ds.article || '';
    const dsCol  = ds.anitaColor || ds.color || '';
    if (dsKoll || dsArt || dsCol) return { koll: dsKoll.trim(), arnr: dsArt.trim(), fbnr: dsCol.trim() };
    return parsePid(table?.id || '');
  }

  // -----------------------
  // Fetch detail (441, fallback 410)
  // -----------------------
  function build441Url({ arnr, koll='', fbnr='', zicht='A' }) {
    const qp = new URLSearchParams();
    if (koll) qp.set('koll', koll);
    if (arnr) qp.set('arnr', arnr);
    if (fbnr != null && String(fbnr).trim() !== '') qp.set('fbnr', String(fbnr).trim());
    qp.set('sicht', zicht || 'A');
    return `${BASE}${PATH_441}?${qp.toString()}`;
  }

  async function fetchDetailHtml(params) {
    // 1) try 441
    const url441 = build441Url(params);
    const r441 = await fetchViaGM({ url: url441 });

    if (r441.status >= 200 && r441.status < 300) return r441.text;
    if (isNotFoundHttp(r441.status)) throw new Error(`HTTP_${r441.status}`);

    // 2) fallback 410 (POST with session hidden if possible)
    try {
      const h = await getSessionHidden();

      const bodyParams = {
        such: params.arnr || '',
        koll: params.koll || '',
        zicht: 'S',
        ...h
      };
      if (params.fbnr != null && String(params.fbnr).trim() !== '') bodyParams.fbnr = String(params.fbnr).trim();

      const body = new URLSearchParams(bodyParams).toString();
      const rPost = await fetchViaGM({ method:'POST', url: BASE + PATH_410, data: body });

      if (rPost.status >= 200 && rPost.status < 300) return rPost.text;
      if (isNotFoundHttp(rPost.status)) throw new Error(`HTTP_${rPost.status}`);

      // unknown -> treat as not-found
      throw new Error(`HTTP_${rPost.status}`);

    } catch (e) {
      // 3) fallback 410 via GET qs
      const qsParams = { such: params.arnr || '', koll: params.koll || '', zicht: 'S' };
      if (params.fbnr != null && String(params.fbnr).trim() !== '') qsParams.fbnr = String(params.fbnr).trim();

      const qs = new URLSearchParams(qsParams).toString();
      const rGet = await fetchViaGM({ url: BASE + PATH_410 + '?' + qs });

      if (rGet.status >= 200 && rGet.status < 300) return rGet.text;
      if (isNotFoundHttp(rGet.status)) throw new Error(`HTTP_${rGet.status}`);

      throw new Error(`HTTP_${rGet.status}`);
    }
  }

  // -----------------------
  // Parse HTML (pure parsing)
  // -----------------------
  const normColor = (s='') => {
    const t = String(s).trim();
    const stripped = t.replace(/^0+/, '');
    return stripped === '' ? '0' : stripped;
  };

  function colorFromImg(table) {
    const img = table.querySelector('img[src*="/color/"]');
    if (!img) return '';
    const m = String(img.getAttribute('src') || '').match(/\/color\/(\d+)\.jpg/i);
    return m ? m[1] : '';
  }

  function parseAnitaStock(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const tables = $$('.shop-article-tables table[data-article-number]', doc);

    const out = { article: tables[0]?.dataset.articleNumber || null, colors: {} };

    for (const t of tables) {
      let colorNo = (t.dataset.colorNumber || '').trim();
      if (!colorNo) {
        const fromImg = colorFromImg(t);
        if (fromImg) colorNo = fromImg;
      }

      const colorName = (t.dataset.colorName || '').trim();

      const bandHeaders = $$('thead th', t)
        .map(th => th.textContent.trim())
        .filter(v => v && !/^(Inkoopprijs|Verkoopprijs)$/i.test(v));

      const rows = $$('tbody tr', t);
      const hasCup = rows.some(r => (r.querySelector('th[scope="row"]')?.textContent || '').trim().length > 0);

      const sizes = {};

      if (hasCup) {
        for (const row of rows) {
          const cup = (row.querySelector('th[scope="row"]')?.textContent || '').trim();
          if (!cup) continue;
          const cells = $$('td', row);
          cells.forEach((td, i) => {
            const band = bandHeaders[i];
            const inp  = $('input[data-in-stock]', td);
            if (!band || !inp) return;

            const key = `${String(band).trim()}${String(cup).trim()}`.replace(/\s+/g, '');
            const qty = parseInt(inp.getAttribute('data-in-stock') || '0', 10) || 0;
            sizes[key] = qty;
          });
        }
      } else {
        for (const row of rows) {
          const cells = $$('td', row);
          cells.forEach((td, i) => {
            const band = bandHeaders[i];
            const inp  = $('input[data-in-stock]', td);
            if (!band || !inp) return;

            const key = String(band).replace(/\s+/g, '');
            const qty = parseInt(inp.getAttribute('data-in-stock') || '0', 10) || 0;
            sizes[key] = qty;
          });
        }
      }

      if (colorNo) out.colors[colorNo] = { name: colorName, sizes };
    }

    return out;
  }

  // -----------------------
  // Kleurselectie (pure selectie)
  // -----------------------
  function chooseColor(remote, table, fbnrHint) {
    const colors = remote?.colors || {};

    // Als fbnr is opgegeven: alleen die kleur accepteren
    const asked = String(fbnrHint || '').trim();
    if (asked) {
      if (colors[asked]) return colors[asked].sizes;

      const askedN = normColor(asked);
      const key = Object.keys(colors).find(k => normColor(k) === askedN);
      if (key) return colors[key].sizes;

      return {};
    }

    // Geen fbnr: oude gedrag (naam-hint -> single -> merge)
    const hintName = String(table.dataset.anitaColorName || '').toLowerCase().trim();
    if (hintName) {
      const hit = Object.values(colors).find(c => String(c.name || '').toLowerCase().includes(hintName));
      if (hit) return hit.sizes;
    }

    const entries = Object.values(colors);
    if (entries.length === 1) return entries[0].sizes;

    const merged = {};
    for (const c of entries) {
      for (const [k, v] of Object.entries(c.sizes || {})) {
        merged[k] = Math.max(merged[k] || 0, Number(v || 0));
      }
    }
    return merged;
  }

  // -----------------------
  // Remote qty resolver (pure)
  // -----------------------
  function resolveRemoteQty(remoteMap, label) {
    const raw = String(label || '').trim();

    if (Object.prototype.hasOwnProperty.call(remoteMap, raw)) return remoteMap[raw];
    const nospace = raw.replace(/\s+/g, '');
    if (Object.prototype.hasOwnProperty.call(remoteMap, nospace)) return remoteMap[nospace];

    const m = raw.match(/^(\d+)\s*([A-Za-z]{1,2}(?:\/[A-Za-z]{1,2})+)$/);
    if (m) {
      const band = m[1];
      const cups = m[2].split('/');
      let best = -1;
      for (const cup of cups) {
        const key = `${band}${cup}`.replace(/\s+/g, '');
        if (Object.prototype.hasOwnProperty.call(remoteMap, key)) {
          const v = remoteMap[key];
          if (v > best) best = v;
        }
      }
      if (best >= 0) return best;
    }

    if (raw.includes('/')) {
      let best = -1;
      for (const part of raw.split('/').map(s => s.trim())) {
        const k1 = part;
        const k2 = part.replace(/\s+/g, '');
        if (Object.prototype.hasOwnProperty.call(remoteMap, k1)) best = Math.max(best, remoteMap[k1]);
        else if (Object.prototype.hasOwnProperty.call(remoteMap, k2)) best = Math.max(best, remoteMap[k2]);
      }
      if (best >= 0) return best;
    }

    return undefined;
  }

  // -----------------------
  // Tool: local table parsing
  // -----------------------
  function readLocalTable(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const out = [];

    for (const tr of rows) {
      const maatRaw = tr.dataset.size || tr.children?.[0]?.textContent || '';
      const maat = String(maatRaw).trim();
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

  function getMaxCap(table) {
    try {
      if (typeof Core.getMaxCap === 'function') return Core.getMaxCap(table);
    } catch {}
    return 5;
  }

  // -----------------------
  // ✅ Apply: StockRules mapping + reconcile, Core.markRow
  // -----------------------
  function applyCompareAndMark(localRows, remoteMap, maxCap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      const remoteQty = resolveRemoteQty(remoteMap, maat);
      if (typeof remoteQty !== 'number') continue;

      const target = SR.mapRemoteToTarget(BRAND_KEY, remoteQty, maxCap);
      const res    = SR.reconcile(local, target, maxCap);

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

      report.push({ maat, local, remote: remoteQty, target, delta, status });
    }

    if (firstMut) Core.jumpFlash(firstMut);
    return report;
  }

  function bepaalStatus(report, remoteMap) {
    if (!remoteMap || Object.keys(remoteMap).length === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  // -----------------------
  // perTable (Core.runTables)
  // -----------------------
  async function perTable(table) {
    const sku = getSkuFromTable(table);
    const { koll, arnr, fbnr } = getPidHintsFromTable(table);

    const label = table.querySelector('thead th[colspan]')?.textContent?.trim()
      || table.id || [koll, arnr, fbnr].filter(Boolean).join('-') || 'onbekend';

    const anchorId = sku || arnr || label;

    if (!arnr) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    let html = '';
    try {
      html = await fetchDetailHtml({ arnr, koll, fbnr, zicht: 'A' });
    } catch (e) {
      const msg = String(e?.message || e);
      if (/^HTTP_\d+$/i.test(msg)) {
        const status = parseInt(msg.replace(/^HTTP_/i, ''), 10);
        if (Number.isFinite(status) && isNotFoundHttp(status)) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          return 0;
        }
      }
      // alles wat hier misgaat: niet-gevonden (VCP2 foutregels)
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    let remote;
    let remoteMap;
    try {
      remote = parseAnitaStock(html);
      remoteMap = chooseColor(remote, table, fbnr);
    } catch {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    if (!remoteMap || Object.keys(remoteMap).length === 0) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const localRows = readLocalTable(table);
    const maxCap = getMaxCap(table);

    const report = applyCompareAndMark(localRows, remoteMap, maxCap);
    const status = bepaalStatus(report, remoteMap);

    Logger.status(anchorId, status);
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  // -----------------------
  // Run
  // -----------------------
  async function run(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable
    });
  }

  // -----------------------
  // Supplier select (zoals Chantelle)
  // -----------------------
  function normBlob(s='') {
    return String(s).toLowerCase().trim().replace(/[-_]+/g,' ').replace(/\s+/g,' ');
  }

  function isAllowedSupplierSelected() {
    const dd = document.getElementById('leverancier-keuze');
    if (!dd) return true;

    const opt = dd.options[dd.selectedIndex] || null;
    const byValue = normBlob(dd.value || '').replace(/\s+/g,'-');
    const byText  = normBlob(opt ? (opt.text || '') : '').replace(/\s+/g,'-');

    return ALLOWED_SUPPLIERS.has(byValue) || ALLOWED_SUPPLIERS.has(byText);
  }

  // -----------------------
  // UI (Core.mountSupplierButton)
  // -----------------------
      function titleCaseWords(s='') {
    return String(s)
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/(^|\s)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }

  function getSelectedAnitaLabel() {
    const dd = document.getElementById('leverancier-keuze');
    if (!dd) return 'Anita';

    const opt = dd.options?.[dd.selectedIndex];
    const byText = String(opt?.text || '').trim();
    const byValue = String(dd.value || '').trim();

    // Prefer de zichtbare tekst; die is vaak al "Anita Care" etc.
    let label = byText || byValue || 'Anita';

    // Normaliseer bekende slugs/varianten naar nette naam
    const norm = (x='') => String(x).toLowerCase().trim().replace(/[_]+/g,'-').replace(/\s+/g,'-');

    const v = norm(byValue);
    const t = norm(byText);

    if (v.includes('rosa-faia-badmode') || t.includes('rosa-faia-badmode') || /rosa\s*faia\s*badmode/i.test(label)) return 'Rosa Faia Badmode';
    if (v.includes('rosa-faia') || t.includes('rosa-faia')) return 'Rosa Faia';
    if (v.includes('anita-care') || t.includes('anita-care') || /anita\s*care/i.test(label)) return 'Anita Care';
    if (v.includes('anita-maternity') || t.includes('anita-maternity') || /anita\s*maternity/i.test(label)) return 'Anita Maternity';
    if (v.includes('anita-active') || t.includes('anita-active') || /anita\s*active/i.test(label)) return 'Anita Active';
    if (v.includes('anita-badmode') || t.includes('anita-badmode') || /anita\s*badmode/i.test(label)) return 'Anita Badmode';

    // Als het gewoon "anita" is, maak het netjes
    if (v === 'anita' || t === 'anita' || /^anita$/i.test(label)) return 'Anita';

    // Anders: gebruik dropdowntekst maar maak het wat netter
    return titleCaseWords(label);
  }

  function updateAnitaButtonText() {
    const btn = document.getElementById('vcp2-anita-btn');
    if (!btn) return;
    const brand = getSelectedAnitaLabel();
    btn.textContent = `🔍 Check Stock | ${brand}`;
  }

  if (ON_TOOL) {
    Core.mountSupplierButton({
      id: 'vcp2-anita-btn',
      text: '🔍 Check Stock | Anita',          // init, wordt direct overschreven
      right: 250,
      top: 8,
      match: () => isAllowedSupplierSelected(),
      onClick: (btn) => run(btn),
    });

    // Text sync na mount + bij dropdown change (alleen tekst, geen show/hide)
    setTimeout(updateAnitaButtonText, 50);

    const dd = document.getElementById('leverancier-keuze');
    if (dd) dd.addEventListener('change', () => setTimeout(updateAnitaButtonText, 0));
  }

})();
