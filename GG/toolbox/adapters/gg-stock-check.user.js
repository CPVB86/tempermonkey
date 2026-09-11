// ==UserScript==
// @name         GG Toolbox | Adapter | Stock Check
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.8.3
// @description  Stock Check voorbereiden, scans injecteren, bulklijst en foutieve EANs beheren.
// @match        https://fm-e-warehousing.goedgepickt.nl/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-stock-check.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/toolbox/adapters/gg-stock-check.user.js
// ==/UserScript==
(() => {
  'use strict';
  if (window.__ggStockCheck) return;
  const mode = () => /^\/products\/(incoming|incoming-products)\/?$/.test(location.pathname) ? 'incoming' : /^\/products\/outgoing-products\/?$/.test(location.pathname) ? 'outgoing' : '';
  const allowed = () => !!mode() && window.__ggToolbox?.isEnabled('stockCheck') === true;
  let selectedLocation = '';
  let viewedFailures = new WeakMap();
  let busy = false, prepared = '', panel, message = 'Klik op Activeer om de formulieren voor te bereiden.';
  let queue = [], pending = null, activeMode = '', editorOpen = false, listSaved = false, listTotal = 0;
  let listCompleted = false;
  let scanProgress = null;
  let injectionUncertain = false;
  const key = () => 'gg_stock_check_v1_' + mode();
  function save() { sessionStorage.setItem(key(), JSON.stringify({ queue, pending, listSaved, listTotal, listCompleted })); }
  function restore() {
    if (activeMode === mode()) return;
    activeMode = mode(); prepared = ''; queue = []; pending = null; editorOpen = false; listSaved = false; listTotal = 0; listCompleted = false;
    try { const state = JSON.parse(sessionStorage.getItem(key()) || 'null'); if (state) { queue = state.queue || []; listTotal = state.listTotal ?? queue.reduce((sum,item)=>sum+item.qty,0); pending = state.pending || null; listSaved = state.listSaved ?? (queue.length > 0 || !!pending); listCompleted = state.listCompleted === true; } } catch {}
    completeEmptyList();
  }
  function requireAccess() { if (!allowed()) throw new Error('Geen toegang of verkeerde pagina'); }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(fn) {
    for (let i = 0; i < 100; i++) { requireAccess(); const result = fn(); if (result) return result; await pause(150); }
    throw new Error('Formulierveld niet beschikbaar');
  }
  function input(el, value) {
    if (!el || el.disabled) throw new Error('Veld ontbreekt of is niet bewerkbaar');
    if (el.options && ![...el.options].some(option => option.value === value)) throw new Error('Veldoptie ontbreekt: ' + value);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles:true })); el.dispatchEvent(new Event('change', { bubbles:true }));
    try {
      const $ = window.jQuery;
      // Refresh only existing widgets; initializing on a fancy-input backing select creates a duplicate dropdown.
      if (el.options && $?.fn?.selectpicker) {
        const picker = $(el);
        if (picker.data('selectpicker')) picker.selectpicker('refresh');
      }
    } catch {}
  }
  async function prepare() {
    prepared = '';
    if (mode() === 'outgoing') {
      input(await waitFor(() => document.querySelector('textarea#reason[name="reason"]')), 'Stock Check');
    } else {
      input(await waitFor(() => document.querySelector('#bulk_reason')), 'other');
      input(await waitFor(() => document.querySelector('#other_reason')), 'Stock Check');
    }
    if (mode() === 'incoming') {
      input(await waitFor(() => document.querySelector('#inbound_location')), 'otherLocation');
      const fancy = await waitFor(() => document.querySelector('.fancy-input-otherLocation,#picklocationSelect .fancy-input'));
      (fancy.querySelector('.value-holder') || fancy).click();
      const filter = fancy.querySelector('.filter-input');
      if (filter) { input(filter, 'Extern'); filter.dispatchEvent(new Event('keyup', { bubbles:true })); }
      const option = await waitFor(() => fancy.querySelector('.dropdown-item.option[data-key="00. Extern"]'));
      option.click();
      const value = option.getAttribute('data-value'), select = document.querySelector('#otherLocation');
      if (value && select && select.value !== value) input(select, value);
      if (!value || !select) throw new Error('Locatieselectie kan niet worden bevestigd');
      selectedLocation = value;
      if (select && value && select.value !== value) throw new Error('00. Extern is niet geselecteerd');
    }
    prepared = mode(); message = 'Voorbereid: Stock Check' + (mode() === 'incoming' ? ' · 00. Extern' : '') + '. Injecteer nu de barcodes.';
  }
  function parseList(text) {
    const items = new Map();
    for (const [index,line] of String(text || '').split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const cells = line.trim().split('\t'), ean = cells[0].trim(), rawQuantity = (cells[1] || '1').trim();
      const quantity = mode() === 'outgoing' ? rawQuantity.replace(/^-(?=[1-9]\d*$)/, '') : rawQuantity;
      if (cells.length > 2 || !/^\d{8,14}$/.test(ean) || !/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) throw new Error('Ongeldige regel ' + (index+1) + ': gebruik EAN en positief aantal');
      const total = (items.get(ean) || 0) + Number(quantity);
      if (!Number.isSafeInteger(total)) throw new Error('Aantal te groot');
      items.set(ean, total);
    }
    if (!items.size) throw new Error('Geen barcodes gevonden');
    return [...items].map(([ean,qty]) => ({ean,qty}));
  }
  function nextBatch(items, maxProducts = 75) {
    // parseList already groups repeated EANs; keep each product's entire quantity together.
    return items.slice(0,maxProducts).map(item => ({ean:item.ean,qty:item.qty}));
  }
  function subtract(items, batch) {
    const amounts = new Map(batch.map(item => [item.ean,item.qty]));
    return items.map(item => ({ean:item.ean,qty:item.qty-(amounts.get(item.ean)||0)})).filter(item => item.qty>0);
  }
  const tasks = () => [...document.querySelectorAll(mode() === 'incoming' ? '#scannedProducts tbody tr, .scanned_tasks_body tr' : '.scanned_tasks_body tr')];
  const failedTask = row => row.classList.contains('failed_tr') ||
    (row.dataset?.processed !== undefined && !!row.querySelector('.fa-times,.fa-times-circle'));
  const terminalIncomingTask = row => row.dataset?.processed === 'true' ||
    (failedTask(row) && !row.querySelector('.fa-spinner'));
  const unfinished = () => tasks().some(row => row.dataset?.processed !== undefined
    ? !terminalIncomingTask(row)
    : row.matches('.to_do_task,.processing,.processing_tr,.in_progress'));
  const taskCell = row => row.querySelector('.barcode_td') || row.querySelector('td:nth-child(2)');
  const taskBarcode = row => (row.dataset?.barcode || taskCell(row)?.dataset.barcode || taskCell(row)?.textContent || '').trim();
  function waitForIncomingTask(row, start) {
    return new Promise((resolve,reject) => {
      let observer, timer, settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; observer?.disconnect(); clearTimeout(timer);
        document.removeEventListener?.('visibilitychange',onVisibility);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        try {
          requireAccess();
          if (!row.isConnected) throw new Error('Scantaak verdwenen vóór bevestigde afloop; injectie gestopt');
          if (terminalIncomingTask(row)) finish();
        } catch(error) { finish(error); }
      };
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          check();
          if (settled) return;
          if (document.hidden) armTimeout();
          else finish(new Error('Scantaak na 60 seconden nog niet afgerond; niet opnieuw aangeboden'));
        },60000);
      };
      const onVisibility = () => {
        check();
        if (!settled && !document.hidden) armTimeout();
      };
      // Watch this task and its removal. Never start or call GG's self-scheduling processor.
      observer = new MutationObserver(check);
      observer.observe(row.parentNode, {subtree:true,childList:true,attributes:true,attributeFilter:['data-processed','class']});
      document.addEventListener?.('visibilitychange',onVisibility);
      armTimeout();
      check();
      if (!settled) {
        try { start?.(); check(); } catch(error) { finish(error); }
      }
    });
  }
  async function incomingScan(ean) {
    const before = new Set(tasks());
    window.addBarcodeToTasks(ean);
    const added = tasks().filter(row => !before.has(row) && taskBarcode(row) === ean);
    if (added.length !== 1) throw new Error('Nieuwe scantaak niet eenduidig herkenbaar; injectie gestopt');
    const row = added[0];
    if (row.dataset.processed !== 'false') throw new Error('Scantaak is al opgepakt; niet opnieuw aangeboden');
    // Claim synchronously before yielding: GG's native loop selects only data-processed="false".
    row.dataset.processed = 'processing';
    if (row.dataset.isSerialNumber === 'true') throw new Error('Serienummerdialoog actief; controleer de taak voordat je verdergaat');
    await waitForIncomingTask(row, () => window.processScannedProduct(window.jQuery(row)));
  }
  function failureReason(row) {
    return (row.getAttribute?.('data-original-title') || row.getAttribute?.('title') || '').trim();
  }
  function failuresViewed() {
    const rows = tasks().filter(failedTask);
    return rows.length > 0 && rows.every(row => viewedFailures.get(row) === failureReason(row));
  }
  async function failureAction() {
    if (failuresViewed()) {
      const eans=failures();
      await navigator.clipboard.writeText(eans.join('\n'));
      message=eans.length+' unieke foutieve EANs gekopieerd.';
    } else clean();
  }
  function failures() {
    return [...new Set(tasks().filter(failedTask).map(taskBarcode).filter(Boolean))];
  }
  function clean() {
    if (unfinished()) throw new Error('Wacht tot alle scantaken klaar zijn');
    const seen = new Set(); let removed = 0;
    for (const row of tasks()) {
      const td = taskCell(row);
      if (!td || row.classList.contains('no_scans')) continue;
      const ean = taskBarcode(row);
      if (failedTask(row)) {
        if (!ean || !seen.has(ean)) {
          if (ean) {
            seen.add(ean); td.dataset.barcode=ean;
            const reason=failureReason(row);
            td.textContent=ean+(reason?' - '+reason:'');
            viewedFailures.set(row,reason);
          }
          continue;
        }
      }
      row.remove(); removed++;
    }
    message = removed + ' afgeronde/dubbele regels opgeruimd. ' + failures().length + ' unieke fouten blijven staan.';
  }
  async function inject(directItems = null) {
    const bulk = directItems === null;
    if (injectionUncertain) throw new Error('Vorige injectie onderbroken; controleer de aangeboden scans en herlaad de pagina voordat je opnieuw injecteert');
    if (prepared !== mode()) throw new Error('Bereid eerst het formulier voor');
    const reasonCorrect = mode() === 'outgoing'
      ? document.querySelector('textarea#reason[name="reason"]')?.value === 'Stock Check'
      : document.querySelector('#other_reason')?.value === 'Stock Check' && document.querySelector('#bulk_reason')?.value === 'other';
    if (!reasonCorrect) { prepared = ''; throw new Error('Formulier gewijzigd; bereid opnieuw voor'); }
    if (mode() === 'incoming' && (document.querySelector('#inbound_location')?.value !== 'otherLocation' || document.querySelector('#otherLocation')?.value !== selectedLocation)) { prepared='';throw new Error('Locatie gewijzigd; bereid opnieuw voor'); }
    if (bulk && pending) throw new Error('Registreer eerst de vorige batch via Goedgepickt; controleer bij een onderbroken batch de pagina');
    if (unfinished()) throw new Error('Er staan nog onverwerkte scantaken');
    if (!(bulk ? queue : directItems).length) throw new Error('Laad eerst barcodes');
    if (!document.hasFocus() || document.hidden) throw new Error('Activeer dit tabblad');
    if (mode() === 'incoming' && (typeof window.addBarcodeToTasks !== 'function' || typeof window.processScannedProduct !== 'function' || typeof window.jQuery !== 'function')) throw new Error('Scannerfunctie niet geladen');
    if (mode() === 'outgoing' && (!document.querySelector('.scanned_tasks_body') || typeof window.executeTasks !== 'function')) throw new Error('Uitgaande scanner niet geladen');
    const batch = bulk ? nextBatch(queue) : directItems;
    scanProgress={total:batch.reduce((sum,item)=>sum+item.qty,0),done:0,rows:[],mode:mode(),stopped:false};
    if (bulk) { pending = { batch, status:'injecting' }; save(); }
    viewedFailures = new WeakMap();
    let count = 0;
    try {
      for (const item of batch) for (let i=0;i<item.qty;i++) {
        requireAccess();
        if (mode() === 'incoming' && document.querySelector('.swal2-popup.swal2-show')) throw new Error('Goedgepickt vraagt om invoer in een dialoog; injectie gestopt. Handel de melding af en controleer de reeds aangeboden scans');
        count++;
        if (mode() === 'incoming') await incomingScan(item.ean);
        else {
          const row = document.createElement('tr'); row.className = 'to_do_task';
          const icon = document.createElement('td'), barcode = document.createElement('td');
          barcode.className = 'barcode_td'; barcode.dataset.barcode = item.ean; barcode.textContent = item.ean;
          row.append(icon,barcode); document.querySelector('.scanned_tasks_body').prepend(row);
          scanProgress.rows.push(row);
        }
        if (mode() === 'incoming') scanProgress.done++;
        message = count + ' scans aangeboden.';
      }
      if (bulk) { pending.status = 'injected'; save(); }
      if (mode() === 'outgoing') {
        window.executeTasks();
        if (bulk) advanceBatch();
      }
      message = count + ' scans geïnjecteerd. ' + (mode() === 'incoming' ? 'Registreer de ontvangst met de knop van Goedgepickt.' : 'Controleer en verwerk de producten via Goedgepickt.');
    } catch (error) { scanProgress.stopped=true; injectionUncertain = count > 0; if (bulk && pending) { pending.status = 'uncertain'; save(); } throw new Error(count + ' scans aangeboden; controleer de pagina. ' + error.message); }
  }
  function advanceBatch() {
    if (!pending || pending.status !== 'injected') return;
    queue = subtract(queue,pending.batch); pending = null; completeEmptyList(); save();
  }
  function completeEmptyList() {
    if (!listSaved || queue.length || pending) return;
    listSaved=false; listTotal=0; editorOpen=false; listCompleted=true;
    const textarea=panel?.querySelector('textarea'); if(textarea)textarea.value='';
  }
  function listStatus() {
    const listText=listCompleted?'Bulklijst verwerkt.':listSaved?listTotal+' scans in de lijst, nog '+queue.reduce((sum,item)=>sum+item.qty,0)+' te verwerken.':'';
    if (!scanProgress || scanProgress.mode!==mode()) return listText;
    if (scanProgress.mode==='outgoing') {
      // Inspect only our own outstanding task rows, using the existing one-second UI refresh.
      scanProgress.rows=scanProgress.rows.filter(row=>{
        const finished=!row.matches?.('.to_do_task,.processing,.processing_tr,.in_progress') &&
          (row.classList?.contains('failed_tr') || !!row.querySelector?.('.fa-check,.fa-check-circle,.fa-check-circle-o'));
        if(finished)scanProgress.done++;
        return !finished;
      });
    }
    const {done,total,stopped}=scanProgress;
    const percent=total?Math.floor(done/total*100):0;
    const label=stopped?'Gestopt':done===total?'Scans verwerkt':'Scans verwerken';
    const progress=label+': '+done+'/'+total+' ('+percent+'%).';
    // A submitted outgoing batch can leave the local list before GG finishes its task rows.
    return progress+(listCompleted&&done<total?'':listText?' '+listText:'');
  }
  // This advances only our list, not the stock registration. GG owns submission and retries.
  if (typeof document !== 'undefined') document.addEventListener?.('click', event => {
    const button = event.target?.closest?.('button.attach_scanned_products');
    if (!button || button.disabled || event.defaultPrevented || !allowed() || mode() !== 'incoming') return;
    if (busy) {
      event.preventDefault(); event.stopImmediatePropagation();
      message = 'Wacht tot de injectie klaar is voordat je de ontvangst registreert.';
      return;
    }
    if (unfinished()) return;
    if (pending?.status !== 'injected') return;
    advanceBatch();
    message = 'Registratie aangevraagd via Goedgepickt. Controleer het resultaat daar voordat je verdergaat.';
  }, true);
  const wagroClasses = ['gg-stock-wagro-only','gg-stock-wagro-multi'];
  function wagroKind(select) {
    const isWaGro = (text, value) => String(text || '').trim().startsWith('WaGro') || String(value || '').trim().startsWith('WaGro');
    const options = [...(select.options || [])];
    let selectedText = (options[select.selectedIndex]?.text || '').trim();
    if (!selectedText) {
      const button = (select.closest('.bootstrap-select') || select.parentElement)?.querySelector('button.dropdown-toggle');
      selectedText = button?.getAttribute('title') || button?.textContent || '';
    }
    if (!isWaGro(selectedText, select.value)) return '';
    return options.some(option => ((option.text || '').trim() || (option.value || '').trim()) && !isWaGro(option.text, option.value)) ? 'multi' : 'only';
  }
  function wagroRows() {
    const rows = new Map();
    for (const select of document.querySelectorAll('select.picklocationSelectPicker')) {
      const row = select.closest('tr'); if (!row) continue;
      const kind = wagroKind(select);
      // A row with multiple selectors is removable only if every selector is WaGro-only.
      rows.set(row, rows.has(row) && rows.get(row) !== kind ? 'multi' : kind);
    }
    return rows;
  }
  const locationWarnings = new Set();
  const locationNotice = 'De volgende producten hebben geen geldige voorraadlocatie geselecteerd. Controleer de locatie en probeer het opnieuw.';
  const normalizeNotice = text => String(text || '').replace(/\s+/g,' ').trim();
  function captureLocationNotice(notice) {
    if (!allowed() || mode() !== 'outgoing') return;
    if (!normalizeNotice(notice.textContent).startsWith(locationNotice)) return;
    for (const item of notice.querySelectorAll('li')) {
      // textContent also joins SKU fragments split by the DDO product-link adapter.
      const match = normalizeNotice(item.textContent).match(/\((\d{5}-\d{1,3}-\d{1,3})\)\s*$/);
      if (match) locationWarnings.add(match[1]);
    }
  }
  function inspectLocationNotices(node) {
    if (!node) return;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node) return;
    const parentNotice = node.closest?.('[data-notify="message"]');
    if (parentNotice) captureLocationNotice(parentNotice);
    node.querySelectorAll?.('[data-notify="message"]').forEach(captureLocationNotice);
  }
  function updateLocationWarnings() {
    const active = allowed() && mode() === 'outgoing';
    if (active) inspectLocationNotices(document);
    else locationWarnings.clear();
    let style = document.getElementById('gg-stock-location-style');
    if (active && locationWarnings.size && !style) {
      style=document.createElement('style');style.id='gg-stock-location-style';
      // Yellow takes priority over WaGro red/orange without removing those classifications.
      style.textContent='tr.gg-stock-location-warning.gg-stock-location-warning,tr.gg-stock-location-warning.gg-stock-location-warning>td{background-color:#f4d03f!important}';
      document.head.appendChild(style);
    } else if (!active) style?.remove();
    const rows = new Set(document.querySelectorAll('tr[data-product-uuid],tr[data-product_uuid],tr.gg-stock-location-warning'));
    for (const row of rows) {
      const cell=row.querySelector('td[data-field="ProductSKU"]');
      const skus=(cell?.textContent || '').match(/\b\d{5}-\d{1,3}-\d{1,3}\b/g) || [];
      const marked=active && skus.some(sku=>locationWarnings.has(sku));
      row.classList.toggle('gg-stock-location-warning',marked);
      const note=row.querySelector('.gg-stock-location-note');
      if (marked && !note) {
        const target=row.querySelector('td.originalStockLocations') || cell;
        if (!target) continue;
        const icon=document.createElement('span');icon.className='gg-stock-location-note';icon.textContent='⚠ ';
        icon.title='GG meldde voor dit product geen geldige voorraadlocatie. Controleer de locatie.';
        icon.setAttribute('aria-label',icon.title);target.prepend(icon);
      } else if (!marked) note?.remove();
    }
  }
  // Capture even a toast added and removed between two regular toolbox refreshes.
  if (typeof document !== 'undefined' && document.documentElement && typeof MutationObserver !== 'undefined') {
    const locationObserver = new MutationObserver(mutations => {
      if (!allowed() || mode() !== 'outgoing') return;
      for (const mutation of mutations) {
        inspectLocationNotices(mutation.target);
        mutation.addedNodes?.forEach(inspectLocationNotices);
        mutation.removedNodes?.forEach(inspectLocationNotices);
      }
      if (locationWarnings.size) updateLocationWarnings();
    });
    locationObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }
  function updateWaGro() {
    const active = allowed() && mode() === 'outgoing';
    const rows = active ? wagroRows() : new Map();
    let style = document.getElementById('gg-stock-wagro-style');
    if (active && !style) {
      style = document.createElement('style'); style.id = 'gg-stock-wagro-style';
      style.textContent = 'tr.gg-stock-wagro-only,tr.gg-stock-wagro-only>td{background-color:#e6a400!important}tr.gg-stock-wagro-only:hover>td{background-color:#ffb600!important}tr.gg-stock-wagro-multi,tr.gg-stock-wagro-multi>td{background-color:#e04b4b!important}tr.gg-stock-wagro-multi:hover>td{background-color:#ff5f5f!important}';
      document.head.appendChild(style);
    } else if (!active) style?.remove();
    for (const row of document.querySelectorAll('tr.gg-stock-wagro-only,tr.gg-stock-wagro-multi')) {
      if (!rows.has(row)) row.classList.remove(...wagroClasses);
    }
    for (const [row,kind] of rows) {
      wagroClasses.forEach((name,index) => row.classList.toggle(name, kind === ['only','multi'][index]));
    }
    return [...rows].filter(([row,kind]) => kind === 'only' && row.querySelector('button.removeProductRow:not(:disabled)')).length;
  }
  function removeWaGro() {
    requireAccess();
    if (mode() !== 'outgoing' || prepared !== mode()) throw new Error('Activeer eerst Stock Check op outgoing');
    if (unfinished()) throw new Error('Wacht tot alle scantaken klaar zijn');
    let count = 0;
    for (const [row] of wagroRows()) {
      // Recheck immediately before using the site's own remove handler.
      const selects = [...row.querySelectorAll('select.picklocationSelectPicker')];
      if (!row.isConnected || !selects.length || !selects.every(select => wagroKind(select) === 'only')) continue;
      const button = row.querySelector('button.removeProductRow:not(:disabled)');
      if (button) { button.click(); count++; }
    }
    message = count + ' alleen-WaGro regels aangeboden voor verwijderen.';
  }
  function externOption(select) {
    return [...select.options].find(option => !option.disabled && /^00\.\s*Extern(?:\s*\(|$)/i.test(option.text.trim()));
  }
  function wagroChanges() {
    return [...document.querySelectorAll('select.picklocationSelectPicker')].filter(select => !select.disabled && wagroKind(select) === 'multi' && externOption(select));
  }
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  function visiblePopup() {
    return [...document.querySelectorAll('.swal2-popup')].find(visible);
  }
  function stockNoticeButton(popup) {
    const normalize = text => String(text || '').replace(/<\/?b>/gi,'').replace(/\s+/g,' ').trim();
    if (normalize(popup.querySelector('.swal2-title')?.textContent) !== 'Let op!') return null;
    const text = normalize(popup.querySelector('#swal2-content')?.textContent);
    const match = text.match(/^De geselecteerde locatie heeft minder voorraad dan gescand\. Hierdoor is het gescande nummer aangepast van (\d+) naar (\d+)\.?$/);
    if (!match || Number(match[2]) >= Number(match[1])) return null;
    if (!visible(popup.querySelector('.swal2-info')) || visible(popup.querySelector('.swal2-cancel'))) return null;
    const button = popup.querySelector('.swal2-confirm');
    return visible(button) && !button.disabled && normalize(button.textContent) === 'OK' ? button : null;
  }
  async function changeWaGro() {
    requireAccess();
    if (mode() !== 'outgoing' || prepared !== mode()) throw new Error('Activeer eerst Stock Check op outgoing');
    if (unfinished()) throw new Error('Wacht tot alle scantaken klaar zijn');
    if (visiblePopup()) throw new Error('Sluit eerst de openstaande melding');
    let changed = 0, notices = 0;
    for (const select of wagroChanges()) {
      requireAccess();
      if (mode() !== 'outgoing' || unfinished()) throw new Error('Locatiewijziging gestopt: pagina of scantaken gewijzigd');
      if (!select.isConnected || select.disabled || wagroKind(select) !== 'multi') continue;
      const option = externOption(select); if (!option) continue;
      if (visiblePopup()) throw new Error('Openstaande melding; overige locaties niet gewijzigd');
      input(select,option.value);
      // Only inspect the brief response to this explicit location change, never other page actions.
      for (let attempt=0;attempt<10;attempt++) {
        await pause(100); requireAccess();
        const popup = visiblePopup();
        if (!popup) continue;
        const confirm = stockNoticeButton(popup);
        if (!confirm || select.value !== option.value) throw new Error('Andere melding aangetroffen; controleer deze zelf. Overige locaties niet gewijzigd');
        confirm.click(); notices++;
        for (let wait=0;wait<50 && visible(popup);wait++) await pause(100);
        if (visiblePopup()) throw new Error('Melding blijft open; overige locaties niet gewijzigd');
        break;
      }
      if (select.value !== option.value) throw new Error('Locatie niet overgenomen; controleer de productregel');
      changed++;
      message = changed + ' locaties gewijzigd naar 00. Extern; ' + notices + ' voorraadmeldingen bevestigd.';
    }
    message = changed + ' locaties gewijzigd naar 00. Extern; ' + notices + ' voorraadmeldingen bevestigd. Controleer de aantallen voor verwerking.';
  }
  async function operation(fn) {
    if (busy) return; requireAccess(); busy = true; render();
    try { await fn(); } catch(error) { message = error.message; window.alert(message); }
    finally { busy = false; render(); }
  }
  function addButton(label, fn, id) {
    const button = document.createElement('button'); button.type='button';button.dataset.action=id;button.textContent=label;
    button.onclick=()=>{ if(allowed()) void operation(fn); };
    button.style.cssText='padding:5px;border:0;border-radius:4px;font:10px/1.2 system-ui;cursor:pointer';
    panel.querySelector('.stock-actions').append(button);return button;
  }
  function listAction() {
    scanProgress=null;
    listCompleted=false;
    if (listSaved) {
      if (pending && !window.confirm('De vorige batch is nog niet bevestigd. Alleen de opgeslagen lijst en blokkering wissen? Scans op de pagina blijven staan. Controleer die voordat je opnieuw injecteert.')) return;
      queue=[]; pending=null; listSaved=false; editorOpen=false; listTotal=0;
      panel.querySelector('textarea').value=''; save(); message='Bulklijst gereset.';
    } else if (editorOpen) {
      if (pending) throw new Error('Bevestig eerst de vorige batch');
      queue=parseList(panel.querySelector('textarea').value); listTotal=queue.reduce((sum,item)=>sum+item.qty,0); listSaved=true; editorOpen=false;
      save(); message=queue.length+' unieke EANs opgeslagen; klaar voor injectie.';
    } else editorOpen=true;
  }
  function flowState() {
    const activated=prepared===mode() && !!mode();
    return { activated, label:listSaved?'Lijst resetten':editorOpen?'Lijst opslaan':'Bulklijst', editorVisible:activated && editorOpen && !listSaved };
  }
  function mount() {
    const next = window.__ggToolbox?.getPanel?.('stockCheck'); if (!next) return;
    panel = next;
    if (panel.querySelector('.stock-actions')) return;
    panel.style.cssText='padding:6px;border-top:1px solid #dfe5e9';
    panel.innerHTML='<div style="font-size:10px;margin-bottom:4px">Stock Check</div><div class="stock-actions" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px"></div><textarea class="stock-list" aria-label="Bulklijst: EAN en aantal gescheiden door tab" placeholder="EAN [tab] AANTAL" style="box-sizing:border-box;width:100%;height:110px;font:10px monospace;margin-top:4px" hidden></textarea><div class="stock-status" role="status" style="font-size:9px;overflow-wrap:anywhere;margin-top:4px"></div>';
    addButton('Activeer',prepare,'activate');
    addButton('Barcodes injecteren',async()=>{
      if (listSaved) await inject();
      else { const text=await navigator.clipboard.readText(); requireAccess(); await inject(parseList(text)); }
    },'inject');
    addButton('Bulklijst',listAction,'list');
    addButton('Fouten bekijken',failureAction,'errors');
    const wagroButton = addButton('Alleen WaGro verwijderen',removeWaGro,'wagro');
    wagroButton.title = 'Verwijder alle producten op WaGro-locaties';
    wagroButton.setAttribute('aria-label',wagroButton.title);
    const changeButton = addButton('WaGro locatie wijzigen',changeWaGro,'wagroChange');
    changeButton.title = 'Wijzig voorraadlocatie van WaGro naar Extern';
    changeButton.setAttribute('aria-label',changeButton.title);

  }
  function render() {
    const wagroCount = updateWaGro();
    updateLocationWarnings();
    if (!allowed()) { if(panel) panel.hidden=true;prepared='';return; }
    restore();mount();if(!panel)return;panel.hidden=false;
    const flow=flowState();
    const changeCount=mode()==='outgoing'?wagroChanges().length:0;
    const flags={activate:true,list:true,inject:prepared===mode(),errors:failures().length>0&&(failuresViewed()||!unfinished()),wagro:wagroCount>0&&!unfinished(),wagroChange:changeCount>0&&!unfinished()};
    for(const button of panel.querySelectorAll('[data-action]')){
      const id=button.dataset.action;button.disabled=busy||!flags[id];button.style.background=button.disabled?'#d6dce1':'#18864b';button.style.color=button.disabled?'#56616a':'white';
      button.hidden=id==='activate'?flow.activated:!flow.activated;
      if(id==='wagro'){button.hidden=!flow.activated||mode()!=='outgoing';button.textContent='🗑 −WaGro';button.style.gridColumn='auto';button.title='Verwijder alle producten op WaGro-locaties';}
      if(id==='wagroChange'){button.hidden=!flow.activated||mode()!=='outgoing';button.textContent='🔧 >Extern';button.style.gridColumn='auto';button.title='Wijzig voorraadlocatie van WaGro naar Extern';}
      if(!button.disabled && id==='wagro'){button.style.background='#e6a400';button.style.color='#111';}
      if(!button.disabled && id==='wagroChange')button.style.background='#e04b4b';
      if(id==='activate'||id==='inject'||id==='list')button.style.gridColumn='1 / -1';
      if(id==='list')button.textContent=flow.label;
      if(id==='errors'){
        button.textContent=failuresViewed()?'📋 Kopieer':'⚠ Fouten';
        button.title=failuresViewed()?'Kopieer unieke foutieve EANs':'Log opschonen en fouten bekijken';
        if(!button.disabled){button.style.background='#f4d03f';button.style.color='#111';}
      }
      if(id==='errors'||id==='wagro'||id==='wagroChange'){
        button.setAttribute('aria-label',button.title);
        button.style.padding='5px 2px';button.style.minWidth='0';button.style.whiteSpace='nowrap';button.style.fontSize='9px';
      }
    }
    panel.querySelector('textarea').hidden=!flow.editorVisible;
    const status=panel.querySelector('.stock-status');
    status.textContent=listStatus();
    status.hidden=!status.textContent;
  }
  function getState(){return {ready:allowed()&&!busy,reason:allowed()?'Bereid Stock Check-formulieren voor':'Open inkomende of uitgaande producten'};}
  window.__ggStockCheck={version:'1.8.3',getState,run:()=>operation(prepare)};
  setInterval(render,1000);
})();
