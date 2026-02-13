// ==UserScript==
// @name         VCP2 | RJ Bodywear
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      b2b.rjbodywear.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-rj-bodywear.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-rj-bodywear.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');
  if (!ON_TOOL) return;

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  const BRAND_KEY = 'rj-bodywear';

  // -----------------------
  // Tool-side prerequisites
  // -----------------------
  if (!Core) {
    console.error('[VCP2|RJ] VCPCore ontbreekt. Check @require vcp-core.js');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.error('[VCP2|RJ] StockRules ontbreekt/incompleet. Vereist: mapRemoteToTarget + reconcile');
    return;
  }

  // =========================
  // CONFIG
  // =========================
  const RJ_BASE = 'https://b2b.rjbodywear.com';

  const TIMEOUT_MS  = 20000;
  const MAX_PAGES   = 50;
  const LIST_LIMIT  = 36;

  const INDEX_CONCURRENCY = 2; // index scan concurrency
  const TABLE_CONCURRENCY = 3; // Core.runTables concurrency

  const $ = (s, r=document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  const isNotFoundHttp = (status) =>
    status === 401 || status === 403 || status === 404 || status === 410 || (status >= 500 && status <= 599);

  // =========================
  // LOGGER (VCP2 rules)
  // =========================
  const Logger = {
    lb() {
      try {
        return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek;
      } catch {
        return window.logboek;
      }
    },
    status(id, txt) {
      const lb = this.lb();
      if (lb && typeof lb.resultaat === 'function') lb.resultaat(String(id), String(txt));
      else console.info(`[RJ][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      console.groupCollapsed(`[RJ][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remote: (r.remoteRaw ?? '—'),
          target: Number.isFinite(r.target) ? r.target : '—',
          delta: Number.isFinite(r.delta) ? r.delta : '—',
          status: r.status
        })));
      } finally {
        console.groupEnd();
      }
    }
  };

  // =========================
  // GM fetch helper
  // =========================
  function httpGetText(url, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout,
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        onload: (res) => resolve({ status: res.status, text: res.responseText || '' }),
        onerror: () => reject(new Error('Network error: ' + url)),
        ontimeout: () => reject(new Error('Timeout: ' + url))
      });
    });
  }

  // =========================
  // Helpers: PID / SKU / maat
  // =========================
  function baseFromSupplierPid(pid) {
    const s = String(pid || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    return parts.length >= 3 ? parts.slice(0, 3).join('-') : s;
  }

  function toBaseSku(skuRaw) {
    const s = String(skuRaw || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    return parts.length >= 3 ? parts.slice(0, 3).join('-') : s;
  }

  function deriveColorSuffix(pid) {
    const s = String(pid || '').trim();
    if (!s) return null;

    const parts = s.split('-').filter(Boolean);
    if (parts.length >= 3) {
      const candidate = parts[2];
      if (/^\d{3}$/.test(candidate)) return candidate;
    }

    const allMatches = s.match(/\d{3}/g);
    if (allMatches && allMatches.length) return allMatches[allMatches.length - 1];

    return null;
  }

  function normalizeSize(s) {
    let out = String(s || '')
      .toUpperCase()
      .replace(/^SIZE[:\s]+/, '')
      .replace(/\s+/g, '');

    out = out
      .replace(/[–—]/g, '-')
      .replace(/^(\d{2})-(\d{2})$/, '$1/$2');

    // extern XXL ↔ 2XL
    if (out === 'XXL') out = '2XL';
    return out;
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

    const n1 = normalizeSize(raw);
    if (n1) set.add(n1);

    if (SIZE_ALIAS[raw]) set.add(SIZE_ALIAS[raw]);
    if (SIZE_ALIAS[ns])  set.add(SIZE_ALIAS[ns]);
    if (SIZE_ALIAS[n1])  set.add(SIZE_ALIAS[n1]);

    if (raw.includes('/')) {
      raw.split('/').map(s => s.trim()).forEach(x => {
        if (!x) return;
        set.add(x);
        set.add(x.replace(/\s+/g,''));
        const nx = normalizeSize(x);
        if (nx) set.add(nx);
        if (SIZE_ALIAS[x])  set.add(SIZE_ALIAS[x]);
        if (SIZE_ALIAS[nx]) set.add(SIZE_ALIAS[nx]);
      });
    }
    return Array.from(set);
  }

  // =========================
  // jsonConfig extraction (pure parsing)
  // =========================
  function extractAllJsonConfigsFromHtml(html) {
    const configs = [];
    const re1 = /"jsonConfig":\s*(\{[\s\S]*?\}),\s*['"]jsonSwatchConfig['"]/g;
    const re2 = /jsonConfig:\s*(\{[\s\S]*?\}),\s*jsonSwatchConfig/g;

    for (const re of [re1, re2]) {
      let m;
      while ((m = re.exec(String(html || ''))) !== null) {
        try { configs.push(JSON.parse(m[1])); } catch {}
      }
    }
    return configs;
  }

  // =========================
  // INDEX BUILDER (scan /dames -> /heren)
  // =========================
  let RJ_INDEX_PROMISE = null;

  function makeEmptyIndex() {
    return {
      byBase: new Map(), // baseSku -> { jsonConfig, sourceUrl, path, page }
    };
  }

  function addConfigToIndex(index, cfg, meta) {
    const skus = cfg?.skus || {};
    const bases = new Set();

    Object.values(skus).forEach(fullSku => {
      const base = toBaseSku(fullSku);
      if (base) bases.add(base);
    });

    let added = 0;
    for (const base of bases) {
      if (!index.byBase.has(base)) {
        index.byBase.set(base, {
          jsonConfig: cfg,
          sourceUrl: meta.url,
          path: meta.path,
          page: meta.page
        });
        added++;
      }
    }
    return added;
  }

  function pLimit(n) {
    const q = [];
    let a = 0;

    const next = () => {
      if (a >= n || !q.length) return;
      a++;
      const job = q.shift();
      job.fn().then(job.resolve, job.reject).finally(() => { a--; next(); });
    };

    return (fn) => new Promise((resolve, reject) => {
      q.push({ fn, resolve, reject });
      next();
    });
  }

  async function buildRjIndexOnce() {
    if (RJ_INDEX_PROMISE) return RJ_INDEX_PROMISE;

    RJ_INDEX_PROMISE = (async () => {
      const index = makeEmptyIndex();

      // scan /dames then /heren; stop per path zodra pagina zonder jsonConfig
      const paths = ['/dames', '/heren'];
      const limiter = pLimit(INDEX_CONCURRENCY);

      // we scannen per path sequentieel, maar pagina's binnen path gecontroleerd
      for (const path of paths) {
        let stop = false;

        const pageJobs = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const url = `${RJ_BASE}${path}?p=${page}&product_list_limit=${LIST_LIMIT}`;

          pageJobs.push(limiter(async () => {
            if (stop) return { path, page, url, stop: true };

            let res;
            try { res = await httpGetText(url); }
            catch { return { path, page, url, error: true }; }

            if (isNotFoundHttp(res.status)) return { path, page, url, error: true, notFound: true };
            if (!(res.status >= 200 && res.status < 300)) return { path, page, url, error: true };

            const configs = extractAllJsonConfigsFromHtml(res.text);
            if (!configs.length) return { path, page, url, empty: true };

            let basesAddedTotal = 0;
            for (const cfg of configs) basesAddedTotal += addConfigToIndex(index, cfg, { path, page, url });

            return { path, page, url, basesAdded: basesAddedTotal, configsFound: configs.length };
          }));
        }

        // consume in order; zodra we een empty zien: stop deze path
        // (parallel jobs kunnen al lopen; dat is oké — index blijft correct)
        const results = await Promise.all(pageJobs);

        for (const r of results.sort((a,b) => (a.page||0) - (b.page||0))) {
          if (r?.empty) { stop = true; break; }
        }
      }

      return index;
    })();

    return RJ_INDEX_PROMISE;
  }

  // =========================
  // jsonConfig -> variants (pure parsing + kleurfilter)
  // =========================
  function buildVariantsFromJsonConfig(jsonConfig, supplierPid) {
    const attrs        = jsonConfig?.attributes || {};
    const optionPrices = jsonConfig?.optionPrices || {};
    const skus         = jsonConfig?.skus || {};
    const indexMap     = jsonConfig?.index || {};

    let sizeAttrId  = null;
    let sizeAttr    = null;
    let colorAttrId = null;
    let colorAttr   = null;

    for (const [attrId, attr] of Object.entries(attrs)) {
      const code  = String(attr?.code || '').toLowerCase();
      const label = String(attr?.label || '').toLowerCase();

      if (!sizeAttr && (code === 'size' || label === 'size' || label.includes('maat'))) {
        sizeAttrId = String(attrId);
        sizeAttr = attr;
      }
      if (!colorAttr && (code === 'color' || label === 'color' || label.includes('kleur'))) {
        colorAttrId = String(attrId);
        colorAttr = attr;
      }
    }

    if (!sizeAttrId || !sizeAttr) throw new Error('TARGET_NOT_FOUND');

    const valueToSizeLabel = {};
    for (const opt of sizeAttr.options || []) valueToSizeLabel[String(opt.id)] = opt.label || '';

    const colorSuffix = deriveColorSuffix(supplierPid);
    let targetColorValueIndex = null;

    if (colorSuffix && colorAttr && Array.isArray(colorAttr.options)) {
      for (const opt of colorAttr.options) {
        const lbl = String(opt.label || '').trim();
        if (lbl && lbl.includes(colorSuffix)) { targetColorValueIndex = String(opt.id); break; }
      }
    }

    const variants = [];
    const seenSizeKey = new Set();

    for (const [simpleId, attrValues] of Object.entries(indexMap)) {
      const sizeValueIndex = attrValues?.[sizeAttrId];
      if (!sizeValueIndex) continue;

      if (targetColorValueIndex && colorAttrId) {
        const colorVal = attrValues?.[colorAttrId];
        if (String(colorVal) !== String(targetColorValueIndex)) continue;
      }

      const sizeLabel = valueToSizeLabel[String(sizeValueIndex)] || '';
      const sizeKey = normalizeSize(sizeLabel);
      if (!sizeKey) continue;

      const priceInfo = optionPrices?.[simpleId] || {};
      const qty = Number(
        priceInfo.qty != null ? priceInfo.qty : (priceInfo.stock != null ? priceInfo.stock : 0)
      ) || 0;

      const sku = skus?.[simpleId] || '';

      if (seenSizeKey.has(sizeKey)) continue;
      seenSizeKey.add(sizeKey);

      variants.push({ id: simpleId, sku, sizeLabel, sizeKey, remoteQty: qty });
    }

    return variants;
  }

  function buildQtyMapFromVariants(variants) {
    // sizeKey(alias) -> remoteQty (max)
    const map = {};

    const add = (sizeKey, qty) => {
      const clean = normalizeSize(sizeKey);
      if (!clean) return;

      for (const k of aliasCandidates(clean)) {
        const kk = normalizeSize(k);
        if (!kk) continue;
        map[kk] = Math.max(Number(map[kk] || 0), Number(qty || 0));
      }
    };

    for (const v of variants) add(v.sizeKey || v.sizeLabel, Number(v.remoteQty) || 0);
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
  // ✅ Apply via StockRules + reconcile, mark via Core
  // =========================
  function applyCompareAndMark(localRows, qtyMap, maxCap) {
    const report = [];
    let firstMut = null;

    for (const { tr } of localRows) Core.clearRowMarks(tr);

    for (const { tr, maat, local } of localRows) {
      const remoteQty = resolveRemoteQty(qtyMap, maat);
      if (typeof remoteQty !== 'number') continue;

      const target = SR.mapRemoteToTarget(BRAND_KEY, remoteQty, maxCap);
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

  function bepaalStatus(report, qtyMap) {
    if (!qtyMap || Object.keys(qtyMap).length === 0) return 'niet-gevonden';
    const diffs = report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
    return diffs === 0 ? 'ok' : 'afwijking';
  }

  // =========================
  // perTable
  // =========================
  async function perTable(table, index) {
    const supplierPid = String(table.id || '').trim();
    const label = table.querySelector('thead th[colspan]')?.textContent?.trim() || supplierPid || 'onbekend';
    const anchorId = supplierPid || label || getSkuFromTable(table);

    if (!supplierPid) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const baseSku = baseFromSupplierPid(supplierPid);

    const hit = index.byBase.get(baseSku);
    if (!hit?.jsonConfig) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    let variants;
    try {
      variants = buildVariantsFromJsonConfig(hit.jsonConfig, supplierPid);
    } catch {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const qtyMap = buildQtyMapFromVariants(variants);
    if (!qtyMap || Object.keys(qtyMap).length === 0) {
      Logger.status(anchorId, 'niet-gevonden');
      Logger.perMaat(anchorId, []);
      return 0;
    }

    const localRows = readLocalTable(table);
    const maxCap = getMaxCap(table);

    const report = applyCompareAndMark(localRows, qtyMap, maxCap);
    Logger.status(anchorId, bepaalStatus(report, qtyMap));
    Logger.perMaat(anchorId, report);

    return report.filter(r => r.status === 'bijboeken' || r.status === 'uitboeken').length;
  }

  // =========================
  // Run
  // =========================
  async function run(btn) {
  // 👇 directe feedback
  btn.disabled = true;
  btn.dataset.busy = '1';
  btn.textContent = '⏳ Indexeren RJ…';

  try {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    // 1) indexeren
    let index;
    try {
      index = await buildRjIndexOnce();
    } catch (e) {
      console.error('[VCP2|RJ] index build error:', e);
      Logger.status('RJ', 'afwijking');
      return;
    }

    // label updaten zodra index klaar is
    btn.textContent = '🔍 Check Stock | RJ Bodywear';

    // 2) vergelijken
    await Core.runTables({
      btn,
      tables,
      concurrency: TABLE_CONCURRENCY,
      perTable: (t) => perTable(t, index)
    });

  } finally {
    // 👇 altijd resetten
    btn.disabled = false;
    btn.dataset.busy = '0';
    btn.textContent = '🔍 Check Stock | RJ Bodywear';
  }
}

  // =========================
  // UI: leverancier-keuze
  // =========================
  function isRjSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return false;
    const val = norm(sel.value || '');
    const txt = norm(sel.options[sel.selectedIndex]?.text || '');
    const blob = `${val} ${txt}`;
    return /\brj\b/i.test(blob) || /rj\s*bodywear/i.test(blob);
  }

  // -----------------------
  // UI (Core.mountSupplierButton)
  // -----------------------
  Core.mountSupplierButton({
    id: 'vcp2-rj-btn',
    text: '🔍 Check Stock | RJ Bodywear',
    right: 250,
    top: 8,
    match: () => isRjSelected(),
    onClick: (btn) => run(btn),
  });

})();
