// ==UserScript==
// @name         Size Matters | Lisca
// @version      1.2
// @description  Voegt de maten toe in de selectbox
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/size-matters-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/size-matters-lisca.user.js
// ==/UserScript==

(function () {
  'use strict';

  function waitForBrandAndInit() {
    const brandContainer = document.querySelector('#tabs-1 #select2-brand-container');
    const brand = brandContainer?.title?.trim() || "";

    if (!brandContainer) {
      setTimeout(waitForBrandAndInit, 300);
      return;
    }

    if (!brand.toLowerCase().startsWith("lisca")) return;

    injectFontAwesome();
    waitForSelect2AndInjectButton();
  }

  function waitForSelect2AndInjectButton() {
    const container = document.querySelector('.select2-selection--multiple');
    const select = document.querySelector('select[name="sizes[]"]');

    if (!container || !select) {
      setTimeout(waitForSelect2AndInjectButton, 500);
      return;
    }

    if (document.getElementById('add-lisca-sizes-button')) return;

    const button = document.createElement('button');
    button.id = 'add-lisca-sizes-button';
    button.innerHTML = '<i class="fas fa-tshirt"></i>';
    button.title = 'Plak Lisca HTML en voeg beschikbare maten toe';
    button.style.marginLeft = '8px';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#007bff';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.padding = '4px 8px';

    button.addEventListener('mouseover', () => button.style.backgroundColor = '#28a745');
    button.addEventListener('mouseout', () => button.style.backgroundColor = '#007bff');

    button.addEventListener('click', async () => {
      const pidInput = document.querySelector('input[name="supplier_pid"]');
      const backendPid = pidInput?.value?.trim();
      if (!backendPid) {
        alert('⚠️ Supplier PID niet gevonden in backend.');
        return;
      }

      try {
        const clipboardText = await navigator.clipboard.readText();
        const parser = new DOMParser();
        const doc = parser.parseFromString(clipboardText, 'text/html');

        const supplierSpan = doc.querySelector('.pdp-details_product-code span');
        const supplierPid = supplierSpan?.textContent?.trim();

        if (!supplierPid) {
          alert('❌ Geen productcode gevonden in de Lisca HTML.');
          return;
        }

        if (supplierPid !== backendPid) {
          alert(`❌ PID mismatch:\n\nKlembord: ${supplierPid}\nBackend: ${backendPid}`);
          return;
        }

        const bandDivs = doc.querySelectorAll('thead th div.swatch-option');
        const rows = doc.querySelectorAll('tbody tr');
        const maten = [];

        if (rows.length === 1 && rows[0].querySelectorAll('td.prodmatrix-instock').length > 0) {
          // 🔁 Slip- of confectiematrix (1 rij, alleen kolommen tellen)
          const cells = rows[0].querySelectorAll('td.prodmatrix-instock');
          cells.forEach((cell, i) => {
            const maat = bandDivs[i]?.textContent.trim();
            if (maat) {
              maten.push(maat);
            }
          });
        } else {
          // 👙 BH-matrix (cup + band)
          rows.forEach(row => {
            const cup = row.querySelector('td:first-child div')?.textContent.trim();
            const cells = row.querySelectorAll('td.prodmatrix-instock');

            cells.forEach((cell, i) => {
              const band = bandDivs[i];
              if (band && cup) {
                maten.push(`${band.textContent.trim()}${cup}`);
              }
            });
          });
        }

        if (maten.length === 0) {
          alert('❌ Geen maten met voorraad gevonden.');
          return;
        }

        // ✅ Eventuele maatconversies toepassen
        const geconverteerd = maten.map(m => m === '2XL' ? 'XXL' : m);

        // ✅ Koppel aan select-opties
        const options = Array.from(select.options);
        const toegevoegd = [];

        geconverteerd.forEach(maat => {
          const match = options.find(opt => opt.textContent.trim() === maat);
          if (match && !match.selected) {
            match.selected = true;
            toegevoegd.push(maat);
          }
        });

        if (toegevoegd.length > 0) {
          console.log(`[Lisca] Toegevoegde maten voor ${backendPid}:`, toegevoegd);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          alert('ℹ️ Geen overeenkomende maten gevonden in de selectie.');
        }

      } catch (err) {
        alert('❌ Fout bij lezen van klembord of verwerking.');
        console.error(err);
      }
    });

    container.parentElement.appendChild(button);
  }

  function injectFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(link);
  }

  waitForBrandAndInit();
})();
