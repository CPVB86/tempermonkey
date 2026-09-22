// ==UserScript==
// @name         DDO Toolbox | Adapter | Product Validator
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.4.1
// @description  Controleert producten op kleur-, prijs-, NME- en Supplier PID-afwijkingen en beheert Supplier PID-batches.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID='productValidator', VERSION='1.4.1';
  const UPDATE_URL='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-product-validator.user.js';
  const PANEL_ID='ddo-product-validator-status', BADGE='ddo-product-validator-badge';
  const BULK_PANEL_ID='ddo-product-validator-supplier-panel';
const REQUIRED_TAGS = {
  promo: 'SYST - Promo',
  webwinkelkeur: 'SYST - Webwinkelkeur'
};
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
    checks.referenceNme||
  checks.promoTag||
  checks.webwinkelkeurTag
  );

  function validateDocument(doc){
    const issues=[];
    const checks={
      vipTab1:false,
      colorsTab2:false,
      priceTab3:false,
      adviceTab3:false,
      vipTab3:false,
      referenceNme:false,
      supplierPid:false,
  promoTag:false,
  webwinkelkeurTag:false
    };

    const mainPrice=cents(value(doc,'price'));
    const mainAdvice=cents(value(doc,'price_advice'));
    const mainVip=cents(value(doc,'price_vip'));

    if(!String(value(doc,'supplier_pid')??'').trim()){
      checks.supplierPid=true;
      issues.push('Supplier PID ontbreekt op tab 1');
    }

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

// Verplichte tags op tab 7
const assignedTags=[...doc.querySelectorAll('tr[id^="tagdelete_"]')]
  .filter(row=>!row.classList.contains('empty_set'))
  .map(row=>(row.querySelector('td.control')?.textContent||'').trim().toLowerCase());

if(!assignedTags.includes(REQUIRED_TAGS.promo.toLowerCase())){
  checks.promoTag=true;
  issues.push(`Tag ontbreekt: ${REQUIRED_TAGS.promo}`);
}

if(!assignedTags.includes(REQUIRED_TAGS.webwinkelkeur.toLowerCase())){
  checks.webwinkelkeurTag=true;
  issues.push(`Tag ontbreekt: ${REQUIRED_TAGS.webwinkelkeur}`);
}

    return {issues,checks};
  }

  function report(){
    installSupplierBulkButton();
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

function summaryCounts(){
  const results=run?.results||[];

  return {
    vipTab1:results.filter(r=>r.checks?.vipTab1).length,
    referenceNme:results.filter(r=>r.checks?.referenceNme).length,
    supplierPid:results.filter(r=>r.checks?.supplierPid).length,

    colorsTab2:results.filter(r=>r.checks?.colorsTab2).length,

    priceTab3:results.filter(r=>r.checks?.priceTab3).length,
    adviceTab3:results.filter(r=>r.checks?.adviceTab3).length,
    vipTab3:results.filter(r=>r.checks?.vipTab3).length,

    promoTag:results.filter(r=>r.checks?.promoTag).length,
    webwinkelkeurTag:results.filter(r=>r.checks?.webwinkelkeurTag).length,

    failed:results.filter(r=>r.error).length
  };
}

function render(progress){
  const node=panel();
  if(!node)return;

  const canApply=!progress.running&&run?.results?.some(
    result=>!result.error&&fixable(result.currentChecks||result.checks)
  );

  const s=summaryCounts();

  node.style.cssText=`
    margin:0 0 8px;
    padding:7px 9px;
    border:1px solid #cad5df;
    border-radius:6px;
    background:#f7fafc;
    color:#25313b;
    font:11px/1.3 system-ui;
  `;

  node.innerHTML=`
    <div style="
      display:flex;
      align-items:center;
      gap:8px;
    ">
      <strong>Product Validator</strong>

      <span>${safe(progress.status)}</span>
      <span>${progress.done}/${progress.total}</span>

      <span style="color:#b42318">
        ${progress.errors} afwijkend
      </span>

      <span style="color:#a15c00">
        ${progress.failed} mislukt
      </span>

      <span style="flex:1"></span>

      ${
        progress.running
          ? '<button type="button" data-action="stop">Stop</button>'
          : `
              ${canApply
                ? '<button type="button" data-action="apply">Pas wijzigingen toe</button>'
                : ''
              }
              ${run?.results?.length
                ? '<button type="button" data-action="export">Exporteer CSV</button>'
                : ''
              }
            `
      }
    </div>

    <div style="
  margin-top:6px;
  padding-top:6px;
  border-top:1px solid #dce3e8;
  display:flex;
  gap:7px;
  align-items:center;
  flex-wrap:wrap;
  font-size:10px;
">

  <strong>Tab 1:</strong>

  <span title="VIP-prijs op tab 1 is niet 0,00">
    VIP-prijs <strong>${s.vipTab1}</strong>
  </span>

  <span title="Reference bevat [NME]">
    NME <strong>${s.referenceNme}</strong>
  </span>

  <span title="Supplier PID ontbreekt op tab 1">
    Supplier PID <strong>${s.supplierPid}</strong>
  </span>

  <span style="color:#aeb8bf">|</span>

  <strong>Tab 2:</strong>

  <span title="Producten met meer dan 2 kleuren">
    Dubbele kleuren <strong>${s.colorsTab2}</strong>
  </span>

  <span style="color:#aeb8bf">|</span>

  <strong>Tab 3:</strong>

  <span title="Optieprijzen die afwijken van de hoofdprijs">
    Prijs <strong>${s.priceTab3}</strong>
  </span>

  <span title="Optie-adviesprijzen die afwijken van de hoofdadviesprijs">
    Adviesprijs <strong>${s.adviceTab3}</strong>
  </span>

  <span title="VIP-prijzen bij opties hoger dan 0,00">
    VIP-prijs <strong>${s.vipTab3}</strong>
  </span>

<span style="color:#aeb8bf">|</span>

<strong>Tab 7:</strong>

<span title="Producten zonder SYST - Promo">
  Promo <strong>${s.promoTag}</strong>
</span>

<span title="Producten zonder SYST - Webwinkelkeur">
  Webwinkelkeur <strong>${s.webwinkelkeurTag}</strong>
</span>

<span style="color:#aeb8bf">|</span>

<span
  title="Producten die niet gecontroleerd konden worden"
  style="${s.failed?'color:#a15c00':''}"
>
  Niet controleerbaar <strong>${s.failed}</strong>
</span>

</div>
  `;

  node.querySelectorAll('button').forEach(button=>{
    button.style.cssText=`
      border:0;
      border-radius:4px;
      padding:3px 7px;
      background:#0877b9;
      color:#fff;
      cursor:pointer;
    `;
  });

  node.querySelector('[data-action="stop"]')
    ?.addEventListener('click',()=>{
      if(run)run.cancelled=true;
    });

  node.querySelector('[data-action="apply"]')
    ?.addEventListener('click',applyChanges);

  node.querySelector('[data-action="export"]')
    ?.addEventListener('click',exportCsv);
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
      'Supplier PID ontbreekt',
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
      result.checks?.supplierPid?'✓':'',
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
const tagsSelect=doc.querySelector('select[name="tags[]"]');

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

// Ontbrekende verplichte tags toevoegen
if(tagsSelect){
  const ensureTag=(label)=>{
    const option=[...tagsSelect.options].find(option=>
      (option.textContent||'').trim().toLowerCase()===label.toLowerCase()
    );

    if(!option){
      throw new Error(`Ontbrekende tag niet beschikbaar in tags[]: ${label}`);
    }

    if(!option.selected){
      option.selected=true;
      return true;
    }

    return false;
  };

  if(result.currentChecks?.promoTag && ensureTag(REQUIRED_TAGS.promo)){
    changes.push(`Tag toegevoegd: ${REQUIRED_TAGS.promo}`);
  }

  if(result.currentChecks?.webwinkelkeurTag && ensureTag(REQUIRED_TAGS.webwinkelkeur)){
    changes.push(`Tag toegevoegd: ${REQUIRED_TAGS.webwinkelkeur}`);
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

  const supplierBulkBrand=()=>{
    const query=params();
    return query.get('section')==='products'&&query.get('action')==='list'&&query.get('filter')==='brand_id'&&/^\d+$/.test(query.get('id')||'')?query.get('id'):'';
  };

  function parseSupplierBulk(text){
    const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
    if(!lines.length)throw new Error('Plak minimaal één regel met Product ID, oude Supplier ID en nieuwe Supplier ID.');
    const cells=line=>{
      const parts=[];let field='',quoted=false;
      for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++}else if(quoted||!field)quoted=!quoted;else field+=char}else if(char==='\t'&&!quoted){parts.push(field.trim());field=''}else field+=char}
      if(quoted)throw new Error('Niet afgesloten aanhalingsteken in plakgegevens.');parts.push(field.trim());return parts;
    };
    const first=cells(lines[0]).map(cell=>cell.toLocaleLowerCase('nl').replace(/\s+/g,' '));
    const header=first[0]==='product id'&&['oude supplier id','oude supplier pid'].includes(first[1])&&['nieuwe supplier id','nieuwe supplier pid'].includes(first[2]);
    const data=header?lines.slice(1):lines;
    if(!data.length)throw new Error('De lijst bevat alleen kolomkoppen.');
    const seen=new Set();
    return data.map((line,index)=>{
      const row=cells(line),number=index+1+(header?1:0);
      if(row.length!==3)throw new Error(`Regel ${number}: precies drie kolommen vereist.`);
      const [id,oldPid,newPid]=row;
      if(!/^\d+$/.test(id)||id==='0')throw new Error(`Regel ${number}: ongeldig Product ID.`);
      if(seen.has(id))throw new Error(`Product ID ${id} staat dubbel in de lijst.`);
      if(!newPid)throw new Error(`Regel ${number}: nieuwe Supplier ID ontbreekt.`);
      seen.add(id);
      return {id,oldPid,newPid,checked:false,done:false,error:'',message:'Nog niet gecontroleerd'};
    });
  }

  function inspectSupplierProduct(doc,item,brandId){
    const brand=doc.querySelector('select[name="brand_id"],input[name="brand_id"]')?.value;
    if(!brand||brand!==brandId)throw new Error(`Merk-ID wijkt af: ${brand||'onbekend'} ≠ ${brandId}.`);
    const field=doc.querySelector('input[name="supplier_pid"]');
    if(!field)throw new Error('Supplier PID-veld ontbreekt.');
    const current=field.value.trim();
    if(current!==item.oldPid)throw new Error(`Oude Supplier ID wijkt af: “${current}” ≠ “${item.oldPid}”.`);
    const form=field.closest('form');
    if(!form)throw new Error('Productformulier ontbreekt.');
    const page=`${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(item.id)}`;
    const action=new URL(form.getAttribute('action')||page,page);
    if(action.origin!==location.origin||action.pathname!=='/admin.php'||action.searchParams.get('section')!=='products'||action.searchParams.get('action')!=='edit'||action.searchParams.get('id')!==item.id||String(form.getAttribute('method')||'post').toLowerCase()!=='post')throw new Error('Onverwachte formulieractie; niet opslaan.');
    return {field,form,action:action.href,changed:current!==item.newPid};
  }

  async function saveSupplierProduct(item,brandId){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const doc=await fetchProduct(item.id,controller.signal);
      const prepared=inspectSupplierProduct(doc,item,brandId);
      if(!prepared.changed)return 'Reeds correct';
      prepared.field.value=item.newPid;
      const body=new FormData(prepared.form);
      body.set('supplier_pid',item.newPid);
      const submit=prepared.form.querySelector('input[type="submit"][name="edit"],button[type="submit"][name="edit"],input[type="submit"][name]');
      if(submit?.name)body.set(submit.name,submit.value||'Update product');
      const response=await fetch(prepared.action,{method:'POST',body,credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(`Opslaan gaf HTTP ${response.status}.`);
      const verified=await fetchProduct(item.id,controller.signal);
      const current=verified.querySelector('input[name="supplier_pid"]')?.value.trim();
      if(current!==item.newPid)throw new Error(`Nacontrole mislukt: Supplier PID is “${current??'ontbreekt'}”.`);
      return 'Gewijzigd en geverifieerd';
    }finally{clearTimeout(timer)}
  }

  function installSupplierBulkButton(){
    const brandId=supplierBulkBrand();
    if(!brandId)return;
    const coreAccess=window.__ddoToolbox?.isEnabled?.(ID);
    if(coreAccess===false)return;
    if(coreAccess!==true){
      // GM_xxx- en @grant none-scripts kunnen in gescheiden werelden draaien.
      // Neem dan dezelfde expliciete namenlijst als de Core, nooit een open fallback.
      const name=document.querySelector('.profile .profile_content h1,.profile h1')?.textContent?.replace(/\s+/g,' ').trim().toLocaleLowerCase('nl')||'';
      if(!['chantor pascal van beek','folkert van beek','monique van beek','chantal timmer','anke adams'].includes(name))return;
    }
    const toolbox=document.getElementById('ddo-toolbox');
    if(!toolbox||document.getElementById(BULK_PANEL_ID))return;
    const section=document.createElement('section');section.id=BULK_PANEL_ID;section.className='ddo-module-panel';
    const title=document.createElement('div');title.className='ddo-edi-title';title.textContent='Product Validator';
    const row=document.createElement('div');row.className='ddo-edi-row';row.style.display='block';
    const control=document.createElement('button');control.type='button';control.className='ddo-edi-action';control.style.width='100%';control.textContent='Supplier ID’s wijzigen';control.title='Wijzig Supplier PID’s in bulk na exacte controle van Product ID, merk en oude Supplier ID';control.onclick=()=>openSupplierBulk(brandId);
    row.append(control);section.append(title,row);toolbox.querySelector('#ddo-edi-panel')?.insertAdjacentElement('afterend',section)||toolbox.append(section);
  }

  function openSupplierBulk(brandId){
    if(document.getElementById('ddo-supplier-bulk-dialog'))return;
    const dialog=document.createElement('dialog');dialog.id='ddo-supplier-bulk-dialog';dialog.style.cssText='width:900px;max-width:95vw;max-height:90vh;padding:0 12px 12px;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0003;background:#fff;color:#25313b;font:12px/1.3 system-ui';document.body.append(dialog);
    const heading=document.createElement('h2');heading.textContent=`Supplier ID’s wijzigen · merk ${brandId}`;heading.style.cssText='margin:0 -12px 8px;padding:8px 38px 8px 10px;background:#263746;color:#fff;border-radius:6px 6px 0 0;font:650 13px/1.2 system-ui';dialog.append(heading);
    const makeButton=(label,parent,handler)=>{const control=document.createElement('button');control.type='button';control.textContent=label;control.style.cssText='padding:7px 10px;border:0;border-radius:4px;background:#0877b9;color:#fff;font:600 11px/1.2 system-ui;cursor:pointer';control.onclick=handler;parent.append(control);return control};
    const close=makeButton('×',dialog,()=>dialog.close());close.title='Sluiten';close.style.cssText='position:absolute;right:7px;top:4px;width:25px;height:25px;padding:0;border:0;background:transparent;color:#fff;font:20px/1 system-ui;cursor:pointer';
    const intro=document.createElement('p');intro.textContent='Plak drie tabgescheiden kolommen: Product ID, oude Supplier ID, nieuwe Supplier ID. Een lege oude ID is toegestaan en wordt exact vergeleken. Alleen producten van dit merk worden verwerkt.';intro.style.margin='8px 0';dialog.append(intro);
    const input=document.createElement('textarea');input.placeholder='Product ID\toude Supplier ID\tnieuwe Supplier ID';input.setAttribute('aria-label','Supplier ID-bulklijst');input.style.cssText='box-sizing:border-box;width:100%;height:105px;padding:8px;border:1px solid #cbd5df;border-radius:4px;font:12px/1.35 monospace';dialog.append(input);
    const controls=document.createElement('div');controls.style.cssText='display:flex;gap:6px;margin:8px 0';dialog.append(controls);
    const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='min-height:16px;margin:6px 0';dialog.append(status);
    const scroller=document.createElement('div');scroller.style.cssText='max-height:45vh;overflow:auto;border:1px solid #cbd5df;border-radius:4px';dialog.append(scroller);
    const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse';scroller.append(table);
    const header=table.createTHead().insertRow();for(const label of ['Product ID','Oude Supplier ID','Nieuwe Supplier ID','Status']){const cell=header.insertCell();cell.textContent=label;cell.style.cssText='padding:5px;background:#edf2f7;text-align:left'}
    const body=table.createTBody();let items=[],busy=false,stop=false;
    const check=makeButton('Controleren',controls,()=>checkRows());const apply=makeButton('Uitvoeren',controls,()=>applyRows());const halt=makeButton('Stop na huidige regel',controls,()=>{stop=true});
    const update=()=>{check.disabled=busy||!input.value.trim();apply.disabled=busy||!items.length||items.some(item=>!item.checked)||!items.some(item=>!item.done);halt.disabled=!busy;close.disabled=busy;input.disabled=busy;for(const control of [check,apply,halt])control.style.opacity=control.disabled?'.5':'1'};
    const draw=()=>{body.replaceChildren();for(const item of items){const row=body.insertRow();for(const value of [item.id,item.oldPid,item.newPid,item.message]){const cell=row.insertCell();cell.textContent=value;cell.style.cssText=`padding:5px;border-bottom:1px solid #e2e8f0;${item.error?'color:#b91c1c':''}`}}};
    input.oninput=()=>{items=[];body.replaceChildren();status.textContent='Lijst gewijzigd; opnieuw controleren.';update()};
    async function checkRows(){try{items=parseSupplierBulk(input.value)}catch(error){status.textContent=error.message;update();return}busy=true;stop=false;update();draw();let count=0;for(const item of items){if(stop)break;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const doc=await fetchProduct(item.id,controller.signal),prepared=inspectSupplierProduct(doc,item,brandId);item.checked=true;item.done=!prepared.changed;item.error='';item.message=prepared.changed?'Klaar om te wijzigen':'Reeds correct'}catch(error){item.checked=false;item.error=String(error.message||error);item.message=item.error}finally{clearTimeout(timer)}count++;status.textContent=`${count}/${items.length} gecontroleerd · ${items.length-count} resterend`;draw()}busy=false;status.textContent=items.some(item=>!item.checked)?'Controle niet compleet; corrigeer de gemarkeerde regels.':`${count}/${items.length} gecontroleerd · ${items.filter(item=>!item.done).length} te wijzigen`;update()}
    async function applyRows(){if(items.some(item=>!item.checked)||!items.some(item=>!item.done))return;if(!confirm(`Wijzig de Supplier PID van ${items.filter(item=>!item.done).length} product(en)? De oude waarde en het merk worden vóór iedere opslag opnieuw exact gecontroleerd.`))return;busy=true;stop=false;update();let count=items.filter(item=>item.done).length;try{if(!navigator.locks)throw new Error('Browser ondersteunt geen batchvergrendeling.');await navigator.locks.request('ddo-supplier-pid-batch',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Er loopt al een Supplier PID-batch in een ander tabblad.');for(const item of items){if(stop)break;if(item.done)continue;try{item.message=await saveSupplierProduct(item,brandId);item.done=true;count++}catch(error){item.error=String(error.message||error);item.message=`Gestopt: ${item.error}`;stop=true}status.textContent=`${count}/${items.length} verwerkt · ${items.length-count} resterend`;draw()}})}catch(error){status.textContent=error.message}finally{busy=false;update()}}
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});dialog.addEventListener('close',()=>dialog.remove());update();dialog.showModal();input.focus();
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
