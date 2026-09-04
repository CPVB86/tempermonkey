// ==UserScript==
// @name         Stock Check | Chantelle & Femilet
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.2
// @description  Vergelijk de lokale voorraad van Chantelle en Femilet met de leverancier.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @match        https://chantelle-lingerie.my.site.com/DefaultStore/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_info
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-chantelle.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-chantelle.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL      = location.hostname.includes('lingerieoutlet.nl');
  const ON_CHANTELLE = location.hostname.includes('chantelle-lingerie.my.site.com');

  const g    = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const Core = g.VCPCore;
  const SR   = g.StockRules;

  function registerUserscript() {
    const detail = {
      id: 'stock-check-chantelle',
      name: 'Stock Check | Chantelle & Femilet',
      version: typeof GM_info !== 'undefined'
        ? GM_info.script.version
        : '5.2'
    };

    g.__stockCheckUserscripts =
      g.__stockCheckUserscripts ||
      Object.create(null);

    g.__stockCheckUserscripts[detail.id] = detail;

    try {
      g.dispatchEvent(
        new g.CustomEvent(
          'stockcheck:userscript-register',
          { detail }
        )
      );
    } catch {}
  }


  // =====================================================================
  // BRIDGE
  // =====================================================================

  const BRIDGE_KEY    = 'chantelle_vcp2_bridge';
  const REQ_KEY       = `${BRIDGE_KEY}_req`;
  const RESP_KEY      = `${BRIDGE_KEY}_resp`;
  const HEARTBEAT_KEY = `${BRIDGE_KEY}_hb`;

  const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  const uid = () =>
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  const $ = (s, r = document) =>
    r.querySelector(s);


  const TIMEOUT_MS = 75000;

  // Tool-side verwerking.
  const CHECK_CONCURRENCY = 4;
  const CHECK_BATCH_SIZE = 120;
  const CHECK_BATCH_DELAY_MS = 650;

  // Maximaal aantal getStock RPC's in één /apexremote POST.
  const APEX_BATCH_SIZE = 50;

  // Zelfde SKU gedurende 15 minuten niet opnieuw opvragen.
  const STOCK_CACHE_TTL_MS =
    15 * 60 * 1000;

  const LOG_SIZE_REPORTS = false;


  // =====================================================================
  // TOOL PREREQUISITES
  // =====================================================================

  if (ON_TOOL) {
    if (!Core) {
      console.error(
        '[VCP2|Chantelle] VCPCore ontbreekt. Check @require vcp-core.js'
      );
      return;
    }

    if (
      !SR ||
      typeof SR.mapRemoteToTarget !== 'function' ||
      typeof SR.reconcile !== 'function'
    ) {
      console.error(
        '[VCP2|Chantelle] StockRules ontbreekt/incompleet. ' +
        'Vereist: mapRemoteToTarget + reconcile'
      );
      return;
    }
  }


  // =====================================================================
  // SIZE NORMALIZATION
  // =====================================================================

  function normSize(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .trim();
  }


  function normalizeSizeKey(raw) {
    let v = String(raw ?? '').trim();

    if (!v) return '';

    // Alternatieven met | of , afkappen.
    // Slash-maten zoals XS/S blijven bestaan.
    v = v.split(/[|,]/)[0];

    v = normSize(v);

    if (!v) return '';

    const namedSizes = {
      EXTRASMALL: 'XS',
      XSMALL: 'XS',
      SMALL: 'S',
      MEDIUM: 'M',
      LARGE: 'L',
      EXTRALARGE: 'XL',
      XLARGE: 'XL',
      EXTRAEXTRALARGE: '2XL',
      XXLARGE: '2XL',
      XXLarge: '2XL'
    };

    if (namedSizes[v]) {
      return namedSizes[v];
    }

    // Langste eerst.
    v = v.replace(/XXXXL/g, '4XL');
    v = v.replace(/XXXL/g, '3XL');
    v = v.replace(/XXL/g, '2XL');

    const combined = v.match(
      /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)[\/-](XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)$/
    );

    if (combined) {
      return `${combined[1]}/${combined[2]}`;
    }

    if (
      /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)\/(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)$/.test(v)
    ) {
      return v;
    }

    if (
      /^(NOSIZE|ONESIZE|ONE SIZE|ONE-SIZE|OS|TU)$/.test(v)
    ) {
      return 'TU';
    }

    let m = v.match(
      /^0*(\d{2,3})([A-Z]{1,4})$/
    );

    if (m) {
      return `${parseInt(m[1], 10)}${m[2]}`;
    }

    if (/^0*\d{1,3}$/.test(v)) {
      const n = parseInt(v, 10);

      return (
        Number.isFinite(n) &&
        n > 0
      )
        ? String(n)
        : '';
    }

    if (
      /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|TU)$/.test(v)
    ) {
      return v;
    }

    return v;
  }


  function isSizeLabel(s) {
    const v = normalizeSizeKey(s);

    if (!v) return false;

    if (/^\d{2,3}[A-Z]{1,4}$/.test(v)) {
      return true;
    }

    if (/^\d{1,3}$/.test(v)) {
      return true;
    }

    if (
      /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|TU)$/.test(v)
    ) {
      return true;
    }

    if (
      /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)\/(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL)$/.test(v)
    ) {
      return true;
    }

    return false;
  }


  function isAlphaApparelSize(s) {
    const v = normalizeSizeKey(s);

    return /^(XXXS|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|6XL|TU)$/.test(v);
  }


  // =====================================================================
  // LOGGER
  // =====================================================================

  const Logger = {

    lb() {
      return (
        typeof unsafeWindow !== 'undefined' &&
        unsafeWindow.logboek
      )
        ? unsafeWindow.logboek
        : window.logboek;
    },


    status(anchorId, txt) {
      const lb = this.lb();

      if (lb?.resultaat) {
        lb.resultaat(
          String(anchorId),
          String(txt),
          { autoJump: false }
        );
      } else {
        console.info(
          `[Chantelle][${anchorId}] status: ${txt}`
        );
      }
    },


    perMaat(anchorId, report) {
      if (!LOG_SIZE_REPORTS) return;

      console.groupCollapsed(
        `[Chantelle][${anchorId}] maatvergelijking`
      );

      try {
        console.table(
          report.map(r => ({
            maat: r.maat,
            local: r.local,
            remote: r.remoteRaw ?? '—',
            target: Number.isFinite(r.target)
              ? r.target
              : '—',
            delta: Number.isFinite(r.delta)
              ? r.delta
              : '—',
            status: r.status
          }))
        );
      } finally {
        console.groupEnd();
      }
    }
  };


  // =====================================================================
  // TOOL-SIDE BRIDGE
  // =====================================================================

  function bridgeRequest(
    payload,
    timeoutMs = TIMEOUT_MS
  ) {

    const id = uid();

    return new Promise(
      (resolve, reject) => {

        let handle =
          GM_addValueChangeListener(
            RESP_KEY,
            (_n, _o, msg) => {

              if (
                !msg ||
                msg.id !== id
              ) {
                return;
              }

              try {
                GM_removeValueChangeListener(
                  handle
                );
              } catch {}

              msg.ok
                ? resolve(msg)
                : reject(
                    new Error(
                      msg.error ||
                      'bridge error'
                    )
                  );
            }
          );


        GM_setValue(
          REQ_KEY,
          Object.assign(
            {},
            payload,
            {
              id,
              timeout: timeoutMs
            }
          )
        );


        setTimeout(() => {
          try {
            GM_removeValueChangeListener(
              handle
            );
          } catch {}

          reject(
            new Error(
              'bridge timeout'
            )
          );

        }, timeoutMs + 1500);
      }
    );
  }


  function bridgeOnline(
    maxAgeMs = 6000
  ) {
    try {
      const t =
        GM_getValue(
          HEARTBEAT_KEY,
          0
        );

      return (
        t &&
        (
          Date.now() - t
        ) < maxAgeMs
      );

    } catch {
      return false;
    }
  }


  // =====================================================================
  // TOOL-SIDE TABLE READER
  // =====================================================================

  function readLocalTable(table) {
    const rows =
      Array.from(
        table.querySelectorAll(
          'tbody tr'
        )
      );

    const out = [];

    for (const tr of rows) {

      const maatRaw =
        tr.dataset.size ||
        tr.children?.[0]?.textContent ||
        '';

      const maat =
        normalizeSizeKey(
          maatRaw
        );

      if (!maat) continue;

      const local =
        parseInt(
          String(
            tr.children?.[1]?.textContent ||
            ''
          ).trim(),
          10
        ) || 0;

      out.push({
        tr,
        maat,
        local
      });
    }

    return out;
  }


  function getSkuFromTable(table) {
    const id =
      String(
        table.id ||
        ''
      ).trim();

    if (id) {
      return id;
    }

    const label =
      table
        .querySelector(
          'thead th[colspan]'
        )
        ?.textContent
        ?.trim() ||
      '';

    const m =
      label.match(
        /\b[A-Z0-9]{3,}-[A-Z0-9]{2,}\b/
      );

    return m
      ? m[0]
      : '';
  }


  // =====================================================================
  // CENTRAL STOCKRULES
  // =====================================================================

  function applyCompareAndMark(
    localRows,
    stockMap
  ) {

    const report = [];


    for (
      const { tr }
      of localRows
    ) {
      Core.clearRowMarks(tr);
    }


    for (
      const {
        tr,
        maat,
        local
      }
      of localRows
    ) {

      const hasRemoteSize =
        Object.prototype
          .hasOwnProperty
          .call(
            stockMap,
            maat
          );


      const remoteRaw =
        hasRemoteSize
          ? String(
              stockMap[maat] ??
              ''
            ).trim()
          : '0';


      let target;

      try {
        target =
          SR.mapRemoteToTarget(
            'chantelle',
            remoteRaw,
            5
          );

      } catch (e) {

        console.warn(
          '[VCP2|Chantelle] mapRemoteToTarget failed for',
          maat,
          remoteRaw,
          e
        );

        target = 0;
      }


      const res =
        SR.reconcile(
          local,
          target,
          5
        );


      const delta =
        res.delta ||
        0;


      let status =
        'ok';


      if (
        res.action === 'bijboeken' &&
        delta > 0
      ) {

        Core.markRow(
          tr,
          {
            action: 'add',
            delta,
            title:
              `Bijboeken ${delta} ` +
              `(target ${target}, remote ${remoteRaw})`
          }
        );

        status =
          'bijboeken';


      } else if (
        res.action === 'uitboeken' &&
        delta > 0
      ) {

        Core.markRow(
          tr,
          {
            action: 'remove',
            delta,
            title:
              `Uitboeken ${delta} ` +
              `(target ${target}, remote ${remoteRaw})`
          }
        );

        status =
          'uitboeken';


      } else {

        Core.markRow(
          tr,
          {
            action: 'none',
            delta: 0,
            title:
              `OK ` +
              `(target ${target}, remote ${remoteRaw})`
          }
        );

        status =
          'ok';
      }


      report.push({
        maat,
        local,
        remoteRaw,
        target,
        delta,
        status
      });
    }


    return report;
  }


  function bepaalStatus(
    report,
    stockMap
  ) {

    if (
      !stockMap ||
      Object.keys(
        stockMap
      ).length === 0
    ) {
      return 'niet-gevonden';
    }


    const diffs =
      report.filter(
        r =>
          r.status === 'bijboeken' ||
          r.status === 'uitboeken'
      ).length;


    return diffs === 0
      ? 'ok'
      : 'afwijking';
  }


async function perTableWithBatchResult(
  table,
  stockMap,
  failed = false
) {

  const sku =
    getSkuFromTable(table);


  const label =
    table
      .querySelector('thead th[colspan]')
      ?.textContent
      ?.trim() ||
    sku ||
    'onbekend';


  const anchorId =
    sku ||
    label;


  if (!sku) {

    Logger.status(
      anchorId,
      'niet-gevonden'
    );

    return 0;
  }


  const localRows =
    readLocalTable(table);


  // ===============================================================
  // BELANGRIJK:
  // Geen geldig supplier-resultaat = uit veiligheid behandelen als
  // leveranciervoorraad 0 voor alle lokaal aanwezige maten.
  // ===============================================================

  if (
    failed ||
    !stockMap ||
    Object.keys(stockMap).length === 0
  ) {

    const fallbackReport =
      applyCompareAndMark(
        localRows,
        {}
      );


    const fallbackMutationCount =
      fallbackReport.filter(
        r =>
          r.status === 'bijboeken' ||
          r.status === 'uitboeken'
      ).length;


    Logger.status(
      anchorId,
      fallbackMutationCount > 0
        ? 'afwijking'
        : 'ok'
    );


    Logger.perMaat(
      anchorId,
      fallbackReport
    );


    console.warn(
      `[Chantelle][${sku}] geen geldig stockresultaat; ` +
      `behandeld als 0-stock | ` +
      `${fallbackMutationCount} maten uitboeken`
    );


    return fallbackMutationCount;
  }


  const report =
    applyCompareAndMark(
      localRows,
      stockMap
    );


  Logger.status(
    anchorId,
    bepaalStatus(
      report,
      stockMap
    )
  );


  Logger.perMaat(
    anchorId,
    report
  );


  return report.filter(
    r =>
      r.status === 'bijboeken' ||
      r.status === 'uitboeken'
  ).length;
}


  // =====================================================================
  // COLLECT ALL SKU'S BEFORE REQUEST
  // =====================================================================

  function collectBatchItems(
    tables
  ) {

    const bySku =
      new Map();


    for (
      const table
      of tables
    ) {

      const sku =
        getSkuFromTable(
          table
        );

      if (!sku) continue;


      const sizes =
        readLocalTable(
          table
        )
          .map(
            r => r.maat
          )
          .filter(
            isSizeLabel
          );


      if (
        !bySku.has(
          sku
        )
      ) {
        bySku.set(
          sku,
          new Set()
        );
      }


      const set =
        bySku.get(
          sku
        );


      for (
        const size
        of sizes
      ) {
        set.add(
          normalizeSizeKey(
            size
          )
        );
      }
    }


    return Array.from(
      bySku,
      ([sku, sizes]) => ({
        sku,
        sizes:
          Array.from(
            sizes
          )
      })
    );
  }


  function chunkArray(
    arr,
    size
  ) {

    const out =
      [];


    for (
      let i = 0;
      i < arr.length;
      i += size
    ) {

      out.push(
        arr.slice(
          i,
          i + size
        )
      );
    }


    return out;
  }


  // =====================================================================
  // RUN
  // =====================================================================

 async function run(btn) {

  const tables =
    Array.from(
      document.querySelectorAll(
        '#output table'
      )
    );


  if (!tables.length) {
    return;
  }


  if (!bridgeOnline()) {

    alert(
      'Chantelle-bridge offline.\n' +
      'Open een Chantelle PDP-tab ' +
      '(chantelle-lingerie.my.site.com), refresh 1x,\n' +
      'en probeer opnieuw.'
    );

    return;
  }


  const items =
    collectBatchItems(
      tables
    );


  if (!items.length) {
    return;
  }


  console.info(
    `[Chantelle] ${items.length} unieke SKU's te controleren`
  );


  // ===============================================================
  // ÉÉN DEFERRED PROMISE PER SKU
  //
  // Core.runTables kan hierdoor gewoon blijven draaien.
  // Zodra een supplier-batch klaar is, worden de promises van
  // precies die SKU's opgelost en verschijnen de cardupdates.
  // ===============================================================

  const deferredBySku =
    new Map();


  function createDeferred() {

    let resolve;

    const promise =
      new Promise(
        res => {
          resolve = res;
        }
      );


    return {
      promise,
      resolve
    };
  }


  for (
    const item
    of items
  ) {

    deferredBySku.set(
      item.sku,
      createDeferred()
    );
  }


  // ===============================================================
  // BATCH DRIVER
  //
  // BELANGRIJK:
  // Iedere 50 SKU's krijgen hun EIGEN bridgeRequest.
  // Daardoor heeft iedere supplier-call opnieuw 75 sec timeout.
  // ===============================================================

  const batches =
    chunkArray(
      items,
      APEX_BATCH_SIZE
    );


  const batchDriver =
    (async () => {

      let batchNr =
        0;


      for (
        const batch
        of batches
      ) {

        batchNr++;


        console.info(
          `[Chantelle] bridge batch ${batchNr}/${batches.length} ` +
          `(${batch.length} SKU's)`
        );


        try {

          const resp =
            await bridgeRequest(
              {
                mode:
                  'stockBatch',

                items:
                  batch
              },
              TIMEOUT_MS
            );


          const stockBySku =
            resp?.stockBySku ||
            {};


          const failed =
            new Set(
              resp?.failedSkus ||
              []
            );


          let invalidStockResultCount =
            0;


          for (
            const item
            of batch
          ) {

            const sku =
              item.sku;


            const hasResult =
              Object.prototype
                .hasOwnProperty
                .call(
                  stockBySku,
                  sku
                );


            const stockMap =
              hasResult
                ? stockBySku[sku]
                : null;


            const invalidStockResult =
              failed.has(sku) ||
              !stockMap ||
              Object.keys(stockMap).length === 0;


            if (invalidStockResult) {
              invalidStockResultCount++;
            }


            deferredBySku
              .get(sku)
              ?.resolve({
                stockMap:
                  stockMap,

                failed:
                  failed.has(sku) ||
                  !hasResult
              });
          }


          console.info(
            `[Chantelle] ✅ batch ${batchNr}/${batches.length} verwerkt | ` +
            `${invalidStockResultCount} SKU's geen geldig stockresultaat`
          );


        } catch (e) {

          console.error(
            `[Chantelle] batch ${batchNr}/${batches.length} bridge-fout:`,
            e
          );


          // Ook bij een complete batchfout moet Core verder kunnen.
          // Maar ZONDER mutaties.
          for (
            const item
            of batch
          ) {

            deferredBySku
              .get(item.sku)
              ?.resolve({
                stockMap:
                  null,

                failed:
                  true
              });
          }
        }
      }
    })();


  // ===============================================================
  // CORE/UI
  // ===============================================================

  await Core.runTables({

    btn,

    tables,

    concurrency:
      CHECK_CONCURRENCY,

    batchSize:
      CHECK_BATCH_SIZE,

    batchDelayMs:
      CHECK_BATCH_DELAY_MS,

    perTable:
      async table => {

        const sku =
          getSkuFromTable(
            table
          );


        if (!sku) {

          return perTableWithBatchResult(
            table,
            null,
            true
          );
        }


        const deferred =
          deferredBySku.get(
            sku
          );


        if (!deferred) {

          return perTableWithBatchResult(
            table,
            null,
            true
          );
        }


        // -----------------------------------------------------------
        // Deze tabel wacht alleen nog op ZIJN eigen SKU.
        //
        // Zodra de supplier-batch waar deze SKU in zit klaar is,
        // wordt deze card onmiddellijk verwerkt.
        // -----------------------------------------------------------

        const result =
          await deferred.promise;


        return perTableWithBatchResult(
          table,
          result.stockMap,
          result.failed
        );
      }
  });


  await batchDriver;
}


  // =====================================================================
  // SUPPLIER SELECT
  // =====================================================================

  function normBlob(s = '') {
    return String(s)
      .toLowerCase()
      .trim()
      .replace(
        /[-_]+/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      );
  }


  function isChantelleSelected() {

    const sel =
      $('#leverancier-keuze');


    if (!sel) {
      return true;
    }


    const byValue =
      normBlob(
        sel.value ||
        ''
      );


    const byText =
      normBlob(
        sel.options?.[
          sel.selectedIndex
        ]?.text ||
        ''
      );


    return (
      /^(chantelle|femilet)(?:\s|$)/.test(
        byValue
      ) ||
      /\b(chantelle|femilet)\b/.test(
        byText
      )
    );
  }


  // =====================================================================
  // HEARTBEAT BADGE
  // =====================================================================

  function installHeartbeatBadge(
    btn
  ) {

    if (
      !btn ||
      btn.querySelector(
        '.supplier-bridge-badge'
      )
    ) {
      return;
    }


    btn.style.position =
      'relative';


    const badge =
      document.createElement(
        'span'
      );


    badge.className =
      'supplier-bridge-badge';


    badge.setAttribute(
      'aria-hidden',
      'true'
    );


    const setBadge =
      ok =>
        badge.classList.toggle(
          'is-online',
          !!ok
        );


    setBadge(
      bridgeOnline()
    );


    btn.appendChild(
      badge
    );


    try {
      GM_addValueChangeListener(
        HEARTBEAT_KEY,
        () => setBadge(true)
      );
    } catch {}
  }


  // =====================================================================
  // WORKER
  // =====================================================================
  //
  // Draait uitsluitend op de Chantelle-tab.
  //
  // In tegenstelling tot v4.x roepen we niet meer:
  //
  // ccCLProductMatrixRCBTCtrl.getStock()
  //
  // aan.
  //
  // We maken rechtstreeks dezelfde Salesforce RPC request:
  //
  // POST /DefaultStore/apexremote
  //
  // =====================================================================

  function workerInit() {

    const extractFirst =
      (html, re) =>
        html.match(re)?.[1] ||
        '';


    const stockCache =
      new Map();


    let cachedCtx =
      null;

      let rpcTemplate = null;

// ================================================================
// CAPTURE ECHTE CHANTELLE GETSTOCK RPC TEMPLATE
// ================================================================

(function hookApexRemoteTemplate() {
  try {
    const w = (
      typeof unsafeWindow !== 'undefined'
        ? unsafeWindow
        : window
    );

    const XHR = w.XMLHttpRequest;

    if (!XHR || XHR.prototype.__chantelleTemplateHooked) {
      return;
    }

    XHR.prototype.__chantelleTemplateHooked = true;

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function(method, url) {
      this.__chantelleUrl = String(url || '');

      return originalOpen.apply(
        this,
        arguments
      );
    };


    XHR.prototype.send = function(body) {
      try {
        if (
          /\/apexremote(?:\?|$)/i.test(
            this.__chantelleUrl || ''
          ) &&
          typeof body === 'string'
        ) {
          const parsed = JSON.parse(body);

          const call = Array.isArray(parsed)
            ? parsed.find(
                x =>
                  x?.action === 'ccCLProductMatrixRCBTCtrl' &&
                  x?.method === 'getStock'
              )
            : null;

          if (call) {
            rpcTemplate = JSON.parse(
              JSON.stringify(call)
            );

            console.info(
              '[chantelle-worker] ✅ geldige getStock RPC-template gevangen'
            );
          }
        }
      } catch {}

      return originalSend.apply(
        this,
        arguments
      );
    };


    console.info(
      '[chantelle-worker] apexremote template-sniffer actief'
    );

  } catch (e) {
    console.warn(
      '[chantelle-worker] template-sniffer kon niet starten:',
      e
    );
  }
})();

    // -------------------------------------------------------------
    // Heartbeat
    // -------------------------------------------------------------

    setInterval(
      () => {
        try {
          GM_setValue(
            HEARTBEAT_KEY,
            Date.now()
          );
        } catch {}
      },
      2500
    );


    // -------------------------------------------------------------
    // PAGEVARS
    // -------------------------------------------------------------

    function getAnyPageVars() {

      return (
        window.CCRZ?.pagevars ||
        window.ccrz?.pagevars ||
        window.CCRZ?.PageVars ||
        window.ccrz?.PageVars ||
        {}
      );
    }


    function parsePagevarsFromHtml(
      html
    ) {

      const eff =
        extractFirst(
          html,
          /CCRZ\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.effAccountId\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        '';


      const pg =
        extractFirst(
          html,
          /CCRZ\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.priceGroupId\s*=\s*['"]([^'"]*)['"]/i
        ) ||
        '';


      const pu =
        extractFirst(
          html,
          /CCRZ\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.portalUserId\s*=\s*['"]([^'"]*)['"]/i
        ) ||
        '';


      const storeName =
        extractFirst(
          html,
          /CCRZ\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.storeName\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        'DefaultStore';


      const sitePrefix =
        extractFirst(
          html,
          /CCRZ\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.sitePrefix\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        '/DefaultStore';


      const currSiteURL =
        extractFirst(
          html,
          /CCRZ\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        extractFirst(
          html,
          /ccrz\.pagevars\.currSiteURL\s*=\s*['"]([^'"]+)['"]/i
        ) ||
        (
          location.origin +
          sitePrefix +
          '/'
        );


      return {
        eff,
        pg,
        pu,
        storeName,
        sitePrefix,
        currSiteURL
      };
    }

async function waitForRemoteFn(
  controllerName,
  methodName,
  {
    timeoutMs = 12000,
    stepMs = 200
  } = {}
) {
  const start = Date.now();

  while (
    Date.now() - start <
    timeoutMs
  ) {
    const w = (
      typeof unsafeWindow !== 'undefined'
        ? unsafeWindow
        : window
    );

    const fn =
      w?.[controllerName]?.[methodName];

    if (
      typeof fn === 'function'
    ) {
      return {
        w,
        fn,
        ctrl:
          w[controllerName]
      };
    }

    await delay(
      stepMs
    );
  }

  return {
    w:
      (
        typeof unsafeWindow !== 'undefined'
          ? unsafeWindow
          : window
      ),

    fn: null,
    ctrl: null
  };
}


async function bootstrapRpcTemplate(
  ctx,
  sku
) {
  if (rpcTemplate) {
    return;
  }

  console.info(
    `[chantelle-worker] bootstrap RPC-template via ${sku}`
  );

  const {
    fn,
    ctrl
  } =
    await waitForRemoteFn(
      'ccCLProductMatrixRCBTCtrl',
      'getStock'
    );


  if (
    typeof fn !== 'function'
  ) {
    throw new Error(
      'Kan Chantelle getStock-controller niet vinden voor bootstrap.'
    );
  }


  const inputContext =
    makeInputContext(
      ctx,
      sku
    );


  const price =
    window.CCRZ
      ?.productDetailModel
      ?.attributes
      ?.product
      ?.price
    ??
    window.ccrz
      ?.productDetailModel
      ?.attributes
      ?.product
      ?.price
    ??
    window.CCRZ
      ?.productDetailModel
      ?.attributes
      ?.product
      ?.prodBean
      ?.price
    ??
    window.ccrz
      ?.productDetailModel
      ?.attributes
      ?.product
      ?.prodBean
      ?.price
    ??
    '0';


  await new Promise(
    (resolve, reject) => {

      const timer =
        setTimeout(
          () =>
            reject(
              new Error(
                'Bootstrap getStock timeout'
              )
            ),
          15000
        );


      const callback =
        (result, event) => {

          clearTimeout(
            timer
          );


          if (
            event?.status
          ) {
            resolve(
              result
            );

          } else {

            reject(
              new Error(
                event?.message ||
                'Bootstrap getStock failed'
              )
            );
          }
        };


      try {
        fn.apply(
          ctrl,
          [
            inputContext,
            null,
            String(price),
            {},
            false,
            false,
            false,
            callback,
            {
              escape: false
            }
          ]
        );

      } catch (e) {

        clearTimeout(
          timer
        );

        reject(e);
      }
    }
  );


  // XHR-hook wordt synchroon geraakt bij send().
  // Kleine marge voor zekerheid.
  await delay(
    50
  );


  if (!rpcTemplate) {
    throw new Error(
      'Bootstrap werkte, maar RPC-template werd niet gevangen.'
    );
  }


  console.info(
    '[chantelle-worker] ✅ RPC-template gereed voor batching'
  );
}

    // -------------------------------------------------------------
    // AUTH / CONTEXT
    // -------------------------------------------------------------

    function getCtxFromCurrentPage() {

      const html =
        document.documentElement.innerHTML;


      const csrf =
        extractFirst(
          html,
          /["']csrf["']\s*:\s*["']([^"']+)["']/i
        );


      const vid =
        extractFirst(
          html,
          /["']vid["']\s*:\s*["']([^"']+)["']/i
        );


      const authorization =
        extractFirst(
          html,
          /["']authorization["']\s*:\s*["']([^"']+)["']/i
        );


      const verStr =
        extractFirst(
          html,
          /["']ver["']\s*:\s*(\d{1,3})/i
        );


      const pv =
        getAnyPageVars();


      let effAccountId =
        pv.effAccountId ||
        '';


      let priceGroupId =
        pv.priceGroupId ||
        '';


      let portalUserId =
        pv.portalUserId ||
        '';


      let storeName =
        pv.storeName ||
        'DefaultStore';


      let sitePrefix =
        pv.sitePrefix ||
        '/DefaultStore';


      let currSiteURL =
        pv.currSiteURL ||
        (
          location.origin +
          sitePrefix +
          '/'
        );


      if (!effAccountId) {

        const parsed =
          parsePagevarsFromHtml(
            html
          );


        effAccountId =
          parsed.eff ||
          effAccountId;


        priceGroupId =
          priceGroupId ||
          parsed.pg;


        portalUserId =
          portalUserId ||
          parsed.pu;


        storeName =
          storeName ||
          parsed.storeName;


        sitePrefix =
          sitePrefix ||
          parsed.sitePrefix;


        currSiteURL =
          currSiteURL ||
          parsed.currSiteURL;
      }


      const pickCartIdFromHref =
        href => {

          const s =
            String(
              href ||
              ''
            );


          const m =
            s.match(
              /[?&]cartId=([^&]+)/i
            ) ||
            s.match(
              /cartId=([a-f0-9-]{32,36})/i
            );


          return m
            ? decodeURIComponent(
                m[1]
              )
            : '';
        };


      const hrefCandidates =
        [];


      try {
        hrefCandidates.push(
          String(
            location.href ||
            ''
          )
        );
      } catch {}


      try {
        hrefCandidates.push(
          String(
            document.URL ||
            ''
          )
        );
      } catch {}


      try {
        hrefCandidates.push(
          String(
            window?.top?.location?.href ||
            ''
          )
        );
      } catch {}


      let cartId =
        '';


      for (
        const href
        of hrefCandidates
      ) {

        cartId =
          pickCartIdFromHref(
            href
          );


        if (cartId) {
          break;
        }
      }


      if (!cartId) {

        cartId =
          pv.currentCartId ||
          pv.cartId ||
          window.CCRZ?.currentCartId ||
          window.ccrz?.currentCartId ||
          window.CCRZ?.pagevars?.currentCartId ||
          window.ccrz?.pagevars?.currentCartId ||
          '';
      }


      if (!cartId) {

        cartId =
          extractFirst(
            html,
            /[?&]cartId=([^&"'\s]+)/i
          ) ||
          extractFirst(
            html,
            /cartId=([a-f0-9-]{32,36})/i
          ) ||
          '';
      }


      return {
        csrf,
        vid,
        authorization,

        ver:
          verStr
            ? Number(verStr)
            : 45,

        effAccountId,
        cartId,
        priceGroupId,
        portalUserId,
        storeName,
        sitePrefix,
        currSiteURL
      };
    }


    async function getWorkerContext() {

      if (
        cachedCtx?.csrf &&
        cachedCtx?.vid &&
        cachedCtx?.authorization &&
        cachedCtx?.effAccountId &&
        cachedCtx?.cartId
      ) {
        return cachedCtx;
      }


      let ctx =
        getCtxFromCurrentPage();


      if (!ctx?.effAccountId) {

        await delay(
          800
        );

        ctx =
          getCtxFromCurrentPage();
      }


      cachedCtx =
        ctx;


      return ctx;
    }


    // ===================================================================
    // CHANTELLE INPUT CONTEXT
    // ===================================================================

    function makeInputContext(
      ctx,
      sku
    ) {

      const currentPageURL =
        `${ctx.currSiteURL}ccrz__ProductDetails` +
        `?cartId=${encodeURIComponent(ctx.cartId)}` +
        `&cclcl=nl_NL` +
        `&effectiveAccount=${encodeURIComponent(ctx.effAccountId)}` +
        `&sku=${encodeURIComponent(sku)}` +
        `&store=${encodeURIComponent(ctx.storeName)}`;


      return {

        storefront:
          ctx.storeName,

        portalUserId:
          ctx.portalUserId ||
          '',

        effAccountId:
          ctx.effAccountId,

        priceGroupId:
          ctx.priceGroupId ||
          '',

        currentCartId:
          ctx.cartId,

        userIsoCode:
          'EUR',

        userLocale:
          'nl_NL',

        currentPageName:
          'ccrz__ProductDetails',

        currentPageURL,

        queryParams: {

          sku,

          cartId:
            ctx.cartId,

          store:
            ctx.storeName,

          effectiveAccount:
            ctx.effAccountId,

          cclcl:
            'nl_NL'
        }
      };
    }


    // ===================================================================
    // STOCK PARSER
    // ===================================================================

    function sizeFromStockInfo(
      info
    ) {

      const candidates = [

        info?.size,
        info?.sizeLabel,
        info?.sizelabel,
        info?.sizeName,
        info?.sizeCode,
        info?.label,
        info?.displayLabel,
        info?.attributeValue,
        info?.xvalue,
        info?.xValue
      ];


      for (
        const candidate
        of candidates
      ) {

        const key =
          normalizeSizeKey(
            candidate
          );


        if (
          isSizeLabel(
            key
          )
        ) {
          return key;
        }
      }


      const skuCandidates = [

        info?.sku,
        info?.extSku,
        info?.label,
        info?.displayLabel
      ];


      for (
        const candidate
        of skuCandidates
      ) {

        const apparel =
          '(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|2XL|3XL|4XL|5XL|6XL)';


        const tailPattern =
          new RegExp(
            `(?:^|\\s)` +
            `(${apparel}` +
            `(?:\\s*[\\/-]\\s*${apparel})?` +
            `|TU` +
            `|\\d{2,3}[A-Z]{1,4}` +
            `|\\d{1,3})$`,
            'i'
          );


        const tail =
          String(
            candidate ||
            ''
          )
            .trim()
            .match(
              tailPattern
            )?.[1] ||
          '';


        const key =
          normalizeSizeKey(
            tail
          );


        if (
          isSizeLabel(
            key
          )
        ) {
          return key;
        }
      }


      return '';
    }


    function stockValueFromInfo(
      info
    ) {

      return String(

        info?.stockValue ??
        info?.stock ??
        ''

      ).trim();
    }


    function parseStockMap(
      stockPayload
    ) {

      const sd =
        stockPayload?.stockData ||
        {};


      const out =
        {};


      // ---------------------------------------------------------------
      // Enkele maatdimensie
      // ---------------------------------------------------------------

      if (
        sd?.values &&
        typeof sd.values === 'object'
      ) {

        const valuesAreArray =
          Array.isArray(
            sd.values
          );


        for (
          const [sizeKey, info]
          of Object.entries(
            sd.values
          )
        ) {

          const explicitKey =
            sizeFromStockInfo(
              info
            );


          const fallbackKey =
            normalizeSizeKey(
              sizeKey
            );


          const key =
            explicitKey ||
            (
              !valuesAreArray &&
              !isAlphaApparelSize(
                fallbackKey
              )
                ? fallbackKey
                : ''
            );


          if (
            !isSizeLabel(
              key
            )
          ) {
            continue;
          }


          const raw =
            stockValueFromInfo(
              info
            );


          out[key] =
            (
              !raw ||
              raw === '-' ||
              raw === ' - '
            )
              ? ''
              : raw;
        }


        return out;
      }


      // ---------------------------------------------------------------
      // Cup / band matrix
      // ---------------------------------------------------------------

      for (
        const [cupKey, cupObj]
        of Object.entries(
          sd
        )
      ) {

        const cup =
          String(
            cupObj?.cupsize ||
            cupKey ||
            ''
          )
            .trim()
            .toUpperCase();


        const values =
          cupObj?.values ||
          {};


        for (
          const [bandKey, info]
          of Object.entries(
            values
          )
        ) {

          const explicitKey =
            sizeFromStockInfo(
              info
            );


          const fallbackKey =
            normalizeSizeKey(
              bandKey
            );


          const bandNorm =
            explicitKey ||
            (
              isAlphaApparelSize(
                fallbackKey
              )
                ? ''
                : fallbackKey
            );


          if (!bandNorm) {
            continue;
          }


          const isDummyCup =
            !cup ||
            cup === '-' ||
            cup === '—';


          const explicitBraSize =
            /^\d{2,3}[A-Z]{1,4}$/.test(
              explicitKey
            );


          const key =
            (
              isDummyCup ||
              explicitBraSize
            )
              ? bandNorm
              : normalizeSizeKey(
                  `${bandNorm}${cup}`
                );


          if (
            !isSizeLabel(
              key
            )
          ) {
            continue;
          }


          const raw =
            stockValueFromInfo(
              info
            );


          out[key] =
            (
              !raw ||
              raw === '-' ||
              raw === ' - '
            )
              ? ''
              : raw;
        }
      }


      return out;
    }


    // ===================================================================
    // DIRECT APEX RPC
    // ===================================================================

    function makeRpcCall(
  ctx,
  sku,
  tid
) {
  if (!rpcTemplate) {
    throw new Error(
      'Geen geldige Chantelle RPC-template beschikbaar.'
    );
  }


  // Exacte originele Chantelle-call klonen.
  const call =
    JSON.parse(
      JSON.stringify(
        rpcTemplate
      )
    );


  // Alleen transaction ID wijzigen.
  call.tid = tid;


  // En de inputContext voor deze SKU.
  call.data[0] =
    makeInputContext(
      ctx,
      sku
    );


  return call;
}


    function parseMaybeJson(
      value
    ) {

      if (
        typeof value !==
        'string'
      ) {
        return value;
      }


      const s =
        value.trim();


      if (!s) {
        return value;
      }


      try {
        return JSON.parse(
          s
        );
      } catch {
        return value;
      }
    }


    function payloadFromRpcItem(
      item
    ) {

      if (
        !item ||
        Number(
          item.statusCode
        ) >= 400
      ) {

        throw new Error(
          `Apex RPC failed ` +
          `(HTTP ${item?.statusCode ?? 'unknown'})`
        );
      }


      const result =
        parseMaybeJson(
          item.result ??
          item.data ??
          item
        );


      const payload =
        parseMaybeJson(
          result?.data ??
          result
        );


      if (
        payload?.stockData
      ) {
        return payload;
      }


      if (
        result?.stockData
      ) {
        return result;
      }


      if (
        result?.data?.stockData
      ) {
        return result.data;
      }


      throw new Error(
        'getStock: no stockData in RPC response'
      );
    }


    // ===================================================================
    // BATCH REQUEST
    // ===================================================================

    async function fetchApexBatch(
      ctx,
      skus
    ) {

      if (!skus.length) {
        return {};
      }


      const w =
        typeof unsafeWindow !==
        'undefined'
          ? unsafeWindow
          : window;


      const endpoint =
        `${location.origin}` +
        `${ctx.sitePrefix || '/DefaultStore'}` +
        `/apexremote`;


      const baseTid =
        Math.floor(
          Math.random() *
          800000
        ) +
        100000;


      const tidToSku =
        new Map();


      const calls =
        skus.map(
          (sku, i) => {

            const tid =
              baseTid +
              i;


            tidToSku.set(
              String(tid),
              sku
            );


            return makeRpcCall(
              ctx,
              sku,
              tid
            );
          }
        );


      console.info(
        `[chantelle-worker] batch van ${calls.length} SKU's`
      );


      const ctrl =
        new AbortController();


      const timer =
        setTimeout(
          () =>
            ctrl.abort(),
          TIMEOUT_MS
        );


      const started =
        performance.now();


      let res;


      try {

        res =
          await w.fetch(
            endpoint,
            {
              method:
                'POST',

              credentials:
                'include',

              headers: {
                'Content-Type':
                  'application/json',

                'Accept':
                  'application/json'
              },

              body:
                JSON.stringify(
                  calls
                ),

              signal:
                ctrl.signal
            }
          );

      } finally {

        clearTimeout(
          timer
        );
      }


      console.info(
        `[chantelle-worker] batch klaar in ` +
        `${Math.round(performance.now() - started)} ms`
      );


      if (!res.ok) {

        throw new Error(
          `Apex batch HTTP ${res.status}`
        );
      }


      const response =
        await res.json();


      if (
        !Array.isArray(
          response
        )
      ) {

        throw new Error(
          'Apex batch response is geen array'
        );
      }


      const out = {};

const errors = [];

const failedSkus =
  new Set();


for (
  const item
  of response
) {

  const sku =
    tidToSku.get(
      String(
        item?.tid
      )
    );


  if (!sku) {
    continue;
  }


  try {

    const payload =
      payloadFromRpcItem(
        item
      );


    out[sku] =
      parseStockMap(
        payload
      );


  } catch (e) {

    failedSkus.add(
      sku
    );


    errors.push(
      `${sku}: ${String(
        e?.message ||
        e
      )}`
    );
  }
}


for (
  const sku
  of skus
) {

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        out,
        sku
      )
  ) {

    failedSkus.add(
      sku
    );


    if (
      !errors.some(
        x =>
          x.startsWith(
            `${sku}:`
          )
      )
    ) {

      errors.push(
        `${sku}: geen RPC-response`
      );
    }
  }
}


if (
  errors.length
) {

  console.warn(
    '[chantelle-worker] batch gedeeltelijk mislukt:',
    errors
  );
}


return {
  stockBySku:
    out,

  failedSkus:
    Array.from(
      failedSkus
    )
};
          }

    // ===================================================================
    // FILTER STOCK TO REQUESTED SIZES
    // ===================================================================

    function filterStockMap(
      stockMapFull,
      sizes
    ) {

      const wanted =
        new Set(
          (sizes || [])
            .map(
              normalizeSizeKey
            )
            .filter(
              isSizeLabel
            )
        );


      if (!wanted.size) {

        return (
          stockMapFull ||
          {}
        );
      }


      return Object.fromEntries(

        Object.entries(
          stockMapFull ||
          {}
        )
          .filter(
            ([k]) =>
              wanted.has(
                normalizeSizeKey(
                  k
                )
              )
          )
      );
    }


    // ===================================================================
    // CACHE + BATCH SPLITTING
    // ===================================================================

async function loadStockMaps(
  ctx,
  items
) {

  const bySku =
    new Map();


  // ===============================================================
  // DEDUPLICATIE
  // ===============================================================

  for (
    const item
    of items ||
    []
  ) {

    const sku =
      String(
        item?.sku ||
        ''
      ).trim();


    if (!sku) {
      continue;
    }


    if (
      !bySku.has(
        sku
      )
    ) {

      bySku.set(
        sku,
        new Set()
      );
    }


    for (
      const size
      of item?.sizes ||
      []
    ) {

      const key =
        normalizeSizeKey(
          size
        );


      if (
        isSizeLabel(
          key
        )
      ) {

        bySku
          .get(sku)
          .add(key);
      }
    }
  }


  const fullBySku =
    {};


  const failedSkus =
    new Set();


  const missingSkus =
    [];


  // ===============================================================
  // CACHE
  // ===============================================================

  for (
    const sku
    of bySku.keys()
  ) {

    const cached =
      stockCache.get(
        sku
      );


    if (
      cached &&
      (
        Date.now() -
        cached.timestamp
      ) <
      STOCK_CACHE_TTL_MS
    ) {

      fullBySku[sku] =
        cached.stockMap;

    } else {

      missingSkus.push(
        sku
      );
    }
  }


  console.info(
    `[chantelle-worker] ${bySku.size} unieke SKU's, ` +
    `${missingSkus.length} niet in cache`
  );


  // ===============================================================
  // RPC TEMPLATE
  // ===============================================================

  if (
    missingSkus.length &&
    !rpcTemplate
  ) {

    await bootstrapRpcTemplate(
      ctx,
      missingSkus[0]
    );
  }


  // ===============================================================
  // APEX BATCHES
  // ===============================================================

  for (
    const batch
    of chunkArray(
      missingSkus,
      APEX_BATCH_SIZE
    )
  ) {

    const result =
      await fetchApexBatch(
        ctx,
        batch
      );


    const batchResult =
      result?.stockBySku ||
      {};


    for (
      const failedSku
      of result?.failedSkus ||
      []
    ) {

      failedSkus.add(
        failedSku
      );
    }


    for (
      const sku
      of batch
    ) {

      // -----------------------------------------------------------
      // Alleen een SKU verwerken wanneer er echt een RPC-resultaat
      // voor bestaat.
      // -----------------------------------------------------------

      if (
        !Object.prototype
          .hasOwnProperty
          .call(
            batchResult,
            sku
          )
      ) {

        failedSkus.add(
          sku
        );

        continue;
      }


      const stockMap =
        batchResult[sku];


      fullBySku[sku] =
        stockMap;


      // Alleen geldige supplier-responses cachen.
      stockCache.set(
        sku,
        {
          timestamp:
            Date.now(),

          stockMap
        }
      );
    }
  }


  // ===============================================================
  // FILTER OP LOKAAL GEBRUIKTE MATEN
  // ===============================================================

  const filteredBySku =
    {};


  for (
    const [sku, sizes]
    of bySku.entries()
  ) {

    if (
      failedSkus.has(
        sku
      )
    ) {
      continue;
    }


    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          fullBySku,
          sku
        )
    ) {
      continue;
    }


    filteredBySku[sku] =
      filterStockMap(
        fullBySku[sku],
        Array.from(
          sizes
        )
      );
  }


  return {
    stockBySku:
      filteredBySku,

    failedSkus:
      Array.from(
        failedSkus
      )
  };
}


    // ===================================================================
    // BRIDGE REQUEST HANDLER
    // ===================================================================

    async function handleReq(
      req
    ) {

      const id =
        req?.id;


      if (!id) {
        return;
      }


      try {

        const ctx =
          await getWorkerContext();


        if (
          !ctx?.csrf ||
          !ctx?.vid ||
          !ctx?.authorization
        ) {

          throw new Error(
            'Worker: tokens missing. ' +
            'Open een PDP + refresh once.'
          );
        }


        if (
          !ctx?.effAccountId
        ) {

          throw new Error(
            'Worker: effAccountId missing.'
          );
        }


        if (
          !ctx?.cartId
        ) {

          throw new Error(
            'Worker: cartId missing. ' +
            'Open PDP with cartId once.'
          );
        }


        const items =
          req.mode === 'stockBatch'

            ? (
                Array.isArray(
                  req.items
                )
                  ? req.items
                  : []
              )

            : [
                {
                  sku:
                    req.sku,

                  sizes:
                    req.sizes ||
                    []
                }
              ];


        if (!items.length) {

          throw new Error(
            'Worker: geen SKU-items ontvangen.'
          );
        }


        const result =
  await loadStockMaps(
    ctx,
    items
  );


const stockBySku =
  result?.stockBySku ||
  {};


const failedSkus =
  result?.failedSkus ||
  [];


        if (
          req.mode === 'stockBatch'
        ) {

          GM_setValue(
  RESP_KEY,
  {
    id,
    ok: true,
    stockBySku,
    failedSkus
  }
);

        } else {

          const sku =
            String(
              req.sku ||
              ''
            ).trim();


          GM_setValue(
            RESP_KEY,
            {
              id,
              ok: true,
              stockMap:
                stockBySku[sku] ||
                {}
            }
          );
        }


      } catch (e) {

        // Context kan verlopen zijn.
        // Volgende run opnieuw uit DOM halen.
        cachedCtx =
          null;


        console.error(
          '[chantelle-worker] error:',
          e
        );


        GM_setValue(
          RESP_KEY,
          {
            id,
            ok: false,
            error:
              String(
                e?.message ||
                e
              )
          }
        );
      }
    }


    GM_addValueChangeListener(
      REQ_KEY,
      (_k, _old, req) => {

        if (
          !req?.id
        ) {
          return;
        }


        handleReq(
          req
        );
      }
    );


    try {
      GM_setValue(
        HEARTBEAT_KEY,
        Date.now()
      );
    } catch {}


    console.info(
      `[chantelle-worker] v5.2 actief | directe apexremote batching max ${APEX_BATCH_SIZE}`
    );
  }


  // =====================================================================
  // TOOL UI
  // =====================================================================

  if (ON_TOOL) {

    registerUserscript();


    const mounted =
      Core.mountSupplierButton({

        id:
          'vcp2-chantelle-btn',

        text:
          'Controleer Chantelle',

        right:
          250,

        top:
          8,

        match:
          () =>
            isChantelleSelected(),

        onClick:
          btn =>
            run(btn)
      });


    mounted.btn.innerHTML =
      '<i class="fa-solid fa-magnifying-glass-chart"></i>';


    mounted.btn.setAttribute(
      'aria-label',
      'Controleer voorraad bij Chantelle of Femilet'
    );


    mounted.btn.title =
      'Controleer voorraad bij Chantelle of Femilet';


    setTimeout(
      () => {

        const btn =
          document.getElementById(
            'vcp2-chantelle-btn'
          );


        if (btn) {
          installHeartbeatBadge(
            btn
          );
        }

      },
      50
    );
  }


  // =====================================================================
  // START WORKER ON CHANTELLE
  // =====================================================================

  if (ON_CHANTELLE) {
    workerInit();
  }

})();
