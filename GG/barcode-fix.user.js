// ==UserScript==
// @name         GG | Barcode Fix
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.4
// @description  Vult alleen gescande numerieke barcodes aan naar exact 13 cijfers
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  function normalizeBarcode(value) {
    if (value == null) return value;

    const str = String(value).trim();

    // Alleen pure numerieke scannerbarcodes aanpassen
    if (!/^\d+$/.test(str)) return value;

    // Alleen aanvullen als korter dan 13
    if (str.length < 13) {
      return str.padStart(13, '0');
    }

    // Precies 13 = laten staan
    if (str.length === 13) {
      return str;
    }

    // Langer dan 13 = niet aanpassen
    return value;
  }

  function patchJQuery($) {
    if (!$ || !$ .fn || $.fn.__barcodeFixPatched) return;

    const originalTrigger = $.fn.trigger;
    const originalTriggerHandler = $.fn.triggerHandler;

    function patchPayload(type, data) {
      const eventType =
        typeof type === 'string'
          ? type
          : (type && type.type) || '';

      if (eventType !== 'barcodeScanned') {
        return data;
      }

      if (Array.isArray(data) && data.length > 0) {
        const original = data[0];
        const normalized = normalizeBarcode(original);

        if (normalized !== original) {
          console.log('[Barcode Fix scanner]', original, '→', normalized);
        }

        return [normalized, ...data.slice(1)];
      }

      const normalized = normalizeBarcode(data);

      if (normalized !== data) {
        console.log('[Barcode Fix scanner]', data, '→', normalized);
      }

      return normalized;
    }

    $.fn.trigger = function (type, data) {
      return originalTrigger.call(this, type, patchPayload(type, data));
    };

    $.fn.triggerHandler = function (type, data) {
      return originalTriggerHandler.call(this, type, patchPayload(type, data));
    };

    $.fn.__barcodeFixPatched = true;
    console.log('[Barcode Fix] scanner-only patch actief');
  }

  function waitForJQuery() {
    if (window.jQuery && window.jQuery.fn) {
      patchJQuery(window.jQuery);
      return;
    }

    setTimeout(waitForJQuery, 25);
  }

  waitForJQuery();
})();
