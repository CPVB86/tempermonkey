// ==UserScript==
// @name         DDO Toolbox | Adapter | FluentL
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.1.3
// @description  Zelfstandige Toolbox-koppeling voor de FluentL-vertaalmachine.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-fluentl.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-fluentl.user.js
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';

  const ID = 'fluentL';
  const VERSION = '2.1.3';
  const UPDATE_URL = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-fluentl.user.js';
  const SOURCE_URL = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/fluentl.user.js';
  const OPENER_ID = 'ddo-opener';
  const SECTIONS = new Set(['categories', 'brands', 'products', 'news', 'publisher']);
  let loading = null;

  const supported = () => {
    const params = new URLSearchParams(location.search);
    return params.get('action') === 'edit' && SECTIONS.has(params.get('section'));
  };

  const state = () => {
    const available = supported();
    const opener = document.getElementById(OPENER_ID);
    return {
      id: ID,
      kind: 'feature',
      label: 'FluentL',
      version: VERSION,
      updateUrl: UPDATE_URL,
      available,
      ready: available && !opener?.disabled,
      reason: available
        ? (opener ? 'FluentL gereed' : 'FluentL wordt bij gebruik geladen')
        : 'Open een ondersteunde bewerkpagina'
    };
  };

  const report = () => document.dispatchEvent(new CustomEvent('ddo-toolbox:adapter-state', {
    detail: JSON.stringify(state())
  }));

  const hideOpener = () => document.getElementById(OPENER_ID)?.classList.add('ddo-fluentl-adapter-control');

  const decorate = () => {
    const panel = document.getElementById('ddo-i18n-pro');
    if (!panel || panel.dataset.ddoFloating === '1') return;
    panel.dataset.ddoFloating = '1';
    Object.entries({position:'fixed',right:'auto',bottom:'auto',width:'480px',maxWidth:'calc(100vw - 20px)',maxHeight:'calc(100vh - 20px)',overflow:'auto'}).forEach(([key,value]) => panel.style.setProperty(key,value,'important'));
    const saved = (() => { try { return JSON.parse(localStorage.getItem('ddoFluentLPosition') || 'null'); } catch { return null; } })();
    const toolbox = document.getElementById('ddo-toolbox')?.getBoundingClientRect();
    const width = Math.min(480, innerWidth - 20);
    panel.style.setProperty('left', `${Math.min(saved?.left ?? Math.max(10,(toolbox?.left ?? innerWidth-225)-width-8),innerWidth-width-10)}px`, 'important');
    panel.style.setProperty('top', `${Math.min(saved?.top ?? Math.max(10,toolbox?.top ?? 10),innerHeight-40)}px`, 'important');
    const handle = panel.querySelector('header');
    if (!handle) return;
    handle.style.setProperty('cursor','move','important');
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,input,a,select,textarea,.flag')) return;
      const rect=panel.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;
      handle.setPointerCapture?.(event.pointerId);
      const move=e=>{panel.style.setProperty('left',`${Math.max(0,Math.min(innerWidth-panel.offsetWidth,e.clientX-dx))}px`,'important');panel.style.setProperty('top',`${Math.max(0,Math.min(innerHeight-32,e.clientY-dy))}px`,'important')};
      const stop=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',stop);try{localStorage.setItem('ddoFluentLPosition',JSON.stringify({left:panel.offsetLeft,top:panel.offsetTop}))}catch{}};
      document.addEventListener('pointermove',move);document.addEventListener('pointerup',stop,{once:true});
    });
  };

  const waitForOpener = (timeout = 10000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const opener = document.getElementById(OPENER_ID);
      if (opener) return resolve(opener);
      if (Date.now() - started >= timeout) return reject(new Error('FluentL is gestart, maar de bediening verscheen niet'));
      setTimeout(check, 100);
    };
    check();
  });

  const fetchSource = () => new Promise((resolve, reject) => GM_xmlhttpRequest({
    method: 'GET',
    url: `${SOURCE_URL}?_=${Date.now()}`,
    timeout: 30000,
    onload: response => response.status >= 200 && response.status < 300
      ? resolve(response.responseText)
      : reject(new Error(`FluentL-bron niet bereikbaar (HTTP ${response.status})`)),
    onerror: () => reject(new Error('FluentL-bron kon niet worden opgehaald')),
    ontimeout: () => reject(new Error('Ophalen van FluentL duurde te lang'))
  }));

  const load = async () => {
    const existing = document.getElementById(OPENER_ID);
    if (existing) return existing;
    if (!loading) loading = (async () => {
      const source = await fetchSource();
      eval(`${source}\n//# sourceURL=${SOURCE_URL}`);
      return waitForOpener();
    })().finally(() => { loading = null; });
    return loading;
  };

  const style = document.createElement('style');
  style.textContent = '.ddo-fluentl-adapter-control{display:none!important}#ddo-i18n-pro{font:12px/1.25 system-ui!important;color:#25313b!important}#ddo-i18n-pro .card{background:#fff!important;color:#25313b!important;border:1px solid #cbd5df!important;border-radius:7px!important;box-shadow:0 5px 18px #0002!important}#ddo-i18n-pro header{background:#263746!important;color:#fff!important;padding:7px 9px!important}#ddo-i18n-pro button{border:0!important;border-radius:4px!important;background:#0877b9!important;color:#fff!important}#ddo-i18n-pro button:hover{background:#18864b!important}#ddo-i18n-pro .chip,#ddo-i18n-pro .badge{background:#f4f7f9!important;color:#25313b!important;border-color:#cbd5df!important}#ddo-i18n-pro .settings{background:#fff!important;color:#25313b!important;border-color:#cbd5df!important}';
  document.documentElement.appendChild(style);

  document.addEventListener('ddo-toolbox:discover', () => {
    hideOpener();
    decorate();
    report();
  });

  document.addEventListener('ddo-toolbox:run-feature', async event => {
    let data = {};
    try { data = JSON.parse(event.detail || '{}'); } catch {}
    if (data.id !== ID || !supported()) return;
    try {
      const opener = await load();
      hideOpener();
      decorate();
      opener.click();
      report();
    } catch (error) {
      console.error('[DDO Adapter / FluentL]', error);
      alert(`FluentL kon niet starten: ${error.message}`);
    }
  });

  report();
})();
