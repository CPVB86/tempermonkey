// ==UserScript==
// @name         DDO | Niet Meer Extern Tool
// @namespace    https://runiversity.nl/userscripts
// @version      1.0.0
// @description  Vervangt [ext] voor [NME], zet stock location op Nijmegen, delivery op Direct from stock, verwijdert STOCK - tags en voegt SYST - NME toe.
// @author       You
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @run-at       document-idle
// @author       C. P. v. Beek
// @updateURL    https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/nme.user.js
// @downloadURL  https://raw.githubusercontent.com/CPVB86/tempermonkey/main/DDO/nme.user.js
// ==/UserScript==

(() => {
  'use strict';

  const TAG_TO_ADD = 'SYST - NME';
  const STOCK_TAG_PREFIX = 'STOCK - ';
  const REQUIRED_TAG_TO_SHOW_BUTTON = 'SYST - Extern';

  const DELETE_EXACT_TAGS = new Set([
    'SYST - Extern',
  ]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function trigger(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function hardClick(el) {
    if (!el) return false;

    try { el.click(); return true; } catch (_) {}

    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (_) {}

    return false;
  }

  function scrollToBottomSmooth() {
    try {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }

  function setSelectValue(selectEl, value) {
    if (!selectEl) return false;
    if (selectEl.value === value) return true;

    const opt = [...selectEl.options].find((o) => o.value === value);
    if (!opt) return false;

    selectEl.value = value;
    trigger(selectEl);
    selectEl.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function removeExtFromReference() {
    const input = document.querySelector('input[name="reference"]');
    if (!input) return false;

    const before = input.value ?? '';
    const after = before
      .replace(/\[ext\]/gi, '[NME]')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (after !== before) {
      input.value = after;
      trigger(input);
      console.log('[NME] Reference aangepast:', { before, after });
      return true;
    }
    return false;
  }

  function ensureStockLocationNijmegen() {
    const select = document.querySelector('select[name="stock_location_id"]');
    if (!select) return false;

    // Nijmegen = value "1"
    const ok = setSelectValue(select, '1');
    if (ok) console.log('[NME] Stock location -> Nijmegen');
    return ok;
  }

  function setDeliveryDirectFromStock() {
    const select = document.querySelector('select[name="delivery"]');
    if (!select) return false;

    // Direct from stock = value "stock"
    const ok = setSelectValue(select, 'stock');
    if (ok) console.log('[NME] Delivery -> Direct from stock');
    return ok;
  }

  function shouldDeleteTagLabel(label) {
    if (!label) return false;
    if (label.startsWith(STOCK_TAG_PREFIX)) return true;
    if (DELETE_EXACT_TAGS.has(label)) return true;
    return false;
  }

  function hasRequiredTagInTab7() {
    const tab7 = document.querySelector('#tabs-7');
    if (!tab7) return false;

    const rows = [...tab7.querySelectorAll('tr[id^="tagdelete_"]')];
    return rows.some((tr) => {
      const label = (tr.querySelector('td.control')?.textContent || '').trim();
      return label === REQUIRED_TAG_TO_SHOW_BUTTON;
    });
  }

  function ensureButtonVisibilityRule() {
    const btn = document.querySelector('#nme-action-btn');
    if (!btn) return;

    const shouldShow = hasRequiredTagInTab7();

    // Alleen togglen als nodig (scheelt flicker)
    if (shouldShow && btn.style.display === 'none') btn.style.display = '';
    if (!shouldShow && btn.style.display !== 'none') btn.style.display = 'none';
  }

  async function deleteUnwantedTagsInTab7() {
    const tab7 = document.querySelector('#tabs-7');
    if (!tab7) {
      console.warn('[NME] #tabs-7 niet gevonden.');
      return 0;
    }

    const tagRows = [...tab7.querySelectorAll('tr[id^="tagdelete_"]')];
    let deleted = 0;

    for (const tr of tagRows) {
      const label = (tr.querySelector('td.control')?.textContent || '').trim();
      if (!shouldDeleteTagLabel(label)) continue;

      const img = tr.querySelector('a.ajax_row_delete img[title="Delete"], a.ajax_row_delete img[alt="delete"]');
      const a = tr.querySelector('a.ajax_row_delete');

      let clicked = false;
      if (img) clicked = hardClick(img);
      if (!clicked && a) clicked = hardClick(a);

      if (clicked) {
        deleted++;
        console.log('[NME] Delete tag (klik icoon):', label);
        await sleep(150);
      } else {
        console.warn('[NME] Kon delete niet klikken voor:', label, tr);
      }
    }

    return deleted;
  }

  async function ensureSystNmeTagInput() {
    const tab7 = document.querySelector('#tabs-7');
    if (!tab7) return false;

    const input = tab7.querySelector('input[name="tags_csv"]');
    if (!input) {
      console.warn('[NME] input[name="tags_csv"] niet gevonden.');
      return false;
    }

    const current = (input.value || '').trim();
    const parts = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const hasAlready = parts.some((p) => p.toLowerCase() === TAG_TO_ADD.toLowerCase());

    if (!hasAlready) parts.push(TAG_TO_ADD);

    const next = parts.join(', ');
    if (next !== current) {
      input.value = next;
      trigger(input);
      console.log('[NME] tags_csv bijgewerkt:', next);
      return true;
    }
    return false;
  }

  async function runAllActions() {
    console.group('[NME] Run');
    try {
      const did1 = removeExtFromReference();
      const did2 = ensureStockLocationNijmegen();
      const did3 = setDeliveryDirectFromStock();

      await sleep(150);

      const deleted = await deleteUnwantedTagsInTab7();
      const did4 = await ensureSystNmeTagInput();

      await sleep(250);
      scrollToBottomSmooth();

      console.log('[NME] Klaar ✅', { did1, did2, did3, deletedTags: deleted, did4 });

      // Na verwijderen van SYST - Extern kan de knop weg
      ensureButtonVisibilityRule();
    } catch (e) {
      console.error('[NME] Fout:', e);
      alert('NME script: er ging iets mis. Check console.');
    } finally {
      console.groupEnd();
    }
  }

  function addNmeButton() {
    const nameInput = document.querySelector('input[name="name"]');
    if (!nameInput) return false;

    if (document.querySelector('#nme-action-btn')) return true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'nme-action-btn';
    btn.textContent = 'NME';
    btn.title = 'Voer Nijmegen/stock/tags acties uit';

    btn.style.background = '#000';
    btn.style.color = '#fff';
    btn.style.border = '1px solid #000';
    btn.style.borderRadius = '4px';
    btn.style.padding = '2px 2px';
    btn.style.marginLeft = '5px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '700';
    btn.style.lineHeight = '1';
    btn.style.height = '22px';
    btn.style.verticalAlign = 'middle';
    btn.style.display = 'none'; // default: verbergen tot rule true is

    btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.85'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'));

    btn.addEventListener('click', async () => {
      scrollToBottomSmooth();

      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '...';
      try {
        await runAllActions();
      } finally {
        btn.textContent = old;
        btn.disabled = false;
      }
    });

    nameInput.insertAdjacentElement('afterend', btn);

    // pas direct rule toe
    ensureButtonVisibilityRule();

    return true;
  }

  addNmeButton();

  // Observer: detecteert wanneer tab7/tags geladen worden en togglet button
  const obs = new MutationObserver(() => {
    addNmeButton();
    ensureButtonVisibilityRule();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
