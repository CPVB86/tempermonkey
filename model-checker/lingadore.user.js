// ==UserScript==
// @name         DDO | Model Checker LingaDore
// @namespace    https://runiversity.nl/
// @version      1.1.0
// @description  Vergelijkt alle LingaDore kleurvarianten met DDO en maakt PDP kleurfilters als pills
// @match        https://b2b.lingadore.com/*
// @grant        GM_xmlhttpRequest
// @connect      dutchdesignersoutlet.com
// @connect      www.dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/lingadore.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/model-checker/lingadore.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================

  const DDO_BRAND_IDS = [2, 58, 61, 146];

  const EXPORT_PAYLOAD = {
    format: 'excel',
    export: 'Export products'
  };

  const STORAGE_KEY_PREFIX =
    'ddoModelCheckerCacheV1:lingadore';

  const CACHE_TTL_MS =
    15 * 60 * 1000;

  const IMAGE_PREFIX =
    'https://www.dutchdesignersoutlet.com/img/product/';

  const SHEET_PREFERRED = 'Parent';

  const COL_IMAGE = 1;
  const COL_PRODUCT_ID = 3;

  const HEADER_ROW_INDEX = 0;


  const STATUS = {
    ALL: 'Alles in DDO',
    PARTIAL: 'Deels in DDO',
    MISS: 'Niet in DDO'
  };


  const state = {
    ddoMap: null,
    observer: null,
    compareTimer: null,
    loading: false,
    minimized: false,
    pdpObserver: null,
    pdpTimer: null
  };


  // ============================================================
  // CSS
  // ============================================================

  injectCSS(`

    /* ==========================================================
       MODEL CHECKER PANEL
       ========================================================== */

    #ddo-model-checker {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      width: 360px;
      max-width: calc(100vw - 32px);
      background: #111827;
      color: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.28);
      padding: 14px;
      font: 13px/1.4 Arial, sans-serif;
    }

    #ddo-model-checker * {
      box-sizing: border-box;
      font: inherit;
    }

    #ddo-model-checker .ddo-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    #ddo-model-checker .ddo-title {
      font-weight: 700;
      font-size: 14px;
      margin: 0;
    }

    #ddo-model-checker .ddo-toggle-btn {
      background: rgba(255,255,255,.12);
      color: #fff;
      border: 0;
      border-radius: 8px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-weight: 700;
      line-height: 1;
    }

    #ddo-model-checker button:not(.ddo-toggle-btn) {
      border: 0;
      border-radius: 8px;
      padding: 8px 10px;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
      white-space: nowrap;
    }

    #ddo-model-checker button:disabled {
      opacity: .65;
      cursor: wait;
    }

    #ddo-model-checker .ddo-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    #ddo-model-checker .ddo-status {
      background: rgba(255,255,255,.08);
      border-radius: 8px;
      padding: 8px 10px;
      min-height: 38px;
      word-break: break-word;
    }

    #ddo-model-checker .ddo-summary {
      margin-top: 8px;
      font-size: 12px;
      opacity: .95;
      white-space: pre-wrap;
    }

    #ddo-remove-matches-btn {
      background: #dc2626 !important;
    }

    #ddo-export-csv-btn {
      background: #059669 !important;
    }


    /* ==========================================================
       GRID CARD STATUS
       ========================================================== */

    .ddo-card-checked {
      outline: 2px solid transparent !important;
      outline-offset: 2px !important;
      position: relative !important;
      transition: outline-color .2s ease !important;
    }

    .ddo-card-all {
      outline-color: #16a34a !important;
    }

    .ddo-card-partial {
      outline-color: #f59e0b !important;
    }

    .ddo-card-miss {
      outline-color: #dc2626 !important;
    }

    .ddo-card-all .item-main-img {
      opacity: .45 !important;
      transition: opacity .2s ease !important;
    }

    .ddo-card-all:hover .item-main-img {
      opacity: .72 !important;
    }


    /* ==========================================================
       GRID CARD STATUS BADGE
       ========================================================== */

    .ddo-card-status {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 100;
      border-radius: 999px;
      padding: 5px 9px;
      font: 12px/1 Arial, sans-serif;
      font-weight: 700;
      color: #fff;
      box-shadow: 0 4px 12px rgba(0,0,0,.18);
      pointer-events: none;
      user-select: none;
    }

    .ddo-card-all .ddo-card-status {
      background: #16a34a;
    }

    .ddo-card-partial .ddo-card-status {
      background: #f59e0b;
      color: #111827;
    }

    .ddo-card-miss .ddo-card-status {
      background: #dc2626;
    }


    /* ==========================================================
       GRID VARIANT RESULTS
       ========================================================== */

    .ddo-variant-results {
      position: absolute;
      left: 8px;
      bottom: 8px;
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-width: calc(100% - 16px);
      pointer-events: auto;
    }

    .ddo-variant-pill {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      max-width: 100%;
      padding: 4px 7px;
      border-radius: 999px;
      font: 11px/1.2 Arial, sans-serif;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }

    .ddo-variant-pill--match {
      background: #16a34a;
      color: #fff;
    }

    .ddo-variant-pill--miss {
      background: #dc2626;
      color: #fff;
    }

    a.ddo-variant-pill--match:hover {
      filter: brightness(1.1);
      color: #fff;
      text-decoration: none;
    }


    /* ==========================================================
       PDP COLOR PILLS
       ========================================================== */

    .ddo-color-pill-wrapper {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }

    .ddo-color-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 36px;
      padding: 5px 11px 5px 6px;
      border: 2px solid #d1d5db;
      border-radius: 999px;
      background: #fff;
      color: #111827;
      font: 12px/1.2 Arial, sans-serif;
      font-weight: 700;
      cursor: pointer;
      transition:
        border-color .15s ease,
        box-shadow .15s ease,
        transform .15s ease;
    }

    .ddo-color-pill:hover {
      border-color: #6b7280;
      transform: translateY(-1px);
    }

    .ddo-color-pill.active {
      border-color: #111827;
      box-shadow:
        0 0 0 2px rgba(17,24,39,.12);
    }

    .ddo-color-pill-swatch {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      border-radius: 50%;
      border: 1px solid rgba(0,0,0,.18);
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,.15);
    }

    .ddo-color-pill-check {
      display: none;
      font-size: 11px;
      font-weight: 900;
    }

    .ddo-color-pill.active
    .ddo-color-pill-check {
      display: inline;
    }


    /* Originele LingaDore select blijft bestaan,
       maar wordt visueel verborgen. */

    .matrix-filters
    .ddo-original-color-select {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

  `);


  // ============================================================
  // INIT
  // ============================================================

  init();


  async function init() {

    createPanel();

    bindEvents();

    enableNativeModifierClick();

    startObserver();

    initPDPColorPills();

    await loadAndCompare();
  }


  // ============================================================
  // PANEL
  // ============================================================

  function createPanel() {

    if (
      document.querySelector(
        '#ddo-model-checker'
      )
    ) {
      return;
    }


    const panel =
      document.createElement('div');


    panel.id =
      'ddo-model-checker';


    panel.innerHTML = `

      <div class="ddo-head">

        <div class="ddo-title">
          Model-checker LingaDore
        </div>

        <button
          id="ddo-toggle-btn"
          type="button"
          class="ddo-toggle-btn"
          title="Minimaliseer"
        >
          −
        </button>

      </div>


      <div id="ddo-panel-body">

        <div class="ddo-row">

          <button
            id="ddo-refresh-btn"
            type="button"
          >
            Check
          </button>

          <button
            id="ddo-remove-matches-btn"
            type="button"
          >
            Verwijder complete
          </button>

          <button
            id="ddo-export-csv-btn"
            type="button"
          >
            Export CSV
          </button>

        </div>


        <div
          id="ddo-status"
          class="ddo-status"
        >
          Klaar.
        </div>


        <div
          id="ddo-summary"
          class="ddo-summary"
        ></div>

      </div>
    `;


    document.body.appendChild(
      panel
    );
  }


  // ============================================================
  // EVENTS
  // ============================================================

  function bindEvents() {

    document
      .querySelector(
        '#ddo-refresh-btn'
      )
      ?.addEventListener(
        'click',
        async () => {

          await loadAndCompare({
            forceRefresh: true
          });

        }
      );


    document
      .querySelector(
        '#ddo-remove-matches-btn'
      )
      ?.addEventListener(
        'click',
        () => {

          const removed =
            removeFullyMatchedCards();


          setStatus(
            `${removed} volledig aanwezige cards verwijderd.`
          );

        }
      );


    document
      .querySelector(
        '#ddo-export-csv-btn'
      )
      ?.addEventListener(
        'click',
        () => {

          const count =
            exportGridToCSV();


          setStatus(
            `${count} kleurvarianten geëxporteerd naar CSV.`
          );

        }
      );


    document
      .querySelector(
        '#ddo-toggle-btn'
      )
      ?.addEventListener(
        'click',
        () => {

          state.minimized =
            !state.minimized;


          const body =
            document.querySelector(
              '#ddo-panel-body'
            );


          const btn =
            document.querySelector(
              '#ddo-toggle-btn'
            );


          if (
            !body ||
            !btn
          ) {
            return;
          }


          body.style.display =
            state.minimized
              ? 'none'
              : '';


          btn.textContent =
            state.minimized
              ? '+'
              : '−';


          btn.title =
            state.minimized
              ? 'Open'
              : 'Minimaliseer';

        }
      );
  }


  // ============================================================
  // UI HELPERS
  // ============================================================

  function setStatus(text) {

    const el =
      document.querySelector(
        '#ddo-status'
      );


    if (el) {
      el.textContent = text;
    }
  }


  function setSummary(text) {

    const el =
      document.querySelector(
        '#ddo-summary'
      );


    if (el) {
      el.textContent = text;
    }
  }


  function setLoading(isLoading) {

    state.loading =
      isLoading;


    const btn =
      document.querySelector(
        '#ddo-refresh-btn'
      );


    if (btn) {
      btn.disabled =
        isLoading;
    }
  }


  // ============================================================
  // LOAD + COMPARE
  // ============================================================

  async function loadAndCompare(
    options = {}
  ) {

    const {
      forceRefresh = false
    } = options;


    try {

      setLoading(true);


      setStatus(
        `Bezig met ophalen DDO brand exports (${DDO_BRAND_IDS.join(', ')})…`
      );


      setSummary('');


      const ddoMap =
        await getArticleMap(
          'ddo',
          forceRefresh
        );


      state.ddoMap =
        ddoMap;


      setStatus(
        `DDO exports geladen: ${ddoMap.size} producten`
      );


      runCompare();


    } catch (err) {

      console.error(
        '[DDO Model Checker LingaDore]',
        err
      );


      setStatus(
        `Fout: ${err.message || err}`
      );


      setSummary('');


    } finally {

      setLoading(false);

    }
  }


  // ============================================================
  // GRID COMPARE
  // ============================================================

  function runCompare() {

    if (!state.ddoMap) {

      setStatus(
        'Geen exportdata geladen.'
      );

      return;
    }


    const cards =
      findProductCards();


    let totalCards = 0;

    let allCards = 0;
    let partialCards = 0;
    let missCards = 0;

    let totalVariants = 0;
    let matchedVariants = 0;
    let missingVariants = 0;


    for (const card of cards) {

      const variants =
        extractLingaDoreVariantsFromCard(
          card
        );


      if (!variants.length) {
        continue;
      }


      totalCards++;


      const results =
        variants.map(
          variant => {

            const result =
              getStatusForCode(
                variant.code
              );


            if (result.match) {
              matchedVariants++;
            } else {
              missingVariants++;
            }


            totalVariants++;


            return {
              ...variant,
              ...result
            };

          }
        );


      const matches =
        results.filter(
          item => item.match
        ).length;


      let cardStatus;


      if (
        matches ===
        results.length
      ) {

        cardStatus =
          STATUS.ALL;

        allCards++;


      } else if (
        matches > 0
      ) {

        cardStatus =
          STATUS.PARTIAL;

        partialCards++;


      } else {

        cardStatus =
          STATUS.MISS;

        missCards++;

      }


      markCard(
        card,
        cardStatus,
        results
      );
    }


    setStatus(
      'LingaDore gecontroleerd.'
    );


    setSummary(
      `Cards: ${totalCards}` +
      ` | compleet: ${allCards}` +
      ` | deels: ${partialCards}` +
      ` | geen: ${missCards}\n` +
      `Kleuren: ${totalVariants}` +
      ` | in DDO: ${matchedVariants}` +
      ` | ontbreken: ${missingVariants}`
    );
  }


  function getStatusForCode(code) {

    const ddoInfo =
      state.ddoMap.get(code);


    if (ddoInfo) {

      return {
        match: true,

        productId:
          ddoInfo.productId ||
          null,

        ddoEditId:
          ddoInfo.ddoEditId ||
          null
      };
    }


    return {
      match: false,
      productId: null,
      ddoEditId: null
    };
  }


  // ============================================================
  // PRODUCT CARDS
  // ============================================================

  function findProductCards() {

    return Array.from(
      document.querySelectorAll(
        '.item-wrapper'
      )
    );
  }


  // ============================================================
  // LINGADORE VARIANTS UIT CARD
  // ============================================================

  function extractLingaDoreVariantsFromCard(
    card
  ) {

    if (!card) {
      return [];
    }


    const item =
      card.matches('.item')
        ? card
        : card.querySelector('.item');


    if (!item) {
      return [];
    }


    // ----------------------------------------------------------
    // MODEL
    //
    // <div class="item"
    //      data-model-no="1341">
    // ----------------------------------------------------------

    let model =
      item.getAttribute(
        'data-model-no'
      ) || '';


    if (!model) {

      model =
        item
          .querySelector(
            '.model-no'
          )
          ?.textContent ||
        '';

    }


    model =
      normalizeModelNumber(
        model
      );


    if (!model) {
      return [];
    }


    const variants = [];

    const seen =
      new Set();


    // ----------------------------------------------------------
    // PRIMAIRE BRON
    //
    // .item-colors
    //
    // data-color="01"
    // data-color="02"
    // data-color="03"
    // etc.
    // ----------------------------------------------------------

    item
      .querySelectorAll(
        '.item-colors .color[data-color]'
      )
      .forEach(
        colorEl => {

          const color =
            normalizeColorCode(
              colorEl.getAttribute(
                'data-color'
              )
            );


          if (!color) {
            return;
          }


          const code =
            buildLingaDoreCode(
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
              colorEl.getAttribute(
                'title'
              ) || ''
          });

        }
      );


    // ----------------------------------------------------------
    // FALLBACK:
    // thumbnail data-color
    // ----------------------------------------------------------

    if (!variants.length) {

      item
        .querySelectorAll(
          '.image-thumbs [data-color]'
        )
        .forEach(
          colorEl => {

            const color =
              normalizeColorCode(
                colorEl.getAttribute(
                  'data-color'
                )
              );


            if (!color) {
              return;
            }


            const code =
              buildLingaDoreCode(
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


    // ----------------------------------------------------------
    // LAATSTE FALLBACK:
    //
    // data-style="03-D"
    //
    // => 03
    // ----------------------------------------------------------

    if (!variants.length) {

      const rawStyle =
        item.getAttribute(
          'data-style'
        );


      const color =
        normalizeColorCode(
          rawStyle
        );


      if (color) {

        const code =
          buildLingaDoreCode(
            model,
            color
          );


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


  // ============================================================
  // NORMALISATIE
  // ============================================================

  function normalizeModelNumber(
    value
  ) {

    if (value == null) {
      return null;
    }


    const s =
      String(value)
        .trim()
        .toUpperCase();


    return s || null;
  }


  function normalizeColorCode(
    value
  ) {

    if (value == null) {
      return null;
    }


    let s =
      String(value)
        .trim()
        .toUpperCase();


    if (!s) {
      return null;
    }


    // ----------------------------------------------------------
    // LingaDore variant suffix verwijderen:
    //
    // 03-D  => 03
    // 03-B  => 03
    // 03-F  => 03
    // 01-G  => 01
    // 167-D => 167
    // ----------------------------------------------------------

    s =
      s.split('-')[0].trim();


    return s || null;
  }


  function buildLingaDoreCode(
    model,
    color
  ) {

    model =
      normalizeModelNumber(
        model
      );


    color =
      normalizeColorCode(
        color
      );


    if (
      !model ||
      !color
    ) {
      return null;
    }


    return `${model}-${color}`;
  }


  // ============================================================
  // GRID CARD MARKERING
  // ============================================================

  function markCard(
    card,
    cardStatus,
    results
  ) {

    clearSingleCardMarker(
      card
    );


    card.classList.add(
      'ddo-card-checked'
    );


    if (
      cardStatus ===
      STATUS.ALL
    ) {

      card.classList.add(
        'ddo-card-all'
      );


    } else if (
      cardStatus ===
      STATUS.PARTIAL
    ) {

      card.classList.add(
        'ddo-card-partial'
      );


    } else {

      card.classList.add(
        'ddo-card-miss'
      );

    }


    const matches =
      results.filter(
        result =>
          result.match
      ).length;


    // ----------------------------------------------------------
    // STATUS BADGE
    // ----------------------------------------------------------

    const status =
      document.createElement(
        'div'
      );


    status.className =
      'ddo-card-status';


    status.textContent =
      `${results.length} kleuren · ` +
      `${matches} in DDO · ` +
      `${results.length - matches} ontbreken`;


    card.appendChild(
      status
    );


    // ----------------------------------------------------------
    // VARIANT PILLS
    // ----------------------------------------------------------

    const resultBox =
      document.createElement(
        'div'
      );


    resultBox.className =
      'ddo-variant-results';


    for (
      const result
      of results
    ) {

      let pill;


      const productId =
        result.productId ||
        result.ddoEditId ||
        null;


      if (
        result.match &&
        productId
      ) {

        pill =
          document.createElement(
            'a'
          );


        pill.href =
          buildDDOEditUrl(
            productId
          );


        pill.target =
          '_blank';


        pill.rel =
          'noopener';


      } else {

        pill =
          document.createElement(
            'span'
          );

      }


      pill.classList.add(
        'ddo-variant-pill'
      );


      if (result.match) {

        pill.classList.add(
          'ddo-variant-pill--match'
        );


        pill.textContent =
          productId
            ? `✓ ${result.color} · PID ${productId}`
            : `✓ ${result.color}`;


      } else {

        pill.classList.add(
          'ddo-variant-pill--miss'
        );


        pill.textContent =
          `✕ ${result.color}`;

      }


      if (
        result.colorName
      ) {

        pill.title =
          `${result.code} · ${result.colorName}`;

      } else {

        pill.title =
          result.code;

      }


      resultBox.appendChild(
        pill
      );
    }


    card.appendChild(
      resultBox
    );


    card.dataset.ddoStatus =
      cardStatus;


    card.dataset.ddoVariants =
      JSON.stringify(
        results
      );
  }


  function clearSingleCardMarker(
    card
  ) {

    card.classList.remove(
      'ddo-card-checked',
      'ddo-card-all',
      'ddo-card-partial',
      'ddo-card-miss'
    );


    card
      .querySelectorAll(
        ':scope > .ddo-card-status, ' +
        ':scope > .ddo-variant-results'
      )
      .forEach(
        el => el.remove()
      );


    delete card.dataset.ddoStatus;

    delete card.dataset.ddoVariants;
  }


  function clearCardMarkers() {

    document
      .querySelectorAll(
        '.ddo-card-checked'
      )
      .forEach(
        clearSingleCardMarker
      );
  }


  // ============================================================
  // REMOVE COMPLETE CARDS
  // ============================================================

  function removeFullyMatchedCards() {

    const cards =
      document.querySelectorAll(
        '.ddo-card-all'
      );


    let removed = 0;


    cards.forEach(
      card => {

        card.remove();

        removed++;

      }
    );


    updateSummaryFromCurrentCards();


    return removed;
  }


  function updateSummaryFromCurrentCards() {

    const cards =
      document.querySelectorAll(
        '.ddo-card-checked'
      );


    let all = 0;
    let partial = 0;
    let miss = 0;


    cards.forEach(
      card => {

        if (
          card.classList.contains(
            'ddo-card-all'
          )
        ) {

          all++;


        } else if (
          card.classList.contains(
            'ddo-card-partial'
          )
        ) {

          partial++;


        } else if (
          card.classList.contains(
            'ddo-card-miss'
          )
        ) {

          miss++;

        }

      }
    );


    setSummary(
      `Cards: ${cards.length}` +
      ` | compleet: ${all}` +
      ` | deels: ${partial}` +
      ` | geen: ${miss}`
    );
  }


  // ============================================================
  // CSV EXPORT
  // ============================================================

  function exportGridToCSV() {

    const cards =
      findProductCards();


    const rows = [[
      'Model',
      'Kleurcode',
      'Kleurnaam',
      'DDO code',
      'Status',
      'DDO Product ID',
      'LingaDore URL'
    ]];


    let count = 0;


    for (
      const card
      of cards
    ) {

      const variants =
        extractLingaDoreVariantsFromCard(
          card
        );


      if (!variants.length) {
        continue;
      }


      const item =
        card.querySelector(
          '.item'
        );


      const detailUrl =
        item?.getAttribute(
          'data-detail'
        ) || '';


      for (
        const variant
        of variants
      ) {

        const result =
          getStatusForCode(
            variant.code
          );


        const productId =
          result.productId ||
          result.ddoEditId ||
          '';


        rows.push([
          variant.model,
          variant.color,
          variant.colorName,
          variant.code,

          result.match
            ? 'In DDO'
            : 'Niet in DDO',

          productId,
          detailUrl
        ]);


        count++;
      }
    }


    if (!count) {

      setStatus(
        'Geen LingaDore kleurvarianten gevonden.'
      );

      return 0;
    }


    const csv =
      toCSV(rows);


    const filename =
      `lingadore-model-check-${formatDateForFilename(new Date())}.csv`;


    downloadTextFile(
      filename,
      csv,
      'text/csv;charset=utf-8'
    );


    return count;
  }


  function toCSV(rows) {

    return rows
      .map(
        cols =>
          cols
            .map(
              escapeCSVValue
            )
            .join(',')
      )
      .join('\n');
  }


  function escapeCSVValue(
    value
  ) {

    const s =
      value == null
        ? ''
        : String(value);


    if (
      /[",\n;]/.test(s)
    ) {

      return `"${s.replace(/"/g, '""')}"`;

    }


    return s;
  }


  function downloadTextFile(
    filename,
    content,
    mimeType =
      'text/plain;charset=utf-8'
  ) {

    const blob =
      new Blob(
        [content],
        {
          type: mimeType
        }
      );


    const blobUrl =
      URL.createObjectURL(
        blob
      );


    const a =
      document.createElement(
        'a'
      );


    a.href =
      blobUrl;


    a.download =
      filename;


    document.body.appendChild(
      a
    );


    a.click();

    a.remove();


    setTimeout(
      () =>
        URL.revokeObjectURL(
          blobUrl
        ),
      1000
    );
  }


  function formatDateForFilename(
    date
  ) {

    const y =
      date.getFullYear();


    const m =
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        '0'
      );


    const d =
      String(
        date.getDate()
      ).padStart(
        2,
        '0'
      );


    const hh =
      String(
        date.getHours()
      ).padStart(
        2,
        '0'
      );


    const mm =
      String(
        date.getMinutes()
      ).padStart(
        2,
        '0'
      );


    return (
      `${y}${m}${d}-` +
      `${hh}${mm}`
    );
  }


  // ============================================================
  // DDO EXPORT
  // ============================================================

  async function getArticleMap(
    exportKey,
    forceRefresh = false
  ) {

    const cached =
      !forceRefresh
        ? readCache(
            exportKey
          )
        : null;


    if (cached) {

      return new Map(
        cached
      );

    }


    if (
      exportKey !==
      'ddo'
    ) {

      throw new Error(
        `Onbekende export: ${exportKey}`
      );

    }


    const maps =
      await Promise.all(

        DDO_BRAND_IDS.map(
          async brandId => {

            const arrayBuffer =
              await fetchExport(
                buildBrandExportUrl(
                  brandId
                ),
                EXPORT_PAYLOAD
              );


            return parseArticleMapFromWorkbook(
              arrayBuffer
            );

          }
        )

      );


    const articleMap =
      mergeArticleMaps(
        maps
      );


    writeCache(
      exportKey,
      [...articleMap.entries()]
    );


    return articleMap;
  }


  function buildBrandExportUrl(
    brandId
  ) {

    return (
      'https://www.dutchdesignersoutlet.com/' +
      'admin.php?section=products' +
      '&action=list' +
      '&filter=brand_id' +
      `&id=${encodeURIComponent(brandId)}`
    );
  }


  function mergeArticleMaps(
    maps
  ) {

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
          !merged.has(
            code
          )
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
        'Geen bruikbare Product ID koppelingen gevonden in DDO exports.'
      );

    }


    return merged;
  }


  function fetchExport(
    url,
    payload
  ) {

    return new Promise(
      (resolve, reject) => {

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
            res => {

              try {

                if (
                  res.status !==
                  200
                ) {

                  throw new Error(
                    `HTTP ${res.status} bij export ophalen`
                  );

                }


                if (
                  !res.response ||
                  !res.response.byteLength
                ) {

                  throw new Error(
                    'Lege export ontvangen'
                  );

                }


                resolve(
                  res.response
                );


              } catch (err) {

                reject(err);

              }

            },


          onerror:
            () =>
              reject(
                new Error(
                  'Netwerkfout bij export ophalen'
                )
              ),


          ontimeout:
            () =>
              reject(
                new Error(
                  'Timeout bij export ophalen'
                )
              )

        });

      }
    );
  }


  // ============================================================
  // EXCEL PARSER
  // ============================================================

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
        'Excel-bestand kon niet worden gelezen'
      );

    }


    if (
      !workbook.SheetNames?.length
    ) {

      throw new Error(
        'Geen sheets gevonden in export'
      );

    }


    const preferredNames =
      [];


    if (
      workbook.SheetNames.includes(
        SHEET_PREFERRED
      )
    ) {

      preferredNames.push(
        SHEET_PREFERRED
      );

    }


    for (
      const name
      of workbook.SheetNames
    ) {

      if (
        !preferredNames.includes(
          name
        )
      ) {

        preferredNames.push(
          name
        );

      }
    }


    let bestMap =
      new Map();


    for (
      const sheetName
      of preferredNames
    ) {

      const sheet =
        workbook.Sheets[
          sheetName
        ];


      if (!sheet) {
        continue;
      }


      const rows =
        XLSX.utils.sheet_to_json(
          sheet,
          {
            header: 1,
            raw: false,
            defval: '',
            blankrows: false
          }
        );


      if (
        !rows.length
      ) {
        continue;
      }


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


        const normalizedCode =
          normalizeDDOProductCode(
            rawProductId
          );


        if (
          !normalizedCode
        ) {

          continue;

        }


        const ddoEditId =
          extractDDOEditIdFromImageField(
            rawImage
          );


        const productId =
          extractProductIdFromImageField(
            rawImage
          );


        map.set(
          normalizedCode,
          {
            ddoEditId:
              ddoEditId ||
              null,

            productId:
              productId ||
              null
          }
        );

      }


      if (
        map.size >
        bestMap.size
      ) {

        bestMap =
          map;

      }


      if (
        sheetName ===
          SHEET_PREFERRED &&
        map.size > 0
      ) {

        break;

      }
    }


    if (
      !bestMap.size
    ) {

      throw new Error(
        'Geen bruikbare Product ID koppelingen gevonden.'
      );

    }


    return bestMap;
  }


  // ============================================================
  // DDO PRODUCT ID NORMALISATIE
  // ============================================================

  function normalizeDDOProductCode(
    value
  ) {

    if (
      value == null
    ) {

      return null;

    }


    let s =
      String(value)
        .trim()
        .toUpperCase();


    if (!s) {
      return null;
    }


    // ----------------------------------------------------------
    // DDO:
    //
    // 1341-03
    //
    // Maar indien aanwezig:
    //
    // 1341-03-D
    //
    // wordt eveneens:
    //
    // 1341-03
    // ----------------------------------------------------------

    const parts =
      s.split('-');


    if (
      parts.length >= 2
    ) {

      const model =
        parts[0].trim();


      const color =
        parts[1].trim();


      if (
        model &&
        color
      ) {

        return (
          `${model}-${color}`
        );

      }
    }


    return s;
  }


  // ============================================================
  // DDO IMAGE -> PRODUCT ID
  // ============================================================

  function extractDDOEditIdFromImageField(
    imageField
  ) {

    if (
      imageField == null
    ) {

      return null;

    }


    const text =
      String(
        imageField
      ).trim();


    if (!text) {
      return null;
    }


    const firstPart =
      text
        .split('|')[0]
        .trim();


    if (
      !firstPart.startsWith(
        IMAGE_PREFIX
      )
    ) {

      return null;

    }


    const rest =
      firstPart.slice(
        IMAGE_PREFIX.length
      );


    const match =
      rest.match(
        /^(\d{5,6})/
      );


    return match
      ? match[1]
      : null;
  }


  function extractProductIdFromImageField(
    imageField
  ) {

    if (
      imageField == null
    ) {

      return null;

    }


    const text =
      String(
        imageField
      ).trim();


    if (!text) {
      return null;
    }


    const firstPart =
      text
        .split('|')[0]
        .trim();


    if (
      !firstPart.startsWith(
        IMAGE_PREFIX
      )
    ) {

      return null;

    }


    const rest =
      firstPart.slice(
        IMAGE_PREFIX.length
      );


    const match =
      rest.match(
        /^(\d{5})/
      );


    return match
      ? match[1]
      : null;
  }


  function buildDDOEditUrl(
    productId
  ) {

    return (
      'https://www.dutchdesignersoutlet.com/' +
      'admin.php?section=products' +
      '&action=edit' +
      `&id=${encodeURIComponent(productId)}`
    );
  }


  // ============================================================
  // PDP COLOR PILLS
  // ============================================================

  function initPDPColorPills() {

    if (
      !isLingaDorePDP()
    ) {

      return;

    }


    buildPDPColorPills();


    if (
      state.pdpObserver
    ) {

      state.pdpObserver.disconnect();

    }


    state.pdpObserver =
      new MutationObserver(
        mutations => {

          // Onze eigen pills veroorzaken ook DOM-mutaties.
          // Alleen opnieuw controleren als er relevante nodes
          // worden toegevoegd/verwijderd.

          const relevant =
            mutations.some(
              mutation => {

                return Array
                  .from(
                    mutation.addedNodes
                  )
                  .concat(
                    Array.from(
                      mutation.removedNodes
                    )
                  )
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
                        el.classList?.contains(
                          'ddo-color-pill-wrapper'
                        )
                      ) {

                        return false;

                      }


                      return (
                        el.matches?.(
                          '.matrix-filters, .item-colors'
                        ) ||
                        el.querySelector?.(
                          '.matrix-filters, .item-colors'
                        )
                      );

                    }
                  );

              }
            );


          if (!relevant) {
            return;
          }


          clearTimeout(
            state.pdpTimer
          );


          state.pdpTimer =
            setTimeout(
              () => {

                buildPDPColorPills();

              },
              150
            );

        }
      );


    state.pdpObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }


  function isLingaDorePDP() {

    return (
      /^\/nl\/catalog\/item\/[^/]+\/?/.test(
        location.pathname
      )
    );
  }


  function buildPDPColorPills() {

    const select =
      document.querySelector(
        '.matrix-filters ' +
        'select[data-filter-attribute="color"]'
      );


    if (!select) {
      return;
    }


    // ----------------------------------------------------------
    // Bestaande pills?
    // Dan alleen synchroniseren.
    // ----------------------------------------------------------

    const existingWrapper =
      select
        .parentElement
        ?.querySelector(
          ':scope > .ddo-color-pill-wrapper'
        );


    if (
      existingWrapper
    ) {

      syncPDPColorPills(
        select,
        existingWrapper
      );

      return;
    }


    // ----------------------------------------------------------
    // Kleuren vanuit leverancier
    // ----------------------------------------------------------

    const supplierColors =
      getSupplierColorMap();


    const wrapper =
      document.createElement(
        'div'
      );


    wrapper.className =
      'ddo-color-pill-wrapper';


    // ----------------------------------------------------------
    // OPTIONS -> PILLS
    // ----------------------------------------------------------

    Array
      .from(
        select.options
      )
      .forEach(
        option => {

          // Placeholder overslaan.

          if (
            !option.value
          ) {

            return;

          }


          const colorCode =
            normalizeColorCode(
              option.value
            );


          if (
            !colorCode
          ) {

            return;

          }


          const colorName =
            option.textContent
              ?.trim() ||
            '';


          const supplierColor =
            supplierColors.get(
              colorCode
            );


          const pill =
            document.createElement(
              'button'
            );


          pill.type =
            'button';


          pill.className =
            'ddo-color-pill';


          pill.dataset.color =
            colorCode;


          pill.dataset.optionValue =
            option.value;


          // ----------------------------------------------------
          // SWATCH
          // ----------------------------------------------------

          const swatch =
            document.createElement(
              'span'
            );


          swatch.className =
            'ddo-color-pill-swatch';


          if (
            supplierColor
              ?.background
          ) {

            swatch.style.background =
              supplierColor.background;

          } else {

            swatch.style.background =
              '#e5e7eb';

          }


          // ----------------------------------------------------
          // CODE + NAAM
          //
          // 02 Zwart
          // 04 Ivoor
          // 05 Rood
          // ----------------------------------------------------

          const text =
            document.createElement(
              'span'
            );


          text.textContent =
            `${colorCode} ${colorName}`;


          // ----------------------------------------------------
          // ACTIVE CHECK
          // ----------------------------------------------------

          const check =
            document.createElement(
              'span'
            );


          check.className =
            'ddo-color-pill-check';


          check.textContent =
            '✓';


          pill.append(
            swatch,
            text,
            check
          );


          // ----------------------------------------------------
          // CLICK
          // ----------------------------------------------------

          pill.addEventListener(
            'click',
            () => {

              const originalValue =
                pill.dataset
                  .optionValue;


              if (
                select.value ===
                originalValue
              ) {

                syncPDPColorPills(
                  select,
                  wrapper
                );

                return;

              }


              // Originele waarde gebruiken.
              //
              // Dus wanneer LingaDore zelf
              // bijvoorbeeld "03-D" gebruikt,
              // blijft dat voor hun eigen systeem
              // gewoon "03-D".

              select.value =
                originalValue;


              // Onze pills meteen visueel
              // synchroniseren.

              syncPDPColorPills(
                select,
                wrapper
              );


              // LingaDore zelf laten reageren.

              select.dispatchEvent(
                new Event(
                  'change',
                  {
                    bubbles: true
                  }
                )
              );

            }
          );


          wrapper.appendChild(
            pill
          );

        }
      );


    if (
      !wrapper.children.length
    ) {

      return;

    }


    // ----------------------------------------------------------
    // ORIGINELE SELECT VERBERGEN
    // ----------------------------------------------------------

    select.classList.add(
      'ddo-original-color-select'
    );


    // ----------------------------------------------------------
    // PILLS PLAATSEN
    // ----------------------------------------------------------

    select.insertAdjacentElement(
      'afterend',
      wrapper
    );


    // ----------------------------------------------------------
    // ACTIEVE KLEUR
    // ----------------------------------------------------------

    syncPDPColorPills(
      select,
      wrapper
    );
  }


  // ============================================================
  // LEVERANCIER KLEUREN
  // ============================================================

  function getSupplierColorMap() {

    const map =
      new Map();


    document
      .querySelectorAll(
        '.item-colors ' +
        '.color[data-color]'
      )
      .forEach(
        colorEl => {

          const colorCode =
            normalizeColorCode(
              colorEl.getAttribute(
                'data-color'
              )
            );


          if (
            !colorCode
          ) {

            return;

          }


          const span =
            colorEl.querySelector(
              'span'
            );


          let background =
            '';


          if (span) {

            background =
              span.style.background ||
              span.style.backgroundColor ||
              '';

          }


          map.set(
            colorCode,
            {
              background,

              description:
                colorEl.getAttribute(
                  'data-description'
                ) || '',

              title:
                colorEl.getAttribute(
                  'title'
                ) || ''
            }
          );

        }
      );


    return map;
  }


  // ============================================================
  // PDP ACTIVE PILL
  // ============================================================

  function syncPDPColorPills(
    select,
    wrapper
  ) {

    if (
      !select ||
      !wrapper
    ) {

      return;

    }


    const activeColor =
      normalizeColorCode(
        select.value
      );


    wrapper
      .querySelectorAll(
        '.ddo-color-pill'
      )
      .forEach(
        pill => {

          const isActive =
            pill.dataset.color ===
            activeColor;


          pill.classList.toggle(
            'active',
            isActive
          );


          pill.setAttribute(
            'aria-pressed',
            isActive
              ? 'true'
              : 'false'
          );

        }
      );
  }


  // ============================================================
  // CACHE
  // ============================================================

  function getCacheKey(
    exportKey
  ) {

    return (
      `${STORAGE_KEY_PREFIX}:` +
      exportKey
    );
  }


  function readCache(
    exportKey
  ) {

    try {

      const raw =
        localStorage.getItem(
          getCacheKey(
            exportKey
          )
        );


      if (!raw) {
        return null;
      }


      const parsed =
        JSON.parse(
          raw
        );


      if (
        !parsed ||
        !parsed.timestamp ||
        !Array.isArray(
          parsed.items
        )
      ) {

        return null;

      }


      if (
        Date.now() -
          parsed.timestamp >
        CACHE_TTL_MS
      ) {

        return null;

      }


      return parsed.items;


    } catch {

      return null;

    }
  }


  function writeCache(
    exportKey,
    items
  ) {

    try {

      localStorage.setItem(

        getCacheKey(
          exportKey
        ),

        JSON.stringify({
          timestamp:
            Date.now(),

          items
        })

      );


    } catch (err) {

      console.warn(
        '[DDO Model Checker LingaDore] Cache opslaan mislukt:',
        err
      );

    }
  }


  // ============================================================
  // GRID MUTATION OBSERVER
  // ============================================================

  function startObserver() {

    if (
      state.observer
    ) {

      state.observer.disconnect();

    }


    state.observer =
      new MutationObserver(
        mutations => {

          if (
            !state.ddoMap ||
            state.loading
          ) {

            return;

          }


          // Eigen DDO elementen negeren.
          // Anders kan het toevoegen van onze badges
          // opnieuw een volledige compare triggeren.

          const relevant =
            mutations.some(
              mutation => {

                return Array
                  .from(
                    mutation.addedNodes
                  )
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
                        el.classList?.contains(
                          'ddo-card-status'
                        ) ||
                        el.classList?.contains(
                          'ddo-variant-results'
                        ) ||
                        el.classList?.contains(
                          'ddo-color-pill-wrapper'
                        )
                      ) {

                        return false;

                      }


                      return (
                        el.matches?.(
                          '.item-wrapper'
                        ) ||
                        el.querySelector?.(
                          '.item-wrapper'
                        )
                      );

                    }
                  );

              }
            );


          if (!relevant) {
            return;
          }


          debounceCompare();

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


  function debounceCompare() {

    clearTimeout(
      state.compareTimer
    );


    state.compareTimer =
      setTimeout(
        () => {

          clearCardMarkers();

          runCompare();

        },
        450
      );
  }


  // ============================================================
  // CTRL / CMD / MIDDLE CLICK
  // ============================================================

  function enableNativeModifierClick() {

    if (
      document.documentElement
        .dataset
        .ddoModifierClickBound ===
      'true'
    ) {

      return;

    }


    document.documentElement
      .dataset
      .ddoModifierClickBound =
      'true';


    document.addEventListener(
      'click',
      event => {

        if (
          !event.ctrlKey &&
          !event.metaKey
        ) {

          return;

        }


        const link =
          event.target.closest(
            'a[href]'
          );


        if (!link) {
          return;
        }


        const href =
          link.getAttribute(
            'href'
          );


        if (
          !href ||
          href.startsWith('#')
        ) {

          return;

        }


        event.preventDefault();

        event.stopPropagation();

        event
          .stopImmediatePropagation?.();


        window.open(
          new URL(
            href,
            location.origin
          ).toString(),

          '_blank',

          'noopener'
        );

      },
      true
    );


    document.addEventListener(
      'auxclick',
      event => {

        if (
          event.button !==
          1
        ) {

          return;

        }


        const link =
          event.target.closest(
            'a[href]'
          );


        if (!link) {
          return;
        }


        const href =
          link.getAttribute(
            'href'
          );


        if (
          !href ||
          href.startsWith('#')
        ) {

          return;

        }


        event.preventDefault();

        event.stopPropagation();

        event
          .stopImmediatePropagation?.();


        window.open(
          new URL(
            href,
            location.origin
          ).toString(),

          '_blank',

          'noopener'
        );

      },
      true
    );
  }


  // ============================================================
  // CSS HELPER
  // ============================================================

  function injectCSS(css) {

    const id =
      'ddo-model-checker-lingadore-style';


    if (
      document.getElementById(
        id
      )
    ) {

      return;

    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      id;


    style.textContent =
      css;


    document.head.appendChild(
      style
    );
  }

})();
