// ==UserScript==
// @name         Sparkle | DDO
// @version      2.6
// @description  Plakt HTML (of SPARKLE payload) uit het klembord, vult backend velden in en zet description direct in de TinyMCE iframe-body (fallback-only). Klik ✨ of gebruik Ctrl+Shift+V / Cmd+Shift+V
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // ✅ Sparkle Data Contract (WHAT we expect to receive as input)
  // ============================================================
  // Prefer: payload in clipboard like:
  // <!--SPARKLE:{"name":"...","rrp":"79.95","productCode":"ABC","modelName":"...","descriptionText":"...","compositionUrl":"...","reference":" - [ext]"}-->
  //
  // Fallback: regular HTML from supplier PDP (DOM parsing).
  const DATA_SPEC = [
    {
      key: 'name',
      label: 'Name',
      required: true,
      get: (dom) => dom.querySelector('.pdp-details_heading')?.textContent.trim() || ''
    },
    {
      key: 'rrp',
      label: 'RRP',
      required: true,
      get: (dom) => dom.querySelector('.pdp-details_price__offer')?.textContent || '',
      transform: (v) => normalizePrice(v)
    },
    {
      key: 'price',
      label: 'Price (discounted)',
      required: false,
      get: (dom) => dom.querySelector('.pdp-details_price__discounted')?.textContent || '',
      transform: (v) => normalizePrice(v)
    },
    {
      key: 'productCode',
      label: 'Product Code',
      required: true,
      get: (dom) => {
        const el = [...dom.querySelectorAll('.pdp-details_product-code')]
          .find(p => (p.textContent || '').includes('Product Code'))
          ?.querySelector('span');
        return el?.textContent.trim() || '';
      }
    },
    {
      key: 'modelName',
      label: 'Model name',
      required: false,
      get: (dom) => dom.querySelector('.pdp-details_model span')?.textContent.trim() || ''
    },
    {
      key: 'descriptionText',
      label: 'Description (plain)',
      required: false,
      get: (dom) => dom.querySelector('.pdp-details_description')?.textContent.trim() || ''
    },
    {
      key: 'compositionUrl',
      label: 'URL (composition field)',
      required: false,
      get: (dom) => extractUrlFromDom(dom)
    },
    {
      key: 'reference',
      label: 'Reference tag',
      required: false,
      get: (dom) => (dom.querySelector('a') ? ' - [ext]' : '')
    }
  ];

  // ==========================================
  // ✅ Backend mapping (WHERE we write the data)
  // ==========================================
  const TAGS_DEFAULT = 'SYST - Promo, SYST - Extern, SYST - Prune Me, SYST - Webwinkelkeur, SYST - To Do';
  const DELIVERY_DEFAULT = '1-2d';
  const PUBLIC_DEFAULT = '0';
  const PRICE_VIP_DEFAULT = '0.00';

  // --- UI injectie ---
  const observer = new MutationObserver(() => {
    const tab1 = document.querySelector('#tabs-1');
    const msg = document.querySelector('#magicMsg');
    if (tab1 && !msg) addMagicMessage();
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

  // --- Helpers ---
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const isEditableTarget = (el) => {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
    try { if (el.ownerDocument?.body?.id === 'tinymce') return true; } catch (_) {}
    return false;
  };

  function escapeHtml(str = '') {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizePrice(text) {
    const cleaned = (text || '').replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '0.00';
    return cleaned.replace(',', '.');
  }

  function extractUrlFromDom(dom) {
    const urlEl = dom.querySelector('.url');
    if (!urlEl) return '';

    let val = '';
    if (urlEl.tagName?.toLowerCase() === 'a') {
      val = (urlEl.getAttribute('href') || '').trim();
    }
    if (!val) {
      val = (urlEl.getAttribute?.('href') || urlEl.getAttribute?.('content') || '').trim();
    }
    if (!val) {
      val = (urlEl.textContent || '').trim();
    }
    if (!val) return '';

    try { return new URL(val, location.href).href; } catch { return val; }
  }

  function tryParseSparklePayload(raw) {
    const m = raw.match(/<!--\s*SPARKLE:(\{[\s\S]*?\})\s*-->/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  function validateRequired(data) {
    const missing = [];
    for (const spec of DATA_SPEC) {
      if (!spec.required) continue;
      const v = (data?.[spec.key] ?? '').toString().trim();
      if (!v) missing.push(spec.label || spec.key);
    }
    return missing;
  }

  function extractDataFromDom(dom) {
    const out = {};
    const missing = [];

    for (const spec of DATA_SPEC) {
      let v = spec.get(dom);
      if (spec.transform) v = spec.transform(v);
      out[spec.key] = v;

      if (spec.required && !v) missing.push(spec.label || spec.key);
    }

    return { data: out, missing };
  }

  function setValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setChecked(selector, checked = true) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function setContentIframeOnly(htmlToSet) {
    const selectors = [
      'iframe.tox-edit-area__iframe',
      'iframe#mce_1_ifr',
      'iframe#mce_0_ifr',
      'iframe[id^="mce_"]'
    ];

    let iframe = null;
    for (const sel of selectors) {
      iframe = document.querySelector(sel);
      if (iframe) break;
    }
    if (!iframe) {
      console.warn('⚠️ Geen TinyMCE iframe gevonden');
      return false;
    }

    const doc = iframe.contentDocument;
    if (!doc) {
      console.warn('⚠️ Geen contentDocument op TinyMCE iframe');
      return false;
    }

    for (let i = 0; i < 15; i++) {
      const body = doc.getElementById('tinymce') || doc.body;
      if (body) {
        body.innerHTML = htmlToSet;
        try { iframe.contentWindow?.focus?.(); } catch (_) {}
        console.log('✅ Description direct in iframe-body gezet');
        return true;
      }
      await sleep(120);
    }

    console.warn('⚠️ TinyMCE body niet gevonden na retries');
    return false;
  }

  function applyDefaults() {
    // public = 0
    setChecked(`input[name="public"][value="${PUBLIC_DEFAULT}"]`, true);

    // delivery = 1-2d
    const deliverySelect = document.querySelector('select[name="delivery"]');
    if (deliverySelect) {
      deliverySelect.value = DELIVERY_DEFAULT;
      deliverySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // tags
    const tagInput = document.querySelector('input[name="tags_csv"]');
    if (tagInput) {
      tagInput.value = TAGS_DEFAULT;
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      tagInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // price_vip
    setValue('input[name="price_vip"]', PRICE_VIP_DEFAULT);
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
    }
  }

  function applyToBackend(data, ctx) {
    const fullTitle = `${ctx.localName} ${data.name}`.trim();

    setValue('input[name="name"]', fullTitle);
    setValue('input[name="title"]', fullTitle);

    // Jouw huidige logica: price/price_advice = rrp
    setValue('input[name="price"]', data.rrp);
    setValue('input[name="price_advice"]', data.rrp);

    setValue('input[name="supplier_pid"]', data.productCode);
    setValue('input[name="reference"]', data.reference || '');

    if (data.compositionUrl) {
      const ok = setValue('input[name="composition"]', data.compositionUrl);
      if (!ok) console.warn('⚠️ Veld input[name="composition"] niet gevonden.');
    }

    if (data.modelName) selectModel(data.modelName);
  }

  function logData(data, missing) {
    console.log('📦 Sparkle input data:', data);
    if (missing?.length) console.warn('⚠️ Ontbrekende verplichte velden:', missing.join(', '));

    const desc = (data.descriptionText || '').trim();
    console.log('📝 Description:', desc ? `${desc.slice(0, 80)}…` : '(leeg)');
  }

  // --- Events ---
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'magicMsg') return;
    e.preventDefault();
    runSparkle(false);
  });

  // Hotkey: Ctrl+Shift+V / Cmd+Shift+V
  document.addEventListener('keydown', (e) => {
    const keyV = (e.key?.toLowerCase() === 'v') || (e.code === 'KeyV');
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK || !keyV) return;

    if (isEditableTarget(document.activeElement)) return;

    e.preventDefault();
    runSparkle(true);
  });

  // --- Hoofdflow ---
  async function runSparkle(fromHotkey = false) {
    console.clear();
    console.log(`▶️ Sparkle start ${fromHotkey ? '(hotkey)' : '(click)'}`);

    try {
      const nameInput = document.querySelector('input[name="name"]');
      const localName = nameInput?.value.trim() || '';
      if (!localName) console.warn('ℹ️ input[name="name"] leeg: brand match kan misgaan.');

      const raw = await navigator.clipboard.readText();
      console.log('📋 Clipboard (preview):', (raw || '').slice(0, 260));

      // 1) Prefer payload
      const payload = tryParseSparklePayload(raw);

      let data, missing;

      if (payload) {
        // Optional: normalize based on DATA_SPEC transforms where possible
        data = { ...payload };

        // Ensure known numeric fields normalized if present
        if ('rrp' in data) data.rrp = normalizePrice(data.rrp);
        if ('price' in data) data.price = normalizePrice(data.price);

        missing = validateRequired(data);
        console.log('🧠 SPARKLE payload gevonden (DOM extractie overgeslagen).');
      } else {
        // 2) Fallback: DOM parsing
        const dom = new DOMParser().parseFromString(raw, 'text/html');
        ({ data, missing } = extractDataFromDom(dom));
        console.log('🧩 DOM extractie gebruikt (geen payload gevonden).');
      }

      logData(data, missing);

      // Defaults first
      applyDefaults();

      // Brand (DDO) match op localName
      applyBrandByName(localName);

      // Apply extracted input
      applyToBackend(data, { localName });

      // ✅ Only fallback: description direct in TinyMCE iframe-body zetten
      if ((data.descriptionText || '').trim()) {
        const safe = escapeHtml(data.descriptionText.trim());
        const htmlToSet = `<p>${safe}</p>`;
        await setContentIframeOnly(htmlToSet);
      } else {
        console.log('ℹ️ Geen description gevonden in input (oké om leeg te laten).');
      }

      console.log('✅ Klaar!');
    } catch (err) {
      console.error('❌ Fout:', err);
    }
  }

  // Modelselectie (ongewijzigd, maar opgeruimd qua guard-rails)
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

          if (typeof window.$ === 'function') {
            window.$(modelSelect).trigger('change');
          } else {
            modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }

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
