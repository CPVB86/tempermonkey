// ==UserScript==
// @name         GG | Warehousing
// @namespace    https://fm-e-warehousing.goedgepickt.nl/
// @version      1.0
// @description  Kopieert data van aangevinkte orders op klembord voor op het logboek.
// @author       C. P. v. Beek
// @match        https://fm-e-warehousing.goedgepickt.nl/orders*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/warehousing.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/GG/warehousing.user.js
// ==/UserScript==

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  GM_addStyle(`
    .gg-tsv-btn{display:inline-flex;align-items:center;justify-content:center;width:45px!important;gap:15px!important}
    .gg-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;background:#111827;color:#E5E7EB;border:1px solid #374151;border-radius:12px;padding:10px 14px;z-index:999999;opacity:0;transition:.2s}
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

  function waitFor(selector, {root=document, timeout=15000, poll=50}={}){
    return new Promise((resolve,reject)=>{
      const t0=Date.now();
      const it=setInterval(()=>{
        const el=root.querySelector(selector);
        if(el){clearInterval(it); resolve(el);} else if(Date.now()-t0>timeout){clearInterval(it); reject(new Error('Timeout: '+selector));}
      },poll);
    });
  }

  let btn;
  function ensureButton(){
    if(btn) return btn;
    const container = document.querySelector('.orders-index-search-container .d-flex.flex-nowrap.btn-group.mr-2');
    if(!container) return null;
    btn=document.createElement('button');
    btn.id='gg_copy_tsv';
    btn.className='btn btn-secondary-o gg-tsv-btn';
    btn.type='button';
    btn.innerHTML='<span class="fa fa-copy"></span>';
    btn.style.display='none';
    btn.addEventListener('click',copyCheckedAsTSV);
    // links vóór zoekveld
    container.parentNode.insertBefore(btn, container);
    return btn;
  }

  function getCellText(tr, n){
    const td = tr.querySelector(`td:nth-child(${n})`);
    if(!td) return '';
    const a = td.querySelector('a');
    const raw = (a ? a.textContent : td.textContent) || '';
    return raw.replace(/\s+/g,' ').trim();
  }

  function getBesteldatumDateOnly(tr){
    const txt = getCellText(tr, 8);
    const m = txt.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    if(m) return m[1];
    if(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/.test(txt)){
      const d = new Date();
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    }
    return (txt.split(' '))[0] || '';
  }

  function getProductCountMinusOne(tr){
    const txt = getCellText(tr, 6);
    const n = parseInt((txt.match(/\d+/)||[])[0],10);
    if(isNaN(n)) return '0';
    return String(Math.max(0, n - 1));
  }

  function hasB2BTag(tr){
    const klantCell = tr.querySelector('td:nth-child(4)');
    if(!klantCell) return false;
    const tags = $$('span.order-tag, .tag, .badge', klantCell).map(s=>s.textContent.trim().toLowerCase());
    if(tags.includes('b2b')) return true;
    return /\bB2B\b/i.test(klantCell.textContent || '');
  }

  function rowToFields(tr){
    const webshop     = getCellText(tr, 7);
    const bestelnummer= getCellText(tr, 3);
    const klant       = getCellText(tr, 4);
    const besteldatum = getBesteldatumDateOnly(tr);
    const land        = getCellText(tr, 5);
    const productenM1 = getProductCountMinusOne(tr);
    const retailFlag  = hasB2BTag(tr) ? 'Wholesale' : 'Retail';
    return [webshop, bestelnummer, klant, besteldatum, land, productenM1, retailFlag];
  }

  async function copyCheckedAsTSV(){
    const checked = $$('#order_index_datatable input.orders:checked');
    if(checked.length===0){ toast('Niks geselecteerd.'); return; }
    const rows = checked.map(cb => cb.closest('tr'));
    const lines = rows.reverse().map(row => rowToFields(row).join('\t'));
    const text = lines.join('\n');
    try{
      await navigator.clipboard.writeText(text);
      toast(`${rows.length} regels naar klembord.`);
    }catch{
      const ta=document.createElement('textarea');
      ta.style.position='fixed'; ta.style.opacity='0'; ta.value=text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast(`${rows.length} regels naar klembord (fallback).`);
    }
  }

  function toggleButton(){
    const btn=ensureButton();
    if(!btn) return;
    const checked = $$('#order_index_datatable input.orders:checked');
    btn.style.display = checked.length? 'inline-flex':'none';
  }

  waitFor('#order_index_datatable').then(()=>{
    ensureButton();
    document.addEventListener('change', e=>{
      if(e.target.matches('#order_index_datatable input.orders')) toggleButton();
    });
  });

})();
