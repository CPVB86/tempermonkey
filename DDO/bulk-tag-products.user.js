// ==UserScript==
// @name         DDO | Bulk Tag Products
// @namespace    ddo-bulk-prune-products
// @version      2.1
// @description  Selecteert ECHT alle producten, zet tags via Select2 of direct op de <select>, en triggert de echte submit (editmulti). Ranges & dry/apply.
// @match        https://www.dutchdesignersoutlet.com/admin.php*section=products*
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/bulk-tag-products.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/bulk-tag-products.user.js
// ==/UserScript==

(function(){
  "use strict";

  // ---------- Config ----------
  const URL_PREFIX = "https://www.dutchdesignersoutlet.com/admin.php?section=products&page=";
  const START_PAGE_DEFAULT = 1;
  const END_PAGE_DEFAULT   = 227;

  // Tags die je wilt toevoegen
  const TAGS = [
    "SYST - Prune Me",
    "SYST - Webwinkelkeur",
    "SYST - Promo",
  ];

  // ---------- State ----------
  const LS_KEY = "ddo_bulk_tag_state";
  const S = () => { try{ return JSON.parse(localStorage.getItem(LS_KEY))||{} } catch{ return {} } };
  const W = (v) => localStorage.setItem(LS_KEY, JSON.stringify(v));

  function setRunFlags({apply=false, autoNext=true, singlePage=false}){
    const s=S();
    s.apply      = !!apply;
    s.autoNext   = !!autoNext;
    s.singlePage = !!singlePage;
    W(s);
  }

  // ---------- Helpers ----------
  const $  = (sel,root=document)=> (root||document).querySelector(sel);
  const $$ = (sel,root=document)=> Array.from((root||document).querySelectorAll(sel));
  const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(getter, {timeout=12000, step=120}={}){
    const t0=Date.now();
    while(Date.now()-t0<timeout){
      const el = (typeof getter==='function') ? getter() : (document.querySelector(getter));
      if (el) return el;
      await wait(step);
    }
    return null;
  }
  const pageFromUrl = ()=> parseInt((new URL(location.href)).searchParams.get("page")||"0",10)||null;
  const click = (el)=>{ if(!el) return; el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.click(); el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); };

  // ---------- Overlay ----------
  GM_addStyle(`
    #ddo-overlay{position:fixed;right:12px;bottom:12px;background:rgba(0,0,0,.9);color:#fff;z-index:99999;padding:10px 12px;border-radius:10px;font:12px/1.4 system-ui, sans-serif;min-width:320px}
    #ddo-overlay b{font-weight:700}
    #ddo-overlay .muted{opacity:.8}
  `);
  function overlay(msg){
    const s=S();
    let box = $('#ddo-overlay');
    if(!box){ box=document.createElement('div'); box.id='ddo-overlay'; document.body.appendChild(box); }
    if(msg){ s.msg=msg; W(s); }
    box.innerHTML = `
      <div><b>DDO Bulk Tag</b> ${s.apply?'• APPLY':'• Dry'}</div>
      <div>Range: ${s.start||'-'} → ${s.end||'-'} | page: ${s.current||'-'}</div>
      <div>AutoNext: ${s.autoNext?'aan':'uit'} | Single: ${s.singlePage?'ja':'nee'}</div>
      <div>Status: ${s.running?'actief':'idle'}</div>
      <div class="muted">${s.msg||''}</div>
    `;
  }
  setInterval(()=>overlay(),500);

  // ---------- Selectie: ALLES aan + failsafe hidden inputs ----------
  function ensureAllProductsSelected(form){
    const rows = $$('tbody input[type="checkbox"][name="products[]"]', form);
    let toggled = 0;
    for(const cb of rows){
      if(!cb.checked){
        cb.checked = true;
        cb.dispatchEvent(new Event('change',{bubbles:true}));
        toggled++;
      }
    }
    const checked = $$('input[type="checkbox"][name="products[]"]:checked', form).length;
    if (checked === 0 && rows.length){
      let bucket = $('#ddo-hidden-products', form);
      if(!bucket){
        bucket = document.createElement('div');
        bucket.id = 'ddo-hidden-products';
        bucket.style.display='none';
        form.appendChild(bucket);
      } else {
        bucket.innerHTML = '';
      }
      for(const cb of rows){
        const hid = document.createElement('input');
        hid.type = 'hidden';
        hid.name = 'products[]';
        hid.value = cb.value;
        bucket.appendChild(hid);
      }
      return {checked: rows.length, forcedHidden: true, toggled};
    }
    return {checked, forcedHidden:false, toggled};
  }

  // ---------- Select2 helpers ----------
  function findSelect2Container(select){
    // 1) direct next sibling
    let sib = select && select.nextElementSibling;
    if(sib && (sib.classList.contains('select2') || sib.classList.contains('select2-container'))) return sib;

    // 2) siblings in parent
    if(select && select.parentNode){
      const cands = $$('.select2, .select2-container', select.parentNode);
      const direct = cands.find(el => el.previousElementSibling===select);
      if(direct) return direct;
      if(cands.length) return cands[0];
    }

    // 3) global heuristic
    const all = $$('.select2, .select2-container');
    const near = all.find(el => el.previousElementSibling===select);
    return near || null;
  }

  function selectOptionByText(select, wanted){
    if(!select) return false;
    const opts = Array.from(select.options||[]);
    // perfecte match op text of value
    let cand = opts.find(o => (o.text||'').trim().toLowerCase() === wanted.toLowerCase());
    if(!cand)   cand = opts.find(o => (o.value||'').trim().toLowerCase() === wanted.toLowerCase());
    if(!cand)   cand = opts.find(o => (o.text||'').toLowerCase().includes(wanted.toLowerCase()));
    if(cand){
      cand.selected = true;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }
    return false;
  }

  // ---------- Select2/Select: tags zetten ----------
  async function ensureTags(tab2Root, tagTexts){
    const select = tab2Root.querySelector('select[name="tags[]"]');
    if(!select) return {ok:false, reason:'tags[] select niet gevonden'};

    const container = findSelect2Container(select);

    const openSelect2 = async ()=>{
      if(!container) return;
      const selection = $('.select2-selection', container) || container;
      click(selection);
      await wait(50);
    };

    const hasChip = (label)=>{
      if(container){
        const chips = $$('.select2-selection__rendered li', container).map(li=>(li.textContent||'').trim().toLowerCase());
        return chips.includes(label.toLowerCase());
      }
      // fallback: kijk naar onderliggende select
      return Array.from(select.selectedOptions||[]).some(o => (o.text||'').trim().toLowerCase() === label.toLowerCase());
    };

    const pickResult = async (wanted, timeout=6000)=>{
      const until = Date.now()+timeout;
      while(Date.now()<until){
        const list = $('.select2-results__options'); // wordt in body gerenderd
        if(list){
          const items = $$('li.select2-results__option', list).filter(li=>!li.classList.contains('loading-results'));
          let cand = items.find(li => (li.textContent||'').trim().toLowerCase() === wanted.toLowerCase());
          if(!cand) cand = items.find(li => (li.textContent||'').toLowerCase().includes(wanted.toLowerCase()));
          if(cand){
            click(cand);
            select.dispatchEvent(new Event('change',{bubbles:true}));
            return true;
          }
        }
        await wait(120);
      }
      return false;
    };

    const added=[], failed=[];
    for(const label of tagTexts){
      if (hasChip(label)) continue;

      if(container){
        await openSelect2();
        const input = await waitFor(()=>$('.select2-search__field'), {timeout:4000, step:60});
        if(!input){
          // probeer direct op de select te kiezen
          const ok = selectOptionByText(select, label);
          ok ? added.push(label) : failed.push({tag:label, reason:'geen search veld'});
          continue;
        }
        input.value = '';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.focus();
        for(const ch of label){
          input.value += ch;
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:ch}));
          await wait(8);
        }

        let ok = await pickResult(label, 6000);
        if(!ok){
          // Enter voor eerste optie
          input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',code:'Enter'}));
          input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Enter',code:'Enter'}));
          await wait(150);
          ok = (select.selectedOptions||[]).length>0 && hasChip(label);
        }
        ok ? added.push(label) : failed.push({tag:label, reason:'geen match/keuze'});
        await wait(120);
      } else {
        // Geen Select2-container: kies rechtstreeks op de select
        const ok = selectOptionByText(select, label);
        ok ? added.push(label) : failed.push({tag:label, reason:'geen container & geen optie'});
      }
    }

    // Sluit dropdown netjes
    if(container){
      document.activeElement && document.activeElement.blur();
      document.body.click();
    }

    const selectedCount = (select.selectedOptions||[]).length;
    return {ok: selectedCount>0, added, failed, selectedCount, containerFound: !!container};
  }

  // ---------- Submit: echte knop "editmulti" ----------
  async function hardSubmit(tab2Root){
    const btn = tab2Root.querySelector('input[type="submit"][name="editmulti"], button[name="editmulti"]')
             || tab2Root.querySelector('input[type="submit"][value="Edit products"]')
             || tab2Root.querySelector('input[type="submit"], button[type="submit"]');
    const form = (btn && (btn.form || btn.closest('form'))) || $('form.validate.ajax_form') || $('form');
    if(!form) return {ok:false, reason:'form niet gevonden'};

    try{ if(btn) click(btn); }catch{}
    try{
      if(typeof form.requestSubmit === 'function'){
        form.requestSubmit(btn||undefined);
      } else {
        if(btn && btn.name){
          const tmp = document.createElement('input');
          tmp.type='hidden'; tmp.name=btn.name; tmp.value=btn.value||'Edit products';
          form.appendChild(tmp);
        }
        form.submit();
      }
    }catch(e){
      try{ form.submit(); }catch{}
    }
    return {ok:true};
  }

  // ---------- Flow per pagina ----------
  async function runOnPage(){
    const s=S(); if(!s.running) return;

    const here = pageFromUrl();
    if(here && s.current !== here){ s.current = here; W(s); }

    await waitFor('#tabs-1, #tabs-2', {timeout:15000});

    const form = $('form.validate.ajax_form') || $('form');
    if(!form){ overlay('❌ Geen formulier gevonden'); return afterPage(false,'no form'); }
    const sel = ensureAllProductsSelected(form);
    overlay(`Selectie: ${sel.checked}${sel.forcedHidden?' (hidden forced)':''}`);

    const tab2Link = $('[href="#tabs-2"], [aria-controls="tabs-2"]') || $('#tabs-2');
    if(tab2Link && tab2Link !== $('#tabs-2')){ click(tab2Link); await wait(250); }
    const tab2 = await waitFor('#tabs-2', {timeout:6000});
    if(!tab2){ overlay('❌ #tabs-2 niet gevonden'); return afterPage(false,'tab2'); }

    const tagRes = await ensureTags(tab2, TAGS);
    if(!tagRes.ok){
      overlay(`⚠️ Tags deels/niet gezet. Added: ${tagRes.added?.join(', ')||'—'} | Missed: ${tagRes.failed?.map(f=>f.tag).join(', ')||'—'} | container: ${tagRes.containerFound?'ja':'nee'}`);
      if (S().apply){ overlay('Stop: geen tags geselecteerd (safe)'); return afterPage(false,'no tags'); }
    } else {
      overlay(`✅ Tags gezet (${tagRes.selectedCount} geselecteerd) • container: ${tagRes.containerFound?'ja':'nee'}`);
    }

    if(s.apply){
      s.current = (s.current||START_PAGE_DEFAULT) + 1; W(s);
      const sub = await hardSubmit(tab2);
      if(!sub.ok){ overlay('❌ Submit mislukt'); return afterPage(false,'submit'); }
      overlay('⏳ Bezig met bewerken…');
      await wait(1800);
      if (S().autoNext && !S().singlePage){
        gotoCurrent();
      }
    } else {
      overlay('ℹ️ Dry-run: geen submit');
      afterPage(true,'dry');
    }
  }

  function afterPage(ok, why){
    const s=S();
    if (s.singlePage || !s.autoNext){ s.running=false; W(s); return; }
    s.current = (s.current||START_PAGE_DEFAULT)+1;
    W(s);
    setTimeout(()=>gotoCurrent(), 150);
  }

  function gotoCurrent(){
    const s=S(); if(!s.running) return;
    if (s.current > (s.end||END_PAGE_DEFAULT)){
      s.running=false; W(s); overlay('Klaar met range'); alert('Klaar 🤘'); return;
    }
    const want = URL_PREFIX + s.current;
    if (location.href !== want){ overlay(`→ Ga naar ${s.current}`); location.href = want; }
    else { runOnPage(); }
  }

  // ---------- Menu ----------
  GM_registerMenuCommand("Start DRY (1→227)", ()=>{
    const s=S(); s.running=true; s.start=START_PAGE_DEFAULT; s.end=END_PAGE_DEFAULT;
    s.current = pageFromUrl() || s.start; W(s);
    setRunFlags({apply:false, autoNext:true, singlePage:false});
    overlay(`Dry start @${s.current}`); gotoCurrent();
  });

  GM_registerMenuCommand("Start DRY (huidige pagina)", ()=>{
    const s=S(); s.running=true; s.start=s.end=s.current = pageFromUrl()||START_PAGE_DEFAULT; W(s);
    setRunFlags({apply:false, autoNext:false, singlePage:true});
    overlay('Dry op huidige pagina'); runOnPage();
  });

  GM_registerMenuCommand("Start APPLY (1→227)", ()=>{
    const s=S(); s.running=true; s.start=START_PAGE_DEFAULT; s.end=END_PAGE_DEFAULT;
    s.current = pageFromUrl() || s.start; W(s);
    setRunFlags({apply:true, autoNext:true, singlePage:false});
    overlay(`Apply start @${s.current}`); gotoCurrent();
  });

  GM_registerMenuCommand("Start APPLY (huidige pagina)", ()=>{
    const s=S(); s.running=true; s.start=s.end=s.current = pageFromUrl()||START_PAGE_DEFAULT; W(s);
    setRunFlags({apply:true, autoNext:false, singlePage:true});
    overlay('Apply op huidige pagina'); runOnPage();
  });

  GM_registerMenuCommand("Start (custom range…)", ()=>{
    const s=S();
    let from = prompt("Startpagina:", String(pageFromUrl()||START_PAGE_DEFAULT)); if(from===null) return;
    let to   = prompt(`Eindpagina (max ${END_PAGE_DEFAULT}):`, String(END_PAGE_DEFAULT)); if(to===null) return;
    from = Math.max(1, Math.min(END_PAGE_DEFAULT, parseInt(from,10)||START_PAGE_DEFAULT));
    to   = Math.max(1, Math.min(END_PAGE_DEFAULT, parseInt(to,10)||END_PAGE_DEFAULT));
    if(to<from) [from,to]=[to,from];
    s.running=true; s.start=from; s.end=to; s.current = (pageFromUrl()>=from&&pageFromUrl()<=to)?pageFromUrl():from; W(s);
    const apply = confirm("APPLY aan? (OK=Apply, Annuleren=Dry)");
    setRunFlags({apply, autoNext:true, singlePage:false});
    overlay(`${apply?'Apply':'Dry'}: ${s.current}→${s.end}`); gotoCurrent();
  });

  GM_registerMenuCommand("Toggle AutoNext", ()=>{ const s=S(); s.autoNext=!s.autoNext; W(s); overlay(`AutoNext: ${s.autoNext?'aan':'uit'}`); });
  GM_registerMenuCommand("Stop", ()=>{ const s=S(); s.running=false; W(s); overlay('Gestopt'); alert('Gestopt'); });
  GM_registerMenuCommand("Reset state", ()=>{ localStorage.removeItem(LS_KEY); alert('State gewist'); location.reload(); });

  // ---------- Auto-run ----------
  (function init(){
    const s=S();
    if(s.running){
      const want = s.current || START_PAGE_DEFAULT;
      const here = pageFromUrl();
      if(!String(location.href).startsWith(URL_PREFIX) || (here && here!==want)) gotoCurrent();
      else runOnPage();
    } else {
      overlay('Idle (gebruik Tampermonkey menu)');
    }
  })();

})();
