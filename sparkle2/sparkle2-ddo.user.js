// ==UserScript==
// @name         Sparkle 2 | DDO
// @version      3.7
// @description  Leest één SPARKLE payload uit het klembord en vult DDO backend velden. Klik ✨ of gebruik Ctrl+Shift+V / Cmd+Shift+V (vult + Update product). Verwerkt descriptionHtml als gesanitized HTML in TinyMCE, anders descriptionText als plain. Ruimt overbodige <br> en lege <p> op.
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// ==/UserScript==

(function () {
  'use strict';

  console.log('✨ Sparkle script loaded v3.7');

  const DATA_CONTRACT = [
    { key: 'name', label: 'Name', required: true },
    { key: 'title', label: 'Title', required: false },
    { key: 'rrp', label: 'RRP', required: true, transform: normalizePrice },
    { key: 'price', label: 'Price (discounted)', required: false, transform: normalizePrice },
    { key: 'productCode', label: 'Product Code', required: true },
    { key: 'modelName', label: 'Model name', required: false },
    { key: 'descriptionHtml', label: 'Description (html)', required: false },
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

  const sleep = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };

  function normalizePrice(v) {
    const cleaned = (v == null ? '' : String(v)).replace(/[^\d,\.]/g, '').trim();
    if (!cleaned) return '';
    return cleaned.replace(',', '.');
  }

  function normalizeUrl(v) {
    const s = (v == null ? '' : String(v)).trim();
    if (!s) return '';
    try {
      return new URL(s, location.href).href;
    } catch (e) {
      return s;
    }
  }

  function escapeHtml(str) {
    str = str || '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeHtml(unsafeHtml) {
    const html = unsafeHtml == null ? '' : String(unsafeHtml);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(function (n) {
      n.remove();
    });

    const ALLOWED = new Set([
      'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U',
      'UL', 'OL', 'LI',
      'H1', 'H2', 'H3', 'H4',
      'A', 'SPAN',
      'BLOCKQUOTE'
    ]);

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (el) {
      const tag = el.tagName;

      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        const name = attr.name.toLowerCase();
        const val = (attr.value || '').trim();

        if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
        if (name === 'style') el.removeAttribute(attr.name);

        if ((name === 'href' || name === 'src') && /^javascript:/i.test(val)) {
          el.removeAttribute(attr.name);
        }
      });

      if (!ALLOWED.has(tag)) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }

      if (tag === 'A') {
        const href = (el.getAttribute('href') || '').trim();
        const ok =
          href.indexOf('/') === 0 ||
          /^https?:\/\//i.test(href) ||
          /^mailto:/i.test(href) ||
          /^tel:/i.test(href);

        if (!ok) el.removeAttribute('href');

        if (el.getAttribute('target') === '_blank') {
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });

    return doc.body.innerHTML.trim();
  }

  function tidyHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(html || '', 'text/html');
      const body = doc.body;

      body.querySelectorAll('p').forEach(function (p) {
        const clone = p.cloneNode(true);
        clone.querySelectorAll('br').forEach(function (br) {
          br.remove();
        });

        const text = (clone.textContent || '').replace(/\u00a0/g, ' ').trim();
        const hasMeaningfulText = text.length > 0;
        const hasMedia = p.querySelector('img, table, ul, ol, blockquote') != null;

        if (!hasMeaningfulText && !hasMedia) p.remove();
      });

      body.querySelectorAll('br').forEach(function (br) {
        let prev = br.previousSibling;
        while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) {
          prev = prev.previousSibling;
        }
        if (prev && prev.nodeName === 'BR') br.remove();
      });

      body.querySelectorAll('strong').forEach(function (strong) {
        let n = strong.nextSibling;
        while (n && n.nodeType === 3 && !n.nodeValue.trim()) {
          n = n.nextSibling;
        }

        if (n && n.nodeName === 'BR') {
          let next = n.nextSibling;
          while (next && next.nodeType === 3 && !next.nodeValue.trim()) {
            next = next.nextSibling;
          }
          if (next && next.nodeName === 'BR') next.remove();
        }
      });

      if (typeof NodeFilter !== 'undefined') {
        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(function (t) {
          t.nodeValue = t.nodeValue
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n');
        });
      }

      return body.innerHTML.trim();
    } catch (e) {
      console.warn('⚠️ tidyHtml failed, using raw html', e);
      return String(html || '').trim();
    }
  }

  function setValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;

    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (typeof window.$ === 'function') {
      try {
        window.$(el).trigger('input').trigger('change');
      } catch (e) {}
    }

    return true;
  }

  function setChecked(selector, checked) {
    const el = document.querySelector(selector);
    if (!el) return false;

    el.checked = checked !== false;
    el.dispatchEvent(new Event('change', { bubbles: true }));

    if (typeof window.$ === 'function') {
      try {
        window.$(el).trigger('change');
      } catch (e) {}
    }

    return true;
  }

  function parseSparklePayload(raw) {
    const match = raw.match(/<!--\s*SPARKLE:(\{[\s\S]*?\})\s*-->/i);
    if (!match) return null;

    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }

  function validateAndNormalizePayload(payload) {
    const data = Object.assign({}, payload || {});
    const missing = [];

    DATA_CONTRACT.forEach(function (spec) {
      const rawVal = data[spec.key];
      let val = rawVal;

      if (spec.transform) val = spec.transform(rawVal);
      if (val !== undefined) data[spec.key] = val;

      const isEmpty = (val === undefined || val === null || String(val).trim() === '');
      if (spec.required && isEmpty) missing.push(spec.label);
    });

    return { data: data, missing: missing };
  }

  function applyDefaults() {
    setChecked('input[name="public"][value="' + DEFAULTS.publicValue + '"]', true);

    const deliverySelect = document.querySelector('select[name="delivery"]');
    if (deliverySelect) {
      deliverySelect.value = DEFAULTS.delivery;
      deliverySelect.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof window.$ === 'function') {
        try {
          window.$(deliverySelect).trigger('change');
        } catch (e) {}
      }
    }

    const tagInput = document.querySelector('input[name="tags_csv"]');
    if (tagInput) {
      tagInput.value = DEFAULTS.tagsCsv;
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      tagInput.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof window.$ === 'function') {
        try {
          window.$(tagInput).trigger('input').trigger('change');
        } catch (e) {}
      }
    }

    setValue('input[name="price_vip"]', DEFAULTS.priceVip);
  }

  function applyBrandByName(brandName) {
    const brandSelect = document.querySelector('select[name="brand_id"]');
    if (!brandSelect || !brandName) return;

    const match = Array.prototype.slice.call(brandSelect.options).find(function (opt) {
      return (opt.text || '').trim().toLowerCase() === brandName.trim().toLowerCase();
    });

    if (match) {
      brandSelect.value = match.value;
      brandSelect.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof window.$ === 'function') {
        try {
          window.$(brandSelect).trigger('change');
        } catch (e) {}
      }
    }
  }

  async function setTinyMceHtml(fieldName, htmlToSet) {
    const textarea = document.querySelector('textarea[name="' + fieldName + '"]');
    if (!textarea) return false;

    const editorId = textarea.id;
    if (!editorId) return false;

    try {
      const api =
        (window.tinymce && typeof window.tinymce.get === 'function' && window.tinymce.get(editorId)) ||
        (window.tinyMCE && typeof window.tinyMCE.get === 'function' && window.tinyMCE.get(editorId));

      if (api && typeof api.setContent === 'function') {
        api.setContent(htmlToSet, { format: 'html' });

        try {
          if (api && typeof api.fire === 'function') api.fire('change');
        } catch (e) {}

        try {
          if (api && typeof api.fire === 'function') api.fire('input');
        } catch (e) {}

        if (typeof api.save === 'function') api.save();

        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    } catch (e) {}

    const iframeId = editorId + '_ifr';
    const iframe = document.getElementById(iframeId);
    if (!iframe) return false;

    for (let i = 0; i < 25; i++) {
      const doc = iframe.contentDocument;
      const body = doc && (doc.getElementById('tinymce') || doc.body);

      if (body) {
        body.innerHTML = htmlToSet;

        textarea.value = htmlToSet;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        try {
          if (iframe && iframe.contentWindow && typeof iframe.contentWindow.focus === 'function') {
            iframe.contentWindow.focus();
          }
        } catch (e) {}

        return true;
      }

      await sleep(120);
    }

    return false;
  }

  function applyToBackend(data, ctx) {
    const nameInput = document.querySelector('input[name="name"]');
    const existingName = (nameInput && nameInput.value ? nameInput.value : '').trim();

    const supplierName = (data.name || '').trim();
    const supplierTitle = (data.title || '').trim() || supplierName;

    const brandPrefixForName = (existingName || ctx.brandName || '').trim();
    const brandForTitle = (ctx.brandName || brandPrefixForName || '').trim();

    let newName = existingName;

    if (supplierTitle) {
      const normExisting = existingName.toLowerCase();
      const normSupplier = supplierTitle.toLowerCase();

      if (normExisting.indexOf(normSupplier) === -1) {
        newName = [brandPrefixForName, supplierTitle].filter(Boolean).join(' ').trim();
      }
    }

    if (newName && newName !== existingName) {
      setValue('input[name="name"]', newName);
    }

    let title = '';
    if (supplierTitle && brandForTitle) {
      title = (brandForTitle + ' ' + supplierTitle).trim();
    } else if ((data.title || '').trim()) {
      title = (data.title || '').trim();
    } else {
      title = newName || supplierTitle || existingName;
    }

    if (title) setValue('input[name="title"]', title);

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

    try {
      btn.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      btn.click();
    } catch (e) {}

    const form = btn.form || btn.closest('form');
    if (form) {
      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
        else form.submit();
      } catch (e) {}
    }

    console.log('💾 Update product getriggerd');
    return true;
  }

  function logContract(data) {
    console.log('📦 Sparkle payload data (normalized):');
    DATA_CONTRACT.forEach(function (spec) {
      console.log('- ' + spec.label + ' (' + spec.key + ') =', data && data[spec.key] != null ? data[spec.key] : '');
    });
  }

  const observer = new MutationObserver(function () {
    if (document.querySelector('#tabs-1') && !document.querySelector('#magicMsg')) {
      addMagicMessage();
    }
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

  let blockPasteUntil = 0;

  function hijackEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }
  }

  document.addEventListener('paste', function (e) {
    if (Date.now() < blockPasteUntil) hijackEvent(e);
  }, true);

  document.addEventListener('click', function (e) {
    if (!e.target || e.target.id !== 'magicMsg') return;
    e.preventDefault();
    runSparkle('click', { doUpdate: false });
  });

  document.addEventListener('keydown', function (e) {
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK) return;

    const key = (e.key || '').toLowerCase();
    const code = e.code;
    const isV = key === 'v' || code === 'KeyV';
    if (!isV) return;

    hijackEvent(e);
    blockPasteUntil = Date.now() + 400;

    (async function () {
      await runSparkle('hotkey-v', { doUpdate: true });
      await sleep(200);
      triggerUpdateProduct();
    })();
  }, true);

  async function runSparkle(trigger, options) {
    options = options || { doUpdate: false };

    console.clear();
    console.log('▶️ Sparkle start (' + trigger + ')');

    try {
      const nameInput = document.querySelector('input[name="name"]');
      const localNameRaw = (nameInput && nameInput.value ? nameInput.value : '').trim();
      const brandSelect = document.querySelector('select[name="brand_id"]');

      let brandName = localNameRaw;

      if (brandSelect && localNameRaw) {
        const exact = Array.prototype.slice.call(brandSelect.options).find(function (opt) {
          return (opt.text || '').trim().toLowerCase() === localNameRaw.trim().toLowerCase();
        });

        if (exact) {
          brandName = (exact.text || '').trim();
        } else {
          if (/^rj(\s|$)/i.test(localNameRaw)) brandName = 'RJ Bodywear';
        }
      } else {
        if (/^rj(\s|$)/i.test(localNameRaw)) brandName = 'RJ Bodywear';
      }

      const raw = await navigator.clipboard.readText();
      const payload = parseSparklePayload(raw);

      if (!payload) {
        console.error('❌ Geen SPARKLE payload gevonden in klembord.');
        console.info('➡️ Verwacht formaat: <!--SPARKLE:{...json...}-->');
        return false;
      }

      const result = validateAndNormalizePayload(payload);
      const data = result.data;
      const missing = result.missing;

      if (missing.length) {
        console.error('❌ Payload mist verplichte velden:', missing.join(', '));
        logContract(data);
        return false;
      }

      logContract(data);

      applyDefaults();
      applyBrandByName(brandName);
      applyToBackend(data, { localName: localNameRaw, brandName: brandName });

      const htmlRaw = (data.descriptionHtml || '').trim();
      const textRaw = (data.descriptionText || '').trim();
      let htmlToSet = '';

      if (htmlRaw) {
        htmlToSet = tidyHtml(sanitizeHtml(htmlRaw));
      } else if (textRaw) {
        const safe = escapeHtml(textRaw)
          .replace(/\n{2,}/g, '</p><p>')
          .replace(/\n/g, '<br>');
        htmlToSet = tidyHtml('<p>' + safe + '</p>');
      }

      if (htmlToSet) {
        const ok = await setTinyMceHtml('description', htmlToSet);
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

    const interval = setInterval(function () {
      const modelSelect = document.querySelector('select[name="model_id"]');

      if (modelSelect && modelSelect.options.length > 1) {
        let bestMatch = null;
        let bestScore = 0;

        Array.prototype.slice.call(modelSelect.options).forEach(function (opt) {
          const optionText = (opt.textContent || '').toLowerCase().trim();
          if (!optionText) return;

          if (optionText === nameLower) {
            bestMatch = opt;
            bestScore = 999;
            return;
          }

          const words = optionText.split(/[^a-z0-9]+/).filter(Boolean);
          const score = words.reduce(function (acc, word) {
            return acc + (nameLower.indexOf(word) !== -1 ? 1 : 0);
          }, 0);

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

          console.log('✅ Beste modelmatch: ' + bestMatch.textContent + ' (score: ' + bestScore + ')');
        } else {
          console.warn('⚠️ Geen geschikte modelmatch gevonden in: "' + name + '"');
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
