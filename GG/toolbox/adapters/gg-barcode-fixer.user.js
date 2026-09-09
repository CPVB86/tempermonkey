// ==UserScript==
// @name         GG Toolbox | Adapter | Barcode Fixer
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.0
// @description  Barcode Fixer v2.2 voor GG Toolbox. Toegang wordt bepaald door de core.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-barcode-fixer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-barcode-fixer.user.js
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggBarcodeFixer) return;
  window.__ggBarcodeFixer = { version: '1.0.0' };
  function enabled() {
    return window.__ggToolbox?.isEnabled('barcodeFixer') === true;
  }
  // Barcode Fixer: aangeleverde v2.2, met core-toegangscontrole.
  const LOG_PREFIX = '[Barcode Fix]';

  /*
   * Maximale tijd tussen scannertekens.
   */
  const MAX_KEY_INTERVAL_MS = 150;

  /*
   * Hoe lang een herkende scan beschikbaar blijft
   * voor een eventueel volgend netwerkverzoek.
   */
  const PENDING_SCAN_LIFETIME_MS = 3000;

  /*
   * Stock Check gebruikt blijkbaar zijn eigen globale
   * keyboard/scannerbuffer.
   *
   * Op deze pagina onderscheppen we daarom de fysieke scan
   * en spelen we daarna zelf de genormaliseerde barcode af.
   */
  const IS_STOCK_CHECK =
    /^\/products\/stock-check(?:\/|$)/.test(
      window.location.pathname
    );

  let pendingOriginal = null;
  let pendingNormalized = null;
  let pendingUntil = 0;

  /************************************************************
   * BARCODE NORMALISATIE
   ************************************************************/

  function normalizeBarcode(value) {
    const str = String(value ?? '').trim();

    /*
     * Alleen 11 of 12 cijfers aanpassen.
     */
    if (!/^\d{11,12}$/.test(str)) {
      return str;
    }

    /*
     * Aanvullen tot EAN-13.
     */
    return str.padStart(13, '0');
  }

  function clearPendingScan() {
    pendingOriginal = null;
    pendingNormalized = null;
    pendingUntil = 0;
  }

  function getPendingScan() {
    if (!enabled()) { clearPendingScan(); return null; }
    if (
      !pendingOriginal ||
      !pendingNormalized ||
      Date.now() > pendingUntil
    ) {
      clearPendingScan();
      return null;
    }

    return {
      original: pendingOriginal,
      normalized: pendingNormalized
    };
  }

  function registerScan(original) {
    clearPendingScan();
    const normalized = normalizeBarcode(original);

    if (normalized === original) {
      console.log(
        LOG_PREFIX,
        'Scan niet aangepast:',
        original,
        'lengte:',
        original.length
      );

      return;
    }

    pendingOriginal = original;
    pendingNormalized = normalized;
    pendingUntil =
      Date.now() + PENDING_SCAN_LIFETIME_MS;

    console.log(
      LOG_PREFIX,
      'Globale scan herkend:',
      original,
      '→',
      normalized
    );
  }

  /************************************************************
   * NORMALE GOEDGEPICKT PAGINA'S
   ************************************************************/

  function installNormalScannerListener() {
    let scanBuffer = '';
    let lastKeyTime = 0;

    window.addEventListener(
      'keydown',
      function (event) {
        if (!enabled()) { scanBuffer = ''; lastKeyTime = 0; clearPendingScan(); return; }
        /*
         * Eigen synthetische events nooit opnieuw verwerken.
         */
        if (!event.isTrusted) {
          return;
        }

        const now = Date.now();

        if (event.key === 'Enter') {
          if (scanBuffer) {
            const completedScan = scanBuffer;

            scanBuffer = '';
            lastKeyTime = 0;

            registerScan(completedScan);
          }

          return;
        }

        if (!/^\d$/.test(event.key)) {
          scanBuffer = '';
          lastKeyTime = 0;
          return;
        }

        /*
         * Nieuwe scan wanneer er te veel tijd zit
         * tussen twee toetsaanslagen.
         */
        if (
          lastKeyTime &&
          now - lastKeyTime > MAX_KEY_INTERVAL_MS
        ) {
          scanBuffer = '';
        }

        scanBuffer += event.key;
        lastKeyTime = now;

        /*
         * Bescherming tegen onverwacht lange invoer.
         */
        if (scanBuffer.length > 20) {
          scanBuffer = event.key;
        }
      },
      true
    );

    console.log(
      LOG_PREFIX,
      'normale scannerlistener actief'
    );
  }

  /************************************************************
   * STOCK CHECK SCANNER PROXY
   ************************************************************/

  function installStockCheckScannerProxy() {
    let scanBuffer = '';
    let lastKeyTime = 0;

    /*
     * Element waarop de fysieke scanner zijn events
     * oorspronkelijk afvuurde.
     */
    let originalTarget = null;

    /*
     * Voorkomt dat onze synthetische scan opnieuw
     * door onze eigen proxy wordt onderschept.
     */
    let replaying = false;

    /*
     * Maak keyboard-events die zoveel mogelijk lijken
     * op scanner/keyboard-events.
     */
    function createKeyboardEvent(type, key) {
      const isEnter = key === 'Enter';

      let code;

      if (isEnter) {
        code = 'Enter';
      } else {
        code = `Digit${key}`;
      }

      return new window.KeyboardEvent(
        type,
        {
          key: key,
          code: code,

          keyCode: isEnter
            ? 13
            : key.charCodeAt(0),

          which: isEnter
            ? 13
            : key.charCodeAt(0),

          charCode: type === 'keypress' && !isEnter
            ? key.charCodeAt(0)
            : 0,

          bubbles: true,
          cancelable: true,
          composed: true
        }
      );
    }

    /*
     * Eén toets opnieuw aanbieden aan Goedgepickt.
     *
     * We sturen:
     *
     * keydown
     * keypress
     * keyup
     *
     * zodat ook oudere jQuery keyboardhandlers de
     * scan kunnen ontvangen.
     */
    function replayKey(target, key) {
      target.dispatchEvent(
        createKeyboardEvent(
          'keydown',
          key
        )
      );

      /*
       * Voor Enter is keypress niet overal relevant,
       * maar Goedgepickt kan oudere code gebruiken.
       */
      target.dispatchEvent(
        createKeyboardEvent(
          'keypress',
          key
        )
      );

      target.dispatchEvent(
        createKeyboardEvent(
          'keyup',
          key
        )
      );
    }

    /*
     * Speel complete barcode opnieuw af.
     */
    function replayBarcode(barcode, target) {
      console.log(
        LOG_PREFIX,
        'Stock Check replay:',
        barcode
      );

      replaying = true;

      try {
        for (const digit of barcode) {
          replayKey(
            target,
            digit
          );
        }

        replayKey(
          target,
          'Enter'
        );
      } finally {
        replaying = false;
      }
    }

    /*
     * Wis tijdelijke proxy-state.
     */
    function resetProxy() {
      scanBuffer = '';
      lastKeyTime = 0;
      originalTarget = null;
    }

    /*
     * CAPTURE listener.
     *
     * Belangrijk:
     * deze listener moet eerder draaien dan de normale
     * Goedgepickt listener.
     */
    window.addEventListener(
      'keydown',
      function (event) {
        if (!enabled()) { resetProxy(); clearPendingScan(); return; }
        /*
         * Synthetische replay-events gewoon doorlaten.
         */
        if (
          replaying ||
          !event.isTrusted
        ) {
          return;
        }

        const now = Date.now();

        /******************************************************
         * CIJFER
         ******************************************************/

        if (/^\d$/.test(event.key)) {
          /*
           * Eerste teken of een nieuwe scan.
           */
          if (
            !lastKeyTime ||
            now - lastKeyTime >
              MAX_KEY_INTERVAL_MS
          ) {
            scanBuffer = '';
            originalTarget =
              event.target || document;
          }

          scanBuffer += event.key;
          lastKeyTime = now;

          /*
           * Op Stock Check mag Goedgepickt het originele
           * cijfer NIET ontvangen.
           */
          event.preventDefault();
          event.stopImmediatePropagation();

          /*
           * Veiligheidsgrens.
           */
          if (scanBuffer.length > 20) {
            console.warn(
              LOG_PREFIX,
              'Stock Check scanbuffer te lang, reset:',
              scanBuffer
            );

            resetProxy();
          }

          return;
        }

        /******************************************************
         * ENTER
         ******************************************************/

        if (event.key === 'Enter') {
          if (!scanBuffer) {
            /*
             * Gewone Enter zonder voorafgaande scan:
             * niets mee doen.
             */
            return;
          }

          const original = scanBuffer;
          const normalized =
            normalizeBarcode(original);

          /*
           * Doel bepalen vóór reset.
           */
          let replayTarget = originalTarget;

          if (
            !replayTarget ||
            typeof replayTarget.dispatchEvent !==
              'function'
          ) {
            replayTarget = document;
          }

          /*
           * Originele Enter tegenhouden.
           */
          event.preventDefault();
          event.stopImmediatePropagation();

          resetProxy();

          registerScan(original);

          console.log(
            LOG_PREFIX,
            'Stock Check fysieke scan onderschept:',
            original,
            '→',
            normalized
          );

          /*
           * Speel de scan nu pas af voor Goedgepickt.
           *
           * Bij 11/12 cijfers is dit de 13-cijferige versie.
           * Bij bijvoorbeeld een reeds correcte EAN-13
           * blijft de barcode ongewijzigd.
           */
          replayBarcode(
            normalized,
            replayTarget
          );

          return;
        }

        /******************************************************
         * ANDERE TOETS
         ******************************************************/

        if (scanBuffer) {
          /*
           * Scannerbuffer afbreken wanneer tussendoor
           * een andere toets wordt gebruikt.
           */
          console.log(
            LOG_PREFIX,
            'Stock Check scan afgebroken door toets:',
            event.key
          );

          resetProxy();
        }
      },
      true
    );

    console.log(
      LOG_PREFIX,
      'Stock Check scanner-proxy actief'
    );
  }

  /*
   * Kies scannerstrategie.
   */
  if (IS_STOCK_CHECK) {
    installStockCheckScannerProxy();
  } else {
    installNormalScannerListener();
  }

  /************************************************************
   * STRING REPLACEMENT
   ************************************************************/

  function replacePendingInString(
    value,
    source
  ) {
    if (typeof value !== 'string') {
      return value;
    }

    const pending = getPendingScan();

    if (!pending) {
      return value;
    }

    /*
     * Alleen exacte gescande cijferreeks vervangen.
     *
     * Dus bijvoorbeeld:
     *
     * 193773458311
     *
     * maar niet wanneer die reeks onderdeel is van
     * een langere numerieke code.
     */
    const escapedOriginal =
      pending.original.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

    const pattern = new RegExp(
      `(?<!\\d)${escapedOriginal}(?!\\d)`,
      'g'
    );

    const patched = value.replace(
      pattern,
      pending.normalized
    );

    if (patched !== value) {
      console.log(
        LOG_PREFIX,
        source,
        pending.original,
        '→',
        pending.normalized
      );
    }

    return patched;
  }

  /************************************************************
   * OBJECT REPLACEMENT
   ************************************************************/

  function replacePendingInObject(
    value,
    source,
    seen = new WeakSet()
  ) {
    if (value == null) {
      return value;
    }

    if (typeof value === 'string') {
      return replacePendingInString(
        value,
        source
      );
    }

    if (typeof value === 'number') {
      const patched =
        replacePendingInString(
          String(value),
          source
        );

      /*
       * Wanneer een voorloopnul wordt toegevoegd,
       * moet het resultaat een string blijven.
       */
      return patched === String(value)
        ? value
        : patched;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return value;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      for (
        let index = 0;
        index < value.length;
        index++
      ) {
        value[index] =
          replacePendingInObject(
            value[index],
            `${source}[${index}]`,
            seen
          );
      }

      return value;
    }

    for (
      const key of Object.keys(value)
    ) {
      try {
        value[key] =
          replacePendingInObject(
            value[key],
            `${source}.${key}`,
            seen
          );
      } catch (error) {
        /*
         * Niet-schrijfbare properties overslaan.
         */
      }
    }

    return value;
  }

  /************************************************************
   * REQUEST BODY
   ************************************************************/

  function patchBody(
    body,
    source
  ) {
    if (!enabled()) return body;
    if (body == null) {
      return body;
    }

    if (typeof body === 'string') {
      return replacePendingInString(
        body,
        source
      );
    }

    /*
     * URLSearchParams
     */
    if (body instanceof window.URLSearchParams) {
      for (
        const [key, value]
        of [...body.entries()]
      ) {
        const patched =
          replacePendingInString(
            value,
            `${source}.URLSearchParams.${key}`
          );

        if (patched !== value) {
          body.set(
            key,
            patched
          );
        }
      }

      return body;
    }

    /*
     * FormData
     */
    if (body instanceof window.FormData) {
      for (
        const [key, value]
        of [...body.entries()]
      ) {
        if (
          typeof value !== 'string'
        ) {
          continue;
        }

        const patched =
          replacePendingInString(
            value,
            `${source}.FormData.${key}`
          );

        if (patched !== value) {
          body.set(
            key,
            patched
          );
        }
      }

      return body;
    }

    /*
     * Gewoon object/array
     */
    if (typeof body === 'object') {
      return replacePendingInObject(
        body,
        source
      );
    }

    return body;
  }

  /************************************************************
   * FETCH
   ************************************************************/

  if (
    typeof window.fetch === 'function'
  ) {
    const originalFetch =
      window.fetch;

    window.fetch = function (
      input,
      init
    ) {
      try {
        /*
         * URL als string.
         */
        if (
          typeof input === 'string'
        ) {
          input =
            replacePendingInString(
              input,
              'fetch URL'
            );
        }

        /*
         * URL object.
         */
        else if (
          input instanceof window.URL
        ) {
          const originalUrl =
            input.toString();

          const patchedUrl =
            replacePendingInString(
              originalUrl,
              'fetch URL'
            );

          if (
            patchedUrl !== originalUrl
          ) {
            input = new window.URL(
              patchedUrl
            );
          }
        }

        /*
         * Request body.
         */
        if (
          init &&
          Object.prototype
            .hasOwnProperty
            .call(
              init,
              'body'
            )
        ) {
          init.body = patchBody(
            init.body,
            'fetch body'
          );
        }
      } catch (error) {
        console.warn(
          LOG_PREFIX,
          'fetch patch error',
          error
        );
      }

      return originalFetch.call(
        this,
        input,
        init
      );
    };

    console.log(
      LOG_PREFIX,
      'fetch-patch actief'
    );
  }

  /************************************************************
   * XMLHttpRequest
   ************************************************************/

  if (
    typeof window.XMLHttpRequest ===
      'function'
  ) {
    const originalOpen =
      window.XMLHttpRequest.prototype.open;

    const originalSend =
      window.XMLHttpRequest.prototype.send;

    /*
     * URL patch.
     */
    window.XMLHttpRequest.prototype.open =
      function (
        method,
        url,
        async,
        username,
        password
      ) {
        try {
          url =
            replacePendingInString(
              String(url),
              'XHR URL'
            );
        } catch (error) {
          console.warn(
            LOG_PREFIX,
            'XHR URL patch error',
            error
          );
        }

        return originalOpen.call(
          this,
          method,
          url,
          async,
          username,
          password
        );
      };

    /*
     * Body patch.
     */
    window.XMLHttpRequest.prototype.send =
      function (body) {
        try {
          body = patchBody(
            body,
            'XHR body'
          );
        } catch (error) {
          console.warn(
            LOG_PREFIX,
            'XHR body patch error',
            error
          );
        }

        return originalSend.call(
          this,
          body
        );
      };

    console.log(
      LOG_PREFIX,
      'XMLHttpRequest-patch actief'
    );
  }

  /************************************************************
   * jQuery AJAX
   ************************************************************/

  function patchJQuery($) {
    if (
      !$ ||
      !$.ajax ||
      $.__globalBarcodeFixPatched
    ) {
      return;
    }

    const originalAjax =
      $.ajax;

    $.ajax = function (
      url,
      options
    ) {
      try {
        /*
         * Vorm:
         *
         * $.ajax({
         *   url: '...',
         *   data: ...
         * })
         */
        if (
          url &&
          typeof url === 'object'
        ) {
          if (url.url) {
            url.url =
              replacePendingInString(
                String(url.url),
                'jQuery AJAX URL'
              );
          }

          if (
            Object.prototype
              .hasOwnProperty
              .call(
                url,
                'data'
              )
          ) {
            url.data =
              patchBody(
                url.data,
                'jQuery AJAX data'
              );
          }
        }

        /*
         * Vorm:
         *
         * $.ajax(
         *   'url',
         *   {
         *      data: ...
         *   }
         * )
         */
        if (
          typeof url === 'string'
        ) {
          url =
            replacePendingInString(
              url,
              'jQuery AJAX URL'
            );

          if (
            options &&
            typeof options ===
              'object' &&
            Object.prototype
              .hasOwnProperty
              .call(
                options,
                'data'
              )
          ) {
            options.data =
              patchBody(
                options.data,
                'jQuery AJAX options.data'
              );
          }
        }
      } catch (error) {
        console.warn(
          LOG_PREFIX,
          'jQuery AJAX patch error',
          error
        );
      }

      return originalAjax.call(
        this,
        url,
        options
      );
    };

    $.__globalBarcodeFixPatched =
      true;

    console.log(
      LOG_PREFIX,
      'jQuery AJAX-patch actief'
    );
  }

  function waitForJQuery() {
    if (window.jQuery) {
      patchJQuery(
        window.jQuery
      );

      return;
    }

    setTimeout(
      waitForJQuery,
      25
    );
  }

  waitForJQuery();

  /************************************************************
   * STARTLOG
   ************************************************************/

  console.log(
    LOG_PREFIX,
    'globale scannerpatch v2.2 geladen',
    IS_STOCK_CHECK
      ? '(STOCK CHECK PROXY)'
      : '(NORMALE MODUS)'
  );
})();
