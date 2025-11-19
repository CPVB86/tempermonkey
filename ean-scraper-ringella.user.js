// ==UserScript==
// @name         EAN Scraper | Ringella
// @version      1.6
// @description  Haal EAN's + stock uit Ringella XLSX o.b.v. Supplier PID (kolom H) en maat (E) en plak ze in #tabs-3.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scraper-ringella.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/ean-scraper-ringella.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ean-ringella-scraper-btn';
  const TABLE_SELECTOR = '#tabs-3 table.options';
  const PID_SELECTOR = '#tabs-1 input[name="supplier_pid"]';
  const BRAND_TITLE_SELECTOR = '#tabs-1 #select2-brand-container';

  // Ringella XLSX bron
  const XLSX_URL = 'https://www.ringella.com/out/downloads/uploads/Ueberhangliste_Sofort_Excel.xlsx';

  // Kolommen in Ringella stocklijst:
  // A = 0 (Nr)
  // B = 1 (Bezeichnung)
  // C = 2 (farbe)
  // D = 3 (farb_bez)
  // E = 4 (groesse)
  // F = 5 (freies_Lager)
  // G = 6 (freier_Verkauf)
  // H = 7 (Artikel.Nr+barcodes.farbe)  ← sleutel voor PID
  // I = 8 (barcode / EAN)
  const SIZE_COL_INDEX = 4;
  const FREE_COL_INDEX = 6;
  const PID_COL_INDEX  = 7;
  const EAN_COL_INDEX  = 8;

  // Cache: Map<key: "PIDNORM|MAAT", value: { ean: string, stock: number }>
  let EAN_MAP = null;
  let XLSX_LOADING = false;

  // nieuwe key omdat de normalisatie is veranderd
  const CACHE_KEY = 'ringella_ean_map_v2_pidH';

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);

  const SIZE_MAP = { '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL' };
  function normalizeSize(s) {
    if (!s) return '';
    let t = String(s).trim().toUpperCase().replace(/\s+/g, '');
    if (SIZE_MAP[t]) t = SIZE_MAP[t];
    return t;
  }

  const getBrandTitle = () =>
    document.querySelector(BRAND_TITLE_SELECTOR)?.title?.trim() || '';

  function isRingellaBrand() {
    const title = getBrandTitle().toLowerCase();
    return title.includes('ringella');
  }

  function hasTable() {
    return !!document.querySelector(TABLE_SELECTOR);
  }

  // Normaliseer PID: alleen '-' strippen, letters behouden, case-insensitive
  function normalizePid(pid) {
    return String(pid || '')
      .replace(/-/g, '')
      .trim()
      .toUpperCase();
  }

  // Jouw stocklogica: free (G) → 1 / 2 / 3 / 5
  function mapFreeToStockLevel(free) {
    const n = Number(free ?? 0) || 0;

    if (n <= 2) return 1;  // 0, 1 of 2 → 1 stuk
    if (n === 3) return 2; // 2 stuks
    if (n === 4) return 3; // 3 stuks

    return 5;              // 5 of meer
  }

  // ---------- Persistent cache helpers ----------
  function loadCacheFromStorage() {
    try {
      const raw = GM_getValue(CACHE_KEY, null);
      if (!raw) return null;
      const obj = JSON.parse(raw); // { "PIDNORM|MAAT": { ean, stock }, ... }
      const map = new Map(Object.entries(obj));
      console.info('[EAN Scraper | Ringella] Map uit GM-cache:', map.size);
      return map;
    } catch (e) {
      console.warn('[EAN Scraper | Ringella] cache read error', e);
      return null;
    }
  }

  function saveCacheToStorage(map) {
    try {
      const obj = Object.fromEntries(map.entries());
      GM_setValue(CACHE_KEY, JSON.stringify(obj));
      console.info('[EAN Scraper | Ringella] Map opgeslagen in GM-cache:', map.size);
    } catch (e) {
      console.warn('[EAN Scraper | Ringella] cache write error', e);
    }
  }

  // optionele debug helper
  if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.resetRingellaCache = function () {
      EAN_MAP = null;
      GM_setValue(CACHE_KEY, '');
      console.log('[EAN Scraper | Ringella] cache gereset');
    };
  }

  // ---------- XLSX → Map builder ----------
  function buildEanMapFromXlsx(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return new Map();

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const map = new Map();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];

      const rawSize  = row[SIZE_COL_INDEX];                // groesse
      const freeRaw  = row[FREE_COL_INDEX];                // freier_Verkauf
      const rawPidH  = String(row[PID_COL_INDEX] ?? '').trim(); // Artikel.Nr+barcodes.farbe
      const rawEan   = String(row[EAN_COL_INDEX] ?? '').trim(); // barcode

      // Header of lege regels skippen
      if (!rawPidH || !rawSize || !rawEan) continue;
      if (String(row[0] ?? '').trim().toLowerCase() === 'nr') continue;

      const pidNorm   = normalizePid(rawPidH);
      if (!pidNorm) continue;

      const maatNorm   = normalizeSize(rawSize);
      const eanDigits  = rawEan.replace(/\D/g, '');
      const stockLevel = mapFreeToStockLevel(freeRaw);

      if (!maatNorm || !eanDigits) continue;

      const key = `${pidNorm}|${maatNorm}`;
      map.set(key, { ean: eanDigits, stock: stockLevel });
    }

    console.info('[EAN Scraper | Ringella] Map size:', map.size);
    return map;
  }

  // Zoek { ean, stock } op basis van supplierPid (norm) + maat
  function findEanForPidAndSize(eanMap, supplierPid, maat) {
    const pidNorm = normalizePid(supplierPid);  // bv "5511023-226" → "5511023226"
    const maatNorm = normalizeSize(maat);
    if (!pidNorm || !maatNorm) return null;

    const exactKey = `${pidNorm}|${maatNorm}`;
    return eanMap.get(exactKey) || null;
  }

  // ---------- UI button ----------
  function ensureButton() {
    if (!document.body) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.textContent = '📦 EAN+Stock Ringella';
      btn.style.cssText = `
        position: fixed;
        right: 10px;
        top: 90px;
        z-index: 999999;
        padding: 10px 12px;
        background: #8e44ad;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        font: 600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      `;
      document.body.appendChild(btn);
      btn.addEventListener('click', onScrapeClick);
    }

    const isRingella = isRingellaBrand();
    const tableReady = hasTable();

    // Alleen tonen bij merk Ringella
    btn.style.display = isRingella ? '' : 'none';
    if (!isRingella) return;

    btn.disabled = !tableReady;
    btn.style.opacity = tableReady ? '1' : '.55';
    btn.title = tableReady
      ? 'Haal EAN + stock uit Ringella XLSX en plak in #tabs-3'
      : 'Wachten tot #tabs-3 geladen is...';
  }

  // ---------- XLSX laden (met cache: RAM + GM-storage) ----------
  function loadXlsxIfNeeded(btn, callback) {
    // 1) RAM-cache
    if (EAN_MAP instanceof Map && EAN_MAP.size > 0) {
      console.info('[EAN Scraper | Ringella] Gebruik RAM-cache');
      callback();
      return;
    }

    // 2) GM-storage cache
    const cached = loadCacheFromStorage();
    if (cached && cached.size > 0) {
      EAN_MAP = cached;
      callback();
      return;
    }

    // 3) Anders echt downloaden
    if (XLSX_LOADING) {
      console.info('[EAN Scraper | Ringella] XLSX is al aan het laden...');
      return;
    }

    XLSX_LOADING = true;
    btn.disabled = true;
    btn.style.opacity = '.7';
    btn.textContent = '⏳ Ringella XLSX laden...';

    GM_xmlhttpRequest({
      method: 'GET',
      url: XLSX_URL,
      responseType: 'arraybuffer',
      onload: (resp) => {
        try {
          const data = new Uint8Array(resp.response);
          const wb = XLSX.read(data, { type: 'array' });
          EAN_MAP = buildEanMapFromXlsx(wb);
          XLSX_LOADING = false;

          if (!EAN_MAP || EAN_MAP.size === 0) {
            btn.textContent = '❌ Geen EAN-data in XLSX';
            btn.style.backgroundColor = '#e06666';
            setTimeout(resetBtn, 2500);
            return;
          }

          saveCacheToStorage(EAN_MAP);

          btn.textContent = '📦 EAN+Stock Ringella';
          btn.style.backgroundColor = '#8e44ad';
          btn.disabled = false;
          btn.style.opacity = '1';
          callback();
        } catch (err) {
          console.error('[EAN Scraper | Ringella] Fout bij lezen XLSX:', err);
          XLSX_LOADING = false;
          btn.textContent = '❌ Fout bij XLSX';
          btn.style.backgroundColor = '#e06666';
          setTimeout(resetBtn, 2500);
        }
      },
      onerror: (err) => {
        console.error('[EAN Scraper | Ringella] Netwerkfout:', err);
        XLSX_LOADING = false;
        btn.textContent = '❌ XLSX niet bereikbaar';
        btn.style.backgroundColor = '#e06666';
        setTimeout(resetBtn, 2500);
      }
    });
  }

  // ---------- Hoofdactie ----------
  function onScrapeClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;

    loadXlsxIfNeeded(btn, () => {
      try {
        runEanPaster(btn);
      } catch (e) {
        console.error('[EAN Scraper | Ringella] Fout tijdens verwerken:', e);
        btn.textContent = '❌ Fout bij plakken';
        btn.style.backgroundColor = '#e06666';
        setTimeout(resetBtn, 2500);
      }
    });
  }

  function runEanPaster(btn) {
    const supplierPid = document.querySelector(PID_SELECTOR)?.value?.trim();
    if (!supplierPid) {
      btn.textContent = '❌ Geen Supplier PID';
      btn.style.backgroundColor = '#e06666';
      setTimeout(resetBtn, 2500);
      return;
    }

    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) {
      btn.textContent = '❌ #tabs-3 niet klaar';
      btn.style.backgroundColor = '#e06666';
      setTimeout(resetBtn, 2500);
      return;
    }

    const rows = table.querySelectorAll('tr');
    let matched = 0;

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      // maat: eerste product_option_small input in de rij (size)
      const maatInput = cells[0].querySelector('input.product_option_small');
      const maatRaw = maatInput ? maatInput.value : '';
      const maatNorm = normalizeSize(maatRaw);

      // EAN: options[...][barcode]
      const eanInput = row.querySelector('input[name^="options"][name$="[barcode]"]');

      // STOCK: options[...][stock]
      const stockInput = row.querySelector('input[name^="options"][name$="[stock]"]');

      if (!maatNorm || !eanInput) return;

      const entry = findEanForPidAndSize(EAN_MAP, supplierPid, maatNorm);
      if (entry) {
        const { ean, stock } = entry;

        // EAN invullen
        eanInput.value = ean;
        eanInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Stock invullen (alleen als er een input is)
        if (stockInput && Number.isFinite(stock)) {
          stockInput.value = String(stock);
          stockInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        matched++;
      }
    });

    btn.style.backgroundColor = '#2ecc71';
    btn.textContent = `📦 ${matched} rijen (EAN + stock)`;
    console.info(`[EAN Scraper | Ringella] ${matched} rijen ingevuld voor PID ${supplierPid}`);
    setTimeout(resetBtn, 2500);
  }

  function resetBtn() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.style.backgroundColor = '#8e44ad';
    btn.textContent = '📦 EAN+Stock Ringella';
    btn.style.opacity = hasTable() && isRingellaBrand() ? '1' : '.55';
    btn.disabled = !hasTable();
  }

  // ---------- Observer + lifecycle ----------
  const observer = new MutationObserver(() => ensureButton());

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch {}
  }

  window.addEventListener('pageshow', ensureButton);
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureButton();
  });
  window.addEventListener('hashchange', ensureButton);
  window.addEventListener('popstate', ensureButton);

  ensureButton();
  startObserver();
})();
