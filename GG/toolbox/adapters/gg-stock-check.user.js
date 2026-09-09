// ==UserScript==
// @name         GG Toolbox | Adapter | Stock Check
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0.1
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
  let busy = false, prepared = '', panel, message = 'Klik op Stock Check om de formulieren voor te bereiden.';
  let queue = [], pending = null, activeMode = '', editorOpen = false;
  const key = () => 'gg_stock_check_v1_' + mode();
  function save() { sessionStorage.setItem(key(), JSON.stringify({ queue, pending })); }
  function restore() {
    if (activeMode === mode()) return;
    activeMode = mode(); prepared = ''; queue = []; pending = null;
    try { const state = JSON.parse(sessionStorage.getItem(key()) || 'null'); if (state) { queue = state.queue || []; pending = state.pending || null; } } catch {}
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
    try { const $ = window.jQuery; if (el.options && $?.fn?.selectpicker) $(el).selectpicker('refresh'); } catch {}
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
      if (value && select) input(select, value);
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
      const cells = line.trim().split('\t'), ean = cells[0].trim(), quantity = (cells[1] || '1').trim();
      if (cells.length > 2 || !/^\d{8,14}$/.test(ean) || !/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) throw new Error('Ongeldige regel ' + (index+1) + ': gebruik EAN en positief aantal');
      const total = (items.get(ean) || 0) + Number(quantity);
      if (!Number.isSafeInteger(total)) throw new Error('Aantal te groot');
      items.set(ean, total);
    }
    if (!items.size) throw new Error('Geen barcodes gevonden');
    return [...items].map(([ean,qty]) => ({ean,qty}));
  }
  function nextBatch(items, maxScans = 50) {
    const batch = []; let remaining = maxScans;
    for (const item of items) { if (!remaining) break; const qty = Math.min(item.qty, remaining); batch.push({ean:item.ean,qty}); remaining -= qty; }
    return batch;
  }
  function subtract(items, batch) {
    const amounts = new Map(batch.map(item => [item.ean,item.qty]));
    return items.map(item => ({ean:item.ean,qty:item.qty-(amounts.get(item.ean)||0)})).filter(item => item.qty>0);
  }
  const tasks = () => [...document.querySelectorAll('.scanned_tasks_body tr')];
  const unfinished = () => tasks().some(row => row.matches('.to_do_task,.processing,.processing_tr,.in_progress'));
  function failures() {
    return [...new Set(tasks().filter(row => row.classList.contains('failed_tr')).map(row => { const td = row.querySelector('.barcode_td'); return (td?.dataset.barcode || td?.textContent || '').trim(); }).filter(Boolean))];
  }
  function clean() {
    if (unfinished()) throw new Error('Wacht tot alle scantaken klaar zijn');
    const seen = new Set(); let removed = 0;
    for (const row of tasks()) {
      const td = row.querySelector('.barcode_td');
      if (!td || row.classList.contains('no_scans')) continue;
      const ean = (td.dataset.barcode || td.textContent || '').trim();
      if (row.classList.contains('failed_tr')) {
        if (!ean || !seen.has(ean)) { if (ean) seen.add(ean); continue; }
      }
      row.remove(); removed++;
    }
    message = removed + ' afgeronde/dubbele regels opgeruimd. ' + failures().length + ' unieke fouten blijven staan.';
  }
  async function inject() {
    if (prepared !== mode()) throw new Error('Bereid eerst het formulier voor');
    const reasonCorrect = mode() === 'outgoing'
      ? document.querySelector('textarea#reason[name="reason"]')?.value === 'Stock Check'
      : document.querySelector('#other_reason')?.value === 'Stock Check' && document.querySelector('#bulk_reason')?.value === 'other';
    if (!reasonCorrect) { prepared = ''; throw new Error('Formulier gewijzigd; bereid opnieuw voor'); }
    if (mode() === 'incoming' && (document.querySelector('#inbound_location')?.value !== 'otherLocation' || document.querySelector('#otherLocation')?.value !== selectedLocation)) { prepared='';throw new Error('Locatie gewijzigd; bereid opnieuw voor'); }
    if (pending) throw new Error('Bevestig eerst de vorige batch');
    if (unfinished()) throw new Error('Er staan nog onverwerkte scantaken');
    if (!queue.length) throw new Error('Laad eerst barcodes');
    if (!document.hasFocus() || document.hidden) throw new Error('Activeer dit tabblad');
    if (mode() === 'incoming' && typeof window.addBarcodeToTasks !== 'function') throw new Error('Scannerfunctie niet geladen');
    if (mode() === 'outgoing' && (!document.querySelector('.scanned_tasks_body') || typeof window.executeTasks !== 'function')) throw new Error('Uitgaande scanner niet geladen');
    const batch = nextBatch(queue);
    pending = { batch, status:'injecting' }; save();
    let count = 0;
    try {
      for (const item of batch) for (let i=0;i<item.qty;i++) {
        requireAccess();
        if (mode() === 'incoming') window.addBarcodeToTasks(item.ean);
        else {
          const row = document.createElement('tr'); row.className = 'to_do_task';
          const icon = document.createElement('td'), barcode = document.createElement('td');
          barcode.className = 'barcode_td'; barcode.dataset.barcode = item.ean; barcode.textContent = item.ean;
          row.append(icon,barcode); document.querySelector('.scanned_tasks_body').prepend(row);
        }
        count++;
      }
      pending.status = 'injected'; save();
      if (mode() === 'incoming') window.processScannedProducts?.();
      else window.executeTasks();
      message = count + ' scans geïnjecteerd. ' + (mode() === 'incoming' ? 'Registreer de ontvangst op de pagina en bevestig hieronder.' : 'Wacht op de verwerking en bevestig hieronder.');
    } catch (error) { pending.status = 'uncertain'; save(); throw new Error(count + ' scans aangeboden; controleer de pagina. ' + error.message); }
  }
  function acknowledge() {
    if (!pending || unfinished()) throw new Error('Wacht tot de verwerking klaar is');
    queue = subtract(queue,pending.batch); pending = null; save();
    message = 'Batch bevestigd. ' + queue.reduce((sum,item)=>sum+item.qty,0) + ' scans over.';
  }
  async function operation(fn) {
    if (busy) return; requireAccess(); busy = true; render();
    try { await fn(); } catch(error) { message = error.message; }
    finally { busy = false; render(); }
  }
  function addButton(label, fn, id) {
    const button = document.createElement('button'); button.type='button';button.dataset.action=id;button.textContent=label;
    button.onclick=()=>{ if(allowed()) void operation(fn); };
    button.style.cssText='padding:5px;border:0;border-radius:4px;font:10px/1.2 system-ui;cursor:pointer';
    panel.querySelector('.stock-actions').append(button);return button;
  }
  function mount() {
    const next = window.__ggToolbox?.getPanel?.('stockCheck'); if (!next) return;
    panel = next;
    if (panel.querySelector('.stock-actions')) return;
    panel.style.cssText='padding:6px;border-top:1px solid #dfe5e9';
    panel.innerHTML='<div style="font-size:10px;margin-bottom:4px">Stock Check</div><div class="stock-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:4px"></div><textarea class="stock-list" aria-label="Bulklijst: EAN en aantal gescheiden door tab" placeholder="EAN [tab] AANTAL" style="box-sizing:border-box;width:100%;height:110px;font:10px monospace;margin-top:4px" hidden></textarea><div class="stock-status" role="status" style="font-size:9px;overflow-wrap:anywhere;margin-top:4px"></div>';
    addButton('Barcodes injecteren',async()=>{
      if (!queue.length) { const text=await navigator.clipboard.readText(); requireAccess(); queue=parseList(text);save(); }
      await inject();
    },'inject');
    addButton('Bulklijst',()=>{editorOpen=!editorOpen;},'editor');
    addButton('Lijst opslaan',()=>{ if(pending)throw new Error('Bevestig eerst de vorige batch');queue=parseList(panel.querySelector('textarea').value);save();message=queue.length+' unieke EANs opgeslagen; klaar voor injectie.';},'save');
    addButton('Foute EANs kopiëren',async()=>{await navigator.clipboard.writeText(failures().join('\n'));message=failures().length+' unieke foutieve EANs gekopieerd.';},'copy');
    addButton('Opschonen',clean,'clean');
    addButton('Batch bevestigen',acknowledge,'ack');
    addButton('Lijst wissen',()=>{if(pending && !window.confirm('De vorige batch is nog niet bevestigd. Alleen de opgeslagen lijst en blokkering wissen? Scans op de pagina blijven staan. Controleer die voordat je opnieuw injecteert.'))return;queue=[];pending=null;save();message='Bulklijst gewist.';},'reset');
  }
  function render() {
    if (!allowed()) { if(panel) panel.hidden=true;prepared='';return; }
    restore();mount();if(!panel)return;panel.hidden=false;
    const flags={inject:prepared===mode()&&!pending&&!unfinished(),editor:true,save:editorOpen&&!pending,copy:failures().length>0,clean:tasks().some(row=>row.querySelector('.barcode_td'))&&!unfinished(),ack:!!pending&&!unfinished()&&pending.status==='injected',reset:queue.length>0||!!pending};
    for(const button of panel.querySelectorAll('[data-action]')){
      const id=button.dataset.action;button.disabled=busy||!flags[id];button.style.background=button.disabled?'#d6dce1':'#18864b';button.style.color=button.disabled?'#56616a':'white';
      button.hidden=(id==='save'&&!editorOpen)||(id==='ack'&&!pending);
      if(id==='ack')button.textContent=mode()==='incoming'?'Registratie bevestigd':'Verwerking bevestigd';
    }
    panel.querySelector('textarea').hidden=!editorOpen;
    panel.querySelector('.stock-status').textContent=message+' · '+queue.reduce((sum,item)=>sum+item.qty,0)+' scans in lijst · '+failures().length+' unieke fouten';
  }
  function getState(){return {ready:allowed()&&!busy,reason:allowed()?'Bereid Stock Check-formulieren voor':'Open inkomende of uitgaande producten'};}
  window.__ggStockCheck={version:'1.0.1',getState,run:()=>operation(prepare)};
  setInterval(render,1000);
})();
