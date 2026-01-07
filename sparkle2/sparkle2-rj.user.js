// ==UserScript==
// @name         EAN Scraper | RJ Bodywear
// @namespace    https://dutchdesignersoutlet.nl/
// @version      0.59
// @description  Haal RJ Bodywear stock én EAN via supplier PID + Google Sheet en vul #tabs-3 in (DDO admin). Hotkey: Ctrl+Shift+R + autosave.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        GM_xmlhttpRequest
// @connect      b2b.rjbodywear.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @run-at       document-end
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle2-rj.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle2-rj.user.js
// ==/UserScript==

(() => {
  'use strict';

  console.log('[EAN Scraper | RJ] Userscript geladen v0.59');

  // ---------- Config ----------

  const RJ_BASE = 'https://b2b.rjbodywear.com';

  const TABLE_SELECTOR        = '#tabs-3 table.options';
  const PID_SELECTOR          = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR  = '#tabs-1 #select2-brand-container';
  const HOTKEY = { ctrl: true, shift: true, alt: false, key: 'r' };

  const BTN_ID = 'rj-ean-btn';

  // Google Sheet RJ-tab
  const RJ_SHEET_ID  = '1JChA4mI3mliqrwJv1s2DLj-GbkW06FWRehwCL44dF68';
  const RJ_SHEET_GID = '927814391'; // tab voor RJ
  let   rjEanCache   = null;        // cache Map voor EAN’s

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Helpers algemeen ----------

  function httpGetText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            return reject(new Error(`HTTP ${res.status} for ${url}`));
          }
          resolve(res.responseText);
        },
        onerror: () => reject(new Error('Network error: ' + url)),
        ontimeout: () => reject(new Error('Timeout: ' + url))
      });
    });
  }

  function normalizeSize(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/^SIZE[:\s]+/, '')  // "Size: M" → "M"
      .replace(/\s+/g, '');
  }

  // base 12-123-123 uit bv. 12-123-123-X of 12-123-123-201
  function baseFromSupplierPid(pid) {
    const s = String(pid || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    return s;
  }

  // base 12-123-123 uit bv. 12-123-123-S / 12-123-123-XL
  function toBaseSku(skuRaw) {
    const s = String(skuRaw || '').trim();
    if (!s) return '';
    const parts = s.split('-');
    if (parts.length >= 3) return parts.slice(0, 3).join('-');
    return s;
  }

  // kleur-suffix uit Supplier PID
  // 32-042-229       → "229"
  // 31-008-201-X     → "201"
  function deriveColorSuffix(pid) {
    const s = String(pid || '').trim();
    if (!s) return null;

    const parts = s.split('-').filter(Boolean);

    // Case 1: 32-042-229 → derde blok als 3 cijfers
    if (parts.length >= 3) {
      const candidate = parts[2];
      if (/^\d{3}$/.test(candidate)) {
        return candidate;
      }
    }

    // Fallback: laatste 3-cijferige blok in de string
    const allMatches = s.match(/\d{3}/g);
    if (allMatches && allMatches.length) {
      return allMatches[allMatches.length - 1];
    }

    return null;
  }

  // mapping remote stock → DDO stock
  function mapRemoteToLocalStock(remoteQty, _localBefore = 0) {
    const n = Number(remoteQty) || 0;

    if (n <= 0) return 1; // leverancier 0 → toch 1 in DDO
    if (n <= 2) return 1; // 1–2
    if (n === 3) return 2; // 3
    if (n === 4) return 3; // 4
    if (n > 4)  return 5;  // >4

    return 1;
  }

  function clickUpdateProductButton() {
    const btn =
      document.querySelector('input[type="submit"][name="edit"]') ||
      document.querySelector('button[name="edit"]');
    if (!btn) {
      console.warn('[EAN Scraper | RJ] Geen save-knop gevonden');
      return false;
    }
    console.log('[EAN Scraper | RJ] Autosave: klik op "Update product".');
    btn.click();
    return true;
  }

  function isTab3Active() {
    const headerActive = document.querySelector(
      '#tabs .ui-tabs-active a[href="#tabs-3"], ' +
      '#tabs .active a[href="#tabs-3"], ' +
      '#tabs li.current a[href="#tabs-3"]'
    );
    if (headerActive) return true;
    const panel = document.getElementById('tabs-3');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.height !== '0px';
  }

  function hasTable() {
    return !!$(TABLE_SELECTOR);
  }

  function getBrandTitle() {
    const c = $(BRAND_TITLE_SELECTOR);
    const titleAttr = c?.getAttribute('title') || '';
    const text      = c?.textContent || '';
    const selectText =
      $('#tabs-1 select[name="brand"] option:checked')?.textContent || '';
    return (titleAttr || text || selectText || '').replace(/\u00A0/g, ' ').trim();
  }

  function isRjBrand() {
    const t = getBrandTitle().toLowerCase();
    if (!t) return false;
    return t.includes('rj');
  }

  function getStartPathForBrand() {
    const t = getBrandTitle().toLowerCase();
    // RJ Bodywear Men → heren
    if (t.includes('men') || t.includes('heren')) {
      return '/heren';
    }
    // RJ Bodywear → dames
    return '/dames';
  }

  // ---------- RJ: jsonConfig uit categoriepagina ----------

  function extractAllJsonConfigsFromHtml(html) {
    const configs = [];

    // Variant 1: "jsonConfig": { ... }, "jsonSwatchConfig"
    const re1 = /"jsonConfig":\s*(\{[\s\S]*?\}),\s*['"]jsonSwatchConfig['"]/g;
    // Variant 2: jsonConfig: { ... }, jsonSwatchConfig
    const re2 = /jsonConfig:\s*(\{[\s\S]*?\}),\s*jsonSwatchConfig/g;

    for (const re of [re1, re2]) {
      let m;
      while ((m = re.exec(html)) !== null) {
        try {
          const cfg = JSON.parse(m[1]);
          configs.push(cfg);
        } catch (e) {
          console.warn('[EAN Scraper | RJ] JSON parse error in jsonConfig-blok:', e);
        }
      }
    }

    console.log('[EAN Scraper | RJ] extractAllJsonConfigsFromHtml →', configs.length, 'configs');
    return configs;
  }

  function findMatchingConfigForBase(baseSku, configs) {
    baseSku = String(baseSku || '').trim();
    if (!baseSku) return null;

    for (const cfg of configs) {
      const skus = cfg.skus || {};
      for (const fullSku of Object.values(skus)) {
        const base = toBaseSku(fullSku);
        if (base === baseSku) {
          return cfg;
        }
      }
    }
    return null;
  }

  /**
   * Loop categoriepagina's in /dames of /heren af en zoek een jsonConfig
   * waarvan een SKU dezelfde base heeft als baseFromSupplierPid(supplierPid).
   */
  async function findJsonConfigForSupplierPid(supplierPid, maxPages = 50) {
    const baseSku = baseFromSupplierPid(supplierPid);
    if (!baseSku) {
      console.warn('[EAN Scraper | RJ] Geen geldige baseSku uit supplierPid:', supplierPid);
      return null;
    }

    const startPath = getStartPathForBrand();
    console.log('[EAN Scraper | RJ] Zoek baseSku', baseSku, 'in categorie', startPath);

    for (let page = 1; page <= maxPages; page++) {
      const url = `${RJ_BASE}${startPath}?p=${page}&product_list_limit=36`;
      console.log('[EAN Scraper | RJ] Categoriepagina', page, url);

      const html = await httpGetText(url);
      const configs = extractAllJsonConfigsFromHtml(html);

      if (!configs.length) {
        console.log('[EAN Scraper | RJ] Geen jsonConfig-blokken meer gevonden op deze pagina → stop.');
        break;
      }

      const matchCfg = findMatchingConfigForBase(baseSku, configs);
      if (matchCfg) {
        console.log('[EAN Scraper | RJ] MATCH gevonden voor baseSku', baseSku, 'op categoriepagina', url);
        return {
          productUrl: url,
          jsonConfig: matchCfg
        };
      }
    }

    console.warn('[EAN Scraper | RJ] Geen match gevonden voor baseSku', baseSku, 'na categorie-loop.');
    return null;
  }

  // ---------- Google Sheet → EAN-map (NIET inhoudelijk gewijzigd) ----------

  async function fetchRjEanMap() {
    if (rjEanCache) {
      return rjEanCache;
    }
    if (!RJ_SHEET_ID) {
      console.warn('[EAN Scraper | RJ] RJ_SHEET_ID niet ingevuld → geen EAN\'s beschikbaar.');
      rjEanCache = new Map();
      return rjEanCache;
    }

    const url = `https://docs.google.com/spreadsheets/d/${RJ_SHEET_ID}/export?format=tsv&gid=${RJ_SHEET_GID}`;
    console.log('[EAN Scraper | RJ] Haal RJ EAN-sheet op:', url);

    const tsv = await httpGetText(url);
    const lines = tsv.split(/\r?\n/);
    const map = new Map();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const cells = line.split('\t');
      // We verwachten SupplierID in kolom A en EAN in kolom H
      if (cells.length < 8) continue;

      const supplierIdRaw = String(cells[0] || '').trim();
      const ean = String(cells[7] || '').trim();

      // Skip header of lege rijen
      if (!supplierIdRaw || /^supplierid/i.test(supplierIdRaw)) continue;
      if (!ean) continue;

      const parts = supplierIdRaw.split('-');
      if (parts.length < 4) continue;

      // 30-018-007-L → base = 30-018-007, sizePart = L
      const base = parts.slice(0, 3).join('-');
      const sizePart = parts.slice(3).join('-'); // voor het geval maat iets geks heeft
      const sizeKey = normalizeSize(sizePart);

      if (!base || !sizeKey) continue;

      const key = `${base}|${sizeKey}`;
      if (!map.has(key)) {
        map.set(key, ean);
      }
    }

    console.log('[EAN Scraper | RJ] EAN-map geladen, entries:', map.size);
    rjEanCache = map;
    return map;
  }

  async function attachEansToVariants(variants, supplierPid) {
    const baseSku = baseFromSupplierPid(supplierPid);
    if (!baseSku) {
      console.warn('[EAN Scraper | RJ] Geen baseSku, sla EAN-koppeling over.');
      return variants;
    }

    const eanMap = await fetchRjEanMap();

    for (const v of variants) {
      if (!v.sizeKey) continue;
      const key = `${baseSku}|${v.sizeKey}`;
      const ean = eanMap.get(key);
      if (ean) {
        v.ean = ean;
      }
    }

    // ---- extra logging: EAN-missers ----
    const total   = variants.length;
    const withEan = variants.filter(v => v.ean && String(v.ean).trim()).length;
    const without = total - withEan;

    if (without > 0) {
      const missingSizes = variants
        .filter(v => !v.ean)
        .map(v => v.sizeLabel || v.sizeKey || '?');
      console.warn(
        `[EAN Scraper | RJ] Geen EAN-match voor ${without}/${total} varianten. Maten zonder EAN:`,
        missingSizes.join(', ')
      );
    } else if (total > 0) {
      console.log('[EAN Scraper | RJ] EAN-match voor alle varianten.');
    }

    console.log('[EAN Scraper | RJ] Variants na EAN-koppeling:', variants);
    return variants;
  }

  // ---------- jsonConfig → varianten (met kleurfilter) ----------

  function buildVariantsFromJsonConfig(jsonConfig, supplierPid) {
    const attrs        = jsonConfig.attributes || {};
    const optionPrices = jsonConfig.optionPrices || {};
    const skus         = jsonConfig.skus || {};
    const indexMap     = jsonConfig.index || {};

    let sizeAttrId  = null;
    let sizeAttr    = null;
    let colorAttrId = null;
    let colorAttr   = null;

    // size + color attribute detecteren
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

    // Kleurfilter met suffix uit supplierPid
    const colorSuffix = deriveColorSuffix(supplierPid);
    let targetColorValueIndex = null;

    if (colorSuffix && colorAttr && Array.isArray(colorAttr.options)) {
      for (const opt of colorAttr.options) {
        const lbl = String(opt.label || '').trim();
        if (!lbl) continue;
        if (lbl.includes(colorSuffix)) {
          targetColorValueIndex = String(opt.id);
          console.log('[EAN Scraper | RJ] Kleurmatch voor suffix', colorSuffix, '→', lbl, '(id', targetColorValueIndex, ')');
          break;
        }
      }
      if (!targetColorValueIndex) {
        console.warn('[EAN Scraper | RJ] Geen kleurmatch gevonden voor suffix', colorSuffix, '→ geen kleurfilter toegepast.');
      }
    }

    const variants = [];
    const seenSizeKey = new Set();

    for (const [simpleId, attrValues] of Object.entries(indexMap)) {
      const sizeValueIndex = attrValues[sizeAttrId];
      if (!sizeValueIndex) continue;

      // kleurfilter (indien targetColorValueIndex gevonden)
      if (targetColorValueIndex && colorAttrId) {
        const colorVal = attrValues[colorAttrId];
        if (String(colorVal) !== String(targetColorValueIndex)) {
          continue; // andere kleur → skip
        }
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

      if (seenSizeKey.has(sizeKey)) {
        continue;
      }
      seenSizeKey.add(sizeKey);

      variants.push({
        id: simpleId,
        sku,
        sizeLabel,
        sizeKey,
        stockLevel: qty,
        ean: '' // wordt later gevuld via Google Sheet
      });
    }

    console.log('[EAN Scraper | RJ] Variants uit jsonConfig (na kleurfilter, vóór EAN):', variants);
    return variants;
  }

  // ---------- Toepassen in DDO ----------

  function applyToDdoTable(variants) {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) {
      console.warn('[EAN Scraper | RJ] Geen #tabs-3 table.options gevonden');
      return 0;
    }

    const varMap = new Map();
    for (const v of variants) {
      if (!v.sizeKey) continue;
      if (!varMap.has(v.sizeKey)) {
        varMap.set(v.sizeKey, v);
      }
    }

    const rows = $$('tbody tr', table);
    const report = [];
    let changed = 0;

    rows.forEach((row, idx) => {
      const sizeInput = row.querySelector('td input.product_option_small');
      if (!sizeInput) return;

      const sizeRaw  = sizeInput.value || '';
      const sizeNorm = normalizeSize(sizeRaw);
      if (!sizeNorm) return;

      const stockInput =
        row.querySelector('input[name^="options"][name$="[stock]"]') ||
        row.querySelector('input[name*="[stock]"]') ||
        row.querySelector('input[name*="stock"]');

      const eanInput = row.querySelector(
        'input[name^="options"][name$="[barcode]"], ' +
        'input[name*="[ean]"], input[name*="ean"]'
      );

      const variant = varMap.get(sizeNorm);

      if (!variant) {
        report.push({
          row: idx,
          size: sizeRaw,
          match: 'geen variant',
          remoteQty: 0,
          mappedStock: '(nvt)',
          ean: ''
        });
        return;
      }

      const remoteQty   = variant.stockLevel || 0;
      const mappedStock = mapRemoteToLocalStock(remoteQty, 0);
      const ean         = variant.ean ? String(variant.ean).trim() : '';

      let rowChanged = false;

      if (stockInput) {
        const newStock = String(mappedStock);
        console.log(
          `[EAN Scraper | RJ] rij ${idx} maat ${sizeRaw}: stock = ${remoteQty} → mapped ${newStock}`
        );
        stockInput.value = newStock;
        stockInput.dispatchEvent(new Event('input', { bubbles: true }));
        rowChanged = true;
      } else {
        console.warn(
          `[EAN Scraper | RJ] rij ${idx} maat ${sizeRaw}: géén stockInput gevonden`
        );
      }

      if (eanInput && ean) {
        console.log(
          `[EAN Scraper | RJ] rij ${idx} maat ${sizeRaw}: EAN = ${ean}`
        );
        eanInput.value = ean;
        eanInput.dispatchEvent(new Event('input', { bubbles: true }));
        rowChanged = true;
      } else if (!eanInput) {
        console.warn(
          `[EAN Scraper | RJ] rij ${idx} maat ${sizeRaw}: géén eanInput gevonden`
        );
      }

      if (rowChanged) {
        changed++;
        const oldBg = row.style.backgroundColor;
        row.style.transition = 'background-color .4s';
        row.style.backgroundColor = '#d4edda';
        setTimeout(() => {
          row.style.backgroundColor = oldBg || '';
        }, 1500);
      }

      report.push({
        row: idx,
        size: sizeRaw,
        match: 'OK',
        remoteQty,
        mappedStock,
        ean
      });
    });

    console.groupCollapsed('[EAN Scraper | RJ] Resultaat per maat (DDO na mapping)');
    console.table(report);
    console.groupEnd();

    console.log('[EAN Scraper | RJ] Aantal rijen overschreven:', changed);
    return changed;
  }

  // ---------- Button loading-state ----------

  function setButtonLoading(isLoading) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    if (isLoading) {
      if (!btn.dataset.originalText) {
        btn.dataset.originalText = btn.textContent || '⛏️ Stock | RJ Bodywear';
      }
      btn.textContent = '⛏️ Bezig met scrapen...';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    } else {
      btn.textContent = btn.dataset.originalText || '⛏️ Stock | RJ Bodywear';
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  // ---------- Hoofdactie ----------

  async function runRjScrape(autoSave) {
    let loadingSet = false;

    try {
      if (!isRjBrand()) {
        console.warn('[EAN Scraper | RJ] Merk is geen RJ Bodywear → abort.');
        return;
      }

      if (!isTab3Active()) {
        console.warn('[EAN Scraper | RJ] Tab #tabs-3 niet actief → abort.');
        return;
      }

      if (!hasTable()) {
        console.warn('[EAN Scraper | RJ] Geen maten/opties tabel gevonden → abort.');
        return;
      }

      const pidInput = $(PID_SELECTOR);
      const supplierPid = pidInput && pidInput.value ? pidInput.value.trim() : '';
      if (!supplierPid) {
        console.warn('[EAN Scraper | RJ] Geen Supplier PID op tab 1 → abort.');
        return;
      }

      // nu gaan we écht scrapen → button op "bezig"
      setButtonLoading(true);
      loadingSet = true;

      console.log('[EAN Scraper | RJ] Start voor Supplier PID:', supplierPid);

      const match = await findJsonConfigForSupplierPid(supplierPid, 50);
      if (!match) {
        console.warn('[EAN Scraper | RJ] Geen passende jsonConfig gevonden voor PID', supplierPid);
        return;
      }

      const sourceUrl = match.productUrl;
      console.log('[EAN Scraper | RJ] Bronpagina (categorie):', sourceUrl);

      let variants = buildVariantsFromJsonConfig(match.jsonConfig, supplierPid);
      variants = await attachEansToVariants(variants, supplierPid);

      // korte summary: #sizes | % EAN
      const totalSizes = variants.length;
      const withEan    = variants.filter(v => v.ean && String(v.ean).trim()).length;
      const pctEan     = totalSizes ? Math.round((withEan / totalSizes) * 100) : 0;

      console.log(
        `[EAN Scraper | RJ] Resultaat: ${totalSizes} sizes | ${withEan}/${totalSizes} (${pctEan}%) met EAN`
      );

      console.group('[EAN Scraper | RJ] Scrape-varianten (bron RJ)');
      console.log('[EAN Scraper | RJ] Bronpagina voor mapping:', sourceUrl);
      console.table(
        variants.map(v => ({
          size: v.sizeLabel,
          sizeKey: v.sizeKey,
          remoteQty: v.stockLevel,
          ean: v.ean || ''
        }))
      );
      console.groupEnd();

      const changed = applyToDdoTable(variants);

      console.log(
        `[EAN Scraper | RJ] Klaar: ${changed} rijen overschreven voor PID ${supplierPid}`
      );

      if (autoSave && changed > 0) {
        setTimeout(() => {
          clickUpdateProductButton();
        }, 200);
      }

    } catch (e) {
      console.error('[EAN Scraper | RJ] Fout in runRjScrape:', e);
    } finally {
      if (loadingSet) {
        setButtonLoading(false);
      }
    }
  }

  // ---------- Button visibility ----------

  function updateButtonVisibility() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const visible = isRjBrand() && isTab3Active() && hasTable();

    btn.style.display = visible ? '' : 'none';

    if (!hasTable()) {
      btn.title = 'Wachten tot #tabs-3 geladen is...';
    } else if (!isTab3Active()) {
      btn.title = 'Ga naar tab Maten/Opties (#tabs-3).';
    } else if (!isRjBrand()) {
      btn.title = 'Button alleen zichtbaar bij RJ Bodywear-merken.';
    } else {
      btn.title = 'Haalt stock + EAN uit RJ B2B en Google Sheet.\nHotkey: Ctrl+Shift+R (met autosave).';
    }
  }

  // ---------- Hotkey (Ctrl+Shift+R) ----------

  function onKeydown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
      return;
    }

    const key = (e.key || '').toLowerCase();
    const match =
      key === HOTKEY.key &&
      !!e.ctrlKey === HOTKEY.ctrl &&
      !!e.shiftKey === HOTKEY.shift &&
      !!e.altKey === HOTKEY.alt;

    if (!match) return;
    if (!isTab3Active()) return;
    if (!isRjBrand()) return;

    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.style.display === 'none' || btn.disabled) return;

    e.preventDefault();
    console.log('[EAN Scraper | RJ] Hotkey Ctrl+Shift+R');
    runRjScrape(true);
  }

  // ---------- Knop ----------

  function addButton() {
    if (!document.body) return;
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '⛏️ Stock | RJ Bodywear';
    btn.style.cssText = `
      position: fixed;
      right: 10px;
      top: 10px;
      z-index: 999999;
      padding: 8px 10px;
      background: #152e4f;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,.15);
      font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    btn.addEventListener('click', () => runRjScrape(false));
    document.body.appendChild(btn);

    updateButtonVisibility();
  }

  function boot() {
    addButton();
    document.addEventListener('keydown', onKeydown);
    setInterval(updateButtonVisibility, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
