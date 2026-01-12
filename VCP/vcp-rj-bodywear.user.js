// ==UserScript==
// @name         VCP | RJ Bodywear
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.1
// @description  Vergelijk local stock met RJ Bodywear stock via jsonConfig op categoriepagina’s (dames/heren). Zonder bridge.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      b2b.rjbodywear.com
// @run-at       document-start
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-rj-bodywear.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-rj-bodywear.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');

  if (!ON_TOOL) return;

  // =========================
  // CONFIG
  // =========================
  const RJ_BASE = 'https://b2b.rjbodywear.com';
  const TIMEOUT_MS = 20000;

  // categorie-scan
  const MAX_PAGES = 50;
  const LIST_LIMIT = 36; // zoals je scraper

  // concurrency (tool)
  const CONCURRENCY = 3;

  const uid  = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm = (s = '') => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  // =========================
  // LOGGER (zelfde patroon als Mundo)
  // =========================
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
      else console.info(`[RJ][${id}] status: ${txt}`);
    },
    perMaat(id, report) {
      console.groupCollapsed(`[RJ][${id}] maatvergelijking`);
      try {
        console.table(report.map(r => ({
          maat: r.maat,
          local: r.local,
          remoteQty: Number.isFinite(r.remoteQty) ? r.remoteQty : '—',
          remoteStock: Number.isFinite(r.remoteStock) ? r.remoteStock : '—',
          status: r.actie
        })));
      } finally { console.groupEnd(); }
    }
  };

  // =========================
  // GM fetch helper
  // =========================
  function httpGetText(url, timeout = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let done = false;

      const to = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('Timeout: ' + url));
      }, timeout);

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        onload: (res) => {
          if (done) return;
          done = true;
          clearTimeout(to);

          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status} for ${url}`));
            return;
          }
          resolve(res.responseText);
        },
        onerror: () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          reject(new Error('Network error: ' + url));
        }
      });
    });
  }

  // =========================
  // Size normalization / aliasing
  // (overgenomen stijl uit je scraper + Mundo)
  // =========================
  function normalizeSize(s) {
    let out = String(s || '')
      .toUpperCase()
      .replace(/^SIZE[:\s]+/, '')
      .replace(/\s+/g, '');

    out = out
      .replace(/[–—]/g, '-')
      .replace(/^(\d{2})-(\d{2})$/, '$1/$2');

    // RJ/Tool mismatch: XXL vs 2XL
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
  // PID helpers (zoals scraper)
  // =========================
  function baseFromSupplierPid(pid) {
    const s = String(pid || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    return s;
  }

  function toBaseSku(skuRaw) {
    const s = String(skuRaw || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    return s;
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

  // =========================
  // Stock mapping (VCP: 0 = niet leverbaar)
  // (zelfde schaal als Naturana-like in Mundo)
  // =========================
  function mapRjStockLevel(remoteQty) {
    const n = Number(remoteQty) || 0;
    if (n <= 0) return 0;
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    if (n > 4)  return 5;
    return 0;
  }

  // =========================
  // jsonConfig extraction (zoals scraper)
  // =========================
  function extractAllJsonConfigsFromHtml(html) {
    const configs = [];

    const re1 = /"jsonConfig":\s*(\{[\s\S]*?\}),\s*['"]jsonSwatchConfig['"]/g;
    const re2 = /jsonConfig:\s*(\{[\s\S]*?\}),\s*jsonSwatchConfig/g;

    for (const re of [re1, re2]) {
      let m;
      while ((m = re.exec(html)) !== null) {
        try {
          const cfg = JSON.parse(m[1]);
          configs.push(cfg);
        } catch (e) {
          // ignore per-block parse errors
        }
      }
    }
    return configs;
  }

  function findMatchingConfigForBase(baseSku, configs) {
    baseSku = String(baseSku || '').trim();
    if (!baseSku) return null;

    for (const cfg of configs) {
      const skus = cfg.skus || {};
      for (const fullSku of Object.values(skus)) {
        const base = toBaseSku(fullSku);
        if (base === baseSku) return cfg;
      }
    }
    return null;
  }

  async function findJsonConfigForSupplierPid(supplierPid, maxPages = MAX_PAGES) {
    const baseSku = baseFromSupplierPid(supplierPid);
    if (!baseSku) return null;

    // In VCP weten we niet "men vs dames" uit brand-title, dus: probeer beide.
    const startPaths = ['/dames', '/heren'];

    for (const startPath of startPaths) {
      for (let page = 1; page <= maxPages; page++) {
        const url = `${RJ_BASE}${startPath}?p=${page}&product_list_limit=${LIST_LIMIT}`;
        const html = await httpGetText(url);

        const configs = extractAllJsonConfigsFromHtml(html);
        if (!configs.length) break; // geen jsonConfig meer → stop deze categorie

        const matchCfg = findMatchingConfigForBase(baseSku, configs);
        if (matchCfg) {
          return { productUrl: url, jsonConfig: matchCfg, startPath };
        }
      }
    }

    return null;
  }

  // =========================
  // jsonConfig -> variants (met kleurfilter)
  // =========================
  function buildVariantsFromJsonConfig(jsonConfig, supplierPid) {
    const attrs        = jsonConfig.attributes || {};
    const optionPrices = jsonConfig.optionPrices || {};
    const skus         = jsonConfig.skus || {};
    const indexMap     = jsonConfig.index || {};

    let sizeAttrId  = null;
    let sizeAttr    = null;
    let colorAttrId = null;
    let colorAttr   = null;

    for (const [attrId, attr] of Object.entries(attrs)) {
      const code  = (attr.code || '').toLowerCase();
      const label = (attr.label || '').toLowerCase();

      if (!sizeAttr && (code === 'size' || label === 'size' || label.includes('maat'))) {
        sizeAttrId = String(attrId);
        sizeAttr   = attr;
      }

      if (!colorAttr && (code === 'color' || label === 'color' || label.includes('kleur'))) {
        colorAttrId = String(attrId);
        colorAttr   = attr;
      }
    }

    if (!sizeAttrId || !sizeAttr) {
      throw new Error('Geen size attribute gevonden in jsonConfig.attributes');
    }

    const valueToSizeLabel = {};
    for (const opt of sizeAttr.options || []) {
      valueToSizeLabel[String(opt.id)] = opt.label || '';
    }

    // Kleurfilter: suffix uit PID matchen in color-label
    const colorSuffix = deriveColorSuffix(supplierPid);
    let targetColorValueIndex = null;

    if (colorSuffix && colorAttr && Array.isArray(colorAttr.options)) {
      for (const opt of colorAttr.options) {
        const lbl = String(opt.label || '').trim();
        if (!lbl) continue;
        if (lbl.includes(colorSuffix)) {
          targetColorValueIndex = String(opt.id);
          break;
        }
      }
    }

    const variants = [];
    const seenSizeKey = new Set();

    for (const [simpleId, attrValues] of Object.entries(indexMap)) {
      const sizeValueIndex = attrValues[sizeAttrId];
      if (!sizeValueIndex) continue;

      if (targetColorValueIndex && colorAttrId) {
        const colorVal = attrValues[colorAttrId];
        if (String(colorVal) !== String(targetColorValueIndex)) continue;
      }

      const sizeLabel = valueToSizeLabel[String(sizeValueIndex)] || '';
      const sizeKey   = normalizeSize(sizeLabel);
      if (!sizeKey) continue;

      const priceInfo = optionPrices[simpleId] || {};
      const qty =
        Number(
          priceInfo.qty != null
            ? priceInfo.qty
            : (priceInfo.stock != null ? priceInfo.stock : 0)
        ) || 0;

      const sku = skus[simpleId] || '';

      if (seenSizeKey.has(sizeKey)) continue;
      seenSizeKey.add(sizeKey);

      variants.push({
        id: simpleId,
        sku,
        sizeLabel,
        sizeKey,
        remoteQty: qty
      });
    }

    return variants;
  }

  function buildStatusMapFromVariants(variants) {
    // map keys = allerlei aliasCandidates -> { qty, stockLevel }
    const map = {};

    const add = (sizeKey, qty) => {
      const clean = normalizeSize(sizeKey);
      if (!clean) return;

      const stockLevel = mapRjStockLevel(qty);

      for (const k of aliasCandidates(clean)) {
        const ex = map[k];
        if (!ex) map[k] = { qty, stock: stockLevel };
        else {
          // neem de hoogste qty/stock als er dubbels zijn
          ex.qty = Math.max(ex.qty || 0, qty || 0);
          ex.stock = Math.max(ex.stock || 0, stockLevel || 0);
        }
      }
    };

    variants.forEach(v => add(v.sizeKey || v.sizeLabel, Number(v.remoteQty) || 0));
    return map;
  }

  function resolveRemote(statusMap, label) {
    for (const c of aliasCandidates(label)) if (statusMap[c]) return statusMap[c];
    return undefined;
  }

  // =========================
  // UI markering (zelfde als Mundo)
  // =========================
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
      const maat  = (row.dataset.size || row.children[0]?.textContent || '').trim().toUpperCase();
      const local = parseInt((row.children[1]?.textContent || '').trim(), 10) || 0;

      const remoteEntry = resolveRemote(statusMap, maat);
      const supplierQty = Number(remoteEntry?.qty) || 0;
      const supVal      = Number(remoteEntry?.stock);

      const effAvail = Number.isFinite(supVal) ? supVal > 0 : false;

      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green', 'status-red');
      delete row.dataset.status;

      let actie = 'none';

      if (local > 0 && !effAvail) {
        row.style.background = '#f8d7da';
        row.title = remoteEntry ? 'Uitboeken (leverancier niet op voorraad)' : 'Uitboeken/Negeren (maat onbekend)';
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
        row.title = remoteEntry ? 'Negeren (leverancier niet op voorraad)' : 'Negeren (maat onbekend)';
        actie = 'negeren';
      }

      report.push({
        maat,
        local,
        remoteQty: remoteEntry ? supplierQty : NaN,
        remoteStock: remoteEntry ? supVal : NaN,
        actie
      });
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

  // =========================
  // Concurrency helper (zoals Mundo)
  // =========================
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

  // =========================
  // MAIN runner
  // =========================
  async function runRj(btn) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    const limit = pLimit(CONCURRENCY);
    let idx = 0;
    let totalMut = 0;

    await Promise.all(tables.map(table => limit(async () => {
      const tableId  = (table.id || '').trim();
      const anchorId = tableId || 'onbekend';

      // ✅ AANNAME: table.id = supplierPid
      const supplierPid = tableId;

      if (!supplierPid) {
        Logger.status(anchorId, 'niet-gevonden (geen supplierPid)');
        Logger.perMaat(anchorId, []);
        progress.setDone(++idx);
        return;
      }

      try {
        const match = await findJsonConfigForSupplierPid(supplierPid, MAX_PAGES);
        if (!match || !match.jsonConfig) {
          Logger.status(anchorId, 'niet-gevonden');
          Logger.perMaat(anchorId, []);
          progress.setDone(++idx);
          return;
        }

        const variants = buildVariantsFromJsonConfig(match.jsonConfig, supplierPid);
        const statusMap = buildStatusMapFromVariants(variants);

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
        if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) Logger.status(anchorId, 'afwijking (auth/cookies op RJ tab)');
        else if (msg.includes('Timeout')) Logger.status(anchorId, 'afwijking (timeout)');
        else Logger.status(anchorId, 'afwijking');

        Logger.perMaat(anchorId, []);
      } finally {
        progress.setDone(++idx);
      }
    })));

    progress.success(totalMut);
  }

  // =========================
  // UI mount: leverancier-keuze
  // =========================
  function isRjSelected() {
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return false;
    const val = norm(sel.value || '');
    const txt = norm(sel.options[sel.selectedIndex]?.text || '');
    const blob = `${val} ${txt}`;

    // ruim matchen
    return /\brj\b/i.test(blob) || /rj\s*bodywear/i.test(blob);
  }

  function ensureButton() {
    let btn = document.getElementById('adv-rj-btn');
    if (btn) return btn;

    btn = document.createElement('button');
    btn.id = 'adv-rj-btn';
    btn.className = 'sk-btn';
    btn.type = 'button';
    btn.textContent = 'Check RJ Bodywear Stock';

    Object.assign(btn.style, {
      position: 'fixed',
      top: '8px',
      right: '250px',
      zIndex: '9999',
      display: 'none'
    });

    btn.addEventListener('click', () => runRj(btn));
    document.body.appendChild(btn);
    return btn;
  }

  function maybeMountOrRemove() {
    const hasTables = !!document.querySelector('#output table');
    const need      = isRjSelected();
    const existing  = document.getElementById('adv-rj-btn');

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
