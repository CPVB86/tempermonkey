// ==UserScript==
// @name         Voorraadchecker Proxy - LingaDore
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.2
// @description  Vergelijk local stock met XLSX-stock op EAN — knop/progress via StockKit, badges, logboek.
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @run-at       document-idle
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-lingadore-xlsx-ean.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-lingadore-xlsx-ean.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:   'both',    // 'console' | 'logboek' | 'both' | 'off'
      perMaat:  'console', // console-tabel per rij (EAN)
      debug:    false,
    },
    uiDelayMs: 80,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // XLSX data: Map<EAN (string) -> remoteStock (number)>
  let XLSX_MAP = null;

  // ---------- Logger ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    _on(mode, kind) {
      const m = (CONFIG.LOG[kind] || 'off').toLowerCase();
      return m === mode || m === 'both';
    },
    status(id, txt) {
      const sid = String(id);
      if (this._on('console', 'status')) console.info(`[LingaDore XLSX][${sid}] status: ${txt}`);
      if (this._on('logboek', 'status')) {
        const lb = this.lb();
        if (lb?.resultaat) lb.resultaat(sid, txt);
        else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
          unsafeWindow.voegLogregelToe(sid, txt);
        }
      }
    },
    perMaat(id, report) {
      if (!this._on('console', 'perMaat')) return;
      console.groupCollapsed(`[LingaDore XLSX][${id}] EAN-vergelijking`);
      try {
        const rows = report.map(r => ({
          ean: r.ean,
          local: r.local,
          remote: r.sup,
          status: r.actie,
        }));
        console.table(rows);
      } finally {
        console.groupEnd();
      }
    },
    debug(...a) {
      if (CONFIG.LOG.debug) console.info('[LingaDore XLSX][debug]', ...a);
    }
  };

  // ---------- XLSX parsing ----------
  function hasXlsxData() {
    return XLSX_MAP instanceof Map && XLSX_MAP.size > 0;
  }

  function buildXlsxMap(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) return new Map();

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const map = new Map();

    // r = 2 → rij 3 (0-based)
    for (let r = 2; r <= range.e.r; r++) {
      const eanCell   = sheet[XLSX.utils.encode_cell({ c: 0, r })]; // kolom A = EAN
      const stockCell = sheet[XLSX.utils.encode_cell({ c: 1, r })]; // kolom B = Stock

      const rawEan = eanCell && String(eanCell.v ?? '').trim();
      if (!rawEan) continue;

      // alleen cijfers → EAN
      const eanDigits = rawEan.replace(/\D/g, '');
      if (!eanDigits) continue;

      const stockRaw = stockCell ? stockCell.v : 0;
      const stockNum = Number(stockRaw ?? 0);
      if (!Number.isFinite(stockNum)) continue;

      const ourQty = stockNum; // direct 1-op-1
      map.set(eanDigits, ourQty);
    }

    return map;
  }

  // ---------- Vergelijking / badges ----------
  function setBadge(table, status) {
    const b = window.StockKit?.Badges;
    if (b?.setForTable) { b.setForTable(table, status); return; }
    // fallback
    const th = table.querySelector('thead th[colspan], thead tr:first-child th:last-child, thead th');
    if (!th) return;
    let tag = th.querySelector('.sk-badge');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'sk-badge';
      tag.style.cssText = 'margin-left:8px;padding:2px 6px;border-radius:10px;font-size:12px;vertical-align:middle';
      th.appendChild(tag);
    }
    const palette = {
      'ok':            { bg: '#e7f7ee', fg: '#1b7f44', txt: 'OK' },
      'afwijking':     { bg: '#fff4d6', fg: '#8a6d00', txt: 'Afwijking' },
      'niet-gevonden': { bg: '#fde2e1', fg: '#a11a16', txt: 'Niet gevonden' },
    };
    const p = palette[status] || palette.ok;
    tag.textContent = p.txt; tag.style.background = p.bg; tag.style.color = p.fg;
  }

  // Bepaal kolomindices o.b.v. header
  function getColumnIndices(table) {
    const headerRow = table.querySelector('thead tr:last-child');
    if (!headerRow) return { eanCol: 2, stockCol: 1 }; // fallback op jouw standaard (Size, Stock, EAN)

    const ths = Array.from(headerRow.children);
    let eanCol = -1;
    let stockCol = -1;

    ths.forEach((th, idx) => {
      const txt = (th.textContent || '').trim().toLowerCase();
      if (eanCol === -1 && txt.includes('ean')) eanCol = idx;
      if (stockCol === -1 && (txt.includes('stock') || txt.includes('voorraad'))) stockCol = idx;
    });

    if (eanCol < 0) eanCol = 2;
    if (stockCol < 0) stockCol = 1;

    return { eanCol, stockCol };
  }

  // Vergelijk lokale tabel met XLSX-map op EAN
  function applyRulesAndMarkFromEAN(localTable, eanMap) {
    const { eanCol, stockCol } = getColumnIndices(localTable);
    const rows = localTable.querySelectorAll('tbody tr');
    const report = [];
    let hits = 0;

    rows.forEach(row => {
      const eanCell   = row.children[eanCol];
      const stockCell = row.children[stockCol];

      const rawEanTxt = (eanCell?.textContent || '').trim();
      const eanDigits = rawEanTxt.replace(/\D/g, ''); // alleen cijfers
      const local     = parseInt((stockCell?.textContent || '').trim(), 10) || 0;

      const remoteRaw = eanDigits ? eanMap.get(eanDigits) : undefined;
      const remoteNum = Number(remoteRaw ?? 0);
      const isAvail   = remoteNum > 0;

      if (eanDigits && remoteRaw !== undefined) hits++;

      // reset styles
      row.style.background = '';
      row.style.transition = 'background-color .25s';
      row.title = '';
      row.classList.remove('status-green', 'status-red');
      delete row.dataset.status;

      let actie = 'negeren';
      if (local > 0 && !isAvail) {
        row.style.background = '#f8d7da';
        row.title = `Uitboeken (XLSX: 0 — EAN ${eanDigits || 'onbekend'})`;
        row.dataset.status = 'remove';
        row.classList.add('status-red');
        actie = 'uitboeken';
      } else if (local === 0 && isAvail) {
        row.style.background = '#d4edda';
        row.title = `Bijboeken 2 (XLSX >0 — EAN ${eanDigits || 'onbekend'})`;
        row.dataset.status = 'add';
        row.classList.add('status-green');
        actie = 'bijboeken_2';
      }

      report.push({ ean: eanDigits || rawEanTxt, local, sup: remoteNum, actie });
    });

    return { report, hits };
  }

  function bepaalLogStatus(report, hits) {
    const counts = report.reduce((a, r) => {
      a[r.actie] = (a[r.actie] || 0) + 1;
      return a;
    }, {});
    const remoteLeeg = hits === 0;
    if (remoteLeeg) return 'niet-gevonden';
    if ((counts.uitboeken || 0) === 0 && (counts.bijboeken_2 || 0) === 0) return 'ok';
    return 'afwijking';
  }

  // ---------- UI helpers ----------
  function ensureStockKitCss() {
    if (document.getElementById('stockkit-css')) return;
    const link = document.createElement('link');
    link.id = 'stockkit-css';
    link.rel = 'stylesheet';
    link.href = 'https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
    document.head.appendChild(link);
  }

  function injectDisabledStyle() {
    if (document.getElementById('linga-xlsx-disabled-style')) return;
    const style = document.createElement('style');
    style.id = 'linga-xlsx-disabled-style';
    style.textContent = `
      #check-linga-xlsx-btn[disabled] {
        background: #ccc !important;
        border-color: #bbb !important;
        color: #666 !important;
        cursor: not-allowed !important;
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  function normStr(s){
    return String(s||'')
      .toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu,'')
      .replace(/[_\s-]+/g,'')
      .trim();
  }

  function isLingaSelected(){
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return true; // geen select → toon gewoon
    const v = normStr(sel.value);
    const t = normStr(sel.options[sel.selectedIndex]?.textContent || '');
    // Toestaan: "lingadore" en varianten zoals "linga-dore", "linga dore"
    return v.includes('lingadore') || t.includes('lingadore');
  }

  // ---------- Main run ----------
  async function run(btn) {
    if (!hasXlsxData()) {
      alert('Upload eerst een XLSX-bestand met kolom A = EAN en kolom B = Stock (vanaf rij 3).');
      return;
    }

    if (typeof StockKit === 'undefined' || !StockKit.makeProgress) {
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) {
      alert('Geen tabellen gevonden in #output.');
      return;
    }

    const progress = StockKit.makeProgress(btn);
    progress.start(tables.length);

    let totalMutations = 0;
    let ok = 0;
    let fail = 0;
    let idx = 0;

    for (const table of tables) {
      idx++;
      const headerText = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
      const anchorId   = (table.id || '').trim() || headerText || `table-${idx}`;

      try {
        const { report, hits } = applyRulesAndMarkFromEAN(table, XLSX_MAP);
        const diffs = report.filter(r => r.actie === 'uitboeken' || r.actie === 'bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, hits);
        Logger.status(anchorId, status);
        Logger.perMaat(anchorId, report);
        setBadge(table, status);

        ok++;
      } catch (e) {
        console.error('[LingaDore XLSX] fout:', e);
        Logger.status(anchorId, 'afwijking');
        setBadge(table, 'afwijking');
        fail++;
      }

      progress.setDone(idx);
      await delay(CONFIG.uiDelayMs);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) {
      console.info(
        `[LingaDore XLSX] verwerkt: ${ok + fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`
      );
    }
  }

  // ---------- Toolbar ----------
  function addToolbar() {
    if (document.getElementById('linga-xlsx-toolbar')) return;

    ensureStockKitCss();
    injectDisabledStyle();

    const bar = document.createElement('div');
    bar.id = 'linga-xlsx-toolbar';
    bar.style.cssText = `
      position:fixed;
      top:8px;
      right:298px;
      z-index:9999;
      display:none;
      gap:8px;
      align-items:center;
      font-size:13px;
    `;

    const fileLabel = document.createElement('label');
    fileLabel.textContent = '📄 XLSX:';
    fileLabel.htmlFor = 'linga-xlsx-input';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'linga-xlsx-input';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.maxWidth = '260px';

    const btn = document.createElement('button');
    btn.id = 'check-linga-xlsx-btn';
    btn.className = 'sk-btn';
    btn.textContent = '🔍 Check Stock LingaDore';
    btn.disabled = true;
    btn.title = 'Upload eerst een XLSX-bestand.';

    btn.addEventListener('click', () => run(btn));

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) {
        XLSX_MAP = null;
        btn.disabled = true;
        btn.title = 'Upload eerst een XLSX-bestand.';
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = new Uint8Array(ev.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          XLSX_MAP = buildXlsxMap(wb);
          const size = XLSX_MAP.size;
          btn.disabled = !hasXlsxData();
          btn.title = hasXlsxData()
            ? `XLSX geladen (${size} EAN-regels).`
            : 'Geen bruikbare EAN-gegevens gevonden in XLSX.';
          Logger.status('XLSX', `Bestand geladen: ${file.name} — ${size} EAN-regels`);
        } catch (err) {
          console.error('[LingaDore XLSX] fout bij lezen XLSX:', err);
          alert('Kon XLSX niet lezen. Controleer of het een geldig bestand is.');
          XLSX_MAP = null;
          btn.disabled = true;
          btn.title = 'Upload eerst een XLSX-bestand.';
        }
      };
      reader.readAsArrayBuffer(file);
    });

    // Uploadveld LINKS, button RECHTS
    bar.appendChild(fileLabel);
    bar.appendChild(fileInput);
    bar.appendChild(btn);
    document.body.appendChild(bar);

    const outputHasTables = () => !!document.querySelector('#output table');

    function toggle() {
      const show = outputHasTables() && isLingaSelected();
      bar.style.display = show ? 'flex' : 'none';
      if (!show) {
        // reset state bij wissel naar andere leverancier
        XLSX_MAP = null;
        btn.disabled = true;
        btn.title = 'Upload eerst een XLSX-bestand.';
        fileInput.value = '';
      }
    }

    // Reageer op wijzigingen in #output en #leverancier-keuze
    const out = $('#output');
    if (out) new MutationObserver(toggle).observe(out, { childList: true, subtree: true });

    const supplierSel = document.querySelector('#leverancier-keuze');
    if (supplierSel) {
      supplierSel.addEventListener('change', toggle);
      new MutationObserver(toggle).observe(supplierSel, { childList: true, subtree: true, attributes: true });
    }

    toggle();
  }

  (document.readyState === 'loading')
    ? document.addEventListener('DOMContentLoaded', addToolbar)
    : addToolbar();
})();
