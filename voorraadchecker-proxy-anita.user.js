// ==UserScript==
// @name         Voorraadchecker Proxy - Anita
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.0
// @description  Vergelijk local stock met remote stock
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      b2b.anita.com
// @run-at       document-idle
// @require      https://lingerieoutlet.nl/tools/stock/common/stockkit.js?v=2025-08-13-1
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-anita.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/voorraadchecker-proxy-anita.user.js
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    LOG: {
      status:   'both',    // 'console' | 'logboek' | 'both' | 'off'  (samenvatting per tabel)
      perMaat:  'console', // maten-overzicht in console
      debug:    false,
    }
  };

  const BASE='https://b2b.anita.com';
  const PATH_441='/nl/shop/441/'; // directe artikelweergave
  const PATH_410='/nl/shop/410/'; // zoekpagina (fallback)
  const ACCEPT_HDR='text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  const CONTENT_HDR='application/x-www-form-urlencoded; charset=UTF-8';

  // Alleen tonen bij deze leverancierslabels (value of zichtbare tekst)
  const ALLOWED_SUPPLIERS=new Set([
    'anita','anita-active','anita-badmode','anita-care','anita-maternity',
    'rosa-faia','rosa-faia-badmode'
  ]);

  const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const norm=(s='')=>String(s).trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');

  // ---------- Logging ----------
  const Logger={
    lb(){ return (typeof unsafeWindow!=='undefined' && unsafeWindow.logboek) ? unsafeWindow.logboek : window.logboek; },
    _on(mode,kind){ const m=(CONFIG.LOG[kind]||'off').toLowerCase(); return m===mode || m==='both'; },
    status(id,txt){
      if(this._on('console','status')) console.info(`[Anita][${id}] status: ${txt}`);
      if(this._on('logboek','status')){
        const lb=this.lb();
        if (lb?.resultaat) lb.resultaat(id, txt);
        else if (typeof unsafeWindow!=='undefined' && unsafeWindow.voegLogregelToe) unsafeWindow.voegLogregelToe(String(id), txt);
      }
    },
    perMaat(id,report){
      if(!this._on('console','perMaat')) return;
      console.groupCollapsed(`[Anita][${id}] maatvergelijking`);
      try {
        const rows = report.map(r => ({ maat:r.maat, local:r.local, remote:Number.isFinite(r.sup)?r.sup:'—', status:r.actie }));
        console.table(rows);
      } finally { console.groupEnd(); }
    },
    debug(...a){ if(CONFIG.LOG.debug) console.info('[Anita][debug]', ...a); }
  };

  // ---------- Badge op tabelkop ----------
  function injectBadgeCSS(){
    if (document.getElementById('anita-badge-css')) return;
    const css = `
      .anita-badge{display:inline-flex;align-items:center;gap:.35em;font:500 12px/1.2 system-ui; margin-left:.5em; padding:.15em .5em; border-radius:999px; vertical-align:middle}
      .anita-badge svg{width:12px;height:12px}
      .anita-ok{background:#e6f4ea;color:#137333;border:1px solid #b7e1c0}
      .anita-warn{background:#fff4e5;color:#8a5a00;border:1px solid #ffd9a8}
      .anita-miss{background:#f1f3f4;color:#3c4043;border:1px solid #e0e3e7}
    `.trim();
    const el = document.createElement('style');
    el.id = 'anita-badge-css';
    el.textContent = css;
    document.head.appendChild(el);
  }
  function makeIcon(pathD){
    const ns='http://www.w3.org/2000/svg';
    const s=document.createElementNS(ns,'svg');
    s.setAttribute('viewBox','0 0 24 24');
    const p=document.createElementNS(ns,'path'); p.setAttribute('d',pathD);
    s.appendChild(p); return s;
  }
  const ICONS = {
    ok:   'M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5L9 16.2z',
    warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    miss: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'
  };
  function setTableBadge(table, status){
    injectBadgeCSS();
    const head = table.querySelector('thead th[colspan]') || table.querySelector('thead th');
    if (!head) return;
    const old = head.querySelector('.anita-badge'); if (old) old.remove();
    const span = document.createElement('span');
    span.className = 'anita-badge ' + (status==='ok'?'anita-ok':status==='afwijking'?'anita-warn':'anita-miss');
    const label = status==='ok' ? 'OK' : status==='afwijking' ? 'Afwijking' : 'Niet gevonden';
    span.appendChild(makeIcon(ICONS[ status==='ok'?'ok':status==='afwijking'?'warn':'miss' ]));
    span.appendChild(document.createTextNode(' ' + label));
    head.appendChild(span);
  }

  // ---------- GM fetch ----------
  function fetchViaGM(opts){
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url: opts.url,
        data: opts.data,
        withCredentials: true,
        timeout: opts.timeout || 20000,
        headers: {
          'Accept': ACCEPT_HDR,
          'Content-Type': opts.contentType || CONTENT_HDR,
          'Referer': BASE + '/nl/shop'
        },
        onload: (r)=> (r.status>=200 && r.status<300) ? resolve(r.responseText || '') : reject(new Error(`HTTP ${r.status} @ ${opts.url}`)),
        onerror: reject,
        ontimeout: ()=>reject(new Error(`timeout @ ${opts.url}`))
      });
    });
  }

  // ---------- Session (voor 410 fallback) ----------
  async function getSessionHidden(){
    const html=await fetchViaGM({ url: BASE + PATH_410 });
    const doc=new DOMParser().parseFromString(html,'text/html');
    const form=$('.shop-article-search',doc) || $('form[name="Suche"]',doc);
    const val=n=>form?.querySelector(`input[name="${n}"]`)?.value?.trim()||'';
    const out={ fir:val('fir'), kdnr:val('kdnr'), fssc:val('fssc'), aufn:val('aufn') };
    if(!out.fir || !out.kdnr) throw new Error('Sessiewaarden niet gevonden');
    return out;
  }

  // ---------- PID parsing (robust: alles tussen 1e en laatste '-' is ARNR) ----------
  function parsePid(raw=''){
    const pid=String(raw).trim().replace(/\s+/g,''); if(!pid) return {koll:'',arnr:'',fbnr:''};
    const parts=pid.split('-').filter(Boolean);
    if(parts.length>=3){
      const kollCandidate=parts[0];
      const fbnr=parts[parts.length-1];
      if(/[A-Za-z]/.test(kollCandidate)){ // bv. M5-8310-0-401
        return { koll:kollCandidate, arnr:parts.slice(1,-1).join('-'), fbnr };
      } else { // bv. 8310-0-401 (geen koll)
        return { koll:'', arnr:parts.slice(0,-1).join('-'), fbnr };
      }
    } else if(parts.length===2){
      return { koll:'', arnr:parts[0], fbnr:parts[1] };
    } else {
      return { koll:'', arnr:parts[0]||'', fbnr:'' };
    }
  }

  // Hints uit table: data-* voorrang; anders id
  function getPidHintsFromTable(table){
    const ds=table?.dataset||{};
    const dsKoll=ds.anitaKoll||ds.anitaCollection||ds.koll||'';
    const dsArt =ds.anitaArticle||ds.article||'';
    const dsCol =ds.anitaColor||ds.color||'';
    if(dsKoll||dsArt||dsCol) return { koll:dsKoll.trim(), arnr:dsArt.trim(), fbnr:dsCol.trim() };
    return parsePid(table?.id||'');
  }

  // ---------- Fetch detail ----------
  function build441Url({arnr,koll='',fbnr='',zicht='A'}){
    const qp=new URLSearchParams();
    if (koll) qp.set('koll', koll);
    if (arnr) qp.set('arnr', arnr);
    if (fbnr) qp.set('fbnr', fbnr);
    qp.set('sicht', zicht || 'A');
    return `${BASE}${PATH_441}?${qp.toString()}`;
  }
  async function fetchDetailHtml(params){
    const url441=build441Url(params);
    try { return await fetchViaGM({ url: url441 }); }
    catch(e){
      try{
        const h=await getSessionHidden();
        const body=new URLSearchParams({ such: params.arnr || '', sicht: 'S', ...h }).toString();
        return await fetchViaGM({ method:'POST', url: BASE + PATH_410, data: body });
      } catch {
        const qs=new URLSearchParams({ such: params.arnr || '', sicht: 'S' }).toString();
        return await fetchViaGM({ url: BASE + PATH_410 + '?' + qs });
      }
    }
  }

  // ---------- Parse HTML (2D en 1D) ----------
  function parseAnitaStock(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    const tables=$$('.shop-article-tables table[data-article-number]',doc);

    const out={ article: tables[0]?.dataset.articleNumber || null, colors:{} };

    for(const t of tables){
      const colorNo  =(t.dataset.colorNumber||'').trim();
      const colorName=(t.dataset.colorName||'').trim();

      const bandHeaders=$$('thead th',t)
        .map(th=>th.textContent.trim())
        .filter(v=>v && !/^(Inkoopprijs|Verkoopprijs)$/i.test(v));

      const rows=$$('tbody tr',t);
      const hasCup=rows.some(r => (r.querySelector('th[scope="row"]')?.textContent || '').trim().length > 0);

      const sizes={};

      if (hasCup) {
        // 2D: band × cup
        for(const row of rows){
          const cup=(row.querySelector('th[scope="row"]')?.textContent||'').trim();
          if(!cup) continue;
          const cells=$$('td',row);
          cells.forEach((td,i)=>{
            const band=bandHeaders[i];
            const inp=$('input[data-in-stock]',td);
            if(!band||!inp) return;
            const key=`${band}${cup}`;
            const qty=parseInt(inp.getAttribute('data-in-stock')||'0',10)||0;
            sizes[key]=qty;
          });
        }
      } else {
        // 1D: maatkolommen (38, 40, S, M, ...)
        for(const row of rows){
          const cells=$$('td',row);
          cells.forEach((td,i)=>{
            const band=bandHeaders[i];
            const inp=$('input[data-in-stock]',td);
            if(!band||!inp) return;
            const key=band.replace(/\s+/g,'');
            const qty=parseInt(inp.getAttribute('data-in-stock')||'0',10)||0;
            sizes[key]=qty;
          });
        }
      }

      if (colorNo) out.colors[colorNo] = { name: colorName, sizes };
    }
    return out;
  }

  // ---------- Samengestelde maten afhandelen ----------
  // Map '36 A/B' -> max(remote['36A'], remote['36B'])
  // Werkt ook voor 'S/M' of '38/40' (1D-groepen), en 'AA/AB' etc.
  function resolveRemoteQty(remoteMap, label) {
    const raw = String(label || '').trim();

    // 1) Exacte hit (voor 1D zoals '38', 'S', '36A' etc.)
    if (Object.prototype.hasOwnProperty.call(remoteMap, raw)) return remoteMap[raw];
    const nospace = raw.replace(/\s+/g, '');
    if (Object.prototype.hasOwnProperty.call(remoteMap, nospace)) return remoteMap[nospace];

    // 2) Band + cups: "36 A/B" (spatie optioneel), cups 1-2 letters
    //    ook "36 AA/AB", etc.
    const m = raw.match(/^(\d+)\s*([A-Za-z]{1,2}(?:\/[A-Za-z]{1,2})+)$/);
    if (m) {
      const band = m[1];
      const cups = m[2].split('/');
      let best = -1;
      for (const cup of cups) {
        const key = `${band}${cup}`;
        if (Object.prototype.hasOwnProperty.call(remoteMap, key)) {
          const v = remoteMap[key];
          if (v > best) best = v;
        }
      }
      if (best >= 0) return best;
    }

    // 3) 1D groep zonder band: "S/M" of "38/40"
    if (raw.includes('/')) {
      let best = -1;
      for (const part of raw.split('/').map(s => s.trim())) {
        const k1 = part;
        const k2 = part.replace(/\s+/g, '');
        if (Object.prototype.hasOwnProperty.call(remoteMap, k1)) best = Math.max(best, remoteMap[k1]);
        else if (Object.prototype.hasOwnProperty.call(remoteMap, k2)) best = Math.max(best, remoteMap[k2]);
      }
      if (best >= 0) return best;
    }

    return undefined; // niets gevonden
  }

  // ---------- Kleurselectie ----------
  function chooseColor(remote, table, fbnrHint){
    if (fbnrHint && remote.colors[fbnrHint]) return remote.colors[fbnrHint].sizes;
    const hintName=(table.dataset.anitaColorName||'').toLowerCase();
    if (hintName){
      const hit=Object.values(remote.colors).find(c => (c.name||'').toLowerCase().includes(hintName));
      if (hit) return hit.sizes;
    }
    const entries=Object.values(remote.colors);
    if (entries.length===1) return entries[0].sizes;
    // fallback: merge (max)
    const merged={};
    for(const c of entries) for(const [k,v] of Object.entries(c.sizes)) merged[k]=Math.max(merged[k]||0,v);
    return merged;
  }

  // ---------- Markeren + rapport ----------
  function applyRulesAndMark(localTable, remoteMap){
    const rows=localTable.querySelectorAll('tbody tr'); const report=[];
    rows.forEach(row=>{
      const sizeCell=row.children[0];
      const localCell=row.children[1];
      const maat=(row.dataset.size || sizeCell?.textContent || '').trim();
      const local=parseInt((localCell?.textContent || '').trim(),10) || 0;

      // << gebruik samengestelde-maten-resolve >>
      const sup = resolveRemoteQty(remoteMap, maat);
      const hasSup = typeof sup === 'number';

      // reset
      row.style.background=''; row.style.transition='background-color .25s';
      row.title=''; row.classList.remove('status-green','status-red'); delete row.dataset.status;

      let actie='none';
      if (hasSup){
        if (local>0 && sup===0){
          row.style.background='#f8d7da';
          row.title='Uitboeken (Anita=0)';
          row.dataset.status='remove'; row.classList.add('status-red');
          actie='uitboeken';
        } else if (local===0 && sup>4){
          row.style.background='#d4edda';
          row.title='Bijboeken 2 (Anita>4)';
          row.dataset.status='add'; row.classList.add('status-green');
          actie='bijboeken_2';
        } else if (local===0 && sup<5){
          row.title='Negeren (Anita<5 en lokaal 0)';
          actie='negeren';
        }
      } else {
        row.title='Maat niet gevonden bij Anita';
        if (local>0){
          row.style.background='#f8d7da';
          row.dataset.status='remove'; row.classList.add('status-red');
        }
        actie='anita_missing';
      }
      report.push({ maat, local, sup, actie });
    });
    return report;
  }

  function bepaalLogStatus(report, remoteMap){
    const n=report.length;
    const counts=report.reduce((a,r)=> (a[r.actie]=(a[r.actie]||0)+1, a), {});
    const nUit=counts.uitboeken||0, nBij=counts.bijboeken_2||0, nMiss=counts.anita_missing||0;
    const remoteLeeg=!remoteMap || Object.keys(remoteMap).length===0;
    if (remoteLeeg || (n>0 && nMiss===n)) return 'niet-gevonden';
    if (nUit===0 && nBij===0 && nMiss===0) return 'ok';
    return 'afwijking';
  }

  // ---------- Main ----------
  async function run(btn){
    if (typeof StockKit==='undefined' || !StockKit.makeProgress){
      alert('StockKit niet geladen. Vernieuw de pagina of controleer de @require-URL.');
      return;
    }

    const progress=StockKit.makeProgress(btn);
    const tables=Array.from(document.querySelectorAll('#output table'));
    if (!tables.length){ alert('Geen tabellen gevonden in #output.'); return; }

    progress.start(tables.length);
    let totalMutations=0, ok=0, fail=0, idx=0;

    for (const table of tables){
      idx++;

      const { koll, arnr, fbnr } = getPidHintsFromTable(table);
      const label = table.querySelector('thead th[colspan]')?.textContent?.trim()
                 || table.id || [koll,arnr,fbnr].filter(Boolean).join('-') || 'onbekend';

      try {
        if (!arnr){
          Logger.status(label, 'niet-gevonden');
          setTableBadge(table, 'niet-gevonden');
          progress.setDone(idx);
          continue;
        }

        const html      = await fetchDetailHtml({ arnr, koll, fbnr, zicht:'A' });
        const remote    = parseAnitaStock(html);
        const remoteMap = chooseColor(remote, table, fbnr);

        const report = applyRulesAndMark(table, remoteMap);
        const diffs  = report.filter(r => r.actie==='uitboeken' || r.actie==='bijboeken_2').length;
        totalMutations += diffs;

        const status = bepaalLogStatus(report, remoteMap);
        Logger.status(label, status);     // -> logboek + console
        Logger.perMaat(label, report);    // -> console
        setTableBadge(table, status);     // -> badge op kop

        ok++;
      } catch (e){
        console.error('[Anita] fout:', e);
        Logger.status(label, 'afwijking');
        setTableBadge(table, 'afwijking');
        fail++;
      }

      progress.setDone(idx);
      await delay(80);
    }

    progress.success(totalMutations);
    if (CONFIG.LOG.debug) console.info(`[Anita] verwerkt: ${ok+fail} | geslaagd: ${ok} | fouten: ${fail} | mutaties: ${totalMutations}`);
  }

  // ---------- UI ----------
  function isAllowedSupplierSelected(){
    const dd=document.getElementById('leverancier-keuze');
    if (!dd) return true;
    const opt=dd.options[dd.selectedIndex]||null;
    const byValue=norm(dd.value||'');
    const byText =norm(opt ? (opt.text||'') : '');
    return ALLOWED_SUPPLIERS.has(byValue) || ALLOWED_SUPPLIERS.has(byText);
  }

  function addButton(){
    if (document.getElementById('check-anita-btn')) return;

    // StockKit CSS (optioneel)
    if (!document.getElementById('stockkit-css')) {
      const link=document.createElement('link');
      link.id='stockkit-css'; link.rel='stylesheet';
      link.href='https://lingerieoutlet.nl/tools/stock/common/stockkit.css';
      document.head.appendChild(link);
    }

    const btn=document.createElement('button');
    btn.textContent='🔍 Check Stock Anita';
    btn.id='check-anita-btn';
    btn.className='sk-btn';
    Object.assign(btn.style,{ position:'fixed', top:'8px', right:'250px', zIndex:9999, display:'none' });
    btn.addEventListener('click',()=>run(btn));
    document.body.appendChild(btn);

    const outputHasTables=()=>!!document.querySelector('#output table');
    function toggle(){
      btn.style.display = (outputHasTables() && isAllowedSupplierSelected()) ? 'block' : 'none';
    }
    const out=document.getElementById('output');
    if (out) new MutationObserver(toggle).observe(out, { childList:true, subtree:true });

    const select=document.getElementById('leverancier-keuze');
    if (select) select.addEventListener('change', toggle);

    const upload=document.getElementById('upload-container');
    if (upload) new MutationObserver(toggle).observe(upload,{ attributes:true, attributeFilter:['style','class'] });

    toggle();
  }

  (document.readyState==='loading')
    ? document.addEventListener('DOMContentLoaded', addButton)
    : addButton();
})();
