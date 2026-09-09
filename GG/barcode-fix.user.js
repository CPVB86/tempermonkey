// ==UserScript==
// @name         Goedgepickt globale barcode fix
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      2.0
// @description  Herkent globale scannerscans van 11/12 cijfers en zet deze in verzoeken om naar 13 cijfers
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/barcode-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/barcode-fix.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[Barcode Fix]';

  /*
   * Maximale tijd tussen twee scannertekens.
   * Een scanner typt veel sneller dan een mens.
   */
  const MAX_KEY_INTERVAL_MS = 150;

  /*
   * Hoe lang de gevonden scan beschikbaar blijft
   * voor het daaropvolgende netwerkverzoek.
   */
  const PENDING_SCAN_LIFETIME_MS = 3000;

  let scanBuffer = '';
  let lastKeyTime = 0;

  let pendingOriginal = null;
  let pendingNormalized = null;
  let pendingUntil = 0;

  function normalizeBarcode(value) {
    const str = String(value ?? '').trim();

    if (!/^\d{11,12}$/.test(str)) {
      return str;
    }

    return str.padStart(13, '0');
  }

  function clearPendingScan() {
    pendingOriginal = null;
    pendingNormalized = null;
    pendingUntil = 0;
  }

  function getPendingScan() {
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
    pendingUntil = Date.now() + PENDING_SCAN_LIFETIME_MS;

    console.log(
      LOG_PREFIX,
      'Globale scan herkend:',
      original,
      '→',
      normalized
    );
  }

  /*
   * Luister mee met de globale scanner.
   *
   * We blokkeren geen toetsen en veranderen geen events.
   * Goedgepickt ontvangt dus gewoon de oorspronkelijke scan.
   */
  window.addEventListener(
    'keydown',
    function (event) {
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
       * Nieuwe scan beginnen wanneer er te veel tijd
       * tussen twee toetsaanslagen zit.
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

  function replacePendingInString(value, source) {
    if (typeof value !== 'string') {
      return value;
    }

    const pending = getPendingScan();

    if (!pending) {
      return value;
    }

    /*
     * Alleen de exacte gescande cijferreeks vervangen.
     * Niet vervangen wanneer deze onderdeel is van
     * een langere numerieke code.
     */
    const escapedOriginal = pending.original.replace(
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

  function replacePendingInObject(value, source, seen = new WeakSet()) {
    if (value == null) {
      return value;
    }

    if (typeof value === 'string') {
      return replacePendingInString(value, source);
    }

    if (typeof value === 'number') {
      const patched = replacePendingInString(
        String(value),
        source
      );

      /*
       * Bij een voorloopnul moet de waarde een string blijven.
       */
      return patched === String(value) ? value : patched;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return value;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        value[index] = replacePendingInObject(
          value[index],
          `${source}[${index}]`,
          seen
        );
      }

      return value;
    }

    for (const key of Object.keys(value)) {
      try {
        value[key] = replacePendingInObject(
          value[key],
          `${source}.${key}`,
          seen
        );
      } catch (error) {
        // Niet-schrijfbare eigenschappen overslaan
      }
    }

    return value;
  }

  function patchBody(body, source) {
    if (body == null) {
      return body;
    }

    if (typeof body === 'string') {
      return replacePendingInString(body, source);
    }

    if (body instanceof URLSearchParams) {
      for (const [key, value] of [...body.entries()]) {
        const patched = replacePendingInString(
          value,
          `${source}.URLSearchParams.${key}`
        );

        if (patched !== value) {
          body.set(key, patched);
        }
      }

      return body;
    }

    if (body instanceof FormData) {
      for (const [key, value] of [...body.entries()]) {
        if (typeof value !== 'string') continue;

        const patched = replacePendingInString(
          value,
          `${source}.FormData.${key}`
        );

        if (patched !== value) {
          body.set(key, patched);
        }
      }

      return body;
    }

    if (typeof body === 'object') {
      return replacePendingInObject(body, source);
    }

    return body;
  }

  /*
   * Fetch
   */
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;

    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          input = replacePendingInString(
            input,
            'fetch URL'
          );
        } else if (input instanceof URL) {
          const patchedUrl = replacePendingInString(
            input.toString(),
            'fetch URL'
          );

          if (patchedUrl !== input.toString()) {
            input = new URL(patchedUrl);
          }
        }

        if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
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

      return originalFetch.call(this, input, init);
    };

    console.log(LOG_PREFIX, 'fetch-patch actief');
  }

  /*
   * XMLHttpRequest
   */
  if (typeof window.XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method,
      url,
      async,
      username,
      password
    ) {
      try {
        url = replacePendingInString(
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

    XMLHttpRequest.prototype.send = function (body) {
      try {
        body = patchBody(body, 'XHR body');
      } catch (error) {
        console.warn(
          LOG_PREFIX,
          'XHR body patch error',
          error
        );
      }

      return originalSend.call(this, body);
    };

    console.log(
      LOG_PREFIX,
      'XMLHttpRequest-patch actief'
    );
  }

  /*
   * jQuery AJAX
   */
  function patchJQuery($) {
    if (!$ || !$.ajax || $.__globalBarcodeFixPatched) {
      return;
    }

    const originalAjax = $.ajax;

    $.ajax = function (url, options) {
      try {
        /*
         * $.ajax({
         *   url: '...',
         *   data: ...
         * })
         */
        if (url && typeof url === 'object') {
          if (url.url) {
            url.url = replacePendingInString(
              String(url.url),
              'jQuery AJAX URL'
            );
          }

          if (Object.prototype.hasOwnProperty.call(url, 'data')) {
            url.data = patchBody(
              url.data,
              'jQuery AJAX data'
            );
          }
        }

        /*
         * $.ajax('url', {
         *   data: ...
         * })
         */
        if (typeof url === 'string') {
          url = replacePendingInString(
            url,
            'jQuery AJAX URL'
          );

          if (
            options &&
            typeof options === 'object' &&
            Object.prototype.hasOwnProperty.call(options, 'data')
          ) {
            options.data = patchBody(
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

      return originalAjax.call(this, url, options);
    };

    $.__globalBarcodeFixPatched = true;

    console.log(
      LOG_PREFIX,
      'jQuery AJAX-patch actief'
    );
  }

  function waitForJQuery() {
    if (window.jQuery) {
      patchJQuery(window.jQuery);
      return;
    }

    setTimeout(waitForJQuery, 25);
  }

  waitForJQuery();

  console.log(
    LOG_PREFIX,
    'globale scannerpatch geladen'
  );
})();
