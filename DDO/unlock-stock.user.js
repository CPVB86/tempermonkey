// ==UserScript==
// @name         DDO | Unlock Stock
// @version      1.0
// @description  Ontgrendel alle stock-inputs (disabled/readonly uit)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/unlock-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/unlock-stock.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Styling & icon-load (zelfde aanpak als voorbeeld) ---
  function loadFontAwesome() {
    if (!document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
      document.head.appendChild(link);
    }
  }

  function createUnlockButton() {
    const button = document.createElement('button');
    button.innerHTML = '<i class="fa fa-unlock"></i>';
    button.title = 'Ontgrendel alle stockvelden';

    Object.assign(button.style, {
      backgroundColor: '#007bff',
      color: 'white',
      borderRadius: '5px',
      padding: '3px 6px',
      cursor: 'pointer',
      fontSize: '10px',
      marginLeft: '6px'
    });

    button.addEventListener('mouseenter', () => (button.style.backgroundColor = 'green'));
    button.addEventListener('mouseleave', () => (button.style.backgroundColor = '#007bff'));

    button.addEventListener('click', () => {
      const stockFields = document.querySelectorAll('input[type="text"][name^="options"][name$="[stock]"]');

      let changed = 0;
      stockFields.forEach((inp) => {
        // Verwijder attributen en zet disabled proper uit
        if (inp.hasAttribute('disabled') || inp.disabled) {
          inp.disabled = false;
          inp.removeAttribute('disabled');
          changed++;
        }
        if (inp.hasAttribute('readonly')) {
          inp.removeAttribute('readonly');
          changed++;
        }
        // Visuele hint dat het veld actief is
        inp.style.outline = '1px solid #28a745';
        inp.style.outlineOffset = '0px';
      });

      // Kleine bevestiging in console
      console.info(`[Unlock Stock Fields] Aantal wijzigingen: ${changed}`);
    });

    return button;
  }

  // --- Wachten op de tabel-kop en 5e kolom (Stock) ---
  function waitForStockHeader(callback, timeout = 10000) {
    const start = Date.now();
    const check = () => {
      // Zowel #tabs-3 als .options tabellen komen voor in deze backend
      const headerRows = document.querySelectorAll('#tabs-3 th.product_option, .options th.product_option, #tabs-3 th, .options th');
      if (headerRows.length) {
        // Zoek expliciet op tekst 'Stock' of pak index 4 als fallback.
        let stockTh = null;
        const headers = Array.from(headerRows);
        stockTh = headers.find(th => th.textContent.trim().toLowerCase() === 'stock');

        if (!stockTh && headers.length >= 5) {
          // Fallback: neem de 5e kolom
          stockTh = headers[4];
        }

        if (stockTh) {
          callback(stockTh);
          return;
        }
      }
      if (Date.now() - start < timeout) {
        setTimeout(check, 200);
      }
    };
    check();
  }

  loadFontAwesome();
  waitForStockHeader((stockTh) => {
    const btn = createUnlockButton();
    stockTh.appendChild(btn);
  });
})();
