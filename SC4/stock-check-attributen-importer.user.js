// ==UserScript==
// @name         Stock Check | Attributen Importer
// @version      4.1
// @description  Haalt de DDO Attributes-export voor de geselecteerde leverancier op en importeert deze in Stock Check.
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      www.dutchdesignersoutlet.com
// @connect      dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-attributen-importer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-attributen-importer.user.js
// ==/UserScript==

(function () {
  'use strict';

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const $ = (selector, root = document) => root.querySelector(selector);

  function waitFor(getValue, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        const value = getValue();
        if (value) return resolve(value);
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error('Stock Check basis-API niet beschikbaar.'));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function setStatus(message, label = '') {
    const target = $('#process-status');
    if (!target) return;
    target.replaceChildren();
    if (label) {
      const strong = document.createElement('strong');
      strong.textContent = label;
      target.append(strong, document.createTextNode(' '));
    }
    target.append(document.createTextNode(message));
  }

  function fetchAttributes(config) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: config.url,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams(config.payload).toString(),
        responseType: 'arraybuffer',
        timeout: 30000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`DDO-export gaf HTTP ${response.status}.`));
            return;
          }
          const buffer = response.response;
          const bytes = buffer ? new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength)) : null;
          if (!buffer || buffer.byteLength === 0 || !bytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            reject(new Error('DDO stuurde geen geldig XLSX-bestand terug. Controleer of je bent ingelogd.'));
            return;
          }
          resolve(buffer);
        },
        onerror: () => reject(new Error('De DDO-export kon niet worden opgehaald.')),
        ontimeout: () => reject(new Error('De DDO-export duurde te lang.'))
      });
    });
  }

  function handoffToStockCheck(buffer, filename) {
    const input = $('#file-input');
    if (!input) throw new Error('Stock Check uploader #file-input ontbreekt.');

    const file = new File([buffer], filename, { type: XLSX_MIME });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createImportButton(header) {
    const existing = $('#stock-check-attributes-import');
    if (existing) return existing;

    const button = document.createElement('button');
    button.id = 'stock-check-attributes-import';
    button.type = 'button';
    button.style.display = 'none';
    button.title = 'Haal de DDO Attributes-export op';
    button.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i><span>Importeer stock</span>';
    header.prepend(button);
    return button;
  }

  async function init() {
    const [select, header, supplierLinks] = await Promise.all([
      waitFor(() => $('#leverancier-keuze')),
      waitFor(() => $('#header-select-wrapper')),
      waitFor(() => page.SupplierLinks)
    ]);
    const button = createImportButton(header);
    let busy = false;
    let locked = false;

    const refresh = () => {
      const config = supplierLinks.getAttributeExportConfig(select.value);
      button.style.display = config && !busy && !locked ? 'inline-flex' : 'none';
    };

    button.addEventListener('click', async () => {
      if (busy) return;
      const config = supplierLinks.getAttributeExportConfig(select.value);
      if (!config) return;

      busy = true;
      button.disabled = true;
      button.style.display = 'inline-flex';
      select.style.display = 'none';
      setStatus('De Attributes-export wordt opgehaald.', 'Bezig...');

      try {
        const buffer = await fetchAttributes(config);
        handoffToStockCheck(buffer, config.filename);
        locked = true;
        button.style.display = 'none';
      } catch (error) {
        select.style.display = '';
        console.error('[Stock Check | Attributen Importer]', error);
        setStatus(error.message, 'Import mislukt.');
      } finally {
        busy = false;
        button.disabled = false;
        refresh();
      }
    });

    select.addEventListener('change', refresh);
    refresh();
  }

  init().catch(error => {
    console.error('[Stock Check | Attributen Importer]', error);
  });
})();
