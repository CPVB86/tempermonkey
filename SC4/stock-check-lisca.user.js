// ==UserScript==
// @name         Stock Check | Lisca
// @version      4.1
// @description  Vergelijkt de lokale voorraad met de Lisca-voorraad en markeert de benodigde mutaties.
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      www.dutchdesignersoutlet.com
// @connect      dutchdesignersoutlet.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TIMEOUT_MS = 15000;
  const CACHE_KEY = 'stock_check_lisca_csv_v4';
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const SHEET_ID = '1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww';
  const GID = '933070542';
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  function waitForCore(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (page.VCPCore && page.StockRules && page.logboek) {
          resolve({ Core: page.VCPCore, Rules: page.StockRules });
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error('De Stock Check basis-API is niet beschikbaar.'));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function csvUrl(authUser = null, userPath = null) {
    if (userPath !== null) {
      return `https://docs.google.com/u/${userPath}/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    }
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    return authUser === null ? base : `${base}&authuser=${authUser}`;
  }

  function requestCsv(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'text',
        withCredentials: true,
        timeout: TIMEOUT_MS,
        headers: { Accept: 'text/csv,text/plain,*/*;q=0.8' },
        onload: resolve,
        onerror: () => reject(new Error('Lisca CSV kon niet worden opgehaald.')),
        ontimeout: () => reject(new Error('Lisca CSV ophalen duurde te lang.'))
      });
    });
  }

  function loadCache() {
    try {
      const cached = JSON.parse(GM_getValue(CACHE_KEY, 'null'));
      if (cached && Date.now() - cached.savedAt <= CACHE_TTL_MS) return cached.csv;
    } catch (error) {
      console.warn('[Stock Check | Lisca] Cache genegeerd:', error);
    }
    return null;
  }

  function saveCache(csv) {
    GM_setValue(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), csv }));
  }

  function isCsvResponse(response) {
    const text = response?.responseText;
    return response?.status === 200
      && typeof text === 'string'
      && text.trim()
      && !text.trimStart().startsWith('<');
  }

  async function fetchLiscaCsv() {
    const cached = loadCache();
    if (cached) return cached;

    for (let account = 0; account <= 4; account++) {
      const candidates = [csvUrl(account, null), csvUrl(null, account)];
      for (const url of candidates) {
        const response = await requestCsv(url);
        if (isCsvResponse(response)) {
          saveCache(response.responseText);
          return response.responseText;
        }
      }
    }
    throw new Error('Lisca CSV is niet beschikbaar. Controleer je Google-account.');
  }

  function parseCsvToStockMap(csv) {
    const workbook = XLSX.read(csv, { type: 'string', raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    const stockByEan = new Map();

    for (const row of rows) {
      const ean = String(row[5] || '').trim();
      if (!ean) continue;
      const stock = Number.parseInt(String(row[6] || '0').trim(), 10);
      stockByEan.set(ean, Number.isFinite(stock) ? stock : 0);
    }
    return stockByEan;
  }

  function normalizeRemoteStock(remote) {
    if (remote === undefined) return undefined;
    if (remote > 4) return 5;
    if (remote < 2) return 0;
    return remote;
  }

  function reconcileTable(table, remoteMap, Core, Rules) {
    let changes = 0;
    let matches = 0;
    let firstMarkedRow = null;
    const report = [];

    table.querySelectorAll('tbody tr').forEach(row => {
      const [sizeCell, stockCell, eanCell] = row.querySelectorAll('td');
      if (!eanCell) return;

      const size = String(sizeCell.textContent || '').trim();
      const local = Number.parseInt(String(stockCell.textContent || '0').trim(), 10) || 0;
      const ean = String(eanCell.textContent || '').trim();
      const remoteRaw = ean ? remoteMap.get(ean) : undefined;
      const target = normalizeRemoteStock(remoteRaw);

      Core.clearRowMarks(row);
      [sizeCell, stockCell, eanCell].forEach(cell => { cell.style.background = ''; });

      if (!ean || target === undefined) {
        if (local === 0) {
          report.push({ maat: size, local, remote: remoteRaw, target: NaN, actie: 'negeren', delta: 0 });
          return;
        }
        Core.markRow(row, {
          action: 'remove',
          delta: local,
          title: 'Uitboeken: EAN ontbreekt in de Lisca-voorraad.'
        });
        changes++;
        if (!firstMarkedRow) firstMarkedRow = row;
        report.push({ maat: size, local, remote: remoteRaw, target: NaN, actie: 'uitboeken', delta: local });
        return;
      }

      matches++;
      const result = Rules.reconcile(local, target, 5);
      if (result.action === 'bijboeken' && result.delta > 0) {
        Core.markRow(row, {
          action: 'add',
          delta: result.delta,
          title: `Bijboeken ${result.delta} (doel ${target})`
        });
        changes++;
        if (!firstMarkedRow) firstMarkedRow = row;
      } else if (result.action === 'uitboeken' && result.delta > 0) {
        Core.markRow(row, {
          action: 'remove',
          delta: result.delta,
          title: `Uitboeken ${result.delta} (doel ${target})`
        });
        changes++;
        if (!firstMarkedRow) firstMarkedRow = row;
      } else {
        Core.markRow(row, { action: 'none', title: `OK (doel ${target})` });
      }

      report.push({
        maat: size,
        local,
        remote: remoteRaw,
        target,
        actie: result.action,
        delta: result.delta
      });
    });

    if (firstMarkedRow) Core.jumpFlash(firstMarkedRow);
    const status = changes > 0 ? 'afwijking' : matches > 0 ? 'ok' : 'niet-gevonden';
    return { changes, report, status };
  }

  async function runLisca(button, Core, Rules) {
    const tables = Array.from(document.querySelectorAll('#output table'));
    if (!tables.length) return;

    let remoteMap;
    try {
      remoteMap = parseCsvToStockMap(await fetchLiscaCsv());
      if (!remoteMap.size) throw new Error('De Lisca CSV bevat geen voorraadregels.');
    } catch (error) {
      console.error('[Stock Check | Lisca]', error);
      alert(error.message);
      return;
    }

    await Core.runTables({
      btn: button,
      tables,
      concurrency: 3,
      perTable: async table => {
        const anchorId = table.id || table.querySelector('thead th')?.textContent?.trim() || 'onbekend';
        const result = reconcileTable(table, remoteMap, Core, Rules);
        page.logboek.resultaat(anchorId, result.status, { autoJump: false });
        Core.logReport('Lisca', anchorId, result.report);
        return result.changes;
      }
    });
  }

  waitForCore()
    .then(({ Core, Rules }) => {
      const mounted = Core.mountSupplierButton({
        id: 'stock-check-lisca',
        text: 'Check Lisca',
        match: /^lisca(?:\s|$)/i,
        onClick: button => runLisca(button, Core, Rules)
      });
      mounted.btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i>';
      mounted.btn.setAttribute('aria-label', 'Controleer voorraad bij Lisca');
      mounted.btn.title = 'Vergelijk de voorraad met Lisca';
    })
    .catch(error => {
      console.error('[Stock Check | Lisca]', error);
    });
})();
