// ==UserScript==
// @name         GG | Return Clipper Textual
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.1
// @description  Plaatst een copy-icoon in elk statusballetje op /returns en kopieert rij-gegevens als TSV-regel.
// @author       You
// @match        https://fm-e-warehousing.goedgepickt.nl/returns*
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/return-clipper-textual.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/return-clipper-textual.user.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  GM_addStyle(`
    .gg-badge-copy {
      background: transparent !important;
      border: none !important;
      padding: 0;
      color: #fff;
      cursor: pointer;
    }
    .gg-badge-copy:hover {
      color: #e5e7eb;
    }
    .gg-toast{
      position:fixed;left:50%;transform:translateX(-50%);
      bottom:22px;background:#111827;color:#E5E7EB;
      border:1px solid #374151;border-radius:12px;
      padding:10px 14px;z-index:999999;opacity:0;transition:.2s
    }
    .gg-toast.show{opacity:1;bottom:30px}
  `);

  function toast(msg){
    const el=document.createElement('div');
    el.className='gg-toast';
    el.textContent=msg;
    document.body.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{el.classList.remove('show'); setTimeout(()=>el.remove(),220)},2200);
  }

  function formatTodayNL(){
    const d = new Date();
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  function extractText(td){
    if(!td) return '';
    const a = td.querySelector('a');
    const raw = (a ? a.textContent : td.textContent) || '';
    return raw.replace(/\s+/g,' ').trim();
  }

  function extractDateFromCell(td){
    const txt = extractText(td);
    if(!txt) return '';

    if(/^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(txt)){
      return formatTodayNL();
    }

    const m = txt.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    if(m) return m[1];
    return (txt.split(' '))[0] || txt;
  }

  function buildTSVForRow(tr){
    const bestelnummer = extractText(tr.querySelector('td:nth-child(4)'));
    const klant        = extractText(tr.querySelector('td:nth-child(5)'));
    const producten    = extractText(tr.querySelector('td:nth-child(6)'));
    const datum        = extractDateFromCell(tr.querySelector('td:nth-child(8)'));

    return ['Return', bestelnummer, klant, datum, '', producten].join('\t');
  }

  async function copyText(text){
    try{
      await navigator.clipboard.writeText(text);
      toast('Gekopieerd naar klembord.');
    }catch{
      const ta=document.createElement('textarea');
      ta.style.position='fixed'; ta.style.opacity='0'; ta.value=text;
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast('Gekopieerd (fallback).');
    }
  }

  function injectCopyIcons(){
    $$('#returnOrderIndexTable tbody tr').forEach(tr=>{
      const statusTd = tr.querySelector('td:nth-child(1)');
      if(!statusTd) return;
      const badge = statusTd.querySelector('.m-badge');
      if(!badge) return;

      // Dubbele injectie voorkomen
      if(badge.querySelector('.gg-badge-copy')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gg-badge-copy';
      btn.title = 'Kopieer rij-info';
      btn.innerHTML = '<i class="fa fa-copy" aria-hidden="true"></i>';

      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const line = buildTSVForRow(tr);
        copyText(line);
      });

      badge.appendChild(btn);
    });
  }

  function hookDataTablesDraw(){
    const table = $('#returnOrderIndexTable');
    if(!table) return;
    const tbody = table.querySelector('tbody');
    if(!tbody) return;

    if(!tbody._ggObserver){
      const obs = new MutationObserver(()=>injectCopyIcons());
      obs.observe(tbody, {childList:true, subtree:true});
      tbody._ggObserver = obs;
    }
  }

  function waitFor(selector, {root=document, timeout=15000, poll=50}={}){
    return new Promise((resolve,reject)=>{
      const t0=Date.now();
      const it=setInterval(()=>{
        const el=root.querySelector(selector);
        if(el){clearInterval(it); resolve(el);}
        else if(Date.now()-t0>timeout){clearInterval(it); reject(new Error('Timeout: '+selector));}
      },poll);
    });
  }

  waitFor('#returnOrderIndexTable').then(()=>{
    hookDataTablesDraw();
    injectCopyIcons();
  });

})();
