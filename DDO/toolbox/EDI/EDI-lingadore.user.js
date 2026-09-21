// ==UserScript==
// @name DDO Toolbox | Adapter | LingaDore
// @namespace https://dutchdesignersoutlet.nl/
// @version 1.0.1
// @description LingaDore EDI: modelcheck, product, maten, EAN, foto's en DDO EAN-koppeling.
// @match https://b2b.lingadore.com/*
// @match https://www.dutchdesignersoutlet.com/admin.php*
// @grant GM_xmlhttpRequest
// @grant GM_setClipboard
// @grant GM_download
// @connect b2b.lingadore.com
// @connect dutchdesignersoutlet.com
// @connect www.dutchdesignersoutlet.com
// @require https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at document-idle
// @author C. P. v. Beek
// @updateURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lingadore.user.js
// @downloadURL https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lingadore.user.js
// ==/UserScript==
(() => {
'use strict';
// BEGIN SHARED EDI (generated; edit EDI/shared.js)
// Shared EDI contract. Bundled into userscripts by build-edi.cjs.
const DDO_EDI = (() => {
  function normalizeSize(value) {
    let size = String(value ?? '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '');
    size = ({'XL/2L':'XL/XXL','XL/2XL':'XL/XXL','3L/4L':'3XL/4XL'})[size] || size;
    return size.replace(/\b([2-5])XL\b/g, (_, n) => 'X'.repeat(Number(n)) + 'L');
  }
  function sizeCandidates(value) {
    const size = normalizeSize(value), match = size.match(/^(X{2,5})L$/);
    return match ? [size, `${match[1].length}XL`] : [size];
  }
  function parseEAN(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('input[type="password"]')) throw Error('Log eerst in bij LingaDore B2B');
    const values = new Set();
    for (const row of doc.querySelectorAll('tr')) {
      const label = row.querySelector('th,td');
      if (!/\bean\b/i.test(label?.textContent || '')) continue;
      const value = label.nextElementSibling?.textContent?.trim() || '';
      if (/^\d{8,14}$/.test(value)) values.add(value);
    }
    if (values.size > 1) throw Error('Meerdere EAN-codes voor één variant');
    return [...values][0] || '';
  }
  function variantMap(entries) {
    const map = new Map();
    for (const entry of entries) {
      const size = normalizeSize(entry.size), ean = String(entry.ean || '');
      if (!size || !/^\d{8,14}$/.test(ean)) throw Error('Ongeldige maat/EAN-regel');
      if (map.has(size) && map.get(size).ean !== ean) throw Error(`Conflicterende EAN voor ${size}`);
      map.set(size, {...entry, size, ean});
    }
    return map;
  }
  function eanTSV(entries, supplierId) {
    if (/[\t\r\n]/.test(supplierId)) throw Error('Ongeldig Supplier ID');
    return [...variantMap(entries).values()].map(e => `${e.size}\t${e.ean}\t${supplierId}`).join('\n');
  }
  const productClipboard = payload => `<!--SPARKLE:${JSON.stringify(payload)}-->`;
  const sizesClipboard = (source, supplierId, sizes) => JSON.stringify({source, orderId:false, supplierId, sizes:[...new Set(sizes.map(normalizeSize))]}, null, 2);
  const theme = `
    #edi-lingadore{background:#fff;color:#25313b;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0002;font:12px/1.25 system-ui}
    #edi-lingadore .edi-head{min-height:28px;padding:0 8px;background:#263746;color:#fff;border:0;touch-action:none}
    #edi-lingadore .edi-version{font-size:9px;color:#fff}
    #edi-lingadore .edi-icon-btn{color:#fff;border-radius:4px}
    #edi-lingadore .edi-icon-btn:hover{background:#ffffff22}
    #edi-lingadore .edi-btn,#edi-lingadore .edi-action{border:0;border-radius:4px;background:#0877b9;color:#fff;font:600 11px/1.15 system-ui;min-height:27px;padding:4px 7px}
    #edi-lingadore .edi-btn:hover:not(:disabled),#edi-lingadore .edi-action:hover:not(:disabled){background:#18864b;color:#fff}
    #edi-lingadore .edi-danger{background:#c83939}
    #edi-lingadore button:disabled{background:#d6dce1;color:#7b858d;opacity:1;cursor:not-allowed}
    #edi-lingadore .edi-status{background:#f4f7f9;color:#56616a;border-radius:4px;font-size:10px}
    #edi-lingadore .edi-match-ok{color:#18864b}
    #edi-lingadore .edi-match-miss{color:#c83939}
    #edi-lingadore .edi-body{max-height:calc(100vh - 65px);overflow:auto}
  `;
  return {normalizeSize, sizeCandidates, parseEAN, variantMap, eanTSV, productClipboard, sizesClipboard, theme};
})();

// END SHARED EDI
(() => {
  'use strict';
  if (location.hostname !== 'www.dutchdesignersoutlet.com' || window.top !== window.self) return;
  const ID = 'lingadore', VERSION = '1.0.1';
  const UPDATE = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/EDI/EDI-lingadore.user.js';
  const $ = (s, root = document) => root.querySelector(s);
  const send = (name, data) => document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`, {detail:JSON.stringify(data)}));
  const pidValue = () => $('#tabs-1 input[name="supplier_pid"]')?.value?.trim() || '';
  const brand = () => /\blingadore\b/i.test($('#tabs-1 #select2-brand-container')?.textContent || $('#tabs-1 select[name="brand"] option:checked')?.textContent || '');
  let busy = false;
  const cache = new Map();
  function parsePid(value) {
    const match = String(value).trim().toUpperCase().match(/^(.+)-([^-]+?)(?:-([A-Z]{1,3}))?$/);
    // Numeric colour + cup suffix must not be swallowed by the model.
    const cupMatch = String(value).trim().toUpperCase().match(/^(.+)-(\d+)-([A-Z]{1,3})$/);
    if (cupMatch) return {model:cupMatch[1], color:cupMatch[2], cup:cupMatch[3]};
    if (!match) throw Error('Supplier PID vereist MODEL-KLEUR, eventueel met -CUP');
    return {model:match[1], color:match[2], cup:match[3] || ''};
  }
  function variantKeys(pid, rawSize) {
    const size = DDO_EDI.normalizeSize(rawSize), bra = size.match(/^(\d{2,3})([A-Z]{1,3})$/);
    if (bra) {
      if (pid.cup && pid.cup !== bra[2]) throw Error(`Cup ${bra[2]} wijkt af van Supplier PID (${pid.cup})`);
      return [{color:`${pid.color}-${bra[2]}`, size:bra[1]}];
    }
    if (pid.cup) {
      if (!/^\d{2,3}$/.test(size)) throw Error(`Geen bandmaat voor ${size}`);
      return [{color:`${pid.color}-${pid.cup}`, size}];
    }
    return DDO_EDI.sizeCandidates(size).map(size => ({color:pid.color, size}));
  }
  const encode = value => encodeURIComponent(btoa(value).replace(/=+$/, ''));
  function get(url) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({method:'GET',url,withCredentials:true,timeout:15000,
      onload:r => {
        if (r.status === 401 || r.status === 403 || /\/(login|sign-in)(?:[/?]|$)/i.test(r.finalUrl || '')) return reject(Error('Log eerst in bij LingaDore B2B'));
        if (r.status === 404) return resolve('');
        if (r.status !== 200) return reject(Error(`LingaDore HTTP ${r.status}`));
        resolve(r.responseText || '');
      },onerror:() => reject(Error('Netwerkfout bij LingaDore')),ontimeout:() => reject(Error('Timeout bij LingaDore'))}));
  }
  async function fetchVariant(model, key, force) {
    const url = `https://b2b.lingadore.com/catalog/variant-modal/${[model,key.color,key.size].map(encode).join('/')}`;
    const cached = cache.get(url);
    if (!force && cached && Date.now() - cached.time < 120000) return cached.ean;
    const html = await get(url), ean = html ? DDO_EDI.parseEAN(html) : '';
    if (ean) cache.set(url, {ean,time:Date.now()});
    return ean;
  }
  function readRows(table) {
    return [...table.querySelectorAll('tr')].flatMap(row => {
      const cell = $('td:first-child',row), input = $('input[name$="[barcode]"]',row);
      if (!cell || !input) return [];
      const field = $('input,select',cell), size = DDO_EDI.normalizeSize(field?.value ?? cell.textContent);
      return size ? [{size,input}] : [];
    });
  }
  function announce() { send('adapter-state',{id:ID,label:'LingaDore',version:VERSION,updateUrl:UPDATE,priority:70,available:brand(),capabilities:['ean','edi']}); }
  async function run(request) {
    const status = (text,kind='busy',done=false,changed=0) => send('adapter-status',{requestId:request.requestId,text,kind,done,changed,autoSave:done && kind==='success' && !!request.autoSave});
    if (busy) return status('LingaDore is al bezig','error',true);
    busy = true;
    try {
      const table = $('#tabs-3 table.options'), originalPid = pidValue();
      if (!brand() || !table) throw Error('Open LingaDore producttab 3');
      const pid = parsePid(originalPid), rows = readRows(table), sizes = [...new Set(rows.map(r => r.size))];
      if (!sizes.length) throw Error('Geen maten gevonden');
      // Validate every cup before fetching or changing fields.
      const jobs = sizes.map(size => ({size,keys:variantKeys(pid,size)})), entries = [], missing = [];
      const started = Date.now();
      for (const [index, job] of jobs.entries()) {
        let ean = '';
        for (const key of job.keys) {
          if (Date.now() - started > 85000) throw Error('LingaDore duurt te lang; probeer opnieuw (cache blijft beschikbaar)');
          ean = await fetchVariant(pid.model,key,!!request.forceRefresh);
          if (ean) break;
        }
        if (ean) entries.push({size:job.size,ean}); else missing.push(job.size);
        status(`LingaDore EAN ${index + 1}/${jobs.length}`);
      }
      // Never save a partial scrape or write into a different product/table after navigation.
      if (missing.length) throw Error(`Geen EAN voor ${missing.join(', ')}; controleer B2B-login en varianten`);
      const map = DDO_EDI.variantMap(entries), current = readRows(table);
      if (!table.isConnected || table !== $('#tabs-3 table.options') || pidValue() !== originalPid || !brand() || current.length !== rows.length || rows.some((r,i) => r.input !== current[i].input || r.size !== current[i].size)) throw Error('Product of maten gewijzigd tijdens ophalen; start opnieuw');
      let changed = 0;
      for (const row of rows) {
        const ean = map.get(row.size).ean;
        if (row.input.value === ean) continue;
        row.input.value = ean;
        row.input.dispatchEvent(new Event('input',{bubbles:true}));
        row.input.dispatchEvent(new Event('change',{bubbles:true}));
        changed++;
      }
      status(`${changed} EAN-rijen gevuld · voorraad ongewijzigd`,'success',true,changed);
    } catch (error) { status(error.message || 'LingaDore ophalen mislukt','error',true); }
    finally { busy = false; }
  }
  document.addEventListener('ddo-toolbox:discover',announce);
  document.addEventListener('ddo-toolbox:run-adapter',event => {
    let request; try { request = JSON.parse(event.detail || '{}'); } catch { return; }
    if (request.id === ID) void run(request);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',announce,{once:true}); else announce();
})();

(function () {
  'use strict';
  if (location.hostname !== 'b2b.lingadore.com' || window.top !== window.self) return;

  // ============================================================
  // CONFIG
  // ============================================================

  const APP = 'DDO Toolbox | LingaDore';
  const VERSION = '1.0.1';
  const SUPPLIER = 'LingaDore';

  const DDO_BRAND_IDS = [2, 58, 61, 146];

  const EXPORT_PAYLOAD = {
    format: 'excel',
    export: 'Export products'
  };

  const CACHE_PREFIX = 'edi:lingadore:ddo:v1';
  const UI_KEY = 'edi:lingadore:ui:v1';
  const CACHE_TTL_MS = 15 * 60 * 1000;

  const IMAGE_PREFIX =
    'https://www.dutchdesignersoutlet.com/img/product/';

  const SHEET_PREFERRED = 'Parent';
  const COL_IMAGE = 1;
  const COL_PRODUCT_ID = 3;
  const HEADER_ROW_INDEX = 0;

  const state = {
    ddoMap: null,
    modelCheckStarted: false,
    loading: false,
    observer: null,
    renderTimer: null,
    drag: null,
    eanCache: new Map()
  };

  // ============================================================
  // HELPERS
  // ============================================================

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  function text(selector, root = document) {
    return (
      $(selector, root)
        ?.textContent
        ?.replace(/\s+/g, ' ')
        .trim() || ''
    );
  }

  function normalizeModel(value) {
    const s =
      String(value ?? '')
        .trim()
        .toUpperCase();

    return s || null;
  }

  function normalizeColor(value) {
    const s =
      String(value ?? '')
        .trim()
        .toUpperCase();

    return s
      ? s.split('-')[0].trim()
      : null;
  }

  function buildCode(model, color) {
    model = normalizeModel(model);
    color = normalizeColor(color);

    return model && color
      ? `${model}-${color}`
      : null;
  }

  function normalizeDDOProductCode(value) {
    const s =
      String(value ?? '')
        .trim()
        .toUpperCase();

    if (!s) return null;

    const parts = s.split('-');

    return (
      parts.length >= 2 &&
      parts[0] &&
      parts[1]
    )
      ? `${parts[0].trim()}-${parts[1].trim()}`
      : s;
  }

  function parsePriceText(value) {
    const s =
      String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[^\d,.-]/g, '')
        .trim();

    if (!s) return NaN;

    let normalized = s;

    if (
      s.includes(',') &&
      s.includes('.')
    ) {
      normalized =
        s.lastIndexOf(',') >
        s.lastIndexOf('.')
          ? s
              .replace(/\./g, '')
              .replace(',', '.')
          : s.replace(/,/g, '');

    } else if (s.includes(',')) {
      normalized =
        s.replace(',', '.');
    }

    const n = Number(normalized);

    return Number.isFinite(n)
      ? n
      : NaN;
  }

  function fmtMoney(value) {
    return Number.isFinite(value)
      ? value
          .toFixed(2)
          .replace('.', ',')
      : '';
  }

  function toTitleCase(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(
        /(^|[\s\-/'’])\p{L}/gu,
        m => m.toUpperCase()
      );
  }

  function unique(values) {
    return [
      ...new Set(
        values.filter(Boolean)
      )
    ];
  }

  function decodeBase64(value) {
    try {
      return decodeURIComponent(
        Array.prototype.map
          .call(
            atob(String(value || '')),
            c =>
              '%' +
              (
                '00' +
                c
                  .charCodeAt(0)
                  .toString(16)
              ).slice(-2)
          )
          .join('')
      );

    } catch {
      try {
        return atob(
          String(value || '')
        );
      } catch {
        return '';
      }
    }
  }

  function writeClipboard(value) {
    if (
      typeof GM_setClipboard ===
      'function'
    ) {
      GM_setClipboard(
        value,
        'text'
      );

      return Promise.resolve();
    }

    return navigator.clipboard
      .writeText(value);
  }

  function isPDP() {
    return (
      /^\/nl\/catalog\/item\/[^/]+\/?/
        .test(location.pathname)
    );
  }

  function getModelNo() {
    return (
      normalizeModel(
        $('.product[data-modelno]')
          ?.dataset.modelno
      ) ||

      normalizeModel(
        text(
          '.product-header-block h3'
        )
      ) ||

      normalizeModel(
        location.pathname.match(
          /\/catalog\/item\/([^/]+)/
        )?.[1]
      ) ||

      ''
    );
  }

  function getProductTitle() {
    return text(
      '.product-header-block h1'
    );
  }

  function getInfoBlock(label) {
    const wanted =
      label.toLowerCase();

    for (
      const block
      of $$('.info-block--item')
    ) {
      const cells =
        Array.from(
          block.children
        );

      if (cells.length < 2) {
        continue;
      }

      const key =
        (
          cells[0].textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      if (
        key.includes(wanted)
      ) {
        return {
          label:
            cells[0]
              .textContent
              .trim(),

          text:
            (
              cells[1]
                .textContent ||
              ''
            )
              .replace(/\s+/g, ' ')
              .trim(),

          html:
            (
              cells[1]
                .innerHTML ||
              ''
            ).trim()
        };
      }
    }

    return {
      label: '',
      text: '',
      html: ''
    };
  }

  function getRRP() {
    return parsePriceText(
      getInfoBlock(
        'adviesverkoopprijs'
      ).text
    );
  }

  function getDescription() {
    const info =
      getInfoBlock(
        'omschrijving'
      );

    if (info.html) {
      return {
        descriptionHtml:
          info.html,

        descriptionText:
          ''
      };
    }

    return {
      descriptionHtml: '',
      descriptionText:
        info.text || ''
    };
  }

  function getColorSelect() {
    return $(
      '.matrix-filters ' +
      'select[data-filter-attribute="color"]'
    );
  }

  function getActiveBaseColor() {
    return normalizeColor(
      getColorSelect()?.value
    );
  }

  function getSupplierColorMap() {
    const map =
      new Map();

    $$('.item-colors .color[data-color]')
      .forEach(el => {

        const color =
          normalizeColor(
            el.dataset.color
          );

        if (
          !color ||
          map.has(color)
        ) {
          return;
        }

        const swatch =
          $('span', el);

        map.set(
          color,
          {
            background:
              swatch
                ?.style
                .background ||

              swatch
                ?.style
                .backgroundColor ||

              '#e5e7eb',

            title:
              el.getAttribute(
                'title'
              ) || '',

            description:
              el.dataset
                .description ||
              ''
          }
        );
      });

    return map;
  }

  // ============================================================
  // CSS
  // ============================================================

  function injectCSS() {

    if (
      $('#edi-lingadore-css')
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'edi-lingadore-css';

    style.textContent = `

      #edi-lingadore {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483000;

        width: 430px;
        max-width: calc(100vw - 24px);

        background:
          rgba(255,255,255,.98);

        color: #202124;

        border:
          1px solid #dfe1e5;

        border-radius: 10px;

        box-shadow:
          0 8px 28px
          rgba(60,64,67,.20);

        font:
          12px/1.35
          Arial,
          sans-serif;

        overflow: hidden;
      }

      #edi-lingadore * {
        box-sizing: border-box;
        font: inherit;
      }

      #edi-lingadore .edi-head {
        display: flex;
        align-items: center;

        min-height: 38px;

        padding:
          7px 8px
          7px 11px;

        border-bottom:
          1px solid #eceff1;

        cursor: move;
        user-select: none;

        background: #fff;
      }

      #edi-lingadore
      .edi-title {
        flex: 1;
        font-weight: 700;
        letter-spacing: .01em;
      }

      #edi-lingadore
      .edi-version {
        margin-left: 6px;

        color: #9aa0a6;

        font-size: 10px;
        font-weight: 400;
      }

      #edi-lingadore
      .edi-icon-btn {
        width: 26px;
        height: 26px;

        padding: 0;

        border: 0;
        border-radius: 6px;

        background: transparent;
        color: #5f6368;

        cursor: pointer;
      }

      #edi-lingadore
      .edi-icon-btn:hover {
        background: #f1f3f4;
        color: #202124;
      }

      #edi-lingadore
      .edi-body {
        padding: 10px;
      }

      #edi-lingadore.edi-minimized {
        width: 190px;
      }

      #edi-lingadore.edi-minimized
      .edi-body {
        display: none;
      }

      #edi-lingadore.edi-minimized
      .edi-head {
        border-bottom: 0;
      }

      .edi-toolbar {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;

        margin-bottom: 8px;
      }

      .edi-btn {
        appearance: none;

        border:
          1px solid #dadce0;

        background: #fff;
        color: #3c4043;

        border-radius: 6px;

        min-height: 27px;

        padding: 4px 8px;

        cursor: pointer;
        white-space: nowrap;

        transition:
          background .12s ease,
          border-color .12s ease;
      }

      .edi-btn:hover:not(:disabled) {
        background: #f8f9fa;
        border-color: #bdc1c6;
      }

      .edi-btn:disabled {
        opacity: .38;
        cursor: default;
      }

      .edi-btn.edi-primary {
        border-color: #1a73e8;
        color: #1967d2;
      }

      .edi-btn.edi-danger {
        color: #b3261e;
      }

      .edi-status {
        min-height: 24px;

        padding: 5px 7px;
        margin-bottom: 8px;

        border-radius: 6px;

        background: #f8f9fa;
        color: #5f6368;

        font-size: 11px;
      }

      .edi-summary {
        color: #5f6368;
        font-size: 11px;

        margin:
          -2px 0 8px;
      }

      .edi-pdp-meta {
        display: flex;
        gap: 6px;
        align-items: baseline;

        margin-bottom: 8px;

        color: #5f6368;
      }

      .edi-pdp-meta strong {
        color: #202124;
      }

      .edi-colors {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .edi-color-row {
        display: grid;

        grid-template-columns:
          minmax(128px, 1fr)
          auto;

        align-items: center;
        gap: 7px;

        min-height: 34px;

        padding: 3px 4px;

        border:
          1px solid transparent;

        border-radius: 7px;
      }

      .edi-color-row.edi-active {
        background: #f8f9fa;

        border-color:
          #e3e6e8;
      }

      .edi-color-main {
        min-width: 0;

        display: flex;
        align-items: center;

        gap: 7px;
      }

      .edi-color-select {
        display: flex;

        min-width: 0;

        align-items: center;
        gap: 7px;

        border: 0;
        background: transparent;

        padding: 2px 0;

        color: #202124;

        cursor: pointer;
        text-align: left;
      }

      .edi-swatch {
        width: 17px;
        height: 17px;

        flex:
          0 0 17px;

        border-radius: 50%;

        border:
          1px solid
          rgba(0,0,0,.18);
      }

      .edi-color-label {
        min-width: 0;

        overflow: hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;

        font-weight: 600;
      }

      .edi-match {
        margin-left: auto;

        font-size: 10px;

        color: #9aa0a6;

        white-space:
          nowrap;
      }

      .edi-match.edi-match-ok {
        color: #188038;
      }

      .edi-match.edi-match-miss {
        color: #b3261e;
      }

      .edi-match a {
        color: inherit;
        text-decoration: none;
      }

      .edi-actions {
        display: flex;
        gap: 3px;
      }

      .edi-action {
        border: 0;

        background:
          transparent;

        color: #5f6368;

        padding: 4px 5px;

        border-radius: 5px;

        cursor: pointer;

        font-size: 11px;
      }

      .edi-action:hover:not(:disabled) {
        background: #eef3f8;
        color: #1967d2;
      }

      .edi-action:disabled {
        opacity: .25;
        cursor: default;
      }

      .matrix-filters
      .edi-original-color-select {
        position:
          absolute !important;

        width: 1px !important;
        height: 1px !important;

        padding: 0 !important;

        margin:
          -1px !important;

        overflow:
          hidden !important;

        clip:
          rect(
            0,
            0,
            0,
            0
          ) !important;

        white-space:
          nowrap !important;

        border:
          0 !important;
      }

      /*
       * Oude Model Checker-pills
       * verbergen als het oude script
       * nog actief staat.
       */

      .matrix-filters
      .ddo-color-pill-wrapper {
        display:
          none !important;
      }

      /* ==========================
         GRID
         ========================== */

      .edi-card-checked {
        outline:
          2px solid
          transparent !important;

        outline-offset:
          2px !important;

        position:
          relative !important;
      }

      .edi-card-all {
        outline-color:
          #188038 !important;
      }

      .edi-card-partial {
        outline-color:
          #f9ab00 !important;
      }

      .edi-card-miss {
        outline-color:
          #d93025 !important;
      }

      .edi-card-all
      .item-main-img {
        opacity:
          .48 !important;
      }

      .edi-grid-badge {
        position: absolute;

        z-index: 100;

        top: 7px;
        left: 7px;

        padding: 4px 7px;

        border-radius:
          999px;

        color: #fff;
        background: #5f6368;

        font:
          700 10px/1.2
          Arial,
          sans-serif;

        pointer-events:
          none;
      }

      .edi-card-all
      .edi-grid-badge {
        background: #188038;
      }

      .edi-card-partial
      .edi-grid-badge {
        background: #f9ab00;
        color: #202124;
      }

      .edi-card-miss
      .edi-grid-badge {
        background: #d93025;
      }

      .edi-grid-results {
        position: absolute;

        left: 7px;
        bottom: 7px;

        z-index: 101;

        display: flex;
        flex-direction: column;

        gap: 3px;

        max-width:
          calc(100% - 14px);
      }

      .edi-grid-pill {
        width: fit-content;
        max-width: 100%;

        padding: 3px 6px;

        border-radius:
          999px;

        color: #fff;
        background: #d93025;

        font:
          700 10px/1.2
          Arial,
          sans-serif;

        text-decoration:
          none !important;

        overflow: hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;
      }

      .edi-grid-pill.edi-ok {
        background: #188038;
      }

    `;

    style.textContent += DDO_EDI.theme;

    document.head
      .appendChild(style);
  }

  // ============================================================
  // UI
  // ============================================================

  function createPanel() {

    if (
      $('#edi-lingadore')
    ) {
      return;
    }

    const panel =
      document.createElement(
        'section'
      );

    panel.id =
      'edi-lingadore';

    panel.innerHTML = `

      <div class="edi-head">

        <div class="edi-title">
          Toolbox · LingaDore
          <span class="edi-version">
            v${VERSION}
          </span>
        </div>

        <button
          class="edi-icon-btn"
          id="edi-minimize"
          type="button"
          title="Minimaliseer"
        >
          −
        </button>

      </div>

      <div class="edi-body">

        <div class="edi-toolbar">

          <button
            class="edi-btn edi-primary"
            id="edi-start-check"
            type="button"
          >
            Start modelcheck
          </button>

          <button
            class="edi-btn"
            id="edi-recheck"
            type="button"
            disabled
          >
            Opnieuw checken
          </button>

          <button
            class="edi-btn edi-danger"
            id="edi-reset"
            type="button"
          >
            Reset
          </button>

        </div>

        <div
          class="edi-status"
          id="edi-status"
        >
          Modelcheck staat stil.
        </div>

        <div
          class="edi-summary"
          id="edi-summary"
        ></div>

        <div id="edi-pdp"></div>

      </div>
    `;

    document.body
      .appendChild(panel);

    restoreUI();

    bindPanelEvents();

    makeDraggable(panel);
  }

  function bindPanelEvents() {

    $('#edi-minimize')
      ?.addEventListener(
        'click',
        event => {

          event.stopPropagation();

          const panel =
            $('#edi-lingadore');

          if (!panel) return;

          panel.classList
            .toggle(
              'edi-minimized'
            );

          const minimized =
            panel.classList
              .contains(
                'edi-minimized'
              );

          $('#edi-minimize')
            .textContent =
              minimized
                ? '+'
                : '−';

          $('#edi-minimize')
            .title =
              minimized
                ? 'Open'
                : 'Minimaliseer';

          saveUI();
        }
      );

    $('#edi-start-check')
      ?.addEventListener(
        'click',
        () =>
          startModelCheck(false)
      );

    $('#edi-recheck')
      ?.addEventListener(
        'click',
        () =>
          recheckCurrentPage()
      );

    $('#edi-reset')
      ?.addEventListener(
        'click',
        resetModelCheck
      );
  }

  function setStatus(message) {

    const el =
      $('#edi-status');

    if (el) {
      el.textContent =
        message;
    }
  }

  function setSummary(
    message = ''
  ) {

    const el =
      $('#edi-summary');

    if (el) {
      el.textContent =
        message;
    }
  }

  function setLoading(loading) {

    state.loading =
      loading;

    const start =
      $('#edi-start-check');

    const recheck =
      $('#edi-recheck');

    const reset =
      $('#edi-reset');

    if (start) {
      start.disabled =
        loading;
    }

    if (recheck) {
      recheck.disabled =
        loading ||
        !state.modelCheckStarted;
    }

    if (reset) {
      reset.disabled =
        loading;
    }
  }

  function flashButton(
    button,
    label = '✓'
  ) {

    if (!button) return;

    const old =
      button.textContent;

    button.textContent =
      label;

    setTimeout(
      () => {

        if (
          button.isConnected
        ) {
          button.textContent =
            old;
        }

      },
      900
    );
  }

  // ============================================================
  // DRAG + PERSISTENT UI
  // ============================================================

  function restoreUI() {

    const panel =
      $('#edi-lingadore');

    if (!panel) return;

    try {

      const saved =
        JSON.parse(
          localStorage.getItem(
            UI_KEY
          ) || '{}'
        );

      if (
        Number.isFinite(
          saved.left
        ) &&
        Number.isFinite(
          saved.top
        )
      ) {

        panel.style.left =
          `${Math.max(
            0,
            Math.min(
              saved.left,
              innerWidth - 80
            )
          )}px`;

        panel.style.top =
          `${Math.max(
            0,
            Math.min(
              saved.top,
              innerHeight - 38
            )
          )}px`;

        panel.style.right =
          'auto';
      }

      if (
        saved.minimized
      ) {

        panel.classList.add(
          'edi-minimized'
        );

        $('#edi-minimize')
          .textContent = '+';

        $('#edi-minimize')
          .title = 'Open';
      }

    } catch {}
  }

  function saveUI() {

    const panel =
      $('#edi-lingadore');

    if (!panel) return;

    const rect =
      panel.getBoundingClientRect();

    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        left:
          Math.round(
            rect.left
          ),

        top:
          Math.round(
            rect.top
          ),

        minimized:
          panel.classList
            .contains(
              'edi-minimized'
            )
      })
    );
  }

  function makeDraggable(panel) {

    const handle =
      $('.edi-head', panel);

    if (!handle) return;

    handle.addEventListener(
      'pointerdown',
      event => {

        if (
          event.target.closest(
            'button'
          )
        ) {
          return;
        }

        const rect =
          panel
            .getBoundingClientRect();

        state.drag = {
          pointerId:
            event.pointerId,

          dx:
            event.clientX -
            rect.left,

          dy:
            event.clientY -
            rect.top
        };

        handle.setPointerCapture(
          event.pointerId
        );

        panel.style.right =
          'auto';

        event.preventDefault();
      }
    );

    handle.addEventListener(
      'pointermove',
      event => {

        if (
          !state.drag ||
          state.drag.pointerId !==
            event.pointerId
        ) {
          return;
        }

        const maxX =
          Math.max(
            0,
            innerWidth -
            panel.offsetWidth
          );

        const maxY =
          Math.max(
            0,
            innerHeight -
            panel.offsetHeight
          );

        const x =
          Math.max(
            0,
            Math.min(
              event.clientX -
              state.drag.dx,
              maxX
            )
          );

        const y =
          Math.max(
            0,
            Math.min(
              event.clientY -
              state.drag.dy,
              maxY
            )
          );

        panel.style.left =
          `${x}px`;

        panel.style.top =
          `${y}px`;
      }
    );

    const stop =
      event => {

        if (
          !state.drag ||
          state.drag.pointerId !==
            event.pointerId
        ) {
          return;
        }

        state.drag =
          null;

        saveUI();
      };

    handle.addEventListener(
      'pointerup',
      stop
    );

    handle.addEventListener(
      'pointercancel',
      stop
    );
  }

  // ============================================================
  // PDP
  // ============================================================

  function renderPDP() {

    const host =
      $('#edi-pdp');

    if (!host) return;

    if (!isPDP()) {

      host.innerHTML = '';

      return;
    }

    const select =
      getColorSelect();

    const model =
      getModelNo();

    const title =
      getProductTitle();

    if (
      !select ||
      !model
    ) {

      host.innerHTML = `

        <div class="edi-pdp-meta">

          <strong>
            ${escapeHTML(
              model ||
              'Product'
            )}
          </strong>

          <span>
            ${escapeHTML(title)}
          </span>

        </div>

        <div class="edi-summary">
          Wacht op kleurmatrix…
        </div>
      `;

      return;
    }

    select.classList.add(
      'edi-original-color-select'
    );

    const supplierColors =
      getSupplierColorMap();

    const active =
      normalizeColor(
        select.value
      );

    const options =
      Array.from(
        select.options
      )
        .filter(
          option =>
            option.value
        )
        .map(
          option => ({
            optionValue:
              option.value,

            color:
              normalizeColor(
                option.value
              ),

            name:
              option
                .textContent
                .trim()
          })
        )
        .filter(
          item =>
            item.color
        );

    host.innerHTML = `

      <div class="edi-pdp-meta">

        <strong>
          ${escapeHTML(model)}
        </strong>

        <span>
          ${escapeHTML(title)}
        </span>

      </div>

      <div class="edi-colors">

        ${options
          .map(
            item =>
              renderColorRow(
                item,
                supplierColors.get(
                  item.color
                ),
                active
              )
          )
          .join('')}

      </div>
    `;

    bindPDPEvents(
      select
    );
  }

  function renderColorRow(
    item,
    supplierColor,
    active
  ) {

    const isActive =
      item.color === active;

    const match =
      getStatusForCode(
        buildCode(
          getModelNo(),
          item.color
        )
      );

    const matchHTML =
      renderMatch(match);

    const bg =
      supplierColor
        ?.background ||
      '#e5e7eb';

    return `

      <div
        class="
          edi-color-row
          ${isActive
            ? 'edi-active'
            : ''}
        "
        data-color="${escapeAttr(
          item.color
        )}"
      >

        <div class="edi-color-main">

          <button
            type="button"
            class="edi-color-select"
            data-option-value="${escapeAttr(
              item.optionValue
            )}"
            title="Selecteer ${escapeAttr(
              item.color
            )} ${escapeAttr(
              item.name
            )}"
          >

            <span
              class="edi-swatch"
              style="background:${escapeAttr(
                bg
              )}"
            ></span>

            <span class="edi-color-label">
              ${escapeHTML(
                item.color
              )}
              ${escapeHTML(
                item.name
              )}
            </span>

          </button>

          ${matchHTML}

        </div>

        <div class="edi-actions">

          <button
            type="button"
            class="edi-action"
            data-action="product"
            title="Productgegevens kopiëren"
          >
            Product
          </button>

          <button
            type="button"
            class="edi-action"
            data-action="sizes"
            title="Maten kopiëren"
            ${isActive
              ? ''
              : 'disabled'}
          >
            Maten
          </button>

          <button
            type="button"
            class="edi-action"
            data-action="ean"
            title="EAN-data kopiëren"
            ${isActive
              ? ''
              : 'disabled'}
          >
            EAN
          </button>

          <button
            type="button"
            class="edi-action"
            data-action="photos"
            title="Originele foto's downloaden"
          >
            Foto's
          </button>

        </div>

      </div>
    `;
  }

  function renderMatch(match) {

    if (
      !state.modelCheckStarted ||
      !state.ddoMap
    ) {
      return `
        <span class="edi-match">
          ·
        </span>
      `;
    }

    if (!match.match) {
      return `
        <span
          class="
            edi-match
            edi-match-miss
          "
        >
          —
        </span>
      `;
    }

    const id =
      match.productId ||
      match.ddoEditId;

    if (!id) {
      return `
        <span
          class="
            edi-match
            edi-match-ok
          "
        >
          ✓
        </span>
      `;
    }

    return `

      <span
        class="
          edi-match
          edi-match-ok
        "
      >

        <a
          href="${escapeAttr(
            buildDDOEditUrl(id)
          )}"
          target="_blank"
          rel="noopener"
          title="Open DDO"
        >
          ✓ ${escapeHTML(id)}
        </a>

      </span>
    `;
  }

  function bindPDPEvents(
    select
  ) {

    $$(
      '.edi-color-select',
      $('#edi-pdp')
    )
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () => {

              const value =
                button.dataset
                  .optionValue;

              if (!value) {
                return;
              }

              if (
                select.value !==
                value
              ) {

                select.value =
                  value;

                select.dispatchEvent(
                  new Event(
                    'change',
                    {
                      bubbles: true
                    }
                  )
                );
              }

              setTimeout(
                renderPDP,
                50
              );
            }
          );
        }
      );

    $$(
      '.edi-action',
      $('#edi-pdp')
    )
      .forEach(
        button => {

          button.addEventListener(
            'click',
            async () => {

              const row =
                button.closest(
                  '.edi-color-row'
                );

              const color =
                row?.dataset
                  .color;

              if (!color) {
                return;
              }

              const action =
                button.dataset
                  .action;

              try {

                if (
                  action ===
                  'product'
                ) {

                  await copyProduct(
                    color
                  );

                  flashButton(
                    button
                  );

                } else if (
                  action ===
                  'sizes'
                ) {

                  await copySizes(
                    color
                  );

                  flashButton(
                    button
                  );

                } else if (
                  action ===
                  'ean'
                ) {

                  button.disabled =
                    true;

                  button.textContent =
                    '…';

                  await copyEAN(
                    color
                  );

                  button.textContent =
                    '✓';

                  setTimeout(
                    renderPDP,
                    900
                  );

                } else if (
                  action ===
                  'photos'
                ) {

                  button.disabled =
                    true;

                  button.textContent =
                    '…';

                  const count =
                    await downloadPhotos(
                      color
                    );

                  button.textContent =
                    count
                      ? `✓ ${count}`
                      : '0';

                  setTimeout(
                    renderPDP,
                    1100
                  );
                }

              } catch (error) {

                console.error(
                  `[${APP}]`,
                  error
                );

                setStatus(
                  `Fout: ${
                    error.message ||
                    error
                  }`
                );

                button.textContent =
                  '!';

                setTimeout(
                  renderPDP,
                  1200
                );
              }
            }
          );
        }
      );

    if (
      !select.dataset
        .ediBound
    ) {

      select.dataset.ediBound =
        '1';

      select.addEventListener(
        'change',
        () => {

          setStatus(
            `Kleur ${
              normalizeColor(
                select.value
              ) || ''
            } geselecteerd.`
          );

          setTimeout(
            renderPDP,
            100
          );

          setTimeout(
            renderPDP,
            500
          );
        }
      );
    }
  }

  // ============================================================
  // PRODUCT / SPARKLE V2
  // ============================================================

  async function copyProduct(
    color
  ) {

    const model =
      getModelNo();

    const select =
      getColorSelect();

    const option =
      Array.from(
        select?.options ||
        []
      )
        .find(
          o =>
            normalizeColor(
              o.value
            ) === color
        );

    const colorName =
      option
        ?.textContent
        ?.trim() ||
      '';

    const baseTitle =
      getProductTitle();

    const computedName =
      `${baseTitle} ${
        toTitleCase(
          colorName
        )
      }`
        .replace(/\s+/g, ' ')
        .trim();

    const rrpNumber =
      getRRP();

    const {
      descriptionHtml,
      descriptionText
    } =
      getDescription();

    const payload = {

      name:
        computedName,

      title:
        computedName,

      rrp:
        fmtMoney(
          rrpNumber
        ),

      /*
       * Geen inkoopprijs gebruiken.
       * Price blijft leeg zolang
       * er geen echte verkoopactieprijs
       * beschikbaar is.
       */
      price: '',

      productCode:
        buildCode(
          model,
          color
        ),

      modelName:
        baseTitle,

      descriptionHtml,

      descriptionText,

      compositionUrl:
        location.href,

      reference:
        ' - [ext]',

      _sparkle: {
        source:
          SUPPLIER,

        v: 2,

        ts:
          new Date()
            .toISOString()
      }
    };

    await writeClipboard(
      DDO_EDI.productClipboard(payload)
    );

    setStatus(
      `${
        payload.productCode
      }: productgegevens gekopieerd.`
    );
  }

  // ============================================================
  // VARIANTS / SIZES
  // ============================================================

  function getActiveVariants(
    color
  ) {

    const active =
      getActiveBaseColor();

    if (
      active !== color
    ) {
      throw new Error(
        `Selecteer eerst kleur ${color}.`
      );
    }

    const model =
      getModelNo();

    const result = [];
    const seen =
      new Set();

    const rows =
      $$(
        '.item-row.style_row[data-color-id], ' +
        '.style_row[data-color-id], ' +
        '[data-color-id].item-row'
      );

    for (
      const row
      of rows
    ) {

      const rawStyle =
        String(
          row.dataset
            .colorId ||
          ''
        )
          .trim()
          .toUpperCase();

      if (
        normalizeColor(
          rawStyle
        ) !== color
      ) {
        continue;
      }

      const suffix =
        rawStyle.includes('-')
          ? rawStyle
              .split('-')
              .slice(1)
              .join('-')
              .trim()
          : '';

      const nodes =
        $$(
          '.input_variant_qty.matrix_product[data-size], ' +
          '.variant-info[data-size], ' +
          '[data-variant-url][data-size]',
          row
        );

      for (
        const node
        of nodes
      ) {

        const encodedModel =
          node.dataset.model ||

          node.dataset
            .modelNo ||

          node.closest(
            '[data-model]'
          )
            ?.dataset.model ||

          '';

        const encodedColor =
          node.dataset.color ||

          node.dataset
            .colorNo ||

          node.closest(
            '[data-color]'
          )
            ?.dataset.color ||

          '';

        const encodedSize =
          node.dataset.size ||
          '';

        let visibleSize =
          findVisibleSize(
            node
          );

        if (!visibleSize) {

          visibleSize =
            decodeBase64(
              encodedSize
            ).trim();
        }

        if (!visibleSize) {
          continue;
        }

        const finalSize =
          combineSizeAndSuffix(
            visibleSize,
            suffix
          );

        const variantUrl =
          node.dataset
            .variantUrl ||

          row.querySelector(
            `[data-size="${
              cssEscape(
                encodedSize
              )
            }"][data-variant-url]`
          )
            ?.dataset
            .variantUrl ||

          buildVariantURL(
            encodedModel,
            encodedColor,
            encodedSize
          );

        const key =
          `${finalSize}|${variantUrl}`;

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);

        result.push({
          model,
          color,
          rawStyle,
          suffix,

          size:
            finalSize,

          visibleSize,

          encodedModel,
          encodedColor,
          encodedSize,
          variantUrl
        });
      }
    }

    /*
     * Fallback voor matrixversies
     * zonder style_row.
     */

    if (
      !result.length
    ) {

      const nodes =
        $$(
          '[data-variant-url][data-size], ' +
          '.variant-info[data-size]'
        );

      for (
        const node
        of nodes
      ) {

        const encodedSize =
          node.dataset.size ||
          '';

        const visibleSize =
          findVisibleSize(
            node
          ) ||

          decodeBase64(
            encodedSize
          ).trim();

        if (!visibleSize) {
          continue;
        }

        const variantUrl =
          node.dataset
            .variantUrl ||
          '';

        const key =
          `${visibleSize}|${variantUrl}`;

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);

        result.push({
          model,
          color,

          rawStyle:
            color,

          suffix:
            '',

          size:
            visibleSize,

          visibleSize,

          encodedModel:
            node.dataset.model ||
            node.dataset.modelNo ||
            '',

          encodedColor:
            node.dataset.color ||
            node.dataset.colorNo ||
            '',

          encodedSize,

          variantUrl
        });
      }
    }

    result.sort(
      (a, b) =>
        a.size.localeCompare(
          b.size,
          undefined,
          {
            numeric: true,
            sensitivity: 'base'
          }
        )
    );

    return result;
  }

  function findVisibleSize(
    node
  ) {

    const cell =
      node.closest(
        '.sizes-el.cell.size'
      ) ||

      node.closest(
        '.cell.size'
      ) ||

      node.closest(
        '.size'
      );

    const titled =
      cell?.querySelector(
        'span[title]'
      );

    if (
      titled
        ?.getAttribute(
          'title'
        )
    ) {

      return titled
        .getAttribute(
          'title'
        )
        .trim();
    }

    const top =
      cell?.querySelector(
        '.cell-top span, ' +
        '.top span'
      );

    if (
      top?.textContent
    ) {

      return top
        .textContent
        .replace(
          /\([^)]*\)/g,
          ''
        )
        .trim();
    }

    return '';
  }

  function combineSizeAndSuffix(
    size,
    suffix
  ) {

    size =
      String(
        size ||
        ''
      ).trim();

    suffix =
      String(
        suffix ||
        ''
      )
        .trim()
        .toUpperCase();

    if (
      !suffix ||
      !/^[A-Z]{1,3}$/
        .test(suffix)
    ) {
      return size;
    }

    if (
      size
        .toUpperCase()
        .endsWith(
          suffix
        )
    ) {
      return size;
    }

    return (
      `${size}${suffix}`
    );
  }

  function buildVariantURL(
    encodedModel,
    encodedColor,
    encodedSize
  ) {

    if (
      !encodedModel ||
      !encodedColor ||
      !encodedSize
    ) {
      return '';
    }

    return (
      `${location.origin}` +
      `/nl/catalog/variant-modal/` +
      `${encodeURIComponent(
        encodedModel
      )}/` +
      `${encodeURIComponent(
        encodedColor
      )}/` +
      `${encodeURIComponent(
        encodedSize
      )}`
    );
  }

  async function copySizes(
    color
  ) {

    const variants =
      getActiveVariants(
        color
      );

    const sizes =
      unique(
        variants.map(
          v => v.size
        )
      );

    if (!sizes.length) {
      throw new Error(
        'Geen maten gevonden in de actieve matrix.'
      );
    }

    const supplierId =
      buildCode(
        getModelNo(),
        color
      );

    const payload = {
      source:
        SUPPLIER,

      orderId:
        false,

      supplierId,

      sizes
    };

    await writeClipboard(
      DDO_EDI.sizesClipboard(SUPPLIER, supplierId, sizes)
    );

    setStatus(
      `${supplierId}: ${sizes.length} maten gekopieerd.`
    );
  }

  // ============================================================
  // EAN
  // ============================================================

  async function copyEAN(
    color
  ) {

    const variants =
      getActiveVariants(
        color
      );

    if (
      !variants.length
    ) {
      throw new Error(
        'Geen varianten gevonden in de actieve matrix.'
      );
    }

    const supplierId =
      buildCode(
        getModelNo(),
        color
      );

    const rows = [];
    const seen =
      new Set();

    setStatus(
      `${supplierId}: EAN ophalen (0/${variants.length})…`
    );

    for (
      let i = 0;
      i < variants.length;
      i++
    ) {

      const variant =
        variants[i];

      const ean =
        await fetchEAN(
          variant.variantUrl
        );

      if (ean) {

        const key =
          `${variant.size}|${ean}`;

        if (
          !seen.has(key)
        ) {

          seen.add(key);

          rows.push({size: variant.size, ean});
        }
      }

      setStatus(
        `${supplierId}: EAN ophalen (${i + 1}/${variants.length})…`
      );
    }

    if (
      !rows.length
    ) {
      throw new Error(
        'Geen EAN-codes gevonden.'
      );
    }

    await writeClipboard(
      DDO_EDI.eanTSV(rows, supplierId)
    );

    setStatus(
      `${supplierId}: ${rows.length} EAN-regels gekopieerd.`
    );
  }

  async function fetchEAN(
    url
  ) {

    if (!url) {
      return '';
    }

    if (
      state.eanCache
        .has(url)
    ) {
      return state
        .eanCache
        .get(url);
    }

    const response =
      await fetch(
        url,
        {
          credentials:
            'include',

          headers: {
            'X-Requested-With':
              'XMLHttpRequest'
          }
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `EAN endpoint HTTP ${response.status}`
      );
    }

    const html =
      await response.text();

    const ean = DDO_EDI.parseEAN(html);

    state.eanCache
      .set(
        url,
        ean
      );

    return ean;
  }

  // ============================================================
  // PHOTOS
  // ============================================================

  async function downloadPhotos(
    color
  ) {

    const model =
      getModelNo();

    const urls =
      await getOriginalImageURLs(
        model,
        color
      );

    if (
      !urls.length
    ) {

      throw new Error(
        `Geen foto's gevonden voor ${model}-${color}.`
      );
    }

    setStatus(
      `${model}-${color}: ${urls.length} originele foto's gevonden.`
    );

    urls.forEach(
      (url, index) => {

        const filename =
          getFilenameFromURL(
            url
          ) ||

          `${model}_${color}_${
            String(
              index + 1
            ).padStart(
              2,
              '0'
            )
          }.jpg`;

        setTimeout(
          () => {

            if (
              typeof GM_download ===
              'function'
            ) {

              GM_download({
                url,
                name:
                  filename,

                saveAs:
                  false,

                onerror:
                  error =>
                    console.error(
                      `[${APP}] Download fout`,
                      url,
                      error
                    )
              });

            } else {

              const a =
                document.createElement(
                  'a'
                );

              a.href =
                url;

              a.download =
                filename;

              a.target =
                '_blank';

              a.rel =
                'noopener';

              document.body
                .appendChild(a);

              a.click();

              a.remove();
            }

          },
          index * 180
        );
      }
    );

    return urls.length;
  }

  async function getOriginalImageURLs(
    model,
    color
  ) {

    const urls =
      new Set();

    /*
     * 1. Thumbnails op de
     * huidige productpagina.
     */

    $$(
      '.image-thumbs [data-color]'
    )
      .forEach(
        item => {

          if (
            normalizeColor(
              item.dataset.color
            ) !== color
          ) {
            return;
          }

          const candidates = [
            item.dataset.src,

            $('img', item)
              ?.dataset.src,

            $('img', item)
              ?.src
          ];

          candidates.forEach(
            url => {

              const original =
                normalizeOriginalImageURL(
                  url
                );

              if (
                original &&
                isProductImage(
                  original,
                  model
                )
              ) {

                urls.add(
                  original
                );
              }
            }
          );
        }
      );

    /*
     * 2. Main image indien
     * actieve kleur.
     */

    if (
      getActiveBaseColor() ===
      color
    ) {

      const main =
        normalizeOriginalImageURL(
          $('.main-detail-image')
            ?.src
        );

      if (
        main &&
        isProductImage(
          main,
          model
        )
      ) {

        urls.add(main);
      }
    }

    /*
     * 3. LingaDore zoomImages
     * endpoint.
     */

    try {

      const zoomURL =
        `${location.origin}` +
        `/nl/catalog/zoomImages/` +
        `${encodeURIComponent(
          model
        )}/` +
        `${encodeURIComponent(
          color
        )}`;

      const response =
        await fetch(
          zoomURL,
          {
            credentials:
              'include',

            headers: {
              'X-Requested-With':
                'XMLHttpRequest'
            }
          }
        );

      if (
        response.ok
      ) {

        const html =
          await response.text();

        const doc =
          new DOMParser()
            .parseFromString(
              html,
              'text/html'
            );

        $$(
          'img, [data-src], [href]',
          doc
        )
          .forEach(
            el => {

              [
                el.getAttribute(
                  'src'
                ),

                el.getAttribute(
                  'data-src'
                ),

                el.getAttribute(
                  'href'
                )
              ]
                .forEach(
                  raw => {

                    const original =
                      normalizeOriginalImageURL(
                        raw
                      );

                    if (
                      original &&
                      isProductImage(
                        original,
                        model
                      )
                    ) {

                      urls.add(
                        original
                      );
                    }
                  }
                );
            }
          );

        /*
         * Ook afbeeldingen
         * uit JSON/JS-fragmenten.
         */

        const matches =
          html.match(
            /https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\\\s]*)?/gi
          ) || [];

        matches.forEach(
          raw => {

            const original =
              normalizeOriginalImageURL(
                raw.replace(
                  /\\\//g,
                  '/'
                )
              );

            if (
              original &&
              isProductImage(
                original,
                model
              )
            ) {

              urls.add(
                original
              );
            }
          }
        );
      }

    } catch (error) {

      console.debug(
        `[${APP}] zoomImages fallback niet beschikbaar`,
        error
      );
    }

    return [...urls]
      .sort(
        (a, b) =>
          getFilenameFromURL(a)
            .localeCompare(
              getFilenameFromURL(b),
              undefined,
              {
                numeric: true,
                sensitivity:
                  'base'
              }
            )
      );
  }

  function normalizeOriginalImageURL(
    raw
  ) {

    if (!raw) {
      return '';
    }

    try {

      const url =
        new URL(
          String(raw)
            .replace(
              /&amp;/g,
              '&'
            ),
          location.origin
        );

      if (
        !/\.(?:jpe?g|png|webp)$/i
          .test(
            url.pathname
          )
      ) {
        return '';
      }

      /*
       * width / crop / bgcolor
       * etc. verwijderen.
       *
       * Daarmee vragen we het
       * originele bestand op.
       */

      url.search = '';

      return url.href;

    } catch {
      return '';
    }
  }

  function isProductImage(
    url,
    model
  ) {

    try {

      const pathname =
        new URL(url)
          .pathname;

      return (
        pathname.includes(
          '/media/itemvariants/'
        ) &&

        pathname
          .toUpperCase()
          .includes(
            String(model)
              .toUpperCase()
          )
      );

    } catch {
      return false;
    }
  }

  function getFilenameFromURL(
    url
  ) {

    try {

      return decodeURIComponent(
        new URL(url)
          .pathname
          .split('/')
          .pop() ||
        ''
      );

    } catch {
      return '';
    }
  }

  // ============================================================
  // MODEL CHECK - HANDMATIGE START
  // ============================================================

  async function startModelCheck(
    forceRefresh = false
  ) {

    if (
      state.loading
    ) {
      return;
    }

    try {

      setLoading(true);

      setSummary('');

      setStatus(
        forceRefresh
          ? 'DDO exports opnieuw ophalen…'
          : 'DDO modeldata laden…'
      );

      state.ddoMap =
        await getArticleMap(
          forceRefresh
        );

      state.modelCheckStarted =
        true;

      recheckCurrentPage();

      setStatus(
        `Modelcheck actief · ${state.ddoMap.size} DDO producten geladen.`
      );

    } catch (error) {

      console.error(
        `[${APP}] Modelcheck`,
        error
      );

      state.modelCheckStarted =
        false;

      state.ddoMap =
        null;

      clearGridMarkers();

      setStatus(
        `Modelcheck fout: ${
          error.message ||
          error
        }`
      );

      setSummary('');

    } finally {

      setLoading(false);

      renderPDP();
    }
  }

  function recheckCurrentPage() {

    if (
      !state.modelCheckStarted ||
      !state.ddoMap
    ) {

      setStatus(
        'Klik eerst op Start modelcheck.'
      );

      return;
    }

    if (isPDP()) {

      renderPDP();

      const model =
        getModelNo();

      const colors =
        Array.from(
          getColorSelect()
            ?.options ||
          []
        )
          .filter(
            o => o.value
          )
          .map(
            o =>
              normalizeColor(
                o.value
              )
          )
          .filter(Boolean);

      const matches =
        colors.filter(
          color =>
            getStatusForCode(
              buildCode(
                model,
                color
              )
            ).match
        ).length;

      setSummary(
        `${colors.length} kleuren · ` +
        `${matches} in DDO · ` +
        `${colors.length - matches} ontbreken`
      );

      return;
    }

    runGridCompare();
  }

  function resetModelCheck() {

    clearDDOCache();

    clearGridMarkers();

    state.ddoMap =
      null;

    state.modelCheckStarted =
      false;

    state.eanCache
      .clear();

    setSummary('');

    setStatus(
      'Cache geleegd. Modelcheck staat stil.'
    );

    const recheck =
      $('#edi-recheck');

    if (recheck) {
      recheck.disabled =
        true;
    }

    renderPDP();
  }

  function getStatusForCode(
    code
  ) {

    if (
      !state.ddoMap ||
      !code
    ) {

      return {
        match: false,
        productId: null,
        ddoEditId: null
      };
    }

    const info =
      state.ddoMap.get(
        code
      );

    return info
      ? {
          match: true,

          productId:
            info.productId ||
            null,

          ddoEditId:
            info.ddoEditId ||
            null
        }

      : {
          match: false,
          productId: null,
          ddoEditId: null
        };
  }

  // ============================================================
  // GRID COMPARE
  // ============================================================

  function findProductCards() {

    return $$('.item-wrapper');
  }

  function extractVariantsFromCard(
    card
  ) {

    const item =
      card.matches('.item')
        ? card
        : $('.item', card);

    if (!item) {
      return [];
    }

    const model =
      normalizeModel(
        item.dataset.modelNo ||
        text(
          '.model-no',
          item
        )
      );

    if (!model) {
      return [];
    }

    const variants = [];
    const seen =
      new Set();

    $(
      '.item-colors',
      item
    );

    $$(
      '.item-colors .color[data-color]',
      item
    )
      .forEach(
        el => {

          const color =
            normalizeColor(
              el.dataset.color
            );

          const code =
            buildCode(
              model,
              color
            );

          if (
            !code ||
            seen.has(code)
          ) {
            return;
          }

          seen.add(code);

          variants.push({
            model,
            color,
            code,

            colorName:
              el.getAttribute(
                'title'
              ) || ''
          });
        }
      );

    /*
     * Fallback: thumbnails
     */

    if (
      !variants.length
    ) {

      $$(
        '.image-thumbs [data-color]',
        item
      )
        .forEach(
          el => {

            const color =
              normalizeColor(
                el.dataset.color
              );

            const code =
              buildCode(
                model,
                color
              );

            if (
              !code ||
              seen.has(code)
            ) {
              return;
            }

            seen.add(code);

            variants.push({
              model,
              color,
              code,
              colorName: ''
            });
          }
        );
    }

    /*
     * Laatste fallback:
     * data-style="03-D"
     */

    if (
      !variants.length
    ) {

      const color =
        normalizeColor(
          item.dataset.style
        );

      const code =
        buildCode(
          model,
          color
        );

      if (code) {

        variants.push({
          model,
          color,
          code,
          colorName: ''
        });
      }
    }

    return variants;
  }

  function runGridCompare() {

    clearGridMarkers();

    let cards = 0;

    let complete = 0;

    let partial = 0;

    let missing = 0;

    let variantsTotal = 0;

    let variantsMatch = 0;

    for (
      const card
      of findProductCards()
    ) {

      const variants =
        extractVariantsFromCard(
          card
        );

      if (
        !variants.length
      ) {
        continue;
      }

      cards++;

      const results =
        variants.map(
          variant => ({
            ...variant,

            ...getStatusForCode(
              variant.code
            )
          })
        );

      const matchCount =
        results.filter(
          r => r.match
        ).length;

      variantsTotal +=
        results.length;

      variantsMatch +=
        matchCount;

      let status;

      if (
        matchCount ===
        results.length
      ) {

        status = 'all';

        complete++;

      } else if (
        matchCount > 0
      ) {

        status = 'partial';

        partial++;

      } else {

        status = 'miss';

        missing++;
      }

      markGridCard(
        card,
        status,
        results
      );
    }

    setSummary(
      `Cards ${cards} · ` +
      `compleet ${complete} · ` +
      `deels ${partial} · ` +
      `geen ${missing} · ` +
      `kleuren ${variantsMatch}/${variantsTotal}`
    );
  }

  function markGridCard(
    card,
    status,
    results
  ) {

    card.classList.add(
      'edi-card-checked',
      `edi-card-${status}`
    );

    const matches =
      results.filter(
        r => r.match
      ).length;

    const badge =
      document.createElement(
        'div'
      );

    badge.className =
      'edi-grid-badge';

    badge.textContent =
      `${matches}/${results.length} in DDO`;

    card.appendChild(
      badge
    );

    const box =
      document.createElement(
        'div'
      );

    box.className =
      'edi-grid-results';

    results.forEach(
      result => {

        const id =
          result.productId ||
          result.ddoEditId;

        const el =
          result.match &&
          id

            ? document.createElement(
                'a'
              )

            : document.createElement(
                'span'
              );

        el.className =
          `edi-grid-pill ${
            result.match
              ? 'edi-ok'
              : ''
          }`;

        el.textContent =
          result.match

            ? `✓ ${result.color}${
                id
                  ? ` · ${id}`
                  : ''
              }`

            : `× ${result.color}`;

        el.title =
          `${result.code}${
            result.colorName
              ? ` · ${result.colorName}`
              : ''
          }`;

        if (
          el.tagName ===
          'A'
        ) {

          el.href =
            buildDDOEditUrl(
              id
            );

          el.target =
            '_blank';

          el.rel =
            'noopener';
        }

        box.appendChild(
          el
        );
      }
    );

    card.appendChild(
      box
    );
  }

  function clearGridMarkers() {

    $$('.edi-card-checked')
      .forEach(
        card => {

          card.classList.remove(
            'edi-card-checked',
            'edi-card-all',
            'edi-card-partial',
            'edi-card-miss'
          );

          $$(
            ':scope > .edi-grid-badge, ' +
            ':scope > .edi-grid-results',
            card
          )
            .forEach(
              el =>
                el.remove()
            );
        }
      );
  }

  // ============================================================
  // DDO EXPORT + CACHE
  // ============================================================

  async function getArticleMap(
    forceRefresh = false
  ) {

    if (
      !forceRefresh
    ) {

      const cached =
        readDDOCache();

      if (cached) {

        return new Map(
          cached
        );
      }
    }

    const maps =
      await Promise.all(

        DDO_BRAND_IDS.map(
          async brandId => {

            setStatus(
              `DDO export merk ${brandId} ophalen…`
            );

            const buffer =
              await fetchExport(
                buildBrandExportURL(
                  brandId
                ),
                EXPORT_PAYLOAD
              );

            return (
              parseArticleMapFromWorkbook(
                buffer
              )
            );
          }
        )
      );

    const merged =
      new Map();

    for (
      const map
      of maps
    ) {

      for (
        const [code, info]
        of map.entries()
      ) {

        if (
          !merged.has(code)
        ) {

          merged.set(
            code,
            info
          );
        }
      }
    }

    if (
      !merged.size
    ) {

      throw new Error(
        'Geen bruikbare DDO Product ID koppelingen gevonden.'
      );
    }

    writeDDOCache(
      [...merged.entries()]
    );

    return merged;
  }

  function buildBrandExportURL(
    brandId
  ) {

    return (
      'https://www.dutchdesignersoutlet.com/' +
      'admin.php?section=products' +
      '&action=list' +
      '&filter=brand_id' +
      `&id=${encodeURIComponent(
        brandId
      )}`
    );
  }

  function fetchExport(
    url,
    payload
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        GM_xmlhttpRequest({

          method:
            'POST',

          url,

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },

          data:
            new URLSearchParams(
              payload
            ).toString(),

          responseType:
            'arraybuffer',

          timeout:
            60000,

          onload:
            response => {

              if (
                response.status !==
                200
              ) {

                reject(
                  new Error(
                    `DDO export HTTP ${response.status}`
                  )
                );

                return;
              }

              if (
                !response.response
                  ?.byteLength
              ) {

                reject(
                  new Error(
                    'Lege DDO export ontvangen.'
                  )
                );

                return;
              }

              resolve(
                response.response
              );
            },

          onerror:
            () =>
              reject(
                new Error(
                  'Netwerkfout bij DDO export.'
                )
              ),

          ontimeout:
            () =>
              reject(
                new Error(
                  'Timeout bij DDO export.'
                )
              )

        });
      }
    );
  }

  function parseArticleMapFromWorkbook(
    arrayBuffer
  ) {

    let workbook;

    try {

      workbook =
        XLSX.read(
          arrayBuffer,
          {
            type: 'array'
          }
        );

    } catch {

      throw new Error(
        'DDO Excel-export kon niet worden gelezen.'
      );
    }

    const sheetNames =
      workbook.SheetNames ||
      [];

    const ordered = [

      ...(
        sheetNames.includes(
          SHEET_PREFERRED
        )
          ? [SHEET_PREFERRED]
          : []
      ),

      ...sheetNames.filter(
        name =>
          name !==
          SHEET_PREFERRED
      )
    ];

    let best =
      new Map();

    for (
      const sheetName
      of ordered
    ) {

      const sheet =
        workbook.Sheets[
          sheetName
        ];

      if (!sheet) {
        continue;
      }

      const rows =
        XLSX.utils
          .sheet_to_json(
            sheet,
            {
              header: 1,
              raw: false,
              defval: '',
              blankrows: false
            }
          );

      const map =
        new Map();

      for (
        let r =
          HEADER_ROW_INDEX + 1;

        r < rows.length;

        r++
      ) {

        const row =
          Array.isArray(
            rows[r]
          )
            ? rows[r]
            : [];

        const rawImage =
          row[
            COL_IMAGE
          ];

        const rawProductId =
          row[
            COL_PRODUCT_ID
          ];

        if (
          rawProductId == null ||
          rawProductId === ''
        ) {
          continue;
        }

        const code =
          normalizeDDOProductCode(
            rawProductId
          );

        if (!code) {
          continue;
        }

        map.set(
          code,
          {

            ddoEditId:
              extractDDOEditIdFromImageField(
                rawImage
              ),

            productId:
              extractProductIdFromImageField(
                rawImage
              )
          }
        );
      }

      if (
        map.size >
        best.size
      ) {

        best =
          map;
      }

      if (
        sheetName ===
          SHEET_PREFERRED &&
        map.size
      ) {

        break;
      }
    }

    if (
      !best.size
    ) {

      throw new Error(
        'Geen bruikbare Product ID koppelingen in DDO export.'
      );
    }

    return best;
  }

  function extractDDOEditIdFromImageField(
    imageField
  ) {

    const first =
      String(
        imageField ??
        ''
      )
        .trim()
        .split('|')[0]
        .trim();

    if (
      !first.startsWith(
        IMAGE_PREFIX
      )
    ) {

      return null;
    }

    return (
      first
        .slice(
          IMAGE_PREFIX.length
        )
        .match(
          /^(\d{5,6})/
        )
        ?.[1] ||

      null
    );
  }

  function extractProductIdFromImageField(
    imageField
  ) {

    const first =
      String(
        imageField ??
        ''
      )
        .trim()
        .split('|')[0]
        .trim();

    if (
      !first.startsWith(
        IMAGE_PREFIX
      )
    ) {

      return null;
    }

    return (
      first
        .slice(
          IMAGE_PREFIX.length
        )
        .match(
          /^(\d{5})/
        )
        ?.[1] ||

      null
    );
  }

  function buildDDOEditUrl(
    productId
  ) {

    return (
      'https://www.dutchdesignersoutlet.com/' +
      'admin.php?section=products&action=edit' +
      `&id=${encodeURIComponent(
        productId
      )}`
    );
  }

  function readDDOCache() {

    try {

      const raw =
        localStorage.getItem(
          `${CACHE_PREFIX}:map`
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !parsed ||
        !Array.isArray(
          parsed.data
        ) ||
        !Number.isFinite(
          parsed.ts
        ) ||
        Date.now() -
          parsed.ts >
          CACHE_TTL_MS
      ) {

        localStorage.removeItem(
          `${CACHE_PREFIX}:map`
        );

        return null;
      }

      return parsed.data;

    } catch {

      return null;
    }
  }

  function writeDDOCache(
    data
  ) {

    try {

      localStorage.setItem(
        `${CACHE_PREFIX}:map`,
        JSON.stringify({
          ts:
            Date.now(),

          data
        })
      );

    } catch (error) {

      console.warn(
        `[${APP}] Cache schrijven mislukt`,
        error
      );
    }
  }

  function clearDDOCache() {

    Object.keys(
      localStorage
    )
      .filter(
        key =>
          key.startsWith(
            CACHE_PREFIX
          )
      )
      .forEach(
        key =>
          localStorage
            .removeItem(key)
      );
  }

  // ============================================================
  // OBSERVER
  // ============================================================

  function startObserver() {

    state.observer
      ?.disconnect();

    state.observer =
      new MutationObserver(
        mutations => {

          const relevant =
            mutations.some(
              mutation =>

                [
                  ...mutation.addedNodes,
                  ...mutation.removedNodes
                ]
                  .some(
                    node => {

                      if (
                        node.nodeType !==
                        Node.ELEMENT_NODE
                      ) {
                        return false;
                      }

                      const el =
                        node;

                      if (
                        el.id ===
                          'edi-lingadore' ||

                        el.closest?.(
                          '#edi-lingadore'
                        )
                      ) {

                        return false;
                      }

                      return (
                        el.matches?.(
                          '.matrix-filters, ' +
                          '.item-colors, ' +
                          '.ordermatrix-wrapper, ' +
                          '.item-wrapper, ' +
                          '.image-thumbs'
                        ) ||

                        el.querySelector?.(
                          '.matrix-filters, ' +
                          '.item-colors, ' +
                          '.ordermatrix-wrapper, ' +
                          '.item-wrapper, ' +
                          '.image-thumbs'
                        )
                      );
                    }
                  )
            );

          if (!relevant) {
            return;
          }

          clearTimeout(
            state.renderTimer
          );

          state.renderTimer =
            setTimeout(
              () => {

                if (isPDP()) {

                  renderPDP();

                } else if (
                  state.modelCheckStarted &&
                  state.ddoMap
                ) {

                  runGridCompare();
                }

              },
              180
            );
        }
      );

    state.observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  // ============================================================
  // ESCAPING
  // ============================================================

  function escapeHTML(value) {

    return String(
      value ??
      ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }

  function escapeAttr(value) {

    return escapeHTML(
      value
    );
  }

  function cssEscape(value) {

    if (
      window.CSS?.escape
    ) {

      return CSS.escape(
        String(value)
      );
    }

    return String(value)
      .replace(
        /["\\]/g,
        '\\$&'
      );
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {

    injectCSS();

    createPanel();

    startObserver();

    renderPDP();

    /*
     * Modelcheck start
     * nadrukkelijk NIET
     * automatisch.
     */

    console.info(
      `[${APP}] v${VERSION} klaar. ` +
      'Modelcheck wacht op startsignaal.'
    );
  }

  init();

})();
})();
