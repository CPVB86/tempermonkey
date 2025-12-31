// ==UserScript==
// @name         VCP | DDO Ex>Import
// @version      1.7
// @description  Start vanuit de checker direct een Attributes-export en biedt link naar B2B per merk
// @match        https://lingerieoutlet.nl/tools/stock/Voorraadchecker%20Proxy.htm
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      www.dutchdesignersoutlet.com
// @connect      dutchdesignersoutlet.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/VCP/vcp-ddo.user.js
// ==/UserScript==

(function () {
  // ---------- 0) Centrale CSS ----------
  const CSS = `
    .ddo-pill {
      background: #111827;
      color: #fff;
      padding: 10px 14px;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.15);
      max-width: 80vw;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font: inherit;
      border: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1.2;
      gap: .5ch;
    }
    /* Container voor knoppen, gecentreerd onderin */
    .ddo-fixed-bottom-wrap {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 72px;
      z-index: 99999;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .ddo-hidden { display: none; }
    .ddo-toast {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 72px;
      z-index: 100000; /* net boven de buttons */
      pointer-events: none;
    }
    .ddo-fade { transition: opacity .15s ease; opacity: 1; }
    .ddo-hidden.ddo-fade { opacity: 0; }
  `;
  (function injectCSS(){
    if (!document.querySelector('#ddo-proxy-css')) {
      const s = document.createElement('style');
      s.id = 'ddo-proxy-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  })();

  // ---------- 1) MAPPING ----------
  function basePayload(){ return { format: 'excel_attribute', export: 'Export products' }; }

  const EXPORTS = {
    freya: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=215', payload: basePayload() },
    'freya-swim': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=216', payload: basePayload() },
    fantasie: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=217', payload: basePayload() },
    'fantasie-swim': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=218', payload: basePayload() },
    elomi: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=219', payload: basePayload() },
    'elomi-swim': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=220', payload: basePayload() },
    wacoal: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=214', payload: basePayload() },
    muchachomalo: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=203', payload: basePayload() },
    hom: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=205', payload: basePayload() },
    'hom-swimwear': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=190', payload: basePayload() },
    'hom-nachtmode': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=207', payload: basePayload() },
    lisca: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=193', payload: basePayload() },
    'q-linn': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=111', payload: basePayload() },
    'sugar-candy': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=178', payload: basePayload() },
    anita: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=196', payload: basePayload() },
    'anita-active': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=197', payload: basePayload() },
    'anita-badmode': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=198', payload: basePayload() },
    'anita-care': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=199', payload: basePayload() },
    'anita-maternity': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=200', payload: basePayload() },
    'rosa-faia': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=195', payload: basePayload() },
    'rosa-faia-badmode': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=194', payload: basePayload() },
    'lingadore': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=213', payload: basePayload() },
    'lingadore-beach': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=223', payload: basePayload() },
    'lingadore-consignatie': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=231', payload: basePayload() },
    'triumph': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=221', payload: basePayload() },
    'sloggi': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=222', payload: basePayload() },
    'ringella': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=brand_id&id=191', payload: basePayload() },
    naturana: { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=225', payload: basePayload() },
    'naturana-swim': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=226', payload: basePayload() },
    'mundo-unico': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=228', payload: basePayload() },
    'zetex': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=224', payload: basePayload() },
    'charlie-choe': { url: 'https://www.dutchdesignersoutlet.com/admin.php?section=products&action=list&filter=tag_id&id=204', payload: basePayload() }
  };

  // B2B URL's per groep (jouw lijst, incl. nieuwe HOM-URL)
  const B2B_URLS = {
    anita:         'https://b2b.anita.com/',
    wacoal:        'https://b2b.wacoal-europe.com/b2b/en/EUR/login',
    lisca:         'https://b2b-eu.lisca.com/customer/account/login/',
    muchachomalo:  'https://agent.muchachomalo.com/en/login',
    'sugar-candy': 'https://b2b.cakelingerie.eu/authentication',
    'charlie-choe':'https://vangennip.itsperfect.it/webshop/shop/',
    hom:           'https://b2b.huberholding.com/huberholdingb2b/',
    lingadore:     'https://b2b.lingadore.com/',
    triumph:       'https://b2b.triumph.com/categories/NL_TriumphPROD',
    sloggi:        'https://b2b.triumph.com/categories/NL_sloggiPROD',
    zetex:         'https://b2b.zetex.nl/',
    ringella:      'https://b2b.ringella.com/',
    naturana:      'https://naturana-online.de/naturana/',
    'mundo-unico': 'https://www.colomoda.eu/',
    // qlinn:      'https://…' // toevoegen zodra beschikbaar
  };

  // ---------- 2) Helpers ----------
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const $ = (s, c=document) => c.querySelector(s);
  function waitSel(sel, timeout=10000){
    return new Promise((resolve, reject)=>{
      const t0 = Date.now();
      (function loop(){
        const el = $(sel);
        if (el) return resolve(el);
        if (Date.now()-t0 > timeout) return reject(new Error('Not found: '+sel));
        requestAnimationFrame(loop);
      })();
    });
  }
  const normalizeKey = k => String(k || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  function getSelectedKey(select){ return normalizeKey(select?.value); }

  // Key → B2B-groep
  function getB2BGroup(key){
    if (!key) return null;
    key = String(key).toLowerCase();
    if (/^(anita|rosa-faia)/.test(key)) return 'anita';
    if (/^(wacoal|freya|freya-swim|fantasie|fantasie-swim|elomi|elomi-swim)/.test(key)) return 'wacoal';
    if (/^lisca/.test(key)) return 'lisca';
    if (/^muchachomalo/.test(key)) return 'muchachomalo';
    if (/^sugar-candy/.test(key)) return 'sugar-candy';
    if (/^charlie-choe/.test(key)) return 'charlie-choe';
    if (/^hom/.test(key)) return 'hom';
    if (/^q-linn/.test(key)) return 'qlinn';
    if (/^(lingadore|lingadore-beach|lingadore-consignatie)/.test(key)) return 'lingadore';
    if (/^triumph/.test(key)) return 'triumph';
    if (/^sloggi/.test(key)) return 'sloggi';
    if (/^ringella/.test(key)) return 'ringella';
    if (/^zetex/.test(key)) return 'zetex';
    if (/^(naturana|naturana-badmode)/.test(key)) return 'naturana';
    if (/^mundo-unico/.test(key)) return 'mundo-unico';
    return null;
  }
  function getB2BUrlForKey(key){
    const group = getB2BGroup(key);
    return group ? B2B_URLS[group] : null;
  }

  // ---------- 3) UI: container + knoppen + toast ----------
  function ensureBtnWrap(){
    let wrap = $('#ddo-btn-wrap');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'ddo-btn-wrap';
      wrap.className = 'ddo-fixed-bottom-wrap ddo-hidden';
      document.body.appendChild(wrap);
    }
    return wrap;
  }
  function ensureImportBtn(wrap){
    let btn = $('#ddo-import-attributes-btn');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'ddo-import-attributes-btn';
      btn.type = 'button';
      btn.className = 'ddo-pill ddo-fade';
      btn.title = 'Haalt de export op en voert deze in jouw uploader (Alt+E)';
      wrap.appendChild(btn);
    }
    return btn;
  }
  function ensureB2BBtn(wrap){
    let btn = $('#ddo-b2b-btn');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'ddo-b2b-btn';
      btn.type = 'button';
      btn.className = 'ddo-pill ddo-fade';
      btn.textContent = '📦';
      btn.setAttribute('aria-label', 'Open B2B-portal');
      btn.title = 'Open B2B in nieuw tabblad (Alt+B)';
      wrap.appendChild(btn);
    }
    return btn;
  }
  function toast(msg){
    let t = $('#ddo-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ddo-toast';
      t.className = 'ddo-pill ddo-fade ddo-toast ddo-hidden';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove('ddo-hidden');
    clearTimeout(t._to);
    t._to = setTimeout(()=> t.classList.add('ddo-hidden'), 3200);
  }

  // ---------- 4) Export ophalen ----------
  async function fetchAttributes(url, payload){
    return new Promise((resolve, reject)=>{
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams(payload).toString(),
        responseType: 'arraybuffer',
        onload: (res) => {
          try {
            if (res.status !== 200) throw new Error('HTTP '+res.status+' bij ophalen export');
            const buf = res.response;
            if (!buf || !(buf.byteLength > 0)) throw new Error('Lege response ontvangen');
            resolve({ buffer: buf, mime: XLSX_MIME, filename: 'ddo-attributes.xlsx' });
          } catch (e) { reject(e); }
        },
        onerror: (e) => reject(e?.error || e),
        ontimeout: () => reject(new Error('Timeout bij ophalen export')),
      });
    });
  }

  // ---------- 5) Handoff naar uploader ----------
  async function handoffToUploader(fileBlob, filename, mime){
    const input = document.querySelector('#file-input');
    if (input) {
      const file = new File([fileBlob], filename, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      toast('Bestand ingevoerd via file-input ✔');
      return true;
    }
    const dropZone = document.querySelector('#drop-zone');
    if (dropZone) {
      const file = new File([fileBlob], filename, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('dragover',  { bubbles: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('drop',      { bubbles: true, dataTransfer: dt }));
      toast('Bestand “gedropt” op drop-zone ✔');
      return true;
    }
    toast('Geen uploader gevonden (#file-input of #drop-zone)');
    return false;
  }

  // ---------- 6) Init ----------
  (async function init(){
    const select = await waitSel('#leverancier-keuze');

    const wrap = ensureBtnWrap();
    const importBtn = ensureImportBtn(wrap);
    const b2bBtn = ensureB2BBtn(wrap);

    // Lock: na succesvolle upload knoppen blijvend verbergen
    let buttonsLocked = false;

    function refreshButtons(){
      if (buttonsLocked){
        wrap.classList.add('ddo-hidden');
        importBtn.classList.add('ddo-hidden');
        b2bBtn.classList.add('ddo-hidden');
        return;
      }
      const key  = getSelectedKey(select);
      const conf = EXPORTS[key];
      if (conf){
        const label = select.options[select.selectedIndex]?.text || key;
        importBtn.textContent = `Importeer de stock van ${label}`;
        wrap.classList.remove('ddo-hidden');
        importBtn.classList.remove('ddo-hidden');

        const b2bUrl = getB2BUrlForKey(key);
        if (b2bUrl){
          b2bBtn.dataset.href = b2bUrl;
          b2bBtn.classList.remove('ddo-hidden');
        } else {
          b2bBtn.classList.add('ddo-hidden');
          delete b2bBtn.dataset.href;
        }
      } else {
        importBtn.classList.add('ddo-hidden');
        b2bBtn.classList.add('ddo-hidden');
        wrap.classList.add('ddo-hidden');
      }
    }

    importBtn.addEventListener('click', async () => {
      wrap.classList.add('ddo-hidden'); // tijdelijk verbergen tijdens actie

      const key  = getSelectedKey(select);
      const conf = EXPORTS[key];
      if (!conf || !conf.url) {
        toast('Geen configuratie/URL gevonden.');
        if (!buttonsLocked) refreshButtons();
        return;
      }

      toast('Bezig met ophalen…');

      try {
        const { buffer, filename, mime } = await fetchAttributes(conf.url, conf.payload);
        const blob = new Blob([buffer], { type: mime || XLSX_MIME });
        const ok = await handoffToUploader(blob, filename, mime);

        if (ok) {
          toast('Upload gestart via jouw uploader 🎉');
          buttonsLocked = true; // vanaf nu nooit meer terug
        } else {
          // geen lock; gebruiker kan opnieuw proberen
        }
      } catch (e) {
        console.error('[DDO] Import/uploader handoff mislukt:', e);
        toast('Handoff mislukt (zie console)');
      } finally {
        if (!buttonsLocked) refreshButtons(); // alleen refreshen als niet gelockt
      }
    });

    b2bBtn.addEventListener('click', () => {
      const href = b2bBtn.dataset.href;
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    });

    // Keyboard shortcuts (alleen actief als wrap zichtbaar)
    window.addEventListener('keydown', (e) => {
      const visible = !wrap.classList.contains('ddo-hidden');
      if (!visible) return;

      if (e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        importBtn.click();
      }
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        b2bBtn.click();
      }
    });

    select.addEventListener('change', refreshButtons);
    select.addEventListener('input',  refreshButtons);

    refreshButtons();
  })();
})();
