// ==UserScript==
// @name         DDO Toolbox | Adapter | Product Validator
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.3.0
// @description  Controleert en corrigeert geselecteerde producten op kleur-, prijs- en NME-afwijkingen.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID='productValidator', VERSION='1.3.0';
  const UPDATE_URL='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js';
  const PANEL_ID='ddo-product-validator-status', BADGE='ddo-product-validator-badge';
  let run=null;

  const params=()=>new URLSearchParams(location.search);
  const boxes=()=>[...document.querySelectorAll('input[type="checkbox"][name="products[]"]')];
  const productList=()=>params().get('section')==='products'&&params().get('action')!=='edit';
  const applicable=()=>productList()&&boxes().length>0&&window.__ddoToolbox?.isEnabled?.(ID)!==false;
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
  const optionValues=(doc,name)=>[...doc.querySelectorAll(`#tabs-3 input[name^="options"][name$="[${name}]"]`)]
    .filter(field=>!field.closest('tr')?.classList.contains('empty_set'))
    .map(field=>field.value);

  const plural=(count,one,many)=>`${count} ${count===1?one:many}`;

  const fixable=checks=>!!checks&&(
    checks.vipTab1||
    checks.priceTab3||
    checks.adviceTab3||
    checks.vipTab3||
    checks.referenceNme
  );

  function validateDocument(doc){
    const issues=[];
    const checks={
      vipTab1:false,
      colorsTab2:false,
      priceTab3:false,
      adviceTab3:false,
      vipTab3:false,
      referenceNme:false
    };

    const mainPrice=cents(value(doc,'price'));
    const mainAdvice=cents(value(doc,'price_advice'));
    const mainVip=cents(value(doc,'price_vip'));

    if(mainVip===null){
      checks.vipTab1=true;
      issues.push('VIP-prijs op tab 1 is niet controleerbaar');
    }
    else if(mainVip!==0){
      checks.vipTab1=true;
      issues.push('VIP-prijs op tab 1 is hoger dan 0,00');
    }

    const colors=[...doc.querySelectorAll('#tabs-2 tr[id^="colordelete_"]')]
      .filter(row=>!row.classList.contains('empty_set'));

    if(colors.length>2){
      checks.colorsTab2=true;
      issues.push(`${colors.length} kleuren op tab 2 (maximaal 2)`);
    }

    const prices=optionValues(doc,'price').map(cents);
    const advices=optionValues(doc,'price_advice').map(cents);
    const vips=optionValues(doc,'price_vip').map(cents);

    if(mainPrice===null){
      checks.priceTab3=true;
      issues.push('Prijs op tab 1 is niet controleerbaar');
    }
    else {
      const wrong=prices.filter(price=>price===null||price!==mainPrice).length;
      if(wrong){
        checks.priceTab3=true;
        issues.push(`${plural(wrong,'optieprijs','optieprijzen')} wijkt af van tab 1`);
      }
    }

    if(mainAdvice===null){
      checks.adviceTab3=true;
      issues.push('Adviesprijs op tab 1 is niet controleerbaar');
    }
    else {
      const wrong=advices.filter(price=>price===null||price!==mainAdvice).length;
      if(wrong){
        checks.adviceTab3=true;
        issues.push(`${plural(wrong,'optie-adviesprijs','optie-adviesprijzen')} wijkt af van tab 1`);
      }
    }

    const badVip=vips.filter(price=>price===null||price>0).length;
    if(badVip){
      checks.vipTab3=true;
      issues.push(`${plural(badVip,'optie-VIP-prijs','optie-VIP-prijzen')} hoger dan 0,00 of niet controleerbaar`);
    }

    // NME-controle:
    // Alleen [NME] tussen blokhaken, hoofdletterongevoelig.
    // De rest van de reference blijft volledig ongemoeid.
    const reference=value(doc,'reference');

    if(/\[NME\]/i.test(reference||'')){
      checks.referenceNme=true;
      issues.push(`Reference bevat [NME]: ${reference}`);
    }

    return {issues,checks};
  }

  function report(){
    const ready=applicable();
    send('adapter-state',{
      id:ID,
      kind:'feature',
      label:'Product Validator',
      version:VERSION,
      updateUrl:UPDATE_URL,
      available:ready,
      ready,
      reason:ready?'Selecteer producten om ze te controleren':'Open het productoverzicht'
    });
  }

  function selected(){
    return boxes()
      .filter(box=>box.checked)
      .map(box=>{
        const row=box.closest('tr');
        const cells=[...row?.querySelectorAll('td')||[]];

        return {
          id:String(box.value||'').trim(),
          name:String(cells.find(cell=>cell!==box.closest('td'))?.innerText||'').trim().split('\n')[0],
          row
        };
      })
      .filter(item=>/^\d+$/.test(item.id)&&item.row);
  }

  function installStyle(){
    if(document.getElementById('ddo-product-validator-style'))return;

    const style=document.createElement('style');
    style.id='ddo-product-validator-style';
    style.textContent=`
      tr.ddo-validator-error>td{background:#ffe3e3!important}
      tr.ddo-validator-unreadable>td{background:#fff2c7!important}
      .${BADGE}{
        display:inline-block;
        margin-left:6px;
        padding:1px 5px;
        border-radius:10px;
        color:#fff;
        font:600 10px/1.4 system-ui;
        vertical-align:middle
      }
      tr.ddo-validator-error .${BADGE}{background:#b42318}
      tr.ddo-validator-unreadable .${BADGE}{background:#a15c00}
      tr.ddo-validator-ok .${BADGE}{background:#21863a}
    `;
    document.head.append(style);
  }

  function clearMarks(){
    document
      .querySelectorAll('tr.ddo-validator-error,tr.ddo-validator-unreadable,tr.ddo-validator-ok')
      .forEach(row=>row.classList.remove(
        'ddo-validator-error',
        'ddo-validator-unreadable',
        'ddo-validator-ok'
      ));

    document.querySelectorAll(`.${BADGE}`).forEach(node=>node.remove());
  }

  function mark(item,type,text,title){
    item.row.classList.remove(
      'ddo-validator-error',
      'ddo-validator-unreadable',
      'ddo-validator-ok'
    );

    item.row.querySelectorAll(`.${BADGE}`).forEach(node=>node.remove());
    item.row.classList.add(`ddo-validator-${type}`);

    const cell=item.row.querySelector('td:nth-child(2)')||item.row.querySelector('td');
    if(!cell)return;

    const badge=document.createElement('span');
    badge.className=BADGE;
    badge.textContent=text;
    badge.title=title;
    cell.append(badge);
  }

  function panel(){
    let node=document.getElementById(PANEL_ID);
    if(node)return node;

    node=document.createElement('div');
    node.id=PANEL_ID;
    node.style.cssText='margin:0 0 8px;padding:7px 9px;border:1px solid #cad5df;border-radius:6px;background:#f7fafc;color:#25313b;font:11px/1.3 system-ui;display:flex;align-items:center;gap:8px';

    const table=boxes()[0]?.closest('table');
    table?.parentNode?.insertBefore(node,table);

    return node;
  }

  function render(progress){
    const node=panel();
    if(!node)return;

    const canApply=!progress.running&&run?.results?.some(
      result=>!result.error&&fixable(result.currentChecks||result.checks)
    );

    node.innerHTML=`
      <strong>Product Validator</strong>
      <span>${safe(progress.status)}</span>
      <span>${progress.done}/${progress.total}</span>
      <span style="color:#b42318">${progress.errors} afwijkend</span>
      <span style="color:#a15c00">${progress.failed} mislukt</span>
      ${
        progress.running
          ?'<button type="button" data-action="stop">Stop</button>'
          :`${canApply?'<button type="button" data-action="apply">Pas wijzigingen toe</button>':''}${run?.results?.length?'<button type="button" data-action="export">Exporteer CSV</button>':''}`
      }
    `;

    node.querySelectorAll('button').forEach(button=>{
      button.style.cssText='margin-left:auto;border:0;border-radius:4px;padding:3px 7px;background:#0877b9;color:#fff;cursor:pointer';
    });

    node.querySelector('[data-action="stop"]')?.addEventListener('click',()=>{
      if(run)run.cancelled=true;
    });

    node.querySelector('[data-action="apply"]')?.addEventListener('click',applyChanges);
    node.querySelector('[data-action="export"]')?.addEventListener('click',exportCsv);
  }

  const csvCell=value=>`"${String(value??'').replace(/"/g,'""')}"`;

  function exportCsv(){
    if(!run?.results?.length)return;

    const headers=[
      'ProductID',
      'URL',
      'VIP prijs tab 1',
      'Meer dan 2 kleuren tab 2',
      'Prijs afwijkend tab 3',
      'Adviesprijs afwijkend tab 3',
      'VIP prijs tab 3',
      'NME in Reference',
      'Controle mislukt',
      'Wijzigingslog',
      'Wijziging mislukt'
    ];

    const rows=run.results.map(result=>[
      result.id,
      result.url,
      result.checks?.vipTab1?'✓':'',
      result.checks?.colorsTab2?'✓':'',
      result.checks?.priceTab3?'✓':'',
      result.checks?.adviceTab3?'✓':'',
      result.checks?.vipTab3?'✓':'',
      result.checks?.referenceNme?'✓':'',
      result.error||'',
      (result.changes||[]).join(' | '),
      result.applyError||''
    ]);

    const csv='\uFEFF'+
      [headers,...rows]
        .map(row=>row.map(csvCell).join(';'))
        .join('\r\n');

    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    const stamp=new Date().toISOString().slice(0,10);

    link.href=url;
    link.download=`ddo-product-validator-${stamp}.csv`;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function setValue(field,newValue){
    if(!field||field.value===newValue)return false;
    field.value=newValue;
    field.setAttribute('value',newValue);
    return true;
  }

  async function updateProduct(result){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);

    try{
      const doc=await fetchProduct(result.id,controller.signal);
      const form=doc.querySelector('input[name="price"]')?.closest('form');

      if(!form)throw new Error('productformulier niet gevonden');

      const mainPriceField=doc.querySelector('input[name="price"]');
      const mainAdviceField=doc.querySelector('input[name="price_advice"]');
      const mainVipField=doc.querySelector('input[name="price_vip"]');
      const referenceField=doc.querySelector('input[name="reference"]');

      const mainPrice=mainPriceField?.value;
      const mainAdvice=mainAdviceField?.value;

      const changes=[];

      if(cents(mainVipField?.value)!==0&&setValue(mainVipField,'0.00')){
        changes.push('VIP tab 1 → 0.00');
      }

      const sync=(name,source,label)=>{
        if(cents(source)===null)return;

        let count=0;

        doc.querySelectorAll(
          `#tabs-3 input[name^="options"][name$="[${name}]"]`
        ).forEach(field=>{
          if(cents(field.value)!==cents(source)&&setValue(field,source)){
            count++;
          }
        });

        if(count){
          changes.push(`${count} ${label} tab 3 overgenomen`);
        }
      };

      sync('price',mainPrice,'prijzen');
      sync('price_advice',mainAdvice,'adviesprijzen');

      let vipCount=0;

      doc.querySelectorAll(
        '#tabs-3 input[name^="options"][name$="[price_vip]"]'
      ).forEach(field=>{
        if(cents(field.value)!==0&&setValue(field,'0.00')){
          vipCount++;
        }
      });

      if(vipCount){
        changes.push(`${vipCount} VIP-prijzen tab 3 → 0.00`);
      }

      // NME → EXT
      //
      // Voorbeelden:
      // [NME]       → [EXT]
      // [nme]       → [EXT]
      // - [NME]     → - [EXT]
      // 07 - [NME]  → 07 - [EXT]
      //
      // Niets anders uit Reference wordt verwijderd of gewijzigd.
      if(referenceField&&/\[NME\]/i.test(referenceField.value)){
        const oldReference=referenceField.value;
        const newReference=oldReference.replace(/\[NME\]/gi,'[EXT]');

        if(setValue(referenceField,newReference)){
          changes.push(`Reference "${oldReference}" → "${newReference}"`);
        }
      }

      if(!changes.length){
        return {
          changes:[],
          validation:validateDocument(doc)
        };
      }

      const formData=new FormData(form);
      const submit=form.querySelector(
        'input[type="submit"][name="edit"],button[type="submit"][name="edit"],input[type="submit"][name]'
      );

      if(submit?.name){
        formData.set(submit.name,submit.value||'Update product');
      }

      const action=new URL(
        form.getAttribute('action')||result.url,
        result.url
      ).href;

      const response=await fetch(action,{
        method:(form.getAttribute('method')||'post').toUpperCase(),
        body:formData,
        credentials:'same-origin',
        cache:'no-store',
        signal:controller.signal
      });

      if(!response.ok){
        throw new Error(`opslaan gaf HTTP ${response.status}`);
      }

      result.changes=[...changes];

      const verifyDoc=await fetchProduct(result.id,controller.signal);
      const validation=validateDocument(verifyDoc);

      if(fixable(validation.checks)){
        throw new Error('nacontrole vond nog corrigeerbare afwijkingen');
      }

      return {
        changes,
        validation
      };
    }
    finally{
      clearTimeout(timer);
    }
  }

  async function applyChanges(){
    if(!run||run.running)return;

    const targets=run.results.filter(
      result=>!result.error&&fixable(result.currentChecks||result.checks)
    );

    if(!targets.length)return;

    if(!confirm(
      `Wijzig ${targets.length} product(en)?\n\n`+
      `VIP-prijzen worden 0.00.\n`+
      `Afwijkende prijzen en adviesprijzen op tab 3 worden gelijkgezet aan tab 1.\n`+
      `[NME] in Reference wordt vervangen door [EXT].\n\n`+
      `Overige inhoud van Reference en kleuren blijven ongemoeid.`
    ))return;

    run.running=true;
    run.cancelled=false;

    const progress={
      status:'Wijzigingen toepassen…',
      done:0,
      total:targets.length,
      errors:0,
      failed:0,
      running:true
    };

    render(progress);

    for(const result of targets){
      if(run.cancelled)break;

      try{
        const outcome=await updateProduct(result);

        result.changes=outcome.changes;
        result.applyError='';
        result.currentChecks=outcome.validation.checks;

        const remaining=outcome.validation.issues;

        if(remaining.length){
          progress.errors++;

          mark(
            result.item,
            'error',
            `⚠ ${remaining.length}`,
            `${remaining.join('\n')}\n\nGewijzigd: ${outcome.changes.join(' · ')}`
          );
        }
        else {
          mark(
            result.item,
            'ok',
            '✓ Hersteld',
            outcome.changes.join('\n')||'Was al correct'
          );
        }
      }
      catch(error){
        const message=String(error?.message||error);

        result.applyError=message;
        progress.failed++;

        mark(
          result.item,
          'unreadable',
          '? Wijziging mislukt',
          message
        );

        console.error(
          `[DDO Product Validator] Wijzigen product ${result.id}`,
          error
        );
      }

      progress.done++;
      render(progress);
    }

    progress.running=false;
    progress.status=run.cancelled
      ?'Wijzigen gestopt'
      :'Wijzigingen afgerond';

    run.running=false;
    render(progress);
  }

  async function fetchProduct(id,signal){
    const url=`${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(id)}`;

    const response=await fetch(url,{
      credentials:'same-origin',
      cache:'no-store',
      signal
    });

    if(!response.ok){
      throw new Error(`HTTP ${response.status}`);
    }

    const html=await response.text();
    const doc=new DOMParser().parseFromString(html,'text/html');

    if(
      doc.querySelector('input[type="password"]')||
      !doc.querySelector('input[name="price"]')
    ){
      throw new Error('productpagina niet herkenbaar');
    }

    return doc;
  }

  async function start(){
    if(!applicable()||run?.running)return;

    const items=selected();

    if(!items.length){
      alert('Selecteer eerst minimaal één product om te controleren.');
      return;
    }

    installStyle();
    clearMarks();

    run={
      running:true,
      cancelled:false,
      results:[]
    };

    const progress={
      status:'Controleren…',
      done:0,
      total:items.length,
      errors:0,
      failed:0,
      running:true
    };

    render(progress);

    for(const item of items){
      if(run.cancelled)break;

      const url=`${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(item.id)}`;
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),30000);

      try{
        const doc=await fetchProduct(item.id,controller.signal);
        const result=validateDocument(doc);

        run.results.push({
          id:item.id,
          url,
          item,
          checks:result.checks,
          currentChecks:result.checks,
          error:'',
          changes:[],
          applyError:''
        });

        if(result.issues.length){
          progress.errors++;

          mark(
            item,
            'error',
            `⚠ ${result.issues.length}`,
            result.issues.join('\n')
          );
        }
        else {
          mark(
            item,
            'ok',
            '✓ OK',
            'Geen afwijkingen gevonden'
          );
        }
      }
      catch(error){
        const message=String(error?.message||error);

        run.results.push({
          id:item.id,
          url,
          item,
          checks:null,
          currentChecks:null,
          error:message,
          changes:[],
          applyError:''
        });

        progress.failed++;

        mark(
          item,
          'unreadable',
          '? Mislukt',
          message
        );

        console.error(
          `[DDO Product Validator] Product ${item.id}`,
          error
        );
      }
      finally{
        clearTimeout(timer);
      }

      progress.done++;
      render(progress);
    }

    progress.running=false;
    progress.status=run.cancelled
      ?'Gestopt'
      :'Controle afgerond';

    run.running=false;
    render(progress);
  }

  document.addEventListener('ddo-toolbox:discover',report);

  document.addEventListener('ddo-toolbox:run-feature',event=>{
    let detail={};

    try{
      detail=JSON.parse(event.detail||'{}');
    }
    catch{}

    if(detail.id===ID){
      start();
    }
  });

  report();
})();
