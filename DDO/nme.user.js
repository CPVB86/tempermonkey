// ==UserScript==
// @name         DDO | Niet Meer Extern Tool
// @namespace    https://runiversity.nl/userscripts
// @version      1.1.0
// @description  Zet product heen en terug tussen Extern en NME.
// @author       You
// @match        https://www.dutchdesignersoutlet.com/admin.php?section=products&action=edit&id=*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const TAG_NME = 'SYST - NME';
  const TAG_EXTERN = 'SYST - Extern';
  const STOCK_TAG_PREFIX = 'STOCK - ';

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

  function setSelectByTextOrValue(selectEl, wantedTextsOrValues) {
    if (!selectEl) return false;

    const wanted = wantedTextsOrValues.map((v) => String(v).toLowerCase().trim());

    const opt = [...selectEl.options].find((o) => {
      const value = String(o.value || '').toLowerCase().trim();
      const text = String(o.textContent || '').toLowerCase().trim();
      return wanted.includes(value) || wanted.some((w) => text.includes(w));
    });

    if (!opt) {
      console.warn('[NME] Levertijd optie niet gevonden:', wantedTextsOrValues);
      return false;
    }

    selectEl.value = opt.value;
    trigger(selectEl);
    selectEl.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function replaceReference(fromTag, toTag) {
    const input = document.querySelector('input[name="reference"]');
    if (!input) return false;

    const before = input.value ?? '';
    const regex = new RegExp(`\\[${fromTag}\\]`, 'gi');
    const after = before
      .replace(regex, `[${toTag}]`)
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

    const ok = setSelectValue(select, '1');
    if (ok) console.log('[NME] Stock location -> Nijmegen');
    return ok;
  }

  function setDeliveryDirectFromStock() {
    const select = document.querySelector('select[name="delivery"]');
    if (!select) return false;

    const ok = setSelectValue(select, 'stock');
    if (ok) console.log('[NME] Delivery -> Direct from stock');
    return ok;
  }

  function setDeliveryTwoDays() {
    const select = document.querySelector('select[name="delivery"]');
    if (!select) return false;

    const ok = setSelectByTextOrValue(select, [
      '2',
      '2 dagen',
      '2 days',
      'two days'
    ]);

    if (ok) console.log('[NME] Delivery -> 2 dagen');
    return ok;
  }

  function getTagLabels() {
    const tab7 = document.querySelector('#tabs-7');
    if (!tab7) return [];

    return [...tab7.querySelectorAll('tr[id^="tagdelete_"]')].map((tr) => ({
      tr,
      label: (tr.querySelector('td.control')?.textContent || '').trim()
    }));
  }

  function hasTag(tagName) {
    return getTagLabels().some(({ label }) => label === tagName);
  }

  function ensureButtonVisibilityRule() {
    const nmeBtn = document.querySelector('#nme-action-btn');
    const extBtn = document.querySelector('#extern-action-btn');

    if (nmeBtn) nmeBtn.style.display = hasTag(TAG_EXTERN) ? '' : 'none';
    if (extBtn) extBtn.style.display = hasTag(TAG_NME) ? '' : 'none';
  }

  async function deleteTags(tagsToDelete, alsoDeleteStockTags = false) {
    let deleted = 0;

    for (const { tr, label } of getTagLabels()) {
      const shouldDelete =
        tagsToDelete.includes(label) ||
        (alsoDeleteStockTags && label.startsWith(STOCK_TAG_PREFIX));

      if (!shouldDelete) continue;

      const img = tr.querySelector('a.ajax_row_delete img[title="Delete"], a.ajax_row_delete img[alt="delete"]');
      const a = tr.querySelector('a.ajax_row_delete');

      let clicked = false;
      if (img) clicked = hardClick(img);
      if (!clicked && a) clicked = hardClick(a);

      if (clicked) {
        deleted++;
        console.log('[NME] Delete tag:', label);
        await sleep(150);
      }
    }

    return deleted;
  }

  async function ensureTagInput(tagToAdd) {
    const tab7 = document.querySelector('#tabs-7');
    if (!tab7) return false;

    const input = tab7.querySelector('input[name="tags_csv"]');
    if (!input) {
      console.warn('[NME] input[name="tags_csv"] niet gevonden.');
      return false;
    }

    const current = (input.value || '').trim();
    const parts = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const hasAlready = parts.some((p) => p.toLowerCase() === tagToAdd.toLowerCase());

    if (!hasAlready) parts.push(tagToAdd);

    const next = parts.join(', ');
    if (next !== current) {
      input.value = next;
      trigger(input);
      console.log('[NME] tags_csv bijgewerkt:', next);
      return true;
    }

    return false;
  }

  async function runToNme() {
    console.group('[NME] Naar NME');
    try {
      const did1 = replaceReference('ext', 'NME');
      const did2 = ensureStockLocationNijmegen();
      const did3 = setDeliveryDirectFromStock();

      await sleep(150);

      const deleted = await deleteTags([TAG_EXTERN], true);
      const did4 = await ensureTagInput(TAG_NME);

      await sleep(250);
      scrollToBottomSmooth();

      console.log('[NME] Klaar ✅', { did1, did2, did3, deletedTags: deleted, did4 });
      ensureButtonVisibilityRule();
    } catch (e) {
      console.error('[NME] Fout:', e);
      alert('NME script: er ging iets mis. Check console.');
    } finally {
      console.groupEnd();
    }
  }

  async function runToExtern() {
    console.group('[NME] Terug naar Extern');
    try {
      const did1 = replaceReference('NME', 'ext');
      const did2 = setDeliveryTwoDays();

      await sleep(150);

      const deleted = await deleteTags([TAG_NME], false);
      const did3 = await ensureTagInput(TAG_EXTERN);

      await sleep(250);
      scrollToBottomSmooth();

      console.log('[NME] Reverse klaar ✅', { did1, did2, deletedTags: deleted, did3 });
      ensureButtonVisibilityRule();
    } catch (e) {
      console.error('[NME] Reverse fout:', e);
      alert('NME reverse script: er ging iets mis. Check console.');
    } finally {
      console.groupEnd();
    }
  }

  function styleButton(btn, bg) {
    btn.style.background = bg;
    btn.style.color = '#fff';
    btn.style.border = `1px solid ${bg}`;
    btn.style.borderRadius = '4px';
    btn.style.padding = '2px 4px';
    btn.style.marginLeft = '5px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '700';
    btn.style.lineHeight = '1';
    btn.style.height = '22px';
    btn.style.verticalAlign = 'middle';
    btn.style.display = 'none';

    btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.85'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'));
  }

  function addButtons() {
    const nameInput = document.querySelector('input[name="name"]');
    if (!nameInput) return false;

    if (!document.querySelector('#nme-action-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'nme-action-btn';
      btn.textContent = 'NME';
      btn.title = 'Zet product naar Niet Meer Extern';

      styleButton(btn, '#000');

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';

        try {
          await runToNme();
        } finally {
          btn.textContent = old;
          btn.disabled = false;
        }
      });

      nameInput.insertAdjacentElement('afterend', btn);
    }

    if (!document.querySelector('#extern-action-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'extern-action-btn';
      btn.textContent = 'EXT';
      btn.title = 'Zet product terug naar Extern';

      styleButton(btn, '#8b0000');

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';

        try {
          await runToExtern();
        } finally {
          btn.textContent = old;
          btn.disabled = false;
        }
      });

      const nmeBtn = document.querySelector('#nme-action-btn');
      if (nmeBtn) nmeBtn.insertAdjacentElement('afterend', btn);
      else nameInput.insertAdjacentElement('afterend', btn);
    }

    ensureButtonVisibilityRule();
    return true;
  }

  addButtons();

  const obs = new MutationObserver(() => {
    addButtons();
    ensureButtonVisibilityRule();
  });

  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
