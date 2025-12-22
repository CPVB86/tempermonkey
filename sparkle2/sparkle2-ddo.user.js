// ==UserScript==
// @name         Sparkle 2 | DDO
// @version      3.2
// @description  Leest één SPARKLE payload uit het klembord en vult DDO backend velden. Klik ✨ of gebruik Ctrl+Shift+V / Cmd+Shift+V (vult + Update product).
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DATA_CONTRACT = [
    { key: 'name', label: 'Name', required: true },
    { key: 'title', label: 'Title', required: false },
    { key: 'rrp', label: 'RRP', required: true, transform: normalizePrice },
    { key: 'price', label: 'Price (discounted)', required: false, transform: normalizePrice },
    { key: 'productCode', label: 'Product Code', required: true },
    { key: 'modelName', label: 'Model name', required: false },
    { key: 'descriptionText', label: 'Description (plain)', required: false },
    { key: 'compositionUrl', label: 'Composition URL', required: false, transform: normalizeUrl },
    { key: 'reference', label: 'Reference', required: false }
  ];

  const DEFAULTS = {
    tagsCsv: 'SYST - Promo, SYST - Extern, SYST - Prune Me, SYST - Webwinkelkeur, SYST - To Do',
    delivery: '1-2d',
    publicValue: '0',
    priceVip: '0.00'
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function normalizePrice(v) {
    const cleaned = (v ?? '').toString().replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';
    return cleaned.replace(',', '.');
  }

  function normalizeUrl(v) {
    const s = (v ?? '').toString().trim();
    if (!s) return '';
    try { return new URL(s, location.href).href; } catch { return s; }
  }

  function escapeHtml(str = '') {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.$ === 'function') {
      try { window.$(el).trigger('input').trigger('change'); } catch (_) {}
    }
    return true;
  }

  function setChecked(selector, checked = true) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof window.$ === 'function') {
      try { window.$(el).trigger('change'); } catch (_) {}
    }
    return true;
  }

  function parseSparklePayload(raw) {
    const match = raw.match(/<!--\s*SPARKLE:(\{[\s\S]*?\})\s*-->/i);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }

  function validateAndNormalizePayload(payload) {
    const data = { ...(payload || {}) };
    const missing = [];

    for (const spec of DATA_CONTRACT) {
      const rawVal = data[spec.key];
      let val = rawVal;

      if (spec.transform) val = spec.transform(rawVal);
      if (val !== undefined) data[spec.key] = val;

      const isEmpty = (val === undefined || val === null || `${val}`.trim() === '');
      if (spec.required && isEmpty) missing.push(spec.label);
    }

    return { data, missing };
  }

  function applyDefaults() {
    setChecked(`input[name="public"][value="${DEFAULTS.publicValue}"]`, true);

    const deliverySelect = document.querySelector('select[name="delivery"]');
    if (deliverySelect) {
      deliverySelect.value = DEFAULTS.delivery;
      deliverySelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof window.$ === 'function') {
        try { window.$(deliverySelect).trigger('change'); } catch (_) {}
      }
    }

    const tagInput = document.querySelector('input[name="tags_csv"]');
    if (tagInput) {
      tagInput.value = DEFAULTS.tagsCsv;
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      tagInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof window.$ === 'function') {
        try { window.$(tagInput).trigger('input').trigger('change'); } catch (_) {}
      }
    }

    setValue('input[name="price_vip"]', DEFAULTS.priceVip);
  }

  function applyBrandByName(brandName) {
    const brandSelect = document.querySelector('select[name="brand_id"]');
    if (!brandSelect || !brandName) return;

    const match = [...brandSelect.options].find(opt =>
      (opt.text || '').trim().toLowerCase() === brandName.trim().toLowerCase()
    );

    if (match) {
      brandSelect.value = match.value;
      brandSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof window.$ === 'function') {
        try { window.$(brandSelect).trigger('change'); } catch (_) {}
      }
    }
  }

  async function setTinyMceHtml(htmlToSet) {
    const iframe = document.querySelector('iframe.tox-edit-area__iframe') || document.querySelector('iframe[id^="mce_"]');
    if (!iframe?.contentDocument) return false;

    for (let i = 0; i < 15; i++) {
      const body = iframe.contentDocument.getElementById('tinymce') || iframe.contentDocument.body;
      if (body) {
        body.innerHTML = htmlToSet;
        try { iframe.contentWindow?.focus?.(); } catch (_) {}
        return true;
      }
      await sleep(120);
    }
    return false;
  }

  function applyToBackend(data, ctx) {
    const supplierName = (data.name || '').trim();
    const title = (data.title || '').trim() || `${ctx.localName} ${supplierName}`.trim();

    setValue('input[name="name"]', title);
    setValue('input[name="title"]', title);

    setValue('input[name="price"]', data.rrp);
    setValue('input[name="price_advice"]', data.rrp);

    setValue('input[name="supplier_pid"]', (data.productCode || '').trim());
    setValue('input[name="reference"]', (data.reference || '').trim());

    if (data.compositionUrl) setValue('input[name="composition"]', data.compositionUrl);
    if (data.modelName) selectModel(data.modelName);
  }

  function triggerUpdateProduct() {
    const btn =
      document.querySelector('input[type="submit"][name="edit"][value="Update product"]') ||
      document.querySelector('input[type="submit"][name="edit"]');

    if (!btn) {
      console.warn('⚠️ Update-knop niet gevonden (input[name="edit"]).');
      return false;
    }

    // Run wired handlers
    try {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      btn.click();
    } catch (_) {}

    const form = btn.form || btn.closest('form');
    if (form) {
      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
        else form.submit();
      } catch (_) {}
    }

    console.log('💾 Update product getriggerd');
    return true;
  }

  function logContract(data) {
    console.log('📦 Sparkle payload data (normalized):');
    for (const spec of DATA_CONTRACT) {
      console.log(`- ${spec.label} (${spec.key}) =`, data?.[spec.key] ?? '');
    }
  }

  // --- UI injectie ---
  const observer = new MutationObserver(() => {
    if (document.querySelector('#tabs-1') && !document.querySelector('#magicMsg')) addMagicMessage();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function addMagicMessage() {
    const h2 = document.querySelector('#tabs-1 h2');
    if (!h2) return;

    const msg = document.createElement('div');
    msg.id = 'magicMsg';
    msg.textContent = '✨';
    Object.assign(msg.style, {
      fontSize: '1.2em',
      fontWeight: 'bold',
      color: '#d35400',
      marginTop: '10px',
      marginBottom: '10px',
      cursor: 'pointer',
      userSelect: 'none'
    });

    h2.insertAdjacentElement('afterend', msg);
  }

  // --- Hard hijack Ctrl+Shift+V (stop paste, always run Sparkle) ---
  let blockPasteUntil = 0;
  function hijackEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }

  document.addEventListener('paste', (e) => {
    if (Date.now() < blockPasteUntil) hijackEvent(e);
  }, true);

  // --- Events ---
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'magicMsg') return;
    e.preventDefault();
    runSparkle('click', { doUpdate: false });
  });

  document.addEventListener('keydown', (e) => {
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK) return;

    const key = (e.key || '').toLowerCase();
    const code = e.code;
    const isV = key === 'v' || code === 'KeyV';
    if (!isV) return;

    hijackEvent(e);
    blockPasteUntil = Date.now() + 400;

    (async () => {
      await runSparkle('hotkey-v', { doUpdate: true });
      await sleep(200);
      triggerUpdateProduct();
    })();
  }, true);

  // --- Hoofdflow ---
  async function runSparkle(trigger, { doUpdate } = { doUpdate: false }) {
    console.clear();
    console.log(`▶️ Sparkle start (${trigger})`);

    try {
      const nameInput = document.querySelector('input[name="name"]');
      const localName = nameInput?.value.trim() || '';

      const raw = await navigator.clipboard.readText();
      const payload = parseSparklePayload(raw);

      if (!payload) {
        console.error('❌ Geen SPARKLE payload gevonden in klembord.');
        console.info('➡️ Verwacht formaat: <!--SPARKLE:{...json...}-->');
        return false;
      }

      const { data, missing } = validateAndNormalizePayload(payload);

      if (missing.length) {
        console.error('❌ Payload mist verplichte velden:', missing.join(', '));
        logContract(data);
        return false;
      }

      logContract(data);

      applyDefaults();
      applyBrandByName(localName);
      applyToBackend(data, { localName });

      if ((data.descriptionText || '').trim()) {
        const safe = escapeHtml(data.descriptionText.trim());
        const ok = await setTinyMceHtml(`<p>${safe}</p>`);
        if (!ok) console.warn('⚠️ TinyMCE iframe/body niet gevonden of niet klaar.');
      }

      console.log('✅ Klaar!');
      return true;
    } catch (err) {
      console.error('❌ Fout:', err);
      return false;
    }
  }

  function selectModel(name) {
    const maxWaitTime = 5000;
    const intervalTime = 200;
    let waited = 0;

    const nameLower = (name || '').toLowerCase().trim();
    if (!nameLower) return;

    const interval = setInterval(() => {
      const modelSelect = document.querySelector('select[name="model_id"]');
      if (modelSelect && modelSelect.options.length > 1) {
        let bestMatch = null;
        let bestScore = 0;

        [...modelSelect.options].forEach(opt => {
          const optionText = (opt.textContent || '').toLowerCase().trim();
          if (!optionText) return;

          if (optionText === nameLower) {
            bestMatch = opt;
            bestScore = 999;
            return;
          }

          const words = optionText.split(/[^a-z0-9]+/).filter(Boolean);
          const score = words.reduce((acc, word) => acc + (nameLower.includes(word) ? 1 : 0), 0);

          if (score > bestScore) {
            bestScore = score;
            bestMatch = opt;
          }
        });

        if (bestMatch && bestScore > 0) {
          modelSelect.value = bestMatch.value;

          if (typeof window.$ === 'function') window.$(modelSelect).trigger('change');
          else modelSelect.dispatchEvent(new Event('change', { bubbles: true }));

          console.log(`✅ Beste modelmatch: ${bestMatch.textContent} (score: ${bestScore})`);
        } else {
          console.warn(`⚠️ Geen geschikte modelmatch gevonden in: "${name}"`);
        }

        clearInterval(interval);
      }

      waited += intervalTime;
      if (waited >= maxWaitTime) {
        console.warn('⏰ Timeout bij zoeken naar model-selectie');
        clearInterval(interval);
      }
    }, intervalTime);
  }
})();
