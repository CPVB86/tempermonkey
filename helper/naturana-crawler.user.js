// ==UserScript==
// @name         Naturana Crawler v2
// @version      1.2.2
// @description  Selecteer producten via checkbox in grid én popup (gesynchroniseerd), open via __doPostBack, scrape alle kleuren + maten, export clean CSV. Stock=1 vast + Qty=remote max per maat.
// @match        https://*/naturana/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* -------------------------
   * Helpers
   * ------------------------- */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const capWords = (s) => (s || '').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));
  const parsePriceToEuro = (str) => (str || '').replace(/[^\d.,]/g, '').replace(',', '.').trim();

  function pad3(s) {
    const v = String(s || '').trim();
    if (!v) return '';
    return v.padStart(3, '0');
  }

  // Force Excel text: ="023" (keeps leading zeros)
  function excelText(v) {
    const s = String(v ?? '');
    if (!s) return '';
    return `="${s.replace(/"/g, '""')}"`;
  }

  function htmlToDoc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function parseDoPostBackTargetFromHref(href) {
    if (!href) return null;
    const m = href.match(/__doPostBack\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/);
    if (!m) return null;
    return { eventTarget: m[1], eventArgument: m[2] || '' };
  }

  function byIdLike(starts, ends, root = document) {
    return root.querySelector(`[id^="${starts}"][id$="${ends}"]`);
  }

  function toIntSafe(v) {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getRemoteQtyFromTile(tile) {
    // Inspiratie uit VCP: Naturana gebruikt meestal input.gridAmount[max] als "remote qty"
    const inp = tile.querySelector('input.gridAmount, input.aspNetDisabled.gridAmount');
    if (!inp) return 0;

    // Prefer max
    const maxAttr = inp.getAttribute('max');
    if (maxAttr != null) return toIntSafe(maxAttr);

    // Fallbacks (soms)
    const dm = inp.getAttribute('data-max') ?? inp.dataset?.max;
    if (dm != null) return toIntSafe(dm);

    // Fallback (niet ideaal): value
    const val = inp.getAttribute('value') ?? inp.value;
    if (val != null) return toIntSafe(val);

    return 0;
  }

  /* -------------------------
   * Selection storage + sync
   * ------------------------- */
  const LS_KEY = 'naturana_crawler_selection_v1';

  function loadSelection() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveSelection(sel) {
    localStorage.setItem(LS_KEY, JSON.stringify(sel || {}));
  }

  function isSelected(key) {
    const sel = loadSelection();
    return !!sel[key];
  }

  function setSelected(key, checked) {
    const sel = loadSelection();
    sel[key] = !!checked;
    saveSelection(sel);
  }

  /* -------------------------
   * WebForms POST helpers
   * ------------------------- */
  async function postBackFetchCurrentPage({ eventTarget, eventArgument = '' }, extraFields = {}) {
    const form = document.forms?.form1;
    if (!form) throw new Error('Geen form1 gevonden op huidige pagina');

    const fd = new FormData(form);
    fd.set('__EVENTTARGET', eventTarget);
    fd.set('__EVENTARGUMENT', eventArgument);

    for (const [k, v] of Object.entries(extraFields)) fd.set(k, v);

    const res = await fetch(form.action || location.href, {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`POST failed: ${res.status}`);
    return await res.text();
  }

  function makePostBackFetchFromDoc(doc) {
    const form = doc.forms?.form1;
    if (!form) throw new Error('Geen form1 in fetched doc');

    return async function postBackFetchFromThisDoc({ eventTarget, eventArgument = '' }, extraFields = {}) {
      const fd = new FormData(form);
      fd.set('__EVENTTARGET', eventTarget);
      fd.set('__EVENTARGUMENT', eventArgument);

      for (const [k, v] of Object.entries(extraFields)) fd.set(k, v);

      const res = await fetch(form.action || location.href, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      return await res.text();
    };
  }

  /* -------------------------
   * Detail parsing
   * ------------------------- */
  function getBaseProductDataFromDoc(doc) {
    const articleNo =
      byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_lblArticleNo_0', doc)?.textContent.trim()
      || '';

    const type = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_repDescriptions_0_lblDescValue_0', doc)?.textContent.trim() || '';
    const name1 = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_repDescriptions_0_lblDescValue_1', doc)?.textContent.trim() || '';
    const name2 = byIdLike('cphContent_cphMain_repArticle_wpArticle_', '_repDescriptions_0_lblDescValue_2', doc)?.textContent.trim() || '';

    const modelName = name2 || name1 || '';
    const baseTitle = capWords([name2, name1, type].filter(Boolean).join(' ').trim());

    return { articleNo, modelName, baseTitle };
  }

  function collectColorSelectPostbacks(doc) {
    // Alleen de kleur-tiles (input type=image met btnSelectColor)
    const btns = Array.from(doc.querySelectorAll('input[type="image"][id*="btnSelectColor_"]'));
    const items = btns.map(btn => {
      const id = btn.getAttribute('id') || '';
      const name = btn.getAttribute('name') || '';
      return { eventTarget: name || id, eventArgument: '' };
    });

    const uniq = new Map();
    for (const it of items) uniq.set(it.eventTarget, it);
    return Array.from(uniq.values());
  }

  function parseActiveColorAndSizes(doc, base) {
    const activeColorNr =
      doc.querySelector('div.div-art-color span[id*="_lblColorNr_"]')?.textContent?.trim() || '';
    const activeColorName =
      doc.querySelector('div.div-art-color span[id*="_lblColorName_"]')?.textContent?.trim() || '';

    const colorNrPadded = pad3(activeColorNr);
    const colorNrText = excelText(colorNrPadded);

    const grids = Array.from(doc.querySelectorAll('.color-size-grid'));
    const rows = [];

    for (const grid of grids) {
      const tiles = Array.from(grid.querySelectorAll('div.p-2.text-center'));
      for (const tile of tiles) {
        const size = tile.querySelector('.gridSize')?.textContent?.trim() || '';
        const uvp = parsePriceToEuro(tile.querySelector('.gridUvp')?.textContent || '');
        const ek = parsePriceToEuro(tile.querySelector('.gridEk')?.textContent || '');

        const qty = getRemoteQtyFromTile(tile); // <-- nieuw

        const title = capWords([base.baseTitle, activeColorName].filter(Boolean).join(' ').trim());
        const productCode = [base.articleNo, colorNrPadded].filter(Boolean).join('-') || base.articleNo;

        rows.push({
          ProductCode: productCode,     // A
          UVP: uvp,                     // B
          Title: title,                 // C
          Empty: '',                    // D
          Size: size,                   // E
          EK: ek,                       // F
          ColorNr: colorNrText,         // G (="023")
          ColorName: activeColorName,   // H
          ModelName: base.modelName,    // I
          ArticleNo: base.articleNo,    // J
          Stock: 1,                     // K (altijd 1)
          Qty: qty,                     // L (remote qty per maat)
        });
      }
    }

    return rows;
  }

  async function buildExportRowsFromDetailHtml_ALLCOLORS(htmlDetail) {
    let doc = htmlToDoc(htmlDetail);
    const base = getBaseProductDataFromDoc(doc);
    const colorPBs = collectColorSelectPostbacks(doc);

    if (!colorPBs.length) return parseActiveColorAndSizes(doc, base);

    const all = [];
    const seen = new Set();

    for (const cpb of colorPBs) {
      const postBackFromThisDoc = makePostBackFetchFromDoc(doc);

      // extra x/y voor image button (veilig)
      const extra = {};
      extra[cpb.eventTarget + '.x'] = '1';
      extra[cpb.eventTarget + '.y'] = '1';

      const htmlAfterColor = await postBackFromThisDoc({ eventTarget: cpb.eventTarget, eventArgument: '' }, extra);
      doc = htmlToDoc(htmlAfterColor);

      const rows = parseActiveColorAndSizes(doc, base);
      for (const r of rows) {
        // Qty meegenomen in uniqueness (zodat een wijziging in max niet samenvouwt)
        const k = `${r.ProductCode}|${r.Size}|${r.EK}|${r.UVP}|${r.Qty}`;
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(r);
      }
    }

    return all;
  }

  /* -------------------------
   * CSV
   * ------------------------- */
  const CSV_HEADERS = [
    'ProductCode', // A
    'UVP',         // B
    'Title',       // C
    'Empty',       // D
    'Size',        // E
    'EK',          // F
    'ColorNr',     // G
    'ColorName',   // H
    'ModelName',   // I
    'ArticleNo',   // J
    'Stock',       // K (vast 1)
    'Qty',         // L (remote qty)
  ];

  function toCsv(rows) {
    const esc = (v) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    return [
      CSV_HEADERS.map(esc).join(','),
      ...rows.map(r => CSV_HEADERS.map(h => esc(r[h])).join(','))
    ].join('\n');
  }

  function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* -------------------------
   * Overview item collection (robust)
   * ------------------------- */
  function findProductCards() {
    const cards = [
      ...$$('.mod-container-col'),
      ...$$('.mod-container'),
      ...$$('[id*="repMod_wpMod_"]')
    ];
    return Array.from(new Set(cards));
  }

  function collectOverviewItems() {
    const cards = findProductCards();
    const items = [];

    for (const card of cards) {
      let link =
        card.querySelector('a[id*="_linkArticleNo_"][href*="__doPostBack"]') ||
        card.querySelector('a.mod-desc-art-link[href*="__doPostBack"]') ||
        card.querySelector('a[href*="__doPostBack"]');

      const href = link?.getAttribute('href') || '';
      const pb = parseDoPostBackTargetFromHref(href);
      if (!pb?.eventTarget) continue;

      const articleNo =
        card.querySelector('span[id*="_lblArticleNo_"]')?.textContent?.trim() ||
        link?.textContent?.trim() ||
        '';

      const label =
        card.querySelector('.mod-desc-art-link')?.textContent?.trim() ||
        articleNo ||
        pb.eventTarget;

      items.push({
        card,
        articleNo,
        label,
        eventTarget: pb.eventTarget,
        eventArgument: pb.eventArgument || '',
      });
    }

    const uniq = new Map();
    for (const it of items) uniq.set(it.eventTarget, it);
    return Array.from(uniq.values());
  }

  /* -------------------------
   * UI
   * ------------------------- */
  function mountUI() {
    if ($('#naturana-crawl-ui')) return;

    const wrap = document.createElement('div');
    wrap.id = 'naturana-crawl-ui';
    wrap.style.cssText = `
      position: fixed; right: 14px; bottom: 14px; z-index: 999999;
      background: #fff; border: 1px solid #ccc; border-radius: 10px;
      padding: 10px; width: 460px; box-shadow: 0 6px 18px rgba(0,0,0,.15);
      font: 12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    `;

    wrap.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">Naturana → CSV Crawler</div>

      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <button id="nc-refresh" style="flex:1; padding:8px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer;">
          Producten laden / verversen
        </button>
        <button id="nc-all" style="padding:8px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer;">
          Alles
        </button>
        <button id="nc-none" style="padding:8px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer;">
          Niets
        </button>
      </div>

      <label style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <input type="checkbox" id="nc-only-filled" />
        <span>Alleen rijen met UVP én EK ingevuld (optioneel filter)</span>
      </label>

      <div style="margin-bottom:8px; color:#444;">
        Vink aan in de grid (pill) of hieronder (lijst). Beide syncen.
      </div>

      <div id="nc-list" style="max-height:210px; overflow:auto; border:1px solid #e5e5e5; border-radius:8px; padding:6px; background:#fafafa;"></div>

      <div style="display:flex; gap:8px; margin-top:8px; margin-bottom:8px;">
        <button id="nc-run" style="flex:1; padding:8px; border-radius:8px; border:1px solid #0073aa; background:#0073aa; color:#fff; cursor:pointer;">
          Crawl & CSV
        </button>
        <button id="nc-stop" style="padding:8px; border-radius:8px; border:1px solid #999; background:#fff; cursor:pointer;">
          Stop
        </button>
      </div>

      <div id="nc-log" style="white-space:pre-wrap; max-height:180px; overflow:auto; background:#f7f7f7; border:1px solid #e5e5e5; padding:6px; border-radius:8px;"></div>
    `;

    document.body.appendChild(wrap);

    const css = document.createElement('style');
    css.textContent = `
      .nc-pill {
        position:absolute; top:6px; left:6px; z-index: 9999;
        background: rgba(255,255,255,.92);
        border: 1px solid #cfcfcf;
        border-radius: 10px;
        padding: 4px 6px;
        display:flex; gap:6px; align-items:center;
        box-shadow: 0 2px 10px rgba(0,0,0,.10);
        font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
        user-select:none;
      }
      .nc-pill.nc-on { border-color:#0073aa; }
      .nc-pill.nc-on .nc-pill-label { color:#0073aa; font-weight:700; }

      .nc-card-on { outline: 2px solid rgba(0,115,170,.35); outline-offset: 2px; border-radius: 10px; }
    `;
    document.head.appendChild(css);
  }

  function logLine(msg) {
    const box = $('#nc-log');
    if (!box) return;
    box.textContent += (box.textContent ? '\n' : '') + msg;
    box.scrollTop = box.scrollHeight;
  }

  /* -------------------------
   * Popup list rendering
   * ------------------------- */
  let LAST_ITEMS = [];
  let STOP = false;

  function renderProductList(items) {
    const list = $('#nc-list');
    if (!list) return;

    if (!items.length) {
      list.innerHTML = `<div style="color:#777;">Geen producten gevonden op deze pagina. (Zit je op een productoverzicht?)</div>`;
      return;
    }

    list.innerHTML = items.map((it, idx) => {
      const key = it.eventTarget;
      const checked = isSelected(key);

      const safeLabel = (it.label || it.articleNo || key).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeArt = (it.articleNo || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return `
        <label style="display:flex; gap:8px; align-items:flex-start; padding:4px 2px; border-bottom:1px dashed #e8e8e8;">
          <input type="checkbox" class="nc-item" data-key="${key}" ${checked ? 'checked' : ''} />
          <div style="flex:1;">
            <div style="font-weight:600;">${safeArt || '—'} <span style="color:#666; font-weight:400;">(${idx + 1})</span></div>
            <div style="color:#555;">${safeLabel}</div>
          </div>
        </label>
      `;
    }).join('');

    $$('.nc-item', list).forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.getAttribute('data-key');
        setSelected(key, cb.checked);
        syncGridFromSelection();
      });
    });
  }

  function syncPopupFromSelection() {
    const list = $('#nc-list');
    if (!list) return;
    $$('.nc-item', list).forEach(cb => {
      const key = cb.getAttribute('data-key');
      cb.checked = isSelected(key);
    });
  }

  /* -------------------------
   * Grid pills
   * ------------------------- */
  function ensureCardPositioned(card) {
    const style = getComputedStyle(card);
    if (style.position === 'static') card.style.position = 'relative';
  }

  function upsertPillForItem(item) {
    const card = item.card;
    if (!card) return;

    ensureCardPositioned(card);

    let pill = card.querySelector('.nc-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'nc-pill';
      card.appendChild(pill);
    }

    pill.setAttribute('data-key', item.eventTarget);

    if (!pill.querySelector('input.nc-grid-select')) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'nc-grid-select';
      cb.style.cssText = 'width:14px;height:14px;cursor:pointer;';

      const label = document.createElement('span');
      label.className = 'nc-pill-label';
      label.textContent = 'Crawl';
      label.style.cssText = 'cursor:pointer;';

      cb.addEventListener('click', (e) => { e.stopPropagation(); });
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        setSelected(item.eventTarget, cb.checked);
        syncGridFromSelection();
        syncPopupFromSelection();
      });

      label.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });

      pill.appendChild(cb);
      pill.appendChild(label);
    }

    const checked = isSelected(item.eventTarget);
    pill.classList.toggle('nc-on', checked);
    card.classList.toggle('nc-card-on', checked);
    pill.querySelector('input.nc-grid-select').checked = checked;
  }

  function syncGridFromSelection() {
    for (const it of LAST_ITEMS) upsertPillForItem(it);
  }

  /* -------------------------
   * Refresh
   * ------------------------- */
  function refreshItems() {
    LAST_ITEMS = collectOverviewItems();
    renderProductList(LAST_ITEMS);
    syncGridFromSelection();
    logLine(`Producten gevonden: ${LAST_ITEMS.length}`);
  }

  function setAllSelection(checked) {
    const sel = loadSelection();
    for (const it of LAST_ITEMS) sel[it.eventTarget] = !!checked;
    saveSelection(sel);
    syncGridFromSelection();
    syncPopupFromSelection();
  }

  function getSelectedItems() {
    return LAST_ITEMS.filter(it => isSelected(it.eventTarget));
  }

  /* -------------------------
   * Crawl
   * ------------------------- */
  async function runCrawl() {
    STOP = false;
    $('#nc-log').textContent = '';

    if (!LAST_ITEMS.length) refreshItems();

    const selected = getSelectedItems();
    if (!selected.length) {
      logLine('Geen producten geselecteerd.');
      return;
    }

    const onlyFilled = !!$('#nc-only-filled')?.checked;

    logLine(`Start crawl… geselecteerd: ${selected.length} producten.`);
    const allRows = [];
    const delayMs = 350;

    for (let i = 0; i < selected.length; i++) {
      if (STOP) { logLine('Stop aangevraagd. Afbreken.'); break; }

      const it = selected[i];
      logLine(`[${i + 1}/${selected.length}] open ${it.articleNo || '(?)'}…`);

      try {
        const htmlDetail = await postBackFetchCurrentPage({ eventTarget: it.eventTarget, eventArgument: it.eventArgument });
        const rows = await buildExportRowsFromDetailHtml_ALLCOLORS(htmlDetail);
        const rowsFiltered = onlyFilled ? rows.filter(r => (r.UVP && r.EK)) : rows;
        allRows.push(...rowsFiltered);
        logLine(`  ✓ ok: ${rowsFiltered.length} rijen`);
      } catch (e) {
        logLine(`  ✗ fout: ${e.message || e}`);
      }

      await sleep(delayMs);
    }

    if (!allRows.length) {
      logLine('Geen resultaten om te exporteren.');
      return;
    }

    const csv = toCsv(allRows);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadText(`naturana-export-clean-${ts}.csv`, csv);

    logLine(`Klaar. CSV gedownload: ${allRows.length} rijen.`);
    logLine(`Kolommen: A ProductCode | B UVP | C Title | D leeg | E.. | K Stock(1) | L Qty(remote max)`);
  }

  /* -------------------------
   * Debounced observer
   * ------------------------- */
  function mountObserver() {
    let t = null;
    const obs = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if ($('#naturana-crawl-ui')) {
          if (!LAST_ITEMS.length) refreshItems();
          else syncGridFromSelection();
        }
      }, 250);
    });

    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* -------------------------
   * Boot
   * ------------------------- */
  function boot() {
    mountUI();

    $('#nc-refresh')?.addEventListener('click', refreshItems);
    $('#nc-all')?.addEventListener('click', () => setAllSelection(true));
    $('#nc-none')?.addEventListener('click', () => setAllSelection(false));

    $('#nc-run')?.addEventListener('click', runCrawl);
    $('#nc-stop')?.addEventListener('click', () => { STOP = true; });

    setTimeout(() => {
      refreshItems();
      mountObserver();
      logLine('UI geladen. Selecteer in grid of popup en klik “Crawl & CSV”.');
    }, 400);
  }

  boot();

})();
