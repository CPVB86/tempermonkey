// ==UserScript==
// @name         DDO | Prune Me
// @namespace    ddo-tools
// @version      1.8
// @description  Snel alle 'Sizes' (#tabs-2) verwijderen die niet in 'Options' (#tabs-3) staan, met batchrunner, eindcheck, tag-opschoning, queue-bouw, animaties snel, watchdog/heartbeat en visibility failsafes.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/prune-me.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/prune-me.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------ CONSTANTS ------------------
  const BASE_EDIT_URL  = 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=';
  const EDIT_HASH      = '#tabs-2';

  const PRUNE_TAG_NORM = 'SYSTPRUNEME'; // norm('SYST - Prune Me')
  const DEFAULT_ANIM_MS = 10;

  // ------------------ STATELESS HELPERS ------------------
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const SKEY = 'DDO_BATCH_PRUNE_V1';

  function loadState() {
    try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { return {}; }
  }
  function saveState(st) {
    localStorage.setItem(SKEY, JSON.stringify(st));
  }
  function resetState() {
    saveState({
      active:false, paused:false, dryRun:true,
      delayMs: 500,        // navigeer-delay tussen producten (sneller)
      maxErrors: 50,
      queue: [], idx: 0,
      stats:{done:0, deleted:0, skipped:0, errors:0},
      log:[],
      fastMode: true,      // snel verwijderen in bulk
      settleMs: 300        // korte wachttijd na bulk voor AJAX/DOM
    });
  }

  // --------------- WATCHDOG / HEARTBEAT / PROGRESS ---------------
  let DDO_WATCHDOG = null;
  let DDO_HEARTBEAT = null;
  let DDO_LAST_PROGRESS_TS = Date.now();
  let DDO_NAV_LOCK = false;

  function touchProgress(){ DDO_LAST_PROGRESS_TS = Date.now(); }

  function forceGotoNext(reason='watchdog'){
    if (DDO_NAV_LOCK) return;
    const st = loadState();
    if (!st || !st.active) return;
    st.idx = Math.min((st.idx||0)+1, (st.queue?.length||1)-1);
    saveState(st);
    const next = st.queue?.[st.idx];
    if (!next) return;
    console.warn('[DDO-BATCH] Force nav →', reason, next);
    DDO_NAV_LOCK = true;
    try { location.assign(next + '#ddo=' + Date.now()); }
    catch { try { location.replace(next + '#ddo=' + Date.now()); } catch {} }
  }

  document.addEventListener('visibilitychange', ()=>{
    const hidden = document.hidden;
    logLine(hidden ? '🔕 Tab is hidden → timers kunnen vertragen' : '🔔 Tab is zichtbaar');
    try {
      clearTimeout(DDO_WATCHDOG);
      DDO_WATCHDOG = setTimeout(()=>forceGotoNext('product-timeout'), hidden ? 30000 : 45000);
    } catch {}
  });

  // ------------------ LOGGING ------------------
  function logLine(msg){
    const st = loadState();
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    st.log = (st.log||[]).concat(line).slice(-5000);
    saveState(st);
    const el = $('#ddo-batch-log'); if (el) el.textContent += '\n'+line;
    console.log('[DDO-BATCH]', msg);
    try { touchProgress(); } catch {}
  }

  // ------------------ NORMALIZE & URL ------------------
  function norm(s){
    return (s||'')
      .toString()
      .normalize('NFKC')
      .replace(/[\s\u00A0]+/g, '')
      .replace(/[^0-9A-Z]/gi, '')
      .toUpperCase()
      .trim();
  }

  function normalizeToUrl(token){
    if (/^https?:\/\//i.test(token)) {
      let id = '';
      try {
        const u = new URL(token.trim(), location.origin);
        id = u.searchParams.get('id') || (u.href.match(/[?&]id=(\d+)/)?.[1] ?? '');
      } catch { /* noop */ }
      if (!id) throw new Error('Geen geldige id in URL');
      return BASE_EDIT_URL + id;
    }
    const id = String(token).trim();
    if (!/^\d+$/.test(id)) throw new Error('Kale ID is niet numeriek: ' + id);
    return BASE_EDIT_URL + id;
  }

  // ------------------ DOM READY HELPERS ------------------
  async function waitForTabs(){
    return new Promise(res=>{
      const ok=()=> $('#tabs-2') && $('#tabs-3') && $('#tabs-7');
      if(ok()) return res();
      const mo=new MutationObserver(()=>{ if(ok()){ mo.disconnect(); res(); } });
      mo.observe(document.documentElement,{childList:true,subtree:true});
    });
  }

  function clickTabIfNeeded(tabSel){
    const tabEl = document.querySelector(tabSel);
    const hasRows = tabEl && tabEl.querySelector('tr');
    if (hasRows) return;
    const a = document.querySelector(`a[href="${tabSel}"], #tabs a[href="${tabSel}"]`);
    if (a) a.click();
  }

  function waitForOptionsLoaded(timeoutMs=5000){
    return new Promise((resolve, reject)=>{
      const start = Date.now();
      const ready = ()=> document.querySelector('#tabs-3 table.options tr');
      if (ready()) return resolve();
      clickTabIfNeeded('#tabs-3');
      const target = document.getElementById('tabs-3') || document.body;
      const mo = new MutationObserver(()=>{
        if (ready()){ mo.disconnect(); resolve(); }
        else if (Date.now()-start > timeoutMs){ mo.disconnect(); reject(new Error('Options niet geladen')); }
      });
      mo.observe(target, {childList:true,subtree:true});
      setTimeout(()=>{ if (ready()){ mo.disconnect(); resolve(); } }, 300);
    });
  }

  function waitForTagsLoaded(timeoutMs=5000){
    return new Promise((resolve, reject)=>{
      const start = Date.now();
      const ready = ()=> document.querySelector('#tabs-7 table.control tr[id^="tagdelete_"]') || document.querySelector('#tabs-7 .empty_set');
      if (ready()) return resolve();
      clickTabIfNeeded('#tabs-7');
      const target = document.getElementById('tabs-7') || document.body;
      const mo = new MutationObserver(()=>{
        if (ready()){ mo.disconnect(); resolve(); }
        else if (Date.now()-start > timeoutMs){ mo.disconnect(); reject(new Error('Tags niet geladen')); }
      });
      mo.observe(target, {childList:true,subtree:true});
      setTimeout(()=>{ if (ready()){ mo.disconnect(); resolve(); } }, 300);
    });
  }

  // ------------------ ANIMATIES SNEL MAKEN ------------------
  function speedUpUIAnimations(ms = DEFAULT_ANIM_MS){
    const css = `
      #tabs-2, #tabs-2 * {
        transition-duration: ${ms}ms !important;
        animation-duration: ${ms}ms !important;
        transition-timing-function: linear !important;
        animation-timing-function: linear !important;
      }
      .ui-effects-wrapper, .fade, [class*="fade"] {
        transition-duration: ${ms}ms !important;
        animation-duration: ${ms}ms !important;
        transition-timing-function: linear !important;
        animation-timing-function: linear !important;
      }
    `;
    let style = document.getElementById('ddo-fast-anim');
    if (!style){
      style = document.createElement('style');
      style.id = 'ddo-fast-anim';
      style.type = 'text/css';
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
    } else {
      style.textContent = css;
    }

    const $jq = window.jQuery || window.$;
    if ($jq && $jq.fx) {
      try {
        const speeds = $jq.fx.speeds || ($jq.fx.speeds = {});
        speeds._default = ms;
        speeds.fast = ms;
        speeds.slow = Math.max(ms * 2, 120);

        const forceMs = (fnName)=>{
          const orig = $jq.fn[fnName];
          if (!orig || orig.__ddoPatchedFast) return;
          $jq.fn[fnName] = function(){
            const args = Array.from(arguments);
            if (args.length === 0) {
              args.push(ms);
            } else if (typeof args[0] === 'number') {
              args[0] = Math.min(args[0], ms);
            } else if (typeof args[0] === 'string') {
              args[0] = (args[0] === 'slow') ? Math.max(ms * 2, 120) : ms;
            } else {
              args.unshift(ms);
            }
            return orig.apply(this, args);
          };
          $jq.fn[fnName].__ddoPatchedFast = true;
        };

        ['fadeOut','fadeIn','slideUp','slideDown','hide','show'].forEach(forceMs);
      } catch {/* noop */}
    }
  }

  // ------------------ READERS ------------------
  function getSizesFromTabs3(){
    const tab3 = document.getElementById('tabs-3'); if(!tab3) return new Set();
    const set = new Set();
    const rows = Array.from(tab3.querySelectorAll('table.options tr')).slice(1);
    rows.forEach(tr=>{
      const firstTd = tr.children[0];
      let raw = '';
      const cand = firstTd?.querySelector('input.product_option_small, input, select');
      if (cand) raw = cand.value || cand.textContent || '';
      else raw = firstTd?.textContent || '';
      const v = norm(raw);
      if (v) set.add(v);
    });
    return set;
  }

  function readTab2Raw() {
    const tab2 = document.getElementById('tabs-2'); if (!tab2) return [];
    return Array.from(tab2.querySelectorAll('tr[id^="sizedelete_"]'));
  }

  function readTab2(){
    return readTab2Raw().map(row=>{
      const firstControl = row.querySelector('td.control');
      const raw = firstControl ? firstControl.textContent : row.textContent || '';
      return { key: norm(raw), rowId: row.id };
    }).filter(x=>x.key);
  }

  // ------------------ PRODUCT ID GUARD ------------------
  function currentProductId(){
    const m = location.search.match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
  }
  function ensureProductIdHidden(){
    const pid = currentProductId();
    if (!pid) return;
    let inp = document.querySelector('input[name="product_id"], input[name="products_id"]');
    if (!inp){
      inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = 'product_id';
      const form = document.querySelector('#tabs-2 form, form[action*="products"]') || document.body;
      form.appendChild(inp);
    }
    inp.value = pid;
  }

  // ------------------ FAST DELETE (MICROBATCHES) ------------------
  async function fastClickDeleteForKeys(keys){
    let clicked = 0;
    const CHUNK = 10; // deletes per minibatch
    const GAP   = 40; // ms pauze tussen minibatches

    for (let i=0; i<keys.length; i+=CHUNK){
      const batch = keys.slice(i, i+CHUNK);
      for (const key of batch){
        const rows = readTab2();
        const item = rows.find(x => x.key === key);
        if (!item) continue;
        const row = document.getElementById(item.rowId);
        const del = row?.querySelector('a.ajax_row_delete') || row?.querySelector('img[src*="/img/icon/delete"], img[alt="delete"]');
        if (del){
          const clickable = del.closest?.('a.ajax_row_delete') || del;
          try { clickable.click(); clicked++; } catch {}
        }
      }
      if (i+CHUNK < keys.length) await new Promise(r=>setTimeout(r, GAP));
    }
    if (clicked) touchProgress();
    return clicked;
  }

  async function settleAfterBatch(ms){
    await new Promise(r=>setTimeout(r, ms)); // korte vaste settle (UI instelbaar)
    // snellere micro-poll: max ~180ms, interval ~60ms
    const start = Date.now();
    let lastCount = readTab2Raw().length;
    while (Date.now() - start < 180){
      await new Promise(r=>setTimeout(r, 60));
      const now = readTab2Raw().length;
      if (now === lastCount) break;
      lastCount = now;
    }
    touchProgress();
  }

  // ------------------ SAFE PASS (fallback) ------------------
  async function safePassDelete(keys){
    let deleted = 0;
    for (const key of keys){
      const rows = readTab2();
      const item = rows.find(x => x.key === key);
      if (!item){ continue; }
      const row = document.getElementById(item.rowId);
      const del = row?.querySelector('.ajax_row_delete') || row?.querySelector('img[src*="/img/icon/delete"], img[alt="delete"]');
      if (!del){ logLine(`⛔ Geen delete-link voor ${key}`); continue; }

      const waitRowGone = new Promise((resolve)=>{
        const mo = new MutationObserver(()=>{
          const still = document.getElementById(item.rowId);
          if (!still){ mo.disconnect(); resolve(); }
        });
        mo.observe(document.getElementById('tabs-2') || document.body, {childList:true,subtree:true});
        setTimeout(()=>{ mo.disconnect(); resolve(); }, 1200); // was 4000
      });

      try {
        const clickable = del.closest?.('a.ajax_row_delete') || del;
        clickable.click();
        await waitRowGone;
        deleted++;
        touchProgress();
        await new Promise(r=>setTimeout(r, 20)); // was 120
      } catch(e){
        logLine(`❌ Fout bij verwijderen ${key}: ${e.message}`);
      }
    }
    return deleted;
  }

  // ------------------ TAG REMOVAL (#tabs-7) ------------------
  function hardClick(el){
    if (!el) return false;
    try {
      const evts = ['mousedown','mouseup','click'];
      for (const type of evts){
        const evt = new MouseEvent(type, { bubbles:true, cancelable:true, view:window });
        el.dispatchEvent(evt);
      }
      return true;
    } catch { return false; }
  }

  async function removePruneTagIfPresent({dryRun}){
    await waitForTagsLoaded().catch(()=>{});

    const findRow = () => {
      const tab7 = document.getElementById('tabs-7');
      if (!tab7) return null;
      const rows = Array.from(tab7.querySelectorAll('tr[id^="tagdelete_"]'));
      for (const tr of rows){
        const td = tr.querySelector('td.control');
        const raw = (td?.textContent || '').trim();
        const normed = norm(raw);
        if (normed === PRUNE_TAG_NORM) return tr;
      }
      return null;
    };

    let row = findRow();
    if (!row){
      logLine('Tag "SYST - Prune Me" niet gevonden (of al weg).');
      return false;
    }
    if (dryRun){
      logLine('DRY-RUN: tag "SYST - Prune Me" zou verwijderd worden.');
      return false;
    }

    const MAX_TRIES = 3;
    for (let attempt=1; attempt<=MAX_TRIES; attempt++){
      const idBefore = row.id;

      let clicked = false;
      const img = row.querySelector('img[src="/img/icon/delete.png"], img[alt="delete"]');
      if (img) { clicked = hardClick(img) || img.click?.(); }

      if (!clicked) {
        const a = row.querySelector('a.ajax_row_delete');
        if (a) { clicked = hardClick(a) || a.click?.(); }
      }

      if (!clicked){
        logLine(`🏷️ Tag delete: geen klikbaar element gevonden (poging ${attempt}).`);
        await new Promise(r=>setTimeout(r, 200));
      }

      const gone = await new Promise((resolve)=>{
        const mo = new MutationObserver(()=>{
          const still = document.getElementById(idBefore);
          if (!still){ mo.disconnect(); resolve(true); }
        });
        mo.observe(document.getElementById('tabs-7') || document.body, {childList:true,subtree:true});
        setTimeout(()=>{ mo.disconnect(); resolve(false); }, 1200); // was 2500
      });

      if (gone){
        logLine('🏷️ Tag "SYST - Prune Me" verwijderd.');
        touchProgress();
        return true;
      } else {
        logLine(`🏷️ Tag delete lijkt niet verwerkt (poging ${attempt}). Opnieuw proberen…`);
        await new Promise(r=>setTimeout(r, 200));
        row = findRow();
        if (!row){
          logLine('🏷️ Tag-rij niet meer gevonden na retry → beschouwd als verwijderd.');
          touchProgress();
          return true;
        }
      }
    }

    logLine('⚠️ Tag "SYST - Prune Me" bleef staan na 3 pogingen.');
    return false;
  }

  // ------------------ INVALID PAGE DETECTION (strikt) ------------------
  function pageSaysInvalidId(){
    // Enkel true als tabs ontbreken én we een standalone foutmelding zien
    const hasTabs = document.querySelector('#tabs-2, #tabs-3, #tabs-7');
    if (hasTabs) return false;

    const containers = [
      document.querySelector('.error'),
      document.querySelector('.notice'),
      document.querySelector('#content')
    ].filter(Boolean);

    const txt = (containers.length ? containers.map(el=>el.innerText).join('\n')
                                 : document.body.innerText || '').trim();

    return /^\s*product id invalid\s*$/i.test(txt)
        || /(^|\n)\s*product id invalid\s*$/i.test(txt);
  }

  // ------------------ PRUNE ORCHESTRATOR ------------------
  async function pruneProduct({dryRun, fastMode, settleMs}){
    speedUpUIAnimations(DEFAULT_ANIM_MS);
    await waitForTabs();
    await waitForOptionsLoaded().catch(()=>{});

    ensureProductIdHidden();

    const sizes3 = getSizesFromTabs3();
    let list2 = readTab2();

    if (!list2.length){ logLine('Geen sizes in #tabs-2 → skip'); return {deleted:0, skipped:1}; }
    if (!sizes3.size){  logLine('Geen options in #tabs-3 → skip'); return {deleted:0, skipped:1}; }

    const toRemove = list2.filter(x => !sizes3.has(x.key)).map(x=>x.key);
    const shouldKeep = list2.length - toRemove.length;

    if (!toRemove.length){
      logLine('OK: alle sizes staan ook in options.');
      await removePruneTagIfPresent({dryRun});
      return {deleted:0, skipped:1};
    }

    if (dryRun){
      logLine(`DRY-RUN: zouden verwijderen = ${toRemove.length}; overhouden = ${shouldKeep}`);
      return {deleted:0, skipped:1};
    }

    let deletedTotal = 0;

    if (fastMode){
      const clicked = await fastClickDeleteForKeys(toRemove); // await microbatches
      logLine(`FAST: clicks uitgezet voor ${clicked}/${toRemove.length} maten`);
      await settleAfterBatch(settleMs);

      const after1 = readTab2();
      const remainingKeys1 = after1.filter(x => !sizes3.has(x.key)).map(x=>x.key);
      deletedTotal += (toRemove.length - remainingKeys1.length);

      if (remainingKeys1.length){
        logLine(`FAST: ${remainingKeys1.length} restanten → extra fast batch`);
        await fastClickDeleteForKeys(remainingKeys1);
        await settleAfterBatch(Math.max(200, Math.round(settleMs*0.5)));

        const after2 = readTab2();
        const remainingKeys2 = after2.filter(x => !sizes3.has(x.key)).map(x=>x.key);
        if (remainingKeys2.length){
          logLine(`SAFE: ${remainingKeys2.length} restanten → safe pass`);
          const d2 = await safePassDelete(remainingKeys2);
          deletedTotal += d2;
        }
      }
    } else {
      const d = await safePassDelete(toRemove);
      deletedTotal += d;
      await settleAfterBatch(settleMs);
    }

    // Eindcontrole + tag
    const finalList = readTab2();
    const finalMissing = finalList.filter(x => !sizes3.has(x.key)).map(x=>x.key);
    if (finalMissing.length === 0){
      logLine(`✅ Klaar: alles verwijderd. Kept=${shouldKeep}, Deleted~=${deletedTotal}`);
      await removePruneTagIfPresent({dryRun:false});
    } else {
      logLine(`⚠️ Na cleanup blijven nog ${finalMissing.length} maten over (mogelijk UI/permissions). Tag blijft staan.`);
    }

    return {deleted: deletedTotal, skipped:0};
  }

  // ------------------ NAVIGATION ------------------
  function gotoNextProduct(){
    const st = loadState();
    if(!st.active || st.paused) return;
    if(st.idx >= st.queue.length){
      st.active=false; saveState(st);
      alert(`Batch klaar!\nVerwerkt: ${st.stats.done}\nDeleted: ${st.stats.deleted}\nErrors: ${st.stats.errors}`);
      logLine('Batch afgerond ✔️');
      return;
    }
    const url = st.queue[st.idx];
    logLine(`→ Volgende (${st.idx+1}/${st.queue.length}): ${url}`);
    touchProgress();

    if (DDO_NAV_LOCK) return;
    DDO_NAV_LOCK = true;

    try { location.href = url + '#ddo=' + Date.now(); }
    catch {
      try { location.replace(url + '#ddo=' + Date.now()); } catch {}
    }
  }

  // ------------------ UI: LIST PAGE ------------------
  function injectListUI(){
    const host = document.body;
    const wrap = document.createElement('div');
    wrap.style.position='sticky';
    wrap.style.top='0';
    wrap.style.zIndex='9999';
    wrap.style.background='#fff';
    wrap.style.padding='8px';
    wrap.style.border='1px solid #ddd';
    wrap.style.margin='8px 0';
    wrap.style.fontFamily='system-ui, sans-serif';

    wrap.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <strong>DDO Batch Runner</strong>
        <button id="ddo-batch-build">Queue (oude selector)</button>
        <button id="ddo-batch-build-checked">Queue (checkboxen)</button>
        <button id="ddo-batch-build-page">Queue (hele pagina)</button>
        <button id="ddo-batch-clear">Wis queue</button>
        <label style="display:inline-flex;gap:6px;align-items:center;">
          <input type="checkbox" id="ddo-batch-dryrun" checked>
          Dry-run
        </label>
        <label style="display:inline-flex;gap:6px;align-items:center;">
          <input type="checkbox" id="ddo-batch-fast" checked>
          Fast mode
        </label>
        <label style="display:inline-flex;gap:6px;align-items:center;">
          Settle (ms)
          <input type="number" id="ddo-batch-settle" value="300" min="0" style="width:90px;">
        </label>
        <label style="display:inline-flex;gap:6px;align-items:center;">
          Delay nav (ms)
          <input type="number" id="ddo-batch-delay" value="500" min="0" style="width:90px;">
        </label>
        <label style="display:inline-flex;gap:6px;align-items:center;">
          Max errors
          <input type="number" id="ddo-batch-maxerr" value="50" min="0" style="width:70px;">
        </label>
        <button id="ddo-batch-start">Start</button>
        <button id="ddo-batch-pause">Pauze</button>
        <button id="ddo-batch-resume">Hervat</button>
        <button id="ddo-batch-stop">Stop</button>
      </div>
      <div style="margin-top:6px;display:flex;gap:8px;align-items:flex-start;">
        <textarea id="ddo-batch-paste" placeholder="Plak product-IDs of URLs (één per regel)" style="width:420px;height:80px;"></textarea>
        <div>
          <button id="ddo-batch-addpasted">Voeg geplakte items toe</button>
          <div id="ddo-batch-stats" style="font-size:12px;margin-top:6px;"></div>
        </div>
      </div>
      <pre id="ddo-batch-log" style="margin-top:6px;max-height:220px;overflow:auto;border:1px dashed #ccc;padding:6px;font-size:12px;white-space:pre-wrap;"></pre>
    `;
    host.prepend(wrap);

    const st = loadState(); if(!st.queue) resetState();
    $('#ddo-batch-dryrun').checked = st.dryRun ?? true;
    $('#ddo-batch-fast').checked   = st.fastMode ?? true;
    $('#ddo-batch-settle').value   = st.settleMs ?? 300;
    $('#ddo-batch-delay').value    = st.delayMs ?? 500;
    $('#ddo-batch-maxerr').value   = st.maxErrors ?? 50;
    $('#ddo-batch-log').textContent = (st.log||[]).join('\n');
    renderStats();

    $('#ddo-batch-build').addEventListener('click', buildQueueFromList_GenericAnchors);
    $('#ddo-batch-build-checked').addEventListener('click', buildQueueFromList_CheckedOnly);
    $('#ddo-batch-build-page').addEventListener('click', buildQueueFromList_WholePage);

    $('#ddo-batch-clear').addEventListener('click', ()=>{ resetState(); renderStats(); logLine('Queue gewist.'); });
    $('#ddo-batch-addpasted').addEventListener('click', addPastedItems);

    $('#ddo-batch-start').addEventListener('click', startBatch);
    $('#ddo-batch-pause').addEventListener('click', ()=>{ const s=loadState(); s.paused=true; saveState(s); logLine('Gepauzeerd.'); renderStats(); });
    $('#ddo-batch-resume').addEventListener('click', ()=>{ const s=loadState(); s.paused=false; saveState(s); logLine('Hervat.'); setTimeout(gotoNextProduct, 250); renderStats(); });
    $('#ddo-batch-stop').addEventListener('click', ()=>{ const s=loadState(); s.active=false; s.paused=false; saveState(s); logLine('Gestopt.'); renderStats(); });

    function renderStats(){
      const s = loadState();
      $('#ddo-batch-stats').innerHTML = `
        <div>Queue: ${s.queue?.length||0}, Index: ${s.idx||0}</div>
        <div>Done: ${s.stats?.done||0}, Deleted: ${s.stats?.deleted||0}, Skipped: ${s.stats?.skipped||0}, Errors: ${s.stats?.errors||0}</div>
        <div>Active: ${s.active?'ja':'nee'}${s.paused?' (pauze)':''}</div>
      `;
    }

    function addToQueue(urls, label){
      if(!urls.length){ alert(`Geen items gevonden voor: ${label}`); return; }
      const s = loadState();
      s.queue = Array.from(new Set([...(s.queue||[]), ...urls]));
      saveState(s);
      logLine(`${label}: +${urls.length} items`);
      renderStats();
    }

    function buildQueueFromList_GenericAnchors(){
      const links = $$('a[href*="section=products"][href*="action=edit"][href*="id="]');
      const urls = links.map(a => {
        try {
          const u = new URL(a.href, location.origin);
          const id = u.searchParams.get('id') || (u.href.match(/[?&]id=(\d+)/)?.[1] ?? '');
          return id ? (BASE_EDIT_URL + id) : null;
        } catch { return null; }
      }).filter(Boolean);
      addToQueue(urls, 'Queue (oude selector)');
    }

    function collectIdsFromCheckboxes({checkedOnly}){
      const sel = checkedOnly ? 'input[name="products[]"]:checked' : 'input[name="products[]"]';
      return $$(sel).map(inp => inp.value).filter(v => /^\d+$/.test(v));
    }

    function collectIdsFromGotoHandlers(){
      const trs = $$('tr[onmousedown*="Goto("]');
      const ids = [];
      for(const tr of trs){
        const attr = tr.getAttribute('onmousedown') || '';
        const m = attr.match(/id=(\d+)/);
        if (m && m[1]) ids.push(m[1]);
      }
      return ids;
    }

    function buildQueueFromList_CheckedOnly(){
      let ids = collectIdsFromCheckboxes({checkedOnly:true});
      if (!ids.length){
        logLine('Checkboxen: geen aangevinkte producten gevonden.');
        alert('Geen aangevinkte producten gevonden.');
        return;
      }
      const urls = ids.map(id => BASE_EDIT_URL + id);
      addToQueue(urls, 'Queue (checkboxen)');
    }

    function buildQueueFromList_WholePage(){
      let ids = collectIdsFromCheckboxes({checkedOnly:false});
      if (!ids.length){
        ids = collectIdsFromGotoHandlers();
      }
      const urls = Array.from(new Set(ids)).map(id => BASE_EDIT_URL + id);
      addToQueue(urls, 'Queue (hele pagina)');
    }

    function addPastedItems(){
      const ta = $('#ddo-batch-paste');
      const lines = ta.value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      if(!lines.length){ alert('Niets geplakt.'); return; }
      let urls = [];
      for(const ln of lines){
        try { urls.push(normalizeToUrl(ln)); }
        catch(e){ logLine('⚠️ Overgeslagen (ongeldig): '+ln+' → '+e.message); }
      }
      addToQueue(urls, 'Toegevoegd uit paste');
    }

    function startBatch(){
      const s = loadState();
      if(!s.queue?.length){ alert('Queue is leeg. Bouw of plak eerst items.'); return; }

      // Start reset index en stats
      s.idx   = 0;
      s.stats = {done:0, deleted:0, skipped:0, errors:0};

      s.active   = true;
      s.paused   = false;
      s.dryRun   = $('#ddo-batch-dryrun').checked;
      s.fastMode = $('#ddo-batch-fast').checked;
      s.settleMs = Math.max(0, parseInt($('#ddo-batch-settle').value||'300',10));
      s.delayMs  = Math.max(0, parseInt($('#ddo-batch-delay').value||'500',10));
      s.maxErrors= Math.max(0, parseInt($('#ddo-batch-maxerr').value||'50',10));
      saveState(s);

      logLine(`Start • DryRun=${s.dryRun} • Fast=${s.fastMode} • Settle=${s.settleMs}ms • NavDelay=${s.delayMs}ms`);
      setTimeout(gotoNextProduct, 200);
      renderStats();
    }
  }

  // ------------------ UI: EDIT PAGE ------------------
  function injectEditBanner(){
    const st = loadState();
    const bar = document.createElement('div');
    bar.style.position='sticky';
    bar.style.top='0';
    bar.style.zIndex='9999';
    bar.style.background= st.active ? '#f6fff6' : '#fff';
    bar.style.border = '1px solid #ddd';
    bar.style.padding='6px 8px';
    bar.style.margin='8px 0';
    bar.style.fontFamily='system-ui,sans-serif';
    bar.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <strong>DDO Batch Runner</strong>
        <span>Active: ${st.active?'ja':'nee'}${st.paused?' (pauze)':''}</span>
        <span>Idx: ${st.idx||0}/${st.queue?.length||0}</span>
        <span>Done: ${st.stats?.done||0} • Deleted: ${st.stats?.deleted||0} • Skipped: ${st.stats?.skipped||0} • Errors: ${st.stats?.errors||0}</span>
        <button id="ddo-ep-pause">Pauze</button>
        <button id="ddo-ep-resume">Hervat</button>
        <button id="ddo-ep-stop">Stop</button>
      </div>
      <pre id="ddo-batch-log" style="margin-top:6px;max-height:180px;overflow:auto;border:1px dashed #ccc;padding:6px;font-size:12px;white-space:pre-wrap;"></pre>
    `;
    document.body.prepend(bar);
    $('#ddo-batch-log').textContent = (st.log||[]).join('\n');

    $('#ddo-ep-pause').addEventListener('click', ()=>{ const s=loadState(); s.paused=true; saveState(s); logLine('Gepauzeerd.'); });
    $('#ddo-ep-resume').addEventListener('click', ()=>{ const s=loadState(); s.paused=false; saveState(s); logLine('Hervat.'); setTimeout(gotoNextProduct, 100); });
    $('#ddo-ep-stop').addEventListener('click', ()=>{ const s=loadState(); s.active=false; s.paused=false; saveState(s); logLine('Gestopt.'); });
  }

  // ------------------ EDIT PAGE AUTO-RUN ------------------
  async function maybeRunOnEditPage(){
    const st = loadState();
    injectEditBanner();
    speedUpUIAnimations(DEFAULT_ANIM_MS);

    // start product-watchdog (45s / 30s hidden)
    clearTimeout(DDO_WATCHDOG);
    DDO_WATCHDOG = setTimeout(()=>forceGotoNext('product-timeout'), document.hidden ? 30000 : 45000);
    // heartbeat elke 5s: als >20s geen progress → force next
    clearInterval(DDO_HEARTBEAT);
    DDO_HEARTBEAT = setInterval(()=>{
      const noProgressFor = Date.now() - DDO_LAST_PROGRESS_TS;
      if (noProgressFor > 20000) forceGotoNext('heartbeat-stall');
    }, 5000);
    touchProgress();

    if(!st.active || st.paused) return;

    if (pageSaysInvalidId()){
      st.stats.done = (st.stats.done||0)+1;
      st.stats.skipped = (st.stats.skipped||0)+1;
      st.idx++; saveState(st);
      logLine('⏭️ Overgeslagen: product ID invalid (pagina)');
      clearTimeout(DDO_WATCHDOG);
      return setTimeout(gotoNextProduct, st.delayMs || 500);
    }

    // Safeguard: afwijkende URL loggen (maar doorgaan)
    const current = location.href.split('#')[0];
    if(st.idx >= st.queue.length){ gotoNextProduct(); return; }
    const target = st.queue[st.idx];
    if(current.indexOf(target.split('#')[0]) === -1){
      logLine('Waarschuwing: huidige pagina wijkt af van queue-URL. Ga toch door.');
    }

    try{
      const {deleted, skipped} = await pruneProduct({
        dryRun : !!st.dryRun,
        fastMode: !!st.fastMode,
        settleMs: st.settleMs || 300
      });
      st.stats.done = (st.stats.done||0)+1;
      st.stats.deleted = (st.stats.deleted||0)+deleted;
      st.stats.skipped = (st.stats.skipped||0)+skipped;
      st.idx++;
      saveState(st);
    }catch(e){
      st.stats.errors = (st.stats.errors||0)+1;
      logLine('❌ Fout op edit page: '+e.message);
      if(st.stats.errors >= (st.maxErrors||50)){
        st.active=false; st.paused=false; saveState(st);
        alert(`Batch gestopt: max errors bereikt (${st.stats.errors}).`);
        return;
      } else {
        st.idx++; saveState(st);
      }
    }

    if(!st.active || st.paused) return;
    clearTimeout(DDO_WATCHDOG);
    setTimeout(gotoNextProduct, st.delayMs || 500);
  }

  // ------------------ AJAX MESSAGE OBSERVER (debug) ------------------
  (function observeAjaxResult(){
    const target = document.body;
    if (!target) return;
    const mo = new MutationObserver((muts)=>{
      for (const m of muts){
        const nodes = Array.from(m.addedNodes || []);
        for (const n of nodes){
          if (!(n instanceof HTMLElement)) continue;
          const msgEl = n.matches?.('.ajax_result, .notice, .error') ? n
                      : n.querySelector?.('.ajax_result, .notice, .error');
          if (msgEl){
            const txt = msgEl.innerText.trim();
            if (/product id invalid/i.test(txt)){
              logLine('⚠️ AJAX meldde: "Product ID invalid" (waarschijnlijk race/nonce).');
            }
          }
        }
      }
    });
    mo.observe(target, {childList:true, subtree:true});
  })();

  // ------------------ BOOT ------------------
  if(!loadState().queue){ resetState(); }

  const isListPage = /section=products&action=list/.test(location.search);
  const isEditPage = /section=products&action=edit/.test(location.search);

  if(isListPage){ injectListUI(); }
  if(isEditPage){ maybeRunOnEditPage(); }
})();
