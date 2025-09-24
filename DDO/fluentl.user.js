// ==UserScript==
// @name         DDO | FluentL
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.5.0
// @description  Vertaal NL naar EN/DE/FR
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=categories&action=edit*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=brands&action=edit*
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const CONFIG = {
    MODEL: 'gpt-4o-mini',
    TAB_NL: '#tabs-1',
    TAB_ML: '#tabs-2',
    TAB_SEO: '#tabs-3',
    UI_ID: 'ddo-i18n-pro',
    OPENER_ID: 'ddo-opener',
    LS_KEY: 'ddo-openai-key',
    LS_LANGS: 'ddo-fluentl-langs',
    MAX_CHARS: 120000,
    MAXI_VIEW_DEFAULT: true // true = paneel zichtbaar; false = geminimaliseerd starten
  };

  // assets
  const FLAG_URL = {
    de: 'https://www.dutchdesignersoutlet.com/ddo/img/de.png',
    en: 'https://www.dutchdesignersoutlet.com/ddo/img/gb.png',
    fr: 'https://www.dutchdesignersoutlet.com/ddo/img/fr.png',
  };

  // taalstate (vlaggen)
  let LANG_STATE = (() => {
    try { return JSON.parse(localStorage.getItem(CONFIG.LS_LANGS) || '{}'); } catch { return {}; }
  })();
  if (typeof LANG_STATE.de !== 'boolean') LANG_STATE.de = true;
  if (typeof LANG_STATE.en !== 'boolean') LANG_STATE.en = true;
  if (typeof LANG_STATE.fr !== 'boolean') LANG_STATE.fr = true;

  const allLangs = ['de','en','fr'];
  const activeLangs = () => allLangs.filter(l => LANG_STATE[l]);
  const saveLangState = () => localStorage.setItem(CONFIG.LS_LANGS, JSON.stringify(LANG_STATE));

  // runtime setting (niet bewaren)
  let keywordsEnabled = false;

  // NL-bronvelden (#tabs-1)
  const NL_FIELDS = {
    name:    '[name="name"]',
    title:   '[name="title"]',
    content: 'textarea[name="content"], textarea.htmleditor, [name="content"]',
    promo:   'textarea[name="promo_content"], [name="promo_content"]'
  };
  // Doelvelden (#tabs-2)
  const ML_FIELDS = (lang) => ({
    name:    `[name="lang[${lang}][name]"]`,
    title:   `[name="lang[${lang}][title]"]`,
    content: `[name="lang[${lang}][content]"]`,
    promo:   `[name="lang[${lang}][promo_content]"]`,
  });
  // SEO-velden (#tabs-3)
  const SEO_FIELDS = (lang) => ({
    page_title:       `[name="meta[${lang}][page_title]"]`,
    header_title:     `[name="meta[${lang}][header_title]"]`,
    meta_description: `[name="meta[${lang}][description]"]`,
    meta_keywords:    `[name="meta[${lang}][keywords]"]`,
    footer_content:   `[name="meta[${lang}][footer_content]"]`,
  });

  // ---------- STYLES + ASSETS ----------
  // FA + Orbitron
  const linkFA = document.createElement('link');
  linkFA.rel = 'stylesheet';
  linkFA.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
  document.head.appendChild(linkFA);

  const linkOrbitron = document.createElement('link');
  linkOrbitron.rel = 'stylesheet';
  linkOrbitron.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&display=swap';
  document.head.appendChild(linkOrbitron);

  const css = `
  #${CONFIG.UI_ID}{position:fixed;right:16px;bottom:16px;z-index:999999;width:460px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  #${CONFIG.UI_ID} .card{background:#0f172a;color:#e5e7eb;border:1px solid #334155;border-radius:14px;box-shadow:0 12px 24px rgba(0,0,0,.25);overflow:hidden}
  #${CONFIG.UI_ID} header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#111827}
  #${CONFIG.UI_ID} h3{margin:0;font-size:16px;font-weight:800;font-family:'Orbitron',system-ui;letter-spacing:.5px;display:flex;align-items:center;gap:10px}
  #${CONFIG.UI_ID} .flags{display:flex;align-items:center;gap:8px;margin-left:8px}
  #${CONFIG.UI_ID} .flag{height:16px;width:auto;border-radius:4px;padding:2px;background:transparent;cursor:pointer;transition:filter .2s ease,opacity .2s ease,transform .05s}
  #${CONFIG.UI_ID} .flag:hover{transform:translateY(-1px)}
  #${CONFIG.UI_ID} .flag.off{filter:grayscale(100%);opacity:.45}
  #${CONFIG.UI_ID} .row{display:flex;gap:8px;margin:10px 12px;flex-wrap:wrap}
  #${CONFIG.UI_ID} button{cursor:pointer;border:1px solid #374151;background:#1f2937;color:#e5e7eb;border-radius:10px;padding:8px 10px;font-size:12px}
  #${CONFIG.UI_ID} button:hover{background:#374151}
  #${CONFIG.UI_ID} .iconbtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px}
  #${CONFIG.UI_ID} .chip{background:#1f2937;border:1px solid #374151;border-radius:999px;padding:4px 8px;font-size:11px}
  #${CONFIG.UI_ID} .checks{display:flex;gap:12px;align-items:center}
  #${CONFIG.UI_ID} label{font-size:12px;display:flex;align-items:center;gap:6px}

  #${CONFIG.UI_ID} .tools{display:flex;gap:6px}
  #${CONFIG.UI_ID} .settings{position:absolute;right:10px;top:50px;background:#0b1220;border:1px solid #334155;border-radius:12px;box-shadow:0 8px 18px rgba(0,0,0,.3);padding:12px;min-width:280px;display:none}
  #${CONFIG.UI_ID} .settings h4{margin:0 0 8px 0;font-size:13px;color:#9ca3af}
  #${CONFIG.UI_ID} .settings .formrow{display:flex;align-items:center;gap:6px;margin:8px 0}
  #${CONFIG.UI_ID} .settings input[type="password"],
  #${CONFIG.UI_ID} .settings input[type="text"]{flex:1 1 auto;background:#111827;border:1px solid #374151;border-radius:8px;color:#e5e7eb;padding:6px 8px;font-size:12px}
  #${CONFIG.UI_ID} .settings .btns{display:flex;gap:8px;margin-top:8px}

  #${CONFIG.OPENER_ID}{
    position:fixed;right:16px;bottom:16px;z-index:1000001;background:#0f172a;color:#e5e7eb;border:1px solid #334155;
    border-radius:999px;padding:10px 12px;font-size:14px;box-shadow:0 8px 18px rgba(0,0,0,.25);cursor:pointer;display:none
  }
  #${CONFIG.OPENER_ID} i{font-size:16px;line-height:1}
  `;
  if (typeof GM_addStyle === 'function') GM_addStyle(css);
  else { const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s); }

  // ---------- UTILS ----------
  const $ = (sel,root=document)=>root.querySelector(sel);
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  function sanitizeKey(s){ return (s||'').trim().replace(/[^\x20-\x7E]/g,'').replace(/\s+/g,''); }

  async function ensureTabVisible(tabSel){
    const tab = $(tabSel);
    if (tab && tab.offsetParent !== null) return;
    const href = `a[href="${tabSel}"], [data-target="${tabSel}"], [data-bs-target="${tabSel}"]`;
    const a = document.querySelector(href);
    if (a) { a.click(); await sleep(350); }
  }

  function readField(el){
    if (!el) return '';
    if (el.tagName==='TEXTAREA' || el.tagName==='INPUT') return el.value;
    if (el.getAttribute && el.getAttribute('contenteditable')==='true') return el.innerHTML;
    return el.textContent;
  }

  function getNLValues(){
    const root = $(CONFIG.TAB_NL) || document;
    return {
      name:    readField($(NL_FIELDS.name, root)),
      title:   readField($(NL_FIELDS.title, root)),
      content: readField($(NL_FIELDS.content, root)),
      promo:   readField($(NL_FIELDS.promo, root)),
    };
  }
  function getNLSeoValues(){
    const root = $(CONFIG.TAB_SEO) || document;
    const S = SEO_FIELDS('nl');
    return {
      page_title:       readField($(S.page_title, root)),
      header_title:     readField($(S.header_title, root)),
      meta_description: readField($(S.meta_description, root)),
      meta_keywords:    readField($(S.meta_keywords, root)),
      footer_content:   readField($(S.footer_content, root)),
    };
  }

  function pickTarget(lang, key){
    const root = $(CONFIG.TAB_ML) || document;
    return $(ML_FIELDS(lang)[key], root);
  }
  function pickSeoTarget(lang, key){
    const root = $(CONFIG.TAB_SEO) || document;
    return $(SEO_FIELDS(lang)[key], root);
  }

// --- REPLACE: getTextareaIframe + setIntoEditor ---

function getTextareaIframe(textarea) {
  if (!textarea) return null;

  // Alleen rich editors (TinyMCE) mogen een iframe krijgen
  const isRich =
    textarea.classList?.contains('htmleditor') ||
    (!!textarea.id && /mce|tinymce/i.test(textarea.id));

  // Directe koppeling: <textarea id="mce_9"> ↔ <iframe id="mce_9_ifr">
  if (textarea.id) {
    const direct = document.getElementById(textarea.id + '_ifr');
    if (direct) return direct;
  }

  // Geen rich? Dan nooit naar een nabij iframe zoeken.
  if (!isRich) return null;

  // Voor rich editors: beperkt zoeken binnen dichtsbijzijnde editor wrapper
  let c = textarea.parentElement;
  for (let i = 0; i < 4 && c; i++) {
    const iframe = c.querySelector('.mceIframeContainer iframe, iframe[id$="_ifr"]');
    if (iframe) return iframe;
    c = c.parentElement;
  }
  return null;
}

function setIframeHtml(iframe, html) {
  try {
    if (!iframe) return false;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return false;
    const body = doc.body;
    if (!body) return false;

    if (body.innerHTML !== html) {
      body.innerHTML = html;
      // Laat events bubbelen zodat eventuele listeners/tracking meedoen
      body.dispatchEvent(new Event('input',  { bubbles: true }));
      body.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  } catch (e) {
    console.warn('setIframeHtml() failed:', e);
    return false;
  }
}

function setIntoEditor(el, html) {
  if (!el) return false;
  let changed = false;

  if (el.tagName === 'TEXTAREA') {
    // Alleen iframe-pad als dit écht een rich editor is
    const isRich =
      el.classList?.contains('htmleditor') ||
      (!!el.id && /mce|tinymce/i.test(el.id)) ||
      !!document.getElementById((el.id || '') + '_ifr');

    if (isRich) {
      const iframe = getTextareaIframe(el);
      if (iframe) {
        const ok = setIframeHtml(iframe, html);
        if (ok) {
          changed = true;
          if (el.value !== html) {
            el.value = html;
            try {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
          }
          if (window.tinymce && typeof tinymce.triggerSave === 'function') tinymce.triggerSave();
          return changed;
        }
      }
    }

    // Plain textarea: direct value zetten, géén iframe
    if (el.value !== html) { el.value = html; changed = true; }
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
    return changed;
  }

  if (el.tagName === 'INPUT') {
    if (el.value !== html) { el.value = html; changed = true; }
  } else if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
    if (el.innerHTML !== html) { el.innerHTML = html; changed = true; }
  } else {
    const inner = el.querySelector && el.querySelector('textarea, [contenteditable="true"], input');
    if (inner) return setIntoEditor(inner, html);
    if (el.textContent !== html) { el.textContent = html; changed = true; }
  }

  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {}
  return changed;
}

  async function waitForSeoEditors(langArr, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let allReady = true;
      for (const lang of langArr) {
        const taFooter = document.querySelector(SEO_FIELDS(lang).footer_content);
        if (taFooter) {
          const iframe = getTextareaIframe(taFooter);
          if (!iframe) { allReady = false; break; }
        }
      }
      if (allReady) return true;
      await sleep(150);
    }
    return false;
  }

  // ---------- CACHING ----------
  function djb2(str){ let h=5381; for (let i=0;i<str.length;i++) h=((h<<5)+h)+str.charCodeAt(i); return (h>>>0).toString(36); }
  function cacheKey(obj){ return 'ddo-i18n-cache-' + djb2(JSON.stringify(obj)); }
  function getCache(obj){
    try { const raw = localStorage.getItem(cacheKey(obj)); if (!raw) return null;
      const {ts,data} = JSON.parse(raw); if (Date.now()-ts>7*24*3600e3) return null; return data;
    } catch { return null; }
  }
  function setCache(obj,data){ localStorage.setItem(cacheKey(obj), JSON.stringify({ts:Date.now(), data})); }

  // ---------- HTTP ----------
  function postJson(url, headers, body){
    return new Promise((resolve,reject)=>{
      if (typeof GM_xmlhttpRequest==='function'){
        GM_xmlhttpRequest({
          method:'POST', url, headers, data: JSON.stringify(body),
          onload: (resp)=>{
            if (resp.status>=200 && resp.status<300) {
              try { resolve(JSON.parse(resp.responseText)); }
              catch(e){ reject(new Error('Kon JSON niet parsen: '+e.message)); }
            } else reject(new Error('HTTP '+resp.status+': '+resp.responseText));
          },
          onerror:(e)=> reject(new Error('Netwerkfout (GM): '+(e.error||'unknown')))
        });
      } else {
        fetch(url,{method:'POST', headers, body: JSON.stringify(body)})
          .then(async r=>{ const t=await r.text(); if(!r.ok) throw new Error('HTTP '+r.status+': '+t); resolve(JSON.parse(t)); })
          .catch(reject);
      }
    });
  }

  // ---------- OPENAI ----------
  function normalizeLangKey(k=''){
    const s = k.toLowerCase();
    if (['en','gb','uk','english'].includes(s)) return 'en';
    if (['de','ger','german','du'].includes(s)) return 'de';
    if (['fr','fra','french'].includes(s)) return 'fr';
    return s;
  }

  async function translateBatch(opts) {
    const {
      doName, doTitle, doContent, doPromo,
      doSeoPage, doSeoHeader, doSeoDesc, /* doSeoKeys via keywordsEnabled */ doSeoFooter
    } = opts;

    const targets = activeLangs();
    const nl = getNLValues();
    const nlSeo = getNLSeoValues();

    const payload = {
      name:    doName    ? (nl.name||'')    : '',
      title:   doTitle   ? (nl.title||'')   : '',
      content: doContent ? (nl.content||'') : '',
      promo:   doPromo   ? (nl.promo||'')   : '',
      page_title:       doSeoPage  ? (nlSeo.page_title||'')       : '',
      header_title:     doSeoHeader? (nlSeo.header_title||'')     : '',
      meta_description: doSeoDesc  ? (nlSeo.meta_description||'') : '',
      meta_keywords:    keywordsEnabled ? (nlSeo.meta_keywords||'') : '',
      footer_content:   doSeoFooter? (nlSeo.footer_content||'')   : ''
    };

    const compact = {};
    Object.keys(payload).forEach(k=>{
      compact[k] = (payload[k]||'').replace(/\s+/g,' ').trim();
    });

    const totalChars = Object.values(compact).reduce((a,b)=>a+(b?b.length:0),0);
    if (!totalChars) throw new Error('Geen broninhoud geselecteerd.');
    if (totalChars > CONFIG.MAX_CHARS) throw new Error('Inhoud te groot — splits even op.');

    const cacheProbe = { model: CONFIG.MODEL, targets: targets.join(','), compact };
    const cached = getCache(cacheProbe);
    if (cached) return cached;

    const apiKey = (localStorage.getItem(CONFIG.LS_KEY)||'').trim();
    if (!apiKey) throw new Error('Geen API key gevonden. Klik op het tandwiel om je OpenAI key in te voeren.');

    const system = [
      'You are a professional ecommerce translator for lingerie & fashion.',
      'Translate Dutch (nl) to the requested target languages (EN/DE/FR).',
      'Preserve HTML structure and only translate visible text.',
      'Keep brand/product names and sizes as in source.',
      'Return JSON keyed by language code (en,de,fr).',
      'Each language object may contain: name, title, content, promo, page_title, header_title, meta_description, meta_keywords, footer_content.',
      'For meta_keywords, return a comma-separated plain list.'
    ].join(' ');

    const user = [
      'Source language: nl',
      `Targets: ${targets.join(', ') || '(none)'}`,
      'Fields JSON:',
      JSON.stringify(compact)
    ].join('\n');

    const body = {
      model: CONFIG.MODEL,
      text: { format: { type: 'json_object' } },
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user + '\n\nReturn ONLY the requested targets as keys.' }
      ]
    };

    const data = await postJson('https://api.openai.com/v1/responses',
      { 'Authorization':'Bearer '+apiKey, 'Content-Type':'application/json' },
      body
    );

    function extractOutputText(resp) {
      if (!resp || typeof resp !== 'object') return '';
      if (resp.output_text && typeof resp.output_text === 'string') return resp.output_text;
      const out = resp.output;
      if (Array.isArray(out) && out[0]?.content?.[0]?.text) return out[0].content[0].text;
      if (Array.isArray(resp.content) && resp.content[0]?.text) return resp.content[0].text;
      return '';
    }

    const text = extractOutputText(data);
    if (!text) throw new Error('Lege model-output.');

    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
    let obj = JSON.parse(clean);

    // normaliseer sleutels (en,de,fr)
    const norm = {};
    for (const k of Object.keys(obj||{})) {
      const nk = normalizeLangKey(k);
      norm[nk] = obj[k];
    }
    return norm;
  }

  // ---------- UI ----------
  if ($(CONFIG.UI_ID) || $(CONFIG.OPENER_ID)) return;

  // opener (max)
  const opener = document.createElement('button');
  opener.id = CONFIG.OPENER_ID;
  opener.title = 'Open FluentL';
  opener.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>';
  opener.addEventListener('click', ()=> setMinimized(false));
  document.body.appendChild(opener);

  // paneel
  const wrap = document.createElement('div');
  wrap.id = CONFIG.UI_ID;
  wrap.innerHTML = `
    <div class="card">
      <header>
        <h3>
          FluentL
          <span class="flags" id="fluentl-flags"></span>
        </h3>
        <div class="tools">
          <button id="ddo-gear" class="iconbtn" title="Instellingen"><i class="fa-solid fa-gear"></i></button>
          <button id="ddo-minimize" class="iconbtn" title="Minimaliseer"><i class="fa-solid fa-down-left-and-up-right-to-center"></i></button>
        </div>
      </header>

      <div class="settings" id="ddo-settings">
        <h4>Instellingen</h4>
        <div class="formrow">
          <label style="min-width:64px">API key</label>
          <input type="password" id="inp-apikey" placeholder="OpenAI API key">
          <button id="btn-savekey">Opslaan</button>
        </div>
        <div class="formrow">
          <label><input type="checkbox" id="opt-keys"> Meta keywords meenemen</label>
        </div>
        <div class="btns">
          <button id="btn-nlcheck">NL Check</button>
          <button id="btn-close-settings">Sluiten</button>
        </div>
      </div>

      <div id="ddo-body">
        <div class="row checks">
          <label><input type="checkbox" id="chk-name" checked> Name</label>
          <label><input type="checkbox" id="chk-title" checked> Title</label>
          <label><input type="checkbox" id="chk-content" checked> Content</label>
          <label><input type="checkbox" id="chk-promo" checked> Promo</label>
        </div>

        <div class="row checks">
          <label><input type="checkbox" id="chk-seo-page" checked> Page title</label>
          <label><input type="checkbox" id="chk-seo-header" checked> Header title</label>
          <label><input type="checkbox" id="chk-seo-desc" checked> Meta description</label>
          <!-- meta keywords weggehaald uit hoofd-UI -->
          <label><input type="checkbox" id="chk-seo-footer" checked> Footer content</label>
        </div>

        <div class="row">
          <button id="ddo-translate">Vertaal & Vul</button>
        </div>

        <div class="row" id="ddo-stats"><span class="chip">Ready</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const setStat = (msg)=> ($('#ddo-stats').innerHTML = `<span class="chip">${msg}</span>`);

  // Flags render
  function renderFlags(){
    const host = $('#fluentl-flags');
    if (!host) return;
    host.innerHTML = '';
    for (const lang of allLangs) {
      const img = document.createElement('img');
      img.src = FLAG_URL[lang];
      img.alt = lang.toUpperCase();
      img.className = 'flag' + (LANG_STATE[lang] ? '' : ' off');
      img.dataset.lang = lang;
      img.title = `Toggle ${lang.toUpperCase()}`;
      img.addEventListener('click', ()=>{
        LANG_STATE[lang] = !LANG_STATE[lang];
        saveLangState();
        renderFlags();
      });
      host.appendChild(img);
    }
  }
  renderFlags();

  // Minimizer / Maximizer
  function setMinimized(min) {
    const wrapEl = $('#'+CONFIG.UI_ID);
    const op = $('#'+CONFIG.OPENER_ID);
    if (!wrapEl || !op) return;
    if (min) { wrapEl.style.display = 'none'; op.style.display = 'inline-block'; }
    else     { wrapEl.style.display = 'block'; op.style.display = 'none'; }
  }
  setMinimized(!CONFIG.MAXI_VIEW_DEFAULT);

  // Settings toggle
  const settings = $('#ddo-settings');
  function toggleSettings(show=null){
    const willShow = (show===null)? (settings.style.display!=='block') : show;
    settings.style.display = willShow ? 'block' : 'none';
  }

  // Listeners topbar
  $('#ddo-minimize').addEventListener('click', ()=> setMinimized(true));
  $('#ddo-gear').addEventListener('click', ()=> toggleSettings());

  // Settings listeners
  $('#btn-close-settings').addEventListener('click', ()=> toggleSettings(false));
  $('#btn-savekey').addEventListener('click', ()=>{
    const v = sanitizeKey($('#inp-apikey').value);
    if (v) {
      localStorage.setItem(CONFIG.LS_KEY, v);
      setStat('API key opgeslagen');
      $('#inp-apikey').value = '';
    } else {
      setStat('Lege key — niets opgeslagen');
    }
  });
  $('#opt-keys').addEventListener('change', (e)=> { keywordsEnabled = !!e.target.checked; });
  $('#btn-nlcheck').addEventListener('click', ()=>{
    const v = getNLValues();
    const s = getNLSeoValues();
    const act = activeLangs().map(x=>x.toUpperCase()).join('/');
    const report = [
      `Actief: ${act || '—'}`,
      `#tabs-1 → Name:${(v.name||'').length} | Title:${(v.title||'').length} | Content:${(v.content||'').length} | Promo:${(v.promo||'').length}`,
      `#tabs-3 → Page:${(s.page_title||'').length} | Header:${(s.header_title||'').length} | Desc:${(s.meta_description||'').length} | Keys:${(s.meta_keywords||'').length} | Footer:${(s.footer_content||'').length}`
    ];
    setStat(report.join(' — '));
  });

  // Translate button
  $('#ddo-translate').addEventListener('click', async ()=>{
    try{
      const langs = activeLangs();
      if (!langs.length) { setStat('Geen talen actief (vlaggen).'); return; }

      const doName    = $('#chk-name').checked;
      const doTitle   = $('#chk-title').checked;
      const doContent = $('#chk-content').checked;
      const doPromo   = $('#chk-promo').checked;

      const doSeoPage   = $('#chk-seo-page').checked;
      const doSeoHeader = $('#chk-seo-header').checked;
      const doSeoDesc   = $('#chk-seo-desc').checked;
      const doSeoFooter = $('#chk-seo-footer').checked;

      const base = getNLValues();
      const seo  = getNLSeoValues();
      const totalChars =
        (doName?(base.name||'').length:0) +
        (doTitle?(base.title||'').length:0) +
        (doContent?(base.content||'').length:0) +
        (doPromo?(base.promo||'').length:0) +
        (doSeoPage?(seo.page_title||'').length:0) +
        (doSeoHeader?(seo.header_title||'').length:0) +
        (doSeoDesc?(seo.meta_description||'').length:0) +
        (keywordsEnabled?(seo.meta_keywords||'').length:0) +
        (doSeoFooter?(seo.footer_content||'').length:0);

      if (!totalChars) { setStat('Geen broninhoud (NL) geselecteerd.'); return; }
      if (totalChars > CONFIG.MAX_CHARS) { setStat('Inhoud te groot — splits even op.'); return; }

      setStat('Vertalen…');
      const out = await translateBatch({
        doName, doTitle, doContent, doPromo,
        doSeoPage, doSeoHeader, doSeoDesc, doSeoFooter
      });

      // Vul #tabs-2
      await ensureTabVisible(CONFIG.TAB_ML);
      let filled = 0;
      const touched = [];

      for (const lang of langs) {
        const pack = out[lang] || {};

        if (doName && pack.name) {
          const el = pickTarget(lang,'name');
          if (setIntoEditor(el, pack.name)) { filled++; touched.push(`${lang}:name`); }
        }
        if (doTitle && pack.title) {
          const elT = pickTarget(lang,'title');
          if (setIntoEditor(elT, pack.title)) { filled++; touched.push(`${lang}:title`); }
        }
        if (doContent && pack.content) {
          const elC = pickTarget(lang,'content');
          if (setIntoEditor(elC, pack.content)) { filled++; touched.push(`${lang}:content`); }
        }
        if (doPromo && pack.promo) {
          const elP = pickTarget(lang,'promo');
          if (setIntoEditor(elP, pack.promo)) { filled++; touched.push(`${lang}:promo`); }
        }
      }

      // Vul #tabs-3 (SEO)
      await ensureTabVisible(CONFIG.TAB_SEO);
      await waitForSeoEditors(langs);

      for (const lang of langs) {
        const pack = out[lang] || {};

        if (doSeoPage && pack.page_title) {
          const el = pickSeoTarget(lang,'page_title');
          if (setIntoEditor(el, pack.page_title)) { filled++; touched.push(`${lang}:seo_page_title`); }
        }
        if (doSeoHeader && pack.header_title) {
          const el = pickSeoTarget(lang,'header_title');
          if (setIntoEditor(el, pack.header_title)) { filled++; touched.push(`${lang}:seo_header_title`); }
        }
        if (doSeoDesc && pack.meta_description) {
          const el = pickSeoTarget(lang,'meta_description');
          if (setIntoEditor(el, pack.meta_description)) { filled++; touched.push(`${lang}:seo_meta_description`); }
        }
        if (keywordsEnabled && pack.meta_keywords) {
          const el = pickSeoTarget(lang,'meta_keywords');
          if (setIntoEditor(el, pack.meta_keywords)) { filled++; touched.push(`${lang}:seo_meta_keywords`); }
        }
        if (doSeoFooter && pack.footer_content) {
          const el = pickSeoTarget(lang,'footer_content');
          if (setIntoEditor(el, pack.footer_content)) { filled++; touched.push(`${lang}:seo_footer_content`); }
        }
      }

      if (window.tinymce && typeof tinymce.triggerSave === 'function') tinymce.triggerSave();

      if (console && console.table) console.table(touched.map(x=>({changed:x})));
      setStat(`Klaar: ${filled} veld(en) gevuld • Actief: ${langs.map(x=>x.toUpperCase()).join('/')}`);
    } catch(e){
      console.error(e);
      setStat('Fout: '+(e.message||e));
    }
  });

})();
