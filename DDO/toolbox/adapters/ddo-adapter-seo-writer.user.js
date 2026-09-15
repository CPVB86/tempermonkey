// ==UserScript==
// @name         DDO Toolbox | Adapter | SEO Writer
// @namespace    https://dutchdesignersoutlet.nl/
// @version      2.3.0
// @description  Verbindt SEO Writer met de Toolbox en voegt aparte leveranciersproducttekstknoppen toe.
// @match        https://www.dutchdesignersoutlet.com/admin.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// @connect      b2b-api.vandeveldeservice.com
// @connect      chantelle.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-seo-writer.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-seo-writer.user.js
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';

  const ID = 'seoWriter';
  const VERSION = '2.3.0';
  const UPDATE_URL = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/toolbox/adapters/ddo-adapter-seo-writer.user.js';
  const SEO_OPENER = 'seo-writer-opener';
  const PRODUCT_BUTTON_ID = 'ddo-toolbox-product-writer';
  const SEO_SOURCE = 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/SEO/ddo-seo-gen-v3.0.user.js';
  const PRODUCT_WRITERS = Object.freeze([
    {
      id: 'ddo-vdv-producttekst',
      label: 'Van de Velde-producttekst',
      source: 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/van-de-velde-card-tekst.user.js',
      matches: brand => /^(?:primadonna|marie\s*jo|mariejo)\b/i.test(brand)
    },
    {
      id: 'ddo-chantelle-producttekst',
      label: 'Chantelle-producttekst',
      source: 'https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/chantelle-card-tekst.user.js',
      matches: brand => /^chantelle\b/i.test(brand)
    }
  ]);

  const isProductEdit = () => {
    const params = new URLSearchParams(location.search);
    return params.get('section') === 'products' && params.get('action') === 'edit' && !!params.get('id');
  };

  const selectedBrand = () => {
    const select = document.querySelector('select#brand[name="brand_id"]');
    return String(select?.selectedOptions?.[0]?.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const productWriter = () => {
    if (!isProductEdit()) return null;
    const brand = selectedBrand();
    return PRODUCT_WRITERS.find(writer => writer.matches(brand)) || null;
  };

  const seoFieldsExist = () => !!document.querySelector([
    'input[name="meta[nl][page_title]"]',
    'input[name="meta[nl][header_title]"]',
    'textarea[name="meta[nl][description]"]',
    'textarea[name="content"]',
    'textarea[name="description"]',
    'textarea[name*="footer"]'
  ].join(','));

  const target = () => {
    const opener = document.getElementById(SEO_OPENER);
    const available = seoFieldsExist();
    return {
      element: opener,
      label: 'SEO Writer',
      available,
      ready: available && !opener?.disabled,
      source: SEO_SOURCE,
      expectedId: SEO_OPENER,
      reason: available ? (opener ? 'SEO Writer gereed' : 'SEO Writer wordt bij gebruik geladen') : 'Geen ondersteunde tekstvelden op deze pagina'
    };
  };

  const state = () => {
    const current = target();
    return {
      id: ID,
      kind: 'feature',
      label: current.label,
      version: VERSION,
      updateUrl: UPDATE_URL,
      available: current.available,
      ready: current.ready,
      reason: current.reason
    };
  };

  let lastState = '';
  const report = (force = false) => {
    const detail = JSON.stringify(state());
    if (!force && detail === lastState) return;
    lastState = detail;
    document.dispatchEvent(new CustomEvent('ddo-toolbox:adapter-state', {detail}));
  };

  const hideLegacyControls = () => {
    [SEO_OPENER, ...PRODUCT_WRITERS.map(writer => writer.id)].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.classList.add('ddo-seo-adapter-control');
    });
  };

  const placeBesideToolbox = (panel, storageKey) => {
    if (!panel || panel.dataset.ddoFloating === '1') return;
    panel.dataset.ddoFloating = '1';
    panel.style.setProperty('position', 'fixed', 'important');
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
    panel.style.setProperty('max-height', 'calc(100vh - 20px)', 'important');
    panel.style.setProperty('overflow', 'auto', 'important');
    const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; } })();
    const toolbox = document.getElementById('ddo-toolbox')?.getBoundingClientRect();
    const width = Math.min(panel.offsetWidth || 760, innerWidth - 20);
    const left = saved?.left ?? Math.max(10, (toolbox?.left ?? innerWidth - 225) - width - 8);
    const top = saved?.top ?? Math.max(10, toolbox?.top ?? 10);
    panel.style.setProperty('left', `${Math.min(left, innerWidth - width - 10)}px`, 'important');
    panel.style.setProperty('top', `${Math.min(top, innerHeight - 40)}px`, 'important');
    const handle = panel.querySelector('.seo-writer-header');
    if (!handle) return;
    handle.style.cursor = 'move';
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,input,a,select,textarea')) return;
      const rect = panel.getBoundingClientRect(), dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      handle.setPointerCapture?.(event.pointerId);
      const move = e => {
        panel.style.setProperty('left', `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, e.clientX - dx))}px`, 'important');
        panel.style.setProperty('top', `${Math.max(0, Math.min(innerHeight - 32, e.clientY - dy))}px`, 'important');
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        try { localStorage.setItem(storageKey, JSON.stringify({left:panel.offsetLeft, top:panel.offsetTop})); } catch {}
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop, {once:true});
    });
  };

  const decorateSeoPanel = () => placeBesideToolbox(document.getElementById('seo-writer-panel'), 'ddoSeoWriterPosition');

  const installProductWriterButton = () => {
    const writer = productWriter();
    let button = document.getElementById(PRODUCT_BUTTON_ID);
    if (!writer) {
      button?.remove();
      return;
    }

    if (!button) {
      const editor = document.querySelector('#mce_1_tbl, textarea.htmleditor, textarea[name="description"]');
      const pid = document.querySelector('input[name="supplier_pid"]');
      const anchor = editor || pid;
      if (!anchor?.parentNode) return;
      button = document.createElement('button');
      button.type = 'button';
      button.id = PRODUCT_BUTTON_ID;
      button.className = 'ddo-inline-tool ddo-product-writer-button';
      anchor.parentNode.insertBefore(button, anchor);
      button.addEventListener('click', runProductWriter);
    }

    button.dataset.writerId = writer.id;
    const label = writer.label === 'Chantelle-producttekst'
      ? 'Chantelle-producttekst ophalen'
      : 'Van de Velde-producttekst ophalen';
    if (button.textContent !== label && !button.disabled) button.textContent = label;
    button.title = `Vul de producttekst vanuit ${writer.label.replace('-producttekst', '')}`;
  };

  const refresh = (force = false) => {
    hideLegacyControls();
    installProductWriterButton();
    decorateSeoPanel();
    report(force);
  };

  const waitForElement = (id, timeout = 10000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const element = document.getElementById(id);
      if (element) return resolve(element);
      if (Date.now() - started >= timeout) return reject(new Error(`Module gestart, maar #${id} verscheen niet`));
      setTimeout(check, 100);
    };
    check();
  });

  const fetchSource = url => new Promise((resolve, reject) => GM_xmlhttpRequest({
    method: 'GET',
    url: `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`,
    timeout: 30000,
    onload: response => response.status >= 200 && response.status < 300
      ? resolve(response.responseText)
      : reject(new Error(`Bronbestand niet bereikbaar (HTTP ${response.status})`)),
    onerror: () => reject(new Error('Bronbestand kon niet worden opgehaald')),
    ontimeout: () => reject(new Error('Ophalen van bronbestand duurde te lang'))
  }));

  const loading = new Map();
  const loadTarget = async current => {
    const existing = document.getElementById(current.expectedId);
    if (existing) return existing;
    if (!loading.has(current.expectedId)) loading.set(current.expectedId, (async () => {
      const source = await fetchSource(current.source);
      // De bron is dezelfde vertrouwde GitHub-bron die voorheen via @require werd geladen.
      eval(`${source}\n//# sourceURL=${current.source}`);
      return waitForElement(current.expectedId);
    })().finally(() => loading.delete(current.expectedId)));
    return loading.get(current.expectedId);
  };

  async function runProductWriter() {
    const proxy = document.getElementById(PRODUCT_BUTTON_ID);
    const writer = productWriter();
    if (!proxy || !writer || proxy.dataset.writerId !== writer.id || proxy.disabled) return;
    const originalText = proxy.textContent;
    proxy.disabled = true;
    proxy.textContent = 'Producttekst ophalen…';
    try {
      const control = await loadTarget({source: writer.source, expectedId: writer.id});
      hideLegacyControls();
      control.click();
      proxy.textContent = 'Producttekstfunctie gestart ✓';
    } catch (error) {
      console.error('[DDO Adapter / Producttekst]', error);
      proxy.textContent = 'Producttekst ophalen mislukt';
      alert(`Producttekst kon niet starten: ${error.message}`);
    } finally {
      setTimeout(() => {
        proxy.disabled = false;
        proxy.textContent = originalText;
      }, 2500);
    }
  }

  const style = document.createElement('style');
  style.textContent = '.ddo-seo-adapter-control{display:none!important}.ddo-product-writer-button{display:block!important;width:max-content;min-height:25px;margin:0 0 6px 0!important;padding:4px 9px!important;border:0;border-radius:4px;background:#0877b9;color:#fff;font:600 11px/1.2 system-ui;cursor:pointer}.ddo-product-writer-button:disabled{background:#8aa9ba;cursor:wait}#seo-writer-overlay{background:transparent!important;pointer-events:none!important}#seo-writer-panel{pointer-events:auto!important;background:#fff!important;color:#25313b!important;border:1px solid #cbd5df!important;border-radius:7px!important;box-shadow:0 5px 18px #0002!important}#seo-writer-panel .seo-writer-header{background:#263746!important;color:#fff!important;border-radius:6px 6px 0 0!important}#seo-writer-panel button:not(.seo-writer-close){border-radius:4px!important}';
  document.documentElement.appendChild(style);

  document.addEventListener('ddo-toolbox:discover', () => refresh(true));
  document.addEventListener('ddo-toolbox:run-feature', async event => {
    let data = {};
    try { data = JSON.parse(event.detail || '{}'); } catch {}
    if (data.id !== ID) return;
    const current = target();
    if (!current.ready) return;
    try {
      const control = current.element || await loadTarget(current);
      hideLegacyControls();
      decorateSeoPanel();
      control.click();
      refresh();
    } catch (error) {
      console.error('[DDO Adapter / SEO Writer]', error);
      alert(`SEO Writer kon niet starten: ${error.message}`);
    }
  });

  document.addEventListener('change', event => {
    if (event.target?.matches?.('select#brand[name="brand_id"]')) refresh();
  });

  let refreshPending = false;
  new MutationObserver(() => {
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => {
      refreshPending = false;
      refresh();
    });
  }).observe(document.documentElement, {childList: true, subtree: true});
  refresh();
  setTimeout(refresh, 250);
  setTimeout(refresh, 1000);
})();
