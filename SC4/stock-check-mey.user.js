// ==UserScript==
// @name         Stock Check | Mey
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.0
// @description  Vergelijk de lokale voorraad van Mey met de leverancier.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      meyb2b.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-mey.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-mey.user.js
// ==/UserScript==

(() => {
  'use strict';

  const g = (typeof unsafeWindow !== 'undefined')
    ? unsafeWindow
    : window;

  const Core = g.VCPCore;
  const SR   = g.StockRules;


  // =========================================================
  // Config
  // =========================================================

  const TIMEOUT = 15000;

  // Bewust conservatief.
  // Test:
  // 100 styles => 4617 varianten in ~762 ms
  // 284 styles => 6646 varianten in ~998 ms
  const MEY_BATCH_SIZE = 100;


  const MEY_CTX = {
    dataareaid: 'ME:NO',
    custid: '385468',
    assortid: 'ddd8763b-b678-4004-ba8b-c64d45b5333c',
    ordertypeid: 'NO',

    webSocketUniqueId:
      crypto?.randomUUID
        ? crypto.randomUUID()
        : `ws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  };


  // styleid => {
  //   ok: true/false,
  //   xvalues: {},
  //   reason: ''
  // }
  const ORDER_DETAIL_CACHE = new Map();


  // =========================================================
  // Userscript registratie
  // =========================================================

  function registerUserscript() {
    const detail = {
      id: 'stock-check-mey',
      name: 'Stock Check | Mey',
      version:
        typeof GM_info !== 'undefined'
          ? GM_info.script.version
          : '5.0'
    };

    g.__stockCheckUserscripts =
      g.__stockCheckUserscripts ||
      Object.create(null);

    g.__stockCheckUserscripts[
      detail.id
    ] = detail;

    try {
      g.dispatchEvent(
        new g.CustomEvent(
          'stockcheck:userscript-register',
          { detail }
        )
      );
    } catch {}
  }


  // =========================================================
  // Guards
  // =========================================================

  if (!Core) {
    console.error(
      '[VCP2|Mey] VCPCore ontbreekt. Check @require vcp-core.js'
    );
    return;
  }

  if (
    !SR ||
    typeof SR.mapRemoteToTarget !== 'function' ||
    typeof SR.reconcile !== 'function'
  ) {
    console.error(
      '[VCP2|Mey] StockRules ontbreekt of incompleet. Check @require stockrules.js'
    );
    return;
  }


  // =========================================================
  // Logger
  // =========================================================

  const Logger = {

    lb() {
      try {
        return (
          typeof unsafeWindow !== 'undefined' &&
          unsafeWindow.logboek
        )
          ? unsafeWindow.logboek
          : window.logboek;
      } catch {
        return window.logboek;
      }
    },


    status(id, txt) {
      const lb = this.lb();

      if (
        lb &&
        typeof lb.resultaat === 'function'
      ) {
        lb.resultaat(
          String(id),
          txt
        );
      } else {
        console.info(
          `[Mey][${id}] status: ${txt}`
        );
      }
    },


    progress(txt) {
      console.info(
        `[Mey] ${txt}`
      );

      try {
        const lb = this.lb();

        if (
          lb &&
          typeof lb.resultaat === 'function'
        ) {
          lb.resultaat(
            'mey-progress',
            txt
          );
        }
      } catch {}
    },


    perMaat(id, report) {
      if (
        g.StockCheckConfig?.detailLogging !== true
      ) {
        return;
      }

      console.groupCollapsed(
        `[Mey][${id}] maatvergelijking`
      );

      try {
        console.table(
          report.map(r => ({
            maat: r.maat,
            local: r.local,

            remote:
              Number.isFinite(r.remote)
                ? r.remote
                : '-',

            target:
              Number.isFinite(r.target)
                ? r.target
                : '-',

            delta:
              Number.isFinite(r.delta)
                ? r.delta
                : '-',

            status: r.status,
            hint: r.hint
          }))
        );

      } finally {
        console.groupEnd();
      }
    }
  };


  // =========================================================
  // Helpers
  // =========================================================

  function chunkArray(arr, size) {
    const out = [];

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


  function normSize(raw) {
    return String(raw || '')
      .toUpperCase()
      .trim()
      .replace(/\s+/g, '');
  }


  function looksLikeSize(value) {
    const s = normSize(value);

    return (
      /^(XXXS|XXS|XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|6XL|TU|OS)$/.test(s) ||
      /^\d{1,3}$/.test(s) ||
      /^\d{2,3}[A-Z]{1,4}$/.test(s)
    );
  }


  // ---------------------------------------------------------
  // PID parser
  //
  // Ondersteunt onder andere:
  //
  // 1230081-1718
  // ME;NO;1230081;*;*/1718
  // ---------------------------------------------------------

  function parsePid(pid) {
    const s =
      String(pid || '').trim();

    let m =
      s.match(
        /^\s*(\d+)\s*[-_]\s*(\d+)\s*$/
      );

    if (m) {
      return {
        styleid: m[1],
        colorKey: m[2]
      };
    }


    m =
      s.match(
        /\/\s*(\d{1,6})\s*$/
      );

    const trailingColor =
      m?.[1] || '';


    const nums =
      s.match(/\d+/g) || [];

    if (!nums.length) {
      return {
        styleid: '',
        colorKey: ''
      };
    }


    const styleid =
      [...nums]
        .sort(
          (a, b) =>
            b.length - a.length
        )[0] || '';


    const colorCandidates =
      nums.filter(
        n =>
          n !== styleid &&
          n.length >= 1 &&
          n.length <= 6
      );


    const colorKey =
      (
        trailingColor ||
        colorCandidates[
          colorCandidates.length - 1
        ] ||
        ''
      ).trim();


    return {
      styleid,
      colorKey
    };
  }


  // ---------------------------------------------------------
  // Mey key -> lokale maat
  //
  // D;1749;75 => 75D
  // *;1718;XS => XS
  // *;408;40  => 40
  // ---------------------------------------------------------

  function keyToMaat(
    k,
    v,
    colorKey = ''
  ) {
    const ks =
      String(k || '');


    const mBra =
      ks.match(
        /^([A-Z]{1,4});[^;]*;(\d{2,3})$/i
      );


    if (mBra) {
      const cup =
        String(
          mBra[1]
        ).toUpperCase();

      const band =
        String(
          mBra[2]
        ).toUpperCase();

      return `${band}${cup}`;
    }


    const size =
      normSize(
        v?.size
      );

    if (size) {
      return size;
    }


    const parts =
      ks
        .split(
          /[;|/:_\-\s]+/
        )
        .map(
          part => part.trim()
        )
        .filter(Boolean);


    const keyColor =
      String(
        colorKey || ''
      ).trim();


    const sizePart =
      parts.find(
        part =>
          part !== keyColor &&
          looksLikeSize(part)
      );


    return normSize(
      sizePart || ''
    );
  }


  // ---------------------------------------------------------
  // Exacte kleurcontrole
  // ---------------------------------------------------------

  function entryMatchesColor(
    k,
    v,
    colorKey
  ) {
    const wanted =
      String(
        colorKey || ''
      ).trim();


    if (!wanted) {
      return true;
    }


    const keyParts =
      String(k || '')
        .split(
          /[;|/:_\-\s]+/
        )
        .map(
          part => part.trim()
        )
        .filter(Boolean);


    if (
      keyParts.includes(wanted)
    ) {
      return true;
    }


    const candidates = [
      v?.yattrib,
      v?.yattribid,
      v?.color,
      v?.colorid,
      v?.colour,
      v?.colourid,
      v?.variantid,
      v?.variant,
      v?.itemid,
      v?.key
    ];


    return candidates.some(
      value =>
        String(value || '')
          .split(
            /[;|/:_\-\s]+/
          )
          .map(
            part => part.trim()
          )
          .includes(wanted)
    );
  }


  // ---------------------------------------------------------
  // Duplicaten voor dezelfde exacte maat:
  // conservatief laagste voorraad gebruiken.
  // ---------------------------------------------------------

  function setRemoteSize(
    map,
    maat,
    next
  ) {
    const current =
      map[maat];


    if (!current) {
      map[maat] = next;
      return;
    }


    const currentStock =
      Number(
        current.stock ?? 0
      );

    const nextStock =
      Number(
        next.stock ?? 0
      );


    if (
      nextStock < currentStock
    ) {
      map[maat] = {
        ...next,
        conflict: true
      };
    } else {
      map[maat] = {
        ...current,
        conflict: true
      };
    }
  }


  // =========================================================
  // GM POST
  // =========================================================

  function gmPost(
    url,
    jsonBody
  ) {
    return new Promise(
      (resolve, reject) => {

        GM_xmlhttpRequest({
          method: 'POST',
          url,

          withCredentials: true,

          timeout:
            TIMEOUT,

          headers: {
            'Content-Type':
              'application/json;charset=UTF-8',

            'Accept':
              'application/json, text/plain, */*'
          },

          data:
            JSON.stringify(
              jsonBody
            ),


          onload: r => {
            if (
              r.status >= 200 &&
              r.status < 400
            ) {
              resolve(
                r.responseText || ''
              );
            } else {
              reject(
                new Error(
                  `HTTP ${r.status} @ ${url}`
                )
              );
            }
          },


          onerror: () =>
            reject(
              new Error(
                `netwerkfout @ ${url}`
              )
            ),


          ontimeout: () =>
            reject(
              new Error(
                `timeout @ ${url}`
              )
            )
        });
      }
    );
  }


  function buildMeyUrl(
    endpointPath
  ) {
    const uniq =
      `${Date.now()}r${Math.floor(
        Math.random() * 1000
      )}`;

    return (
      `https://meyb2b.com/b2bapi?-/` +
      `${uniq}/${endpointPath}`
    );
  }


  // =========================================================
  // OrderDetail BATCH
  // =========================================================

  async function fetchOrderDetailBatch(
    styleIds
  ) {
    const styles =
      [
        ...new Set(
          styleIds
            .map(String)
            .map(
              s => s.trim()
            )
            .filter(Boolean)
        )
      ];


    if (!styles.length) {
      return;
    }


    const url =
      buildMeyUrl(
        'OrderDetail/collection'
      );


    const payload = [{
      _getparams: {
        '': 'undefined'
      },

      _webSocketUniqueId:
        MEY_CTX.webSocketUniqueId,

      _url:
        'OrderDetail/collection',

      _dataareaid:
        MEY_CTX.dataareaid,

      _agentid:
        null,

      _custid:
        String(
          MEY_CTX.custid
        ),

      _method:
        'read',

      styles:
        styles.map(
          styleid => ({
            custareaid: 'ME',
            styleareaid: 'NO',
            styleid:
              String(styleid),
            variantid: '*',
            zkey: '*'
          })
        ),

      assortid:
        MEY_CTX.assortid,

      ordertypeid:
        MEY_CTX.ordertypeid
    }];


    const started =
      performance.now();


    try {

      const text =
        await gmPost(
          url,
          payload
        );


      const json =
        JSON.parse(text);


      const results =
        json?.[0]?.result || [];


      const returnedStyles =
        new Set();


      results.forEach(
        (item, index) => {

          // Mey gaf tijdens onze test netjes styleid mee.
          // Index-fallback alleen als de styleid ontbreekt.
          const styleid =
            String(
              item?.styleid ||
              item?.style?.styleid ||
              item?.itemid ||
              styles[index] ||
              ''
            ).trim();


          if (!styleid) {
            return;
          }


          returnedStyles.add(
            styleid
          );


          ORDER_DETAIL_CACHE.set(
            styleid,
            {
              ok: true,

              xvalues:
                item?.xvalues || {},

              reason: ''
            }
          );
        }
      );


      // Belangrijk:
      // request was succesvol, maar een aangevraagde style
      // die niet terugkomt betekent remote = 0.
      for (
        const styleid of styles
      ) {
        if (
          returnedStyles.has(styleid)
        ) {
          continue;
        }


        ORDER_DETAIL_CACHE.set(
          styleid,
          {
            ok: false,
            xvalues: {},
            reason:
              'style ontbreekt in succesvolle Mey-response'
          }
        );


        console.warn(
          `[VCP2|Mey] ${styleid}: ` +
          `geen result in succesvolle batch → remote 0`
        );
      }


      const ms =
        Math.round(
          performance.now() -
          started
        );


      const variants =
        results.reduce(
          (sum, item) =>
            sum +
            Object.keys(
              item?.xvalues || {}
            ).length,
          0
        );


      console.info(
        `[VCP2|Mey] batch: ` +
        `${styles.length} styles → ` +
        `${results.length} results → ` +
        `${variants} varianten in ${ms} ms`
      );


      return {
        requested:
          styles.length,

        returned:
          results.length,

        variants,

        ms
      };


    } catch (e) {

      // Veiligheidsregel:
      // een mislukte supplier batch = remote 0
      // voor ALLE styles in die batch.
      for (
        const styleid of styles
      ) {
        ORDER_DETAIL_CACHE.set(
          styleid,
          {
            ok: false,
            xvalues: {},
            reason:
              String(
                e?.message ||
                e ||
                'Mey batch mislukt'
              )
          }
        );
      }


      console.error(
        `[VCP2|Mey] batch met ` +
        `${styles.length} styles mislukt → ` +
        `remote 0 voor gehele batch`,
        e
      );


      return {
        requested:
          styles.length,

        returned: 0,
        variants: 0,

        ms:
          Math.round(
            performance.now() -
            started
          ),

        error: e
      };
    }
  }


  // =========================================================
  // Alle benodigde styles vooraf ophalen
  // =========================================================

  async function preloadOrderDetails(
    tables,
    btn
  ) {
    ORDER_DETAIL_CACHE.clear();


    const styleIds =
      [
        ...new Set(
          tables
            .map(
              table =>
                parsePid(
                  table.id || ''
                ).styleid
            )
            .filter(Boolean)
        )
      ];


    const batches =
      chunkArray(
        styleIds,
        MEY_BATCH_SIZE
      );


    console.info(
      `[VCP2|Mey] ` +
      `${tables.length} tabellen → ` +
      `${styleIds.length} unieke styles → ` +
      `${batches.length} batches`
    );


    let done = 0;
    let variants = 0;


    if (btn) {
      btn.title =
        `Mey ophalen 0/${styleIds.length}`;
    }


    Logger.progress(
      `Mey ophalen: 0/${styleIds.length} (0%)`
    );


    // Bewust SEQUENTIEEL.
    // Met batches van 100 zijn dit maar enkele calls,
    // en zo belasten we Mey minimaal.
    for (
      let i = 0;
      i < batches.length;
      i++
    ) {
      const batch =
        batches[i];


      const result =
        await fetchOrderDetailBatch(
          batch
        );


      done +=
        batch.length;

      variants +=
        Number(
          result?.variants || 0
        );


      const pct =
        styleIds.length
          ? Math.round(
              (
                done /
                styleIds.length
              ) * 100
            )
          : 100;


      const txt =
        `Mey ophalen: ` +
        `${done}/${styleIds.length} ` +
        `(${pct}%)`;


      Logger.progress(txt);


      if (btn) {
        btn.title =
          `${txt} — ` +
          `${variants} varianten`;
      }
    }


    return {
      styles:
        styleIds.length,

      batches:
        batches.length,

      variants
    };
  }


  // =========================================================
  // Remote map maken uit CACHE
  // =========================================================

  function buildRemoteMap(
    styleid,
    colorKey
  ) {
    const cached =
      ORDER_DETAIL_CACHE.get(
        String(styleid)
      );


    const map = {};


    // Style niet opgehaald / batch fout / style ontbreekt:
    // remote 0 voor alle lokale maten.
    if (
      !cached ||
      cached.ok !== true
    ) {
      Object.defineProperty(
        map,
        '__meyMeta',
        {
          enumerable: false,

          value: {
            colorMatchedEntries: 0,
            forceZero: true,

            reason:
              cached?.reason ||
              'geen Mey OrderDetail beschikbaar'
          }
        }
      );

      return map;
    }


    const xvalues =
      cached.xvalues || {};


    let colorMatchedEntries =
      0;


    for (
      const [k, v]
      of Object.entries(xvalues)
    ) {

      if (
        !entryMatchesColor(
          k,
          v,
          colorKey
        )
      ) {
        continue;
      }


      // We tellen de kleurmatch VOOR verdere filtering.
      // Ook een geblokkeerde 0-variant bewijst dus
      // dat de kleur bestaat.
      colorMatchedEntries++;


      const rawStock =
        Number(
          v?.stock ?? 0
        );


      const blocked =
        v?.blocked === true;


      const maat =
        keyToMaat(
          k,
          v,
          colorKey
        );


      if (!maat) {
        continue;
      }


      // OrderDetail is nu leidend:
      //
      // blocked = 0
      // geen/niet-numerieke voorraad = 0
      // stock <= 0 = 0
      //
      // positieve, niet-geblokkeerde voorraad
      // blijft de echte remote voorraad.
      const safeRawStock =
        Number.isFinite(rawStock)
          ? Math.max(
              0,
              rawStock
            )
          : 0;


      const effectiveStock =
        blocked
          ? 0
          : safeRawStock;


      setRemoteSize(
        map,
        maat,
        {
          stock:
            effectiveStock,

          orderable:
            !blocked &&
            effectiveStock > 0,

          blocked,

          rawStock:
            safeRawStock,

          ean:
            String(
              v?.ean || ''
            ).trim(),

          sourceKey:
            String(k)
        }
      );
    }


    // Style bestaat, maar de gevraagde kleur niet:
    // veiligheidsregel => remote 0.
    const forceZero =
      colorMatchedEntries === 0;


    Object.defineProperty(
      map,
      '__meyMeta',
      {
        enumerable: false,

        value: {
          colorMatchedEntries,
          forceZero,

          reason:
            forceZero
              ? `kleur ${colorKey || '?'} ontbreekt in Mey OrderDetail`
              : ''
        }
      }
    );


    return map;
  }


  // =========================================================
  // StockRules
  // =========================================================

  function applyRulesAndMark(
    localTable,
    remoteMapObj
  ) {
    const rows =
      localTable.querySelectorAll(
        'tbody tr'
      );


    const report = [];


    const forceZero =
      remoteMapObj?.__meyMeta?.forceZero === true;


    const forceReason =
      remoteMapObj?.__meyMeta?.reason || '';


    rows.forEach(
      row => {

        const sizeCell =
          row.children[0];

        const localCell =
          row.children[1];


        const maat =
          normSize(
            row.dataset.size ||
            sizeCell?.textContent ||
            ''
          );


        const local =
          parseInt(
            String(
              localCell?.textContent || ''
            ).trim(),
            10
          ) || 0;


        // Cruciale veiligheidsregel:
        //
        // - ontbrekende style       => 0
        // - ontbrekende kleur       => 0
        // - ontbrekende maat        => 0
        // - blocked variant         => 0
        // - supplier batch failure  => 0
        //
        const remoteInfo =
          forceZero
            ? {
                stock: 0,
                orderable: false,
                rawStock: 0,
                forcedZero: true
              }
            : (
                remoteMapObj[maat] || {
                  stock: 0,
                  orderable: false,
                  rawStock: 0,
                  missingSize: true
                }
              );


        const remoteRaw =
          Number(
            remoteInfo.stock ?? 0
          );


        const target =
          SR.mapRemoteToTarget(
            'mey',
            remoteRaw,
            5
          );


        const res =
          SR.reconcile(
            local,
            target,
            5
          );


        const action =
          res.action;

        const delta =
          res.delta;


        let status =
          'ok';


        if (
          action === 'bijboeken' &&
          delta > 0
        ) {

          Core.markRow(
            row,
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
          action === 'uitboeken' &&
          delta > 0
        ) {

          Core.markRow(
            row,
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
            row,
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


        let hint =
          'orderable';


        if (forceZero) {
          hint =
            `FORCED-ZERO: ${forceReason}`;
        } else if (
          remoteInfo.missingSize
        ) {
          hint =
            'SIZE-MISSING-FOR-EXACT-COLOR → remote 0';
        } else if (
          remoteInfo.blocked
        ) {
          hint =
            'BLOCKED → remote 0';
        } else if (
          remoteInfo.orderable === false
        ) {
          hint =
            'NOT-ORDERABLE → remote 0';
        }


        report.push({
          maat,
          local,
          remote:
            remoteRaw,
          target,
          delta,
          status,
          hint
        });
      }
    );


    return report;
  }


  function bepaalLogStatus(
    report
  ) {
    const diffs =
      report.filter(
        r =>
          r.status === 'bijboeken' ||
          r.status === 'uitboeken'
      ).length;


    if (
      diffs === 0
    ) {
      return 'ok';
    }


    return 'afwijking';
  }


  // =========================================================
  // Per tabel
  // =========================================================

  async function perTable(
    table
  ) {
    const pid =
      String(
        table.id || ''
      ).trim();


    const label =
      table
        .querySelector(
          'thead th[colspan]'
        )
        ?.textContent
        ?.trim() ||
      pid ||
      'onbekend';


    const anchorId =
      pid || label;


    if (!pid) {
      Logger.status(
        anchorId,
        'niet-gevonden'
      );

      Logger.perMaat(
        anchorId,
        []
      );

      return 0;
    }


    const {
      styleid,
      colorKey
    } =
      parsePid(pid);


    if (!styleid) {
      Logger.status(
        anchorId,
        'niet-gevonden'
      );

      Logger.perMaat(
        anchorId,
        []
      );

      return 0;
    }


    const remoteMapObj =
      buildRemoteMap(
        styleid,
        colorKey
      );


    const meta =
      remoteMapObj?.__meyMeta;


    if (
      meta?.forceZero === true
    ) {
      console.warn(
        `[VCP2|Mey] ${pid}: ` +
        `${meta.reason} → remote 0`
      );
    }


    const report =
      applyRulesAndMark(
        table,
        remoteMapObj
      );


    const status =
      bepaalLogStatus(
        report
      );


    Logger.status(
      anchorId,
      status
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


  // =========================================================
  // Run
  // =========================================================

  async function run(
    btn
  ) {
    const tables =
      Array.from(
        document.querySelectorAll(
          '#output table'
        )
      );


    if (!tables.length) {
      return;
    }


    const started =
      performance.now();


    try {

      // -----------------------------------------------
      // Fase 1:
      // Mey ophalen in batches van maximaal 100 styles
      // -----------------------------------------------

      const preload =
        await preloadOrderDetails(
          tables,
          btn
        );


      console.info(
        `[VCP2|Mey] ophalen klaar: ` +
        `${preload.styles} styles | ` +
        `${preload.batches} batches | ` +
        `${preload.variants} varianten`
      );


      // -----------------------------------------------
      // Fase 2:
      // lokaal verwerken
      // -----------------------------------------------

      Logger.progress(
        `Voorraad verwerken: 0/${tables.length} (0%)`
      );


      if (btn) {
        btn.title =
          `Voorraad verwerken 0/${tables.length}`;
      }


      let processed =
        0;


      const wrappedPerTable =
        async table => {

          try {
            return await perTable(
              table
            );

          } finally {

            processed++;


            const pct =
              Math.round(
                (
                  processed /
                  tables.length
                ) * 100
              );


            if (
              processed === 1 ||
              processed === tables.length ||
              processed % 10 === 0
            ) {

              const txt =
                `Voorraad verwerken: ` +
                `${processed}/${tables.length} ` +
                `(${pct}%)`;


              Logger.progress(txt);


              if (btn) {
                btn.title =
                  txt;
              }
            }
          }
        };


      await Core.runTables({
        btn,
        tables,

        // Geen supplier calls meer per tabel,
        // dus lokaal mag dit ruim omhoog.
        concurrency: 20,

        perTable:
          wrappedPerTable
      });


      const totalMs =
        Math.round(
          performance.now() -
          started
        );


      Logger.progress(
        `Klaar — ` +
        `${tables.length} producten gecontroleerd ` +
        `in ${(totalMs / 1000).toFixed(1)}s`
      );


      console.info(
        `[VCP2|Mey] klaar: ` +
        `${tables.length} tabellen in ` +
        `${totalMs} ms`
      );


      if (btn) {
        btn.title =
          `Controleer voorraad bij Mey`;
      }


    } catch (e) {

      console.error(
        '[VCP2|Mey] run error:',
        e
      );


      if (btn) {
        btn.title =
          'Controleer voorraad bij Mey';
      }
    }
  }


  // =========================================================
  // UI
  // =========================================================

  registerUserscript();


  const mounted =
    Core.mountSupplierButton({
      id:
        'stock-check-mey-btn',

      text:
        'Controleer Mey',

      right: 250,
      top: 8,

      match:
        /\bmey\b/i,

      onClick:
        btn => run(btn)
    });


  mounted.btn.innerHTML =
    '<i class="fa-solid fa-magnifying-glass-chart"></i>';

  mounted.btn.setAttribute(
    'aria-label',
    'Controleer voorraad bij Mey'
  );

  mounted.btn.title =
    'Controleer voorraad bij Mey';

})();
