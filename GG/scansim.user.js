// ==UserScript==
// @name         ScanSim
// @version      1.1
// @description  Scan Simulater; leest barcodes uit klembord en activeert scannerloop
// @match        https://fm-e-warehousing.goedgepickt.nl/products/incoming-products
// @match        https://fm-e-warehousing.goedgepickt.nl/products/outgoing-products
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/scansim.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Injecteer Font Awesome als die nog niet op de pagina staat
  function injectFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    document.head.appendChild(link);
  }

  // Barcode toevoegen
  function injectScanTask(barcode) {
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

    console.log(`[ScanSim] Toegevoegd: ${barcode}`);
  }

  // Verwerk klembordinhoud
  function processClipboard(text) {
    const lines = text.trim().split('\n');
    for (const line of lines) {
      const [barcode, countRaw] = line.split('\t');
      const count = Math.abs(parseInt(countRaw || '1', 10));
      if (!barcode || isNaN(count)) continue;

      for (let i = 0; i < count; i++) {
        injectScanTask(barcode.trim());
      }
    }
    console.log('[ScanSim] Klembordverwerking klaar');
  }

  // Voeg scanbutton toe
  function addButton() {
    if (document.getElementById('simuleer-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'simuleer-scan-btn';
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
      borderRadius: '5px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      transition: 'background-color 0.3s'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = '#28a745'; // groen bij hover
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = '#007bff'; // blauw normaal
    });

    btn.addEventListener('click', async () => {
      const content = await navigator.clipboard.readText();
      processClipboard(content);
    });

    document.body.appendChild(btn);
    console.log('[ScanSim] Knop toegevoegd');
  }

  function activateScannerLoop() {
    if (typeof executeTasks === 'function') {
      console.log('[ScanSim] Start executeTasks loop');
      setInterval(() => {
        try {
          executeTasks();
        } catch (e) {
          console.error('[ScanSim] executeTasks fout', e);
        }
      }, 1000);
    }
  }

  function waitForScanBodyAndInject() {
    const observer = new MutationObserver(() => {
      const tbody = document.querySelector('.scanned_tasks_body');
      if (tbody) {
        injectFontAwesome();
        addButton();
        activateScannerLoop();
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  waitForScanBodyAndInject();
})();
