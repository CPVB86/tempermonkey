// ==UserScript==
// @name         DDO | FAQ Creator
// @namespace    https://www.dutchdesignersoutlet.com/
// @version      1.4.1
// @description  Maak/Update FAQs vanuit een queue: NL/EN/DE/FR Q&A + optioneel ID (overschrijven). Werkt met tab of pipe. Leegt categorie (Select2) automatisch.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=faq*
// @grant        GM_addStyle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/faq-creator.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/faq-creator.user.js
// ==/UserScript==

(function () {
  'use strict';

  // -------------------------
  // Config & State keys
  // -------------------------
  const S = {
    UI_ID: 'ddo-faq-creator',
    LS_QUEUE: 'ddo-faq-queue',
    LS_IDX: 'ddo-faq-idx',
    LS_RUNNING: 'ddo-faq-running',
    LS_SUBMIT_GUARD: 'ddo-faq-submit-guard',   // { idx:number, ts:number }
    LS_CREATE_CARRY: 'ddo-faq-create-carry'    // { idx:number, ts:number }
  };

  // utils
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const $ = (sel,root=document)=>root.querySelector(sel);
  const now = ()=> Date.now();

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(S.LS_QUEUE) || '[]'); } catch { return []; }
  }
  function setQueue(arr) { localStorage.setItem(S.LS_QUEUE, JSON.stringify(arr||[])); }
  function getIdx() { return parseInt(localStorage.getItem(S.LS_IDX) || '0', 10) || 0; }
  function setIdx(i) { localStorage.setItem(S.LS_IDX, String(i)); }
  function isRunning() { return localStorage.getItem(S.LS_RUNNING) === '1'; }
  function setRunning(v) { localStorage.setItem(S.LS_RUNNING, v ? '1' : '0'); }

  function setSubmitGuard(idx) {
    localStorage.setItem(S.LS_SUBMIT_GUARD, JSON.stringify({ idx, ts: now() }));
  }
  function clearSubmitGuard() {
    localStorage.removeItem(S.LS_SUBMIT_GUARD);
  }
  function getSubmitGuard() {
    try { return JSON.parse(localStorage.getItem(S.LS_SUBMIT_GUARD) || 'null'); } catch { return null; }
  }

  function setCreateCarry(idx) {
    localStorage.setItem(S.LS_CREATE_CARRY, JSON.stringify({ idx, ts: now() }));
  }
  function clearCreateCarry() {
    localStorage.removeItem(S.LS_CREATE_CARRY);
  }
  function getCreateCarry() {
    try { return JSON.parse(localStorage.getItem(S.LS_CREATE_CARRY) || 'null'); } catch { return null; }
  }

  // -------------------------
  // Page detectors
  // -------------------------
  function onListPage() {
    return !!($('input[name="name"].control') && $('input[type="submit"][name="add"]'));
  }
  function onEditPage() {
    return !!($('input[name="question"]') && $('input[type="submit"][name="edit"]'));
  }

  // -------------------------
  // DOM helpers
  // -------------------------
  function fire(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch {}
  }
  function fillInput(el, val) {
    if (!el) return false;
    if (el.value !== val) {
      el.value = val;
      fire(el,'input'); fire(el,'change');
      return true;
    }
    return false;
  }
  function getIframeForTextarea(ta) {
    if (!ta) return null;
    if (ta.id && document.getElementById(ta.id + '_ifr')) return document.getElementById(ta.id + '_ifr');
    let p = ta.parentElement;
    for (let i=0; i<5 && p; i++) {
      const ifr = p.querySelector('iframe[id$="_ifr"], .mceIframeContainer iframe');
      if (ifr) return ifr;
      p = p.parentElement;
    }
    return null;
  }
  function setIframeBodyHtml(ifr, html) {
    if (!ifr) return false;
    const doc = ifr.contentDocument || ifr.contentWindow?.document;
    const body = doc && doc.body;
    if (!body) return false;
    if (body.innerHTML !== html) {
      body.innerHTML = html;
      fire(body,'input'); fire(body,'change');
    }
    return true;
  }
  async function fillEditorByTextareaSelector(textareaSelector, html) {
    const ta = document.querySelector(textareaSelector);
    if (!ta) return false;
    let changed = false;

    // TinyMCE API
    try {
      const tm = window.tinymce || window.tinyMCE;
      const ed = (ta.id && tm && typeof tm.get === 'function') ? tm.get(ta.id) : null;
      if (ed) {
        try { ed.setContent(html); changed = true; } catch {}
        try { const b = ed.getBody && ed.getBody(); if (b) { b.innerHTML = html; changed = true; } } catch {}
        try { const el = ed.getElement && ed.getElement(); if (el && el.value !== html) { el.value = html; changed = true; } } catch {}
        try { if (typeof ed.save === 'function') ed.save(); } catch {}
        try { if (typeof ed.fire === 'function') ed.fire('change'); } catch {}
      }
    } catch {}

    // Direct iframe fallback
    try {
      const ifr = getIframeForTextarea(ta);
      if (setIframeBodyHtml(ifr, html)) changed = true;
    } catch {}

    // Underlying textarea
    if (ta.value !== html) { ta.value = html; changed = true; }
    fire(ta,'input'); fire(ta,'change');

    // Global triggersave
    try {
      const tm = window.tinymce || window.tinyMCE;
      if (tm && typeof tm.triggerSave === 'function') tm.triggerSave();
    } catch {}

    return changed;
  }

  // Leeg de Select2-categorie
  function clearCategorySelect() {
    const sel = document.querySelector('select[name="category_id"]');
    if (sel) {
      const hasEmpty = [...sel.options].some(o => o.value === '' || o.value === '0');
      sel.value = hasEmpty ? ([...sel.options].find(o => o.value === '') ? '' : '0') : '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Select2 API
    try {
      const jq = window.jQuery || window.$;
      if (jq && sel && jq(sel).data('select2')) {
        jq(sel).val(null).trigger('change');
      }
    } catch {}
    // Fallback: rendered spans legen
    const spSpecific = document.getElementById('select2-category_id-gn-container');
    if (spSpecific) {
      spSpecific.textContent = '';
      spSpecific.removeAttribute('title');
    }
    document.querySelectorAll('[id^="select2-category_id-"][id$="-container"]').forEach(sp => {
      sp.textContent = '';
      sp.removeAttribute('title');
    });
  }

  // -------------------------
  // Nav helper: edit by ID
  // -------------------------
  function gotoEditById(id) {
    if (!id) return false;
    const base = location.origin + location.pathname;
    const url1 = `${base}?section=faq&action=edit&id=${encodeURIComponent(id)}`;
    if (!onEditPage()) {
      location.href = url1;
      return true;
    }
    return true;
  }

  // -------------------------
  // Parser  (tab of pipe per regel)
  // -------------------------
  function parseLines(src) {
    const lines = (src || '')
      .split(/\r?\n/)
      .map(s => s.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    const parsed = lines.map(line => {
      const partsRaw = line.includes('\t') ? line.split('\t') : line.split('|');
      const parts = partsRaw.map(s => (s || '').trim());
      if (parts.length < 8) return null;

      const [q_nl, a_nl, q_en, a_en, q_de, a_de, q_fr, a_fr] = parts;
      let faq_id = 0;
      if (parts[8] && /^\d+$/.test(parts[8])) faq_id = parseInt(parts[8], 10);

      return { q_nl, a_nl, q_en, a_en, q_de, a_de, q_fr, a_fr, faq_id };
    }).filter(Boolean);

    return parsed;
  }

  // -------------------------
  // UI
  // -------------------------
  const css = `
#${S.UI_ID}{position:fixed;right:16px;bottom:16px;z-index:9999999;width:560px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
#${S.UI_ID} .card{background:#0f172a;color:#e5e7eb;border:1px solid #334155;border-radius:14px;box-shadow:0 12px 24px rgba(0,0,0,.25);overflow:hidden}
#${S.UI_ID} header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#111827}
#${S.UI_ID} h3{margin:0;font-size:16px;font-weight:800;letter-spacing:.3px}
#${S.UI_ID} .row{display:flex;gap:8px;margin:10px 12px;flex-wrap:wrap}
#${S.UI_ID} textarea{width:100%;min-height:160px;background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:8px}
#${S.UI_ID} button{cursor:pointer;border:1px solid #374151;background:#1f2937;color:#e5e7eb;border-radius:10px;padding:8px 10px;font-size:12px}
#${S.UI_ID} button:hover{background:#374151}
#${S.UI_ID} .chip{background:#1f2937;border:1px solid #374151;border-radius:999px;padding:4px 8px;font-size:11px}
#${S.UI_ID} .muted{opacity:.85;font-size:12px}
  `;
  if (typeof GM_addStyle === 'function') GM_addStyle(css);
  else { const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s); }

  if (!document.getElementById(S.UI_ID)) {
    const wrap = document.createElement('div');
    wrap.id = S.UI_ID;
    wrap.innerHTML = `
      <div class="card">
        <header>
          <h3>Auto FAQ Creator</h3>
          <div>
            <button id="ddo-faq-start">Start</button>
            <button id="ddo-faq-stop">Stop</button>
          </div>
        </header>
        <div class="row">
          <div class="muted">
            Formaat per regel: <code>Vraag NL | Antwoord NL | Vraag EN | Antwoord EN | Vraag DE | Antwoord DE | Vraag FR | Antwoord FR | [ID]</code><br>
            Je mag ook TAB gebruiken in plaats van pipes. Laatste veld (optioneel) is het <b>FAQ-ID</b> om te overschrijven.
          </div>
          <textarea id="ddo-faq-src" placeholder="Één item per regel"></textarea>
        </div>
        <div class="row">
          <button id="ddo-faq-queue">Queue bijwerken</button>
          <span class="chip" id="ddo-faq-stat">wachtend…</span>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const stat = $('#ddo-faq-stat');
    const src = $('#ddo-faq-src');
    const btnQ = $('#ddo-faq-queue');
    const btnStart = $('#ddo-faq-start');
    const btnStop = $('#ddo-faq-stop');

    function renderStat() {
      const q = getQueue();
      const idx = getIdx();
      const left = Math.max(0, q.length - idx);
      stat.textContent = `${left} open • idx ${idx}/${q.length} • ${isRunning()?'RUNNING':'PAUSED'}`;
    }

    btnQ.addEventListener('click', () => {
      const parsed = parseLines(src.value);
      setQueue(parsed);
      setIdx(0);
      clearSubmitGuard();
      clearCreateCarry();
      renderStat();
    });

    btnStart.addEventListener('click', () => {
      if (getQueue().length === 0) {
        const parsed = parseLines(src.value);
        setQueue(parsed);
        setIdx(0);
      }
      setRunning(true);
      renderStat();
      processPage().catch(console.error);
    });

    btnStop.addEventListener('click', () => {
      setRunning(false);
      renderStat();
    });

    renderStat();
  }

  // -------------------------
  // Core processing
  // -------------------------
  async function processPage() {
    if (!isRunning()) return;

    // guards auto-clear
    const guard = getSubmitGuard();
    if (guard && now() - guard.ts > 20000) clearSubmitGuard();

    const carry = getCreateCarry();
    if (carry && now() - carry.ts > 30000) clearCreateCarry();

    const queue = getQueue();
    let idx = getIdx();
    if (idx >= queue.length) {
      setRunning(false);
      clearSubmitGuard();
      clearCreateCarry();
      return;
    }

    const item = queue[idx];
    const { q_nl, a_nl, q_en, a_en, q_de, a_de, q_fr, a_fr, faq_id } = item;

    // 1) Als ID is opgegeven → ga (of blijf) naar edit
    if (faq_id) {
      if (!onEditPage()) {
        gotoEditById(faq_id);
        return; // navigatie
      }
    }

    // 2) Nieuw item aanmaken op lijstpagina (GEEN idx++ hier!)
    if (!faq_id && onListPage()) {
      const nameInput = $('input[name="name"].control');
      const addBtn = $('input[name="add"][type="submit"]');
      if (!nameInput || !addBtn) return;

      // Vul name = vraag NL
      fillInput(nameInput, q_nl || '');
      await sleep(150);

      // categorie leegmaken
      clearCategorySelect();

      // Markeer dat het huidige idx-item op de volgende editpagina gevuld moet worden
      setCreateCarry(idx);
      setSubmitGuard(idx);
      addBtn.click();
      return;
    }

    // 3) Editpagina: bepaal of dit een "create-carry" is (nieuw) of een gewone edit
    const useCreateCarry = !!(getCreateCarry() && getCreateCarry().idx === idx && onEditPage());

    if (onEditPage()) {
      // "name" veld (vereist) gelijk aan Vraag NL
      const nameInput = $('input[name="name"]');
      fillInput(nameInput, q_nl || '');

      // NL
      fillInput($('input[name="question"]'), q_nl || '');
      await fillEditorByTextareaSelector('textarea[name="answer"]', a_nl || '');

      // EN
      fillInput($('input[name="lang[en][question]"]'), q_en || q_nl || '');
      await fillEditorByTextareaSelector('textarea[name="lang[en][answer]"]', a_en || '');

      // DE
      fillInput($('input[name="lang[de][question]"]'), q_de || q_nl || '');
      await fillEditorByTextareaSelector('textarea[name="lang[de][answer]"]', a_de || '');

      // FR
      fillInput($('input[name="lang[fr][question]"]'), q_fr || q_nl || '');
      await fillEditorByTextareaSelector('textarea[name="lang[fr][answer]"]', a_fr || '');

      // categorie leegmaken vóór submit
      clearCategorySelect();

      await sleep(150);

      const updBtn = $('input[type="submit"][name="edit"]');
      if (updBtn) {
        setSubmitGuard(idx);
        updBtn.click();
        // direct idx++ om loops te voorkomen; guard wordt opgeschoond bij load
        setIdx(idx + 1);
        if (useCreateCarry) clearCreateCarry();
        return;
      }
    }

    // 4) Veiligheidsnet: als geen actie mogelijk was, skip item
    setIdx(idx + 1);
    await sleep(200);
    if (isRunning()) processPage();
  }

  // Herstart bij pageload als running
  if (isRunning()) {
    setTimeout(() => {
      const guard = getSubmitGuard();
      const currentIdx = getIdx();
      if (guard && guard.idx < currentIdx) clearSubmitGuard();
      processPage().catch(console.error);
    }, 250);
  }
})();
