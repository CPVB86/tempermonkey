// ==UserScript==
// @name         GG / WaGro Check
// @version      1.2
// @description  Markeert alle regels met een WaGro productlocatie en biedt bulk-verwijderen voor alleen-WaGro regels
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

  let wagroDeleteBtn = null;

  // --- Styles: oranje & rood varianten + sticky button ---
  const STYLE_ID = 'wagroHighlightStyle';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ORANJE: alleen WaGro als optie */
      tr.wagro-highlight,
      tr.wagro-highlight > td {
        background-color: #e6a400 !important;
        transition: background-color .2s ease;
      }
      table.table.m-table.table-hover tbody tr.wagro-highlight > td {
        background-color: #e6a400 !important;
      }
      table.table.m-table.table-hover tbody tr.wagro-highlight:hover > td {
        background-color: #ffb600 !important;
      }

      /* ROOD: WaGro geselecteerd, maar er zijn ook andere opties */
      tr.wagro-highlight-multi,
      tr.wagro-highlight-multi > td {
        background-color: #e04b4b !important;
        transition: background-color .2s ease;
      }
      table.table.m-table.table-hover tbody tr.wagro-highlight-multi > td {
        background-color: #e04b4b !important;
      }
      table.table.m-table.table-hover tbody tr.wagro-highlight-multi:hover > td {
        background-color: #ff5f5f !important;
      }

      /* Sticky bulk-delete knop voor alleen-WaGro regels */
      #wagroDeleteButton {
        position: fixed;
        bottom: 60px;
        right: 90px;
        z-index: 9999;
        background-color: #e6a400;
        color: #000;
        border: none;
        border-radius: 5px;
        padding: 10px 15px;
        font-size: 13px;
        font-weight: 600;
        display: none; /* standaard verborgen */
        align-items: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        cursor: pointer;
      }

      #wagroDeleteButton:hover {
        background-color: #ffb600;
      }

      #wagroDeleteButton .fa,
      #wagroDeleteButton .fas {
        margin-right: 4px;
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
        const t = (btn.getAttribute('title') || btn.textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  function isWaGroTextOrValue(text, value) {
    const t = (text || '').trim();
    const v = (value || '').trim();
    return t.startsWith('WaGro') || v.startsWith('WaGro');
  }

  function isWaGroSelected(select) {
    const text = getSelectedTextFromSelect(select);
    const value = (select.value || '').trim();
    return isWaGroTextOrValue(text, value);
  }

  // Check: heeft deze select óók nog een andere optie dan WaGro?
  function hasNonWaGroOption(select) {
    const opts = select.options || [];
    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const text = (opt.text || '').trim();
      const value = (opt.value || '').trim();

      // negeer echt lege opties
      if (!text && !value) continue;

      if (!isWaGroTextOrValue(text, value)) {
        // Dit is een andere (niet-WaGro) optie
        return true;
      }
    }
    return false;
  }

  function findRow(el) {
    let n = el;
    while (n && n !== document.body) {
      if (n.tagName === 'TR') return n;
      n = n.parentElement;
    }
    return null;
  }

  // Maak (of hergebruik) de sticky delete button
  function ensureDeleteButton() {
    if (wagroDeleteBtn) return wagroDeleteBtn;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'wagroDeleteButton';
    // icoontje prullenbak + kort label
    btn.innerHTML = '<span class="fas fa-trash"></span>';

    btn.addEventListener('click', () => {
      const rows = Array.from(document.querySelectorAll('tr.wagro-highlight'));
      rows.forEach((tr) => {
        const removeBtn = tr.querySelector('button.removeProductRow');
        if (removeBtn) {
          removeBtn.click();
        }
      });
    });

    document.body.appendChild(btn);
    wagroDeleteBtn = btn;
    return btn;
  }

  // Toon of verberg knop op basis van aanwezigheid wagro-highlight (alleen-WaGro)
  function updateDeleteButtonVisibility() {
    const btn = ensureDeleteButton();
    const hasOnlyWaGro = !!document.querySelector('tr.wagro-highlight');
    btn.style.display = hasOnlyWaGro ? 'inline-flex' : 'none';
  }

  function updateRowColorForSelect(select) {
    const tr = findRow(select);
    if (!tr) return;

    // altijd eerst schoonmaken
    tr.classList.remove('wagro-highlight', 'wagro-highlight-multi');

    if (isWaGroSelected(select)) {
      // WaGro geselecteerd: check of er ook andere opties zijn
      if (hasNonWaGroOption(select)) {
        // WaGro + andere optie → ROOD
        tr.classList.add('wagro-highlight-multi');
      } else {
        // Alleen WaGro als optie → ORANJE
        tr.classList.add('wagro-highlight');
      }
    }

    updateDeleteButtonVisibility();
  }

  function processAll(scope) {
    $qsa(scope || document, 'select.picklocationSelectPicker').forEach(updateRowColorForSelect);
    updateDeleteButtonVisibility();
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

      if (!window.__wagro_bs_bound) {
        window.__wagro_bs_bound = true;
        $(document).on(
          'changed.bs.select loaded.bs.select rendered.bs.select',
          'select.picklocationSelectPicker',
          function () {
            updateRowColorForSelect(this);
          }
        );
      }
      return true;
    };

    if (!tryBindBootstrapEvents()) {
      const retry = setInterval(() => {
        if (tryBindBootstrapEvents()) clearInterval(retry);
      }, 500);
      window.addEventListener('beforeunload', () => clearInterval(retry));
    }
  }

  // ---- DOM observe voor dynamiek ----
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
          const selects = node.querySelectorAll('select.picklocationSelectPicker');
          if (selects.length) {
            selects.forEach(updateRowColorForSelect);
          }
        }
      });

      if (m.addedNodes.length || m.removedNodes.length) {
        needsScan = true;
      }
    }

    if (needsScan) {
      processAll();
    }
  });

  const interval = setInterval(() => processAll(), 1500);

  // ---- Start ----
  ensureDeleteButton();          // alvast aanmaken (maar nog verborgen)
  bindEvents(document);
  processAll();
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('beforeunload', () => {
    clearInterval(interval);
    observer.disconnect();
  });
})();
