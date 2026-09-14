// ==UserScript==
// @name         DDO Toolbox | Adapter | FAQ Selector
// @namespace    https://dutchdesignersoutlet.nl/
// @version      3.0.0
// @description  Zelfstandige FAQ-selectie, lokale relevantieanalyse, AI-selectie en automatische tags.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @connect      api.openai.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-faq-selector.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-faq-selector.user.js
// @run-at       document-end
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
    tagStateKey: 'ddoFaqTagState.v4',
    logKey: 'ddoFaqLog.v2.tags',
    apiKeyStorageKey: 'ddoFaqOpenAiApiKey.v1',
    logTrimKeepLast: 10000,
    ai: {
      model: 'gpt-5.4-mini',
      endpoint: 'https://api.openai.com/v1/responses',
      maxCandidates: 180,
      maxPageChars: 9000,
      maxAnswerChars: 650,
      maxSelect: 12,
      minConfidence: 0.62
    },
    autoTag: {
      maxTags: 8,
      minScore: 0.18,
      profileBoost: 1.35,
      tagNameBoost: 0.35
    },
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

    #ddo-faq-tag-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647 !important;
      background: #0b1220cc;
      display: none;
    }
    #ddo-faq-panel {
      position: absolute;
      inset: 24px;
      background:#fff;
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:14px;
      box-shadow: 0 16px 48px rgba(0,0,0,.25);
      display:flex;
      flex-direction:column;
      gap:10px;
      font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;
    }

    .ddo-btn {
      border:1px solid #ddd;
      background:#fafafa;
      border-radius:8px;
      padding:8px 10px;
      cursor:pointer;
    }
    .ddo-btn:disabled {
      opacity:.6;
      cursor:not-allowed;
    }

    #tag-toolbar {
      display:flex;
      gap:8px;
      align-items:center;
      flex-wrap:wrap;
    }
    #tag-chips {
      display:flex;
      gap:6px;
      flex-wrap:wrap;
      max-height:160px;
      overflow:auto;
      border:1px solid #eee;
      border-radius:8px;
      padding:8px;
    }
    .ddo-chip {
      display:flex;
      gap:6px;
      align-items:center;
      border:1px solid #ddd;
      border-radius:999px;
      padding:4px 8px;
      background:#fafafa;
      cursor:pointer;
      user-select:none;
    }
    .ddo-chip.is-auto {
      border-color:#2563eb;
      background:#eff6ff;
      color:#1e3a8a;
    }
    .ddo-chip input {
      pointer-events:auto;
    }

    #faq-auto-status {
      color:#334155;
      font-size:12px;
    }
    #faq-ai-status {
      color:#334155;
      font-size:12px;
      min-height:18px;
    }

    #faq-searchbar {
      display:flex;
      gap:8px;
      align-items:center;
      flex-wrap:wrap;
    }
    #faq-search {
      width: 320px;
      max-width: 100%;
      border:1px solid #ddd;
      border-radius:8px;
      padding:8px 10px;
      font:inherit;
    }

    #faq-summary {
      margin-top:2px;
      color:#333;
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
    }
    .faq-summary-link {
      cursor:pointer;
      text-decoration:underline;
      text-underline-offset:2px;
      color:#0f172a;
      font-weight:600;
    }
    .faq-summary-link:hover {
      opacity:.8;
    }
    .faq-summary-link.is-active {
      color:#2563eb;
    }
    .faq-summary-link.is-active.selected {
      color:#059669;
    }
    .faq-summary-muted {
      color:#666;
      font-size:12px;
    }

    #faq-list {
      flex:1 1 auto;
      overflow:auto;
      border:1px solid #eee;
      border-radius:8px;
      padding:8px;
    }

    .faq-row {
      display:grid;
      grid-template-columns: 1fr minmax(480px, 60%);
      align-items:center;
      column-gap:12px;
      padding:4px 0;
      border-bottom:1px dashed #eee;
    }
    .faq-left {
      display:flex;
      gap:8px;
      align-items:flex-start;
      min-width:0;
    }
    .faq-title {
      font-weight:600;
      word-break:break-word;
    }
    .faq-meta {
      font-size:12px;
      color:#666;
    }
    .faq-right {
      min-width:0;
      display:flex;
      align-items:center;
      gap:8px;
    }
    .faq-answer {
      font-size:12px;
      color:#444;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:normal;
      display:-webkit-box;
      -webkit-box-orient:vertical;
      -webkit-line-clamp:2;
      flex: 1 1 auto;
    }
    .faq-score {
      font-size:12px;
      color:#666;
      flex-shrink:0;
      width:44px;
      text-align:right;
    }
  `);

  // ========= HELPERS =========
  const norm = s => (s || '').toString().toLowerCase().normalize('NFKD')
    .replace(/[’'`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const canonTag = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const canonTags = arr => {
    const set = new Set();
    (arr || []).forEach(t => {
      const c = canonTag(t);
      if (c) set.add(c);
    });
    return [...set];
  };
  const byId = id => document.getElementById(id);

  function getCatId() {
    const m = location.search.match(/[?&]id=(\d+)/);
    return m ? m[1] : '';
  }

  function getCatTitle() {
    let el = document.querySelector(CONFIG.ui.titleInput);
    if (el) return (el.value || el.getAttribute('value') || '').trim();
    el = document.querySelector('input[name$="[header_title]"]');
    if (el) return (el.value || el.getAttribute('value') || '').trim();
    const h = document.querySelector('input[name="title"], input[name$="[title]"]');
    return h ? (h.value || h.getAttribute('value') || '').trim() : '';
  }

  function getCatSlug() {
    const candidates = [...document.querySelectorAll('input.control[readonly], input[readonly]')];
    for (const el of candidates) {
      const v = (el.value || '').trim();
      if (/^\/[A-Za-z0-9/_\\-]+$/.test(v)) return v;
    }
    return '';
  }

  function ensureFaqOpen() {
    const dd = document.querySelector(CONFIG.ui.dropdown);
    if (!dd) return;
    const active = dd.classList.contains('faq__dropdown--active') || dd.style.display !== 'none';
    if (!active) document.querySelector(CONFIG.ui.toggleBtn)?.click();
  }

  function collectFaqDom() {
    return [...document.querySelectorAll(CONFIG.ui.item)].map(it => {
      const cb = it.querySelector(CONFIG.ui.itemCheckbox);
      const p = it.querySelector(CONFIG.ui.itemTitle);
      const label = (p?.textContent || '').trim();
      const id = cb?.value || cb?.name || label;
      return { node: it, cb, label, id };
    }).filter(x => x.cb);
  }

  // ========= GOOGLE SHEETS: CSV ONLY =========
  async function fetchSheetCSV(sheetId, gid) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
    return res.text();
  }

  function parseCsvToRows(csvText) {
    const rows = [];
    let row = [], val = '', inQ = false;
    const push = () => { row.push(val); val = ''; };

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i], nxt = csvText[i + 1];
      if (inQ) {
        if (ch === '"' && nxt === '"') { val += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { val += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { push(); }
        else if (ch === '\n') { push(); rows.push(row); row = []; }
        else if (ch === '\r') { /* skip */ }
        else { val += ch; }
      }
    }

    if (val.length || row.length) {
      push();
      rows.push(row);
    }

    const header = rows.shift().map(norm);
    return { cols: header, rows };
  }

  function rowsToFaqTagModel(cols, rows) {
    const idx = {
      id: cols.findIndex(c => c === norm(CONFIG.COLS.id)),
      q: cols.findIndex(c => c === norm(CONFIG.COLS.question)),
      a: cols.findIndex(c => c === norm(CONFIG.COLS.answer)),
      t: cols.findIndex(c => c === norm(CONFIG.COLS.tags)),
    };

    if (idx.id < 0 || idx.q < 0 || idx.a < 0 || idx.t < 0) {
      throw new Error(`Kolommen niet gevonden. Verwacht: ${Object.values(CONFIG.COLS).join(', ')}`);
    }

    const faqList = [];
    const allTags = new Set();

    rows.forEach(r => {
      const id = String(r[idx.id] ?? '').trim();
      const q = String(r[idx.q] ?? '').trim();
      const a = String(r[idx.a] ?? '').trim();
      const raw = String(r[idx.t] ?? '');

      // zoekfunctie: zoeken in sheet kolom A en B
      const searchA = String(r[0] ?? '').trim();
      const searchB = String(r[1] ?? '').trim();
      const searchText = norm(`${searchA} ${searchB}`);

      const tags = canonTags(String(raw).split(CONFIG.TAG_SPLIT_RE).filter(Boolean));
      tags.forEach(t => allTags.add(t));

      if (id && q) {
        faqList.push({
          id,
          label: q,
          answer: a,
          tags,
          searchA,
          searchB,
          searchText
        });
      }
    });

    return { faqList, tagOptions: [...allTags].sort() };
  }

  // ========= STATE =========
  const state = {
    domFaqs: [],
    sheetFaqs: [],
    tagOptions: [],
    picks: [],
    activeTags: [],
    autoTagScores: new Map(),
    searchTerm: '',
    viewMode: 'default' // default | selected-in-picks | selected-all
  };

  // ========= SEMANTIC TAG ANALYSIS =========
  const STOP_WORDS = new Set([
    'aan', 'als', 'bij', 'dat', 'de', 'den', 'der', 'deze', 'die', 'dit', 'door', 'een',
    'en', 'er', 'het', 'hoe', 'ik', 'in', 'is', 'je', 'jij', 'kan', 'kun', 'met', 'mijn',
    'naar', 'niet', 'nog', 'om', 'op', 'over', 'te', 'tot', 'u', 'uw', 'van', 'voor',
    'waar', 'wat', 'welke', 'word', 'worden', 'ze', 'zijn'
  ]);

  const CONCEPT_ALIASES = {
    bezorgen: ['bezorging', 'levering', 'leveren', 'verzending', 'verzenden', 'shipping', 'delivery', 'pakket', 'postnl', 'dhl'],
    retourneren: ['retour', 'retours', 'terugsturen', 'terugzenden', 'omruilen', 'ruilen', 'refund', 'terugbetaling'],
    betalen: ['betaling', 'betalen', 'factuur', 'ideal', 'klarna', 'paypal', 'bancontact', 'creditcard'],
    maat: ['maat', 'maten', 'pasvorm', 'fit', 'valt', 'maattabel', 'maatadvies', 'size', 'sizing'],
    kleur: ['kleur', 'kleuren', 'zwart', 'wit', 'blauw', 'groen', 'rood', 'beige', 'bruin', 'grijs', 'roze', 'paars'],
    materiaal: ['materiaal', 'stof', 'leer', 'suede', 'katoen', 'wol', 'polyester', 'linnen', 'denim', 'canvas'],
    voorraad: ['voorraad', 'beschikbaar', 'uitverkocht', 'stock', 'leverbaar'],
    garantie: ['garantie', 'klacht', 'defect', 'beschadigd', 'reparatie', 'service'],
    onderhoud: ['onderhoud', 'wassen', 'wasadvies', 'reinigen', 'schoonmaken', 'care'],
    cadeau: ['cadeau', 'giftcard', 'voucher', 'waardebon'],
    winkel: ['winkel', 'showroom', 'afhalen', 'pickup', 'openingstijden'],
    sale: ['sale', 'korting', 'actie', 'outlet', 'aanbieding']
  };

  const ALIAS_TO_CONCEPT = (() => {
    const out = new Map();
    Object.entries(CONCEPT_ALIASES).forEach(([concept, aliases]) => {
      out.set(concept, concept);
      aliases.forEach(a => out.set(norm(a), concept));
    });
    return out;
  })();

  function stemToken(token) {
    return token
      .replace(/(heden|ering|ingen|lijke|lijk|jes|tje|en|s)$/i, '')
      .replace(/(.)\1{2,}/g, '$1$1');
  }

  function conceptTerms(text) {
    const tokens = norm(text)
      .replace(/[_/-]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(t => t && t.length > 2 && !STOP_WORDS.has(t));

    const out = [];
    tokens.forEach(t => {
      const stem = stemToken(t);
      out.push(ALIAS_TO_CONCEPT.get(t) || ALIAS_TO_CONCEPT.get(stem) || stem);
    });

    Object.entries(CONCEPT_ALIASES).forEach(([concept, aliases]) => {
      if (aliases.some(a => norm(text).includes(norm(a)))) out.push(concept);
    });

    return out;
  }

  function vectorFromText(text, weight = 1) {
    const vec = new Map();
    conceptTerms(text).forEach(term => {
      vec.set(term, (vec.get(term) || 0) + weight);
    });
    return vec;
  }

  function addVector(into, from, weight = 1) {
    from.forEach((value, key) => into.set(key, (into.get(key) || 0) + value * weight));
    return into;
  }

  function cosine(a, b) {
    let dot = 0, aa = 0, bb = 0;
    a.forEach((value, key) => {
      aa += value * value;
      dot += value * (b.get(key) || 0);
    });
    b.forEach(value => { bb += value * value; });
    if (!aa || !bb) return 0;
    return dot / Math.sqrt(aa * bb);
  }

  function getCategoryContextText() {
    const values = [
      getCatTitle(),
      getCatSlug(),
      document.querySelector('input[name$="[meta_description]"]')?.value || '',
      document.querySelector('textarea[name$="[meta_description]"]')?.value || '',
      document.querySelector('textarea[name$="[description]"]')?.value || '',
      [...document.querySelectorAll('h1,h2,.breadcrumb,a[href*="section=categories"]')]
        .map(el => el.textContent || '')
        .join(' ')
    ];

    return values.join(' ').replace(/\s+/g, ' ').trim();
  }

  function buildTagProfiles() {
    const profiles = new Map();

    state.sheetFaqs.forEach(faq => {
      const faqText = `${faq.label || ''} ${faq.answer || ''} ${faq.searchA || ''} ${faq.searchB || ''}`;
      const faqVec = vectorFromText(faqText, 1);
      (faq.tags || []).forEach(tag => {
        if (!profiles.has(tag)) profiles.set(tag, new Map());
        addVector(profiles.get(tag), faqVec, 1);
        addVector(profiles.get(tag), vectorFromText(tag, 0.65), 1);
      });
    });

    return profiles;
  }

  function analyseRelevantTags() {
    const contextText = getCategoryContextText();
    const contextVec = vectorFromText(contextText, 1);
    const profiles = buildTagProfiles();

    const scored = state.tagOptions.map(tag => {
      const profileVec = profiles.get(tag) || new Map();
      const tagVec = vectorFromText(tag, 1);
      const score =
        cosine(contextVec, profileVec) * CONFIG.autoTag.profileBoost +
        cosine(contextVec, tagVec) * CONFIG.autoTag.tagNameBoost;

      return { tag, score };
    })
      .filter(x => x.score >= CONFIG.autoTag.minScore)
      .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
      .slice(0, CONFIG.autoTag.maxTags);

    return { contextText, scored };
  }

  function applyAutoTags() {
    const { contextText, scored } = analyseRelevantTags();
    state.autoTagScores = new Map(scored.map(x => [x.tag, x.score]));
    state.activeTags = scored.map(x => x.tag);
    state.viewMode = 'default';
    persistCurrentCatState();
    renderChips();
    onFilter();

    const status = byId('faq-auto-status');
    if (!status) return;

    if (!contextText) {
      status.textContent = 'Geen categorie-context gevonden om te analyseren.';
    } else if (!scored.length) {
      status.textContent = 'Analyse vond geen sterke tagmatch. Kies tags handmatig of verrijk de categorie-tekst.';
    } else {
      const shown = scored.map(x => `${x.tag} ${(x.score * 100).toFixed(0)}%`).join(', ');
      status.textContent = `Analyse: ${shown}`;
    }
  }

  // ========= AI FAQ SELECTION =========
  function truncateText(s, max) {
    const text = oneLine(s || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function collectPageContent() {
    const fields = [];
    const seen = new Set();

    const add = (label, value) => {
      const clean = oneLine(value || '');
      if (!clean || clean.length < 3) return;
      const key = `${label}:${clean}`;
      if (seen.has(key)) return;
      seen.add(key);
      fields.push({ label, value: clean });
    };

    add('category_title', getCatTitle());
    add('category_slug', getCatSlug());
    add('document_title', document.title);

    [...document.querySelectorAll('h1,h2,h3,.breadcrumb,[aria-label*="breadcrumb" i]')].forEach((el, i) => {
      add(`heading_${i + 1}`, el.textContent || '');
    });

    [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].forEach((el, i) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'password', 'checkbox', 'radio', 'file', 'submit', 'button'].includes(type)) return;
      if (el.closest('#ddo-faq-tag-overlay')) return;

      const name = el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('aria-label') || `field_${i + 1}`;
      const value = el.isContentEditable ? el.textContent : el.value;
      add(name, value || '');
    });

    const fullText = fields.map(f => `${f.label}: ${f.value}`).join('\n');
    return truncateText(fullText, CONFIG.ai.maxPageChars);
  }

  function getSheetFaqForDom(domFaq) {
    const byIdMap = new Map(state.sheetFaqs.map(f => [String(f.id), f]));
    const byLabelMap = new Map(state.sheetFaqs.map(f => [norm(f.label), f]));
    return byIdMap.get(String(domFaq.id)) || byLabelMap.get(norm(domFaq.label));
  }

  function getAiFaqCandidates() {
    return state.domFaqs
      .map(d => {
        const sh = getSheetFaqForDom(d);
        if (!sh) return null;
        return {
          id: String(d.id),
          question: sh.label || d.label || '',
          answer: truncateText(sh.answer || '', CONFIG.ai.maxAnswerChars),
          tags: sh.tags || []
        };
      })
      .filter(Boolean)
      .slice(0, CONFIG.ai.maxCandidates);
  }

  function getOpenAiKey() {
    let key = localStorage.getItem(CONFIG.apiKeyStorageKey) || '';
    if (key) return key;

    key = prompt('OpenAI API-key voor FAQ-selectie. De key wordt lokaal in deze browser opgeslagen:') || '';
    key = key.trim();
    if (key) localStorage.setItem(CONFIG.apiKeyStorageKey, key);
    return key;
  }

  function gmJsonPost(url, body, apiKey) {
    return new Promise((resolve, reject) => {
      const done = (status, responseText) => {
        let json;
        try { json = JSON.parse(responseText || '{}'); }
        catch { return reject(new Error(`Ongeldige JSON-response (${status})`)); }

        if (status < 200 || status >= 300) {
          const msg = json?.error?.message || `HTTP ${status}`;
          reject(new Error(msg));
        } else {
          resolve(json);
        }
      };

      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          data: JSON.stringify(body),
          onload: res => done(res.status, res.responseText),
          onerror: () => reject(new Error('API-verzoek mislukt.')),
          ontimeout: () => reject(new Error('API-verzoek duurde te lang.')),
          timeout: 45000
        });
      } else {
        fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
          .then(async res => done(res.status, await res.text()))
          .catch(reject);
      }
    });
  }

  function extractResponseText(json) {
    if (json.output_text) return json.output_text;

    const chunks = [];
    (json.output || []).forEach(item => {
      (item.content || []).forEach(part => {
        if (part.text) chunks.push(part.text);
      });
    });
    return chunks.join('\n');
  }

  async function aiSelectFaqs() {
    const status = byId('faq-ai-status');
    const btn = byId('faq-ai-select');
    if (status) status.textContent = 'AI analyseert pagina en FAQ-kandidaten…';
    if (btn) btn.disabled = true;

    try {
      const apiKey = getOpenAiKey();
      if (!apiKey) {
        if (status) status.textContent = 'Geen API-key ingevuld.';
        return;
      }

      const pageContent = collectPageContent();
      const candidates = getAiFaqCandidates();
      if (!pageContent) throw new Error('Geen pagina-content gevonden om te analyseren.');
      if (!candidates.length) throw new Error('Geen FAQ-kandidaten gevonden.');

      const payload = {
        category: {
          id: getCatId(),
          title: getCatTitle(),
          slug: getCatSlug()
        },
        pageContent,
        rules: {
          maxSelect: CONFIG.ai.maxSelect,
          minConfidence: CONFIG.ai.minConfidence,
          onlyUseCandidateIds: true
        },
        faqCandidates: candidates
      };

      const body = {
        model: CONFIG.ai.model,
        input: [
          {
            role: 'system',
            content: 'Je selecteert Nederlandse e-commerce FAQ-items voor een categoriepagina. Interpreteer de pagina-inhoud semantisch. Kies alleen FAQ’s die concreet relevant zijn voor deze categorie of productgroep. Gebruik uitsluitend id’s uit de kandidaatlijst. Geef compacte JSON terug.'
          },
          {
            role: 'user',
            content: JSON.stringify(payload)
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'faq_selection',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                selected: {
                  type: 'array',
                  maxItems: CONFIG.ai.maxSelect,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      confidence: { type: 'number' },
                      reason: { type: 'string' }
                    },
                    required: ['id', 'confidence', 'reason']
                  }
                }
              },
              required: ['selected']
            }
          }
        }
      };

      const json = await gmJsonPost(CONFIG.ai.endpoint, body, apiKey);
      const parsed = JSON.parse(extractResponseText(json));
      const validIds = new Set(candidates.map(f => String(f.id)));
      const selected = (parsed.selected || [])
        .filter(x => validIds.has(String(x.id)) && Number(x.confidence || 0) >= CONFIG.ai.minConfidence)
        .slice(0, CONFIG.ai.maxSelect);

      state.picks = selected.map(x => {
        const domFaq = state.domFaqs.find(d => String(d.id) === String(x.id));
        const sh = domFaq ? getSheetFaqForDom(domFaq) : null;
        return {
          faq: {
            id: String(x.id),
            label: sh?.label || domFaq?.label || '',
            answer: sh?.answer || '',
            tags: [...(sh?.tags || [])],
            searchA: sh?.searchA || '',
            searchB: sh?.searchB || ''
          },
          score: Math.max(0, Math.min(1, Number(x.confidence || 0)))
        };
      });

      selected.forEach(x => {
        applyToAdmin(String(x.id), true);
        logApply(String(x.id), true);
      });

      state.viewMode = 'default';
      renderList(state.picks);

      if (status) {
        const reasons = selected.slice(0, 4).map(x => `${x.id}: ${x.reason}`).join(' | ');
        status.textContent = selected.length
          ? `AI selecteerde ${selected.length} FAQ’s. ${reasons}`
          : 'AI vond geen FAQ’s boven de ingestelde betrouwbaarheidsdrempel.';
      }
    } catch (e) {
      console.error('[DDO] AI FAQ-selectie mislukt:', e);
      if (status) status.textContent = `AI-selectie mislukt: ${e.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ========= LOG =========
  function loadLog() {
    try { return JSON.parse(localStorage.getItem(CONFIG.logKey) || '[]'); }
    catch { return []; }
  }

  function saveLog(arr) {
    if (CONFIG.logTrimKeepLast && arr.length > CONFIG.logTrimKeepLast) {
      arr = arr.slice(-CONFIG.logTrimKeepLast);
    }
    localStorage.setItem(CONFIG.logKey, JSON.stringify(arr));
  }

  // ========= PER-CAT TAG STATE =========
  function loadTagState() {
    try { return JSON.parse(localStorage.getItem(CONFIG.tagStateKey) || '{}'); }
    catch { return {}; }
  }

  function saveTagState(map) {
    localStorage.setItem(CONFIG.tagStateKey, JSON.stringify(map));
  }

  function getCatTagState(catId) {
    const m = loadTagState();
    return m[catId] || { tags: [], searchTerm: '' };
  }

  function setCatTagState(catId, data) {
    const m = loadTagState();
    m[catId] = data;
    saveTagState(m);
  }

  function persistCurrentCatState() {
    setCatTagState(getCatId(), {
      tags: [...state.activeTags],
      searchTerm: state.searchTerm || ''
    });
  }

  // ========= FILTER (TAGS + SEARCH) =========
  function filterFaqs() {
    const activeCanon = new Set(state.activeTags);
    const query = norm(state.searchTerm);

    const byIdMap = new Map(state.sheetFaqs.map(f => [String(f.id), f]));
    const byLabelMap = new Map(state.sheetFaqs.map(f => [norm(f.label), f]));

    const out = [];

    for (const d of state.domFaqs) {
      let sh = byIdMap.get(String(d.id));
      if (!sh) sh = byLabelMap.get(norm(d.label));
      if (!sh) continue;

      const searchMatch = !query || sh.searchText.includes(query);

      let tagMatch = true;
      let score = 0.5;

      if (activeCanon.size) {
        const shSet = new Set(sh.tags || []);
        tagMatch = [...activeCanon].some(t => shSet.has(t));

        if (tagMatch) {
          const cover = [...activeCanon].filter(t => shSet.has(t)).length;
          const extra = [...shSet].filter(t => !activeCanon.has(t)).length;
          score = 0.8 * (cover / Math.max(1, activeCanon.size)) + 0.2 * (1 / (1 + extra));
        }
      }

      if (!activeCanon.size && !query) continue;
      if (!tagMatch || !searchMatch) continue;

      out.push({
        faq: {
          id: d.id,
          label: d.label,
          answer: sh.answer || '',
          tags: [...(sh.tags || [])],
          searchA: sh.searchA || '',
          searchB: sh.searchB || ''
        },
        score
      });
    }

    out.sort((a, b) => b.score - a.score || a.faq.label.localeCompare(b.faq.label));
    return out;
  }

  function getAllSelectedFaqs() {
    const byIdMap = new Map(state.sheetFaqs.map(f => [String(f.id), f]));
    const byLabelMap = new Map(state.sheetFaqs.map(f => [norm(f.label), f]));
    const out = [];

    for (const d of state.domFaqs) {
      if (!d.cb?.checked) continue;

      let sh = byIdMap.get(String(d.id));
      if (!sh) sh = byLabelMap.get(norm(d.label));

      out.push({
        faq: {
          id: d.id,
          label: d.label,
          answer: sh?.answer || '',
          tags: [...(sh?.tags || [])],
          searchA: sh?.searchA || '',
          searchB: sh?.searchB || ''
        },
        score: 1
      });
    }

    out.sort((a, b) => a.faq.label.localeCompare(b.faq.label));
    return out;
  }

  // ========= UI =========
  function makeOverlay() {
    let overlay = byId('ddo-faq-tag-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ddo-faq-tag-overlay';
      overlay.innerHTML = `
        <div id="ddo-faq-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <strong style="font-size:16px">FAQ Tag Selector</strong>
            <button id="faq-close" type="button" class="ddo-btn" title="Sluiten">✕</button>
          </div>

          <div id="faq-cat" style="color:#333;margin-top:-2px;"></div>

          <div id="faq-searchbar">
            <span style="color:#333">Zoeken in sheet kolom A + B:</span>
            <input id="faq-search" type="text" placeholder="Bijv. Wit" />
            <button id="faq-search-clear" type="button" class="ddo-btn">Wis zoekterm</button>
            <button id="faq-ai-select" type="button" class="ddo-btn" title="Laat AI pagina-content analyseren en relevante FAQ’s aanvinken">AI selecteer FAQ’s</button>
          </div>
          <div id="faq-ai-status"></div>

          <div>
            <div id="tag-toolbar">
              <span style="color:#333">Tags (klik om te filteren):</span>
              <button id="tags-auto" type="button" class="ddo-btn" title="Selecteer relevante tags op basis van categorie en FAQ-inhoud">Analyseer tags</button>
              <button id="tags-select-all" type="button" class="ddo-btn" title="Selecteer alle tags">Selecteer alle tags</button>
              <button id="tags-clear" type="button" class="ddo-btn" title="Deselecteer alle tags">Deselecteer alle tags</button>
              <span id="faq-auto-status"></span>
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
      byId('faq-ai-select').onclick = aiSelectFaqs;
      byId('tags-auto').onclick = applyAutoTags;

      byId('tags-select-all').onclick = () => {
        state.autoTagScores = new Map();
        if (byId('faq-auto-status')) byId('faq-auto-status').textContent = '';
        state.activeTags = [...state.tagOptions];
        persistCurrentCatState();
        renderChips();
        onFilter();
      };

      byId('tags-clear').onclick = () => {
        state.autoTagScores = new Map();
        if (byId('faq-auto-status')) byId('faq-auto-status').textContent = '';
        state.activeTags = [];
        persistCurrentCatState();
        renderChips();
        onFilter();
      };

      byId('faq-search-clear').onclick = () => {
        const input = byId('faq-search');
        if (!input) return;
        input.value = '';
        state.searchTerm = '';
        persistCurrentCatState();
        state.viewMode = 'default';
        onFilter();
      };

      const searchInput = byId('faq-search');
      if (searchInput) {
        searchInput.value = state.searchTerm || '';
        searchInput.addEventListener('input', () => {
          state.searchTerm = searchInput.value || '';
          persistCurrentCatState();
          state.viewMode = 'default';
          onFilter();
        });
      }

      const catTitle = getCatTitle();
      const catId = getCatId();
      const slug = getCatSlug();
      byId('faq-cat').textContent = `Categorie: ${catTitle || '—'} (ID ${catId || '—'})${slug ? ' – ' + slug : ''}`;

      renderChips();
    }

    return overlay;
  }

  function makeOpener() {
    let btn = byId('ddo-faq');
    if (!btn) {
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

  function toggleOverlay(force) {
    const ov = makeOverlay();
    const willOpen = (typeof force === 'boolean')
      ? force
      : (ov.style.display === 'none' || ov.style.display === '');

    ov.style.display = willOpen ? 'block' : 'none';

    if (willOpen) {
      const input = byId('faq-search');
      if (input) input.value = state.searchTerm || '';
    }
  }

  function renderChips() {
    const host = byId('tag-chips');
    if (!host) return;

    host.innerHTML = '';
    const active = new Set(state.activeTags);
    const ordered = state.tagOptions;

    ordered.forEach((tagCanon) => {
      const autoScore = state.autoTagScores.get(tagCanon);
      const chip = document.createElement('label');
      chip.className = `ddo-chip ${autoScore ? 'is-auto' : ''}`;
      if (autoScore) chip.title = `Automatisch voorgesteld: ${(autoScore * 100).toFixed(0)}% relevant`;
      chip.innerHTML = `<input type="checkbox" ${active.has(tagCanon) ? 'checked' : ''}/> <span>${tagCanon}</span>`;

      const input = chip.querySelector('input');

      input.addEventListener('change', () => {
        state.autoTagScores = new Map();
        if (byId('faq-auto-status')) byId('faq-auto-status').textContent = '';
        const next = new Set(state.activeTags);
        if (input.checked) next.add(tagCanon);
        else next.delete(tagCanon);
        state.activeTags = [...next];
        persistCurrentCatState();
        state.viewMode = 'default';
        renderChips();
        onFilter();
      });

      chip.addEventListener('click', (e) => {
        if (e.target !== input) {
          input.checked = !input.checked;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      host.appendChild(chip);
    });
  }

  function renderSummary() {
    const sum = byId('faq-summary');
    if (!sum) return;

    const activeParts = [];
    if (state.searchTerm) activeParts.push(`zoekterm: "${escHtml(state.searchTerm)}"`);
    if (state.activeTags.length) activeParts.push(`tags: ${state.activeTags.length}`);
    if (state.viewMode === 'selected-in-picks') activeParts.push('alleen geselecteerde binnen voorstellen');
    if (state.viewMode === 'selected-all') activeParts.push('alle geselecteerde FAQ’s');

    sum.innerHTML = `
      <span class="faq-summary-link ${state.viewMode === 'selected-in-picks' ? 'is-active' : ''}" id="faq-summary-toggle-picks">
        Voorstellen: ${state.picks.length}
      </span>
      <span class="faq-summary-link ${state.viewMode === 'selected-all' ? 'is-active selected' : ''}" id="faq-summary-toggle-selected">
        ✅: ${countAdminSelected()}
      </span>
      ${activeParts.length ? `<span class="faq-summary-muted">${activeParts.join(' • ')}</span>` : ''}
    `;

    const togglePicks = byId('faq-summary-toggle-picks');
    if (togglePicks) {
      togglePicks.title = state.viewMode === 'selected-in-picks'
        ? 'Klik om weer alle voorstellen te tonen'
        : 'Klik om alleen geselecteerde FAQ’s binnen de voorstellen te tonen';

      togglePicks.onclick = () => {
        state.viewMode = state.viewMode === 'selected-in-picks' ? 'default' : 'selected-in-picks';
        renderList(state.picks);
      };
    }

    const toggleSelected = byId('faq-summary-toggle-selected');
    if (toggleSelected) {
      toggleSelected.title = state.viewMode === 'selected-all'
        ? 'Klik om weer de normale lijst te tonen'
        : 'Klik om alle geselecteerde FAQ’s te tonen';

      toggleSelected.onclick = () => {
        state.viewMode = state.viewMode === 'selected-all' ? 'default' : 'selected-all';
        renderList(state.picks);
      };
    }
  }

  function renderList(picks) {
    const list = byId('faq-list');
    if (!list) return;

    list.innerHTML = '';

    let visiblePicks = picks;
    if (state.viewMode === 'selected-in-picks') {
      visiblePicks = picks.filter(p => isAdminChecked(String(p.faq.id)));
    } else if (state.viewMode === 'selected-all') {
      visiblePicks = getAllSelectedFaqs();
    }

    visiblePicks.forEach(p => {
      const id = String(p.faq.id);
      const row = document.createElement('div');
      row.className = 'faq-row';
      row.dataset.id = id;
      row.innerHTML = `
        <div class="faq-left">
          <input class="faq-include" type="checkbox" ${isAdminChecked(id) ? 'checked' : ''} style="margin-top:3px;transform:scale(1.05);cursor:pointer"/>
          <div style="min-width:0">
            <div class="faq-title">${escHtml(p.faq.label)}</div>
            <div class="faq-meta">ID: ${escHtml(p.faq.id)} • Tags: ${escHtml((p.faq.tags || []).join(', '))}</div>
          </div>
        </div>
        <div class="faq-right">
          <div class="faq-answer" title="${escAttr(p.faq.answer || '')}">${escHtml(oneLine(p.faq.answer || ''))}</div>
          <div class="faq-score">${(p.score * 100).toFixed(0)}%</div>
        </div>`;
      list.appendChild(row);
    });

    renderSummary();

    list.querySelectorAll('.faq-include').forEach(chk => {
      chk.onchange = (e) => {
        const id = e.currentTarget.closest('[data-id]').dataset.id;

        if (e.currentTarget.checked) {
          applyToAdmin(id, true);
          logApply(id, true);
        } else {
          applyToAdmin(id, false);
          logApply(id, false);
        }

        if (state.viewMode === 'selected-in-picks' || state.viewMode === 'selected-all') {
          renderList(state.picks);
        } else {
          renderSummary();
        }
      };
    });
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  function escAttr(s) {
    return escHtml(s).replace(/'/g, '&#39;');
  }

  function oneLine(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  // ====== ADMIN CHECKBOXEN ======
  function isAdminChecked(id) {
    const f = state.domFaqs.find(x => String(x.id) === String(id));
    return !!(f && f.cb && f.cb.checked);
  }

  function countAdminSelected() {
    return state.domFaqs.reduce((acc, f) => acc + (f.cb?.checked ? 1 : 0), 0);
  }

  function applyToAdmin(id, checked) {
    const f = state.domFaqs.find(x => String(x.id) === String(id));
    if (!f || !f.cb) return;
    if (f.cb.checked !== checked) {
      f.cb.checked = checked;
      f.cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function clearSelection(all) {
    all.forEach(f => {
      if (f.cb.checked) {
        f.cb.checked = false;
        f.cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    byId('faq-list')?.querySelectorAll('.faq-include').forEach(c => { c.checked = false; });

    if (state.viewMode === 'selected-in-picks' || state.viewMode === 'selected-all') {
      renderList(state.picks);
    } else {
      renderSummary();
    }
  }

  function onSelectAllFaqs() {
    if (!state.picks?.length) return;

    for (const p of state.picks) {
      const id = String(p.faq.id);
      if (!isAdminChecked(id)) {
        applyToAdmin(id, true);
        const row = byId('faq-list')?.querySelector(`.faq-row[data-id="${CSS.escape(id)}"] .faq-include`);
        if (row) row.checked = true;
        logApply(id, true);
      }
    }

    if (state.viewMode === 'selected-in-picks' || state.viewMode === 'selected-all') {
      renderList(state.picks);
    } else {
      renderSummary();
    }
  }

  // ====== LOGGING ======
  function logApply(id, on) {
    const ts = new Date().toISOString();
    const catId = getCatId();
    const catTitle = getCatTitle();
    const pageUrl = location.href;
    const p = state.picks.find(x => String(x.faq.id) === String(id));

    const entry = {
      ts,
      catId,
      catTitle,
      tags: [...state.activeTags],
      searchTerm: state.searchTerm || '',
      faqId: String(id),
      faqLabel: p?.faq?.label || '',
      action: on ? 'apply' : 'remove',
      pageUrl
    };

    const log = loadLog();
    log.push(entry);
    saveLog(log);
  }

  // ====== MAIN ======
  async function main() {
    makeOpener();
    ensureFaqOpen();

    state.domFaqs = collectFaqDom();
    if (!state.domFaqs.length) return;

    let cols, rows;
    try {
      const csv = await fetchSheetCSV(CONFIG.SHEET_ID, CONFIG.GID);
      const parsed = parseCsvToRows(csv);
      cols = parsed.cols;
      rows = parsed.rows;
    } catch (e) {
      console.error('[DDO] Sheet ophalen/parsen mislukt:', e);
      alert('Kon Google Sheet (CSV) niet ophalen.');
      return;
    }

    try {
      const { faqList, tagOptions } = rowsToFaqTagModel(cols, rows);
      state.sheetFaqs = faqList;
      state.tagOptions = tagOptions;
    } catch (e) {
      console.error('[DDO] Sheet mapping error:', e);
      alert(e.message);
      return;
    }

    const saved = getCatTagState(getCatId());
    state.activeTags = Array.isArray(saved.tags) ? canonTags(saved.tags) : [];
    state.searchTerm = saved.searchTerm || '';

    makeOverlay();
    renderChips();
    onFilter();

    console.log('[DDO] Tag Selector klaar.', {
      domFaqs: state.domFaqs.length,
      sheetFaqs: state.sheetFaqs.length,
      tags: state.tagOptions.length,
      restoredTags: state.activeTags,
      searchTerm: state.searchTerm
    });
  }

  function onFilter() {
    state.picks = filterFaqs();
    renderList(state.picks);
  }

  if (document.readyState !== 'loading') setTimeout(main, 100);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(main, 100));

})();

(() => {
  'use strict';

  const ID = 'faqSelector';
  const VERSION = '3.0.0';
  const UPDATE_URL = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-faq-selector.user.js';
  const OPENER_ID = 'ddo-faq';
  const PANEL_ID = 'ddo-faq-panel';
  const POSITION_KEY = 'ddoFaqPosition';

  const applicable = () => !!document.querySelector([
    '.faq__header.controlbutton',
    '.faq__dropdown .faq__item',
    '[name*="faq"]',
    '[id*="faq"]'
  ].join(','));

  const state = () => {
    const available = applicable();
    const opener = document.getElementById(OPENER_ID);
    return {
      id: ID,
      kind: 'feature',
      label: 'FAQ Selector',
      version: VERSION,
      updateUrl: UPDATE_URL,
      available,
      ready: available && !opener?.disabled,
      reason: available
        ? (opener ? 'FAQ Selector gereed' : 'FAQ Selector wordt bij gebruik geladen')
        : 'Geen FAQ-velden op deze pagina'
    };
  };

  const report = () => document.dispatchEvent(new CustomEvent('ddo-toolbox:adapter-state', {
    detail: JSON.stringify(state())
  }));

  const hideOpener = () => document.getElementById(OPENER_ID)?.classList.add('ddo-faq-adapter-control');

  const decorate = () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || panel.dataset.ddoFloating === '1') return;
    panel.dataset.ddoFloating = '1';
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(POSITION_KEY) || 'null'); }
      catch { return null; }
    })();
    const toolbox = document.getElementById('ddo-toolbox')?.getBoundingClientRect();
    const width = Math.min(700, innerWidth - 20);
    Object.entries({
      position: 'fixed',
      right: 'auto',
      bottom: 'auto',
      width: `${width}px`,
      maxWidth: 'calc(100vw - 20px)',
      maxHeight: 'calc(100vh - 20px)',
      overflow: 'auto'
    }).forEach(([property, value]) => panel.style.setProperty(property, value, 'important'));
    panel.style.setProperty(
      'left',
      `${Math.min(saved?.left ?? Math.max(10, (toolbox?.left ?? innerWidth - 225) - width - 8), innerWidth - width - 10)}px`,
      'important'
    );
    panel.style.setProperty(
      'top',
      `${Math.min(saved?.top ?? Math.max(10, toolbox?.top ?? 10), innerHeight - 40)}px`,
      'important'
    );

    const handle = panel.firstElementChild;
    if (!handle) return;
    handle.style.cursor = 'move';
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,input,a,select,textarea')) return;
      const rect = panel.getBoundingClientRect();
      const dx = event.clientX - rect.left;
      const dy = event.clientY - rect.top;
      handle.setPointerCapture?.(event.pointerId);
      const move = e => {
        panel.style.setProperty(
          'left',
          `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, e.clientX - dx))}px`,
          'important'
        );
        panel.style.setProperty(
          'top',
          `${Math.max(0, Math.min(innerHeight - 32, e.clientY - dy))}px`,
          'important'
        );
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        try {
          localStorage.setItem(POSITION_KEY, JSON.stringify({
            left: panel.offsetLeft,
            top: panel.offsetTop
          }));
        } catch {}
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, {once:true});
    });
  };

  const waitForOpener = (timeout = 10000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const opener = document.getElementById(OPENER_ID);
      if (opener) return resolve(opener);
      if (Date.now() - started >= timeout) {
        return reject(new Error('FAQ-module is gestart, maar de bediening verscheen niet'));
      }
      setTimeout(check, 100);
    };
    check();
  });

  const load = () => waitForOpener();

  const refresh = () => {
    hideOpener();
    decorate();
    report();
  };

  const style = document.createElement('style');
  style.textContent = [
    '.ddo-faq-adapter-control{display:none!important}',
    '#ddo-faq-tag-overlay{background:transparent!important;pointer-events:none!important}',
    '#ddo-faq-panel{pointer-events:auto!important;background:#fff!important;color:#25313b!important;border:1px solid #cbd5df!important;border-radius:7px!important;box-shadow:0 5px 18px #0002!important}',
    '#ddo-faq-panel>div:first-child{background:#263746!important;color:#fff!important;margin:-1px -1px 8px!important;padding:7px 9px!important;border-radius:7px 7px 0 0!important}',
    '#ddo-faq-panel .ddo-btn{border:0!important;border-radius:4px!important;background:#0877b9!important;color:#fff!important}',
    '#ddo-faq-panel .ddo-btn:hover{background:#18864b!important}'
  ].join('');
  document.documentElement.appendChild(style);

  document.addEventListener('ddo-toolbox:discover', refresh);
  document.addEventListener('ddo-toolbox:run-feature', async event => {
    let data = {};
    try { data = JSON.parse(event.detail || '{}'); } catch {}
    if (data.id !== ID || !applicable()) return;
    try {
      const opener = await load();
      refresh();
      opener.click();
      decorate();
    } catch (error) {
      console.error('[DDO Adapter / FAQ Selector]', error);
      alert(`FAQ Selector kon niet starten: ${error.message}`);
    }
  });

  refresh();
})();

