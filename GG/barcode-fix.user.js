// ==UserScript==
// @name         GG | Barcode Fix
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.3
// @description  Vult gescande numerieke barcodes aan naar exact 13 cijfers vóór Goedgepickt ze verwerkt
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/barcode-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/barcode-fix.user.js
// ==/UserScript==

(function () {
  'use strict';

  function normalizeBarcode(value) {
    if (value == null) return value;

    const str = String(value).trim();

    // Alleen pure numerieke barcodes aanpassen
    if (!/^\d+$/.test(str)) {
      return value;
    }

    // Altijd exact 13 cijfers
    if (str.length <= 13) {
      return str.padStart(13, '0');
    }

    // Langer dan 13? Niet aanpassen
    return value;
  }

  function patchJQuery($) {
    if (!$ || $.fn.__barcodeFixPatched) return;

    const originalTrigger = $.fn.trigger;
    const originalTriggerHandler = $.fn.triggerHandler;

    function normalizeTriggerArgs(type, data) {
      const eventType =
        typeof type === 'string'
          ? type
          : (type && type.type) || '';

      if (eventType !== 'barcodeScanned') {
        return data;
      }

      // jQuery trigger kan string, array of losse waarde meekrijgen
      if (Array.isArray(data) && data.length > 0) {
        const normalized = normalizeBarcode(data[0]);
        if (normalized !== data[0]) {
          console.log('[Barcode Fix trigger]', data[0], '→', normalized);
        }
        return [normalized, ...data.slice(1)];
      }

      const normalized = normalizeBarcode(data);
      if (normalized !== data) {
        console.log('[Barcode Fix trigger]', data, '→', normalized);
      }
      return normalized;
    }

    $.fn.trigger = function (type, data) {
      return originalTrigger.call(this, type, normalizeTriggerArgs(type, data));
    };

    $.fn.triggerHandler = function (type, data) {
      return originalTriggerHandler.call(this, type, normalizeTriggerArgs(type, data));
    };

    // Extra vangnet: als GG via jQuery dispatch werkt met arguments
    const originalDispatch = $.event.dispatch;
    $.event.dispatch = function () {
      try {
        const event = arguments[0];
        if (event && event.type === 'barcodeScanned' && arguments.length > 1) {
          const original = arguments[1];
          const normalized = normalizeBarcode(original);
          if (normalized !== original) {
            arguments[1] = normalized;
            console.log('[Barcode Fix dispatch]', original, '→', normalized);
          }
        }
      } catch (err) {
        console.warn('[Barcode Fix dispatch error]', err);
      }

      return originalDispatch.apply(this, arguments);
    };

    $.fn.__barcodeFixPatched = true;
    console.log('[Barcode Fix] jQuery barcodeScanned patch actief');
  }

  function patchInputs() {
    const applyToInput = (input) => {
      if (!input || input.dataset.barcodeFixBound === '1') return;

      const apply = () => {
        const oldValue = input.value;
        const newValue = normalizeBarcode(oldValue);

        if (newValue !== oldValue) {
          input.value = newValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Barcode Fix input]', oldValue, '→', newValue);
        }
      };

      input.addEventListener('blur', apply, true);
      input.addEventListener('change', apply, true);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') apply();
      }, true);

      input.dataset.barcodeFixBound = '1';
    };

    const scan = () => {
      document.querySelectorAll('input, textarea').forEach(applyToInput);
    };

    scan();

    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function waitForJQuery() {
    if (window.jQuery && window.jQuery.fn) {
      patchJQuery(window.jQuery);
      patchInputs();
      return;
    }

    setTimeout(waitForJQuery, 25);
  }

  waitForJQuery();
})();
