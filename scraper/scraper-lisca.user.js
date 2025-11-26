// ==UserScript==
// @name         EAN Scrape - Lisca
// @version      1.5
// @description  Scrape de EAN code én stock direct in de juiste inputfields
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-lisca.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/scraper/scraper-lisca.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @connect      clients6.google.com
// @connect      www.google.com
// ==/UserScript==

(function(){
  "use strict";

  // ---------- CONFIG ----------
  const SHEET_ID = '1JGQp-sgPp-6DIbauCUSFWTNnljLyMWww';
  const GID      = '933070542';

  const AUTHUSER_MAX   = 9;
  const CACHE_KEY      = 'sheet_ean_lisca_cache_v4';
  const CACHE_TTL_MS   = 2 * 60 * 1000; // 2 minuten cache

  const DEBUG = true;
  const log = (...a) => DEBUG && console.log('[SheetEAN-Lisca]', ...a);

  // ---------- UI ----------
  function buildBtn(){
    const b=document.createElement('button');
    b.type='button';
    b.textContent='Sheet EAN + Stock (Lisca)';
    b.style.cssText='position:fixed;right:10px;top:50px;z-index:9999;padding:10px 12px;background:#333;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.15);';
    return b;
  }
  function setBtn(b, ok, msg, ms=2400){
    b.textContent = msg;
    b.style.background = ok ? '#2ecc71' : '#e06666';
    if (ms) setTimeout(()=>{ b.style.background='#333'; b.textContent='Sheet EAN + Stock (Lisca)'; }, ms);
  }

  // ---------- Brand check: Lisca & Lisca Swimwear ----------
  function normLiscaColor(c){
    const t = String(c || '').trim().toUpperCase();
    // Als volledig numeriek: strip leading zeros → "02"→"2", "002"→"2"
    return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
  }

  function isLiscaBrand() {
    const tab1 = document.querySelector('#tabs-1');
    if (!tab1) return false;
    for (const el of tab1.querySelectorAll('select,[role="combobox"],input,span')) {
      const opt = el.tagName === 'SELECT' ? el.options[el.selectedIndex] : null;
      const txt = (opt ? opt.textContent : (el.textContent || el.value || '')).trim().toLowerCase();
      if (/\blisca\b/.test(txt) || /\blisca\s*swimwear\b/.test(txt)) return true;
    }
    return false;
  }

  // ---------- Helpers: normalisatie & maat/cup ----------
  function normSize(v){ return String(v||'').toUpperCase().replace(/\s+/g,'').replace(/\(.*?\)/g,'').trim(); }

  function splitSID(pid){
    // "013121-KZ" of "013121 - KZ" → {A:"013121", C:"KZ"}
    const parts = String(pid||'').split(/\s*-\s*/);
    return { A:(parts[0]||'').trim(), C:(parts[1]||'').trim() };
  }

  function parseBraSize(s) {
    const t = String(s||'').toUpperCase().replace(/\s+/g,'').replace(/\(.*?\)/g,'');
    // check voor 'AA' → ongeldig in Lisca
    if (/AA$/.test(t)) return { band:'', cup:'' };

    const m = t.match(/^(\d{2,3})([A-Z\/+]{0,4})?$/);
    if (!m) return { band:'', cup:'' };
    return { band:m[1], cup:(m[2]||'').replace(/[^A-Z]/g,'') };
  }

  function cupToIndex(c){
    if (!c) return 0;
    if (c.length > 1) return 0; // dubbele letters (AA, BB, DD) → ongeldig voor Lisca
    return c.charCodeAt(0) - 64; // A=1, B=2, etc.
  }

  // ---------- Stock mapping ----------
  // n komt uit de sheet (0,1,2,3,4,5,...)
  // mapping volgens jouw regels:
  // 0,1,2 → 1 ; 3 → 2 ; 4 → 3 ; 5+ → 5
  function mapSheetStockToDDO(raw){
    const n = parseInt(raw, 10);
    if (isNaN(n)) return '';   // geen geldige waarde → niet invullen
    if (n <= 2) return 1;
    if (n === 3) return 2;
    if (n === 4) return 3;
    return 5;
  }

  // ---------- Net: Google Sheet ----------
  const CSV_URL = (authuser=null, uPath=null) => {
    if (uPath != null) return `https://docs.google.com/u/${uPath}/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
    return authuser == null ? base : `${base}&authuser=${authuser}`;
  };

  function gmFetch(url, responseType='text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        withCredentials: true,
        timeout: 20000,
        headers: { 'Accept':'text/csv,text/plain,*/*;q=0.8', 'User-Agent': navigator.userAgent },
        onload: r => resolve(r),
        onerror: e => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  function loadCache() {
    try {
      const raw = GM_getValue(CACHE_KEY, null);
      if (!raw) return null;
      const { t, data } = JSON.parse(raw);
      return (Date.now() - t <= CACHE_TTL_MS) ? data : null;
    } catch { return null; }
  }

  function saveCache(csv) {
    try { GM_setValue(CACHE_KEY, JSON.stringify({ t: Date.now(), data: csv })); } catch {}
  }

  function isTextOK(r){
    return r?.status===200 && typeof r.responseText==='string' &&
           r.responseText.trim() && !r.responseText.trim().startsWith('<');
  }

  async function tryGVizJSON(){
    const urlBase = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`;
    const tries = [urlBase, ...Array.from({length:AUTHUSER_MAX+1},(_,i)=>`${urlBase}&authuser=${i}`)];
    for (const url of tries){
      try{
        const r = await gmFetch(url, 'text');
        if (r?.status===200 && /google\.visualization\.Query\.setResponse/.test(r.responseText||'')) {
          const json = JSON.parse(r.responseText.replace(/^[^{]+/, '').replace(/;?\s*$/, ''));
          const rows = json.table?.rows || [];
          if (!rows.length) continue;
          const csv = rows.map(row => {
            const cells = (row.c||[]);
            return cells.map(c => {
              const v = (c?.v ?? '');
              const s = String(v);
              return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
            }).join(',');
          }).join('\n');
          return csv;
        }
      }catch(e){}
    }
    return null;
  }

  async function fetchSheetCSV() {
    const cached = loadCache();
    if (cached) return cached;

    // 0) kaal
    try{
      const r0 = await gmFetch(CSV_URL(null, null), 'text');
      if (isTextOK(r0)) { saveCache(r0.responseText); return r0.responseText; }
    }catch(e){}

    // 1) authuser varianten (query en /u/{n})
    for (let au = 0; au <= AUTHUSER_MAX; au++) {
      try {
        const rQ = await gmFetch(CSV_URL(au, null), 'text');
        if (isTextOK(rQ)) { saveCache(rQ.responseText); return rQ.responseText; }
      } catch(e) {}

      try {
        const rU = await gmFetch(CSV_URL(null, au), 'text');
        if (isTextOK(rU)) { saveCache(rU.responseText); return rU.responseText; }
      } catch(e) {}
    }

    // 2) fallback GViz JSON
    const jsonCsv = await tryGVizJSON();
    if (jsonCsv) { saveCache(jsonCsv); return jsonCsv; }

    throw new Error('CSV niet beschikbaar of account heeft geen toegang (log in met het juiste Google-account).');
  }

  // ---------- CSV parser ----------
  function parseCSV(text){
    const rows = [];
    let i=0, field='', row=[], inQ=false;
    while (i < text.length){
      const ch = text[i];
      if (inQ){
        if (ch === '"'){
          if (text[i+1] === '"'){ field+='"'; i+=2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      } else {
        if (ch === '"'){ inQ = true; i++; continue; }
        if (ch === ','){ row.push(field); field=''; i++; continue; }
        if (ch === '\n'){ row.push(field); rows.push(row); row=[]; field=''; i++; continue; }
        if (ch === '\r'){ i++; continue; }
        field += ch; i++; continue;
      }
    }
    row.push(field); rows.push(row);
    return rows;
  }

  // ---------- CSV → array rows {A,C,D,E,F,S,__i} ----------
  function parseCSVRows(csvText){
    const lines = parseCSV(csvText);
    const rows = [];
    for (let i=0;i<lines.length;i++){
      const cols = lines[i];
      rows.push({
        A: (cols[0]||'').trim(), // Supplier-id deel 1
        C: (cols[2]||'').trim(), // Supplier-id deel 2
        D: (cols[3]||'').trim(), // cup-index 0=geen, 1=A, 2=B...
        E: (cols[4]||'').trim(), // maat-basis (40, 70, M...)
        F: (cols[5]||'').trim(), // EAN
        S: (cols[6]||'').trim(), // STOCK (sheetkolom 7 → pas aan indien nodig)
        __i: i+1
      });
    }
    return rows;
  }

  // ---------- Lookup: A → C → (E,D) → {ean, stock} ----------
  function findEANStockFromRows(rows, pid, sizeRaw){
    const { A, C } = splitSID(pid);
    if (!A || !C) return { ean:'', stock:'' };

    const levelA = rows.filter(r => r.A === A);
    if (!levelA.length) { log('× geen A-match', A); return { ean:'', stock:'' }; }

    const levelC = levelA.filter(r => normLiscaColor(r.C) === normLiscaColor(C));
    if (!levelC.length) { log('× geen C-match', C); return { ean:'', stock:'' }; }

    const { band, cup } = parseBraSize(sizeRaw);
    let Ewant = '';
    let DWANT = 0;

    if (band && cup) {            // BH met cup
      Ewant = band;
      DWANT = cupToIndex(cup);
    } else {                      // apparel of band-only → D=0
      Ewant = normSize(sizeRaw);
      DWANT = 0;
    }

    const hit = levelC.find(r => normSize(r.E) === normSize(Ewant) && (parseInt(r.D||'0',10) === DWANT));
    if (!hit) {
      log('× geen rij voor', {pid, sizeRaw, Ewant, DWANT});
      return { ean:'', stock:'' };
    }

    const ean   = hit.F || '';
    const stock = mapSheetStockToDDO(hit.S);
    return {
      ean,
      stock: stock === '' ? '' : String(stock)
    };
  }

  // ---------- Plakken in #tabs-3 ----------
  function pasteIntoTab3(pid, rows, tab3){
    let matched = 0;
    for (const tr of tab3.querySelectorAll('table.options tr')) {
      const sizeCell  = tr.querySelector('td:first-child');
      const eanInput  = tr.querySelector('input[name^="options"][name$="[barcode]"]');
      const stockInput = tr.querySelector('input[name^="options"][name$="[stock]"]');
      if (!sizeCell || !eanInput) continue;

      const el = sizeCell.querySelector('input,select') || sizeCell;
      const rawSize = (el?.value ?? el?.textContent ?? '').trim();
      if (!rawSize) continue;

      const data = findEANStockFromRows(rows, pid, rawSize);

      if (data.ean) {
        eanInput.value = data.ean;
        eanInput.dispatchEvent(new Event('input',{bubbles:true}));
        matched++;
        log(`→ EAN: ${pid} | ${rawSize} → ${data.ean}`);
      } else {
        log(`× geen EAN-match: ${pid} | ${rawSize}`);
      }

      // Stock alleen invullen als we een waarde hebben én veld is nog leeg of 0
      if (data.stock && stockInput) {
        const current = String(stockInput.value || '').trim();
        if (current === '' || current === '0') {
          stockInput.value = data.stock;
          stockInput.dispatchEvent(new Event('input',{bubbles:true}));
          log(`   → Stock: ${rawSize} → ${data.stock} (sheet=${data.stock})`);
        } else {
          log(`   ↷ Stock overgeslagen (bestond al: ${current})`);
        }
      }
    }
    return matched;
  }

  // ---------- Main ----------
  function init(){
    const tab3 = document.querySelector('#tabs-3');
    if (!tab3) return;

    if (!isLiscaBrand()) return;

    const btn = buildBtn();
    tab3.prepend(btn);

    btn.addEventListener('click', async ()=>{
      console.groupCollapsed('Sheet EAN + Stock (Lisca) — Run');
      try {
        const pid = document.querySelector('#tabs-1 input[name="supplier_pid"]')?.value?.trim();
        if (!pid) { setBtn(btn,false,'❌ Geen Supplier PID'); console.groupEnd(); return; }

        setBtn(btn,true,'⏳ Sheet laden…',0);
        const csv  = await fetchSheetCSV();
        const rows = parseCSVRows(csv);
        log('Sheet-rijen:', rows.length);

        if (!rows.length) { setBtn(btn,false,'❌ Lege sheet'); console.groupEnd(); return; }

        const n = pasteIntoTab3(pid, rows, tab3);
        setBtn(btn, n>0, n?`✅ ${n} EAN’s (en stock) geplakt`:'❌ Geen maat-match');
      } catch (e) {
        console.error('[SheetEAN-Lisca] Error:', e);
        setBtn(btn,false,'❌ Fout tijdens ophalen');
      } finally {
        console.groupEnd();
      }
    });
  }

  (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded', init) : init();
})();
