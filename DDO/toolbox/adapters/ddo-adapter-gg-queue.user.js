// ==UserScript==
// @name         DDO Toolbox | Adapter | GoedGepickt Queue
// @namespace    https://dutchdesignersoutlet.nl/
// @version      1.1.1
// @description  Pusht geselecteerde DDO-producten één voor één via de bestaande GoedGepickt-knop.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js
// ==/UserScript==

(() => {
  'use strict';

  const ID='ggQueue', VERSION='1.1.1';
  const UPDATE_URL='https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-gg-queue.user.js';
  const STORAGE_KEY='__DDO_GG_QUEUE_V1__', SOURCE_KEY='__DDO_GG_QUEUE_SOURCE__', TIMEOUT=90000, PANEL_ID='ddo-gg-queue-panel', WORKER_NAME='ddo-gg-queue-worker';
  const params=()=>new URLSearchParams(location.search);
  const allowed=()=>window.__ddoToolbox?.isEnabled?.(ID)!==false;
  const productPage=()=>params().get('section')==='products';
  const editId=()=>productPage()&&params().get('action')==='edit'?params().get('id'):'';
  const listPage=()=>productPage()&&params().get('action')!=='edit';
  const boxes=()=>[...document.querySelectorAll('input[type="checkbox"][name="products[]"]')];
  const applicable=()=>allowed()&&listPage()&&boxes().length>0;
  const send=(name,data)=>document.dispatchEvent(new CustomEvent(`ddo-toolbox:${name}`,{detail:JSON.stringify(data)}));
  const productUrl=id=>`${location.origin}/admin.php?section=products&action=edit&id=${encodeURIComponent(id)}`;
  const isWorker=()=>window.name===WORKER_NAME;
  const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

  function state(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(error){console.error('[DDO GG Queue] State lezen mislukt',error);return null}}
  function save(value){localStorage.setItem(STORAGE_KEY,JSON.stringify(value));render()}
  function clear(){localStorage.removeItem(STORAGE_KEY);render()}
  function report(){const ready=applicable();send('adapter-state',{id:ID,kind:'feature',label:'GG Queue',version:VERSION,updateUrl:UPDATE_URL,available:ready,ready,reason:ready?'Selecteer producten en start de queue':'Open een productlijst'})}

  function selected(){return boxes().filter(box=>box.checked).map(box=>{const row=box.closest('tr'),cells=[...row?.querySelectorAll('td')||[]];return{id:String(box.value||'').trim(),name:String(cells[1]?.innerText||'').trim().split('\n')[0].trim()}}).filter(item=>/^\d+$/.test(item.id))}
  function start(){if(!applicable())return;const queue=selected();if(!queue.length){alert('Selecteer eerst minimaal één product dat naar GoedGepickt moet.');return}const current=state();if(current&&['running','pushing','paused'].includes(current.status)&&!confirm('Er bestaat al een GG Queue.\n\nWil je die vervangen door de huidige selectie?'))return;sessionStorage.setItem(SOURCE_KEY,location.href);save({version:1,status:'running',queue,index:0,currentId:null,currentName:'',lastSuccessId:null,lastSuccessName:'',startedAt:new Date().toISOString(),pushStartedAt:null,error:null});openCurrent()}
  function openCurrent(){const current=state();if(!current||current.status!=='running')return;if(current.index>=current.queue.length){finish();return}const product=current.queue[current.index];current.currentId=product.id;current.currentName=product.name||'';current.error=null;save(current);const target=productUrl(product.id);if(isWorker()){location.href=target;return}const worker=window.open(target,WORKER_NAME);if(!worker)pause('Het Queue-tabblad kon niet worden geopend. Sta pop-ups voor DDO toe en probeer opnieuw.')}
  function pause(message){const current=state();if(!current)return;current.status='paused';current.error={time:new Date().toISOString(),message};save(current);console.error('[DDO GG Queue]',message)}
  function finish(){const current=state();if(!current)return;current.status='finished';current.currentId=null;current.currentName='';current.pushStartedAt=null;save(current)}

  function push(){const current=state(),pageId=editId(),expected=current?.queue?.[current.index];if(!current||current.status!=='running'||!expected)return;if(String(pageId)!==String(expected.id)){pause(`Onverwacht product. Verwacht ${expected.id}, geopend ${pageId||'onbekend'}.`);return}const button=document.querySelector('input[name="gg_product_add"],button[name="gg_product_add"]');if(!button){pause('De knop “Add product to WMS” is niet gevonden.');return}current.status='pushing';current.currentId=pageId;current.currentName=expected.name||'';current.pushStartedAt=new Date().toISOString();current.error=null;save(current);button.click();setTimeout(()=>{const latest=state();if(latest?.status==='pushing'&&String(latest.currentId)===String(pageId))pause('Geen succesvolle reload ontvangen binnen 90 seconden.')},TIMEOUT)}
  function handleEdit(){const current=state(),pageId=editId();if(!isWorker()||!current||!pageId||!allowed())return;const expected=current.queue?.[current.index];if(!expected){finish();return}if(current.status==='pushing'&&String(pageId)===String(current.currentId)){current.lastSuccessId=current.currentId;current.lastSuccessName=current.currentName;current.index++;current.currentId=null;current.currentName='';current.pushStartedAt=null;current.error=null;if(current.index>=current.queue.length){current.status='finished';save(current);return}current.status='running';save(current);openCurrent();return}if(current.status==='running'&&String(pageId)===String(expected.id)){push();return}if(['running','pushing'].includes(current.status))pause(`Onverwacht product. Verwacht ${expected.id}, geopend ${pageId}.`)}

  function retry(){const current=state();if(current?.status!=='paused')return;const product=current.queue?.[current.index];if(!product)return;if(!confirm(`Product ${product.id} opnieuw proberen?\n\nControleer bij twijfel eerst of het al in GoedGepickt staat.`))return;current.status='running';current.pushStartedAt=null;current.error=null;save(current);if(isWorker())location.href=productUrl(product.id);else openCurrent()}
  function skip(){const current=state();if(current?.status!=='paused')return;const product=current.queue?.[current.index];if(!product||!confirm(`Product ${product.id} overslaan?\n\n${product.name||''}`))return;current.index++;current.currentId=null;current.currentName='';current.pushStartedAt=null;current.error=null;if(current.index>=current.queue.length){current.status='finished';save(current)}else{current.status='running';save(current);openCurrent()}}
  function stop(){if(state()&&confirm('GG Queue volledig stoppen en de voortgang wissen?'))clear()}

  function render(){let panel=document.getElementById(PANEL_ID),current=state(),visible=isWorker()||(listPage()&&sessionStorage.getItem(SOURCE_KEY)===location.href);if(!current||!visible){panel?.remove();return}if(!panel){panel=document.createElement('aside');panel.id=PANEL_ID;panel.style.cssText='position:fixed;right:235px;top:10px;width:245px;z-index:99999998;background:#fff;color:#25313b;border:1px solid #cbd5df;border-radius:7px;box-shadow:0 5px 18px #0002;font:11px/1.3 system-ui;overflow:hidden';document.body.append(panel)}const total=current.queue?.length||0,done=Math.min(current.index||0,total),item=current.queue?.[current.index],labels={running:'Product openen',pushing:'Bezig met pushen…',paused:'Gepauzeerd',finished:'Klaar'},error=current.error?.message?`<div style="margin-top:7px;padding:6px;background:#fff0f0;color:#a61b1b;border-radius:4px">${safe(current.error.message)}</div>`:'',controls=current.status==='paused'?'<button data-q="retry">Opnieuw</button><button data-q="skip">Overslaan</button><button data-q="stop">Stop</button>':current.status==='finished'?'<button data-q="clear">Sluiten / wissen</button>':'<button data-q="stop">Stop</button>';panel.innerHTML=`<header style="padding:7px 9px;background:#263746;color:#fff;font-weight:650">GoedGepickt Queue</header><div style="padding:9px"><strong style="font-size:16px">${done} / ${total}</strong><div style="color:#63717c">${labels[current.status]||safe(current.status)}</div>${item?`<div style="margin-top:7px;padding:6px;background:#f4f7f9;border-radius:4px"><b>${safe(item.id)}</b>${item.name?`<br>${safe(item.name)}`:''}</div>`:''}${error}<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">${controls}</div></div>`;panel.querySelectorAll('button').forEach(button=>button.style.cssText='border:0;border-radius:4px;padding:5px 8px;background:#0877b9;color:#fff;font:600 10px system-ui;cursor:pointer');panel.querySelector('[data-q="retry"]')?.addEventListener('click',retry);panel.querySelector('[data-q="skip"]')?.addEventListener('click',skip);panel.querySelector('[data-q="stop"]')?.addEventListener('click',stop);panel.querySelector('[data-q="clear"]')?.addEventListener('click',clear)}

  document.addEventListener('ddo-toolbox:discover',report);
  document.addEventListener('ddo-toolbox:run-feature',event=>{let detail={};try{detail=JSON.parse(event.detail||'{}')}catch{}if(detail.id===ID)start()});
  window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY)render()});
  report();render();if(editId())handleEdit();
})();
