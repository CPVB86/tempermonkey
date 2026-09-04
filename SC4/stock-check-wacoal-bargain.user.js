// ==UserScript==
// @name         Stock Check | Wacoal Bargain
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.3
// @description  Vergelijk de lokale Wacoal Bargain-voorraad op EAN met de Wacoal XLSX-export.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @grant        GM_info
// @grant        unsafeWindow
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-wacoal-bargain.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-wacoal-bargain.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR = g.StockRules;
  const SUPPLIER_KEYS = new Set([
    'wacoal', 'freya', 'freya-swim', 'fantasie', 'fantasie-swim',
    'elomi', 'elomi-swim', 'wacoal-bargain'
  ]);
  const SESSION_KEY = 'stock-check-wacoal-bargain-xlsx-v3';
  const MAX_LOCAL_STOCK = 5;

  if (!Core) {
    console.warn('[Stock Check | Wacoal Bargain] VCPCore ontbreekt.');
    return;
  }
  if (!SR || typeof SR.mapRemoteToTarget !== 'function' || typeof SR.reconcile !== 'function') {
    console.warn('[Stock Check | Wacoal Bargain] StockRules ontbreekt.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    console.warn('[Stock Check | Wacoal Bargain] XLSX-library ontbreekt.');
    return;
  }

  let stockByEan = null;
  let importedFileName = '';

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const digitsOnly = value => String(value ?? '').replace(/\D/g, '');

  function registerUserscript() {
    const detail = {
      id: 'stock-check-wacoal-bargain',
      name: 'Stock Check | Wacoal Bargain',
      version: typeof GM_info !== 'undefined' ? GM_info.script.version : '5.3'
    };
    g.__stockCheckUserscripts = g.__stockCheckUserscripts || Object.create(null);
    g.__stockCheckUserscripts[detail.id] = detail;
    try {
      g.dispatchEvent(new g.CustomEvent('stockcheck:userscript-register', { detail }));
    } catch {}
  }

  function logStatus(id, status, extra) {
    const logbook = g.logboek;
    if (logbook?.resultaat) logbook.resultaat(String(id), String(status), extra);
  }

  function normalizeHeader(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getCell(sheet, row, column) {
    if (Array.isArray(sheet)) return sheet[row]?.[column];
    if (Array.isArray(sheet?.['!data'])) return sheet['!data'][row]?.[column];
    return sheet?.[XLSX.utils.encode_cell({ r: row, c: column })];
  }

  function cellValue(sheet, row, column) {
    const cell = getCell(sheet, row, column);
    if (cell && typeof cell === 'object' && 'v' in cell) return cell.v;
    return cell ?? '';
  }

  function normalizeEan(value) {
    const canonicalize = digits => {
      const normalized = digitsOnly(digits);
      const canonical = normalized.replace(/^0+(?=\d)/, '');
      return /^(?:\d{8}|\d{12,14})$/.test(canonical) ? canonical : '';
    };

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.isSafeInteger(value) ? canonicalize(String(Math.trunc(value))) : '';
    }

    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^\d+(?:\.0+)?$/.test(raw)) return canonicalize(raw.replace(/\.0+$/, ''));
    if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(raw)) {
      const numeric = Number(raw.replace(',', '.'));
      return Number.isSafeInteger(numeric) ? canonicalize(String(Math.trunc(numeric))) : '';
    }
    return canonicalize(raw);
  }

  function parseStock(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : NaN;
    const match = String(value ?? '').trim().match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return NaN;
    const normalized = match[0].replace(/\s/g, '').replace(',', '.');
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : NaN;
  }

  function findColumns(sheet, range) {
    return { headerRow: range.s.r, eanColumn: 8, stockColumn: 14 };
  }

  function excelColumnToIndex(value) {
    const letters = String(value ?? '').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(letters)) return -1;
    let index = 0;
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
    return index - 1;
  }

  function indexToExcelColumn(index) {
    let value = Number(index) + 1;
    let result = '';
    while (value > 0) {
      value--;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function askForColumns(defaultHeaderRow = 1) {
    return new Promise(resolve => {
      document.getElementById('wacoal-column-modal')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'wacoal-column-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'wacoal-column-modal-title');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '100000', display: 'grid', placeItems: 'center',
        padding: '24px', background: 'rgba(15, 23, 42, .62)', backdropFilter: 'blur(2px)'
      });

      const panel = document.createElement('form');
      Object.assign(panel.style, {
        width: 'min(480px, 100%)', padding: '24px', borderRadius: '14px', background: '#fff',
        color: '#172033', boxShadow: '0 24px 70px rgba(0, 0, 0, .32)', font: '14px/1.45 Arial, sans-serif'
      });
      panel.innerHTML = `
        <h2 id="wacoal-column-modal-title" style="margin:0 0 8px;font-size:20px">Kolommen kiezen</h2>
        <p style="margin:0 0 20px;color:#5b6577">De standaardkolommen I en O bevatten geen bruikbare regels. Bekijk het leveranciersbestand en vul hieronder de juiste posities in. Het bestand blijft geopend in Stock Check.</p>
        <label style="display:grid;gap:6px;margin-bottom:14px;font-weight:700">EAN-kolom
          <input name="ean" value="G" autocomplete="off" maxlength="3" style="padding:10px 12px;border:1px solid #cbd3df;border-radius:8px;font:inherit;text-transform:uppercase">
        </label>
        <label style="display:grid;gap:6px;margin-bottom:14px;font-weight:700">Voorraadkolom
          <input name="stock" value="O" autocomplete="off" maxlength="3" style="padding:10px 12px;border:1px solid #cbd3df;border-radius:8px;font:inherit;text-transform:uppercase">
        </label>
        <label style="display:grid;gap:6px;margin-bottom:8px;font-weight:700">Regel met kolomtitels
          <input name="header" value="${defaultHeaderRow}" type="number" min="1" step="1" style="padding:10px 12px;border:1px solid #cbd3df;border-radius:8px;font:inherit">
        </label>
        <p data-error role="alert" style="min-height:20px;margin:4px 0 12px;color:#c53030"></p>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button type="button" data-cancel style="padding:9px 14px;border:1px solid #cbd3df;border-radius:8px;background:#fff;cursor:pointer">Annuleren</button>
          <button type="submit" style="padding:9px 14px;border:0;border-radius:8px;background:#1769aa;color:#fff;font-weight:700;cursor:pointer">Bestand verwerken</button>
        </div>`;

      const finish = result => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(result);
      };
      const onKeydown = event => {
        if (event.key === 'Escape') finish(null);
      };

      panel.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(panel);
        const eanColumn = excelColumnToIndex(data.get('ean'));
        const stockColumn = excelColumnToIndex(data.get('stock'));
        const headerRowNumber = Number.parseInt(String(data.get('header') || '').trim(), 10);
        const error = panel.querySelector('[data-error]');
        if (eanColumn < 0 || stockColumn < 0 || !Number.isInteger(headerRowNumber) || headerRowNumber < 1) {
          error.textContent = 'Gebruik kolomletters zoals I en O en een geldig regelnummer.';
          return;
        }
        if (eanColumn === stockColumn) {
          error.textContent = 'EAN en voorraad kunnen niet uit dezelfde kolom worden gelezen.';
          return;
        }
        finish({ headerRow: headerRowNumber - 1, eanColumn, stockColumn, manual: true });
      });
      panel.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeydown);
      panel.elements.ean.focus();
      panel.elements.ean.select();
    });
  }

  function buildStockMap(workbook, columnSelection = null) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet?.['!ref']) throw new Error('Het eerste werkblad bevat geen gegevens.');

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const { headerRow, eanColumn, stockColumn, manual = false } = columnSelection || findColumns(sheet, range);
    if (headerRow < range.s.r || headerRow > range.e.r) {
      throw new Error('De gekozen kopregel valt buiten het gebruikte bereik van het werkblad.');
    }
    const map = new Map();
    let validRows = 0;
    let duplicateRows = 0;
    let nonZeroRows = 0;
    let skippedRows = 0;
    const denseRows = Array.isArray(sheet['!data']) ? sheet['!data'] : null;
    // Een XLS(X) kan door alleen opmaak een !ref tot regel 1.048.576 krijgen.
    // In dense mode bevat !data uitsluitend de daadwerkelijk ingelezen rijen.
    const lastDataRow = denseRows ? Math.min(range.e.r, denseRows.length - 1) : range.e.r;

    for (let row = headerRow + 1; row <= lastDataRow; row++) {
      const ean = normalizeEan(cellValue(sheet, row, eanColumn));
      const stock = parseStock(cellValue(sheet, row, stockColumn));
      if (!ean || !Number.isFinite(stock)) {
        skippedRows++;
        continue;
      }

      validRows++;
      if (stock > 0) nonZeroRows++;
      if (map.has(ean)) {
        duplicateRows++;
        map.set(ean, Math.max(map.get(ean), stock));
      } else {
        map.set(ean, stock);
      }
    }

    return { map, validRows, duplicateRows, nonZeroRows, skippedRows, eanColumn, stockColumn, headerRow, manual };
  }

  function isSelected() {
    return SUPPLIER_KEYS.has(document.getElementById('leverancier-keuze')?.value || '');
  }

  function hasStockData() {
    return stockByEan instanceof Map && stockByEan.size > 0;
  }

  function restoreSessionData() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (!cached || !Array.isArray(cached.entries) || !cached.entries.length) return;
      stockByEan = new Map(cached.entries);
      importedFileName = String(cached.fileName || 'Wacoal-voorraadbestand');
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function saveSessionData() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        fileName: importedFileName,
        entries: Array.from(stockByEan.entries())
      }));
    } catch (error) {
      console.warn('[Stock Check | Wacoal Bargain] XLSX-cache kon niet worden opgeslagen:', error);
    }
  }

  function getColumns(table) {
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    let stockColumn = 1;
    let eanColumn = headers.length - 1;
    headers.forEach((header, index) => {
      const text = normalizeHeader(header.textContent);
      if (text === 'local stock' || text === 'stock' || text === 'voorraad') stockColumn = index;
      if (text.includes('ean')) eanColumn = index;
    });
    return { stockColumn, eanColumn };
  }

  function setBadge(table, status) {
    g.StockKit?.Badges?.setForTable?.(table, status);
  }

  function checkTable(table) {
    const { stockColumn, eanColumn } = getColumns(table);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const report = [];
    let matched = 0;
    let unresolved = 0;
    let differences = 0;

    for (const row of rows) {
      const size = String(row.children[0]?.textContent || '').trim();
      const local = parseInt(String(row.children[stockColumn]?.textContent || '0').trim(), 10) || 0;
      const ean = normalizeEan(row.children[eanColumn]?.textContent || '');
      Core.clearRowMarks(row);

      if (!ean) {
        unresolved++;
        Core.markRow(row, {
          action: 'none', delta: 0, remote: '-', target: '-',
          title: 'Niet gecontroleerd: lokale EAN ontbreekt'
        });
        report.push({ size, ean: '', local, remote: '-', target: '-', delta: 0, status: 'geen EAN' });
        continue;
      }

      const found = stockByEan.has(ean);
      const remote = found ? stockByEan.get(ean) : 0;
      if (found) matched++;

      const target = SR.mapRemoteToTarget('wacoal', remote, MAX_LOCAL_STOCK);
      const result = SR.reconcile(local, target, MAX_LOCAL_STOCK);
      const action = result.action === 'bijboeken'
        ? 'add'
        : result.action === 'uitboeken' ? 'remove' : 'none';

      if (action !== 'none') differences++;
      Core.markRow(row, {
        action,
        delta: result.delta,
        remote,
        target,
        title: `${result.action === 'ok' ? 'OK' : result.action} (target ${target}, remote ${remote}${found ? '' : ', EAN niet in XLSX'})`
      });
      report.push({ size, ean, local, remote, target, delta: result.delta, status: result.action });
    }

    const status = matched === 0
      ? 'niet-gevonden'
      : (differences > 0 || unresolved > 0) ? 'afwijking' : 'ok';
    setBadge(table, status);
    return { report, differences, status };
  }

  async function run(button) {
    if (!hasStockData()) {
      alert('Importeer eerst de Wacoal-voorraadlijst met EDIEAN en STOCK.');
      return;
    }

    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) {
      alert('Importeer eerst het DDO-attributenbestand voor Wacoal Group.');
      return;
    }

    await Core.runTables({
      btn: button,
      tables,
      concurrency: 8,
      batchSize: 300,
      batchDelayMs: 20,
      perTable: async table => {
        const id = table.id || table.querySelector('thead th[colspan]')?.textContent?.trim() || 'onbekend';
        const result = checkTable(table);
        logStatus(id, result.status);
        if (g.StockCheckConfig?.detailLogging === true) console.table(result.report);
        await delay(8);
        return result.differences;
      }
    });
  }

  function addControls() {
    if (document.getElementById('stock-check-wacoal-bargain-import')) return;
    registerUserscript();
    restoreSessionData();

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'stock-check-wacoal-bargain-file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.hidden = true;
    document.body.appendChild(fileInput);

    const importButton = document.createElement('button');
    importButton.id = 'stock-check-wacoal-bargain-import';
    importButton.type = 'button';
    importButton.className = 'supplier-stock-import-btn';
    importButton.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i>';
    importButton.setAttribute('aria-label', 'Importeer Wacoal Bargain-voorraadbestand');
    importButton.title = 'Importeer Wacoal XLSX: EDIEAN en STOCK';
    importButton.addEventListener('click', () => fileInput.click());

    const header = document.getElementById('header-select-wrapper');
    const select = document.getElementById('leverancier-keuze');
    if (header && select) select.insertAdjacentElement('afterend', importButton);
    else document.body.appendChild(importButton);

    const mounted = Core.mountSupplierButton({
      id: 'stock-check-wacoal-bargain-btn',
      text: 'Controleer Wacoal Bargain',
      match: () => isSelected() && hasStockData(),
      onClick: button => run(button)
    });
    mounted.btn.innerHTML = '<i class="fa-solid fa-file-circle-check"></i>';
    mounted.btn.setAttribute('aria-label', 'Controleer geselecteerd Wacoal-merk via XLSX');
    mounted.btn.title = `Controleer via ${importedFileName || 'de geimporteerde Wacoal-voorraadlijst'}`;

    function syncControls() {
      const hasTables = !!document.querySelector('#output table');
      importButton.style.display = isSelected() && hasTables && !hasStockData() ? 'inline-flex' : 'none';
      mounted.refresh();
    }

    fileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      importButton.disabled = true;
      importButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      logStatus('WACOAL-BARGAIN', `Bestand verwerken: ${file.name}`);

      reader.onload = async loadEvent => {
        const previousMap = stockByEan;
        const previousFileName = importedFileName;
        try {
          await delay(30);
          const workbook = XLSX.read(new Uint8Array(loadEvent.target.result), {
            type: 'array', dense: true, cellStyles: false, cellHTML: false, cellNF: false
          });
          let parsed = buildStockMap(workbook);
          if (!parsed.map.size) {
            const manualColumns = await askForColumns(parsed.headerRow + 1);
            if (!manualColumns) throw new Error('Import geannuleerd: geen handmatige kolommen gekozen.');
            parsed = buildStockMap(workbook, manualColumns);
          }
          stockByEan = parsed.map;
          importedFileName = file.name;

          if (!hasStockData()) throw new Error('Geen bruikbare EAN/voorraadregels gevonden.');
          saveSessionData();
          mounted.btn.title = `Controleer via ${importedFileName}`;
          logStatus(
            'WACOAL-BARGAIN',
            `${importedFileName} geladen: ${stockByEan.size} unieke EAN-codes` +
              `, EAN uit kolom ${indexToExcelColumn(parsed.eanColumn)}` +
              `, stock uit kolom ${indexToExcelColumn(parsed.stockColumn)}` +
              `, gegevens vanaf regel ${parsed.headerRow + 2}` +
              (parsed.manual ? ' (handmatig gekozen)' : '') +
              `, ${parsed.nonZeroRows} regels met voorraad` +
              (parsed.duplicateRows ? `, ${parsed.duplicateRows} dubbele regels` : '')
          );
        } catch (error) {
          console.error('[Stock Check | Wacoal Bargain] import mislukt:', error);
          stockByEan = previousMap;
          importedFileName = previousFileName;
          alert(`Kon de Wacoal-voorraadlijst niet lezen. ${error.message || error}`);
        } finally {
          importButton.disabled = false;
          importButton.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i>';
          fileInput.value = '';
          syncControls();
        }
      };

      reader.onerror = () => {
        importButton.disabled = false;
        importButton.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i>';
        alert('Kon het Wacoal-voorraadbestand niet openen.');
        syncControls();
      };
      reader.readAsArrayBuffer(file);
    });

    select?.addEventListener('change', syncControls);

    const output = document.getElementById('output');
    if (output) new MutationObserver(syncControls).observe(output, { childList: true });
    syncControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addControls);
  } else {
    addControls();
  }
})();
