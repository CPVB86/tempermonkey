// ==UserScript==
// @name         Sparkle | DDO
// @version      2.5
// @description  Plakt HTML uit het klembord, vult backend velden in en zet description direct in de TinyMCE iframe-body (fallback-only). Klik ✨ of gebruik Ctrl+Shift+V / Cmd+Shift+V
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products*
// @grant        none
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/sparkle/sparkle-ddo.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- UI injectie ---
  const observer = new MutationObserver(() => {
    const tab1 = document.querySelector('#tabs-1');
    const messageBestaatAl = document.querySelector('#magicMsg');
    if (tab1 && !messageBestaatAl) addMagicMessage();
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

  // --- Events ---
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'magicMsg') return;
    e.preventDefault();
    runSparkle();
  });

  // Hotkey: Ctrl+Shift+V / Cmd+Shift+V
  document.addEventListener('keydown', (e) => {
    const keyV = e.key?.toLowerCase() === 'v' || e.code === 'KeyV';
    const modOK = (e.ctrlKey || e.metaKey) && e.shiftKey;
    if (!modOK || !keyV) return;

    if (isEditableTarget(document.activeElement)) return;

    e.preventDefault();
    runSparkle(true);
  });

  // --- Hoofdflow ---
  async function runSparkle(fromHotkey = false) {
    console.clear();
    console.log(`▶️ Start script ${fromHotkey ? '(hotkey)' : '(click)'}`);

    try {
      const nameInput = document.querySelector('input[name="name"]');
      const localName = nameInput?.value.trim() || '';

      const html = await navigator.clipboard.readText();
      console.log('📋 HTML gekopieerd:', html.slice(0, 300));

      const dom = new DOMParser().parseFromString(html, 'text/html');

      const name = dom.querySelector('.pdp-details_heading')?.textContent.trim() || '';
      console.log('🧾 Naam leverancier:', name);

      const priceText = dom.querySelector('.pdp-details_price__discounted')?.textContent.replace(/[^\d,\.]/g, '') || '0.00';
      const rrpText = dom.querySelector('.pdp-details_price__offer')?.textContent.replace(/[^\d,\.]/g, '') || '0.00';
      const price = priceText.replace(',', '.');
      const rrp = rrpText.replace(',', '.');

      const productCode = [...dom.querySelectorAll('.pdp-details_product-code')]
        .find(p => p.textContent.includes('Product Code'))
        ?.querySelector('span')?.textContent.trim() || '';

      const aMatch = dom.querySelector('a');
      const reference = aMatch ? ` - [ext]` : '';

      const modelName = dom.querySelector('.pdp-details_model span')?.textContent.trim() || '';

      // 📌 DESCRIPTION (platte tekst) uit export oppakken
      const descriptionText = dom.querySelector('.pdp-details_description')?.textContent.trim() || '';
      console.log('📝 Description:', descriptionText ? `${descriptionText.slice(0, 80)}…` : '(leeg)');

      const set = (selector, value) => {
        const el = document.querySelector(selector);
        if (el) el.value = value;
      };

      const fullTitle = `${localName} ${name}`.trim();

      // Velden vullen
      set('input[name="name"]', fullTitle);
      set('input[name="title"]', fullTitle);
      set('input[name="price"]', rrp);
      set('input[name="price_advice"]', rrp);
      set('input[name="price_vip"]', '0.00');
      set('input[name="supplier_pid"]', productCode);
      set('input[name="reference"]', reference);

      const publicNo = document.querySelector('input[name="public"][value="0"]');
      if (publicNo) publicNo.checked = true;

      const deliverySelect = document.querySelector('select[name="delivery"]');
      if (deliverySelect) {
        deliverySelect.value = '1-2d';
        deliverySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const brandSelect = document.querySelector('select[name="brand_id"]');
      if (brandSelect) {
        const match = [...brandSelect.options].find(opt =>
          opt.text.trim().toLowerCase() === localName.toLowerCase());
        if (match) {
          brandSelect.value = match.value;
          brandSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      selectModel(modelName);

      const tagInput = document.querySelector('input[name="tags_csv"]');
      if (tagInput) {
        tagInput.value = 'SYST - Promo, SYST - Extern, SYST - Webwinkelkeur, SYST - To Do';
        console.log('🏷️ Tags ingevuld via inputveld');
      }

      // 🔗 NIEUW: URL uit .url naar composition veld
      try {
        const urlEl = dom.querySelector('.url');
        if (urlEl) {
          let compositionVal = '';

          // 1) <a class="url" href="...">variant
          if (urlEl.tagName?.toLowerCase() === 'a' && urlEl.getAttribute('href')) {
            compositionVal = urlEl.getAttribute('href').trim();
          }

          // 2) Element met href/content attribuut (fallback)
          if (!compositionVal) {
            const href = urlEl.getAttribute?.('href') || urlEl.getAttribute?.('content') || '';
            if (href) compositionVal = href.trim();
          }

          // 3) Tekstinhoud als laatste redmiddel
          if (!compositionVal) {
            const txt = (urlEl.textContent || '').trim();
            if (txt) compositionVal = txt;
          }

          // Normaliseren naar absolute URL indien mogelijk
          if (compositionVal) {
            try {
              const u = new URL(compositionVal, location.href);
              compositionVal = u.href;
            } catch (_) { /* laat zoals geplakt */ }
          }

          if (compositionVal) {
            const compInput = document.querySelector('input[name="composition"]');
            if (compInput) {
              compInput.value = compositionVal;
              compInput.dispatchEvent(new Event('input', { bubbles: true }));
              compInput.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('🔗 Composition URL gezet:', compositionVal);
            } else {
              console.warn('⚠️ Veld input[name="composition"] niet gevonden.');
            }
          } else {
            console.log('ℹ️ .url gevonden maar geen bruikbare waarde.');
          }
        } else {
          console.log('ℹ️ Geen .url element in de geplakte HTML.');
        }
      } catch (e) {
        console.warn('⚠️ Fout bij verwerken .url → composition:', e);
      }

      // ✅ Alleen fallback: description direct in TinyMCE iframe-body zetten
      if (descriptionText) {
        const safe = escapeHtml(descriptionText);
        const htmlToSet = `<p>${safe}</p>`;
        await setContentIframeOnly(htmlToSet);
      } else {
        console.log('ℹ️ Geen description gevonden in klembord (oké om leeg te laten).');
      }

      console.log('✅ Klaar!');
    } catch (err) {
      console.error('❌ Fout:', err);
    }
  }

  // Modelselectie (ongewijzigd)
  function selectModel(name) {
    const maxWaitTime = 5000;
    const intervalTime = 200;
    let waited = 0;

    const nameLower = (name || '').toLowerCase();

    const interval = setInterval(() => {
      const modelSelect = document.querySelector('select[name="model_id"]');
      if (modelSelect && modelSelect.options.length > 1) {
        let bestMatch = null;
        let bestScore = 0;

        [...modelSelect.options].forEach(opt => {
          const optionText = (opt.textContent || '').toLowerCase();
          if (!optionText) return;

          if (optionText === nameLower) {
            bestMatch = opt;
            bestScore = 999;
            return;
          }

          const words = optionText.split(/[^a-z0-9]+/).filter(Boolean);
          let score = words.reduce((acc, word) => acc + (nameLower.includes(word) ? 1 : 0), 0);

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
