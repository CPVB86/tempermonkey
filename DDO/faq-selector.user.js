// ==UserScript==
// @name         DDO | FAQ Selector
// @namespace    ddo-tools
// @version      1.8.1
// @description  Filter FAQ’s via tags uit Google Sheets (CSV). Antwoorden compact rechts (2 regels met ellipsis), bredere rechterkolom, live sync met admin-checkboxen, selecteer-alle-gefilterde-FAQ’s, per-categorie tag-herstel. (Zonder shift-select.)
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=categories&action=edit&id=*
// @run-at       document-idle
// @grant        GM_addStyle
// @connect      docs.google.com
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/faq-selector.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/faq-selector.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ========= CONFIG =========
  const CONFIG = {
    SHEET_ID: '1w08R2OJtSyI_lFq7dsiQnLksC7rwz8qJXuBAsE05ehs',
    GID: '1095907208',
    COLS: { id: 'id', question: 'question_nl', answer: 'answer_nl', tags: 'tags' },
    TAG_SPLIT_RE: /\s*,\s*/,
    ui: {
      titleInput: 'input[name="meta[nl][header_title]"]',
      toggleBtn: '.faq__header.controlbutton',
      dropdown: '.faq__dropdown',
      item: '.faq__item',
      itemTitle: 'p',
      itemCheckbox: 'input[type="checkbox"]',
    },
    tagStateKey: 'ddoFaqTagState.v3',
    logKey: 'ddoFaqLog.v2.tags',
    logTrimKeepLast: 10000,
  };

  // ========= STYLES =========
  GM_addStyle(`
    #ddo-faq {
      position: fixed !important;
      right: 65px !important;
      bottom: 16px !important;
      z-index: 2147483646 !important;
      background: #0f172a !important;
      color: #e5e7eb !important;
      border: 1px solid #334155 !important;
      border-radius: 999px !important;
      padding: 0 !important;
      width: 42px !important; height: 39px !important;
      font-size: 16px !important;
      box-shadow: 0 8px 18px rgba(0,0,0,.25) !important;
      cursor: pointer !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      line-height: 1 !important; user-select: none !important; pointer-events: auto !important;
    }
    #ddo-faq span { font-weight: 700; }

    #ddo-faq-tag-overlay { position: fixed; inset: 0; z-index: 2147483647 !important; background: #0b1220cc; display: none; }
    #ddo-faq-panel {
      position: absolute; inset: 24px; background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:14px;
      box-shadow: 0 16px 48px rgba(0,0,0,.25); display:flex; flex-direction:column; gap:10px;
      font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;
    }
    .ddo-btn { border:1px solid #ddd; background:#fafafa; border-radius:8px; padding:8px 10px; cursor:pointer; }
    .ddo-btn:disabled { opacity:.6; cursor:not-allowed; }

    #tag-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    #tag-chips { display:flex; gap:6px; flex-wrap:wrap; max-height:160px; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px; }
    .ddo-chip { display:flex; gap:6px; align-items:center; border:1px solid #ddd; border-radius:999px; padding:4px 8px; background:#fafafa; cursor:pointer; user-select:none; }
    .ddo-chip input { pointer-events:auto; }

    #faq-summary { margin-top:2px; color:#333 }
    #faq-list { flex:1 1 auto; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px; }

    /* rechterkolom 60px breder dan voorheen: 420px -> 480px */
    .faq-row {
      display:grid;
      grid-template-columns: 1fr minmax(480px, 60%);
      align-items:center;
      column-gap:12px;
      padding:4px 0;
      border-bottom:1px dashed #eee;
    }
    .faq-left { display:flex; gap:8px; align-items:flex-start; min-width:0; }
    .faq-title { font-weight:600; word-break:break-word; }
    .faq-meta { font-size:12px; color:#666; }
    .faq-right { min-width:0; display:flex; align-items:center; gap:8px; }
    .faq-answer {
      font-size:12px; color:#444;
      overflow:hidden; text-overflow:ellipsis; white-space:normal;
      display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; /* 2 regels met ellipsis */
      flex: 1 1 auto;
    }
    .faq-score { font-size:12px; color:#666; flex-shrink:0; width:44px; text-align:right }
  `);

  // ========= HELPERS =========
  const norm = s => (s||'').toString().toLowerCase().normalize('NFKD')
    .replace(/[’'`´]/g,'').replace(/\s+/g,' ').trim();

  const canonTag = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g,'');
  const canonTags = arr => { const set=new Set(); (arr||[]).forEach(t=>{const c=canonTag(t); if(c) set.add(c)}); return [...set]; };
  const byId = id => document.getElementById(id);

  function getCatId(){ const m=location.search.match(/[?&]id=(\d+)/); return m?m[1]:''; }
  function getCatTitle(){
    let el = document.querySelector(CONFIG.ui.titleInput);
    if (el) return (el.value || el.getAttribute('value') || '').trim();
    el = document.querySelector('input[name$="[header_title]"]');
    if (el) return (el.value || el.getAttribute('value') || '').trim();
    const h = document.querySelector('input[name="title"], input[name$="[title]"]');
    return h ? (h.value || h.getAttribute('value') || '').trim() : '';
  }
  function getCatSlug(){
    const candidates = [...document.querySelectorAll('input.control[readonly], input[readonly]')];
    for (const el of candidates){ const v=(el.value||'').trim(); if (/^\/[A-Za-z0-9/_\-]+$/.test(v)) return v; }
    return '';
  }

  function ensureFaqOpen(){
    const dd = document.querySelector(CONFIG.ui.dropdown);
    if (!dd) return;
    const active = dd.classList.contains('faq__dropdown--active') || dd.style.display!=='none';
    if (!active) document.querySelector(CONFIG.ui.toggleBtn)?.click();
  }
  function collectFaqDom(){
    return [...document.querySelectorAll(CONFIG.ui.item)].map(it=>{
      const cb=it.querySelector(CONFIG.ui.itemCheckbox);
      const p =it.querySelector(CONFIG.ui.itemTitle);
      const label=(p?.textContent||'').trim();
      const id=cb?.value || cb?.name || label;
      return {node:it, cb, label, id};
    }).filter(x=>x.cb);
  }

  // ========= GOOGLE SHEETS: CSV ONLY =========
  async function fetchSheetCSV(sheetId, gid){
    const url=`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const res = await fetch(url, { credentials:'omit' });
    if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
    return res.text();
  }
  function parseCsvToRows(csvText){
    const rows=[]; let row=[], val='', inQ=false;
    const push=()=>{ row.push(val); val=''; };
    for (let i=0;i<csvText.length;i++){
      const ch=csvText[i], nxt=csvText[i+1];
      if (inQ){
        if (ch === '"' && nxt === '"'){ val+='"'; i++; }
        else if (ch === '"'){ inQ=false; }
        else { val += ch; }
      } else {
        if (ch === '"'){ inQ=true; }
        else if (ch === ','){ push(); }
        else if (ch === '\n'){ push(); rows.push(row); row=[]; }
        else if (ch === '\r'){ /* skip */ }
        else { val += ch; }
      }
    }
    if (val.length || row.length){ push(); rows.push(row); }
    const header = rows.shift().map(norm);
    return { cols: header, rows };
  }
  function rowsToFaqTagModel(cols, rows){
    const idx = {
      id: cols.findIndex(c => c === norm(CONFIG.COLS.id)),
      q:  cols.findIndex(c => c === norm(CONFIG.COLS.question)),
      a:  cols.findIndex(c => c === norm(CONFIG.COLS.answer)),
      t:  cols.findIndex(c => c === norm(CONFIG.COLS.tags)),
    };
    if (idx.id<0 || idx.q<0 || idx.a<0 || idx.t<0)
      throw new Error(`Kolommen niet gevonden. Verwacht: ${Object.values(CONFIG.COLS).join(', ')}`);
    const faqList=[], allTags=new Set();
    rows.forEach(r=>{
      const id  = String(r[idx.id] ?? '').trim();
      const q   = String(r[idx.q] ?? '').trim();
      const a   = String(r[idx.a] ?? '').trim();
      const raw = String(r[idx.t] ?? '');
      const tags = canonTags(String(raw).split(CONFIG.TAG_SPLIT_RE).filter(Boolean));
      tags.forEach(t=>allTags.add(t));
      if (id && q) faqList.push({ id, label:q, answer:a, tags });
    });
    return { faqList, tagOptions: [...allTags].sort() };
  }

  // ========= STATE =========
  const state = {
    domFaqs: [],
    sheetFaqs: [],
    tagOptions: [],
    picks: [],
    activeTags: []
  };

  // ========= LOG =========
  function loadLog(){ try { return JSON.parse(localStorage.getItem(CONFIG.logKey)||'[]'); } catch{ return []; } }
  function saveLog(arr){ if (CONFIG.logTrimKeepLast && arr.length>CONFIG.logTrimKeepLast) arr=arr.slice(-CONFIG.logTrimKeepLast); localStorage.setItem(CONFIG.logKey, JSON.stringify(arr)); }

  // ========= PER-CAT TAG STATE =========
  function loadTagState(){ try { return JSON.parse(localStorage.getItem(CONFIG.tagStateKey)||'{}'); } catch { return {}; } }
  function saveTagState(map){ localStorage.setItem(CONFIG.tagStateKey, JSON.stringify(map)); }
  function getCatTagState(catId){ const m=loadTagState(); return m[catId] || { tags:[] }; }
  function setCatTagState(catId, data){ const m=loadTagState(); m[catId]=data; saveTagState(m); }

  // ========= FILTER (OR) =========
  function filterByTags(){
    const activeCanon = new Set(state.activeTags);
    if (!activeCanon.size) return [];
    const byId = new Map(state.sheetFaqs.map(f=>[String(f.id), f]));
    const byLabel = new Map(state.sheetFaqs.map(f=>[norm(f.label), f]));

    const out = [];
    for (const d of state.domFaqs){
      let sh = byId.get(String(d.id));
      if (!sh) sh = byLabel.get(norm(d.label));
      if (!sh || !sh.tags?.length) continue;

      const shSet = new Set(sh.tags);
      const any = [...activeCanon].some(t => shSet.has(t));
      if (!any) continue;

      const cover = [...activeCanon].filter(t=>shSet.has(t)).length;
      const extra = [...shSet].filter(t=>!activeCanon.has(t)).length;
      const score = 0.8*(cover/Math.max(1,activeCanon.size)) + 0.2*(1/(1+extra));

      out.push({ faq:{ id:d.id, label:d.label, answer: sh.answer||'', tags:[...shSet] }, score });
    }
    out.sort((a,b)=> b.score - a.score || a.faq.label.localeCompare(b.faq.label));
    return out;
  }

  // ========= UI =========
  function makeOverlay(){
    let overlay = byId('ddo-faq-tag-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id='ddo-faq-tag-overlay';
      overlay.innerHTML=`
        <div id="ddo-faq-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <strong style="font-size:16px">FAQ Tag Selector</strong>
            <button id="faq-close" type="button" class="ddo-btn" title="Sluiten">✕</button>
          </div>
          <div id="faq-cat" style="color:#333;margin-top:-2px;"></div>
          <div>
            <div id="tag-toolbar">
              <span style="color:#333">Tags (klik om te filteren):</span>
              <button id="tags-select-all" type="button" class="ddo-btn" title="Selecteer alle tags">Selecteer alle tags</button>
              <button id="tags-clear" type="button" class="ddo-btn" title="Deselecteer alle tags">Deselecteer alle tags</button>
            </div>
            <div id="tag-chips"></div>
          </div>
          <div id="faq-summary">—</div>
          <div id="faq-list"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="faq-select-all" type="button" class="ddo-btn">Selecteer alle FAQ’s</button>
            <button id="faq-clear" type="button" class="ddo-btn">Deselecteer alle FAQ’s</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      byId('faq-close').onclick = () => toggleOverlay(false);
      byId('faq-clear').onclick = () => clearSelection(state.domFaqs);
      byId('faq-select-all').onclick = onSelectAllFaqs;

      byId('tags-select-all').onclick = () => {
        state.activeTags = [...state.tagOptions];
        setCatTagState(getCatId(), { tags: [...state.activeTags] });
        renderChips(); onFilter();
      };
      byId('tags-clear').onclick = () => {
        state.activeTags = [];
        setCatTagState(getCatId(), { tags: [] });
        renderChips(); onFilter();
      };

      const catTitle=getCatTitle(), catId=getCatId(), slug=getCatSlug();
      byId('faq-cat').textContent = `Categorie: ${catTitle || '—'} (ID ${catId || '—'})${slug ? ' – ' + slug : ''}`;

      renderChips();
    }
    return overlay;
  }

  function makeOpener(){
    let btn = byId('ddo-faq');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'ddo-faq';
      btn.title = 'FAQ Tag Selector';
      btn.type = 'button';
      btn.innerHTML = `<span>?</span>`;
      document.body.appendChild(btn);
      btn.addEventListener('click', () => toggleOverlay());
    }
    return btn;
  }

  function toggleOverlay(force){
    const ov = makeOverlay();
    const willOpen = (typeof force === 'boolean') ? force : (ov.style.display === 'none' || ov.style.display === '');
    ov.style.display = willOpen ? 'block' : 'none';
  }

  // ====== TAG CHIPS ======
  function renderChips(){
    const host = byId('tag-chips'); if (!host) return;
    host.innerHTML='';

    const active = new Set(state.activeTags);
    const ordered = state.tagOptions;

    ordered.forEach((tagCanon)=>{
      const chip=document.createElement('label');
      chip.className='ddo-chip';
      chip.innerHTML=`<input type="checkbox" ${active.has(tagCanon)?'checked':''}/> <span>${tagCanon}</span>`;
      const input = chip.querySelector('input');

      input.addEventListener('change', ()=>{
        const next = new Set(state.activeTags);
        if (input.checked) next.add(tagCanon);
        else next.delete(tagCanon);
        state.activeTags = [...next];
        setCatTagState(getCatId(), { tags: [...state.activeTags] });
        onFilter();
      });

      chip.addEventListener('click', (e)=>{
        if (e.target !== input){
          input.checked = !input.checked;
          input.dispatchEvent(new Event('change', { bubbles:true }));
        }
      });

      host.appendChild(chip);
    });
  }

  // ====== FAQ LIST ======
  function renderList(picks){
    const list = byId('faq-list'); const sum  = byId('faq-summary'); if (!list || !sum) return;
    list.innerHTML='';
    picks.forEach(p=>{
      const id=String(p.faq.id);
      const row=document.createElement('div');
      row.className='faq-row'; row.dataset.id=id;
      row.innerHTML=`
        <div class="faq-left">
          <input class="faq-include" type="checkbox" ${isAdminChecked(id)?'checked':''} style="margin-top:3px;transform:scale(1.05);cursor:pointer"/>
          <div style="min-width:0">
            <div class="faq-title">${p.faq.label}</div>
            <div class="faq-meta">ID: ${p.faq.id} • Tags: ${(p.faq.tags||[]).join(', ')}</div>
          </div>
        </div>
        <div class="faq-right">
          <div class="faq-answer" title="${escAttr(p.faq.answer||'')}">${escHtml(oneLine(p.faq.answer||''))}</div>
          <div class="faq-score">${(p.score*100).toFixed(0)}%</div>
        </div>`;
      list.appendChild(row);
    });
    sum.textContent = `Voorstellen: ${picks.length} • ✅: ${countAdminSelected()}`;
    list.querySelectorAll('.faq-include').forEach(chk=>{
      chk.onchange=(e)=>{
        const id=e.currentTarget.closest('[data-id]').dataset.id;
        if (e.currentTarget.checked) { applyToAdmin(id, true); logApply(id, true); }
        else { applyToAdmin(id, false); logApply(id, false); }
        byId('faq-summary').textContent = `Voorstellen: ${state.picks.length} • ✅: ${countAdminSelected()}`;
      };
    });
  }

  function escHtml(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
  function escAttr(s){ return escHtml(s).replace(/'/g,'&#39;'); }
  function oneLine(s){ return String(s).replace(/\s+/g,' ').trim(); }

  // ====== ADMIN CHECKBOXEN ======
  function isAdminChecked(id){
    const f = state.domFaqs.find(x=>String(x.id)===String(id));
    return !!(f && f.cb && f.cb.checked);
  }
  function countAdminSelected(){ return state.domFaqs.reduce((acc,f)=> acc + (f.cb?.checked?1:0), 0); }
  function applyToAdmin(id, checked){
    const f = state.domFaqs.find(x=>String(x.id)===String(id));
    if (!f || !f.cb) return;
    if (f.cb.checked !== checked){
      f.cb.checked = checked;
      f.cb.dispatchEvent(new Event('change', { bubbles:true }));
    }
  }
  function clearSelection(all){
    all.forEach(f => {
      if (f.cb.checked){ f.cb.checked=false; f.cb.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    byId('faq-list')?.querySelectorAll('.faq-include').forEach(c => c.checked = false);
    byId('faq-summary').textContent = `Voorstellen: ${state.picks.length} • ✅: 0`;
  }
  function onSelectAllFaqs(){
    if (!state.picks?.length) return;
    for (const p of state.picks){
      const id = String(p.faq.id);
      if (!isAdminChecked(id)){
        applyToAdmin(id, true);
        const row = byId('faq-list')?.querySelector(`.faq-row[data-id="${CSS.escape(id)}"] .faq-include`);
        if (row) row.checked = true;
        logApply(id, true);
      }
    }
    byId('faq-summary').textContent = `Voorstellen: ${state.picks.length} • ✅: ${countAdminSelected()}`;
  }

  // ====== LOGGING ======
  function logApply(id, on){
    const ts=new Date().toISOString();
    const catId=getCatId(), catTitle=getCatTitle(), pageUrl=location.href;
    const p = state.picks.find(x=>String(x.faq.id)===String(id));
    const entry = { ts, catId, catTitle, tags:[...state.activeTags], faqId:String(id), faqLabel:p?.faq?.label || '', action:on?'apply':'remove', pageUrl };
    const log=loadLog(); log.push(entry); saveLog(log);
  }

  // ====== MAIN ======
  async function main(){
    makeOpener(); ensureFaqOpen();
    state.domFaqs = collectFaqDom();
    if (!state.domFaqs.length) return;

    let cols, rows;
    try{
      const csv = await fetchSheetCSV(CONFIG.SHEET_ID, CONFIG.GID);
      const parsed = parseCsvToRows(csv); cols = parsed.cols; rows = parsed.rows;
    }catch(e){ console.error('[DDO] Sheet ophalen/parsen mislukt:', e); alert('Kon Google Sheet (CSV) niet ophalen.'); return; }

    try{
      const { faqList, tagOptions } = rowsToFaqTagModel(cols, rows);
      state.sheetFaqs = faqList; state.tagOptions = tagOptions;
    }catch(e){ console.error('[DDO] Sheet mapping error:', e); alert(e.message); return; }

    // Herstel tags per categorie
    const saved = getCatTagState(getCatId());
    state.activeTags = Array.isArray(saved.tags) ? canonTags(saved.tags) : [];

    makeOverlay(); renderChips(); onFilter();

    console.log('[DDO] Tag Selector klaar.', {
      domFaqs: state.domFaqs.length, sheetFaqs: state.sheetFaqs.length, tags: state.tagOptions.length, restoredTags: state.activeTags
    });
  }

  function onFilter(){ state.picks = filterByTags(); renderList(state.picks); }

  if (document.readyState !== 'loading') setTimeout(main, 100);
  else document.addEventListener('DOMContentLoaded', ()=> setTimeout(main,100));

})();
