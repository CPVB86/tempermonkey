// ==UserScript==
// @name         DDO Toolbox | Adapter | Product Validator
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.0.0
// @description  Controleert geselecteerde producten op kleur- en prijsafwijkingen.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID='productValidator', VERSION='1.0.0';
  const UPDATE_URL='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js';
  const PANEL_ID='ddo-product-validator-status', BADGE='ddo-product-validator-badge';
  let run=null;

  const params=()=>new URLSearchParams(location.search);
  const boxes=()=>[...document.querySelectorAll('input[type="checkbox"][name="products[]"]')];
  const applicable=()=>params().get('section')==='categories'&&boxes().length>0&&window.__ddoToolbox?.isEnabled?.(ID)!==false;
  const send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  function cents(value){
    let text=String(value??'').trim().replace(/\s/g,'');
    if(!text)return null;
    if(text.includes(',')&&text.includes('.'))text=text.replace(/\./g,'').replace(',','.');
    else text=text.replace(',','.');
    if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
    const number=Number(text);
    return Number.isFinite(number)?Math.round(number*100):null;
  }
  const value=(doc,name)=>doc.querySelector(`input[name="${name}"]`)?.value;
  const optionValues=(doc,name)=>[...doc.querySelectorAll(`#tabs-3 input[name^="options"][name$="[${name}]"]`)].filter(field=>!field.closest('tr')?.classList.contains('empty_set')).map(field=>field.value);
  const plural=(count,one,many)=>`${count} ${count===1?one:many}`;

  function validateDocument(doc){
    const issues=[],mainPrice=cents(value(doc,'price')),mainAdvice=cents(value(doc,'price_advice')),mainVip=cents(value(doc,'price_vip'));
    if(mainVip===null)issues.push('VIP-prijs op tab 1 is niet controleerbaar');
    else if(mainVip!==0)issues.push('VIP-prijs op tab 1 is hoger dan 0,00');

    const colors=[...doc.querySelectorAll('#tabs-2 tr[id^="colordelete_"]')].filter(row=>!row.classList.contains('empty_set'));
    if(colors.length>2)issues.push(`${colors.length} kleuren op tab 2 (maximaal 2)`);

    const prices=optionValues(doc,'price').map(cents),advices=optionValues(doc,'price_advice').map(cents),vips=optionValues(doc,'price_vip').map(cents);
    if(mainPrice===null)issues.push('Prijs op tab 1 is niet controleerbaar');
    else {const wrong=prices.filter(price=>price===null||price!==mainPrice).length;if(wrong)issues.push(`${plural(wrong,'optieprijs','optieprijzen')} wijkt af van tab 1`)}
    if(mainAdvice===null)issues.push('Adviesprijs op tab 1 is niet controleerbaar');
    else {const wrong=advices.filter(price=>price===null||price!==mainAdvice).length;if(wrong)issues.push(`${plural(wrong,'optie-adviesprijs','optie-adviesprijzen')} wijkt af van tab 1`)}
    const badVip=vips.filter(price=>price===null||price>0).length;
    if(badVip)issues.push(`${plural(badVip,'optie-VIP-prijs','optie-VIP-prijzen')} hoger dan 0,00 of niet controleerbaar`);
    return issues;
  }

  function report(){const ready=applicable();send('adapter-state',{id:ID,kind:'feature',label:'Product Validator',version:VERSION,updateUrl:UPDATE_URL,available:ready,ready,reason:ready?'Selecteer producten om ze te controleren':'Open een categoriepagina met producten'})}
  function selected(){return boxes().filter(box=>box.checked).map(box=>{const row=box.closest('tr'),cells=[...row?.querySelectorAll('td')||[]];return{id:String(box.value||'').trim(),name:String(cells.find(cell=>cell!==box.closest('td'))?.innerText||'').trim().split('\n')[0],row}}).filter(item=>/^\d+$/.test(item.id)&&item.row)}

  function installStyle(){if(document.getElementById('ddo-product-validator-style'))return;const style=document.createElement('style');style.id='ddo-product-validator-style';style.textContent=`
    tr.ddo-validator-error>td{background:#ffe3e3!important}tr.ddo-validator-unreadable>td{background:#fff2c7!important}
    .${BADGE}{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:10px;color:#fff;font:600 10px/1.4 system-ui;vertical-align:middle}
    tr.ddo-validator-error .${BADGE}{background:#b42318}tr.ddo-validator-unreadable .${BADGE}{background:#a15c00}tr.ddo-validator-ok .${BADGE}{background:#21863a}
  `;document.head.append(style)}
  function clearMarks(){document.querySelectorAll('tr.ddo-validator-error,tr.ddo-validator-unreadable,tr.ddo-validator-ok').forEach(row=>row.classList.remove('ddo-validator-error','ddo-validator-unreadable','ddo-validator-ok'));document.querySelectorAll(`.${BADGE}`).forEach(node=>node.remove())}
  function mark(item,type,text,title){item.row.classList.add(`ddo-validator-${type}`);const cell=item.row.querySelector('td:nth-child(2)')||item.row.querySelector('td');if(!cell)return;const badge=document.createElement('span');badge.className=BADGE;badge.textContent=text;badge.title=title;cell.append(badge)}

  function panel(){let node=document.getElementById(PANEL_ID);if(node)return node;node=document.createElement('div');node.id=PANEL_ID;node.style.cssText='margin:0 0 8px;padding:7px 9px;border:1px solid #cad5df;border-radius:6px;background:#f7fafc;color:#25313b;font:11px/1.3 system-ui;display:flex;align-items:center;gap:8px';const table=boxes()[0]?.closest('table');table?.parentNode?.insertBefore(node,table);return node}
  function render(progress){const node=panel();if(!node)return;node.innerHTML=`<strong>Product Validator</strong><span>${safe(progress.status)}</span><span>${progress.done}/${progress.total}</span><span style="color:#b42318">${progress.errors} afwijkend</span><span style="color:#a15c00">${progress.failed} mislukt</span>${progress.running?'<button type="button">Stop</button>':''}`;const button=node.querySelector('button');if(button){button.style.cssText='margin-left:auto;border:0;border-radius:4px;padding:3px 7px;background:#6b7780;color:#fff;cursor:pointer';button.onclick=()=>{if(run)run.cancelled=true}}}

  async function fetchProduct(id,signal){const url=`${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(id)}`,response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);const html=await response.text(),doc=new DOMParser().parseFromString(html,'text/html');if(doc.querySelector('input[type="password"]')||!doc.querySelector('input[name="price"]'))throw new Error('productpagina niet herkenbaar');return doc}
  async function start(){
    if(!applicable()||run?.running)return;
    const items=selected();if(!items.length){alert('Selecteer eerst minimaal één product om te controleren.');return}
    installStyle();clearMarks();run={running:true,cancelled:false};const progress={status:'Controleren…',done:0,total:items.length,errors:0,failed:0,running:true};render(progress);
    for(const item of items){
      if(run.cancelled)break;
      try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),doc=await fetchProduct(item.id,controller.signal);clearTimeout(timer);const issues=validateDocument(doc);if(issues.length){progress.errors++;mark(item,'error',`⚠ ${issues.length}`,issues.join('\n'))}else mark(item,'ok','✓ OK','Geen afwijkingen gevonden')}
      catch(error){progress.failed++;mark(item,'unreadable','? Mislukt',String(error?.message||error));console.error(`[DDO Product Validator] Product ${item.id}`,error)}
      progress.done++;render(progress);
    }
    progress.running=false;progress.status=run.cancelled?'Gestopt':'Controle afgerond';run.running=false;render(progress);
  }

  document.addEventListener('ddo-toolbox:discover',report);
  document.addEventListener('ddo-toolbox:run-feature',event=>{let detail={};try{detail=JSON.parse(event.detail||'{}')}catch{}if(detail.id===ID)start()});
  report();
})();
