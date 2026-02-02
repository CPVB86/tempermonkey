// ==UserScript==
// @name         GG | ScanSim
// @version      1.8
// @description  Scan Simulater; leest barcodes uit klembord en activeert scannerloop + Stock Check preset (incoming)
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// ==/UserScript==

(function () {
  'use strict';

  const path = location.pathname;
  const isIncoming = path === '/products/incoming';
  const isOutgoing = path === '/products/outgoing-products';

  if (!isIncoming && !isOutgoing) return;

  // =========================
  // Settings
  // =========================
  // 1) Voorkomt scroll-lock bij bulk (door $('html,body').animate({scrollTop...}))
  const NEUTRALIZE_SCROLL_ANIMATE = true;

  // 2) Buffering (OPTIONEEL) - standaard UIT om loops te voorkomen.
  // Zet op true als je het wilt testen op incoming (outgoing blijft sowieso origineel).
  const BUFFER_INCOMING = false;
  const FLUSH_INTERVAL_MS = 50;
  const BATCH_SIZE = 50;

  // -------------------------
  // Neutralize jQuery scroll animations on html/body
  // -------------------------
  (function neutralizeBodyScrollAnimate() {
    if (!NEUTRALIZE_SCROLL_ANIMATE) return;

    const $ = window.jQuery;
    if (!$ || !$.fn || !$.fn.animate) return;

    const origAnimate = $.fn.animate;

    $.fn.animate = function (props, speed, easing, callback) {
      try {
        const isHtmlBody = this.is('html, body');
        const isScrollTop = props && Object.prototype.hasOwnProperty.call(props, 'scrollTop');
        if (isHtmlBody && isScrollTop) {
          // Geen queue, geen lock: direct zetten
          this.stop(true, false);
          this.scrollTop(props.scrollTop);
          if (typeof easing === 'function') easing.call(this);
          if (typeof callback === 'function') callback.call(this);
          return this;
        }
      } catch (_) {}

      return origAnimate.apply(this, arguments);
    };

    console.log('[ScanSim] Neutralized jQuery html/body scrollTop animations');
  })();

  // -------------------------
  // Font Awesome
  // -------------------------
  function injectFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(link);
  }

  // -------------------------
  // Tiny wait helper
  // -------------------------
  function waitFor(fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        try {
          const res = fn();
          if (res) {
            clearInterval(t);
            resolve(res);
            return;
          }
          if (Date.now() - start > timeoutMs) {
            clearInterval(t);
            reject(new Error('timeout'));
          }
        } catch (e) {
          clearInterval(t);
          reject(e);
        }
      }, intervalMs);
    });
  }

  // -------------------------
  // Prevent cross-tab scanning on incoming
  // (site gebruikt BroadcastChannel -> incoming luistert mee)
  // -------------------------
  function wrapIncomingFunctionsToRequireFocus() {
    if (!isIncoming) return;

    const guard = () => {
      // Alleen verwerken als tab zichtbaar + focus heeft
      return document.visibilityState === 'visible' && document.hasFocus();
    };

    // Wrap addBarcodeToTasks
    if (typeof window.addBarcodeToTasks === 'function' && !window.addBarcodeToTasks.__scansimWrapped) {
      const original = window.addBarcodeToTasks.bind(window);
      const wrapped = function (...args) {
        if (!guard()) return; // negeer broadcast scans in achtergrondtab
        return original(...args);
      };
      wrapped.__scansimWrapped = true;
      window.addBarcodeToTasks = wrapped;
      console.log('[ScanSim] Wrapped addBarcodeToTasks() with focus-guard');
    }

    // Wrap processScannedProducts (extra veiligheid)
    if (typeof window.processScannedProducts === 'function' && !window.processScannedProducts.__scansimWrapped) {
      const original = window.processScannedProducts.bind(window);
      const wrapped = function (...args) {
        if (!guard()) return;
        return original(...args);
      };
      wrapped.__scansimWrapped = true;
      window.processScannedProducts = wrapped;
      console.log('[ScanSim] Wrapped processScannedProducts() with focus-guard');
    }
  }

  // -------------------------
  // Stock Check preset button (incoming)
  // -------------------------
  function addStockCheckButton() {
    if (!isIncoming) return;
    if (document.getElementById('scansim-stockcheck-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'scansim-stockcheck-btn';
    btn.type = 'button';
    btn.title = 'Preset: Stock Check + locatie 00. Extern';
    btn.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i>`;

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '80px',
      zIndex: 9999,
      padding: '10px 12px',
      fontSize: '16px',
      backgroundColor: '#343a40',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#495057'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#343a40'));

    btn.addEventListener('click', async () => {
      try {
        await applyStockCheckPreset();
        console.log('[ScanSim] Stock Check preset toegepast');
      } catch (e) {
        console.error('[ScanSim] Stock Check preset faalde', e);
        alert('Stock Check preset faalde. Open console voor details.');
      }
    });

    document.body.appendChild(btn);
  }

  function setSelectValueAndTrigger(selectEl, value) {
    if (!selectEl) return;
    selectEl.value = value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setInputValue(inputEl, value) {
    if (!inputEl) return;
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function click(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  function openFancyDropdown() {
    const root = document.querySelector('#picklocationSelect .fancy-input');
    if (!root) return false;
    return click(root.querySelector('.value-holder') || root);
  }

  async function applyStockCheckPreset() {
    const bulkReason = document.querySelector('#bulk_reason');
    const otherReason = document.querySelector('#other_reason');
    const inboundLocation = document.querySelector('#inbound_location');

    if (!bulkReason) throw new Error('#bulk_reason niet gevonden');
    if (!inboundLocation) throw new Error('#inbound_location niet gevonden');

    setSelectValueAndTrigger(bulkReason, 'other');
    if (otherReason) setInputValue(otherReason, 'Stock Check');

    setSelectValueAndTrigger(inboundLocation, 'otherLocation');

    await waitFor(() => {
      const wrap = document.querySelector('#picklocationSelect .dropdown-item-wrapper');
      const loading = document.querySelector('#picklocationSelect .loader-wrapper');
      const hasOptions = !!document.querySelector('#picklocationSelect .dropdown-item.option[data-key]');
      const isLoading = loading && loading.style && loading.style.display !== 'none';
      return wrap && hasOptions && !isLoading ? true : null;
    }, { timeoutMs: 20000, intervalMs: 150 });

    openFancyDropdown();

    const externItem = await waitFor(() => {
      return document.querySelector('#picklocationSelect .dropdown-item.option[data-key="00. Extern"]') || null;
    }, { timeoutMs: 20000, intervalMs: 150 });

    const externValue = externItem.getAttribute('data-value');
    click(externItem);

    const otherLocationSelect = document.querySelector('#otherLocation');
    if (otherLocationSelect && externValue) {
      otherLocationSelect.value = externValue;
      otherLocationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const holder = document.querySelector('#picklocationSelect .value-holder');
    if (holder) holder.textContent = '00. Extern';
  }

  // -------------------------
  // Barcode inject / processing (ORIGINEEL gedrag)
  // -------------------------
  function injectScanTask(barcode) {
    if (isIncoming) {
      // Gebruik site-functie zodat processing/registratie gebeurt
      if (typeof window.addBarcodeToTasks === 'function') {
        window.addBarcodeToTasks(barcode);
        return;
      }
      console.warn('[ScanSim] addBarcodeToTasks() niet gevonden (nog niet geladen?)');
      return;
    }

    // Outgoing: ORIGINEEL gedrag terug
    const tbody = document.querySelector('.scanned_tasks_body');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.classList.add('to_do_task');

    const tdIcon = document.createElement('td');
    const tdBarcode = document.createElement('td');
    tdBarcode.classList.add('barcode_td');
    tdBarcode.dataset.barcode = barcode;
    tdBarcode.textContent = barcode;

    tr.appendChild(tdIcon);
    tr.appendChild(tdBarcode);
    tbody.prepend(tr);
  }

    // -------------------------
// Incoming: processing kick (debounced, voorkomt loops)
// -------------------------
let incomingKickTimer = null;

function scheduleIncomingProcessKick() {
  if (!isIncoming) return;
  // alleen als tab echt actief is
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;

  // debounce: steeds opnieuw plannen, maar uiteindelijk maar 1x uitvoeren
  if (incomingKickTimer) clearTimeout(incomingKickTimer);
  incomingKickTimer = setTimeout(() => {
    incomingKickTimer = null;
    if (typeof window.processScannedProducts === 'function') {
      try {
        window.processScannedProducts();
        console.log('[ScanSim] processScannedProducts() kick');
      } catch (e) {
        console.warn('[ScanSim] processScannedProducts() kick failed', e);
      }
    } else {
      console.warn('[ScanSim] processScannedProducts() niet gevonden');
    }
  }, 250);
}

  // -------------------------
  // OPTIONAL buffering (incoming only)
  // -------------------------
  const scanQueue = [];
  let flushTimer = null;

  function enqueueScan(barcode, count = 1) {
    for (let i = 0; i < count; i++) scanQueue.push(barcode);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
  }

  function flushQueue() {
    flushTimer = null;
    if (!scanQueue.length) return;

    const batch = scanQueue.splice(0, BATCH_SIZE);

    // Alleen incoming bufferen. Outgoing blijft 1-op-1 origineel.
    for (const bc of batch) injectScanTask(bc);

    if (scanQueue.length) scheduleFlush();
      if (isIncoming) scheduleIncomingProcessKick();

  }

function processClipboard(text) {
  const lines = text.trim().split('\n');
  for (const line of lines) {
    const [barcodeRaw, countRaw] = line.split('\t');
    const barcode = (barcodeRaw || '').trim();
    const count = Math.abs(parseInt(countRaw || '1', 10));
    if (!barcode || Number.isNaN(count)) continue;

    if (isIncoming && BUFFER_INCOMING) {
      enqueueScan(barcode, count);
    } else {
      for (let i = 0; i < count; i++) injectScanTask(barcode);
    }
  }

  // ✅ Belangrijk: 1x verwerking starten (debounced)
  scheduleIncomingProcessKick();

  console.log('[ScanSim] Klembordverwerking klaar');
}


  // -------------------------
  // Barcode Button
  // -------------------------
  function addBarcodeButton() {
    if (document.getElementById('simuleer-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'simuleer-scan-btn';
    btn.type = 'button';
    btn.innerHTML = `<i class="fa-solid fa-barcode"></i>`;

    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      padding: '10px 15px',
      fontSize: '16px',
      backgroundColor: '#007bff',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      transition: 'background-color 0.2s',
      boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
    });

    btn.addEventListener('mouseenter', () => (btn.style.backgroundColor = '#28a745'));
    btn.addEventListener('mouseleave', () => (btn.style.backgroundColor = '#007bff'));

    btn.addEventListener('click', async () => {
      try {
        const content = await navigator.clipboard.readText();
        processClipboard(content);
      } catch (e) {
        console.error('[ScanSim] Kon klembord niet lezen (permissions?)', e);
        alert('Klembord lezen mislukt. Klik eerst op de pagina en probeer opnieuw.');
      }
    });

    document.body.appendChild(btn);
    console.log('[ScanSim] Barcode knop toegevoegd');
  }

  // -------------------------
  // Outgoing scanner loop (TERUG NAAR ORIGINEEL)
  // -------------------------
  let scannerLoopStarted = false;

  function activateOutgoingScannerLoop() {
    if (!isOutgoing) return;
    if (scannerLoopStarted) return;

    if (typeof window.executeTasks === 'function') {
      scannerLoopStarted = true;
      console.log('[ScanSim] Start executeTasks loop (original behavior)');
      setInterval(() => {
        try {
          window.executeTasks();
        } catch (e) {
          console.error('[ScanSim] executeTasks fout', e);
        }
      }, 1000);
    }
  }

  // -------------------------
  // Init
  // -------------------------
  function init() {
    injectFontAwesome();
    addBarcodeButton();
    addStockCheckButton();
    activateOutgoingScannerLoop();

    // Incoming: wacht tot site-functies bestaan en wrap ze (tegen cross-tab)
    if (isIncoming) {
      waitFor(() => (typeof window.addBarcodeToTasks === 'function' ? true : null), { timeoutMs: 20000 })
        .then(() => {
          wrapIncomingFunctionsToRequireFocus();
        })
        .catch(() => console.warn('[ScanSim] addBarcodeToTasks niet gevonden binnen timeout'));

      // Ook processScannedProducts later nog even wrappen als die later wordt geladen
      const t = setInterval(() => {
        wrapIncomingFunctionsToRequireFocus();
        if (window.addBarcodeToTasks?.__scansimWrapped && window.processScannedProducts?.__scansimWrapped) {
          clearInterval(t);
        }
      }, 500);
      setTimeout(() => clearInterval(t), 20000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
