// ==UserScript==
// @name         VCP2 | LingaDore
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0
// @description  Vergelijk local stock met die van de leverancier (remote).
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        unsafeWindow
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-lingadore.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP2/vcp2-lingadore.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  if (!Core) { console.warn('[VCP2 LingaDore] VCPCore ontbreekt (vcp-core.js).'); return; }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.warn('[VCP2 LingaDore] StockRules ontbreekt (stockRules.js).');
    return;
  }

  const CONFIG = { uiDelayMs: 30 };

  const $ = (s, r = document) => r.querySelector(s);
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // XLSX data: Map<EAN digits -> remoteQty>
  let XLSX_MAP = null;

  // ---------- Logger (alleen logboek; console mapping doen we hieronder) ----------
  const Logger = {
    lb() {
      return (typeof unsafeWindow !== 'undefined' && unsafeWindow.logboek)
        ? unsafeWindow.logboek
        : window.logboek;
    },
    status(id, txt, extra) {
      const sid = String(id);
      const lb = this.lb();
      if (lb?.resultaat) lb.resultaat(sid, txt, extra);
      else if (typeof unsafeWindow !== 'undefined' && unsafeWindow.voegLogregelToe) {
        unsafeWindow.voegLogregelToe(sid, txt);
      }
    }
  };

  // ---------- Console report (Mundo-style) ----------
  function consoleReport(anchorId, report) {
    console.groupCollapsed(`[LingaDore][${anchorId}] maatvergelijking`);
    try {
      console.table(report.map(r => ({
        maat: r.maat,
        local: r.local,
        remote: Number.isFinite(r.remote) ? r.remote : '—',
        target: Number.isFinite(r.target) ? r.target : '—',
        delta: Number.isFinite(r.delta) ? r.delta : '—',
        status: r.actie
      })));
    } finally {
      console.groupEnd();
    }
  }

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

    // r=2 => rij 3 (0-based)
    for (let r = 2; r <= range.e.r; r++) {
      const eanCell   = sheet[XLSX.utils.encode_cell({ c: 0, r })]; // A = EAN
      const stockCell = sheet[XLSX.utils.encode_cell({ c: 1, r })]; // B = Stock

      const rawEan = eanCell && String(eanCell.v ?? '').trim();
      if (!rawEan) continue;

      const eanDigits = rawEan.replace(/\D/g, '');
      if (!eanDigits) continue;

      const stockNum = Number(stockCell ? stockCell.v : 0);
      if (!Number.isFinite(stockNum)) continue;

      map.set(eanDigits, stockNum);
    }

    return map;
  }

  // ---------- Badges ----------
  function setBadge(table, status) {
    const b = g.StockKit?.Badges;
    if (b?.setForTable) { b.setForTable(table, status); return; }

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
      ok:            { bg: '#e7f7ee', fg: '#1b7f44', txt: 'OK' },
      afwijking:     { bg: '#fff4d6', fg: '#8a6d00', txt: 'Afwijking' },
      'niet-gevonden': { bg: '#fde2e1', fg: '#a11a16', txt: 'Niet gevonden' },
    };
    const p = palette[status] || palette.ok;
    tag.textContent = p.txt;
    tag.style.background = p.bg;
    tag.style.color = p.fg;
  }

  // ---------- Column indices ----------
  function getColumnIndices(table) {
    const headerRow = table.querySelector('thead tr:last-child');
    if (!headerRow) return { sizeCol: 0, stockCol: 1, eanCol: 2 };

    const ths = Array.from(headerRow.children);
    let eanCol = -1;
    let stockCol = -1;
    const sizeCol = 0;

    ths.forEach((th, idx) => {
      const txt = (th.textContent || '').trim().toLowerCase();
      if (eanCol === -1 && txt.includes('ean')) eanCol = idx;
      if (stockCol === -1 && (txt.includes('stock') || txt.includes('voorraad'))) stockCol = idx;
    });

    if (eanCol < 0) eanCol = 2;
    if (stockCol < 0) stockCol = 1;

    return { sizeCol, stockCol, eanCol };
  }

  // ---------- Rules ----------
  function applyRulesAndMarkFromEAN(localTable, eanMap) {
    const { sizeCol, stockCol, eanCol } = getColumnIndices(localTable);
    const rows = localTable.querySelectorAll('tbody tr');

    const report = [];
    let hits = 0;
    let diffs = 0;
    let firstMutRow = null;

    rows.forEach(row => {
      const sizeCell  = row.children[sizeCol];
      const stockCell = row.children[stockCol];
      const eanCell   = row.children[eanCol];

      const maat      = (sizeCell?.textContent || '').trim();
      const rawEanTxt = (eanCell?.textContent || '').trim();
      const eanDigits = rawEanTxt.replace(/\D/g, '');
      const local     = parseInt((stockCell?.textContent || '').trim(), 10) || 0;

      Core.clearRowMarks(row);

      const remoteRaw = eanDigits ? eanMap.get(eanDigits) : undefined;

      // EAN niet gevonden => policy:
      // - local>0: alles uitboeken
      // - local=0: negeren
      if (!eanDigits || remoteRaw === undefined) {
        if (local > 0) {
          const delta = local;
          Core.markRow(row, {
            action: 'remove',
            delta,
            title: `Uitboeken ${delta} (EAN onbekend / niet in XLSX)`
          });
          diffs++;
          if (!firstMutRow) firstMutRow = row;
          report.push({ maat, local, remote: NaN, target: NaN, delta, actie: 'uitboeken' });
        } else {
          Core.markRow(row, { action: 'none', delta: 0, title: 'Negeren (EAN onbekend / niet in XLSX)' });
          report.push({ maat, local, remote: NaN, target: NaN, delta: 0, actie: 'negeren' });
        }
        return;
      }

      hits++;

      const remoteNum = Number(remoteRaw ?? 0);

      // ✅ centrale mapping + reconcile (max 5)
      const target = SR.mapRemoteToTarget('default', remoteNum, 5);
      const res    = SR.reconcile(local, target, 5);

      if (res.action === 'bijboeken' && res.delta > 0) {
        diffs++;
        if (!firstMutRow) firstMutRow = row;
        Core.markRow(row, {
          action: 'add',
          delta: res.delta,
          title: `Bijboeken ${res.delta} (target ${target}, remote ${remoteNum})`
        });
        report.push({ maat, local, remote: remoteNum, target, delta: res.delta, actie: 'bijboeken' });
        return;
      }

      if (res.action === 'uitboeken' && res.delta > 0) {
        diffs++;
        if (!firstMutRow) firstMutRow = row;
        Core.markRow(row, {
          action: 'remove',
          delta: res.delta,
          title: `Uitboeken ${res.delta} (target ${target}, remote ${remoteNum})`
        });
        report.push({ maat, local, remote: remoteNum, target, delta: res.delta, actie: 'uitboeken' });
        return;
      }

      Core.markRow(row, { action: 'none', delta: 0, title: `OK (target ${target}, remote ${remoteNum})` });
      report.push({ maat, local, remote: remoteNum, target, delta: 0, actie: 'ok' });
    });

    if (firstMutRow) Core.jumpFlash(firstMutRow);

    const status = (hits === 0) ? 'niet-gevonden' : (diffs === 0 ? 'ok' : 'afwijking');
    return { report, hits, diffs, status };
  }

  // ---------- Supplier toggle ----------
  function normStr(s){
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // ✅ werkt overal
      .replace(/[_\s-]+/g, '')
      .trim();
  }

  function isLingaSelected(){
    const sel = document.querySelector('#leverancier-keuze');
    if (!sel) return true;
    const blob = Core.getSupplierBlob(sel);
    const v = normStr(sel.value);
    const t = normStr(sel.options[sel.selectedIndex]?.textContent || '');
    return /\blingadore\b/i.test(blob) || v.includes('lingadore') || t.includes('lingadore');
  }

  // ---------- Run ----------
  async function run(btn) {
    if (!hasXlsxData()) {
      alert('Upload eerst een XLSX-bestand met kolom A = EAN en kolom B = Stock (vanaf rij 3).');
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) { alert('Geen tabellen gevonden in #output.'); return; }

    await Core.runTables({
      btn,
      tables,
      concurrency: 3,
      perTable: async (table) => {
        const headerText = table.querySelector('thead th[colspan]')?.textContent?.trim() || '';
        const anchorId   = (table.id || '').trim() || headerText || 'onbekend';

        const { report, diffs, status } = applyRulesAndMarkFromEAN(table, XLSX_MAP);

        Logger.status(anchorId, status);
        consoleReport(anchorId, report);
        setBadge(table, status);

        await delay(CONFIG.uiDelayMs);
        return diffs;
      }
    });
  }

  // ---------- UI (toolbar) ----------
  function addToolbar() {
    if (document.getElementById('linga-xlsx-toolbar')) return;

    const bar = document.createElement('div');
    bar.id = 'linga-xlsx-toolbar';
    bar.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:298px',
      'z-index:9999',
      'display:none',
      'gap:8px',
      'align-items:center',
      'font-size:13px'
    ].join(';');

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
    btn.textContent = '🔍 Check Stock | LingaDore'; // ✅ nieuwe standaard
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
          console.error('[VCP2 LingaDore] fout bij lezen XLSX:', err);
          alert('Kon XLSX niet lezen. Controleer of het een geldig bestand is.');
          XLSX_MAP = null;
          btn.disabled = true;
          btn.title = 'Upload eerst een XLSX-bestand.';
        }
      };
      reader.readAsArrayBuffer(file);
    });

    bar.appendChild(fileLabel);
    bar.appendChild(fileInput);
    bar.appendChild(btn);
    document.body.appendChild(bar);

    const outputHasTables = () => !!document.querySelector('#output table');

    function toggle() {
      const show = outputHasTables() && isLingaSelected();
      bar.style.display = show ? 'flex' : 'none';

      if (!show) {
        XLSX_MAP = null;
        btn.disabled = true;
        btn.title = 'Upload eerst een XLSX-bestand.';
        fileInput.value = '';
      }
    }

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
