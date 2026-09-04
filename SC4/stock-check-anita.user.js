// ==UserScript==
// @name         Stock Check | Anita & Rosa Faia
// @namespace    https://dutchdesignersoutlet.nl/
// @version      5.1
// @description  Snelle voorraadcontrole voor Anita en Rosa Faia via article-level batching, met live progress logging.
// @author       C. P. van Beek
// @match        https://lingerieoutlet.nl/tools/stockv4/*
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      b2b.anita.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SC4/stock-check-anita.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ON_TOOL = location.hostname.includes('lingerieoutlet.nl');
  if (!ON_TOOL) return;

  const g =
    typeof unsafeWindow !== 'undefined'
      ? unsafeWindow
      : window;

  const Core = g.VCPCore;
  const SR = g.StockRules;

  const VERSION =
    typeof GM_info !== 'undefined' &&
    GM_info?.script?.version
      ? GM_info.script.version
      : '5.1';

  const BRAND_KEY = 'anita';

  const BASE = 'https://b2b.anita.com';
  const PATH_441 = '/nl/shop/441/';

  const CONCURRENCY = 30;
  const REQUEST_TIMEOUT = 25000;

  const LOG_SIZE_REPORTS = false;

  const ALLOWED_SUPPLIERS = new Set([
    'anita',
    'anita-active',
    'anita-badmode',
    'anita-care',
    'anita-maternity',
    'anita-group',
    'rosa-faia',
    'rosa-faia-badmode',
    'rosa-faia-group'
  ]);

  if (!Core) {
    console.error(
      '[VCP2|Anita] VCPCore ontbreekt.'
    );
    return;
  }

  if (
    !SR ||
    typeof SR.mapRemoteToTarget !== 'function' ||
    typeof SR.reconcile !== 'function'
  ) {
    console.error(
      '[VCP2|Anita] StockRules ontbreekt/incompleet.'
    );
    return;
  }

  const $ = (s, r = document) =>
    r.querySelector(s);

  const $$ = (s, r = document) =>
    Array.from(r.querySelectorAll(s));

  const ARTICLE_CACHE = new Map();

  function registerUserscript() {
    const detail = {
      id: 'stock-check-anita',
      name: 'Stock Check | Anita & Rosa Faia',
      version: VERSION
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
          {
            autoJump: false
          }
        );
      } else {
        console.info(
          `[Anita][${anchorId}] ${txt}`
        );
      }
    },

    progress(txt) {
      this.status(
        'anita-progress',
        txt
      );

      const dashboardProgress =
        document.getElementById(
          'table-count'
        );

      if (dashboardProgress) {
        dashboardProgress.textContent =
          String(txt);
      }

      console.info(
        `[Anita-progress] ${txt}`
      );
    },

    perMaat(anchorId, report) {
      if (!LOG_SIZE_REPORTS) {
        return;
      }

      console.groupCollapsed(
        `[Anita][${anchorId}] maatvergelijking`
      );

      try {
        console.table(
          report.map(r => ({
            maat: r.maat,
            local: r.local,
            remote: r.remote,
            target: r.target,
            delta: r.delta,
            status: r.status
          }))
        );
      } finally {
        console.groupEnd();
      }
    }
  };

  function parsePid(raw = '') {
    const pid = String(raw)
      .trim()
      .replace(/\s+/g, '');

    if (!pid) {
      return {
        koll: '',
        arnr: '',
        fbnr: ''
      };
    }

    const parts =
      pid.split('-').filter(Boolean);

    const hasColor =
      parts.length >= 2 &&
      /^\d{3}$/.test(
        parts[parts.length - 1]
      );

    const fbnr =
      hasColor
        ? parts.pop()
        : '';

    let koll = '';

    if (
      parts.length >= 2 &&
      /[A-Za-z]/.test(parts[0])
    ) {
      koll =
        parts.shift().toUpperCase();
    }

    const arnr =
      parts.join('-');

    return {
      koll,
      arnr,
      fbnr
    };
  }

  function getPidHintsFromTable(table) {
    const ds =
      table?.dataset || {};

    const dsKoll =
      ds.anitaKoll ||
      ds.anitaCollection ||
      ds.koll ||
      '';

    const dsArt =
      ds.anitaArticle ||
      ds.article ||
      '';

    const dsCol =
      ds.anitaColor ||
      ds.color ||
      '';

    if (
      dsKoll ||
      dsArt ||
      dsCol
    ) {
      return {
        koll:
          String(dsKoll).trim(),

        arnr:
          String(dsArt).trim(),

        fbnr:
          String(dsCol).trim()
      };
    }

    return parsePid(
      getSkuFromTable(table)
    );
  }

  function getSkuFromTable(table) {
    const id =
      String(
        table?.id || ''
      ).trim();

    if (id) {
      return id;
    }

    const label =
      table
        ?.querySelector(
          'thead th[colspan]'
        )
        ?.textContent
        ?.trim() || '';

    const m =
      label.match(
        /\b[A-Z0-9]+(?:-[A-Z0-9]+){1,4}\b/i
      );

    return m
      ? m[0]
      : '';
  }

  function articleKey({
    koll = '',
    arnr = ''
  }) {
    return (
      `${String(koll)
        .trim()
        .toUpperCase()}|` +
      `${String(arnr)
        .trim()
        .toUpperCase()}`
    );
  }

  function build441Url({
    koll = '',
    arnr = ''
  }) {
    const qp =
      new URLSearchParams();

    if (koll) {
      qp.set(
        'koll',
        koll
      );
    }

    qp.set(
      'arnr',
      arnr
    );

    qp.set(
      'sicht',
      'A'
    );

    return (
      `${BASE}${PATH_441}?` +
      qp.toString()
    );
  }

  function fetchViaGM(url) {
    return new Promise(
      (resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',

          url,

          withCredentials: true,

          timeout:
            REQUEST_TIMEOUT,

          headers: {
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

            Referer:
              `${BASE}/nl/shop`
          },

          onload: r => {
            resolve({
              status:
                Number(
                  r.status || 0
                ),

              text:
                r.responseText || ''
            });
          },

          onerror: e => {
            reject(e);
          },

          ontimeout: () => {
            reject(
              new Error(
                `timeout @ ${url}`
              )
            );
          }
        });
      }
    );
  }

  function colorFromImg(table) {
    const img =
      table.querySelector(
        'img[src*="/color/"]'
      );

    if (!img) {
      return '';
    }

    const m =
      String(
        img.getAttribute('src') || ''
      ).match(
        /\/color\/(\d+)\.jpg/i
      );

    return m
      ? m[1]
      : '';
  }

  function parseAnitaStock(html) {
    const doc =
      new DOMParser()
        .parseFromString(
          String(html || ''),
          'text/html'
        );

    const tables =
      $$(
        '.shop-article-tables table[data-article-number]',
        doc
      );

    const out = {
      article:
        tables[0]
          ?.dataset
          .articleNumber ||
        null,

      tableCount:
        tables.length,

      colors: {}
    };

    for (const table of tables) {
      let colorNo =
        String(
          table.dataset.colorNumber || ''
        ).trim();

      if (!colorNo) {
        colorNo =
          colorFromImg(table);
      }

      const colorName =
        String(
          table.dataset.colorName || ''
        ).trim();

      const bandHeaders =
        $$(
          'thead th',
          table
        )
          .map(
            th =>
              th.textContent.trim()
          )
          .filter(
            v =>
              v &&
              !/^(Inkoopprijs|Verkoopprijs)$/i
                .test(v)
          );

      const rows =
        $$(
          'tbody tr',
          table
        );

      const hasCup =
        rows.some(
          row =>
            String(
              row
                .querySelector(
                  'th[scope="row"]'
                )
                ?.textContent ||
              ''
            )
              .trim()
              .length > 0
        );

      const sizes = {};

      for (const row of rows) {
        const cup =
          String(
            row
              .querySelector(
                'th[scope="row"]'
              )
              ?.textContent ||
            ''
          ).trim();

        if (
          hasCup &&
          !cup
        ) {
          continue;
        }

        $$(
          'td',
          row
        ).forEach(
          (td, index) => {
            const band =
              bandHeaders[index];

            const input =
              $(
                'input[data-in-stock]',
                td
              );

            if (
              !band ||
              !input
            ) {
              return;
            }

            const key =
              (
                hasCup
                  ? `${band}${cup}`
                  : String(band)
              ).replace(
                /\s+/g,
                ''
              );

            const qty =
              parseInt(
                input.getAttribute(
                  'data-in-stock'
                ) || '0',
                10
              ) || 0;

            sizes[key] =
              qty;
          }
        );
      }

      if (colorNo) {
        out.colors[
          colorNo
        ] = {
          name:
            colorName,

          sizes
        };
      }
    }

    return out;
  }

  async function fetchArticle(params) {
    const key =
      articleKey(params);

    if (
      ARTICLE_CACHE.has(key)
    ) {
      return ARTICLE_CACHE.get(
        key
      );
    }

    const promise =
      (async () => {
        const url =
          build441Url(params);

        const started =
          performance.now();

        try {
          const res =
            await fetchViaGM(url);

          const ms =
            Math.round(
              performance.now() -
              started
            );

          if (
            res.status < 200 ||
            res.status >= 300
          ) {
            console.warn(
              `[Anita-worker] ${key}: ` +
              `HTTP ${res.status} ` +
              `in ${ms} ms -> 0-stock`
            );

            return {
              ok: false,

              reason:
                `HTTP ${res.status}`,

              url,

              ms,

              parsed: {
                article: null,
                tableCount: 0,
                colors: {}
              }
            };
          }

          const parsed =
            parseAnitaStock(
              res.text
            );

          if (
            !parsed.tableCount
          ) {
            console.warn(
              `[Anita-worker] ${key}: ` +
              `geen maattabel ` +
              `in ${ms} ms -> 0-stock`
            );

            return {
              ok: false,

              reason:
                'geen maattabel',

              url,

              ms,

              parsed
            };
          }

          console.info(
            `[Anita-worker] ${key}: ` +
            `${parsed.tableCount} kleur(en) ` +
            `in ${ms} ms`
          );

          return {
            ok: true,
            reason: '',
            url,
            ms,
            parsed
          };

        } catch (error) {
          const ms =
            Math.round(
              performance.now() -
              started
            );

          console.warn(
            `[Anita-worker] ${key}: ` +
            `request mislukt ` +
            `in ${ms} ms -> 0-stock`,
            error
          );

          return {
            ok: false,

            reason:
              String(
                error?.message ||
                error
              ),

            url,

            ms,

            parsed: {
              article: null,
              tableCount: 0,
              colors: {}
            }
          };
        }
      })();

    ARTICLE_CACHE.set(
      key,
      promise
    );

    return promise;
  }

  const normColor =
    raw => {
      const stripped =
        String(raw || '')
          .trim()
          .replace(
            /^0+/,
            ''
          );

      return (
        stripped === ''
          ? '0'
          : stripped
      );
    };

  function chooseColor(
    parsed,
    fbnr
  ) {
    const colors =
      parsed?.colors || {};

    const asked =
      String(
        fbnr || ''
      ).trim();

    if (!asked) {
      const entries =
        Object.values(
          colors
        );

      if (
        entries.length === 1
      ) {
        return (
          entries[0].sizes ||
          {}
        );
      }

      const merged = {};

      for (
        const color
        of entries
      ) {
        for (
          const [
            size,
            stock
          ]
          of Object.entries(
            color.sizes || {}
          )
        ) {
          merged[size] =
            Math.max(
              merged[size] || 0,
              Number(
                stock || 0
              )
            );
        }
      }

      return merged;
    }

    if (
      colors[asked]
    ) {
      return (
        colors[asked].sizes ||
        {}
      );
    }

    const askedN =
      normColor(asked);

    const key =
      Object.keys(
        colors
      ).find(
        k =>
          normColor(k) ===
          askedN
      );

    return (
      key
        ? colors[key].sizes || {}
        : {}
    );
  }

  function resolveRemoteQty(
    remoteMap,
    label
  ) {
    const raw =
      String(
        label || ''
      ).trim();

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          remoteMap,
          raw
        )
    ) {
      return Number(
        remoteMap[raw] || 0
      );
    }

    const noSpace =
      raw.replace(
        /\s+/g,
        ''
      );

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          remoteMap,
          noSpace
        )
    ) {
      return Number(
        remoteMap[noSpace] || 0
      );
    }

    const braAlt =
      raw.match(
        /^(\d+)\s*([A-Za-z]{1,2}(?:\/[A-Za-z]{1,2})+)$/
      );

    if (braAlt) {
      const band =
        braAlt[1];

      let best = -1;

      for (
        const cup
        of braAlt[2]
          .split('/')
      ) {
        const key =
          `${band}${cup}`
            .replace(
              /\s+/g,
              ''
            );

        if (
          Object.prototype
            .hasOwnProperty
            .call(
              remoteMap,
              key
            )
        ) {
          best =
            Math.max(
              best,
              Number(
                remoteMap[key] || 0
              )
            );
        }
      }

      if (
        best >= 0
      ) {
        return best;
      }
    }

    if (
      raw.includes('/')
    ) {
      let best = -1;

      for (
        const part
        of raw
          .split('/')
          .map(
            s =>
              s.trim()
          )
      ) {
        const key =
          part.replace(
            /\s+/g,
            ''
          );

        if (
          Object.prototype
            .hasOwnProperty
            .call(
              remoteMap,
              part
            )
        ) {
          best =
            Math.max(
              best,
              Number(
                remoteMap[part] || 0
              )
            );

        } else if (
          Object.prototype
            .hasOwnProperty
            .call(
              remoteMap,
              key
            )
        ) {
          best =
            Math.max(
              best,
              Number(
                remoteMap[key] || 0
              )
            );
        }
      }

      if (
        best >= 0
      ) {
        return best;
      }
    }

    return undefined;
  }

  function readLocalTable(
    table
  ) {
    const out = [];

    for (
      const tr
      of Array.from(
        table.querySelectorAll(
          'tbody tr'
        )
      )
    ) {
      const maatRaw =
        tr.dataset.size ||
        tr.children?.[0]
          ?.textContent ||
        '';

      const maat =
        String(
          maatRaw
        ).trim();

      if (!maat) {
        continue;
      }

      const local =
        parseInt(
          String(
            tr.children?.[1]
              ?.textContent ||
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

  function getMaxCap(
    table
  ) {
    try {
      if (
        typeof Core.getMaxCap ===
        'function'
      ) {
        return Core.getMaxCap(
          table
        );
      }
    } catch {}

    return 5;
  }

  function applyCompareAndMark(
    localRows,
    remoteMap,
    maxCap,
    forceMissingToZero = false
  ) {
    const report = [];

    for (
      const { tr }
      of localRows
    ) {
      Core.clearRowMarks(
        tr
      );
    }

    for (
      const {
        tr,
        maat,
        local
      }
      of localRows
    ) {
      let remoteQty =
        resolveRemoteQty(
          remoteMap,
          maat
        );

      if (
        typeof remoteQty !==
        'number'
      ) {
        if (
          !forceMissingToZero
        ) {
          continue;
        }

        remoteQty = 0;
      }

      const target =
        SR.mapRemoteToTarget(
          BRAND_KEY,
          remoteQty,
          maxCap
        );

      const res =
        SR.reconcile(
          local,
          target,
          maxCap
        );

      const delta =
        Number(
          res?.delta || 0
        );

      let status =
        'ok';

      if (
        res?.action ===
          'bijboeken' &&
        delta > 0
      ) {
        Core.markRow(
          tr,
          {
            action: 'add',

            delta,

            title:
              `Bijboeken ${delta} ` +
              `(target ${target}, remote ${remoteQty})`
          }
        );

        status =
          'bijboeken';

      } else if (
        res?.action ===
          'uitboeken' &&
        delta > 0
      ) {
        Core.markRow(
          tr,
          {
            action: 'remove',

            delta,

            title:
              `Uitboeken ${delta} ` +
              `(target ${target}, remote ${remoteQty})`
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
              `(target ${target}, remote ${remoteQty})`
          }
        );
      }

      report.push({
        maat,
        local,
        remote:
          remoteQty,
        target,
        delta,
        status
      });
    }

    return report;
  }

  function collectJobs(
    tables
  ) {
    const jobs = [];

    const uniqueArticles =
      new Map();

    for (
      const table
      of tables
    ) {
      const sku =
        getSkuFromTable(
          table
        );

      const parsed =
        getPidHintsFromTable(
          table
        );

      const anchorId =
        sku ||
        parsed.arnr ||
        table.id ||
        'onbekend';

      const job = {
        table,
        sku,
        anchorId,
        ...parsed
      };

      jobs.push(
        job
      );

      if (
        parsed.arnr
      ) {
        const key =
          articleKey(
            parsed
          );

        if (
          !uniqueArticles.has(
            key
          )
        ) {
          uniqueArticles.set(
            key,
            {
              key,

              koll:
                parsed.koll,

              arnr:
                parsed.arnr
            }
          );
        }
      }
    }

    return {
      jobs,

      articles:
        [
          ...uniqueArticles
            .values()
        ]
    };
  }

  async function runPool(
    items,
    concurrency,
    worker,
    progress
  ) {
    let cursor = 0;
    let done = 0;

    const runners =
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              items.length
            )
        },

        async () => {
          while (true) {
            const index =
              cursor++;

            if (
              index >=
              items.length
            ) {
              return;
            }

            await worker(
              items[index],
              index
            );

            done++;

            progress?.(
              done,
              items.length
            );
          }
        }
      );

    await Promise.all(
      runners
    );
  }

  async function run(
    btn
  ) {
    const tables =
      Array.from(
        document.querySelectorAll(
          '#output table'
        )
      );

    if (
      !tables.length
    ) {
      console.warn(
        '[Anita] Geen lokale producttabellen gevonden.'
      );

      return;
    }

    ARTICLE_CACHE.clear();

    const {
      jobs,
      articles
    } =
      collectJobs(
        tables
      );

    const jobByTable =
      new Map(
        jobs.map(
          job => [
            job.table,
            job
          ]
        )
      );

    const resultByArticle =
      new Map();

    console.info(
      `[Anita] ${tables.length} lokale tabellen ` +
      `-> ${articles.length} unieke artikelrequests`
    );

    if (btn) {
      btn.disabled = true;
    }

    const started =
      performance.now();

    try {
      /*
       * =====================================
       * FASE 1
       * SUPPLIERDATA OPHALEN
       * =====================================
       */

      Logger.progress(
        `Anita ophalen: 0/${articles.length} (0%)`
      );

      await runPool(
        articles,

        CONCURRENCY,

        async item => {
          const result =
            await fetchArticle(
              item
            );

          resultByArticle.set(
            item.key,
            result
          );
        },

        (
          done,
          total
        ) => {
          const pct =
            total > 0
              ? Math.round(
                  done /
                  total *
                  100
                )
              : 100;

          const text =
            `Anita ophalen: ` +
            `${done}/${total} ` +
            `(${pct}%)`;

          if (btn) {
            btn.title =
              text;
          }

          Logger.progress(
            text
          );
        }
      );

      Logger.progress(
        `Anita opgehaald: ` +
        `${articles.length}/${articles.length} ` +
        `— voorraad verwerken…`
      );

      /*
       * =====================================
       * FASE 2
       * LOKALE TABELLEN VERWERKEN
       * =====================================
       */

      let totalDiffs = 0;

      let failedArticles = 0;

      let processedTables = 0;

      for (
        const result
        of resultByArticle
          .values()
      ) {
        if (
          !result.ok
        ) {
          failedArticles++;
        }
      }

      Logger.progress(
        `Voorraad verwerken: ` +
        `0/${tables.length} (0%)`
      );

      await Core.runTables({
        btn,

        tables,

        concurrency:
          30,

        perTable:
          async table => {
            const job =
              jobByTable.get(
                table
              );

            try {
              if (
                !job?.arnr
              ) {
                Logger.status(
                  job?.anchorId ||
                  'onbekend',

                  '0-stock'
                );

                const localRows =
                  readLocalTable(
                    table
                  );

                const report =
                  applyCompareAndMark(
                    localRows,
                    {},
                    getMaxCap(
                      table
                    ),
                    true
                  );

                Logger.perMaat(
                  job?.anchorId ||
                  'onbekend',

                  report
                );

                const diffs =
                  report.filter(
                    r =>
                      r.status ===
                        'bijboeken' ||
                      r.status ===
                        'uitboeken'
                  ).length;

                totalDiffs +=
                  diffs;

                return diffs;
              }

              const key =
                articleKey(
                  job
                );

              const articleResult =
                resultByArticle.get(
                  key
                );

              const articleOk =
                Boolean(
                  articleResult?.ok
                );

              const remoteMap =
                articleOk
                  ? chooseColor(
                      articleResult
                        .parsed,

                      job.fbnr
                    )
                  : {};

              const colorFound =
                job.fbnr
                  ? Object
                      .keys(
                        articleResult
                          ?.parsed
                          ?.colors ||
                        {}
                      )
                      .some(
                        k =>
                          normColor(
                            k
                          ) ===
                          normColor(
                            job.fbnr
                          )
                      )

                  : Object.keys(
                      remoteMap
                    ).length > 0;

              const forceZero =
                !articleOk ||
                !colorFound;

              if (
                forceZero
              ) {
                console.warn(
                  `[Anita][${job.sku || job.arnr}] ` +
                  (
                    !articleOk
                      ? 'artikelrequest mislukt/geen tabel'
                      : `kleur ${job.fbnr || '?'} ontbreekt`
                  ) +
                  ' -> 0-stock'
                );
              }

              const localRows =
                readLocalTable(
                  table
                );

              const report =
                applyCompareAndMark(
                  localRows,

                  remoteMap,

                  getMaxCap(
                    table
                  ),

                  forceZero
                );

              const diffs =
                report.filter(
                  r =>
                    r.status ===
                      'bijboeken' ||
                    r.status ===
                      'uitboeken'
                ).length;

              totalDiffs +=
                diffs;

              Logger.status(
                job.anchorId,

                forceZero
                  ? '0-stock'
                  : (
                      diffs
                        ? 'afwijking'
                        : 'ok'
                    )
              );

              Logger.perMaat(
                job.anchorId,
                report
              );

              return diffs;

            } finally {
              processedTables++;

              const pct =
                tables.length > 0
                  ? Math.round(
                      processedTables /
                      tables.length *
                      100
                    )
                  : 100;

              const text =
                `Voorraad verwerken: ` +
                `${processedTables}/${tables.length} ` +
                `(${pct}%)`;

              if (btn) {
                btn.title =
                  text;
              }

              Logger.progress(
                text
              );
            }
          }
      });

      const totalMs =
        Math.round(
          performance.now() -
          started
        );

      const totalSec =
        (
          totalMs /
          1000
        ).toFixed(
          1
        );

      Logger.progress(
        `Klaar — ` +
        `${tables.length} producten gecontroleerd ` +
        `in ${totalSec}s`
      );

      console.info(
        `[Anita] klaar: ` +
        `${articles.length} unieke artikelen, ` +
        `${failedArticles} supplierfouten/lege resultaten, ` +
        `${totalDiffs} afwijkingen, ` +
        `${totalSec}s totaal`
      );

    } finally {
      if (btn) {
        btn.disabled = false;

        btn.title =
          'Controleer voorraad bij Anita of Rosa Faia';
      }
    }
  }

  function normBlob(
    s = ''
  ) {
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

  function isAllowedSupplierSelected() {
    const dd =
      document.getElementById(
        'leverancier-keuze'
      );

    if (!dd) {
      return true;
    }

    const opt =
      dd.options[
        dd.selectedIndex
      ] || null;

    const byValue =
      normBlob(
        dd.value || ''
      )
        .replace(
          /\s+/g,
          '-'
        );

    const byText =
      normBlob(
        opt
          ? opt.text || ''
          : ''
      )
        .replace(
          /\s+/g,
          '-'
        );

    return (
      ALLOWED_SUPPLIERS.has(
        byValue
      ) ||
      ALLOWED_SUPPLIERS.has(
        byText
      )
    );
  }

  registerUserscript();

  const mounted =
    Core.mountSupplierButton({
      id:
        'stock-check-anita-btn',

      text:
        'Controleer Anita',

      right:
        250,

      top:
        8,

      match:
        () =>
          isAllowedSupplierSelected(),

      onClick:
        btn =>
          run(
            btn
          )
    });

  mounted.btn.innerHTML =
    '<i class="fa-solid fa-magnifying-glass-chart"></i>';

  mounted.btn.setAttribute(
    'aria-label',
    'Controleer voorraad bij Anita of Rosa Faia'
  );

  mounted.btn.title =
    'Controleer voorraad bij Anita of Rosa Faia';

  console.info(
    `[VCP2|Anita] v${VERSION} actief | ` +
    `article batching concurrency=${CONCURRENCY}`
  );
})();

