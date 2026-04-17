// ==UserScript==
// @name         Goedgepickt barcode fix ajax-only
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.6
// @description  Vult alleen scannerbarcodes aan naar exact 13 cijfers via barcode-AJAX requests
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/GG/barcode-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/GG/barcode-fix.user.js
// ==/UserScript==

(function () {
  'use strict';

  function normalizeBarcode(value) {
    if (value == null) return value;

    const str = String(value).trim();

    // Alleen pure numerieke codes
    if (!/^\d+$/.test(str)) return value;

    // Alleen korter dan 13 aanvullen
    if (str.length < 13) return str.padStart(13, '0');

    // 13 laten staan, >13 niet wijzigen
    return str;
  }

  function shouldPatchUrl(url) {
    if (!url) return false;

    const s = String(url);

    return (
      s.includes('/barcodes/validate') ||
      s.includes('/barcodes/get-product-details')
    );
  }

  function patchAjax($) {
    if (!$ || !$.ajax || $.__barcodeAjaxFixPatched) return;

    const originalAjax = $.ajax;

    $.ajax = function (options) {
      try {
        if (options && typeof options === 'object' && shouldPatchUrl(options.url)) {
          if (options.data && typeof options.data === 'object' && 'barcode' in options.data) {
            const original = options.data.barcode;
            const normalized = normalizeBarcode(original);

            if (normalized !== original) {
              options.data.barcode = normalized;
              console.log('[Barcode Fix ajax]', original, '→', normalized, 'for', options.url);
            }
          }
        }
      } catch (err) {
        console.warn('[Barcode Fix ajax error]', err);
      }

      return originalAjax.apply(this, arguments);
    };

    $.__barcodeAjaxFixPatched = true;
    console.log('[Barcode Fix] ajax-only patch actief');
  }

  function waitForJQuery() {
    if (window.jQuery) {
      patchAjax(window.jQuery);
      return;
    }

    setTimeout(waitForJQuery, 25);
  }

  waitForJQuery();
})();
