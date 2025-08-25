// ==UserScript==
// @name         GG / WaGro Check
// @version      1.0
// @description  Markeert alle regels met een WaGro productlocatie
// @author       C. P. v. Beek
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/wagro-check.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/wagro-check.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // --- Styles: geef zowel TR als TD een zachte oranje tint met hoge specificiteit ---
  const STYLE_ID = 'wagroHighlightStyle';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* generiek */
      tr.wagro-highlight,
      tr.wagro-highlight > td {
        background-color: #e6a400 !important; /* zachte peach */
        transition: background-color .2s ease;
      }
      /* Metronic/Bootstrap tabellen kunnen specifiekere selectors hebben, dus versterk: */
      table.table.m-table.table-hover tbody tr.wagro-highlight > td {
        background-color: #e6a400 !important;
      }
      /* hover niet laten overschrijven */
      table.table.m-table.table-hover tbody tr.wagro-highlight:hover > td {
        background-color: #ffb600 !important;
      }
    `;
    document.head.appendChild(s);
  }

  // ---- Helpers ----
  function $qsa(scope, sel) {
    return (scope || document).querySelectorAll(sel);
  }

  function getSelectedTextFromSelect(select) {
    // Probeer eerst "echte" select
    const opt = select.options?.[select.selectedIndex];
    const txt = (opt?.text || '').trim();
    if (txt) return txt;

    // Fallback: bootstrap-select button in zelfde .bootstrap-select wrapper
    const wrapper = select.closest('.bootstrap-select') || select.parentElement;
    if (wrapper) {
      const btn = wrapper.querySelector('button.dropdown-toggle');
      if (btn) {
        // Bootstrap-select zet de zichtbare tekst ook als title
        const t = (btn.getAttribute('title') || btn.textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  function isWaGroSelected(select) {
    const text = getSelectedTextFromSelect(select);
    const value = (select.value || '').trim();
    return text.startsWith('WaGro') || value.startsWith('WaGro');
  }

  function findRow(el) {
    // primair: dichtstbijzijnde TR
    let n = el;
    while (n && n !== document.body) {
      if (n.tagName === 'TR') return n;
      n = n.parentElement;
    }
    return null;
  }

  function updateRowColorForSelect(select) {
    const tr = findRow(select);
    if (!tr) return;
    if (isWaGroSelected(select)) {
      tr.classList.add('wagro-highlight');
    } else {
      tr.classList.remove('wagro-highlight');
    }
  }

  function processAll(scope) {
    $qsa(scope || document, 'select.picklocationSelectPicker').forEach(updateRowColorForSelect);
  }

  // ---- Event binding ----
  function bindEvents(root) {
    // Native change events op echte select
    document.addEventListener('change', (e) => {
      const target = e.target;
      if (target && target.matches && target.matches('select.picklocationSelectPicker')) {
        updateRowColorForSelect(target);
      }
    });

    // Bootstrap-select events, indien jQuery beschikbaar is
    const tryBindBootstrapEvents = () => {
      const $ = window.jQuery;
      if (!$ || !$.fn) return false;

      // Eén keer globale delegated handler
      if (!window.__wagro_bs_bound) {
        window.__wagro_bs_bound = true;
        // Luister op document voor alle selectpicker instances
        $(document).on('changed.bs.select loaded.bs.select rendered.bs.select', 'select.picklocationSelectPicker', function () {
          updateRowColorForSelect(this);
        });
      }
      return true;
    };

    // probeer meteen
    if (!tryBindBootstrapEvents()) {
      // probeer later nog eens (sommige pagina’s laden jQuery/bs-select async)
      const retry = setInterval(() => {
        if (tryBindBootstrapEvents()) clearInterval(retry);
      }, 500);
      // auto-opruiming
      window.addEventListener('beforeunload', () => clearInterval(retry));
    }
  }

  // ---- DOM observe voor dynamiek (na scans) ----
  const observer = new MutationObserver((mutations) => {
    let needsScan = false;

    for (const m of mutations) {
      if (m.type !== 'childList') continue;

      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;

        if (node.matches?.('select.picklocationSelectPicker')) {
          updateRowColorForSelect(node);
        }
        if (node.querySelectorAll) {
          // nieuwe subtree: check op selects
          const selects = node.querySelectorAll('select.picklocationSelectPicker');
          if (selects.length) {
            selects.forEach(updateRowColorForSelect);
          }
        }
      });

      // als table cell inhoud of button-titles wisselen, doen we een lichte rescan
      if (m.addedNodes.length || m.removedNodes.length) {
        needsScan = true;
      }
    }

    if (needsScan) {
      processAll();
    }
  });

  // ---- Periodieke safety scan (sommige plugins updaten zonder DOM-mutatie) ----
  const interval = setInterval(() => processAll(), 1500);

  // ---- Start ----
  bindEvents(document);
  processAll();
  observer.observe(document.body, { childList: true, subtree: true });

  // Opruimen bij navigatie
  window.addEventListener('beforeunload', () => {
    clearInterval(interval);
    observer.disconnect();
  });
})();
